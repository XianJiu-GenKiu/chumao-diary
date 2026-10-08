// 云函数：getLocationDetail
// 功能：获取地点详情，附带当前用户自己的收藏状态。
// 公开展示型：不再返回「相关帖子 / 评论 / 热门点评 / 签到 / 评分」等
// 依赖用户生成内容或跨用户聚合的字段（这些功能已整体下线）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { locationId } = event

  if (!locationId) {
    return { code: -1, message: '缺少地点 ID' }
  }

  try {
    // 1. 获取地点详情
    const locationRes = await db.collection('locations').doc(locationId).get()
    const location = locationRes.data

    if (!location) {
      return { code: -1, message: '地点不存在' }
    }
    // 审核未通过（rejected / pending）的地点只对作者本人可见。
    const isAuthor = !!openid && location.creatorOpenId === openid
    if (location.visibility === 'hidden' || location.moderationStatus === 'hidden') {
      return { code: -1, message: '该地点已下架' }
    }
    // 只有 approved 才公开：rejected / pending / review 一律仅作者本人可见。
    if (location.moderationStatus && location.moderationStatus !== 'approved' && !isAuthor) {
      return { code: -1, message: '该地点正在审核中' }
    }
    if (location.visibility === 'circle' && !isAuthor) {
      return { code: -1, message: '该地点仅自己可见' }
    }

    // 2. 当前用户是否已收藏（纯个人事务，不产生任何跨用户可见信息）
    let isFavorited = false
    if (openid) {
      // favorites 集合在「还没有任何人收藏过」时并不存在，count() 会抛 -502005。
      // 这条查询只是补充「我是否收藏过」，不能因为集合缺失就让整个详情页打不开。
      const favRes = await db.collection('favorites').where({
        targetId: locationId,
        targetType: 'location',
        userOpenId: openid
      }).count().catch(() => ({ total: 0 }))
      isFavorited = favRes.total > 0
    }

    // 3. 补充收藏数：优先使用 toggleFavorite 在事务中维护的 favoriteCount，
    //    保证与列表页读取同一来源；历史数据缺字段时才精确计数。
    let favoriteCount = Math.max(0, Number(location.favoriteCount) || 0)
    if (!Number.isFinite(Number(location.favoriteCount))) {
      const favCountRes = await db.collection('favorites').where({
        targetId: locationId,
        targetType: 'location'
      }).count().catch(() => ({ total: 0 }))
      favoriteCount = favCountRes.total
    }

    return {
      code: 0,
      data: {
        ...location,
        isFavorited,
        favoriteCount
      }
    }
  } catch (err) {
    console.error('getLocationDetail 云函数出错:', err)
    return { code: -1, message: '获取地点详情失败', error: err.message }
  }
}
