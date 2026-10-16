// 云函数：searchLocations
// 功能：按关键词搜索地点（名称、地址、描述、提示、最佳时间、标签模糊匹配）
// 公开展示型：不再召回帖子——发布型内容（posts）已整体下线，
// 搜索结果只可能返回地点库内容。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const { isPubliclyVisible } = require('./visibility')
const { getBlockedIds, filterBlocked } = require('./blocked')
// 公开字段出口：剔除已下线功能的遗留字段 + creatorOpenId。
// 搜索页 wxml 上有 `wx:if="{{item.rating}}"`，不剔除就会给已下线的评分渲染一颗星。
const { toPublicLocation } = require('./locationFields')
const MAX_FETCH = 100 // 云数据库单次查询上限

exports.main = async (event, context) => {
  const { OPENID: openid } = cloud.getWXContext()
  const { keyword = '', scene = 'all' } = event
  const safePage = Math.max(1, Math.floor(Number(event.page) || 1))
  const safePageSize = Math.min(30, Math.max(1, Math.floor(Number(event.pageSize) || 10)))

  if (!keyword.trim()) {
    return { code: 0, data: [] }
  }

  const reg = db.RegExp({ regexp: keyword, options: 'i' })
  const skip = (safePage - 1) * safePageSize

  try {
    // 搜索地点（名称、地址、描述、提示、最佳时间、标签）
    const locRes = await db.collection('locations')
      .where(_.or([
        { name: reg },
        { address: reg },
        { description: reg },
        { notice: reg },
        { bestTime: reg },
        { tags: reg }
      ]))
      .orderBy('createdAt', 'desc')
      .limit(MAX_FETCH)
      .get()

    // 可见性规则统一由 visibility.js 提供：只有 approved 才公开，
    // rejected / pending 一律仅作者本人可见。
    // 拉黑过滤：搜索结果里同样不展示被当前用户拉黑的内容。
    const blockedIds = await getBlockedIds(db, openid)
    const merged = filterBlocked(locRes.data
      .filter(item => isPubliclyVisible(item, openid))
      .filter(item => matchesScene(item, scene)), blockedIds)
      .map(item => toPublicLocation(item, { openid, extra: { _type: 'location' } }))
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return tb - ta
      })

    const paged = merged.slice(skip, skip + safePageSize)

    return { code: 0, data: paged }
  } catch (err) {
    console.error('searchLocations 云函数出错:', err)
    return { code: -1, message: '搜索失败', error: err.message }
  }
}

function matchesScene(location, scene) {
  if (!scene || scene === 'all') return true
  if (scene === 'indoor') return location.indoor === true || location.category === '室内场景'
  if (scene === 'outdoor') return location.indoor !== true
  if (['shade', 'restroom', 'changing', 'parking', 'power'].includes(scene)) {
    return Array.isArray(location.facilities) && location.facilities.some(item =>
      (typeof item === 'string' ? item : item && item.key) === scene
    )
  }
  const categoryAliases = {
    forest: '自然风光', urban: '城市街景', water: '水域', park: '公园绿地'
  }
  return location.style === scene || location.category === categoryAliases[scene] ||
    (Array.isArray(location.tags) && location.tags.includes(scene))
}
