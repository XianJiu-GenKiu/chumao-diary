#!/usr/bin/env node
/**
 * 离线自测：分享海报渲染（pages/share-card 的 _render / _renderFootprint）
 *
 * 不联网、不依赖小程序运行时：用一个记录调用的 canvas 假实现把绘制真跑一遍，断言
 *   1. 所有坐标都是有限值且落在画布内 —— canvas 对越界是静默裁剪，看不出来；
 *   2. 所有 fillText 用的字号都不低于 24 —— 画布 630 逻辑宽按 662rpx 展示，
 *      所以 1 画布单位 ≈ 1.05rpx，低于 24 就等于低于项目 24rpx 的可读下限；
 *   3. save/restore 配平 —— 不配平会污染后续所有绘制；
 *   4. 足迹海报在有/无静态底图两条路径下都能画完。
 *
 * ⚠️ 覆盖不到颜色和观感，那部分要在开发者工具里肉眼确认。
 * 改 _render / _renderFootprint / _drawFootprintMap / _infoTile 后必跑。
 */

const path = require('path')
const ROOT = path.resolve(__dirname, '..')

/** 弧线的时间色阶与页面里用的是同一份（省份徽章那套绿→橙） */
const ARC_TIME_RAMP = require(path.join(ROOT, 'utils/provinceBadges.js')).PROVINCE_RAMP

const {
  NATIONAL_IMAGE_W,
  NATIONAL_IMAGE_H,
  nationalMapView,
  buildMapMapping,
  projectToBox
} = require(path.join(ROOT, 'utils/mapView.js'))

const W = 630
const H = 1000
/** 允许的越界容差：圆角矩形的描边会略微超出路径本身 */
const SLACK = 4
/** 项目字号下限（rpx）。画布单位 ≈ rpx，所以画布里的字号也不能低于它。 */
const MIN_FONT_SIZE = 24
/** 足迹海报的地图卡：与 share-card.js 里的常量保持一致 */
const MAP_BOX = { x: 28, y: 96, w: 574, h: 384 }
/**
 * 底图铺进地图卡的映射（与 share-card.js 同源：全国视图 + cover 缩放）。
 * 底图取的是 840×560 的全国窗口，铺进来要等比缩小，覆盖物也得按同一缩放画。
 */
const MAP_MAPPING = buildMapMapping(nationalMapView(), NATIONAL_IMAGE_W, NATIONAL_IMAGE_H, MAP_BOX.w, MAP_BOX.h)
const MAP_DRAW = {
  x: MAP_BOX.x + MAP_MAPPING.offsetX,
  y: MAP_BOX.y + MAP_MAPPING.offsetY,
  w: MAP_MAPPING.imageWidth * MAP_MAPPING.scale,
  h: MAP_MAPPING.imageHeight * MAP_MAPPING.scale
}
const near = (a, b) => Math.abs(a - b) < 1e-6

let page = null
let cloudCalls = 0
let lastCloud = null
let cloudResponse = { code: 0, data: { src: 'data:image/png;base64,AAAB' } }
let writtenFile = null
let writeShouldFail = false
let downloadShouldFail = false
let downloadedFileID = null
let downloadCalls = 0

// 小程序运行时替身：页面文件在模块顶层就会调 getApp() 和 Page()
global.getApp = () => ({
  globalData: {},
  callCloud: (name, payload) => {
    cloudCalls++
    lastCloud = { name, payload }
    // 允许 cloudResponse 是函数：用来测「同一函数被调用两次、两次返回不同」的通道回退
    const response = typeof cloudResponse === 'function' ? cloudResponse(payload, cloudCalls) : cloudResponse
    return Promise.resolve(response)
  }
})
global.Page = config => { page = config }
global.wx = {
  getWindowInfo: () => ({ pixelRatio: 2 }),
  getStorageSync: () => [],
  env: { USER_DATA_PATH: '/tmp' },
  getFileSystemManager: () => ({
    writeFile: options => {
      if (writeShouldFail) options.fail && options.fail(new Error('disk full'))
      else { writtenFile = options; options.success && options.success() }
    }
  }),
  // 底图默认走「云存储 fileID + downloadFile」这条通道，替身要能分别模拟成功/失败
  cloud: {
    downloadFile: options => {
      downloadCalls++
      downloadedFileID = options.fileID
      if (downloadShouldFail) options.fail && options.fail(new Error('download failed'))
      else options.success && options.success({ tempFilePath: '/tmp/cloud-map.png' })
    }
  },
  createSelectorQuery: () => ({ select: () => ({ fields: () => ({ exec: () => {} }) }) })
}

require(path.join(ROOT, 'pages/share-card/share-card.js'))

let pass = 0
let fail = 0

function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

function createContext() {
  const calls = []
  const fonts = []
  const strokeColors = []
  let strokeStyleValue = ''
  const record = name => (...args) => { calls.push({ name, args }) }
  const ctx = {
    calls,
    fonts,
    strokeColors,
    fillStyle: '', lineWidth: 1, textAlign: 'left',
    lineJoin: 'miter', lineCap: 'butt', shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
    createLinearGradient: () => ({ addColorStop: () => {} }),
    // 假字体度量：中文按 1 字符 = 24px（24px 字号下汉字正好一个 em 宽）。
    // 别改成更小的值 —— 标签避让是靠它算胶囊宽度的，估小了就测不出「压住指北针」这类问题。
    measureText: text => ({ width: String(text).length * 24 }),
    save: record('save'), restore: record('restore'), clip: record('clip'),
    beginPath: record('beginPath'), closePath: record('closePath'),
    moveTo: record('moveTo'), lineTo: record('lineTo'),
    arc: record('arc'), arcTo: record('arcTo'), rect: record('rect'),
    fill: record('fill'),
    // 每次描边都记下当时的颜色：用来断言弧线确实按时间取了色阶
    stroke: (...args) => { calls.push({ name: 'stroke', args }); strokeColors.push(strokeStyleValue) },
    fillRect: record('fillRect'), clearRect: record('clearRect'),
    fillText: record('fillText'), drawImage: record('drawImage'),
    setLineDash: record('setLineDash'), scale: record('scale')
  }
  // font / strokeStyle 用访问器记下来，才能断言"没有画过小字""弧线用了哪几个颜色"
  let font = ''
  Object.defineProperty(ctx, 'font', {
    get: () => font,
    set: value => { font = String(value); fonts.push(font) },
    enumerable: true
  })
  Object.defineProperty(ctx, 'strokeStyle', {
    get: () => strokeStyleValue,
    set: value => { strokeStyleValue = String(value) },
    enumerable: true
  })
  return ctx
}

/** 二维码与底图都走 canvas.createImage()，这里让 src 赋值立刻触发 onload */
function createCanvas() {
  return {
    createImage: () => {
      const img = { width: 200, height: 200 }
      Object.defineProperty(img, 'src', { set() { if (img.onload) img.onload() } })
      return img
    }
  }
}

const BASE_DATA = {
  type: 'footprint',
  title: '毛毛用户的出毛足迹',
  subtitle: '累计出毛 12 次 · 走过 9 天',
  city: '上海 · 杭州',
  category: '足迹成就',
  statText: '足迹遍及：上海 · 杭州 · 广州',
  tiles: [
    { label: '出毛次数', value: '12 次' },
    { label: '点亮城市', value: '3 个' },
    { label: '兽聚场次', value: '2 场' }
  ],
  qrCodePath: ''
}

async function render(mapPoints, overrides, options) {
  const ctx = createContext()
  const opts = options || {}
  page.data = Object.assign({}, page.data, BASE_DATA, overrides || {})
  page._mapPoints = mapPoints || { path: [], meets: [], labels: [] }
  if (opts.type) page.data.type = opts.type
  // 底图走页面自己的取图流程：这样 _staticMapPath 与 _staticMapView 一定配套。
  // （直接塞一个路径而不管视图，正是测试第一版踩到的坑：视图是上一节留下的旧值，
  //   弧线按旧取景算像素，点就画到画布外面去了。）
  page._staticMapPath = ''
  page._staticMapView = null
  if (opts.withBaseMap) {
    cloudResponse = { code: 0, data: { src: 'data:image/png;base64,AAAB' } }
    writeShouldFail = false
    page._staticMapPath = await page._loadStaticMap()
  }
  await page._render(ctx, createCanvas(), W, H, opts.coverPath || '')
  return ctx
}

/** 把绘制调用换算成需要校验的坐标点（含末端点 / 圆的外沿） */
function pointsOf(calls) {
  const points = []
  calls.forEach(call => {
    const a = call.args
    switch (call.name) {
      case 'fillText':
        points.push({ x: a[1], y: a[2], what: `fillText(${a[0]})` })
        break
      case 'arc':
        points.push({ x: a[0] - a[2], y: a[1] - a[2], what: 'arc.min' })
        points.push({ x: a[0] + a[2], y: a[1] + a[2], what: 'arc.max' })
        break
      case 'arcTo':
      case 'moveTo':
      case 'lineTo':
        points.push({ x: a[0], y: a[1], what: call.name })
        break
      case 'fillRect':
        points.push({ x: a[0], y: a[1], what: 'fillRect' })
        points.push({ x: a[0] + a[2], y: a[1] + a[3], what: 'fillRect.far' })
        break
      case 'drawImage':
        points.push({ x: a[1], y: a[2], what: 'drawImage' })
        points.push({ x: a[1] + a[3], y: a[2] + a[4], what: 'drawImage.far' })
        break
      default:
        break
    }
  })
  return points
}

function fontSizes(ctx) {
  return ctx.fonts
    .map(text => /(\d+(?:\.\d+)?)px/.exec(text))
    .filter(Boolean)
    .map(match => Number(match[1]))
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/**
 * 从绘制调用里把地名胶囊的位置抠出来。
 * _roundRect(..., 34, 17) 的第一笔是 moveTo(x + 17, y)，所以从 fillText 往前找最近的
 * moveTo 就能还原胶囊左上角。宽度按假实现的 measureText 算：pillW = 字数×24 + 24。
 */
function labelPills(ctx, names) {
  const pills = []
  ctx.calls.forEach((call, index) => {
    if (call.name !== 'fillText' || names.indexOf(call.args[0]) === -1) return
    for (let i = index - 1; i >= 0; i--) {
      if (ctx.calls[i].name !== 'moveTo') continue
      const left = ctx.calls[i].args[0] - 17
      const top = ctx.calls[i].args[1]
      pills.push({
        text: call.args[0],
        left,
        top,
        right: left + String(call.args[0]).length * 24 + 24,
        bottom: top + 34
      })
      break
    }
  })
  return pills
}

function audit(label, ctx) {
  const points = pointsOf(ctx.calls)
  const bad = points.filter(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  check(`${label}：坐标全部是有限值`, bad.length === 0, bad.slice(0, 3).map(p => `${p.what}(${p.x},${p.y})`).join(' '))
  const outside = points.filter(p => p.x < -SLACK || p.x > W + SLACK || p.y < -SLACK || p.y > H + SLACK)
  check(`${label}：没有画到画布外（${points.length} 个坐标点）`, outside.length === 0,
    outside.slice(0, 3).map(p => `${p.what}(${Math.round(p.x)},${Math.round(p.y)})`).join(' '))
  const saves = ctx.calls.filter(c => c.name === 'save').length
  const restores = ctx.calls.filter(c => c.name === 'restore').length
  check(`${label}：save/restore 配平`, saves === restores, `save=${saves} restore=${restores}`)
  const sizes = fontSizes(ctx)
  const tooSmall = sizes.filter(size => size < MIN_FONT_SIZE)
  check(`${label}：字号不低于 ${MIN_FONT_SIZE}（最小 ${sizes.length ? Math.min.apply(null, sizes) : '无'}）`,
    sizes.length > 0 && tooSmall.length === 0, tooSmall.join(','))
}

const multiCity = {
  path: [
    { latitude: 31.2304, longitude: 121.4737, city: '上海' },
    { latitude: 30.2741, longitude: 120.1551, city: '杭州' },
    { latitude: 23.1291, longitude: 113.2644, city: '广州' }
  ],
  meets: [{ latitude: 22.5431, longitude: 114.0579 }],
  labels: [
    { text: '上海', latitude: 31.2304, longitude: 121.4737 },
    { text: '广州', latitude: 23.1291, longitude: 113.2644 }
  ]
}

const singlePoint = {
  path: [{ latitude: 31.2304, longitude: 121.4737, city: '上海' }],
  meets: [],
  labels: [{ text: '上海', latitude: 31.2304, longitude: 121.4737 }]
}

const emptyMap = { path: [], meets: [], labels: [] }

;(async () => {
  console.log('\n══ 1. 足迹海报：有静态底图 ══')
  const withMap = await render(multiCity, {}, { withBaseMap: true })
  audit('有底图', withMap)
  const mapDraws = withMap.calls.filter(c => c.name === 'drawImage' && near(c.args[3], MAP_DRAW.w))
  check('底图按铺图映射铺满（短边对齐，长边多出不到 2px）', mapDraws.length === 1, `实际 ${mapDraws.length} 次`)
  check('底图落在地图卡位置（含铺图偏移）',
    mapDraws.length === 1 && near(mapDraws[0].args[1], MAP_DRAW.x) && near(mapDraws[0].args[2], MAP_DRAW.y),
    mapDraws.length === 1 ? `${mapDraws[0].args[1]},${mapDraws[0].args[2]} vs ${MAP_DRAW.x},${MAP_DRAW.y}` : '')
  check('底图铺出来比卡片略大（等比缩小的结果，由圆角裁剪吃掉）',
    MAP_DRAW.w >= MAP_BOX.w && MAP_DRAW.w <= MAP_BOX.w + 2
    && MAP_DRAW.h >= MAP_BOX.h && MAP_DRAW.h <= MAP_BOX.h + 2,
    `${MAP_DRAW.w.toFixed(2)}×${MAP_DRAW.h.toFixed(2)}`)
  check('仍然画了指北针', withMap.calls.some(c => c.name === 'fillText' && c.args[0] === 'N'))
  check('有底图时也自己叠画弧线（时间色阶两端都出现）',
    withMap.strokeColors.indexOf(ARC_TIME_RAMP[0]) !== -1 && withMap.strokeColors.indexOf(ARC_TIME_RAMP[ARC_TIME_RAMP.length - 1]) !== -1,
    withMap.strokeColors.filter(c => c.indexOf('#') === 0).join(','))
  check('弧线垫了白色描边（才能压在底图的道路文字上）',
    withMap.strokeColors.some(c => c.indexOf('rgba(255, 255, 255') === 0))
  check('画了地点名标签', withMap.calls.some(c => c.name === 'fillText' && c.args[0] === '上海'))
  check('画了卡内图例（足迹 / 兽聚）',
    withMap.calls.some(c => c.name === 'fillText' && c.args[0] === '足迹')
    && withMap.calls.some(c => c.name === 'fillText' && c.args[0] === '兽聚'))
  check('画了时间色阶图例（早期 / 近期 / 点越大去得越多）',
    withMap.calls.some(c => c.name === 'fillText' && c.args[0] === '早期')
    && withMap.calls.some(c => c.name === 'fillText' && c.args[0] === '近期')
    && withMap.calls.some(c => c.name === 'fillText' && c.args[0] === '点越大去得越多'))
  check('画了比例尺', withMap.calls.some(c => c.name === 'fillText' && /^\d+ km$/.test(String(c.args[0]))))
  // 比例尺必须按**卡片像素**算（底图缩小过，一卡片像素比一底图像素远得多）：
  // 全国视图下量出来应是千公里级，若漏除铺图缩放会得到几百公里的短尺子
  const scaleText = withMap.calls
    .filter(c => c.name === 'fillText' && /^\d+ km$/.test(String(c.args[0])))
    .map(c => Number(String(c.args[0]).replace(' km', '')))[0]
  check(`比例尺量级符合全国视图（${scaleText} km）`, scaleText >= 1000 && scaleText <= 2000)

  console.log('\n══ 2. 足迹海报：底图缺失时回退矢量网格 ══')
  const fallback = await render(multiCity)
  audit('矢量回退', fallback)
  check('回退时不画地图底图', !fallback.calls.some(c => c.name === 'drawImage'))
  check('回退时同样画弧线（两种底图视觉语言一致）',
    fallback.strokeColors.indexOf(ARC_TIME_RAMP[0]) !== -1)
  // 全国视图下东部城市会挤在一起：压住了要改摆点的下方，而不是直接丢掉
  const fallbackLabels = fallback.calls
    .filter(c => c.name === 'fillText' && ['上海', '杭州', '广州'].includes(c.args[0]))
    .map(c => c.args[0])
  check('回退时三个地名都标了（挤不下就改摆点的下方）', fallbackLabels.length === 3, fallbackLabels.join(','))
  const fallbackPills = labelPills(fallback, ['上海', '杭州', '广州'])
  check('回退时地名胶囊互不重叠',
    !fallbackPills.some((a, i) => fallbackPills.some((b, j) => j > i && rectsOverlap(a, b))),
    fallbackPills.map(p => `${p.text}[${Math.round(p.left)},${Math.round(p.top)}]`).join(' '))
  check('回退时也画指北针', fallback.calls.some(c => c.name === 'fillText' && c.args[0] === 'N'))

  console.log('\n══ 3. 二维码两个分支 ══')
  const withCode = await render(multiCity, { qrCodePath: '/tmp/fake-code.png' }, { withBaseMap: true })
  audit('带码', withCode)
  check('码被画进海报', withCode.calls.some(c => c.name === 'drawImage' && c.args[3] === 100))
  check('有码时给的是扫码文案', withCode.calls.some(c => c.name === 'fillText' && c.args[0] === '扫码打开出毛日记'))
  const noCode = await render(multiCity, {}, { withBaseMap: true })
  check('没有码时给的是占位文案', noCode.calls.some(c => c.name === 'fillText' && c.args[0] === '在微信内打开'))
  check('没有码时不出现扫码文案', !noCode.calls.some(c => c.name === 'fillText' && c.args[0] === '扫码打开出毛日记'))

  console.log('\n══ 4. 只有一个点 / 没有点 / 大跨度 ══')
  const singleCtx = await render(singlePoint, {}, { withBaseMap: true })
  audit('单点', singleCtx)
  // 全国视图的硬证据：单点也不该被放大成卡片正中的特写 ——
  // 上海按全国投影落在偏东、中偏下的位置。若这里又回到卡片中心，
  // 说明底图取景又跟着点集缩放了。
  const dot = singleCtx.calls.filter(c => c.name === 'arc' && c.args[2] === 6)[0]
  const expectDot = projectToBox(singlePoint.path[0], MAP_MAPPING, MAP_BOX.x, MAP_BOX.y)
  check('单点按全国视图投影落点（不是点集特写）',
    !!dot && near(dot.args[0], expectDot.x) && near(dot.args[1], expectDot.y),
    dot ? `${dot.args[0].toFixed(1)},${dot.args[1].toFixed(1)} vs ${expectDot.x.toFixed(1)},${expectDot.y.toFixed(1)}` : '没找到足迹点')
  check('单点不落在卡片正中（全国视图下上海本就偏东偏下）',
    !!dot && Math.abs(dot.args[0] - (MAP_BOX.x + MAP_BOX.w / 2)) > 40
    && Math.abs(dot.args[1] - (MAP_BOX.y + MAP_BOX.h / 2)) > 20,
    dot ? `${dot.args[0].toFixed(1)},${dot.args[1].toFixed(1)}` : '')
  const empty = await render(emptyMap)
  audit('空地图', empty)
  check('空态给了提示文案', empty.calls.some(c => c.name === 'fillText' && String(c.args[0]).includes('还没有带坐标')))
  audit('南北跨度', await render({
    path: [
      { latitude: 45.8038, longitude: 126.5349, city: '哈尔滨' },
      { latitude: 18.2528, longitude: 109.5119, city: '三亚' }
    ],
    meets: [],
    labels: [{ text: '哈尔滨', latitude: 45.8038, longitude: 126.5349 }]
  }))

  console.log('\n══ 5. 地点 / 合集海报（同一套字号标准）══')
  audit('地点海报', await render(null, { type: 'location', city: '上海', category: '拍摄地点' }))
  audit('合集海报', await render(null, { type: 'collection', city: '杭州', category: '地点合集' }))
  const twoLineTitle = await render(null, {
    type: 'location',
    title: '一个相当长的地点名称用来把标题挤成两行看会不会压到下面的三格统计',
    category: '拍摄地点'
  })
  audit('地点海报（两行标题）', twoLineTitle)

  console.log('\n══ 6. 静态底图取图契约 ══')
  page._mapPoints = multiCity
  cloudCalls = 0
  cloudResponse = { code: 0, data: { src: 'data:image/png;base64,AAAB' } }
  writeShouldFail = false
  const fetchedPath = await page._loadStaticMap()
  check('调用的是 getMapSnapshot', lastCloud && lastCloud.name === 'getMapSnapshot')
  check('取的是固定的全国尺寸（底图比地图卡大，铺进来时再缩小）',
    lastCloud.payload.size === `${NATIONAL_IMAGE_W}*${NATIONAL_IMAGE_H}`, lastCloud.payload.size)
  check('走普清 scale=1（840×560 的高清图会撞上 callFunction 返回体积上限）', lastCloud.payload.scale === 1)
  check('请求带上了 center 与 zoom', Number.isFinite(lastCloud.payload.latitude) && Number.isFinite(lastCloud.payload.zoom))
  check('只取纯底图，不请求任何覆盖物（弧线由客户端画）',
    !('markers' in lastCloud.payload) && !('path' in lastCloud.payload)
    && !('route' in lastCloud.payload) && !('labels' in lastCloud.payload) && !('footprints' in lastCloud.payload))
  check('成功时返回本机文件路径', /^\/tmp\/footprint-map-\d+\.png$/.test(fetchedPath), fetchedPath)
  check('底图视图被存下来给绘制层复用（否则弧线与底图会错位）',
    !!page._staticMapView && page._staticMapView.zoom === lastCloud.payload.zoom
    && page._staticMapView.latitude === lastCloud.payload.latitude)
  check('取的就是固定全国视图', (() => {
    const national = nationalMapView()
    return page._staticMapView.zoom === national.zoom
      && page._staticMapView.latitude === national.latitude
      && page._staticMapView.longitude === national.longitude
  })())

  // 取景与用户点集无关：换一批点（含跨度大到装不下的）请求必须一模一样
  const nationalPayload = JSON.stringify(lastCloud.payload)
  page._mapPoints = {
    path: [{ latitude: 53.47, longitude: 122.34 }, { latitude: 18.25, longitude: 109.51 }],
    meets: [],
    labels: []
  }
  cloudCalls = 0
  const widePath = await page._loadStaticMap()
  check('跨度大到装不下也照取全国底图（不再退回矢量）', cloudCalls === 1 && widePath !== '', `cloudCalls=${cloudCalls}`)
  check('换点集后请求完全一致（取景固定，与足迹点无关）', JSON.stringify(lastCloud.payload) === nationalPayload)

  // 云函数失败：必须安静降级，不能把海报搞崩
  page._mapPoints = multiCity
  cloudResponse = { code: -1, message: '地图快照生成失败' }
  check('云函数失败时返回空串（海报仍能生成）', (await page._loadStaticMap()) === '')
  cloudResponse = { code: 0, data: {} }
  check('云函数没给图片时返回空串', (await page._loadStaticMap()) === '')

  // ── 6b. 底图投递通道 ──
  // 全国底图的 base64 有 520KB，官方文档对 callFunction 的建议临界值是 100KB，
  // 所以默认必须走「云存储 fileID」，base64 只作为兜底。
  console.log('\n══ 6b. 底图投递通道（fileID 优先 / base64 兜底）══')
  const FILE_ID = 'cloud://cloudbase-d1gv7z.6d67-cloudbase-d1gv7z-1/map-snapshots/abc123.png'
  downloadShouldFail = false
  downloadCalls = 0
  cloudCalls = 0
  cloudResponse = { code: 0, data: { fileID: FILE_ID } }
  const viaCloudFile = await page._loadStaticMap()
  check('有 fileID 时走云存储下载', downloadCalls === 1 && downloadedFileID === FILE_ID,
    `downloadCalls=${downloadCalls} fileID=${downloadedFileID}`)
  check('云存储下载成功就直接返回临时路径（不再落 base64）',
    viaCloudFile === '/tmp/cloud-map.png', viaCloudFile)
  check('走 fileID 通道时云函数只调一次', cloudCalls === 1, `cloudCalls=${cloudCalls}`)

  // 云存储下载失败（例如存储读权限受限）→ 必须带 mode:'base64' 再要一次，别直接掉到网格
  downloadShouldFail = true
  downloadCalls = 0
  cloudCalls = 0
  writtenFile = null
  cloudResponse = (payload, n) => (n === 1
    ? { code: 0, data: { fileID: FILE_ID } }
    : { code: 0, data: { src: 'data:image/png;base64,AAAB' } })
  const afterDownloadFail = await page._loadStaticMap()
  check('下载失败后重试一次，并显式要 base64', cloudCalls === 2 && lastCloud.payload.mode === 'base64',
    `cloudCalls=${cloudCalls} mode=${lastCloud.payload.mode}`)
  check('重试时除 mode 外的取图参数不变',
    lastCloud.payload.size === `${NATIONAL_IMAGE_W}*${NATIONAL_IMAGE_H}` && lastCloud.payload.scale === 1)
  check('下载失败时回退到 base64 落盘',
    /^\/tmp\/footprint-map-\d+\.png$/.test(afterDownloadFail) && !!writtenFile && writtenFile.data === 'AAAB',
    `${afterDownloadFail} / ${writtenFile && writtenFile.data}`)

  // 两条通道都不可用 → 安静返回空串，交给矢量回退
  downloadShouldFail = true
  cloudResponse = { code: 0, data: { fileID: FILE_ID } }
  check('fileID 与 base64 都拿不到时返回空串（走矢量回退）', (await page._loadStaticMap()) === '')
  downloadShouldFail = false
  cloudResponse = { code: 0, data: { src: 'data:image/png;base64,AAAB' } }

  console.log('\n══ 7. base64 底图落盘 ══')
  cloudResponse = { code: 0, data: { src: 'data:image/png;base64,AAAB' } }
  writeShouldFail = false
  await page._writeBase64File('data:image/png;base64,AAAB')
  check('data URL 前缀被剥掉再写盘', writtenFile && writtenFile.data === 'AAAB', writtenFile && writtenFile.data)
  check('按 base64 编码写入', writtenFile && writtenFile.encoding === 'base64')
  check('写入的是本机用户目录', writtenFile && writtenFile.filePath.indexOf('/tmp/footprint-map-') === 0)
  check('空 data URL 返回空串', (await page._writeBase64File('')) === '')
  writeShouldFail = true
  check('落盘失败返回空串（交给矢量回退）', (await page._writeBase64File('data:image/png;base64,AAAB')) === '')
  writeShouldFail = false

  console.log('\n══ 8. 地点去重与弧线取色 ══')
  // 同一个地点去 3 次 + 另一个地点 1 次：应该只有 2 个地点、1 条弧线，
  // 点的大小按次数区分（否则"频率"这个维度就丢了）
  const repeat = {
    path: [
      { latitude: 31.2304, longitude: 121.4737, city: '上海', placeName: '外滩', visitedAt: 1 },
      { latitude: 31.2310, longitude: 121.4740, city: '上海', placeName: '外滩', visitedAt: 2 },
      { latitude: 31.2300, longitude: 121.4730, city: '上海', placeName: '外滩', visitedAt: 3 },
      { latitude: 30.2741, longitude: 120.1551, city: '杭州', placeName: '西湖', visitedAt: 4 }
    ],
    meets: [],
    labels: []
  }
  const repeatCtx = await render(repeat, {}, { withBaseMap: true })
  audit('同地点多次', repeatCtx)
  const { buildStops } = require(path.join(ROOT, 'utils/mapView.js'))
  const stops = buildStops(repeat.path)
  check('同一地点去多次只算一个地点', stops.length === 2, `实际 ${stops.length}`)
  check('地点带上到访次数', stops[0].visits === 3 && stops[1].visits === 1)
  check('地点坐标取多次记录的平均值',
    Math.abs(stops[0].latitude - (31.2304 + 31.2310 + 31.2300) / 3) < 1e-5)
  check('地点按首次到访时间排序（外滩在前）', stops[0].placeName === '外滩' && stops[1].placeName === '西湖')
  check('只有一段行程时弧线取色阶最"近"的颜色',
    repeatCtx.strokeColors.indexOf(ARC_TIME_RAMP[ARC_TIME_RAMP.length - 1]) !== -1)
  check('点大小按次数区分（3 次的点比 1 次的大）', (() => {
    const radii = repeatCtx.calls.filter(c => c.name === 'arc').map(c => c.args[2])
    return radii.indexOf(6) !== -1 && radii.some(r => Math.abs(r - 9.2) < 1e-6)
  })())

  console.log('\n══ 9. 贴边的地名标签不越出地图卡 ══')
  // 东西跨度最大的一组：乌鲁木齐在最左、上海在最右。
  // 4 字城市名的胶囊半宽（约 60px）比留白（52px）还宽，不夹住就会甩到卡片外面。
  const edge = await render({
    path: [
      { latitude: 31.2304, longitude: 121.4737, city: '上海', placeName: '上海', visitedAt: 1 },
      { latitude: 43.8256, longitude: 87.6168, city: '乌鲁木齐', placeName: '乌鲁木齐', visitedAt: 2 }
    ],
    meets: [],
    labels: []
  }, {}, { withBaseMap: true })
  audit('贴边标签', edge)
  // 地名胶囊是 _roundRect(..., 34, 17)：它的第一笔是 moveTo(x + 17, y)。
  // 宽度按假实现的 measureText（每字符 24px）算：pillW = 字符数 × 24 + 24。
  const edgePills = labelPills(edge, ['上海', '乌鲁木齐'])
  check('两个地名标签都画了', edgePills.length === 2, `实际 ${edgePills.length}`)
  check('标签胶囊整体落在地图卡内',
    edgePills.every(pill => pill.left >= MAP_BOX.x - 1 && pill.right <= MAP_BOX.x + MAP_BOX.w + 1),
    edgePills.map(pill => `${pill.text}[${Math.round(pill.left)},${Math.round(pill.right)}]`).join(' '))

  console.log('\n══ 10. 地名标签避让图例与指北针 ══')
  // 直接调绘制层，精确控制标签落点：东北角的城市（哈尔滨一带）正好压在指北针上，
  // 标签必须改摆点的下方，而不是糊在指北针上。
  const northCtx = createContext()
  const harbin = { latitude: 45.8038, longitude: 126.5349, city: '哈尔滨', placeName: '哈尔滨', visits: 1 }
  page._drawFootprintMap(northCtx, MAP_BOX.x, MAP_BOX.y, MAP_BOX.w, MAP_BOX.h, null, MAP_MAPPING, {
    stops: [harbin],
    arcs: [],
    meets: [],
    labels: [
      { text: '哈尔滨', latitude: harbin.latitude, longitude: harbin.longitude },
      { text: '上海', latitude: 31.2304, longitude: 121.4737 }
    ]
  })
  const compassBox = {
    left: MAP_BOX.x + MAP_BOX.w - 76, top: MAP_BOX.y + 18,
    right: MAP_BOX.x + MAP_BOX.w - 16, bottom: MAP_BOX.y + 78
  }
  const northPills = labelPills(northCtx, ['哈尔滨', '上海'])
  check('两个标签都摆下了', northPills.length === 2, `实际 ${northPills.length}`)
  check('没有标签压住指北针',
    !northPills.some(pill => rectsOverlap(pill, compassBox)),
    northPills.map(pill => `${pill.text}[${Math.round(pill.left)},${Math.round(pill.top)}]`).join(' '))
  const harbinPill = northPills.filter(pill => pill.text === '哈尔滨')[0]
  const harbinPoint = projectToBox(harbin, MAP_MAPPING, MAP_BOX.x, MAP_BOX.y)
  check('哈尔滨的标签被改摆到点的下方（默认在点上方，会压住指北针）',
    !!harbinPill && harbinPill.top > harbinPoint.y,
    harbinPill ? `标签顶 ${Math.round(harbinPill.top)} vs 点 ${Math.round(harbinPoint.y)}` : '没找到')
  check('没有标签压住卡内图例（左上角）', !northPills.some(pill =>
    rectsOverlap(pill, { left: MAP_BOX.x + 12, top: MAP_BOX.y + 12, right: MAP_BOX.x + 240, bottom: MAP_BOX.y + 58 })))
  check('标签仍落在地图卡内', northPills.every(pill =>
    pill.left >= MAP_BOX.x - 1 && pill.right <= MAP_BOX.x + MAP_BOX.w + 1
    && pill.top >= MAP_BOX.y - 1 && pill.bottom <= MAP_BOX.y + MAP_BOX.h + 1),
  northPills.map(pill => `${pill.text}[${Math.round(pill.left)},${Math.round(pill.top)}]`).join(' '))

  console.log(`\n══ 结果：${pass} 通过 / ${fail} 失败 ══\n`)
  process.exit(fail === 0 ? 0 : 1)
})()
