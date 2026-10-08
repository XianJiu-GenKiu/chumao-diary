const app = getApp()
const { uploadImages, stopRefresh, bindDarkMode, unbindDarkMode } = require('../../utils/common')

Page({
  data: {
    userInfo: null,
    stats: { postCount: 0, likeCount: 0, favoriteCount: 0 },
    settingGroups: [],
    darkMode: false
  },

  onLoad() {
    this.setData({ userInfo: app.globalData.userInfo, darkMode: app.globalData.darkMode || false })
    this._initSettings()
    // 深色模式实时同步（统一走 utils/common 的 bindDarkMode）
    bindDarkMode(this)
  },
  onShow() {
    this.setData({ userInfo: app.globalData.userInfo, darkMode: app.globalData.darkMode || false })
    this._loadStats()
  },
  onUnload() {
    unbindDarkMode(this)
  },

  onPullDownRefresh() {
    this.setData({ userInfo: app.globalData.userInfo })
    stopRefresh(this._loadStats())
  },

  _initSettings() {
    const notify = wx.getStorageSync('notifyEnabled') !== false
    const dark = wx.getStorageSync('darkMode') || false
    this.setData({
      settingGroups: [
        { title: '个人', items: [
          { label: '编辑资料', icon: 'user', url: '/pages/profile-edit/profile-edit' },
          { label: '我的收藏', icon: 'bookmark', action: 'myFavorites' }
        ]},
        { title: '通用', items: [
          { label: '通知设置', icon: 'bell', action: 'toggleNotify', checked: notify, isSwitch: true },
          { label: '深色模式', icon: 'moon', action: 'toggleDark', checked: dark, isSwitch: true },
          { label: '清除缓存', icon: 'trash', action: 'clearCache' },
          { label: '意见反馈', icon: 'message-circle', action: 'feedback' },
          { label: '用户协议', icon: 'file-text', action: 'agreement' },
          { label: '关于我们', icon: 'info', action: 'about' }
        ]},
        { title: '账号', items: [
          { label: '退出登录', icon: 'arrow-left', action: 'logout', danger: true }
        ]}
      ]
    })
  },

  async _loadStats() {
    try {
      const res = await app.callCloud('getUserStats', {})
      if (res?.data) this.setData({ stats: res.data })
    } catch (e) { console.warn('获取统计失败:', e) }
  },

  // ── 设置项点击 ──
  onSettingTap(e) {
    const { item } = e.currentTarget.dataset
    if (!item || item.isSwitch) return
    if (item.url) wx.navigateTo({ url: item.url })
    else if (item.action && this[item.action]) this[item.action]()
  },

  onSwitchChange(e) {
    const { item } = e.currentTarget.dataset
    if (!item) return
    wx.vibrateShort({ type: 'light' })
    const value = e.detail.value
    if (item.action === 'toggleNotify') {
      wx.setStorageSync('notifyEnabled', value)
      this._initSettings()
      wx.showToast({ title: value ? '通知已开启' : '通知已关闭', icon: 'none' })
    } else if (item.action === 'toggleDark') {
      wx.setStorageSync('darkMode', value)
      app.globalData.darkMode = value
      this._initSettings()
      // 通知所有页面更新深色模式
      app.emit('darkModeChange', value)
      wx.showToast({ title: value ? '深色模式已开启' : '深色模式已关闭', icon: 'none' })
    }
  },

  // ── 头像 ──
  onAvatarTap() {
    if (!app.globalData.userInfo) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      wx.switchTab({ url: '/pages/profile/profile' })
      return
    }
    wx.chooseMedia({
      count: 1, mediaType: ['image'],
      success: async (r) => {
        wx.showLoading({ title: '上传中..' })
        try {
          const [fileID] = await uploadImages([r.tempFiles[0].tempFilePath], 'avatars')
          const res = await app.callCloud('login', { userInfo: { avatarUrl: fileID } })
          const nextUser = {
            ...(app.globalData.userInfo || {}),
            ...(res && res.data ? res.data : {}),
            avatar: fileID
          }
          app.globalData.userInfo = nextUser
          app.globalData.openId = nextUser.openId || app.globalData.openId
          app.globalData.isLoggedIn = true
          this.setData({ userInfo: nextUser })
          wx.setStorageSync('userInfo', nextUser)
          wx.showToast({ title: '头像已更新', icon: 'success' })
        } catch (err) {
          console.error('更新头像失败:', err)
          wx.showToast({ title: err.message || '更新失败', icon: 'none' })
        } finally { wx.hideLoading() }
      }
    })
  },

  // ── 功能入口 ──
  myFavorites() {
    app.globalData.profileInitialTab = 'favorite'
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  clearCache() {
    wx.showModal({
      title: '清除缓存', content: '确定清除本地缓存？不会删除已发布的数据和登录状态。',
      success: (r) => {
        if (r.confirm) {
          const preserve = ['agreementAccepted', 'userInfo']
          try {
            const info = wx.getStorageInfoSync()
            const toRemove = info.keys.filter(k => !preserve.includes(k))
            toRemove.forEach(k => wx.removeStorageSync(k))
          } catch (e) {
            wx.clearStorageSync()
          }
          wx.showToast({ title: '缓存已清除', icon: 'success' })
        }
      }
    })
  },

  feedback() {
    wx.showModal({
      title: '意见反馈', editable: true, placeholderText: '请描述你遇到的问题或建议',
      success: async (r) => {
        if (!r.confirm) return
        try {
          const res = await app.callCloud('submitFeedback', { content: r.content })
          if (!res || res.code !== 0) throw new Error((res && res.message) || '提交失败')
          wx.showToast({ title: '感谢反馈！', icon: 'success' })
        } catch (err) {
          wx.showToast({ title: err.message || '提交失败', icon: 'none' })
        }
      }
    })
  },

  about() {
    wx.showModal({ title: '关于', content: '出毛日记 v0.2.0\n一个低成本、为出毛拍摄地点与体验分享而做的小程序。\n地点与动态内容仅作经验参考，请遵守场地规则并注意出行安全。', showCancel: false })
  },

  agreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' })
  },

  logout() {
    wx.showModal({
      title: '退出登录', content: '确定退出当前账号？',
      success: (r) => {
        if (r.confirm) {
          app.clearLoginState()
          wx.switchTab({ url: '/pages/profile/profile' })
        }
      }
    })
  }
})
