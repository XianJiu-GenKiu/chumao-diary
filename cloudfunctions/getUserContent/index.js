// 云函数：getUserContent
// 功能：根据 tab 获取用户内容（dynamic / favorite / location）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { tab = 'dynamic' } = event
  const safePage = Math.max(1, Math.floor(Number(event.page) || 1))
  const safePageSize = Math.min(50, Math.max(1, Math.floor(Number(event.pageSize) || 10)))
  const skip = (safePage - 1) * safePageSize

  if (!openid) {
    return { code: 0, data: [] }
  }

  try {
    if (tab === 'dynamic') {
      // 我的动态 — 该用户发布的帖子
      const result = await db.collection('posts')
        .where({ creatorOpenId: openid })
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(safePageSize)
        .get()
      return { code: 0, data: result.data }

    } else if (tab === 'favorite') {
      // 我的收藏 — v2.0 个人中心展示收藏地点。
      // favorites 集合在「还没有任何人收藏过」时并不存在，直接查询会抛 -502005；
      // 这种情况等价于「没有收藏」，不应让整个「我的」页面报错。
      const favRes = await db.collection('favorites')
        .where({ userOpenId: openid, targetType: 'location' })
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(safePageSize)
        .get()
        .catch(() => ({ data: [] }))

      if (favRes.data.length === 0) {
        return { code: 0, data: [] }
      }

      const locationIds = favRes.data.map(f => f.targetId)
      const locationsRes = await db.collection('locations')
        .where({ _id: _.in(locationIds) })
        .get()

      // 按收藏顺序排列
      const locationMap = {}
      locationsRes.data.forEach(location => { locationMap[location._id] = location })
      const ordered = locationIds.map(id => locationMap[id]).filter(Boolean)

      return { code: 0, data: ordered }

    } else if (tab === 'location') {
      // 我的地点 — 该用户创建的地点
      const result = await db.collection('locations')
        .where({ creatorOpenId: openid })
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(safePageSize)
        .get()
      return { code: 0, data: result.data }

    }

    return { code: 0, data: [] }
  } catch (err) {
    console.error('getUserContent 云函数出错:', err)
    return { code: -1, message: '获取内容失败', error: err.message }
  }
}
