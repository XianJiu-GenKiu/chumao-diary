/**
 * 我的足迹（成就地图 + 出毛记录 + 兽聚徽章）
 *
 * ⚠️ 合规设计（改前必读）：
 * 1. 所有数据只存本机（wx.setStorageSync），服务端零个人内容；
 * 2. 小程序内没有任何"看别人足迹"的入口 —— 无列表流、无排行、无点赞；
 * 3. 同伴字段是纯文本本地备注，绝不做用户选择/搜索/艾特；
 * 4. 兽聚只是「成就徽章」（运营方名录 + 本机打勾），不是活动系统：
 *    无创建/报名/参与人/讨论/倒计时/消息提醒，也不提供指向某个兽聚的分享。
 * 5. 分享只产出一张个人海报（saveToAlbum / 微信原生分享），海报内容全部程序生成。
 */

const app = getApp()
const { bindDarkMode, unbindDarkMode } = require('../../utils/common.js')
const { CITY_CANDIDATES } = require('../../config/cities.js')
const { FURMEETS, FURMEET_MAP, cityLabel, formatMonths } = require('../../config/furmeets.js')

const STORAGE_KEY = 'fur_footprints_v1'
const MARKER_FOOTPRINT = '/images/map/marker-footprint.png'
const MARKER_FURMEET = '/images/map/marker-furmeet.png'

// 城市中心兜底坐标（手动填地点 / 兽聚打卡时没有精确坐标）
const CITY_MAP = CITY_CANDIDATES.reduce((acc, c) => {
  acc[c.name] = { latitude: c.lat, longitude: c.lng }
  return acc
}, {})

/** 中国大致中心，足迹为空时的地图默认视野 */
const DEFAULT_CENTER = { latitude: 35.0, longitude: 105.0, scale: 4 }

/** 里程碑规则（纯计算，达成即点亮） */
const MILESTONES = [
  { key: 'first-visit', label: '初次出毛', desc: '记录第 1 次出毛', test: s => s.visits >= 1 },
  { key: 'places-5', label: '五地行者', desc: '到访 5 个不同地点', test: s => s.places >= 5 },
  { key: 'cities-5', label: '五城征途', desc: '点亮 5 座城市', test: s => s.cities >= 5 },
  { key: 'visits-30', label: '出毛常客', desc: '累计出毛 30 次', test: s => s.visits >= 30 },
  { key: 'furmeet-first', label: '首场兽聚', desc: '参加第 1 场兽聚', test: s => s.furmeetCount >= 1 },
  { key: 'furmeet-3', label: '兽聚常客', desc: '参加 3 个不同兽聚', test: s => s.furmeetDistinct >= 3 },
  { key: 'furmeet-cities-5', label: '五城聚友', desc: '在 5 座城市参加过兽聚', test: s => s.furmeetCities >= 5 },
  { key: 'furmeet-10', label: '兽聚达人', desc: '累计参加兽聚 10 场', test: s => s.furmeetCount >= 10 }
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

Page({
  data: {
    darkMode: false,
    activeTab: 'map',

    // ── 统计 ──
    stats: { visits: 0, places: 0, cities: 0, days: 0, furmeetCount: 0, furmeetDistinct: 0, furmeetCities: 0 },

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
    furmeetBadges: [],

    // ── 记录列表 ──
    logGroups: [],
    logTotal: 0,

    // ── 表单 ──
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
      photos: [],
      furmeetIds: []
    },
    formDate: '',
    formTime: '',
    cityIndex: -1,
    cityNames: [],
    formFurmeets: [],
    coordsSource: ''
  },

  onLoad(options) {
    this.setData({
      darkMode: app.globalData.darkMode || false,
      cityNames: CITY_CANDIDATES.map(c => cityLabel(c.name))
    })
    bindDarkMode(this)

    this.rebuild()

    // 从地点详情页「记录出毛」进入：预填表单
    if (options && options.add === '1') {
      const prefill = {
        placeName: decodeURIComponent(options.placeName || ''),
        city: decodeURIComponent(options.city || ''),
        locationId: options.locationId || '',
        latitude: options.latitude ? Number(options.latitude) : null,
        longitude: options.longitude ? Number(options.longitude) : null
      }
      if (prefill.placeName || prefill.locationId) {
        this.openFormNew(prefill)
        // 地点库数据不一定带 city，有坐标时兜底逆解析一次
        if (!prefill.city && prefill.latitude && prefill.longitude) {
          this._reverseCity(prefill.latitude, prefill.longitude)
        }
      }
    }
  },

  onShow() {
    this.rebuild()
  },

  onUnload() {
    unbindDarkMode(this)
  },

  // ── 数据构建 ──

  rebuild() {
    const records = loadRecords()
    const stats = this._computeStats(records)
    const map = this._buildMap(records)
    const milestones = MILESTONES.map(m => ({
      key: m.key,
      label: m.label,
      desc: m.desc,
      unlocked: m.test(stats)
    }))

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
      cityBadges: this._buildCityBadges(records),
      furmeetBadges: this._buildFurmeetBadges(records),
      logGroups: this._buildLogGroups(records),
      logTotal: records.length
    })
  },

  _computeStats(records) {
    const places = new Set()
    const cities = new Set()
    const days = new Set()
    const furmeetIds = new Set()
    const furmeetCities = new Set()
    let furmeetCount = 0

    records.forEach(r => {
      if (r.placeName) places.add(r.placeName)
      if (r.city) cities.add(r.city)
      if (r.visitedAt) days.add(sameDay(r.visitedAt))
      ;(r.furmeetIds || []).forEach(fid => {
        const fm = FURMEET_MAP[fid]
        if (!fm) return
        furmeetIds.add(fid)
        furmeetCities.add(fm.city)
        furmeetCount++
      })
    })

    return {
      visits: records.length,
      places: places.size,
      cities: cities.size,
      days: days.size,
      furmeetCount,
      furmeetDistinct: furmeetIds.size,
      furmeetCities: furmeetCities.size
    }
  },

  _buildMap(records) {
    const markers = []
    const footPoints = []
    const furmeetPoints = {}
    let markerId = 0

    const sorted = records.slice().sort((a, b) => (a.visitedAt || 0) - (b.visitedAt || 0))

    sorted.forEach(r => {
      const fallback = CITY_MAP[r.city] || DEFAULT_CENTER
      const lat = Number(r.latitude) || fallback.latitude
      const lng = Number(r.longitude) || fallback.longitude
      const point = { latitude: lat, longitude: lng }

      const furmeetIds = Array.isArray(r.furmeetIds) ? r.furmeetIds : []
      furmeetIds.forEach(fid => {
        if (!FURMEET_MAP[fid]) return
        if (!furmeetPoints[fid]) furmeetPoints[fid] = { ...point }
      })

      // 兽聚打卡产生的轻记录（autoMarked）只画兽聚针，不重复画足迹针
      if (!r.autoMarked) {
        markers.push({
          id: markerId++,
          latitude: lat,
          longitude: lng,
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
      }
    })

    Object.keys(furmeetPoints).forEach((fid, index) => {
      const fm = FURMEET_MAP[fid]
      if (!fm) return
      const p = furmeetPoints[fid]
      // 兽聚没有精确坐标时用城市中心加稳定偏移，避免同城多个兽聚完全重叠
      const isCityCenter = !p.latitude || (p.latitude === (CITY_MAP[fm.city] || {}).latitude)
      const offset = isCityCenter ? jitter(fid) : 0
      markers.push({
        id: 900000 + index,
        latitude: p.latitude + offset,
        longitude: p.longitude + offset,
        iconPath: MARKER_FURMEET,
        width: 32,
        height: 40,
        title: fm.name,
        callout: {
          content: `兽聚 · ${fm.name}`,
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
    return CITY_CANDIDATES
      .map(c => ({
        name: c.name,
        label: cityLabel(c.name),
        count: counts[c.name] || 0,
        active: !!counts[c.name]
      }))
      .sort((a, b) => (b.active - a.active) || (b.count - a.count))
  },

  _buildFurmeetBadges(records) {
    const counts = {}
    records.forEach(r => {
      ;(r.furmeetIds || []).forEach(fid => {
        if (!FURMEET_MAP[fid]) return
        counts[fid] = (counts[fid] || 0) + 1
      })
    })
    return FURMEETS
      .map(f => ({
        id: f.id,
        city: f.city,
        cityLabel: cityLabel(f.city),
        name: f.name,
        monthsText: formatMonths(f.months),
        tip: f.tip || '',
        count: counts[f.id] || 0,
        active: !!counts[f.id]
      }))
      .sort((a, b) => (b.active - a.active) || (b.count - a.count) || a.city.localeCompare(b.city))
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

      const furmeetNames = (r.furmeetIds || [])
        .map(fid => (FURMEET_MAP[fid] ? FURMEET_MAP[fid].name : ''))
        .filter(Boolean)

      byMonth[month].push({
        id: r.id,
        dateText: `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
        placeName: r.placeName || '未命名地点',
        cityLabel: cityLabel(r.city),
        companions: r.companions || '',
        note: r.note || '',
        photos: Array.isArray(r.photos) ? r.photos : [],
        furmeetNames,
        locationId: r.locationId || '',
        autoMarked: !!r.autoMarked
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

  // ── 兽聚打勾（成就徽章） ──

  onFurmeetBadgeTap(e) {
    const id = e.currentTarget.dataset.id
    const fm = FURMEET_MAP[id]
    if (!fm) return
    const records = loadRecords()
    const mine = records.filter(r => (r.furmeetIds || []).indexOf(id) !== -1)

    if (mine.length) {
      wx.showActionSheet({
        itemList: [`再记一次（当前 ${mine.length} 次）`, '查看说明'],
        success: res => {
          if (res.tapIndex === 0) this._createFurmeetRecord(fm)
          else this._showFurmeetInfo(fm)
        }
      })
    } else {
      wx.showModal({
        title: fm.name,
        content: `${cityLabel(fm.city)} · ${formatMonths(fm.months)}\n${fm.tip || ''}\n\n记为「我去过」？会生成一条出毛记录（仅保存在本机）。`,
        confirmText: '我去过',
        success: res => { if (res.confirm) this._createFurmeetRecord(fm) }
      })
    }
  },

  _showFurmeetInfo(fm) {
    wx.showModal({
      title: fm.name,
      content: `${cityLabel(fm.city)} · ${formatMonths(fm.months)}\n${fm.tip || ''}`,
      showCancel: false
    })
  },

  /** 兽聚打勾 = 生成一条轻量出毛记录（仅本机），次数由记录数推导 */
  _createFurmeetRecord(fm) {
    const cityInfo = CITY_MAP[fm.city] || {}
    const records = loadRecords()
    records.push({
      id: `fm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      placeName: fm.name,
      city: fm.city,
      locationId: '',
      latitude: cityInfo.latitude || null,
      longitude: cityInfo.longitude || null,
      visitedAt: Date.now(),
      companions: '',
      note: '',
      photos: [],
      furmeetIds: [fm.id],
      autoMarked: true
    })
    saveRecords(records)
    this.rebuild()
    wx.showToast({ title: '已记录，成就点亮', icon: 'success' })
  },

  // ── 记录表单 ──

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
        photos: [],
        furmeetIds: []
      },
      formDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      formTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      cityIndex,
      formFurmeets: this._formFurmeets(city, [])
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
        photos: Array.isArray(record.photos) ? record.photos.slice() : [],
        furmeetIds: Array.isArray(record.furmeetIds) ? record.furmeetIds.slice() : []
      },
      formDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      formTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      cityIndex,
      formFurmeets: this._formFurmeets(record.city, record.furmeetIds || [])
    })
  },

  _guessCity() {
    const current = app.globalData.currentCity
    if (current && CITY_MAP[current]) return current
    return ''
  },

  _formFurmeets(city, selectedIds) {
    return FURMEETS
      .filter(f => f.city === city)
      .map(f => ({
        id: f.id,
        name: f.name,
        monthsText: formatMonths(f.months),
        selected: (selectedIds || []).indexOf(f.id) !== -1
      }))
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
    this.setData({
      cityIndex: index,
      'form.city': city,
      formFurmeets: this._formFurmeets(city, this.data.form.furmeetIds)
    })
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

  onFormFurmeetToggle(e) {
    const id = e.currentTarget.dataset.id
    const ids = this.data.form.furmeetIds.slice()
    const index = ids.indexOf(id)
    if (index === -1) ids.push(id)
    else ids.splice(index, 1)
    this.setData({
      'form.furmeetIds': ids,
      formFurmeets: this._formFurmeets(this.data.form.city, ids)
    })
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
            cityIndex: CITY_CANDIDATES.findIndex(c => c.name === city),
            formFurmeets: this._formFurmeets(city, this.data.form.furmeetIds)
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
      success: res => {
        const fsm = wx.getFileSystemManager()
        const saved = []
        let pending = res.tempFiles.length
        res.tempFiles.forEach(f => {
          fsm.saveFile({
            tempFilePath: f.tempFilePath,
            success: r => saved.push(r.savedFilePath),
            fail: () => saved.push(f.tempFilePath),
            complete: () => {
              pending--
              if (pending === 0) {
                this.setData({ 'form.photos': this.data.form.photos.concat(saved).slice(0, 3) })
              }
            }
          })
        })
      }
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
      photos: form.photos || [],
      furmeetIds: form.furmeetIds || []
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
