// 云函数：suggestPlaces
// 调用腾讯位置服务「关键词输入提示」，用于地点搜索的联想补全。
// 地图服务的 key 与请求封装统一由 mapApi 提供。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { request } = require('./mapApi')

exports.main = async (event) => {
  const keyword = String(event.keyword || '').trim()
  const region = event.region || '全国'

  if (!keyword) {
    return { code: 0, data: [] }
  }

  try {
    const payload = await request('/ws/place/v1/suggestion', {
      keyword,
      region,
      page_size: 6
    })

    const raw = Array.isArray(payload.data) ? payload.data : []
    const list = raw.map(item => {
      const location = item.location || {}
      return {
        _id: item.id || `${item.title || ''}|${location.lat || ''}`,
        name: item.title || '',
        address: item.address || '',
        category: item.category || '',
        latitude: location.lat !== undefined ? location.lat : null,
        longitude: location.lng !== undefined ? location.lng : null,
        _type: 'map_poi'
      }
    }).filter(item => item.name)

    return { code: 0, data: list }
  } catch (err) {
    console.error('suggestPlaces 调用失败:', err.message)
    return { code: -1, data: [], message: err.message }
  }
}
