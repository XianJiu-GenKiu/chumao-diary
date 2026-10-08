// 云函数：getUserStats
// 功能：获取当前用户的统计数据（帖子数、获赞数、收藏数）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return { code: -1, message: '未登录' }
  }

  try {
    // 帖子数 — 该用户发布的帖子
    const postsRes = await db.collection('posts')
      .where({ creatorOpenId: openid })
      .count()

    // 获种草数 — 兼容旧版 likeCount，优先累计新版种草数。
    const myPosts = await db.collection('posts')
      .where({ creatorOpenId: openid })
      .field({ likeCount: true, reactionUpCount: true })
      .get()

    let totalLikes = 0
    myPosts.data.forEach(p => {
      totalLikes += (p.reactionUpCount || p.likeCount || 0)
    })

    const locationsRes = await db.collection('locations')
      .where({ creatorOpenId: openid })
      .count()

    // 收藏数 — 该用户收藏的帖子数。
    // favorites 集合在「还没有任何人收藏过」时并不存在，count() 会抛 -502005；
    // 这里只影响一个统计数字，不能因此让整个个人中心的统计接口失败。
    const favRes = await db.collection('favorites')
      .where({ userOpenId: openid })
      .count()
      .catch(() => ({ total: 0 }))

    return {
      code: 0,
      data: {
        postCount: postsRes.total,
        likeCount: totalLikes,
        upCount: totalLikes,
        favoriteCount: favRes.total,
        locationCount: locationsRes.total
      }
    }
  } catch (err) {
    console.error('getUserStats 云函数出错:', err)
    return { code: -1, message: '获取统计数据失败', error: err.message }
  }
}
