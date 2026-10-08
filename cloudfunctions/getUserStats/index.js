// 云函数：getUserStats
// 功能：获取当前用户的统计数据（地点数、收藏数）。
// 公开展示型：不再统计「发布数 / 获赞数」——那是发布型内容（posts）的指标。
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
    // 收藏数 — 当前用户自己收藏的内容数（纯个人统计，他人不可见）。
    // favorites 集合在「还没有任何人收藏过」时并不存在，count() 会抛 -502005；
    // 这里只影响一个统计数字，不能因此让整个个人中心的统计接口失败。
    const favRes = await db.collection('favorites')
      .where({ userOpenId: openid })
      .count()
      .catch(() => ({ total: 0 }))

    const locationsRes = await db.collection('locations')
      .where({ creatorOpenId: openid })
      .count()

    return {
      code: 0,
      data: {
        favoriteCount: favRes.total,
        locationCount: locationsRes.total
      }
    }
  } catch (err) {
    console.error('getUserStats 云函数出错:', err)
    return { code: -1, message: '获取统计数据失败', error: err.message }
  }
}
