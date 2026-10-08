/**
 * LBS 改造 + 拉黑能力 端到端验证探针
 *
 * 用法：
 *   node scripts/e2e-lbs-verify.js            # 只读探针（无副作用）
 *
 * 覆盖四项改造中可只读验证的三项：
 *   1. getCityCandidates 空集合兜底（source 应为 builtin 或 collection）
 *   2. getWeather 真实数据 / 失败时降级为 data:null（绝不返回假数据）
 *   3. planRoute 返回真实路网距离与 polyline（对比直线距离）
 *   4. blockUser 读路径（status / list）
 * 拉黑过滤的写入路径见 scripts/e2e-block-filter.js（需配合注入的探针文档）。
 *
 * 跑法：
 *   NODE_PATH=C:/Users/123/.workbuddy/binaries/node/workspace/node_modules node scripts/e2e-lbs-verify.js
 */
const automator = require('miniprogram-automator')

const WS = 'ws://127.0.0.1:9420'
const TIANANMEN = { latitude: 39.908722, longitude: 116.397499 }
const AIRPORT = { latitude: 40.0799, longitude: 116.6031 }

function haversine(a, b) {
  const R = 6371000
  const rad = d => (d * Math.PI) / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLng = rad(b.longitude - a.longitude)
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(s)))
}

const results = []
function check(name, pass, detail) {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

;(async () => {
  const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 })

  const call = async (name, data) => mp.evaluate(
    (fn, payload) => new Promise(res => {
      wx.cloud.callFunction({
        name: fn, data: payload,
        success: x => res({ ok: true, result: x.result }),
        fail: e => res({ ok: false, errMsg: String(e && (e.errMsg || e.message)) })
      })
    }), name, data || {}
  )

  // ── 1. getCityCandidates ──
  const cities = await call('getCityCandidates', {})
  if (!cities.ok) {
    check('getCityCandidates 调用成功', false, cities.errMsg)
  } else {
    const r = cities.result || {}
    const list = Array.isArray(r.data) ? r.data : (r.data && r.data.list) || []
    check('getCityCandidates 调用成功', r.code === 0, `code=${r.code} source=${r.source}`)
    check('getCityCandidates 返回非空城市表', list.length >= 40, `count=${list.length}`)
    check('getCityCandidates 声明了数据来源', r.source === 'collection' || r.source === 'builtin', `source=${r.source}`)
  }

  // ── 2. getWeather ──
  const w = await call('getWeather', { latitude: TIANANMEN.latitude, longitude: TIANANMEN.longitude, city: '北京' })
  if (!w.ok) {
    check('getWeather 调用成功', false, w.errMsg)
  } else {
    const r = w.result || {}
    check('getWeather 调用成功', r.code === 0, `code=${r.code}`)
    const d = r.data
    if (d) {
      // 有数据：必须是真实值，且不能出现「假数据兜底」的特征
      const tempOk = typeof d.temperature === 'number' && d.temperature > -60 && d.temperature < 60
      check('getWeather 有数据时温度是合理数值', tempOk, `temperature=${d.temperature}`)
    } else {
      // 无数据：必须显式降级，而不是编造
      check('getWeather 无数据时显式降级', r.degraded === true, `degraded=${r.degraded} reason=${r.reason}`)
    }
    // 无论哪条路径，都不允许出现曾被移除的硬编码假数据特征
    const looksFake = d && d.temperature === 28 && d.humidity === 65 && d.weather === '晴'
    check('getWeather 未回退到已删除的假数据(28℃/晴/65%)', !looksFake, JSON.stringify(d || null).slice(0, 120))
  }

  // ── 3. planRoute ──
  const straight = haversine(TIANANMEN, AIRPORT)
  const p = await call('planRoute', {
    mode: 'driving',
    points: [TIANANMEN, AIRPORT]
  })
  if (!p.ok) {
    check('planRoute 调用成功', false, p.errMsg)
  } else {
    const r = p.result || {}
    check('planRoute 调用成功', r.code === 0, `code=${r.code}`)
    const d = r.data
    if (d && !r.degraded) {
      const poly = d.polyline || d.points || []
      check('planRoute 返回 polyline 顶点', Array.isArray(poly) && poly.length > 2, `vertices=${Array.isArray(poly) ? poly.length : 'n/a'}`)
      check('planRoute 距离 >= 直线距离', typeof d.distance === 'number' && d.distance >= straight,
        `路网=${d.distance}m 直线=${straight}m 比值=${d.distance ? (d.distance / straight).toFixed(2) : '-'}`)
      check('planRoute 返回耗时', typeof d.duration === 'number' && d.duration > 0, `duration=${d.duration}s`)
    } else {
      check('planRoute 失败时显式降级', r.degraded === true, `degraded=${r.degraded} reason=${r.reason || d}`)
    }
  }

  // ── 4. blockUser 读路径 ──
  const st = await call('blockUser', { action: 'status', targetOpenId: 'probe__nonexistent__openid' })
  if (!st.ok) {
    check('blockUser status 调用成功', false, st.errMsg)
  } else {
    const r = st.result || {}
    check('blockUser status 调用成功', r.code === 0, `code=${r.code}`)
    check('blockUser status 对未拉黑返回 false', r.data === false || (r.data && r.data.blocked === false),
      JSON.stringify(r.data))
  }
  const ls = await call('blockUser', { action: 'list' })
  if (!ls.ok) {
    check('blockUser list 调用成功', false, ls.errMsg)
  } else {
    const r = ls.result || {}
    const arr = Array.isArray(r.data) ? r.data : (r.data && r.data.list) || []
    check('blockUser list 返回数组', r.code === 0 && Array.isArray(arr), `code=${r.code} count=${arr.length}`)
  }

  await mp.disconnect()

  const failed = results.filter(r => !r.pass)
  console.log('\n──────────────────────────────')
  console.log(`共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
  if (failed.length) {
    console.log('失败项：')
    failed.forEach(f => console.log(`  - ${f.name} ${f.detail || ''}`))
  }
  process.exit(failed.length ? 1 : 0)
})().catch(e => { console.error(String((e && e.stack) || e)); process.exit(1) })
