// 云函数：toggleReaction
// 功能：种草 / 踩雷（每种目标每个用户最多一条反应记录）
//
// 一致性设计：反应关系使用确定性 _id，关系与计数在同一个事务内更新。
// 由于存在「up / down 互相切换」，这里用 doc().set() 覆盖写同一条记录，
// 并按旧状态精确计算两个计数的增减，避免出现负值或重复计数。
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

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext()
  const { targetId, targetType = 'location', reactionType } = event

  if (!openid) return { code: -1, message: '未登录' }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }
  if (!targetId || !['location', 'post'].includes(targetType) || !['up', 'down'].includes(reactionType)) {
    return { code: -1, message: '参数不完整' }
  }

  try {
    const targetCollection = targetType === 'post' ? 'posts' : 'locations'
    const targetRes = await db.collection(targetCollection).doc(targetId).get()
    const target = targetRes.data
    if (!target || target.visibility === 'hidden' || target.moderationStatus === 'hidden') {
      return { code: -1, message: '目标内容不存在或已下架' }
    }
    if (target.visibility === 'circle' && target.creatorOpenId !== openid) {
      return { code: -1, message: '该内容仅作者可见' }
    }

    const reactionId = relationId('reaction', targetType, targetId, openid)

    // reactions 集合可能尚未创建；事务内不能建集合，先自愈再进事务。
    await ensureCollection(db, 'reactions')

    let existing = null
    try {
      const docRes = await db.collection('reactions').doc(reactionId).get()
      existing = docRes.data || null
    } catch (e) {
      existing = null
    }

    const previousType = existing ? existing.reactionType : ''
    // 再次点击同一种反应 = 取消；点击另一种 = 切换。
    const nextType = previousType === reactionType ? '' : reactionType

    const countPatch = {}
    if (previousType) {
      countPatch[previousType === 'up' ? 'reactionUpCount' : 'reactionDownCount'] = _.inc(-1)
    }
    if (nextType) {
      countPatch[nextType === 'up' ? 'reactionUpCount' : 'reactionDownCount'] = _.inc(1)
    }

    await db.runTransaction(async transaction => {
      const targetRef = transaction.collection(targetCollection).doc(targetId)
      if (!nextType) {
        if (existing) await transaction.collection('reactions').doc(reactionId).remove()
      } else {
        await transaction.collection('reactions').doc(reactionId).set({
          data: {
            targetId,
            targetType,
            reactionType: nextType,
            userOpenId: openid,
            createdAt: existing ? (existing.createdAt || db.serverDate()) : db.serverDate(),
            updatedAt: db.serverDate()
          }
        })
      }
      if (Object.keys(countPatch).length) {
        await targetRef.update({ data: countPatch })
      }
    })

    let fresh = {}
    try {
      const freshRes = await db.collection(targetCollection).doc(targetId).get()
      fresh = freshRes.data || {}
    } catch (e) { fresh = target }

    // 仅在「新增种草」时通知作者。
    if (nextType === 'up' && previousType !== 'up' && target.creatorOpenId && target.creatorOpenId !== openid) {
      try {
        // messages 集合可能尚未创建，通知失败会被 catch 吞掉，先自愈一次。
        await ensureCollection(db, 'messages')
        const userRes = await db.collection('users').where({ openId: openid }).limit(1).get()
        const user = userRes.data[0] || {}
        await db.collection('messages').add({ data: {
          toOpenId: target.creatorOpenId, fromOpenId: openid,
          fromName: user.nickname || '用户', fromAvatar: user.avatar || '',
          type: 'reaction', content: '种草了你的内容',
          targetId, targetType, isRead: false, createdAt: db.serverDate()
        } })
      } catch (notifyError) { console.warn('reaction notification failed:', notifyError.message) }
    }

    return {
      code: 0,
      data: {
        reactionUp: nextType === 'up',
        reactionDown: nextType === 'down',
        reactionUpCount: Math.max(0, Number(fresh.reactionUpCount) || 0),
        reactionDownCount: Math.max(0, Number(fresh.reactionDownCount) || 0)
      }
    }
  } catch (err) {
    console.error('toggleReaction 云函数出错:', err)
    if (isDuplicateKeyError(err)) {
      // 并发写入同一反应：关系已存在，回读当前状态返回即可。
      return { code: 0, data: { reactionUp: reactionType === 'up', reactionDown: reactionType === 'down' } }
    }
    return { code: -1, message: '操作失败', error: err.message }
  }
}
