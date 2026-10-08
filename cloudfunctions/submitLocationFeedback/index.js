// 云函数：submitLocationFeedback
//
// 用户侧「地点推荐 / 纠错」的**单向**提交通道。
//
// 合规要点（公开展示型降级版）：
//   1. 提交只落 location_submissions 集合。该集合**只**被 manageSubmissions
//      （ADMIN_OPENIDS 白名单）读取，任何面向普通用户的读接口都不返回它，
//      因此用户之间永远看不到彼此的提交 —— 「他人可见」这一要件被切断。
//   2. 本函数**绝不写 locations**。公开地点库始终由运营方经 addLocation 录
//      入，公开内容的主体与责任都在运营方。提交只是「素材来源」，不是发布。
//   3. submitterOpenId 只用于防刷与追责，不随任何读接口返回，
//      也绝不进入公开地点对象（公开库里既无提交者字段也无署名）。
//   4. 可提交范围被 locationFeedback.js 收成四个字段（名称 / 封闭类型标签 /
//      位置描述 / ≤30 字反馈），没有自由创作空间，不收图片、不收富文本。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const { ensureCollection } = require('./ensureCollection')
const { validateFeedback, DAILY_LIMIT } = require('./locationFeedback')

const COLLECTION = 'location_submissions'
const DAY_MS = 24 * 60 * 60 * 1000

async function isUserActive(openid) {
  try {
    const result = await db.collection('users').where({ openId: openid }).limit(1).get()
    return !result.data.length || result.data[0].status !== 'banned'
  } catch (err) {
    // users 集合不存在或读取失败时不阻断正常用户，交由后续流程。
    console.warn('submitLocationFeedback: 校验用户状态失败', err.message)
    return true
  }
}

exports.main = async event => {
  const { OPENID: openid } = cloud.getWXContext()
  if (!openid) return { code: -1, message: '未登录' }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }

  const validated = validateFeedback(event)
  if (!validated.ok) return { code: -1, message: validated.message }
  const { name, category, note, address, latitude, longitude } = validated.data

  try {
    // 集合首次写入才存在：这里必须自愈，否则「第一个提交的用户」必然失败。
    await ensureCollection(db, COLLECTION)

    // 防刷：同一用户 24 小时内最多 DAILY_LIMIT 次。
    // 集合不存在（-502005）时按 0 次处理，不阻断首提。
    let recentCount = 0
    try {
      const since = new Date(Date.now() - DAY_MS)
      const countRes = await db.collection(COLLECTION)
        .where({ submitterOpenId: openid, createdAt: _.gt(since) })
        .count()
      recentCount = countRes.total || 0
    } catch (err) {
      recentCount = 0
    }
    if (recentCount >= DAILY_LIMIT) {
      return { code: -429, message: `今天提交的次数已达上限（${DAILY_LIMIT} 次），请明天再来` }
    }

    const res = await db.collection(COLLECTION).add({
      data: {
        name,
        category,
        note,
        address,
        latitude,
        longitude,
        // 处理状态：pending → accepted（已录入）/ rejected（忽略）
        status: 'pending',
        // 仅用于防刷与追责：不随任何读接口返回，不进入公开地点库。
        submitterOpenId: openid,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })

    return { code: 0, data: { submissionId: res._id } }
  } catch (err) {
    console.error('submitLocationFeedback 云函数出错:', err)
    return { code: -1, message: '提交失败，请稍后重试', error: err.message }
  }
}
