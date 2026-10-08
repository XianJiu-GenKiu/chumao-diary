const app = getApp()
const { getFriendlyTime, submitComment: doSubmitComment, bindDarkMode, unbindDarkMode, redirectWithToast } = require('../../utils/common')
const { parseSceneId } = require('../../utils/scene')

// 评分维度定义
const RATING_DIMS = ['facilities', 'scenery', 'transport', 'safety', 'amenities']
const DIM_LABELS = {
  facilities: '设施完善',
  scenery: '风景出片',
  transport: '交通便利',
  safety: '安全隐私',
  amenities: '周边配套'
}
const DIM_HINTS = {
  facilities: '换装间、厕所、遮阳、停车等',
  scenery: '风景美观度、拍照效果',
  transport: '公共交通、停车、可达性',
  safety: '隐私保护、防骚扰、人流情况',
  amenities: '附近餐饮、休息、补给'
}

function defaultDimRatings() {
  return { facilities: 0, scenery: 0, transport: 0, safety: 0, amenities: 0 }
}

/**
 * 将评分值转换为 5 星状态数组（支持半星）
 * 0=空, 0.5=半星, 1=满星
 */
function buildStars(rating) {
  const r = Math.max(0, Math.min(5, Number(rating) || 0))
  // 返回对象数组而不是 [1,1,1,0,0]：数值会重复，导致
  // wx:key="*this" 报「Do not set same key 1」。带上槽位序号 i 作为 key 即可唯一。
  return [1, 2, 3, 4, 5].map(i => ({
    i,
    on: r >= i ? 1 : (r >= i - 0.5 ? 0.5 : 0)
  }))
}

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
    posts: [],
    comments: [],
    mapMarkers: [],
    mapLatitude: null,
    mapLongitude: null,
    loading: true,
    statusBarHeight: 20,
    currentSwiper: 0,
    newComment: '',
    isSubmittingComment: false,
    reactionUp: false,
    reactionDown: false,
    reactionUpCount: 0,
    reactionDownCount: 0,
    hotReviews: [],
    showAllReviews: false,
    isOwner: false,
    darkMode: false,
    showRatingModal: false,
    myRating: 0,
    myRatingTemp: 0,
    replyTo: null,
    checkedIn: false,
    checkinCount: 0,
    ratingStars: buildStars(0),
    // 多维度评分
    dimLabels: DIM_LABELS,
    dimHints: DIM_HINTS,
    myDimRatings: defaultDimRatings(),
    myDimRatingsTemp: defaultDimRatings(),
    allDimsRated: false,
    computedOverall: 0,
    previewStars: buildStars(0),
    dimRatingAvgs: {},
    dimRatingCounts: {}
  },

  onLoad(options) {
    // getSystemInfoSync 已废弃，改用 getWindowInfo 取状态栏高度
    const systemInfo = wx.getWindowInfo()
    this.setData({ darkMode: app.globalData.darkMode || false, statusBarHeight: systemInfo.statusBarHeight || 20 })
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

  goBack() {
    wx.navigateBack({ delta: 1 })
  },

  onShareTimeline() {
    const { location } = this.data
    return {
      title: location ? `${location.name} - 出毛地点推荐` : '出毛日记 - 地点详情',
      query: `id=${this.data.id}`,
      imageUrl: this.data.images && this.data.images.length > 0 ? this.data.images[0] : ''
    }
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

        const comments = (data.comments || []).map(c => ({
          ...c,
          _createTimeText: getFriendlyTime(c.createdAt) || ''
        }))

        this.setData({
          loading: false,
          location: { ...data, facilities: normalizeFacilities(data.facilities) },
          mapLatitude: Number(data.latitude),
          mapLongitude: Number(data.longitude),
          images,
          mapMarkers,
          posts: data.posts || [],
          comments,
          reactionUp: data.reactionUp || false,
          reactionDown: data.reactionDown || false,
          reactionUpCount: data.reactionUpCount || 0,
          reactionDownCount: data.reactionDownCount || 0,
          checkedIn: !!data.checkedIn,
          checkinCount: data.checkinCount || 0,
          hotReviews: (data.hotReviews || []).map(c => ({ ...c, postId: c.postId || c._id })),
          ratingStars: buildStars(data.rating),
          dimRatingAvgs: data.dimRatingAvgs || {},
          dimRatingCounts: data.dimRatingCounts || {},
          myDimRatings: data.myDimRatings || defaultDimRatings()
        })
        app.trackEvent('content_view', { targetId: id, targetType: 'location' })

        // 判断当前用户是否为创建者
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

  goToPost(e) {
    wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${e.currentTarget.dataset.id}` })
  },

  onCommentInput(e) {
    this.setData({ newComment: e.detail.value })
  },

  clearComment() {
    this.setData({ newComment: '', replyTo: null })
  },

  async submitComment() {
    const content = (this.data.newComment || '').trim()
    if (!content) return wx.showToast({ title: '请输入评论内容', icon: 'none' })
    if (this.data.isSubmittingComment) return
    this.setData({ isSubmittingComment: true })
    const replyTo = this.data.replyTo
    const result = await doSubmitComment({
      targetId: this.data.id,
      targetType: 'location',
      content,
      replyTo: replyTo ? replyTo.id : null
    })
    this.setData({ isSubmittingComment: false })
    if (!result.success) return wx.showToast({ title: result.message, icon: 'error' })

    if (replyTo) {
      // 添加到对应评论的回复列表
      const comments = this.data.comments.map(c => {
        if (c._id === replyTo.id) {
          return { ...c, replies: [...(c.replies || []), result.comment] }
        }
        return c
      })
      this.setData({ comments, newComment: '', replyTo: null })
    } else {
      this.setData({ comments: [...this.data.comments, result.comment], newComment: '' })
    }
    wx.showToast({ title: '评论成功', icon: 'success' })
    wx.pageScrollTo({ selector: '.comment-section', duration: 300 })
  },

  onReplyTap(e) {
    const { id, name } = e.currentTarget.dataset
    this.setData({ replyTo: { id, name } })
  },

  cancelReply() {
    this.setData({ replyTo: null, newComment: '' })
  },

  async onCommentLikeTap(e) {
    const { id, index } = e.currentTarget.dataset
    const comment = this.data.comments[index]
    if (!comment) return

    const wasLiked = comment.isLiked
    // 乐观更新
    this.setData({
      [`comments[${index}].isLiked`]: !wasLiked,
      [`comments[${index}].likeCount`]: (comment.likeCount || 0) + (wasLiked ? -1 : 1)
    })
    wx.vibrateShort({ type: 'light' })

    try {
      const res = await app.callCloud('toggleCommentLike', { commentId: id })
      if (res.code !== 0) {
        // 回滚
        this.setData({
          [`comments[${index}].isLiked`]: wasLiked,
          [`comments[${index}].likeCount`]: comment.likeCount || 0
        })
      }
    } catch (err) {
      console.error('comment like error:', err)
      this.setData({
        [`comments[${index}].isLiked`]: wasLiked,
        [`comments[${index}].likeCount`]: comment.likeCount || 0
      })
    }
  },

  goToComment() {
    wx.pageScrollTo({ selector: '.comment-section', duration: 300 })
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

  async toggleReaction(e) {
    if (this._reactionPending) return
    this._reactionPending = true
    const type = e.currentTarget.dataset.type
    wx.vibrateShort({ type: 'light' })
    const snapshot = {
      reactionUp: this.data.reactionUp,
      reactionDown: this.data.reactionDown,
      reactionUpCount: this.data.reactionUpCount,
      reactionDownCount: this.data.reactionDownCount
    }
    const isUp = type === 'up'
    const wasActive = isUp ? snapshot.reactionUp : snapshot.reactionDown
    this.setData({
      reactionUp: isUp ? !wasActive : false,
      reactionDown: isUp ? false : !wasActive,
      reactionUpCount: Math.max(0, snapshot.reactionUpCount + (isUp ? (wasActive ? -1 : 1) : (snapshot.reactionUp ? -1 : 0))),
      reactionDownCount: Math.max(0, snapshot.reactionDownCount + (!isUp ? (wasActive ? -1 : 1) : (snapshot.reactionDown ? -1 : 0)))
    })
    try {
      const res = await app.callCloud('toggleReaction', {
        targetId: this.data.id,
        targetType: 'location',
        reactionType: type
      })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '操作失败')
      // 只回写本操作涉及的字段，避免服务端返回体覆盖页面其他状态。
      if (res.data) {
        this.setData({
          reactionUp: !!res.data.reactionUp,
          reactionDown: !!res.data.reactionDown,
          reactionUpCount: Math.max(0, Number(res.data.reactionUpCount) || 0),
          reactionDownCount: Math.max(0, Number(res.data.reactionDownCount) || 0)
        })
      }
    } catch (err) {
      this.setData(snapshot)
      wx.showToast({ title: '操作失败', icon: 'none' })
    } finally {
      this._reactionPending = false
    }
  },

  toggleAllReviews() {
    this.setData({ showAllReviews: !this.data.showAllReviews })
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
        itemList: collections.map(item => item.name),
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

  async checkIn() {
    if (this.data.checkedIn) return wx.showToast({ title: '今天已签到', icon: 'none' })
    if (this._checkInPending) return
    this._checkInPending = true
    try {
      const res = await app.callCloud('checkInLocation', { locationId: this.data.id })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '签到失败')
      this.setData({ checkedIn: true, checkinCount: res.data.checkinCount || this.data.checkinCount + 1 })
      if (!res.data.already) app.trackEvent('checkin', { targetId: this.data.id, targetType: 'location' })
      wx.vibrateShort({ type: 'light' })
      wx.showToast({ title: res.data.already ? '今天已签到' : '签到成功', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '签到失败', icon: 'none' })
    } finally {
      this._checkInPending = false
    }
  },

  goShoot() {
    wx.navigateTo({
      url: `/pages/post-create/post-create?locationId=${this.data.id}&locationName=${encodeURIComponent(this.data.location.name)}`
    })
  },

  // —— 更多操作菜单 ——
  showActionMenu() {
    const isOwner = this.data.isOwner
    const items = isOwner
      ? ['编辑地点信息', '删除地点', '生成分享卡片', '举报内容']
      : ['生成分享卡片', '举报内容']

    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const action = items[res.tapIndex]
        if (action === '编辑地点信息') this.editLocation()
        else if (action === '删除地点') this.deleteLocation()
        else if (action === '举报内容') this.reportContent()
        else if (action === '生成分享卡片') this.shareCard()
      }
    })
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
      content: '删除后无法恢复，关联的评论也将被清除。确定要删除这个地点吗？',
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

  reportContent() {
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

  // —— 评分功能 ——
  showRatingDialog() {
    const dims = this.data.myDimRatings || defaultDimRatings()
    const vals = Object.values(dims)
    const allRated = vals.every(v => v >= 1)
    const overall = allRated
      ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10
      : 0
    this.setData({
      showRatingModal: true,
      myRatingTemp: this.data.myRating || 0,
      myDimRatingsTemp: { ...dims },
      allDimsRated: allRated,
      computedOverall: overall,
      previewStars: buildStars(overall)
    })
  },

  closeRatingModal() {
    this.setData({ showRatingModal: false })
  },

  preventBubble() {},

  onTagTap(e) {
    const tag = e.currentTarget.dataset.tag
    if (tag) wx.navigateTo({ url: `/pages/tag-content/tag-content?tag=${encodeURIComponent(tag)}` })
  },

  // 保留旧版总体星级选择（兼容）
  setRatingTemp(e) {
    const val = Number(e.currentTarget.dataset.val)
    wx.vibrateShort({ type: 'light' })
    this.setData({ myRatingTemp: val })
  },

  // 设置某维度的临时评分
  setDimRatingTemp(e) {
    const { dim, val } = e.currentTarget.dataset
    wx.vibrateShort({ type: 'light' })
    const temp = { ...this.data.myDimRatingsTemp, [dim]: Number(val) }
    const vals = Object.values(temp)
    const allRated = vals.every(v => v >= 1)
    const overall = allRated
      ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10
      : 0
    this.setData({
      myDimRatingsTemp: temp,
      allDimsRated: allRated,
      computedOverall: overall,
      previewStars: buildStars(overall)
    })
  },

  // 检查所有维度是否都已评分
  _allDimsRated() {
    const temp = this.data.myDimRatingsTemp
    return Object.values(temp).every(v => v >= 1)
  },

  // 计算维度平均分作为综合分
  _computeOverallFromDims() {
    const d = this.data.myDimRatingsTemp
    const vals = Object.values(d)
    if (vals.some(v => v < 1)) return 0
    return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10
  },

  async submitRating() {
    // 优先使用多维度评分
    if (this.data.allDimsRated) {
      wx.showLoading({ title: '提交中...' })
      try {
        const res = await app.callCloud('rateLocation', {
          locationId: this.data.id,
          dimRatings: this.data.myDimRatingsTemp
        })

        if (res.code === 0) {
          this.setData({
            'location.rating': res.data.rating,
            'location.ratingCount': res.data.ratingCount,
            myRating: res.data.myRating,
            myDimRatings: res.data.myDimRatings || this.data.myDimRatingsTemp,
            dimRatingAvgs: res.data.dimRatingAvgs || {},
            dimRatingCounts: res.data.dimRatingCounts || {},
            ratingStars: buildStars(res.data.rating),
            showRatingModal: false
          })
          wx.showToast({ title: '评分成功', icon: 'success' })
        } else {
          wx.showToast({ title: res.message || '评分失败', icon: 'none' })
        }
      } catch (err) {
        console.error('submitRating error:', err)
        wx.showToast({ title: '网络错误', icon: 'error' })
      } finally {
        wx.hideLoading()
      }
      return
    }

    // 兜底：旧版总体星级评分
    const rating = this.data.myRatingTemp
    if (!rating || rating < 1) {
      wx.showToast({ title: '请为所有维度评分（1-5星）', icon: 'none' })
      return
    }

    wx.showLoading({ title: '提交中...' })
    try {
      const res = await app.callCloud('rateLocation', {
        locationId: this.data.id,
        rating
      })

      if (res.code === 0) {
        this.setData({
          'location.rating': res.data.rating,
          'location.ratingCount': res.data.ratingCount,
          myRating: rating,
          dimRatingAvgs: res.data.dimRatingAvgs || {},
          dimRatingCounts: res.data.dimRatingCounts || {},
          ratingStars: buildStars(res.data.rating),
          showRatingModal: false
        })
        wx.showToast({ title: '评分成功', icon: 'success' })
      } else {
        wx.showToast({ title: res.message || '评分失败', icon: 'none' })
      }
    } catch (err) {
      console.error('submitRating error:', err)
      wx.showToast({ title: '网络错误', icon: 'error' })
    } finally {
      wx.hideLoading()
    }
  }
})
