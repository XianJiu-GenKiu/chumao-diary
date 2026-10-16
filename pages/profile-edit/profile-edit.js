const app = getApp()
const { uploadImages } = require('../../utils/common')
const PROFILE_BG_CROP_SCALE = '16:9'

// 与云函数 updateUserProfile → contentSecurity.js 的 MAX_IMAGE_BYTES 对齐。
// 超过这个体积云端会直接判 rejected，但返回的文案是「未通过安全审核」，
// 用户会误以为内容违规，其实是图太大。
const MAX_PROFILE_IMAGE_BYTES = 1024 * 1024

// 微信选图返回的临时文件，在真机上常表现为 http://tmp/xxx（模拟器同样如此）。
// 旧版这里把所有 http(s):// 一律当成外链，于是把临时文件误判成网络图，
// 交给 wx.downloadFile 去「下载」一个本地文件 —— 必然失败，
// 表现为「头像和背景图怎么都换不了」。
// 其它页面（设置页换头像 / 发帖 / 上传地点）都是把临时路径直传 uploadImages，所以不受影响。
function isWechatTempFile(path) {
  return /^(wxfile|wxblob|blob|file):/i.test(path) || /^https?:\/\/tmp\//i.test(path)
}

function isLocalImage(path) {
  if (!path) return false
  if (/^cloud:\/\//.test(path)) return false
  if (isWechatTempFile(path)) return true
  if (/^https?:\/\//i.test(path)) return false
  return true
}

/**
 * 只上传「这次真的换过」的图。
 * 没换就原样回传旧值：云端 updateUserProfile 对新旧值相同的字段会跳过重复审核，
 * 也就不会为了重新上传去下载一个可能不在 downloadFile 域名白名单里的历史外链头像。
 * @param {string} path 当前值
 * @param {string} folder 云存储目录
 * @param {string} currentPath 进入页面时的原始值
 */
async function uploadIfLocal(path, folder, currentPath) {
  if (!path) return ''
  if (/^cloud:\/\//.test(path)) return path
  if (currentPath && path === currentPath) return path

  // Legacy WeChat avatar URLs are downloaded and re-uploaded so the server can
  // run image moderation on every public profile asset.
  const source = isLocalImage(path) ? path : await downloadImage(path)
  const [fileId] = await uploadImages([source], folder, { maxBytes: MAX_PROFILE_IMAGE_BYTES })
  return fileId || ''
}

function downloadImage(path) {
  return new Promise((resolve, reject) => {
    if (!path) return reject(new Error('请先上传背景图'))
    if (isLocalImage(path)) return resolve(path)
    if (/^cloud:\/\//.test(path)) {
      wx.cloud.downloadFile({
        fileID: path,
        success: res => resolve(res.tempFilePath),
        fail: reject
      })
      return
    }
    wx.downloadFile({
      url: path,
      success: res => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.tempFilePath)
        else reject(new Error('背景图下载失败'))
      },
      fail: reject
    })
  })
}

Page({
  data: {
    darkMode: false,
    nickname: '',
    furName: '',
    signature: '',
    avatar: '',
    profileBg: '',
    saving: false
  },

  onLoad() {
    const user = app.globalData.userInfo || wx.getStorageSync('userInfo') || {}
    const avatar = user.avatar || user.avatarUrl || ''
    const profileBg = user.profileBg || user.backgroundImage || user.coverUrl || ''
    // 记住进页面时的原值：保存时只有真正变过的图才重新上传，
    // 未变动的历史外链头像不会被拉去下载重传（那条路很容易因域名白名单失败）。
    this._origin = { avatar, profileBg }
    this.setData({
      darkMode: app.globalData.darkMode || false,
      nickname: user.nickname || '',
      furName: user.furName || '',
      signature: user.signature || '',
      avatar,
      profileBg
    })
  },

  onFieldInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  /** 空处理器：只用于 catchtap 阻止事件冒泡（头像按钮不能触发外层的换背景）。 */
  noop() {},

  /**
   * 微信官方「头像昵称填写能力」回调。
   * <button open-type="chooseAvatar"> 触发，e.detail.avatarUrl 是临时文件路径，
   * 保存时由 uploadIfLocal 上传到云存储并过审。
   */
  onChooseAvatar(e) {
    const avatarUrl = (e && e.detail && e.detail.avatarUrl) || ''
    if (!avatarUrl) return
    this.setData({ avatar: avatarUrl })
  },

  chooseProfileBg() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: result => {
        const filePath = result.tempFiles[0].tempFilePath
        this.setData({ profileBg: filePath })
      }
    })
  },

  async cropProfileBg() {
    if (!this.data.profileBg) return this.chooseProfileBg()
    wx.showLoading({ title: '准备图片...' })
    try {
      const src = await downloadImage(this.data.profileBg)
      wx.hideLoading()
      if (wx.cropImage) {
        wx.cropImage({
          src,
          cropScale: PROFILE_BG_CROP_SCALE,
          success: res => this.setData({ profileBg: res.tempFilePath || src }),
          fail: () => wx.showToast({ title: '裁剪已取消', icon: 'none' })
        })
        return
      }
      if (wx.editImage) {
        wx.showToast({ title: '当前环境不支持固定比例裁剪', icon: 'none' })
        wx.editImage({
          src,
          success: res => this.setData({ profileBg: res.tempFilePath || src })
        })
        return
      }
      wx.showToast({ title: '当前环境不支持图片编辑', icon: 'none' })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '图片准备失败', icon: 'none' })
    }
  },

  editProfileBg() {
    if (!this.data.profileBg) return this.chooseProfileBg()
    if (wx.editImage && isLocalImage(this.data.profileBg)) {
      wx.editImage({
        src: this.data.profileBg,
        success: res => this.setData({ profileBg: res.tempFilePath || this.data.profileBg }),
        fail: () => this.previewProfileBg()
      })
      return
    }
    this.previewProfileBg()
  },

  previewProfileBg() {
    if (!this.data.profileBg) return
    wx.previewImage({
      current: this.data.profileBg,
      urls: [this.data.profileBg]
    })
  },

  async save() {
    if (this.data.saving) return
    const nickname = this.data.nickname.trim()
    if (!nickname) return wx.showToast({ title: '请输入昵称', icon: 'none' })

    this.setData({ saving: true })
    wx.showLoading({ title: '保存中...' })
    let uploaded = null
    try {
      const origin = this._origin || {}
      const [avatar, profileBg] = await Promise.all([
        uploadIfLocal(this.data.avatar, 'avatars', origin.avatar),
        uploadIfLocal(this.data.profileBg, 'profile-backgrounds', origin.profileBg)
      ])
      uploaded = { avatar, profileBg }
      // 上传成功后立刻同步本地展示，云函数万一失败也不会出现「图已换、页面没变」
      this.setData({ avatar, profileBg })

      const res = await app.callCloud('updateUserProfile', {
        nickname,
        furName: this.data.furName,
        signature: this.data.signature,
        avatar,
        profileBg
      })
      if (!res || res.code !== 0) throw new Error((res && res.message) || '保存失败')

      const nextUser = {
        ...(app.globalData.userInfo || {}),
        ...(res.data || {}),
        nickname,
        furName: this.data.furName,
        signature: this.data.signature,
        avatar,
        profileBg
      }
      app.globalData.userInfo = nextUser
      wx.setStorageSync('userInfo', nextUser)
      this._origin = { avatar, profileBg }

      const pages = getCurrentPages()
      const prevPage = pages[pages.length - 2]
      if (prevPage && prevPage.route === 'pages/profile/profile') {
        prevPage.setData({ userInfo: nextUser, isLoggedIn: true })
      }

      wx.showToast({ title: '保存成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
    } catch (err) {
      // 图片已上传成功、只是云函数没写进去时，把上传结果记为新基准，
      // 用户再点一次保存会直接复用 fileID，不必重新上传。
      if (uploaded) this._origin = uploaded
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ saving: false })
    }
  }
})
