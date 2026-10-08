// 云函数：toggleLike
// 功能：切换帖子的点赞状态（已赞则取消，未赞则点赞），同步更新 likeCount
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

async function isUserActive(openid) {
  const result = await db.collection('users').where({ openId: openid }).limit(1).get()
  return !result.data.length || result.data[0].status !== 'banned'
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return { code: -1, message: '未登录' }
  }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }

  const { postId } = event

  if (!postId) {
    return { code: -1, message: '缺少帖子 ID' }
  }

  try {
    const postRes = await db.collection('posts').doc(postId).get()
    const post = postRes.data
    if (!post || post.visibility === 'hidden' || post.moderationStatus === 'hidden') {
      return { code: -1, message: '帖子不存在或已下架' }
    }
    if (post.visibility === 'circle' && post.creatorOpenId !== openid) {
      return { code: -1, message: '该动态仅作者可见' }
    }
    // 查询是否已点赞
    const likeRes = await db.collection('likes').where({
      targetId: postId,
      targetType: 'post',
      userOpenId: openid
    }).get().catch(() => ({ data: [] }))

    const hasLiked = likeRes.data.length > 0

    if (hasLiked) {
      // 取消点赞
      await db.collection('likes').doc(likeRes.data[0]._id).remove()
      await db.collection('posts').doc(postId).update({
        data: { likeCount: _.inc(-1) }
      })
      return { code: 0, data: { liked: false } }
    } else {
      // 点赞
      await db.collection('likes').add({
        data: {
          targetId: postId,
          targetType: 'post',
          userOpenId: openid,
          createdAt: db.serverDate()
        }
      })
      await db.collection('posts').doc(postId).update({
        data: { likeCount: _.inc(1) }
      })
      return { code: 0, data: { liked: true } }
    }
  } catch (err) {
    console.error('toggleLike 云函数出错:', err)
    return { code: -1, message: '操作失败', error: err.message }
  }
}
