const app = getApp()
const { bindDarkMode, unbindDarkMode, redirectWithToast } = require('../../utils/common')
const { parseSceneId } = require('../../utils/scene')
const { evaluateFromWeather } = require('../../utils/furIndex')

/**
 * 周边设施兼容两种历史形态：新数据是 { key, name }，老数据是纯字符串。
 * 统一成带唯一 key 的对象，列表就能用 wx:key="key"（对象直接用 *this 会得到 "[object Object]"）。
 */
function normalizeFacilities(list) {
  if (!Array.isArray(list)) return []
  return list.map((item, idx) => {
    if (item && typeof item === 'object') {
      return { key: `${idx}_${item.key || item.name || ''}`, name: item.name || item.key || '' }
    }
    return { key: `${idx}_${item || ''}`, name: String(item || '') }
  })
}

Page({
  data: {
    id: null,
    location: null,
    images: [],
    mapMarkers: [],
    mapLatitude: null,
    mapLongitude: null,
    loading: true,
    statusBarHeight: 20,
    currentSwiper: 0,
    // 本人是该地点的创建者（历史数据）；与 isAdmin 共同决定「编辑 / 删除」入口。
    isOwner: false,
    isAdmin: false,
    darkMode: false,
    // 出毛适宜度（实时天气 + 本地计算；天气不可用时为 null，卡片不展示）
    furIndex: null
  },

  onLoad(options) {
    // getSystemInfoSync 已废弃，改用 getWindowInfo 取状态栏高度
    const systemInfo = wx.getWindowInfo()
    this.setData({
      darkMode: app.globalData.darkMode || false,
      statusBarHeight: systemInfo.statusBarHeight || 20,
      isAdmin: !!app.globalData.isAdmin
    })
    // 小程序码扫码进入时参数在 options.scene，需与 options.id 一并解析。
    const id = parseSceneId(options)
    if (id) {
      this.setData({ id })
      this.loadLocationDetail(id)
    } else {
      // 没有可用的地点 ID 时不能停留在永久骨架屏。
      this.setData({ loading: false })
      redirectWithToast('地点链接已失效')
    }
    // 深色模式实时同步（统一走 utils/common 的 bindDarkMode）
    bindDarkMode(this)
  },

  onUnload() {
    unbindDarkMode(this)
  },

  onShareAppMessage() {
    const { location } = this.data
    return {
      title: location ? location.name : '出毛日记 - 地点详情',
      path: `/pages/location-detail/location-detail?id=${this.data.id}`
    }
  },

  onShareTimeline() {
    const { location } = this.data
    return {
      title: location ? `${location.name} - 出毛地点推荐` : '出毛日记 - 地点详情',
      query: `id=${this.data.id}`,
      imageUrl: this.data.images && this.data.images.length > 0 ? this.data.images[0] : ''
    }
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  },

  async loadLocationDetail(id) {
    this.setData({ loading: true })
    wx.showLoading({ title: '加载中...' })

    try {
      const res = await app.callCloud('getLocationDetail', { locationId: id })

      if (res.code === 0) {
        const data = res.data
        const images = (data.images || []).map(img =>
          typeof img === 'string' ? img : img.url || img
        )
        const mapMarkers = (data.latitude && data.longitude) ? [{
          id: 0,
          latitude: data.latitude,
          longitude: data.longitude,
          width: 32,
          height: 32
        }] : []

        this.setData({
          loading: false,
          location: { ...data, facilities: normalizeFacilities(data.facilities) },
          mapLatitude: Number(data.latitude),
          mapLongitude: Number(data.longitude),
          images,
          mapMarkers
        })
        app.trackEvent('content_view', { targetId: id, targetType: 'location' })

        // 实时天气 + 出毛适宜度（本地计算，公共气象数据，用户零输入）
        this._loadFurIndex(data)

        // 判断当前用户是否为创建者（历史数据），供「编辑 / 删除」入口使用
        const openId = app.globalData.openId || await app.getOpenId()
        if (openId && data.creatorOpenId === openId) {
          this.setData({ isOwner: true })
        }
      } else {
        redirectWithToast(res.message || '加载失败', { icon: 'error' })
      }
    } catch (err) {
      console.error('加载地点详情失败:', err)
      wx.showToast({ title: '网络错误', icon: 'error' })
      this.setData({ loading: false })
    } finally {
      wx.hideLoading()
    }
  },

  async onPullDownRefresh() {
    await this.loadLocationDetail(this.data.id)
    wx.stopPullDownRefresh()
  },

  onSwiperChange(e) {
    this.setData({ currentSwiper: e.detail.current })
  },

  previewImage(e) {
    const index = e.currentTarget.dataset.index
    const images = this.data.images
    if (!images || images.length === 0) return
    wx.previewImage({
      current: images[index] || images[0],
      urls: images
    })
  },

  async toggleFavorite() {
    const location = this.data.location
    if (!location) return
    // 未登录先引导登录，避免服务端静默失败（与发现页卡片行为保持一致）。
    if (!app.globalData.isLoggedIn) {
      wx.showModal({
        title: '请先登录',
        content: '登录后才能收藏地点。',
        confirmText: '去登录',
        success: result => { if (result.confirm) wx.switchTab({ url: '/pages/profile/profile' }) }
      })
      return
    }
    // 请求进行中忽略重复点击，避免连点产生重复收藏关系。
    if (this._favoritePending) return
    this._favoritePending = true
    wx.vibrateShort({ type: 'light' })

    // 操作前的状态必须显式快照：setData 之后 this.data.location 会被就地更新。
    const prevFavorited = !!location.isFavorited
    const prevCount = Number(location.favoriteCount) || 0
    const isFavorited = !prevFavorited
    const favoriteCount = isFavorited
      ? prevCount + 1
      : Math.max(prevCount - 1, 0)

    this.setData({
      'location.isFavorited': isFavorited,
      'location.favoriteCount': favoriteCount
    })

    try {
      const res = await app.callCloud('toggleFavorite', {
        targetId: this.data.id,
        targetType: 'location'
      })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '收藏失败')
      // 以服务端权威结果校正本地状态，避免乐观更新与服务端不一致。
      if (res.data && typeof res.data.favorited === 'boolean') {
        // 按「服务端最终状态 - 操作前状态」的差值校正，重复请求不会造成偏移。
        const serverCount = Math.max(0, prevCount + (res.data.favorited ? 1 : 0) - (prevFavorited ? 1 : 0))
        this.setData({
          'location.isFavorited': res.data.favorited,
          'location.favoriteCount': serverCount
        })
      }
      wx.showToast({ title: isFavorited ? '已收藏' : '已取消收藏', icon: 'none' })
    } catch (err) {
      console.error('收藏操作失败:', err)
      this.setData({
        'location.isFavorited': prevFavorited,
        'location.favoriteCount': prevCount
      })
      wx.showToast({ title: (err && err.message) || '操作失败，请重试', icon: 'none' })
    } finally {
      this._favoritePending = false
    }
  },

  /**
   * 拉取实时天气并本地计算「出毛适宜度」。
   * 查不到天气就静默不展示（绝不填假数据），与 getWeather 的降级约定一致。
   */
  _loadFurIndex(location) {
    const latitude = Number(location && location.latitude)
    const longitude = Number(location && location.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    app.callCloud('getWeather', { latitude, longitude })
      .then(res => {
        const data = res && res.code === 0 ? res.data : null
        if (!data) return
        this.setData({ furIndex: evaluateFromWeather(data) })
      })
      .catch(() => { /* 天气不可用时不展示适宜度卡片 */ })
  },

  onFurIndexTap() {
    const fi = this.data.furIndex
    if (!fi || !fi.ok) return
    const lines = fi.factors.map(f => `${f.label} ${f.value}：${f.score} 分${f.reason ? `（${f.reason}）` : ''}`)
    wx.showModal({
      title: `出毛适宜度 ${fi.score} 分 · ${fi.levelLabel}`,
      content: `${lines.join('\n')}\n\n建议：${fi.advice.join('；')}\n\n仅供参考，不构成专业建议`,
      showCancel: false
    })
  },

  openMap() {
    if (!this.data.location) return
    const { latitude, longitude, name } = this.data.location
    wx.openLocation({ latitude, longitude, name: name || '', scale: 15 })
  },

  focusCurrentLocation() {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => this.setData({ mapLatitude: res.latitude, mapLongitude: res.longitude }),
      fail: () => {
        wx.showModal({
          title: '定位权限未开启',
          content: '请在微信设置中开启定位权限，以便查看当前位置。',
          confirmText: '去设置',
          success: (result) => { if (result.confirm) wx.openSetting() }
        })
      }
    })
  },

  copyAddress() {
    const { location } = this.data
    if (!location || !location.address) return
    wx.setClipboardData({
      data: location.address,
      success: () => wx.showToast({ title: '已复制地址', icon: 'success' })
    })
  },

  async addToCollection() {
    if (this._collectionPending) return
    try {
      const res = await app.callCloud('manageCollections', { action: 'list' })
      const collections = res && res.data ? res.data : []
      if (!collections.length) {
        wx.showModal({ title: '还没有合集', content: '请先创建一个地点合集', confirmText: '去创建', success: result => {
          if (result.confirm) wx.navigateTo({ url: '/pages/collections/collections' })
        } })
        return
      }
      wx.showActionSheet({
        itemList: collections.map(item => item.name || item.title),
        success: async result => {
          // ActionSheet 回调内的异步调用必须自行捕获异常，否则断网时会静默失败。
          if (this._collectionPending) return
          this._collectionPending = true
          try {
            const selected = collections[result.tapIndex]
            const addRes = await app.callCloud('manageCollections', { action: 'addLocation', collectionId: selected._id, locationId: this.data.id })
            if (!addRes || addRes.code !== 0) throw new Error((addRes && addRes.message) || '加入合集失败')
            // 服务端会返回是否本来就在合集里，据此给出准确反馈。
            wx.showToast({ title: addRes.data && addRes.data.alreadyInCollection ? '该地点已在合集中' : '已加入合集', icon: 'none' })
          } catch (err) {
            wx.showToast({ title: (err && err.message) || '加入合集失败，请重试', icon: 'none' })
          } finally {
            this._collectionPending = false
          }
        }
      })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '加载合集失败，请重试', icon: 'none' })
    }
  },

  // —— 更多操作菜单 ——
  // 地点库由运营方维护：只有创建者本人或管理员才能看到编辑 / 删除入口。
  showActionMenu() {
    const canManage = this.data.isOwner || this.data.isAdmin
    const visitCount = this._countLocalVisits()
    const visitLabel = visitCount ? `记录出毛（已 ${visitCount} 次）` : '记录出毛'
    const items = canManage
      ? [visitLabel, '编辑地点信息', '删除地点', '生成分享卡片', '举报地点']
      : [visitLabel, '生成分享卡片', '举报地点']

    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const action = items[res.tapIndex]
        if (action === visitLabel) this.recordFurOuting()
        else if (action === '编辑地点信息') this.editLocation()
        else if (action === '删除地点') this.deleteLocation()
        else if (action === '举报地点') this.reportLocation()
        else if (action === '生成分享卡片') this.shareCard()
      }
    })
  },

  /**
   * 「记录出毛」：跳到足迹页并预填本地点。
   * 次数从本机存储读取 —— 足迹数据只存本机（服务端零个人内容），这里绝不写云端。
   */
  _countLocalVisits() {
    try {
      const list = wx.getStorageSync('fur_footprints_v1')
      if (!Array.isArray(list)) return 0
      return list.filter(item => item && item.locationId === this.data.id).length
    } catch (e) {
      return 0
    }
  },

  recordFurOuting() {
    const location = this.data.location || {}
    const params = [
      'add=1',
      `locationId=${encodeURIComponent(this.data.id || '')}`,
      `placeName=${encodeURIComponent(location.name || '')}`,
      `city=${encodeURIComponent(location.city || '')}`,
      `latitude=${location.latitude || ''}`,
      `longitude=${location.longitude || ''}`
    ].join('&')
    wx.navigateTo({ url: `/pages/footprints/footprints?${params}` })
  },

  shareCard() {
    wx.navigateTo({
      url: `/pages/share-card/share-card?type=location&id=${this.data.id}`
    })
  },

  editLocation() {
    const { id, location } = this.data
    if (!id || !location) return
    wx.navigateTo({
      url: `/pages/location-upload/location-upload?editId=${id}&mode=edit`
    })
  },

  deleteLocation() {
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复。确定要删除这个地点吗？',
      confirmColor: '#E02020',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        try {
          const result = await app.callCloud('deleteContent', {
            contentType: 'location',
            contentId: this.data.id
          })
          if (result.code === 0) {
            redirectWithToast('已删除', { icon: 'success' })
          } else {
            wx.showToast({ title: result.message || '删除失败', icon: 'error' })
          }
        } catch (err) {
          wx.showToast({ title: '网络错误', icon: 'error' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  reportLocation() {
    const { id, location } = this.data
    wx.showActionSheet({
      itemList: ['垃圾广告', '违法违规', '不实信息', '其他'],
      success: async (res) => {
        const reasons = ['垃圾广告', '违法违规', '不实信息', '其他']
        const reason = reasons[res.tapIndex]
        wx.showLoading({ title: '提交中...' })
        try {
          const result = await app.callCloud('reportContent', {
            targetId: id,
            targetType: 'location',
            targetName: location.name || '',
            reason
          })
          if (result.code === 0) {
            wx.showToast({ title: '举报已提交', icon: 'success' })
          } else {
            wx.showToast({ title: result.message || '举报失败', icon: 'error' })
          }
        } catch (err) {
          wx.showToast({ title: '网络错误', icon: 'error' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  preventBubble() {}
})
