const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const { ensureCollection } = require('./ensureCollection')
// 白名单必须覆盖前端实际上报的全部事件名，否则会被当作「无效事件」丢弃。
// 当前前端上报：post_create / location_create / search / reaction / favorite /
//              checkin / share / content_view / map_navigation
const ALLOWED_EVENTS = new Set(['post_create', 'location_create', 'search', 'reaction', 'favorite', 'checkin', 'share', 'content_view', 'map_navigation'])

async function isUserActive(openid) {
  const result = await db.collection('users').where({ openId: openid }).limit(1).get()
  return !result.data.length || result.data[0].status !== 'banned'
}

exports.main = async event => {
  const { OPENID: openid } = cloud.getWXContext()
  const { name, payload = {} } = event
  if (!openid || !ALLOWED_EVENTS.has(name)) return { code: -1, message: '无效事件' }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }
  const safePayload = {
    targetId: typeof payload.targetId === 'string' ? payload.targetId.slice(0, 80) : '',
    targetType: typeof payload.targetType === 'string' ? payload.targetType.slice(0, 20) : '',
    resultCount: Number.isFinite(Number(payload.resultCount)) ? Math.max(0, Math.min(1000, Number(payload.resultCount))) : undefined
  }
  try {
    // usage_events 是纯埋点集合，可能从未创建过，先自愈再写。
    await ensureCollection(db, 'usage_events')
    await db.collection('usage_events').add({ data: { name, openId: openid, payload: safePayload, createdAt: db.serverDate() } })
    return { code: 0 }
  } catch (err) { return { code: -1, message: '记录失败' } }
}
