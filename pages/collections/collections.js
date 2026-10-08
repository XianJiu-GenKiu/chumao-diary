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
    } catch (err) { this.setData({ error: err.message || '加载失败，请重试' }) }
    finally { this.setData({ loading: false }) }
  },
  createCollection() {
    wx.showModal({ title: '新建地点合集', editable: true, placeholderText: '例如：上海出毛必去', success: async result => {
      if (!result.confirm) return
      try {
        const res = await app.callCloud('manageCollections', { action: 'create', name: result.content })
        if (!res || res.code !== 0) throw new Error((res && res.message) || '创建失败')
        wx.showToast({ title: '创建成功', icon: 'success' }); this.loadCollections()
      } catch (err) { wx.showToast({ title: err.message || '创建失败', icon: 'none' }) }
    } })
  },
  onCollectionTap(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/route-plan/route-plan?id=${id}` })
  },
  onShareCollection(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/share-card/share-card?type=collection&id=${id}` })
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
