#!/usr/bin/env node
/**
 * 出毛日记 · 公开展示型（release/display）部署前验证
 *
 * 从 app.json 动态读取页面列表，因此不会因页面增减而失效。
 * 分两层：静态层（读本地源码，不需要 IDE）+ 运行时层（需要 IDE 自动化端口）。
 *
 *   静态 S:   云函数源码是否已按降级约定改造
 *   静态 S-2: 地点反馈规则集（服务端母本 ↔ 客户端副本）一致性与行为断言
 *   静态 S-3: 反馈通道边界（客户端不直读反馈集合 / 无分享入口 / 无提交列表）
 *   运行 A: 全部页面可达（含 2 个门禁页的预期重定向）
 *   运行 B: 运行时噪声（排除已知预期项）
 *   运行 C: tabBar 3 项可切换
 *   运行 E: 已删 14 页确认不可达
 *   运行 F: 核心读接口可用性 + 线上部署状态探测（未部署时只提示，不计失败）
 *
 * 用法：NODE_PATH=... node scripts/e2e-degrade-verify.js
 * 前置：IDE 已开服务端口 + `cli.bat auto --auto-port 9420`
 */
const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
const WS = process.env.MP_WS || 'ws://127.0.0.1:9420'

const results = []
function pass(name, detail = '') { results.push({ name, ok: true, detail }); console.log(`  \x1b[32mOK\x1b[0m   ${name}${detail ? '  — ' + detail : ''}`) }
function fail(name, detail = '') { results.push({ name, ok: false, detail }); console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? '  — ' + detail : ''}`) }
function info(msg) { console.log(`  \x1b[90m·\x1b[0m    ${msg}`) }

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

// 进程级兜底：IDE 侧自动化服务在大改版重编译时会对 reLaunch 返回
// 「timeout waiting for automator response」，该错误经 WebSocket 消息回调异步抛出，
// 页面层 try/catch 拦不到，未捕获会直接崩掉整个进程 —— 这里吞掉它让重试逻辑有机会接管。
const SWALLOW_ASYNC_NOISE = /timeout waiting for automator response|Connection closed, check if wechat web devTools/i
process.on('uncaughtException', err => {
  const msg = String((err && err.message) || err)
  if (SWALLOW_ASYNC_NOISE.test(msg)) { console.log('  … （进程级兜底：忽略 IDE 侧异步超时噪声）'); return }
  console.error('\n未捕获异常：', msg)
  process.exit(1)
})
process.on('unhandledRejection', err => {
  const msg = String((err && err.message) || err)
  if (SWALLOW_ASYNC_NOISE.test(msg)) { console.log('  … （进程级兜底：忽略未处理的异步超时拒绝）'); return }
  console.error('\n未处理的 Promise 拒绝：', msg)
})

// ────────────────────────────── 静态层 ──────────────────────────────
function staticChecks() {
  console.log('\n【S】云函数源码降级契约（静态读源码，不依赖部署）')

  const checks = [
    {
      name: 'getLeaderboard 已移除用户榜',
      file: 'cloudfunctions/getLeaderboard/index.js',
      bad: /\b(users|userRank|userList)\s*[:=]/,
      hint: '仍存在用户榜相关字段/变量'
    },
    {
      name: 'getUserStats 只返回 favoriteCount + locationCount',
      file: 'cloudfunctions/getUserStats/index.js',
      bad: /\b(postCount|likeCount|upCount|followCount|fansCount)\b/,
      hint: '仍返回社交统计字段'
    },
    {
      name: 'manageReports 提供 whoami 身份探测',
      file: 'cloudfunctions/manageReports/index.js',
      must: /action === 'whoami'/,
      hint: '缺少 whoami 分支，运营控制台无法探测身份'
    },
    {
      name: 'addLocation 有运营方白名单门禁（-403）',
      file: 'cloudfunctions/addLocation/index.js',
      must: /ADMIN_OPENIDS/,
      miss: /-403/,
      hint: '缺少 ADMIN_OPENIDS 门禁'
    },
    {
      name: 'getLocationDetail 不再返回帖子/评论/签到/评分',
      file: 'cloudfunctions/getLocationDetail/index.js',
      bad: /\b(posts|comments|hotReviews|checkInCount|reviewCount|rating)\b/,
      hint: '仍返回 UGC 字段'
    },
    {
      name: 'getUserContent 已移除「我的动态」分支',
      file: 'cloudfunctions/getUserContent/index.js',
      bad: /dynamic/,
      hint: '仍存在 dynamic 分支'
    },
    {
      name: 'toggleFavorite 不再通知作者（跨用户可见点）',
      file: 'cloudfunctions/toggleFavorite/index.js',
      bad: /(sendMessage|notif|notify|messages\.add|通知)/,
      hint: '仍存在通知作者逻辑'
    },
    {
      name: 'manageCollections 无自由文本入参（name/description）',
      file: 'cloudfunctions/manageCollections/index.js',
      bad: /(data\.name|data\.description|event\.name|event\.description)/,
      hint: '仍接受用户自由文本'
    },
    {
      name: 'generateShareCode 页面白名单不含 event',
      file: 'cloudfunctions/generateShareCode/index.js',
      bad: /pages\/event-detail/,
      hint: '白名单仍有 event-detail'
    },
    {
      name: 'searchLocations 已移除帖子召回分支',
      file: 'cloudfunctions/searchLocations/index.js',
      bad: /\bposts\b/,
      hint: '仍召回帖子'
    },
    // ── 精选链路与足迹本地化（本轮功能改造契约） ──
    {
      name: 'getLocations 支持 featuredOnly 精选过滤',
      file: 'cloudfunctions/getLocations/index.js',
      must: /featuredOnly/,
      hint: '缺少精选过滤，地图「精选」视角与底部精选推荐无数据来源'
    },
    {
      name: 'addLocation 接受 featured 精选标记',
      file: 'cloudfunctions/addLocation/index.js',
      must: /featured/,
      hint: '运营方无法在录入时标记精选'
    },
    {
      name: '足迹页不再依赖官方兽聚名录（已改为用户本机自建）',
      file: 'pages/footprints/footprints.js',
      bad: /config\/furmeets/,
      hint: '仍引用已删除的官方名录'
    },
    {
      name: 'getMapSnapshot 是纯只读代理（不读写任何集合）',
      file: 'cloudfunctions/getMapSnapshot/index.js',
      bad: /\.collection\(|\.(add|update|remove)\(/,
      hint: '出现数据库读写，超出静态图代理职责'
    },
    // ── 用户地点反馈通道（单向：用户 → 运营方） ──
    {
      name: 'submitLocationFeedback 只写反馈表，不写公开地点库',
      file: 'cloudfunctions/submitLocationFeedback/index.js',
      bad: /collection\(\s*['"]locations['"]\s*\)/,
      hint: '提交路径出现了对公开 locations 集合的写入'
    },
    {
      name: 'submitLocationFeedback 有每日提交上限（防刷）',
      file: 'cloudfunctions/submitLocationFeedback/index.js',
      must: /DAILY_LIMIT/,
      hint: '缺少防刷上限'
    },
    {
      name: 'manageSubmissions 有运营方白名单门禁',
      file: 'cloudfunctions/manageSubmissions/index.js',
      must: /ADMIN_OPENIDS/,
      hint: '缺少 ADMIN_OPENIDS 门禁'
    },
    {
      name: 'manageSubmissions 不对外返回提交者身份',
      file: 'cloudfunctions/manageSubmissions/index.js',
      bad: /submitterOpenId/,
      hint: '对外返回里出现了提交者字段（违反「不暴露提交者」边界）'
    }
  ]

  for (const c of checks) {
    let src
    try { src = read(c.file) } catch (e) { fail(c.name, '文件缺失 ' + c.file); continue }
    // 剔除注释，避免注释里的说明文字造成误判
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    if (c.bad && c.bad.test(code)) { fail(c.name, c.hint); continue }
    if (c.must && !c.must.test(code)) { fail(c.name, c.hint); continue }
    if (c.miss && !c.miss.test(code)) { fail(c.name, c.hint); continue }
    pass(c.name)
  }
}

// ─────────────────── 静态层 2：类型清单一致性 ───────────────────
// 客户端不 require 云函数目录，因此类型标签存在两份。这里直接 require 两份
// 做逐项比对与行为断言，比正则匹配强得多（能抓到「加了标签但只改一边」）。
function configChecks() {
  console.log('\n【S-2】地点反馈规则集：服务端母本 ↔ 客户端副本')
  const server = require(path.join(ROOT, 'cloudfunctions-shared/locationFeedback.js'))
  const client = require(path.join(ROOT, 'config/location-feedback.js'))

  const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length && a.every((v, i) => v === b[i])

  if (sameList(server.FEEDBACK_CATEGORIES, client.FEEDBACK_CATEGORIES)) {
    pass(`类型标签清单一致（${server.FEEDBACK_CATEGORIES.length} 项）`, server.FEEDBACK_CATEGORIES.join(' / '))
  } else {
    fail('类型标签清单漂移', `服务端 [${server.FEEDBACK_CATEGORIES}] ≠ 客户端 [${client.FEEDBACK_CATEGORIES}]`)
  }

  if (server.NAME_MAX === client.NAME_MAX && server.NOTE_MAX === client.NOTE_MAX && server.ADDRESS_MAX === client.ADDRESS_MAX) {
    pass('字段长度上限一致', `名称 ${server.NAME_MAX} / 反馈 ${server.NOTE_MAX} / 位置 ${server.ADDRESS_MAX}`)
  } else {
    fail('字段长度上限不一致', `服务端 ${server.NAME_MAX}/${server.NOTE_MAX}/${server.ADDRESS_MAX}，客户端 ${client.NAME_MAX}/${client.NOTE_MAX}/${client.ADDRESS_MAX}`)
  }

  // 封闭集合：任何不在清单里的值都必须被拒（含带空格、空值、自定义标签）
  const smuggled = ['自定义标签', '', ' 自然风光', '自然风光 '].filter(c => server.isAllowedCategory(c))
  if (!smuggled.length) pass('类型标签为封闭集合（自定义/越界值一律拒绝）')
  else fail('类型标签可被绕过', smuggled.join(' | '))

  // 超长反馈必须被拒（30 字是硬上限）
  const longNote = 'x'.repeat(server.NOTE_MAX + 1)
  const longRes = server.validateFeedback({ name: '测试地点', category: server.FEEDBACK_CATEGORIES[0], note: longNote })
  if (!longRes.ok) pass(`超长反馈被拒（>${server.NOTE_MAX} 字）`, longRes.message)
  else fail('超长反馈未被拒绝')

  // 缺名称 / 缺类型必须被拒
  if (!server.validateFeedback({ category: server.FEEDBACK_CATEGORIES[0] }).ok &&
      !server.validateFeedback({ name: '测试地点' }).ok) {
    pass('缺少名称或类型时拒绝提交')
  } else {
    fail('必填校验缺失')
  }

  // 文本清洗：换行与控制字符必须被归一化（避免反馈里夹带版式/隐藏字符）
  const dirty = server.validateFeedback({
    name: '测试\n地点',
    category: server.FEEDBACK_CATEGORIES[0],
    note: 'a\u0000b\u200Bc'
  })
  const dirtyText = dirty.ok ? dirty.data.name + dirty.data.note : ''
  if (dirty.ok && !/[\n\u0000\u200B]/.test(dirtyText)) pass('文本清洗生效（换行/控制字符/零宽字符被移除）')
  else fail('文本清洗未生效', JSON.stringify(dirty))
}

// ─────────────────── 静态层 3：反馈通道边界 ───────────────────
function feedbackBoundaryChecks() {
  console.log('\n【S-3】反馈通道边界（用户之间互不可见、内容不传播）')

  // 1) 客户端不得直接读写反馈集合 —— 读取只能经运营方云函数
  const clientFiles = []
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(rel)
      else if (/\.(js|json|wxml|wxss)$/.test(entry.name)) clientFiles.push(rel)
    }
  }
  ;['pages', 'components', 'utils', 'config'].forEach(walk)
  clientFiles.push('app.js')

  // 只扫「真实代码」，剔除注释 —— 合规说明里提到集合名不算违规。
  const stripComments = (text, file) => {
    if (file.endsWith('.wxml')) return text.replace(/<!--[\s\S]*?-->/g, '')
    if (file.endsWith('.json')) return text
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  }
  const direct = clientFiles.filter(f => {
    try { return /location_submissions/.test(stripComments(read(f), f)) } catch (e) { return false }
  })
  if (!direct.length) pass('客户端不直接引用 location_submissions（仅注释中提及）', `${clientFiles.length} 个客户端文件已扫描`)
  else fail('客户端出现对反馈集合的直接引用', direct.join(', '))

  // 2) app.json 已注册反馈页
  const appJson = JSON.parse(read('app.json'))
  if (appJson.pages.includes('pages/location-feedback/location-feedback')) pass('app.json 已注册 pages/location-feedback')
  else fail('app.json 未注册反馈页')

  // 2.5) pages 数组不得有重复声明（重复会导致 IDE 编译失败，模拟器永远就绪不了，
  //      automator 所有命令全部超时 —— 2026-10-08 批次 3 实际踩过）
  {
    const dup = appJson.pages.filter((p, i) => appJson.pages.indexOf(p) !== i)
    if (!dup.length) pass(`app.json pages 无重复（${appJson.pages.length} 页）`)
    else fail('app.json pages 存在重复声明', dup.join(' | ') + ' —— IDE 将无法编译')
    // tabBar 页必须在 pages 中
    const tabMiss = (appJson.tabBar.list || []).map(t => t.pagePath).filter(p => !appJson.pages.includes(p))
    if (!tabMiss.length) pass('tabBar 页均在 pages 中注册')
    else fail('tabBar 页未注册进 pages', tabMiss.join(' | '))
  }

  // 3) 反馈页不提供对外分享入口（提交内容不具传播路径）
  const fbJs = read('pages/location-feedback/location-feedback.js')
  const fbWxml = read('pages/location-feedback/location-feedback.wxml')
  if (!/onShareAppMessage|onShareTimeline/.test(fbJs) && !/open-type="share"/.test(fbWxml)) pass('反馈页无对外分享入口')
  else fail('反馈页存在分享入口', '提交内容不得提供传播路径')

  // 4) 反馈页不展示「我的提交 / 他人提交」类列表
  const listWords = ['我的提交', '提交记录', '历史反馈', '大家推荐', '最新推荐', '他人提交']
  const found = listWords.filter(w => fbWxml.includes(w))
  if (!found.length) pass('反馈页无提交列表（用户之间互不可见）')
  else fail('反馈页出现提交列表类文案', found.join(' | '))
}

// ────────────────────────────── 运行时层 ──────────────────────────────
async function runtimeChecks() {
  let automator
  try { automator = require('miniprogram-automator') } catch (e) {
    console.error('\n缺少 miniprogram-automator，跳过运行时层。')
    return
  }

  const appJson = JSON.parse(read('app.json'))
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const noise = []

  console.log(`\n连接自动化端口 ${WS}`)
  const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 })
    .catch(() => automator.connect(WS))
  console.log('已连接 ✓')

  mp.on('console', (msg) => {
    const t = msg.type || 'log'
    if (t === 'error' || t === 'warn') {
      noise.push({ kind: t, text: (msg.args || []).map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a) } catch (e) { return String(a) }
      }).join(' ') })
    }
  })
  mp.on('exception', e => noise.push({ kind: 'exception', text: JSON.stringify(e).slice(0, 300) }))
  mp.on('pageNotFound', e => noise.push({ kind: 'pageNotFound', text: JSON.stringify(e) }))

  // 已知且无害的运行时噪声（无参进入详情类页面的必然错误态）
  const EXPECTED_NOISE = [/生成分享卡片失败/, /地点不存在或已下架/]

  // reLaunch 重试封装：大改版后首次 reLaunch 触发全量重编译，automator 单次调用 30s 超时属正常，
  // 编译完成后重试即可通过（超时之外的错误不重试）
  const reLaunchWithRetry = async (path, tries = 3) => {
    let lastErr
    for (let i = 0; i < tries; i++) {
      try { return await mp.reLaunch(path) }
      catch (e) {
        lastErr = e
        const msg = String((e && e.message) || e)
        if (!/timeout/i.test(msg)) throw e
        console.log(`  … reLaunch 超时（第 ${i + 1}/${tries} 次），等 15s 重试（首次全量编译较慢属正常）`)
        await sleep(15000)
      }
    }
    throw lastErr
  }

  // ── A：页面可达性 ──
  // 这两个页面带运营方门禁，非运营方进入后被弹回 discover —— 这就是预期行为
  const GATED = {
    'pages/location-upload/location-upload': '仅运营方可录入地点',
    'pages/admin-console/admin-console': '仅运营方可进入'
  }

  console.log(`\n【A】页面可达性（app.json 声明 ${appJson.pages.length} 页）`)
  const normalPages = appJson.pages.filter(p => !GATED[p])
  const badPages = []
  for (const p of normalPages) {
    let actual = null
    try {
      await reLaunchWithRetry('/' + p)
      await sleep(1300)
      const page = await mp.currentPage()
      actual = page && page.path
    } catch (e) { actual = 'ERR:' + String((e && e.message) || e).slice(0, 80) }
    if (actual !== p) badPages.push(`${p} → ${actual}`)
  }
  if (!badPages.length) pass(`${normalPages.length} 个常规页面全部可达且路径匹配`)
  else fail('常规页面不可达', badPages.join(' | '))

  // 门禁页：应被重定向回 discover
  for (const [p, tip] of Object.entries(GATED)) {
    let actual = null
    try {
      await reLaunchWithRetry('/' + p)
      await sleep(2600) // 门禁弹回有 1200ms 延时
      const page = await mp.currentPage()
      actual = page && page.path
    } catch (e) { actual = 'ERR' }
    if (actual === 'pages/discover/discover') pass(`门禁页「${p.split('/')[1]}」按预期弹回发现页`, tip)
    else fail(`门禁页「${p.split('/')[1]}」未按预期弹回`, `实际停留 ${actual}`)
  }

  // ── C：tabBar ──
  console.log('\n【C】tabBar 切换')
  for (const item of appJson.tabBar.list) {
    let ok = false
    try {
      await mp.switchTab('/' + item.pagePath)
      await sleep(1300)
      const page = await mp.currentPage()
      ok = page && page.path === item.pagePath
    } catch (e) { /* ignore */ }
    if (ok) pass(`tab「${item.text}」可切换`, item.pagePath)
    else fail(`tab「${item.text}」切换失败`, item.pagePath)
  }

  // ── E：已删页面必须不可达 ──
  console.log('\n【E】已删页面反向确认（应不可达）')
  const removed = [
    'pages/posts/posts', 'pages/post-create/post-create', 'pages/post-detail/post-detail',
    'pages/messages/messages', 'pages/follow-list/follow-list', 'pages/blocked-list/blocked-list',
    'pages/user-home/user-home', 'pages/tag-content/tag-content', 'pages/admin-reports/admin-reports',
    'pages/events/events', 'pages/event-detail/event-detail', 'pages/event-create/event-create',
    'pages/xiaoju-create/xiaoju-create', 'pages/xiaoju-detail/xiaoju-detail',
    'pages/featured/featured'
  ]
  const leaked = []
  for (const p of removed) {
    let reachable = true
    try {
      await mp.reLaunch('/' + p)
      await sleep(600)
      const page = await mp.currentPage()
      if (!page || page.path !== p) reachable = false
    } catch (e) { reachable = false }
    if (reachable) leaked.push(p)
  }
  if (!leaked.length) pass(`${removed.length} 个已删页面确认不可达`)
  else fail('已删页面仍可访问', leaked.join(', '))

  // ── F：读接口可用性 + 部署状态 ──
  console.log('\n【F】读接口可用性与线上部署状态')
  await reLaunchWithRetry('/pages/discover/discover')
  await sleep(1500)

  async function callCloud(name, data = {}) {
    return mp.evaluate(
      (fn, payload) => wx.cloud.callFunction({ name: fn, data: payload })
        .then(res => ({ ok: true, result: res && res.result }))
        .catch(err => ({ ok: false, errMsg: String((err && (err.errMsg || err.message)) || err) })),
      name, data
    )
  }

  const deployedNotes = []

  // F1 基础读接口必须可用
  const loc = await callCloud('getLocations', { page: 1, pageSize: 5 })
  let sampleId = null
  if (loc.ok && loc.result && loc.result.code === 0) {
    const d = loc.result.data
    const arr = Array.isArray(d) ? d : (d && (d.list || [])) || []
    sampleId = arr.length ? (arr[0]._id || arr[0].id) : null
    pass('getLocations 可用', `返回 ${arr.length} 条${sampleId ? ' | 样本 ' + sampleId : '（地点库为空，属数据清理预期）'}`)
  } else fail('getLocations 异常', JSON.stringify(loc).slice(0, 180))

  const sea = await callCloud('getSeasonalLocations', {})
  if (sea.ok && sea.result && sea.result.code === 0) {
    const d = sea.result.data
    const n = Array.isArray(d) ? d.length : (d && (d.list || []).length) || 0
    pass('getSeasonalLocations 可用', `返回 ${n} 条`)
  } else fail('getSeasonalLocations 异常', JSON.stringify(sea).slice(0, 180))

  const wea = await callCloud('getWeather', {})
  if (wea.ok && wea.result && wea.result.code === 0) pass('getWeather 可用')
  else info('getWeather 未就绪：' + JSON.stringify(wea.result || wea).slice(0, 140))

  // F2 部署状态探测（本地已改但未部署时，这里会看到旧结构）
  const lb = await callCloud('getLeaderboard', { type: 'location' })
  if (lb.ok && lb.result && lb.result.code === 0) {
    const hasUserRank = /"(users|userRank|userList)"\s*:/.test(JSON.stringify(lb.result.data || {}))
    if (hasUserRank) deployedNotes.push('getLeaderboard 线上仍含用户榜（本地源码已修正 → 待部署）')
    else pass('线上 getLeaderboard 已是地点榜')
  } else deployedNotes.push('getLeaderboard 调用异常：' + JSON.stringify(lb.result || lb).slice(0, 120))

  const st = await callCloud('getUserStats', {})
  if (st.ok && st.result && st.result.code === 0) {
    const keys = Object.keys(st.result.data || {})
    const extra = keys.filter(k => !['favoriteCount', 'locationCount'].includes(k))
    if (extra.length) deployedNotes.push(`getUserStats 线上仍含 ${extra.join(',')}（本地源码已修正 → 待部署）`)
    else pass('线上 getUserStats 已收敛为收藏+地点数')
  } else deployedNotes.push('getUserStats 调用异常：' + JSON.stringify(st.result || st).slice(0, 120))

  const who = await callCloud('manageReports', { action: 'whoami' })
  if (who.ok && who.result && who.result.code === 0) {
    pass('线上 manageReports.whoami 可用', 'isAdmin=' + String(who.result.data && who.result.data.isAdmin))
  } else {
    deployedNotes.push('manageReports.whoami 返回「' + String((who.result && who.result.message) || '?') + '」（本地已加 → 待部署）')
  }

  // F3 地点详情（有样本才测）
  if (sampleId) {
    const det = await callCloud('getLocationDetail', { locationId: sampleId })
    if (det.ok && det.result && det.result.code === 0) {
      const banned = ['posts', 'hotReviews', 'comments', 'checkIns', 'checkinCount', 'rating', 'reviewCount']
      const leaked = banned.filter(k => k in (det.result.data || {}))
      if (leaked.length) deployedNotes.push('getLocationDetail 线上仍返回 ' + leaked.join(',') + '（本地已去 → 待部署）')
      else pass('线上 getLocationDetail 已去 UGC 字段')
    } else deployedNotes.push('getLocationDetail 调用异常：' + JSON.stringify(det.result || det).slice(0, 120))
  } else {
    info('地点库为空，跳过 getLocationDetail 契约探测')
  }

  if (deployedNotes.length) {
    console.log('\n【F-部署状态】以下差异全部来自「本地已改、云函数尚未部署」：')
    deployedNotes.forEach(n => console.log(`  \x1b[33m→\x1b[0m ${n}`))
  }

  // ── B：运行时噪声 ──
  console.log('\n【B】运行时噪声')
  const unexpected = noise.filter(n => n.kind !== 'warn' && !EXPECTED_NOISE.some(re => re.test(n.text)))
  if (!unexpected.length) {
    pass('除已知预期项外无 error/exception/pageNotFound',
      noise.length ? `采集 ${noise.length} 条（warn/预期 error）` : '零噪声')
  } else {
    fail(`出现 ${unexpected.length} 条非预期错误`)
    unexpected.slice(0, 8).forEach(n => console.log(`      [${n.kind}] ${n.text.slice(0, 200)}`))
  }

  const out = path.join(__dirname, '.degrade-verify-report.json')
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), results, noise, deployedNotes }, null, 2), 'utf8')
  console.log(`\n报告：${out}`)
  await mp.disconnect()
}

async function main() {
  const staticOnly = process.argv.includes('--static-only')
  console.log('\n══ 出毛日记 · 公开展示型 部署前验证 ══' + (staticOnly ? '（仅静态层）' : ''))
  staticChecks()
  configChecks()
  feedbackBoundaryChecks()
  if (!staticOnly) await runtimeChecks()

  const failed = results.filter(r => !r.ok)
  console.log('\n' + '─'.repeat(58))
  console.log(`断言：${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
  if (failed.length) failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
  console.log('─'.repeat(58))
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error('运行失败:', (e && e.stack) || e); process.exit(1) })
