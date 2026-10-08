const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

async function isUserActive(openid) {
  const result = await db.collection('users').where({ openId: openid }).limit(1).get()
  return !result.data.length || result.data[0].status !== 'banned'
}

exports.main = async (event) => {
  const { commentId } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return { code: -1, message: '未登录' }
  }
  if (!await isUserActive(openid)) return { code: -403, message: 'Account is banned' }

  if (!commentId) {
    return { code: -1, message: '缺少评论ID' }
  }

  try {
    const commentRef = db.collection('comments').doc(commentId)
    const commentRes = await commentRef.get()
    const comment = commentRes.data

    if (!comment) {
      return { code: -2, message: '评论不存在' }
    }

    if (comment.visibility === 'hidden' || comment.moderationStatus === 'hidden') {
      return { code: -2, message: 'Comment is unavailable' }
    }

    if (!comment.targetId || !['post', 'location'].includes(comment.targetType)) {
      return { code: -1, message: 'Invalid comment target' }
    }

    const targetCollection = comment.targetType === 'location' ? 'locations' : 'posts'
    const targetResult = await db.collection(targetCollection).doc(comment.targetId).get()
    const target = targetResult.data
    if (!target || target.visibility === 'hidden' || target.moderationStatus === 'hidden') {
      return { code: -2, message: 'Content is unavailable' }
    }
    if (target.visibility === 'circle' && target.creatorOpenId !== openid) {
      return { code: -2, message: 'No permission for this content' }
    }

    const likedBy = comment.likedBy || []
    const isLiked = likedBy.includes(openid)

    // 并发安全：把「当前是否已点赞」的条件下沉到 where，由数据库原子判定，
    // 避免「先 get 判断、再 update 写入」之间的竞态导致同一用户被重复计入。
    // 单文档的 update 是原子的，stats.updated 为 0 表示状态已被另一并发请求改变。
    if (isLiked) {
      // 取消点赞
      const res = await db.collection('comments')
        .where({ _id: commentId, likedBy: openid })
        .update({ data: { likeCount: _.inc(-1), likedBy: _.pull(openid) } })
      if (!res.stats || res.stats.updated === 0) {
        return { code: 0, data: { isLiked: false, likeCount: comment.likeCount || 0 } }
      }
      return { code: 0, data: { isLiked: false, likeCount: (comment.likeCount || 1) - 1 } }
    } else {
      // 点赞：仅当 likedBy 中还不含自己时才写入，天然幂等。
      // 这里用 neq 而非 nin：对数组字段而言 $ne 的语义即为「数组不包含该值」，
      // 且 neq 已在 visibility.js 中使用，保持操作符面最小。
      const res = await db.collection('comments')
        .where({ _id: commentId, likedBy: _.neq(openid) })
        .update({ data: { likeCount: _.inc(1), likedBy: _.push(openid) } })
      if (!res.stats || res.stats.updated === 0) {
        // 另一并发请求已完成点赞，按当前状态返回，不重复计数、不重复发通知。
        return { code: 0, data: { isLiked: true, likeCount: comment.likeCount || 0 } }
      }

      // 发送消息通知评论作者
      if (comment.userOpenId && comment.userOpenId !== openid) {
        try {
          await db.collection('messages').add({
            data: {
              type: 'like',
              toOpenId: comment.userOpenId,
              fromOpenId: openid,
              targetType: comment.targetType || 'comment',
              targetId: commentId,
              targetName: (comment.content || '').slice(0, 30),
              content: '赞了你的评论',
              isRead: false,
              createdAt: db.serverDate()
            }
          })
        } catch (e) {
          console.warn('Failed to send like notification:', e)
        }
      }

      return { code: 0, data: { isLiked: true, likeCount: (comment.likeCount || 0) + 1 } }
    }
  } catch (err) {
    console.error('toggleCommentLike error:', err)
    return { code: -1, message: '操作失败', error: err.message }
  }
}
