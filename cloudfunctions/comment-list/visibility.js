/**
 * 内容可见性统一规则（唯一真源）
 *
 * ⚠️ 母本位置：cloudfunctions-shared/visibility.js
 * 请勿直接修改各云函数目录下的副本，改这里后用 `npm run sync:shared` 分发。
 * 一致性由 `npm run check:shared` 校验（已接入 npm run check）。
 *
 * ── 审核状态机（唯一权威定义，共 4 态）──
 *   approved  审核通过，正常公开
 *   pending   审核服务不可用，先允许写入，仅作者本人可见
 *   rejected  明确违规，调用方应拒绝写入
 *   hidden    管理员下架，任何人都不可见（含作者）
 *
 * 注意：微信 msgSecCheck 返回的 `suggest` 字段取值为 pass / review / risky，
 * 那是**接口原始返回值**，不是本状态机的取值，两者不要混用。
 *
 * ── 可见性规则 ──
 *   visibility = hidden  或  moderationStatus = hidden   → 一律不可见
 *   moderationStatus 非 approved                        → 仅作者可见
 *   visibility = circle                                 → 仅作者可见
 *   visibility 为空 / public                            → 公开
 *   （旧数据没有 visibility 字段时按公开处理，保持向后兼容）
 */

const MODERATION = {
  APPROVED: 'approved',
  PENDING: 'pending',
  REJECTED: 'rejected',
  HIDDEN: 'hidden'
}

const VISIBILITY = {
  PUBLIC: 'public',
  CIRCLE: 'circle',
  HIDDEN: 'hidden'
}

/** 审核是否已通过（无状态字段的旧数据视为通过） */
function isApproved(item) {
  const status = item && item.moderationStatus
  return !status || status === MODERATION.APPROVED
}

/** 是否被下架（visibility 或 moderationStatus 任一为 hidden） */
function isRemoved(item) {
  if (!item) return true
  return item.visibility === VISIBILITY.HIDDEN || item.moderationStatus === MODERATION.HIDDEN
}

/** 查看者是否为该内容的作者 */
function isAuthor(item, viewerOpenId, authorField) {
  const field = authorField || 'creatorOpenId'
  return !!viewerOpenId && !!item && item[field] === viewerOpenId
}

/**
 * 内容对指定查看者是否可见。
 *
 * @param {object} item 内容文档
 * @param {string} viewerOpenId 查看者 openid
 * @param {string} [authorField='creatorOpenId'] 作者字段名。
 *        posts / locations 用 creatorOpenId；comments 用 userOpenId。
 * @returns {boolean}
 */
function isPubliclyVisible(item, viewerOpenId, authorField) {
  if (!item) return false
  const status = item.moderationStatus
  const authorViewing = isAuthor(item, viewerOpenId, authorField)
  if (item.visibility === VISIBILITY.HIDDEN || status === MODERATION.HIDDEN) return false
  if (status && status !== MODERATION.APPROVED) return authorViewing
  if (item.visibility === VISIBILITY.CIRCLE) return authorViewing
  return !item.visibility || item.visibility === VISIBILITY.PUBLIC || authorViewing
}

/**
 * 数据库查询层面的「未下架」过滤条件，用于在 where 中提前缩小结果集。
 * 注意：这只排除 hidden，pending / rejected 的「仅作者可见」语义
 * 无法用单条 where 表达，仍需配合 isPubliclyVisible 在内存中过滤。
 *
 * @param {object} _ db.command 实例
 * @returns {object} 可直接展开进 where 的条件对象
 */
function notRemovedFilter(_) {
  return {
    visibility: _.neq(VISIBILITY.HIDDEN),
    moderationStatus: _.neq(MODERATION.HIDDEN)
  }
}

module.exports = {
  MODERATION,
  VISIBILITY,
  isApproved,
  isRemoved,
  isAuthor,
  isPubliclyVisible,
  notRemovedFilter
}
