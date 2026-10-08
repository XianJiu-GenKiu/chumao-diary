// 云函数：addLocation
// 功能：添加新的地点标注
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const { checkText, checkImages, describeFailure, resolveModerationStatus, moderationTraceFields, SCENE } = require('./contentSecurity')
const { sanitizeAvatar } = require('./mediaUrl')

async function isUserActive(openid) {
  const result = await db.collection('users').where({ openId: openid }).limit(1).get()
  return !result.data.length || result.data[0].status !== 'banned'
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (err) {
    if (!/exist|exists|already|同名集合|已存在/i.test(err.message || '')) {
      console.warn(`ensure collection ${name} failed:`, err.message)
    }
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return { code: -1, message: '未登录' }
  }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }

  const {
    name = '',
    category = '',
    tags = [],
    description = '',
    images = [],
    latitude = null,
    longitude = null,
    address = '',
    weather = null,
    indoor = false,
    style = '',
    locationKind = 'shooting',
    isServiceLocation = false,
    serviceCategory = '',
    facilities = [],
    rating = 0,
    bestTime = '',
    season = '',
    notice = '',
    visibility = 'public',
    imageVisibility = 'public'
  } = event

  if (typeof name !== 'string' || name.trim().length > 30) {
    return { code: -1, message: '地点名称需为 1-30 个字符' }
  }
  if (!Array.isArray(images) || images.length > 9 || images.some(item => typeof item !== 'string' || !item.startsWith('cloud://'))) {
    return { code: -1, message: '图片数量不能超过 9 张，且必须为已上传的图片' }
  }
  if (!Array.isArray(tags) || tags.length > 5 || tags.some(tag => typeof tag !== 'string' || tag.trim().length > 10)) {
    return { code: -1, message: '标签最多 5 个，每个不超过 10 个字符' }
  }
  if (typeof description !== 'string' || description.length > 500 || typeof notice !== 'string' || notice.length > 300) {
    return { code: -1, message: '描述或注意事项长度超出限制' }
  }
  if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude)) || Number(latitude) < -90 || Number(latitude) > 90 || Number(longitude) < -180 || Number(longitude) > 180) {
    return { code: -1, message: '请在地图中选择有效位置' }
  }

  // 校验必填字段
  if (!name.trim()) {
    return { code: -1, message: '请输入地点名称' }
  }
  if (!category) {
    return { code: -1, message: '请选择地点类别' }
  }
  const normalizedKind = locationKind === 'service' || isServiceLocation ? 'service' : 'shooting'
  const serviceCategories = ['餐饮', '商场', '交通', '补给']
  const normalizedServiceCategory = normalizedKind === 'service' && serviceCategories.includes(serviceCategory) ? serviceCategory : ''
  if (normalizedKind === 'service' && !normalizedServiceCategory) {
    return { code: -1, message: '请选择有效的周边服务分类' }
  }
  if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
    return { code: -1, message: '请在地图上选择有效位置' }
  }

  // —— 内容质量控制 ——
  // 1. 至少需要 1 张图片
  if (!images || images.length === 0) {
    return { code: -1, message: '请至少上传 1 张地点图片' }
  }
  // 2. 描述不少于 10 字
  if (!description || description.trim().length < 10) {
    return { code: -1, message: '请填写至少 10 字的地点描述' }
  }

  // 3. 首次发布检查资料完善度
  const userRes = await db.collection('users').where({ openId: openid }).get()
  const user = userRes.data[0]
  if (user) {
    const hasNickName = (user.nickname || user.nickName || '').trim()
    const hasAvatar = user.avatar || user.avatarUrl
    if (!hasNickName || !hasAvatar) {
      return { code: -4, message: '发布前请先完善昵称和头像', needProfile: true }
    }
  }

  // —— 内容安全审核 ——
  // 明确违规 → 拒绝写入；审核服务不可用 → 降级放行（记 approved + degraded，内容可见）。
  const moderationResults = []

  // 1. 文字审核（名称、描述、注意事项合并检查）
  const combinedText = [name, description, notice, ...(tags || [])].join(' ')
  const textResult = await checkText(combinedText, { openid, scene: SCENE.LOG })
  moderationResults.push(textResult)
  if (textResult.moderationStatus === 'rejected') {
    return { code: -3, message: describeFailure(textResult, 'text'), suggest: textResult.suggest, moderationStatus: textResult.moderationStatus }
  }

  // 2. 图片审核
  if (images && images.length > 0) {
    const imgResult = await checkImages(images, { openid })
    moderationResults.push(imgResult)
    if (imgResult.moderationStatus === 'rejected') {
      return { code: -3, message: describeFailure(imgResult, 'image'), suggest: imgResult.suggest, failedIndex: imgResult.failedIndex, moderationStatus: imgResult.moderationStatus }
    }
  }

  try {
    await ensureCollection('users')
    await ensureCollection('locations')

    // 获取用户信息
    let authorName = '毛毛用户'
    let authorAvatar = ''
    const userRes = await db.collection('users').where({ openId: openid }).get()
    if (userRes.data.length > 0) {
      authorName = userRes.data[0].nickname || authorName
      // 防脏数据：用户头像若为微信选图临时路径（http://tmp/xxx、wxfile:），
      // 一旦冗余进地点就会在线上裂图，这里直接落空串由前端回退默认头像。
      authorAvatar = sanitizeAvatar(userRes.data[0].avatar || '')
    }

    const duplicateRes = await db.collection('locations').where({ name: name.trim() }).limit(20).get()
    const duplicate = duplicateRes.data.find(item => distanceBetween(item.latitude, item.longitude, latitude, longitude) <= 120)
    if (duplicate) return { code: -2, message: '地点已存在', data: { locationId: duplicate._id } }

    const normalizedRating = Math.max(0, Math.min(5, Number(rating) || 0))
    const normalizedVisibility = visibility === 'circle' ? 'circle' : 'public'
    const location = {
      name: name.trim(),
      category,
      tags: tags || [],
      description: description.trim(),
      images: images || [],
      latitude,
      longitude,
      address: address || '',
      weather: weather || null,
      indoor: Boolean(indoor),
      style: style || '',
      locationKind: normalizedKind,
      isServiceLocation: normalizedKind === 'service',
      serviceCategory: normalizedServiceCategory,
      facilities: Array.isArray(facilities) ? facilities : [],
      bestTime: String(bestTime).trim().slice(0, 30),
      season: String(season).trim().slice(0, 30),
      notice: String(notice).trim().slice(0, 300),
      visibility: normalizedVisibility,
      imageVisibility: imageVisibility === 'circle' ? 'circle' : normalizedVisibility,
      // 审核结果落库：approved 正常公开（含接口不可用时的降级放行）。
      // 降级放行的事实落在 moderationDegraded / moderationDegradeCodes，便于日后补审。
      moderationStatus: resolveModerationStatus(...moderationResults),
      ...moderationTraceFields(...moderationResults),
      // 作者信息
      creatorOpenId: openid,
      authorName,
      authorAvatar,
      // 统计
      // 保留上传者的初始评分，后续用户评分只能更新聚合结果，不能覆盖它。
      creatorRating: normalizedRating,
      rating: normalizedRating,
      ratingCount: 0,
      // 计数器必须初始化：收藏 / 签到 / 种草 / 踩雷由各自云函数在事务中递增，
      // 缺少初始值会让 _.inc 之外的读取路径拿到 undefined。
      favoriteCount: 0,
      checkinCount: 0,
      reactionUpCount: 0,
      reactionDownCount: 0,
      commentCount: 0,
      viewCount: 0,
      // 时间
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }

    const res = await db.collection('locations').add({ data: location })

    return { code: 0, data: { locationId: res._id } }
  } catch (err) {
    console.error('addLocation 云函数出错:', err)
    return { code: -1, message: '添加地点失败', error: err.message }
  }
}

function distanceBetween(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every(value => Number.isFinite(Number(value)))) return Infinity
  const rad = Math.PI / 180
  const dLat = (Number(lat2) - Number(lat1)) * rad
  const dLng = (Number(lng2) - Number(lng1)) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(Number(lat1) * rad) * Math.cos(Number(lat2) * rad) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
