/**
 * 运营控制台（仅 ADMIN_OPENIDS 白名单可进入）
 *
 * 公开展示型：地点库由运营方统一录入，本页是唯一的运营入口集合。
 * 前端只负责隐藏入口与呈现界面，真正的权限边界在云函数
 * （addLocation / manageReports 都会独立校验 isAdmin）。
 */
const app = getApp()
const { bindDarkMode, unbindDarkMode, formatTime } = require('../../utils/common')

/** 举报目标类型 → 中文（posts / comments 已下线，只可能出现 location） */
const TARGET_LABEL = { location: '地点', post: '动态', comment: '评论' }

Page({
  data: {
    darkMode: false,
    loading: true,
    error: '',
    openId: '',
    isAdmin: false,
    reports: [],
    reportsLoading: false,
    reportsError: '',
    // 用户推荐地点（单向反馈）：只有运营方能读，接口不返回提交者身份
    submissions: [],
    submissionsLoading: false,
    submissionsError: '',
    actionPending: false
  },

  onLoad() {
    this.setData({ darkMode: app.globalData.darkMode || false })
    // 深色模式实时同步（统一走 utils/common 的 bindDarkMode）
    bindDarkMode(this)
    this.init()
  },

  onUnload() { unbindDarkMode(this) },

  async init() {
    this.setData({ loading: true, error: '' })
    try {
      const res = await app.callCloud('manageReports', { action: 'whoami' })
      const isAdmin = !!(res && res.code === 0 && res.data && res.data.isAdmin)
      app.globalData.isAdmin = isAdmin
      if (!isAdmin) {
        // 非运营方：不呈现控制台界面，直接弹回，避免出现「页面在但没有权限」的灰色观感。
        wx.showToast({ title: '仅运营方可进入', icon: 'none' })
        setTimeout(() => {
          if (getCurrentPages().length > 1) wx.navigateBack()
          else wx.reLaunch({ url: '/pages/discover/discover' })
        }, 1200)
        return
      }
      this.setData({
        isAdmin: true,
        openId: app.globalData.openId || '',
        loading: false
      })
      this.loadReports()
      this.loadSubmissions()
    } catch (err) {
      this.setData({ loading: false, error: err.message || '身份校验失败' })
    }
  },

  /**
   * 加载用户推荐的地点反馈。
   * 接口（manageSubmissions）只返回白名单字段，**不含提交者身份**，
   * 因此这里也拿不到、更不会展示「是谁提交的」。
   */
  async loadSubmissions() {
    this.setData({ submissionsLoading: true, submissionsError: '' })
    try {
      const res = await app.callCloud('manageSubmissions', { action: 'list', status: 'pending', page: 1, pageSize: 20 })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '加载失败')
      const list = (res.data && res.data.list) || []
      this.setData({
        submissions: list.map(item => ({
          ...item,
          coordText: (item.latitude !== null && item.longitude !== null)
            ? `${item.latitude}, ${item.longitude}`
            : '',
          timeText: formatTime(item.createdAt, 'YYYY-MM-DD HH:mm')
        })),
        submissionsLoading: false
      })
    } catch (err) {
      this.setData({ submissionsLoading: false, submissionsError: err.message || '加载失败' })
    }
  },

  /** 去录入：跳转运营方录入页并预填反馈里的名称 / 位置 / 类型。 */
  onSubmissionAdd(e) {
    const item = e.currentTarget.dataset.item
    if (!item) return
    const query = [
      `poiName=${encodeURIComponent(item.name || '')}`,
      `poiAddress=${encodeURIComponent(item.address || '')}`
    ]
    if (item.latitude !== null && item.longitude !== null) {
      query.push(`poiLat=${item.latitude}`, `poiLng=${item.longitude}`)
    }
    if (item.category) query.push(`poiCategory=${encodeURIComponent(item.category)}`)
    wx.navigateTo({ url: `/pages/location-upload/location-upload?${query.join('&')}` })
  },

  /** 标记已处理 / 忽略：只改 location_submissions 的状态，不写公开地点库。 */
  async onSubmissionUpdate(e) {
    const { id, status } = e.currentTarget.dataset
    if (!id || !status || this.data.actionPending) return
    this.setData({ actionPending: true })
    try {
      const res = await app.callCloud('manageSubmissions', { action: 'update', submissionId: id, status })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '操作失败')
      wx.showToast({ title: status === 'rejected' ? '已忽略' : '已标记处理', icon: 'success' })
      this.loadSubmissions()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ actionPending: false })
    }
  },

  async loadReports() {
    this.setData({ reportsLoading: true, reportsError: '' })
    try {
      const res = await app.callCloud('manageReports', { action: 'list', page: 1, pageSize: 20 })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '加载失败')
      const list = (res.data && res.data.list) || []
      this.setData({
        reports: list.map(item => ({ ...item, targetLabel: TARGET_LABEL[item.targetType] || item.targetType || '内容' })),
        reportsLoading: false
      })
    } catch (err) {
      this.setData({ reportsLoading: false, reportsError: err.message || '加载失败' })
    }
  },

  onAddLocation() { wx.navigateTo({ url: '/pages/location-upload/location-upload' }) },

  onLeaderboard() { wx.navigateTo({ url: '/pages/leaderboard/leaderboard' }) },

  async onResolveReport(e) {
    const reportId = e.currentTarget.dataset.id
    if (!reportId || this.data.actionPending) return
    this.setData({ actionPending: true })
    try {
      const res = await app.callCloud('manageReports', { action: 'update', reportId, status: 'resolved' })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '处理失败')
      wx.showToast({ title: '已标记处理', icon: 'success' })
      this.loadReports()
    } catch (err) {
      wx.showToast({ title: err.message || '处理失败', icon: 'none' })
    } finally {
      this.setData({ actionPending: false })
    }
  },

  onCopyOpenId() {
    if (!this.data.openId) return
    wx.setClipboardData({ data: this.data.openId })
  },

  onRetry() { this.init() }
})
