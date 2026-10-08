const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

// 标签页是公开列表：只有 approved 展示；
// 下架（hidden）与 rejected / pending / review 都不展示。
function isPublic(item) {
  if (!item) return false
  if (item.visibility === 'hidden' || item.moderationStatus === 'hidden') return false
  if (item.moderationStatus && item.moderationStatus !== 'approved') return false
  return !item.visibility || item.visibility === 'public'
}

exports.main = async event => {
  const tag = String(event.tag || '').trim()
  const page = Math.max(1, Number(event.page) || 1)
  const pageSize = Math.min(20, Math.max(1, Number(event.pageSize) || 10))
  if (!tag || tag.length > 10) return { code: -1, message: '标签参数不正确' }
  try {
    const [postsRes, locationsRes] = await Promise.all([
      db.collection('posts').where({ tags: _.all([tag]) }).orderBy('createdAt', 'desc').limit(100).get(),
      page === 1 ? db.collection('locations').where({ tags: _.all([tag]) }).orderBy('createdAt', 'desc').limit(30).get() : Promise.resolve({ data: [] })
    ])
    const publicPosts = postsRes.data.filter(isPublic)
    const skip = (page - 1) * pageSize
    return { code: 0, data: {
      posts: publicPosts.slice(skip, skip + pageSize),
      locations: locationsRes.data.filter(isPublic),
      hasMore: skip + pageSize < publicPosts.length
    } }
  } catch (err) {
    console.error('getTagContent failed:', err)
    return { code: -1, message: '获取标签内容失败', error: err.message }
  }
}
