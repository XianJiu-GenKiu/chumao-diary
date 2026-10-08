// 云函数：getLeaderboard
// 功能：地点热度榜。
// 公开展示型：只保留地点维度——用户榜由 posts 聚合而来，属于「用户之间的比较」，
// 随发布型内容一并下线。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  try {
    const locationsRes = await db.collection('locations').orderBy('createdAt', 'desc').limit(100).get()
    // 榜单是公开数据：只有 approved 参与；下架与 rejected / pending / review 都不参与。
    const isPublic = item => !!item &&
      item.visibility !== 'hidden' && item.moderationStatus !== 'hidden' &&
      (!item.moderationStatus || item.moderationStatus === 'approved') &&
      (!item.visibility || item.visibility === 'public')
    const locations = locationsRes.data.filter(isPublic)
      // 热度只用「收藏数 + 浏览量」这类不暴露个体行为的聚合量。
      .map(item => ({ ...item, score: (Number(item.favoriteCount) || 0) * 2 + (Number(item.viewCount) || 0) }))
      .sort((a, b) => b.score - a.score).slice(0, 20)
    return { code: 0, data: { locations } }
  } catch (err) { return { code: -1, message: '获取排行榜失败', error: err.message } }
}
