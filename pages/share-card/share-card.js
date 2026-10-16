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
const { cityLabel } = require('../../config/city-labels.js')
const { meetStats, meetAttendances } = require('../../utils/furmeets.js')
const { PROVINCE_RAMP } = require('../../utils/provinceBadges.js')
const {
  TILE_SIZE,
  NATIONAL_IMAGE_W,
  NATIONAL_IMAGE_H,
  MAP_APPROVAL_NUMBER,
  nationalMapView,
  buildNationalMapRequest,
  buildMapMapping,
  projectToBox,
  buildStops,
  buildArcs
} = require('../../utils/mapView.js')

const FOOTPRINT_STORAGE_KEY = 'fur_footprints_v1'
const MEET_STORAGE_KEY = 'fur_furmeets_v1'

/**
 * 海报画布逻辑尺寸。
 * wxss 里按 662×1051rpx 展示，所以 **1 个画布单位 ≈ 1.05rpx** ——
 * 字号必须按这个比例给，早期写成 13px 的辅助文字实际只有约 13rpx，
 * 远低于项目 24rpx 的下限，在手机上看不清。
 */
const POSTER_W = 630
const POSTER_H = 1000

/**
 * 足迹海报地图卡的尺寸（海报里的展示矩形）。
 *
 * 底图**不按这个尺寸取**：全国版图在 zoom=4（API 下限）下要 840×560 才装得下，
 * 取图尺寸见 utils/mapView.js 的 NATIONAL_IMAGE_*（与这个卡片同比，所以铺进来正好满格）。
 */
const FOOTPRINT_MAP_W = 574
const FOOTPRINT_MAP_H = 384

/**
 * 弧线的时间色阶，直接复用省份徽章那套绿→橙热度色阶：
 * 早 = 浅绿、近 = 品牌橙，全 app 只有一套"进度"配色语言。
 */
const ARC_TIME_RAMP = PROVINCE_RAMP

/**
 * 地图上的地点标签超过这个数量就只标首尾两个，否则小图上会糊成一片。
 */
const MAX_STOP_LABELS = 6

/**
 * 足迹海报配色：跟小程序其余页面同调（米底 + 白卡 + 橙主色），
 * 不再用之前那套不在设计令牌里的墨绿。
 *
 * brandInk 专供浅底上的橙色文字 —— 品牌橙 #D4890E 对白底只有约 3.0:1，
 * 当正文读不够，压深到 #9A5F05 后是 5.2:1。色块/线条仍用 brand。
 */
const POSTER = {
  cream: '#FFFDF8',
  creamDeep: '#FFF1DC',
  card: '#FFFFFF',
  cardBorder: '#EFE3CF',
  gridMinor: '#F4ECDD',
  gridMajor: '#E7DAC2',
  ink: '#1A1A1A',
  inkSoft: '#707070',
  brand: '#D4890E',
  brandInk: '#9A5F05',
  brandTint: '#FFF7E6',
  green: '#5BA81A'
}

/** 两个矩形是否相交（地图上的地名标签靠它避让，省得糊成一坨或压住指北针） */
function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

Page({
  data: {
    type: '',
    id: '',
    isLoading: true,
    canvasWidth: POSTER_W,
    canvasHeight: POSTER_H,
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
  async _loadFootprintData() {
    let records = []
    try {
      const value = wx.getStorageSync(FOOTPRINT_STORAGE_KEY)
      if (Array.isArray(value)) records = value
    } catch (e) { /* 按无记录处理 */ }

    if (!records.length) throw new Error('还没有出毛记录，先去记录一次吧')

    // 兽聚来自用户本机自建（fur_furmeets_v1）；地图针用自定义坐标或城市中心
    let myMeets = []
    try {
      const meetValue = wx.getStorageSync(MEET_STORAGE_KEY)
      if (Array.isArray(meetValue)) myMeets = meetValue
    } catch (e) { /* 按无兽聚处理 */ }
    const CITY_MAP = CITY_CANDIDATES.reduce((acc, c) => {
      acc[c.name] = { latitude: c.lat, longitude: c.lng }
      return acc
    }, {})
    // 场次口径与足迹页共用 utils/furmeets，避免海报数字和页面数字对不上
    const furmeetCount = meetStats(myMeets).furmeetCount
    const meets = myMeets
      .filter(m => Number.isFinite(Number(m && m.latitude)) || CITY_MAP[m && m.city])
      .map(m => {
        const fallback = CITY_MAP[m.city] || {}
        return {
          id: m.id,
          latitude: Number(m.latitude) || fallback.latitude,
          longitude: Number(m.longitude) || fallback.longitude,
          // 场次给海报用：兽聚点的大小也表达"去过几次"
          attendances: meetAttendances(m)
        }
      })

    const places = new Set()
    const cities = new Set()
    const cityCounts = {}
    const days = new Set()
    const path = []

    records.slice()
      .sort((a, b) => (a.visitedAt || 0) - (b.visitedAt || 0))
      .forEach(r => {
        if (r.placeName) places.add(r.placeName)
        if (r.city) {
          cities.add(r.city)
          cityCounts[r.city] = (cityCounts[r.city] || 0) + 1
        }
        if (r.visitedAt) days.add(new Date(r.visitedAt).toDateString())
        const hasCoords = Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
        if (!r.autoMarked && hasCoords) {
          // placeName / visitedAt 给海报地图用：前者用来区分"去过哪些不同地点"，
          // 后者决定弧线的时间色阶（记录已按 visitedAt 升序）
          path.push({
            latitude: r.latitude,
            longitude: r.longitude,
            city: r.city || '',
            placeName: r.placeName || '',
            visitedAt: r.visitedAt || 0
          })
        }
      })

    // 海报上的城市名按到访次数取前 6 个（变体甲：含城市名，不含任何自由文本）
    const topCities = Object.keys(cityCounts)
      .sort((a, b) => cityCounts[b] - cityCounts[a])
      .slice(0, 6)
      .map(cityLabel)

    const userInfo = app.globalData.userInfo || {}
    const nick = userInfo.furName || userInfo.nickName || userInfo.nickname || '毛毛用户'

    // 地图上只给起点和终点城市打标签：图幅有限，标签一多就会互相压住
    const labels = []
    if (path.length) {
      const first = path[0]
      const last = path[path.length - 1]
      if (first.city) labels.push({ text: cityLabel(first.city), latitude: first.latitude, longitude: first.longitude })
      if (path.length > 1 && last.city && last.city !== first.city) {
        labels.push({ text: cityLabel(last.city), latitude: last.latitude, longitude: last.longitude })
      }
    }

    this._mapPoints = { path, meets, labels }

    // 真实底图：取不到就交给绘制层走矢量回退，绝不让整张海报生成失败
    this._staticMapPath = ''
    try {
      this._staticMapPath = await this._loadStaticMap()
    } catch (err) {
      console.warn('静态地图底图不可用，改用矢量地图:', err)
    }

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

  /**
   * 取腾讯静态地图底图，落成本机临时文件后返回路径。
   *
   * 取的是**固定的全国视图**（center/zoom/尺寸都是常量，与用户足迹点无关）：
   * 海报要表达的是「点亮了哪些地方」，一张全国地图才是主角；跟着点集缩放只会
   * 得到某个城市的特写。副作用是底图对所有用户完全一致（将来可直接做缓存）。
   *
   * 走云函数而不是客户端直连：key 不能出现在客户端，小程序 request 也要求域名白名单。
   * 任何失败都返回空串，由绘制层回退到矢量地图 —— 海报必须能生成出来。
   *
   * 两条投递通道（云函数侧按「纯底图」自动选）：
   *   1. data.fileID → 云存储下载。全国底图 840×560 的 base64 有 520KB，
   *      走 callFunction 直接回传有被网关按传输大小拦掉的风险，所以默认走这条；
   *   2. data.src    → base64 落盘（旧通道，也是云存储不可用时的兜底）。
   * 通道 1 下载失败时再带 mode:'base64' 要一次，尽量别让用户看到网格回退。
   */
  async _loadStaticMap() {
    // 只取纯底图：弧线、标记、地名全部由 canvas 自己画（静态图 API 画不出弧线）。
    // 请求用的视图必须原样存下来给绘制层复用 —— 两边各算一次就会和底图错位。
    const request = buildNationalMapRequest()
    this._staticMapView = request
      ? { latitude: request.latitude, longitude: request.longitude, zoom: request.zoom }
      : null
    if (!request) return ''
    const res = await app.callCloud('getMapSnapshot', request)
    if (!res || res.code !== 0 || !res.data) {
      console.warn('getMapSnapshot 未返回图片:', (res && (res.message || res.code)) || '空响应')
      return ''
    }
    if (res.data.fileID) {
      const filePath = await this._downloadCloudFile(res.data.fileID)
      if (filePath) return filePath
      const retry = await app.callCloud('getMapSnapshot', Object.assign({}, request, { mode: 'base64' }))
      if (retry && retry.code === 0 && retry.data && retry.data.src) {
        return this._writeBase64File(retry.data.src)
      }
      return ''
    }
    if (res.data.src) return this._writeBase64File(res.data.src)
    console.warn('getMapSnapshot 返回里既没有 fileID 也没有 src')
    return ''
  },

  /**
   * 云存储 fileID → 本机临时路径。
   * 用 wx.cloud.downloadFile 而不是 getTempFileURL + downloadFile：
   * 前者一次调用直接落成本机文件，少一次网络往返。
   */
  _downloadCloudFile(fileID) {
    return new Promise(resolve => {
      wx.cloud.downloadFile({
        fileID,
        success: res => resolve((res && res.tempFilePath) || ''),
        fail: err => {
          console.warn('地图底图云存储下载失败:', err)
          resolve('')
        }
      })
    })
  },

  /**
   * base64 data URL → 本机临时文件。
   * canvas.createImage() 对 base64 data URL 的支持不可靠，而本机文件路径是确定可用的，
   * 所以先落盘再交给 createImage（同样的写法在 scripts/e2e-profile-save-real.js 里用过）。
   */
  _writeBase64File(dataUrl) {
    return new Promise(resolve => {
      const base64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, '')
      if (!base64) return resolve('')
      const filePath = `${wx.env.USER_DATA_PATH}/footprint-map-${Date.now()}.png`
      wx.getFileSystemManager().writeFile({
        filePath,
        data: base64,
        encoding: 'base64',
        success: () => resolve(filePath),
        fail: err => {
          console.warn('地图底图落盘失败:', err)
          resolve('')
        }
      })
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
      fallback.addColorStop(0, '#3E2F1C'); fallback.addColorStop(1, '#1B140B')
      ctx.fillStyle = fallback; ctx.fillRect(0, 0, w, h)
    }
    const shade = ctx.createLinearGradient(0, 0, 0, h)
    shade.addColorStop(0, 'rgba(26,19,10,.20)')
    shade.addColorStop(.46, 'rgba(24,17,9,.18)')
    shade.addColorStop(.72, 'rgba(24,17,9,.83)')
    shade.addColorStop(1, 'rgba(24,17,9,.97)')
    ctx.fillStyle = shade; ctx.fillRect(0, 0, w, h)
    ctx.restore()

    // 顶部：品牌和城市坐标。字号按「1 画布单位 ≈ 1.05rpx」给，不低于 24rpx 可读下限
    this._pill(ctx, inset, 30, 190, 44, 'rgba(255,255,255,.18)')
    ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(this.data.type === 'collection' ? '出毛日记 · 合集' : '出毛日记 · 地点', inset + 95, 60)
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,.86)'; ctx.font = '24px sans-serif'
    ctx.fillText(this._truncate(this.data.city || '城市探索', 12), w - inset, 60)

    // 中段：地点基本信息。
    const titleY = 490
    ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = 'bold 44px sans-serif'
    const lines = this._wrapText(ctx, this.data.title, w - inset * 2)
    lines.slice(0, 2).forEach((line, index) => ctx.fillText(line, inset, titleY + index * 52))
    const subY = titleY + Math.min(lines.length, 2) * 52 + 10
    ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.font = '28px sans-serif'
    ctx.fillText(`⌖  ${this._truncate(this.data.subtitle, 24)}`, inset, subY)
    this._pill(ctx, inset, subY + 26, 150, 36, 'rgba(228,157,50,.92)')
    ctx.fillStyle = POSTER.ink; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(this._truncate(this.data.category, 6), inset + 75, subY + 50)

    // 信息胶囊：把“拍摄建议”放进分享海报，提升保存和转发价值。
    // 三格内容由 _loadLocationData / _loadCollectionData 程序生成，此处只负责排版。
    const infoY = 694
    const gap = 12
    const itemW = (w - inset * 2 - gap * 2) / 3
    const tiles = (Array.isArray(this.data.tiles) && this.data.tiles.length === 3)
      ? this.data.tiles
      : [{ label: '最佳拍摄', value: '待探索' }, { label: '推荐季节', value: '四季皆宜' }, { label: '所在城市', value: '待补充' }]
    tiles.forEach((tile, index) => {
      this._infoTile(ctx, inset + (itemW + gap) * index, infoY, itemW, this._truncate(tile.label, 5), this._truncate(tile.value, 7))
    })
    ctx.fillStyle = 'rgba(255,255,255,.78)'; ctx.font = '26px sans-serif'; ctx.textAlign = 'left'
    ctx.fillText(this._truncate(this.data.statText, 22), inset, infoY + 134)

    // 底部扫码区；必须留有白底和足够尺寸，保证小程序码识别率。
    const isCollection = this.data.type === 'collection'
    const qrY = 844
    this._roundRect(ctx, inset, qrY, w - inset * 2, 128, 18)
    ctx.fillStyle = '#fff'; ctx.fill()
    if (code) {
      ctx.drawImage(code, inset + 16, qrY + 14, 100, 100)
      ctx.fillStyle = '#1d2926'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'left'
      ctx.fillText(isCollection ? '扫码看完整路线' : '扫码看地点详情', inset + 136, qrY + 56)
      ctx.fillStyle = '#71817c'; ctx.font = '24px sans-serif'
      ctx.fillText(isCollection ? '查看合集全部点位' : '收藏路线，出发去拍', inset + 136, qrY + 92)
    } else {
      this._roundRect(ctx, inset + 16, qrY + 14, 100, 100, 12); ctx.fillStyle = '#edf1ef'; ctx.fill()
      ctx.fillStyle = '#426356'; ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('出', inset + 66, qrY + 82)
      ctx.fillStyle = '#1d2926'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(isCollection ? '在微信内查看路线' : '在微信内打开', inset + 136, qrY + 56)
      ctx.fillStyle = '#71817c'; ctx.font = '24px sans-serif'; ctx.fillText('小程序码正在准备中', inset + 136, qrY + 92)
    }
  },

  /**
   * 足迹成就海报：足迹地图 + 昵称 + 统计数字 + 城市名（全部程序生成）。
   *
   * 排版顺序 = 地图（主角）→ 人 → 数据 → 城市 → 扫码，底色走米白暖调。
   * 字号按「1 画布单位 ≈ 1.05rpx」给：正文 ≥26、辅助 ≥24、标题 44，
   * 保证在手机上不低于项目 24rpx 的可读下限。用户照片绝不进海报。
   */
  async _renderFootprint(ctx, canvas, w, h) {
    const inset = 28
    const code = await this._loadCanvasImage(canvas, this.data.qrCodePath)
    // 静态地图底图；取不到时 _drawFootprintMap 会自己走矢量回退
    const mapImage = await this._loadCanvasImage(canvas, this._staticMapPath)

    this._roundRect(ctx, 0, 0, w, h, 24)
    ctx.save(); ctx.clip()

    const bg = ctx.createLinearGradient(0, 0, 0, h)
    bg.addColorStop(0, POSTER.cream)
    bg.addColorStop(1, POSTER.creamDeep)
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h)

    // ── 顶部品牌行 ──
    this._pill(ctx, inset, 30, 200, 44, POSTER.brand)
    ctx.fillStyle = POSTER.ink; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText('出毛日记 · 足迹', inset + 100, 60)
    ctx.textAlign = 'right'; ctx.fillStyle = POSTER.inkSoft; ctx.font = '24px sans-serif'
    ctx.fillText(this._truncate(this.data.city || '足迹地图', 12), w - inset, 60)

    // ── 地图卡：海报的主角，给它最大面积 ──
    const points = this._mapPoints || { path: [], meets: [], labels: [] }
    // 一个地点一个点（同一地点去多次只留一个，次数决定点的大小）；
    // 相邻地点之间连弧线，弧线颜色按时间先后走绿→橙色阶
    const stops = buildStops(points.path)
    const arcs = buildArcs(stops, ARC_TIME_RAMP, { bow: 0.18, steps: 24 })
    // 底图必须和取图时那份视图配对：弧线是按 view 算像素的，
    // 用另一套取景去铺图会让整张图错位 —— 那种情况宁可老实退回网格。
    // 取不到底图时退到同一个全国视图（nationalMapView），这样两种底图下
    // 可见的经纬范围完全一致，不会出现「有底图看得到、没底图就跑到卡外」。
    const useBaseMap = !!(mapImage && this._staticMapView)
    const view = useBaseMap ? this._staticMapView : nationalMapView()
    // 铺图映射：底图取的是 840×560 的全国窗口，铺进 574×384 的卡片要等比缩小，
    // 覆盖物必须乘同一个缩放，否则点和弧线整片偏掉。
    const mapping = buildMapMapping(view, NATIONAL_IMAGE_W, NATIONAL_IMAGE_H, FOOTPRINT_MAP_W, FOOTPRINT_MAP_H)
    // 地点名：数量不多就全标，多了只标首尾，否则小图上会糊成一片
    // （重叠的还会在 _drawFootprintMap 里被逐个跳过 —— 全国视图下东部城市会挤在一起）
    const stopLabels = stops.length && stops.length <= MAX_STOP_LABELS
      ? stops.map(stop => ({
          text: cityLabel(stop.city) || stop.placeName,
          latitude: stop.latitude,
          longitude: stop.longitude
        }))
      : points.labels

    const mapTop = 96
    this._drawFootprintMap(ctx, inset, mapTop, w - inset * 2, FOOTPRINT_MAP_H, useBaseMap ? mapImage : null, mapping, {
      stops,
      arcs,
      meets: points.meets,
      labels: stopLabels
    })

    // 图例放在卡片外：说明弧线的时间色阶与点的大小含义
    const legendY = mapTop + FOOTPRINT_MAP_H + 36
    let legendX = inset + 6
    ctx.textAlign = 'left'; ctx.fillStyle = POSTER.inkSoft; ctx.font = '24px sans-serif'
    ctx.fillText('早期', legendX, legendY)
    legendX += ctx.measureText('早期').width + 12
    ARC_TIME_RAMP.forEach(color => {
      ctx.beginPath(); ctx.arc(legendX + 8, legendY - 8, 8, 0, Math.PI * 2)
      ctx.fillStyle = color; ctx.fill()
      legendX += 20
    })
    legendX += 4
    ctx.fillStyle = POSTER.inkSoft
    ctx.fillText('近期', legendX, legendY)
    legendX += ctx.measureText('近期').width + 26
    ctx.fillText('点越大去得越多', legendX, legendY)

    // ── 标题区：昵称 + 统计副标题 + 类别（全部程序拼接，非用户自由文本）──
    const titleY = 572
    ctx.textAlign = 'left'; ctx.fillStyle = POSTER.ink; ctx.font = 'bold 44px sans-serif'
    this._wrapText(ctx, this.data.title, w - inset * 2).slice(0, 1)
      .forEach((line, index) => ctx.fillText(line, inset, titleY + index * 52))
    ctx.fillStyle = POSTER.inkSoft; ctx.font = '28px sans-serif'
    ctx.fillText(this._truncate(this.data.subtitle, 26), inset, titleY + 36)

    this._pill(ctx, inset, titleY + 56, 150, 36, POSTER.brandTint)
    ctx.fillStyle = POSTER.brandInk; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(this._truncate(this.data.category, 6), inset + 75, titleY + 80)

    // ── 三格统计：白卡 + 橙色数字 ──
    const infoY = 684
    const gap = 12
    const itemW = (w - inset * 2 - gap * 2) / 3
    const tiles = (Array.isArray(this.data.tiles) && this.data.tiles.length === 3)
      ? this.data.tiles
      : [{ label: '出毛次数', value: '0 次' }, { label: '点亮城市', value: '0 个' }, { label: '兽聚场次', value: '0 场' }]
    tiles.forEach((tile, index) => {
      this._infoTile(ctx, inset + (itemW + gap) * index, infoY, itemW, this._truncate(tile.label, 5), this._truncate(tile.value, 7), true)
    })
    ctx.fillStyle = POSTER.inkSoft; ctx.font = '26px sans-serif'; ctx.textAlign = 'left'
    ctx.fillText(this._truncate(this.data.statText, 22), inset, infoY + 136)

    // ── 底部扫码区：码只指向小程序首页 ──
    const qrY = 844
    this._roundRect(ctx, inset, qrY, w - inset * 2, 128, 18)
    ctx.fillStyle = POSTER.card; ctx.fill()
    ctx.lineWidth = 1.5; ctx.strokeStyle = POSTER.cardBorder
    this._roundRect(ctx, inset, qrY, w - inset * 2, 128, 18); ctx.stroke()
    if (code) {
      ctx.drawImage(code, inset + 16, qrY + 14, 100, 100)
      ctx.fillStyle = POSTER.ink; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'left'
      ctx.fillText('扫码打开出毛日记', inset + 136, qrY + 56)
      ctx.fillStyle = POSTER.inkSoft; ctx.font = '24px sans-serif'
      ctx.fillText('记录你的出毛足迹', inset + 136, qrY + 92)
    } else {
      this._roundRect(ctx, inset + 16, qrY + 14, 100, 100, 12); ctx.fillStyle = POSTER.brandTint; ctx.fill()
      ctx.fillStyle = POSTER.brand; ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('出', inset + 66, qrY + 82)
      ctx.fillStyle = POSTER.ink; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('在微信内打开', inset + 136, qrY + 56)
      ctx.fillStyle = POSTER.inkSoft; ctx.font = '24px sans-serif'; ctx.fillText('小程序码正在准备中', inset + 136, qrY + 92)
    }

    ctx.restore()
  },

  /**
   * 把地图画进海报的指定矩形。
   *
   * 底图两条路径，覆盖物一套逻辑：
   *   1. mapImage 有值 → 铺腾讯静态地图的**全国底图**；
   *   2. mapImage 为空 → 用经纬网格撑住画面。
   * 两种情况下弧线、地点、兽聚、地名全部由 canvas 自己画 —— 静态图 API 的 path
   * 只支持 color / weight、**画不出弧线**，所以覆盖物只能客户端画；顺带让两条路径
   * 的视觉语言完全一致（云函数没部署时也一样能看到弧线）。
   *
   * 坐标一律走 mapping（= 全国视图 + 铺图缩放），不直接用 projectToCanvas：
   * 底图是从 840×560 缩小到卡片上的，漏乘那个缩放，点和弧线会整片往中心挤。
   *
   * 回退分支不是可有可无的：静态图依赖云函数与 key（key 有没有静态图权限未知），
   * 任何一种失败都不能让海报生成失败。
   *
   * 为什么不能直接截小程序原生 map 组件：canvasToTempFilePath 不包含原生组件。
   */
  _drawFootprintMap(ctx, x, y, w, h, mapImage, mapping, overlay) {
    const data = overlay || { stops: [], arcs: [], meets: [], labels: [] }
    const hasPoints = data.stops.length > 0 || data.meets.length > 0
    // 经纬度 → 画布绝对坐标（含卡片偏移与铺图缩放）
    const toCanvas = point => projectToBox(point, mapping, x, y)
    // 全国视图下境外记录会落在地图卡之外：直接跳过，别让它画到海报别处去
    const onCard = pt => !!pt && pt.x >= x - 12 && pt.x <= x + w + 12 && pt.y >= y - 12 && pt.y <= y + h + 12

    // 卡片底：白底 + 暖色描边 + 柔和投影
    ctx.save()
    ctx.shadowColor = 'rgba(150, 118, 62, 0.18)'
    ctx.shadowBlur = 16
    ctx.shadowOffsetY = 5
    this._roundRect(ctx, x, y, w, h, 18)
    ctx.fillStyle = POSTER.card
    ctx.fill()
    ctx.restore()
    ctx.lineWidth = 1.5; ctx.strokeStyle = POSTER.cardBorder
    this._roundRect(ctx, x, y, w, h, 18)
    ctx.stroke()

    // 底图实际铺在卡片上的矩形：底图比卡片大，短边铺满、长边居中多出不到 1px，
    // 由下面的圆角裁剪吃掉。网格回退也按同一个矩形铺，两条路径的经纬范围才一致。
    const drawW = mapping ? mapping.imageWidth * mapping.scale : w
    const drawH = mapping ? mapping.imageHeight * mapping.scale : h
    const drawX = x + (mapping ? mapping.offsetX : 0)
    const drawY = y + (mapping ? mapping.offsetY : 0)

    ctx.save()
    this._roundRect(ctx, x, y, w, h, 18)
    ctx.clip()
    if (mapImage) {
      // ── 真地图底图：弧线与标记由 canvas 自己叠上去（静态图 API 画不出弧线）──
      ctx.drawImage(mapImage, drawX, drawY, drawW, drawH)
      // 极淡暖纱：把腾讯底图偏冷的色调拉向海报的米白暖调
      ctx.fillStyle = 'rgba(255, 243, 224, 0.12)'
      ctx.fillRect(x, y, w, h)
    } else {
      // ── 回退：经纬网格撑住画面。点和弧线照样画，两种底图下视觉语言保持一致 ──
      const gridStep = 24
      let gridIndex = 0
      for (let gx = drawX; gx <= drawX + drawW; gx += gridStep, gridIndex++) {
        ctx.beginPath(); ctx.moveTo(gx, drawY); ctx.lineTo(gx, drawY + drawH)
        ctx.strokeStyle = gridIndex % 4 === 2 ? POSTER.gridMajor : POSTER.gridMinor
        ctx.lineWidth = 1; ctx.stroke()
      }
      gridIndex = 0
      for (let gy = drawY; gy <= drawY + drawH; gy += gridStep, gridIndex++) {
        ctx.beginPath(); ctx.moveTo(drawX, gy); ctx.lineTo(drawX + drawW, gy)
        ctx.strokeStyle = gridIndex % 4 === 2 ? POSTER.gridMajor : POSTER.gridMinor
        ctx.lineWidth = 1; ctx.stroke()
      }
    }
    ctx.restore()

    // 地图审图号：《地图管理条例》要求公开展示的地图标注审图号，而腾讯静态图底图
    // 不自带，必须由展示者叠加。编号在 utils/mapView.js 的 MAP_APPROVAL_NUMBER 配置，
    // 留空则不画。画在裁剪区之外、卡片左下角，只在使用真底图时出现（矢量网格不算地图）。
    if (mapImage && MAP_APPROVAL_NUMBER) {
      ctx.save()
      ctx.fillStyle = 'rgba(90, 78, 58, 0.6)'
      ctx.font = '20px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(MAP_APPROVAL_NUMBER, x + 14, y + h - 12)
      ctx.restore()
    }

    if (!hasPoints || !mapping) {
      ctx.fillStyle = POSTER.inkSoft; ctx.font = '26px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('还没有带坐标的出毛记录', x + w / 2, y + h / 2)
      return
    }

    // 覆盖物一律裁在卡片内：全国视图下点可能落在卡外，不裁就会画到海报的标题区上
    ctx.save()
    this._roundRect(ctx, x, y, w, h, 18)
    ctx.clip()

    // ── 弧线：相邻两个地点之间，颜色按时间从浅绿到品牌橙 ──
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    data.arcs.forEach(arc => {
      const traceArc = () => {
        ctx.beginPath()
        let started = false
        arc.path.forEach(point => {
          const pt = toCanvas(point)
          if (!pt) return
          if (started) ctx.lineTo(pt.x, pt.y)
          else { ctx.moveTo(pt.x, pt.y); started = true }
        })
        return started
      }
      // 白色粗描边打底：弧线要压在真实底图的道路与地名上，不垫一层会看不清
      if (traceArc()) { ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)'; ctx.lineWidth = 7; ctx.stroke() }
      if (traceArc()) { ctx.strokeStyle = arc.color; ctx.lineWidth = 3.5; ctx.stroke() }
    })

    // ── 地点：一个地点一个点，去得越多点越大（用大小表达频率）──
    data.stops.forEach(stop => {
      const pt = toCanvas(stop)
      if (!onCard(pt)) return
      const radius = 6 + Math.min(4, Math.max(0, stop.visits - 1)) * 1.6
      ctx.beginPath(); ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = POSTER.brand; ctx.fill()
      ctx.lineWidth = 3; ctx.strokeStyle = '#FFFFFF'; ctx.stroke()
    })

    // ── 兽聚：绿色点，去得越多也越大 ──
    data.meets.forEach(meet => {
      const pt = toCanvas(meet)
      if (!onCard(pt)) return
      const visits = Math.max(1, Number(meet.attendances) || 1)
      const radius = 7 + Math.min(4, visits - 1) * 1.6
      ctx.beginPath(); ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = POSTER.green; ctx.fill()
      ctx.lineWidth = 3; ctx.strokeStyle = '#FFFFFF'; ctx.stroke()
    })

    // 只有一个地点时补两圈脉冲，否则图正中孤零零一个点很像画错了
    if (data.stops.length === 1 && !data.meets.length) {
      const pt = toCanvas(data.stops[0])
      if (onCard(pt)) {
        ;[22, 34].forEach(radius => {
          ctx.beginPath(); ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(212, 137, 14, 0.32)'; ctx.lineWidth = 2; ctx.stroke()
        })
      }
    }

    // ── 地点名：白底胶囊，压在底图和弧线之上才读得清 ──
    // 全国视图下城市会挤成一团（上海/杭州/苏州相距不到 20px），所以按顺序摆：
    // 先试点的上方，压住了就改摆下方，两边都占就跳过 —— 宁可少标一个，也不要糊成一坨。
    // 图例与指北针先占位：东北城市（哈尔滨一带）正好落在指北针那一角。
    ctx.font = '24px sans-serif'; ctx.textAlign = 'left'
    const legendItems = [
      { color: POSTER.brand, text: '足迹' },
      { color: POSTER.green, text: '兽聚' }
    ]
    const legendW = legendItems.reduce((sum, item) => sum + 34 + ctx.measureText(item.text).width, 0) + 24
    const legendBox = { left: x + 12, top: y + 12, right: x + 12 + legendW, bottom: y + 58 }
    const compassBox = { left: x + w - 76, top: y + 18, right: x + w - 16, bottom: y + 78 }
    const blocked = [legendBox, compassBox]

    ctx.font = 'bold 24px sans-serif'
    ;(data.labels || []).forEach(label => {
      if (!label || !label.text) return
      const pt = toCanvas(label)
      if (!onCard(pt)) return
      const pillW = ctx.measureText(label.text).width + 24
      // 横向也要夹在卡片内：4 字城市名的胶囊半宽能超过留白，贴边的点会把标签甩出卡外
      const pillX = Math.max(x + 4, Math.min(pt.x - pillW / 2, x + w - pillW - 4))
      const box = [pt.y - 48, pt.y + 20]
        .map(top => Math.max(y + 6, Math.min(top, y + h - 40)))
        .map(top => ({ left: pillX, top, right: pillX + pillW, bottom: top + 34 }))
        .find(candidate => !blocked.some(prev => rectsOverlap(candidate, prev)))
      if (!box) return
      blocked.push(box)
      this._roundRect(ctx, pillX, box.top, pillW, 34, 17)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'; ctx.fill()
      ctx.lineWidth = 1.5; ctx.strokeStyle = POSTER.cardBorder; ctx.stroke()
      ctx.fillStyle = POSTER.ink; ctx.textAlign = 'center'
      ctx.fillText(label.text, pillX + pillW / 2, box.top + 24)
    })

    ctx.restore()

    // ── 卡内左上角图例：点的颜色代表什么（白底胶囊，压在任何底图上都读得清）──
    ctx.font = '24px sans-serif'; ctx.textAlign = 'left'
    this._roundRect(ctx, legendBox.left, legendBox.top, legendW, 46, 23)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'; ctx.fill()
    let legendX = x + 12 + 16
    legendItems.forEach(item => {
      ctx.beginPath(); ctx.arc(legendX + 7, y + 35, 7, 0, Math.PI * 2)
      ctx.fillStyle = item.color; ctx.fill()
      ctx.fillStyle = POSTER.inkSoft
      ctx.fillText(item.text, legendX + 20, y + 43)
      legendX += 34 + ctx.measureText(item.text).width
    })

    this._drawCompass(ctx, x + w - 46, y + 48)

    // ── 比例尺：按视图缩放反推一个整齐的公里数 ──
    // 每像素多少公里 = 1 经度多少公里 ÷ 1 经度多少像素；
    // 1 经度 ≈ 111.32×cos(纬度) km，1 经度 = TILE_SIZE×2^zoom/360 像素。
    // 注意要再 ÷ 铺图缩放：尺子是画在卡片上的，量的是**卡片像素**，
    // 底图缩小过，一卡片像素对应的实际距离比一底图像素更大。
    const worldSize = TILE_SIZE * Math.pow(2, mapping.view.zoom)
    const kmPerLngDegree = 111.32 * Math.cos(mapping.view.latitude * Math.PI / 180)
    const kmPerPx = kmPerLngDegree / (worldSize / 360) / mapping.scale
    // 从大到小找第一个塞得下的：这样尺子尽量长、读数尽量整（从小到大找会永远停在 10 km，
    // 全国视图下就成了一根 1px 的尺子）
    const target = [2000, 1000, 500, 200, 100, 50, 20, 10].find(km => km / kmPerPx <= w * 0.42)
    if (target) {
      const barW = target / kmPerPx
      const bx = x + 18
      const by = y + h - 22
      ctx.beginPath()
      ctx.moveTo(bx, by); ctx.lineTo(bx + barW, by)
      ctx.moveTo(bx, by - 6); ctx.lineTo(bx, by + 6)
      ctx.moveTo(bx + barW, by - 6); ctx.lineTo(bx + barW, by + 6)
      ctx.strokeStyle = POSTER.inkSoft; ctx.lineWidth = 2; ctx.stroke()
      // 公里数写在尺子右侧同一基线上
      ctx.fillStyle = POSTER.inkSoft; ctx.font = '24px sans-serif'; ctx.textAlign = 'left'
      ctx.fillText(`${target} km`, bx + barW + 12, by + 8)
    }
  },

  /** 指北针：小图里最能"点题"的地图元素，真底图与矢量回退都用它 */
  _drawCompass(ctx, cx, cy) {
    ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'; ctx.fill()
    ctx.lineWidth = 1.5; ctx.strokeStyle = POSTER.cardBorder; ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx, cy - 16); ctx.lineTo(cx + 8, cy + 4); ctx.lineTo(cx, cy - 1); ctx.lineTo(cx - 8, cy + 4)
    ctx.closePath(); ctx.fillStyle = POSTER.brand; ctx.fill()
    ctx.fillStyle = POSTER.ink; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText('N', cx, cy + 26)
  },

  /** 三格信息块。light=true 走足迹海报的浅色主题（白卡 + 橙色数字） */
  _infoTile(ctx, x, y, w, label, value, light) {
    this._roundRect(ctx, x, y, w, 104, 14)
    ctx.fillStyle = light ? POSTER.card : 'rgba(255,255,255,.16)'
    ctx.fill()
    if (light) {
      ctx.lineWidth = 1.5; ctx.strokeStyle = POSTER.cardBorder
      this._roundRect(ctx, x, y, w, 104, 14); ctx.stroke()
    }
    ctx.fillStyle = light ? POSTER.inkSoft : 'rgba(255,255,255,.78)'
    ctx.font = '24px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, x + w / 2, y + 42)
    ctx.fillStyle = light ? POSTER.brandInk : '#fff'
    ctx.font = 'bold 34px sans-serif'; ctx.fillText(value, x + w / 2, y + 86)
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
