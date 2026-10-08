// 真实运行时探测：小程序端 wx.cloud.callFunction（带微信云调用上下文）
// 与云端控制面 invoke 不同，可以分辨 -604101（权限未声明）/-501001（上下文缺失误报）
const automator = require('miniprogram-automator')

;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420', timeout: 30000 })

  const result = await mp.evaluate(async () => {
    const out = {}
    const call = (name, data) => new Promise(resolve => {
      wx.cloud.callFunction({
        name,
        data: data || {},
        success: r => resolve({ ok: true, result: r.result }),
        fail: e => resolve({ ok: false, errMsg: String((e && (e.errMsg || e.message)) || e) })
      })
    })

    // 1) 小程序码（云调用 openapi.wxacode.getUnlimited）
    const r1 = await call('generateShareCode', {
      page: 'pages/location-detail/location-detail',
      scene: 'abcdefghijklmnop1234567890abcdef'
    })
    out.generateShareCode = r1

    // 2) 内容安全（云调用 openapi.security.msgSecCheck）—— 同一类云调用能力
    const r2 = await call('post-create', {
      content: '连通性探测用文本，请忽略',
      images: [],
      _probe: true
    })
    out.postCreate = r2

    // 3) 普通业务函数（对照组，不依赖云调用）
    const r3 = await call('getPosts', { tab: 'recommend', page: 1, pageSize: 1 })
    out.getPosts = r3

    return out
  })

  console.log(JSON.stringify(result, null, 2))
  await mp.disconnect()
})().catch(e => { console.error(String(e && e.stack || e)); process.exit(1) })
