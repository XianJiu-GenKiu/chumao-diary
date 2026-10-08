const app = getApp()
const { getFriendlyTime, getNavLayout, bindDarkMode, unbindDarkMode } = require('../../utils/common')

Page({
  data: {
    targetOpenId: '',
    user: null,
    stats: {},
    isFollowing: false,
    isSelf: false,
    isBlocked: false,
    posts: [],
    locations: [],
    activeTab: 'posts',
    loading: true,
    page: 1,
    hasMore: false,
    darkMode: false,
    statusBarHeight: 0,
    totalNavHeight: 0
  },

  onLoad(options) {
    const nav = getNavLayout()
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      totalNavHeight: nav.totalNavHeight,
      darkMode: app.globalData.darkMode || false
    })

    if (options.openId) {
      this.setData({ targetOpenId: options.openId })
      this.loadData()
    }
    // 深色模式实时同步（统一走 utils/common 的 bindDarkMode）
    bindDarkMode(this)
  },

  onUnload() {
    unbindDarkMode(this)
  },

  onShow() {
    this.setData({ darkMode: app.globalData.darkMode || false })
  },

  async loadData() {
    try {
      const res = await app.callCloud('getUserPublicContent', {
        targetOpenId: this.data.targetOpenId,
        page: 1
      })

      if (res.code !== 0) {
        wx.showToast({ title: res.message || '加载失败', icon: 'none' })
        return
      }

      const data = res.data
      const posts = (data.posts || []).map(p => ({
        ...p,
        _createTimeText: getFriendlyTime(p.createdAt)
      }))

      this.setData({
        user: data.user,
        stats: data.stats,
        isFollowing: data.isFollowing,
        isSelf: data.isSelf,
        posts,
        locations: data.locations || [],
        hasMore: data.hasMore,
        page: 1,
        loading: false
      })

      wx.setNavigationBarTitle({ title: data.user.nickName || '用户主页' })

      // 屏蔽状态单独查询：它不属于「公开内容」，不塞进 getUserPublicContent 的语义里。
      this.checkBlockStatus()
    } catch (err) {
      console.error('loadData error:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.activeTab) return
    wx.vibrateShort({ type: 'light' })
    this.setData({ activeTab: tab })
  },

  async loadMore() {
    if (!this.data.hasMore) return
    const nextPage = this.data.page + 1

    try {
      const res = await app.callCloud('getUserPublicContent', {
        targetOpenId: this.data.targetOpenId,
        page: nextPage
      })

      if (res.code !== 0) return

      const newPosts = (res.data.posts || []).map(p => ({
        ...p,
        _createTimeText: getFriendlyTime(p.createdAt)
      }))

      this.setData({
        posts: [...this.data.posts, ...newPosts],
        hasMore: res.data.hasMore,
        page: nextPage
      })
    } catch (err) {
      console.error('loadMore error:', err)
    }
  },

  async toggleFollow() {
    if (this.data.isSelf) return

    try {
      const res = await app.callCloud('followUser', {
        targetOpenId: this.data.targetOpenId,
        action: this.data.isFollowing ? 'unfollow' : 'follow'
      })

      if (res.code === 0) {
        const wasFollowing = this.data.isFollowing
        this.setData({
          isFollowing: !wasFollowing,
          'stats.followersCount': (this.data.stats.followersCount || 0) + (wasFollowing ? -1 : 1)
        })
        wx.vibrateShort({ type: 'light' })
        wx.showToast({
          title: wasFollowing ? '已取消关注' : '关注成功',
          icon: 'none'
        })
      }
    } catch (err) {
      console.error('toggleFollow error:', err)
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  /** 查询当前用户是否已屏蔽对方。失败时静默，不影响页面主体功能。 */
  async checkBlockStatus() {
    if (this.data.isSelf || !this.data.targetOpenId) return
    try {
      const res = await app.callCloud('blockUser', { action: 'status', targetOpenId: this.data.targetOpenId })
      if (res && res.code === 0) this.setData({ isBlocked: !!res.data.blocked })
    } catch (err) {
      console.warn('查询屏蔽状态失败:', err)
    }
  },

  onMoreTap() {
    const blocked = this.data.isBlocked
    wx.showActionSheet({
      itemList: [blocked ? '取消屏蔽' : '屏蔽该用户'],
      success: res => {
        if (res.tapIndex === 0) this.toggleBlock()
      },
      fail: () => {}
    })
  },

  /**
   * 屏蔽 / 取消屏蔽。
   *
   * 屏蔽后该用户的内容会立刻从各列表消失（读接口统一走 blocked.js 过滤），
   * 所以这里同时退回上一页 —— 否则用户会停在一个内容已失效的页面上，
   * 看起来像「点了没反应」。
   */
  async toggleBlock() {
    const blocked = this.data.isBlocked
    const confirmed = await new Promise(resolve => wx.showModal({
      title: blocked ? '取消屏蔽' : '屏蔽该用户',
      content: blocked
        ? '取消后，你将重新看到该用户发布的动态与地点。'
        : '屏蔽后，你将不再看到该用户发布的动态与地点，双方的关注关系也会解除。',
      confirmText: blocked ? '取消屏蔽' : '屏蔽',
      confirmColor: '#d9534f',
      success: result => resolve(!!result.confirm),
      fail: () => resolve(false)
    }))
    if (!confirmed) return

    wx.showLoading({ title: '处理中', mask: true })
    try {
      const res = await app.callCloud('blockUser', {
        action: blocked ? 'unblock' : 'block',
        targetOpenId: this.data.targetOpenId
      })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '操作失败')

      this.setData({ isBlocked: !blocked })
      wx.hideLoading()
      wx.showToast({ title: blocked ? '已取消屏蔽' : '已屏蔽', icon: 'success' })
      wx.vibrateShort({ type: 'light' })

      if (blocked) {
        this.loadData()
      } else {
        setTimeout(() => wx.navigateBack(), 700)
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  onPostTap(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${id}` })
  },

  onLocationTap(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/location-detail/location-detail?id=${id}` })
  },

  goToFollowing() {
    wx.navigateTo({ url: `/pages/follow-list/follow-list?type=following&openId=${this.data.targetOpenId}` })
  },

  goToFollowers() {
    wx.navigateTo({ url: `/pages/follow-list/follow-list?type=followers&openId=${this.data.targetOpenId}` })
  }
})
