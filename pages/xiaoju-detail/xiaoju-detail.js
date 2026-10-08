const app = getApp()
const DEMO = { id: 'demo-1', title: '黄昏公园 + 商场聚餐路线', summary: '公园拍摄 → 商场聚餐 → 地铁返程', cover: '/images/empty/empty-post.png', tags: ['半日拍摄', '地铁方便'], points: [{ id: 'p1', name: '城市森林公园', type: '拍摄', duration: '约 2 小时', note: '建议 16:00 后到达，光线柔和，人流较少。' }, { id: 'p2', name: '湖边栈道', type: '拍摄', duration: '约 1 小时', note: '先拍合照再拍个人照，附近有卫生间。' }, { id: 'p3', name: '城市广场', type: '聚餐', duration: '约 1.5 小时', note: '大桌友好，出地铁站步行约 8 分钟。' }], duration: '约 5 小时', people: '4-8 人', author: '毛毛A', likes: 86, saved: false, reason: '点位距离集中，拍摄结束后直接去商场，吃饭和返程都方便。', notice: '周末人流较多，建议提前联系餐厅。' }
Page({
  data: { id: '', item: DEMO },
  async onLoad(options) {
    const id = options.id || 'demo-1'
    const list = wx.getStorageSync('xiaojuDrafts') || []
    const found = list.find(x => x.id === id)
    this.setData({ id, item: found || (id === 'demo-1' ? DEMO : { ...DEMO, id }) })
    if (id === 'demo-1' || id.indexOf('local-') === 0) return
    try {
      const res = await app.callCloud('xiaoju', { action: 'detail', id })
      if (res && res.code === 0 && res.data) this.setData({ item: { ...res.data, createdText: res.data.createdAt ? '刚刚' : '今天' } })
    } catch (err) {
      wx.showToast({ title: '云端详情加载失败', icon: 'none' })
    }
  },
  goBack() { wx.navigateBack() },
  toggleSave() { const item = { ...this.data.item, saved: !this.data.item.saved }; this.setData({ item }); wx.showToast({ title: item.saved ? '已收藏路线' : '已取消收藏', icon: 'none' }) },
  toggleLike() { this.setData({ 'item.likes': Number(this.data.item.likes || 0) + 1 }); wx.vibrateShort({ type: 'light' }) },
  startEvent() { const item = this.data.item; const query = encodeURIComponent(item.title || '小聚路线'); wx.showModal({ title: '基于此路线发起活动', content: '将自动带入路线标题和点位信息，接下来补充活动时间即可。', confirmText: '继续创建', success: res => { if (res.confirm) wx.navigateTo({ url: `/pages/event-create/event-create?routeTitle=${query}` }) } }) },
  onShareAppMessage() { return { title: this.data.item.title, path: `/pages/xiaoju-detail/xiaoju-detail?id=${this.data.id}` } }
})
