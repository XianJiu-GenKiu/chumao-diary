const app = getApp()

// 地点热度榜（公开展示型：仅地点维度，不含用户榜）
Page({
  data: { locations: [], loading: true, error: '' },

  onLoad() { this.load() },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const res = await app.callCloud('getLeaderboard')
      if (!res || res.code !== 0) throw new Error((res && res.message) || '加载失败')
      this.setData({ locations: (res.data && res.data.locations) || [] })
    } catch (err) {
      this.setData({ error: err.message || '加载失败，请重试' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onLocation(e) {
    wx.navigateTo({ url: `/pages/location-detail/location-detail?id=${e.currentTarget.dataset.id}` })
  },

  onRetry() { this.load() }
})
