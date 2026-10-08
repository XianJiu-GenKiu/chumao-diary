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
const { CITY_CANDIDATES } = require('../../config/cities.js')
const { cityLabel } = require('../../config/city-labels.js')

const STORAGE_KEY = 'fur_footprints_v1'
const MEET_STORAGE_KEY = 'fur_furmeets_v1'
const MARKER_FOOTPRINT = '/images/map/marker-footprint.png'
const MARKER_FURMEET = '/images/map/marker-furmeet.png'

// 城市中心兜底坐标（城市徽章标注 / 兽聚未选点时使用）
const CITY_MAP = CITY_CANDIDATES.reduce((acc, c) => {
  acc[c.name] = { latitude: c.lat, longitude: c.lng }
  return acc
}, {})

/** 中国大致中心，足迹为空时的地图默认视野 */
const DEFAULT_CENTER = { latitude: 35.0, longitude: 105.0, scale: 4 }

/** 一天毫秒数（里程碑「出毛元年」用） */
const DAY_MS = 24 * 60 * 60 * 1000

/** 里程碑规则（纯计算，达成即点亮） */
const MILESTONES = [
  { key: 'first-visit', label: '初次出毛', desc: '记录第 1 次出毛', test: s => s.visits >= 1 },
  { key: 'visits-5', label: '出毛学徒', desc: '累计出毛 5 次', test: s => s.visits >= 5 },
  { key: 'visits-30', label: '出毛常客', desc: '累计出毛 30 次', test: s => s.visits >= 30 },
  { key: 'visits-100', label: '出毛狂人', desc: '累计出毛 100 次', test: s => s.visits >= 100 },
  { key: 'places-2', label: '两地巡游', desc: '到访 2 个不同地点', test: s => s.places >= 2 },
  { key: 'places-5', label: '五地行者', desc: '到访 5 个不同地点', test: s => s.places >= 5 },
  { key: 'places-10', label: '十地漫游', desc: '到访 10 个不同地点', test: s => s.places >= 10 },
  { key: 'places-20', label: '廿地远征', desc: '到访 20 个不同地点', test: s => s.places >= 20 },
  { key: 'cities-2', label: '双城记', desc: '点亮 2 座城市', test: s => s.cities >= 2 },
  { key: 'cities-5', label: '五城征途', desc: '点亮 5 座城市', test: s => s.cities >= 5 },
  { key: 'cities-10', label: '十城灯火', desc: '点亮 10 座城市', test: s => s.cities >= 10 },
  { key: 'cities-20', label: '廿城星图', desc: '点亮 20 座城市', test: s => s.cities >= 20 },
  { key: 'furmeet-first', label: '初逢兽友', desc: '记录第 1 场兽聚', test: s => s.furmeetCount >= 1 },
  { key: 'furmeet-3', label: '兽聚常客', desc: '参加 3 场兽聚', test: s => s.furmeetCount >= 3 },
  { key: 'furmeet-10', label: '兽聚达人', desc: '累计参加兽聚 10 场', test: s => s.furmeetCount >= 10 },
  { key: 'furmeet-cities-5', label: '五城聚友', desc: '在 5 座城市参加过兽聚', test: s => s.furmeetCities >= 5 },
  { key: 'furmeet-places-5', label: '聚游收藏家', desc: '记录 5 个不同兽聚', test: s => s.furmeetDistinct >= 5 },
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
    cityBadges: [],
    myMeets: [],

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
      photos: [],
      attendCount: 1
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

    this.setData({
      stats,
      markers: map.markers,
      polyline: map.polyline,
      includePoints: map.includePoints,
      hasPoints: map.markers.length > 0,
      mapLatitude: map.center.latitude,
      mapLongitude: map.center.longitude,
      mapScale: map.center.scale,
      milestones,
      unlockedCount,
      cityBadges: this._buildCityBadges(records),
      myMeets: this._buildMeetList(meets),
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

    const meetCities = new Set()
    let furmeetCount = 0
    ;(meets || []).forEach(m => {
      furmeetCount += Math.max(1, Number(m.attendCount) || 1)
      if (m.city) meetCities.add(m.city)
    })

    return {
      visits: records.length,
      places: places.size,
      cities: cities.size,
      days: days.size,
      furmeetCount,
      furmeetDistinct: (meets || []).length,
      furmeetCities: meetCities.size,
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

    return { markers, polyline, includePoints: allPoints, center }
  },

  _buildCityBadges(records) {
    const counts = {}
    records.forEach(r => {
      if (r.city) counts[r.city] = (counts[r.city] || 0) + 1
    })
    // 47 个内置城市 + 记录里出现过的自定义城市（全国任意城市都可持续标注）
    const customCities = Object.keys(counts).filter(name => !CITY_MAP[name])
    const builtin = CITY_CANDIDATES.map(c => ({
      name: c.name,
      label: cityLabel(c.name),
      count: counts[c.name] || 0,
      active: !!counts[c.name],
      custom: false
    }))
    const custom = customCities.map(name => ({
      name,
      label: cityLabel(name),
      count: counts[name],
      active: true,
      custom: true
    }))
    return builtin.concat(custom)
      .sort((a, b) => (b.active - a.active) || (b.count - a.count) || (b.custom - a.custom))
  },

  _buildMeetList(meets) {
    return (meets || [])
      .slice()
      .sort((a, b) => (b.date || 0) - (a.date || 0))
      .map(m => {
        const d = new Date(m.date || Date.now())
        return {
          id: m.id,
          name: m.name,
          cityLabel: cityLabel(m.city),
          dateText: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
          note: m.note || '',
          photos: Array.isArray(m.photos) ? m.photos : [],
          attendCount: Math.max(1, Number(m.attendCount) || 1)
        }
      })
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

  goPoster() {
    if (!this.data.logTotal) {
      wx.showToast({ title: '先记录一次出毛，再生成海报', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/share-card/share-card?type=footprint' })
  },

  // ── 城市徽章（点击 = 标注在该城市出过毛） ──

  onCityBadgeTap(e) {
    const name = e.currentTarget.dataset.name
    if (!name) return
    const badge = this.data.cityBadges.find(b => b.name === name)
    if (!badge) return

    if (badge.active) {
      wx.showActionSheet({
        itemList: [`再记一次（当前 ${badge.count} 次）`],
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

  /** 创建一条城市级出毛记录（坐标用城市中心；自定义城市须带选点坐标） */
  _createCityRecord(city, coords) {
    const fallback = CITY_MAP[city] || {}
    const latitude = (coords && coords.latitude) || fallback.latitude || null
    const longitude = (coords && coords.longitude) || fallback.longitude || null
    const records = loadRecords()
    records.push({
      id: `city_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      placeName: `${cityLabel(city)} · 城市出毛`,
      city,
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

  /** 「添加城市」：地图选点 + 逆解析城市名，支持 47 城之外的全国城市 */
  addCityByChoose() {
    wx.chooseLocation({
      success: res => {
        if (!res || !Number.isFinite(res.latitude)) return
        app.callCloud('getCityByLocation', { latitude: res.latitude, longitude: res.longitude })
          .then(result => {
            let city = result && result.code === 0 && result.data ? result.data.city : ''
            if (!city) {
              wx.showToast({ title: '未能识别所在城市，可从徽章墙选择', icon: 'none' })
              return
            }
            // 归一化：去掉「市/地区/盟/自治州」后缀再匹配内置表，保持徽章口径一致
            const normalized = city.replace(/(市|地区|盟|自治州|特别行政区)$/g, '')
            if (!CITY_MAP[city] && CITY_MAP[normalized]) city = normalized
            wx.showModal({
              title: `标注 · ${cityLabel(city)}`,
              content: `把「${res.name || '所选位置'}」标注为在${cityLabel(city)}出过毛？`,
              confirmText: '标注',
              success: r => {
                if (r.confirm) this._createCityRecord(city, { latitude: res.latitude, longitude: res.longitude })
              }
            })
          })
          .catch(() => wx.showToast({ title: '城市识别失败，请重试', icon: 'none' }))
      },
      fail: () => {}
    })
  },

  // ── 我的兽聚（本机自建） ──

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
        photos: [],
        attendCount: 1
      },
      meetDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      meetCityIndex: CITY_CANDIDATES.findIndex(c => c.name === this._guessCity())
    })
  },

  openMeetFormEdit(e) {
    const id = e.currentTarget.dataset.id
    const meet = loadMeets().find(m => m.id === id)
    if (!meet) return
    const d = new Date(meet.date || Date.now())
    this.setData({
      showMeetForm: true,
      editingMeetId: id,
      meetCoordsSource: meet.latitude ? '自定义坐标' : '城市中心',
      meetForm: {
        name: meet.name || '',
        city: meet.city || '',
        latitude: meet.latitude || null,
        longitude: meet.longitude || null,
        date: meet.date || '',
        note: meet.note || '',
        photos: Array.isArray(meet.photos) ? meet.photos.slice() : [],
        attendCount: Math.max(1, Number(meet.attendCount) || 1)
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
    const fallback = CITY_MAP[form.city] || {}
    const meet = {
      id: this.data.editingMeetId || `mt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      city: form.city,
      latitude: Number.isFinite(form.latitude) ? form.latitude : (fallback.latitude || null),
      longitude: Number.isFinite(form.longitude) ? form.longitude : (fallback.longitude || null),
      date: Number.isFinite(dateTs) ? dateTs : Date.now(),
      note: String(form.note || '').trim(),
      photos: form.photos || [],
      attendCount: Math.max(1, Number(form.attendCount) || 1)
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
      itemList: [`再参加一次（已记 ${meet.attendCount} 次）`, '编辑', '删除'],
      success: res => {
        if (res.tapIndex === 0) this._incMeet(id)
        else if (res.tapIndex === 1) this.openMeetFormEdit({ currentTarget: { dataset: { id } } })
        else if (res.tapIndex === 2) this._deleteMeet(id)
      }
    })
  },

  _incMeet(id) {
    const meets = loadMeets()
    const meet = meets.find(m => m.id === id)
    if (!meet) return
    meet.attendCount = Math.max(1, (Number(meet.attendCount) || 1) + 1)
    saveMeets(meets)
    this.rebuild()
    wx.showToast({ title: `已记第 ${meet.attendCount} 次`, icon: 'success' })
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
