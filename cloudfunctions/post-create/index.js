// 云函数：post-create
// 功能：创建新帖子（动态）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const { checkText, checkImages, describeFailure, resolveModerationStatus, moderationTraceFields, SCENE } = require('./contentSecurity.js')
const { sanitizeAvatar } = require('./mediaUrl.js')

async function isUserActive(openid) {
  const result = await db.collection('users').where({ openId: openid }).limit(1).get()
  return !result.data.length || result.data[0].status !== 'banned'
}

async function notifyMentions(content, senderOpenId, senderName, senderAvatar, postId) {
  const names = [...new Set([...String(content).matchAll(/@([^\s@#，,。.!！?？]{1,20})/g)].map(match => match[1]))]
  if (!names.length) return
  // messages 集合可能尚未创建，通知失败会被调用方的 catch 吞掉，先自愈一次。
  await ensureCollection('messages')
  const usersRes = await db.collection('users').where({ nickname: _.in(names) }).get()
  await Promise.all(usersRes.data.filter(user => user.openId && user.openId !== senderOpenId).map(user =>
    db.collection('messages').add({ data: {
      toOpenId: user.openId, fromOpenId: senderOpenId, fromName: senderName, fromAvatar: senderAvatar,
      type: 'system', content: `${senderName} 提及了你`, targetId: postId, targetType: 'post', isRead: false, createdAt: db.serverDate()
    } })
  ))
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
    content = '', images = [], location = null, locationName = '', mood = '', tags = [],
    equipTags = [], visibility = 'public'
  } = event

  if (typeof content !== 'string' || content.length > 500) {
    return { code: -1, message: '动态文字不能超过 500 个字符' }
  }
  if (!Array.isArray(images) || images.length > 9 || images.some(item => typeof item !== 'string' || !item.startsWith('cloud://'))) {
    return { code: -1, message: '图片数量不能超过 9 张，且必须为已上传的图片' }
  }
  if (!Array.isArray(tags) || tags.length > 5 || tags.some(tag => typeof tag !== 'string' || tag.trim().length > 10)) {
    return { code: -1, message: '标签最多 5 个，每个不超过 10 个字符' }
  }
  if (!Array.isArray(equipTags) || equipTags.length > 8 || equipTags.some(tag => typeof tag !== 'string' || tag.trim().length > 20)) {
    return { code: -1, message: '装备标签格式不正确' }
  }

  // 校验：内容和图片至少有一个
  if (!content.trim() && images.length === 0) {
    return { code: -1, message: '请输入内容或添加图片' }
  }
  // 内容质量控制：纯文字动态至少 5 字
  if (images.length === 0 && content.trim().length < 5) {
    return { code: -1, message: '文字内容太少了，再说点什么吧~' }
  }

  // 首次发布检查资料完善度
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
  // 明确违规 → 拒绝写入；审核服务不可用 → 降级放行（记 approved + degraded，内容可见），
  // 避免因审核接口抖动或权限未配置而让用户完全无法发布。
  const moderationResults = []

  // 1. 文字审核
  if (content.trim()) {
    const textResult = await checkText(content, { openid, scene: SCENE.LOG })
    moderationResults.push(textResult)
    if (textResult.moderationStatus === 'rejected') {
      return {
        code: -3,
        message: describeFailure(textResult, 'text'),
        suggest: textResult.suggest,
        moderationStatus: textResult.moderationStatus
      }
    }
  }

  // 2. 图片审核
  if (images && images.length > 0) {
    const imgResult = await checkImages(images, { openid })
    moderationResults.push(imgResult)
    if (imgResult.moderationStatus === 'rejected') {
      return {
        code: -3,
        message: describeFailure(imgResult, 'image'),
        suggest: imgResult.suggest,
        failedIndex: imgResult.failedIndex,
        moderationStatus: imgResult.moderationStatus
      }
    }
  }

  try {
    await ensureCollection('users')
    await ensureCollection('posts')

    // 获取用户信息（用于帖子中嵌入作者信息）
    let authorName = '毛毛用户'
    let authorAvatar = ''
    const userRes = await db.collection('users').where({ openId: openid }).get()
    if (userRes.data.length > 0) {
      authorName = userRes.data[0].nickname || authorName
      // 防脏数据：临时路径头像不可持久化，落空串由前端回退默认头像。
      authorAvatar = sanitizeAvatar(userRes.data[0].avatar || '')
    }

    const normalizedVisibility = ['public', 'circle'].includes(visibility) ? visibility : 'public'
    const locationId = location && (location._id || location.locationId) ? (location._id || location.locationId) : ''
    let latitude = location && Number.isFinite(Number(location.latitude)) ? Number(location.latitude) : null
    let longitude = location && Number.isFinite(Number(location.longitude)) ? Number(location.longitude) : null

    // 从已有地点发动态时，补齐地点坐标，保证同城/附近动态可以检索。
    if (locationId && (latitude === null || longitude === null)) {
      try {
        const locationRes = await db.collection('locations').doc(locationId).get()
        latitude = Number.isFinite(Number(locationRes.data.latitude)) ? Number(locationRes.data.latitude) : null
        longitude = Number.isFinite(Number(locationRes.data.longitude)) ? Number(locationRes.data.longitude) : null
      } catch (e) {
        console.warn('关联地点不存在或坐标读取失败:', e.message)
      }
    }
    const geoLocation = latitude !== null && longitude !== null
      ? new db.Geo.Point(longitude, latitude)
      : null

    const post = {
      content: content.trim(),
      images: images || [],
      location: location,          // { latitude, longitude } 或 null
      locationId,
      latitude,
      longitude,
      // Geo.Point is indexed by CloudBase and powers exact nearby ranking.
      geoLocation,
      locationName: locationName || '',
      mood: mood || '',
      tags: tags || [],
      equipTags: Array.isArray(equipTags) ? equipTags : [],
      visibility: normalizedVisibility,
      // 审核结果落库：approved 正常公开（含接口不可用时的降级放行）。
      // 降级放行的事实落在 moderationDegraded / moderationDegradeCodes，便于日后补审。
      moderationStatus: resolveModerationStatus(...moderationResults),
      ...moderationTraceFields(...moderationResults),
      // 作者信息（冗余存储方便列表展示）
      creatorOpenId: openid,
      authorName,
      authorAvatar,
      // 计数器
      likeCount: 0,
      reactionUpCount: 0,
      reactionDownCount: 0,
      commentCount: 0,
      shareCount: 0,
      // 时间
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }

    const res = await db.collection('posts').add({ data: post })
    try { await notifyMentions(content, openid, authorName, authorAvatar, res._id) }
    catch (notifyError) { console.warn('mention notification failed:', notifyError.message) }

    return { code: 0, data: { postId: res._id } }
  } catch (err) {
    console.error('post-create 云函数出错:', err)
    return { code: -1, message: '发布失败', error: err.message }
  }
}
