const app = getApp()
const { getFriendlyTime, stopRefresh } = require('../../utils/common')

Page({
  data: { tag: '', posts: [], locations: [], page: 1, hasMore: true, loading: true, errorMessage: '' },
  onLoad(options) {
    const tag = decodeURIComponent(options.tag || '')
    if (!tag) return wx.navigateBack()
    this.setData({ tag })
    wx.setNavigationBarTitle({ title: `#${tag}` })
    this.load(true)
  },
  async load(refresh = false) {
    if (this.data.loading && !refresh) return
    const page = refresh ? 1 : this.data.page
    this.setData({ loading: true, errorMessage: '' })
    try {
      const res = await app.callCloud('getTagContent', { tag: this.data.tag, page, pageSize: 10 })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '加载失败')
      const posts = (res.data.posts || []).map(post => ({ ...post, timeText: getFriendlyTime(post.createdAt) }))
      this.setData({
        posts: refresh ? posts : [...this.data.posts, ...posts],
        locations: refresh ? (res.data.locations || []) : this.data.locations,
        page: page + 1, hasMore: !!res.data.hasMore, loading: false
      })
    } catch (err) { this.setData({ loading: false, errorMessage: err.message || '加载失败，请重试' }) }
  },
  onPullDownRefresh() { stopRefresh(this.load(true)) },
  onReachBottom() { if (this.data.hasMore) this.load() },
  onRetry() { this.load(true) },
  onPostTap(e) { wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${e.currentTarget.dataset.id}` }) },
  onLocationTap(e) { wx.navigateTo({ url: `/pages/location-detail/location-detail?id=${e.currentTarget.dataset.id}` }) }
})
