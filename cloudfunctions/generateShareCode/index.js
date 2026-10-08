// 云函数：generateShareCode
// 生成海报使用的小程序码。
//
// ── 前置条件（缺失会导致调用失败）──
// 本函数目录下必须有 config.json 声明云调用权限，否则返回 -604101：
//   { "permissions": { "openapi": ["wxacode.getUnlimited"] } }
//
// ── 为什么 scene 用裸 ID ──
// wxacode.getUnlimited 的 scene 上限是 32 个可见字符，而云开发文档 _id 本身就是
// 32 位，加 `id=` 前缀会超限导致生成失败。详情页由 utils/scene.js 的
// parseSceneId 同时兼容裸 ID 与旧的 `id=xxx` 写法。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const ALLOWED_PAGES = [
  'pages/location-detail/location-detail',
  'pages/event-detail/event-detail',
  'pages/route-plan/route-plan'
]
const MAX_SCENE_LENGTH = 32

exports.main = async (event) => {
  const page = event.page || 'pages/location-detail/location-detail'
  const rawScene = String(event.scene || '')

  // 兼容两种入参：裸 ID，或历史调用方传来的 `id=xxx`。
  let scene = rawScene
  const legacy = rawScene.match(/^id=([A-Za-z0-9_-]+)$/)
  if (legacy) scene = legacy[1]

  if (!ALLOWED_PAGES.includes(page) ||
      !/^[A-Za-z0-9_-]{1,32}$/.test(scene) ||
      scene.length > MAX_SCENE_LENGTH) {
    return { code: -1, message: '无效的小程序码参数' }
  }

  try {
    const result = await cloud.openapi.wxacode.getUnlimited({
      page,
      scene,
      checkPath: false,
      width: 280,
      autoColor: false,
      lineColor: { r: 24, g: 45, b: 39 }
    })

    // 云调用成功时返回 buffer；若返回体里带 errcode 说明实际调用失败。
    const buffer = result && (result.buffer || result.fileContent)
    if (!buffer || !buffer.length) {
      const code = result && result.errcode
      console.error('getUnlimited 未返回图片数据:', JSON.stringify(result || {}).slice(0, 500))
      return {
        code: -1,
        message: code ? `小程序码生成失败（错误码 ${code}）` : '小程序码生成失败',
        errcode: code || undefined
      }
    }

    // cloudPath 必须同时含 page 与 scene：只按 scene 命名会让「同一 scene 的不同
    // 页面」互相覆盖 —— 后写的码会把先写的替换掉，分享卡就可能跳到错误页面。
    const codeKey = `${page.replace(/[^A-Za-z0-9]/g, '_')}_${Buffer.from(scene).toString('hex')}`
    const upload = await cloud.uploadFile({
      cloudPath: `share-codes/${codeKey}.png`,
      fileContent: buffer
    })
    return { code: 0, data: { fileID: upload.fileID } }
  } catch (err) {
    // 把真实错误码透出给前端，便于定位是权限未声明（-604101）、
    // 页面未发布（-41030）还是参数问题，而不是只报「生成失败」。
    const errcode = err && (err.errCode || err.errcode)
    const errmsg = (err && (err.errMsg || err.message)) || ''
    console.error('generateShareCode 调用失败:', errcode || '', errmsg, err)
    let hint = '小程序码生成失败'
    if (errcode === -604101) hint = '小程序码权限未配置，请在云函数 config.json 声明 wxacode.getUnlimited 后重新部署'
    else if (errcode === -41030) hint = '小程序码指向的页面尚未发布，请先发布包含该页面的版本'
    else if (errcode === 40001 || errcode === 42001) hint = '小程序凭证异常，请稍后重试'
    return { code: -1, message: hint, errcode: errcode || undefined }
  }
}
