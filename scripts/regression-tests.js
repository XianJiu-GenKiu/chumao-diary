const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

function loadPage(relative, app) {
  let definition
  vm.runInNewContext(read(relative), {
    Page: value => { definition = value },
    getApp: () => app,
    require: () => ({ uploadImages: async () => [] }),
    wx: { showLoading() {}, hideLoading() {}, showToast() {}, navigateBack() {} },
    setTimeout() {}
  }, { filename: relative })
  return definition
}

async function main() {
  // 注意：原本这里断言 pages/event-create 的 _toTimestamp。
  // 公开展示型降级（release/display）已删除活动/帖子等 UGC 页面，相关断言同步移除 ——
  // 保留会 ENOENT，且测的是已下线的能力。云函数侧的校验见下方 createEvent/getEvents。
  // 云函数统一用 { code, message } 契约，这里此前写成了 msg:，断言早已过期。
  assert.match(read('cloudfunctions/createEvent/index.js'), /if \(!endTime\) return \{ code: -2, message: '请选择结束时间' \}/)

  const item = { name: '测试地点', category: '公园绿地', facilities: [{ key: 'changing' }, 'restroom'] }
  const locationPage = loadPage('pages/location-upload/location-upload.js', {
    globalData: {},
    callCloud: async () => ({ data: item })
  })
  const pageState = JSON.parse(JSON.stringify(locationPage.data))
  const pageContext = {
    data: pageState,
    setData(update) { Object.assign(this.data, update) }
  }
  await locationPage._loadForEdit.call(pageContext, 'location-id')
  assert.equal(pageContext.data.facilityOptions.find(option => option.key === 'changing').checked, true)
  assert.equal(pageContext.data.facilityOptions.find(option => option.key === 'restroom').checked, true)

  const updateSource = read('cloudfunctions/updateContent/index.js')
  assert.match(updateSource, /if \(!updateData\.location\) \{\s*updateData\.latitude = null\s*updateData\.longitude = null/s)
  assert.match(updateSource, /updateData\.geoLocation = null/)
  assert.match(read('cloudfunctions/post-create/index.js'), /new db\.Geo\.Point\(longitude, latitude\)/)
  assert.match(read('cloudfunctions/getPosts/index.js'), /geoLocation: _\.geoNear/)
  assert.match(read('cloudfunctions/manageReports/index.js'), /action === 'backfillPostGeo'/)
  const pageFiles = fs.readdirSync(path.join(root, 'pages'), { recursive: true })
    .filter(file => file.endsWith('.wxml'))
  for (const file of pageFiles) {
    const source = fs.readFileSync(path.join(root, 'pages', file), 'utf8')
    assert.ok(!source.includes('/images/default-avatar.png'), `${file} still references the missing default avatar`)
  }
  assert.match(read('cloudfunctions/getEvents/index.js'), /query\.endTime = _\.gt\(now\)/)
  assert.match(read('cloudfunctions/getEvents/index.js'), /!Number\.isFinite\(endAt\) && event\.status === 'ended'/)
  assert.match(read('cloudfunctions/joinEvent/index.js'), /endAt <= now/)
  // 原「pages/post-create/post-create.wxml 含『仅自己可见』」的断言随 UGC 页面删除一并移除。

  // ── 编辑资料页：头像 / 背景图上传 ──
  // 回归点：微信选图返回的临时路径在真机上是 http://tmp/xxx，
  // 旧实现把所有 http(s):// 当成外链，于是把本地临时文件丢给 wx.downloadFile，
  // 必然失败 —— 表现为「编辑资料里换不了头像和背景图」。
  {
    const uploaded = []
    const downloadFileCalls = []
    const sandbox = {
      Page: () => {},
      getApp: () => ({ globalData: {}, callCloud: async () => ({ code: 0, data: {} }) }),
      require: () => ({
        uploadImages: async (images, folder, options) => {
          uploaded.push({ images, folder, options })
          return images.map((_, index) => `cloud://uploaded-${folder}-${index}`)
        }
      }),
      wx: {
        getFileSystemManager: () => ({ getFileInfo: ({ success }) => success({ size: 1024 }) }),
        downloadFile: options => {
          downloadFileCalls.push(options.url)
          options.success({ statusCode: 200, tempFilePath: 'http://tmp/downloaded.jpg' })
        },
        cloud: { downloadFile: () => {} },
        showLoading() {}, hideLoading() {}, showToast() {}, navigateBack() {}
      },
      setTimeout() {}
    }
    vm.runInNewContext(
      `${read('pages/profile-edit/profile-edit.js')}\n;__helpers = { isLocalImage, uploadIfLocal }`,
      sandbox,
      { filename: 'pages/profile-edit/profile-edit.js' }
    )
    const helpers = sandbox.__helpers

    assert.equal(helpers.isLocalImage('http://tmp/abc.jpg'), true, '微信临时文件被误判成外链')
    assert.equal(helpers.isLocalImage('wxfile://tmp_abc.jpg'), true, 'wxfile 临时文件被误判成外链')
    assert.equal(helpers.isLocalImage('http://tmp/abc.jpg?x=1'), true)
    assert.equal(helpers.isLocalImage('cloud://env.xxx/avatars/a.jpg'), false)
    assert.equal(helpers.isLocalImage('https://thirdwx.qlogo.cn/a.jpg'), false)

    const fileId = await helpers.uploadIfLocal('http://tmp/abc.jpg', 'avatars', 'cloud://old/a.jpg')
    assert.deepEqual(downloadFileCalls, [], '临时文件不该被拿去 downloadFile')
    assert.equal(uploaded[0].images[0], 'http://tmp/abc.jpg')
    assert.equal(uploaded[0].folder, 'avatars')
    assert.equal(uploaded[0].options.maxBytes, 1024 * 1024, '未对齐云端 1MB 审核上限')
    assert.equal(fileId, 'cloud://uploaded-avatars-0')

    // 没改动 → 原样回传，不重复上传，也不去下载历史外链
    const uploadCountBefore = uploaded.length
    assert.equal(await helpers.uploadIfLocal('cloud://keep/a.jpg', 'avatars', 'cloud://keep/a.jpg'), 'cloud://keep/a.jpg')
    assert.equal(await helpers.uploadIfLocal('https://thirdwx.qlogo.cn/a.jpg', 'avatars', 'https://thirdwx.qlogo.cn/a.jpg'), 'https://thirdwx.qlogo.cn/a.jpg')
    assert.equal(uploaded.length, uploadCountBefore, '未改动的图被重复上传了')
    assert.deepEqual(downloadFileCalls, [], '未改动的历史头像被拉去下载了')

    // 真的换了外链头像 → 才走下载重传（合规要求，不能绕过审核）
    await helpers.uploadIfLocal('https://thirdwx.qlogo.cn/b.jpg', 'avatars', 'cloud://old/a.jpg')
    assert.deepEqual(downloadFileCalls, ['https://thirdwx.qlogo.cn/b.jpg'])
  }

  // ── 多用户 / 集合自愈 ──
  // 回归点：favorites / collections 都是「第一次被写出时才存在」的集合。
  // 云开发在集合不存在时写入会抛 -502005，缺了自愈会让「第一个收藏的用户」
  // 直接失败，并且连累 getLocationDetail / getUserStats 等读接口整页报错。
  //
  // 注意：公开展示型降级已移除「通知作者」这条跨用户链路（messages），
  // 也移除了帖子/评论相关的 UGC 云函数，因此不再断言 messages 自愈。
  assert.match(read('cloudfunctions/toggleFavorite/index.js'), /ensureCollection\(db, 'favorites'\)/)
  assert.match(read('cloudfunctions/post-favorite/index.js'), /ensureCollection\(db, 'favorites'\)/)
  // 读接口对「集合可能不存在」必须降级，而不是让整页失败。
  const detailSource = read('cloudfunctions/getLocationDetail/index.js')
  assert.match(
    detailSource,
    /collection\('favorites'\)[\s\S]{0,400}?\.count\(\)\.catch\(\(\) => \(\{ total: 0 \}\)\)/,
    'getLocationDetail 的 favorites 查询缺少降级'
  )
  assert.match(read('cloudfunctions/getUserStats/index.js'), /\.count\(\)\s*\.catch\(\(\) => \(\{ total: 0 \}\)\)/, 'getUserStats 的收藏数缺少降级')
  assert.match(read('cloudfunctions/getUserContent/index.js'), /\.catch\(\(\) => \(\{ data: \[\] \}\)\)/, 'getUserContent 的收藏列表缺少降级')

  console.log('关键回归检查通过。')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
