const app = getApp()
const { uploadImages, bindDarkMode, unbindDarkMode, redirectWithToast } = require('../../utils/common')

Page({
  data: {
    darkMode: false,
    name: '', category: '',
    locationKind: 'shooting',
    serviceCategory: '',
    serviceCategoryOptions: ['餐饮', '商场', '交通', '补给'],
    serviceCategoryIndex: -1,
    categoryOptions: ['自然风光', '城市街景', '室内场景', '公园绿地', '水域', '山地', '其他'],
    categoryIndex: -1,
    tags: [], tagInput: '',
    description: '',
    images: [], maxImages: 9,
    latitude: null, longitude: null, address: '', mapMarkers: [],
    weatherInfo: null, submitting: false,
    addressKeyword: '', addressSuggestions: [], isSuggestingAddress: false,
    isIndoor: false,
    styleOptions: [
      { key: 'forest', name: '森林' },
      { key: 'urban', name: '城市' },
      { key: 'ruins', name: '废墟' },
      { key: 'ancient', name: '古风' },
      { key: 'water', name: '水景' },
      { key: 'countryside', name: '田园' },
      { key: 'park', name: '公园' },
      { key: 'night', name: '夜间' }
    ],
    activeStyle: '',
    styleIconMap: {
      forest: 'compass', urban: 'home', ruins: 'map', ancient: 'flag',
      water: 'cloud-rain', countryside: 'map', park: 'map-pin', night: 'moon'
    },
    facilityOptions: [
      { key: 'shade', name: '遮阳', checked: false },
      { key: 'restroom', name: '有厕所', checked: false },
      { key: 'changing', name: '可换装', checked: false },
      { key: 'parking', name: '附近停车', checked: false },
      { key: 'power', name: '有电源', checked: false }
    ],
    rating: 0,
    bestTime: '', season: '', notice: '', visibility: 'public',
    isEdit: false, editId: '',
    currentStep: 0,
    steps: ['基本信息', '位置信息', '详细说明']
  },

  onLoad(options) {
    this.setData({ darkMode: app.globalData.darkMode || false })
    if (!this._ensureLoggedIn()) return
    // 从地图外部地点跳转过来时，先预填腾讯地图返回的基础信息，
    // 用户只需补充图片与描述，避免重复手动输入。
    const prefilled = this._applyExternalPoi(options)
    if (options.editId) {
      this.setData({ isEdit: true, editId: options.editId })
      this._loadForEdit(options.editId)
    } else if (!prefilled) this._locate()
    // 深色模式实时同步（统一走 utils/common 的 bindDarkMode）
    bindDarkMode(this)
  },

  /**
   * 预填来自腾讯地图的外部地点信息。
   * 只在确实带有坐标与名称时生效，并阻止草稿恢复覆盖这些值。
   * @returns {boolean} 是否成功预填
   */
  _applyExternalPoi(options) {
    const name = options && options.poiName ? decodeURIComponent(options.poiName) : ''
    const latitude = Number(options && options.poiLat)
    const longitude = Number(options && options.poiLng)
    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return false

    const address = options.poiAddress ? decodeURIComponent(options.poiAddress) : ''
    const rawCategory = options.poiCategory ? decodeURIComponent(options.poiCategory) : ''
    // 把腾讯分类映射到本页已有的分类选项；映射不到就留空由用户选择。
    const categoryIndex = this.data.categoryOptions.findIndex(item =>
      rawCategory && (rawCategory.includes(item) || item.includes(rawCategory))
    )

    this._prefilledFromMap = true
    this.setData({
      name,
      address,
      latitude,
      longitude,
      category: categoryIndex >= 0 ? this.data.categoryOptions[categoryIndex] : '',
      categoryIndex,
      mapMarkers: [{ id: 0, latitude, longitude, width: 32, height: 32 }],
      // 从地图添加的地点默认标记为公开，符合「分享地点」的预期
      visibility: 'public'
    })
    wx.showToast({ title: '已填入地图地点信息', icon: 'none' })
    return true
  },

  _ensureLoggedIn() {
    if (app.globalData.isLoggedIn) return true
    wx.showModal({
      title: '请先登录',
      content: '登录后才能上传地点。',
      confirmText: '去登录',
      success: result => {
        if (result.confirm) wx.switchTab({ url: '/pages/profile/profile' })
        else wx.navigateBack()
      }
    })
    return false
  },

  onReady() {
    // 已从地图预填时不再恢复草稿，避免旧草稿把地图地点信息覆盖掉。
    if (this._prefilledFromMap) return
    if (!this.data.isEdit && !this.data.name && !this.data.description && this.data.images.length === 0) this._restoreDraft()
  },

  onUnload() {
    unbindDarkMode(this)
    this._saveDraft()
  },

  _saveDraft() {
    if (this._draftCleared) return
    if (this.data.isEdit || (!this.data.name.trim() && !this.data.description.trim() && this.data.images.length === 0)) return
    wx.setStorageSync('location_upload_draft_v1', {
      name: this.data.name, category: this.data.category, categoryIndex: this.data.categoryIndex, tags: this.data.tags,
      description: this.data.description, images: this.data.images, latitude: this.data.latitude, longitude: this.data.longitude,
      address: this.data.address, isIndoor: this.data.isIndoor, activeStyle: this.data.activeStyle,
      locationKind: this.data.locationKind, serviceCategory: this.data.serviceCategory, serviceCategoryIndex: this.data.serviceCategoryIndex,
      facilityOptions: this.data.facilityOptions, rating: this.data.rating, bestTime: this.data.bestTime,
      season: this.data.season, notice: this.data.notice, visibility: this.data.visibility,
      currentStep: this.data.currentStep
    })
  },

  _restoreDraft() {
    const draft = wx.getStorageSync('location_upload_draft_v1')
    if (!draft || (!draft.name && !draft.description && !(draft.images || []).length)) return
    const summary = (draft.name || draft.description || '').trim().slice(0, 48) || `${(draft.images || []).length} 张图片`
    wx.showModal({ title: '恢复草稿', content: `检测到未发布的地点草稿：${summary}${summary.length >= 48 ? '…' : ''}\n\n是否恢复？`, confirmText: '恢复', cancelText: '丢弃', success: result => {
      if (result.confirm) {
        const hasPosition = Number.isFinite(Number(draft.latitude)) && Number.isFinite(Number(draft.longitude))
        this.setData({ ...draft, mapMarkers: hasPosition ? [{ id: 0, latitude: draft.latitude, longitude: draft.longitude, width: 32, height: 32 }] : [] })
      } else wx.removeStorageSync('location_upload_draft_v1')
    } })
  },

  async _loadForEdit(locationId) {
    wx.showLoading({ title: '加载中...' })
    try {
      const res = await app.callCloud('getLocationDetail', { locationId })
      const item = res && res.data
      if (!item) throw new Error('地点不存在或已删除')
      const facilities = this.data.facilityOptions.map(option => ({
        ...option,
        checked: (item.facilities || []).some(f => (f.key || f) === option.key)
      }))
      this.setData({
        name: item.name || '', category: item.category || '',
        locationKind: item.locationKind || (item.isServiceLocation ? 'service' : 'shooting'),
        serviceCategory: item.serviceCategory || '',
        serviceCategoryIndex: Math.max(-1, this.data.serviceCategoryOptions.indexOf(item.serviceCategory || '')),
        categoryIndex: Math.max(0, this.data.categoryOptions.indexOf(item.category)),
        tags: item.tags || [], description: item.description || '', images: item.images || [],
        latitude: item.latitude, longitude: item.longitude, address: item.address || '',
        mapMarkers: [{ id: 0, latitude: item.latitude, longitude: item.longitude, width: 32, height: 32 }],
        isIndoor: !!item.indoor, activeStyle: item.style || '', facilityOptions: facilities,
        rating: item.creatorRating == null ? (item.rating || 0) : item.creatorRating,
        bestTime: item.bestTime || '', season: item.season || '', notice: item.notice || '',
        visibility: item.visibility || 'public'
      })
    } catch (err) {
      redirectWithToast(err.message || '加载编辑内容失败', { delay: 800 })
    } finally { wx.hideLoading() }
  },

  _locate() {
    wx.getLocation({
      type: 'gcj02',
      success: (r) => {
        this.setData({
          latitude: r.latitude, longitude: r.longitude,
          address: `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`,
          mapMarkers: [{ id: 0, latitude: r.latitude, longitude: r.longitude, width: 32, height: 32 }]
        })
      },
      fail: () => {
        wx.showModal({
          title: '定位权限未开启',
          content: '请授权位置权限以自动获取当前位置，或手动在地图上选择地点。',
          confirmText: '去设置',
          success: (result) => { if (result.confirm) wx.openSetting() }
        })
      }
    })
  },

  // ── 表单输入 ──
  onNameInput(e) { this.setData({ name: e.detail.value }) },
  onLocationKindTap(e) {
    const locationKind = e.currentTarget.dataset.kind
    this.setData({ locationKind })
  },
  onCategoryChange(e) {
    const idx = e.detail.value
    this.setData({ categoryIndex: idx, category: this.data.categoryOptions[idx] })
  },
  onServiceCategoryChange(e) {
    const idx = Number(e.detail.value)
    this.setData({ serviceCategoryIndex: idx, serviceCategory: this.data.serviceCategoryOptions[idx] || '' })
  },
  onDescInput(e) { this.setData({ description: e.detail.value }) },
  onBestTimeInput(e) { this.setData({ bestTime: e.detail.value }) },
  onSeasonInput(e) { this.setData({ season: e.detail.value }) },
  onNoticeInput(e) { this.setData({ notice: e.detail.value }) },
  setVisibility(e) { this.setData({ visibility: e.currentTarget.dataset.value }) },
  onAddressInput(e) {
    const addressKeyword = e.detail.value
    this.setData({ addressKeyword })
    if (this._addressTimer) clearTimeout(this._addressTimer)
    if (!addressKeyword.trim()) return this.setData({ addressSuggestions: [] })
    this._addressTimer = setTimeout(() => this._suggestAddress(addressKeyword.trim()), 300)
  },
  async _suggestAddress(keyword) {
    this.setData({ isSuggestingAddress: true })
    try {
      const res = await app.callCloud('suggestPlaces', { keyword, region: '全国' })
      this.setData({ addressSuggestions: (res.data || []).slice(0, 5) })
    } catch (err) {
      this.setData({ addressSuggestions: [] })
    } finally {
      this.setData({ isSuggestingAddress: false })
    }
  },
  onAddressSuggestionTap(e) {
    const item = e.currentTarget.dataset.item
    if (!item || !Number.isFinite(Number(item.latitude)) || !Number.isFinite(Number(item.longitude))) return
    this._applyLocation({
      latitude: Number(item.latitude), longitude: Number(item.longitude),
      address: item.address || item.name, name: item.name
    })
  },
  _applyLocation({ latitude, longitude, address, name = '' }) {
    this.setData({
      latitude, longitude,
      address: address || name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
      addressKeyword: name || address || '',
      addressSuggestions: [],
      mapMarkers: [{ id: 0, latitude, longitude, width: 32, height: 32 }]
    })
  },
  reLocate() { this._locate(); wx.showToast({ title: '正在定位...', icon: 'none' }) },
  chooseOnMap() {
    wx.chooseLocation({
      success: (res) => {
        this._applyLocation(res)
      }
    })
  },
  setIndoor(e) { this.setData({ isIndoor: e.currentTarget.dataset.val === 'true' }) },
  onStyleTap(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ activeStyle: this.data.activeStyle === key ? '' : key })
  },
  toggleFacility(e) {
    const idx = e.currentTarget.dataset.index
    this.setData({ [`facilityOptions[${idx}].checked`]: !this.data.facilityOptions[idx].checked })
  },
  onRatingTap(e) { this.setData({ rating: e.currentTarget.dataset.value }) },

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
  onTagInput(e) { this.setData({ tagInput: e.detail.value }) },
  addTag() { this._addTag('tags', 'tagInput', 5) },
  removeTag(e) { this._removeTag('tags', e) },

  // ── 图片 ──
  chooseImage() {
    const remaining = this.data.maxImages - this.data.images.length
    if (remaining <= 0) return wx.showToast({ title: `最多${this.data.maxImages}张`, icon: 'none' })
    wx.chooseMedia({
      count: remaining, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success: (r) => this.setData({ images: [...this.data.images, ...r.tempFiles.map(f => f.tempFilePath)] })
    })
  },
  removeImage(e) {
    const { index } = e.currentTarget.dataset
    this.setData({ images: this.data.images.filter((_, i) => i !== index) })
  },
  previewImage(e) {
    wx.previewImage({ urls: this.data.images, current: this.data.images[e.currentTarget.dataset.index] })
  },

  // ── 提交 ──
  validate() {
    if (!this.data.name?.trim()) return wx.showToast({ title: '请输入地点名称', icon: 'none' }), false
    if (this.data.locationKind === 'service' && !this.data.serviceCategory) return wx.showToast({ title: '请选择周边服务分类', icon: 'none' }), false
    if (this.data.locationKind !== 'service' && !this.data.category) return wx.showToast({ title: '请选择地点类别', icon: 'none' }), false
    if (!Number.isFinite(Number(this.data.latitude)) || !Number.isFinite(Number(this.data.longitude))) {
      wx.showToast({ title: '请先选择地点位置', icon: 'none' })
      return false
    }
    return true
  },

  validateStep(step = this.data.currentStep) {
    if (step === 0) {
      if (!this.data.name?.trim()) return wx.showToast({ title: '请输入地点名称', icon: 'none' }), false
      if (this.data.locationKind === 'service' && !this.data.serviceCategory) return wx.showToast({ title: '请选择周边服务分类', icon: 'none' }), false
      if (this.data.locationKind !== 'service' && !this.data.category) return wx.showToast({ title: '请选择地点类别', icon: 'none' }), false
    }
    if (step === 1 && (!Number.isFinite(Number(this.data.latitude)) || !Number.isFinite(Number(this.data.longitude)))) {
      wx.showToast({ title: '请先选择地点位置', icon: 'none' })
      return false
    }
    return true
  },

  onNextStep() {
    if (!this.validateStep()) return
    this.setData({ currentStep: Math.min(2, this.data.currentStep + 1) })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  onPrevStep() {
    this.setData({ currentStep: Math.max(0, this.data.currentStep - 1) })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  async submit() {
    if (!this.validate() || this.data.submitting) return
    this.setData({ submitting: true })
    wx.showLoading({ title: '上传中...' })

    try {
      let imageUrls
      try {
        imageUrls = await uploadImages(this.data.images, 'locations')
      } catch (err) {
        const uploadError = new Error('图片上传失败，请检查网络后重试')
        uploadError.isImageUploadError = true
        throw uploadError
      }

      const payload = {
        name: this.data.name.trim(),
        category: this.data.locationKind === 'service' ? this.data.serviceCategory : this.data.category,
        locationKind: this.data.locationKind,
        isServiceLocation: this.data.locationKind === 'service',
        serviceCategory: this.data.locationKind === 'service' ? this.data.serviceCategory : '',
        tags: this.data.tags,
        description: this.data.description.trim(),
        images: imageUrls,
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        address: this.data.address,
        weather: this.data.weatherInfo,
        indoor: this.data.isIndoor,
        style: this.data.activeStyle,
        facilities: this.data.facilityOptions.filter(f => f.checked).map(f => ({ key: f.key, name: f.name })),
        rating: this.data.rating,
        bestTime: this.data.bestTime.trim(),
        season: this.data.season.trim(),
        notice: this.data.notice.trim(),
        visibility: this.data.visibility,
        imageVisibility: this.data.visibility
      }
      const result = this.data.isEdit
        ? await app.callCloud('updateContent', { contentType: 'location', contentId: this.data.editId, data: payload })
        : await app.callCloud('addLocation', payload)

      wx.hideLoading()
      if (result.code === -2 && result.data && result.data.locationId) {
        wx.showModal({
          title: '发现相近地点', content: '该地点可能已被收录，是否直接查看？',
          confirmText: '查看地点',
          success: modal => {
            if (modal.confirm) wx.redirectTo({ url: `/pages/location-detail/location-detail?id=${result.data.locationId}` })
          }
        })
        this.setData({ submitting: false })
      } else if (result.code === 0) {
        wx.showToast({ title: this.data.isEdit ? '保存成功' : '发布成功', icon: 'success' })
        if (this.data.isEdit) {
          setTimeout(() => { this.setData({ submitting: false }); wx.redirectTo({ url: `/pages/location-detail/location-detail?id=${this.data.editId}` }) }, 800)
          return
        }
        wx.removeStorageSync('location_upload_draft_v1')
        this._draftCleared = true
        const locId = result.data && result.data.locationId
        app.trackEvent('location_create', { targetId: locId, targetType: 'location' })
        if (locId) {
          setTimeout(() => { this.setData({ submitting: false }); wx.redirectTo({ url: `/pages/location-detail/location-detail?id=${locId}` }) }, 1500)
        } else {
          setTimeout(() => { this.setData({ submitting: false }); wx.navigateBack() }, 1500)
        }
      } else if (result.code === -4) {
        wx.showModal({
          title: '完善资料',
          content: result.message,
          confirmText: '去完善',
          success: modal => {
            if (modal.confirm) wx.navigateTo({ url: '/pages/profile-edit/profile-edit' })
          }
        })
        this.setData({ submitting: false })
      } else {
        wx.showToast({ title: result.message || '发布失败', icon: 'none' })
        this.setData({ submitting: false })
      }
    } catch (err) {
      wx.hideLoading()
      console.error('发布地点失败', err)
      wx.showToast({ title: err.isImageUploadError ? err.message : (err.message || '发布失败，请重试'), icon: 'none' })
      this.setData({ submitting: false })
    }
  }
})
