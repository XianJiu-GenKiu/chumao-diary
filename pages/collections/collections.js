const app = getApp()

Page({
  data: { collections: [], loading: true, error: '' },

  onLoad() { this.loadCollections() },

  async loadCollections() {
    this.setData({ loading: true, error: '' })
    try {
      const res = await app.callCloud('manageCollections', { action: 'list' })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '加载失败')
      this.setData({ collections: res.data || [] })
    } catch (err) {
      this.setData({ error: err.message || '加载失败，请重试' })
    } finally {
      this.setData({ loading: false })
    }
  },

  /**
   * 新建合集：不再弹自由文本输入框。
   * 合集标题由服务端按用户昵称程序生成（`XX的路线`）——用户对合集的动作
   * 只剩「挑选地点 + 排序」，不产生用户撰写的内容。
   */
  async createCollection() {
    wx.showLoading({ title: '创建中...', mask: true })
    try {
      const res = await app.callCloud('manageCollections', { action: 'create' })
      wx.hideLoading()
      if (!res || res.code !== 0) throw new Error((res && res.message) || '创建失败')
      wx.showToast({ title: '创建成功', icon: 'success' })
      this.loadCollections()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '创建失败', icon: 'none' })
    }
  },

  onCollectionTap(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/route-plan/route-plan?id=${id}` })
  },

  /**
   * 分享合集：先显式把合集置为公开（这是合集唯一的对外出口），
   * 再进入海报页生成小程序码。默认私有 → 用户主动分享才公开。
   */
  async onShareCollection(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showLoading({ title: '准备分享...', mask: true })
    try {
      const res = await app.callCloud('manageCollections', { action: 'share', collectionId: id })
      wx.hideLoading()
      if (!res || res.code !== 0) throw new Error((res && res.message) || '分享失败')
      wx.navigateTo({ url: `/pages/share-card/share-card?type=collection&id=${id}` })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '分享失败', icon: 'none' })
    }
  },

  async deleteCollection(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '删除合集', content: '合集内地点不会被删除，确定继续吗？', success: async result => {
      if (!result.confirm) return
      try { await app.callCloud('manageCollections', { action: 'delete', collectionId: id }); this.loadCollections() }
      catch (err) { wx.showToast({ title: '删除失败', icon: 'none' }) }
    } })
  },

  onRetry() { this.loadCollections() }
})
