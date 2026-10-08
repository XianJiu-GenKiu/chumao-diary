// 云函数：comment-create
// 功能：创建评论 / 回复评论，并更新 commentCount
// 支持 targetId+targetType（统一格式）和向后兼容 postId
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// throwOnNotFound: false 让 doc.get 在记录不存在时返回空数据而非抛异常，
// 这对事务内的读取尤其重要（异常会直接导致事务回滚）。
const db = cloud.database({ throwOnNotFound: false })
const _ = db.command
const { checkText, describeFailure, moderationTraceFields, SCENE } = require('./contentSecurity')
const { sanitizeAvatar } = require('./mediaUrl')
const { relationId } = require('./relationId')
const { ensureCollection } = require('./ensureCollection')

async function isUserActive(openid) {
  const result = await db.collection('users').where({ openId: openid }).limit(1).get()
  return !result.data.length || result.data[0].status !== 'banned'
}

async function notifyMentions(content, senderOpenId, senderName, senderAvatar, targetId, targetType) {
  const names = [...new Set([...String(content).matchAll(/@([^\s@#，,。.!！?？]{1,20})/g)].map(match => match[1]))]
  if (!names.length) return
  const usersRes = await db.collection('users').where({ nickname: _.in(names) }).get()
  await Promise.all(usersRes.data.filter(user => user.openId && user.openId !== senderOpenId).map(user =>
    db.collection('messages').add({ data: {
      toOpenId: user.openId, fromOpenId: senderOpenId, fromName: senderName, fromAvatar: senderAvatar,
      type: 'system', content: `${senderName} 提及了你`, targetId, targetType, isRead: false, createdAt: db.serverDate()
    } })
  ))
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return { code: -1, message: '未登录' }
  }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }

  // 兼容 targetId + targetType（新格式）和 postId（旧格式）
  const targetId = event.targetId || event.postId
  const targetType = event.targetType || 'post'
  const { content, replyTo = null } = event
  // 客户端提交标识：同一次提交重试（弱网重发、连点）只会落一条评论。
  const requestId = String(event.requestId || '').slice(0, 64)
  if (!['post', 'location'].includes(targetType)) {
    return { code: -1, message: '不支持的内容类型' }
  }
  if (content && content.trim().length > 500) {
    return { code: -1, message: '评论内容不能超过 500 字' }
  }

  if (!targetId || !content || !content.trim()) {
    return { code: -1, message: '参数不完整' }
  }

  // —— 内容安全审核 ——
  // 明确违规 → 拒绝；审核服务不可用 → 降级放行（记 approved + degraded，内容可见）。
  const textResult = await checkText(content, { openid, scene: SCENE.COMMENT })
  if (textResult.moderationStatus === 'rejected') {
    return {
      code: -3,
      message: describeFailure(textResult, 'text'),
      suggest: textResult.suggest,
      moderationStatus: textResult.moderationStatus
    }
  }
  // 审核不可用时降级放行：评论按已过审落库，保证他人可见（不再复用 pending）。
  const commentModerationStatus = textResult.moderationStatus === 'pending' ? 'pending' : 'approved'

  try {
    // 验证目标内容是否存在
    const targetCollection = targetType === 'post' ? 'posts' : 'locations'
    let target
    try {
      const targetRes = await db.collection(targetCollection).doc(targetId).get()
      target = targetRes.data
    } catch (e) {
      return { code: -1, message: '目标内容不存在或已删除' }
    }
    if (!target || target.visibility === 'hidden' || target.moderationStatus === 'hidden') {
      return { code: -1, message: '目标内容已下架，暂不能评论' }
    }
    if (target.visibility === 'circle' && target.creatorOpenId !== openid) {
      return { code: -1, message: '该内容仅作者可见，暂不能评论' }
    }

    // comments 集合由本函数首次写出（全项目唯一写入方）。集合不存在时，
    // 事务内的 add()/set() 会抛 -502005，表现为「第一条评论必定失败」。
    // createCollection 不能在事务内调用，必须在这里提前自愈。
    await ensureCollection(db, 'comments')

    // 获取用户信息
    let authorName = '毛毛用户'
    if (replyTo) {
      const parentRes = await db.collection('comments').doc(replyTo).get()
      const parent = parentRes.data
      if (!parent || parent.targetId !== targetId || parent.targetType !== targetType) {
        return { code: -1, message: '回复目标不存在或不属于当前内容' }
      }
    }
    let authorAvatar = ''
    const userRes = await db.collection('users').where({ openId: openid }).get()
    if (userRes.data.length > 0) {
      authorName = userRes.data[0].nickname || authorName
      // 防脏数据：临时路径头像不可持久化，落空串由前端回退默认头像。
      authorAvatar = sanitizeAvatar(userRes.data[0].avatar || '')
    }

  const comment = {
      targetId,
      targetType,
      content: content.trim(),
      parentId: replyTo || null,
      userOpenId: openid,
      authorName,
      authorAvatar,
      likeCount: 0,
      // 审核状态落库：approved 正常展示（含降级放行）。
      // 降级放行的事实落在 moderationDegraded / moderationDegradeCodes，便于日后补审。
      moderationStatus: commentModerationStatus,
      ...moderationTraceFields(textResult),
      createdAt: db.serverDate()
    }

    // 写入评论并把 commentCount 递增放在同一事务中，避免「评论写了但计数没变」。
    // 传入 requestId 时使用确定性 _id，重复提交会命中同一条记录而不是新增。
    const commentId = requestId
      ? relationId('comment', openid, targetType, targetId, requestId)
      : null

    // 幂等检查放在事务外：事务内的读取异常会导致整个事务回滚，
    // 因此先在外面判断「同 requestId 的评论是否已存在」。
    let alreadyCommented = false
    if (commentId) {
      try {
        const existingRes = await db.collection('comments').doc(commentId).get()
        alreadyCommented = !!(existingRes && existingRes.data)
      } catch (e) {
        alreadyCommented = false
      }
    }

    let res
    if (alreadyCommented) {
      // 同一次提交重试：直接复用已有评论，不重复写入也不重复计数。
      res = { _id: commentId }
    } else {
      await db.runTransaction(async transaction => {
        const commentsRef = transaction.collection('comments')
        const targetRef = transaction.collection(targetType === 'post' ? 'posts' : 'locations').doc(targetId)
        if (commentId) {
          await commentsRef.doc(commentId).set({ data: comment })
          res = { _id: commentId }
        } else {
          res = await commentsRef.add({ data: comment })
        }
        await targetRef.update({ data: { commentCount: _.inc(1) } })
      })
    }

    if (target && target.creatorOpenId && target.creatorOpenId !== openid) {
      try {
        // messages 集合可能尚未创建，通知失败会被 catch 吞掉，
        // 表现为「评论成功但作者收不到通知」，先自愈一次。
        await ensureCollection(db, 'messages')
        await db.collection('messages').add({ data: {
          toOpenId: target.creatorOpenId,
          fromOpenId: openid,
          fromName: authorName,
          fromAvatar: authorAvatar,
          type: 'comment',
          content: content.trim().slice(0, 100),
          targetId,
          targetType,
          isRead: false,
          createdAt: db.serverDate()
        } })
      } catch (notifyError) { console.warn('comment notification failed:', notifyError.message) }
    }
    try { await notifyMentions(content, openid, authorName, authorAvatar, targetId, targetType) }
    catch (notifyError) { console.warn('mention notification failed:', notifyError.message) }

    return { code: 0, data: { commentId: res._id } }
  } catch (err) {
    console.error('comment-create 云函数出错:', err)
    return { code: -1, message: '评论失败', error: err.message }
  }
}
