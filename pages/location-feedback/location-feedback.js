/**
 * 推荐新地点（用户地点反馈）
 *
 * 合规定位：本页是「用户 → 运营方」的**单向**反馈通道。
 *   - 提交只落 location_submissions 集合，仅运营方后台可读；
 *   - 用户之间互不可见 —— 本页不提供「我的提交」也绝不提供他人的提交列表；
 *   - 提交成功后不提供任何对外分享入口。
 * 公开地点仍由运营方经 location-upload 录入，用户提交只是素材来源，
 * 因此本页不产生任何「用户发布 → 他人可见」的链路。
 */
const app = getApp()
const { bindDarkMode, unbindDarkMode } = require('../../utils/common')
const { FEEDBACK_CATEGORIES, NAME_MAX, NOTE_MAX, ADDRESS_MAX } = require('../../config/location-feedback')

/** 查询串可能已经（或还没有）被框架解码，解不开就按原样用，不能让预填把页面搞崩。 */
function safeDecode(value) {
  const raw = String(value === undefined || value === null ? '' : value)
  try { return decodeURIComponent(raw) } catch (e) { return raw }
}

Page({
  data: {
    darkMode: false,
    // 从地点卡片（mode=poi）进来：是对已有地点的补充 / 纠错，文案随之切换
    isPoi: false,
    categories: FEEDBACK_CATEGORIES,
    nameMax: NAME_MAX,
    noteMax: NOTE_MAX,
    addressMax: ADDRESS_MAX,
    name: '',
    category: '',
    address: '',
    latitude: null,
    longitude: null,
    note: '',
    submitting: false,
    submitted: false
  },

  onLoad(options) {
    const opts = options || {}
    // 两条入口共用本页：
    //   mode=poi  ← 地点卡片的「反馈此地点」（已收录 / 未收录地点都能纠错）
    //   默认       ← 「找场地」搜不到结果、设置页「推荐新地点」
    const isPoi = opts.mode === 'poi'
    const patch = {
      darkMode: app.globalData.darkMode || false,
      isPoi
    }
    const name = safeDecode(opts.name).trim()
    if (name) patch.name = name.slice(0, NAME_MAX)
    const address = safeDecode(opts.address).trim()
    if (address) patch.address = address.slice(0, ADDRESS_MAX)
    // 类型来自卡片展示名，只有落进封闭集合才预选，避免把自定义文案塞进单选标签墙。
    const category = safeDecode(opts.category).trim()
    if (FEEDBACK_CATEGORIES.indexOf(category) !== -1) patch.category = category
    const latitude = Number(opts.latitude)
    const longitude = Number(opts.longitude)
    if (Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== 0 && longitude !== 0) {
      patch.latitude = latitude
      patch.longitude = longitude
    }
    this.setData(patch)
    bindDarkMode(this)
  },

  onUnload() { unbindDarkMode(this) },

  // ── 表单输入 ──
  onNameInput(e) { this.setData({ name: e.detail.value }) },
  onCategoryTap(e) {
    const value = e.currentTarget.dataset.value
    // 再点一次取消，便于纠正误触。
    this.setData({ category: this.data.category === value ? '' : value })
  },
  onNoteInput(e) { this.setData({ note: e.detail.value }) },
  onAddressInput(e) {
    // 手输地址后旧坐标不再对应该文字，一并清空，避免落库出现矛盾数据。
    this.setData({ address: e.detail.value, latitude: null, longitude: null })
  },
  chooseOnMap() {
    wx.chooseLocation({
      success: (res) => {
        const label = (res.address || res.name || '').trim()
        this.setData({
          address: label.slice(0, ADDRESS_MAX),
          latitude: res.latitude,
          longitude: res.longitude
        })
      },
      fail: () => {
        wx.showToast({ title: '未选择位置，可手输大概地点', icon: 'none' })
      }
    })
  },
  clearLocation() { this.setData({ address: '', latitude: null, longitude: null }) },

  validate() {
    if (!this.data.name.trim()) {
      wx.showToast({ title: '请填写地点名称', icon: 'none' })
      return false
    }
    if (!this.data.category) {
      wx.showToast({ title: '请选择地点类型', icon: 'none' })
      return false
    }
    return true
  },

  async submit() {
    if (this.data.submitting) return
    if (!this.validate()) return
    this.setData({ submitting: true })
    try {
      const res = await app.callCloud('submitLocationFeedback', {
        name: this.data.name.trim(),
        category: this.data.category,
        address: this.data.address.trim(),
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        note: this.data.note.trim()
      })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '提交失败')
      this.setData({ submitted: true })
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败，请重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  onSubmitAnother() {
    this.setData({
      submitted: false, name: '', category: '',
      address: '', latitude: null, longitude: null, note: ''
    })
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/discover/discover' })
  }
})
