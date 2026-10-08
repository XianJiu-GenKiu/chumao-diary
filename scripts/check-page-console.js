/**
 * 出毛日记 · 指定页面控制台告警排查 / 云函数直调排查
 *
 * 两种用法：
 *
 * 1) 打开某个页面，收集 N 秒内的 console 告警与错误
 *    node scripts/check-page-console.js <页面路径> [query] [毫秒]
 *    例：node scripts/check-page-console.js pages/location-detail/location-detail "id=4a9432..."
 *
 * 2) 直接调用一个云函数，打印原始返回 / 原始报错（用来区分
 *    「云函数本身失败」和「前端超时」）
 *    node scripts/check-page-console.js --fn <云函数名> '<JSON参数>'
 *    例：node scripts/check-page-console.js --fn getEvents '{"page":1,"pageSize":10,"status":"upcoming"}'
 */
const automator = require('miniprogram-automator')

const WS = process.env.MP_WS || 'ws://127.0.0.1:9420'

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function callCloud(mp, fnName, data) {
  const started = Date.now()
  const out = await mp.evaluate(
    (name, payload) => wx.cloud.callFunction({ name, data: payload })
      .then(res => ({ ok: true, result: res && res.result }))
      .catch(err => ({
        ok: false,
        errMsg: String((err && (err.errMsg || err.message)) || err),
        errCode: err && err.errCode
      })),
    fnName, data
  )
  const ms = Date.now() - started
  console.log(`云函数: ${fnName}`)
  console.log(`参数: ${JSON.stringify(data)}`)
  console.log(`耗时: ${ms}ms`)
  console.log(`结果: ${JSON.stringify(out, null, 2)}`)
  // 客户端 callCloud 的超时是 10s；超过就是前端超时，不是云函数报错
  if (ms > 9500) console.log('⚠️ 接近/超过前端 10s 超时阈值')
  return out
}

async function main() {
  const argv = process.argv.slice(2)

  if (argv[0] === '--fn') {
    const fnName = argv[1]
    const data = argv[2] ? JSON.parse(argv[2]) : {}
    if (!fnName) {
      console.error('用法: node scripts/check-page-console.js --fn <云函数名> \'<JSON参数>\'')
      process.exit(1)
    }
    const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 })
    const out = await callCloud(mp, fnName, data)
    await mp.disconnect()
    process.exit(out.ok && out.result && out.result.code === 0 ? 0 : 2)
  }

  const pagePath = argv[0]
  const query = argv[1] || ''
  const waitMs = Number(argv[2]) || 6000

  if (!pagePath) {
    console.error('用法: node scripts/check-page-console.js <页面路径> [query] [毫秒]')
    process.exit(1)
  }

  const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 })
  const seen = []
  mp.on('console', msg => {
    const level = msg.level || 'log'
    if (level === 'warn' || level === 'error') {
      const text = (msg.args || []).map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
      seen.push(`[${level}] ${text}`)
    }
  })

  const cleanPath = pagePath.startsWith('/') ? pagePath : '/' + pagePath
  const url = query ? `${cleanPath}?${query}` : cleanPath
  await mp.reLaunch(url)
  await sleep(waitMs)

  const page = await mp.currentPage()
  console.log(`落地页: ${page.path}`)
  console.log(`等待 ${waitMs}ms 内的告警/错误: ${seen.length} 条`)
  seen.forEach(s => console.log('  ' + s))

  await mp.disconnect()
  process.exit(seen.length ? 2 : 0)
}

main().catch(e => { console.error('失败:', (e && e.stack) || e); process.exit(1) })
