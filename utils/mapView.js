/**
 * 地图视图与投影（纯函数，不依赖小程序运行时，也不发请求）
 *
 * 用途：把「要画进海报的一组坐标」换算成
 *   1. 腾讯静态图 API 需要的 center + zoom（取底图用）；
 *   2. 画布像素坐标（在底图上叠画弧线、标记、地名用）。
 *
 * ── 取景固定成「全国」，不跟着足迹点缩放 ──
 * 足迹海报的主视觉是一张**全国地图**（表达「点亮了哪些地方」），而不是某次行程的特写。
 * 所以底图一律按 NATIONAL_BOUNDS 取全国视图，与用户点集无关；点集只决定画哪些覆盖物。
 * 副作用是超出版图的点（境外记录）会落在地图卡之外 —— 绘制层直接跳过，不画到海报别处。
 *
 * ── 为什么取回来的底图要缩小再铺进卡片 ──
 * 全国版图在 zoom=4（API 下限，不能再小）下需要约 700×523 像素才装得下，比海报地图卡
 * （574×384）大。所以取图尺寸 NATIONAL_IMAGE_* 特意取得比卡片大、且与卡片同比，
 * 铺进卡片时按 cover 等比缩小；**覆盖物必须乘同一个缩放**（buildMapMapping / projectToBox），
 * 否则点和弧线会整片偏掉。取图尺寸与卡片同比这一条别乱改：同比才不会变形，
 * 也才不用真的裁掉边角。
 *
 * ── 为什么必须自己算 center + zoom，而不是让 API 隐式定位 ──
 * 静态图 API 不传 center 时会按标记隐式定位，但它可能选到 zoom=18，而 scale=2（高清）
 * 要求 4≤zoom≤17 —— 单点或密集点位的用户会直接请求失败。所以这里自己算并且**向下取整**：
 * zoom 越小视野越大，宁可四周多留白，也绝不能把点裁到画布外。
 *
 * ── 为什么覆盖物要客户端自己画 ──
 * 静态图的 path 只支持 color / weight，**画不出弧线**（没有曲线参数），而海报要求
 * 点与点之间用弧线连接。所以底图只向 API 要「纯地图」，弧线 / 标记 / 地名全部在
 * canvas 上用本文件的投影自己画 —— 顺带让矢量回退分支能共用同一套绘制逻辑。
 * 代价：依赖「腾讯静态图按标准 Web 墨卡托、256px 瓦片、给定 zoom 渲染」这一前提。
 * 站点若整体偏移，症状是"点相对底图错位"，此时可改回让 API 画标记
 * （getMapSnapshot 仍保留 markers / path 能力）。
 *
 * ── API 约束（来自官方文档，改动前先核对）──
 *   size      宽 50~1680、高 50~1200；scale=2 时建议 ≤900×900
 *   zoom      4~18（scale=2 时上限 17）
 *   center    纬度 3.5~53、经度 73.5~135，超出直接失败
 *   scale     只影响返回像素大小，覆盖范围由 size × zoom 决定
 *             （所以想要「更广的视野」只能加大 size 或减小 zoom，不能靠 scale）
 *
 * ⚠️ 改本文件后必跑：node scripts/test-map-view.js
 */

/** Web 墨卡托把世界铺成 2^zoom × 2^zoom 块 256px 的瓦片 */
const TILE_SIZE = 256

/** 墨卡托投影的纬度截断（再往两极 y 会发散） */
const MERCATOR_LAT_LIMIT = 85.05112878

/** 静态图 API 对 center 的合法范围：超出这个范围直接放弃底图，别发必然失败的请求 */
const CENTER_LAT_MIN = 3.5
const CENTER_LAT_MAX = 53
const CENTER_LNG_MIN = 73.5
const CENTER_LNG_MAX = 135

/** scale=2 要求 zoom ≤17，所以底图的 zoom 上限就是 17 */
const MIN_ZOOM = 4
const MAX_ZOOM = 17

/**
 * 海报底图取景用的「全国范围」：西起 73.5°E（帕米尔）、东到 135.1°E（抚远）、
 * 南到 17.5°N（含海南与西沙）、北到 53.6°N（漠河）。
 *
 * 南海诸岛（南沙一线低到 4°N）不在这块范围里 —— 强行塞进来整张图会变成一片海，
 * 海报就没法看了。国家标准图幅的做法是「主图 + 南海诸岛附图」，而腾讯底图在低缩放级别
 * 自带该附图，所以这里只管主图范围，附图交给底图自己渲染。
 */
const NATIONAL_BOUNDS = { minLat: 17.5, maxLat: 53.6, minLng: 73.5, maxLng: 135.1 }

/**
 * 全国底图的取图逻辑尺寸。
 *
 * 两条硬约束：
 *   1. 必须装得下 NATIONAL_BOUNDS —— zoom 已经是 API 下限 4，视野只能靠加大 size 来扩，
 *      实测至少需要 701×523；
 *   2. 必须与海报地图卡（574×384 ≈ 1.4948）同比 —— 同比才能整幅铺满且不变形，
 *      也就不用真的裁边（见 buildMapMapping 的 cover 语义）。
 * 840×560 = 1.5，与卡片差 0.35%，铺图时四边各多出约 1px，视觉上等于严丝合缝。
 */
const NATIONAL_IMAGE_W = 840
const NATIONAL_IMAGE_H = 560

/**
 * 地图审图号（对外展示地图图片时必填）
 *
 * ── 为什么必须自己标 ──
 * 《地图管理条例》第十六条：展示或者登载不属于出版物的地图的，由展示者或者登载者送审；
 * 公开使用的地图应当标注审图号。腾讯位置服务静态图 API 返回的底图**不自带审图号**
 * （图片里只有左下角一个「腾讯地图」logo），所以海报底图、POI 卡片封面这类
 * 会被用户看到甚至保存分享的地图图片，必须由我们自己叠加审图号。
 * 注意：小程序内置 map 组件由平台提供、自带合规，不适用本条；这里管的是**导出的图片**。
 *
 * ⚠️ 提审前必须填成真实可用的编号：
 *   1) 先向腾讯位置服务确认其静态图产品允许标注的审图号；或
 *   2) 改用其他已送审的合规底图。
 * 留空时渲染层会跳过绘制（不会画出半个空标注），但也意味着这一条合规项尚未闭合。
 */
const MAP_APPROVAL_NUMBER = ''

function hasCoords(point) {
  return !!point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
}

/** 纬度 → 墨卡托 y（0 在北、1 在南） */
function projectY(latitude) {
  const clamped = Math.max(-MERCATOR_LAT_LIMIT, Math.min(MERCATOR_LAT_LIMIT, latitude))
  const rad = (clamped * Math.PI) / 180
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI)
}

/** 墨卡托 y → 纬度 */
function unprojectY(y) {
  const lat = (2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) * 180 / Math.PI
  return lat
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6
}

/**
 * 只做几何拟合，不掺任何 API 约束。
 * 返回的 zoomRaw 是未取整的理想值，交给上层按各自的上限去夹。
 */
function fitView(points, width, height, padding) {
  const list = Array.isArray(points) ? points.filter(hasCoords) : []
  if (!list.length) return null
  const boxW = Math.round(Number(width) || 0)
  const boxH = Math.round(Number(height) || 0)
  if (boxW <= 0 || boxH <= 0) return null

  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  list.forEach(point => {
    minLat = Math.min(minLat, point.latitude)
    maxLat = Math.max(maxLat, point.latitude)
    minLng = Math.min(minLng, point.longitude)
    maxLng = Math.max(maxLng, point.longitude)
  })

  // 垂直方向用墨卡托中点，避免高纬度地区整体偏上/偏下
  const centerLat = unprojectY((projectY(minLat) + projectY(maxLat)) / 2)
  const centerLng = (minLng + maxLng) / 2
  const pad = Math.max(0, Number(padding) || 0)
  const usableW = Math.max(50, boxW - pad * 2)
  const usableH = Math.max(50, boxH - pad * 2)
  const spanLng = Math.max(maxLng - minLng, 1e-4)
  const spanY = Math.max(projectY(minLat) - projectY(maxLat), 1e-6)

  // 每度经度占 256*2^zoom/360 像素；纬度方向按墨卡托 y 跨度算。
  // 取两个方向里更小的那个，保证两个方向都装得下。
  const zoomRaw = Math.min(
    Math.log2((usableW * 360) / (TILE_SIZE * spanLng)),
    Math.log2(usableH / (TILE_SIZE * spanY))
  )

  return {
    latitude: centerLat,
    longitude: centerLng,
    zoomRaw,
    spanLng,
    spanY,
    boxW,
    boxH,
    inRange: centerLat >= CENTER_LAT_MIN && centerLat <= CENTER_LAT_MAX
      && centerLng >= CENTER_LNG_MIN && centerLng <= CENTER_LNG_MAX
  }
}

/** 在给定 zoom 下，点集横/纵向需要多少像素 */
function pixelSpan(view, zoom) {
  const scale = TILE_SIZE * Math.pow(2, zoom)
  return {
    width: (view.spanLng * scale) / 360,
    height: view.spanY * scale
  }
}

/** NATIONAL_BOUNDS 的西南角 + 东北角，喂给 pickStaticMapView 当「点集」用 */
function nationalCorners() {
  return [
    { latitude: NATIONAL_BOUNDS.minLat, longitude: NATIONAL_BOUNDS.minLng },
    { latitude: NATIONAL_BOUNDS.maxLat, longitude: NATIONAL_BOUNDS.maxLng }
  ]
}

/**
 * 全国视图：**固定值，与用户足迹点无关**。
 * 底图与矢量回退都用它，两条路径的取景才一致（否则同一批点在两种底图下落点不同）。
 * @returns {{latitude:number, longitude:number, zoom:number}|null}
 */
function nationalMapView() {
  return pickStaticMapView(nationalCorners(), NATIONAL_IMAGE_W, NATIONAL_IMAGE_H, 0)
}

/**
 * 取静态图底图用的视图（按给定点集拟合）。
 *
 * 先按留白算 zoom；若低于 API 最小 zoom（4），说明视野已到极限，退一步不留白，
 * 但仍必须保证所有点落在整张图内 —— 装不下就返回 null，让调用方用矢量回退，
 * 绝不把用户的足迹点裁掉。
 *
 * ⚠️ 海报走的是 nationalMapView()（固定全国取景），不再按点集拟合；
 *    本函数保留给「按点集取局部图」的用法，也是 nationalMapView 的底座。
 *
 * @returns {{latitude:number, longitude:number, zoom:number}|null}
 */
function pickStaticMapView(points, width, height, padding) {
  const fit = fitView(points, width, height, padding)
  if (!fit || !fit.inRange) return null

  const pad = Math.max(0, Number(padding) || 0)
  const usableW = Math.max(50, fit.boxW - pad * 2)
  const usableH = Math.max(50, fit.boxH - pad * 2)
  const zoomPadded = Math.floor(Math.min(
    Math.log2((usableW * 360) / (TILE_SIZE * fit.spanLng)),
    Math.log2(usableH / (TILE_SIZE * fit.spanY))
  ))
  const zoomFull = Math.floor(fit.zoomRaw)
  let zoom = zoomPadded >= MIN_ZOOM ? zoomPadded : zoomFull
  zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))

  const span = pixelSpan(fit, zoom)
  if (span.width > fit.boxW || span.height > fit.boxH) return null

  return { latitude: round6(fit.latitude), longitude: round6(fit.longitude), zoom }
}

/**
 * 经纬度 → 画布像素坐标。
 *
 * 前提：底图按标准 Web 墨卡托渲染，zoom 级世界宽 = 256 * 2^zoom 像素，
 * center 落在画布正中。这是 slippy-tile 系的通用约定。
 */
function projectToCanvas(point, view, width, height) {
  if (!hasCoords(point) || !view) return null
  const worldSize = TILE_SIZE * Math.pow(2, view.zoom)
  const x = ((point.longitude + 180) / 360) * worldSize
  const y = projectY(point.latitude) * worldSize
  const centerX = ((view.longitude + 180) / 360) * worldSize
  const centerY = projectY(view.latitude) * worldSize
  return {
    x: x - centerX + width / 2,
    y: y - centerY + height / 2
  }
}

/**
 * 「取图时的视图窗口」铺进海报地图卡时的映射。
 *
 * 为什么需要它：全国视图在 zoom=4（API 下限）下要 700×523 像素才装得下整块版图，
 * 比地图卡大，所以取回来的底图必须先缩小再铺进卡片；覆盖物只有乘同一个缩放，
 * 才能和底图严丝合缝。
 *
 * cover 语义：短边铺满，长边居中裁掉。取图尺寸与卡片同比时两边几乎相等，
 * 实际只会多出不到 1px（见 NATIONAL_IMAGE_* 的说明）。
 *
 * 矢量回退也用它（传全国视图 + NATIONAL_IMAGE_* 尺寸），这样有底图/没底图两种情况下
 * 可见的经纬范围完全一致，点不会一种底图看得见、另一种看不见。
 *
 * @returns {{view:object, imageWidth:number, imageHeight:number, scale:number,
 *            offsetX:number, offsetY:number, width:number, height:number}|null}
 */
function buildMapMapping(view, imageWidth, imageHeight, boxWidth, boxHeight) {
  const iw = Number(imageWidth) || 0
  const ih = Number(imageHeight) || 0
  const bw = Number(boxWidth) || 0
  const bh = Number(boxHeight) || 0
  if (!view || iw <= 0 || ih <= 0 || bw <= 0 || bh <= 0) return null
  const scale = Math.max(bw / iw, bh / ih)
  return {
    view,
    imageWidth: iw,
    imageHeight: ih,
    scale,
    offsetX: (bw - iw * scale) / 2,
    offsetY: (bh - ih * scale) / 2,
    width: bw,
    height: bh
  }
}

/**
 * 经纬度 → 海报画布绝对坐标（含卡片左上角偏移 + 铺图缩放）。
 *
 * 先用 projectToCanvas 算到「底图像素空间」（视口 = 取图尺寸），再乘映射的缩放与偏移。
 * 两步分开是有意的：底图坐标只跟视图有关，缩放只跟铺图方式有关，混在一起算最容易错。
 */
function projectToBox(point, mapping, boxX, boxY) {
  if (!mapping) return null
  const local = projectToCanvas(point, mapping.view, mapping.imageWidth, mapping.imageHeight)
  if (!local) return null
  return {
    x: boxX + mapping.offsetX + local.x * mapping.scale,
    y: boxY + mapping.offsetY + local.y * mapping.scale
  }
}

/**
 * 两点之间的弧线，返回采样后的经纬度数组（含首尾）。
 *
 * 在**墨卡托空间**里算二次贝塞尔：那个空间与屏幕只差一个等比缩放，所以这样得到的
 * 弧线在屏幕上就是规整的弓形；直接在经纬度空间插值会被纬度压缩拉变形。
 * 控制点取中点沿垂线偏移 bow × 弦长，bow 越大弧越弯。
 */
function buildArcPath(from, to, options) {
  if (!hasCoords(from) || !hasCoords(to)) return []
  const opts = options || {}
  const steps = Math.max(4, Math.min(64, Math.floor(Number(opts.steps) || 24)))
  const bow = Number.isFinite(Number(opts.bow)) ? Number(opts.bow) : 0.18

  // 归一化世界坐标：x ∈ [0,1] 对应 -180~180 经度，y = projectY(lat) ∈ [0,1]。
  // 经度**必须**先归一化再参与运算：经度单位是「度」、墨卡托 y 是 0~1，
  // 两者量纲不同，直接当同一平面算垂线会把控制点甩出几万公里，弧线直接飞到北极。
  const ax = (from.longitude + 180) / 360
  const ay = projectY(from.latitude)
  const bx = (to.longitude + 180) / 360
  const by = projectY(to.latitude)
  // 中点 + 垂线方向的偏移量（垂线向量 (-dy, dx) 的模长就等于弦长）
  const dx = bx - ax
  const dy = by - ay
  const cx = (ax + bx) / 2 - dy * bow
  const cy = (ay + by) / 2 + dx * bow

  const out = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const inv = 1 - t
    const x = inv * inv * ax + 2 * inv * t * cx + t * t * bx
    const y = inv * inv * ay + 2 * inv * t * cy + t * t * by
    out.push({ latitude: unprojectY(y), longitude: x * 360 - 180 })
  }
  return out
}

/**
 * 把按时间排好序的足迹点压成「去过的不同地点」。
 *
 * 同一地点去多次只留一个点：否则相邻两次是同一个坐标，弧线会在原地打转。
 * 到访次数留着，海报用**点的大小**表达频率；坐标取该地点所有记录的平均值，
 * 比只取第一次更接近真实位置。
 */
function buildStops(points) {
  const list = Array.isArray(points) ? points.filter(hasCoords) : []
  const byKey = {}
  const order = []
  list.forEach(point => {
    const key = point.placeName || point.city || `${point.latitude},${point.longitude}`
    if (!byKey[key]) {
      byKey[key] = {
        key,
        placeName: point.placeName || point.city || '',
        city: point.city || '',
        visits: 0,
        latitude: 0,
        longitude: 0
      }
      order.push(key)
    }
    const stop = byKey[key]
    // 先用累加值，最后再摊平成平均坐标
    stop.latitude += point.latitude
    stop.longitude += point.longitude
    stop.visits += 1
  })
  return order.map(key => {
    const stop = byKey[key]
    stop.latitude = round6(stop.latitude / stop.visits)
    stop.longitude = round6(stop.longitude / stop.visits)
    return stop
  })
}

/**
 * 相邻两个地点之间连弧线，颜色按时间先后从色阶头取到尾（越晚越"热"）。
 *
 * @param {Array} stops buildStops 的结果（已按时间排序）
 * @param {Array<string>} ramp 色阶，由调用方传入 —— 这里不写死颜色，
 *        避免几何模块反过来依赖业务配色
 * @returns {Array<{from:object,to:object,path:Array,color:string}>}
 */
function buildArcs(stops, ramp, options) {
  const list = Array.isArray(stops) ? stops : []
  const colors = Array.isArray(ramp) && ramp.length ? ramp : ['#D4890E']
  const arcs = []
  for (let i = 1; i < list.length; i++) {
    const path = buildArcPath(list[i - 1], list[i], options)
    if (path.length < 2) continue
    // 第 i 段在整条时间线上的位置：只有一段时直接给最"近"的颜色
    const t = list.length <= 2 ? 1 : (i - 1) / (list.length - 2)
    arcs.push({
      from: list[i - 1],
      to: list[i],
      path,
      color: colors[Math.min(colors.length - 1, Math.round(t * (colors.length - 1)))]
    })
  }
  return arcs
}

/**
 * 组装 getMapSnapshot 的入参：**只要纯底图**。
 * 弧线、标记、地名都在客户端画（静态图 API 画不出弧线）。
 *
 * @param {object} options width / height（逻辑像素，决定覆盖范围）、points、padding、scale
 * @returns {{size:string, scale:number, latitude:number, longitude:number, zoom:number}|null}
 *          返回 null 表示这次不该走底图（调用方用矢量回退）。
 */
function buildStaticMapRequest(options) {
  const opts = options || {}
  const width = Math.round(Number(opts.width) || 0)
  const height = Math.round(Number(opts.height) || 0)
  const view = pickStaticMapView(opts.points, width, height, opts.padding)
  if (!view) return null
  return {
    size: `${width}*${height}`,
    // scale 只影响返回像素，不影响覆盖范围。默认 2（高清）。
    scale: Number(opts.scale) === 1 ? 1 : 2,
    latitude: view.latitude,
    longitude: view.longitude,
    zoom: view.zoom
  }
}

/**
 * 组装「全国地图」底图的取图入参：尺寸与视图都是固定值，与用户足迹点无关。
 *
 * 为什么默认 scale=1 而不是 2：
 *   全国底图覆盖范围大，取图尺寸就得大（840×560）；scale=2 会返回 1680×1120 的 PNG，
 *   转成 base64 后极可能撞上 callFunction 的返回体积上限，底图反而整个拿不到
 *   （失败就退回矢量网格，海报上就没有全国地图了）。
 *   840×560 已经比海报里的展示尺寸（574×384）大，屏幕上是缩小显示、并不发虚；
 *   只有保存成 2 倍图时会被放大 1.4 倍，地图底图（大片平色 + 细线）可以接受。
 *
 * @returns {{size:string, scale:number, latitude:number, longitude:number, zoom:number}|null}
 */
function buildNationalMapRequest(options) {
  const opts = options || {}
  return buildStaticMapRequest({
    width: NATIONAL_IMAGE_W,
    height: NATIONAL_IMAGE_H,
    padding: 0,
    points: nationalCorners(),
    scale: Number(opts.scale) === 2 ? 2 : 1
  })
}

module.exports = {
  TILE_SIZE,
  CENTER_LAT_MIN,
  CENTER_LAT_MAX,
  CENTER_LNG_MIN,
  CENTER_LNG_MAX,
  MIN_ZOOM,
  MAX_ZOOM,
  NATIONAL_BOUNDS,
  NATIONAL_IMAGE_W,
  NATIONAL_IMAGE_H,
  MAP_APPROVAL_NUMBER,
  hasCoords,
  projectY,
  unprojectY,
  pixelSpan,
  nationalCorners,
  nationalMapView,
  pickStaticMapView,
  projectToCanvas,
  buildMapMapping,
  projectToBox,
  buildArcPath,
  buildStops,
  buildArcs,
  buildStaticMapRequest,
  buildNationalMapRequest
}
