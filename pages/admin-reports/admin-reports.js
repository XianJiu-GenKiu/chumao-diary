const app = getApp()
Page({
  data: { status: '', reports: [], loading: true, error: '' },
  onLoad() { this.loadReports() },
  async loadReports() {
    this.setData({ loading: true, error: '' })
    try {
      const res = await app.callCloud('manageReports', { action: 'list', status: this.data.status, page: 1 })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '加载失败')
      this.setData({ reports: res.data.list || [] })
    } catch (err) { this.setData({ error: err.message || '加载失败，请重试' }) }
    finally { this.setData({ loading: false }) }
  },
  onStatusTap(e) { this.setData({ status: e.currentTarget.dataset.status || '' }); this.loadReports() },
  async onUpdate(e) {
    const { id, status } = e.currentTarget.dataset
    try {
      const res = await app.callCloud('manageReports', { action: 'update', reportId: id, status })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '操作失败')
      wx.showToast({ title: '处理成功', icon: 'success' })
      this.loadReports()
    } catch (err) { wx.showToast({ title: err.message || '操作失败', icon: 'none' }) }
  },
  onTakeDown(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认下架', content: '下架后普通用户将无法继续查看该内容。', confirmColor: '#d9534f',
      success: async result => {
        if (!result.confirm) return
        try {
          const res = await app.callCloud('manageReports', { action: 'takeDown', reportId: id })
          if (!res || res.code !== 0) throw new Error((res && res.message) || '操作失败')
          wx.showToast({ title: '内容已下架', icon: 'success' })
          this.loadReports()
        } catch (err) { wx.showToast({ title: err.message || '操作失败', icon: 'none' }) }
      }
    })
  },
  onBanAuthor(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认封禁作者', content: '将封禁该作者并下架其所有公开内容，此操作不可自动恢复。', confirmColor: '#d9534f',
      success: async result => {
        if (!result.confirm) return
        try {
          const res = await app.callCloud('manageReports', { action: 'banAuthor', reportId: id })
          if (!res || res.code !== 0) throw new Error((res && res.message) || '操作失败')
          wx.showToast({ title: '作者已封禁', icon: 'success' })
          this.loadReports()
        } catch (err) { wx.showToast({ title: err.message || '操作失败', icon: 'none' }) }
      }
    })
  },
  onRetry() { this.loadReports() }
})
