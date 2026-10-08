/**
 * 出毛日记 · 编辑资料页「头像 / 背景图」上传链路验证
 *
 * 修复内容：profile-edit 旧版把所有 http(s):// 都当成外链，
 * 而微信选图返回的临时路径在真机上是 http://tmp/xxx，
 * 于是本地临时文件被误判成网络图、交给 wx.downloadFile 去下载，必然失败，
 * 表现为「编辑资料里换不了头像和背景图」。
 *
 * 本脚本在真实运行时里完整跑一遍 save()，但**不产生任何副作用**：
 *   - 接管 wx.downloadFile / wx.compressImage / wx.cloud.uploadFile
 *   - 接管 app.callCloud，避免真的写用户资料
 * 然后断言：
 *   1. downloadFile 一次都没被调用（修复点）
 *   2. uploadFile 收到的是本地临时路径
 *   3. callCloud 收到了 updateUserProfile 且 avatar 是上传后的 fileID
 *
 * 用法：node scripts/e2e-profile-edit-upload.js
 * 前置：开发者工具已开服务端口 + /v2/auto 已开自动化端口 9420
 */
const fs = require('fs')
const path = require('path')

const WS = process.env.MP_WS || 'ws://127.0.0.1:9420'
const OUT = path.join(__dirname, '.e2e-profile-edit-upload.json')

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  let automator
  try {
    automator = require('miniprogram-automator')
  } catch (e) {
    console.error('缺少 miniprogram-automator，请设置 NODE_PATH 指向其安装位置。')
    process.exit(1)
  }

  const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 })
  console.log('已连接', WS)

  await mp.reLaunch('/pages/profile-edit/profile-edit')
  await sleep(3000)
  const page = await mp.currentPage()
  console.log('当前页:', page.path)
  if (page.path !== 'pages/profile-edit/profile-edit') {
    console.error('未落到编辑资料页，实际：', page.path)
    await mp.disconnect()
    process.exit(1)
  }

  // 接管所有会真正落地的调用，保证验证无副作用
  await mp.evaluate(() => {
    const probe = { downloadFile: [], uploadFile: [], toast: [], callCloud: [] }
    globalThis.__probe = probe

    wx.downloadFile = opts => {
      probe.downloadFile.push(opts && opts.url)
      if (opts && opts.fail) opts.fail({ errMsg: 'probe: downloadFile 被拦截' })
    }
    wx.compressImage = opts => {
      if (opts && opts.success) opts.success({ tempFilePath: 'http://tmp/probe-compressed.jpg' })
    }
    try {
      const fsm = wx.getFileSystemManager()
      fsm.getFileInfo = opts => {
        if (opts && opts.success) opts.success({ size: 512 * 1024 })
      }
    } catch (e) { /* 体积探测失败也不影响主流程 */ }
    try {
      wx.cloud.uploadFile = opts => {
        probe.uploadFile.push(opts && opts.filePath)
        return Promise.resolve({ fileID: `cloud://probe/${opts && opts.cloudPath}` })
      }
    } catch (e) { /* 见下方断言失败信息 */ }
    wx.chooseMedia = opts => {
      if (opts && opts.success) {
        opts.success({ tempFiles: [{ tempFilePath: 'http://tmp/probe-avatar.jpg' }] })
      }
    }
    const rawToast = wx.showToast
    wx.showToast = opts => {
      probe.toast.push(opts && opts.title)
      return rawToast.call(wx, opts)
    }

    const app = getApp()
    app.callCloud = (name, data) => {
      probe.callCloud.push({ name, data })
      return Promise.resolve({ code: 0, data: {} })
    }
    return true
  })

  await page.setData({ nickname: 'probe', profileBg: '' })
  await page.callMethod('chooseAvatar')
  await sleep(500)
  const afterChoose = (await page.data()).avatar
  console.log('选头像后 data.avatar =', afterChoose)

  await page.callMethod('save')
  await sleep(2500)

  const probe = await mp.evaluate(() => globalThis.__probe)
  await mp.disconnect()

  const uploadCall = probe.callCloud.find(call => call.name === 'updateUserProfile')
  const result = {
    ok: false,
    avatarAfterChoose: afterChoose,
    downloadFileCalls: probe.downloadFile,
    uploadFilePaths: probe.uploadFile,
    toasts: probe.toast,
    updateUserProfilePayload: uploadCall ? uploadCall.data : null
  }

  const problems = []
  if (probe.downloadFile.length) problems.push(`临时文件被拿去 downloadFile：${probe.downloadFile.join(', ')}`)
  if (!probe.uploadFile.length) problems.push('uploadFile 没有被调用，图根本没上传')
  else if (!probe.uploadFile.every(p => !/^https?:\/\//.test(p) || /^https?:\/\/tmp\//.test(p))) {
    problems.push(`上传的路径不是本地临时文件：${probe.uploadFile.join(', ')}`)
  }
  if (!uploadCall) problems.push('没有调用 updateUserProfile')
  else if (!/^cloud:\/\//.test(String(uploadCall.data.avatar || ''))) {
    problems.push(`提交给云函数的 avatar 不是 fileID：${uploadCall.data.avatar}`)
  }
  if (probe.toast.some(title => /失败|不存在|invalid|downloadFile/i.test(String(title)))) {
    problems.push(`出现失败提示：${probe.toast.join(' / ')}`)
  }

  result.ok = problems.length === 0
  result.problems = problems
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8')

  console.log('')
  console.log('downloadFile 调用次数:', probe.downloadFile.length, probe.downloadFile)
  console.log('uploadFile 收到的路径:', probe.uploadFile)
  console.log('提交给云函数的 avatar:', uploadCall ? uploadCall.data.avatar : '(未调用)')
  console.log('过程中的提示:', probe.toast)
  console.log('')

  if (problems.length) {
    console.error('验证失败：')
    problems.forEach(p => console.error('  - ' + p))
    process.exit(1)
  }
  console.log('验证通过：编辑资料页头像/背景图上传链路正常。')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
