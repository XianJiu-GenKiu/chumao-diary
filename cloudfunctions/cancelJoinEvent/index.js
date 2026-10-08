/**
 * 云函数：cancelJoinEvent
 * 用户取消活动报名
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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

  try {
    const result = await db.runTransaction(async (transaction) => {
      const res = await transaction.collection('events').doc(eventId).get()
      if (!res.data) return { code: -1, message: '活动不存在' }

      const ev = res.data
      if (!Array.isArray(ev.participantOpenIds) || !ev.participantOpenIds.includes(openid)) {
        return { code: -3, message: '您尚未报名本次活动' }
      }
      if (ev.creatorOpenId === openid) {
        return { code: -4, message: '发起人不能取消报名' }
      }

      await transaction.collection('events').doc(eventId).update({
        data: {
          participantOpenIds: _.pull(openid),
          joinCount: _.inc(-1)
        }
      })
      return { code: 0, message: '已取消报名' }
    })

    return result
  } catch (err) {
    console.error('cancelJoinEvent error:', err)
    return { code: -1, message: '取消报名失败' }
  }
}
