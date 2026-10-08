const app = getApp()
const { createPager, getFriendlyTime, bindDarkMode, unbindDarkMode } = require('../../utils/common')

const pager = createPager({
  cloudFn: 'getPosts',
  dataKey: 'postList',
  pageSize: 10,
  transform: item => ({ ...item, createTimeText: item.createTimeText || getFriendlyTime(item.createdAt) }),
  buildParams: (ctx) => {
    const params = { tab: ctx.data.activeTab }
    if (ctx.data.activeTab === 'nearby' && ctx.data.latitude) {
      params.latitude = ctx.data.latitude
      params.longitude = ctx.data.longitude
    }
    return params
  }
})

Page({
  data: {
    tabs: [
      { key: 'follow',   name: '关注' },
      { key: 'discover', name: '全部' },
      { key: 'nearby',   name: '同城' }
    ],
    activeTab: 'discover',
    activeTabIndex: 1,
    latitude: null,
    longitude: null,
    locationDenied: false,
    userInfo: null,
    darkMode: false,
    errorMessage: '',
    showBackToTop: false,
    ...pager.initData()
  },

  onLoad() {
    this.setData({ userInfo: app.globalData.userInfo })
    this._getLocation()
    pager.load(this, true)
    // 深色模式实时同步（统一走 utils/common 的 bindDarkMode）
    bindDarkMode(this)
  },

  onUnload() {
    unbindDarkMode(this)
    app.off('cityReady', this._onCityReady)
  },

  onPageScroll(e) {
    this.setData({ showBackToTop: e.scrollTop > 600 })
  },

  scrollToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 })
  },

  _getLocation() {
    // 优先使用 app 全局定位结果
    if (app.globalData.cityReady && app.globalData.currentLatitude) {
      this.setData({
        latitude: app.globalData.currentLatitude,
        longitude: app.globalData.currentLongitude
      })
      return
    }
    // 等待全局定位完成
    this._onCityReady = (info) => {
      if (info.latitude) {
        this.setData({ latitude: info.latitude, longitude: info.longitude })
      }
    }
    app.on('cityReady', this._onCityReady)
    // 同时发起一次定位以防全局定位失败
    wx.getLocation({
      type: 'gcj02',
      success: (r) => this.setData({ latitude: r.latitude, longitude: r.longitude }),
      fail: () => this.setData({ locationDenied: true })
    })
  },

  // 同城依赖定位：授权被拒时给出明确指引，避免用户看到空列表却不知原因
  onOpenLocationSetting() {
    wx.openSetting({
      success: (res) => {
        if (res.authSetting && res.authSetting['scope.userLocation']) {
          this.setData({ locationDenied: false })
          this._getLocation()
          if (this.data.activeTab === 'nearby') pager.load(this, true)
        }
      }
    })
  },

  onShow() {
    this.setData({ darkMode: app.globalData.darkMode || false })
    if (app.globalData.userInfo !== this.data.userInfo) {
      this.setData({ userInfo: app.globalData.userInfo })
    }
  },

  onPullDownRefresh() {
    pager.load(this, true).then(() => wx.stopPullDownRefresh())
  },

  onRetry() {
    pager.load(this, true)
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.isLoading) {
      pager.load(this)
    }
  },

  onTabTap(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activeTab) return
    wx.vibrateShort({ type: 'light' })
    // 关注 Tab 需要登录
    if (key === 'follow' && !app.globalData.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    const activeTabIndex = this.data.tabs.findIndex(t => t.key === key)
    this.setData({ activeTab: key, activeTabIndex: Math.max(0, activeTabIndex), postList: [], page: 1, hasMore: true })
    pager.load(this, true)
  },

  /**
   * 跳详情前把这条动态接力给详情页。
   * 详情页据此先渲染正文，即使详情接口异常也不会只剩一张报错页。
   */
  cachePostForDetail(id) {
    if (!id) return
    const post = (this.data.postList || []).find(item => item && item._id === id)
    if (post) app.setPostCache(post)
  },

  onPostTap(e) {
    const id = e.currentTarget.dataset.id
    this.cachePostForDetail(id)
    wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${id}` })
  },

  onAuthorTap(e) {
    const openId = e.currentTarget.dataset.openid
    if (!openId) return
    wx.navigateTo({ url: `/pages/user-home/user-home?openId=${openId}` })
  },

  async onReactionTap(e) {
    const { id, index, type } = e.currentTarget.dataset
    const item = this.data.postList[index]
    if (!item || !['up', 'down'].includes(type)) return
    wx.vibrateShort({ type: 'light' })
    const previous = {
      reactionUp: !!item.reactionUp,
      reactionDown: !!item.reactionDown,
      reactionUpCount: item.reactionUpCount || 0,
      reactionDownCount: item.reactionDownCount || 0
    }
    const isUp = type === 'up'
    const wasActive = isUp ? previous.reactionUp : previous.reactionDown
    const next = {
      reactionUp: isUp ? !wasActive : false,
      reactionDown: isUp ? false : !wasActive,
      reactionUpCount: Math.max(0, previous.reactionUpCount + (isUp ? (wasActive ? -1 : 1) : (previous.reactionUp ? -1 : 0))),
      reactionDownCount: Math.max(0, previous.reactionDownCount + (!isUp ? (wasActive ? -1 : 1) : (previous.reactionDown ? -1 : 0)))
    }
    this.setData({
      [`postList[${index}].reactionUp`]: next.reactionUp,
      [`postList[${index}].reactionDown`]: next.reactionDown,
      [`postList[${index}].reactionUpCount`]: next.reactionUpCount,
      [`postList[${index}].reactionDownCount`]: next.reactionDownCount
    })
    try {
      const res = await app.callCloud('toggleReaction', { targetId: id, targetType: 'post', reactionType: type })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '操作失败')
      this.setData({
        [`postList[${index}].reactionUp`]: res.data.reactionUp,
        [`postList[${index}].reactionDown`]: res.data.reactionDown,
        [`postList[${index}].reactionUpCount`]: res.data.reactionUpCount,
        [`postList[${index}].reactionDownCount`]: res.data.reactionDownCount
      })
    } catch (err) {
      this.setData({
        [`postList[${index}].reactionUp`]: previous.reactionUp,
        [`postList[${index}].reactionDown`]: previous.reactionDown,
        [`postList[${index}].reactionUpCount`]: previous.reactionUpCount,
        [`postList[${index}].reactionDownCount`]: previous.reactionDownCount
      })
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  onCommentTap(e) {
    const id = e.currentTarget.dataset.id
    this.cachePostForDetail(id)
    wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${id}&focus=comment` })
  },

  onLocationTap(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/location-detail/location-detail?id=${id}` })
  },

  onFabTap() {
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/post-create/post-create' })
  }
})
