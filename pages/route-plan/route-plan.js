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
    // true = 我自己的合集（可编辑）；false = 从分享链接进入（只读）
    isOwner: false,
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
      const route = this._buildRoute(locations)
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
      isOwner: !!collection.isOwner,
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

  /**
   * 组装路线点位。
   * 降级版默认遵循用户保存的合集顺序（服务端按 locationIds 顺序返回），
   * 不再自动重排——点位由用户挑选、顺序由用户决定，程序只负责展示。
   */
  _buildRoute(locations) {
    return locations.slice()
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

  async onShareCard() {
    if (!this.data.collectionId) return
    // 自己的合集：先显式置为公开（唯一对外出口）再生成海报。
    // 他人分享进入的合集本就已公开，直接进海报页。
    if (this.data.isOwner) {
      try {
        const res = await app.callCloud('manageCollections', { action: 'share', collectionId: this.data.collectionId })
        if (!res || res.code !== 0) throw new Error((res && res.message) || '分享失败')
      } catch (err) {
        wx.showToast({ title: err.message || '分享失败', icon: 'none' })
        return
      }
    }
    wx.navigateTo({ url: `/pages/share-card/share-card?type=collection&id=${this.data.collectionId}` })
  },

  onShareAppMessage() {
    return { title: (this.data.collection && this.data.collection.title) || '出毛地点合集', path: `/pages/route-plan/route-plan?id=${this.data.collectionId}` }
  }
})
