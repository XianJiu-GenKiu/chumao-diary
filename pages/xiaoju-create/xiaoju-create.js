const app = getApp()
const { uploadImages } = require('../../utils/common')

Page({
  data: {
    title: '', summary: '', cover: '', reason: '', notice: '', people: '', budget: '', publish: true, canStart: true,
    tagOptions: [
      { name: '半日路线', active: false }, { name: '一日路线', active: false }, { name: '拍摄', active: false },
      { name: '聚餐', active: false }, { name: '夜景', active: false }, { name: '地铁方便', active: false },
      { name: '多人友好', active: false }, { name: '雨天备用', active: false }, { name: '新手友好', active: false }
    ], selectedTags: [],
    isAddingPoint: false, newPointName: '',
    points: [
      { id: 'p1', name: '城市森林公园', type: '拍摄', duration: '约 2 小时' },
      { id: 'p2', name: '城市广场', type: '聚餐', duration: '约 1.5 小时' }
    ]
  },
  onLoad() { this.setData({ darkMode: app.globalData.darkMode || false }) },
  goBack() { wx.navigateBack() },
  onTitleInput(e) { this.setData({ title: e.detail.value }) },
  onSummaryInput(e) { this.setData({ summary: e.detail.value }) },
  onReasonInput(e) { this.setData({ reason: e.detail.value }) },
  onNoticeInput(e) { this.setData({ notice: e.detail.value }) },
  onPeopleInput(e) { this.setData({ people: e.detail.value }) },
  onBudgetInput(e) { this.setData({ budget: e.detail.value }) },
  toggleTag(e) { const tag = e.currentTarget.dataset.tag; const list = [...this.data.selectedTags]; const i = list.indexOf(tag); i > -1 ? list.splice(i, 1) : list.push(tag); this.setData({ selectedTags: list, tagOptions: this.data.tagOptions.map(item => ({ ...item, active: list.indexOf(item.name) > -1 })) }) },
  chooseCover() { wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], success: res => this.setData({ cover: res.tempFiles[0].tempFilePath }) }) },
  addPoint() {
    wx.chooseLocation({ success: res => { const points = [...this.data.points, { id: `p${Date.now()}`, name: res.name || res.address || '新地点', type: '拍摄', duration: '约 1 小时' }]; this.setData({ points }) }, fail: err => { if (!err.errMsg || !err.errMsg.includes('cancel')) this.startAddPoint() } })
  },
  startAddPoint() { this.setData({ isAddingPoint: true, newPointName: '' }) },
  onNewPointInput(e) { this.setData({ newPointName: e.detail.value }) },
  confirmAddPoint() { const name = this.data.newPointName.trim(); if (!name) return wx.showToast({ title: '请输入地点名称', icon: 'none' }); this.setData({ points: [...this.data.points, { id: `p${Date.now()}`, name, type: '拍摄', duration: '约 1 小时' }], isAddingPoint: false, newPointName: '' }) },
  cancelAddPoint() { this.setData({ isAddingPoint: false, newPointName: '' }) },
  removePoint(e) { const points = [...this.data.points]; points.splice(Number(e.currentTarget.dataset.index), 1); this.setData({ points }) },
  togglePublish() { this.setData({ publish: !this.data.publish }) },
  toggleCanStart() { this.setData({ canStart: !this.data.canStart }) },
  _payload(status, cover = this.data.cover || '') { return { id: `local-${Date.now()}`, title: this.data.title.trim(), summary: this.data.summary.trim(), cover: cover || '', reason: this.data.reason.trim(), notice: this.data.notice.trim(), people: this.data.people || '不限', budget: this.data.budget || '待补充', tags: this.data.selectedTags, points: this.data.points, duration: `约 ${Math.max(2, this.data.points.length + 1)} 小时`, author: (app.globalData.userInfo && (app.globalData.userInfo.nickName || app.globalData.userInfo.nickname)) || '我的路线', likes: 0, saved: false, status, canStart: this.data.canStart, createdAt: Date.now() } },
  _saveItem(item) { const list = wx.getStorageSync('xiaojuDrafts') || []; wx.setStorageSync('xiaojuDrafts', [item, ...list.filter(x => x.id !== item.id && x.title !== item.title)]); return item },
  _save(status) { return this._saveItem(this._payload(status)) },
  saveDraft() { this._save('draft'); wx.showToast({ title: '草稿已保存', icon: 'success' }) },
  async publish() {
    if (!this.data.title.trim()) return wx.showToast({ title: '请填写小聚标题', icon: 'none' })
    if (this.data.summary.trim().length < 10) return wx.showToast({ title: '简介至少需要10个字', icon: 'none' })
    if (this.data.points.length < 2) return wx.showToast({ title: '请至少添加2个点位', icon: 'none' })
    wx.showLoading({ title: '发布中...' })
    try {
      let cover = this.data.cover || ''
      if (cover && !cover.startsWith('cloud://')) cover = (await uploadImages([cover], 'xiaoju'))[0]
      const status = this.data.publish ? 'published' : 'private'
      const payload = this._payload(status, cover)
      const res = await app.callCloud('xiaoju', { action: 'create', ...payload })
      if (!res || res.code !== 0) throw new Error((res && (res.message || res.msg)) || '小聚发布失败')
      const item = this._saveItem({ ...payload, id: (res.data && (res.data._id || res.data.id)) || payload.id, cover: cover || '/images/empty/empty-post.png' })
      wx.hideLoading()
      wx.showToast({ title: '小聚已发布', icon: 'success' })
      setTimeout(() => wx.redirectTo({ url: `/pages/xiaoju-detail/xiaoju-detail?id=${item.id}` }), 700)
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '发布失败，请重试', icon: 'none' })
    }
  },
  onShareAppMessage() { return { title: this.data.title || '创建一条小聚路线', path: '/pages/xiaoju-create/xiaoju-create' } }
})
