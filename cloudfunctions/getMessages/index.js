// 云函数：getMessages
// 功能：获取当前用户的消息列表（评论、点赞、收藏、系统通知）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

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

  const { type = 'all', markRead = false, markReadIds = [] } = event
  const safePage = Math.max(1, Math.floor(Number(event.page) || 1))
  const safePageSize = Math.min(50, Math.max(1, Math.floor(Number(event.pageSize) || 20)))

  try {
    await ensureCollection('messages')

    if (Array.isArray(markReadIds) && markReadIds.length) {
      const ids = markReadIds.filter(Boolean).slice(0, 50)
      await Promise.all(ids.map(id => db.collection('messages').doc(id).get().then(result => {
        if (result.data && result.data.toOpenId === openid && !result.data.isRead) {
          return db.collection('messages').doc(id).update({ data: { isRead: true, readAt: db.serverDate() } })
        }
      })))
    }

    // 构建查询条件
    let query = { toOpenId: openid }

    if (type === 'like') {
      // The UI groups normal likes and "种草" reactions in one tab.
      query.type = _.in(['like', 'reaction'])
    } else if (type !== 'all') {
      query.type = type
    }

    const skip = (safePage - 1) * safePageSize

    // 获取消息列表
    const res = await db.collection('messages')
      .where(query)
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(safePageSize)
      .get()

    // 获取未读总数
    if (markRead) {
      // Use a collection update so "mark all read" is not limited to one page.
      await db.collection('messages').where({ toOpenId: openid, isRead: false }).update({
        data: { isRead: true, readAt: db.serverDate() }
      })
    }

    const unreadRes = await db.collection('messages')
      .where({ toOpenId: openid, isRead: false })
      .count()

    // 获取各类型未读数
    const types = ['comment', 'like', 'favorite', 'reaction', 'system']
    const unreadByType = {}
    for (const t of types) {
      const countRes = await db.collection('messages')
        .where({ toOpenId: openid, isRead: false, type: t })
        .count()
      unreadByType[t] = countRes.total
    }

    // 标记为已读
    if (markRead && res.data.length > 0) {
      const updatePromises = res.data
        .filter(msg => !msg.isRead)
        .map(msg => db.collection('messages').doc(msg._id).update({
          data: { isRead: true, readAt: db.serverDate() }
        }))
      await Promise.all(updatePromises)
    }

    // 格式化消息
    const messages = res.data.map(msg => ({
      ...msg,
      timeText: formatTime(msg.createdAt)
    }))

    return {
      code: 0,
      data: {
        list: messages,
        total: res.data.length,
        unreadTotal: unreadRes.total,
        unreadByType,
        hasMore: res.data.length === safePageSize
      }
    }
  } catch (err) {
    console.error('getMessages 云函数出错:', err)
    return { code: -1, message: '获取消息失败', error: err.message }
  }
}

function formatTime(createdAt) {
  if (!createdAt) return ''
  const date = new Date(createdAt)
  const now = new Date()
  const diff = now - date
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  return `${m}-${d}`
}
