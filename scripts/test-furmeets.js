#!/usr/bin/env node
/**
 * 离线自测：兽聚读写口径（utils/furmeets.js）
 *
 * 不联网、不依赖小程序运行时，纯 Node 即可跑：
 *   node scripts/test-furmeets.js
 *
 * 重点盯两件事：
 *   1. 老记录（只有 date + attendCount、没有 dates）的场次口径与改造前**完全一致** ——
 *      口径一漂，里程碑数字就会跟着跳，用户会以为自己成就丢了；
 *   2. 列表按「最近一次参加」而不是 `date` 排序 —— 旧实现用 date，导致
 *      「最近去过的聚」沉到列表底部，越用越难找（这是本次要修的 bug）。
 *
 * ⚠️ 改 utils/furmeets.js 后必跑。
 */

const path = require('path')
const ROOT = path.resolve(__dirname, '..')

const {
  meetDates,
  meetAttendances,
  firstAttendedAt,
  lastAttendedAt,
  addAttendance,
  formatDay,
  groupMeetsByCity,
  buildMeetCards,
  meetStats
} = require(path.join(ROOT, 'utils/furmeets.js'))

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

/** 本地时区的当天中午，避免跨时区把日期挤到前一天 */
const at = (y, m, d) => new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00`).getTime()

console.log('\n══ 1. 老记录兜底（只有 date + attendCount）══')
const legacy = { id: 'm1', name: '极兽聚', city: '上海', date: at(2025, 5, 1), attendCount: 3 }
check('dates 缺失时按 attendCount 展开成同样多的日期', meetDates(legacy).length === 3)
check('场次等于 attendCount', meetAttendances(legacy) === 3)
check('首次与最近都回落到那唯一的 date', firstAttendedAt(legacy) === at(2025, 5, 1) && lastAttendedAt(legacy) === at(2025, 5, 1))

console.log('\n══ 2. 场次口径与改造前完全一致（成就数字不能跳）══')
// 旧实现：furmeetCount = Σ max(1, attendCount || 1)
const mixed = [
  { id: 'a', name: 'A', city: '上海', date: at(2025, 1, 1), attendCount: 3 },
  { id: 'b', name: 'B', city: '上海', date: at(2025, 2, 1) },
  { id: 'c', name: 'C', city: '杭州', attendCount: 2 },
  { id: 'd', name: 'D', city: '', date: at(2025, 3, 1), attendCount: 0 }
]
const oldFormula = mixed.reduce((sum, m) => sum + Math.max(1, Number(m.attendCount) || 1), 0)
check(`场次与旧公式一致（${oldFormula}）`, meetStats(mixed).furmeetCount === oldFormula, `实际 ${meetStats(mixed).furmeetCount}`)
check('个数 = 记录条数', meetStats(mixed).furmeetDistinct === 4)
check('城市数只数填了城市的', meetStats(mixed).furmeetCities === 2)
check('完全没有日期的记录仍算 1 次', meetAttendances({ id: 'x', name: 'X' }) === 1)

console.log('\n══ 3. 新记录（有 dates）══')
const fresh = { id: 'm2', name: '毛毛茶话会', city: '杭州', date: at(2026, 3, 1), dates: [at(2026, 9, 20), at(2026, 3, 1)], attendCount: 2 }
check('dates 优先于 attendCount', meetAttendances(fresh) === 2)
check('读取时 dates 会排好序', meetDates(fresh)[0] === at(2026, 3, 1))
check('最近一次 = dates 最大值', lastAttendedAt(fresh) === at(2026, 9, 20))
check('首次 = dates 最小值', firstAttendedAt(fresh) === at(2026, 3, 1))
check('dates 里的非数值被过滤', meetDates({ id: 'y', dates: [at(2026, 1, 1), NaN, null, 'abc'] }).length === 1)

console.log('\n══ 4. 追加一次参加 ══')
const before = { id: 'm1', name: '极兽聚', city: '上海', date: at(2025, 5, 1), attendCount: 3 }
const after = addAttendance(before, at(2026, 5, 2))
check('场次 +1', meetAttendances(after) === 4)
check('不就地修改原对象（setData 前引用不能被改掉）', before.attendCount === 3 && !before.dates)
check('写入 dates 并保持升序', after.dates.length === 4 && after.dates[3] === at(2026, 5, 2) && after.dates.every((v, i, a) => i === 0 || a[i - 1] <= v))
check('date / attendCount 两个兼容字段同步', after.date === at(2025, 5, 1) && after.attendCount === 4)
check('最近一次变成刚追加的日期', lastAttendedAt(after) === at(2026, 5, 2))
const earlier = addAttendance({ id: 'x', name: 'X', city: '上海', date: at(2026, 1, 1), dates: [at(2026, 1, 1)] }, at(2025, 1, 1))
check('补记更早的一次时它会成为首次', firstAttendedAt(earlier) === at(2025, 1, 1) && earlier.date === at(2025, 1, 1))
check('无效时间戳原样返回', addAttendance(before, NaN) === before)

console.log('\n══ 5. 按城市分组 ══')
const meets = [
  { id: 'm1', name: '极兽聚', city: '上海', dates: [at(2025, 5, 1), at(2026, 5, 2)] },
  { id: 'm2', name: '毛毛茶话会', city: '上海', dates: [at(2026, 3, 1)] },
  { id: 'm3', name: '成都毛聚', city: '成都', dates: [at(2026, 1, 1), at(2026, 7, 1), at(2026, 8, 1)] }
]
const groups = groupMeetsByCity(meets)
check('按城市分成 2 组', groups.length === 2)
check('城市按聚数降序（上海 2 个在前）', groups[0].city === '上海' && groups[1].city === '成都')
check('城内按场次降序（极兽聚 2 次在前）', groups[0].meets[0].name === '极兽聚')
check('组带展示名、聚数、总场次', groups[0].cityLabel === '上海' && groups[0].meets.length === 2 && groups[0].attendances === 3)
check('每项带场次与最近日期文案', groups[0].meets[0].attendances === 2 && /^\d{4}-\d{2}-\d{2}$/.test(groups[0].meets[0].lastText))
check('未填城市的聚归到「未填城市」', groupMeetsByCity([{ id: 'n', name: 'N' }])[0].cityLabel === '未填城市')
check('没有 id 的脏数据被跳过', groupMeetsByCity([{ name: 'X', city: '上海' }]).length === 0)

console.log('\n══ 6. 卡片列表按「最近一次」排序 ══')
// 旧实现按 date 排：老聚新去（date 早、最近一次晚）会被排到新聚后面
const sortCase = [
  { id: 'old', name: '老聚新去', city: '上海', date: at(2024, 1, 1), dates: [at(2024, 1, 1), at(2026, 9, 1)] },
  { id: 'new', name: '新聚', city: '上海', date: at(2026, 8, 1), dates: [at(2026, 8, 1)] }
]
check('最近去过的排在最前（旧实现会反过来）', buildMeetCards(sortCase)[0].name === '老聚新去', buildMeetCards(sortCase).map(c => c.name).join(','))
const cards = buildMeetCards(meets)
check('卡片按最近一次倒序', cards[0].name === '成都毛聚', cards.map(c => c.name).join(','))
check('卡片带场次、最近、首次与展示名', cards[0].attendances === 3 && cards[0].lastText === formatDay(at(2026, 8, 1)) && !!cards[0].firstText && cards[0].cityLabel === '成都')

console.log('\n══ 7. 边界 ══')
check('null 入参不抛错', meetDates(null).length === 0 && meetAttendances(null) === 1 && lastAttendedAt(null) === 0)
check('空数组不抛错', groupMeetsByCity([]).length === 0 && buildMeetCards([]).length === 0 && meetStats([]).furmeetCount === 0)
check('meetStats 忽略数组里的空值', meetStats([null, undefined, { id: 'z', name: 'Z', city: '上海', dates: [at(2026, 1, 1)] }]).furmeetCount === 1)
check('formatDay 对 0 / NaN 返回空串', formatDay(0) === '' && formatDay(NaN) === '')

console.log(`\n══ 结果：${pass} 通过 / ${fail} 失败 ══\n`)
process.exit(fail === 0 ? 0 : 1)
