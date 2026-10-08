// 云函数：deleteContent
// 功能：删除已发布的地点或动态（仅创建者可操作）
// 同时清理关联的评论数据
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

async function isUserActive(openid) {
  const result = await db.collection('users').where({ openId: openid }).limit(1).get()
  return !result.data.length || result.data[0].status !== 'banned'
}

async function removeMatching(collection, where) {
  const limit = 100
  while (true) {
    const result = await db.collection(collection).where(where).limit(limit).get()
    if (!result.data.length) return
    await Promise.all(result.data.map(item => db.collection(collection).doc(item._id).remove()))
    if (result.data.length < limit) return
  }
}

async function updateMatching(collection, where, data) {
  const limit = 100
  while (true) {
    const result = await db.collection(collection).where(where).limit(limit).get()
    if (!result.data.length) return
    await Promise.all(result.data.map(item => db.collection(collection).doc(item._id).update({ data })))
    if (result.data.length < limit) return
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return { code: -1, message: '未登录' }
  }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }

  const { contentType, contentId } = event

  if (!contentType || !contentId) {
    return { code: -1, message: '参数不完整' }
  }

  if (!['location', 'post'].includes(contentType)) {
    return { code: -1, message: '不支持的内容类型' }
  }

  const collectionName = contentType === 'location' ? 'locations' : 'posts'

  try {
    // 权限校验：只有创建者可以删除
    const docRes = await db.collection(collectionName).doc(contentId).get()
    const doc = docRes.data

    if (!doc) {
      return { code: -1, message: '内容不存在或已被删除' }
    }

    if (doc.creatorOpenId !== openid) {
      return { code: -2, message: '无权删除他人内容' }
    }

    // 删除关联的评论
    try {
      // CloudBase defaults to 20 records; raise the batch size to avoid leaving
      // comments behind for normal high-activity content.
      const commentsRes = await db.collection('comments').where({ targetId: contentId }).limit(100).get()
      const deletePromises = commentsRes.data.map(comment =>
        db.collection('comments').doc(comment._id).remove()
      )
      await Promise.all(deletePromises)
    } catch (e) {
      console.warn('清理评论失败（非致命）:', e.message)
    }

    // 如果是地点，删除关联动态中的 locationId 引用（不删动态本身）
    if (contentType === 'location') {
      try {
        const postsRes = await db.collection('posts').where({ locationId: contentId }).limit(100).get()
        const updatePromises = postsRes.data.map(post =>
          db.collection('posts').doc(post._id).update({
            data: { locationId: '', locationName: '（地点已删除）' }
          })
        )
        await Promise.all(updatePromises)
      } catch (e) {
        console.warn('清理关联动态引用失败（非致命）:', e.message)
      }
    }

    // 删除云存储中的图片
    if (doc.images && doc.images.length > 0) {
      try {
        const deleteFilePromises = doc.images.map(fileID =>
          cloud.deleteFile({ fileList: [fileID] })
        )
        await Promise.all(deleteFilePromises)
      } catch (e) {
        console.warn('删除图片文件失败（非致命）:', e.message)
      }
    }

    // 删除文档本身
    if (contentType === 'location') {
      try {
        await updateMatching('posts', { locationId: contentId }, {
          locationId: '', location: null, locationName: ''
        })
      } catch (cleanupError) { console.warn('cleanup location references failed:', cleanupError.message) }
    }

    // Clear every dependent document before removing the parent.  This handles
    // content with more than the CloudBase default query page size.
    const dependentCollections = ['comments', 'likes', 'favorites', 'reactions', 'reports', 'messages']
    for (const collection of dependentCollections) {
      try { await removeMatching(collection, { targetId: contentId }) }
      catch (cleanupError) { console.warn(`cleanup ${collection} failed:`, cleanupError.message) }
    }
    if (contentType === 'location') {
      try { await removeMatching('ratings', { locationId: contentId }) }
      catch (cleanupError) { console.warn('cleanup ratings failed:', cleanupError.message) }
    }
    await db.collection(collectionName).doc(contentId).remove()

    return { code: 0, message: '删除成功' }
  } catch (err) {
    console.error('deleteContent 云函数出错:', err)
    return { code: -1, message: '删除失败', error: err.message }
  }
}
