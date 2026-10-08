/**
 * 媒体地址清洗（统一版）
 *
 * 背景：地点 / 动态 / 评论里的 authorAvatar 都是从 users.avatar 冗余下来的。
 * 历史上出现过 users.avatar 被写成「微信选图临时路径」的情况
 * （真机与模拟器都是 http://tmp/xxx，另有 wxfile: 等前缀）。
 * 这类路径一旦落库，线上用户看到的必然是裂图
 * （线上曾有一条地点数据「我服了」中招，已单独修数据）。
 *
 * 处理方式：写入前统一过滤，临时路径直接落空串，由前端回退到默认头像；
 * 正常地址（cloud:// 文件 ID、https 外链）原样保留。
 */

// 微信选图临时文件的几种前缀（真机 / 模拟器 / 编辑器表现不同，全部覆盖）
const TEMP_FILE_PATTERN = /^(wxfile|wxblob|blob|file):/i
const TEMP_HTTP_PATTERN = /^https?:\/\/tmp\//i

/**
 * 判断是否为不可持久化的本地临时文件地址
 * @param {string} value
 * @returns {boolean}
 */
function isTempFileUrl(value) {
  const v = String(value || '').trim()
  if (!v) return false
  return TEMP_FILE_PATTERN.test(v) || TEMP_HTTP_PATTERN.test(v)
}

/**
 * 清洗媒体地址：临时路径 → 空串；其余原样返回。
 * @param {string} value
 * @returns {string}
 */
function sanitizeMediaUrl(value) {
  const v = String(value || '').trim()
  if (!v) return ''
  if (isTempFileUrl(v)) return ''
  return v
}

/** 语义化别名：作者头像场景 */
const sanitizeAvatar = sanitizeMediaUrl

module.exports = {
  sanitizeMediaUrl,
  sanitizeAvatar,
  isTempFileUrl
}
