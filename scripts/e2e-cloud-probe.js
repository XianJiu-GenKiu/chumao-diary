/**
 * 出毛日记 · 云函数连通性探测
 *
 * 在开发者工具的运行时里直接逐个调用云函数，辨别三类状态：
 *   - 函数未部署        → errMsg 含 -501000 / FUNCTION_NOT_FOUND
 *   - 函数在但依赖缺集合 → result.code !== 0 且 message 含 collection / not exists
 *   - 正常              → result.code === 0
 *
 * 用法：node scripts/e2e-cloud-probe.js
 */
const fs = require('fs')
const path = require('path')
const automator = require('miniprogram-automator')

const WS = process.env.MP_WS || 'ws://127.0.0.1:9420'
const OUT = path.join(__dirname, '.e2e-cloud.json')

const CALLS = [
  ['login', {}],
  ['getPosts', { tab: 'recommend', page: 1, pageSize: 2 }],
  ['getLocations', { page: 1, pageSize: 2 }],
  ['getEvents', { page: 1, pageSize: 2 }],
  ['getLeaderboard', {}],
  ['getSeasonalLocations', {}],
  ['getMessages', { page: 1, pageSize: 2 }],
  ['getFollowList', { page: 1, pageSize: 2 }],
  ['getUserStats', {}],
  ['getUserContent', { tab: 'dynamic', page: 1, pageSize: 2 }],
  ['getUserPublicContent', { targetOpenId: 'oXXXXXXXXXXXXXXXXXXXXXXXXXXX', page: 1, pageSize: 2 }],
  ['manageCollections', { action: 'list' }],
  ['manageReports', { action: 'list', page: 1, pageSize: 1 }],
  ['getWeather', { latitude: 26.647, longitude: 106.63 }],
  ['getCityByLocation', { latitude: 26.647, longitude: 106.63 }],
  ['getCityCandidates', { latitude: 26.647, longitude: 106.63 }],
  ['getNearbyMapPoi', { latitude: 26.647, longitude: 106.63 }],
  ['suggestPlaces', { keyword: '公园', region: '贵阳' }],
  ['getTagContent', { tag: '外景', page: 1, pageSize: 2 }],
  ['getLocationDetail', { locationId: 'not-a-real-id' }],
  ['getEventDetail', { id: 'not-a-real-id' }],
  ['post-detail', { postId: 'not-a-real-id' }],
  ['checkEventJoined', { eventId: 'not-a-real-id' }],
  ['checkInLocation', { locationId: 'not-a-real-id' }],
  ['generateShareCode', { page: 'pages/location-detail/location-detail', scene: 'abcdefghijklmnop1234567890abcdef' }],
  ['toggleFavorite', { targetId: 'not-a-real-id', targetType: 'location' }],
  ['toggleReaction', { targetId: 'not-a-real-id', targetType: 'location', reactionType: 'up' }],
  ['rateLocation', { locationId: 'not-a-real-id', rating: 5 }],
  ['reportContent', { targetId: 'not-a-real-id', targetType: 'post', reason: '测试' }],
  ['submitFeedback', { content: '自动化连通性探测' }],
  ['trackEvent', { name: 'content_view', payload: {} }],
  ['xiaoju', { action: 'list' }]
]

async function main() {
  const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 })
  console.log('已连接，开始探测', CALLS.length, '个云函数\n')

  const results = []
  for (const [name, data] of CALLS) {
    let out
    try {
      const r = await mp.evaluate(
        (fnName, fnData) => wx.cloud.callFunction({ name: fnName, data: fnData })
          .then(res => ({ ok: true, result: res && res.result }))
          .catch(err => ({
            ok: false,
            errMsg: String(err && (err.errMsg || err.message) || err),
            errCode: err && err.errCode
          })),
        name, data
      )
      out = r
    } catch (e) {
      out = { ok: false, errMsg: 'evaluate 失败: ' + String(e && e.message || e) }
    }

    let verdict = 'OK'
    if (!out.ok) {
      if (/-501000|FUNCTION_NOT_FOUND|函数未找到|not found/i.test(out.errMsg || '')) verdict = '未部署'
      else verdict = '调用异常'
    } else {
      const res = out.result || {}
      if (res.code !== 0) {
        if (/collection|not exists|集合/i.test(res.message || res.error || '')) verdict = '缺集合'
        else verdict = '业务错误'
      }
    }
    const detail = out.ok
      ? `code=${out.result && out.result.code} msg=${(out.result && (out.result.message || out.result.error)) || '-'}`
      : `err=${out.errMsg}`
    console.log(`${verdict.padEnd(8)} ${name.padEnd(22)} ${detail}`)
    results.push({ name, verdict, ...out })
  }

  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), 'utf8')
  const byVerdict = results.reduce((m, r) => (m[r.verdict] = (m[r.verdict] || 0) + 1, m), {})
  console.log('\n=== 汇总 ===', JSON.stringify(byVerdict))
  console.log('明细:', OUT)

  await mp.disconnect()
  process.exit(0)
}

main().catch(e => { console.error('失败:', e && e.stack || e); process.exit(1) })
