/**
 * 云函数：joinEvent
 * 用户报名参与活动
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
      const now = Date.now()
      const endAt = new Date(ev.endTime).getTime()
      if (ev.status === 'ended' || (Number.isFinite(endAt) && endAt <= now)) {
        return { code: -3, message: '活动已结束' }
      }
      if (Array.isArray(ev.participantOpenIds) && ev.participantOpenIds.includes(openid)) {
        return { code: -4, message: '已报名，无需重复报名' }
      }
      if (ev.maxPeople > 0 && (ev.joinCount || 0) >= ev.maxPeople) {
        return { code: -5, message: '报名人数已满' }
      }

      await transaction.collection('events').doc(eventId).update({
        data: {
          participantOpenIds: _.push(openid),
          joinCount: _.inc(1)
        }
      })
      return { code: 0, message: '报名成功' }
    })

    return result
  } catch (err) {
    console.error('joinEvent error:', err)
    return { code: -1, message: '报名失败' }
  }
}
