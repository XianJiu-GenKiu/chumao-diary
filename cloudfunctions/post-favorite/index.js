// 云函数：post-favorite
// 功能：收藏/取消收藏帖子，并维护 posts.favoriteCount
//
// 与 toggleFavorite 使用同一套一致性设计：确定性关系 _id + 事务 + 计数维护。
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

  if (!postId || !['favorite', 'unfavorite'].includes(action)) {
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

    const favoriteId = relationId('fav', 'post', postId, openid)

    // 与 toggleFavorite 同样的自愈：favorites 集合首次被写出前不存在，
    // 事务内的 set()/remove() 会抛 -502005，导致「第一个收藏的人必定失败」。
    await ensureCollection(db, 'favorites')

    let existing = null
    try {
      const docRes = await db.collection('favorites').doc(favoriteId).get()
      existing = docRes.data || null
    } catch (e) {
      existing = null
    }

    const shouldFavorite = action === 'favorite'
    // 目标状态与当前状态一致时直接返回，避免重复写入与计数漂移。
    const alreadyInDesiredState = (shouldFavorite && existing) || (!shouldFavorite && !existing)
    if (!alreadyInDesiredState) {
      await db.runTransaction(async transaction => {
        const postRef = transaction.collection('posts').doc(postId)
        if (shouldFavorite) {
          await transaction.collection('favorites').doc(favoriteId).set({
            data: {
              targetId: postId,
              targetType: 'post',
              userOpenId: openid,
              createdAt: db.serverDate()
            }
          })
          await postRef.update({ data: { favoriteCount: _.inc(1) } })
        } else {
          await transaction.collection('favorites').doc(favoriteId).remove()
          await postRef.update({ data: { favoriteCount: _.inc(-1) } })
        }
      })
    }

    let favoriteCount = Math.max(0, Number(post.favoriteCount) || 0)
    try {
      const freshRes = await db.collection('posts').doc(postId).get()
      favoriteCount = Math.max(0, Number(freshRes.data.favoriteCount) || 0)
    } catch (e) { /* 回读失败时保留估算值 */ }

    // 仅在真正新增收藏时通知作者。
    if (shouldFavorite && !existing && post.creatorOpenId && post.creatorOpenId !== openid) {
      try {
        // messages 集合可能尚未创建，通知失败会被 catch 吞掉，先自愈一次。
        await ensureCollection(db, 'messages')
        const userRes = await db.collection('users').where({ openId: openid }).limit(1).get()
        const user = userRes.data[0] || {}
        await db.collection('messages').add({ data: {
          toOpenId: post.creatorOpenId, fromOpenId: openid,
          fromName: user.nickname || '用户', fromAvatar: user.avatar || '',
          type: 'favorite', content: '收藏了你的动态',
          targetId: postId, targetType: 'post', isRead: false, createdAt: db.serverDate()
        } })
      } catch (notifyError) { console.warn('post favorite notification failed:', notifyError.message) }
    }

    return { code: 0, data: { favorited: shouldFavorite, favoriteCount } }
  } catch (err) {
    console.error('post-favorite 云函数出错:', err)
    if (isDuplicateKeyError(err)) {
      return { code: 0, data: { favorited: action === 'favorite' } }
    }
    return { code: -1, message: '操作失败', error: err.message }
  }
}
