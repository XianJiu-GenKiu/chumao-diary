/**
 * 找场地 / 拍摄地周边服务
 *
 * 双模式：
 * - place 模式（带 id/name/lat/lng 进入）：固定查看某个地点的周边 —— 原有语义不变；
 * - finder 模式（不带参数进入，从发现页「找场地」入口）：先选位置再查周边设施。
 *
 * 设施检索说明（合规与实现要点）：
 * - 关键词分组（categoryQueries）由客户端传入，云函数不需要改 —— 新增设施类型
 *   只是在前端多写一组关键词；
 * - 「更衣室 / 厕所」在腾讯地图 POI 库召回偏少，因此每类都用多关键词兜底；
 * - 检索结果来自腾讯地图实时数据（平台数据，非用户产出）。
 */

const app = getApp()
const { debounce } = require('../../utils/common.js')

/** 设施类型 → 检索关键词组（多关键词兜底，避免单一关键词召回为空） */
const FACILITY_QUERIES = {
  厕所: ['公共厕所', '卫生间', '洗手间'],
  更衣室: ['更衣室', '换衣间', '试衣间'],
  车站: ['地铁站', '公交站', '火车站'],
  便利店: ['便利店', '超市'],
  药店: ['药店', '药房'],
  停车场: ['停车场', '停车楼'],
  餐饮: ['餐厅', '餐饮', '咖啡'],
  商场: ['商场', '购物中心', '超市']
}

const CATEGORIES = ['全部', '厕所', '更衣室', '车站', '便利店', '药店', '停车场', '餐饮', '商场']

/** POI 分类文案 → 展示分类（用于前端筛选 tab） */
const CATEGORY_MAP = [
  { category: '厕所', match: /厕所|卫生间|洗手间|公厕/, kind: 'wc', icon: 'info' },
  { category: '更衣室', match: /更衣|换衣|试衣/, kind: 'dress', icon: 'clipboard' },
  { category: '车站', match: /地铁|公交|车站|火车站|高铁/, kind: 'transport', icon: 'navigation' },
  { category: '便利店', match: /便利|超市|小卖|商店/, kind: 'supply', icon: 'plus-circle' },
  { category: '药店', match: /药店|药房|医院|诊所/, kind: 'pharmacy', icon: 'plus-circle' },
  { category: '停车场', match: /停车/, kind: 'parking', icon: 'map-pin' },
  { category: '餐饮', match: /餐饮|美食|餐厅|咖啡|火锅|烧烤|茶馆|酒吧|小吃/, kind: 'food', icon: 'home' },
  { category: '商场', match: /购物|商场|商业|百货|市场/, kind: 'mall', icon: 'clipboard' }
]

function mapCategory(value) {
  const text = String(value || '')
  return CATEGORY_MAP.find(item => item.match.test(text)) || { category: '便利店', kind: 'supply', icon: 'map-pin' }
}

function formatDistance(value) {
  const meters = Number(value)
  if (!Number.isFinite(meters)) return '距离未知'
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`
}

Page({
  data: {
    mode: 'finder', // 'place' | 'finder'
    locationId: '', locationName: '当前地点', latitude: null, longitude: null,
    searchKeyword: '', suggestList: [], suggestLoading: false,
    activeCategory: '全部', categories: CATEGORIES,
    weather: '—', services: [], displayServices: [], loading: false,
    degraded: false, errorMessage: ''
  },

  onLoad(options) {
    const latitude = Number(options.lat)
    const longitude = Number(options.lng)
    const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude)
    this.setData({
      mode: options.id ? 'place' : 'finder',
      locationId: options.id || '',
      locationName: options.name ? decodeURIComponent(options.name) : '当前地点',
      latitude: hasCoords ? latitude : null,
      longitude: hasCoords ? longitude : null
    })
    // 防抖联想：输入 300ms 后再请求，避免每个字符打一次云函数
    this._fetchSuggestionsDebounced = debounce(() => this._fetchSuggestions(), 300)
    this.loadNearby()
  },

  // ── 周边检索 ──

  async loadNearby() {
    const { latitude, longitude } = this.data
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      // finder 模式下还没选位置不算错误，给出引导文案
      this.setData({
        errorMessage: this.data.mode === 'finder' ? '' : '暂无有效坐标，无法查询周边地点',
        services: [],
        displayServices: []
      })
      return
    }
    this.setData({ loading: true, errorMessage: '' })
    try {
      const res = await app.callCloud('getNearbyMapPoi', {
        latitude,
        longitude,
        // 每个设施类别独立检索，云函数每类最多返回若干个最近 POI。
        // 关键词组在这里维护即可，无需改云函数。
        categoryQueries: FACILITY_QUERIES
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
      // 按距离排序，方便"就近解决"
      services.sort((a, b) => (a.distanceMeters || 0) - (b.distanceMeters || 0))
      this.setData({ services, displayServices: services, degraded: !!(res.data && res.data.degraded) })
    } catch (err) {
      console.error('加载真实周边 POI 失败', err)
      this.setData({ services: [], displayServices: [], errorMessage: '周边地点暂时无法加载，请稍后重试' })
    } finally {
      this.setData({ loading: false })
    }
  },

  // ── 找场地：位置选择 ──

  onSearchInput(e) {
    const keyword = String(e.detail.value || '').trim()
    this.setData({ searchKeyword: keyword })
    if (this.data.mode !== 'finder') return
    if (!keyword) {
      this.setData({ suggestList: [] })
      return
    }
    this._fetchSuggestionsDebounced()
  },

  async _fetchSuggestions() {
    const keyword = this.data.searchKeyword
    if (!keyword || this.data.suggestLoading) return
    const version = ++this._suggestVersion
    this.setData({ suggestLoading: true })
    try {
      const res = await app.callCloud('suggestPlaces', { keyword, region: '全国' })
      if (version !== this._suggestVersion) return
      const list = (res && res.data) ? res.data : []
      this.setData({ suggestList: list.slice(0, 6), suggestLoading: false })
    } catch (err) {
      if (version !== this._suggestVersion) return
      this.setData({ suggestLoading: false })
    }
  },

  onSuggestTap(e) {
    const item = e.currentTarget.dataset.item
    if (!item || !Number.isFinite(Number(item.latitude))) {
      wx.showToast({ title: '该地点缺少坐标，换个结果试试', icon: 'none' })
      return
    }
    this.setData({
      locationName: item.name,
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
      searchKeyword: item.name,
      suggestList: []
    })
    this.loadNearby()
  },

  /** 微信原生选点 */
  chooseOnMap() {
    wx.chooseLocation({
      success: res => {
        if (!res || !Number.isFinite(Number(res.latitude))) return
        this.setData({
          locationName: res.name || '选中位置',
          latitude: res.latitude,
          longitude: res.longitude
        })
        this.loadNearby()
      }
    })
  },

  /** 用当前位置 */
  useCurrentLocation() {
    wx.getLocation({
      type: 'gcj02',
      success: res => {
        this.setData({
          locationName: '我的位置',
          latitude: res.latitude,
          longitude: res.longitude
        })
        this.loadNearby()
      },
      fail: () => wx.showToast({ title: '定位失败，可搜索地址或地图选点', icon: 'none' })
    })
  },

  goBack() { wx.navigateBack() },

  /**
   * 去「推荐新地点」反馈页。
   * 带动当前搜索词作为名称预填，用户少打一次字；提交仍走单向反馈通道
   * （内容只对运营方可见，不会公开展示）。
   */
  goRecommend() {
    const keyword = String(this.data.searchKeyword || '').trim().slice(0, 30)
    const url = keyword
      ? `/pages/location-feedback/location-feedback?name=${encodeURIComponent(keyword)}`
      : '/pages/location-feedback/location-feedback'
    wx.navigateTo({ url })
  },

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
