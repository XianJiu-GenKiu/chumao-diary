/**
 * 地点文档的公开字段出口（locations 集合的读取侧统一收口）
 *
 * ── 为什么要有这个模块 ──
 * 1. 已下线功能（签到 / 评分 / 种草踩雷 / 评论）的计数字段仍留在历史文档里
 *    （addLocation 当年会初始化它们），`{ ...item }` 会把它们原样带回客户端。
 *    getLocationDetail 早前已显式剔除，但 getLocations / getSeasonalLocations /
 *    searchLocations 三处都漏了 —— 同一份数据「详情页干净、列表页带脏字段」。
 *    脏字段的害处不是体积，而是**客户端一旦误用就会出现幽灵数据**：
 *    pages/search/search.wxml 上就绑着 `wx:if="{{item.rating}}"`，一旦某条历史
 *    文档的 rating 非 0，搜索页就会给「已下线功能的评分」渲染一颗星。
 * 2. creatorOpenId 属用户个人信息，不应下发到客户端。前端唯一的用途是
 *    pages/location-detail/location-detail.js 判断「这条是不是我创建的」，
 *    而这个判断完全可以在服务端完成，没必要把 openid 交出去。
 *
 * 因此：**所有返回 locations 文档的接口都必须经过 toPublicLocation()**。
 * 新增读接口时请直接 require 本模块，不要自己再写一遍剔除逻辑。
 *
 * ── 用法 ──
 *   const { toPublicLocation } = require('./locationFields')
 *   return { code: 0, data: list.map(item => toPublicLocation(item, {
 *     openid,
 *     extra: { isFavorited: favSet.has(item._id) }
 *   })) }
 *
 * 注意：内部排序用的临时字段（如 _score）不属于本模块职责，
 * 由调用方在返回前自行删除。
 */

/**
 * 已下线功能遗留的计数字段。
 * 判定依据：对应功能（签到 / 评分 / 种草踩雷 / 评论）已整体下线，
 * 前端已无任何真实消费点 —— pages/discover/discover.js 的 computeHeat()
 * 只用 favoriteCount + viewCount，且注释明确写「打卡数 / 种草数 / 评分数不再计入」。
 */
const RETIRED_FIELDS = [
  'checkinCount',
  'rating',
  'ratingCount',
  'creatorRating',
  'reactionUpCount',
  'reactionDownCount',
  'commentCount'
]

/** 属用户个人信息、不下发到客户端的字段。 */
const PRIVATE_FIELDS = [
  'creatorOpenId'
]

/**
 * 剔除下线字段与私有字段，返回浅拷贝。
 * 传入非对象时原样返回，避免调用方在空数据上炸掉。
 */
function stripRetiredFields(item) {
  if (!item || typeof item !== 'object') return item
  const out = { ...item }
  RETIRED_FIELDS.forEach(key => { delete out[key] })
  PRIVATE_FIELDS.forEach(key => { delete out[key] })
  return out
}

/**
 * 把一条 locations 文档转成可下发的公开结构。
 *
 * @param {object} item              数据库文档
 * @param {object} [options]
 * @param {string} [options.openid]  当前用户 openid，用于计算 isMine
 * @param {object} [options.extra]   额外附加字段（收藏状态、计数等），最后合并
 * @returns {object} 已剔除私有字段、并带 isMine 的公开结构
 */
function toPublicLocation(item, options = {}) {
  if (!item || typeof item !== 'object') return item
  const { openid, extra } = options
  const out = stripRetiredFields(item)
  // 前端据此决定是否显示「编辑 / 删除」入口，替代原先客户端比对 creatorOpenId。
  out.isMine = !!openid && item.creatorOpenId === openid
  if (extra && typeof extra === 'object') Object.assign(out, extra)
  return out
}

module.exports = {
  RETIRED_FIELDS,
  PRIVATE_FIELDS,
  stripRetiredFields,
  toPublicLocation
}
