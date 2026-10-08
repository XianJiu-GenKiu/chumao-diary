// 云函数：post-detail
// 功能：获取帖子详情，附带当前用户的点赞/收藏状态
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { postId } = event

  if (!postId) {
    return { code: -1, message: '缺少帖子 ID' }
  }

  try {
    // 获取帖子
    const postRes = await db.collection('posts').doc(postId).get()
    const post = postRes.data

    if (!post) {
      return { code: -1, message: '帖子不存在' }
    }
    // 审核未通过（rejected / pending）的内容只对作者本人可见。
    const isAuthor = !!openid && post.creatorOpenId === openid
    if (post.visibility === 'hidden' || post.moderationStatus === 'hidden') {
      return { code: -1, message: '该动态已下架' }
    }
    // 只有 approved 才公开：rejected / pending / review 一律仅作者本人可见。
    if (post.moderationStatus && post.moderationStatus !== 'approved' && !isAuthor) {
      return { code: -1, message: '该动态正在审核中' }
    }
    if (post.visibility === 'circle' && !isAuthor) {
      return { code: -1, message: '该动态仅圈内可见' }
    }

    // 当前用户是否已点赞
    let isLiked = false
    // 当前用户是否已收藏
    let isFavorited = false
    let reactionUp = false
    let reactionDown = false

    if (openid) {
      // 这三条查询只用于补充「当前用户的互动状态」，任何一条失败
      //（例如 likes / favorites 集合尚未创建）都不应该让整个详情页打不开，
      // 因此逐条降级为空结果。
      const [likeRes, favRes, reactionRes] = await Promise.all([
        db.collection('likes').where({
          targetId: postId,
          targetType: 'post',
          userOpenId: openid
        }).count().catch(() => ({ total: 0 })),
        db.collection('favorites').where({
          targetId: postId,
          targetType: 'post',
          userOpenId: openid
        }).count().catch(() => ({ total: 0 })),
        db.collection('reactions').where({
          targetId: postId,
          targetType: 'post',
          userOpenId: openid
        }).limit(1).get().catch(() => ({ data: [] }))
      ])
      isLiked = likeRes.total > 0
      isFavorited = favRes.total > 0
      const reactionType = reactionRes.data[0] && reactionRes.data[0].reactionType
      reactionUp = reactionType === 'up'
      reactionDown = reactionType === 'down'
    }

    return {
      code: 0,
      data: {
        ...post,
        isLiked,
        isFavorited,
        reactionUp,
        reactionDown,
        reactionUpCount: Number(post.reactionUpCount) || 0,
        reactionDownCount: Number(post.reactionDownCount) || 0,
        likeCount: post.likeCount || 0,
        commentCount: post.commentCount || 0,
        shareCount: post.shareCount || 0
      }
    }
  } catch (err) {
    console.error('post-detail 云函数出错:', err)
    return { code: -1, message: '获取帖子详情失败', error: err.message }
  }
}
