const app = getApp()
const { bindDarkMode, unbindDarkMode } = require('../../utils/common')

Page({
  data: {
    list: [],
    loading: true,
    error: '',
    darkMode: false
  },

  onLoad() {
    this.setData({ darkMode: app.globalData.darkMode || false })
    bindDarkMode(this)
    this.loadList()
  },

  onUnload() {
    unbindDarkMode(this)
  },

  onShow() {
    this.setData({ darkMode: app.globalData.darkMode || false })
  },

  async loadList() {
    this.setData({ loading: true, error: '' })
    try {
      const res = await app.callCloud('blockUser', { action: 'list' })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '加载失败')
      this.setData({ list: res.data || [] })
    } catch (err) {
      this.setData({ error: err.message || '加载失败，请重试' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onUserTap(e) {
    const openId = e.currentTarget.dataset.openid
    if (openId) wx.navigateTo({ url: `/pages/user-home/user-home?openId=${openId}` })
  },

  onUnblockTap(e) {
    const { openid, name } = e.currentTarget.dataset
    if (!openid) return
    wx.showModal({
      title: '取消屏蔽',
      content: `取消后，你将重新看到「${name || '该用户'}」发布的动态与地点。`,
      confirmText: '取消屏蔽',
      success: async result => {
        if (!result.confirm) return
        try {
          const res = await app.callCloud('blockUser', { action: 'unblock', targetOpenId: openid })
          if (!res || res.code !== 0) throw new Error((res && res.message) || '操作失败')
          // 本地先移除，避免整页重载造成闪烁。
          this.setData({ list: this.data.list.filter(item => item.openId !== openid) })
          wx.showToast({ title: '已取消屏蔽', icon: 'success' })
        } catch (err) {
          wx.showToast({ title: err.message || '操作失败', icon: 'none' })
        }
      }
    })
  },

  onRetry() {
    this.loadList()
  }
})
