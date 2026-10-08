/**
 * 出毛日记 · 用户操作链路自动化测试
 *
 * 通过 miniprogram-automator 连接微信开发者工具自动化端口，
 * 按真实用户操作顺序逐屏走一遍，捕获：
 *   - 页面加载后的 data（列表是否真的拿到了数据、有没有 errorMessage）
 *   - console 输出（尤其 error / warn，云函数报错会打在这里）
 *   - 未捕获异常
 *
 * 用法：node scripts/e2e-run.js
 * 前置：开发者工具已开服务端口 + /v2/auto 已开自动化端口 9420
 */
const path = require('path')

const WS = process.env.MP_WS || 'ws://127.0.0.1:9420'
// 报告写在 scripts/ 内（该目录已在 packOptions.ignore 中，不会进小程序包）
const OUT = path.join(__dirname, '.e2e-report.json')
const fs = require('fs')

let automator
try {
  automator = require('miniprogram-automator')
} catch (e) {
  console.error('缺少 miniprogram-automator，请先安装。')
  process.exit(2)
}

const events = []
const steps = []

function rec(type, payload) {
  events.push({ t: Date.now(), type, payload })
}

async function connect() {
  try {
    return await automator.connect({ wsEndpoint: WS, timeout: 30000 })
  } catch (e) {
    // 旧版本签名是字符串
    return await automator.connect(WS)
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/** 走一步：切页 → 等渲染 → 抓 data 与错误 */
async function step(mp, name, path, params = {}) {
  const started = Date.now()
  const before = events.length
  const row = { name, path, ok: false, ms: 0, data: null, errors: [] }
  try {
    const query = Object.keys(params).length
      ? '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
      : ''
    await mp.reLaunch(`/${path}${query}`)
    await sleep(2500)
    const page = await mp.currentPage()
    row.actualPath = page.path
    try {
      const data = await page.data()
      // 只保留有诊断价值的字段，避免把整页数据倒出来
      row.data = {
        errorMessage: data.errorMessage || null,
        isLoading: data.isLoading,
        hasMore: data.hasMore,
        listLens: Object.fromEntries(
          Object.entries(data)
            .filter(([k, v]) => Array.isArray(v) && k.toLowerCase().includes('list'))
            .map(([k, v]) => [k, v.length])
        ),
        scalars: Object.fromEntries(
          Object.entries(data)
            .filter(([k, v]) => ['string', 'number', 'boolean'].includes(typeof v))
            .filter(([k]) => /^(currentCity|isLoggedIn|isAdmin|darkMode|cityReady|nickname|openId|stats|locatedCity|filteredCount)$/.test(k))
        )
      }
    } catch (e) {
      row.dataError = String(e && e.message || e)
    }
    row.ok = true
  } catch (e) {
    row.error = String(e && e.message || e)
  }
  row.ms = Date.now() - started
  row.errors = events.slice(before).filter(e => e.type !== 'console-info').map(e => `${e.type}: ${JSON.stringify(e.payload).slice(0, 260)}`)
  steps.push(row)
  const flag = row.ok ? 'OK  ' : 'FAIL'
  console.log(`${flag} ${name.padEnd(22)} ${row.path}${row.error ? '  → ' + row.error : ''}`)
  return row
}

async function main() {
  console.log('连接自动化端口', WS)
  const mp = await connect()
  console.log('已连接 ✓\n')

  mp.on('console', (msg) => {
    const level = msg.type || 'log'
    rec(level === 'error' ? 'console-error' : level === 'warn' ? 'console-warn' : 'console-info', {
      args: (msg.args || []).map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a) } catch (e) { return String(a) }
      }).join(' ')
    })
  })
  mp.on('exception', (e) => rec('exception', e))
  mp.on('pageNotFound', (e) => rec('pageNotFound', e))

  // ── 真实用户操作顺序 ──
  await step(mp, '1 启动-发现页', 'pages/discover/discover')
  await step(mp, '2 动态(Tab)', 'pages/posts/posts')
  await step(mp, '3 我的(Tab)', 'pages/profile/profile')
  await step(mp, '4 消息', 'pages/messages/messages')
  await step(mp, '5 搜索', 'pages/search/search')
  await step(mp, '6 活动列表', 'pages/events/events')
  await step(mp, '7 排行榜', 'pages/leaderboard/leaderboard')
  await step(mp, '8 季节推荐', 'pages/seasonal/seasonal')
  await step(mp, '9 我的收藏', 'pages/collections/collections')
  await step(mp, '10 附近服务', 'pages/nearby-services/nearby-services')
  await step(mp, '11 设置', 'pages/settings/settings')
  await step(mp, '12 用户协议', 'pages/agreement/agreement')
  await step(mp, '13 编辑资料', 'pages/profile-edit/profile-edit')
  await step(mp, '14 发布动态', 'pages/post-create/post-create')
  await step(mp, '15 上传地点', 'pages/location-upload/location-upload')
  await step(mp, '16 创建活动', 'pages/event-create/event-create')
  await step(mp, '17 创建小聚', 'pages/xiaoju-create/xiaoju-create')

  // 带参数的详情页（无真实 id 时主要验证不崩）
  await step(mp, '18 动态详情(无参)', 'pages/post-detail/post-detail')
  await step(mp, '19 地点详情(无参)', 'pages/location-detail/location-detail')
  await step(mp, '20 活动详情(无参)', 'pages/event-detail/event-detail')
  await step(mp, '21 小聚详情(无参)', 'pages/xiaoju-detail/xiaoju-detail')
  await step(mp, '22 路线规划', 'pages/route-plan/route-plan')
  await step(mp, '23 标签内容', 'pages/tag-content/tag-content')
  await step(mp, '24 关注列表', 'pages/follow-list/follow-list')
  await step(mp, '25 用户主页', 'pages/user-home/user-home')

  const report = {
    generatedAt: new Date().toISOString(),
    steps,
    errors: events.filter(e => /error|exception|warn|pageNotFound/.test(e.type)),
    eventCount: events.length
  }
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

  console.log('\n=== 汇总 ===')
  console.log('步骤:', steps.length, '| 失败:', steps.filter(s => !s.ok).length)
  const errs = report.errors
  console.log('错误/警告事件:', errs.length)
  console.log('报告已写入:', OUT)

  await mp.disconnect()
  process.exit(0)
}

main().catch(e => {
  console.error('运行失败:', e && e.stack || e)
  process.exit(1)
})
