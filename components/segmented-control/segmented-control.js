/**
 * segmented-control 组件 — 分段控制器
 * 用法：
 *   <segmented-control
 *     items="{{['关注','发现','附近']}}"
 *     activeIndex="{{activeIndex}}"
 *     bind:change="onTabChange"
 *   />
 */
Component({
  properties: {
    items: { type: Array, value: [] },
    activeIndex: { type: Number, value: 0 }
  },

  methods: {
    onItemTap(e) {
      const index = e.currentTarget.dataset.index
      if (index === this.data.activeIndex) return
      this.triggerEvent('change', { index })
    }
  }
})
