#!/usr/bin/env node
/**
 * 离线自测：出毛适宜度规则引擎 + 城市展示名映射
 *
 * 不联网、不依赖小程序运行时，纯 Node 即可跑：
 *   NODE_PATH=... node scripts/test-fur-index.js
 *
 * 改 utils/furIndex.js 后必跑。
 * （兽聚名录已改为用户本机自建，config/furmeets.js 已删除，名录断言随之移除）
 */

const path = require('path')
const ROOT = path.resolve(__dirname, '..')

const { evaluateFurIndex, evaluateFromWeather } = require(path.join(ROOT, 'utils/furIndex.js'))
const { cityLabel } = require(path.join(ROOT, 'config/city-labels.js'))

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

console.log('\n══ 1. 城市展示名映射 ══')
check('城市展示名映射：香港 → 中国香港', cityLabel('香港') === '中国香港')
check('城市展示名映射：澳门 → 中国澳门', cityLabel('澳门') === '中国澳门')
check('城市展示名映射：台北 → 中国台湾', cityLabel('台北') === '中国台湾')
check('未映射城市原样返回', cityLabel('上海') === '上海')
check('空值返回空串', cityLabel('') === '')

console.log('\n══ 2. 适宜度规则引擎 ══')

// 理想条件应达最高档
const ideal = evaluateFurIndex({ temperature: 22, humidity: 50, wind: 2, uv: 3, condition: '晴' })
check('理想条件 ok', ideal.ok === true)
check(`理想条件 ≥85 分（实际 ${ideal.score}）`, ideal.score >= 85)
check('理想条件 level=excellent', ideal.level === 'excellent')
check('理想条件非硬阻断', ideal.hardBlock === false)

// 高温硬阻断
const hot = evaluateFurIndex({ temperature: 37, humidity: 60, wind: 2, condition: '晴' })
check('37℃ 硬阻断 hardBlock', hot.hardBlock === true)
check('37℃ 判"不宜"', hot.level === 'poor')

// 下雨硬阻断
const rain = evaluateFurIndex({ temperature: 20, humidity: 80, wind: 3, condition: '小雨' })
check('小雨 硬阻断', rain.hardBlock === true && rain.level === 'poor')

// 大雪
const snow = evaluateFurIndex({ temperature: 1, humidity: 60, wind: 2, condition: '大雪' })
check('大雪 硬阻断', snow.hardBlock === true)

// 大风
const wind = evaluateFurIndex({ temperature: 22, humidity: 50, wind: 8, condition: '多云' })
check('8 级风 硬阻断', wind.hardBlock === true)

// 强紫外线应扣分但不断言阻断
const uvBad = evaluateFurIndex({ temperature: 22, humidity: 50, wind: 2, uv: 10, condition: '晴' })
const uvGood = evaluateFurIndex({ temperature: 22, humidity: 50, wind: 2, uv: 2, condition: '晴' })
check(`强紫外线扣分（uv2=${uvGood.score} > uv10=${uvBad.score}）`, uvGood.score > uvBad.score)
check('强紫外线非硬阻断', uvBad.hardBlock === false)

// 湿度影响
const humid = evaluateFurIndex({ temperature: 22, humidity: 90, wind: 2, condition: '多云' })
check(`高湿度扣分（${humid.score} < 100）`, humid.score < 100)

// 降级：无紫外线
const noUv = evaluateFurIndex({ temperature: 22, humidity: 50, wind: 2, condition: '晴' })
check('缺紫外线时 degraded=true', noUv.degraded === true)
check('缺紫外线时因子数为 4', noUv.factors.length === 4)
check('缺紫外线仍能给出分数', typeof noUv.score === 'number')

// 只有温度
const onlyTemp = evaluateFurIndex({ temperature: 24 })
check('仅温度时因子数为 1', onlyTemp.factors.length === 1)
check('仅温度时权重全部折算（24℃ 应接近满分）', onlyTemp.score >= 95)

// 空输入
const empty = evaluateFurIndex({})
check('空输入 ok=false', empty.ok === false)
check('空输入 score=null', empty.score === null)
check('空输入不抛错且有提示语', typeof empty.headline === 'string' && empty.headline.length > 0)

// 分项与建议结构
check('factors 结构完整', ideal.factors.every(f => f.key && f.label && typeof f.score === 'number' && typeof f.value === 'string'))
check('advice 非空数组', Array.isArray(ideal.advice) && ideal.advice.length > 0)
check('headline 非空', typeof ideal.headline === 'string' && ideal.headline.length > 0)

console.log('\n══ 3. evaluateFromWeather 适配 ══')
const fromNull = evaluateFromWeather(null)
check('传 null 不抛错', fromNull.ok === false)
const fromReal = evaluateFromWeather({ temperature: 28, humidity: 70, wind: 3, condition: '多云' })
check('真实返回体可解析', fromReal.ok === true && fromReal.factors.length >= 3)
check('不含 uv 时 degraded', fromReal.degraded === true)
const withUv = evaluateFromWeather({ temperature: 28, humidity: 70, wind: 3, uv: 8, condition: '多云' })
check('含 uv 时 degraded=false', withUv.degraded === false)

console.log(`\n══ 结果：${pass} 通过 / ${fail} 失败 ══\n`)
process.exit(fail === 0 ? 0 : 1)
