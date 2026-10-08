const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { sanitizeAvatar } = require('./mediaUrl')

const db = cloud.database()
const _ = db.command

async function ensureCollection() {
  try {
    await db.createCollection('xiaoju')
  } catch (err) {
    if (!/exist|exists|already|同名集合|已存在/i.test(err.message || '')) console.warn('ensure xiaoju failed:', err.message)
  }
}

async function isUserActive(openid) {
  const result = await db.collection('users').where({ openId: openid }).limit(1).get()
  return !result.data.length || result.data[0].status !== 'banned'
}

function normalizePoints(points) {
  if (!Array.isArray(points)) return []
  return points.slice(0, 30).map((point, index) => ({
    id: String(point.id || `p${index + 1}`),
    name: String(point.name || '').trim().slice(0, 60),
    type: String(point.type || '拍摄').slice(0, 20),
    duration: String(point.duration || '约 1 小时').slice(0, 30),
    note: String(point.note || '').trim().slice(0, 200),
    latitude: Number.isFinite(Number(point.latitude)) ? Number(point.latitude) : null,
    longitude: Number.isFinite(Number(point.longitude)) ? Number(point.longitude) : null
  })).filter(point => point.name)
}

function publicItem(item) {
  if (!item) return null
  return {
    ...item,
    id: item._id,
    cover: item.cover || '/images/empty/empty-post.png',
    points: Array.isArray(item.points) ? item.points : [],
    pointsCount: Array.isArray(item.points) ? item.points.length : 0,
    likes: Number(item.likesCount) || 0,
    saved: false,
    author: item.authorName || '我的路线'
  }
}

exports.main = async event => {
  const openid = cloud.getWXContext().OPENID
  if (!openid) return { code: -1, message: '未登录' }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }

  const action = event.action || 'list'
  try {
    await ensureCollection()

    if (action === 'create') {
      const title = String(event.title || '').trim()
      const summary = String(event.summary || '').trim()
      const points = normalizePoints(event.points)
      const tags = Array.isArray(event.tags) ? event.tags.map(tag => String(tag).trim().slice(0, 20)).filter(Boolean).slice(0, 12) : []
      if (title.length < 1 || title.length > 40) return { code: -1, message: '小聚标题需为 1-40 个字符' }
      if (summary.length < 10 || summary.length > 200) return { code: -1, message: '小聚简介需为 10-200 个字符' }
      if (points.length < 2) return { code: -1, message: '至少需要 2 个路线点位' }
      if (event.cover && (typeof event.cover !== 'string' || !event.cover.startsWith('cloud://'))) return { code: -1, message: '封面图片尚未上传完成' }

      const userRes = await db.collection('users').where({ openId: openid }).limit(1).get()
      const user = userRes.data[0] || {}
      const doc = {
        title,
        summary,
        cover: event.cover || '',
        reason: String(event.reason || '').trim().slice(0, 500),
        notice: String(event.notice || '').trim().slice(0, 300),
        people: String(event.people || '不限').slice(0, 30),
        budget: String(event.budget || '待补充').slice(0, 30),
        tags,
        points,
        duration: String(event.duration || `约 ${Math.max(2, points.length + 1)} 小时`).slice(0, 30),
        ownerOpenId: openid,
        authorName: user.nickname || user.nickName || '我的路线',
        authorAvatar: sanitizeAvatar(user.avatar || user.avatarUrl || ''),
        visibility: event.status === 'private' ? 'private' : 'public',
        canStart: event.canStart !== false,
        likesCount: 0,
        favoriteCount: 0,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
      const result = await db.collection('xiaoju').add({ data: doc })
      return { code: 0, data: { _id: result._id } }
    }

    if (action === 'detail') {
      if (!event.id) return { code: -1, message: '缺少小聚 ID' }
      const result = await db.collection('xiaoju').doc(event.id).get()
      const item = result.data
      if (!item || (item.visibility === 'private' && item.ownerOpenId !== openid)) return { code: -2, message: '小聚不存在或未公开' }
      return { code: 0, data: publicItem(item) }
    }

    if (action === 'list') {
      const page = Math.max(1, Number(event.page) || 1)
      const pageSize = Math.min(30, Math.max(1, Number(event.pageSize) || 10))
      let result = await db.collection('xiaoju').where({ visibility: 'public' }).orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
      return { code: 0, data: result.data.map(publicItem), hasMore: result.data.length === pageSize }
    }

    return { code: -1, message: '不支持的操作' }
  } catch (err) {
    console.error('xiaoju 云函数出错:', err)
    return { code: -1, message: '小聚云端操作失败', error: err.message }
  }
}
