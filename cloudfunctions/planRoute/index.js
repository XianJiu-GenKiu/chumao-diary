// 云函数：planRoute
// 用腾讯位置服务「路线规划」接口，算出多点之间的**真实路网**路径与距离。
//
// ── 为什么需要它 ──
// 此前 pages/route-plan 是用 haversine 把相邻两点连成直线：既没有走真实道路，
// 里程也只是「点到点直线距离之和」，比实际路程短得多。用户看到的那条折线
// 和「约 x km」都是估算，容易误导出行安排。
//
// ── 坐标系 ──
// 腾讯位置服务的 direction 接口使用 gcj02 坐标。小程序 wx.getLocation({type:'gcj02'})
// 与 wx.chooseLocation 返回的也都是 gcj02，因此可直接传入，无需转换。
//
// ── 调用形态 ──
// direction 接口一次只算两点之间，因此 N 个地点需要 N-1 次请求。这里并发发起
// （受 MAX_LEGS 限制），失败时逐段降级：能算出几段就用几段，一段都算不出时
// 返回 degraded=true，由前端回退到直线示意。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { request } = require('./mapApi')

/** 支持出行方式；transit（公交）不接受纯坐标，故不在此列。 */
const MODES = ['driving', 'walking', 'bicycling']
const DEFAULT_MODE = 'driving'

/** 单次请求可规划的最大段数，避免点位过多导致超时与配额浪费。 */
const MAX_LEGS = 10

function toPoint(value) {
  if (!value) return null
  const latitude = Number(value.latitude)
  const longitude = Number(value.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return { latitude, longitude }
}

/**
 * 解压腾讯位置服务返回的 polyline。
 *
 * 压缩格式：前两个数是起点的纬度、经度；此后每两个数为一组，
 * 分别是纬度、经度相对**同类型上一个值**的增量，单位百万分之一度。
 * 官方给的解压方式是 `coors[i] = coors[i - 2] + coors[i] / 1e6`，
 * 注意是回看两个位置（同一维度），不是回看一个位置。
 */
function decodePolyline(polyline) {
  if (!Array.isArray(polyline) || polyline.length < 2) return []
  const coords = polyline.slice()
  for (let i = 2; i < coords.length; i++) {
    coords[i] = coords[i - 2] + coords[i] / 1000000
  }
  const points = []
  for (let i = 0; i + 1 < coords.length; i += 2) {
    const latitude = Number(coords[i])
    const longitude = Number(coords[i + 1])
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      points.push({ latitude, longitude })
    }
  }
  return points
}

/** 规划相邻两点之间的一段路线。 */
async function planLeg(from, to, mode) {
  const payload = await request(`/ws/direction/v1/${mode}/`, {
    from: `${from.latitude},${from.longitude}`,
    to: `${to.latitude},${to.longitude}`
  }, { timeout: 8000 })

  const routes = payload.result && payload.result.routes
  const route = Array.isArray(routes) ? routes[0] : null
  if (!route) throw new Error('腾讯位置服务未返回路线')

  return {
    distance: Number(route.distance) || 0,
    duration: Number(route.duration) || 0,
    points: decodePolyline(route.polyline)
  }
}

exports.main = async (event) => {
  const mode = MODES.includes(event.mode) ? event.mode : DEFAULT_MODE
  const rawPoints = Array.isArray(event.points) ? event.points : []
  const points = rawPoints.map(toPoint).filter(Boolean)

  if (points.length < 2) {
    return { code: -1, message: '至少需要两个有效坐标点才能规划路线' }
  }

  const legs = []
  for (let i = 0; i + 1 < points.length && legs.length < MAX_LEGS; i++) {
    legs.push([points[i], points[i + 1]])
  }

  const results = await Promise.all(legs.map(([from, to]) =>
    planLeg(from, to, mode).catch(err => {
      console.warn('路线分段规划失败:', err.message)
      return null
    })
  ))

  const succeeded = results.filter(Boolean)
  if (!succeeded.length) {
    // 一段都没算出来：明确告知降级，让前端退回直线示意而不是展示错误里程。
    return { code: 0, data: null, degraded: true, reason: 'all_legs_failed', mode }
  }

  let distance = 0
  let duration = 0
  const polyline = []
  succeeded.forEach((leg, index) => {
    distance += leg.distance
    duration += leg.duration
    // 相邻段的首尾点是同一个地点，拼接时跳过重复点避免折线出现回折。
    const start = index === 0 ? 0 : 1
    for (let i = start; i < leg.points.length; i++) polyline.push(leg.points[i])
  })

  return {
    code: 0,
    degraded: succeeded.length < legs.length,
    data: {
      mode,
      distance: Math.round(distance),
      duration: Math.round(duration),
      polyline,
      legs: succeeded.map(leg => ({ distance: leg.distance, duration: leg.duration })),
      plannedLegs: succeeded.length,
      totalLegs: legs.length
    }
  }
}
