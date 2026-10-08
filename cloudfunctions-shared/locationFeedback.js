/**
 * 共享模块：locationFeedback —— 用户地点反馈（推荐 / 纠错）的封闭规则集
 *
 * 合规定位（公开展示型）：
 *   用户提交的内容**不是**对外发布的内容，而是给运营方的「素材」。
 *   提交只落 location_submissions 集合，该集合只被 manageSubmissions
 *   （运营方白名单）读取，任何面向普通用户的读接口都不返回它。
 *   公开地点始终由运营方通过 addLocation 重新录入。
 *   因此本模块刻意把可提交范围收得很窄：
 *     - 类型标签是**封闭集合**，用户不能自定义、不能扩充；
 *     - 只有名称 / 类型 / 位置描述 / 30 字反馈四个字段，没有自由创作空间；
 *     - 不接收图片、不接收富文本、不接收任何指向其他用户的字段。
 *
 * 漂移防护：本文件是服务端母本，客户端副本见 config/location-feedback.js，
 * 两者由 scripts/e2e-degrade-verify.js 的静态层逐项比对（沿用 config/cities.js
 * 「独立副本 + 自检」的既有约定）。
 */

/** 类型标签：封闭集合，仅运营方可增删（改这里 + 客户端副本 + 重跑自检）。 */
const FEEDBACK_CATEGORIES = [
  '自然风光',
  '城市街景',
  '室内场景',
  '公园绿地',
  '水域',
  '山地',
  '其他'
]

/** 字段长度上限，客户端输入框 maxlength 与之一致。 */
const NAME_MAX = 30
const NOTE_MAX = 30
const ADDRESS_MAX = 60

/** 同一用户 24 小时内的提交上限，防刷（超出返回 -429）。 */
const DAILY_LIMIT = 5

function isAllowedCategory(category) {
  return FEEDBACK_CATEGORIES.includes(category)
}

/**
 * 文本清洗：去掉控制字符、零宽字符与换行，压缩连续空白。
 * 反馈文本永不直接公开，因此不保留任何「版式」语义，一律归一化为单行。
 */
function sanitizeText(value, max) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** 经纬度归一化：越界或非数字一律视为「未提供」。 */
function normalizeCoordinate(value, min, max) {
  const num = Number(value)
  if (!Number.isFinite(num) || num < min || num > max) return null
  return num
}

/**
 * 校验一次地点反馈提交。
 * @param {object} input 原始入参（来自客户端，全部不可信）
 * @returns {{ ok: boolean, message?: string, data?: object }}
 */
function validateFeedback(input = {}) {
  const rawName = typeof input.name === 'string' ? input.name.trim() : ''
  if (!rawName) return { ok: false, message: '请填写地点名称' }
  if (rawName.length > NAME_MAX) return { ok: false, message: `地点名称最多 ${NAME_MAX} 个字` }
  const name = sanitizeText(rawName, NAME_MAX)
  if (!name) return { ok: false, message: '请填写有效的地点名称' }

  const category = typeof input.category === 'string' ? input.category.trim() : ''
  if (!isAllowedCategory(category)) return { ok: false, message: '请从列表中选择地点类型' }

  const rawNote = typeof input.note === 'string' ? input.note.trim() : ''
  if (rawNote.length > NOTE_MAX) return { ok: false, message: `反馈信息最多 ${NOTE_MAX} 个字` }
  const note = sanitizeText(rawNote, NOTE_MAX)

  const rawAddress = typeof input.address === 'string' ? input.address.trim() : ''
  if (rawAddress.length > ADDRESS_MAX) return { ok: false, message: `位置描述最多 ${ADDRESS_MAX} 个字` }
  const address = sanitizeText(rawAddress, ADDRESS_MAX)

  const latitude = normalizeCoordinate(input.latitude, -90, 90)
  const longitude = normalizeCoordinate(input.longitude, -180, 180)
  // 经纬度必须成对有效，只给一个视为未提供，避免落进脏坐标。
  const hasCoords = latitude !== null && longitude !== null

  return {
    ok: true,
    data: {
      name,
      category,
      note,
      address,
      latitude: hasCoords ? latitude : null,
      longitude: hasCoords ? longitude : null
    }
  }
}

module.exports = {
  FEEDBACK_CATEGORIES,
  NAME_MAX,
  NOTE_MAX,
  ADDRESS_MAX,
  DAILY_LIMIT,
  isAllowedCategory,
  sanitizeText,
  validateFeedback
}
