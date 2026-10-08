/**
 * hot-diary-card 组件 — 热门日记卡片（大图）
 * 用法：
 *   <hot-diary-card
 *     item="{{post}}"
 *     index="{{index}}"
 *     bind:tap="onDiaryTap"
 *     bind:locationTap="onLocationTap"
 *   />
 */
Component({
  properties: {
    item: { type: Object, value: null },
    index: { type: Number, value: 0 }
  },

  data: {
    imageLoaded: false,
    imageError: false
  },

  methods: {
    // 点击卡片整体 → 动态详情
    onTap() {
      if (this.data.item?._id) {
        this.triggerEvent('tap', { id: this.data.item._id })
      }
    },

    // 点击地点名称 → 地点详情（阻止冒泡）
    onLocationTap(e) {
      const locationId = this.data.item?.locationId
      if (locationId) {
        this.triggerEvent('locationTap', { id: locationId })
      }
    },

    // 图片加载完成
    onImageLoad() {
      this.setData({ imageLoaded: true })
    },

    // 图片加载失败
    onImageError() {
      this.setData({ imageError: true })
    }
  }
})
