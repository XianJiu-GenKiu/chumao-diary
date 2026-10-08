// 云函数：getWeather
// 通过腾讯位置服务（WebService API）查询指定城市/坐标的当前天气。
//
// 设计要点：**查不到就明确返回无数据，绝不返回编造的天气。**
// 早期实现在接口异常或字段缺失时返回硬编码的 28℃ / 晴 / 湿度 65，
// 前端 wxml 还叠了一层 `{{weatherData.temperature || '28'}}` 兜底，
// 两处假数据互相掩护，导致「天气早就坏了却没人发现」。现在统一为 data: null，
// 由前端显式渲染无数据态。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { request, normalizeCityName, lookupAdcode } = require('./mapApi')

/** 由经纬度逆解析 adcode（城市名查表失败时的兜底路径）。 */
async function getAdcodeByLocation(latitude, longitude) {
  if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) return ''
  const payload = await request('/ws/geocoder/v1/', { location: `${latitude},${longitude}` })
  const adInfo = payload.result && payload.result.ad_info
  return adInfo && adInfo.adcode ? String(adInfo.adcode) : ''
}

/** 风力文案 → 等级。查不到时返回 null，不再假装是 3 级。 */
const WIND_POWER_LEVELS = {
  '无风': 0, '微风': 1, '1级': 1, '1-2级': 1, '2级': 2, '2-3级': 2, '3级': 3,
  '4级': 4, '5级': 5, '6级': 6, '7级': 7, '8级': 8
}

/** 能转成数字就取整，否则返回 null —— 不填充默认值。 */
function toNumberOrNull(value) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.round(num) : null
}

exports.main = async (event) => {
  const city = normalizeCityName(event.city)
  const latitude = Number(event.latitude)
  const longitude = Number(event.longitude)

  try {
    let adcode = lookupAdcode(city)
    if (!adcode) adcode = await getAdcodeByLocation(latitude, longitude)
    if (!adcode) {
      // 既没有可用城市名，也拿不到坐标 —— 无从查询，明确告知无数据。
      return { code: 0, data: null, degraded: true, reason: 'no_location' }
    }

    const payload = await request('/ws/weather/v1/', { adcode, type: 'now' })
    const realtime = payload.result && Array.isArray(payload.result.realtime)
      ? payload.result.realtime[0]
      : null
    if (!realtime) {
      return { code: 0, data: null, degraded: true, reason: 'empty_result' }
    }

    const infos = realtime.infos || {}
    const windText = infos.wind_power_v2 || infos.wind_power || ''
    return {
      code: 0,
      degraded: false,
      data: {
        temperature: toNumberOrNull(infos.temperature),
        humidity: toNumberOrNull(infos.humidity),
        wind: WIND_POWER_LEVELS[windText] !== undefined ? WIND_POWER_LEVELS[windText] : null,
        windDisplay: windText || '',
        windDirection: infos.wind_direction || '',
        airPressure: toNumberOrNull(infos.air_pressure),
        condition: infos.weather || '',
        city: city || realtime.city || realtime.province || '',
        adcode: String(realtime.adcode || adcode),
        updateTime: realtime.update_time || ''
      }
    }
  } catch (err) {
    console.error('天气获取失败:', err)
    return { code: 0, data: null, degraded: true, reason: String((err && err.message) || err) }
  }
}
