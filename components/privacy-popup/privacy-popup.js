/**
 * 隐私授权弹窗（全局复用）
 *
 * ── 为什么要有它 ──
 * 微信自 2023-10-17 起，隐私相关功能默认启用：调用 getLocation / chooseMedia /
 * chooseLocation / getUserProfile / saveImageToPhotosAlbum 等隐私接口前，必须先让用户
 * 同意《小程序用户隐私保护指引》。平台自带官方兜底弹窗，但样式不可控、与产品割裂，
 * 所以这里自建一个，交互和文案与站内协议保持一致。
 *
 * ── 两条触发路径（都要处理）──
 *   1) 被动：wx.onNeedPrivacyAuthorization —— 用户触发了未同意过的隐私接口时回调，
 *      必须由我们弹窗并最终 resolve({ event: 'agree' | 'disagree' }) 告诉平台结论。
 *   2) 主动：wx.getPrivacySetting —— 基础库 2.32.3+ 可查 needAuthorization，
 *      用于进页面就先提示，而不是等用户点到某个按钮才弹。
 *
 * ── 多实例问题（关键，别删这段判断）──
 * 组件挂在每个页面上，而 wx.onNeedPrivacyAuthorization 是全局监听：一次隐私接口调用
 * 会同时唤醒所有已挂载实例。如果每个实例都弹窗，用户会在当前页看到弹窗、后台页却各自
 * 攒了一份 resolve。所以只让「当前栈顶页面」上的那个实例响应 —— 其余实例不响应，
 * 平台按「开发者未响应」处理并走官方兜底，不会卡住接口调用。
 *
 * ── 合规要点 ──
 * 同意按钮必须用 <button open-type="agreePrivacyAuthorization">：这是平台认可的唯一
 * 同意入口，点击后微信侧才会记录「用户已同意」，之后隐私接口才放行。
 */
Component({
  data: {
    visible: false,
    contractName: ''
  },

  lifetimes: {
    attached() {
      this._resolve = null
      // 记住本实例所属页面，用于「只响应栈顶页面」的判断。
      const pages = getCurrentPages()
      this._page = pages[pages.length - 1] || null

      this._onNeed = (resolve, eventInfo) => {
        // 非栈顶页面不响应，交给平台官方弹窗兜底。
        if (!this._isTopPage()) return
        this._resolve = typeof resolve === 'function' ? resolve : null
        this._referrer = (eventInfo && eventInfo.referrer) || ''
        this.setData({ visible: true })
      }

      if (typeof wx.onNeedPrivacyAuthorization === 'function') {
        wx.onNeedPrivacyAuthorization(this._onNeed)
      }

      // 主动查询：进页面就提示，而不是等用户点到按钮才弹。
      this._checkNeedAuthorization()
    },

    detached() {
      if (typeof wx.offNeedPrivacyAuthorization === 'function' && this._onNeed) {
        wx.offNeedPrivacyAuthorization(this._onNeed)
      }
      this._resolve = null
    }
  },

  pageLifetimes: {
    show() {
      // 从后台页回到前台时重新判定，避免留下过期弹窗。
      this._checkNeedAuthorization()
    }
  },

  methods: {
    _isTopPage() {
      const pages = getCurrentPages()
      const top = pages[pages.length - 1] || null
      if (!top) return false
      // 页面实例是稳定引用；没记录到时退化为「当前有页面即响应」。
      return this._page ? top === this._page : true
    },

    _checkNeedAuthorization() {
      if (typeof wx.getPrivacySetting !== 'function') return
      wx.getPrivacySetting({
        success: res => {
          if (!res) return
          const name = res.privacyContractName || ''
          if (res.needAuthorization) {
            this.setData({ visible: true, contractName: name })
          } else if (this.data.visible) {
            // 已同意（可能在别的页面同意过）→ 收起，避免残留。
            this.setData({ visible: false })
          } else if (name && name !== this.data.contractName) {
            this.setData({ contractName: name })
          }
        },
        fail: () => {}
      })
    },

    openContract() {
      if (typeof wx.openPrivacyContract === 'function') {
        wx.openPrivacyContract({
          // 后台未配置指引时 openPrivacyContract 会失败，回退到站内协议页。
          fail: () => wx.navigateTo({ url: '/pages/agreement/agreement' })
        })
        return
      }
      wx.navigateTo({ url: '/pages/agreement/agreement' })
    },

    /** 用户点击「同意」：平台已在 open-type 回调里记录同意，这里只负责收尾。 */
    onAgree() {
      this._settle('agree')
      this.setData({ visible: false })
    },

    /** 用户点击「暂不同意」：告知平台拒绝，隐私接口会返回授权失败错误。 */
    onDisagree() {
      this._settle('disagree')
      this.setData({ visible: false })
    },

    _settle(event) {
      const resolve = this._resolve
      this._resolve = null
      if (typeof resolve !== 'function') return
      resolve(event === 'agree'
        ? { buttonId: 'pp-agree-btn', event: 'agree' }
        : { event: 'disagree' })
    },

    noop() {}
  }
})
