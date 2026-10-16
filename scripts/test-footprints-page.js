#!/usr/bin/env node
/**
 * 离线自测：足迹页的数据装配（pages/footprints/footprints.js 的 rebuild）
 *
 * 不联网、不依赖小程序运行时：给 getApp / Page / wx 打替身把页面模块加载起来，
 * 用假记录跑一遍 rebuild()，然后
 *   1. 断言省份徽章装配结果、以及省份下钻的开合往返；
 *   2. 把 footprints.wxml 里出现的**顶层绑定名**抓出来，逐个断言 data 里真的有。
 *
 * 第 2 条是这个脚本存在的主要理由：wxml 写了 {{provinceTotal}} 而 JS 里叫
 * provinceCount 这种错，JS 语法检查、WXML 闭合检查、单测都发现不了，
 * 只会表现为页面上一片空白。这里把它变成一条会失败的断言。
 *
 * ⚠️ 覆盖不到视觉与真机行为。改 rebuild 的数据字段或 wxml 绑定后必跑。
 */

const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const WXML = path.join(ROOT, 'pages/footprints/footprints.wxml')

const RECORDS = [
  { id: 'r1', placeName: '外滩', city: '上海', latitude: 31.24, longitude: 121.49, visitedAt: 1700000000000, photos: [] },
  { id: 'r2', placeName: '西湖', city: '杭州', latitude: 30.25, longitude: 120.15, visitedAt: 1700100000000, photos: [] },
  { id: 'r3', placeName: '珠江', city: '广州', latitude: 23.11, longitude: 113.32, visitedAt: 1700200000000, photos: [] },
  { id: 'r4', placeName: '广州 · 城市出毛', city: '广州', latitude: 23.1291, longitude: 113.2644, visitedAt: 1700300000000, photos: [] },
  // 表外城市：省份只能来自记录里存的 province
  { id: 'r5', placeName: '淄博 · 城市出毛', city: '淄博', province: '山东', latitude: 36.81, longitude: 118.05, visitedAt: 1700400000000, photos: [] }
]

const MEETS = [
  { id: 'm1', name: '夏日兽聚', city: '上海', latitude: 31.23, longitude: 121.47, date: 1700000000000, attendCount: 2, photos: [] }
]

let page = null
const storage = { fur_footprints_v1: RECORDS, fur_furmeets_v1: MEETS }

global.getApp = () => ({
  globalData: { darkMode: false, userInfo: null, footprintPrefill: null, systemInfo: null },
  callCloud: () => Promise.resolve({ code: 0, data: {} })
})
global.Page = config => { page = config }
global.wx = {
  getStorageSync: key => storage[key],
  setStorageSync: (key, value) => { storage[key] = value },
  getWindowInfo: () => ({ pixelRatio: 2 }),
  showToast: () => {}, showModal: () => {}, showActionSheet: () => {},
  navigateTo: () => {}, chooseLocation: () => {}, on: () => {}, off: () => {}
}

require(path.join(ROOT, 'pages/footprints/footprints.js'))

// setData 替身：按小程序语义同步写回 this.data（rebuild 依赖这一点读 openProvince），
// 并支持 'meetForm.name' 这类路径写法
page.setData = function (patch) {
  Object.keys(patch).forEach(key => {
    const parts = key.split('.')
    let target = page.data
    for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]]
    target[parts[parts.length - 1]] = patch[key]
  })
}

let pass = 0
let fail = 0

function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

const find = (list, name) => list.find(item => item.name === name)

// ── WXML 绑定提取 ──

const JS_KEYWORDS = new Set(['true', 'false', 'null', 'undefined', 'typeof', 'instanceof', 'in', 'of', 'new', 'void', 'this', 'NaN', 'Infinity'])

/** wx:for-item / wx:for-index 声明的循环变量，加上默认的 item / index */
function loopVariables(source) {
  const vars = new Set(['item', 'index'])
  const re = /wx:for-(?:item|index)\s*=\s*"([^"]+)"/g
  let m
  while ((m = re.exec(source))) vars.add(m[1].trim())
  return vars
}

/** 抓出所有 {{ }} 里没有点号前缀的顶层标识符 */
function collectBindings(file) {
  const source = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const locals = loopVariables(source)
  const names = new Set()
  const mustache = /\{\{([\s\S]*?)\}\}/g
  let m
  while ((m = mustache.exec(source))) {
    // 先抹掉字符串字面量，否则 'active' 这类比较值会被当成绑定名
    const expr = m[1].replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
    const token = /(\.)?([A-Za-z_$][\w$]*)/g
    let t
    while ((t = token.exec(expr))) {
      if (t[1]) continue // 属性访问（.foo），跳过
      const id = t[2]
      if (JS_KEYWORDS.has(id) || locals.has(id)) continue
      names.add(id)
    }
  }
  return names
}

page.rebuild()

console.log('\n══ 1. 省份徽章装配 ══')
check('34 个省级行政区全部在列', page.data.provinceBadges.length === 34, `实际 ${page.data.provinceBadges.length}`)
check('点亮 4 个省（上海/浙江/广东/山东）', page.data.litProvinceCount === 4, `实际 ${page.data.litProvinceCount}`)
check('广东聚合 2 条记录', find(page.data.provinceBadges, '广东').count === 2)
check('广东含去过的广州 + 未点亮的深圳', (() => {
  const cities = find(page.data.provinceBadges, '广东').cities
  return cities.some(c => c.name === '广州' && c.active) && cities.some(c => c.name === '深圳' && !c.active)
})())
check('表外城市按记录里的 province 归到山东', (() => {
  const shandong = find(page.data.provinceBadges, '山东')
  return shandong.count === 1 && shandong.cities.some(c => c.name === '淄博' && c.active)
})())
check('省份项字段齐全（wxml 用到 bg/border/text/countColor/name/count/active）',
  ['bg', 'border', 'text', 'countColor', 'name', 'count', 'active'].every(k => k in page.data.provinceBadges[0]))
check('色阶图例 5 档且字段齐全', page.data.rampLegend.length === 5 && page.data.rampLegend.every(i => 'color' in i && 'label' in i))
check('省份总数 34，与省份表一致', page.data.provinceTotal === 34)
check('里程碑仍是 18 条', page.data.milestones.length === 18, `实际 ${page.data.milestones.length}`)
check('地图标记 = 5 条足迹 + 1 场兽聚', page.data.markers.length === 6, `实际 ${page.data.markers.length}`)
check('多于一个点时生成轨迹线', page.data.polyline.length === 1)
check('有记录时 hasPoints 为真', page.data.hasPoints === true)
check('兽聚场次沿用旧口径（1 场聚 × attendCount 2）', page.data.stats.furmeetCount === 2)
check('兽聚卡片带场次与最近日期', page.data.myMeets[0].attendances === 2 && /^\d{4}-\d{2}-\d{2}$/.test(page.data.myMeets[0].lastText))
check('兽聚选择项按城市分组', page.data.meetChoices.length === 1 && page.data.meetChoices[0].city === '上海')

console.log('\n══ 2. 省份下钻往返 ══')
page.onProvinceTap({ currentTarget: { dataset: { name: '广东' } } })
check('点省份后面板有数据', !!page.data.openProvinceData && page.data.openProvinceData.name === '广东')
check('展开状态被记住', page.data.openProvince === '广东')
check('广东面板：1 城 · 2 次', page.data.openProvinceData.cityCount === 1 && page.data.openProvinceData.count === 2)
check('城市项字段齐全（wxml 用到 name/label/count/active）',
  ['name', 'label', 'count', 'active'].every(k => k in page.data.openProvinceData.cities[0]))

page.onProvinceTap({ currentTarget: { dataset: { name: '广东' } } })
check('再点一次收起', page.data.openProvinceData === null && page.data.openProvince === '')

page.setData({ openProvince: '不存在的省' })
page.rebuild()
check('展开的省份失效时自动收起', page.data.openProvinceData === null && page.data.openProvince === '')

page.setData({ openProvince: '广东' })
page.rebuild()
check('重新展开仍然可用（rebuild 不丢展开态）', page.data.openProvinceData.name === '广东')

console.log('\n══ 3. WXML 绑定与页面数据一致 ══')
const bindings = collectBindings(WXML)
const missing = [...bindings].filter(name => !(name in page.data))
check(`wxml 用到的 ${bindings.size} 个顶层绑定在 data 里都有`, missing.length === 0, `缺少：${missing.join(', ')}`)
// 反向：新加的省份相关绑定必须真的被抓到，否则上面的检查等于空跑
;['provinceBadges', 'litProvinceCount', 'provinceTotal', 'rampLegend', 'openProvinceData', 'meetChoices', 'showMeetPicker'].forEach(name => {
  check(`绑定提取抓到了 ${name}`, bindings.has(name))
})

console.log('\n══ 4. 城市标注的归省落库 ══')
page._createCityRecord('淄博', { latitude: 36.81, longitude: 118.05 }, '山东')
const stored = storage.fur_footprints_v1
check('表外城市落库时带上调用方给的省份', stored[stored.length - 1].province === '山东')
check('表外城市用选点坐标而不是城市中心', stored[stored.length - 1].latitude === 36.81)
page._createCityRecord('广州', { latitude: 23.0, longitude: 113.0 }, '浙江')
check('内置城市的省份以城市表为准（广州 → 广东，不认传进来的浙江）', stored[stored.length - 1].province === '广东')
check('新建记录后省份徽章计数跟着涨（山东变 2 次）', find(page.data.provinceBadges, '山东').count === 2)

console.log('\n══ 5. 兽聚「记一次」流程 ══')
check('初始不显示选择弹层', page.data.showMeetPicker === false)
page.openMeetPicker()
check('打开选择弹层', page.data.showMeetPicker === true)
page.onMeetPick({ currentTarget: { dataset: { id: 'm1' } } })
check('点一个已有聚后弹层关闭', page.data.showMeetPicker === false)
const picked = storage.fur_furmeets_v1.find(m => m.id === 'm1')
check('这次参加记进了 dates（老记录 2 次 → 3 次）', Array.isArray(picked.dates) && picked.dates.length === 3)
check('attendCount 与 dates 同步', picked.attendCount === 3)
check('场次统计跟着涨到 3', page.data.stats.furmeetCount === 3)
check('卡片里这张聚的场次也更新了', page.data.myMeets[0].attendances === 3)

page.openMeetPicker()
page.onMeetNewFromPicker()
check('「新的兽聚」关掉弹层并打开表单', page.data.showMeetPicker === false && page.data.showMeetForm === true)

console.log('\n══ 6. 兽聚表单落库 ══')
page.setData({ 'meetForm.name': '成都毛聚', 'meetForm.city': '成都', meetDate: '2026-07-04' })
page.saveMeetForm()
const created = storage.fur_furmeets_v1[storage.fur_furmeets_v1.length - 1]
check('新建兽聚写入 dates（1 次）', Array.isArray(created.dates) && created.dates.length === 1)
check('date / attendCount 与 dates 同步', created.date === created.dates[0] && created.attendCount === 1)
check('表单关闭且新聚进了卡片列表', page.data.showMeetForm === false && page.data.myMeets.some(m => m.name === '成都毛聚'))

page.openMeetFormEdit({ currentTarget: { dataset: { id: 'm1' } } })
check('编辑时日期默认取首次参加日期', page.data.meetForm.date === Math.min.apply(null, picked.dates))
page.setData({ meetDate: '2026-10-20' })
page.saveMeetForm()
const edited = storage.fur_furmeets_v1.find(m => m.id === 'm1')
check('改首次日期不会丢掉后面几次参加的日期', edited.dates.length === 3, `实际 ${edited.dates.length}`)
check('新填的日期进了 dates', edited.dates.indexOf(new Date('2026-10-20T12:00:00').getTime()) !== -1)
check('date 始终等于 dates 最小值（排序后）', edited.date === Math.min.apply(null, edited.dates))

// 一场都没记过时也必须弹选择层（空态写在层内）——
// 曾经在"没有兽聚"时直接跳过选择层进空表单，结果新用户看到的是和旧版一模一样的空表单
page.setData({ myMeets: [], meetChoices: [], showMeetForm: false })
page.openMeetPicker()
check('没有任何兽聚时仍然弹出选择层（空态在层内）', page.data.showMeetPicker === true && page.data.showMeetForm === false)

console.log(`\n══ 结果：${pass} 通过 / ${fail} 失败 ══\n`)
process.exit(fail === 0 ? 0 : 1)
