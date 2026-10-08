/**
 * 云函数：getEventDetail
 * 获取活动详情，含参与者信息
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function getEventStatus(event, now = new Date()) {
  const startAt = new Date(event.startTime).getTime()
  const endAt = new Date(event.endTime).getTime()
  const nowAt = now.getTime()
  if (Number.isFinite(endAt) && endAt <= nowAt) return 'ended'
  if (!Number.isFinite(endAt) && event.status === 'ended') return 'ended'
  if (Number.isFinite(startAt) && startAt <= nowAt) return 'ongoing'
  return 'upcoming'
}

exports.main = async (event, context) => {
  const openid = cloud.getWXContext().OPENID
  const { id } = event

  if (!id) return { code: -1, message: '缺少活动ID' }

  try {
    const res = await db.collection('events').doc(id).get()
    if (!res.data) return { code: -1, message: '活动不存在' }

    const eventDoc = res.data

    // 只有 approved（或无该字段的历史活动）才公开；
    // rejected / pending 活动仅创建者本人可见，与活动列表的过滤保持一致。
    if (eventDoc.moderationStatus === 'hidden') return { code: -1, message: '活动已下架' }
    if (eventDoc.moderationStatus && eventDoc.moderationStatus !== 'approved') {
      const isAuthor = !!openid && eventDoc.creatorOpenId === openid
      if (!isAuthor) return { code: -1, message: '活动正在审核中' }
    }

    // 检查是否已点赞
    // event_likes 集合可能尚未创建，点赞状态属于「锦上添花」，
    // 任何一条查询失败都应降级为「未点赞」，而不是让整个详情页打不开。
    let isLiked = false
    if (openid) {
      const likeCheck = await db.collection('event_likes')
        .where({ eventId: id, userOpenId: openid })
        .count().catch(() => ({ total: 0 }))
      if (likeCheck.total > 0) isLiked = true
      else {
        const legacyLikeCheck = await db.collection('event_likes')
          .where({ eventId: id, _openid: openid })
          .count().catch(() => ({ total: 0 }))
        isLiked = legacyLikeCheck.total > 0
      }
    }

    // 获取参与者信息（前20人）
    let participants = []
    if (eventDoc.participantOpenIds && eventDoc.participantOpenIds.length > 0) {
      const pIds = eventDoc.participantOpenIds.slice(0, 20)
      const pRes = await db.collection('users')
        .where({ openId: _.in(pIds) })
        .field({ nickname: true, nickName: true, avatar: true, avatarUrl: true, openId: true })
        .get()
      participants = pRes.data || []
    }

    return {
      code: 0,
      data: { ...eventDoc, status: getEventStatus(eventDoc), isLiked, participants }
    }
  } catch (err) {
    console.error('getEventDetail error:', err)
    return { code: -1, message: '查询失败' }
  }
}
