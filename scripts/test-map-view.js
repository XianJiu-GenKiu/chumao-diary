#!/usr/bin/env node
/**
 * 离线自测：地图视图、投影与弧线（utils/mapView.js）
 *
 * 不联网、不依赖小程序运行时，纯 Node 即可跑：
 *   node scripts/test-map-view.js
 *
 * 三条核心不变量（任一条破了，海报要么取不到底图、要么点和弧线画错位置）：
 *   1. 底图视图必须装得下要画的经纬范围，且 zoom ≤17（请求带 scale=2，API 要求 4≤zoom≤17）；
 *   2. 投影：视图中心必须落在画布正中，偏移量必须符合 256×2^zoom 的瓦片约定
 *      —— 客户端是靠自己算像素坐标把弧线叠在底图上的，这里错了整张图就错位；
 *   3. 弧线：首尾必须精确落在两端点上，中段必须真的弯出去（不能退化成直线）。
 *
 * 另外守两条「全国地图」的不变量：
 *   4. 全国视图必须真的装得下整块中国版图（否则海报会裁掉新疆/海南/漠河）；
 *   5. 铺图映射必须把底图缩小后再铺 —— 覆盖物与底图共用它，漏乘缩放就整片偏掉。
 *
 * ⚠️ 改 utils/mapView.js 后必跑。
 */

const path = require('path')
const ROOT = path.resolve(__dirname, '..')

const {
  TILE_SIZE,
  MAX_ZOOM,
  NATIONAL_BOUNDS,
  NATIONAL_IMAGE_W,
  NATIONAL_IMAGE_H,
  projectY,
  unprojectY,
  pixelSpan,
  nationalMapView,
  pickStaticMapView,
  projectToCanvas,
  buildMapMapping,
  projectToBox,
  buildArcPath,
  buildStops,
  buildRadialArcs,
  buildStaticMapRequest,
  buildNationalMapRequest
} = require(path.join(ROOT, 'utils/mapView.js'))

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

const at = (latitude, longitude) => ({ latitude, longitude })
const W = 574
const H = 384
const PAD = 24

/** 在给定 zoom 下把点集换算成像素跨度，用来验证"是否真的装得下" */
function spansInPixels(view, points) {
  const worldPx = TILE_SIZE * Math.pow(2, view.zoom)
  const xs = points.map(p => ((p.longitude + 180) / 360) * worldPx)
  const ys = points.map(p => projectY(p.latitude) * worldPx)
  return {
    width: Math.max.apply(null, xs) - Math.min.apply(null, xs),
    height: Math.max.apply(null, ys) - Math.min.apply(null, ys)
  }
}

console.log('\n══ 1. 墨卡托投影往返 ══')
;[0, 23.1291, 31.2304, 45.8038, -33.87].forEach(lat => {
  check(`纬度 ${lat} 往返一致`, Math.abs(unprojectY(projectY(lat)) - lat) < 1e-6)
})
check('赤道在 y=0.5', Math.abs(projectY(0) - 0.5) < 1e-12)
check('北纬 y 更小（越往北越靠上）', projectY(50) < projectY(20))

console.log('\n══ 2. 底图视图：装得下 + zoom 合法 ══')
const cases = [
  { name: '单点（上海）', points: [at(31.2304, 121.4737)] },
  { name: '同城两点', points: [at(31.2304, 121.4737), at(31.2900, 121.5200)] },
  { name: '跨省（上海↔成都）', points: [at(31.2304, 121.4737), at(30.5728, 104.0668)] },
  { name: '南北跨度（哈尔滨↔三亚）', points: [at(45.8038, 126.5349), at(18.2528, 109.5119)] },
  { name: '东西跨度（上海↔乌鲁木齐）', points: [at(31.2304, 121.4737), at(43.8256, 87.6168)] }
]
cases.forEach(item => {
  const view = pickStaticMapView(item.points, W, H, PAD)
  if (!view) {
    check(`${item.name}：能算出视图`, false, '返回了 null')
    return
  }
  const span = spansInPixels(view, item.points)
  check(`${item.name}：点集在整张图内（${Math.round(span.width)}×${Math.round(span.height)} ≤ ${W}×${H}）`,
    span.width <= W && span.height <= H)
  const pinned = view.zoom === 4
  const fitsPadded = span.width <= W - PAD * 2 && span.height <= H - PAD * 2
  check(`${item.name}：${pinned ? 'zoom 已被 API 下限钳住（不要求留白）' : '留出了 padding'}`,
    pinned || fitsPadded, pinned ? '' : `${Math.round(span.width)}×${Math.round(span.height)}`)
  check(`${item.name}：zoom 在 4~${MAX_ZOOM}`, view.zoom >= 4 && view.zoom <= MAX_ZOOM, `实际 ${view.zoom}`)
  check(`${item.name}：中心点落在包围盒内`,
    view.latitude >= Math.min.apply(null, item.points.map(p => p.latitude)) - 0.5
    && view.latitude <= Math.max.apply(null, item.points.map(p => p.latitude)) + 0.5)
})

console.log('\n══ 3. 单点收敛到 zoom ≤17（scale=2 的硬约束）══')
const single = pickStaticMapView([at(31.2304, 121.4737)], W, H, PAD)
check('单点 zoom 不超过 17', single.zoom <= MAX_ZOOM, `实际 ${single.zoom}`)
check('单点 zoom 取到上限 17（不浪费清晰度）', single.zoom === MAX_ZOOM, `实际 ${single.zoom}`)
check('单点中心就是该点', Math.abs(single.latitude - 31.2304) < 1e-6 && Math.abs(single.longitude - 121.4737) < 1e-6)

console.log('\n══ 4. 越界与脏数据 ══')
check('空数组返回 null', pickStaticMapView([], W, H, PAD) === null)
check('全部坐标非法返回 null', pickStaticMapView([{ latitude: NaN, longitude: 1 }, null], W, H, PAD) === null)
check('中心点超出 API 合法纬度范围时返回 null', pickStaticMapView([at(60, 100)], W, H, PAD) === null)
check('中心点超出 API 合法经度范围时返回 null', pickStaticMapView([at(30, 10)], W, H, PAD) === null)
check('画布尺寸非法返回 null', pickStaticMapView([at(31, 121)], 0, H, PAD) === null)
// 漠河↔三亚 在 zoom=4（API 下限）下需要 506px 高 > 384，静态图装不下
check('跨度超出 zoom=4 的能力时返回 null', pickStaticMapView([at(53.47, 122.34), at(18.25, 109.51)], W, H, PAD) === null)
check('pixelSpan 与几何一致（跨省）', (() => {
  const points = [at(31.2304, 121.4737), at(30.5728, 104.0668)]
  const view = pickStaticMapView(points, W, H, PAD)
  const byHelper = pixelSpan({
    spanLng: Math.abs(121.4737 - 104.0668),
    spanY: Math.abs(projectY(31.2304) - projectY(30.5728))
  }, view.zoom)
  const byMath = spansInPixels(view, points)
  return Math.abs(byHelper.width - byMath.width) < 1e-6 && Math.abs(byHelper.height - byMath.height) < 1e-6
})())

console.log('\n══ 5. 投影：中心落在正中，偏移符合瓦片约定 ══')
const view = { latitude: 31.2304, longitude: 121.4737, zoom: 10 }
const center = projectToCanvas(view, view, W, H)
check('视图中心投影到画布正中', Math.abs(center.x - W / 2) < 1e-6 && Math.abs(center.y - H / 2) < 1e-6,
  `(${center.x}, ${center.y})`)
const east = projectToCanvas(at(31.2304, 121.4737 + 1), view, W, H)
const worldPx = TILE_SIZE * Math.pow(2, view.zoom)
check('东移 1 度经度 = 256×2^zoom/360 像素', Math.abs((east.x - center.x) - worldPx / 360) < 1e-6,
  `${(east.x - center.x).toFixed(3)} vs ${(worldPx / 360).toFixed(3)}`)
const north = projectToCanvas(at(31.2304 + 1, 121.4737), view, W, H)
check('北移经度不变时 x 不变', Math.abs(north.x - center.x) < 1e-6)
check('北移纬度变大时 y 变小', north.y < center.y)
check('非法点返回 null', projectToCanvas({ latitude: NaN, longitude: 1 }, view, W, H) === null)
check('视图为 null 时返回 null', projectToCanvas(at(31, 121), null, W, H) === null)

console.log('\n══ 6. 弧线：首尾精确、中段真的弯 ══')
const from = at(31.2304, 121.4737)
const to = at(23.1291, 113.2644)
const arc = buildArcPath(from, to, { steps: 24, bow: 0.18 })
check('采样点数 = steps + 1', arc.length === 25, `实际 ${arc.length}`)
check('首点精确等于起点', Math.abs(arc[0].latitude - from.latitude) < 1e-9 && Math.abs(arc[0].longitude - from.longitude) < 1e-9)
check('末点精确等于终点', Math.abs(arc[24].latitude - to.latitude) < 1e-9 && Math.abs(arc[24].longitude - to.longitude) < 1e-9)
// 二次贝塞尔：控制点垂直偏移 bow×弦长，最大偏离（t=0.5）为它的一半。
// 量度必须在**归一化世界坐标**里做（经度也要 /360），否则和实现一样会混算量纲。
const normalized = point => ({ x: (point.longitude + 180) / 360, y: projectY(point.latitude) })
const deviation = (() => {
  const a = normalized(from)
  const b = normalized(to)
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  let max = 0
  arc.forEach(point => {
    const p = normalized(point)
    const cross = Math.abs((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y))
    max = Math.max(max, cross / len)
  })
  return { max, expected: len * 0.18 / 2, len }
})()
check(`弧线最大偏离 ≈ bow×弦长/2（${deviation.max.toFixed(6)} vs ${deviation.expected.toFixed(6)}）`,
  Math.abs(deviation.max - deviation.expected) < deviation.expected * 0.02)
check('弧线不是直线（确实弯出去了）', deviation.max > 1e-6)
// 回归护栏：量纲混算曾让弧线飞到北极（纬度一路涨到 89°），这里必须守住
const arcLats = arc.map(p => p.latitude)
check('弧线纬度不会飞出两端范围（防量纲混算）',
  Math.min.apply(null, arcLats) >= Math.min(from.latitude, to.latitude) - 2
  && Math.max.apply(null, arcLats) <= Math.max(from.latitude, to.latitude) + 2,
  `${Math.min.apply(null, arcLats).toFixed(2)}~${Math.max.apply(null, arcLats).toFixed(2)}`)
check('弧线经度不会飞出两端范围',
  Math.min.apply(null, arc.map(p => p.longitude)) >= Math.min(from.longitude, to.longitude) - 2
  && Math.max.apply(null, arc.map(p => p.longitude)) <= Math.max(from.longitude, to.longitude) + 2)
const straight = buildArcPath(from, to, { bow: 0 })
check('bow=0 时退化为直线', Math.max.apply(null, straight.map(p => {
  const a = normalized(from)
  const b = normalized(to)
  const p2 = normalized(p)
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  return Math.abs((b.x - a.x) * (p2.y - a.y) - (p2.x - a.x) * (b.y - a.y)) / len
})) < 1e-9)
check('同一点之间不抛错且退化', buildArcPath(from, from, { steps: 8 }).length === 9)
check('坐标非法的端点返回空数组', buildArcPath(from, { latitude: NaN, longitude: 1 }).length === 0)
check('steps 被夹在 4~64', buildArcPath(from, to, { steps: 999 }).length === 65)

console.log('\n══ 6b. 迁徙图：从第一个地点放射出去 ══')
const migrationStops = buildStops([
  { placeName: '上海', latitude: 31.2304, longitude: 121.4737 },
  { placeName: '广州', latitude: 23.1291, longitude: 113.2644 },
  { placeName: '成都', latitude: 30.5728, longitude: 104.0668 },
  { placeName: '上海', latitude: 31.2304, longitude: 121.4737 }
])
check('同一地点去两次只留一个点', migrationStops.length === 3, `实际 ${migrationStops.length}`)
check('到访次数被记下（决定点的大小）', migrationStops[0].visits === 2)
const radial = buildRadialArcs(migrationStops, ['#111111', '#222222'], { steps: 8 })
check('弧线条数 = 地点数 - 1（起点不连自己）', radial.length === 2, `实际 ${radial.length}`)
check('每条弧线都从第一个地点出发',
  radial.every(a => a.from.key === migrationStops[0].key))
check('终点依次是第 2、3 个地点',
  radial.every((a, i) => a.to.key === migrationStops[i + 1].key))
check('弧线采样点数 = steps + 1（原生 polyline 靠采样点画弯）',
  radial.every(a => a.path.length === 9))
check('颜色按时间从色阶头走到尾',
  radial[0].color === '#111111' && radial[1].color === '#222222',
  radial.map(a => a.color).join(','))
check('只有一个地点时不画弧', buildRadialArcs(migrationStops.slice(0, 1), ['#111111']).length === 0)
check('空/非法输入不抛错', buildRadialArcs(null, null).length === 0 && buildRadialArcs([], null).length === 0)

console.log('\n══ 7. 全国视图：装得下整块版图 + 铺图映射 ══')
const national = nationalMapView()
check('全国视图能算出来', !!national)
check('全国视图 zoom 取到 API 下限 4（视野最大）', national && national.zoom === 4, national && `实际 ${national.zoom}`)
check('全国视图 center 落在 API 合法范围内（纬度 3.5~53、经度 73.5~135）',
  national.latitude >= 3.5 && national.latitude <= 53
  && national.longitude >= 73.5 && national.longitude <= 135,
  `${national.latitude},${national.longitude}`)
// 视野必须覆盖 NATIONAL_BOUNDS 的四边 —— 少一条，海报上就有省份被裁掉
const nationalBox = (() => {
  const worldPx = TILE_SIZE * Math.pow(2, national.zoom)
  const cx = ((national.longitude + 180) / 360) * worldPx
  const cy = projectY(national.latitude) * worldPx
  return {
    minLng: ((cx - NATIONAL_IMAGE_W / 2) / worldPx) * 360 - 180,
    maxLng: ((cx + NATIONAL_IMAGE_W / 2) / worldPx) * 360 - 180,
    maxLat: unprojectY((cy - NATIONAL_IMAGE_H / 2) / worldPx),
    minLat: unprojectY((cy + NATIONAL_IMAGE_H / 2) / worldPx)
  }
})()
check(`全国视图覆盖西边界 ${NATIONAL_BOUNDS.minLng}°E`, nationalBox.minLng <= NATIONAL_BOUNDS.minLng, nationalBox.minLng.toFixed(2))
check(`全国视图覆盖东边界 ${NATIONAL_BOUNDS.maxLng}°E`, nationalBox.maxLng >= NATIONAL_BOUNDS.maxLng, nationalBox.maxLng.toFixed(2))
check(`全国视图覆盖北边界 ${NATIONAL_BOUNDS.maxLat}°N`, nationalBox.maxLat >= NATIONAL_BOUNDS.maxLat, nationalBox.maxLat.toFixed(2))
check(`全国视图覆盖南边界 ${NATIONAL_BOUNDS.minLat}°N`, nationalBox.minLat <= NATIONAL_BOUNDS.minLat, nationalBox.minLat.toFixed(2))

const mapping = buildMapMapping(national, NATIONAL_IMAGE_W, NATIONAL_IMAGE_H, W, H)
check('铺图映射能算出来', !!mapping)
;[['西南', NATIONAL_BOUNDS.minLat, NATIONAL_BOUNDS.minLng],
  ['东北', NATIONAL_BOUNDS.maxLat, NATIONAL_BOUNDS.maxLng],
  ['西北', NATIONAL_BOUNDS.maxLat, NATIONAL_BOUNDS.minLng],
  ['东南', NATIONAL_BOUNDS.minLat, NATIONAL_BOUNDS.maxLng]
].forEach(item => {
  const pt = projectToBox(at(item[1], item[2]), mapping, 0, 0)
  check(`版图${item[0]}角落在卡片内（${Math.round(pt.x)},${Math.round(pt.y)}）`,
    pt.x >= 0 && pt.x <= W && pt.y >= 0 && pt.y <= H)
})
check('铺图是等比缩小（底图比卡片大）', mapping.scale > 0 && mapping.scale < 1,
  `${NATIONAL_IMAGE_W}×${NATIONAL_IMAGE_H} → ${W}×${H}，scale=${mapping.scale.toFixed(4)}`)
check('铺图后短边铺满、长边居中（四边多出不超过 2px）',
  Math.abs(mapping.imageWidth * mapping.scale - W) <= 2 && Math.abs(mapping.imageHeight * mapping.scale - H) <= 2,
  `${(mapping.imageWidth * mapping.scale).toFixed(2)}×${(mapping.imageHeight * mapping.scale).toFixed(2)}`)
// 覆盖物必须跟着缩放走：漏乘 scale，同一个点会往卡片中心挤 1/scale 倍
const probe = at(31.2304, 121.4737)
const viaBox = projectToBox(probe, mapping, 0, 0)
const viaCanvas = projectToCanvas(probe, national, NATIONAL_IMAGE_W, NATIONAL_IMAGE_H)
check('投影把铺图缩放算进去了（否则点和弧线整片偏掉）',
  Math.abs(viaBox.x - (mapping.offsetX + viaCanvas.x * mapping.scale)) < 1e-9
  && Math.abs(viaBox.y - (mapping.offsetY + viaCanvas.y * mapping.scale)) < 1e-9)
check('卡片偏移也算进去了', (() => {
  const shifted = projectToBox(probe, mapping, 28, 96)
  return Math.abs(shifted.x - (28 + viaBox.x)) < 1e-9 && Math.abs(shifted.y - (96 + viaBox.y)) < 1e-9
})())
check('空视图 / 零尺寸都返回 null',
  buildMapMapping(null, NATIONAL_IMAGE_W, NATIONAL_IMAGE_H, W, H) === null
  && buildMapMapping(national, 0, NATIONAL_IMAGE_H, W, H) === null
  && buildMapMapping(national, NATIONAL_IMAGE_W, NATIONAL_IMAGE_H, 0, H) === null)
check('projectToBox 对 null 映射返回 null', projectToBox(probe, null, 0, 0) === null)
check('projectToBox 对非法坐标返回 null', projectToBox({ latitude: NaN, longitude: 1 }, mapping, 0, 0) === null)

console.log('\n══ 8. 全国底图请求 ══')
const nationalRequest = buildNationalMapRequest()
check('尺寸是固定的全国取图尺寸', nationalRequest.size === `${NATIONAL_IMAGE_W}*${NATIONAL_IMAGE_H}`, nationalRequest.size)
check('默认走普清 scale=1（840×560 的高清图会撞上 callFunction 返回体积上限）', nationalRequest.scale === 1)
check('显式要高清时给 scale=2', buildNationalMapRequest({ scale: 2 }).scale === 2)
check('带 center 与 zoom（不依赖隐式定位）',
  Number.isFinite(nationalRequest.latitude) && Number.isFinite(nationalRequest.zoom))
check('请求的视图与 nationalMapView 一致（底图与覆盖物必须同源）',
  nationalRequest.latitude === national.latitude && nationalRequest.longitude === national.longitude
  && nationalRequest.zoom === national.zoom)
check('不请求任何覆盖物（弧线由客户端画）',
  !('markers' in nationalRequest) && !('path' in nationalRequest) && !('labels' in nationalRequest))
check('与用户足迹点无关（同样入参永远得到同一份请求）',
  JSON.stringify(buildNationalMapRequest()) === JSON.stringify(nationalRequest))

console.log('\n══ 9. 按点集拟合的底图请求（保留能力）：只要纯地图 ══')
const request = buildStaticMapRequest({ width: W, height: H, padding: PAD, points: [at(31.2304, 121.4737), at(30.5728, 104.0668)] })
check('尺寸按宽*高传出', request.size === `${W}*${H}`)
check('走高清 scale=2', request.scale === 2)
check('带 center 与 zoom（不依赖隐式定位）', Number.isFinite(request.latitude) && Number.isFinite(request.zoom))
check('zoom 满足 scale=2 的上限', request.zoom <= MAX_ZOOM)
check('不再请求任何覆盖物（弧线由客户端画）',
  !('markers' in request) && !('path' in request) && !('labels' in request) && !('route' in request))
check('点集为空时返回 null', buildStaticMapRequest({ width: W, height: H, points: [] }) === null)
check('尺寸缺失时返回 null', buildStaticMapRequest({ points: [at(31, 121)] }) === null)
check('没有入参不抛错', buildStaticMapRequest({}) === null)

console.log(`\n══ 结果：${pass} 通过 / ${fail} 失败 ══\n`)
process.exit(fail === 0 ? 0 : 1)
