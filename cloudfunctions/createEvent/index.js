/**
 * 云函数：createEvent
 * 创建新活动，包含内容安全审核
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const { checkText, checkImage, moderationTraceFields, SCENE } = require('./contentSecurity.js')
const { ensureCollection } = require('./ensureCollection')

async function isUserActive(openid) {
  const result = await db.collection('users').where({ openId: openid }).limit(1).get()
  return !result.data.length || result.data[0].status !== 'banned'
}

function parseDateTime(value) {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/)
  if (!match) return null
  const [, year, month, day, hour, minute] = match.map(Number)
  const validationDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))
  if (validationDate.getUTCFullYear() !== year || validationDate.getUTCMonth() !== month - 1 ||
    validationDate.getUTCDate() !== day || validationDate.getUTCHours() !== hour ||
    validationDate.getUTCMinutes() !== minute) return null
  // Activity times are entered in China Standard Time (UTC+8); persist an absolute timestamp.
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0))
}

/**
 * 活动封面审核。
 * 只接受云存储文件（拒绝外链，避免绕过审核）；
 * 审核结果交由调用方按 rejected / approved 处理（接口不可用时降级为 approved + degraded）。
 */
async function checkCover(fileID, openid) {
  if (!fileID) return { pass: true, moderationStatus: 'approved' }
  if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) {
    return { pass: false, moderationStatus: 'rejected', warning: 'invalid_image_source' }
  }
  return checkImage(fileID, { openid })
}

exports.main = async (event, context) => {
  const openid = cloud.getWXContext().OPENID
  if (!openid) return { code: -1, message: '未登录' }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }

  const { name, description, cover, startTime, endTime, location, maxPeople, tags } = event

  // 参数校验
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 40) return { code: -2, message: '活动名称需为 2-40 个字符' }
  if (!startTime) return { code: -2, message: '请选择开始时间' }
  if (!endTime) return { code: -2, message: '请选择结束时间' }
  if (typeof description !== 'string' || description.trim().length < 10 || description.trim().length > 500) return { code: -2, message: '活动介绍需为 10-500 个字符' }
  const startAt = parseDateTime(startTime)
  const endAt = parseDateTime(endTime)
  if (!startAt || startAt.getTime() <= Date.now()) return { code: -2, message: '开始时间需晚于当前时间' }
  if (!endAt || endAt.getTime() <= startAt.getTime()) return { code: -2, message: '结束时间需晚于开始时间' }
  if (!Number.isFinite(Number(maxPeople)) || Number(maxPeople) < 0 || Number(maxPeople) > 1000 || !Number.isInteger(Number(maxPeople))) return { code: -2, message: '报名人数上限不正确' }
  if (!Array.isArray(tags) || tags.length > 5 || tags.some(tag => typeof tag !== 'string' || tag.trim().length > 10)) return { code: -2, message: '标签格式不正确' }
  // —— 内容安全审核 ——
  // 明确违规 → 拒绝创建；审核服务不可用 → 降级放行（记 approved + degraded，活动可见）。
  const coverResult = await checkCover(cover, openid)
  if (coverResult.moderationStatus === 'rejected') {
    return { code: -3, message: '活动封面未通过安全审核，请更换后重试' }
  }

  const textResult = await checkText(
    (name.trim() + ' ' + (description || '').trim()).slice(0, 500),
    { openid, scene: SCENE.LOG }
  )
  if (textResult.moderationStatus === 'rejected') {
    return { code: -3, message: '内容未通过安全审核，请修改后重试' }
  }

  // 明确违规已在上面返回；走到这里一律按 approved 落库。降级放行时同样记 approved，
  // 不再记 pending —— pending 在读侧等于「仅作者可见」，会让活动别人看不到。
  const moderationStatus = (coverResult.moderationStatus === 'pending' || textResult.moderationStatus === 'pending')
    ? 'pending'
    : 'approved'

  // 获取用户信息
  const userRes = await db.collection('users').where({ openId: openid }).limit(1).get()
  const user = (userRes.data && userRes.data.length > 0) ? userRes.data[0] : {}

  const doc = {
    name: name.trim(),
    description: description.trim(),
    cover: cover || '',
    startTime: startAt,
    endTime: endAt,
    location: location || '',
    maxPeople: Number(maxPeople) || 0,
    tags: tags || [],
    creatorOpenId: openid,
    creatorName: user.nickname || user.nickName || '匿名用户',
    creatorAvatar: user.avatar || user.avatarUrl || '',
    joinCount: 0,
    likeCount: 0,
    moderationStatus,
    // 降级放行（审核接口不可用）的事实落库，便于日后筛出未审核活动补审。
    ...moderationTraceFields(coverResult, textResult),
    participantOpenIds: [],
    status: 'upcoming', // upcoming / ongoing / ended
    createTime: db.serverDate()
  }

  try {
    // events 集合可能从未创建过（本函数是唯一写入方），先自愈再写。
    await ensureCollection(db, 'events')
    const res = await db.collection('events').add({ data: doc })
    return { code: 0, data: { _id: res._id } }
  } catch (err) {
    console.error('createEvent error:', err)
    return { code: -1, message: '创建失败' }
  }
}
