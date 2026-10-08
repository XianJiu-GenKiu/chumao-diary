const app = getApp()

const CATEGORY_MAP = [
  { category: '餐饮', match: /餐饮|美食|餐厅|咖啡|火锅|烧烤|茶馆|酒吧|小吃/, kind: 'food', icon: 'home' },
  { category: '商场', match: /购物|商场|商业|超市|百货|市场/, kind: 'mall', icon: 'clipboard' },
  { category: '交通', match: /地铁|公交|车站|停车|交通|机场|码头/, kind: 'transport', icon: 'navigation' },
  { category: '补给', match: /便利|药店|医院|厕所|卫生间|户外|补给/, kind: 'supply', icon: 'plus-circle' }
]

function mapCategory(value) {
  const text = String(value || '')
  return CATEGORY_MAP.find(item => item.match.test(text)) || { category: '补给', kind: 'supply', icon: 'map-pin' }
}

function formatDistance(value) {
  const meters = Number(value)
  if (!Number.isFinite(meters)) return '距离未知'
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`
}

Page({
  data: {
    locationId: '', locationName: '当前地点', latitude: null, longitude: null,
    activeCategory: '全部', categories: ['全部', '餐饮', '商场', '交通', '补给'],
    weather: '—', services: [], displayServices: [], loading: false,
    degraded: false, errorMessage: ''
  },

  onLoad(options) {
    const latitude = Number(options.lat)
    const longitude = Number(options.lng)
    this.setData({
      locationId: options.id || '',
      locationName: options.name ? decodeURIComponent(options.name) : '当前地点',
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null
    })
    this.loadNearby()
  },

  async loadNearby() {
    const { latitude, longitude } = this.data
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      this.setData({ errorMessage: '暂无有效坐标，无法查询周边地点' })
      return
    }
    this.setData({ loading: true, errorMessage: '' })
    try {
      const res = await app.callCloud('getNearbyMapPoi', {
        latitude,
        longitude,
        // 每个服务类别独立检索，云函数每类最多返回 5 个最近 POI。
        categoryQueries: {
          餐饮: ['餐厅', '餐饮', '咖啡'],
          商场: ['商场', '购物中心', '超市'],
          交通: ['地铁站', '公交站', '停车场'],
          补给: ['便利店', '药店', '卫生间']
        }
      })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '周边查询失败')
      const raw = (res.data && res.data.pois) || []
      const services = raw.map(item => {
        const serviceCategory = item.serviceCategory || item.category
        const type = mapCategory(serviceCategory)
        return {
          id: item.externalId || `${item.latitude},${item.longitude}`,
          kind: type.kind, icon: type.icon, category: type.category,
          name: item.name, address: item.address || '暂无地址',
          latitude: item.latitude, longitude: item.longitude,
          distance: formatDistance(item.distance),
          distanceMeters: Number(item.distance) || 0,
          meta: item.source === 'local' ? '出毛日记用户地点' : (item.category || '腾讯地图周边 POI'),
          locationId: item.locationId || item.matchedLocationId || '',
          source: item.source || 'tencent',
          tags: [item.source === 'local' ? '出毛日记已收录' : '腾讯地图 POI']
        }
      })
      this.setData({ services, displayServices: services, degraded: !!(res.data && res.data.degraded) })
    } catch (err) {
      console.error('加载真实周边 POI 失败', err)
      this.setData({ services: [], displayServices: [], errorMessage: '周边地点暂时无法加载，请稍后重试' })
    } finally {
      this.setData({ loading: false })
    }
  },

  goBack() { wx.navigateBack() },

  switchCategory(e) {
    const category = e.currentTarget.dataset.category
    this.setData({ activeCategory: category, displayServices: category === '全部' ? this.data.services : this.data.services.filter(item => item.category === category) })
  },

  openService(e) {
    const item = e.currentTarget.dataset.item
    if (!item) return
    wx.showModal({ title: item.name, content: `${item.address}\n${item.meta}\n距离：${item.distance}`, showCancel: false })
  },

  openMap(e) {
    const item = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.item
    const target = item || { latitude: this.data.latitude, longitude: this.data.longitude, name: this.data.locationName }
    if (!Number.isFinite(Number(target.latitude)) || !Number.isFinite(Number(target.longitude))) return wx.showToast({ title: '暂无有效坐标', icon: 'none' })
    wx.openLocation({ latitude: Number(target.latitude), longitude: Number(target.longitude), name: target.name || '周边地点', address: target.address || '', scale: 16 })
  },

  retry() { this.loadNearby() }
})
