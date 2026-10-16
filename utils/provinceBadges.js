/**
 * 省份徽章聚合（纯函数，不依赖小程序运行时）
 *
 * 足迹页把「城市徽章墙」改成「省份徽章墙」后，这一层负责：
 *   - 按省聚合出毛次数与到访城市；
 *   - 给每个省算填充色（次数越多越「热」，绿 → 橙，见 PROVINCE_RAMP）；
 *   - 每个省带一份可下钻的城市清单，未点亮的城市也要在列，否则展开后没得点。
 *
 * 省份归属优先用记录里显式存的 province（在省份面板里地图选点添加的表外城市），
 * 否则按内置城市表推导 —— 早期记录没有 province 字段，靠这一步兜底。
 * 两边都推不出来的城市归到「其他」，且只有真的存在这类记录时才会出现这一项。
 *
 * ⚠️ 改本文件后必跑：node scripts/test-province-badges.js
 */

const { CITY_CANDIDATES, PROVINCE_OF_CITY, CITY_MAP } = require('../config/cities.js')
const { cityLabel } = require('../config/city-labels.js')

/** 内置城市表覆盖到的全部省级行政区：没去过的省也要出现，才能点开补城市 */
const ALL_PROVINCES = [...new Set(CITY_CANDIDATES.map(c => c.province))]

/** 城市没能对上省份时的兜底分组，永远排在徽章墙最后 */
const OTHER_PROVINCE = '其他'

/**
 * 省份热度梯度：在这个省出毛越多越「热」，1 次浅绿 → 5 次+ 品牌橙。
 * 色相从绿(100°)推到橙(35°)、亮度从 58% 单调降到 44%，末档就是主色
 * --color-primary(#D4890E)，首档是它的浅绿对位。五档都配深色文字
 * （最浅的 #7DDA4E 对 #1A1A1A 仍有约 9:1 对比度），所以色块可以整块填充，
 * 不需要靠降不透明度来保证可读性。
 */
const PROVINCE_RAMP = ['#7DDA4E', '#9CDD39', '#CACA22', '#DCBF16', '#D4890E']

/** 色阶图例，与 PROVINCE_RAMP 同源，避免颜色在两处各写一遍 */
const PROVINCE_LEGEND = PROVINCE_RAMP.map((color, index) => ({
  color,
  label: index === PROVINCE_RAMP.length - 1 ? `${index + 1}+` : String(index + 1)
}))

/** 省份徽章配色：次数为 0 时是「未点亮」的素色 */
function provinceChipStyle(count) {
  if (!count) return { bg: '#FFFFFF', border: '#E5E5E5', text: '#909090', countColor: '#B0B0B0' }
  const color = PROVINCE_RAMP[Math.min(count, PROVINCE_RAMP.length) - 1]
  return { bg: color, border: color, text: '#1A1A1A', countColor: 'rgba(26, 26, 26, 0.62)' }
}

/**
 * 把出毛记录聚合成省份徽章列表。
 *
 * @param {Array} records 本机出毛记录（每条至少可能有 city / province）
 * @returns {Array} 每个省一项：{ name, count, cityCount, active, cities, order, bg, border, text, countColor }
 *                  cities 里每项：{ name, label, count, active, custom }
 */
function buildProvinceBadges(records) {
  const list = Array.isArray(records) ? records : []
  const cityCounts = {}
  const customProvince = {}

  list.forEach(record => {
    if (!record || !record.city) return
    cityCounts[record.city] = (cityCounts[record.city] || 0) + 1
    // 表外城市才需要记录里的省份：内置城市的归属永远以城市表为准
    if (record.province && !PROVINCE_OF_CITY[record.city]) {
      customProvince[record.city] = record.province
    }
  })

  const groups = {}
  const ensure = name => {
    if (!groups[name]) {
      groups[name] = {
        name,
        count: 0,
        cities: [],
        order: name === OTHER_PROVINCE ? ALL_PROVINCES.length : ALL_PROVINCES.indexOf(name)
      }
    }
    return groups[name]
  }

  Object.keys(cityCounts).forEach(city => {
    const group = ensure(PROVINCE_OF_CITY[city] || customProvince[city] || OTHER_PROVINCE)
    group.count += cityCounts[city]
    group.cities.push({
      name: city,
      label: cityLabel(city),
      count: cityCounts[city],
      active: true,
      custom: !CITY_MAP[city]
    })
  })

  // 内置城市里还没点亮的也要列出来，否则省份展开后没有可点选的项
  CITY_CANDIDATES.forEach(candidate => {
    const group = ensure(candidate.province)
    if (!group.cities.some(item => item.name === candidate.name)) {
      group.cities.push({
        name: candidate.name,
        label: cityLabel(candidate.name),
        count: 0,
        active: false,
        custom: false
      })
    }
  })

  // 全部省级行政区都要出现：没去过的省也能点开，再从里面补城市
  ALL_PROVINCES.forEach(province => ensure(province))

  return Object.keys(groups)
    .map(name => {
      const group = groups[name]
      // 去过的城市排前面，其次按次数，最后表外城市后置
      group.cities.sort((a, b) => (b.active - a.active) || (b.count - a.count) || (a.custom - b.custom))
      const style = provinceChipStyle(group.count)
      return {
        name: group.name,
        count: group.count,
        cityCount: group.cities.filter(city => city.active).length,
        active: group.count > 0,
        cities: group.cities,
        order: group.order,
        bg: style.bg,
        border: style.border,
        text: style.text,
        countColor: style.countColor
      }
    })
    // 点亮的省排前面，其次按次数，最后按行政区固定顺序（「其他」恒在末尾）
    .sort((a, b) => (b.active - a.active) || (b.count - a.count) || (a.order - b.order))
}

module.exports = {
  ALL_PROVINCES,
  OTHER_PROVINCE,
  PROVINCE_RAMP,
  PROVINCE_LEGEND,
  provinceChipStyle,
  buildProvinceBadges
}
