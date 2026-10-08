/**
 * 临时探针：新功能运行时端到端验证
 *  1) 我的-数据栏点击跳转（发布/关注/粉丝/获赞/收藏）
 *  2) 动态 / 收藏 的删除入口（真实云函数，测试数据自建自删）
 * 用法：NODE_PATH=<workspace>/node_modules node scripts/tmp-e2e-profile-features.js
 */
const automator = require('miniprogram-automator')
const WS = process.env.MP_WS || 'ws://127.0.0.1:9420'
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 })
  const problems = []

  // ── 准备：刷新登录态 + 造一条测试动态 + 造一条测试收藏 ──
  const setup = await mp.evaluate(async () => {
    const app = getApp()
    try { const lr = await app.callCloud('login', {}); if (lr && lr.data) app.setLoggedInUser(lr.data) } catch (e) {}
    const post = await app.callCloud('post-create', {
      content: '自动化测试动态-可安全删除 ' + Date.now(),
      images: [],
      visibility: 'public'
    })
    const locs = await app.callCloud('getLocations', { page: 1, pageSize: 20 })
    const list = (locs && locs.data) || []
    // 挑一个「当前未收藏」的地点，收藏后用于验证取消收藏（结束会还原）
    let favTarget = null
    for (const loc of list) {
      const detail = await app.callCloud('getLocationDetail', { locationId: loc._id })
      if (detail && detail.code === 0 && detail.data && detail.data.isFavorited === false) {
        favTarget = loc._id
        break
      }
    }
    return {
      postRes: { code: post && post.code, message: post && post.message, postId: post && post.data && post.data.postId },
      favTarget,
      openId: app.globalData.openId,
      commentCount: list.length
    }
  })
  console.log('准备结果:', JSON.stringify(setup, null, 2))
  const postId = setup.postRes.postId
  if (!postId) { console.error('测试动态创建失败，终止'); await mp.disconnect(); process.exit(1) }

  let favoriteId = null
  if (setup.favTarget) {
    const fav = await mp.evaluate(async (id) => {
      const app = getApp()
      const r = await app.callCloud('toggleFavorite', { targetId: id, targetType: 'location' })
      return { code: r && r.code, favorited: r && r.data && r.data.favorited }
    }, setup.favTarget)
    console.log('预置收藏:', JSON.stringify(fav))
    if (fav.code === 0 && fav.favorited === true) favoriteId = setup.favTarget
  } else {
    problems.push('没有可用的未收藏地点，跳过了收藏相关验证')
  }

  // ── 打开「我的」 ──
  await mp.reLaunch('/pages/profile/profile')
  await sleep(3500)
  const page = await mp.currentPage()
  console.log('当前页:', page.path)

  // 安装拦截面板 + 记录 toast
  await mp.evaluate(() => {
    globalThis.__f = { toasts: [], modals: [] }
    const rawToast = wx.showToast
    wx.showToast = o => { globalThis.__f.toasts.push(o && o.title); return rawToast.call(wx, o) }
    wx.showModal = o => {
      globalThis.__f.modals.push({ title: o.title, content: o.content, confirmText: o.confirmText })
      if (o.success) o.success({ confirm: true, cancel: false })
    }
    wx.showLoading = () => {}
    wx.hideLoading = () => {}
  })

  // ── 1. 数据栏点击跳转 ──
  const nav = async (key) => {
    await page.callMethod('onStatsTap', { currentTarget: { dataset: { key } } })
    await sleep(1200)
    const stack = await mp.evaluate(() => getCurrentPages().map(p => p.route))
    return stack
  }

  const stackFollowing = await nav('following')
  console.log('关注 →', JSON.stringify(stackFollowing))
  if (!stackFollowing.includes('pages/follow-list/follow-list')) problems.push('「关注」没有跳转到名单页')
  await mp.evaluate(() => { const p = getCurrentPages(); if (p.length > 1) wx.navigateBack() })
  await sleep(900)

  const stackFollowers = await nav('followers')
  console.log('粉丝 →', JSON.stringify(stackFollowers))
  if (!stackFollowers.includes('pages/follow-list/follow-list')) problems.push('「粉丝」没有跳转到名单页')
  const followListData = await mp.evaluate(() => {
    const p = getCurrentPages()
    const pg = p[p.length - 1]
    return { route: pg.route, type: pg.data.type, targetOpenId: pg.data.targetOpenId, total: pg.data.total }
  })
  console.log('名单页数据:', JSON.stringify(followListData))
  if (followListData.type !== 'followers') problems.push('粉丝名单页 type 参数不对')
  if (followListData.targetOpenId !== (setup.openId || '')) problems.push('粉丝名单页 openId 参数不对')
  await mp.evaluate(() => { const p = getCurrentPages(); if (p.length > 1) wx.navigateBack() })
  await sleep(900)

  const stackLike = await nav('like')
  console.log('获赞 →', JSON.stringify(stackLike))
  if (!stackLike.includes('pages/messages/messages')) problems.push('「获赞」没有跳转到消息页')
  const msgTab = await mp.evaluate(() => {
    const p = getCurrentPages(); const pg = p[p.length - 1]
    return { route: pg.route, currentTab: pg.data.currentTab }
  })
  console.log('消息页:', JSON.stringify(msgTab))
  if (msgTab.currentTab !== 'like') problems.push('消息页没有落到「赞」分类')
  await mp.evaluate(() => { const p = getCurrentPages(); if (p.length > 1) wx.navigateBack() })
  await sleep(900)

  // 发布 / 收藏 切本页 tab
  await page.callMethod('onStatsTap', { currentTarget: { dataset: { key: 'post' } } })
  await sleep(900)
  const afterPost = await page.data()
  console.log('发布 → 当前 tab:', afterPost.activeTab)
  if (afterPost.activeTab !== 'dynamic') problems.push('「发布」没有切到动态 tab')
  const hasTestPost = (afterPost.dynamicList || []).some(i => i._id === postId)
  console.log('动态列表是否包含测试动态:', hasTestPost)
  if (!hasTestPost) problems.push('动态列表里找不到刚创建的测试动态')

  // ── 2. 动态删除 ──
  await page.callMethod('onDeleteTap', { currentTarget: { dataset: { type: 'dynamic', id: postId } } })
  await sleep(3000)
  const afterDelete = await page.data()
  const stillThere = (afterDelete.dynamicList || []).some(i => i._id === postId)
  console.log('删除后动态列表仍包含该条:', stillThere, '| postCount =', afterDelete.stats && afterDelete.stats.postCount)
  if (stillThere) problems.push('删除后列表里仍然有该动态')
  const dbCheck = await mp.evaluate(async (id) => {
    const app = getApp()
    const r = await app.callCloud('post-detail', { postId: id })
    return { code: r && r.code, message: r && r.message }
  }, postId)
  console.log('云端回查该动态:', JSON.stringify(dbCheck))
  if (dbCheck.code === 0) problems.push('云端仍能读到已删除的动态')

  // ── 3. 收藏取消 ──
  if (favoriteId) {
    await page.callMethod('onStatsTap', { currentTarget: { dataset: { key: 'favorite' } } })
    await sleep(2500)
    const favTabData = await page.data()
    const inFav = (favTabData.favoriteList || []).some(i => i._id === favoriteId)
    console.log('收藏 tab:', favTabData.activeTab, '| 含预置收藏:', inFav, '| 共', (favTabData.favoriteList || []).length)
    if (!inFav) problems.push('收藏列表里找不到预置的收藏')

    await page.callMethod('onDeleteTap', { currentTarget: { dataset: { type: 'favorite', id: favoriteId } } })
    await sleep(3000)
    const afterFav = await page.data()
    const stillFav = (afterFav.favoriteList || []).some(i => i._id === favoriteId)
    console.log('取消收藏后列表仍包含:', stillFav, '| favoriteCount =', afterFav.stats && afterFav.stats.favoriteCount)
    if (stillFav) problems.push('取消收藏后列表里仍然有该地点')
    const favDb = await mp.evaluate(async (id) => {
      const app = getApp()
      const r = await app.callCloud('getLocationDetail', { locationId: id })
      return { code: r && r.code, isFavorited: r && r.data && r.data.isFavorited }
    }, favoriteId)
    console.log('云端回查收藏状态:', JSON.stringify(favDb))
    if (favDb.isFavorited === true) problems.push('云端仍显示已收藏')
  }

  const rec = await mp.evaluate(() => globalThis.__f)
  console.log('\n弹窗:', JSON.stringify(rec.modals))
  console.log('提示:', JSON.stringify(rec.toasts))

  // ── 兜底清理：确保测试动态被删除 ──
  await mp.evaluate(async (id) => {
    const app = getApp()
    await app.callCloud('deleteContent', { contentType: 'post', contentId: id })
  }, postId)

  await mp.disconnect()
  console.log('\n================ 结论 ================')
  if (problems.length) { problems.forEach(p => console.error('  ✗ ' + p)); process.exit(1) }
  console.log('  全部通过 ✓')
}
main().catch(e => { console.error('失败:', e && (e.stack || e)); process.exit(1) })
