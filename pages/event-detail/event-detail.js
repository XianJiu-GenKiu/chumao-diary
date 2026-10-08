/**
 * 活动详情页
 * 展示活动详细信息、参与人员、支持报名/取消报名、点赞、分享
 */
const app = getApp()
const { parseSceneId } = require('../../utils/scene')

const { bindDarkMode, unbindDarkMode, redirectWithToast } = require('../../utils/common')
Page({
  data: {
    id: '',
    event: null,
    participants: [],
    joined: false,
    loading: true,
    darkMode: false
  },

  onLoad(options) {
    // 活动海报的小程序码通过 scene 传参，必须与 options.id 一并解析。
    const id = parseSceneId(options)
    this.setData({
      id,
      darkMode: app.globalData.darkMode,
      loading: !!id
    })
    if (!id) {
      redirectWithToast('活动链接已失效')
      return
    }
    this._loadDetail()
    // 深色模式实时同步（统一走 utils/common 的 bindDarkMode）
    bindDarkMode(this)
  },

  onUnload() {
    unbindDarkMode(this)
  },

  // ── 加载详情 ──
  async _loadDetail() {
    try {
      const res = await app.callCloud('getEventDetail', { id: this.data.id })
      if (!res || res.code !== 0) {
        redirectWithToast('活动不存在')
        return
      }

      const event = res.data
      // 格式化时间
      event.formattedTime = this._formatEventTime(event.startTime, event.endTime)
      event.isLiked = event.isLiked || false

      // 检查是否已报名
      const joinRes = await app.callCloud('checkEventJoined', { eventId: this.data.id })
      const joined = joinRes && joinRes.data && joinRes.data.joined

      this.setData({
        event,
        participants: event.participants || [],
        joined,
        loading: false
      })
    } catch (err) {
      console.error('加载活动详情失败:', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  // ── 报名 / 取消 ──
  async toggleJoin() {
    const { joined, event, id } = this.data
    if (event.status === 'ended') return

    // 乐观更新
    this.setData({
      joined: !joined,
      'event.joinCount': (event.joinCount || 0) + (joined ? -1 : 1)
    })

    wx.vibrateShort({ type: 'medium' })

    try {
      const res = await app.callCloud(joined ? 'cancelJoinEvent' : 'joinEvent', {
        eventId: id
      })
      if (!res || res.code !== 0) {
        // 回滚
        this.setData({
          joined: !this.data.joined,
          'event.joinCount': (event.joinCount || 0)
        })
        wx.showToast({ title: (res && (res.message || res.msg)) || '操作失败', icon: 'none' })
      } else {
        wx.showToast({ title: joined ? '已取消报名' : '报名成功！', icon: 'success' })
        // 刷新参与人员列表
        this._loadDetail()
      }
    } catch (err) {
      // 回滚
      this.setData({
        joined: !this.data.joined,
        'event.joinCount': (event.joinCount || 0)
      })
      wx.showToast({ title: '网络错误', icon: 'none' })
    }
  },

  // ── 点赞 ──
  async toggleLike() {
    const { event, id } = this.data
    const isLiked = !event.isLiked

    this.setData({
      'event.isLiked': isLiked,
      'event.likeCount': (event.likeCount || 0) + (isLiked ? 1 : -1)
    })

    wx.vibrateShort({ type: 'light' })

    try {
      const res = await app.callCloud('toggleEventLike', { eventId: id })
      if (!res || res.code !== 0) {
        this.setData({
          'event.isLiked': !isLiked,
          'event.likeCount': (event.likeCount || 0) + (isLiked ? -1 : 1)
        })
      }
    } catch (err) {
      this.setData({
        'event.isLiked': !isLiked,
        'event.likeCount': (event.likeCount || 0) + (isLiked ? -1 : 1)
      })
    }
  },

  // ── 分享卡片 ──
  shareCard() {
    wx.navigateTo({
      url: `/pages/share-card/share-card?type=event&id=${this.data.id}`
    })
  },

  // ── 分享 ──
  onShareAppMessage() {
    const { event } = this.data
    const cover = event && (event.cover || event.coverUrl)
    return {
      title: event ? `${event.name} - 出毛日记活动` : '出毛日记 · 活动',
      path: `/pages/event-detail/event-detail?id=${this.data.id}`,
      imageUrl: cover || ''
    }
  },

  onShareTimeline() {
    const { event } = this.data
    const cover = event && (event.cover || event.coverUrl)
    return {
      title: event ? event.name : '出毛日记 · 精彩活动',
      query: `id=${this.data.id}`,
      imageUrl: cover || ''
    }
  },

  // ── 辅助 ──
  _formatEventTime(startTime, endTime) {
    if (!startTime) return '时间待定'
    const now = new Date()
    const start = new Date(startTime)
    const end = endTime ? new Date(endTime) : null

    const formatPart = (d) => {
      const m = d.getMonth() + 1
      const day = d.getDate()
      const h = String(d.getHours()).padStart(2, '0')
      const min = String(d.getMinutes()).padStart(2, '0')
      const isToday = d.toDateString() === now.toDateString()
      if (isToday) return `今天 ${h}:${min}`
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      if (d.toDateString() === tomorrow.toDateString()) return `明天 ${h}:${min}`
      return `${m}月${day}日 ${h}:${min}`
    }

    if (end) return `${formatPart(start)} - ${formatPart(end)}`
    return formatPart(start)
  }
})
