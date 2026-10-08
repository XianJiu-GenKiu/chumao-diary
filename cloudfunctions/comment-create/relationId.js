/**
 * 确定性关系 ID 工具（云函数共用）
 *
 * 问题背景：收藏 / 点赞 / 反应 / 签到等关系此前使用 add() 生成随机 _id，
 * 配合「先查询再写入」的逻辑，并发或重试时会产生重复关系记录，
 * 取消一次后仍有残留，计数也会跟着漂移。
 *
 * 解决方式：把关系的主键改为确定性 ID（由关系双方拼接哈希而来）。
 * 同一个用户对同一个目标只会有一条记录；重复写入会命中同一个 _id，
 * 从而在数据库层面天然幂等，不依赖先查询。
 *
 * 注意：_id 只允许字母数字与部分符号，因此统一使用十六进制摘要。
 */

const crypto = require('crypto')

/**
 * 生成确定性关系 ID
 * @param {string} scope 关系类型，例如 'fav' | 'like' | 'reaction' | 'checkin'
 * @param {...string} parts 参与唯一性判定的字段
 * @returns {string} 32 位十六进制 ID
 */
function relationId(scope, ...parts) {
  const raw = [scope, ...parts.map(p => String(p == null ? '' : p))].join('|')
  return crypto.createHash('md5').update(raw).digest('hex')
}

/**
 * 判断错误是否为「文档已存在」
 * 云开发在 _id 冲突时返回的错误码/文案随版本略有差异，这里统一识别。
 * @param {Error} err
 * @returns {boolean}
 */
function isDuplicateKeyError(err) {
  if (!err) return false
  const text = String(err.errMsg || err.message || '')
  return err.errCode === -501001 ||
    err.errCode === -502001 ||
    /duplicate|already exists|已存在|_id/i.test(text)
}

module.exports = { relationId, isDuplicateKeyError }
