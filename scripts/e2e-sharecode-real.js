// 定向探针：只验证 generateShareCode（云调用 openapi.wxacode.getUnlimited）。
// 与 e2e-openapi-probe.js 的区别：不写任何业务数据（不测试 post-create），
// 用真实地点的 _id 作 scene，生成的小程序码是「真实地点分享卡」而非测试垃圾。
//
// 用法：NODE_PATH=... node scripts/e2e-sharecode-real.js
const automator = require('miniprogram-automator')

;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420', timeout: 30000 })

  const result = await mp.evaluate(async () => {
    const call = (name, data) => new Promise(resolve => {
      wx.cloud.callFunction({
        name,
        data: data || {},
        success: r => resolve({ ok: true, result: r.result }),
        fail: e => resolve({ ok: false, errMsg: String((e && (e.errMsg || e.message)) || e) })
      })
    })

    const out = {}

    // 1) 取一个真实地点作为 scene 来源（不产生任何写入）
    const locs = await call('getLocations', { page: 1, pageSize: 1 })
    const list = (locs.ok && locs.result && locs.result.data) || []
    out.getLocations = {
      ok: locs.ok,
      code: locs.ok ? locs.result && locs.result.code : undefined,
      count: list.length,
      firstId: list[0] && list[0]._id
    }

    const scene = out.getLocations.firstId
    if (!scene) { out.note = '无可用地点，跳过小程序码测试'; return out }

    // 2) 场所码
    const r1 = await call('generateShareCode', {
      page: 'pages/location-detail/location-detail',
      scene
    })
    out.locationCode = r1

    // 3) 活动码（同一页面白名单外的另一种 page，验证 page 参数分支）
    const r2 = await call('generateShareCode', {
      page: 'pages/event-detail/event-detail',
      scene
    })
    out.eventCode = r2

    // 4) 参数校验分支（应返回 code:-1，不应触达 openapi）
    const r3 = await call('generateShareCode', { page: 'pages/index/index', scene })
    out.invalidPage = r3

    return out
  })

  console.log(JSON.stringify(result, null, 2))
  await mp.disconnect()

  const ok = result.locationCode && result.locationCode.ok &&
    result.locationCode.result && result.locationCode.result.code === 0
  console.log(ok ? '\n[PASS] 小程序码生成成功' : '\n[FAIL] 小程序码仍未恢复')
  process.exit(ok ? 0 : 1)
})().catch(e => { console.error(String(e && e.stack || e)); process.exit(1) })
