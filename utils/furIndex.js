/**
 * 出毛适宜度规则引擎（纯函数，无副作用、无网络依赖）
 *
 * 用途：把公共气象数据（温度 / 湿度 / 风力 / 天气，可选紫外线）换算成
 *      「今天适不适合穿兽装出毛」的一个综合分 + 四档等级 + 分项理由 + 建议。
 *
 * 为什么单独抽成模块：
 * 1. 纯函数 → 可在 Node 里直接写断言用例，不必启动小程序；
 * 2. 阈值集中一处，调整体感标准不必翻页面代码；
 * 3. 紫外线缺失时**自动降级为 4 因子版本**（权重按比例重分配），页面侧无需分支判断。
 *
 * ⚠️ 输出仅为参考值，不构成专业医疗或安全建议（页面必须展示免责声明）。
 *
 * 合规说明：输入全部是公共气象数据，输出由程序计算得出，用户零输入 ——
 *          不产生任何用户生成内容。
 */

/** 四档等级。颜色沿用品牌色系（绿 / 浅绿 / 品牌橙 / 警示红）。 */
const LEVELS = {
  excellent: { key: 'excellent', label: '很适宜', color: '#4B9B6A', desc: '条件理想，放心出毛' },
  good: { key: 'good', label: '适宜', color: '#7FB069', desc: '条件不错，注意补水与休息' },
  fair: { key: 'fair', label: '一般', color: '#D4890E', desc: '有需要留意的因素，建议缩短单次穿戴时长' },
  poor: { key: 'poor', label: '不宜', color: '#E4572E', desc: '条件不佳，建议改期或大幅缩短行程' }
}

/** 各因子权重（总和 100）。因子缺失时其权重按比例分给其余因子。 */
const WEIGHTS = { temperature: 40, humidity: 20, wind: 15, uv: 15, condition: 10 }

/** 分项展示名 */
const FACTOR_LABELS = {
  temperature: '温度',
  humidity: '湿度',
  wind: '风力',
  uv: '紫外线',
  condition: '天气'
}

/** 因子展示顺序（与权重从高到低一致） */
const FACTOR_ORDER = ['temperature', 'humidity', 'wind', 'uv', 'condition']

function isNum(v) {
  return typeof v === 'number' && isFinite(v)
}

/** 温度：15–26℃ 最佳；>35℃ 或 <0℃ 直接判不宜 */
function scoreTemperature(t) {
  if (t > 35) {
    return { score: 0, reason: `${t}℃ 高温，兽装内体感更高，中暑风险大`, advice: '强烈建议改期', block: true }
  }
  if (t >= 15 && t <= 26) return { score: 100 }
  if (t > 26) {
    return {
      score: Math.max(0, 100 - ((t - 26) / 9) * 100),
      reason: `${t}℃ 偏热，兽装内散热困难`,
      advice: '携带降温贴与足量饮水，缩短单次穿戴时间'
    }
  }
  if (t >= 5) {
    return {
      score: Math.max(30, 100 - ((15 - t) / 10) * 60),
      reason: `${t}℃ 偏冷，长时间静态拍摄容易受凉`,
      advice: '加穿保暖内层，备暖宝宝'
    }
  }
  return {
    score: Math.max(0, 40 - (5 - t) * 8),
    reason: `${t}℃ 严寒，低温下动作僵硬易受伤`,
    advice: '非必要不建议长时间户外出毛',
    block: t < 0
  }
}

/** 湿度：≤65% 舒适；>80% 闷热（毛皮不透气） */
function scoreHumidity(h) {
  if (h <= 65) return { score: 100 }
  if (h <= 80) {
    return { score: Math.max(60, 100 - ((h - 65) / 15) * 30), reason: `湿度 ${h}% 略高，体感偏闷` }
  }
  return {
    score: Math.max(10, 70 - (h - 80) * 3),
    reason: `湿度 ${h}% 偏高，毛皮不透气，闷热感明显`,
    advice: '缩短单次穿戴时间，间歇到阴凉处取下头套散热'
  }
}

/** 风力（级）：≤3 级舒适，≥5 级影响拍摄，≥8 级判不宜 */
function scoreWind(w) {
  if (w <= 3) return { score: 100 }
  if (w === 4) return { score: 80, reason: '4 级风，毛发抖动，拍摄需要挑位置' }
  if (w === 5) {
    return { score: 55, reason: '5 级风，拍照效果受影响', advice: '选择有遮挡的场地，注意固定假发与配件' }
  }
  if (w === 6) return { score: 30, reason: '6 级风较强，配件容易被吹落', advice: '建议换到背风处或改期' }
  return { score: 10, reason: `${w} 级大风，户外活动不安全`, advice: '建议改期', block: w >= 8 }
}

/** 紫外线指数：≥6 需防护（毛皮吸热明显） */
function scoreUv(u) {
  if (u <= 5) return { score: 100 }
  if (u <= 7) return { score: 70, reason: `紫外线指数 ${u}，毛皮吸热明显`, advice: '做好防晒，控制单次时长' }
  if (u <= 9) {
    return { score: 45, reason: `紫外线指数 ${u} 较强`, advice: '尽量清晨或傍晚出毛，避开正午' }
  }
  return { score: 20, reason: `紫外线指数 ${u} 很强`, advice: '避开 10:00–16:00，务必补水' }
}

/** 天气：雨 / 雪 / 雷 / 雾霾沙尘直接判不宜 */
function scoreCondition(text) {
  const t = String(text || '').trim()
  if (!t) return null
  if (/雷/.test(t)) return { score: 0, reason: `${t}，户外有雷电风险`, advice: '建议改期', block: true }
  if (/雨/.test(t)) return { score: 10, reason: `${t}，雨水会打湿毛皮且难以打理`, advice: '建议改期', block: true }
  if (/雪/.test(t)) return { score: 15, reason: `${t}，低温潮湿，毛皮受损风险高`, advice: '建议改期', block: true }
  if (/雾|霾|沙尘|浮尘|扬沙/.test(t)) {
    return { score: 20, reason: `${t}，能见度低且空气质量差`, advice: '不建议户外出毛', block: true }
  }
  if (/晴/.test(t)) return { score: 90, reason: '晴天光照好，注意防晒' }
  return { score: 100 }
}

/**
 * 计算综合适宜度。
 *
 * @param {object} input
 * @param {number} [input.temperature] 摄氏度
 * @param {number} [input.humidity] 相对湿度 %
 * @param {number} [input.wind] 风力等级
 * @param {number} [input.uv] 紫外线指数（接口不可用时省略 → 自动降级 4 因子）
 * @param {string} [input.condition] 天气文案，如「多云」「小雨」
 * @returns {{
 *   ok: boolean, score: number|null, level: string|null, levelLabel: string,
 *   levelColor: string, levelDesc: string, headline: string,
 *   factors: Array<{key:string,label:string,value:string,score:number|null,reason:string,block:boolean}>,
 *   advice: string[], degraded: boolean, hardBlock: boolean, reason?: string
 * }}
 */
function evaluateFurIndex(input = {}) {
  const temperature = isNum(input.temperature) ? Math.round(input.temperature) : null
  const humidity = isNum(input.humidity) ? Math.round(input.humidity) : null
  const wind = isNum(input.wind) ? Math.round(input.wind) : null
  const uv = isNum(input.uv) ? Math.round(input.uv) : null
  const condition = input.condition ? String(input.condition) : ''

  const raw = {
    temperature: temperature === null ? null : scoreTemperature(temperature),
    humidity: humidity === null ? null : scoreHumidity(humidity),
    wind: wind === null ? null : scoreWind(wind),
    uv: uv === null ? null : scoreUv(uv),
    condition: scoreCondition(condition)
  }

  const display = {
    temperature: temperature === null ? '—' : `${temperature}℃`,
    humidity: humidity === null ? '—' : `${humidity}%`,
    wind: wind === null ? '—' : `${wind} 级`,
    uv: uv === null ? '—' : String(uv),
    condition: condition || '—'
  }

  const present = FACTOR_ORDER.filter(key => raw[key] !== null)
  if (!present.length) {
    return {
      ok: false,
      reason: 'no_weather_data',
      score: null,
      level: null,
      levelLabel: '—',
      levelColor: LEVELS.fair.color,
      levelDesc: '暂无实时天气数据',
      headline: '暂无可用的天气数据，无法给出适宜度',
      factors: [],
      advice: [],
      degraded: true,
      hardBlock: false
    }
  }

  // 缺失因子的权重按比例分摊给在场因子
  const totalWeight = present.reduce((sum, key) => sum + WEIGHTS[key], 0)
  let weighted = 0
  const factors = []
  const advice = []
  let hardBlock = false

  present.forEach(key => {
    const r = raw[key]
    const weight = (WEIGHTS[key] / totalWeight) * 100
    weighted += (r.score / 100) * weight
    if (r.block) hardBlock = true
    if (r.advice && advice.indexOf(r.advice) === -1) advice.push(r.advice)
    factors.push({
      key,
      label: FACTOR_LABELS[key],
      value: display[key],
      score: Math.round(r.score),
      reason: r.reason || '',
      block: !!r.block
    })
  })

  const score = Math.max(0, Math.min(100, Math.round(weighted)))

  let levelKey
  if (hardBlock) levelKey = 'poor'
  else if (score >= 85) levelKey = 'excellent'
  else if (score >= 70) levelKey = 'good'
  else if (score >= 45) levelKey = 'fair'
  else levelKey = 'poor'

  const level = LEVELS[levelKey]

  // 头条文案：硬阻断优先，否则取分数最低的那一项的理由
  let headline
  const blocker = factors.find(f => f.block)
  if (blocker) {
    headline = blocker.reason
  } else {
    const worst = factors.slice().sort((a, b) => a.score - b.score)[0]
    headline = worst.score >= 90 ? '各项条件都不错，适合出毛' : (worst.reason || '条件一般，注意防护')
  }

  if (!advice.length) advice.push('注意补水，间歇到阴凉处取下头套散热')

  return {
    ok: true,
    score,
    level: levelKey,
    levelLabel: level.label,
    levelColor: level.color,
    levelDesc: level.desc,
    headline,
    factors,
    advice,
    degraded: uv === null,
    hardBlock
  }
}

/**
 * 从 getWeather 云函数的返回体直接算适宜度（省去页面里手工挑字段）。
 * @param {object} weatherData - getWeather 的 data 字段
 */
function evaluateFromWeather(weatherData) {
  const d = weatherData || {}
  return evaluateFurIndex({
    temperature: d.temperature,
    humidity: d.humidity,
    wind: d.wind,
    uv: d.uv,
    condition: d.condition
  })
}

module.exports = {
  LEVELS,
  WEIGHTS,
  FACTOR_LABELS,
  FACTOR_ORDER,
  evaluateFurIndex,
  evaluateFromWeather
}
