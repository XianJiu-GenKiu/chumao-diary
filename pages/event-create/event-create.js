/**
 * 创建活动页
 * 表单收集活动名称、时间、地点、介绍、人数、标签等信息
 */
const app = getApp()
const { uploadImages, bindDarkMode, unbindDarkMode } = require('../../utils/common')

Page({
  data: {
    darkMode: false,

    name: '',
    description: '',
    cover: '',

    // 时间选择器
    startTimeRange: [[], [], [], [], []],
    endTimeRange: [[], [], [], [], []],
    startTimeIndex: [0, 0, 0, 0, 0],
    endTimeIndex: [0, 0, 0, 0, 0],
    startTime: '',
    endTime: '',

    location: '',
    maxPeople: '',

    selectedTags: [],
    tagSuggestions: [
      '户外', '徒步', '露营', '骑行', '摄影',
      '美食', '聚餐', '桌游', '运动', '羽毛球',
      '跑步', '读书', '音乐', '电影', '旅行',
      '自驾', '宠物', '亲子', '公益', '其他'
    ],

    submitting: false
  },

  onLoad(options) {
    this.setData({ darkMode: app.globalData.darkMode, name: options && options.routeTitle ? decodeURIComponent(options.routeTitle) : '' })
    this._initTimeRange()
    // 深色模式实时同步（统一走 utils/common 的 bindDarkMode）
    bindDarkMode(this)
  },

  onUnload() {
    unbindDarkMode(this)
  },

  // ── 初始化时间选择器 ──
  _initTimeRange() {
    const now = new Date()
    const currentYear = now.getFullYear()
    const years = []
    for (let i = 0; i < 3; i++) years.push(currentYear + i)

    const months = []
    for (let i = 1; i <= 12; i++) months.push(i)

    const days = []
    for (let i = 1; i <= 31; i++) days.push(i)

    const hours = []
    for (let i = 0; i <= 23; i++) hours.push(i)

    const minutes = []
    for (let i = 0; i <= 59; i++) minutes.push(i)

    this.setData({
      startTimeRange: [years, months, days, hours, minutes],
      endTimeRange: [years, months, days, hours, minutes]
    })
  },

  onTimeColumnChange(e) {
    // multiSelector 列变化时更新天数范围
    const { column, value } = e.detail
    const rangeKey = e.target.dataset.rangeType === 'end' ? 'endTimeRange' : 'startTimeRange'
    const range = this.data[rangeKey]
    const idxKey = rangeKey === 'endTimeRange' ? 'endTimeIndex' : 'startTimeIndex'
    const idx = this.data[idxKey]
    if (column === 0 || column === 1) {
      const year = range[0][column === 0 ? value : idx[0]]
      const month = range[1][column === 1 ? value : idx[1]]
      if (year && month) {
        const daysInMonth = new Date(year, month, 0).getDate()
        const days = []
        for (let i = 1; i <= daysInMonth; i++) days.push(i)
        range[2] = days
        this.setData({ [rangeKey]: range })
      }
    }
  },

  // ── 开始时间 ──
  onStartTimeChange(e) {
    const idx = e.detail.value
    const range = this.data.startTimeRange
    const text = `${range[0][idx[0]]}-${String(range[1][idx[1]]).padStart(2, '0')}-${String(range[2][idx[2]]).padStart(2, '0')} ${String(range[3][idx[3]]).padStart(2, '0')}:${String(range[4][idx[4]]).padStart(2, '0')}`
    this.setData({
      startTimeIndex: idx,
      startTime: text
    })
  },

  // ── 结束时间 ──
  onEndTimeChange(e) {
    const idx = e.detail.value
    const range = this.data.endTimeRange
    const text = `${range[0][idx[0]]}-${String(range[1][idx[1]]).padStart(2, '0')}-${String(range[2][idx[2]]).padStart(2, '0')} ${String(range[3][idx[3]]).padStart(2, '0')}:${String(range[4][idx[4]]).padStart(2, '0')}`
    this.setData({
      endTimeIndex: idx,
      endTime: text
    })
  },

  // ── 选择地点 ──
  chooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          location: res.name || res.address || ''
        })
      },
      fail: (err) => {
        if (err.errMsg && !err.errMsg.includes('cancel')) {
          wx.showToast({ title: '定位失败', icon: 'none' })
        }
      }
    })
  },

  // ── 上传封面 ──
  uploadCover() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        const tempPath = res.tempFiles[0].tempFilePath
        wx.showLoading({ title: '上传中…' })
        try {
          const [cover] = await uploadImages([tempPath], 'events')
          this.setData({ cover })
          wx.hideLoading()
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '上传失败', icon: 'none' })
        }
      }
    })
  },

  // ── 标签 ──
  toggleTag(e) {
    const { tag } = e.currentTarget.dataset
    const tags = [...this.data.selectedTags]
    const idx = tags.indexOf(tag)
    if (idx > -1) {
      tags.splice(idx, 1)
    } else {
      if (tags.length >= 5) {
        wx.showToast({ title: '最多选择5个标签', icon: 'none' })
        return
      }
      tags.push(tag)
    }
    this.setData({ selectedTags: tags })
    wx.vibrateShort({ type: 'light' })
  },

  removeTag(e) {
    const { tag } = e.currentTarget.dataset
    const tags = this.data.selectedTags.filter(t => t !== tag)
    this.setData({ selectedTags: tags })
  },

  // ── 输入 ──
  onNameInput(e) { this.setData({ name: e.detail.value }) },
  onDescInput(e) { this.setData({ description: e.detail.value }) },
  onMaxPeopleInput(e) { this.setData({ maxPeople: e.detail.value }) },

  // ── 提交 ──
  async submit() {
    const { name, startTime, description, submitting } = this.data

    // 验证
    if (!name.trim()) {
      wx.showToast({ title: '请输入活动名称', icon: 'none' })
      return
    }
    if (name.trim().length < 2) {
      wx.showToast({ title: '活动名称至少2个字', icon: 'none' })
      return
    }
    if (!startTime) {
      wx.showToast({ title: '请选择开始时间', icon: 'none' })
      return
    }
    if (!this.data.endTime) {
      wx.showToast({ title: '请选择结束时间', icon: 'none' })
      return
    }
    const startAt = this._toTimestamp(startTime)
    const endAt = this._toTimestamp(this.data.endTime)
    if (!startAt || !endAt || startAt <= Date.now()) {
      wx.showToast({ title: '开始时间需晚于当前时间', icon: 'none' })
      return
    }
    if (endAt <= startAt) {
      wx.showToast({ title: '结束时间需晚于开始时间', icon: 'none' })
      return
    }
    if (description.length < 10) {
      wx.showToast({ title: '活动介绍至少10个字', icon: 'none' })
      return
    }
    if (submitting) return

    this.setData({ submitting: true })
    wx.showLoading({ title: '发布中…' })

    try {
      const res = await app.callCloud('createEvent', {
        name: name.trim(),
        description: description.trim(),
        cover: this.data.cover,
        // 云函数接收 picker 的本地时间文本，并按中国标准时间统一转换。
        // 不要在这里转换成 ISO 字符串，否则会与服务端的输入格式校验不一致。
        startTime: this.data.startTime,
        endTime: this.data.endTime,
        location: this.data.location,
        maxPeople: this.data.maxPeople ? parseInt(this.data.maxPeople) : 0,
        tags: this.data.selectedTags
      })

      wx.hideLoading()
      if (res && res.code === 0) {
        wx.vibrateShort({ type: 'heavy' })
        wx.showToast({ title: '发布成功！', icon: 'success' })

        // 通知上一页刷新
        const pages = getCurrentPages()
        const prevPage = pages[pages.length - 2]
        if (prevPage && prevPage._needRefresh !== undefined) {
          prevPage._needRefresh = true
        }

        setTimeout(() => {
          wx.navigateBack()
        }, 1500)
      } else {
        wx.showToast({ title: (res && (res.message || res.msg)) || '发布失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      console.error('发布活动失败:', err)
      wx.showToast({ title: '网络错误', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  // ── 分享 ──
  onShareAppMessage() {
    return {
      title: '出毛日记 · 发布活动',
      path: '/pages/event-create/event-create'
    }
  },

  // ── 辅助：解析时间 ──
  _toTimestamp(text) {
    // 格式: "2025-07-22 14:30"
    const match = String(text || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/)
    if (!match) return null
    const [, y, m, d, h, min] = match
    const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d), parseInt(h), parseInt(min))
    if (isNaN(date.getTime())) return null
    return date.getTime()
  }
})
