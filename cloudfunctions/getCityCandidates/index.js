// 云函数：getCityCandidates
// 返回城市选择器可用的城市列表。
//
// 数据来源两级：
//   1) 数据库 city_candidates 集合 —— 运营可在不发版的情况下增删城市
//      （文档形如 { name, lat, lng, enabled: true, priority: number }）；
//   2) 内置城市表（mapApi.CITY_PRESETS）—— 集合为空或读取失败时兜底。
//
// 为什么需要第 2 级：此前集合为空时本函数直接返回空数组，城市选择器
// 会退化成「只有当前定位城市」一项，而调用方无从判断这究竟是「运营清空了
// 列表」还是「数据根本没配」。现在始终返回可用列表，并用 source 标明来源。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const { listCities } = require('./mapApi')

exports.main = async () => {
  try {
    const result = await db.collection('city_candidates')
      .where({ enabled: true })
      .orderBy('priority', 'asc')
      .limit(100)
      .get()

    const cities = (result.data || [])
      .filter(city => city && typeof city.name === 'string' && Number.isFinite(Number(city.lat)) && Number.isFinite(Number(city.lng)))
      .map(city => ({ name: city.name.trim(), lat: Number(city.lat), lng: Number(city.lng) }))

    if (cities.length) {
      return { code: 0, data: cities, source: 'collection' }
    }
  } catch (err) {
    // 集合不存在（首次部署）或读取失败：不让城市选择器变成空列表。
    console.warn('city_candidates 读取失败，回退内置城市表:', err.message)
  }

  return { code: 0, data: listCities(), source: 'builtin' }
}
