/**
 * 出毛日记 · 详情页「列表接力」降级验证
 *
 * 背景：线上 post-detail 云函数因为依赖的 likes 集合缺失而整页失败，
 * 用户从列表点进详情只能看到报错页——可列表里明明已经有这条动态的数据。
 * 本脚本验证新加的「接力」逻辑是否真的生效：
 *
 *   1. 打开「动态」Tab，确认列表里有数据
 *   2. 触发第一张卡片的点击（走真实 onPostTap）
 *   3. 断言详情页渲染出了正文，而不是报错页
 *   4. 打印 staleNotice（若有），说明是降级渲染
 *
 * 用法：node scripts/e2e-detail-cache.js
 * 前置：开发者工具已开服务端口 + /v2/auto 已开自动化端口 9420
 */
const fs = require('fs')
const path = require('path')

const WS = process.env.MP_WS || 'ws://127.0.0.1:9420'
const OUT = path.join(__dirname, '.e2e-detail-cache.json')

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

  const log = []

  // 1. 打开动态 Tab
  let page = await mp.reLaunch('/pages/posts/posts')
  await sleep(3500)
  page = await mp.currentPage()
  const postList = (await page.data()) && (await page.data()).postList
  console.log(`列表条数: ${postList ? postList.length : 0}`)
  if (!postList || !postList.length) {
    console.error('列表为空，无法验证（需要至少有 1 条动态）')
    fs.writeFileSync(OUT, JSON.stringify({ ok: false, reason: 'empty list' }, null, 2), 'utf8')
    await mp.disconnect()
    process.exit(1)
  }

  const target = postList[0]
  console.log(`目标动态: ${target._id}`)
  console.log(`  正文前 40 字: ${String(target.content || '').slice(0, 40)}`)

  // 2. 走真实点击分支（onPostTap 会先 app.setPostCache 再 navigateTo）
  await page.callMethod('onPostTap', { currentTarget: { dataset: { id: target._id } } })
  await sleep(4000)

  page = await mp.currentPage()
  const route = page.path
  const data = await page.data()
  const post = data && data.post

  const result = {
    route,
    hasPost: !!post,
    postId: post && post._id,
    contentLen: post ? String(post.content || '').length : 0,
    loadError: data && data.loadError,
    staleNotice: data && data.staleNotice,
    passed: route === 'pages/post-detail/post-detail' && !!post && !(data && data.loadError)
  }

  console.log('\n=== 结果 ===')
  console.log(`落地页: ${route}`)
  console.log(`渲染出正文: ${result.hasPost ? '是' : '否'}（${result.contentLen} 字）`)
  console.log(`报错页: ${result.loadError ? '有 → ' + result.loadError : '无'}`)
  console.log(`降级提示: ${result.staleNotice || '（无，说明云端互动状态也拿到了）'}`)
  console.log(`判定: ${result.passed ? '✅ 通过 —— 详情页在云端异常时仍可阅读' : '❌ 未通过'}`)

  log.push(result)
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), results: log }, null, 2), 'utf8')
  console.log('\n明细:', OUT)

  await mp.disconnect()
  process.exit(result.passed ? 0 : 2)
}

main().catch(e => { console.error('失败:', (e && e.stack) || e); process.exit(1) })
