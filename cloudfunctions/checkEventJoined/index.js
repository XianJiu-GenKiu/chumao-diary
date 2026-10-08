/**
 * 云函数：checkEventJoined
 * 检查当前用户是否已报名该活动
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const openid = cloud.getWXContext().OPENID
  const { eventId } = event

  if (!openid || !eventId) return { code: 0, data: { joined: false } }

  try {
    const res = await db.collection('events').doc(eventId).get()
    if (!res.data) return { code: 0, data: { joined: false } }

    const joined = res.data.participantOpenIds && res.data.participantOpenIds.includes(openid)
    return { code: 0, data: { joined: !!joined } }
  } catch (err) {
    return { code: 0, data: { joined: false } }
  }
}
