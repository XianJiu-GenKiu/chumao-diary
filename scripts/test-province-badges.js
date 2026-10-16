#!/usr/bin/env node
/**
 * 离线自测：省份徽章聚合（utils/provinceBadges.js）
 *
 * 不联网、不依赖小程序运行时，纯 Node 即可跑：
 *   node scripts/test-province-badges.js
 *
 * 改 utils/provinceBadges.js，或改 config/cities.js 的 province 之后必跑。
 */

const path = require('path')
const ROOT = path.resolve(__dirname, '..')

const {
  ALL_PROVINCES,
  PROVINCE_RAMP,
  PROVINCE_LEGEND,
  provinceChipStyle,
  buildProvinceBadges
} = require(path.join(ROOT, 'utils/provinceBadges.js'))

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

console.log('\n══ 1. 无记录时的省份墙 ══')
const empty = buildProvinceBadges([])
check(`省级行政区全部在列（${empty.length} 个）`, empty.length === ALL_PROVINCES.length)
check('全部未点亮', empty.every(p => p.active === false && p.count === 0))
check('未点亮配色是素色', empty.every(p => p.bg === '#FFFFFF' && p.text === '#909090'))
check('没有记录时不出现「其他」分组', !find(empty, '其他'))
check('每个省都带内置城市（江苏 6 个）', find(empty, '江苏').cities.length === 6)
check('未点亮省份的 cityCount 为 0', find(empty, '江苏').cityCount === 0)
check('传 null 不抛错', buildProvinceBadges(null).length === ALL_PROVINCES.length)
check('记录里混入空值不抛错', buildProvinceBadges([null, undefined, {}]).length === ALL_PROVINCES.length)

console.log('\n══ 2. 内置城市按省聚合 ══')
const badges = buildProvinceBadges([
  { city: '广州' }, { city: '广州' }, { city: '深圳' },
  { city: '杭州' }, { city: '苏州' }, { city: '香港' }
])
check('广东 count = 3', find(badges, '广东').count === 3)
check('广东 cityCount = 2', find(badges, '广东').cityCount === 2)
check('广东已点亮', find(badges, '广东').active === true)
check('浙江 count = 1', find(badges, '浙江').count === 1)
check('点亮的省排在未点亮的省之前', badges.slice(0, 4).every(p => p.active) && !badges[4].active)
check(`未点亮的省有 ${ALL_PROVINCES.length - 4} 个`, badges.filter(p => !p.active).length === ALL_PROVINCES.length - 4)
check('香港用展示名（中国香港）', find(badges, '香港').cities.some(c => c.name === '香港' && c.label === '中国香港'))
check('省名与省份表一致，没有多余分组', badges.length === ALL_PROVINCES.length)

console.log('\n══ 3. 绿→橙色阶 ══')
const rampBadges = buildProvinceBadges([
  { city: '上海' },
  { city: '北京' }, { city: '北京' },
  { city: '成都' }, { city: '成都' }, { city: '成都' },
  { city: '天津' }, { city: '天津' }, { city: '天津' }, { city: '天津' },
  { city: '重庆' }, { city: '重庆' }, { city: '重庆' }, { city: '重庆' }, { city: '重庆' }
])
check('1 次 → 第 1 档浅绿', find(rampBadges, '上海').bg === PROVINCE_RAMP[0])
check('2 次 → 第 2 档', find(rampBadges, '北京').bg === PROVINCE_RAMP[1])
check('3 次 → 第 3 档', find(rampBadges, '四川').bg === PROVINCE_RAMP[2])
check('4 次 → 第 4 档', find(rampBadges, '天津').bg === PROVINCE_RAMP[3])
check('5 次 → 第 5 档', find(rampBadges, '重庆').bg === PROVINCE_RAMP[4])
check('末档就是品牌主色 #D4890E', PROVINCE_RAMP[4] === '#D4890E')
check('次数超过档位上限时钳到末档', provinceChipStyle(99).bg === '#D4890E')
check('五档都配深色文字（对比度够）', PROVINCE_RAMP.every((_, i) => provinceChipStyle(i + 1).text === '#1A1A1A'))
check('0 次走未点亮素色', provinceChipStyle(0).bg === '#FFFFFF' && provinceChipStyle(0).text === '#909090')
check('图例 5 档、末档标 5+', PROVINCE_LEGEND.length === 5 && PROVINCE_LEGEND[4].label === '5+')
check('图例颜色与色阶同源', PROVINCE_LEGEND.every((item, index) => item.color === PROVINCE_RAMP[index]))

console.log('\n══ 4. 省份归属与兜底 ══')
const custom = buildProvinceBadges([{ city: '淄博', province: '山东' }, { city: '淄博', province: '山东' }])
check('表外城市按记录里的 province 归省', find(custom, '山东').count === 2)
check('表外城市被标记 custom', find(custom, '山东').cities.some(c => c.name === '淄博' && c.custom === true))
check('表外城市不计入内置城市', find(custom, '山东').cities.length === 4)

const orphan = buildProvinceBadges([{ city: '广州' }, { city: '某不知名小城' }])
const other = find(orphan, '其他')
check('省份推不出来时进「其他」', !!other && other.count === 1)
check('「其他」排在所有未点亮的省之前', orphan.findIndex(p => p.name === '其他') < orphan.findIndex(p => !p.active))
check('「其他」不出现在没有命中记录时', !find(buildProvinceBadges([{ city: '广州' }]), '其他'))

const mislabeled = buildProvinceBadges([{ city: '广州', province: '浙江' }])
check('内置城市的省份以城市表为准（广州 → 广东）', find(mislabeled, '广东').count === 1)
check('记录里标错的省份不会凭空点亮', find(mislabeled, '浙江').active === false)
check('标错省份时不会把城市塞进那个省', !find(mislabeled, '浙江').cities.some(c => c.name === '广州'))

console.log('\n══ 5. 下钻城市清单 ══')
const sorter = buildProvinceBadges([{ city: '苏州' }, { city: '苏州' }, { city: '南京' }])
const jiangsu = find(sorter, '江苏')
check('去过的城市排在最前面', jiangsu.cities.slice(0, 2).every(c => c.active))
check('同省内按次数降序（苏州在南京前）', jiangsu.cities[0].name === '苏州' && jiangsu.cities[1].name === '南京')
check('没去过的城市也在列，可以点选', jiangsu.cities.filter(c => !c.active).length === 4)
check('每个城市都有展示名', jiangsu.cities.every(c => typeof c.label === 'string' && c.label.length > 0))
check('cityCount 只数去过的城市', jiangsu.cityCount === 2)
check('cities 里的次数与省 count 一致', jiangsu.cities.filter(c => c.active).reduce((sum, c) => sum + c.count, 0) === jiangsu.count)

console.log(`\n══ 结果：${pass} 通过 / ${fail} 失败 ══\n`)
process.exit(fail === 0 ? 0 : 1)
