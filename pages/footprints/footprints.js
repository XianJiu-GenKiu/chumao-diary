/**
 * 我的足迹（tabBar 一级页：成就地图 + 出毛记录 + 城市徽章 + 我的兽聚）
 *
 * ⚠️ 合规设计（改前必读）：
 * 1. 所有数据只存本机（wx.setStorageSync），服务端零个人内容；
 * 2. 小程序内没有任何"看别人足迹"的入口 —— 无列表流、无排行、无点赞；
 * 3. 同伴字段是纯文本本地备注，绝不做用户选择/搜索/艾特；
 * 4. 兽聚由用户本机自建（名字/城市/日期/照片），仅自己可见，
 *    无创建公开活动/报名/参与人/讨论/倒计时，不是活动系统；
 * 5. 分享只产出一张个人海报（saveToAlbum / 微信原生分享），海报内容全部程序生成。
 */

const app = getApp()
const { bindDarkMode, unbindDarkMode } = require('../../utils/common.js')
const { CITY_CANDIDATES, PROVINCE_OF_CITY, CITY_MAP } = require('../../config/cities.js')
const { cityLabel } = require('../../config/city-labels.js')
const { ALL_PROVINCES, PROVINCE_LEGEND, PROVINCE_RAMP, buildProvinceBadges } = require('../../utils/provinceBadges.js')
const { buildStops, buildRadialArcs } = require('../../utils/mapView.js')
const {
  firstAttendedAt,
  meetDates,
  addAttendance,
  meetAttendances,
  groupMeetsByCity,
  buildMeetCards,
  meetStats
} = require('../../utils/furmeets.js')

const STORAGE_KEY = 'fur_footprints_v1'
const MEET_STORAGE_KEY = 'fur_furmeets_v1'
const MARKER_FOOTPRINT = '/images/map/marker-footprint.png'
const MARKER_FURMEET = '/images/map/marker-furmeet.png'

/** 中国大致中心，足迹为空时的地图默认视野 */
const DEFAULT_CENTER = { latitude: 35.0, longitude: 105.0, scale: 4 }

/** 一天毫秒数（里程碑「出毛元年」用） */
const DAY_MS = 24 * 60 * 60 * 1000

/** 里程碑规则（纯计算，达成即点亮） */
const MILESTONES = [
  { key: 'first-visit', label: '毛装初体验', desc: '记录第 1 次出毛', test: s => s.visits >= 1 },
  { key: 'visits-5', label: '新毛报到', desc: '累计出毛 5 次', test: s => s.visits >= 5 },
  { key: 'visits-30', label: '老毛出没', desc: '累计出毛 30 次', test: s => s.visits >= 30 },
  { key: 'visits-100', label: '毛瘾晚期', desc: '累计出毛 100 次', test: s => s.visits >= 100 },
  { key: 'places-2', label: '两枚爪印', desc: '到访 2 个不同地点', test: s => s.places >= 2 },
  { key: 'places-5', label: '五爪留痕', desc: '到访 5 个不同地点', test: s => s.places >= 5 },
  { key: 'places-10', label: '十爪寻踪', desc: '到访 10 个不同地点', test: s => s.places >= 10 },
  { key: 'places-20', label: '兽迹遍地', desc: '到访 20 个不同地点', test: s => s.places >= 20 },
  { key: 'cities-2', label: '双城兽影', desc: '点亮 2 座城市', test: s => s.cities >= 2 },
  { key: 'cities-5', label: '五城毛踪', desc: '点亮 5 座城市', test: s => s.cities >= 5 },
  { key: 'cities-10', label: '十城毛迹', desc: '点亮 10 座城市', test: s => s.cities >= 10 },
  { key: 'cities-20', label: '廿城兽图', desc: '点亮 20 座城市', test: s => s.cities >= 20 },
  { key: 'furmeet-first', label: '首次认亲', desc: '记录第 1 场兽聚', test: s => s.furmeetCount >= 1 },
  { key: 'furmeet-3', label: '聚会熟毛', desc: '参加 3 场兽聚', test: s => s.furmeetCount >= 3 },
  { key: 'furmeet-10', label: '兽聚扛把子', desc: '累计参加兽聚 10 场', test: s => s.furmeetCount >= 10 },
  { key: 'furmeet-cities-5', label: '五城认亲', desc: '在 5 座城市参加过兽聚', test: s => s.furmeetCities >= 5 },
  { key: 'furmeet-places-5', label: '兽聚集邮', desc: '记录 5 个不同兽聚', test: s => s.furmeetDistinct >= 5 },
  { key: 'span-year', label: '出毛元年', desc: '出毛记录跨越一整年', test: s => s.spanDays >= 365 }
]

function loadRecords() {
  try {
    const value = wx.getStorageSync(STORAGE_KEY)
    return Array.isArray(value) ? value : []
  } catch (e) {
    return []
  }
}

function saveRecords(list) {
  try {
    wx.setStorageSync(STORAGE_KEY, list)
  } catch (e) {
    wx.showToast({ title: '本地存储写入失败', icon: 'none' })
  }
}

function loadMeets() {
  try {
    const value = wx.getStorageSync(MEET_STORAGE_KEY)
    return Array.isArray(value) ? value : []
  } catch (e) {
    return []
  }
}

function saveMeets(list) {
  try {
    wx.setStorageSync(MEET_STORAGE_KEY, list)
  } catch (e) {
    wx.showToast({ title: '本地存储写入失败', icon: 'none' })
  }
}

function pad(n) {
  return String(n).padStart(2, '0')
}

/** 稳定的伪随机偏移（同一 id 永远得到同一偏移，避免每次刷新图标跳动） */
function jitter(id) {
  let h = 0
  const s = String(id)
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return ((h % 7) - 3) * 0.012
}

function sameDay(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 保存照片到本机持久目录（temp 路径重启即失效） */
function persistPhotos(tempFiles, done) {
  const fsm = wx.getFileSystemManager()
  const saved = []
  let pending = tempFiles.length
  tempFiles.forEach(f => {
    fsm.saveFile({
      tempFilePath: f.tempFilePath,
      success: r => saved.push(r.savedFilePath),
      fail: () => saved.push(f.tempFilePath),
      complete: () => {
        pending--
        if (pending === 0) done(saved)
      }
    })
  })
}

Page({
  data: {
    darkMode: false,
    activeTab: 'map',

    // ── 统计 ──
    stats: { visits: 0, places: 0, cities: 0, days: 0, furmeetCount: 0, furmeetDistinct: 0, furmeetCities: 0, spanDays: 0 },

    // ── 成就地图 ──
    markers: [],
    polyline: [],
    includePoints: [],
    mapLatitude: DEFAULT_CENTER.latitude,
    mapLongitude: DEFAULT_CENTER.longitude,
    mapScale: DEFAULT_CENTER.scale,
    hasPoints: false,

    // ── 徽章 ──
    milestones: [],
    rampLegend: PROVINCE_LEGEND,
    // 成就地图两种画法：trace = 相邻两点连成时间轨迹，migration = 从第一次出毛的地点放射出去
    mapMode: 'trace',
    provinceTotal: ALL_PROVINCES.length,
    provinceBadges: [],
    litProvinceCount: 0,
    // 当前展开的省份名与它的下钻数据（null 表示面板收起）
    openProvince: '',
    openProvinceData: null,
    myMeets: [],
    // 兽聚选择弹层：先从自己记过的聚里点一个，再决定要不要新增
    showMeetPicker: false,
    meetChoices: [],

    // ── 记录列表 ──
    logGroups: [],
    logTotal: 0,

    // ── 出毛记录表单 ──
    showForm: false,
    editingId: '',
    form: {
      placeName: '',
      city: '',
      locationId: '',
      latitude: null,
      longitude: null,
      visitedAt: null,
      companions: '',
      note: '',
      photos: []
    },
    formDate: '',
    formTime: '',
    cityIndex: -1,
    cityNames: [],
    coordsSource: '',

    // ── 兽聚表单（本机自建） ──
    showMeetForm: false,
    editingMeetId: '',
    meetForm: {
      name: '',
      city: '',
      latitude: null,
      longitude: null,
      date: '',
      note: '',
      photos: []
    },
    meetDate: '',
    meetCityIndex: -1,
    meetCoordsSource: ''
  },

  onLoad() {
    this.setData({
      darkMode: app.globalData.darkMode || false,
      cityNames: CITY_CANDIDATES.map(c => cityLabel(c.name))
    })
    bindDarkMode(this)
    this.rebuild()
  },

  onShow() {
    this.rebuild()
    this._consumePrefill()
  },

  onUnload() {
    unbindDarkMode(this)
  },

  /**
   * 消费从地点详情页「记录出毛」带过来的预填信息。
   * 足迹页是 tabBar 页面，switchTab 不支持 query 参数，
   * 因此 location-detail 把预填写入 app.globalData.footprintPrefill，这里读取后清掉。
   */
  _consumePrefill() {
    const prefill = app.globalData && app.globalData.footprintPrefill
    if (!prefill || prefill.add !== '1') return
    app.globalData.footprintPrefill = null
    const parsed = {
      placeName: prefill.placeName || '',
      city: prefill.city || '',
      locationId: prefill.locationId || '',
      latitude: prefill.latitude ? Number(prefill.latitude) : null,
      longitude: prefill.longitude ? Number(prefill.longitude) : null
    }
    if (!parsed.placeName && !parsed.locationId) return
    this.setData({ activeTab: 'logs' })
    this.openFormNew(parsed)
    // 地点库数据不一定带 city，有坐标时兜底逆解析一次
    if (!parsed.city && parsed.latitude && parsed.longitude) {
      this._reverseCity(parsed.latitude, parsed.longitude)
    }
  },

  // ── 数据构建 ──

  rebuild() {
    const records = loadRecords()
    const meets = loadMeets()
    const stats = this._computeStats(records, meets)
    const map = this._buildMap(records, meets)
    const milestones = MILESTONES.map(m => ({
      key: m.key,
      label: m.label,
      desc: m.desc,
      unlocked: m.test(stats)
    }))
    const unlockedCount = milestones.filter(m => m.unlocked).length
    const provinceBadges = buildProvinceBadges(records)
    // 展开的省份在下钻数据里找不到（记录被删空或换了人）时自动收起，面板不停留在过期数据上
    const openProvinceData = provinceBadges.find(p => p.name === this.data.openProvince) || null

    // 两种画法一次都建好，切换时只换 polyline，不必为了一次点击重跑整页 rebuild
    this._polylines = { trace: map.polyline, migration: map.migrationPolyline }

    this.setData({
      stats,
      markers: map.markers,
      polyline: this._polylines[this.data.mapMode] || [],
      includePoints: map.includePoints,
      hasPoints: map.markers.length > 0,
      mapLatitude: map.center.latitude,
      mapLongitude: map.center.longitude,
      mapScale: map.center.scale,
      milestones,
      unlockedCount,
      provinceBadges,
      litProvinceCount: provinceBadges.filter(p => p.active).length,
      openProvince: openProvinceData ? openProvinceData.name : '',
      openProvinceData,
      myMeets: buildMeetCards(meets),
      meetChoices: groupMeetsByCity(meets),
      logGroups: this._buildLogGroups(records),
      logTotal: records.length
    })
  },

  _computeStats(records, meets) {
    const places = new Set()
    const cities = new Set()
    const days = new Set()
    let firstTs = Infinity
    let lastTs = 0

    records.forEach(r => {
      if (r.placeName) places.add(r.placeName)
      if (r.city) cities.add(r.city)
      if (r.visitedAt) {
        days.add(sameDay(r.visitedAt))
        firstTs = Math.min(firstTs, r.visitedAt)
        lastTs = Math.max(lastTs, r.visitedAt)
      }
    })

    // 兽聚口径统一走 utils/furmeets —— 分享海报用的是同一份，避免两处各算一套
    const meetAgg = meetStats(meets)

    return {
      visits: records.length,
      places: places.size,
      cities: cities.size,
      days: days.size,
      furmeetCount: meetAgg.furmeetCount,
      furmeetDistinct: meetAgg.furmeetDistinct,
      furmeetCities: meetAgg.furmeetCities,
      spanDays: Number.isFinite(firstTs) && lastTs > firstTs ? Math.floor((lastTs - firstTs) / DAY_MS) : 0
    }
  },

  _buildMap(records, meets) {
    const markers = []
    const footPoints = []
    let markerId = 0

    const sorted = records.slice().sort((a, b) => (a.visitedAt || 0) - (b.visitedAt || 0))

    sorted.forEach(r => {
      const fallback = CITY_MAP[r.city] || DEFAULT_CENTER
      const isCityCenter = !Number(r.latitude) && !!CITY_MAP[r.city]
      const lat = Number(r.latitude) || fallback.latitude
      const lng = Number(r.longitude) || fallback.longitude
      const offset = isCityCenter ? jitter(r.id || r.placeName) : 0
      const point = { latitude: lat + offset, longitude: lng + offset }

      if (r.autoMarked) return // 兽聚打卡产生的轻记录已由兽聚针表达，不再画足迹针
      markers.push({
        id: markerId++,
        latitude: point.latitude,
        longitude: point.longitude,
        iconPath: MARKER_FOOTPRINT,
        width: 32,
        height: 40,
        title: r.placeName || '',
        callout: {
          content: r.placeName || '出毛地点',
          fontSize: 13,
          borderRadius: 10,
          bgColor: '#D4890E',
          color: '#ffffff',
          padding: 8,
          display: 'BYTAP'
        }
      })
      footPoints.push(point)
    })

    // 兽聚针：来自用户本机自建的兽聚（仅自己可见）
    ;(meets || []).forEach((m, index) => {
      const fallback = CITY_MAP[m.city] || DEFAULT_CENTER
      const isCityCenter = !Number(m.latitude) && !!CITY_MAP[m.city]
      const offset = isCityCenter ? jitter(m.id) : 0
      markers.push({
        id: 900000 + index,
        latitude: (Number(m.latitude) || fallback.latitude) + offset,
        longitude: (Number(m.longitude) || fallback.longitude) + offset,
        iconPath: MARKER_FURMEET,
        width: 32,
        height: 40,
        title: m.name,
        callout: {
          content: `兽聚 · ${m.name}`,
          fontSize: 13,
          borderRadius: 10,
          bgColor: '#2E9E8F',
          color: '#ffffff',
          padding: 8,
          display: 'BYTAP'
        }
      })
    })

    const allPoints = markers.map(m => ({ latitude: m.latitude, longitude: m.longitude }))

    let center
    if (!allPoints.length) {
      center = { latitude: DEFAULT_CENTER.latitude, longitude: DEFAULT_CENTER.longitude, scale: DEFAULT_CENTER.scale }
    } else if (allPoints.length === 1) {
      center = { latitude: allPoints[0].latitude, longitude: allPoints[0].longitude, scale: 13 }
    } else {
      center = { latitude: allPoints[0].latitude, longitude: allPoints[0].longitude, scale: 5 }
    }

    const polyline = footPoints.length >= 2
      ? [{
          points: footPoints,
          color: '#D4890ECC',
          width: 3,
          dottedLine: false,
          arrowLine: true
        }]
      : []

    // 迁徙图：从第一次出毛的地点向其余每个地点各画一条弧。
    // 弧线用 buildArcPath 采样成多点折线 —— 原生 map 的 polyline 只会连直线，
    // 采样够密（24 段）屏幕上才呈现出弓形；每条弧线一个 polyline 对象，
    // 否则相邻两条会被当成一条线连起来。
    // ponytail: 一个地点一条 polyline（轨迹只需一条）。几十条没问题，
    // 上百个地点才会开始吃力，到那时再按时间截断或聚类，现在没这个量。
    const migrationPolyline = footPoints.length >= 2
      ? buildRadialArcs(buildStops(footPoints), PROVINCE_RAMP, { bow: 0.18, steps: 24 }).map(arc => ({
          points: arc.path,
          color: `${arc.color}CC`,
          width: 3,
          dottedLine: false,
          arrowLine: true
        }))
      : []

    return { markers, polyline, migrationPolyline, includePoints: allPoints, center }
  },

  _buildLogGroups(records) {
    const sorted = records.slice().sort((a, b) => (b.visitedAt || 0) - (a.visitedAt || 0))
    const groups = []
    const byMonth = {}

    sorted.forEach(r => {
      const d = new Date(r.visitedAt || Date.now())
      const month = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
      if (!byMonth[month]) {
        byMonth[month] = []
        groups.push({ month, items: byMonth[month] })
      }

      byMonth[month].push({
        id: r.id,
        dateText: `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
        placeName: r.placeName || '未命名地点',
        cityLabel: cityLabel(r.city),
        companions: r.companions || '',
        note: r.note || '',
        photos: Array.isArray(r.photos) ? r.photos : [],
        locationId: r.locationId || ''
      })
    })

    return groups
  },

  // ── 交互 ──

  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab && tab !== this.data.activeTab) this.setData({ activeTab: tab })
  },

  onMarkerTap() { /* callout 已展示名称，无需额外处理 */ },

  onMapModeTap(e) {
    const mode = e.currentTarget.dataset.mode
    if (!mode || mode === this.data.mapMode) return
    this.setData({ mapMode: mode, polyline: (this._polylines || {})[mode] || [] })
  },

  goPoster() {
    if (!this.data.logTotal) {
      wx.showToast({ title: '先记录一次出毛，再生成海报', icon: 'none' })
      return
    }
    // 海报跟着地图当前的画法走：在迁徙图下生成的就是迁徙图海报
    const mode = this.data.mapMode === 'migration' ? 'migration' : 'trace'
    wx.navigateTo({ url: `/pages/share-card/share-card?type=footprint&map=${mode}` })
  },

  // ── 省份 / 城市徽章（点省份展开，点城市 = 标注在该城市出过毛） ──

  onProvinceTap(e) {
    const name = e.currentTarget.dataset.name
    if (!name) return
    // 展开/收起都走 rebuild：下钻数据只有一处构建逻辑，不用在两处各维护一份
    this.setData({ openProvince: this.data.openProvince === name ? '' : name })
    this.rebuild()
  },

  onCityBadgeTap(e) {
    const name = e.currentTarget.dataset.name
    const panel = this.data.openProvinceData
    if (!name || !panel) return
    const city = panel.cities.find(c => c.name === name)
    if (!city) return

    if (city.active) {
      wx.showActionSheet({
        itemList: [`再记一次（当前 ${city.count} 次）`],
        success: res => {
          if (res.tapIndex === 0) this._createCityRecord(name)
        }
      })
      return
    }
    wx.showModal({
      title: `标注 · ${cityLabel(name)}`,
      content: `记为「在${cityLabel(name)}出过毛」？会生成一条城市出毛记录（仅保存在本机），并点亮这枚城市徽章。`,
      confirmText: '标注',
      success: res => { if (res.confirm) this._createCityRecord(name) }
    })
  },

  /** 创建一条城市级出毛记录（坐标用城市中心；表外城市必须带选点坐标） */
  _createCityRecord(city, coords, province) {
    const fallback = CITY_MAP[city] || {}
    const latitude = (coords && coords.latitude) || fallback.latitude || null
    const longitude = (coords && coords.longitude) || fallback.longitude || null
    const records = loadRecords()
    records.push({
      id: `city_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      placeName: `${cityLabel(city)} · 城市出毛`,
      city,
      // 内置城市一律以城市表为准，只有表外的自定义城市才采用调用方给的省份
      province: PROVINCE_OF_CITY[city] || province || '',
      locationId: '',
      latitude,
      longitude,
      visitedAt: Date.now(),
      companions: '',
      note: '',
      photos: []
    })
    saveRecords(records)
    this.rebuild()
    wx.showToast({ title: `已点亮${cityLabel(city)}`, icon: 'success' })
  },

  /**
   * 在展开的省份里补一个表外城市：地图选点 → 逆解析城市名 → 归到当前省份。
   * 这样 47 城之外的全国任意城市也能标注，而且足迹地图上的针落在真实选点坐标，
   * 不再只能落在城市中心。
   */
  addCityInProvince() {
    const province = this.data.openProvince
    if (!province || province === '其他') return
    wx.chooseLocation({
      success: res => {
        if (!res || !Number.isFinite(res.latitude)) return
        app.callCloud('getCityByLocation', { latitude: res.latitude, longitude: res.longitude })
          .then(result => {
            let city = result && result.code === 0 && result.data ? result.data.city : ''
            if (!city) {
              wx.showToast({ title: '未能识别所在城市，换个位置再试', icon: 'none' })
              return
            }
            // 归一化：去掉「市/地区/盟/自治州/特别行政区」后缀再匹配内置表，保持徽章口径一致
            const normalized = city.replace(/(市|地区|盟|自治州|特别行政区)$/g, '')
            if (!CITY_MAP[city] && CITY_MAP[normalized]) city = normalized
            // 内置城市的省份以城市表为准，避免在错的省份下点选时归错省
            const finalProvince = PROVINCE_OF_CITY[city] || province
            wx.showModal({
              title: `标注 · ${finalProvince} · ${cityLabel(city)}`,
              content: `把「${res.name || '所选位置'}」记为在${finalProvince}的${cityLabel(city)}出过毛？坐标用这次选点，地图上的针会更准。`,
              confirmText: '标注',
              success: r => {
                if (!r.confirm) return
                this.setData({ openProvince: finalProvince })
                this._createCityRecord(city, { latitude: res.latitude, longitude: res.longitude }, finalProvince)
              }
            })
          })
          .catch(() => wx.showToast({ title: '城市识别失败，请重试', icon: 'none' }))
      },
      fail: () => {}
    })
  },

  // ── 我的兽聚（本机自建） ──

  /**
   * 「＋ 记录一场兽聚」的入口：先弹「记一次」选择层，而不是直接开一张空表单。
   *
   * 兽聚不做预置名录：降级契约（e2e-degrade-verify 的 S 层断言）要求客户端不得内置
   * 官方名录，而且预置名录一定会随新聚出现而过期。所以候选就是用户自己记过的聚 ——
   * 天然按城市分布、天然含"去过多次"的场次、随新聚自动生长。
   */
  openMeetPicker() {
    // 一律先弹选择层。曾经想在"一场都没记过"时直接进空表单省一次点击，
    // 结果那条分支让新用户完全看不到这个流程（点下去还是老样子的空表单），
    // 所以空态就放在选择层里，由「＋ 新的兽聚」承担新增入口。
    this.setData({ showMeetPicker: true })
  },

  closeMeetPicker() {
    this.setData({ showMeetPicker: false })
  },

  /** 点一个已有兽聚 = 记今天一次，不用填任何字段、不用选城市和日期 */
  onMeetPick(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    this.setData({ showMeetPicker: false })
    this._recordMeetAgain(id)
  },

  onMeetNewFromPicker() {
    this.setData({ showMeetPicker: false })
    this.openMeetFormNew()
  },

  openMeetFormNew() {
    const now = new Date()
    this.setData({
      showMeetForm: true,
      editingMeetId: '',
      meetCoordsSource: '',
      meetForm: {
        name: '',
        city: this._guessCity(),
        latitude: null,
        longitude: null,
        date: '',
        note: '',
        photos: []
      },
      meetDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      meetCityIndex: CITY_CANDIDATES.findIndex(c => c.name === this._guessCity())
    })
  },

  openMeetFormEdit(e) {
    const id = e.currentTarget.dataset.id
    const meet = loadMeets().find(m => m.id === id)
    if (!meet) return
    const firstAt = firstAttendedAt(meet) || Date.now()
    const d = new Date(firstAt)
    this.setData({
      showMeetForm: true,
      editingMeetId: id,
      meetCoordsSource: meet.latitude ? '自定义坐标' : '城市中心',
      meetForm: {
        name: meet.name || '',
        city: meet.city || '',
        latitude: meet.latitude || null,
        longitude: meet.longitude || null,
        date: firstAt,
        note: meet.note || '',
        photos: Array.isArray(meet.photos) ? meet.photos.slice() : []
      },
      meetDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      meetCityIndex: CITY_CANDIDATES.findIndex(c => c.name === meet.city)
    })
  },

  closeMeetForm() {
    this.setData({ showMeetForm: false })
  },

  onMeetNameInput(e) {
    this.setData({ 'meetForm.name': e.detail.value })
  },

  onMeetNoteInput(e) {
    this.setData({ 'meetForm.note': e.detail.value })
  },

  onMeetCityChange(e) {
    const index = Number(e.detail.value)
    const city = CITY_CANDIDATES[index] ? CITY_CANDIDATES[index].name : ''
    this.setData({ meetCityIndex: index, 'meetForm.city': city })
  },

  onMeetDateChange(e) {
    this.setData({ meetDate: e.detail.value })
  },

  /** 兽聚举办地选点：坐标 + 逆解析城市（可覆盖手选城市） */
  chooseMeetOnMap() {
    wx.chooseLocation({
      success: res => {
        if (!res || !Number.isFinite(res.latitude)) return
        this.setData({
          'meetForm.latitude': res.latitude,
          'meetForm.longitude': res.longitude,
          meetCoordsSource: '地图选点'
        })
        app.callCloud('getCityByLocation', { latitude: res.latitude, longitude: res.longitude })
          .then(result => {
            const city = result && result.code === 0 && result.data ? result.data.city : ''
            if (!city) return
            const normalized = city.replace(/(市|地区|盟|自治州|特别行政区)$/g, '')
            const finalCity = CITY_MAP[city] ? city : (CITY_MAP[normalized] ? normalized : city)
            this.setData({
              'meetForm.city': finalCity,
              meetCityIndex: CITY_CANDIDATES.findIndex(c => c.name === finalCity)
            })
          })
          .catch(() => {})
      },
      fail: () => {}
    })
  },

  chooseMeetPhoto() {
    const remain = 3 - this.data.meetForm.photos.length
    if (remain <= 0) {
      wx.showToast({ title: '最多 3 张照片', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: res => persistPhotos(res.tempFiles, saved => {
        this.setData({ 'meetForm.photos': this.data.meetForm.photos.concat(saved).slice(0, 3) })
      })
    })
  },

  removeMeetPhoto(e) {
    const index = Number(e.currentTarget.dataset.index)
    const photos = this.data.meetForm.photos.slice()
    photos.splice(index, 1)
    this.setData({ 'meetForm.photos': photos })
  },

  saveMeetForm() {
    const form = this.data.meetForm
    const name = String(form.name || '').trim()
    if (!name) {
      wx.showToast({ title: '填一下兽聚名字', icon: 'none' })
      return
    }
    if (!form.city) {
      wx.showToast({ title: '选择举办城市', icon: 'none' })
      return
    }
    const dateTs = this.data.meetDate ? new Date(`${this.data.meetDate}T12:00`).getTime() : Date.now()
    const firstAt = Number.isFinite(dateTs) ? dateTs : Date.now()
    const fallback = CITY_MAP[form.city] || {}
    // 表单填的是「首次参加日期」：编辑时只改 dates[0]，后面几次参加的日期原样保留
    const rest = this.data.editingMeetId
      ? meetDates(loadMeets().find(m => m.id === this.data.editingMeetId)).slice(1)
      : []
    const dates = [firstAt].concat(rest).sort((a, b) => a - b)
    const meet = {
      id: this.data.editingMeetId || `mt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      city: form.city,
      latitude: Number.isFinite(form.latitude) ? form.latitude : (fallback.latitude || null),
      longitude: Number.isFinite(form.longitude) ? form.longitude : (fallback.longitude || null),
      date: dates[0],
      dates,
      note: String(form.note || '').trim(),
      photos: form.photos || [],
      attendCount: dates.length
    }

    const meets = loadMeets()
    if (this.data.editingMeetId) {
      const index = meets.findIndex(m => m.id === this.data.editingMeetId)
      if (index !== -1) meets[index] = { ...meets[index], ...meet }
    } else {
      meets.push(meet)
    }
    saveMeets(meets)

    this.setData({ showMeetForm: false })
    this.rebuild()
    wx.showToast({ title: '已保存（仅本机）', icon: 'success' })
  },

  onMeetTap(e) {
    const id = e.currentTarget.dataset.id
    const meet = loadMeets().find(m => m.id === id)
    if (!meet) return
    wx.showActionSheet({
      itemList: [`再记一次（今天，已记 ${meetAttendances(meet)} 次）`, '编辑', '删除'],
      success: res => {
        if (res.tapIndex === 0) this._recordMeetAgain(id)
        else if (res.tapIndex === 1) this.openMeetFormEdit({ currentTarget: { dataset: { id } } })
        else if (res.tapIndex === 2) this._deleteMeet(id)
      }
    })
  },

  /**
   * 追加一次参加，日期记成今天。
   * 改造前这里只把 attendCount +1，既不记这次的日期，也不更新 date ——
   * 结果既丢了年度届次的日期，又因为列表按 date 排序而让「最近去过的聚」沉底。
   */
  _recordMeetAgain(id) {
    const meets = loadMeets()
    const index = meets.findIndex(m => m.id === id)
    if (index === -1) return
    const updated = addAttendance(meets[index], Date.now())
    meets[index] = updated
    saveMeets(meets)
    this.rebuild()
    wx.showToast({ title: `已记第 ${meetAttendances(updated)} 次`, icon: 'success' })
  },

  _deleteMeet(id) {
    wx.showModal({
      title: '删除这条兽聚',
      content: '兽聚只保存在本机，删除后无法恢复。',
      confirmText: '删除',
      confirmColor: '#E02020',
      success: res => {
        if (!res.confirm) return
        saveMeets(loadMeets().filter(m => m.id !== id))
        this.rebuild()
        wx.showToast({ title: '已删除', icon: 'success' })
      }
    })
  },

  // ── 出毛记录表单 ──

  openFormNew(prefill) {
    const p = prefill || {}
    const now = new Date()
    const city = p.city || this._guessCity()
    const cityIndex = CITY_CANDIDATES.findIndex(c => c.name === city)
    this.setData({
      showForm: true,
      editingId: '',
      coordsSource: p.locationId ? '来自出毛日记地点库' : '',
      form: {
        placeName: p.placeName || '',
        city: city || '',
        locationId: p.locationId || '',
        latitude: Number.isFinite(p.latitude) ? p.latitude : null,
        longitude: Number.isFinite(p.longitude) ? p.longitude : null,
        visitedAt: Date.now(),
        companions: '',
        note: '',
        photos: []
      },
      formDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      formTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      cityIndex
    })
  },

  openFormEdit(e) {
    const id = e.currentTarget.dataset.id
    const record = loadRecords().find(r => r.id === id)
    if (!record) return
    const d = new Date(record.visitedAt || Date.now())
    const cityIndex = CITY_CANDIDATES.findIndex(c => c.name === record.city)
    this.setData({
      showForm: true,
      editingId: id,
      coordsSource: record.locationId ? '来自出毛日记地点库' : (record.latitude ? '自定义坐标' : '城市中心'),
      form: {
        placeName: record.placeName || '',
        city: record.city || '',
        locationId: record.locationId || '',
        latitude: record.latitude || null,
        longitude: record.longitude || null,
        visitedAt: record.visitedAt || Date.now(),
        companions: record.companions || '',
        note: record.note || '',
        photos: Array.isArray(record.photos) ? record.photos.slice() : []
      },
      formDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      formTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      cityIndex
    })
  },

  _guessCity() {
    const current = app.globalData.currentCity
    if (current && CITY_MAP[current]) return current
    return ''
  },

  closeForm() {
    this.setData({ showForm: false })
  },

  noop() {},

  onFormPlaceInput(e) {
    this.setData({ 'form.placeName': e.detail.value, 'form.locationId': '' })
  },

  onFormCityChange(e) {
    const index = Number(e.detail.value)
    const city = CITY_CANDIDATES[index] ? CITY_CANDIDATES[index].name : ''
    this.setData({ cityIndex: index, 'form.city': city })
  },

  onFormDateChange(e) {
    this.setData({ formDate: e.detail.value })
    this._syncFormTimestamp()
  },

  onFormTimeChange(e) {
    this.setData({ formTime: e.detail.value })
    this._syncFormTimestamp()
  },

  _syncFormTimestamp() {
    const { formDate, formTime } = this.data
    if (!formDate) return
    const ts = new Date(`${formDate}T${formTime || '12:00'}`).getTime()
    if (Number.isFinite(ts)) this.setData({ 'form.visitedAt': ts })
  },

  onFormCompanionsInput(e) {
    this.setData({ 'form.companions': e.detail.value })
  },

  onFormNoteInput(e) {
    this.setData({ 'form.note': e.detail.value })
  },

  /** 微信原生选点（最精确） */
  chooseOnMap() {
    wx.chooseLocation({
      success: res => {
        if (!res || !res.name) return
        this.setData({
          'form.placeName': res.name,
          'form.latitude': res.latitude,
          'form.longitude': res.longitude,
          'form.locationId': '',
          coordsSource: '微信选点'
        })
        if (!this.data.form.city) this._reverseCity(res.latitude, res.longitude)
      }
    })
  },

  /** 用当前位置 */
  useCurrentLocation() {
    wx.getLocation({
      type: 'gcj02',
      success: res => {
        this.setData({
          'form.latitude': res.latitude,
          'form.longitude': res.longitude,
          coordsSource: '当前位置'
        })
        if (!this.data.form.placeName) this.setData({ 'form.placeName': '当前位置附近' })
        if (!this.data.form.city) this._reverseCity(res.latitude, res.longitude)
      },
      fail: () => wx.showToast({ title: '定位失败，可手动选择城市', icon: 'none' })
    })
  },

  _reverseCity(latitude, longitude) {
    app.callCloud('getCityByLocation', { latitude, longitude })
      .then(res => {
        const city = res && res.code === 0 && res.data ? res.data.city : ''
        if (city && CITY_MAP[city]) {
          this.setData({
            'form.city': city,
            cityIndex: CITY_CANDIDATES.findIndex(c => c.name === city)
          })
        }
      })
      .catch(() => {})
  },

  choosePhoto() {
    const remain = 3 - this.data.form.photos.length
    if (remain <= 0) {
      wx.showToast({ title: '最多 3 张照片', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: res => persistPhotos(res.tempFiles, saved => {
        this.setData({ 'form.photos': this.data.form.photos.concat(saved).slice(0, 3) })
      })
    })
  },

  removePhoto(e) {
    const index = Number(e.currentTarget.dataset.index)
    const photos = this.data.form.photos.slice()
    photos.splice(index, 1)
    this.setData({ 'form.photos': photos })
  },

  async saveForm() {
    const form = this.data.form
    const placeName = String(form.placeName || '').trim()
    if (!placeName) {
      wx.showToast({ title: '填一下地点名称', icon: 'none' })
      return
    }
    if (!form.city) {
      wx.showToast({ title: '选择一个城市', icon: 'none' })
      return
    }

    const fallback = CITY_MAP[form.city] || {}
    const record = {
      id: this.data.editingId || `fp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      placeName,
      city: form.city,
      locationId: form.locationId || '',
      latitude: Number.isFinite(form.latitude) ? form.latitude : (fallback.latitude || null),
      longitude: Number.isFinite(form.longitude) ? form.longitude : (fallback.longitude || null),
      visitedAt: form.visitedAt || Date.now(),
      companions: String(form.companions || '').trim(), // 纯文本本地备注，绝不做用户关联
      note: String(form.note || '').trim(),
      photos: form.photos || []
    }

    const records = loadRecords()
    if (this.data.editingId) {
      const index = records.findIndex(r => r.id === this.data.editingId)
      if (index !== -1) records[index] = { ...records[index], ...record, autoMarked: false }
    } else {
      records.push(record)
    }
    saveRecords(records)

    this.setData({ showForm: false })
    this.rebuild()
    wx.showToast({ title: '已保存（仅本机）', icon: 'success' })
  },

  onLogItemTap(e) {
    const id = e.currentTarget.dataset.id
    const record = loadRecords().find(r => r.id === id)
    if (!record) return

    const actions = ['编辑']
    if (record.locationId) actions.push('查看地点')
    actions.push('删除')

    wx.showActionSheet({
      itemList: actions,
      success: res => {
        const action = actions[res.tapIndex]
        if (action === '编辑') this.openFormEdit({ currentTarget: { dataset: { id } } })
        else if (action === '查看地点') wx.navigateTo({ url: `/pages/location-detail/location-detail?id=${record.locationId}` })
        else if (action === '删除') this._deleteRecord(id)
      }
    })
  },

  _deleteRecord(id) {
    wx.showModal({
      title: '删除这条记录',
      content: '记录只保存在本机，删除后无法恢复。',
      confirmText: '删除',
      confirmColor: '#E02020',
      success: res => {
        if (!res.confirm) return
        saveRecords(loadRecords().filter(r => r.id !== id))
        this.rebuild()
        wx.showToast({ title: '已删除', icon: 'success' })
      }
    })
  }
})
