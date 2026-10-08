// 云函数：getLocationDetail
// 功能：获取地点详情，附带当前用户的收藏状态、帖子列表、评论列表
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const MAX_LIMIT = 100

function todayInChina() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date())
}

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

    // 2. 当前用户是否已收藏
    let isFavorited = false
    let reactionUp = false
    let reactionDown = false
    let checkedIn = false
    let myDimRatings = null
    if (openid) {
      const [favRes, reactionRes, checkinRes, myRatingRes] = await Promise.all([
        // favorites 集合在「还没有任何人收藏过」时并不存在，count() 会抛
        // -502005。这条查询只是补充「我是否收藏过」，不能因为集合缺失就让
        // 整个地点详情页打不开（与下面 reactions / checkins / ratings 一致降级）。
        db.collection('favorites').where({
          targetId: locationId,
          targetType: 'location',
          userOpenId: openid
        }).count().catch(() => ({ total: 0 })),
        db.collection('reactions').where({
          targetId: locationId,
          targetType: 'location',
          userOpenId: openid
        }).limit(1).get().catch(() => ({ data: [] })),
        db.collection('checkins').where({ locationId, userOpenId: openid, dateKey: todayInChina() }).limit(1).get().catch(() => ({ data: [] })),
        db.collection('ratings').where({ locationId, userOpenId: openid }).limit(1).get().catch(() => ({ data: [] }))
      ])
      isFavorited = favRes.total > 0
      const reactionType = reactionRes.data[0] && reactionRes.data[0].reactionType
      reactionUp = reactionType === 'up'
      reactionDown = reactionType === 'down'
      checkedIn = checkinRes.data.length > 0
      // 获取当前用户的多维度评分
      if (myRatingRes.data.length > 0 && myRatingRes.data[0].dimRatings) {
        myDimRatings = myRatingRes.data[0].dimRatings
      }
    }

    // 3. 获取该地点的帖子（最新 20 条）
    // 与下面的旧版关联查询一样逐条降级：posts 集合尚不存在时视为「暂无动态」，
    // 不应让整个地点详情页打不开。
    const [postsRes, legacyPostsRes] = await Promise.all([
      db.collection('posts').where({ locationId }).orderBy('createdAt', 'desc').limit(20).get()
        .catch(() => ({ data: [] })),
      db.collection('posts').where({ 'location._id': locationId }).orderBy('createdAt', 'desc').limit(20).get()
        .catch(() => ({ data: [] }))
    ])
    const postMap = new Map()
    ;[...postsRes.data, ...legacyPostsRes.data].forEach(post => postMap.set(post._id, post))
    const posts = [...postMap.values()].filter(post => {
      if (post.visibility === 'hidden' || post.moderationStatus === 'hidden') return false
      const authorViewing = !!openid && post.creatorOpenId === openid
      if (post.moderationStatus && post.moderationStatus !== 'approved') return authorViewing
      return !post.visibility || post.visibility === 'public' || authorViewing
    }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 20)
    const hotReviews = [...posts]
      .sort((a, b) => ((b.reactionUpCount || b.likeCount || 0) * 3 + (b.commentCount || 0) * 2) - ((a.reactionUpCount || a.likeCount || 0) * 3 + (a.commentCount || 0) * 2))
      .slice(0, 10)
      .map(post => ({ ...post, postId: post._id }))

    // 4. 获取该地点的评论（最新 50 条，按时间正序）
    // comments 集合在「还没有任何评论」时并不存在，查询会抛 -502005；
    // 这种情况等价于「没有评论」，不应让整个地点详情页打不开。
    const commentsRes = await db.collection('comments')
      .where({ targetId: locationId, targetType: 'location' })
      .orderBy('createdAt', 'asc')
      .limit(50)
      .get()
      .catch(() => ({ data: [] }))
    const comments = commentsRes.data.filter(comment => comment.visibility !== 'hidden' && comment.moderationStatus !== 'hidden')

    // 5. 补充收藏数：优先使用 toggleFavorite 在事务中维护的 favoriteCount，
    //    保证与列表页、排行榜读取同一来源；历史数据缺字段时才精确计数。
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
        reactionUp,
        reactionDown,
        reactionUpCount: Math.max(0, Number(location.reactionUpCount) || 0),
        reactionDownCount: Math.max(0, Number(location.reactionDownCount) || 0),
        checkedIn,
        checkinCount: Math.max(0, Number(location.checkinCount) || 0),
        favoriteCount,
        myDimRatings,
        posts,
        hotReviews,
        comments
      }
    }
  } catch (err) {
    console.error('getLocationDetail 云函数出错:', err)
    return { code: -1, message: '获取地点详情失败', error: err.message }
  }
}
