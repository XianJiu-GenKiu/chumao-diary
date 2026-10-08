// 云函数：getPosts
// 功能：分页获取帖子列表，支持按 tab 筛选（follow / discover / nearby）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const { isPubliclyVisible } = require('./visibility')
const { getBlockedIds, filterBlocked } = require('./blocked')

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { tab = 'discover', sort = '', latitude, longitude } = event
  const safePage = Math.max(1, Math.floor(Number(event.page) || 1))
  const safePageSize = Math.min(50, Math.max(1, Math.floor(Number(event.pageSize) || 10)))
  const safeRadius = Math.min(100000, Math.max(1000, Number(event.radius) || 50000))
  const skip = (safePage - 1) * safePageSize
  const hasNearbyCoordinates = (tab === 'nearby' || tab === 'local') &&
    Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))

  try {
    const requiresLocalSort = tab === 'local' || sort === 'hot'
    let query = db.collection('posts')

    if (tab === 'follow') {
      // 关注 — 只展示关注用户的帖子
      if (!openid) return { code: 0, data: [] }

      // 从 follows 集合获取关注列表
      try {
        const followsRes = await db.collection('follows')
          .where({ followerOpenId: openid })
          .limit(100)
          .get()
        const followingIds = followsRes.data.map(f => f.followingOpenId)

        if (followingIds.length === 0) {
          return { code: 0, data: [] }
        }

        query = query.where({ creatorOpenId: _.in(followingIds) })
      } catch (e) {
        // follows 集合可能不存在
        return { code: 0, data: [] }
      }
    }

    // 附近动态有两条取数路径：
    //   1) geoNear —— 精度最好，但要求 posts.geoLocation 上存在「地理位置索引」；
    //      索引缺失时查询会直接报 unable to find index for $geoNear query。
    //   2) 回退路径 —— 按时间取最近一批，再用经纬度字段在内存里算距离。
    // 早期实现只有路径 1，一旦索引没建，「同城」整页加载失败。
    // 现在路径 1 失败会自动降级到路径 2，保证功能可用。
    let nearbyPosts = null
    if (hasNearbyCoordinates) {
      try {
        const geoRes = await db.collection('posts')
          .where({
            geoLocation: _.geoNear({
              geometry: new db.Geo.Point(Number(longitude), Number(latitude)),
              minDistance: 0,
              maxDistance: safeRadius
            })
          })
          .limit(100)
          .get()
        // geoNear 已按距离升序返回，无需再排序。
        nearbyPosts = geoRes.data
      } catch (geoErr) {
        console.warn('geoNear 查询不可用，回退为经纬度字段计算距离:', geoErr.message)
      }
    }

    let result
    if (nearbyPosts) {
      result = { data: nearbyPosts }
    } else {
      // 普通分页走 skip/limit；附近（回退）与热门需要先在本地排序，
      // 因此先取一个较大的工作集再切片。
      let orderedQuery = query.orderBy('createdAt', 'desc')
      if (requiresLocalSort || hasNearbyCoordinates) orderedQuery = orderedQuery.limit(100)
      else orderedQuery = orderedQuery.skip(skip).limit(safePageSize)
      result = await orderedQuery.get()
    }

    // 圈内内容只允许作者本人查看；旧数据没有 visibility，按公开内容兼容。
    // 可见性规则统一由 visibility.js 提供（只有 approved 才公开，
    // rejected / pending 一律仅作者本人可见），避免各读接口各写一套。
    let posts = result.data.filter(post => isPubliclyVisible(post, openid))

    // 拉黑过滤：被当前用户拉黑的作者，其内容不出现在任何 tab。
    // 放在可见性过滤之后、排序与分页之前，避免被过滤掉的内容占满一页。
    const blockedIds = await getBlockedIds(db, openid)
    posts = filterBlocked(posts, blockedIds)

    // 附近动态（含 local 旧标签）：统一补上距离并按距离升序。
    // geoNear 路径已保证在半径内且有序，这里只补 _distance 供前端展示；
    // 回退路径需要真正按经纬度字段筛选。坐标同时兼容顶层字段与 location 对象。
    if (hasNearbyCoordinates) {
      posts = posts.map(post => {
        const lat = post.latitude ?? (post.location && post.location.latitude)
        const lng = post.longitude ?? (post.location && post.location.longitude)
        if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null
        const distance = getDistance(Number(latitude), Number(longitude), Number(lat), Number(lng))
        return { ...post, _distance: distance }
      }).filter(item => item && item._distance <= safeRadius)
      // geoNear 已排序；回退路径需要显式排序。
      if (!nearbyPosts) posts.sort((a, b) => a._distance - b._distance)
    } else if (sort === 'hot') {
      posts.sort((a, b) => hotScore(b) - hotScore(a))
    }

    posts = (requiresLocalSort || hasNearbyCoordinates) ? posts.slice(skip, skip + safePageSize) : posts.slice(0, safePageSize)

    // 附加当前用户的种草/踩雷状态；兼容旧版点赞字段。
    if (openid && posts.length > 0) {
      const postIds = posts.map(p => p._id)
      const [likesRes, reactionsRes] = await Promise.all([
        db.collection('likes').where({
          targetId: _.in(postIds),
          targetType: 'post',
          userOpenId: openid
        }).get().catch(() => ({ data: [] })),
        db.collection('reactions').where({
          targetId: _.in(postIds),
          targetType: 'post',
          userOpenId: openid
        }).get().catch(() => ({ data: [] }))
      ])
      const likedSet = new Set(likesRes.data.map(l => l.targetId))
      const reactionMap = new Map(reactionsRes.data.map(item => [item.targetId, item.reactionType]))
      posts = posts.map(p => ({
        ...p,
        liked: likedSet.has(p._id),
        reactionUp: reactionMap.get(p._id) === 'up',
        reactionDown: reactionMap.get(p._id) === 'down',
        reactionUpCount: Number(p.reactionUpCount) || 0,
        reactionDownCount: Number(p.reactionDownCount) || 0
      }))
    }

    return { code: 0, data: posts }
  } catch (err) {
    console.error('getPosts 云函数出错:', err)
    return { code: -1, message: '获取帖子列表失败', error: err.message }
  }
}

function hotScore(post) {
  const engagement = ((Number(post.reactionUpCount) || 0) + (Number(post.likeCount) || 0)) * 3 -
    (Number(post.reactionDownCount) || 0) * 2 +
    (Number(post.commentCount) || 0) * 2 +
    (Number(post.shareCount) || 0)
  const createdAt = new Date(post.createdAt || 0).getTime()
  const ageHours = createdAt > 0 ? Math.max(0, (Date.now() - createdAt) / 3600000) : 24 * 365
  // New posts receive a small, decaying discovery boost. Engagement still
  // dominates once a post has accumulated community feedback.
  const discoveryBoost = Math.max(0, 4 - ageHours / 6)
  return engagement + discoveryBoost
}

// 计算两点之间的距离（米）
function getDistance(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180
  const R = 6371000 // 地球半径（米）
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}
