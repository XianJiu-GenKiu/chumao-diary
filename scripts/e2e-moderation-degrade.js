// 审核降级放行验证（分步模式，避免单次 evaluate 超时 & 客户端读权限限制）
//   node scripts/e2e-moderation-degrade.js create   → 建动态 + 建地点（含真实上传图片），落盘 id，不删除
//   node scripts/e2e-moderation-degrade.js cleanup  → 按落盘的 id 清理动态 / 地点 / 探针图片
// 中间由外部（CloudBase 云端通道）核对落库的 moderationStatus。
const fs = require('fs')
const path = require('path')
const automator = require('miniprogram-automator')

const STATE = path.join(__dirname, '.moderation-probe.json')
const mode = (process.argv[2] || 'create').toLowerCase()

;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420', timeout: 30000 })

  if (mode === 'create') {
    const created = await mp.evaluate(async () => {
      const call = (name, data) => new Promise(resolve => {
        wx.cloud.callFunction({
          name, data: data || {},
          success: r => resolve({ ok: true, result: r.result }),
          fail: e => resolve({ ok: false, errMsg: String((e && (e.errMsg || e.message)) || e) })
        })
      })

      // 造一张极小的真实 PNG 并上传，用于触发图片审核链路
      const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      const fsm = wx.getFileSystemManager()
      const localPath = wx.env.USER_DATA_PATH + '/moderation-probe-' + Date.now() + '.png'
      let fileID = ''
      try {
        await new Promise((res, rej) => fsm.writeFile({
          filePath: localPath, data: pngB64, encoding: 'base64', success: res, fail: rej
        }))
        const up = await wx.cloud.uploadFile({
          cloudPath: 'probe/moderation-' + Date.now() + '.png', filePath: localPath
        })
        fileID = up.fileID
      } catch (e) {
        return { fileUploadError: String((e && (e.errMsg || e.message)) || e) }
      }

      const p = await call('post-create', {
        content: '【探针】审核降级可见性验证，请忽略（稍后自动删除）',
        images: [fileID], tags: []
      })
      const l = await call('addLocation', {
        name: '【探针】测试地点请忽略',
        category: 'other',
        description: '探针用，稍后自动删除',
        tags: [],
        latitude: 26.647,
        longitude: 106.63,
        address: '探针地址',
        images: [fileID]
      })
      return { fileID, post: p, location: l }
    })

    const postId = created.post && created.post.ok && created.post.result && created.post.result.data && created.post.result.data.postId
    const locationId = created.location && created.location.ok && created.location.result && created.location.result.data && created.location.result.data.locationId
    fs.writeFileSync(STATE, JSON.stringify({ postId, locationId, fileID: created.fileID }, null, 2))
    console.log('① 创建结果:')
    console.log(JSON.stringify(created, null, 2))
    console.log('\n落盘:', STATE)
  } else {
    const state = JSON.parse(fs.readFileSync(STATE, 'utf8'))
    const cleaned = await mp.evaluate(async (s) => {
      const call = (name, data) => new Promise(resolve => {
        wx.cloud.callFunction({
          name, data: data || {},
          success: r => resolve({ ok: true, result: r.result }),
          fail: e => resolve({ ok: false, errMsg: String((e && (e.errMsg || e.message)) || e) })
        })
      })
      const res = {}
      if (s.postId) res.post = await call('deleteContent', { contentType: 'post', contentId: s.postId })
      if (s.locationId) res.location = await call('deleteContent', { contentType: 'location', contentId: s.locationId })
      if (s.fileID) {
        try { await wx.cloud.deleteFile({ fileList: [s.fileID] }); res.file = 'deleted' }
        catch (e) { res.file = String((e && (e.errMsg || e.message)) || e) }
      }
      return res
    }, state)
    console.log('③ 清理结果:')
    console.log(JSON.stringify(cleaned, null, 2))
    try { fs.unlinkSync(STATE) } catch (e) {}
  }

  await mp.disconnect()
})().catch(e => { console.error(String(e && e.stack || e)); process.exit(1) })
