#!/usr/bin/env node
/**
 * 出毛日记 · 双用户（多用户）功能可用性模拟
 *
 * 背景：线上数据里所有 posts / locations 的 creatorOpenId 都是同一个值，
 * 说明「第二个用户登录后能不能正常用」这条路径从未被真实跑通。开发者工具的
 * 模拟器又只能以固定微信号身份登录，无法切换账号实测。
 *
 * 做法：不改业务代码，只在 require 层替换 wx-server-sdk —— 注入
 *   1) 内存数据库（实现 CloudBase 的集合/查询/事务/命令语义，含「集合不存在」报错）；
 *   2) 可控的 cloud.getWXContext()，随时切换当前调用者 openid；
 *   3) 可控的内容安全审核接口（通过 / 不可用）。
 * 然后在同一份内存数据上让用户 A / B / C 依次真实调用云函数，断言跨用户行为。
 *
 * 用法：node scripts/multi-user-sim.js
 */

const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const CF = path.join(ROOT, 'cloudfunctions')

const USER_A = 'oXXXXXXXXXXXXXXXXXXXXXXXXXXX' // 线上既有用户（示例用户）
const USER_B = 'oB_simulated_second_user_00000001' // 新来的第二个用户
const USER_C = 'oC_simulated_no_avatar_user_000002' // 新用户但资料未完善

const CLONE = value => (value === undefined ? undefined : structuredClone(value))

/* ────────────────────────── 内存数据库 ────────────────────────── */

function notExistError(what) {
  const err = new Error(
    `${what}:fail -502005 database collection not exists. ` +
    '[ResourceNotFound] Db or Table not exist. Please check your request, but if the problem cannot be solved, contact us.'
  )
  err.errCode = -502005
  return err
}

function deepEqual(a, b) {
  if (a === b) return true
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((item, i) => deepEqual(item, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k]))
  }
  return false
}

function getPath(doc, key) {
  if (!key.includes('.')) return doc ? doc[key] : undefined
  return key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), doc)
}

function setPath(doc, key, value) {
  if (!key.includes('.')) { doc[key] = value; return }
  const parts = key.split('.')
  let cur = doc
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}
    cur = cur[parts[i]]
  }
  cur[parts[parts.length - 1]] = value
}

function haversine(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function matchField(value, expected) {
  if (expected && typeof expected === 'object' && expected.__op) {
    const op = expected.__op
    const operand = expected.value
    switch (op) {
      case 'eq': return deepEqual(value, operand)
      case 'neq': return !deepEqual(value, operand)
      case 'gt': return value > operand
      case 'gte': return value >= operand
      case 'lt': return value < operand
      case 'lte': return value <= operand
      case 'in': return Array.isArray(operand) && operand.some(item => deepEqual(value, item))
      case 'nin': return Array.isArray(operand) && !operand.some(item => deepEqual(value, item))
      case 'exists': return operand ? value !== undefined : value === undefined
      case 'all': return Array.isArray(value) && operand.every(item => value.includes(item))
      case 'size': return Array.isArray(value) && value.length === operand
      case 'geoNear': {
        // 只有带地理位置索引字段（Geo.Point）的文档才命中，与线上一致。
        const point = value && value.coordinates
        if (!Array.isArray(point) || point.length !== 2) return false
        const distance = haversine(operand.geometry.latitude, operand.geometry.longitude, point[1], point[0])
        return distance >= (operand.minDistance || 0) && distance <= operand.maxDistance
      }
      default: return true
    }
  }
  return deepEqual(value, expected)
}

function matchDoc(doc, cond) {
  if (!cond) return true
  if (cond.__logic === 'or') return cond.list.some(item => matchDoc(doc, item))
  if (cond.__logic === 'and') return cond.list.every(item => matchDoc(doc, item))
  return Object.entries(cond).every(([key, expected]) => matchField(getPath(doc, key), expected))
}

function applyUpdate(doc, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && value.__op) {
      switch (value.__op) {
        case 'inc': setPath(doc, key, (Number(getPath(doc, key)) || 0) + value.value); break
        case 'set': setPath(doc, key, CLONE(value.value)); break
        case 'remove': delete doc[key]; break
        case 'push': {
          const list = getPath(doc, key) || []
          list.push(...(Array.isArray(value.value) ? value.value : [value.value]))
          setPath(doc, key, list)
          break
        }
        case 'pull': {
          const list = (getPath(doc, key) || []).filter(item => !deepEqual(item, value.value))
          setPath(doc, key, list)
          break
        }
        default: break
      }
    } else {
      setPath(doc, key, CLONE(value))
    }
  }
}

let idSeq = 0
const nextId = prefix => `${prefix}_sim_${++idSeq}`

function createDbFactory(state, dbOptions) {
  const throwOnNotFound = !!dbOptions.throwOnNotFound

  const requireCollection = name => {
    const map = state[name]
    if (!map) throw notExistError(`collection.${name}`)
    return map
  }

  class DocRef {
    constructor(name, id) { this.name = name; this.id = id }
    async get() {
      const map = requireCollection(this.name)
      const doc = map.get(this.id)
      if (!doc) {
        if (throwOnNotFound) {
          const err = new Error(`document.get:fail document with _id ${this.id} does not exist`)
          err.errCode = -502002
          throw err
        }
        return { data: null, errMsg: '' }
      }
      return { data: CLONE(doc), errMsg: '' }
    }
    async set({ data }) {
      const map = requireCollection(this.name)
      map.set(this.id, { ...CLONE(data), _id: this.id })
      return { _id: this.id, errMsg: '' }
    }
    async update({ data }) {
      const map = requireCollection(this.name)
      const doc = map.get(this.id)
      if (!doc) {
        const err = new Error(`document.update:fail document with _id ${this.id} does not exist`)
        err.errCode = -502002
        throw err
      }
      applyUpdate(doc, data)
      return { stats: { updated: 1 }, errMsg: '' }
    }
    async remove() {
      const map = requireCollection(this.name)
      map.delete(this.id)
      return { stats: { removed: 1 }, errMsg: '' }
    }
  }

  class Query {
    constructor(name, cond) {
      this.name = name
      this.cond = cond
      this._order = []
      this._skip = 0
      this._limit = null
      this._field = null
    }
    orderBy(field, direction) { this._order.push([field, direction || 'asc']); return this }
    skip(n) { this._skip = n; return this }
    limit(n) { this._limit = n; return this }
    field(fields) { this._field = fields; return this }
    _select() {
      const map = requireCollection(this.name)
      let list = [...map.values()].map(CLONE).filter(doc => matchDoc(doc, this.cond))
      for (const [field, direction] of [...this._order].reverse()) {
        list.sort((a, b) => {
          const va = getPath(a, field)
          const vb = getPath(b, field)
          const na = va instanceof Date ? va.getTime() : va
          const nb = vb instanceof Date ? vb.getTime() : vb
          const cmp = typeof na === 'string' || typeof nb === 'string'
            ? String(na).localeCompare(String(nb))
            : (Number(na) || 0) - (Number(nb) || 0)
          return direction === 'desc' ? -cmp : cmp
        })
      }
      return list
    }
    _project(list) {
      if (!this._field) return list
      const keep = Object.entries(this._field).filter(([, v]) => v).map(([k]) => k)
      return list.map(doc => {
        const out = {}
        for (const key of keep) if (doc[key] !== undefined) out[key] = doc[key]
        if (this._field._id !== false && doc._id !== undefined) out._id = doc._id
        return out
      })
    }
    async get() {
      const list = this._select()
      const start = this._skip || 0
      const end = this._limit == null ? undefined : start + this._limit
      return { data: this._project(list.slice(start, end)), errMsg: '' }
    }
    async count() {
      return { total: this._select().length, errMsg: '' }
    }
    async update({ data }) {
      const map = requireCollection(this.name)
      let updated = 0
      for (const doc of map.values()) {
        if (matchDoc(doc, this.cond)) { applyUpdate(doc, data); updated++ }
      }
      return { stats: { updated }, errMsg: '' }
    }
    async remove() {
      const map = requireCollection(this.name)
      let removed = 0
      for (const [id, doc] of [...map.entries()]) {
        if (matchDoc(doc, this.cond)) { map.delete(id); removed++ }
      }
      return { stats: { removed }, errMsg: '' }
    }
  }

  class Collection {
    constructor(name) { this.name = name }
    doc(id) { return new DocRef(this.name, id) }
    where(cond) { return new Query(this.name, cond) }
    orderBy(field, direction) { return new Query(this.name, null).orderBy(field, direction) }
    skip(n) { return new Query(this.name, null).skip(n) }
    limit(n) { return new Query(this.name, null).limit(n) }
    async add({ data }) {
      const map = requireCollection(this.name)
      const id = data._id || nextId(this.name)
      if (map.has(id)) {
        const err = new Error(`collection.add:fail -501001 document already exists: _id=${id}`)
        err.errCode = -501001
        throw err
      }
      map.set(id, { ...CLONE(data), _id: id })
      return { _id: id, errMsg: '' }
    }
    get() { return new Query(this.name, null).get() }
    count() { return new Query(this.name, null).count() }
  }

  const command = {
    eq: value => ({ __op: 'eq', value }),
    neq: value => ({ __op: 'neq', value }),
    gt: value => ({ __op: 'gt', value }),
    gte: value => ({ __op: 'gte', value }),
    lt: value => ({ __op: 'lt', value }),
    lte: value => ({ __op: 'lte', value }),
    in: value => ({ __op: 'in', value }),
    nin: value => ({ __op: 'nin', value }),
    exists: value => ({ __op: 'exists', value }),
    all: value => ({ __op: 'all', value }),
    size: value => ({ __op: 'size', value }),
    inc: value => ({ __op: 'inc', value }),
    set: value => ({ __op: 'set', value }),
    remove: () => ({ __op: 'remove' }),
    push: value => ({ __op: 'push', value }),
    pull: value => ({ __op: 'pull', value }),
    geoNear: value => ({ __op: 'geoNear', value }),
    or: list => ({ __logic: 'or', list }),
    and: list => ({ __logic: 'and', list })
  }

  class GeoPoint {
    constructor(longitude, latitude) {
      this.type = 'Point'
      this.coordinates = [longitude, latitude]
      this.longitude = longitude
      this.latitude = latitude
    }
  }

  function createDb() {
    return {
      collection: name => new Collection(name),
      command,
      Geo: { Point: GeoPoint },
      serverDate: () => new Date(),
      createCollection: async name => {
        if (state[name]) {
          const err = new Error(`collection.create:fail -501001 CollectionExists: ${name}`)
          err.errCode = -501001
          throw err
        }
        state[name] = new Map()
        return { requestId: nextId('create') }
      },
      runTransaction: async fn => {
        // 快照式事务：回调抛错则整体回滚，用于验证「关系写入 + 计数」的原子性。
        const snapshot = new Map()
        for (const [name, map] of Object.entries(state)) {
          snapshot.set(name, new Map([...map].map(([id, doc]) => [id, CLONE(doc)])))
        }
        try {
          return await fn({ collection: name => new Collection(name) })
        } catch (err) {
          for (const name of Object.keys(state)) delete state[name]
          for (const [name, map] of snapshot) state[name] = new Map([...map].map(([id, doc]) => [id, CLONE(doc)]))
          throw err
        }
      }
    }
  }

  return createDb
}

/* ────────────────────────── wx-server-sdk 替身 ────────────────────────── */

function createCloudMock({ state, session, moderation }) {
  return {
    DYNAMIC_CURRENT_ENV: Symbol('DYNAMIC_CURRENT_ENV'),
    init() {},
    getWXContext() {
      return {
        OPENID: session.openid,
        UNIONID: '',
        APPID: 'wx0000000000000000',
        ENV: 'your-cloud-env-id'
      }
    },
    database: dbOptions => createDbFactory(state, dbOptions || {})(),
    downloadFile: async () => ({
      fileContent: Buffer.alloc(moderation.imageBytes || 2048)
    }),
    openapi: {
      security: {
        async msgSecCheck() {
          if (moderation.textUnavailable) {
            const err = new Error('errCode: -604101 function has no permission to call this API')
            err.errCode = -604101
            throw err
          }
          return { errcode: 0, errmsg: 'ok', result: { suggest: 'pass', label: 0 } }
        },
        async imgSecCheck() {
          if (moderation.imageUnavailable) {
            const err = new Error('errCode: -604101 function has no permission to call this API')
            err.errCode = -604101
            throw err
          }
          if (moderation.imageRejected) {
            return { errcode: 0, errmsg: 'ok', suggest: 'risky' }
          }
          return { errcode: 0, errmsg: 'ok', suggest: 'pass' }
        }
      }
    }
  }
}

const Module = require('module')

// 虚拟模块路径：不需要真实存在于磁盘，只需在 require.cache 里命中即可。
const SDK_MOCK_PATH = path.join(CF, '__sim__', 'wx-server-sdk', 'index.js')

let resolverPatched = false
const originalResolveFilename = Module._resolveFilename

/**
 * 拦截 require('wx-server-sdk')，让它解析到虚拟路径。
 * 注意：部分云函数目录没有自己的 node_modules（例如 getPosts），
 * 因此不能依赖 require.resolve 去找真实包，必须在解析层统一改写。
 */
function patchResolver() {
  if (resolverPatched) return
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'wx-server-sdk') return SDK_MOCK_PATH
    return originalResolveFilename.call(this, request, parent, isMain, options)
  }
  resolverPatched = true
}

function unpatchResolver() {
  if (!resolverPatched) return
  Module._resolveFilename = originalResolveFilename
  resolverPatched = false
}

/** 加载云函数；wx-server-sdk 由本模拟器提供 */
function loadFunction(fnName) {
  const dir = path.join(CF, fnName)
  for (const shared of ['contentSecurity.js', 'relationId.js', 'ensureCollection.js', 'visibility.js']) {
    delete require.cache[path.join(dir, shared)]
  }
  const entry = path.join(dir, 'index.js')
  delete require.cache[entry]
  return require(entry).main
}

class Simulator {
  constructor(state, moderation) {
    this.state = state
    this.moderation = moderation
    this.session = { openid: '' }
    this.loaded = new Map()
    patchResolver()
    // 替身实例在整轮模拟中复用，因此 ensureCollection 的进程内缓存行为与线上一致。
    require.cache[SDK_MOCK_PATH] = {
      id: SDK_MOCK_PATH,
      filename: SDK_MOCK_PATH,
      loaded: true,
      exports: createCloudMock({ state, session: this.session, moderation }),
      children: [],
      paths: []
    }
  }
  async call(fnName, openid, event = {}) {
    if (!this.loaded.has(fnName)) this.loaded.set(fnName, loadFunction(fnName))
    this.session.openid = openid
    return this.loaded.get(fnName)(event, {})
  }
  has(name) { return !!this.state[name] }
  all(name) { return this.state[name] ? [...this.state[name].values()] : [] }
  dispose() {
    delete require.cache[SDK_MOCK_PATH]
    unpatchResolver()
  }
}

/* ────────────────────────── 数据种子 ────────────────────────── */

const A_POST_ID = 'post_by_A_public'
const A_LOCATION_ID = 'location_by_A_public'

/**
 * @param {'live'|'fresh'} env
 *   live  —— 按线上现状播种：favorites / messages 已存在，follows 不存在
 *   fresh —— 全新环境：只有 users / posts / locations / comments
 */
function seed(env) {
  const state = {}
  const put = (name, id, doc) => {
    if (!state[name]) state[name] = new Map()
    state[name].set(id, { ...doc, _id: id })
  }

  put('users', 'user_A', {
    openId: USER_A,
    wechatOpenId: USER_A,
    nickname: '示例用户',
    avatar: 'cloud://env/avatars/a.jpg',
    status: 'active',
    createdAt: new Date('2026-07-27T15:00:00Z')
  })

  put('posts', A_POST_ID, {
    content: '森林公园出毛记录',
    images: ['cloud://env/posts/a1.jpg'],
    locationId: A_LOCATION_ID,
    location: { _id: A_LOCATION_ID },
    latitude: 26.547991,
    longitude: 106.75281,
    locationName: '森林公园',
    mood: '',
    tags: [],
    equipTags: [],
    visibility: 'public',
    creatorOpenId: USER_A,
    authorName: '示例用户',
    authorAvatar: 'cloud://env/avatars/a.jpg',
    likeCount: 0,
    reactionUpCount: 0,
    reactionDownCount: 0,
    commentCount: 0,
    shareCount: 0,
    createdAt: new Date('2026-07-27T16:41:26Z')
  })

  put('locations', A_LOCATION_ID, {
    name: '森林公园',
    category: '自然风光',
    tags: [],
    description: '适合叶落',
    images: ['cloud://env/locations/a1.jpg'],
    latitude: 26.547991,
    longitude: 106.75281,
    address: '贵州省贵阳市南明区园林路87号',
    indoor: false,
    style: 'forest',
    facilities: [],
    visibility: 'public',
    imageVisibility: 'public',
    creatorOpenId: USER_A,
    authorName: '示例用户',
    authorAvatar: 'cloud://env/avatars/a.jpg',
    creatorRating: 4,
    rating: 4,
    ratingCount: 0,
    favoriteCount: 0,
    checkinCount: 0,
    reactionUpCount: 0,
    reactionDownCount: 0,
    commentCount: 0,
    viewCount: 0,
    createdAt: new Date('2026-07-27T15:57:09Z')
  })

  put('comments', 'comment_by_A', {
    targetId: A_LOCATION_ID,
    targetType: 'location',
    content: '去过，确实不错',
    parentId: null,
    userOpenId: USER_A,
    authorName: '示例用户',
    authorAvatar: 'cloud://env/avatars/a.jpg',
    likeCount: 0,
    moderationStatus: 'approved',
    createdAt: new Date('2026-07-27T17:00:00Z')
  })

  if (env === 'live') {
    // 线上探测显示：favorites / messages 存在，follows / feedback 不存在。
    put('favorites', 'fav_existing', {
      targetId: A_POST_ID,
      targetType: 'post',
      userOpenId: USER_A,
      createdAt: new Date('2026-07-28T00:00:00Z')
    })
    if (!state.messages) state.messages = new Map()
  }

  if (env === 'fresh') {
    // 全新环境：连 comments 都还没被创建过（验证 comment-create 的集合自愈）。
    delete state.comments
  }

  return state
}

/* ────────────────────────── 断言与报告 ────────────────────────── */

const results = []
function check(label, condition, detail) {
  results.push({ label, pass: !!condition, detail: detail === undefined ? '' : String(detail) })
  const mark = condition ? '  ✓' : '  ✗'
  console.log(`${mark} ${label}${detail === undefined || detail === '' ? '' : ` — ${detail}`}`)
  return !!condition
}

function section(title) {
  console.log(`\n── ${title} ──`)
}

/* ────────────────────────── 主流程 ────────────────────────── */

async function runScenario(env) {
  console.log(`\n══════════ 场景：${env === 'live' ? '线上现状' : '全新环境'} ══════════`)

  const state = seed(env)
  const moderation = {
    textUnavailable: false,
    imageUnavailable: false,
    imageRejected: false,
    imageBytes: 2048
  }
  const sim = new Simulator(state, moderation)

  try {
    /* ── 1. 第二个用户登录 ── */
    section('用户 B 首次登录')
    const loginB = await sim.call('login', USER_B, {
      userInfo: { nickName: '新毛毛B', avatarUrl: 'cloud://env/avatars/b.jpg', gender: 0 }
    })
    check('B 登录成功', loginB.code === 0, JSON.stringify(loginB).slice(0, 120))
    const userB = sim.all('users').find(u => u.openId === USER_B)
    check('users 集合写入 B 的记录', !!userB, userB ? `nickname=${userB.nickname}` : '未找到')
    check('B 的记录写入 openId（驼峰）字段', !!userB && userB.openId === USER_B)

    /* ── 2. B 发动态 ── */
    section('用户 B 发动态（post-create）')
    const postB = await sim.call('post-create', USER_B, {
      content: '第一次来这里发动态，请多指教',
      images: [],
      location: null,
      tags: [],
      equipTags: [],
      visibility: 'public'
    })
    check('B 发动态成功', postB.code === 0, JSON.stringify(postB).slice(0, 160))
    const postBDoc = postB.code === 0 ? sim.state.posts.get(postB.data.postId) : null
    check('新动态 creatorOpenId = B', !!postBDoc && postBDoc.creatorOpenId === USER_B,
      postBDoc ? postBDoc.creatorOpenId : '无')

    /* ── 3. A 能看到 B 的动态吗 ── */
    section('用户 A 浏览（getPosts）')
    const postsAsA = await sim.call('getPosts', USER_A, { tab: 'discover', page: 1, pageSize: 20 })
    check('A 能读到动态列表', postsAsA.code === 0, JSON.stringify(postsAsA).slice(0, 120))
    const aSeesB = postsAsA.code === 0 && postsAsA.data.some(p => p.creatorOpenId === USER_B)
    check('A 能看到 B 刚发的动态（跨用户可见）', aSeesB,
      aSeesB ? '已可见' : `列表 creatorOpenId=${[...new Set((postsAsA.data || []).map(p => p.creatorOpenId))].join(',')}`)

    /* ── 4. B 打开 A 的动态详情 / 点赞 / 评论 ── */
    section('用户 B 与 A 的动态互动')
    const detailAsB = await sim.call('post-detail', USER_B, { postId: A_POST_ID })
    check('B 能打开 A 的动态详情', detailAsB.code === 0, JSON.stringify(detailAsB).slice(0, 120))
    check('详情里 B 的点赞状态独立（isLiked=false）', detailAsB.code === 0 && detailAsB.data.isLiked === false)

    const likeB = await sim.call('post-like', USER_B, { postId: A_POST_ID, action: 'like' })
    check('B 点赞 A 的动态成功', likeB.code === 0, JSON.stringify(likeB).slice(0, 160))
    check('点赞后 likeCount=1', (sim.state.posts.get(A_POST_ID).likeCount || 0) === 1,
      `likeCount=${sim.state.posts.get(A_POST_ID).likeCount}`)
    check('likes 集合被自动创建（ensureCollection）', sim.has('likes'))

    const likeBAgain = await sim.call('post-like', USER_B, { postId: A_POST_ID, action: 'like' })
    check('B 重复点赞幂等（不重复计数）',
      likeBAgain.code === 0 && (sim.state.posts.get(A_POST_ID).likeCount || 0) === 1,
      `likeCount=${sim.state.posts.get(A_POST_ID).likeCount}`)

    const detailAsB2 = await sim.call('post-detail', USER_B, { postId: A_POST_ID })
    check('B 再次打开详情 isLiked=true', detailAsB2.code === 0 && detailAsB2.data.isLiked === true)

    const detailAsA = await sim.call('post-detail', USER_A, { postId: A_POST_ID })
    check('作者 A 看到的点赞状态仍是独立的（isLiked=false）',
      detailAsA.code === 0 && detailAsA.data.isLiked === false)

    const commentB = await sim.call('comment-create', USER_B, {
      targetId: A_POST_ID, targetType: 'post', content: '这张拍得好好看', requestId: 'req-b-1'
    })
    check('B 评论 A 的动态成功', commentB.code === 0, JSON.stringify(commentB).slice(0, 160))
    check('评论后 commentCount=1', (sim.state.posts.get(A_POST_ID).commentCount || 0) === 1,
      `commentCount=${sim.state.posts.get(A_POST_ID).commentCount}`)

    const listAsA = await sim.call('comment-list', USER_A, { targetId: A_POST_ID, targetType: 'post', page: 1, pageSize: 20 })
    check('A 能看到 B 的评论', listAsA.code === 0 && listAsA.data.some(c => c.userOpenId === USER_B),
      listAsA.code === 0 ? `评论数=${listAsA.data.length}` : JSON.stringify(listAsA).slice(0, 120))

    /* ── 5. 互看主页 ── */
    section('互看对方主页（getUserPublicContent）')
    const homeAAsB = await sim.call('getUserPublicContent', USER_B, { targetOpenId: USER_A, page: 1, pageSize: 10 })
    check('B 能打开 A 的主页', homeAAsB.code === 0, JSON.stringify(homeAAsB).slice(0, 160))
    if (homeAAsB.code === 0) {
      check('A 主页返回 isSelf=false', homeAAsB.data.isSelf === false)
      check('A 主页能看到 A 的动态', homeAAsB.data.posts.length >= 1, `posts=${homeAAsB.data.posts.length}`)
      check('A 主页能看到 A 的地点', homeAAsB.data.locations.length >= 1, `locations=${homeAAsB.data.locations.length}`)
      check('未关注时 isFollowing=false', homeAAsB.data.isFollowing === false)
    }

    const homeBAsA = await sim.call('getUserPublicContent', USER_A, { targetOpenId: USER_B, page: 1, pageSize: 10 })
    check('A 能打开 B 的主页', homeBAsA.code === 0, JSON.stringify(homeBAsA).slice(0, 160))
    if (homeBAsA.code === 0) {
      check('B 主页能看到 B 刚发的动态', homeBAsA.data.posts.length >= 1, `posts=${homeBAsA.data.posts.length}`)
    }

    /* ── 6. 关注 ── */
    section('关注关系（followUser / getFollowList）')
    const followBtoA = await sim.call('followUser', USER_B, { targetOpenId: USER_A, action: 'follow' })
    check('B 关注 A 成功', followBtoA.code === 0, JSON.stringify(followBtoA).slice(0, 160))
    check('follows 集合被自动创建', sim.has('follows'))

    const followListB = await sim.call('getFollowList', USER_B, { type: 'following', page: 1, pageSize: 20 })
    check('B 的关注列表含 A', followListB.code === 0 && followListB.data.list.some(u => u.openId === USER_A),
      followListB.code === 0 ? `total=${followListB.data.total}` : JSON.stringify(followListB).slice(0, 140))

    const followerListA = await sim.call('getFollowList', USER_A, { type: 'followers', page: 1, pageSize: 20 })
    check('A 的粉丝列表含 B', followerListA.code === 0 && followerListA.data.list.some(u => u.openId === USER_B),
      followerListA.code === 0 ? `total=${followerListA.data.total}` : JSON.stringify(followerListA).slice(0, 140))

    const homeAAsB2 = await sim.call('getUserPublicContent', USER_B, { targetOpenId: USER_A, page: 1, pageSize: 10 })
    check('关注后 A 主页 isFollowing=true', homeAAsB2.code === 0 && homeAAsB2.data.isFollowing === true)

    // A 也关注 B，用于验证「关注」tab 只显示关注对象的动态
    await sim.call('followUser', USER_A, { targetOpenId: USER_B, action: 'follow' })
    const followPostsAsA = await sim.call('getPosts', USER_A, { tab: 'follow', page: 1, pageSize: 20 })
    check('A 的「关注」动态流只包含 B 的动态',
      followPostsAsA.code === 0 && followPostsAsA.data.length >= 1 &&
      followPostsAsA.data.every(p => p.creatorOpenId === USER_B),
      followPostsAsA.code === 0 ? `条数=${followPostsAsA.data.length}` : JSON.stringify(followPostsAsA).slice(0, 140))

    /* ── 7. 标记地点 ── */
    section('用户 B 标记地点')
    const locListAsB = await sim.call('getLocations', USER_B, { page: 1, pageSize: 10 })
    check('B 能看到 A 标记的地点', locListAsB.code === 0 && locListAsB.data.some(l => l._id === A_LOCATION_ID),
      locListAsB.code === 0 ? `条数=${locListAsB.data.length}` : JSON.stringify(locListAsB).slice(0, 140))

    const locDetailAsB = await sim.call('getLocationDetail', USER_B, { locationId: A_LOCATION_ID })
    check('B 能打开 A 的地点详情', locDetailAsB.code === 0, JSON.stringify(locDetailAsB).slice(0, 200))
    if (locDetailAsB.code === 0) {
      check('详情里 B 的签到状态独立（checkedIn=false）', locDetailAsB.data.checkedIn === false)
      if (env === 'live') {
        check('详情返回了该地点的评论', locDetailAsB.data.comments.length >= 1, `comments=${locDetailAsB.data.comments.length}`)
      } else {
        check('comments 集合不存在时地点详情仍可打开（降级为空评论）',
          locDetailAsB.data.comments.length === 0, `comments=${locDetailAsB.data.comments.length}`)
      }
    }

    const checkinB = await sim.call('checkInLocation', USER_B, { locationId: A_LOCATION_ID })
    check('B 在 A 的地点签到成功', checkinB.code === 0, JSON.stringify(checkinB).slice(0, 160))
    check('签到后 checkinCount=1', (sim.state.locations.get(A_LOCATION_ID).checkinCount || 0) === 1,
      `checkinCount=${sim.state.locations.get(A_LOCATION_ID).checkinCount}`)
    check('checkins 集合被自动创建', sim.has('checkins'))

    const checkinBAgain = await sim.call('checkInLocation', USER_B, { locationId: A_LOCATION_ID })
    check('B 当天重复签到被识别为已签到',
      checkinBAgain.code === 0 && checkinBAgain.data.already === true && (sim.state.locations.get(A_LOCATION_ID).checkinCount || 0) === 1,
      JSON.stringify(checkinBAgain).slice(0, 160))

    const checkinA = await sim.call('checkInLocation', USER_A, { locationId: A_LOCATION_ID })
    check('作者 A 也能签到（独立计数，checkinCount=2）',
      checkinA.code === 0 && (sim.state.locations.get(A_LOCATION_ID).checkinCount || 0) === 2,
      `checkinCount=${sim.state.locations.get(A_LOCATION_ID).checkinCount}`)

    const locCommentB = await sim.call('comment-create', USER_B, {
      targetId: A_LOCATION_ID, targetType: 'location', content: '这个地点周末人多吗', requestId: 'req-b-loc-1'
    })
    check('B 能给 A 的地点留言', locCommentB.code === 0, JSON.stringify(locCommentB).slice(0, 160))
    check('comments 集合被自动创建（ensureCollection）', sim.has('comments'))
    const locDetailAfterComment = await sim.call('getLocationDetail', USER_B, { locationId: A_LOCATION_ID })
    check('地点详情能看到 B 的留言',
      locDetailAfterComment.code === 0 && locDetailAfterComment.data.comments.some(c => c.userOpenId === USER_B),
      locDetailAfterComment.code === 0 ? `comments=${locDetailAfterComment.data.comments.length}` : '')

    const rateB = await sim.call('rateLocation', USER_B, {
      locationId: A_LOCATION_ID,
      dimRatings: { facilities: 4, scenery: 5, transport: 3, safety: 5, amenities: 4 }
    })
    check('B 给 A 的地点评分成功', rateB.code === 0, JSON.stringify(rateB).slice(0, 200))
    check('ratings 集合被自动创建', sim.has('ratings'))
    check('评分后 ratingCount=1', (sim.state.locations.get(A_LOCATION_ID).ratingCount || 0) === 1,
      `ratingCount=${sim.state.locations.get(A_LOCATION_ID).ratingCount}`)
    check('B 的维度评分被回读（myDimRatings 非空）', rateB.code === 0 && !!rateB.data.myDimRatings)

    const locDetailAsB3 = await sim.call('getLocationDetail', USER_B, { locationId: A_LOCATION_ID })
    check('B 再进详情已带出自己的评分维度',
      locDetailAsB3.code === 0 && !!locDetailAsB3.data.myDimRatings &&
      locDetailAsB3.data.myDimRatings.scenery === 5,
      locDetailAsB3.code === 0 ? JSON.stringify(locDetailAsB3.data.myDimRatings) : '')

    const favB = await sim.call('toggleFavorite', USER_B, { targetId: A_LOCATION_ID, targetType: 'location' })
    check('B 收藏 A 的地点成功', favB.code === 0, JSON.stringify(favB).slice(0, 200))
    check('收藏后 favoriteCount=1', (sim.state.locations.get(A_LOCATION_ID).favoriteCount || 0) === 1,
      `favoriteCount=${sim.state.locations.get(A_LOCATION_ID).favoriteCount}`)

    const addLocB = await sim.call('addLocation', USER_B, {
      name: 'B 新发现的天台',
      category: '城市街景',
      tags: ['夜景'],
      description: '晚上灯很好看，适合拍夜景出毛',
      images: ['cloud://env/locations/b1.jpg'],
      latitude: 26.556493,
      longitude: 106.710065,
      address: '贵阳市南明区',
      locationKind: 'shooting',
      visibility: 'public'
    })
    check('B 标记新地点成功', addLocB.code === 0, JSON.stringify(addLocB).slice(0, 200))
    const bLocationId = addLocB.code === 0 ? addLocB.data.locationId : null
    if (bLocationId) {
      const bLocDoc = sim.state.locations.get(bLocationId)
      check('B 的地点 creatorOpenId = B', bLocDoc.creatorOpenId === USER_B)
      check('B 的地点 moderationStatus = approved（审核接口正常时）',
        bLocDoc.moderationStatus === 'approved', `moderationStatus=${bLocDoc.moderationStatus}`)
    }

    const locListAsA = await sim.call('getLocations', USER_A, { page: 1, pageSize: 10 })
    check('A 能看到 B 新标记的地点',
      !!bLocationId && locListAsA.code === 0 && locListAsA.data.some(l => l._id === bLocationId),
      locListAsA.code === 0 ? `条数=${locListAsA.data.length}` : '')

    const homeBAsA2 = await sim.call('getUserPublicContent', USER_A, { targetOpenId: USER_B, page: 1, pageSize: 10 })
    check('A 在 B 的主页能看到 B 的地点',
      homeBAsA2.code === 0 && homeBAsA2.data.locations.length >= 1,
      homeBAsA2.code === 0 ? `locations=${homeBAsA2.data.locations.length}` : '')

    /* ── 8. 可见性边界：圈内内容不得泄漏 ── */
    section('可见性边界（circle / pending）')
    const circlePost = await sim.call('post-create', USER_A, {
      content: '只给圈内人看的动态', images: [], visibility: 'circle'
    })
    check('A 发布圈内动态成功', circlePost.code === 0, JSON.stringify(circlePost).slice(0, 160))
    const circleId = circlePost.code === 0 ? circlePost.data.postId : null
    if (circleId) {
      const postsAsB = await sim.call('getPosts', USER_B, { tab: 'discover', page: 1, pageSize: 50 })
      check('B 的动态流里看不到 A 的圈内动态',
        postsAsB.code === 0 && !postsAsB.data.some(p => p._id === circleId))
      const circleAsB = await sim.call('post-detail', USER_B, { postId: circleId })
      check('B 直接按 ID 打开圈内动态被拒绝', circleAsB.code === -1, JSON.stringify(circleAsB).slice(0, 120))
      const circleAsA = await sim.call('post-detail', USER_A, { postId: circleId })
      check('作者 A 自己可以打开圈内动态', circleAsA.code === 0)
      const likeCircleAsB = await sim.call('post-like', USER_B, { postId: circleId, action: 'like' })
      check('B 不能点赞圈内动态', likeCircleAsB.code === -1, JSON.stringify(likeCircleAsB).slice(0, 120))
    }

    // 审核服务不可用 → 内容落 pending → 只有作者可见（模拟 imgSecCheck 不可用）
    moderation.imageUnavailable = true
    const pendingPost = await sim.call('post-create', USER_B, {
      content: '带图动态（模拟图片审核不可用）',
      images: ['cloud://env/posts/b2.jpg'],
      visibility: 'public'
    })
    moderation.imageUnavailable = false
    check('图片审核不可用时动态仍可写入（不阻断发布）', pendingPost.code === 0,
      JSON.stringify(pendingPost).slice(0, 160))
    const pendingId = pendingPost.code === 0 ? pendingPost.data.postId : null
    if (pendingId) {
      const pendingDoc = sim.state.posts.get(pendingId)
      check('该动态落库为 pending', pendingDoc.moderationStatus === 'pending', pendingDoc.moderationStatus)
      const postsAsA2 = await sim.call('getPosts', USER_A, { tab: 'discover', page: 1, pageSize: 50 })
      check('⚠️ 其他用户（A）看不到这条 pending 动态',
        postsAsA2.code === 0 && !postsAsA2.data.some(p => p._id === pendingId))
      const pendingAsB = await sim.call('post-detail', USER_B, { postId: pendingId })
      check('作者 B 自己能看到 pending 动态', pendingAsB.code === 0)
      const homeBAsA3 = await sim.call('getUserPublicContent', USER_A, { targetOpenId: USER_B, page: 1, pageSize: 10 })
      check('⚠️ 这条动态也不会出现在他人看到的 B 主页上',
        homeBAsA3.code === 0 && !homeBAsA3.data.posts.some(p => p._id === pendingId))
    }

    /* ── 9. 资料未完善的新用户 ── */
    section('资料未完善的新用户 C')
    const loginC = await sim.call('login', USER_C, {})
    check('C 登录成功（无 userInfo 也能登）', loginC.code === 0, JSON.stringify(loginC).slice(0, 140))
    const postC = await sim.call('post-create', USER_C, { content: '资料还没填就发动态', images: [] })
    check('C 未填昵称/头像时发动态被拦截（提示补资料）',
      postC.code === -4 && postC.needProfile === true, JSON.stringify(postC).slice(0, 160))
    const addLocC = await sim.call('addLocation', USER_C, {
      name: 'C 的地点', category: '公园绿地', description: '一二三四五六七八九十',
      images: ['cloud://env/locations/c1.jpg'], latitude: 26.6, longitude: 106.7
    })
    check('C 未填昵称/头像时标记地点被拦截',
      addLocC.code === -4, JSON.stringify(addLocC).slice(0, 160))

    /* ── 10. 自己的内容列表 ── */
    section('「我的」内容列表（getUserContent / getUserStats）')
    const myPostsB = await sim.call('getUserContent', USER_B, { tab: 'dynamic', page: 1, pageSize: 20 })
    check('B 的「我的动态」只有自己的内容',
      myPostsB.code === 0 && myPostsB.data.every(p => p.creatorOpenId === USER_B),
      myPostsB.code === 0 ? `条数=${myPostsB.data.length}` : JSON.stringify(myPostsB).slice(0, 140))
    const myLocsB = await sim.call('getUserContent', USER_B, { tab: 'location', page: 1, pageSize: 20 })
    check('B 的「我的地点」只有自己的内容',
      myLocsB.code === 0 && myLocsB.data.every(l => l.creatorOpenId === USER_B),
      myLocsB.code === 0 ? `条数=${myLocsB.data.length}` : JSON.stringify(myLocsB).slice(0, 140))
    const myFavB = await sim.call('getUserContent', USER_B, { tab: 'favorite', page: 1, pageSize: 20 })
    check('B 的「我的收藏」可正常读取（收藏集合存在时）',
      myFavB.code === 0, JSON.stringify(myFavB).slice(0, 160))
    const statsB = await sim.call('getUserStats', USER_B, {})
    check('B 的统计接口可用', statsB.code === 0, JSON.stringify(statsB).slice(0, 200))
    if (statsB.code === 0) {
      check('统计数字按用户隔离（B 的动态数 < 全站动态数）',
        statsB.data.postCount < sim.state.posts.size,
        `B.postCount=${statsB.data.postCount}, 全站=${sim.state.posts.size}`)
    }
  } finally {
    sim.dispose()
  }
}

async function main() {
  console.log('出毛日记 · 双用户功能可用性模拟')
  console.log('（不改业务代码，注入内存数据库与可切换 openid 的 wx-server-sdk 替身）')

  await runScenario('live')
  await runScenario('fresh')

  const failed = results.filter(item => !item.pass)
  console.log(`\n══════════ 汇总 ══════════`)
  console.log(`断言总数: ${results.length}，通过: ${results.length - failed.length}，失败: ${failed.length}`)
  if (failed.length) {
    console.log('\n失败项：')
    for (const item of failed) console.log(`  ✗ ${item.label}${item.detail ? ` — ${item.detail}` : ''}`)
  }

  const out = path.join(__dirname, '.multi-user-sim.json')
  require('fs').writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2))
  console.log(`\n明细已写入 ${path.relative(ROOT, out)}`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(err => {
  console.error('模拟器自身出错:', err)
  process.exit(2)
})
