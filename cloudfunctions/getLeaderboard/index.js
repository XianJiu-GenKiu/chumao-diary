const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
exports.main = async () => {
  try {
    const [locationsRes, postsRes] = await Promise.all([
      db.collection('locations').orderBy('createdAt', 'desc').limit(100).get(),
      db.collection('posts').orderBy('createdAt', 'desc').limit(100).get()
    ])
    // 榜单是公开数据：只有 approved 参与；下架与 rejected / pending / review 都不参与。
    const isPublic = item => !!item &&
      item.visibility !== 'hidden' && item.moderationStatus !== 'hidden' &&
      (!item.moderationStatus || item.moderationStatus === 'approved') &&
      (!item.visibility || item.visibility === 'public')
    const locations = locationsRes.data.filter(isPublic)
      .map(item => ({ ...item, score: (Number(item.reactionUpCount) || 0) * 3 + (Number(item.favoriteCount) || 0) * 2 + (Number(item.commentCount) || 0) }))
      .sort((a, b) => b.score - a.score).slice(0, 20)
    const authorStats = new Map()
    postsRes.data.filter(isPublic).forEach(post => {
      const stat = authorStats.get(post.creatorOpenId) || { openId: post.creatorOpenId, nickname: post.authorName || '用户', avatar: post.authorAvatar || '', postCount: 0, score: 0 }
      stat.postCount += 1
      stat.score += (Number(post.reactionUpCount) || Number(post.likeCount) || 0) * 3 + (Number(post.commentCount) || 0)
      authorStats.set(post.creatorOpenId, stat)
    })
    const users = [...authorStats.values()].filter(item => item.openId).sort((a, b) => b.score - a.score || b.postCount - a.postCount).slice(0, 20)
    return { code: 0, data: { locations, users } }
  } catch (err) { return { code: -1, message: '获取排行榜失败', error: err.message } }
}
