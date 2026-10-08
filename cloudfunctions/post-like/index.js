// 云函数：post-like
// 功能：点赞/取消点赞帖子，同步更新帖子 likeCount
//
// 一致性设计：确定性关系 _id + 关系与计数同事务，重复请求幂等。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// throwOnNotFound: false 让 doc.get 在记录不存在时返回空数据而非抛异常。
const db = cloud.database({ throwOnNotFound: false })
const _ = db.command
const { relationId, isDuplicateKeyError } = require('./relationId')
const { ensureCollection } = require('./ensureCollection')

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

  const { postId, action } = event

  if (!postId || !['like', 'unlike'].includes(action)) {
    return { code: -1, message: '参数不完整' }
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

    const likeId = relationId('like', 'post', postId, openid)

    // likes 集合在「第一次点赞」前可能从未创建过，直接进事务会 -502005。
    // createCollection 不能在事务内调用，所以必须在这里提前确保。
    await ensureCollection(db, 'likes')

    let existing = null
    try {
      const docRes = await db.collection('likes').doc(likeId).get()
      existing = docRes.data || null
    } catch (e) {
      existing = null
    }

    const shouldLike = action === 'like'
    const alreadyInDesiredState = (shouldLike && existing) || (!shouldLike && !existing)

    if (!alreadyInDesiredState) {
      await db.runTransaction(async transaction => {
        const postRef = transaction.collection('posts').doc(postId)
        if (shouldLike) {
          await transaction.collection('likes').doc(likeId).set({
            data: {
              targetId: postId,
              targetType: 'post',
              userOpenId: openid,
              createdAt: db.serverDate()
            }
          })
          await postRef.update({ data: { likeCount: _.inc(1) } })
        } else {
          await transaction.collection('likes').doc(likeId).remove()
          await postRef.update({ data: { likeCount: _.inc(-1) } })
        }
      })
    }

    if (shouldLike && !existing && post.creatorOpenId && post.creatorOpenId !== openid) {
      try {
        // messages 集合可能尚未创建，通知失败会被下面的 catch 吞掉，
        // 表现为「点赞成功但作者收不到通知」，先自愈一次。
        await ensureCollection(db, 'messages')
        const userRes = await db.collection('users').where({ openId: openid }).limit(1).get()
        const user = userRes.data[0] || {}
        await db.collection('messages').add({ data: {
          toOpenId: post.creatorOpenId, fromOpenId: openid,
          fromName: user.nickname || '用户', fromAvatar: user.avatar || '',
          type: 'like', content: '点赞了你的动态',
          targetId: postId, targetType: 'post', isRead: false, createdAt: db.serverDate()
        } })
      } catch (notifyError) { console.warn('post like notification failed:', notifyError.message) }
    }

    return { code: 0, data: { liked: shouldLike } }
  } catch (err) {
    console.error('post-like 云函数出错:', err)
    if (isDuplicateKeyError(err)) {
      return { code: 0, data: { liked: action === 'like' } }
    }
    return { code: -1, message: '操作失败', error: err.message }
  }
}
