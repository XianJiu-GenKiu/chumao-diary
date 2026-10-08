const app = getApp()
const { parseSceneId } = require('../../utils/scene')

/** 可选的出行方式，与云函数 planRoute 支持的 mode 保持一致。 */
const ROUTE_MODES = [
  { key: 'driving', label: '驾车' },
  { key: 'walking', label: '步行' },
  { key: 'bicycling', label: '骑行' }
]

/** 两点间大圆距离（米），仅用于最近邻排序与直线示意。 */
function distance(a, b) {
  const rad = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * rad
  const dLng = (b.longitude - a.longitude) * rad
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function formatDistance(meters) {
  const value = Number(meters)
  if (!Number.isFinite(value) || value <= 0) return '—'
  return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`
}

function formatDuration(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return ''
  const minutes = Math.max(Math.round(value / 60), 1)
  if (minutes < 60) return `约 ${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `约 ${hours} 小时 ${rest} 分` : `约 ${hours} 小时`
}

Page({
  data: {
    collection: null,
    collectionId: '',
    route: [],
    markers: [],
    polyline: [],
    modes: ROUTE_MODES,
    routeMode: 'driving',
    distanceText: '—',
    durationText: '',
    // true 表示当前展示的是直线示意，而非真实路网路径
    routeDegraded: false,
    routePlanning: false,
    loading: true,
    error: ''
  },

  onLoad(options) {
    // 用于丢弃过期的路线规划响应（用户可能连续切换出行方式）
    this._routeSeq = 0
    // 合集海报的小程序码通过 scene 传参，必须与 options.id 一并解析。
    const id = parseSceneId(options)
    if (!id) {
      this.setData({ loading: false, error: '合集链接已失效' })
      return
    }
    this._load(id)
  },

  async _load(id) {
    this.setData({ loading: true, error: '', collectionId: id, routePlanning: false })
    try {
      const res = await app.callCloud('manageCollections', { action: 'detail', collectionId: id })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '加载路线失败')
      const locations = (res.data.locations || []).filter(item => Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude)))
      const start = await new Promise(resolve => wx.getLocation({ type: 'gcj02', success: resolve, fail: () => resolve(null) }))
      const route = this._buildRoute(locations, start)
      this._renderRoute(res.data, route)
      // 真实路径依赖网络，先让点位与直线示意可见，再异步替换。
      this._planRoute(route)
    } catch (err) {
      this.setData({ error: err.message || '加载失败，请重试' })
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 渲染点位、标注与直线示意；真实里程稍后由 _planRoute 覆盖。 */
  _renderRoute(collection, route) {
    let straight = 0
    for (let i = 1; i < route.length; i++) straight += distance(route[i - 1], route[i])
    this.setData({
      collection,
      route,
      markers: route.map((item, index) => ({
        id: index, latitude: item.latitude, longitude: item.longitude, width: 30, height: 30,
        callout: { content: `${index + 1}. ${item.name}`, display: index === 0 || index === route.length - 1 ? 'ALWAYS' : 'BYCLICK', padding: 6, borderRadius: 6 }
      })),
      polyline: route.length > 1 ? [{ points: route.map(item => ({ latitude: item.latitude, longitude: item.longitude })), color: '#D4890E', width: 5, dottedLine: true, arrowLine: true }] : [],
      // 直线距离只是过渡态，明确标注「直线」以免被误当成实际路程。
      distanceText: straight > 0 ? `直线约 ${formatDistance(straight)}` : '—',
      durationText: '',
      routeDegraded: false
    })
  },

  /** 调云函数取真实路网路径与里程，成功则替换直线示意。 */
  async _planRoute(route) {
    if (!route || route.length < 2) return
    const points = route.map(item => ({ latitude: Number(item.latitude), longitude: Number(item.longitude) }))
    const seq = ++this._routeSeq
    this.setData({ routePlanning: true })
    try {
      const res = await app.callCloud('planRoute', { points, mode: this.data.routeMode })
      if (seq !== this._routeSeq) return
      const data = res && res.code === 0 ? res.data : null
      if (data && Array.isArray(data.polyline) && data.polyline.length > 1) {
        this.setData({
          polyline: [{ points: data.polyline, color: '#D4890E', width: 5, dottedLine: false, arrowLine: true }],
          distanceText: formatDistance(data.distance),
          durationText: formatDuration(data.duration),
          routeDegraded: !!res.degraded,
          routePlanning: false
        })
      } else {
        // 规划不可用：保留直线示意并如实告知，不展示编造的里程。
        this.setData({ routeDegraded: true, routePlanning: false })
      }
    } catch (err) {
      if (seq !== this._routeSeq) return
      this.setData({ routeDegraded: true, routePlanning: false })
    }
  },

  onModeTap(e) {
    const mode = e.currentTarget.dataset.mode
    if (!mode || mode === this.data.routeMode) return
    this.setData({ routeMode: mode })
    this._planRoute(this.data.route)
  },

  /** 最近邻排序：从当前位置出发，每次挑选距离最近的下一个地点。 */
  _buildRoute(locations, start) {
    const pending = locations.slice()
    const route = []
    let cursor
    if (start && Number.isFinite(Number(start.latitude))) {
      cursor = { latitude: start.latitude, longitude: start.longitude }
    } else if (pending.length) {
      cursor = pending.shift()
      route.push(cursor)
    } else return route
    while (pending.length) {
      let bestIndex = 0
      let bestDistance = Infinity
      pending.forEach((item, index) => {
        const value = distance(cursor, item)
        if (value < bestDistance) { bestDistance = value; bestIndex = index }
      })
      const next = pending.splice(bestIndex, 1)[0]
      route.push(next)
      cursor = next
    }
    return route
  },

  openLocation(e) {
    const item = this.data.route[e.currentTarget.dataset.index]
    if (item) wx.openLocation({ latitude: Number(item.latitude), longitude: Number(item.longitude), name: item.name || '', address: item.address || '', scale: 16 })
  },

  removeLocation(e) {
    const item = this.data.route[e.currentTarget.dataset.index]
    if (!item || !this.data.collectionId) return
    wx.showModal({ title: '移出合集', content: `确定将“${item.name}”移出当前合集吗？`, success: async result => {
      if (!result.confirm) return
      try {
        const res = await app.callCloud('manageCollections', { action: 'removeLocation', collectionId: this.data.collectionId, locationId: item._id })
        if (!res || res.code !== 0) throw new Error((res && res.message) || '操作失败')
        wx.showToast({ title: '已移出合集', icon: 'success' })
        this._load(this.data.collectionId)
      } catch (err) { wx.showToast({ title: err.message || '操作失败', icon: 'none' }) }
    } })
  },

  onRetry() { if (this.data.collectionId) this._load(this.data.collectionId) },

  onShareCard() {
    if (this.data.collectionId) wx.navigateTo({ url: `/pages/share-card/share-card?type=collection&id=${this.data.collectionId}` })
  },

  onShareAppMessage() {
    return { title: (this.data.collection && this.data.collection.name) || '出毛地点合集', path: `/pages/route-plan/route-plan?id=${this.data.collectionId}` }
  }
})
