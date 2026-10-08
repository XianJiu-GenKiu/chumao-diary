
const { bindDarkMode, unbindDarkMode } = require('../../utils/common')
const app = getApp()

Page({
  data: {
    currentTab: 'all',
    messages: [],
    loading: true,
    page: 1,
    hasMore: false,
    unreadTotal: 0,
    unreadByType: {},
    darkMode: false,
    errorMessage: ''
  },

  onLoad(options) {
    // 支持从「我的 → 获赞」等入口直达指定分类
    const validTabs = ['all', 'comment', 'like', 'favorite', 'system']
    const requested = options && options.type
    this.setData({
      darkMode: app.globalData.darkMode || false,
      currentTab: validTabs.includes(requested) ? requested : this.data.currentTab
    })
    this.loadMessages()
    // 深色模式实时同步（统一走 utils/common 的 bindDarkMode）
    bindDarkMode(this)
  },

  onUnload() {
    unbindDarkMode(this)
  },

  onShow() {
    this.setData({ darkMode: app.globalData.darkMode || false })
    this.loadMessages()
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.currentTab) return
    this.setData({ currentTab: tab, messages: [], page: 1 })
    this.loadMessages()
  },

  async loadMessages(markRead = false) {
    this.setData({ loading: true, errorMessage: '' })
    try {
      const res = await app.callCloud('getMessages', {
        page: this.data.page,
        pageSize: 20,
        type: this.data.currentTab,
        markRead
      })

      if (res.code === 0) {
        const data = res.data
        this.setData({
          messages: this.data.page === 1 ? data.list : [...this.data.messages, ...data.list],
          hasMore: data.hasMore,
          unreadTotal: data.unreadTotal,
          unreadByType: data.unreadByType || {},
          loading: false
        })
      } else {
        wx.showToast({ title: res.message || '加载失败', icon: 'none' })
        this.setData({ loading: false })
      }
    } catch (err) {
      this.setData({ errorMessage: '网络异常，请检查网络后重试' })
      console.error('加载消息失败:', err)
      wx.showToast({ title: '网络错误', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loading) return
    this.setData({ page: this.data.page + 1 })
    this.loadMessages()
  },

  async markAllRead() {
    wx.showLoading({ title: '处理中...' })
    try {
      // 重新加载并标记已读
      this.setData({ page: 1 })
      await this.loadMessages(true)
      wx.showToast({ title: '已全部标记为已读', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async onMessageTap(e) {
    const msg = e.currentTarget.dataset.msg
    if (!msg) return

    if (!msg.isRead) {
      try {
        await app.callCloud('getMessages', { page: 1, pageSize: 1, markReadIds: [msg._id] })
        const messages = this.data.messages.map(item => item._id === msg._id ? { ...item, isRead: true } : item)
        this.setData({ messages, unreadTotal: Math.max(0, this.data.unreadTotal - 1) })
      } catch (err) { console.warn('mark message read failed:', err) }
    }

    // 根据消息类型跳转
    if (msg.targetType === 'post' && msg.targetId) {
      wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${msg.targetId}` })
    } else if (msg.targetType === 'location' && msg.targetId) {
      wx.navigateTo({ url: `/pages/location-detail/location-detail?id=${msg.targetId}` })
    }
  },

  onPullDownRefresh() {
    this.setData({ page: 1 })
    this.loadMessages()
    wx.stopPullDownRefresh()
  },

  onRetry() {
    this.setData({ page: 1 })
    this.loadMessages()
  }
})
