/**
 * 共享模块：blocked —— 拉黑（屏蔽）关系的读取与过滤
 *
 * ── 为什么需要它 ──
 * UGC 社区规范要求「举报 + 删除 + 拉黑」三项齐备，项目此前只有前两项。
 * 拉黑与「删除内容」不是一回事：删除是**对物**（把某条内容拿掉），
 * 拉黑是**对人**（此后不再看到该用户的任何内容）。缺了拉黑，用户遇到
 * 骚扰者就只能一条条举报，体验和合规都不达标。
 *
 * ── 数据模型 ──
 * 独立集合 blocks，文档形如 { _id, blockerOpenId, blockedOpenId, createdAt }。
 * _id 使用确定性 ID（relationId('block', A, B)），同一对关系天然幂等，
 * 重复点击不会产生多条记录。
 *
 * ⚠️ 拉黑是**单向**的：A 拉黑 B 后只有 A 看不到 B 的内容，B 仍能看到 A 的。
 * 如果将来要改成双向隔离，请在这里统一实现，不要在各个读接口各写一套 ——
 * 这正是本模块存在的意义。
 *
 * ── 接入方式 ──
 *   读接口：拿到数据后调用 filterBlocked(items, blockedIds) 过滤；
 *           blockedIds 由 getBlockedIds(db, viewerOpenId) 取得。
 *   注意 comment-list 等以 userOpenId 记作者的集合，要显式传 authorField。
 */

const COLLECTION = 'blocks'

/** 单用户最多读取的屏蔽条数。正常用户远达不到，仅防列表型滥用。 */
const MAX_BLOCKS = 200

/**
 * 取某用户拉黑的所有 openid。
 *
 * 集合不存在（首次部署）或读取失败时返回空数组 —— 按「没有拉黑任何人」处理。
 * 这样读接口不会因为拉黑功能尚未就绪而整体失败，代价只是过滤暂时不生效。
 */
async function getBlockedIds(db, openid) {
  if (!db || !openid) return []
  try {
    const res = await db.collection(COLLECTION)
      .where({ blockerOpenId: openid })
      .limit(MAX_BLOCKS)
      .get()
    return res.data.map(item => item.blockedOpenId).filter(Boolean)
  } catch (err) {
    console.warn('[blocked] 读取屏蔽列表失败，按无屏蔽处理:', err.message)
    return []
  }
}

/** 内容作者是否在屏蔽名单中。 */
function isBlockedAuthor(item, blockedIds, authorField) {
  if (!item || !blockedIds || !blockedIds.length) return false
  const author = item[authorField || 'creatorOpenId']
  return !!author && blockedIds.indexOf(author) !== -1
}

/** 过滤掉被 viewer 拉黑的内容。blockedIds 为空时原样返回，无额外开销。 */
function filterBlocked(items, blockedIds, authorField) {
  if (!Array.isArray(items)) return []
  if (!blockedIds || !blockedIds.length) return items
  return items.filter(item => !isBlockedAuthor(item, blockedIds, authorField))
}

module.exports = {
  COLLECTION,
  MAX_BLOCKS,
  getBlockedIds,
  isBlockedAuthor,
  filterBlocked
}
