/**
 * poi-preview-card 组件
 * ─────────────────────────────────────────────────────────────
 * 地图 POI 预览卡片。同一套模板渲染「小程序自有地点」与「腾讯地图外部地点」，
 * 差异由 utils/poi-adapter.js 产出的统一字段驱动（collectionStatus / can*）。
 *
 * 用法：
 *   <poi-preview-card
 *     item="{{selectedPoi}}"
 *     visible="{{showPoiPreview}}"
 *     placement="floating"
 *     top="{{poiCardTop}}"
 *     bind:viewDetail="onViewPoiDetail"
 *     bind:navigate="onNavigateToPoi"
 *     bind:favorite="onTogglePoiFavorite"
 *     bind:addToDiary="onAddExternalPoi"
 *     bind:close="onClosePoiPreview"
 *   />
 *
 * 交互要点：
 * 1. 多图时封面使用 swiper 展示，支持左右滑动与循环（circular）。
 * 2. 下滑关闭手势采用「阈值 + 轴向锁定」判定：只有纵向位移明显大于横向时才接管，
 *    因此不会抢走图片轮播的横向滑动，也不会影响卡片内按钮的点击。
 * 3. touchstart 阶段不做 setData，避免单纯点击时触发重渲染而吞掉 tap 事件。
 * 4. 弹出 / 弹入使用非线性缓动（见 wxss 的 --poi-ease-pop / --poi-ease-in），
 *    并通过 animState 状态机保证「进入」与「退出」各自使用不同的时间曲线。
 */
// 判定为「下滑关闭」所需的最小纵向位移（px）
const DRAG_START_THRESHOLD = 8
// 卡片可拖拽的最大位移（px）
const DRAG_MAX_OFFSET = 520
// 收藏按钮的短时防抖，避免连点重复提交
const FAVORITE_DEBOUNCE = 900
// 与 wxss 中弹入动画时长保持一致，用于动画结束后清理状态
const EXIT_DURATION = 260

Component({
  properties: {
    item: {
      type: Object,
      value: null,
      observer(item) {
        const id = item && item._id
        // 外部地点没有 _id，用 externalId / 名称兜底，保证「换地点」能被识别。
        const identity = id || (item && (item.externalId || item.name)) || ''
        // 只有切换到另一个地点时才重置轮播位置，
        // 否则「收藏」等操作回传新对象会把用户正在看的图片弹回第一张。
        const switched = identity !== this._lastItemId
        this._lastItemId = identity

        const images = item && Array.isArray(item.images) ? item.images.filter(Boolean) : []
        // 封面优先取预览图，其次封面字段，最后回退到首图。
        const coverSrc = item
          ? (item.previewImage || item.coverUrl || images[0] || '')
          : ''
        // 轮播图集：封面若不在 images 中则补到最前，保证「封面」与「轮播首图」一致。
        const gallery = images.slice()
        if (coverSrc && gallery.indexOf(coverSrc) === -1) gallery.unshift(coverSrc)

        const patch = { coverSrc, gallery }
        if (switched) {
          // 换地点时才重置轮播：swiperCurrent 驱动 swiper，currentImage 仅记录当前页。
          patch.swiperCurrent = 0
          patch.currentImage = 0
        }
        this.setData(patch)
      }
    },
    visible: {
      type: Boolean,
      value: false,
      observer(visible) {
        clearTimeout(this._enterTimer)
        clearTimeout(this._exitTimer)
        if (!visible) {
          this._beginExit()
          return
        }
        // 先挂载并回到初始态（缩小 + 偏移），下一帧再切到 enter，
        // 让 CSS 过渡真正产生「弹出」的补间动画。
        this.setData({
          mounted: true,
          animState: '',
          dragOffset: 0,
          dragging: false,
          closing: false,
          swiperCurrent: 0,
          currentImage: 0
        })
        this._enterTimer = setTimeout(() => {
          this.setData({ animState: 'enter' })
        }, 20)
      }
    },
    placement: {
      type: String,
      value: 'floating'
    },
    top: {
      type: Number,
      value: 0
    }
  },

  data: {
    dragOffset: 0,
    dragging: false,
    closing: false,
    coverSrc: '',
    gallery: [],
    // swiper 的 current 绑定值：只在程序化切换时修改，绝不在 bindchange 里回写。
    swiperCurrent: 0,
    // 用户当前看到的第几张图，供指示点与全屏预览使用。
    currentImage: 0,
    favPending: false,
    // 是否挂载卡片节点。由组件自己控制，保证「弹入动画」能播完再卸载：
    // 若直接依赖父级的 visible，页面把 visible 置 false 的瞬间节点就会被 wx:if 移除，
    // 动画根本没有机会播放。
    mounted: false,
    // 弹出 / 弹入动画状态：'' 初始态、'enter' 已弹出、'exit' 弹入中
    animState: ''
  },

  lifetimes: {
    detached() {
      clearTimeout(this._enterTimer)
      clearTimeout(this._closeTimer)
      clearTimeout(this._exitTimer)
      clearTimeout(this._favTimer)
    }
  },

  methods: {
    /**
     * 播放弹入动画并在结束后卸载节点。
     * 同时把 visible 同步回 false，避免父级状态与组件内部状态不一致。
     */
    _beginExit() {
      if (!this.data.mounted || this.data.animState === 'exit') return
      this.setData({ animState: 'exit' })
      clearTimeout(this._exitTimer)
      this._exitTimer = setTimeout(() => {
        this.setData({ mounted: false, animState: '' })
      }, EXIT_DURATION)
    },

    // ── 下滑关闭手势 ──
    // 注意：touchstart 里刻意不调用 setData。早期实现在这里 setData 触发重渲染，
    // 会把同一次手势产生的 tap 事件吞掉，导致卡片内按钮（如收藏红心）点不动。
    onTouchStart(e) {
      const touch = e.touches && e.touches[0]
      if (!touch || this.data.closing) return
      this._startX = touch.clientX
      this._startY = touch.clientY
      this._dragStartAt = Date.now()
      this._dragOffset = 0
      this._dragActive = false
      this._tracking = true
    },

    onTouchMove(e) {
      // _tracking 为 false 说明本次触摸没经过 onTouchStart（例如按钮已拦截），直接忽略，
      // 避免用上一次手势的起点算出错误的位移。
      if (!this._tracking || this.data.closing) return
      const touch = e.touches && e.touches[0]
      if (!touch) return
      const dx = touch.clientX - this._startX
      const dy = touch.clientY - this._startY

      if (!this._dragActive) {
        // 需同时满足：纵向位移超过阈值，且明显大于横向位移。
        // 这样横向滑动会留给图片轮播，单纯点击则完全不受影响。
        if (Math.abs(dy) < DRAG_START_THRESHOLD || Math.abs(dy) <= Math.abs(dx)) return
        this._dragActive = true
        this.setData({ dragging: true })
      }

      const offset = Math.max(0, Math.min(DRAG_MAX_OFFSET, dy))
      this._dragOffset = offset
      this.setData({ dragOffset: offset })
    },

    onTouchEnd() {
      if (!this._tracking) return
      this._tracking = false
      // 没有真正进入拖拽 → 什么都不做，让 tap 正常触发。
      if (!this._dragActive) return
      const elapsed = Math.max(1, Date.now() - this._dragStartAt)
      const velocity = this._dragOffset / elapsed
      const shouldClose = this._dragOffset > 100 || (this._dragOffset > 42 && velocity > 0.55)
      this._dragActive = false
      this.setData({ dragging: false })
      if (shouldClose) this.closeWithAnimation()
      else this.setData({ dragOffset: 0 })
    },

    onTouchCancel() {
      if (!this._tracking) return
      this._tracking = false
      if (!this._dragActive) return
      this._dragActive = false
      this.setData({ dragging: false, dragOffset: 0 })
    },

    /**
     * 关闭：先由组件自己播放弹入动画，动画结束后再通知页面。
     * 不能先通知页面 —— 页面把 visible 置 false 后卡片节点会被立即移除，
     * 弹入动画就没有机会播放（这是「动画看起来没生效」的根因）。
     */
    closeWithAnimation() {
      if (this.data.closing || this.data.animState === 'exit') return
      this.setData({ closing: true, dragging: false, dragOffset: 0, animState: 'exit' })
      clearTimeout(this._exitTimer)
      this._exitTimer = setTimeout(() => {
        this.setData({ mounted: false, animState: '', closing: false })
        // 动画播放完毕后再交回页面，页面据此清理 selectedPoi 等状态。
        // 带上 id 让页面能识别「这次关闭是否已过期」（期间用户可能已打开新卡片）。
        const item = this.data.item
        this.triggerEvent('close', { id: (item && item._id) || '' })
      }, EXIT_DURATION)
    },

    // ── 图片轮播 ──
    // 只记录当前页，不回写 swiperCurrent。
    // 官方文档指出：在 bindchange 中 setData 修改 current 会导致 setData 被不停调用，
    // 进而干扰滑动（表现为「有时滑不动」）。
    onGalleryChange(e) {
      this.setData({ currentImage: e.detail.current })
    },

    /** 点击图片打开全屏预览（支持左右滑动查看全部图片） */
    onPreviewImage() {
      const gallery = this.data.gallery
      if (!gallery.length) return
      wx.previewImage({
        current: gallery[this.data.currentImage] || gallery[0],
        urls: gallery
      })
    },

    // ── 操作 ──
    onViewDetail() {
      const item = this.data.item
      if (item && item._id && item.canViewDetail !== false) {
        this.triggerEvent('viewDetail', { id: item._id })
      }
    },

    onNavigate() {
      const item = this.data.item
      const latitude = Number(item && item.latitude)
      const longitude = Number(item && item.longitude)
      if (item && Number.isFinite(latitude) && Number.isFinite(longitude)) {
        wx.openLocation({
          latitude,
          longitude,
          name: item.name || '',
          address: item.address || '',
          scale: 15
        })
        this.triggerEvent('navigate', { id: item._id, externalId: item.externalId })
      } else {
        wx.showToast({ title: '暂无位置信息', icon: 'none' })
      }
    },

    onNearbyServices() {
      const item = this.data.item
      if (item && item._id) this.triggerEvent('nearbyServices', { id: item._id })
    },

    /** 外部地点：请求页面把该地点带进「创建地点」流程 */
    onAddToDiary() {
      const item = this.data.item
      if (!item || !item.canAddToDiary) return
      this.triggerEvent('addToDiary', {
        name: item.name,
        address: item.address,
        category: item.categoryName,
        latitude: item.latitude,
        longitude: item.longitude,
        externalSource: item.externalSource,
        externalId: item.externalId
      })
    },

    /**
     * 收藏 / 取消收藏：由页面负责云函数调用与状态同步。
     * 外部地点 canFavorite 为 false，不会走到这里。
     */
    onFavorite() {
      const item = this.data.item
      // 只有显式声明 canFavorite === false 才禁用（外部地点走这条）。
      // 未经过适配层的调用方可能没有该字段，此时按可收藏处理，保持向后兼容。
      if (!item || !item._id || item.canFavorite === false) return
      if (this._favPending) return
      this._favPending = true
      this.setData({ favPending: true })
      this.triggerEvent('favorite', { id: item._id, favorited: !item.isFavorited })
      clearTimeout(this._favTimer)
      this._favTimer = setTimeout(() => {
        this._favPending = false
        this.setData({ favPending: false })
      }, FAVORITE_DEBOUNCE)
    },

    onCopyAddress() {
      const addr = this.data.item && this.data.item.address
      if (!addr) return
      wx.setClipboardData({
        data: addr,
        success: () => {
          wx.showToast({ title: '地址已复制', icon: 'success' })
          wx.vibrateShort({ type: 'light' })
        }
      })
    },

    onClose() {
      this.closeWithAnimation()
    },

    preventBubble() {}
  }
})
