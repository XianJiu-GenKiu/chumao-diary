/**
 * 运营控制台（仅 ADMIN_OPENIDS 白名单可进入）
 *
 * 公开展示型：地点库由运营方统一录入，本页是唯一的运营入口集合。
 * 前端只负责隐藏入口与呈现界面，真正的权限边界在云函数
 * （addLocation / manageReports 都会独立校验 isAdmin）。
 */
const app = getApp()
const { bindDarkMode, unbindDarkMode } = require('../../utils/common')

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
    } catch (err) {
      this.setData({ loading: false, error: err.message || '身份校验失败' })
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
