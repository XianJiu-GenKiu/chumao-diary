/**
 * 出毛日记 · 第二轮：用真实数据 ID 打开详情页与搜索
 *
 * 第一轮里详情页都没有参数，只验证了"不崩"。这一轮先从云端取真实 _id，
 * 再带参数进入详情页，验证渲染与读取链路。全程只读，不写入任何数据。
 */
const fs = require('fs')
const path = require('path')
const automator = require('miniprogram-automator')

const WS = process.env.MP_WS || 'ws://127.0.0.1:9420'
const OUT = path.join(__dirname, '.e2e-detail.json')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 })
  console.log('已连接\n')

  // 1) 取真实 ID
  const ids = await mp.evaluate(() => Promise.all([
    wx.cloud.callFunction({ name: 'getLocations', data: { page: 1, pageSize: 3 } })
      .then(r => (r.result && r.result.data) || []).catch(() => []),
    wx.cloud.callFunction({ name: 'getPosts', data: { tab: 'recommend', page: 1, pageSize: 3 } })
      .then(r => (r.result && r.result.data) || []).catch(() => []),
    wx.cloud.callFunction({ name: 'getEvents', data: { page: 1, pageSize: 3 } })
      .then(r => (r.result && r.result.data) || []).catch(() => []),
    wx.cloud.callFunction({ name: 'xiaoju', data: { action: 'list' } })
      .then(r => (r.result && r.result.data) || []).catch(() => [])
  ]))

  const pick = (arr, key) => (Array.isArray(arr) ? arr : (arr && arr.list) || [])
  const locs = pick(ids[0]); const posts = pick(ids[1]); const events = pick(ids[2]); const xiaojus = pick(ids[3])
  console.log('真实数据：地点', locs.length, '| 动态', posts.length, '| 活动', events.length, '| 小聚', xiaojus.length)
  console.log('地点样例:', JSON.stringify(locs[0] || {}).slice(0, 220))
  console.log('动态样例:', JSON.stringify(posts[0] || {}).slice(0, 220), '\n')

  const results = []

  async function open(name, route, params) {
    const q = params ? '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : ''
    let row = { name, route, ok: false }
    try {
      await mp.reLaunch(`/${route}${q}`)
      await sleep(2600)
      const page = await mp.currentPage()
      const data = await page.data()
      row = {
        ...row, ok: true, actual: page.path,
        errorMessage: data.errorMessage || null,
        detailLoaded: !!(data.detail || data.location || data.post || data.event || data.item),
        title: (data.detail || data.location || data.post || data.event || data.item || {}).title
          || (data.detail || data.location || data.post || data.event || data.item || {}).name || null,
        commentCount: Array.isArray(data.comments) ? data.comments.length : undefined,
        reviewCount: Array.isArray(data.hotReviews) ? data.hotReviews.length : undefined,
        isEmpty: data.isEmpty === true,
        scalars: Object.fromEntries(Object.entries(data).filter(([k, v]) =>
          ['string', 'number', 'boolean'].includes(typeof v) &&
          /^(checkinCount|checkedIn|isFavorited|reactionUp|reactionDown|likeCount|rating|hasMore|isLoading)$/.test(k)))
      }
    } catch (e) { row.error = String(e && e.message || e) }
    results.push(row)
    console.log(`${row.ok ? 'OK  ' : 'FAIL'} ${name.padEnd(20)} err=${row.errorMessage || '-'} title=${row.title || '-'} ${row.error || ''}`)
  }

  // 2) 带真实 ID 打开详情页
  if (locs[0]) await open('地点详情(真实ID)', 'pages/location-detail/location-detail', { id: locs[0]._id || locs[0].id })
  if (posts[0]) await open('动态详情(真实ID)', 'pages/post-detail/post-detail', { id: posts[0]._id || posts[0].id })
  if (events[0]) await open('活动详情(真实ID)', 'pages/event-detail/event-detail', { id: events[0]._id || events[0].id })
  if (xiaojus[0]) await open('小聚详情(真实ID)', 'pages/xiaoju-detail/xiaoju-detail', { id: xiaojus[0]._id || xiaojus[0].id })
  if (locs[0] && locs[0].latitude) {
    await open('附近服务(带坐标)', 'pages/nearby-services/nearby-services',
      { lat: locs[0].latitude, lng: locs[0].longitude, id: locs[0]._id || locs[0].id, name: locs[0].title || locs[0].name })
  }

  // 3) 搜索链路（真实关键词）
  await open('搜索页', 'pages/search/search')
  const search = await mp.evaluate(() => wx.cloud.callFunction({
    name: 'suggestPlaces', data: { keyword: '公园', region: '贵阳' }
  }).then(r => r.result).catch(e => ({ errMsg: String(e) })))
  console.log('suggestPlaces(公园/贵阳):', JSON.stringify(search).slice(0, 300))

  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), ids: { locs: locs.length, posts: posts.length, events: events.length, xiaojus: xiaojus.length }, results, search }, null, 2), 'utf8')
  console.log('\n明细:', OUT)
  await mp.disconnect()
  process.exit(0)
}

main().catch(e => { console.error('失败:', e && e.stack || e); process.exit(1) })
