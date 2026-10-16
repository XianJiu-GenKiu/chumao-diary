/**
 * 兽聚的读写口径（纯函数，不依赖小程序运行时）
 *
 * 为什么要有这一层：同一份本机兽聚数据（fur_furmeets_v1）被三处消费 ——
 * 足迹页的统计与卡片、分享海报的「兽聚场次」、以及新增的「记一次」弹层。
 * 口径散在三处就会漂移（海报显示的场次和页面对不上），所以统一收在这里。
 *
 * ── 数据形态 ──
 * 一条兽聚 = { id, name, city, latitude, longitude, date, dates[], note, photos, attendCount }
 *   dates[]       每次参加的日期（升序），新增记录必写
 *   date          首次参加日期，等于 dates[0]
 *   attendCount   等于 dates.length
 * date / attendCount 是冗余镜像，保留的理由只有一个：万一版本回退到旧代码，
 * 旧代码仍按 `max(1, attendCount)` 算场次、按 `date` 排序，有镜像就不会算错。
 * 两个字段都由 addAttendance / saveMeetForm 从 dates 派生，没有第三方写入方。
 * 老记录只有 date + attendCount：meetDates 会把 date 按次数展开成占位日期，
 * 所以场次统计口径与改造前**完全一致**，里程碑数字不会跳变，也不需要数据迁移。
 *
 * ⚠️ 改本文件后必跑：node scripts/test-furmeets.js
 */

const { cityLabel } = require('../config/city-labels.js')

/**
 * 每次参加的日期（升序）。
 * 老记录没有 dates 时，把 date 按 attendCount 展开成同样多的占位日期 ——
 * 这样「去过 3 次」在统计上仍是 3 次，只是这 3 次的日期都等于首次那天。
 */
function meetDates(meet) {
  if (!meet) return []
  const stored = Array.isArray(meet.dates) ? meet.dates.filter(Number.isFinite) : []
  if (stored.length) return stored.slice().sort((a, b) => a - b)
  const base = Number(meet.date)
  if (!Number.isFinite(base)) return []
  const count = Math.max(1, Number(meet.attendCount) || 1)
  return new Array(count).fill(base)
}

/** 参加场次。与改造前 `Math.max(1, attendCount)` 的值域保持一致，避免成就数字跳变。 */
function meetAttendances(meet) {
  const dates = meetDates(meet)
  if (dates.length) return dates.length
  return Math.max(1, Number(meet && meet.attendCount) || 1)
}

/** 首次参加时间；没有可用日期时返回 0（便于比较时自然排到末尾） */
function firstAttendedAt(meet) {
  const dates = meetDates(meet)
  if (dates.length) return dates[0]
  const fallback = Number(meet && meet.date)
  return Number.isFinite(fallback) ? fallback : 0
}

/**
 * 最近一次参加时间。
 * 列表排序用它而不是 `date`：`date` 永远停在首次那天，用它排序会让
 * 「最近去过的聚」沉到列表底部，越用越难找。
 */
function lastAttendedAt(meet) {
  const dates = meetDates(meet)
  if (dates.length) return dates[dates.length - 1]
  const fallback = Number(meet && meet.date)
  return Number.isFinite(fallback) ? fallback : 0
}

/**
 * 追加一次参加，返回**新对象**（不改原对象，避免 setData 前的引用被就地改掉）。
 * dates 保持升序，date / attendCount 两个兼容字段同步更新。
 */
function addAttendance(meet, dateTs) {
  const ts = Number(dateTs)
  if (!meet || !Number.isFinite(ts)) return meet
  const dates = meetDates(meet).concat(ts).sort((a, b) => a - b)
  return Object.assign({}, meet, { dates, date: dates[0], attendCount: dates.length })
}

function formatDay(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 选择弹层用的分组数据：按**举办城市**分组（不同城市是不同的聚）。
 * 城市按「聚数 desc → 总场次 desc」排，城内按「场次 desc → 最近一次 desc」排，
 * 让常去的那一场浮到最上面。
 */
function groupMeetsByCity(meets) {
  const groups = {}
  const list = Array.isArray(meets) ? meets : []
  list.forEach(meet => {
    if (!meet || !meet.id) return
    const city = meet.city || ''
    if (!groups[city]) groups[city] = { city, cityLabel: cityLabel(city) || '未填城市', meets: [], attendances: 0 }
    const group = groups[city]
    group.attendances += meetAttendances(meet)
    group.meets.push({
      id: meet.id,
      name: meet.name || '未命名兽聚',
      attendances: meetAttendances(meet),
      lastAt: lastAttendedAt(meet),
      lastText: formatDay(lastAttendedAt(meet))
    })
  })

  return Object.keys(groups)
    .map(city => {
      const group = groups[city]
      group.meets.sort((a, b) => (b.attendances - a.attendances) || (b.lastAt - a.lastAt) || a.name.localeCompare(b.name))
      return group
    })
    .sort((a, b) => (b.meets.length - a.meets.length) || (b.attendances - a.attendances) || a.cityLabel.localeCompare(b.cityLabel))
}

/** 「我的兽聚」卡片列表：按最近一次参加倒序，卡片字段一次算好给 wxml 用 */
function buildMeetCards(meets) {
  return (Array.isArray(meets) ? meets : [])
    .slice()
    .sort((a, b) => lastAttendedAt(b) - lastAttendedAt(a))
    .map(meet => ({
      id: meet.id,
      name: meet.name || '未命名兽聚',
      cityLabel: cityLabel(meet.city) || '未填城市',
      attendances: meetAttendances(meet),
      lastText: formatDay(lastAttendedAt(meet)),
      firstText: formatDay(firstAttendedAt(meet)),
      note: meet.note || '',
      photos: Array.isArray(meet.photos) ? meet.photos : []
    }))
}

/** 统计口径：场次 = Σ 参加次数，个数 = 记录条数，城市 = 去过的举办城市数 */
function meetStats(meets) {
  const list = Array.isArray(meets) ? meets : []
  const cities = new Set()
  let count = 0
  list.forEach(meet => {
    if (!meet) return
    count += meetAttendances(meet)
    if (meet.city) cities.add(meet.city)
  })
  return { furmeetCount: count, furmeetDistinct: list.length, furmeetCities: cities.size }
}

module.exports = {
  meetDates,
  meetAttendances,
  firstAttendedAt,
  lastAttendedAt,
  addAttendance,
  formatDay,
  groupMeetsByCity,
  buildMeetCards,
  meetStats
}
