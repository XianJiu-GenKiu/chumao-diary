#!/usr/bin/env node
/**
 * 离线自测：地点公开字段出口（cloudfunctions-shared/locationFields.js）
 *
 * 不联网、不依赖小程序运行时，纯 Node 即可跑：
 *   node scripts/test-location-fields.js
 *
 * 重点盯三件事：
 *   1. 已下线功能的遗留字段（checkinCount / rating / commentCount ...）必须被剔除。
 *      脏字段的害处不是体积 —— pages/search/search.wxml 上绑着
 *      `wx:if="{{item._type === 'location' && item.rating}}"`，一旦历史文档的
 *      rating 非 0，搜索页就会给「已下线的评分」渲染一颗星。
 *   2. creatorOpenId 属用户个人信息，不得下发；替代品是服务端算好的 isMine。
 *   3. 四个读接口都必须真的走了这个出口 —— 早前 getLocationDetail 剔了、
 *      另外三处漏了，靠人工 review 已经漏过一次，这里用静态检查兜住。
 *
 * ⚠️ 改 locationFields.js 或任一读接口的返回体后必跑。
 */

const path = require('path')
const fs = require('fs')
const ROOT = path.resolve(__dirname, '..')

const {
  RETIRED_FIELDS,
  PRIVATE_FIELDS,
  stripRetiredFields,
  toPublicLocation
} = require(path.join(ROOT, 'cloudfunctions-shared/locationFields.js'))

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}${detail ? '  → ' + detail : ''}`) }
}

/** 一条「什么都有」的历史地点文档：既有合法字段，也有已下线功能的残留。 */
function fullDoc(overrides) {
  return Object.assign({
    _id: 'loc-1',
    name: '黔灵山公园',
    category: '公园绿地',
    latitude: 26.6,
    longitude: 106.6,
    address: '贵阳市云岩区',
    description: '适合出毛',
    tags: ['公园绿地', '林荫'],
    facilities: [{ key: 'restroom', name: '洗手间' }],
    images: ['cloud://a.png'],
    coverUrl: 'cloud://a.png',
    visibility: 'public',
    moderationStatus: 'approved',
    favoriteCount: 7,
    viewCount: 120,
    createdAt: new Date('2026-01-01'),
    creatorOpenId: 'oXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    // 以下为已下线功能的遗留字段
    checkinCount: 3,
    rating: 4.5,
    ratingCount: 9,
    creatorRating: 5,
    reactionUpCount: 2,
    reactionDownCount: 1,
    commentCount: 6
  }, overrides)
}

console.log('\n══ 1. 已下线功能的遗留字段被剔除 ══')
const cleaned = stripRetiredFields(fullDoc())
check('RETIRED_FIELDS 覆盖全部 7 个已知残留字段',
  RETIRED_FIELDS.length === 7 &&
  ['checkinCount', 'rating', 'ratingCount', 'creatorRating', 'reactionUpCount', 'reactionDownCount', 'commentCount']
    .every(k => RETIRED_FIELDS.includes(k)),
  RETIRED_FIELDS.join(','))
check('7 个字段全部不在结果里', RETIRED_FIELDS.every(k => cleaned[k] === undefined),
  RETIRED_FIELDS.filter(k => cleaned[k] !== undefined).join(','))
check('合法字段完整保留',
  cleaned.name === '黔灵山公园' && cleaned.favoriteCount === 7 && cleaned.viewCount === 120 &&
  cleaned.tags.length === 2 && cleaned.facilities.length === 1 && cleaned.visibility === 'public')

console.log('\n══ 2. creatorOpenId 不下发，改为 isMine ══')
const asOwner = toPublicLocation(fullDoc(), { openid: 'oXXXXXXXXXXXXXXXXXXXXXXXXXXX' })
const asOther = toPublicLocation(fullDoc(), { openid: 'someone-else-openid' })
check('PRIVATE_FIELDS 含 creatorOpenId', PRIVATE_FIELDS.includes('creatorOpenId'))
check('结果里没有 creatorOpenId', asOwner.creatorOpenId === undefined)
check('作者本人访问 → isMine = true', asOwner.isMine === true)
check('他人访问 → isMine = false', asOther.isMine === false)
check('未登录（openid 为空）→ isMine = false',
  toPublicLocation(fullDoc(), {}).isMine === false &&
  toPublicLocation(fullDoc(), { openid: '' }).isMine === false)
check('历史数据缺 creatorOpenId 时不误判为本人',
  toPublicLocation(fullDoc({ creatorOpenId: undefined }), { openid: 'x' }).isMine === false)

console.log('\n══ 3. extra 合并与不可变性 ══')
const withExtra = toPublicLocation(fullDoc(), {
  openid: 'oXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  extra: { isFavorited: true, favoriteCount: 99, _type: 'location' }
})
check('extra 字段被合并', withExtra.isFavorited === true && withExtra._type === 'location')
check('extra 可覆盖同名基础字段（调用方的计算结果优先）', withExtra.favoriteCount === 99)
check('isMine 不受 extra 影响', withExtra.isMine === true)
const original = fullDoc()
const before = JSON.stringify(original)
stripRetiredFields(original)
toPublicLocation(original, { openid: 'x' })
check('不修改传入的原对象（浅拷贝）', JSON.stringify(original) === before)

console.log('\n══ 4. 边界 ══')
check('null / undefined 原样返回不抛错',
  stripRetiredFields(null) === null && stripRetiredFields(undefined) === undefined &&
  toPublicLocation(null) === null)
check('字符串 / 数字原样返回不抛错',
  stripRetiredFields('x') === 'x' && toPublicLocation(42) === 42)
check('空对象返回带 isMine 的对象',
  toPublicLocation({}, { openid: 'x' }).isMine === false)
check('缺少全部下线字段的文档也能正常处理',
  toPublicLocation({ _id: 'a', name: 'A' }, { openid: 'x' }).name === 'A')

console.log('\n══ 5. 四个读接口都走了统一出口（静态检查）══')
const READERS = ['getLocations', 'getLocationDetail', 'getSeasonalLocations', 'searchLocations']
READERS.forEach(fn => {
  const src = fs.readFileSync(path.join(ROOT, 'cloudfunctions', fn, 'index.js'), 'utf8')
  check(`${fn} require 了 locationFields`, /require\(['"]\.\/locationFields['"]\)/.test(src))
  check(`${fn} 调用了 toPublicLocation`, /toPublicLocation\(/.test(src))
  check(`${fn} 不再自己写一份 RETIRED_FIELDS`, !/const RETIRED_FIELDS\s*=/.test(src))
})
check('四个接口的副本与母本一致（sync-shared）', (() => {
  const master = fs.readFileSync(path.join(ROOT, 'cloudfunctions-shared/locationFields.js'), 'utf8')
  return READERS.every(fn => {
    const p = path.join(ROOT, 'cloudfunctions', fn, 'locationFields.js')
    return fs.existsSync(p) && fs.readFileSync(p, 'utf8') === master
  })
})())

console.log('\n══ 6. 幽灵数据的真实消费点已断供 ══')
// 搜索页确实绑着 item.rating，所以 searchLocations 必须剔除 rating。
const searchWxml = fs.readFileSync(path.join(ROOT, 'pages/search/search.wxml'), 'utf8')
check('search.wxml 仍绑着 item.rating（说明剔除是必要的）', /item\.rating/.test(searchWxml))
const searchSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/searchLocations/index.js'), 'utf8')
check('searchLocations 返回值已不含 rating', /toPublicLocation\(/.test(searchSrc))
// 详情页不再自己比对 openid
const detailJs = fs.readFileSync(path.join(ROOT, 'pages/location-detail/location-detail.js'), 'utf8')
check('location-detail.js 改读 data.isMine', /data\.isMine/.test(detailJs))
check('location-detail.js 不再比对 creatorOpenId',
  !/data\.creatorOpenId\s*===/.test(detailJs))
// 季节推荐不再用下线字段做排序
const seasonalSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/getSeasonalLocations/index.js'), 'utf8')
// 剥掉行注释再查，否则解释「为什么不再用 reactionUpCount」的注释本身会被判为命中
const seasonalCode = seasonalSrc.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
check('getSeasonalLocations 不再用 reactionUpCount 排序',
  !/reactionUpCount/.test(seasonalCode))
check('getSeasonalLocations 不再下发内部排序字段 _score',
  !/_score:\s*season/.test(seasonalSrc))

console.log(`\n══ 结果：${pass} 通过 / ${fail} 失败 ══\n`)
process.exit(fail === 0 ? 0 : 1)
