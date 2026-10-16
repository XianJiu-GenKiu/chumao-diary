const app = getApp()
const { createPager, stopRefresh, getFriendlyTime, bindDarkMode, unbindDarkMode, debugLog } = require('../../utils/common')

// 每个 tab 独立的分页器
// 注意：公开展示型版本已下线「动态」tab（用户发布内容属社交类目），只保留
// 「收藏」「地点」两个纯个人事务的列表。
const pagers = {
  favorite: createPager({ cloudFn: 'getUserContent', dataKey: 'favoriteList', buildParams: () => ({ tab: 'favorite' }), transform: item => ({ ...item, createTimeText: item.createTimeText || getFriendlyTime(item.createdAt) }) }),
  location: createPager({ cloudFn: 'getUserContent', dataKey: 'locationList', buildParams: () => ({ tab: 'location' }), transform: item => ({ ...item, createTimeText: item.createTimeText || getFriendlyTime(item.createdAt) }) })
}

Page({
  data: {
    userInfo: null,
    isLoggedIn: false,
    isAdmin: false,
    loginLoading: false,
    showAgreementDialog: false,
    stats: { favoriteCount: 0, locationCount: 0 },
    darkMode: false,
    tabs: [
      { key: 'favorite',  name: '收藏' },
      { key: 'location',  name: '地点' }
    ],
    activeTab: 'favorite',
    activeTabIndex: 0,
    _initialized: false,
    errorMessage: '',
    // 从 favorite pager 初始化（location tab 字段会在 tab 切换时设置）
    ...pagers.favorite.initData(),
    locationList: []
  },

  onLoad() {
    this.loadUserInfo()
    // 深色模式实时同步（统一走 utils/common 的 bindDarkMode）
    bindDarkMode(this)
  },

  onUnload() {
    unbindDarkMode(this)
  },

  onShow() {
    const userInfo = app.globalData.userInfo
    const isLoggedIn = !!(userInfo && userInfo.openId && app.globalData.isLoggedIn)
    this.setData({
      darkMode: app.globalData.darkMode || false,
      userInfo: isLoggedIn ? userInfo : null,
      isLoggedIn,
      _initialized: true
    })
    const requestedTab = app.globalData.profileInitialTab
    if (requestedTab && pagers[requestedTab]) {
      app.globalData.profileInitialTab = null
      const requestedIndex = this.data.tabs.findIndex(t => t.key === requestedTab)
      this.setData({ activeTab: requestedTab, activeTabIndex: Math.max(0, requestedIndex), page: 1, hasMore: true })
    }
    if (isLoggedIn) {
      this.loadStats()
      this.checkAdminAccess()
      this._loadCurrentTab(true)
    } else {
      this.setData({ isAdmin: false })
      this._resetAccountData()
    }
  },

  loadUserInfo() {
    const userInfo = app.globalData.userInfo
    if (userInfo) {
      this.setData({ userInfo, isLoggedIn: true, _initialized: true })
      this.loadStats()
      this.checkAdminAccess()
      this._loadCurrentTab(true)
    } else {
      this.setData({ userInfo: null, isLoggedIn: false, isAdmin: false, _initialized: true })
      this._resetAccountData()
    }
  },

  _resetAccountData() {
    this.setData({
      stats: { favoriteCount: 0, locationCount: 0 },
      favoriteList: [],
      locationList: [],
      page: 1,
      hasMore: false,
      isLoading: false,
      errorMessage: ''
    })
  },

  async loadStats() {
    try {
      const res = await app.callCloud('getUserStats')
      if (res?.data) this.setData({ stats: res.data })
    } catch (err) {
      console.error('获取统计数据失败:', err)
    }
  },

  onPullDownRefresh() {
    this.loadStats()
    stopRefresh(this._loadCurrentTab(true))
  },

  onReachBottom() {
    const pager = pagers[this.data.activeTab]
    if (pager && this.data.hasMore && !this.data.isLoading) {
      pager.load(this)
    }
  },

  onTabTap(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activeTab) return
    wx.vibrateShort({ type: 'light' })
    const activeTabIndex = this.data.tabs.findIndex(t => t.key === key)
    this.setData({ activeTab: key, activeTabIndex: Math.max(0, activeTabIndex), page: 1, hasMore: true })
    this._loadCurrentTab(true)
  },

  /** 加载当前 tab 的数据 */
  _loadCurrentTab(refresh) {
    const pager = pagers[this.data.activeTab]
    return pager ? pager.load(this, refresh) : Promise.resolve()
  },

  onRetry() {
    this._loadCurrentTab(true)
  },

  onItemTap(e) {
    const { type, id } = e.currentTarget.dataset
    if (type === 'location' || type === 'favorite') {
      wx.navigateTo({ url: `/pages/location-detail/location-detail?id=${id}` })
    }
  },

  /** 顶部数据栏：收藏 / 地点（均为纯个人事务，不含社交计数） */
  onStatsTap(e) {
    if (!this.data.isLoggedIn) return
    const key = e.currentTarget.dataset.key
    wx.vibrateShort({ type: 'light' })
    if (key === 'favorite') return this._gotoTab('favorite')
    if (key === 'location') return this._gotoTab('location')
  },

  /** 切换到本页的某个 tab；已在该 tab 时滚动到列表 */
  _gotoTab(key) {
    if (!pagers[key]) return
    if (this.data.activeTab === key) {
      wx.pageScrollTo({ scrollTop: 400, duration: 250 })
      return
    }
    const activeTabIndex = this.data.tabs.findIndex(t => t.key === key)
    this.setData({
      activeTab: key,
      activeTabIndex: Math.max(0, activeTabIndex),
      page: 1,
      hasMore: true
    })
    this._loadCurrentTab(true)
  },

  /** 列表项删除入口（动态 / 地点 / 收藏） */
  onDeleteTap(e) {
    const { type, id } = e.currentTarget.dataset
    if (!type || !id) return
    const isFavorite = type === 'favorite'
    wx.showModal({
      title: isFavorite ? '取消收藏' : '删除内容',
      content: isFavorite
        ? '取消后该地点会从你的收藏列表移除，可随时重新收藏。'
        : '删除后不可恢复，请确认。',
      confirmText: isFavorite ? '取消收藏' : '删除',
      confirmColor: '#E02020',
      success: res => {
        if (res.confirm) this._doDelete(type, id)
      }
    })
  },

  async _doDelete(type, id) {
    const isFavorite = type === 'favorite'
    wx.showLoading({ title: isFavorite ? '处理中...' : '删除中...', mask: true })
    try {
      let res
      if (isFavorite) {
        res = await app.callCloud('toggleFavorite', { targetId: id, targetType: 'location' })
        if (res && res.code === 0 && res.data && res.data.favorited === true) {
          // 状态被并发改回「已收藏」，不当作失败处理，提示后刷新即可
          this._loadCurrentTab(true)
        }
      } else {
        res = await app.callCloud('deleteContent', {
          contentType: 'location',
          contentId: id
        })
      }
      if (!res || res.code !== 0) throw new Error((res && res.message) || '操作失败')

      this._removeItemFromList(type, id)
      wx.hideLoading()
      wx.showToast({ title: isFavorite ? '已取消收藏' : '已删除', icon: 'success' })
      // 计数以后端为准重新拉取，避免本地累加漂移
      this.loadStats()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
    }
  },

  _removeItemFromList(type, id) {
    const listKeyMap = { favorite: 'favoriteList', location: 'locationList' }
    const statKeyMap = { favorite: 'favoriteCount', location: 'locationCount' }
    const listKey = listKeyMap[type]
    if (!listKey) return
    const patch = {
      [listKey]: (this.data[listKey] || []).filter(item => item && item._id !== id)
    }
    const statKey = statKeyMap[type]
    if (statKey) {
      patch[`stats.${statKey}`] = Math.max(0, (this.data.stats[statKey] || 0) - 1)
    }
    this.setData(patch)
  },

  onSettingsTap() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  onCollectionsTap() {
    wx.navigateTo({ url: '/pages/collections/collections' })
  },

  async checkAdminAccess() {
    try {
      // 由服务端管理权限作唯一判断；前端只根据结果决定是否展示入口。
      const res = await app.callCloud('manageReports', { action: 'whoami' })
      const isAdmin = !!(res && res.code === 0 && res.data && res.data.isAdmin)
      app.globalData.isAdmin = isAdmin
      this.setData({ isAdmin })
    } catch (err) {
      // 普通用户无管理员权限属于预期状态，不输出错误日志。
      app.globalData.isAdmin = false
      this.setData({ isAdmin: false })
    }
  },

  onAdminConsoleTap() {
    wx.navigateTo({ url: '/pages/admin-console/admin-console' })
  },

  onLeaderboardTap() {
    wx.navigateTo({ url: '/pages/leaderboard/leaderboard' })
  },

  onFootprintsTap() {
    // 足迹页已升级为一级 tabBar 页，switchTab 切换；数据只存本机，服务端零个人内容。
    wx.switchTab({ url: '/pages/footprints/footprints' })
  },

  onEditProfile() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' })
  },

  onLoginTap() {
    // 真机调试时可在 vConsole 直接确认点击是否抵达页面逻辑。
    debugLog('[profile] 登录入口已点击')
    // 检查是否已同意协议
    const agreed = wx.getStorageSync('agreementAccepted')
    debugLog('[profile] 协议状态:', agreed ? '已同意，开始登录' : '未同意，显示协议弹窗')
    if (!agreed) {
      this.setData({ showAgreementDialog: true })
    } else {
      this._doLogin()
    }
  },

  onAgreementConfirm() {
    debugLog('[profile] 协议确认：同意并登录')
    wx.setStorageSync('agreementAccepted', true)
    this.setData({ showAgreementDialog: false })
    this._doLogin()
  },

  onAgreementRead() {
    debugLog('[profile] 协议确认：查看协议')
    this.setData({ showAgreementDialog: false })
    wx.navigateTo({ url: '/pages/agreement/agreement' })
  },

  noop() {},

  _getWechatLoginCode() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: (res) => res.code ? resolve(res.code) : reject(new Error('微信登录凭证获取失败')),
        fail: (err) => reject(new Error((err && err.errMsg) || '微信登录失败'))
      })
    })
  },

  // 注意：这里刻意不再调用 wx.getUserProfile。
  // 微信自 2022-10-25 起已回收该能力（返回的昵称恒为「微信用户」、头像是默认灰头像），
  // 属于「使用已废弃能力」，审核会挑；而且它还会多弹一次毫无意义的授权框。
  // 头像昵称改用官方「头像昵称填写能力」：见 pages/profile-edit
  // （<button open-type="chooseAvatar"> + <input type="nickname">）。
  // 登录只认微信身份（wx.login → 云函数 getWXContext），资料由用户自己填。

  /**
   * 登录后引导完善资料。
   *
   * 背景：wx.getUserProfile 被回收后，昵称头像只能由用户自填。若不引导，
   * 资料页会长期停在默认的「毛毛用户」+ 灰头像 —— 审核员看到的是"没有实质内容"。
   * 这里只提示一次，不强制。
   */
  _maybePromptProfile(user) {
    const nickname = String((user && user.nickname) || '').trim()
    const isDefault = !nickname || nickname === '毛毛用户' || nickname === '微信用户'
    const avatar = (user && (user.avatar || user.avatarUrl)) || ''
    if (!isDefault && avatar) return

    wx.showModal({
      title: '完善个人资料',
      content: '设置昵称和头像后，你的收藏与足迹会更容易分辨。',
      confirmText: '去设置',
      cancelText: '稍后',
      success: r => {
        if (r.confirm) wx.navigateTo({ url: '/pages/profile-edit/profile-edit' })
      }
    })
  },

  async _doLogin() {
    if (this.data.loginLoading) return
    this.setData({ loginLoading: true })
    wx.showLoading({ title: '登录中...' })
    try {
      // wx.login 取得当前微信会话；云函数再以该会话中的 OpenID/UnionID 绑定账号。
      debugLog('[profile] 正在获取微信登录凭证')
      await this._getWechatLoginCode()
      debugLog('[profile] 微信登录凭证获取成功')
      // 不传 userInfo：昵称头像一律由用户在「编辑资料」里自填（官方头像昵称填写能力），
      // 云函数会为新账号写入默认昵称，老账号保留已有资料。
      debugLog('[profile] 正在调用 login 云函数')
      const result = await app.callCloud('login', {})
      debugLog('[profile] login 云函数返回:', result)
      if (result && result.data) {
        if (!app.setLoggedInUser(result.data)) {
          throw new Error('登录信息不完整，请重试')
        }
        this.loadUserInfo()
        wx.showToast({ title: '登录成功', icon: 'success' })
        this._maybePromptProfile(result.data)
      } else {
        wx.showToast({ title: (result && (result.message || result.error)) || '登录失败，请重试', icon: 'none' })
      }
    } catch (err) {
      console.error('登录失败:', err)
      const message = String(err && (err.errMsg || err.message) || '登录失败，请重试')
      wx.showToast({ title: message.slice(0, 18), icon: 'none', duration: 3000 })
    } finally {
      wx.hideLoading()
      this.setData({ loginLoading: false })
    }
  },

  onLogoutTap() {
    wx.showModal({
      title: '退出登录',
      content: '退出后将保留深色模式、城市和其他本地偏好，之后可随时重新登录。',
      confirmText: '退出登录',
      confirmColor: '#E02020',
      success: (res) => {
        if (!res.confirm) return
        app.clearLoginState()
        this.setData({
          userInfo: null,
          isLoggedIn: false,
          loginLoading: false
        })
        this._resetAccountData()
        wx.showToast({ title: '已退出登录', icon: 'success' })
      }
    })
  }
})
