const app = getApp()
const { createPager, uploadImages } = require('../../utils/common')

Page({
  data: {
    images: [],
    maxImages: 9,
    content: '',
    maxContent: 500,
    contentLength: 0,
    location: null,
    locationName: '',
    // 心情改为出毛语境：通用 emoji（开心/难过）与兽装场景脱节，
    // 现改用项目原创的兽头表情图标（见 components/icon 的 mood-* 图标），
    // 图标可跟随主题换色，深色模式下也不会失真。
    moods: [
      { key: 'like', icon: 'mood-like', label: '种草' },
      { key: 'dislike', icon: 'mood-dislike', label: '踩雷' },
      { key: 'excited', icon: 'mood-excited', label: '出发啦' },
      { key: 'focused', icon: 'mood-focused', label: '拍摄中' },
      { key: 'cozy', icon: 'mood-cozy', label: '毛茸茸' },
      { key: 'sunny', icon: 'mood-sunny', label: '好天气' },
      { key: 'tired', icon: 'mood-tired', label: '累了' },
      { key: 'rest', icon: 'mood-rest', label: '收工啦' }
    ],
    selectedMood: '',
    tagInput: '',
    tags: [],
    isPublishing: false,
    darkMode: false,
    visibility: 'public',
    equipTags: [],
    equipInput: '',
    isEdit: false,
    editId: '',
    // 自定义导航栏需要状态栏高度做顶部占位
    statusBarHeight: 20
  },

  onLoad(options) {
    // 状态栏高度直接读取，避免 app.globalData 尚未就绪时回退到错误值
    // （刘海屏状态栏可达 44px 以上，用固定 20 会导致导航栏被顶到屏幕外）
    let statusBarHeight = (app.globalData.systemInfo && app.globalData.systemInfo.statusBarHeight) || 0
    if (!statusBarHeight) {
      try {
        statusBarHeight = wx.getWindowInfo().statusBarHeight || 20
      } catch (e) {
        statusBarHeight = 20
      }
    }
    this.setData({
      darkMode: app.globalData.darkMode || false,
      statusBarHeight
    })
    if (!this._ensureLoggedIn()) return
    if (options.editId) {
      this.setData({ isEdit: true, editId: options.editId })
      this._loadForEdit(options.editId)
      return
    }
    if (options.locationId && options.locationName) {
      this.setData({
        location: { _id: options.locationId },
        locationName: decodeURIComponent(options.locationName)
      })
    }
  },

  _ensureLoggedIn() {
    if (app.globalData.isLoggedIn) return true
    wx.showModal({
      title: '请先登录',
      content: '登录后才能发布动态。',
      confirmText: '去登录',
      success: result => {
        if (result.confirm) wx.switchTab({ url: '/pages/profile/profile' })
        else wx.navigateBack()
      }
    })
    return false
  },

  // 自定义导航栏返回：优先返回上一页，无上一页时回到动态页
  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
    } else {
      wx.switchTab({ url: '/pages/posts/posts' })
    }
  },

  onReady() {
    if (!this.data.isEdit && !this.data.content && this.data.images.length === 0) this._restoreDraft()
  },

  onUnload() { this._saveDraft() },

  _saveDraft() {
    if (this._draftCleared) return
    if (this.data.isEdit || (!this.data.content.trim() && this.data.images.length === 0 && !this.data.locationName)) return
    wx.setStorageSync('post_create_draft_v1', {
      content: this.data.content, images: this.data.images, location: this.data.location, locationName: this.data.locationName,
      selectedMood: this.data.selectedMood, tags: this.data.tags, equipTags: this.data.equipTags, visibility: this.data.visibility
    })
  },

  _restoreDraft() {
    const draft = wx.getStorageSync('post_create_draft_v1')
    if (!draft || (!draft.content && !(draft.images || []).length && !draft.locationName)) return
    const summary = (draft.content || '').trim().slice(0, 48) || `${(draft.images || []).length} 张图片${draft.locationName ? ` · ${draft.locationName}` : ''}`
    wx.showModal({ title: '恢复草稿', content: `检测到未发布的动态草稿：${summary}${summary.length >= 48 ? '…' : ''}\n\n是否恢复？`, confirmText: '恢复', cancelText: '丢弃', success: result => {
      if (result.confirm) this.setData({ content: draft.content || '', contentLength: (draft.content || '').length, images: draft.images || [], location: draft.location || null, locationName: draft.locationName || '', selectedMood: draft.selectedMood || '', tags: draft.tags || [], equipTags: draft.equipTags || [], visibility: draft.visibility || 'public' })
      else wx.removeStorageSync('post_create_draft_v1')
    } })
  },

  async _loadForEdit(postId) {
    wx.showLoading({ title: '加载中...' })
    try {
      const res = await app.callCloud('post-detail', { postId })
      const post = res && res.data
      if (!post) throw new Error('动态不存在或已删除')
      this.setData({
        content: post.content || '',
        contentLength: (post.content || '').length,
        images: post.images || [],
        location: post.location || (post.locationId ? { _id: post.locationId } : null),
        locationName: post.locationName || '',
        selectedMood: post.mood || '',
        tags: post.tags || [],
        equipTags: post.equipTags || [],
        visibility: post.visibility || 'public'
      })
    } catch (err) {
      wx.showToast({ title: err.message || '加载编辑内容失败', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
    } finally { wx.hideLoading() }
  },

  chooseImage() {
    const remaining = this.data.maxImages - this.data.images.length
    if (remaining <= 0) {
      wx.showToast({ title: `最多选择${this.data.maxImages}张图片`, icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const newImages = res.tempFiles.map(f => f.tempFilePath)
        this.setData({
          images: this.data.images.concat(newImages).slice(0, this.data.maxImages)
        })
      }
    })
  },

  previewImage(e) {
    wx.previewImage({
      current: this.data.images[e.currentTarget.dataset.index],
      urls: this.data.images
    })
  },

  removeImage(e) {
    const idx = e.currentTarget.dataset.index
    this.setData({ images: this.data.images.filter((_, i) => i !== idx) })
  },

  onContentInput(e) {
    const content = e.detail.value.slice(0, this.data.maxContent)
    this.setData({ content, contentLength: content.length })
  },

  chooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          location: { latitude: res.latitude, longitude: res.longitude },
          locationName: res.name || res.address
        })
      }
    })
  },

  clearLocation() {
    this.setData({ location: null, locationName: '' })
  },

  selectMood(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ selectedMood: this.data.selectedMood === key ? '' : key })
  },

  onTagInput(e) { this.setData({ tagInput: e.detail.value }) },

  _addTag(listKey, inputKey, max) {
    const tag = this.data[inputKey].trim()
    if (!tag) return
    const list = this.data[listKey]
    if (list.includes(tag)) return wx.showToast({ title: '标签已存在', icon: 'none' })
    if (list.length >= max) return wx.showToast({ title: `最多${max}个`, icon: 'none' })
    this.setData({ [listKey]: [...list, tag], [inputKey]: '' })
  },
  _removeTag(listKey, e) {
    this.setData({ [listKey]: this.data[listKey].filter((_, i) => i !== e.currentTarget.dataset.index) })
  },
  addTag() { this._addTag('tags', 'tagInput', 5) },
  removeTag(e) { this._removeTag('tags', e) },
  onEquipInput(e) { this.setData({ equipInput: e.detail.value }) },
  addEquipTag() { this._addTag('equipTags', 'equipInput', 10) },
  removeEquipTag(e) { this._removeTag('equipTags', e) },
  setVisibility(e) {
    this.setData({ visibility: e.currentTarget.dataset.val })
  },

  async publish() {
    if (this.data.isPublishing) return

    if (!this.data.content.trim() && this.data.images.length === 0) {
      wx.showToast({ title: '请输入内容或添加图片', icon: 'none' })
      return
    }

    this.setData({ isPublishing: true })
    wx.showLoading({ title: '发布中...' })

    try {
      let imageUrls
      try {
        imageUrls = await uploadImages(this.data.images, 'posts')
      } catch (err) {
        const uploadError = new Error('图片上传失败，请检查网络后重试')
        uploadError.isImageUploadError = true
        throw uploadError
      }

      const payload = {
        content: this.data.content.trim(),
        images: imageUrls,
        location: this.data.location,
        locationName: this.data.locationName,
        mood: this.data.selectedMood,
        tags: this.data.tags,
        equipTags: this.data.equipTags,
        visibility: this.data.visibility
      }
      const res = this.data.isEdit
        ? await app.callCloud('updateContent', { contentType: 'post', contentId: this.data.editId, data: payload })
        : await app.callCloud('post-create', payload)

      if (res && res.code === -4) {
        wx.hideLoading()
        wx.showModal({
          title: '完善资料',
          content: res.message,
          confirmText: '去完善',
          success: modal => {
            if (modal.confirm) wx.navigateTo({ url: '/pages/profile-edit/profile-edit' })
          }
        })
        this.setData({ isPublishing: false })
        return
      }

      if (!res || res.code !== 0) {
        throw new Error((res && res.message) || '发布失败')
      }

      wx.hideLoading()
      wx.showToast({ title: this.data.isEdit ? '保存成功' : '发布成功', icon: 'success' })
      wx.removeStorageSync('post_create_draft_v1')
      this._draftCleared = true
      const postId = res && res.data && res.data.postId
      if (!this.data.isEdit) app.trackEvent('post_create', { targetId: postId, targetType: 'post' })
      setTimeout(() => {
        if (this.data.isEdit) {
          wx.redirectTo({ url: `/pages/post-detail/post-detail?id=${this.data.editId}` })
          return
        }
        if (postId) {
          wx.redirectTo({ url: `/pages/post-detail/post-detail?id=${postId}` })
        } else {
          wx.navigateBack()
        }
      }, 1500)
    } catch (err) {
      wx.hideLoading()
      console.error('发布失败:', err)
      wx.showToast({ title: err.isImageUploadError ? err.message : (err.message || '发布失败，请重试'), icon: 'none' })
    } finally {
      this.setData({ isPublishing: false })
    }
  }
})
