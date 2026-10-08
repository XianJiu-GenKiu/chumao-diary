/**
 * 云函数：toggleEventLike
 * 活动点赞/取消点赞
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const { ensureCollection } = require('./ensureCollection')

async function isUserActive(openid) {
  const result = await db.collection('users').where({ openId: openid }).limit(1).get()
  return !result.data.length || result.data[0].status !== 'banned'
}

exports.main = async (event, context) => {
  const openid = cloud.getWXContext().OPENID
  if (!openid) return { code: -1, message: '未登录' }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }

  const { eventId } = event
  if (!eventId) return { code: -2, message: '缺少活动ID' }

  const coll = db.collection('event_likes')
  try {
    // event_likes 集合首次点赞前可能不存在，先自愈再读写。
    await ensureCollection(db, 'event_likes')
    const eventRes = await db.collection('events').doc(eventId).get()
    if (!eventRes.data || eventRes.data.status === 'ended') return { code: -1, message: '活动不存在或已结束' }
    // 检查是否已点赞
    const currentLikes = await coll.where({ eventId, userOpenId: openid }).get()
    const exist = currentLikes.data.length
      ? currentLikes
      : await coll.where({ eventId, _openid: openid }).get()

    if (exist.data && exist.data.length > 0) {
      // 取消点赞
      await coll.doc(exist.data[0]._id).remove()
      await db.collection('events').doc(eventId).update({
        data: { likeCount: db.command.inc(-1) }
      })
      return { code: 0, data: { liked: false } }
    } else {
      // 点赞
      await coll.add({ data: { eventId, userOpenId: openid, createTime: db.serverDate() } })
      await db.collection('events').doc(eventId).update({
        data: { likeCount: db.command.inc(1) }
      })
      return { code: 0, data: { liked: true } }
    }
  } catch (err) {
    console.error('toggleEventLike error:', err)
    return { code: -1, message: '操作失败' }
  }
}
