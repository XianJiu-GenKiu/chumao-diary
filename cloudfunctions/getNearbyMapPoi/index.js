// 云函数：getNearbyMapPoi
// 支持地图点击识别，以及按餐饮 / 商场 / 交通 / 补给分类查询周边 POI。
// 地图服务的 key、请求封装与距离计算统一由 mapApi 提供。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const { request, distanceMeters } = require('./mapApi')

const SEARCH_RADIUS = 1000
const CLICK_RADIUS = 200
const MAX_RESULTS = 3
const CATEGORY_MAX_RESULTS = 5
const MATCH_DISTANCE_METERS = 60
const CANDIDATE_SCAN_LIMIT = 100

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, '').replace(/[（(].*?[)）]/g, '').toLowerCase()
}

function findMatchedLocation(poi, locations) {
  const poiName = normalizeName(poi.name)
  let best = null
  let bestDistance = Infinity
  locations.forEach(location => {
    const meters = distanceMeters(poi.latitude, poi.longitude, location.latitude, location.longitude)
    if (!Number.isFinite(meters) || meters > MATCH_DISTANCE_METERS) return
    const locationName = normalizeName(location.name)
    const sameName = poiName && locationName && (poiName === locationName || poiName.includes(locationName) || locationName.includes(poiName))
    if ((meters <= 30 || (sameName && meters <= MATCH_DISTANCE_METERS)) && meters < bestDistance) {
      best = location
      bestDistance = meters
    }
  })
  return best
}

function mapPoi(item, requestedCategory = '') {
  const location = item.location || {}
  return {
    externalId: String(item.id || ''),
    name: item.title || '',
    address: item.address || '',
    category: item.category || '',
    serviceCategory: requestedCategory || '',
    latitude: Number(location.lat),
    longitude: Number(location.lng),
    distance: Number(item._distance)
  }
}

function mapLocalServiceLocation(location, latitude, longitude) {
  const serviceCategory = location.serviceCategory || location.category || ''
  return {
    externalId: `local:${location._id}`,
    locationId: location._id,
    name: location.name || '',
    address: location.address || '',
    category: serviceCategory,
    serviceCategory,
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    distance: distanceMeters(latitude, longitude, location.latitude, location.longitude),
    collectionStatus: 'collected',
    matchedLocationId: location._id,
    source: 'local'
  }
}

async function fetchExplorePois(latitude, longitude) {
  const boundary = `nearby(${latitude},${longitude},${CLICK_RADIUS},0)`
  const payload = await request('/ws/place/v1/explore', {
    boundary,
    policy: 1,
    page_size: MAX_RESULTS,
    page_index: 1,
    orderby: '_distance'
  })
  if (!Array.isArray(payload.data)) throw new Error('腾讯位置服务未返回地点列表')
  return payload.data
    .map(item => mapPoi(item))
    .filter(item => item.name && Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
}

async function fetchKeywordPois(latitude, longitude, keyword, category) {
  const boundary = `nearby(${latitude},${longitude},${SEARCH_RADIUS},0)`
  const payload = await request('/ws/place/v1/search', {
    keyword,
    boundary,
    page_size: CATEGORY_MAX_RESULTS,
    page_index: 1,
    orderby: '_distance'
  })
  if (!Array.isArray(payload.data)) throw new Error('腾讯位置服务未返回分类地点列表')
  return payload.data
    .map(item => mapPoi(item, category))
    .filter(item => item.name && Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
}

async function fetchByCategories(latitude, longitude, categoryQueries) {
  const entries = Object.entries(categoryQueries || {})
  const groups = await Promise.all(entries.map(async ([category, keywords]) => {
    const list = Array.isArray(keywords) ? keywords : [keywords]
    const results = await Promise.all(list.filter(Boolean).map(keyword => fetchKeywordPois(latitude, longitude, keyword, category).catch(err => {
      console.error(`分类 ${category} / ${keyword} 查询失败`, err)
      return []
    })))
    const seen = new Set()
    return results.flat().sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity)).filter(item => {
      const key = item.externalId || `${item.name}|${item.latitude}|${item.longitude}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, CATEGORY_MAX_RESULTS)
  }))
  return groups.flat()
}

exports.main = async (event) => {
  const latitude = Number(event.latitude)
  const longitude = Number(event.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { code: -1, message: '缺少有效的经纬度' }

  let rawPois = []
  let categorized = false
  try {
    if (event.categoryQueries && typeof event.categoryQueries === 'object') {
      categorized = true
      rawPois = await fetchByCategories(latitude, longitude, event.categoryQueries)
    } else {
      rawPois = await fetchExplorePois(latitude, longitude)
    }
  } catch (err) {
    console.error('周边地点查询失败:', err)
    return { code: 0, data: { pois: [], degraded: true, reason: String(err && err.message || err) } }
  }

  let locations = []
  try {
    const result = await db.collection('locations').field({ _id: true, name: true, address: true, category: true, isServiceLocation: true, serviceCategory: true, latitude: true, longitude: true }).limit(CANDIDATE_SCAN_LIMIT).get()
    locations = result.data || []
  } catch (err) {
    console.error('读取内部地点失败:', err)
  }

  let enriched = rawPois.map(poi => {
    const matched = findMatchedLocation(poi, locations)
    return { ...poi, collectionStatus: matched ? 'collected' : 'not_collected', matchedLocationId: matched ? matched._id : '' }
  })
  if (categorized) {
    const categoryOrder = Object.keys(event.categoryQueries || {})
    const localServices = locations
      .filter(item => item.isServiceLocation || item.serviceCategory)
      .map(item => mapLocalServiceLocation(item, latitude, longitude))
      .filter(item => item.name && Number.isFinite(item.latitude) && Number.isFinite(item.longitude) && item.distance <= SEARCH_RADIUS)
    const merged = []
    categoryOrder.forEach(category => {
      const local = localServices.filter(item => item.serviceCategory === category).sort((a, b) => a.distance - b.distance)
      const remote = enriched.filter(item => item.serviceCategory === category)
      const seen = new Set()
      local.concat(remote).forEach(item => {
        const key = item.externalId || `${item.name}|${item.latitude}|${item.longitude}`
        if (!seen.has(key)) { seen.add(key); merged.push(item) }
      })
    })
    enriched = merged
  }
  return { code: 0, data: { pois: enriched, degraded: false, categorized } }
}
