/**
 * 腾讯位置服务（Tencent LBS）统一调用层
 *
 * ── 为什么要有这个模块 ──
 * 项目早期在 getWeather / getCityByLocation / getNearbyMapPoi / suggestPlaces
 * 四个云函数里各自复制了一份 `https.get` 封装和 `MAP_KEY` 常量，并且用的是
 * **腾讯位置服务官方文档的示例 key**。这带来三个问题：
 *   1. key 散落 4 处，换 key 要改 4 个文件、重新部署 4 次，极易漏改；
 *   2. 示例 key 是全网共用的，没有配额保障，随时可能被限流或停用；
 *   3. 每个函数各写一遍请求封装，超时与错误语义不一致。
 * 本模块把以上三点收敛为一处。
 *
 * ── 配置方式（重要）──
 * 在云函数**环境变量**中设置 TENCENT_MAP_KEY = 你在 lbs.qq.com 申请的 key。
 * 申请路径：https://lbs.qq.com/dev/console/key/manage → 创建应用 → 申请 key，
 * key 的「启用产品」需勾选 WebService API，并填写小程序 AppID 授权。
 * 未配置时回落到官方示例 key 并打印警告（保证开发环境可用，但**不可用于生产**）。
 *
 * ── 用法 ──
 *   const { request, distanceMeters, lookupAdcode } = require('./mapApi')
 *   const payload = await request('/ws/geocoder/v1/', { location: '39.98,116.30' })
 *   // payload.status === 0，业务数据在 payload.result
 *
 * 请求失败时会抛错，错误对象带 lbsStatus / lbsMessage，便于调用方区分
 * 「服务不可用」与「参数错误」，不要把这些错误当成业务结论处理。
 */

const https = require('https')

const LBS_HOST = 'https://apis.map.qq.com'
const KEY_ENV = 'TENCENT_MAP_KEY'

/** 腾讯位置服务官方文档中的示例 key。仅供开发兜底，生产必须替换。 */
const DEMO_KEY = '4IUBZ-FRDLA-LREK3-CNEAT-C75D2-H7FRU'

let demoKeyWarned = false

/**
 * 读取地图服务 key。
 * 冷启动时只警告一次，避免每个请求都刷日志。
 */
function getMapKey() {
  const configured = String(process.env[KEY_ENV] || '').trim()
  if (configured) return configured
  if (!demoKeyWarned) {
    demoKeyWarned = true
    console.warn(
      `[mapApi] 未配置环境变量 ${KEY_ENV}，正在使用腾讯位置服务官方示例 key。` +
      '该 key 全网共用、无配额保障、随时可能失效，请尽快配置自有 key。'
    )
  }
  return DEMO_KEY
}

/** 当前是否在用兜底示例 key（供上层决定要不要给出降级提示）。 */
function isUsingDemoKey() {
  return !String(process.env[KEY_ENV] || '').trim()
}

function buildUrl(pathname, params) {
  const pairs = []
  Object.keys(params || {}).forEach(name => {
    const value = params[name]
    if (value === undefined || value === null || value === '') return
    pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
  })
  pairs.push(`key=${encodeURIComponent(getMapKey())}`)
  return `${LBS_HOST}${pathname}?${pairs.join('&')}`
}

/** 发起 GET 并解析 JSON。网络层错误统一抛 Error。 */
function getJson(url, timeout) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeout || 6000 }, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (err) {
          reject(new Error(`腾讯位置服务返回体不是合法 JSON：${String(body).slice(0, 120)}`))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('腾讯位置服务请求超时')))
  })
}

/**
 * 发起一次 WebService 调用。
 *
 * @param {string} pathname 例如 '/ws/geocoder/v1/'
 * @param {object} params 查询参数（key 由本模块自动附加）
 * @param {object} [options] { timeout }
 * @returns {Promise<object>} 完整的腾讯返回体，业务数据在 .result
 * @throws {Error} 网络异常、非 JSON、或 status !== 0
 */
async function request(pathname, params, options) {
  const payload = await getJson(buildUrl(pathname, params), options && options.timeout)
  if (!payload || typeof payload !== 'object') {
    throw new Error('腾讯位置服务返回空响应')
  }
  if (payload.status !== 0) {
    const err = new Error(`腾讯位置服务返回异常(${payload.status})：${payload.message || '未知错误'}`)
    err.lbsStatus = payload.status
    err.lbsMessage = payload.message || ''
    throw err
  }
  return payload
}

/** 两点间大圆距离（米）。任一参数非数值时返回 Infinity，便于比较时自然淘汰。 */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const values = [lat1, lng1, lat2, lng2].map(Number)
  if (!values.every(Number.isFinite)) return Infinity
  const rad = Math.PI / 180
  const dLat = (values[2] - values[0]) * rad
  const dLng = (values[3] - values[1]) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(values[0] * rad) * Math.cos(values[2] * rad) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** 城市名归一化：去掉「市 / 地区 / 盟 / 自治州 / 特别行政区」后缀。 */
function normalizeCityName(value) {
  return String(value || '').trim().replace(/(市|地区|盟|自治州|特别行政区)$/g, '')
}

/**
 * 内置城市表 —— **云端城市数据的唯一母本**（名称 / 坐标 / adcode）。
 *
 * ── 为什么需要它 ──
 * 此前「城市」这件事被维护成了三份互不相干的数据：
 *   1. getWeather 里硬编码的 46 条 城市名→adcode 映射；
 *   2. 前端 config/cities.js 里的 47 条 城市名→经纬度；
 *   3. 数据库 city_candidates 集合（运营可热更新，但**当时是空的**）。
 * 三份互相不知道对方，新增城市要改多处、还容易只改一半。
 *
 * 现在收敛为：本表是云端权威源，CITY_ADCODES 由它派生；getCityCandidates
 * 在集合为空时回退到它，保证城市选择器不会因为「集合没数据」而变成空列表。
 * 前端 config/cities.js 仍保留一份（首屏无需等网络），改动时请以本表为准。
 */
const CITY_PRESETS = [
  { name: '上海', lat: 31.2304, lng: 121.4737, adcode: '310000' },
  { name: '北京', lat: 39.9042, lng: 116.4074, adcode: '110000' },
  { name: '广州', lat: 23.1291, lng: 113.2644, adcode: '440100' },
  { name: '深圳', lat: 22.5431, lng: 114.0579, adcode: '440300' },
  { name: '杭州', lat: 30.2741, lng: 120.1551, adcode: '330100' },
  { name: '成都', lat: 30.5728, lng: 104.0668, adcode: '510100' },
  { name: '南京', lat: 32.0603, lng: 118.7969, adcode: '320100' },
  { name: '武汉', lat: 30.5928, lng: 114.3055, adcode: '420100' },
  { name: '重庆', lat: 29.5630, lng: 106.5516, adcode: '500000' },
  { name: '西安', lat: 34.3416, lng: 108.9398, adcode: '610100' },
  { name: '苏州', lat: 31.2989, lng: 120.5853, adcode: '320500' },
  { name: '天津', lat: 39.3434, lng: 117.3616, adcode: '120000' },
  { name: '青岛', lat: 36.0671, lng: 120.3826, adcode: '370200' },
  { name: '长沙', lat: 28.2282, lng: 112.9388, adcode: '430100' },
  { name: '郑州', lat: 34.7466, lng: 113.6254, adcode: '410100' },
  { name: '合肥', lat: 31.8206, lng: 117.2272, adcode: '340100' },
  { name: '福州', lat: 26.0745, lng: 119.2965, adcode: '350100' },
  { name: '厦门', lat: 24.4798, lng: 118.0894, adcode: '350200' },
  { name: '宁波', lat: 29.8683, lng: 121.5440, adcode: '330200' },
  { name: '无锡', lat: 31.4912, lng: 120.3124, adcode: '320200' },
  { name: '常州', lat: 31.8107, lng: 119.9741, adcode: '320400' },
  { name: '南通', lat: 31.9802, lng: 120.8943, adcode: '320600' },
  { name: '扬州', lat: 32.3932, lng: 119.4129, adcode: '321000' },
  { name: '济南', lat: 36.6512, lng: 117.1201, adcode: '370100' },
  { name: '烟台', lat: 37.4645, lng: 121.4479, adcode: '370600' },
  { name: '大连', lat: 38.9140, lng: 121.6147, adcode: '210200' },
  { name: '沈阳', lat: 41.8057, lng: 123.4315, adcode: '210100' },
  { name: '长春', lat: 43.8171, lng: 125.3235, adcode: '220100' },
  { name: '哈尔滨', lat: 45.8038, lng: 126.5349, adcode: '230100' },
  { name: '石家庄', lat: 38.0428, lng: 114.5149, adcode: '130100' },
  { name: '太原', lat: 37.8706, lng: 112.5489, adcode: '140100' },
  { name: '呼和浩特', lat: 40.8426, lng: 111.7492, adcode: '150100' },
  { name: '洛阳', lat: 34.6197, lng: 112.4540, adcode: '410300' },
  { name: '南昌', lat: 28.6820, lng: 115.8579, adcode: '360100' },
  { name: '昆明', lat: 25.0389, lng: 102.7183, adcode: '530100' },
  { name: '贵阳', lat: 26.6470, lng: 106.6302, adcode: '520100' },
  { name: '南宁', lat: 22.8170, lng: 108.3669, adcode: '450100' },
  { name: '海口', lat: 20.0444, lng: 110.1999, adcode: '460100' },
  { name: '三亚', lat: 18.2528, lng: 109.5119, adcode: '460200' },
  { name: '兰州', lat: 36.0611, lng: 103.8343, adcode: '620100' },
  { name: '银川', lat: 38.4872, lng: 106.2309, adcode: '640100' },
  { name: '西宁', lat: 36.6171, lng: 101.7782, adcode: '630100' },
  { name: '乌鲁木齐', lat: 43.8256, lng: 87.6168, adcode: '650100' },
  { name: '拉萨', lat: 29.6525, lng: 91.1721, adcode: '540100' },
  { name: '香港', lat: 22.3193, lng: 114.1694, adcode: '810000' },
  { name: '澳门', lat: 22.1987, lng: 113.5439, adcode: '820000' },
  { name: '台北', lat: 25.0330, lng: 121.5654, adcode: '710100' }
]

/** 城市名 → 行政区划编码。由 CITY_PRESETS 派生，不再单独维护。 */
const CITY_ADCODES = CITY_PRESETS.reduce((acc, city) => {
  acc[city.name] = city.adcode
  return acc
}, {})

/** 按城市名查 adcode，查不到返回空串。 */
function lookupAdcode(cityName) {
  return CITY_ADCODES[normalizeCityName(cityName)] || ''
}

/** 城市选择器用的精简列表（城市名 + 坐标）。 */
function listCities() {
  return CITY_PRESETS.map(city => ({ name: city.name, lat: city.lat, lng: city.lng }))
}

module.exports = {
  LBS_HOST,
  KEY_ENV,
  DEMO_KEY,
  getMapKey,
  isUsingDemoKey,
  buildUrl,
  getJson,
  request,
  distanceMeters,
  normalizeCityName,
  lookupAdcode,
  listCities,
  CITY_PRESETS,
  CITY_ADCODES
}
