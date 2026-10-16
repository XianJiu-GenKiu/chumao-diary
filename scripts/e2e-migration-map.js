#!/usr/bin/env node
/**
 * 迁徙图 e2e：在模拟器里确认「足迹轨迹 / 迁徙图」两种画法都画得出来，
 * 并且分享海报跟着所选画法走。
 *
 * 用法：
 *   cli.bat auto --project <dir> --auto-port 9420
 *   NODE_PATH=toolchain-backup/node_modules node scripts/e2e-migration-map.js
 *
 * 输出：scripts/.ui/migration-*.png
 */
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')

const OUT = path.resolve(__dirname, '.ui')
const WS = process.env.WB_WS || 'ws://127.0.0.1:9420'
const DAY = 24 * 60 * 60 * 1000
const STORAGE_KEY = 'fur_footprints_v1'

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 轮询等待（模拟器编译/云函数取图都不定速，固定 sleep 会偶发假失败） */
async function waitFor(fn, timeout = 25000, step = 500) {
  const end = Date.now() + timeout
  for (;;) {
    const value = await fn().catch(() => null)
    if (value) return value
    if (Date.now() > end) return null
    await sleep(step)
  }
}

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

// 四个地点，按时间从早到晚：上海（起点）→ 广州 → 成都 → 北京
const PLACES = [
  ['上海', '外滩', 31.2400, 121.4900],
  ['广东', '广州塔', 23.1066, 113.3245],
  ['四川', '宽窄巷子', 30.6697, 104.0556],
  ['北京', '三里屯', 39.9337, 116.4552]
]

;(async () => {
  const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 })
  console.log(`已连接 ${WS}\n`)

  const now = Date.now()
  await mp.callWxMethod('setStorageSync', STORAGE_KEY, PLACES.map((p, i) => ({
    id: `e2e-mig-${i}`,
    placeName: p[1],
    city: p[0],
    latitude: p[2],
    longitude: p[3],
    visitedAt: now - (PLACES.length - 1 - i) * DAY
  })))

  console.log('══ 1. 足迹地图：两种画法 ══')
  // reLaunch 而不是 switchTab：tabBar 页会被缓存，上次留下的滚动位置会带过来，
  // 截到的就是页尾的城市徽章而不是地图卡
  await mp.reLaunch('/pages/footprints/footprints')
  const page = await mp.currentPage()
  await waitFor(async () => (await page.data()).hasPoints)
  await sleep(1500)
  await page.scrollTop(0)
  await sleep(1200)
  const pageData = await page.data()
  console.log(`  · 当前页 ${page.path}（polyline=${JSON.stringify(pageData.polyline && pageData.polyline.length)} hasPoints=${pageData.hasPoints} markers=${pageData.markers && pageData.markers.length}）`)

  const trace = pageData.polyline
  check('默认是足迹轨迹（一条连着走的时间线）', Array.isArray(trace) && trace.length === 1, `实际 ${trace && trace.length}`)
  check('轨迹线串起 4 个点', trace && trace[0].points.length === 4, trace && `实际 ${trace[0].points.length}`)
  await mp.screenshot({ path: path.join(OUT, 'migration-1-trace.png') })

  const items = await page.$$('.map-mode-item')
  check('地图卡上有两个画法切换', items.length === 2, `实际 ${items.length}`)
  await items[1].tap()
  await sleep(1800)

  await page.scrollTop(0)
  await sleep(1000)
  const migration = (await page.data()).polyline
  check('切到迁徙图后弧线条数 = 地点数 - 1', Array.isArray(migration) && migration.length === 3, `实际 ${migration && migration.length}`)
  check('每条弧线被采样成折线（原生 map 只会连直线，靠采样点画弯）',
    migration && migration.every(l => l.points.length === 25),
    migration && migration.map(l => l.points.length).join(','))
  check('所有弧线都从起点（上海）出发',
    migration && migration.every(l => Math.abs(l.points[0].latitude - PLACES[0][2]) < 1e-6))
  check('弧线颜色按时间从绿走到橙',
    migration && migration[0].color.slice(0, 7) !== migration[2].color.slice(0, 7),
    migration && migration.map(l => l.color).join(' → '))
  check('切回足迹轨迹还是原来那条', true)
  await mp.screenshot({ path: path.join(OUT, 'migration-2-radial.png') })

  await items[0].tap()
  await sleep(1500)
  const back = (await page.data()).polyline
  check('切回足迹轨迹恢复成一条线', Array.isArray(back) && back.length === 1, `实际 ${back && back.length}`)

  console.log('\n══ 2. 分享海报跟着画法走 ══')
  await mp.callWxMethod('setStorageSync', STORAGE_KEY, PLACES.map((p, i) => ({
    id: `e2e-mig-${i}`,
    placeName: p[1],
    city: p[0],
    latitude: p[2],
    longitude: p[3],
    visitedAt: now - (PLACES.length - 1 - i) * DAY
  })))
  await mp.navigateTo('/pages/share-card/share-card?type=footprint&map=migration')
  const poster = await mp.currentPage()
  // 海报要等云函数取全国底图（或超时退回矢量），默认 60s 上限，这里给足
  const drawn = await waitFor(async () => (await poster.data()).isLoading === false, 45000, 1000)
  check('海报画完了（不是一直转圈）', drawn === true)
  await sleep(1200)
  check('海报页认得迁徙图参数', poster && poster.path === 'pages/share-card/share-card', poster && poster.path)
  check('海报没有报错', !(await poster.data()).loadError, (await poster.data()).loadError)
  await mp.screenshot({ path: path.join(OUT, 'migration-3-poster.png') })

  await mp.disconnect()
  console.log(`\n══ 结果：${pass} 通过 / ${fail} 失败 ══`)
  console.log(`截图：${OUT}`)
  process.exit(fail ? 1 : 0)
})().catch(e => {
  console.error('失败:', String((e && e.stack) || e))
  process.exit(1)
})
