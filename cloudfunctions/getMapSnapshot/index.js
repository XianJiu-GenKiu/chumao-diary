// 云函数：getMapSnapshot
// 调用腾讯位置服务「静态图 API v2」，把坐标渲染成一张地图 PNG 交给客户端。
//
// 两类入参：
//   1. 只传 latitude / longitude / zoom → 360*225 单点图（默认尺寸，POI 卡片封面的老形状）；
//   2. 足迹海报：额外传 size / scale，取一张**纯底图**（弧线/标记/地名由客户端画，
//      静态图 API 的 path 只支持 color/weight，画不出弧线）。
//
// ── 为什么默认返回 fileID 而不是 base64 ──
// 足迹海报要的全国底图是 840×560，PNG 实测约 390KB，转 base64 后 ~520KB。
// 官方文档对 callFunction 的建议临界值是 100KB（"避免触及调用链路的传输大小限制"），
// 520KB 有被网关拦掉的现实风险；一旦拦掉，客户端只会看到矢量回退网格，
// 表现成"地图没了"。所以改成官方推荐的图片回传方式：
//   LBS 取图 → 上传云存储 → 只回一个 fileID（响应 ~100 字节），客户端 downloadFile。
// 这条链路在本环境已有先例：generateShareCode 也是 uploadFile + 客户端 downloadFile，
// 海报底部那个小程序码就是这么拿到并画上去的。
// 纯底图（无 markers/path/labels）与用户足迹无关、对所有用户完全一致，天然适合缓存：
//   同一实例（热调用）直接用模块级 memo 命中，连 LBS 都不再请求。
// 兜底：上传失败时退回 base64（data.src），客户端两条路都认；
//       客户端 downloadFile 失败时可再带 mode:'base64' 调一次。
// 带覆盖物的请求（markers/path/labels）每张都不同，不进缓存，直接回 base64。
//
// key 读取与 URL 拼装统一走共享模块 mapApi，不在本函数出现明文 key。
// 本函数只读写云存储，不碰任何数据库集合（e2e-degrade-verify 有断言守着）。
const cloud = require('wx-server-sdk')
const https = require('https')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { LBS_HOST, getMapKey } = require('./mapApi')

const PATHNAME = '/ws/staticmap/v2/'
const DEFAULT_SIZE = '360*225'
/** 官方文档：宽 50~1680、高 50~1200；scale=2 时建议 ≤900×900 */
const SIZE_MIN = 50
const SIZE_MAX = { 1: { width: 1680, height: 1200 }, 2: { width: 900, height: 900 } }
const ZOOM_MIN = 4
/** scale=2 要求 zoom ≤17，普清可到 18 */
const ZOOM_MAX = { 1: 18, 2: 17 }
/** 所有 markers 参数定义的标注总数上限 */
const MAX_MARKERS_TOTAL = 50
const MAX_ROUTE_POINTS = 800
const MAX_LABELS = 30
/** 单个 labels 文本上限（中文字符） */
const MAX_LABEL_CHARS = 13
/** URL 长度保险丝：客户端已把点数压在上限内，这里只兜底防极端入参 */
const MAX_URL_LENGTH = 7000

/** 底图在云存储里的目录（全国底图对所有用户一致，可长期复用） */
const CACHE_DIR = 'map-snapshots'
/**
 * 热调用记忆：同一实例内命中就不必再请求 LBS、也不必再上传。
 * 冷启动会丢，但丢了也只是重取一次，不影响正确性。
 */
const fileIdMemo = new Map()

/**
 * 32 位 FNV-1a。只用来给缓存文件起名，不需要密码学强度。
 * 刻意不引 crypto：本函数只需一个短标识，少一个依赖少一份冷启动开销。
 * 文件名里同时带上尺寸与 zoom，肉眼可读，也不怕这 32 位撞车。
 */
function hashKey(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * 缓存键：只由「决定这张图长什么样」的参数算出。
 * 刻意不含 key，也不含 markers/path/labels —— 那些是覆盖物，
 * 本函数给海报出的始终是纯底图，同一取景就该复用同一张图。
 */
function cacheKeyOf(params) {
  const signature = [params.size, params.scale, params.maptype, params.center || '', params.zoom || ''].join('|')
  return `${String(params.size).replace('*', 'x')}-z${params.zoom || 0}-${hashKey(signature)}`
}

/** 拉取二进制响应体（静态图接口返回 PNG，不是 JSON） */
function getBuffer(url, timeout) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeout || 8000 }, res => {
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`静态地图服务返回 ${res.statusCode}`))
      }
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('静态地图请求超时')))
  })
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * 拼静态图请求 URL。
 *
 * **为什么不直接用 mapApi.buildUrl**：静态图 API 的 markers 允许同名参数出现多次
 * （一种标记样式一个 markers —— 本函数要用橙色画足迹、绿色画兽聚），而 buildUrl 是
 * 从对象拼参数的，装不下重复 key。给 buildUrl 加数组支持会连带改动共享模块的 7 个
 * 副本、要求全部 sync，代价不成比例；而共享模块真正要守的契约是「key 只在一处」，
 * 这里仍然照旧从 mapApi 取 key 与 host，没有第二条取 key 的路径。
 */
function buildStaticMapUrl(params) {
  const pairs = []
  Object.keys(params).forEach(name => {
    const value = params[name]
    const values = Array.isArray(value) ? value : [value]
    values.forEach(item => {
      if (item === undefined || item === null || item === '') return
      pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(item)}`)
    })
  })
  pairs.push(`key=${encodeURIComponent(getMapKey())}`)
  return `${LBS_HOST}${PATHNAME}?${pairs.join('&')}`
}

/** 解析 '宽*高'（也容忍 x / × 分隔），并按 scale 收紧到官方建议上限 */
function parseSize(raw, scale) {
  const match = /^(\d+)\s*[*x×]\s*(\d+)$/i.exec(String(raw || '').trim())
  if (!match) return null
  const limits = SIZE_MAX[scale] || SIZE_MAX[1]
  return {
    width: clamp(parseInt(match[1], 10), SIZE_MIN, limits.width),
    height: clamp(parseInt(match[2], 10), SIZE_MIN, limits.height)
  }
}

/** 坐标数组 → ['纬度,经度', …]（静态图 API 的坐标一律纬度在前） */
function toLatLngList(raw, max) {
  const list = Array.isArray(raw) ? raw : []
  const out = []
  for (let i = 0; i < list.length && out.length < max; i++) {
    const lat = Number(list[i] && list[i].latitude)
    const lng = Number(list[i] && list[i].longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    out.push(`${lat},${lng}`)
  }
  return out
}

/** 地名标签：样式集 + content|location 成对出现 */
function buildLabels(raw) {
  const items = []
  const list = Array.isArray(raw) ? raw : []
  for (let i = 0; i < list.length && items.length < MAX_LABELS; i++) {
    const text = String((list[i] && list[i].text) || '').trim().slice(0, MAX_LABEL_CHARS)
    const lat = Number(list[i] && list[i].latitude)
    const lng = Number(list[i] && list[i].longitude)
    if (!text || !Number.isFinite(lat) || !Number.isFinite(lng)) continue
    items.push(`${text}|${lat},${lng}`)
  }
  if (!items.length) return ''
  // anchor:3 = 文本块下边框中部对准坐标点，标签落在点的正上方
  return `border:0|size:24|color:0x1A1A1A|bgcolor:0xFFFFFF|anchor:3|${items.join('|')}`
}

/**
 * 把 PNG 传进云存储并返回 fileID；失败返回空串，由调用方退回 base64。
 *
 * 同一个 cloudPath 重复上传是覆盖语义，天然幂等 —— 冷启动重传一次也不会堆垃圾。
 */
async function cacheImage(cacheKey, buf) {
  const cloudPath = `${CACHE_DIR}/${cacheKey}.png`
  try {
    const res = await cloud.uploadFile({ cloudPath, fileContent: buf })
    const fileID = (res && res.fileID) || ''
    if (!fileID) throw new Error('uploadFile 未返回 fileID')
    fileIdMemo.set(cacheKey, fileID)
    return fileID
  } catch (err) {
    console.error('底图上传云存储失败，本次退回 base64:', err)
    return ''
  }
}

exports.main = async (event) => {
  const input = event || {}
  const scale = Number(input.scale) === 2 ? 2 : 1
  const size = parseSize(input.size, scale) || parseSize(DEFAULT_SIZE, scale)
  const zoomLimit = ZOOM_MAX[scale] || ZOOM_MAX[1]
  const zoom = clamp(Math.floor(Number(input.zoom) || 15), ZOOM_MIN, zoomLimit)

  const latitude = Number(input.latitude)
  const longitude = Number(input.longitude)
  const hasCenter = Number.isFinite(latitude) && Number.isFinite(longitude)

  const route = toLatLngList(input.route, MAX_ROUTE_POINTS)
  // 两类标记合计不能超过 50：先给足迹点，剩下的额度给兽聚点
  const footprints = toLatLngList(input.footprints, MAX_MARKERS_TOTAL)
  const furmeets = toLatLngList(input.furmeets, Math.max(0, MAX_MARKERS_TOTAL - footprints.length))
  const hasOverlays = route.length >= 2 || footprints.length > 0 || furmeets.length > 0

  if (!hasCenter && !hasOverlays) {
    return { code: -1, message: '缺少有效的经纬度' }
  }

  const params = {
    size: `${size.width}*${size.height}`,
    scale,
    maptype: 'roadmap'
  }
  // 显式给 center + zoom 而不依赖隐式定位：隐式定位可能选到 zoom=18，
  // 与 scale=2 的 zoom ≤17 冲突，会让单点用户直接取不到图。
  if (hasCenter) {
    params.center = `${latitude},${longitude}`
    params.zoom = zoom
  }

  const markerStyles = []
  if (footprints.length) markerStyles.push(`size:mid|color:orange|${footprints.join('|')}`)
  if (furmeets.length) markerStyles.push(`size:mid|color:green|${furmeets.join('|')}`)
  if (markerStyles.length) params.markers = markerStyles

  if (route.length >= 2) {
    params.path = `color:0xD4890E|weight:5|${route.join('|')}`
  }

  const labels = buildLabels(input.labels)
  if (labels) params.labels = labels

  // mode:'base64' 是客户端 downloadFile 失败时的兜底通道：跳过云存储，直接回 base64。
  // 覆盖物（markers/path/labels）每张图都不一样，不进缓存也不该进 —— 有覆盖物就走 base64。
  const wantsBase64 = String(input.mode || '') === 'base64'
  const cacheKey = cacheKeyOf(params)
  const cacheable = !wantsBase64 && !hasOverlays && !!hasCenter

  if (cacheable) {
    const memoized = fileIdMemo.get(cacheKey)
    if (memoized) {
      console.log(`getMapSnapshot 命中热缓存 key=${cacheKey}`)
      return { code: 0, data: { fileID: memoized, cached: true } }
    }
  }

  // URL 构建放进 try：getMapKey() 在未配置 TENCENT_MAP_KEY 时会抛错，
  // 放在 try 外面会让整个云函数以未捕获异常失败，而不是走下面的降级返回。
  let url = ''
  try {
    url = buildStaticMapUrl(params)
    if (url.length > MAX_URL_LENGTH && params.labels) {
      // 宁可少几个地名标签，也别让整张图取不回来
      delete params.labels
      url = buildStaticMapUrl(params)
    }

    // 超时压到 5s：客户端 app.callCloud 的总超时是 10s，而这个云函数平时几乎不被调用、
    // 基本每次都是冷启动（1~3s）。内部再放 8s 就会撞上客户端超时，
    // 表现为"第一张海报没有真地图、第二张才有"。取不到就退回矢量地图，不值得多等。
    const buf = await getBuffer(url, 5000)
    if (!buf || buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) {
      throw new Error('静态地图返回的不是 PNG 图片')
    }
    if (cacheable) {
      const fileID = await cacheImage(cacheKey, buf)
      if (fileID) {
        console.log(`getMapSnapshot ok size=${params.size} scale=${scale} bytes=${buf.length} → 云存储 ${CACHE_DIR}/${cacheKey}.png`)
        return { code: 0, data: { fileID } }
      }
    }
    console.log(`getMapSnapshot ok size=${params.size} scale=${scale} markers=${footprints.length}+${furmeets.length} route=${route.length} bytes=${buf.length} → base64`)
    return { code: 0, data: { src: `data:image/png;base64,${buf.toString('base64')}` } }
  } catch (err) {
    // 把去掉 key 的请求 URL 一并打出来：这条链路此前从未被调用过，
    // 失败时能把 URL 贴到浏览器里直接看到静态图服务返回的错误原文。
    const safeUrl = url ? url.replace(/key=[^&]+/, 'key=***') : '(URL 未构建成功，多半是缺 TENCENT_MAP_KEY)'
    console.error('getMapSnapshot 失败:', err)
    console.error(`getMapSnapshot 请求 URL（已隐去 key）: ${safeUrl}`)
    return { code: -1, message: '地图快照生成失败', error: String((err && err.message) || err) }
  }
}
