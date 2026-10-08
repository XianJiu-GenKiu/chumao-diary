/**
 * 共享模块：ensureCollection —— 集合自愈
 *
 * 背景：微信云开发中，往「从未创建过」的集合写入会直接抛
 *   `collection.add:fail -502005 database collection not exists`
 * 本项目有若干集合（likes / follows / reactions / ratings / checkins /
 * events / event_likes / usage_events / feedback）只由低频写路径首次触碰，
 * 云控制台里可能一直不存在，于是用户的「第一次点击」就成了故障页。
 *
 * 策略：写入前调用 ensureCollection(db, name)
 *   - 用 db.createCollection 幂等建集合（已存在会抛错，视为成功）；
 *   - 结果按容器实例缓存，冷启动后每个集合最多尝试一次，
 *     不会给热路径增加额外请求；
 *   - 任何失败都不向上抛，只告警。业务侧应自带降级分支
 *     （例如集合建不出来时返回空列表而不是白屏）。
 *
 * 注意：createCollection 不能放在事务里，必须在 runTransaction 之前调用。
 */

// 集合已存在的几种报错写法（中英文 / 错误码）
const ALREADY_EXISTS = /already\s*exist|同名集合|已存在|-501001|CollectionExists/i

// 集合不存在的几种报错写法
const MISSING_COLLECTION = /collection not exists|DATABASE_COLLECTION_NOT_EXIST|-502005/i

// 每个容器实例内的已建集合缓存
const cache = new Map()

/**
 * 确保集合存在。返回 true 表示可以安全写入。
 * 已存在 / 创建成功 → true；创建失败 → false（不抛错）。
 */
async function ensureCollection(db, name) {
  if (cache.get(name)) return true
  if (!db || typeof db.createCollection !== 'function') return false

  try {
    await db.createCollection(name)
    cache.set(name, true)
    return true
  } catch (err) {
    const msg = String((err && err.message) || err || '')
    if (ALREADY_EXISTS.test(msg)) {
      cache.set(name, true)
      return true
    }
    console.warn(`[ensureCollection] 创建集合 ${name} 失败：${msg}`)
    return false
  }
}

/**
 * 惰性兜底：先执行 fn，若因「集合不存在」失败，则建集合后重试一次。
 * 用于集合只在事务内被写到、无法提前建集合的场景。
 */
async function withCollectionRetry(db, name, fn) {
  try {
    return await fn()
  } catch (err) {
    if (!MISSING_COLLECTION.test(String((err && err.message) || err || ''))) throw err
    const ok = await ensureCollection(db, name)
    if (!ok) throw err
    return await fn()
  }
}

module.exports = { ensureCollection, withCollectionRetry, MISSING_COLLECTION }
