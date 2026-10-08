// 云函数：getCityByLocation
// 通过腾讯位置服务逆地址解析，把经纬度转换为城市名。
// 地图服务的 key 与请求封装统一由 mapApi 提供。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { request } = require('./mapApi')

const UNKNOWN_CITY = '未知城市'

exports.main = async (event) => {
  const latitude = Number(event.latitude)
  const longitude = Number(event.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { code: 0, data: { city: UNKNOWN_CITY }, degraded: true }
  }

  try {
    const payload = await request('/ws/geocoder/v1/', { location: `${latitude},${longitude}` })
    const component = (payload.result && payload.result.address_component) || {}
    // 直辖市的 city 字段可能为空，此时退回 province。
    const city = component.city || component.province || UNKNOWN_CITY
    return { code: 0, data: { city }, degraded: false }
  } catch (err) {
    console.error('城市获取失败:', err)
    // 降级返回默认值，确保页面不报错；degraded 让调用方知道这是兜底结果。
    return { code: 0, data: { city: UNKNOWN_CITY }, degraded: true }
  }
}
