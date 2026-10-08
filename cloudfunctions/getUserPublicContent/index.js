const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// 他人主页只展示公开且审核通过的内容；
// 下架（hidden）与 rejected / pending / review 都不对外展示。
function isPublicContent(item) {
  if (!item) return false
  if (item.visibility === 'hidden' || item.moderationStatus === 'hidden') return false
  if (item.moderationStatus && item.moderationStatus !== 'approved') return false
  return !item.visibility || item.visibility === 'public'
}

async function loadPublicContent(collection, targetOpenId) {
  const result = await db.collection(collection).where({ creatorOpenId: targetOpenId })
    .orderBy('createdAt', 'desc').limit(100).get()
  return result.data.filter(isPublicContent)
}

exports.main = async (event) => {
  const { targetOpenId, page = 1, pageSize = 10 } = event
  const wxContext = cloud.getWXContext()
  const currentOpenId = wxContext.OPENID

  if (!targetOpenId) {
    return { code: -1, message: '缺少目标用户ID' }
  }

  try {
    // 获取目标用户信息
    const userRes = await db.collection('users').where({ openId: targetOpenId }).get()
    const user = userRes.data[0]

    if (!user) {
      return { code: -2, message: '用户不存在' }
    }

    // Only public, non-moderated content is exposed on another user's home.
    // Missing visibility belongs to legacy public records and remains visible.
    const [publicPosts, publicLocations] = await Promise.all([
      loadPublicContent('posts', targetOpenId),
      loadPublicContent('locations', targetOpenId)
    ])

    // 获取关注/粉丝数。follows 集合可能尚未创建，这里逐条降级为 0，
    // 否则整个「用户主页」都会因为一个统计字段而打不开。
    const followingCount = await db.collection('follows')
      .where({ followerOpenId: targetOpenId }).count().catch(() => ({ total: 0 }))
    const followersCount = await db.collection('follows')
      .where({ followingOpenId: targetOpenId }).count().catch(() => ({ total: 0 }))

    // 检查当前用户是否关注了目标用户
    let isFollowing = false
    if (currentOpenId && currentOpenId !== targetOpenId) {
      const followRes = await db.collection('follows').where({
        followerOpenId: currentOpenId,
        followingOpenId: targetOpenId
      }).count().catch(() => ({ total: 0 }))
      isFollowing = followRes.total > 0
    }

    // 获取用户动态
    const skip = (page - 1) * pageSize
    const posts = publicPosts.slice(skip, skip + pageSize)

    // 获取用户地点
    const locations = page === 1 ? publicLocations.slice(0, 6) : []

    return {
      code: 0,
      data: {
        user: {
          openId: targetOpenId,
          nickName: user.nickName || user.nickname || '匿名用户',
          avatar: user.avatar || user.avatarUrl || '',
          bio: user.bio || '',
          fursuitName: user.fursuitName || ''
        },
        stats: {
          postCount: publicPosts.length,
          locationCount: publicLocations.length,
          followingCount: followingCount.total,
          followersCount: followersCount.total
        },
        isFollowing,
        isSelf: currentOpenId === targetOpenId,
        posts,
        locations,
        hasMore: skip + posts.length < publicPosts.length,
        page
      }
    }
  } catch (err) {
    console.error('getUserPublicContent error:', err)
    return { code: -1, message: '获取用户信息失败', error: err.message }
  }
}
