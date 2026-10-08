/**
 * 出毛日记 - 小程序码 scene 解析
 *
 * 背景：wxacode.getUnlimited 的 scene 最多只能携带 32 个可见字符，
 * 因此海报二维码写入的是「裸 ID」（32 位文档 _id 刚好占满），
 * 历史上也曾写入过 `id=xxx` 形式。两种形式都要能正确解析。
 *
 * 扫码进入小程序时，参数位于 options.scene（且需要 decodeURIComponent），
 * 直接转发/朋友圈进入时参数位于 options.id。
 */

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/**
 * 从页面 onLoad 的 options 中解析出目标内容 ID。
 * 优先级：options.id（直接跳转）> options.scene（小程序码 / 扫码进入）
 *
 * @param {object} options 页面 onLoad 收到的参数
 * @returns {string} 解析出的 ID，解析失败返回空字符串
 */
function parseSceneId(options) {
  if (!options || typeof options !== 'object') return ''

  // 1) 直接带 id 的常规跳转与转发
  if (options.id && ID_PATTERN.test(String(options.id))) return String(options.id)

  // 2) 小程序码：scene 可能是 `id=xxx`，也可能就是裸 ID
  if (options.scene) {
    let scene = String(options.scene)
    try {
      scene = decodeURIComponent(scene)
    } catch (e) {
      // scene 未被编码时 decodeURIComponent 可能抛错，按原值处理
    }
    const matched = scene.match(/(?:^|[?&])id=([A-Za-z0-9_-]{1,64})/)
    if (matched) return matched[1]
    // 兼容裸 ID 形式（海报二维码当前使用的写法）
    if (ID_PATTERN.test(scene)) return scene
  }

  return ''
}

/**
 * 生成用于小程序码的 scene 字符串。
 * 优先使用裸 ID（最省字符，避免超过 32 字符上限）。
 *
 * @param {string} id 文档 ID
 * @returns {string} scene 字符串；ID 不合法或过长时返回空字符串
 */
function buildScene(id) {
  const value = String(id || '')
  if (!ID_PATTERN.test(value)) return ''
  // 裸 ID 最长 32 字符；超长时退回 `id=` 前缀形式由云端自行判断
  return value.length <= 32 ? value : ''
}

module.exports = { parseSceneId, buildScene, ID_PATTERN }
