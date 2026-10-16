// 云函数：getLocations
// 功能：分页获取地点列表，支持分类筛选
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const { isPubliclyVisible } = require('./visibility')
const { getBlockedIds, filterBlocked } = require('./blocked')
// 公开字段出口：剔除已下线功能的遗留字段 + creatorOpenId。
const { toPublicLocation } = require('./locationFields')
const FILTER_CATEGORY_ALIASES = {
  forest: ['自然风光'],
  urban: ['城市街景'],
  water: ['水域'],
  park: ['公园绿地'],
  indoor: ['室内场景'],
  ruins: [], ancient: [], countryside: [], night: []
}

function matchesFilter(location, filters) {
  const list = (Array.isArray(filters) ? filters : [filters]).filter(filter => filter && filter !== 'all')
  if (!list.length) return true
  // 风格/类别与设施可组合；每个已选条件都必须命中。
  return list.every(filter => matchesOneFilter(location, filter))
}

function matchesOneFilter(location, filter) {
  if (filter === 'indoor') return location.indoor === true || location.category === '室内场景'
  if (filter === 'outdoor') return location.indoor !== true
  if (['shade', 'restroom', 'changing', 'parking', 'power'].includes(filter)) {
    return Array.isArray(location.facilities) && location.facilities.some(item =>
      (typeof item === 'string' ? item : item && item.key) === filter
    )
  }
  const aliases = FILTER_CATEGORY_ALIASES[filter] || []
  return location.style === filter || aliases.includes(location.category) ||
    (Array.isArray(location.tags) && location.tags.includes(filter))
}

exports.main = async (event, context) => {
  const { OPENID: openid } = cloud.getWXContext()
  const { category = 'all', featuredOnly = false } = event
  const safePage = Math.max(1, Math.floor(Number(event.page) || 1))
  const safePageSize = Math.min(50, Math.max(1, Math.floor(Number(event.pageSize) || 10)))
  const skip = (safePage - 1) * safePageSize
  // Categories and facilities have legacy aliases, so part of the filter must
  // remain in application code. Read a bounded ordered window first, then page
  // the filtered result to avoid returning an empty page merely because the
  // raw database page contained non-matching records.
  const scanSize = Math.min(100, Math.max(safePageSize * 4, (safePage * safePageSize) * 4))

  try {
    // 读取地点列表。
    // ⚠️ 这里必须容忍「排序字段不存在」的情况：云开发数据库在 orderBy 一个
    // 并非所有文档都带有的字段时，只会返回带有该字段的文档；一旦历史数据
    // 整体缺少 createdAt，排序查询就会返回空集，表现为地图标点整体消失
    // （而且发现页没有渲染 errorMessage，用户看不到任何报错）。
    // 因此排序查询为空时，退回一次未排序查询，保证标点不会凭空不见。
    let result = await db.collection('locations')
      .orderBy('createdAt', 'desc')
      .limit(scanSize)
      .get()
    if (!result.data.length) {
      const fallback = await db.collection('locations').limit(scanSize).get()
      if (fallback.data.length) {
        // 未排序查询拿到的顺序不可预期，这里在内存里按 createdAt 倒序还原，
        // 让补位结果与原排序查询的展示顺序保持一致。
        const sorted = fallback.data.slice().sort((a, b) => {
          const ta = new Date(a.createdAt || 0).getTime() || 0
          const tb = new Date(b.createdAt || 0).getTime() || 0
          return tb - ta
        })
        result = { ...fallback, data: sorted }
      }
    }
    // 旧数据没有 visibility 时按公开处理；下架与审核未通过内容只对作者可见。
    // 可见性规则统一由 visibility.js 提供，避免各读接口各写一套。
    // 拉黑过滤：被当前用户拉黑的作者，其地点不再出现在地图标记与列表中。
    const blockedIds = await getBlockedIds(db, openid)
    const filtered = filterBlocked(result.data.filter(item =>
      isPubliclyVisible(item, openid) &&
      matchesFilter(item, category) &&
      // 精选视角：只返回运营方标记的 featured 地点（详见 location-upload 的精选开关）
      (!featuredOnly || item.featured === true)
    ), blockedIds).slice(skip, skip + safePageSize)
    const locationIds = filtered.map(item => item._id).filter(Boolean)
    let favoriteCountMap = {}
    // 收藏数已由 toggleFavorite 在事务中维护在 locations.favoriteCount 上，
    // 这里以该字段为准；只有历史数据缺字段时才回退到 favorites 计数，
    // 避免旧实现「只聚合前 100 条 favorites」导致的截断误差。
    const needFallbackIds = filtered
      .filter(item => !Number.isFinite(Number(item.favoriteCount)))
      .map(item => item._id)
      .filter(Boolean)
    if (needFallbackIds.length) {
      try {
        const favRes = await db.collection('favorites')
          .where({ targetType: 'location', targetId: _.in(needFallbackIds) })
          .limit(1000)
          .get()
        favRes.data.forEach(item => {
          favoriteCountMap[item.targetId] = (favoriteCountMap[item.targetId] || 0) + 1
        })
      } catch (favErr) {
        console.warn('getLocations 收藏计数回退查询失败:', favErr.message)
      }
    }

    // 地图卡片需要在点开时就显示正确的收藏状态，因此在列表接口里一并返回
    // 当前用户对这批地点的收藏关系（单独精确查询，不受上面 100 条计数窗口影响）。
    let myFavoritedIds = new Set()
    if (openid && locationIds.length) {
      try {
        const myFavRes = await db.collection('favorites')
          .where({ targetType: 'location', targetId: _.in(locationIds), userOpenId: openid })
          .limit(locationIds.length)
          .get()
        myFavoritedIds = new Set(myFavRes.data.map(item => item.targetId))
      } catch (favErr) {
        console.warn('getLocations 收藏状态查询失败:', favErr.message)
      }
    }

    return {
      code: 0,
      // 统一走 toPublicLocation：剔除 checkinCount / rating / commentCount 等
      // 已下线功能的遗留字段，以及 creatorOpenId。
      // 注：热度条（discover.js 的 computeHeat）只用 favoriteCount + viewCount，
      // 不需要 checkinCount / reactionUpCount —— 早前这里给它们补 0 的注释是过时的。
      data: filtered.map(item => toPublicLocation(item, {
        openid,
        extra: {
          favoriteCount: Number.isFinite(Number(item.favoriteCount))
            ? Math.max(0, Number(item.favoriteCount))
            : (favoriteCountMap[item._id] || 0),
          isFavorited: myFavoritedIds.has(item._id),
          viewCount: Math.max(0, Number(item.viewCount) || 0)
        }
      })),
      // A sparse category can return fewer than one UI page while the scanned
      // source window still has more records to inspect.
      hasMore: result.data.length === scanSize && scanSize < 100
    }
  } catch (err) {
    console.error('getLocations 云函数出错:', err)
    return { code: -1, message: '获取地点列表失败', error: err.message }
  }
}
