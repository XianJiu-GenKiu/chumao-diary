const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async event => {
  const { OPENID: openid } = cloud.getWXContext()
  const { targetOpenId = openid, type = 'following', page = 1, pageSize = 20 } = event
  if (!targetOpenId || !['following', 'followers'].includes(type)) return { code: -1, message: '参数错误' }
  try {
    const where = type === 'following' ? { followerOpenId: targetOpenId } : { followingOpenId: targetOpenId }
    const safeSize = Math.min(Math.max(1, pageSize), 50)
    const [links, totalResult] = await Promise.all([
      db.collection('follows').where(where).orderBy('createdAt', 'desc')
        .skip((Math.max(1, page) - 1) * safeSize).limit(safeSize).get(),
      db.collection('follows').where(where).count()
    ])
    const ids = links.data.map(item => type === 'following' ? item.followingOpenId : item.followerOpenId)
    if (!ids.length) return { code: 0, data: { list: [], total: totalResult.total || 0, hasMore: false } }
    const users = await db.collection('users').where({ openId: _.in(ids) }).get()
    const userMap = new Map(users.data.map(user => [user.openId, user]))
    return { code: 0, data: {
      list: ids.map(openId => { const user = userMap.get(openId) || {}; return { openId, nickname: user.nickname || user.nickName || '用户', avatar: user.avatar || user.avatarUrl || '', signature: user.signature || user.bio || '' } }),
      total: totalResult.total || 0,
      hasMore: links.data.length === safeSize
    } }
  } catch (err) {
    // follows 集合尚未创建时，关注关系必然为空，降级返回空列表而不是整体失败
    // （否则「我的关注/粉丝」页面会直接报错，见 getEvents 的同类处理）。
    if (/collection not exists|DATABASE_COLLECTION_NOT_EXIST|-502005/i.test(String(err.message || ''))) {
      return { code: 0, data: { list: [], total: 0, hasMore: false } }
    }
    console.error('getFollowList failed:', err)
    return { code: -1, message: '获取关注列表失败', error: err.message }
  }
}
