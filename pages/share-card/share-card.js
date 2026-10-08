/**
 * 地点分享海报：地点主视觉、实用拍摄信息、社交证明与小程序码。
 */
const app = getApp()
const { buildScene } = require('../../utils/scene')

Page({
  data: {
    type: '',
    id: '',
    isLoading: true,
    canvasWidth: 630,
    canvasHeight: 1000,
    title: '',
    subtitle: '',
    coverImg: '',
    city: '',
    category: '',
    bestTime: '',
    season: '',
    rating: '',
    statText: '',
    qrCodePath: '',
    qrError: '',
    loadError: ''
  },

  onLoad(options) {
    this.setData({ type: options.type || 'location', id: options.id || '' })
    this._loadData()
  },

  async _loadData() {
    this.setData({ isLoading: true, loadError: '' })
    try {
      if (this.data.type === 'event') {
        await this._loadEventData(this.data.id)
      } else if (this.data.type === 'location') {
        await this._loadLocationData(this.data.id)
      } else if (this.data.type === 'collection') {
        await this._loadCollectionData(this.data.id)
      } else {
        throw new Error('暂不支持生成此类海报')
      }
      await this._loadMiniProgramCode()
      this._drawCard()
    } catch (err) {
      console.error('生成分享卡片失败:', err)
      this.setData({ isLoading: false, loadError: err.message || '生成失败，请重试' })
    }
  },

  retryLoad() { this._loadData() },

  async _loadEventData(id) {
    const res = await app.callCloud('getEventDetail', { id })
    if (!res || res.code !== 0 || !res.data) throw new Error('活动不存在或已结束')
    const ev = res.data
    const cover = typeof ev.cover === 'string' ? ev.cover : (ev.coverUrl || '')
    const timeText = this._formatEventTime(ev.startTime, ev.endTime)
    const joinCount = Number(ev.joinCount) || (ev.participantOpenIds && ev.participantOpenIds.length) || 0
    const maxText = ev.maxPeople ? `上限 ${ev.maxPeople} 人` : '人数不限'
    const statusText = ev.status === 'ended' ? '已结束' : ev.status === 'ongoing' ? '进行中' : '即将开始'
    this.setData({
      title: ev.name || '出毛活动',
      subtitle: ev.location || '一起出发去出毛',
      coverImg: cover,
      city: '',
      category: '出毛活动',
      bestTime: timeText || '时间待定',
      season: `${joinCount} 人已报名`, // 复用“推荐季节”信息块展示报名人数
      rating: maxText,
      statText: `${statusText} · ${joinCount} 人已报名`
    })
  },

  _formatEventTime(startTime, endTime) {
    const fmt = (d) => {
      const date = new Date(d)
      if (isNaN(date.getTime())) return ''
      const m = date.getMonth() + 1
      const day = date.getDate()
      const h = String(date.getHours()).padStart(2, '0')
      const min = String(date.getMinutes()).padStart(2, '0')
      return `${m}月${day}日 ${h}:${min}`
    }
    const start = fmt(startTime)
    const end = fmt(endTime)
    if (start && end) return `${start} - ${end}`
    return start || ''
  },

  async _loadLocationData(id) {
    const res = await app.callCloud('getLocationDetail', { locationId: id })
    if (!res || res.code !== 0 || !res.data) throw new Error('地点不存在或已下架')
    const loc = res.data
    const address = loc.address || [loc.city, loc.district].filter(Boolean).join(' · ')
    const cover = Array.isArray(loc.images) && loc.images.length ? loc.images[0] : ''
    this.setData({
      title: loc.name || '发现一处好地点',
      subtitle: address || '收藏这处值得出发的风景',
      coverImg: typeof cover === 'string' ? cover : (cover.url || ''),
      city: loc.city || '',
      category: loc.categoryName || loc.category || '拍摄地点',
      bestTime: loc.bestTime || '待探索',
      season: loc.season || '四季皆宜',
      rating: loc.rating ? String(loc.rating) : '暂无评分',
      statText: `${Number(loc.reactionUpCount || loc.likeCount || 0)} 人种草  ·  ${Number(loc.checkinCount || 0)} 人到访`
    })
  },

  async _loadCollectionData(id) {
    const res = await app.callCloud('manageCollections', { action: 'sharedDetail', collectionId: id })
    if (!res || res.code !== 0 || !res.data) throw new Error('合集不存在或未公开')
    const collection = res.data
    const first = (collection.locations || [])[0] || {}
    this.setData({
      title: collection.name || '地点合集', subtitle: collection.description || '一起收藏出毛好地点',
      coverImg: (first.images && first.images[0]) || '', city: first.city || '', category: '地点合集',
      bestTime: `${(collection.locations || []).length} 个地点`, season: '路线收藏',
      rating: '待探索', statText: '扫码查看完整路线'
    })
  },

  async _loadMiniProgramCode() {
    try {
      const page = this.data.type === 'event' ? 'pages/event-detail/event-detail'
        : this.data.type === 'collection' ? 'pages/route-plan/route-plan'
          : 'pages/location-detail/location-detail'
      // scene 上限 32 个可见字符，必须使用裸 ID；超长或不合法时不再生成，
      // 由调用方展示明确的失败态而不是画一个扫不出结果的占位码。
      const scene = buildScene(this.data.id)
      if (!scene) {
        this.setData({ qrCodePath: '', qrError: '内容 ID 无法生成小程序码' })
        return
      }
      const res = await app.callCloud('generateShareCode', {
        page,
        scene
      })
      const fileID = res && res.data && res.data.fileID
      if (!fileID) {
        // 把云函数透出的错误码一并显示，便于定位是权限、页面未发布还是参数问题。
        const base = (res && res.message) || '小程序码生成失败'
        const code = res && res.errcode
        this.setData({ qrCodePath: '', qrError: code ? `${base}（错误码 ${code}）` : base })
        return
      }
      const downloaded = await wx.cloud.downloadFile({ fileID })
      const tempPath = downloaded.tempFilePath || ''
      this.setData({ qrCodePath: tempPath, qrError: tempPath ? '' : '小程序码下载失败' })
    } catch (err) {
      // 海报仍可生成；但必须让用户知道扫码入口不可用，避免保存废海报。
      // 这里必须把真实原因透出：早期只写「暂不可用」会掩盖云函数未部署、
      // 超时、权限未配置等可操作信息，导致无法定位问题。
      console.warn('小程序码暂不可用:', err)
      const detail = String((err && (err.errMsg || err.message)) || '').replace(/^cloud\.callFunction:fail\s*/i, '')
      this.setData({ qrCodePath: '', qrError: detail ? `小程序码暂不可用：${detail}` : '小程序码暂不可用' })
    }
  },

  async _drawCard() {
    let coverPath = ''
    if (this.data.coverImg) {
      try { coverPath = await this._downloadImage(this.data.coverImg) } catch (err) { console.warn('封面下载失败', err) }
    }
    const query = wx.createSelectorQuery()
    query.select('#shareCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0]) return this.setData({ isLoading: false })
      const canvas = res[0].node
      const ctx = canvas.getContext('2d')
      const dpr = wx.getWindowInfo().pixelRatio || 1
      const w = this.data.canvasWidth
      const h = this.data.canvasHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.scale(dpr, dpr)
      this._render(ctx, canvas, w, h, coverPath).finally(() => this.setData({ isLoading: false }))
    })
  },

  async _render(ctx, canvas, w, h, coverPath) {
    const cover = await this._loadCanvasImage(canvas, coverPath)
    const code = await this._loadCanvasImage(canvas, this.data.qrCodePath)
    const inset = 28

    // 封面作为整张海报的沉浸式底图，保证有图时第一眼就是地点。
    this._roundRect(ctx, 0, 0, w, h, 24)
    ctx.save(); ctx.clip()
    if (cover) this._drawCover(ctx, cover, 0, 0, w, h)
    else {
      const fallback = ctx.createLinearGradient(0, 0, w, h)
      fallback.addColorStop(0, '#365d4f'); fallback.addColorStop(1, '#172a32')
      ctx.fillStyle = fallback; ctx.fillRect(0, 0, w, h)
    }
    const shade = ctx.createLinearGradient(0, 0, 0, h)
    shade.addColorStop(0, 'rgba(9,24,24,.20)')
    shade.addColorStop(.46, 'rgba(8,19,20,.18)')
    shade.addColorStop(.72, 'rgba(8,18,20,.83)')
    shade.addColorStop(1, 'rgba(8,18,20,.97)')
    ctx.fillStyle = shade; ctx.fillRect(0, 0, w, h)
    ctx.restore()

    // 顶部：品牌和城市坐标。
    this._pill(ctx, inset, 30, 142, 38, 'rgba(255,255,255,.16)')
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(this.data.type === 'event' ? '出毛日记 · 活动' : '出毛日记 · 地点', inset + 71, 55)
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,.84)'; ctx.font = '14px sans-serif'
    ctx.fillText(this.data.city || '城市探索', w - inset, 55)

    // 中段：地点基本信息。
    const titleY = 510
    ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = 'bold 38px sans-serif'
    const lines = this._wrapText(ctx, this.data.title, w - inset * 2)
    lines.slice(0, 2).forEach((line, index) => ctx.fillText(line, inset, titleY + index * 50))
    const subY = titleY + Math.min(lines.length, 2) * 50 + 8
    ctx.fillStyle = 'rgba(255,255,255,.86)'; ctx.font = '17px sans-serif'
    ctx.fillText(`⌖  ${this._truncate(this.data.subtitle, 32)}`, inset, subY)
    this._pill(ctx, inset, subY + 24, 110, 32, 'rgba(228,157,50,.90)')
    ctx.fillStyle = '#172520'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(this._truncate(this.data.category, 8), inset + 55, subY + 46)

    // 信息胶囊：把“拍摄建议”放进分享海报，提升保存和转发价值。
    const infoY = 678
    const gap = 12
    const itemW = (w - inset * 2 - gap * 2) / 3
    this._infoTile(ctx, inset, infoY, itemW, '最佳拍摄', this._truncate(this.data.bestTime, 8))
    this._infoTile(ctx, inset + itemW + gap, infoY, itemW, '推荐季节', this._truncate(this.data.season, 8))
    this._infoTile(ctx, inset + (itemW + gap) * 2, infoY, itemW, '地点评分', this.data.rating === '暂无评分' ? this.data.rating : `${this.data.rating} / 5`)
    ctx.fillStyle = 'rgba(255,255,255,.70)'; ctx.font = '15px sans-serif'; ctx.textAlign = 'left'
    ctx.fillText(this.data.statText, inset, infoY + 126)

    // 底部扫码区；必须留有白底和足够尺寸，保证小程序码识别率。
    const qrY = 838
    this._roundRect(ctx, inset, qrY, w - inset * 2, 128, 18)
    ctx.fillStyle = '#fff'; ctx.fill()
    if (code) {
      ctx.drawImage(code, inset + 16, qrY + 14, 100, 100)
      ctx.fillStyle = '#1d2926'; ctx.font = 'bold 19px sans-serif'; ctx.textAlign = 'left'
      ctx.fillText('扫码查看地点详情', inset + 136, qrY + 52)
      ctx.fillStyle = '#71817c'; ctx.font = '14px sans-serif'
      ctx.fillText('收藏路线，出发去拍', inset + 136, qrY + 78)
    } else {
      this._roundRect(ctx, inset + 16, qrY + 14, 100, 100, 12); ctx.fillStyle = '#edf1ef'; ctx.fill()
      ctx.fillStyle = '#426356'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('出', inset + 66, qrY + 76)
      ctx.fillStyle = '#1d2926'; ctx.font = 'bold 19px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('在微信内打开地点详情', inset + 136, qrY + 52)
      ctx.fillStyle = '#71817c'; ctx.font = '14px sans-serif'; ctx.fillText('小程序码正在准备中', inset + 136, qrY + 78)
    }
  },

  _infoTile(ctx, x, y, w, label, value) {
    this._roundRect(ctx, x, y, w, 92, 14); ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,.64)'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, x + w / 2, y + 31)
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px sans-serif'; ctx.fillText(value, x + w / 2, y + 62)
  },

  _pill(ctx, x, y, w, h, color) { this._roundRect(ctx, x, y, w, h, h / 2); ctx.fillStyle = color; ctx.fill() },
  _roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath() },
  _drawCover(ctx, image, x, y, w, h) { const s = Math.max(w / image.width, h / image.height); ctx.drawImage(image, x + (w - image.width * s) / 2, y + (h - image.height * s) / 2, image.width * s, image.height * s) },
  _truncate(text, max) { text = String(text || ''); return text.length > max ? `${text.slice(0, max - 1)}…` : text },
  _wrapText(ctx, text, maxWidth) { const lines = []; let line = ''; for (const char of String(text || '')) { if (ctx.measureText(line + char).width > maxWidth && line) { lines.push(line); line = char } else line += char } if (line) lines.push(line); return lines },
  _loadCanvasImage(canvas, path) { if (!path) return Promise.resolve(null); return new Promise(resolve => { const img = canvas.createImage(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = path }) },
  async _downloadImage(url) {
    if (String(url).startsWith('cloud://')) {
      const res = await wx.cloud.getTempFileURL({ fileList: [url] })
      url = res.fileList && res.fileList[0] && res.fileList[0].tempFileURL
    }
    if (!url) throw new Error('图片地址无效')
    return new Promise((resolve, reject) => wx.downloadFile({ url, success: res => res.statusCode === 200 ? resolve(res.tempFilePath) : reject(new Error('图片下载失败')), fail: reject }))
  },

  saveToAlbum() {
    wx.createSelectorQuery().select('#shareCanvas').fields({ node: true, size: true }).exec(async res => {
      if (!res || !res[0]) return
      try {
        wx.showLoading({ title: '保存中…' })
        const result = await wx.canvasToTempFilePath({ canvas: res[0].node, destWidth: this.data.canvasWidth * 2, destHeight: this.data.canvasHeight * 2 })
        await wx.saveImageToPhotosAlbum({ filePath: result.tempFilePath })
        wx.showToast({ title: '已保存到相册', icon: 'success' })
      } catch (err) {
        if (String(err.errMsg || '').includes('auth deny')) wx.openSetting()
        else wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      } finally { wx.hideLoading() }
    })
  },

  onShareAppMessage() { const page = this.data.type === 'event' ? 'event-detail/event-detail' : this.data.type === 'collection' ? 'route-plan/route-plan' : 'location-detail/location-detail'; return { title: this.data.title || '发现一处好地点', path: `/pages/${page}?id=${this.data.id}` } },
  onShareTimeline() { return { title: this.data.title || '发现一处好地点', query: `id=${this.data.id}` } }
})
