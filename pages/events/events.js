/**
 * 活动列表页
 * 展示所有活动，支持按状态筛选：全部 / 即将开始 / 进行中 / 已结束
 */

const { bindDarkMode, unbindDarkMode } = require('../../utils/common')
const app = getApp()

Page({
  data: {
    navBarHeight: 44,
    darkMode: false,

    tabs: [
      { key: 'all', label: '全部' },
      { key: 'upcoming', label: '即将开始' },
      { key: 'ongoing', label: '进行中' },
      { key: 'ended', label: '已结束' }
    ],
    currentTab: 'all',
    currentTabLabel: '',

    list: [],
    loading: false,
    errorMessage: '',
    hasMore: true,
    page: 1,
    pageSize: 10,

    showBackTop: false
  },

  onLoad() {
    const navLayout = app.globalData.navLayout
    this.setData({
      navBarHeight: (navLayout && navLayout.totalNavHeight) ? navLayout.totalNavHeight : 88,
      darkMode: app.globalData.darkMode
    })
    this._loadList()
    // 深色模式实时同步（统一走 utils/common 的 bindDarkMode）
    bindDarkMode(this)
  },

  onUnload() {
    unbindDarkMode(this)
  },

  onShow() {
    if (app.globalData.darkMode !== this.data.darkMode) {
      this.setData({ darkMode: app.globalData.darkMode })
    }
    // 如果从创建页返回，刷新列表
    if (this._needRefresh) {
      this._needRefresh = false
      this._loadList(true)
    }
  },

  onPullDownRefresh() {
    this._loadList(true, () => {
      wx.stopPullDownRefresh()
    })
  },

  // ── 切换 Tab ──
  switchTab(e) {
    const { key } = e.currentTarget.dataset
    if (key === this.data.currentTab) return
    const tab = this.data.tabs.find(t => t.key === key)
    this.setData({
      currentTab: key,
      currentTabLabel: tab ? tab.label : '',
      page: 1,
      list: [],
      hasMore: true
    })
    this._loadList()
    wx.vibrateShort({ type: 'light' })
  },

  // ── 加载列表 ──
  async _loadList(reset = false, callback) {
    if (this.data.loading) return
    this.setData({ loading: true, errorMessage: '' })

    const { currentTab, page, pageSize } = this.data
    try {
      const params = { page: reset ? 1 : page, pageSize }
      if (currentTab !== 'all') {
        params.status = currentTab
      }

      const res = await app.callCloud('getEvents', params)
      const events = (res && res.data) ? res.data : []

      // 格式化时间
      const formatted = events.map(e => ({
        ...e,
        formattedTime: this._formatEventTime(e.startTime, e.endTime),
        recentParticipants: (e.recentParticipants || []).slice(0, 5),
        remainingCount: Math.max(0, (e.joinCount || 0) - 5)
      }))

      this.setData({
        list: reset ? formatted : [...this.data.list, ...formatted],
        hasMore: events.length >= pageSize,
        page: reset ? 2 : page + 1
      })
    } catch (err) {
      console.error('加载活动列表失败:', err)
      this.setData({ errorMessage: '活动加载失败，请稍后重试' })
    } finally {
      this.setData({ loading: false })
      if (callback) callback()
    }
  },

  // ── 加载更多 ──
  loadMore() {
    if (!this.data.hasMore || this.data.loading) return
    this._loadList()
  },

  retryLoad() {
    this._loadList(true)
  },

  // ── 页面滚动监听（回到顶部按钮） ──
  onPageScroll(e) {
    const show = e.scrollTop > 600
    if (show !== this.data.showBackTop) {
      this.setData({ showBackTop: show })
    }
  },

  scrollToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 })
    wx.vibrateShort({ type: 'light' })
  },

  // ── 跳转详情 ──
  goDetail(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/event-detail/event-detail?id=${id}` })
  },

  // ── 跳转创建 ──
  goCreate() {
    wx.navigateTo({ url: '/pages/event-create/event-create' })
  },

  // ── 分享 ──
  onShareAppMessage() {
    return {
      title: '出毛日记 · 活动聚会',
      path: '/pages/events/events'
    }
  },

  onShareTimeline() {
    return {
      title: '出毛日记 · 发现精彩活动',
      query: ''
    }
  },

  // ── 辅助：格式化时间 ──
  _formatEventTime(startTime, endTime) {
    if (!startTime) return '时间待定'
    const now = new Date()
    const start = new Date(startTime)
    const end = endTime ? new Date(endTime) : null

    const formatPart = (d) => {
      const m = d.getMonth() + 1
      const day = d.getDate()
      const h = String(d.getHours()).padStart(2, '0')
      const min = String(d.getMinutes()).padStart(2, '0')
      const isToday = d.toDateString() === now.toDateString()
      if (isToday) return `今天 ${h}:${min}`
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      if (d.toDateString() === tomorrow.toDateString()) return `明天 ${h}:${min}`
      return `${m}月${day}日 ${h}:${min}`
    }

    if (end) {
      return `${formatPart(start)} - ${formatPart(end)}`
    }
    return formatPart(start)
  }
})
