const app = getApp()
const { submitComment: doSubmitComment, toggleOptimistic, rollbackOptimistic, getFriendlyTime, bindDarkMode, unbindDarkMode, redirectWithToast } = require('../../utils/common')
const { parseSceneId } = require('../../utils/scene')

// 心情 key → 展示信息。
// 此前模板引用 post.moodEmoji / post.moodLabel，但这两个字段从未被赋值，
// 导致心情标签一直是空壳（只有底色和边框、没有内容）。现按 key 解析出
// 图标名与中文标签，与发帖页的兽头图标保持一致。
const MOOD_MAP = {
  like: { icon: 'mood-like', label: '种草' },
  dislike: { icon: 'mood-dislike', label: '踩雷' },
  excited: { icon: 'mood-excited', label: '出发啦' },
  focused: { icon: 'mood-focused', label: '拍摄中' },
  cozy: { icon: 'mood-cozy', label: '毛茸茸' },
  sunny: { icon: 'mood-sunny', label: '好天气' },
  tired: { icon: 'mood-tired', label: '累了' },
  rest: { icon: 'mood-rest', label: '收工啦' }
}

// 兼容旧数据：历史心情 key 映射到语义最接近的新图标
const LEGACY_MOOD_MAP = {
  happy: 'cozy',
  peaceful: 'cozy',
  adventurous: 'excited',
  sad: 'tired'
}

Page({
  data: {
    postId: '',
    post: null,
    comments: [],
    isLoading: true,
    loadError: '',
    // 内容已由列表页带过来、但互动状态没能从云端补齐时的「降级提示」
    staleNotice: '',
    commentsError: '',

    // 评论输入
    commentText: '',
    replyTo: null,

    // 交互状态
    isLiked: false,
    reactionUp: false,
    reactionDown: false,
    isFavorited: false,
    likeCount: 0,
    reactionUpCount: 0,
    reactionDownCount: 0,
    commentCount: 0,
    shareCount: 0,

    // 权限
    isOwner: false,
    darkMode: false
  },

  onLoad(options) {
    this.setData({ darkMode: app.globalData.darkMode || false })
    // 小程序码扫码进入时参数在 options.scene，需与 options.id 一并解析。
    const id = parseSceneId(options)
    if (id) {
      this.setData({ postId: id })
      // 先用列表页接力过来的数据渲染，云函数异常也不会留下空白页
      const cached = app.getPostCache(id)
      if (cached) this.applyPost(cached)
      this.loadPost(id)
    } else {
      this.setData({ isLoading: false, loadError: '动态链接已失效' })
    }
    // 深色模式实时同步（统一走 utils/common 的 bindDarkMode）
    bindDarkMode(this)
  },

  onUnload() {
    unbindDarkMode(this)
  },

  onShow() {},

  /**
   * 把一条动态数据映射进页面 data。
   * 详情接口返回的数据和列表页缓存的数据共用这段逻辑，避免两处走样。
   */
  applyPost(post) {
    post.createTimeText = post.createTimeText || getFriendlyTime(post.createdAt)
    // 解析心情：优先按新 key 匹配，其次兼容旧 key，最后原样展示未知 key
    const moodKey = LEGACY_MOOD_MAP[post.mood] || post.mood
    const moodInfo = MOOD_MAP[moodKey]
    post.moodIcon = moodInfo ? moodInfo.icon : ''
    post.moodLabel = moodInfo ? moodInfo.label : (post.mood || '')
    this.setData({
      post,
      isLiked: post.isLiked || false,
      isFavorited: post.isFavorited || false,
      likeCount: post.likeCount || 0,
      reactionUp: post.reactionUp || false,
      reactionDown: post.reactionDown || false,
      reactionUpCount: post.reactionUpCount || 0,
      reactionDownCount: post.reactionDownCount || 0,
      commentCount: post.commentCount || 0,
      shareCount: post.shareCount || 0
    })
    return post
  },

  // ── 加载帖子 ──
  async loadPost(id) {
    this.setData({ isLoading: true, loadError: '', staleNotice: '' })
    try {
      const res = await app.callCloud('post-detail', { postId: id })
      // 只接受业务成功且带数据的响应；错误包不能被当作帖子渲染。
      if (!res || res.code !== 0 || !res.data) {
        if (this.data.post) {
          // 内容已经渲染出来，只是互动状态没补齐 —— 提示而非报错
          this.setData({ isLoading: false, staleNotice: '互动状态暂时无法加载' })
          return
        }
        this.setData({ isLoading: false, loadError: (res && res.message) || '动态不存在或已删除' })
        return
      }
      const post = this.applyPost(res.data)
      app.trackEvent('content_view', { targetId: id, targetType: 'post' })

      // 判断当前用户是否为创建者
      const openId = app.globalData.openId || await app.getOpenId()
      if (openId && post.creatorOpenId === openId) {
        this.setData({ isOwner: true })
      }

      this.loadComments(id)
    } catch (err) {
      console.error('加载帖子失败:', err)
      if (this.data.post) {
        // 降级：正文照常可读，只是点赞/收藏等状态没同步
        this.setData({ staleNotice: '互动状态暂时无法加载' })
      } else {
        this.setData({ loadError: (err && err.message) || '加载失败，请检查网络后重试' })
      }
    } finally {
      this.setData({ isLoading: false })
    }
  },

  onRetryLoad() {
    if (this.data.postId) this.loadPost(this.data.postId)
  },

  onBackFromError() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/posts/posts' })
  },

  // ── 加载评论 ──
  async loadComments(postId) {
    this.setData({ commentsError: '' })
    try {
      const res = await app.callCloud('comment-list', { targetId: postId, targetType: 'post' })
      // 云函数失败时不能伪装成“还没有评论”。
      if (!res || res.code !== 0) {
        this.setData({ commentsError: (res && res.message) || '评论加载失败' })
        return
      }
      const comments = (res.data || []).map(item => ({
        ...item,
        createTimeText: item.createTimeText || getFriendlyTime(item.createdAt),
        replies: (item.replies || []).map(reply => ({ ...reply, createTimeText: reply.createTimeText || getFriendlyTime(reply.createdAt) }))
      }))
      this.setData({ comments })
    } catch (err) {
      console.error('加载评论失败:', err)
      this.setData({ commentsError: (err && err.message) || '评论加载失败，请稍后重试' })
    }
  },

  onRetryComments() {
    if (this.data.postId) this.loadComments(this.data.postId)
  },

  // ── 图片预览 ──
  previewImage(e) {
    const idx = e.currentTarget.dataset.index
    wx.previewImage({
      current: this.data.post.images[idx],
      urls: this.data.post.images
    })
  },

  // ── 点赞 ──
  async toggleLike() {
    // 请求进行中忽略重复点击，避免连点产生乱序响应。
    if (this._likePending) return
    this._likePending = true
    const snap = toggleOptimistic(this, 'isLiked', 'likeCount')
    try {
      const res = await app.callCloud('post-like', { postId: this.data.postId, action: this.data.isLiked ? 'like' : 'unlike' })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '点赞失败')
      // 以服务端返回为准校正本地状态。
      // 计数按「服务端最终状态 - 操作前状态」的差值校正，重复请求不会造成偏移。
      if (res.data && typeof res.data.liked === 'boolean') {
        const likeCount = Math.max(0,
          (snap.prevCount || 0) + (res.data.liked ? 1 : 0) - (snap.prev ? 1 : 0))
        this.setData({ isLiked: res.data.liked, likeCount })
      }
    } catch (err) {
      rollbackOptimistic(this, 'isLiked', 'likeCount', snap)
      wx.showToast({ title: (err && err.message) || '操作失败，请重试', icon: 'none' })
    } finally {
      this._likePending = false
    }
  },

  async toggleReaction(e) {
    if (this._reactionPending) return
    this._reactionPending = true
    const type = e.currentTarget.dataset.type
    wx.vibrateShort({ type: 'light' })
    const previous = {
      reactionUp: this.data.reactionUp,
      reactionDown: this.data.reactionDown,
      reactionUpCount: this.data.reactionUpCount,
      reactionDownCount: this.data.reactionDownCount
    }
    const isUp = type === 'up'
    const wasActive = isUp ? previous.reactionUp : previous.reactionDown
    this.setData({
      reactionUp: isUp ? !wasActive : false,
      reactionDown: isUp ? false : !wasActive,
      reactionUpCount: Math.max(0, previous.reactionUpCount + (isUp ? (wasActive ? -1 : 1) : (previous.reactionUp ? -1 : 0))),
      reactionDownCount: Math.max(0, previous.reactionDownCount + (!isUp ? (wasActive ? -1 : 1) : (previous.reactionDown ? -1 : 0)))
    })
    try {
      const res = await app.callCloud('toggleReaction', { targetId: this.data.postId, targetType: 'post', reactionType: type })
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
      this.setData(previous)
      wx.showToast({ title: '操作失败', icon: 'none' })
    } finally {
      this._reactionPending = false
    }
  },

  // ── 收藏 ──
  async toggleFavorite() {
    if (this._favoritePending) return
    this._favoritePending = true
    wx.vibrateShort({ type: 'light' })
    const previous = this.data.isFavorited
    const next = !previous
    this.setData({ isFavorited: next })
    try {
      const res = await app.callCloud('post-favorite', { postId: this.data.postId, action: next ? 'favorite' : 'unfavorite' })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '收藏失败')
      // 成功提示必须放在服务端确认之后，否则失败时用户会被误导为已收藏。
      if (res.data && typeof res.data.favorited === 'boolean') {
        this.setData({ isFavorited: res.data.favorited })
        wx.showToast({ title: res.data.favorited ? '已收藏' : '已取消收藏', icon: 'none' })
      } else {
        wx.showToast({ title: next ? '已收藏' : '已取消收藏', icon: 'none' })
      }
    } catch (err) {
      this.setData({ isFavorited: previous })
      wx.showToast({ title: (err && err.message) || '操作失败，请重试', icon: 'none' })
    } finally {
      this._favoritePending = false
    }
  },

  // ── 跳转地点 ──
  goToLocation() {
    const post = this.data.post
    if (post && post.locationId) {
      wx.navigateTo({ url: `/pages/location-detail/location-detail?id=${post.locationId}` })
    }
  },

  onTagTap(e) {
    const tag = e.currentTarget.dataset.tag
    if (tag) wx.navigateTo({ url: `/pages/tag-content/tag-content?tag=${encodeURIComponent(tag)}` })
  },

  goToUserHome(e) {
    const openId = e.currentTarget.dataset.openid
    if (!openId) return
    const currentOpenId = getApp().globalData.openId
    if (openId === currentOpenId) {
      wx.switchTab({ url: '/pages/profile/profile' })
      return
    }
    wx.navigateTo({ url: `/pages/user-home/user-home?openId=${openId}` })
  },

  // ── 分享 ──
  onShareAppMessage() {
    const post = this.data.post
    return {
      title: (post && post.content) ? post.content.slice(0, 50) : '来看看我的外景拍摄',
      path: `/pages/post-detail/post-detail?id=${this.data.postId}`,
      imageUrl: (post && post.images && post.images.length > 0) ? post.images[0] : ''
    }
  },

  onShareTimeline() {
    const post = this.data.post
    return {
      title: (post && post.content) ? post.content.slice(0, 50) : '来看看我的外景拍摄',
      query: `id=${this.data.postId}`,
      imageUrl: (post && post.images && post.images.length > 0) ? post.images[0] : ''
    }
  },

  // ── 评论输入 ──
  onCommentInput(e) {
    this.setData({ commentText: e.detail.value })
  },

  setReplyTo(e) {
    const comment = e.currentTarget.dataset.comment
    this.setData({ replyTo: comment })
  },

  async onCommentLikeTap(e) {
    const { id, index } = e.currentTarget.dataset
    const comment = this.data.comments[index]
    if (!comment) return
    // 按评论 ID 加锁，避免同一条评论连点造成计数错乱。
    if (!this._commentLikePending) this._commentLikePending = {}
    if (this._commentLikePending[id]) return
    this._commentLikePending[id] = true

    const wasLiked = comment.isLiked
    this.setData({
      [`comments[${index}].isLiked`]: !wasLiked,
      [`comments[${index}].likeCount`]: (comment.likeCount || 0) + (wasLiked ? -1 : 1)
    })
    wx.vibrateShort({ type: 'light' })

    try {
      const res = await app.callCloud('toggleCommentLike', { commentId: id })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '操作失败')
    } catch (err) {
      console.error('comment like error:', err)
      this.setData({
        [`comments[${index}].isLiked`]: wasLiked,
        [`comments[${index}].likeCount`]: comment.likeCount || 0
      })
    } finally {
      this._commentLikePending[id] = false
    }
  },

  clearReplyTo() {
    this.setData({ replyTo: null })
  },

  async submitComment() {
    const text = this.data.commentText.trim()
    if (!text) return wx.showToast({ title: '请输入评论内容', icon: 'none' })
    // 请求进行中忽略重复提交，避免连点产生重复评论。
    if (this._commentPending) return
    this._commentPending = true
    this.setData({ isSubmittingComment: true })
    try {
      const result = await doSubmitComment({
        targetId: this.data.postId, targetType: 'post', content: text,
        replyTo: this.data.replyTo ? this.data.replyTo._id : null,
        // 提交标识用于服务端幂等：重试同一内容不会产生重复评论。
        requestId: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      })
      if (!result.success) return wx.showToast({ title: result.message, icon: 'none' })
      this.setData({ commentText: '', replyTo: null, commentCount: this.data.commentCount + 1 })
      wx.showToast({ title: '评论成功', icon: 'success' })
      wx.pageScrollTo({ selector: '.comment-list', duration: 300 })
      this.loadComments(this.data.postId)
    } finally {
      this._commentPending = false
      this.setData({ isSubmittingComment: false })
    }
  },

  // —— 更多操作菜单 ——
  showActionMenu() {
    const isOwner = this.data.isOwner
    const items = isOwner
      ? ['编辑动态', '删除动态', '生成分享卡片', '举报内容']
      : ['生成分享卡片', '举报内容']

    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const action = items[res.tapIndex]
        if (action === '编辑动态') this.editPost()
        else if (action === '删除动态') this.deletePost()
        else if (action === '举报内容') this.reportContent()
        else if (action === '生成分享卡片') this.shareCard()
      }
    })
  },

  shareCard() {
    wx.navigateTo({
      url: `/pages/share-card/share-card?type=post&id=${this.data.postId}`
    })
  },

  editPost() {
    const { postId, post } = this.data
    if (!postId || !post) return
    wx.navigateTo({
      url: `/pages/post-create/post-create?editId=${postId}&mode=edit`
    })
  },

  deletePost() {
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，评论也将被清除。确定要删除这条动态吗？',
      confirmColor: '#E02020',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        try {
          const result = await app.callCloud('deleteContent', {
            contentType: 'post',
            contentId: this.data.postId
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
    const { postId, post } = this.data
    wx.showActionSheet({
      itemList: ['垃圾广告', '违法违规', '不实信息', '其他'],
      success: async (res) => {
        const reasons = ['垃圾广告', '违法违规', '不实信息', '其他']
        const reason = reasons[res.tapIndex]
        wx.showLoading({ title: '提交中...' })
        try {
          const result = await app.callCloud('reportContent', {
            targetId: postId,
            targetType: 'post',
            targetName: (post.content || '').slice(0, 30),
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
  }
})
