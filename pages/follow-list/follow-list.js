const app = getApp()

Page({
  data: {
    type: 'following',
    targetOpenId: '',
    list: [],
    page: 1,
    hasMore: false,
    total: 0,
    loading: true,
    errorMessage: ''
  },

  onLoad(options) {
    const type = options && options.type === 'followers' ? 'followers' : 'following'
    const targetOpenId = (options && options.openId) || app.globalData.openId || ''
    this.setData({ type, targetOpenId })
    wx.setNavigationBarTitle({ title: type === 'followers' ? '粉丝' : '关注' })
    if (!targetOpenId) {
      this.setData({ loading: false, errorMessage: '缺少用户信息，请重新进入' })
      return
    }
    this.load(true)
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh())
  },

  async load(refresh = false) {
    if (this.data.loading && !refresh) return
    const page = refresh ? 1 : this.data.page
    this.setData({ loading: true, errorMessage: '' })
    try {
      const res = await app.callCloud('getFollowList', {
        targetOpenId: this.data.targetOpenId,
        type: this.data.type,
        page,
        pageSize: 20
      })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '加载失败')
      const data = res.data || {}
      const list = refresh ? (data.list || []) : [...this.data.list, ...(data.list || [])]
      this.setData({
        list,
        page: page + 1,
        hasMore: !!data.hasMore,
        total: typeof data.total === 'number' ? data.total : list.length
      })
      const label = this.data.type === 'followers' ? '粉丝' : '关注'
      wx.setNavigationBarTitle({
        title: typeof data.total === 'number' ? `${label} ${data.total}` : label
      })
    } catch (err) {
      this.setData({ errorMessage: (err && err.message) || '加载失败，请重试' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onReachBottom() {
    if (this.data.hasMore) this.load()
  },

  onRetry() {
    this.load(true)
  },

  onUserTap(e) {
    const openId = e.currentTarget.dataset.openid
    if (!openId) return
    if (openId === app.globalData.openId) {
      wx.switchTab({ url: '/pages/profile/profile' })
    } else {
      wx.navigateTo({ url: `/pages/user-home/user-home?openId=${openId}` })
    }
  }
})
