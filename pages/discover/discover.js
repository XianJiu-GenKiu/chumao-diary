const app = getApp()
const { createPager, stopRefresh, getNavLayout, debounce, bindDarkMode, unbindDarkMode } = require('../../utils/common')
const { normalizePoi, COLLECTION_STATUS } = require('../../utils/poi-adapter')

function getCityByLocation(latitude, longitude) {
  return app.callCloud('getCityByLocation', { latitude, longitude }).then(result => {
    if (result && result.code === 0 && result.data) {
      return result.data.city || '定位失败'
    }
    return '定位失败'
  }).catch(() => '定位失败')
}

const pager = createPager({
  cloudFn: 'getLocations',
  dataKey: 'locationList',
  pageSize: 10,
  buildParams: (ctx) => ({ category: ctx.data.activeFilters })
})

const { CITY_CANDIDATES } = require('../../config/cities')
let cityCandidates = CITY_CANDIDATES
const CITY_CACHE_KEY = 'city_candidates_cache_v1'
const CITY_CACHE_TTL = 7 * 24 * 60 * 60 * 1000

// 地图标点尺寸：原来的 26×32 在真机上偏小，放大到 38×46 更易点中。
const MARKER_WIDTH = 38
const MARKER_HEIGHT = 46
// 搜索标点使用的高位 id：内部地点标点占用 0..n-1，避免冲突。
// 注意 marker.id 必须是 number，字符串会导致整组 markers 渲染失败。
const SEARCH_MARKER_ID = 999999

// 面板折叠态需要完整露出环境栏（手柄 + 环境栏 + 间距），与 wxss 中的
// --float-panel-collapsed-height 保持一致：156rpx。
const PANEL_COLLAPSED_HEIGHT = 156
// 拖拽手柄高度，与 .panel-handle 的 32rpx 对应。
const PANEL_HANDLE_HEIGHT = 32
const PANEL_FAB_GAP = 14

function normalizeCityKeyword(value) {
  return String(value || '').trim().replace(/(市|地区|盟|自治州|特别行政区)$/g, '')
}

function mergeCities(...groups) {
  const merged = []
  groups.flat().forEach(city => {
    if (city && city.name && !merged.some(item => item.name === city.name)) merged.push(city)
  })
  return merged
}

// ── 热度模型 ──
// 只把「主动互动」计入高权重：收藏。
// 浏览量用对数压缩，否则几千次浏览就能把热度顶满，所有地点都会恒显示「爆火」。
const HEAT_VIEW_FACTOR = 6
// 热度条满格对应的分数。互动数据是长尾分布，因此进度条用平方根映射：
// 若直接线性映射，绝大多数地点都会挤在最低档、进度条几乎看不出差别。
const HEAT_FULL_SCORE = 900

/**
 * 计算地点热度：收藏数加权 + 浏览量对数压缩。
 * 用于 POI 卡片展示「热度」与热度标签。
 * 注：打卡数 / 种草数 / 评分数不再计入 —— 这三项是跨用户行为聚合，
 * 公开展示型版本已下线对应功能，避免出现「他人在意我」的社交信号。
 */
function computeHeat(loc) {
  const fav = Number(loc.favoriteCount) || 0
  const views = Math.max(0, Number(loc.viewCount) || 0)
  const interaction = fav * 4
  const viewScore = views > 0 ? Math.log10(views + 1) * HEAT_VIEW_FACTOR : 0
  return Math.max(0, Math.round(interaction + viewScore))
}

function heatLabel(heat) {
  if (heat >= 420) return { text: '爆火', tone: 'hot' }
  if (heat >= 180) return { text: '热门', tone: 'warm' }
  if (heat >= 40) return { text: '小众宝藏', tone: 'calm' }
  return { text: '新发现', tone: 'new' }
}

/**
 * 把热度换算成 6-100 的进度条宽度。
 * 与 heatLabel 共用同一套量级，保证「标签」和「进度条」不会互相矛盾。
 */
function heatPercent(heat) {
  const ratio = Math.sqrt(Math.max(0, heat) / HEAT_FULL_SCORE)
  return Math.max(6, Math.min(100, Math.round(ratio * 100)))
}

function buildDistanceText(loc, lat, lng) {
  const lat1 = Number(loc.latitude)
  const lng1 = Number(loc.longitude)
  const lat2 = Number(lat)
  const lng2 = Number(lng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return ''
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  const meters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  if (!Number.isFinite(meters)) return ''
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`
}

Page({
  data: {
    // 深色模式
    darkMode: false,
    // 自定义导航栏
    statusBarHeight: 0,
    navBarHeight: 44,
    totalNavHeight: 112,
    customNavHeight: 162,
    currentCity: '定位中...',
    locatedCity: '',
    userInfo: null,

    // 城市选择
    cityList: [],
    filteredCityList: [],
    showCityPanel: false,
    citySearchKeyword: '',

    // 运营方身份（仅用于隐藏「添加到地点库」入口，真正防线在云函数 addLocation）
    isAdmin: false,

    mapPanelExpanded: true,
    mapPanelDragOffset: 0,
    mapPanelDragging: false,
    // FAB 跟随面板：面板可见高度（px）。首帧给一个保守初值，onReady 测量后立即校正。
    mapFabFollowOffset: 160,
    mapFabDragging: false,

    // 筛选条件：按名称长度从短到长排列，面板内按“场景 / 出毛需求”分区展示。
    sceneFilterOptions: [
      { key: 'park', name: '公园绿地', icon: 'map', active: false },
      { key: 'forest', name: '森林小径', icon: 'paw', active: false },
      { key: 'water', name: '湖畔水边', icon: 'sun', active: false },
      { key: 'ancient', name: '古风建筑', icon: 'home', active: false },
      { key: 'urban', name: '城市街景', icon: 'navigation', active: false },
      { key: 'ruins', name: '工业废墟', icon: 'map', active: false },
      { key: 'indoor', name: '室内场景', icon: 'home', active: false },
      { key: 'night', name: '夜景灯光', icon: 'moon', active: false },
      { key: 'countryside', name: '乡野田园', icon: 'map-pin', active: false }
    ],
    needFilterOptions: [
      { key: 'parking', name: '可停车', icon: 'map-pin', active: false },
      { key: 'restroom', name: '有卫生间', icon: 'home', active: false },
      { key: 'spacious', name: '人少宽敞', icon: 'users', active: false },
      { key: 'shade', name: '遮阳避雨', icon: 'cloud-sun', active: false },
      { key: 'metro', name: '地铁方便', icon: 'navigation', active: false },
      { key: 'food', name: '附近可聚餐', icon: 'home', active: false },
      { key: 'changing', name: '有换装空间', icon: 'edit', active: false },
      { key: 'large-suit', name: '适合大型兽装', icon: 'paw', active: false },
      { key: 'group-shoot', name: '适合多人拍摄', icon: 'users', active: false }
    ],
    quickFilterOptions: [
      { key: 'park', name: '公园绿地', icon: 'map', active: false },
      { key: 'forest', name: '森林小径', icon: 'paw', active: false },
      { key: 'water', name: '湖畔水边', icon: 'sun', active: false },
      { key: 'ancient', name: '古风建筑', icon: 'home', active: false }
    ],
    filterOptions: [],
    activeFilter: 'all', // 兼容已有模板和外部跳转
    activeFilters: [],
    filteredCount: 0,
    showFilterPanel: false,

    // 地图数据
    mapMarkers: [],
    mapLabels: [],
    mapLatitude: 31.2304,
    mapLongitude: 121.4737,
    mapScale: 12,
    searchMarkers: [],
    selectedPoi: null,
    showPoiMini: false,
    // 地图内小号浮层的纵向位置，随导航栏实测高度变化
    mapPoiMiniTop: 116,
    // POI 卡片固定在顶部导航/筛选栏下方的地图安全区，不覆盖底部地点推荐。
    poiCardTop: 174,
    poiMiniScale: 0.9,
    showPoiPreview: false,
    // 外部地点查询中的 loading，避免用户重复点击地图
    poiQuerying: false,

    // 天气数据（展示用，为 null 时界面显示占位符）
    weatherView: null,

    // 附近推荐
    nearbyLocations: [],

    ...pager.initData()
  },

  _citySearchTimer: null,
  _weatherRequestSeq: 0,

  onLoad() {
    const nav = getNavLayout()
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      totalNavHeight: nav.totalNavHeight,
      userInfo: app.globalData.userInfo,
      filterOptions: [...this.data.sceneFilterOptions, ...this.data.needFilterOptions, { key: 'all', name: '全部', icon: 'more-horizontal', active: true }]
    })

    this._loadCityCandidates()
    this._initLocation()
    this._measurePanelMetrics()
    this._syncAdmin()

    const saved = wx.getStorageSync('currentSearchMarker')
    if (saved) {
      // 兼容修复：早期版本把搜索标点的 id 写成字符串 'search_marker'，
      // 这是非法值，会让整组 markers 渲染失败（所有标点消失）。
      // 这里就地纠正并回写，已受影响的老用户升级后会自动恢复。
      if (saved.id !== SEARCH_MARKER_ID) {
        saved.id = SEARCH_MARKER_ID
        wx.setStorageSync('currentSearchMarker', saved)
      }
      this.setData({
        searchMarkers: [saved],
        mapLatitude: saved.latitude,
        mapLongitude: saved.longitude,
        mapScale: 16
      })
    }
    pager.load(this, true).then(() => {
      this._buildMapMarkers()
      this.setData({ filteredCount: this.data.locationList.length })
    })
    // 深色模式实时同步（统一走 utils/common 的 bindDarkMode）
    bindDarkMode(this)
  },

  onUnload() {
    unbindDarkMode(this)
    app.off('cityReady', this._onCityReady)
    if (this._citySearchTimer) clearTimeout(this._citySearchTimer)
  },

  onReady() {
    this._measureCustomNav()
    this._measurePanelMetrics()
  },

  _measureCustomNav() {
    wx.createSelectorQuery()
      .select('.custom-nav-bar')
      .boundingClientRect(rect => {
        if (!rect || rect.height <= 0) return
        const patch = {}
        if (rect.height !== this.data.customNavHeight) patch.customNavHeight = rect.height
        // 小号浮层贴在导航栏下方 8px 处，标题加高后依然不会被遮挡。
        const nextTop = Math.round(rect.height + 8)
        if (nextTop !== this.data.mapPoiMiniTop) patch.mapPoiMiniTop = nextTop
        // 紧凑 POI 卡片与顶部栏保留 12px 间距，直接显示在地图安全区。
        const nextPoiTop = Math.round(rect.height + 12)
        if (nextPoiTop !== this.data.poiCardTop) patch.poiCardTop = nextPoiTop
        if (Object.keys(patch).length) this.setData(patch)
      })
      .exec()
  },

  /**
   * 读取面板真实高度，换算出 FAB 需要贴在面板上沿的位置。
   * rpx → px 用屏幕宽度折算（750rpx = 屏宽）。
   */
  _measurePanelMetrics() {
    const info = app.globalData.systemInfo || wx.getWindowInfo()
    const pxPerRpx = (info.windowWidth || 375) / 750
    this._pxPerRpx = pxPerRpx
    // 先按设计令牌估算一次，避免选择器查询返回前的首帧位置跳变。
    const estimatedExpanded = Math.max(400 * pxPerRpx, (info.windowHeight || 667) - 880 * pxPerRpx)
    this._panelExpandedHeight = estimatedExpanded
    this._panelCollapsedHeight = PANEL_COLLAPSED_HEIGHT * pxPerRpx
    this._syncFabOffset()

    wx.createSelectorQuery()
      .select('.float-panel')
      .boundingClientRect(rect => {
        const expandedHeight = rect && rect.height > 0
          ? rect.height
          : estimatedExpanded
        this._panelExpandedHeight = expandedHeight
        this._panelCollapsedHeight = PANEL_COLLAPSED_HEIGHT * pxPerRpx
        this._syncFabOffset()
      })
      .exec()
  },

  /**
   * 让 FAB 始终贴着环境栏上沿，并随拖拽实时跟随。
   * 面板 bottom: 0，可见高度即 translateY 之上露出的部分。
   */
  _syncFabOffset(expanded, dragOffset) {
    const isExpanded = typeof expanded === 'boolean' ? expanded : this.data.mapPanelExpanded
    const offset = typeof dragOffset === 'number' ? dragOffset : this.data.mapPanelDragOffset
    const expandedHeight = this._panelExpandedHeight || 300
    const collapsedHeight = this._panelCollapsedHeight || (PANEL_COLLAPSED_HEIGHT * (this._pxPerRpx || 0.5))
    // 面板可见高度 = 展开高度 - 当前 translateY（translateY 越大，露出越少）
    const translateY = (isExpanded ? 0 : expandedHeight - collapsedHeight) + offset
    const visibleHeight = Math.max(collapsedHeight, expandedHeight - translateY)
    // 环境栏上沿 = 面板可见高度 - 拖拽手柄高度
    const envBarTop = visibleHeight - PANEL_HANDLE_HEIGHT * (this._pxPerRpx || 0.5)
    this.setData({ mapFabFollowOffset: Math.round(Math.max(visibleHeight * 0.5, envBarTop) + PANEL_FAB_GAP) })
  },

  async _loadCityCandidates() {
    try {
      const cached = wx.getStorageSync(CITY_CACHE_KEY)
      if (cached && Array.isArray(cached.data) && Date.now() - cached.timestamp < CITY_CACHE_TTL) {
        cityCandidates = cached.data
      }
      const res = await app.callCloud('getCityCandidates')
      const data = res && res.data
      if (!Array.isArray(data) || !data.length) return
      const valid = data.filter(city => city && typeof city.name === 'string' && Number.isFinite(Number(city.lat)) && Number.isFinite(Number(city.lng)))
      if (!valid.length) return
      cityCandidates = valid
      wx.setStorage({ key: CITY_CACHE_KEY, data: { data: valid, timestamp: Date.now() } }).catch(() => {})
    } catch (err) {
      // The built-in list keeps city selection usable before the cloud config is deployed.
    }
  },

  onShow() {
    this.setData({
      userInfo: app.globalData.userInfo,
      darkMode: app.globalData.darkMode || false,
      isAdmin: !!app.globalData.isAdmin
    })
    // 同步全局城市（可能在后台已更新）
    if (app.globalData.cityReady && app.globalData.currentCity !== this.data.currentCity) {
      this.setData({
        currentCity: app.globalData.currentCity,
        locatedCity: app.globalData.currentCity
      })
    }
    this._fetchWeather()
  },

  /**
   * 探测当前用户是否运营方（管理员）。
   * 结果只用于隐藏「添加到地点库」这类入口；真正的写入门禁在云函数 addLocation。
   * 全局已探测过就直接复用，避免每个页面都打一次云函数。
   */
  _syncAdmin() {
    if (typeof app.globalData.isAdmin === 'boolean') {
      this.setData({ isAdmin: app.globalData.isAdmin })
      return
    }
    if (!app.globalData.isLoggedIn) return
    app.callCloud('manageReports', { action: 'whoami' }).then(res => {
      const isAdmin = !!(res && res.code === 0 && res.data && res.data.isAdmin)
      app.globalData.isAdmin = isAdmin
      this.setData({ isAdmin })
    }).catch(() => app.globalData.isAdmin === undefined && (app.globalData.isAdmin = false))
  },

  _initLocation() {
    // 如果 app 已经定位好了，直接同步到页面
    if (app.globalData.cityReady) {
      const latitude = app.globalData.currentLatitude || this.data.mapLatitude
      const longitude = app.globalData.currentLongitude || this.data.mapLongitude
      this.setData({
        currentCity: app.globalData.currentCity,
        locatedCity: app.globalData.currentCity,
        mapLatitude: latitude,
        mapLongitude: longitude
      })
      this._currentLatitude = latitude
      this._currentLongitude = longitude
      // 旧缓存可能保存了接口故障期间的“未知城市”；服务恢复后立即自愈。
      if (app.globalData.currentCity === '定位失败' && latitude && longitude) {
        getCityByLocation(latitude, longitude).then(city => {
          if (city === '定位失败') return
          app.globalData.currentCity = city
          this.setData({ currentCity: city, locatedCity: city })
          wx.setStorage({ key: 'cached_city_info', data: { city, latitude, longitude, timestamp: Date.now() } }).catch(() => {})
        })
      }
      this._fetchWeather()
      this._loadNearbyLocations()
      return
    }

    // 还在定位中，等待回调
    this.setData({ currentCity: '定位中...' })
    this._onCityReady = (info) => {
      this.setData({
        currentCity: info.city,
        locatedCity: info.city,
        mapLatitude: info.latitude || this.data.mapLatitude,
        mapLongitude: info.longitude || this.data.mapLongitude
      })
      if (info.latitude) this._currentLatitude = info.latitude
      if (info.longitude) this._currentLongitude = info.longitude
      this._fetchWeather()
      this._loadNearbyLocations()
    }
    app.on('cityReady', this._onCityReady)
  },

  onReLocate() {
    this.setData({ currentCity: '定位中...' })
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        this._currentLatitude = res.latitude
        this._currentLongitude = res.longitude
        this.setData({ mapLatitude: res.latitude, mapLongitude: res.longitude, mapScale: 14 })
        getCityByLocation(res.latitude, res.longitude).then(city => {
          this.setData({ currentCity: city, locatedCity: city })
          // 同步回全局数据，让其他页面也能拿到最新城市
          app.globalData.currentCity = city
          app.globalData.currentLatitude = res.latitude
          app.globalData.currentLongitude = res.longitude
          wx.setStorage({
            key: 'cached_city_info',
            data: { city, latitude: res.latitude, longitude: res.longitude, timestamp: Date.now() }
          }).catch(() => {})
          this._fetchWeather()
          this._loadNearbyLocations()
        })
      },
      fail: () => {
        this.setData({ currentCity: '定位失败' })
        wx.showModal({
          title: '定位权限未开启',
          content: '请在微信设置中开启定位权限，以便为你推荐附近地点。',
          confirmText: '去设置',
          success: result => {
            if (result.confirm) wx.openSetting()
          }
        })
      }
    })
  },

  onAvatarTap() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  // ── 城市选择器 ──

  onCityTap() {
    const cityList = cityCandidates.slice(0, 10)

    const locatedCity = this.data.locatedCity
    if (locatedCity && locatedCity !== '定位中...') {
      const index = cityList.findIndex(c => c.name === locatedCity)
      if (index > 0) {
        cityList.unshift(cityList.splice(index, 1)[0])
      } else if (index === -1) {
        cityList.unshift({ name: locatedCity, lat: this.data.mapLatitude, lng: this.data.mapLongitude })
      }
    }

    this.setData({ cityList, filteredCityList: cityList, showCityPanel: true, citySearchKeyword: '' })
  },

  onCitySearchInput(e) {
    const keyword = e.detail.value
    this.setData({ citySearchKeyword: keyword })
    if (this._citySearchTimer) clearTimeout(this._citySearchTimer)
    if (!keyword.trim()) {
      this.setData({ filteredCityList: this.data.cityList })
      return
    }
    this._citySearchTimer = setTimeout(() => this._searchCityCandidates(keyword.trim()), 200)
  },

  onCitySearchConfirm(e) {
    const keyword = e.detail.value
    if (keyword.trim()) this._searchCityCandidates(keyword.trim())
  },

  _searchCityCandidates(keyword) {
    if (!keyword) return
    const normalized = normalizeCityKeyword(keyword)
    const searched = [keyword.trim(), normalized].filter(Boolean)
    const locatedCity = this.data.locatedCity && this.data.locatedCity !== '定位中...'
      ? [{ name: this.data.locatedCity, lat: this.data.mapLatitude, lng: this.data.mapLongitude }]
      : []
    const matches = mergeCities(locatedCity, cityCandidates).filter(city => {
      const cityName = normalizeCityKeyword(city.name)
      return searched.some(item => cityName.includes(item) || item.includes(cityName))
    })

    if (!matches.length && normalized) {
      matches.push({
        name: normalized,
        lat: this.data.mapLatitude,
        lng: this.data.mapLongitude,
        _customCity: true
      })
    }
    this.setData({ filteredCityList: matches.slice(0, 8) })
  },

  closeCityPanel() { this.setData({ showCityPanel: false }) },

  onCitySelect(e) {
    const { name, lat, lng } = e.currentTarget.dataset
    const latitude = Number(lat) || this.data.mapLatitude
    const longitude = Number(lng) || this.data.mapLongitude
    this._currentLatitude = latitude
    this._currentLongitude = longitude
    this.setData({
      currentCity: name,
      locatedCity: name,
      mapLatitude: latitude,
      mapLongitude: longitude,
      mapScale: 12,
      showCityPanel: false
    }, () => {
      app.globalData.currentCity = name
      app.globalData.currentLatitude = latitude
      app.globalData.currentLongitude = longitude
      app.globalData.cityReady = true
      this._fetchWeather()
      this._loadNearbyLocations()
    })
    wx.showToast({ title: `已切换到${name}`, icon: 'none' })
  },

  onPageScroll(e) {
    // 保留空的滚动监听位：后续如需「回到顶部」等滚动联动效果在此扩展。
  },

  // ── 筛选 ──

  onFilterTap(e) {
    this._applyFilter(e.currentTarget.dataset.key)
  },

  onFilterAllTap() { this.setData({ showFilterPanel: !this.data.showFilterPanel }) },
  closeFilterPanel() { this.setData({ showFilterPanel: false }) },

  /**
   * 面板内的类别：只切换选中态，不自动关闭。
   * 用户可以连续勾选多个类别，确认后自行点击「✕ / 完成」收起面板。
   */
  onFilterPanelTap(e) {
    this._applyFilter(e.currentTarget.dataset.key)
  },

  /** 用户确认选择后收起面板 */
  onFilterPanelConfirm() {
    this.setData({ showFilterPanel: false })
  },

  /** 清空全部筛选条件（面板底部按钮与提示条按钮共用） */
  onFilterClearTap() {
    if (!this.data.activeFilters.length) return
    wx.vibrateShort({ type: 'light' })
    this._applyFilter('all')
    wx.showToast({ title: '已清空筛选', icon: 'none' })
  },

  /** 同步 filterOptions 的 active 标记，供 WXML 直接渲染 */
  _syncFilterOptions(activeFilters) {
    const selected = Array.isArray(activeFilters) ? activeFilters : []
    const mark = item => ({
      ...item,
      active: item.key === 'all' ? selected.length === 0 : selected.indexOf(item.key) >= 0
    })
    this.setData({
      filterOptions: this.data.filterOptions.map(mark),
      sceneFilterOptions: this.data.sceneFilterOptions.map(mark),
      needFilterOptions: this.data.needFilterOptions.map(mark),
      quickFilterOptions: this.data.quickFilterOptions.map(mark)
    })
  },

  _applyFilter(key) {
    let activeFilters
    if (key === 'all') {
      activeFilters = []
    } else {
      activeFilters = this.data.activeFilters.slice()
      const index = activeFilters.indexOf(key)
      if (index >= 0) activeFilters.splice(index, 1)
      else activeFilters.push(key)
    }

    this.setData({
      activeFilter: activeFilters[0] || 'all',
      activeFilters
    })
    this._syncFilterOptions(activeFilters)

    // 点击类别立即反馈，不等云函数返回
    wx.vibrateShort({ type: 'light' })

    pager.load(this, true).then(() => {
      this._buildMapMarkers()
      this.setData({ filteredCount: this.data.locationList.length })
    })
  },

  moveToMyLocation() {
    wx.getLocation({
      type: 'gcj02',
      success: (r) => {
        this._currentLatitude = r.latitude
        this._currentLongitude = r.longitude
        this.setData({ mapLatitude: r.latitude, mapLongitude: r.longitude, mapScale: 14 })
        getCityByLocation(r.latitude, r.longitude).then(city => {
          this.setData({ currentCity: city, locatedCity: city })
          app.globalData.currentCity = city
          app.globalData.currentLatitude = r.latitude
          app.globalData.currentLongitude = r.longitude
          app.globalData.cityReady = true
          this._fetchWeather()
          this._loadNearbyLocations()
        })
      },
      fail: () => wx.showToast({ title: '请授权位置权限', icon: 'none' })
    })
  },

  // ── 天气 ──

  _fetchWeather() {
    const city = normalizeCityKeyword(this.data.currentCity)
    const latitude = this.data.mapLatitude
    const longitude = this.data.mapLongitude
    const requestSeq = ++this._weatherRequestSeq
    const data = city && city !== '定位中...' && city !== '定位失败'
      ? { city, latitude, longitude }
      : { latitude, longitude }

    // 检查本地缓存（30 分钟过期）
    const cacheKey = `weather_${city || `${latitude},${longitude}`}`
    const cached = wx.getStorageSync(cacheKey)
    if (cached && cached.timestamp && Date.now() - cached.timestamp < 30 * 60 * 1000) {
      this.setData({ weatherView: cached.view || null })
      return // 使用缓存，不重复请求
    }

    app.callCloud('getWeather', data).then(result => {
      if (requestSeq !== this._weatherRequestSeq) return
      // 云函数查不到天气时返回 data: null（不再编造数据），这里如实渲染无数据态。
      const view = result && result.code === 0 ? this._formatWeather(result.data) : null
      this.setData({ weatherView: view })
      if (view) {
        wx.setStorageSync(cacheKey, { view, timestamp: Date.now() })
      }
    }).catch(() => {
      if (requestSeq !== this._weatherRequestSeq) return
      this.setData({ weatherView: null })
    })
  },

  /**
   * 把天气数据格式化成展示字符串。
   *
   * 缺字段就显示占位符，**绝不回落到看似真实的具体数值** —— 早期版本
   * 在 wxml 里用 `{{weatherData.temperature || '28'}}` 兜底，接口坏掉时
   * 用户看到的是编造的天气，且与云函数里的假数据互相掩护，很难被发现。
   */
  _formatWeather(data) {
    if (!data) return null
    return {
      temperature: Number.isFinite(data.temperature) ? `${data.temperature}°` : '—',
      humidity: Number.isFinite(data.humidity) ? `${data.humidity}%` : '—',
      wind: data.windDisplay || (Number.isFinite(data.wind) ? `${data.wind}级` : '—'),
      condition: data.condition || '—'
    }
  },

  // ── 附近推荐 ──

  _loadNearbyLocations() {
    const lat = this._currentLatitude || this.data.mapLatitude
    const lng = this._currentLongitude || this.data.mapLongitude
    // UI 框架阶段先切换为地点推荐；后续接入按城市/热度的专用查询参数。
    app.callCloud('getLocations', { category: 'all', latitude: lat, longitude: lng, radius: 5, pageSize: 5 }).then(result => {
      if (result && result.code === 0 && result.data) {
        this.setData({ nearbyLocations: result.data.slice(0, 5).map(item => ({
          ...item,
          serviceSummary: item.serviceSummary || '适合拍摄 · 可查看周边服务'
        })) })
      }
    }).catch(() => {})
  },

  onNearbyTap(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/location-detail/location-detail?id=${id}` })
  },

  onPanelTouchStart(e) {
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this._panelTouchStartY = touch.clientY
    this._panelStartedExpanded = this.data.mapPanelExpanded
    this._panelDragOffset = 0
    const expandedHeight = this._panelExpandedHeight || 300
    const collapsedHeight = this._panelCollapsedHeight || (PANEL_COLLAPSED_HEIGHT * (this._pxPerRpx || 0.5))
    this._panelBaseTranslate = this._panelStartedExpanded ? 0 : Math.max(0, expandedHeight - collapsedHeight)
    this._panelTouchStartAt = Date.now()
    this.setData({ mapPanelDragging: true, mapFabDragging: true })
  },

  onPanelTouchMove(e) {
    const touch = e.touches && e.touches[0]
    if (!touch || !this.data.mapPanelDragging) return
    const delta = touch.clientY - this._panelTouchStartY
    const expandedHeight = this._panelExpandedHeight || 300
    const collapsedHeight = this._panelCollapsedHeight || (PANEL_COLLAPSED_HEIGHT * (this._pxPerRpx || 0.5))
    const baseTranslate = this._panelBaseTranslate || 0
    // 以面板当前真实位移为基准计算，环境栏和拖拽手柄都能连续上下拖动。
    const travel = Math.max(0, expandedHeight - collapsedHeight)
    const nextTranslate = Math.max(0, Math.min(travel, baseTranslate + delta))
    const offset = nextTranslate - baseTranslate
    this._panelDragOffset = offset
    this.setData({ mapPanelDragOffset: offset })
    this._syncFabOffset(this._panelStartedExpanded, offset)
  },

  onPanelTouchEnd() {
    if (!this.data.mapPanelDragging) return
    const elapsed = Math.max(1, Date.now() - this._panelTouchStartAt)
    const velocity = this._panelDragOffset / elapsed
    const collapse = this._panelStartedExpanded && (this._panelDragOffset > 90 || (this._panelDragOffset > 42 && velocity > 0.5))
    const expand = !this._panelStartedExpanded && (this._panelDragOffset < -70 || (this._panelDragOffset < -36 && velocity < -0.5))
    const nextExpanded = expand ? true : collapse ? false : this._panelStartedExpanded
    this.setData({
      mapPanelExpanded: nextExpanded,
      mapPanelDragging: false,
      mapFabDragging: false,
      mapPanelDragOffset: 0
    })
    this._panelDragOffset = 0
    this._syncFabOffset(nextExpanded, 0)
  },

  // ── 地图标记 ──

  _buildMapMarkers() {
    const withCoords = this.data.locationList.filter(i => i.latitude && i.longitude)
    this._markerLocMap = withCoords

    const locMarkers = withCoords.map((item, idx) => ({
      id: idx,
      latitude: item.latitude,
      longitude: item.longitude,
      iconPath: '/images/marker.png',
      // 信息交由自定义浮层展示，避免原生 callout 与 map tap 同时触发。
      width: MARKER_WIDTH,
      height: MARKER_HEIGHT
    }))

    const mapLabels = []

    this.setData({
      mapMarkers: [...locMarkers, ...this.data.searchMarkers],
      mapLabels
    })
  },

  // ── 分页 ──

  onPullDownRefresh() {
    stopRefresh(pager.load(this, true).then(() => {
      this._buildMapMarkers()
      this.setData({ filteredCount: this.data.locationList.length })
    }))
  },

  // ── 导航 ──

  onSearchTap() { wx.navigateTo({ url: '/pages/search/search' }) },
  goSeasonal() { wx.navigateTo({ url: '/pages/seasonal/seasonal' }) },

  onLocationTap(e) {
    wx.navigateTo({ url: `/pages/location-detail/location-detail?id=${e.currentTarget.dataset.id}` })
  },

  onMarkerTap(e) {
    // 某些基础库会在 markertap 后继续派发 map tap；短暂忽略，避免浮层闪退。
    this._ignoreMapTapUntil = Date.now() + 450
    const idx = Number(e.detail.markerId)
    // 搜索标点不属于内部地点，没有对应详情，直接忽略。
    if (idx === SEARCH_MARKER_ID) return
    const loc = this._markerLocMap ? this._markerLocMap[idx] : null
    if (!loc) return
    this._openPoiCard(loc)
  },

  /**
   * 组装 POI 卡片数据：以图片 + 位置 + 收藏 + 热度为核心信息。
   */
  _openPoiCard(loc) {
    const images = Array.isArray(loc.images) ? loc.images.filter(Boolean) : []
    const previewImage = loc.coverUrl || (images.length > 0 ? images[0] : '')
    const heat = computeHeat(loc)
    const badge = heatLabel(heat)
    const distance = loc.distance || buildDistanceText(
      loc,
      this._currentLatitude || this.data.mapLatitude,
      this._currentLongitude || this.data.mapLongitude
    )
    const facilities = (Array.isArray(loc.facilities) ? loc.facilities : [])
      .map(item => (typeof item === 'string' ? item : item && item.name))
      .filter(Boolean)
      .slice(0, 3)

    // 内部地点同样经过统一适配层，保证卡片字段与外部地点完全一致。
    const poi = normalizePoi({
      ...loc,
      coverUrl: loc.coverUrl,
      images,
      previewImage,
      imageCount: images.length,
      isIndoor: !!(loc.isIndoor || loc.indoor),
      ratingCount: Number(loc.ratingCount) || 0,
      categoryName: loc.categoryName || loc.category || loc.style || '',
      tags: (Array.isArray(loc.tags) ? loc.tags : []).slice(0, 3),
      facilities,
      bestTime: loc.bestTime || '',
      distance,
      favoriteCount: Number(loc.favoriteCount) || 0,
      isFavorited: !!loc.isFavorited,
      viewCount: Number(loc.viewCount) || 0,
      heat,
      heatPercent: heatPercent(heat),
      heatLabel: badge.text,
      heatTone: badge.tone,
      miniMeta: `${loc.categoryName || loc.category || loc.style || '地点'}`
    }, 'internal')

    this.setData({
      selectedPoi: poi,
      // 记录当前卡片身份，用于识别过期的关闭事件
      closingPoiId: poi._id || poi.externalId || poi.name || '',
      // 地图标点点击后直接显示卡片式 POI；隐藏旧的小号浮层，避免重复出现两层卡片。
      showPoiMini: false,
      showPoiPreview: true
    })
  },

  /** 地点列表加载失败后重试，成功后重建地图标点 */
  onMapLoadRetry() {
    wx.showLoading({ title: '重新加载...' })
    pager.reset()
    pager.load(this, true).then(() => {
      this._buildMapMarkers()
      this.setData({ filteredCount: this.data.locationList.length })
    }).finally(() => wx.hideLoading())
  },

  /**
   * 点击地图：
   * - 若当前已有卡片打开，第一次点击先收起卡片（保持轻量的关闭手感）；
   * - 卡片已收起时，把点击坐标交给云函数识别腾讯地图上的地点，
   *   识别到就弹出统一 POI 卡片，识别不到则提示「在这里创建地点」。
   */
  onMapTap(e) {
    // 某些基础库会在 markertap 后继续派发 map tap；短暂忽略，避免浮层闪退。
    if (Date.now() < (this._ignoreMapTapUntil || 0)) return
    if (this.data.showPoiPreview || this.data.showPoiMini) {
      this.setData({ showPoiPreview: false, showPoiMini: false, selectedPoi: null })
      return
    }
    const detail = e && e.detail
    const latitude = Number(detail && detail.latitude)
    const longitude = Number(detail && detail.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    this._queryNearbyMapPoi(latitude, longitude)
  },

  /**
   * 点击地图上由腾讯底图渲染的 POI 点（如「花果园购物中心」）。
   *
   * 这是本功能最初「点了没反应」的根因：官方文档中 poitap 是独立事件
   * （e.detail = {name, longitude, latitude}），点击底图 POI 只会触发它，
   * 不会触发 bindtap。因此只监听 onMapTap 时，用户点这些地点完全没有反应。
   */
  onMapPoiTap(e) {
    if (Date.now() < (this._ignoreMapTapUntil || 0)) return
    // 个别基础库会为同一次点击同时派发 poitap 与 tap，
    // 这里设一个很短的窗口，让紧随其后的 tap 被忽略，避免重复查询。
    this._ignoreMapTapUntil = Date.now() + 300
    // 卡片已打开时，沿用「先收起」的一致手感
    if (this.data.showPoiPreview || this.data.showPoiMini) {
      this.setData({ showPoiPreview: false, showPoiMini: false, selectedPoi: null })
      return
    }
    const detail = e && e.detail
    const latitude = Number(detail && detail.latitude)
    const longitude = Number(detail && detail.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return

    // 底图 POI 已经带了名称，直接用它构建卡片，省掉一次网络往返。
    // 但「是否已被小程序收录」仍需云函数判定，因此照常请求。
    this._mapPoiTapName = (detail && detail.name) || ''
    this._queryNearbyMapPoi(latitude, longitude, { poiName: this._mapPoiTapName })
  },

  /**
   * 查询点击坐标附近的地点。
   * 使用请求序号丢弃过期结果，避免用户连续点击时旧请求覆盖新结果。
   * @param {object} [hint] 底图 POI 直接给出的信息（如名称），用于网络结果为空时兜底
   */
  _queryNearbyMapPoi(latitude, longitude, hint) {
    if (this.data.poiQuerying) return
    const seq = (this._poiQuerySeq || 0) + 1
    this._poiQuerySeq = seq
    this.setData({ poiQuerying: true })
    wx.showLoading({ title: '识别地点…', mask: true })

    app.callCloud('getNearbyMapPoi', { latitude, longitude }).then(res => {
      // 只接受最后一次请求的结果
      if (seq !== this._poiQuerySeq) return
      wx.hideLoading()
      this.setData({ poiQuerying: false })

      const pois = (res && res.data && Array.isArray(res.data.pois)) ? res.data.pois : []
      if (!pois.length) {
        // 用户是直接点在底图 POI 上的，即使周边接口没返回结果，
        // 也应该用底图给出的名称展示卡片，而不是退化成「未知位置」。
        const hintName = hint && hint.poiName
        if (hintName) {
          this._openExternalPoi({ name: hintName, latitude, longitude, collectionStatus: 'not_collected' })
        } else {
          this._openUnresolvedPoi(latitude, longitude)
        }
        return
      }
      if (pois.length === 1) {
        this._openExternalPoi(pois[0])
        return
      }
      // 附近有多个地点时让用户选择，避免地点错配
      wx.showActionSheet({
        itemList: pois.slice(0, 3).map(item => {
          const distance = Number(item.distance)
          const suffix = Number.isFinite(distance) ? ` · ${Math.round(distance)}m` : ''
          return `${item.name}${suffix}`.slice(0, 20)
        }),
        success: result => this._openExternalPoi(pois[result.tapIndex]),
        fail: () => {}
      })
    }).catch(() => {
      if (seq !== this._poiQuerySeq) return
      wx.hideLoading()
      this.setData({ poiQuerying: false })
      // 云函数不可用时，底图 POI 的名称依然可用，先展示卡片避免「点了没反应」
      const hintName = hint && hint.poiName
      if (hintName) {
        this._openExternalPoi({ name: hintName, latitude, longitude, collectionStatus: 'not_collected' })
        return
      }
      wx.showToast({ title: '地点识别失败，请重试', icon: 'none' })
    })
  },

  /** 打开腾讯地图外部地点卡片 */
  _openExternalPoi(raw) {
    if (!raw) return
    // 命中已有内部地点时，直接沿用内部卡片体验（含热度、打卡、收藏）
    if (raw.collectionStatus === COLLECTION_STATUS.COLLECTED && raw.matchedLocationId) {
      const matched = this.data.locationList.find(item => item._id === raw.matchedLocationId)
      if (matched) {
        this._openPoiCard(matched)
        return
      }
    }
    const poi = normalizePoi(raw, 'tencent')
    this.setData({
      selectedPoi: poi,
      closingPoiId: poi._id || poi.externalId || poi.name || '',
      showPoiMini: false,
      showPoiPreview: true
    })
  },

  /** 附近没有任何可识别地点时的兜底卡片 */
  _openUnresolvedPoi(latitude, longitude) {
    const poi = normalizePoi({ latitude, longitude }, 'unresolved')
    this.setData({
      selectedPoi: poi,
      // 未识别地点没有 id，用坐标作为身份标识
      closingPoiId: `${latitude},${longitude}`,
      showPoiMini: false,
      showPoiPreview: true
    })
  },

  /** 外部地点 → 预填创建地点页面 */
  onAddExternalPoi(e) {
    const detail = (e && e.detail) || {}
    if (!detail.name) return
    const params = {
      poiName: detail.name,
      poiAddress: detail.address || '',
      poiCategory: detail.category || '',
      poiLat: detail.latitude,
      poiLng: detail.longitude,
      poiSource: detail.externalSource || '',
      poiExternalId: detail.externalId || ''
    }
    const query = Object.keys(params)
      .filter(key => params[key] !== '' && params[key] !== null && params[key] !== undefined)
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&')
    this.setData({ showPoiPreview: false, showPoiMini: false, selectedPoi: null })
    wx.navigateTo({ url: `/pages/location-upload/location-upload?${query}` })
  },

  onOpenPoiPreview() {
    if (this.data.selectedPoi) this.setData({ showPoiMini: false, showPoiPreview: true })
  },

  onViewPoiDetail(e) {
    const id = e.detail.id
    if (id) {
      this.setData({ showPoiPreview: false, showPoiMini: false, selectedPoi: null })
      wx.navigateTo({ url: `/pages/location-detail/location-detail?id=${id}` })
    }
  },

  onClosePoiPreview(e) {
    // 关闭事件在弹入动画播完后才发出（约 260ms）。
    // 若这段时间内用户又点了别的标点并打开了新卡片，这次 close 已经过期，
    // 再清状态会把刚打开的新卡片一起抹掉，因此用 id 比对后直接忽略。
    const closedId = (e && e.detail && e.detail.id) || ''
    const currentId = this.data.closingPoiId || ''
    if (closedId && currentId && closedId !== currentId) return
    this.setData({ showPoiPreview: false, showPoiMini: false, selectedPoi: null, closingPoiId: '' })
  },

  onNavigateToPoi(e) {
    const id = e.detail && e.detail.id
    if (id) app.trackEvent('map_navigation', { targetId: id, targetType: 'location' })
  },

  /** 卡片内直接收藏 / 取消收藏，无需进入详情页 */
  onTogglePoiFavorite(e) {
    const id = (e.detail && e.detail.id) || (this.data.selectedPoi && this.data.selectedPoi._id)
    const poi = this.data.selectedPoi
    if (!id || !poi) return
    if (!app.globalData.isLoggedIn) {
      wx.showModal({
        title: '请先登录',
        content: '登录后才能收藏地点。',
        confirmText: '去登录',
        success: result => {
          if (result.confirm) wx.switchTab({ url: '/pages/profile/profile' })
        }
      })
      return
    }

    const nextFavorited = !poi.isFavorited
    const nextCount = Math.max(0, (poi.favoriteCount || 0) + (nextFavorited ? 1 : -1))
    this.setData({
      'selectedPoi.isFavorited': nextFavorited,
      'selectedPoi.favoriteCount': nextCount
    })
    wx.vibrateShort({ type: 'light' })

    app.callCloud('toggleFavorite', { targetId: id, targetType: 'location' }).then(res => {
      if (!res || res.code !== 0) throw new Error((res && res.message) || '收藏失败')
      // 同步回列表，返回地图时数据保持一致
      const list = this.data.locationList.map(item =>
        item._id === id ? { ...item, isFavorited: nextFavorited, favoriteCount: nextCount } : item
      )
      this.setData({ locationList: list })
      this._markerLocMap = list.filter(i => i.latitude && i.longitude)
      wx.showToast({ title: nextFavorited ? '已收藏' : '已取消收藏', icon: 'none' })
    }).catch(() => {
      this.setData({
        'selectedPoi.isFavorited': !nextFavorited,
        'selectedPoi.favoriteCount': poi.favoriteCount || 0
      })
      wx.showToast({ title: '操作失败，请重试', icon: 'none' })
    })
  },

  onNearbyServices(e) {
    const id = e && e.detail && e.detail.id
    const poi = this.data.selectedPoi || {}
    const lat = Number(poi.latitude)
    const lng = Number(poi.longitude)
    wx.navigateTo({ url: `/pages/nearby-services/nearby-services?id=${id || ''}&lat=${Number.isFinite(lat) ? lat : ''}&lng=${Number.isFinite(lng) ? lng : ''}&name=${encodeURIComponent(poi.name || '当前地点')}` })
  },

  onMapRegionChange: debounce(function (e) {
    if (e.type !== 'regionchange') return
    const detail = e.detail || {}
    const nextScale = Number(detail.scale)
    if (Number.isFinite(nextScale) && nextScale >= 3 && nextScale <= 20) {
      this.setData({
        mapScale: nextScale,
        poiMiniScale: Math.max(0.78, Math.min(1.12, 0.78 + (nextScale - 8) * 0.034))
      })
    }
    if (detail.centerLocation) {
      const { latitude, longitude } = detail.centerLocation
      this._currentLatitude = latitude
      this._currentLongitude = longitude
      this._loadNearbyLocations()
    }
  }, 500),

  addSearchMarker(poi) {
    if (!poi?.latitude || !poi?.longitude) return
    const marker = {
      // marker.id 必须是 number（官方文档：id 为 number 类型，点击事件回传此 id）。
      // 这里原本用的是字符串 'search_marker'，属于非法值：
      // 一旦该标点被写入 markers 数组，会导致整组 markers 渲染失败，
      // 表现为「小程序自己的地点标点全部消失」。
      // 内部地点标点占用 0..n-1，因此搜索标点固定使用这个不会被占用的高位 id。
      id: SEARCH_MARKER_ID,
      latitude: poi.latitude,
      longitude: poi.longitude,
      title: poi.name || '',
      iconPath: '/images/marker.png',
      width: 44, height: 52,
      callout: { content: poi.name || (poi.address ? poi.address.substring(0, 20) : '') || '选中地点', fontSize: 14, borderRadius: 12, bgColor: '#D4890E', color: '#fff', padding: 10, display: 'ALWAYS' }
    }
    this.setData({ searchMarkers: [marker], mapLatitude: poi.latitude, mapLongitude: poi.longitude, mapScale: 16 })
    this._buildMapMarkers()
    wx.setStorageSync('currentSearchMarker', marker)
    wx.showToast({ title: `已标注：${poi.name || '选中地点'}`, icon: 'none' })
  }
})
