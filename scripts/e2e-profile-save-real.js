/**
 * 临时探针：编辑资料「真实」端到端保存测试
 * - 真实 wx.cloud.uploadFile
 * - 真实 updateUserProfile 云函数
 * - 结束后把资料恢复为测试前的值
 * 用法：NODE_PATH=<workspace>/node_modules node scripts/tmp-e2e-profile-real.js
 */
const automator = require('miniprogram-automator')
const WS = process.env.MP_WS || 'ws://127.0.0.1:9420'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function main() {
  const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 })

  // 1) 记录原始资料 + 安装记录器 + 造一个真实本地图片
  const origin = await mp.evaluate(async (pngB64) => {
    const app = getApp()
    // 先用 login 刷新一次真实的用户资料（避免上一轮探针污染的 globalData）
    try {
      const loginRes = await app.callCloud('login', {})
      if (loginRes && loginRes.data) app.setLoggedInUser(loginRes.data)
    } catch (e) { /* 刷新失败则沿用现有值 */ }
    const u = app.globalData.userInfo || {}
    const fsm = wx.getFileSystemManager()
    const localPath = `${wx.env.USER_DATA_PATH}/wb_e2e_${Date.now()}.png`
    await new Promise((res, rej) => fsm.writeFile({ filePath: localPath, data: pngB64, encoding: 'base64', success: res, fail: rej }))

    globalThis.__rec = { uploads: [], calls: [], toasts: [] }
    const rawUpload = wx.cloud.uploadFile.bind(wx.cloud)
    wx.cloud.uploadFile = async (o) => {
      try {
        const r = await rawUpload(o)
        globalThis.__rec.uploads.push({ cloudPath: o.cloudPath, ok: true, fileID: r.fileID })
        return r
      } catch (e) {
        globalThis.__rec.uploads.push({ cloudPath: o.cloudPath, ok: false, err: String((e && (e.errMsg || e.message)) || e) })
        throw e
      }
    }
    const rawCall = app.callCloud.bind(app)
    app.callCloud = async (n, d) => {
      const r = await rawCall(n, d)
      if (n === 'updateUserProfile') globalThis.__rec.calls.push({ data: d, res: r })
      return r
    }
    const rawToast = wx.showToast
    wx.showToast = (o) => { globalThis.__rec.toasts.push(o && o.title); return rawToast.call(wx, o) }

    return {
      localPath,
      openId: app.globalData.openId,
      nickname: u.nickname || '',
      furName: u.furName || '',
      signature: u.signature || '',
      avatar: u.avatar || u.avatarUrl || '',
      profileBg: u.profileBg || u.backgroundImage || u.coverUrl || ''
    }
  }, PNG)
  console.log('原始资料:', JSON.stringify({ openId: origin.openId, nickname: origin.nickname, avatar: origin.avatar, profileBg: origin.profileBg }, null, 2))

  // 2) 走真实保存流程
  await mp.reLaunch('/pages/profile-edit/profile-edit')
  await sleep(2500)
  const page = await mp.currentPage()
  console.log('页面:', page.path)

  await page.setData({
    nickname: origin.nickname || '测试昵称',
    avatar: origin.localPath,
    profileBg: origin.localPath
  })
  await page.callMethod('save')
  await sleep(5000)

  const rec = await mp.evaluate(() => globalThis.__rec)
  const pageData = await page.data()
  console.log('\n=== 上传记录 ===')
  console.log(JSON.stringify(rec.uploads, null, 2))
  console.log('\n=== updateUserProfile 调用 ===')
  console.log(JSON.stringify(rec.calls, null, 2))
  console.log('\n=== 页面提示 ===', JSON.stringify(rec.toasts))
  console.log('=== 保存后页面 avatar ===', pageData.avatar)
  console.log('=== 保存后页面 profileBg ===', pageData.profileBg)

  // 3) 恢复原始资料（真实调用）
  const restore = await mp.evaluate(async (o) => {
    const app = getApp()
    return await app.callCloud('updateUserProfile', {
      nickname: o.nickname || '微信用户',
      furName: o.furName || '',
      signature: o.signature || '',
      avatar: o.avatar || '',
      profileBg: o.profileBg || ''
    })
  }, origin)
  console.log('\n=== 恢复结果 ===', JSON.stringify(restore && { code: restore.code, message: restore.message, avatar: restore.data && restore.data.avatar, profileBg: restore.data && restore.data.profileBg }, null, 2))

  await mp.disconnect()
  const failed = rec.uploads.filter(u => !u.ok)
  const callOk = rec.calls.length && rec.calls[0].res && rec.calls[0].res.code === 0
  console.log('\n结论:', failed.length ? '上传失败' : (callOk ? '全链路成功' : '上传成功但云函数保存失败'))
}
main().catch(e => { console.error('失败:', e && (e.stack || e)); process.exit(1) })
