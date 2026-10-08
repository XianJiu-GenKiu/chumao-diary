/**
 * 云函数：getEvents
 * 分页获取活动列表，支持按状态筛选
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
  const { OPENID: openid } = cloud.getWXContext()
  const { status } = event
  const safePage = Math.max(1, Math.floor(Number(event.page) || 1))
  const safePageSize = Math.min(50, Math.max(1, Math.floor(Number(event.pageSize) || 10)))

  const now = new Date()
  let query = {}

  // 按状态筛选
  if (status === 'upcoming') {
    query.startTime = _.gt(now)
  } else if (status === 'ongoing') {
    query.startTime = _.lte(now)
    query.endTime = _.gt(now)
  } else if (status === 'ended') {
    // Include legacy records whose old status was explicitly ended.
    query = _.or([{ endTime: _.lte(now) }, { status: 'ended' }])
  }

  try {
    const totalRes = await db.collection('events').where(query).count()
    const res = await db.collection('events')
      .where(query)
      .orderBy('createTime', 'desc')
      .skip((safePage - 1) * safePageSize)
      .limit(safePageSize)
      .get()

    // 只有 approved（或无该字段的历史活动）才公开；
    // rejected / pending 活动仅创建者本人可见，避免未过审活动出现在活动列表。
    const visible = res.data.filter(item => {
      if (item.moderationStatus === 'hidden') return false
      if (!item.moderationStatus || item.moderationStatus === 'approved') return true
      return !!openid && item.creatorOpenId === openid
    })

    return {
      code: 0,
      data: visible.map(item => ({ ...item, status: getEventStatus(item, now) })),
      total: visible.length
    }
  } catch (err) {
    console.error('getEvents error:', err)
    // events 首次写入前，云开发会报告集合不存在；此时应展示正常空态而非故障页。
    if (String(err.message || '').includes('collection not exists')) return { code: 0, data: [], total: 0 }
    return { code: -1, message: '查询失败', data: [] }
  }
}
