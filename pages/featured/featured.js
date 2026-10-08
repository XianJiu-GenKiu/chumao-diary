/**
 * 精选（tabBar 第 2 项）
 *
 * 公开展示型：整页为「运营方视角的地点推荐流」，纯展示。
 * 不包含点赞、评论、发布、关注，也不展示任何用户头像 / 昵称。
 *
 * 数据源只用两个公开读接口，不涉及用户生成内容：
 *   - getSeasonalLocations → 本季推荐
 *   - getLocations         → 人气地点（客户端按收藏数排序取前若干）
 */
const app = getApp()
const { bindDarkMode, unbindDarkMode } = require('../../utils/common')

Page({
  data: {
    darkMode: false,
    loading: true,
    error: '',
    season: '',
    seasonList: [],
    hotList: []
  },

  onLoad() {
    this.setData({ darkMode: app.globalData.darkMode || false })
    // 深色模式实时同步（统一走 utils/common 的 bindDarkMode）
    bindDarkMode(this)
    this.load()
  },

  onUnload() { unbindDarkMode(this) },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const [seasonRes, locRes] = await Promise.allSettled([
        app.callCloud('getSeasonalLocations'),
        app.callCloud('getLocations', { page: 1, pageSize: 20 })
      ])
      const seasonOk = seasonRes.status === 'fulfilled' && seasonRes.value && seasonRes.value.code === 0
      const locOk = locRes.status === 'fulfilled' && locRes.value && locRes.value.code === 0
      // 两个接口都不可用才算失败；只有一个可用时照常展示已有的那一段。
      if (!seasonOk && !locOk) throw new Error('加载失败，请重试')

      const seasonData = (seasonOk && seasonRes.value.data) || {}
      const seasonList = Array.isArray(seasonData.list) ? seasonData.list.slice(0, 10) : []
      const all = (locOk && Array.isArray(locRes.value.data)) ? locRes.value.data : []
      // 人气地点：仅按收藏数排序，不使用任何用户身份或互动关系。
      const hotList = all
        .slice()
        .sort((a, b) => (Number(b.favoriteCount) || 0) - (Number(a.favoriteCount) || 0))
        .slice(0, 12)

      this.setData({
        season: seasonData.season || '',
        seasonList,
        hotList,
        loading: false
      })
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败，请重试' })
    }
  },

  onLocationTap(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/location-detail/location-detail?id=${id}` })
  },

  onSearchTap() { wx.navigateTo({ url: '/pages/search/search' }) },

  onSeasonalTap() { wx.navigateTo({ url: '/pages/seasonal/seasonal' }) },

  onLeaderboardTap() { wx.navigateTo({ url: '/pages/leaderboard/leaderboard' }) },

  onRetry() { this.load() }
})
