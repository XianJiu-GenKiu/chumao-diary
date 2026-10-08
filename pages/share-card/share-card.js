/**
 * 分享海报：地点 / 合集 / 个人足迹成就。
 *
 * footprint 类型说明（合规关键）：
 * - 数据只读本机存储（wx.setStorageSync），不发起任何云函数数据请求；
 * - 海报内容全部程序生成（成就地图连线 + 统计数字 + 城市名），不含自由文本、不含用户照片；
 * - 小程序码只指向小程序首页（pages/discover/discover），绝不指向个人足迹页 ——
 *   别人扫码打开的是他自己的小程序，不是"我的足迹"。
 */
const app = getApp()
const { buildScene } = require('../../utils/scene')
const { CITY_CANDIDATES } = require('../../config/cities.js')
const { FURMEET_MAP, cityLabel } = require('../../config/furmeets.js')

const FOOTPRINT_STORAGE_KEY = 'fur_footprints_v1'
const MARKER_COLOR_FOOTPRINT = '#F5A623'
const MARKER_COLOR_FURMEET = '#4FD1C5'

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
    // 海报中段的三格信息全部由程序生成，不含任何用户自由文本。
    tiles: [],
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
      if (this.data.type === 'location') {
        await this._loadLocationData(this.data.id)
      } else if (this.data.type === 'collection') {
        await this._loadCollectionData(this.data.id)
      } else if (this.data.type === 'footprint') {
        await this._loadFootprintData()
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
      // 三格信息全部由程序生成；不再展示「用户评分 / 种草数 / 到访数」这类跨用户聚合数据
      tiles: [
        { label: '最佳拍摄', value: loc.bestTime || '待探索' },
        { label: '推荐季节', value: loc.season || '四季皆宜' },
        { label: '所在城市', value: loc.city || '待补充' }
      ],
      statText: `${Number(loc.favoriteCount) || 0} 人收藏`
    })
  },

  async _loadCollectionData(id) {
    const res = await app.callCloud('manageCollections', { action: 'sharedDetail', collectionId: id })
    if (!res || res.code !== 0 || !res.data) throw new Error('合集不存在或未公开')
    const collection = res.data
    const locations = Array.isArray(collection.locations) ? collection.locations : []
    const first = locations[0] || {}
    const cityCount = new Set(locations.map(item => item && item.city).filter(Boolean)).size
    this.setData({
      // 标题由服务端程序生成（形如「XX的路线 · 5个地点」），不接收用户自由文本
      title: collection.title || collection.name || '地点合集',
      subtitle: collection.subtitle || '一起收藏出毛好地点',
      coverImg: (first.images && first.images[0]) || '',
      city: first.city || '',
      category: '地点合集',
      tiles: [
        { label: '地点数量', value: `${locations.length} 个` },
        { label: '覆盖城市', value: cityCount ? `${cityCount} 个` : '待补充' },
        { label: '合集类型', value: '路线收藏' }
      ],
      statText: '扫码查看完整路线'
    })
  },

  /**
   * 足迹海报数据：只读本机，不发任何云请求。
   * 若本机没有记录，直接抛错让用户回到足迹页先记录。
   */
  _loadFootprintData() {
    let records = []
    try {
      const value = wx.getStorageSync(FOOTPRINT_STORAGE_KEY)
      if (Array.isArray(value)) records = value
    } catch (e) { /* 按无记录处理 */ }

    if (!records.length) throw new Error('还没有出毛记录，先去记录一次吧')

    const places = new Set()
    const cities = new Set()
    const cityCounts = {}
    const days = new Set()
    let furmeetCount = 0
    const furmeetIds = new Set()
    const path = []
    const meets = []

    records.slice()
      .sort((a, b) => (a.visitedAt || 0) - (b.visitedAt || 0))
      .forEach(r => {
        if (r.placeName) places.add(r.placeName)
        if (r.city) {
          cities.add(r.city)
          cityCounts[r.city] = (cityCounts[r.city] || 0) + 1
        }
        if (r.visitedAt) days.add(new Date(r.visitedAt).toDateString())
        ;(r.furmeetIds || []).forEach(fid => {
          if (!FURMEET_MAP[fid]) return
          furmeetIds.add(fid)
          furmeetCount++
        })
        const hasCoords = Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
        if (!r.autoMarked && hasCoords) path.push({ latitude: r.latitude, longitude: r.longitude })
        if (!meets.some(m => m.id === (r.furmeetIds || [])[0]) && (r.furmeetIds || []).length && hasCoords) {
          meets.push({ id: r.furmeetIds[0], latitude: r.latitude, longitude: r.longitude })
        }
      })

    // 海报上的城市名按到访次数取前 6 个（变体甲：含城市名，不含任何自由文本）
    const topCities = Object.keys(cityCounts)
      .sort((a, b) => cityCounts[b] - cityCounts[a])
      .slice(0, 6)
      .map(cityLabel)

    const userInfo = app.globalData.userInfo || {}
    const nick = userInfo.furName || userInfo.nickName || userInfo.nickname || '毛毛用户'

    this._mapPoints = { path, meets }

    this.setData({
      title: `${nick}的出毛足迹`,
      subtitle: `累计出毛 ${records.length} 次 · 走过 ${days.size} 天`,
      coverImg: '',
      city: topCities.slice(0, 2).join(' · ') || '足迹地图',
      category: '足迹成就',
      tiles: [
        { label: '出毛次数', value: `${records.length} 次` },
        { label: '点亮城市', value: `${cities.size} 个` },
        { label: '兽聚场次', value: `${furmeetCount} 场` }
      ],
      statText: topCities.length ? `足迹遍及：${topCities.join(' · ')}` : '继续记录，点亮更多城市'
    })
  },

  async _loadMiniProgramCode() {
    try {
      // scene 跳转目标必须在降级版里真实存在：合集 → 路线页，其余 → 地点详情；
      // 足迹海报 → 小程序首页（个人数据不外链，扫码打开的是扫码者自己的小程序）。
      let page
      let scene
      if (this.data.type === 'footprint') {
        page = 'pages/discover/discover'
        scene = 'home' // discover 页不解析 scene，仅作占位（generateShareCode 要求 1-32 位合法字符）
      } else {
        page = this.data.type === 'collection'
          ? 'pages/route-plan/route-plan'
          : 'pages/location-detail/location-detail'
        // scene 上限 32 个可见字符，必须使用裸 ID；超长或不合法时不再生成，
        // 由调用方展示明确的失败态而不是画一个扫不出结果的占位码。
        scene = buildScene(this.data.id)
      }
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
    if (this.data.type === 'footprint') {
      await this._renderFootprint(ctx, canvas, w, h)
      return
    }
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
    ctx.fillText(this.data.type === 'collection' ? '出毛日记 · 合集' : '出毛日记 · 地点', inset + 71, 55)
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
    // 三格内容由 _loadLocationData / _loadCollectionData 程序生成，此处只负责排版。
    const infoY = 678
    const gap = 12
    const itemW = (w - inset * 2 - gap * 2) / 3
    const tiles = (Array.isArray(this.data.tiles) && this.data.tiles.length === 3)
      ? this.data.tiles
      : [{ label: '最佳拍摄', value: '待探索' }, { label: '推荐季节', value: '四季皆宜' }, { label: '所在城市', value: '待补充' }]
    tiles.forEach((tile, index) => {
      this._infoTile(ctx, inset + (itemW + gap) * index, infoY, itemW, this._truncate(tile.label, 6), this._truncate(tile.value, 8))
    })
    ctx.fillStyle = 'rgba(255,255,255,.70)'; ctx.font = '15px sans-serif'; ctx.textAlign = 'left'
    ctx.fillText(this.data.statText, inset, infoY + 126)

    // 底部扫码区；必须留有白底和足够尺寸，保证小程序码识别率。
    const isCollection = this.data.type === 'collection'
    const qrY = 838
    this._roundRect(ctx, inset, qrY, w - inset * 2, 128, 18)
    ctx.fillStyle = '#fff'; ctx.fill()
    if (code) {
      ctx.drawImage(code, inset + 16, qrY + 14, 100, 100)
      ctx.fillStyle = '#1d2926'; ctx.font = 'bold 19px sans-serif'; ctx.textAlign = 'left'
      ctx.fillText(isCollection ? '扫码查看完整路线' : '扫码查看地点详情', inset + 136, qrY + 52)
      ctx.fillStyle = '#71817c'; ctx.font = '14px sans-serif'
      ctx.fillText(isCollection ? '查看合集全部点位' : '收藏路线，出发去拍', inset + 136, qrY + 78)
    } else {
      this._roundRect(ctx, inset + 16, qrY + 14, 100, 100, 12); ctx.fillStyle = '#edf1ef'; ctx.fill()
      ctx.fillStyle = '#426356'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('出', inset + 66, qrY + 76)
      ctx.fillStyle = '#1d2926'; ctx.font = 'bold 19px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(isCollection ? '在微信内查看完整路线' : '在微信内打开地点详情', inset + 136, qrY + 52)
      ctx.fillStyle = '#71817c'; ctx.font = '14px sans-serif'; ctx.fillText('小程序码正在准备中', inset + 136, qrY + 78)
    }
  },

  /**
   * 足迹成就海报：地图连线 + 昵称 + 统计数字 + 城市名（全部程序生成）。
   * 与地点海报共用底部排版，但不用照片封面 —— 用户照片绝不进海报。
   */
  async _renderFootprint(ctx, canvas, w, h) {
    const inset = 28
    const code = await this._loadCanvasImage(canvas, this.data.qrCodePath)

    this._roundRect(ctx, 0, 0, w, h, 24)
    ctx.save(); ctx.clip()

    const bg = ctx.createLinearGradient(0, 0, 0, h)
    bg.addColorStop(0, '#1f4d44')
    bg.addColorStop(.5, '#173a35')
    bg.addColorStop(1, '#0f2622')
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h)

    // ── 成就地图区（把足迹连线画进海报） ──
    const mapTop = 96
    const mapBottom = 470
    this._drawFootprintMap(ctx, inset + 8, mapTop, w - (inset + 8) * 2, mapBottom - mapTop)

    // 顶部品牌 pill
    this._pill(ctx, inset, 30, 168, 38, 'rgba(255,255,255,.16)')
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText('出毛日记 · 足迹', inset + 84, 55)
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,.84)'; ctx.font = '14px sans-serif'
    ctx.fillText(this.data.city || '足迹地图', w - inset, 55)

    // 标题（昵称）与副标题（统计）—— 都来自程序拼接，非用户自由文本
    const titleY = 528
    ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = 'bold 36px sans-serif'
    this._wrapText(ctx, this.data.title, w - inset * 2).slice(0, 1)
      .forEach((line, index) => ctx.fillText(line, inset, titleY + index * 48))
    ctx.fillStyle = 'rgba(255,255,255,.86)'; ctx.font = '17px sans-serif'
    ctx.fillText(this._truncate(this.data.subtitle, 34), inset, titleY + 46)

    this._pill(ctx, inset, titleY + 66, 110, 32, 'rgba(228,157,50,.90)')
    ctx.fillStyle = '#172520'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(this._truncate(this.data.category, 8), inset + 55, titleY + 88)

    // 三格统计
    const infoY = 678
    const gap = 12
    const itemW = (w - inset * 2 - gap * 2) / 3
    const tiles = (Array.isArray(this.data.tiles) && this.data.tiles.length === 3)
      ? this.data.tiles
      : [{ label: '出毛次数', value: '0 次' }, { label: '点亮城市', value: '0 个' }, { label: '兽聚场次', value: '0 场' }]
    tiles.forEach((tile, index) => {
      this._infoTile(ctx, inset + (itemW + gap) * index, infoY, itemW, this._truncate(tile.label, 6), this._truncate(tile.value, 8))
    })
    ctx.fillStyle = 'rgba(255,255,255,.70)'; ctx.font = '14px sans-serif'; ctx.textAlign = 'left'
    ctx.fillText(this._truncate(this.data.statText, 30), inset, infoY + 126)

    // 底部扫码区：码只指向小程序首页
    const qrY = 838
    this._roundRect(ctx, inset, qrY, w - inset * 2, 128, 18)
    ctx.fillStyle = '#fff'; ctx.fill()
    if (code) {
      ctx.drawImage(code, inset + 16, qrY + 14, 100, 100)
      ctx.fillStyle = '#1d2926'; ctx.font = 'bold 19px sans-serif'; ctx.textAlign = 'left'
      ctx.fillText('扫码打开出毛日记', inset + 136, qrY + 52)
      ctx.fillStyle = '#71817c'; ctx.font = '14px sans-serif'
      ctx.fillText('记录你的出毛足迹', inset + 136, qrY + 78)
    } else {
      this._roundRect(ctx, inset + 16, qrY + 14, 100, 100, 12); ctx.fillStyle = '#edf1ef'; ctx.fill()
      ctx.fillStyle = '#426356'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('出', inset + 66, qrY + 76)
      ctx.fillStyle = '#1d2926'; ctx.font = 'bold 19px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('在微信内打开出毛日记', inset + 136, qrY + 52)
      ctx.fillStyle = '#71817c'; ctx.font = '14px sans-serif'; ctx.fillText('小程序码正在准备中', inset + 136, qrY + 78)
    }

    ctx.restore()
  },

  /**
   * 把足迹连线画进海报的指定矩形区域：
   * 橙色点 = 个人足迹（按时间连线），青色点 = 参加过的兽聚。
   */
  _drawFootprintMap(ctx, x, y, w, h) {
    const points = this._mapPoints || { path: [], meets: [] }
    const all = points.path.concat(points.meets)

    // 底图：浅色网格 + 圆角矩形，营造"地图"感
    this._roundRect(ctx, x, y, w, h, 18)
    ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill()

    if (!all.length) return

    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
    all.forEach(p => {
      minLat = Math.min(minLat, p.latitude); maxLat = Math.max(maxLat, p.latitude)
      minLng = Math.min(minLng, p.longitude); maxLng = Math.max(maxLng, p.longitude)
    })
    const spanLat = Math.max(maxLat - minLat, 0.02)
    const spanLng = Math.max(maxLng - minLng, 0.02)
    const padX = 30, padY = 26
    const toXY = p => ({
      x: x + padX + ((p.longitude - minLng) / spanLng) * (w - padX * 2),
      y: y + h - padY - ((p.latitude - minLat) / spanLat) * (h - padY * 2)
    })

    // 足迹连线
    if (points.path.length >= 2) {
      ctx.beginPath()
      points.path.forEach((p, index) => {
        const pt = toXY(p)
        if (index === 0) ctx.moveTo(pt.x, pt.y)
        else ctx.lineTo(pt.x, pt.y)
      })
      ctx.strokeStyle = 'rgba(255,255,255,.55)'
      ctx.lineWidth = 2.5
      ctx.setLineDash([6, 6])
      ctx.stroke()
      ctx.setLineDash([])
    }

    // 足迹点
    points.path.forEach(p => {
      const pt = toXY(p)
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2)
      ctx.fillStyle = MARKER_COLOR_FOOTPRINT; ctx.fill()
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke()
    })

    // 兽聚点（更大、青色）
    points.meets.forEach(p => {
      const pt = toXY(p)
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2)
      ctx.fillStyle = MARKER_COLOR_FURMEET; ctx.fill()
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke()
    })
  },

  _infoTile(ctx, x, y, w, label, value) {    this._roundRect(ctx, x, y, w, 92, 14); ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fill()
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

  onShareAppMessage() {
    // 足迹海报的分享路径只指向首页：别人点开是他自己的小程序，不是"我的足迹"。
    if (this.data.type === 'footprint') {
      return { title: '我在出毛日记点亮了出毛足迹，来看看', path: '/pages/discover/discover' }
    }
    const page = this.data.type === 'collection' ? 'route-plan/route-plan' : 'location-detail/location-detail'
    return { title: this.data.title || '发现一处好地点', path: `/pages/${page}?id=${this.data.id}` }
  },
  onShareTimeline() {
    if (this.data.type === 'footprint') {
      return { title: '我在出毛日记点亮了出毛足迹，来看看', query: '' }
    }
    return { title: this.data.title || '发现一处好地点', query: `id=${this.data.id}` }
  }
})
