const app = getApp()
const { createPager, stopRefresh, getNavLayout, debounce, bindDarkMode, unbindDarkMode } = require('../../utils/common')
const { normalizePoi, COLLECTION_STATUS } = require('../../utils/poi-adapter')
const { evaluateFromWeather } = require('../../utils/furIndex')

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
  // 地图上要一次看到全部标点，因此不按「一屏 10 条」取；50 是 getLocations 的服务端上限。
  // 超过 50 条时 _loadAllLocations 会继续翻页，不会静默截断标点。
  pageSize: 50,
  // 分页器只服务「全部」视角；「我出过毛 / 我收藏的」走本地足迹与收藏云调用，
  // 「精选地点」走 _loadFeaturedLocations 的独立请求，均不经此分页器。
  buildParams: () => ({})
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
// 地图点击标点（用户点哪儿就落一根针，callout 展示识别结果）。
const TAP_MARKER_ID = 999998
// 本机足迹存储 key（与 pages/footprints 共用同一份数据）
const FOOTPRINT_STORAGE_KEY = 'fur_footprints_v1'

// 面板三档高度（rpx）。环境栏 108rpx + 底部 margin 12rpx + 手柄 52rpx ≈ 172rpx，
// 但实测收起态到概况区顶边只有 150rpx：多出来的高度会让 POI 名称在收起时露出半行被截断，
// 所以收起高度按实测取 150。
// 半开态露出「环境栏 + 地点概况 + 操作区」，三块连排大约是 640rpx，所以半开高度取 640；
// 全开态由详情区撑开，与顶部抽屉底边贴齐。
const PANEL_COLLAPSED_HEIGHT = 150
const PANEL_HALF_HEIGHT = 640
const PANEL_FAB_GAP = 14

// 顶部精选抽屉展开后的内容高度：同样按视口比例取高并设上限。
const FEATURED_BODY_RATIO = 0.46
const FEATURED_BODY_MAX_RPX = 640

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

/** 时间戳 → 「YYYY-MM-DD」（足迹视角的地址摘要用） */
function sameDayText(ts) {
  const d = new Date(Number(ts) || Date.now())
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildDistanceText(loc, lat, lng) {  const lat1 = Number(loc.latitude)
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
    // 0 = 未实测。测量前由 _panelNavFallback() 按导航栏真实结构推算，
    // 不能用固定值兜底：算小了面板会变高，全开态把环境栏顶进导航栏里。
    customNavHeight: 0,
    currentCity: '待定位',
    locatedCity: '',
    userInfo: null,

    // 城市选择
    cityList: [],
    filteredCityList: [],
    showCityPanel: false,
    citySearchKeyword: '',

    // 运营方身份（仅用于隐藏「添加到地点库」入口，真正防线在云函数 addLocation）
    isAdmin: false,

    // 面板三档状态：collapsed（收起，只露环境栏）/ half（地点概况）/ full（详情）
    mapPanelState: 'collapsed',
    mapPanelDragOffset: 0,
    mapPanelDragging: false,
    // 面板总高与位移全部以 px 内联，避免 CSS calc(100vh - …) 在真机上产生档位偏差
    panelFullHeight: 0,
    panelTranslate: 0,
    // FAB 跟随面板：面板可见高度（px）。首帧给一个保守初值，onReady 测量后立即校正。
    mapFabFollowOffset: 160,
    mapFabDragging: false,

    // 顶部精选地点抽屉：内容高度由 JS 驱动（px），收起为 0
    featuredExpanded: false,
    featuredDragging: false,
    featuredBodyHeight: 0,
    featuredLocations: [],

    // 视角切换：all = 全部地点（默认）；visited = 我出过毛（本机足迹，只读本机数据）；
    // favored = 我收藏的。由地图右侧 FAB 触发，再次点击恢复 all。
    viewMode: 'all',
    viewCount: 0,

    // 地图数据
    mapMarkers: [],
    mapLabels: [],
    mapLatitude: 31.2304,
    mapLongitude: 121.4737,
    mapScale: 12,
    searchMarkers: [],
    // 底部面板当前展示的地点及其轮播图
    selectedPoi: null,
    poiGallery: [],
    poiCurrentImage: 0,
    favPending: false,
    // 外部地点查询中的 loading，避免用户重复点击地图
    poiQuerying: false,

    // 天气数据（展示用，为 null 时界面显示占位符）
    weatherView: null,

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
      userInfo: app.globalData.userInfo
    })

    this._loadCityCandidates()
    this._initLocation()
    this._measurePanelMetrics()
    // 自动登录可能晚于页面 onLoad 完成，登录态变化后重新探测管理员身份。
    this._onLoginStateChanged = ({ isLoggedIn }) => {
      delete app.globalData.isAdmin
      this.setData({ isAdmin: false })
      if (isLoggedIn) this._syncAdmin()
    }
    app.on('loginStateChanged', this._onLoginStateChanged)
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
    this._loadAllLocations().then(() => {
      this._buildMapMarkers()
      this.setData({ viewCount: this.data.locationList.length })
    })
    // 深色模式实时同步（统一走 utils/common 的 bindDarkMode）
    bindDarkMode(this)
  },

  onUnload() {
    unbindDarkMode(this)
    app.off('cityReady', this._onCityReady)
    app.off('loginStateChanged', this._onLoginStateChanged)
    if (this._citySearchTimer) clearTimeout(this._citySearchTimer)
    if (this._favTimer) clearTimeout(this._favTimer)
    if (this._layoutRetryTimer) clearTimeout(this._layoutRetryTimer)
  },

  onReady() {
    this._measureLayout()
  },

  /**
   * 测量顶部布局：导航栏高度 + 精选抽屉底边。
   * 精选抽屉位于导航栏内部，其底边已经包含「状态栏 + 标题 + 搜索栏 + 抽屉手柄」，
   * 是底部面板全开时环境栏应当贴着的位置——用它当「顶部遮挡」，
   * 环境栏就能与精选抽屉刚好并拢，且不会被遮住。
   *
   * 这个值只测一次是不够的：onReady 时布局可能还没落定（抽屉 rect 取到 0），
   * 于是面板按兜底值算高了，表现为「环境栏上滑到顶被精选地点盖住」且此后不会自愈。
   * 因此取不到抽屉底边时延迟重测一次，页面重新显示时也补测。
   */
  _measureLayout(retry = true) {
    wx.createSelectorQuery()
      .select('.custom-nav-bar').boundingClientRect()
      .select('.featured-drawer').boundingClientRect()
      .exec(res => {
        const navRect = res && res[0]
        const drawerRect = res && res[1]
        const patch = {}
        if (navRect && navRect.height > 0) patch.customNavHeight = navRect.height
        // 抽屉底边 = 底部面板全开时面板顶边的上限
        if (drawerRect && drawerRect.bottom > 0) this._featuredBottom = drawerRect.bottom
        if (Object.keys(patch).length) this.setData(patch)
        this._measurePanelMetrics()
        if (retry && !(this._featuredBottom > 0)) {
          if (this._layoutRetryTimer) clearTimeout(this._layoutRetryTimer)
          this._layoutRetryTimer = setTimeout(() => this._measureLayout(false), 400)
        }
      })
  },

  /**
   * 计算面板三档高度（px）与精选抽屉的展开高度。
   * rpx → px 用屏幕宽度折算（750rpx = 屏宽）。
   * 面板全开高度 = 视口高度 - 实测精选抽屉底边，
   * 这样环境栏不会被顶部遮挡，且两者之间没有缝隙。
   */
  _measurePanelMetrics() {
    const info = app.globalData.systemInfo || wx.getWindowInfo()
    const pxPerRpx = (info.windowWidth || 375) / 750
    const windowHeight = info.windowHeight || 667
    this._pxPerRpx = pxPerRpx

    // 顶部遮挡高度 = 精选抽屉底边（抽屉在导航栏内部，底边已含状态栏 / 标题 / 搜索栏 / 手柄）。
    // onReady 实测后写入 _featuredBottom；首帧用导航栏推算高度兜底。
    // 兜底值必须按导航栏真实结构算（状态栏占位 + 状态栏内边距 + 标题 80rpx + 内容行 + 抽屉手柄 76rpx），
    // 一旦算小，面板就会变高，全开态把环境栏顶进导航栏里。
    const navHeight = this.data.customNavHeight || Math.round(
      this.data.statusBarHeight * 2 + (80 + 76) * pxPerRpx + (this.data.navBarHeight || 44)
    )
    const topObstruction = (this._featuredBottom && this._featuredBottom > 0) ? this._featuredBottom : navHeight

    // 全开时顶部恰好贴着抽屉下边缘。不能再叠加比例/高度上限，否则会留缝。
    this._panelCollapsedHeight = PANEL_COLLAPSED_HEIGHT * pxPerRpx
    this._panelFullHeight = Math.max(this._panelCollapsedHeight, windowHeight - topObstruction)
    this._panelHalfHeight = Math.min(this._panelFullHeight, PANEL_HALF_HEIGHT * pxPerRpx)
    this._featuredFullHeight = Math.min(windowHeight * FEATURED_BODY_RATIO, FEATURED_BODY_MAX_RPX * pxPerRpx)

    this.setData({ panelFullHeight: Math.round(this._panelFullHeight) })
    this._applyPanelState(this.data.mapPanelState)
  },

  /**
   * 把面板吸附到指定档位。三档共用同一个 translateY：
   *   0                            → 全开
   *   fullHeight - halfHeight      → 半开
   *   fullHeight - collapsedHeight → 收起
   */
  _applyPanelState(state) {
    // 底部面板要上滑时先收起上方列表，避免高层级导航栏盖住环境栏。
    if (state !== 'collapsed' && this.data.featuredBodyHeight > 0) this._setFeaturedHeight(0)
    const full = this._panelFullHeight || 0
    const half = this._panelHalfHeight || 0
    const collapsed = this._panelCollapsedHeight || 0
    let translate = 0
    if (state === 'half') translate = Math.max(0, full - half)
    else if (state === 'collapsed') translate = Math.max(0, full - collapsed)
    this.setData({ mapPanelState: state, panelTranslate: Math.round(translate), mapPanelDragOffset: 0 })
    this._syncFabOffset(0)
  },

  /**
   * 让 FAB 始终贴着面板上沿，并随拖拽实时跟随。
   * 面板 bottom: 0，可见高度 = 面板总高 - 当前总位移。
   */
  _syncFabOffset(dragOffset) {
    const full = this._panelFullHeight || 300
    const collapsed = this._panelCollapsedHeight || (PANEL_COLLAPSED_HEIGHT * (this._pxPerRpx || 0.5))
    const offset = typeof dragOffset === 'number' ? dragOffset : this.data.mapPanelDragOffset
    const translate = (this.data.panelTranslate || 0) + offset
    const visibleHeight = Math.max(collapsed, full - translate)
    this.setData({ mapFabFollowOffset: Math.round(visibleHeight + PANEL_FAB_GAP) })
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
    this._syncAdmin()
    // 同步全局城市（可能在后台已更新）
    if (app.globalData.cityReady && app.globalData.currentCity !== this.data.currentCity) {
      this.setData({
        currentCity: app.globalData.currentCity,
        locatedCity: app.globalData.currentCity
      })
    }
    this._fetchWeather()
    // 重新显示时补测一次顶部布局：字体 / 窗口尺寸变化都会让面板高度过期。
    this._measureLayout(false)
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
    const openId = app.globalData.openId
    app.callCloud('manageReports', { action: 'whoami' }).then(res => {
      if (app.globalData.openId !== openId) return
      const isAdmin = !!(res && res.code === 0 && res.data && res.data.isAdmin)
      app.globalData.isAdmin = isAdmin
      this.setData({ isAdmin })
    }).catch(() => {
      if (app.globalData.openId === openId) this.setData({ isAdmin: false })
    })
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
      this._loadFeaturedLocations()
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
      this._loadFeaturedLocations()
    }
    app.on('cityReady', this._onCityReady)
  },

  /**
   * 重新定位（用户点击城市徽章触发）。
   * 定位统一走 app.locateCity()：它会写全局 + 写缓存 + 广播 cityReady，
   * 并且只在这里（用户交互）才发起 wx.getLocation —— 启动时不索权。
   */
  async onReLocate() {
    this.setData({ currentCity: '定位中...' })
    const result = await app.locateCity()
    if (result && result.ok) {
      const latitude = app.globalData.currentLatitude
      const longitude = app.globalData.currentLongitude
      this._currentLatitude = latitude
      this._currentLongitude = longitude
      this.setData({
        currentCity: result.city,
        locatedCity: result.city,
        mapLatitude: latitude,
        mapLongitude: longitude,
        mapScale: 14
      })
      this._fetchWeather()
      this._loadFeaturedLocations()
      return
    }
    // 失败：app.locateCity 内部已回落旧缓存，这里只负责界面反馈。
    this.setData({ currentCity: app.globalData.currentCity || '定位失败' })
    if (result && result.denied) {
      wx.showModal({
        title: '定位权限未开启',
        content: '请在微信设置中开启定位权限，以便为你推荐附近地点。',
        confirmText: '去设置',
        success: r => { if (r.confirm) wx.openSetting() }
      })
    } else {
      wx.showToast({ title: '定位失败，可手动选择城市', icon: 'none' })
    }
  },

  onAvatarTap() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  // ── 城市选择器 ──

  onCityTap() {
    // 还没有城市（启动时不再自动索权定位）→ 这一次点击就是「用户主动发起定位」，
    // 直接定位，不用先让用户进面板再找按钮。
    const city = this.data.currentCity
    if (city === '待定位' || city === '定位失败' || city === '定位中...') {
      this.onReLocate()
      return
    }

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
      this._loadFeaturedLocations()
    })
    wx.showToast({ title: `已切换到${name}`, icon: 'none' })
  },

  onPageScroll(e) {
    // 保留空的滚动监听位：后续如需「回到顶部」等滚动联动效果在此扩展。
  },

  // ── 视角切换（由地图右侧 FAB 触发） ──

  /** FAB「我出过毛」：把本机足迹标注到地图；再次点击恢复「全部」 */
  onFabVisited() {
    wx.vibrateShort({ type: 'light' })
    this._switchView(this.data.viewMode === 'visited' ? 'all' : 'visited')
  },

  /** FAB「我收藏的」：把收藏过的地点标注到地图；再次点击恢复「全部」 */
  onFabFavored() {
    wx.vibrateShort({ type: 'light' })
    this._switchView(this.data.viewMode === 'favored' ? 'all' : 'favored')
  },

  _switchView(key) {
    this.setData({ viewMode: key })
    this._reloadForView()
  },

  /** 按当前视角重新拉取地图数据 */
  _reloadForView() {
    if (this.data.viewMode === 'visited') return this._loadVisitedView()
    if (this.data.viewMode === 'favored') return this._loadFavoredView()
    // 「全部」视角走分页器
    this._loadAllLocations().then(() => {
      this._buildMapMarkers()
      this.setData({ viewCount: this.data.locationList.length })
    })
  },

  /**
   * 把「全部」视角的地点一次性拉齐。
   *
   * 地图是整屏展示的，标点少一个用户就会以为地点没收录；而分页器默认只取第一页，
   * 之前在 16 个地点时只能显示 10 个。这里循环翻页直到 hasMore 为 false。
   * guard 是防呆上限：服务端 hasMore 异常时不会无限请求。
   */
  async _loadAllLocations() {
    pager.reset()
    let refresh = true
    for (let guard = 0; guard < 20; guard++) {
      const list = await pager.load(this, refresh)
      refresh = false
      if (!Array.isArray(list) || !list.length) break
      if (!this.data.hasMore) break
    }
  },

  /**
   * 「我出过毛」视角：只读本机足迹（fur_footprints_v1），零云请求。
   * 有地点库 id 的点仍可跳详情；纯本地点只展示名称与导航。
   */
  _loadVisitedView() {
    let records = []
    try {
      const value = wx.getStorageSync(FOOTPRINT_STORAGE_KEY)
      if (Array.isArray(value)) records = value
    } catch (e) { /* 按无记录处理 */ }
    const list = records
      .filter(r => r && !r.autoMarked && Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)))
      .map(r => ({
        _id: r.locationId || '',
        name: r.placeName || '出毛地点',
        city: r.city || '',
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
        images: [],
        address: r.city ? `${r.city} · ${sameDayText(r.visitedAt)} 出毛` : `${sameDayText(r.visitedAt)} 出毛`,
        isFavorited: false,
        favoriteCount: 0,
        viewCount: 0
      }))
    this.setData({ locationList: list, viewCount: list.length })
    this._buildMapMarkers()
    if (!list.length) wx.showToast({ title: '还没有出毛记录，去足迹页记一笔', icon: 'none' })
  },

  /** 「我收藏的」视角：拉取当前用户收藏的地点 */
  _loadFavoredView() {
    if (!app.globalData.isLoggedIn) {
      wx.showModal({
        title: '请先登录',
        content: '登录后即可在地图上查看你收藏的地点。',
        confirmText: '去登录',
        success: result => {
          if (result.confirm) wx.switchTab({ url: '/pages/profile/profile' })
        }
      })
      return
    }
    app.callCloud('getUserContent', { tab: 'favorite', page: 1, pageSize: 50 }).then(res => {
      const list = (res && res.code === 0 && Array.isArray(res.data))
        ? res.data.filter(item => Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude)))
        : []
      this.setData({ locationList: list, viewCount: list.length })
      this._buildMapMarkers()
      if (!list.length) wx.showToast({ title: '还没有收藏的地点', icon: 'none' })
    }).catch(() => {
      wx.showToast({ title: '收藏列表加载失败', icon: 'none' })
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
          this._loadFeaturedLocations()
        })
      },
      fail: () => wx.showToast({ title: '请授权位置权限', icon: 'none' })
    })
  },

  // ── 天气 ──

  _fetchWeather() {
    const city = normalizeCityKeyword(this.data.currentCity)
    const latitude = Number(this.data.mapLatitude)
    const longitude = Number(this.data.mapLongitude)
    const requestSeq = ++this._weatherRequestSeq
    const hasCity = !!city && city !== '定位中...' && city !== '定位失败'
    const primaryParams = hasCity ? { city, latitude, longitude } : { latitude, longitude }

    // 保留同一城市上次成功的数据；云端临时无数据时展示真实缓存，不清空环境栏。
    const cacheKey = `weather_${hasCity ? city : `${latitude},${longitude}`}`
    let cached = null
    try { cached = wx.getStorageSync(cacheKey) } catch (e) { cached = null }
    const cachedView = cached && cached.view && this._hasWeatherValues(cached.view) ? cached.view : null
    if (cachedView) this.setData({ weatherView: cachedView })
    if (cachedView && cached.timestamp && Date.now() - cached.timestamp < 30 * 60 * 1000) return

    const applyResult = result => {
      if (requestSeq !== this._weatherRequestSeq) return true
      const view = result && result.code === 0 ? this._formatWeather(result.data) : null
      if (!view || !this._hasWeatherValues(view)) return false
      this.setData({ weatherView: view })
      try { wx.setStorageSync(cacheKey, { view, timestamp: Date.now() }) } catch (e) { /* 缓存不可用不影响展示 */ }
      return true
    }
    const keepLastKnown = () => {
      if (requestSeq !== this._weatherRequestSeq) return
      this.setData({ weatherView: cachedView || null })
    }

    app.callCloud('getWeather', primaryParams).then(result => {
      if (applyResult(result)) return
      // 城市名查询无实时天气时再按坐标查询一次，避免城市映射缺失导致空栏。
      if (hasCity && Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return app.callCloud('getWeather', { latitude, longitude }).then(fallbackResult => {
          if (!applyResult(fallbackResult)) keepLastKnown()
        }).catch(keepLastKnown)
      }
      keepLastKnown()
    }).catch(keepLastKnown)
  },

  /** 天气值可能来自不同版本的云函数，数字和数字字符串都可识别。 */
  _formatWeather(data) {
    if (!data || typeof data !== 'object') return null
    const asNumber = value => {
      if (value === null || value === undefined || value === '') return null
      const number = Number(value)
      return Number.isFinite(number) ? number : null
    }
    const temperature = asNumber(data.temperature)
    const humidity = asNumber(data.humidity)
    const wind = asNumber(data.wind)
    return {
      temperature: temperature !== null ? `${temperature}°` : '—',
      humidity: humidity !== null ? `${humidity}%` : '—',
      wind: data.windDisplay || (wind !== null ? `${wind}级` : '—'),
      condition: String(data.condition || '').trim() || '—',
      furIndex: evaluateFromWeather({ ...data, temperature, humidity, wind })
    }
  },

  _hasWeatherValues(view) {
    return !!view && ['temperature', 'humidity', 'wind', 'condition']
      .some(key => view[key] && view[key] !== '—')
  },

  /** 点击适宜度徽标：展示分项拆解与建议 */
  onFurIndexTap() {
    const fi = this.data.weatherView && this.data.weatherView.furIndex
    if (!fi || !fi.ok) return
    const lines = fi.factors.map(f => `${f.label} ${f.value}：${f.score} 分${f.reason ? `（${f.reason}）` : ''}`)
    wx.showModal({
      title: `出毛适宜度 ${fi.score} 分 · ${fi.levelLabel}`,
      content: `${lines.join('\n')}\n\n建议：${fi.advice.join('；')}\n\n仅供参考，不构成专业建议`,
      showCancel: false
    })
  },

  // ── 顶部精选地点抽屉 ──

  /**
   * 只取运营方标记 featured 的地点（location-upload 的「设为精选推荐」开关）。
   * 数据与地图中心无关，因此不跟随 regionchange 反复请求。
   * 暂无精选数据时展示空态，不悄悄退化成普通热门列表 ——「运营方发布」的语义要保住。
   */
  _loadFeaturedLocations() {
    app.callCloud('getLocations', { featuredOnly: true, page: 1, pageSize: 10 }).then(result => {
      if (result && result.code === 0 && Array.isArray(result.data)) {
        const list = result.data
          .filter(item => item && item.name)
          .sort((a, b) => (Number(b.favoriteCount) || 0) - (Number(a.favoriteCount) || 0))
          .slice(0, 10)
          .map(item => ({ ...item, serviceSummary: item.description ? String(item.description).slice(0, 40) : '运营方精选地点' }))
        this.setData({ featuredLocations: list })
      }
    }).catch(() => {})
  },

  /** 设置抽屉内容高度（px），0 即收起 */
  _setFeaturedHeight(height) {
    const full = this._featuredFullHeight || 0
    const next = Math.max(0, Math.min(full, height))
    // 展开抽屉之前先放下底部面板；否则两个固定层会互相遮挡。
    if (next > 0 && this.data.mapPanelState !== 'collapsed') this._applyPanelState('collapsed')
    this.setData({ featuredBodyHeight: Math.round(next), featuredExpanded: next > 0 })
  },

  onFeaturedToggle() {
    // 拖拽抬手也会派发 tap，用时间戳过滤，避免「刚拖完又被反向折叠」
    if (Date.now() < (this._featuredIgnoreTapUntil || 0)) return
    wx.vibrateShort({ type: 'light' })
    this._setFeaturedHeight(this.data.featuredBodyHeight > 0 ? 0 : (this._featuredFullHeight || 0))
  },

  onFeaturedTouchStart(e) {
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this._featuredTouchStartY = touch.clientY
    this._featuredStartHeight = this.data.featuredBodyHeight
    this._featuredTouchStartAt = Date.now()
    this._featuredDragActive = false
  },

  onFeaturedTouchMove(e) {
    const touch = e.touches && e.touches[0]
    if (!touch) return
    // _featuredTouchStartY 可能在某些边界情况下未初始化，用 0 兜底
    const startY = this._featuredTouchStartY || touch.clientY
    const delta = touch.clientY - startY
    if (!this._featuredDragActive) {
      // 小于 4px 视为轻点，交给 tap 处理，避免吞掉点击
      if (Math.abs(delta) < 4) return
      this._featuredDragActive = true
      this.setData({ featuredDragging: true })
    }
    this._setFeaturedHeight(this._featuredStartHeight + delta)
  },

  onFeaturedTouchEnd() {
    if (!this._featuredDragActive) return
    this._featuredDragActive = false
    this._featuredIgnoreTapUntil = Date.now() + 320
    const elapsed = Math.max(1, Date.now() - this._featuredTouchStartAt)
    const current = this.data.featuredBodyHeight
    const full = this._featuredFullHeight || 0
    // 位移量：正 = 向下拉（展开），负 = 向上拉（收起）
    const velocity = (current - this._featuredStartHeight) / elapsed
    // 吸附判断（阈值放宽，避免「上拉一点又弹回展开」导致用户以为滑不动）：
    // 1. 有明确方向速度时按方向吸附（0.15 px/ms，比原来 0.3 更灵敏）
    // 2. 慢速拖动时按当前位置是否过半判断
    const shouldExpand = velocity > 0.15 ? true
      : velocity < -0.15 ? false
      : current > full * 0.5
    this.setData({ featuredDragging: false })
    this._setFeaturedHeight(shouldExpand ? full : 0)
  },

  /** 点击精选地点：收起抽屉，地图移到该地点，并在底部面板展示概况 */
  onFeaturedTap(e) {
    const item = e.currentTarget.dataset.item
    if (!item) return
    this._setFeaturedHeight(0)
    const latitude = Number(item.latitude)
    const longitude = Number(item.longitude)
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      this._currentLatitude = latitude
      this._currentLongitude = longitude
      this.setData({ mapLatitude: latitude, mapLongitude: longitude, mapScale: 15 })
    }
    // 复用地图标点点击的呈现逻辑，保证两条入口的体验一致
    this._openPoiCard(item)
  },

  // ── 面板拖拽（三档吸附） ──
  // 旧实现是「展开 / 收起」二值，这里改为 full / half / collapsed 三档，
  // 拖拽结束后吸附到最近档位，并允许用快速甩动直接跳到首尾档。

  onPanelTouchStart(e) {
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this._panelTouchStartY = touch.clientY
    this._panelDragOffset = 0
    this._panelTouchStartAt = Date.now()
    this._panelDragActive = false
  },

  onPanelTouchMove(e) {
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const full = this._panelFullHeight || 300
    const collapsed = this._panelCollapsedHeight || (PANEL_COLLAPSED_HEIGHT * (this._pxPerRpx || 0.5))
    const maxTranslate = Math.max(0, full - collapsed)
    const delta = touch.clientY - this._panelTouchStartY
    if (!this._panelDragActive) {
      // 小于 4px 视为轻点，交给 tap / 内部按钮处理，避免吞掉点击
      if (Math.abs(delta) < 4) return
      this._panelDragActive = true
      if (delta < 0 && this.data.featuredBodyHeight > 0) this._setFeaturedHeight(0)
      this.setData({ mapPanelDragging: true, mapFabDragging: true })
    }
    const base = this.data.panelTranslate || 0
    const nextTranslate = Math.max(0, Math.min(maxTranslate, base + delta))
    const offset = nextTranslate - base
    this._panelDragOffset = offset
    this.setData({ mapPanelDragOffset: Math.round(offset) })
    this._syncFabOffset(offset)
  },

  onPanelTouchEnd() {
    if (!this._panelDragActive) return
    this._panelDragActive = false
    const elapsed = Math.max(1, Date.now() - this._panelTouchStartAt)
    const velocity = this._panelDragOffset / elapsed
    const full = this._panelFullHeight || 300
    const half = this._panelHalfHeight || 0
    const collapsed = this._panelCollapsedHeight || (PANEL_COLLAPSED_HEIGHT * (this._pxPerRpx || 0.5))
    const current = Math.max(0, Math.min(full - collapsed, (this.data.panelTranslate || 0) + this._panelDragOffset))

    // 速度优先：快速上滑直接全开、快速下滑直接收起，避免「甩了一下却没动」。
    let next
    if (velocity < -0.5) next = 'full'
    else if (velocity > 0.5) next = 'collapsed'
    else {
      const candidates = [
        { state: 'full', y: 0 },
        { state: 'half', y: Math.max(0, full - half) },
        { state: 'collapsed', y: Math.max(0, full - collapsed) }
      ]
      next = candidates.reduce((best, item) =>
        Math.abs(item.y - current) < Math.abs(best.y - current) ? item : best).state
    }

    this._panelDragOffset = 0
    this.setData({ mapPanelDragging: false, mapFabDragging: false })
    this._applyPanelState(next)
  },

  // ── 地图标记 ──

  _buildMapMarkers() {
    const withCoords = this.data.locationList.filter(i => Number.isFinite(Number(i.latitude)) && Number.isFinite(Number(i.longitude)))
    this._markerLocMap = withCoords

    // 「我出过毛」视角用足迹针，与普通地点针在视觉上区分开
    const iconPath = this.data.viewMode === 'visited' ? '/images/map/marker-footprint.png' : '/images/marker.png'

    const locMarkers = withCoords.map((item, idx) => ({
      id: idx,
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
      iconPath,
      // 信息交由自定义浮层展示，避免原生 callout 与 map tap 同时触发。
      width: MARKER_WIDTH,
      height: MARKER_HEIGHT
    }))

    const extra = this._tapMarker ? [this._tapMarker] : []
    this.setData({
      mapMarkers: [...locMarkers, ...this.data.searchMarkers, ...extra]
    })
  },

  /** 在点击位置放一根识别针（先给即时反馈，识别完成后再更新名称） */
  _setTapMarker(latitude, longitude, name) {
    this._tapMarker = {
      id: TAP_MARKER_ID,
      latitude,
      longitude,
      iconPath: '/images/marker.png',
      width: 40,
      height: 48,
      callout: {
        content: name || '识别中…',
        fontSize: 13,
        borderRadius: 10,
        bgColor: '#D4890E',
        color: '#ffffff',
        padding: 8,
        display: 'ALWAYS'
      }
    }
    this._appendTapMarker()
  },

  _updateTapMarkerName(name) {
    if (!this._tapMarker || !name) return
    this._tapMarker.callout.content = String(name).slice(0, 16)
    this._appendTapMarker()
  },

  _appendTapMarker() {
    const markers = this.data.mapMarkers.filter(m => m.id !== TAP_MARKER_ID)
    if (this._tapMarker) markers.push(this._tapMarker)
    this.setData({ mapMarkers: markers })
  },

  // ── 分页 ──

  onPullDownRefresh() {
    const reload = this._reloadForView()
    stopRefresh(Promise.resolve(reload).then(() => {
      this.setData({ viewCount: this.data.locationList.length })
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
    // 搜索标点 / 点击识别针不属于内部地点，没有对应详情，直接忽略。
    if (idx === SEARCH_MARKER_ID || idx === TAP_MARKER_ID) return
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

    // 「我出过毛」视角的纯本机记录没有地点库 _id：不能收藏、不能跳详情，
    // 只保留「已出毛 / 导航」等离线可用的操作。
    if (!poi._id) {
      poi.canFavorite = false
      poi.canViewDetail = false
    }

    this._updateTapMarkerName(loc.name)
    this._presentPoi(poi)
  },

  /**
   * 把地点交给底部面板：更新轮播数据并把面板吸附到半开态。
   * 用户再上滑即展开完整详情，符合「先看概况、再看详情」的两段式节奏。
   */
  _presentPoi(poi) {
    const images = Array.isArray(poi.images) ? poi.images.filter(Boolean) : []
    const gallery = images.slice()
    if (poi.previewImage && gallery.indexOf(poi.previewImage) === -1) gallery.unshift(poi.previewImage)
    this.setData({ selectedPoi: poi, poiGallery: gallery, poiCurrentImage: 0 })
    this._applyPanelState('half')
  },

  /** 地点列表加载失败后重试，成功后重建地图标点 */
  onMapLoadRetry() {
    wx.showLoading({ title: '重新加载...' })
    const reload = this._reloadForView()
    Promise.resolve(reload).catch(() => {}).finally(() => wx.hideLoading())
  },

  /**
   * 点击地图空白处：直接请求腾讯位置服务识别该点并在地图上落针标点。
   * 不再「第一次点击先收卡片」——一次点击就完成标点 + 识别 + 弹卡片。
   */
  onMapTap(e) {
    // 某些基础库会在 markertap 后继续派发 map tap；短暂忽略，避免浮层闪退。
    if (Date.now() < (this._ignoreMapTapUntil || 0)) return
    const detail = e && e.detail
    const latitude = Number(detail && detail.latitude)
    const longitude = Number(detail && detail.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    this._setTapMarker(latitude, longitude, '识别中…')
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
    const detail = e && e.detail
    const latitude = Number(detail && detail.latitude)
    const longitude = Number(detail && detail.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return

    // 底图 POI 已经带了名称，直接用它构建卡片，省掉一次网络往返。
    // 但「是否已被小程序收录」仍需云函数判定，因此照常请求。
    const poiName = (detail && detail.name) || ''
    this._setTapMarker(latitude, longitude, poiName || '识别中…')
    this._queryNearbyMapPoi(latitude, longitude, { poiName })
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
    this._updateTapMarkerName(raw.name)
    // 命中已有内部地点时，直接沿用内部卡片体验（含热度、打卡、收藏）
    if (raw.collectionStatus === COLLECTION_STATUS.COLLECTED && raw.matchedLocationId) {
      const matched = this.data.locationList.find(item => item._id === raw.matchedLocationId)
      if (matched) {
        this._openPoiCard(matched)
        return
      }
    }
    const poi = normalizePoi(raw, 'tencent')
    this._presentPoi(poi)
  },

  /** 附近没有任何可识别地点时的兜底卡片 */
  _openUnresolvedPoi(latitude, longitude) {
    const poi = normalizePoi({ latitude, longitude }, 'unresolved')
    this._presentPoi(poi)
  },

  /**
   * 主按钮「已出毛」：把当前地点写入本机出毛记录。
   * 只写本机存储（fur_footprints_v1），零云请求、零跨用户内容。
   */
  onPoiMarkVisited() {
    const poi = this.data.selectedPoi || {}
    const name = poi.name
    if (!name) return
    try {
      const records = wx.getStorageSync(FOOTPRINT_STORAGE_KEY)
      const list = Array.isArray(records) ? records : []
      list.push({
        id: `fp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        placeName: name,
        city: poi.city || '',
        locationId: poi._id || '',
        latitude: Number(poi.latitude) || null,
        longitude: Number(poi.longitude) || null,
        visitedAt: Date.now(),
        companions: '',
        note: '',
        photos: []
      })
      wx.setStorageSync(FOOTPRINT_STORAGE_KEY, list)
      wx.vibrateShort({ type: 'light' })
      wx.showToast({ title: '已记一次出毛（仅本机）', icon: 'success' })
      // 若正停留在「我出过毛」视角，立即把新点画上地图
      if (this.data.viewMode === 'visited') this._loadVisitedView()
    } catch (err) {
      wx.showToast({ title: '记录失败，请重试', icon: 'none' })
    }
  },

  /** 导航：调起微信内置地图 */
  onPoiNavigate() {
    const poi = this.data.selectedPoi || {}
    const latitude = Number(poi.latitude)
    const longitude = Number(poi.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      wx.showToast({ title: '暂无位置信息', icon: 'none' })
      return
    }
    wx.openLocation({
      latitude,
      longitude,
      name: poi.name || '',
      address: poi.address || '',
      scale: 15
    })
    app.trackEvent('map_navigation', { targetId: poi._id || '', targetType: 'location' })
  },

  /** 进入地点详情页（仅已收录的内部地点有 _id） */
  onPoiViewDetail() {
    const id = this.data.selectedPoi && this.data.selectedPoi._id
    if (id) wx.navigateTo({ url: `/pages/location-detail/location-detail?id=${id}` })
  },

  /** 运营方：外部地点 → 预填录入页 */
  onPoiAddToDiary() {
    const poi = this.data.selectedPoi || {}
    if (!poi.name) return
    const params = {
      poiName: poi.name,
      poiAddress: poi.address || '',
      poiCategory: poi.categoryName || '',
      poiLat: poi.latitude,
      poiLng: poi.longitude,
      poiSource: poi.externalSource || '',
      poiExternalId: poi.externalId || ''
    }
    const query = Object.keys(params)
      .filter(key => params[key] !== '' && params[key] !== null && params[key] !== undefined)
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&')
    wx.navigateTo({ url: `/pages/location-upload/location-upload?${query}` })
  },

  /**
   * 反馈此地点：带着当前地点信息跳到「用户 → 运营方」的单向反馈表单。
   *
   * 这里曾经用 wx.showActionSheet 选地点类型，结果是「点了完全没反应」：
   * 官方限制 itemList 最多 6 项，而地点类型是 7 项的封闭集合
   * （自然风光 / 城市街景 / 室内场景 / 公园绿地 / 水域 / 山地 / 其他），
   * 超限时 showActionSheet 不弹面板直接走 fail —— 用户什么都看不到。
   * 表单页的类型是标签墙，不受这个上限约束，也让反馈只有唯一落点。
   */
  onPoiFeedback() {
    const poi = this.data.selectedPoi || {}
    if (!poi.name) {
      wx.showToast({ title: '暂无地点信息', icon: 'none' })
      return
    }
    const params = {
      mode: 'poi',
      name: poi.name,
      category: poi.categoryName || '',
      address: poi.address || '',
      latitude: Number(poi.latitude) || '',
      longitude: Number(poi.longitude) || ''
    }
    const query = Object.keys(params)
      .filter(key => params[key] !== '' && params[key] !== null && params[key] !== undefined)
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&')
    wx.navigateTo({ url: `/pages/location-feedback/location-feedback?${query}` })
  },

  /** 面板内直接收藏 / 取消收藏，无需进入详情页 */
  onPoiFavorite() {
    const poi = this.data.selectedPoi
    const id = poi && poi._id
    if (!id || this._favPending) return
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
    // 短时防抖：避免连点导致同一地点被反复收藏 / 取消
    this._favPending = true
    this.setData({
      'selectedPoi.isFavorited': nextFavorited,
      'selectedPoi.favoriteCount': nextCount,
      favPending: true
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
    }).finally(() => {
      clearTimeout(this._favTimer)
      this._favTimer = setTimeout(() => {
        this._favPending = false
        this.setData({ favPending: false })
      }, 600)
    })
  },

  /** 地址一键复制 */
  onPoiCopyAddress() {
    const addr = this.data.selectedPoi && this.data.selectedPoi.address
    if (!addr) return
    wx.setClipboardData({
      data: addr,
      success: () => {
        wx.showToast({ title: '地址已复制', icon: 'success' })
        wx.vibrateShort({ type: 'light' })
      }
    })
  },

  /** 只记录当前页，不回写 current，避免干扰 swiper 滑动 */
  onPoiGalleryChange(e) {
    this.setData({ poiCurrentImage: e.detail.current })
  },

  onPoiPreviewImage() {
    const gallery = this.data.poiGallery
    if (!gallery.length) return
    wx.previewImage({
      current: gallery[this.data.poiCurrentImage] || gallery[0],
      urls: gallery
    })
  },

  onMapRegionChange: debounce(function (e) {
    if (e.type !== 'regionchange') return
    const detail = e.detail || {}
    const nextScale = Number(detail.scale)
    if (Number.isFinite(nextScale) && nextScale >= 3 && nextScale <= 20) {
      this.setData({ mapScale: nextScale })
    }
    if (detail.centerLocation) {
      // 只记录当前中心，供距离计算使用。
      // 精选地点与地图中心无关，因此不再随 regionchange 反复请求。
      this._currentLatitude = detail.centerLocation.latitude
      this._currentLongitude = detail.centerLocation.longitude
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
