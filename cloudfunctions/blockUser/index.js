// 云函数：blockUser
// 拉黑（屏蔽）用户 —— UGC 规范要求的「举报 + 删除 + 拉黑」三项中的第三项。
//
// action:
//   block     拉黑某用户（幂等），同时解除双方关注关系
//   unblock   取消拉黑
//   status    查询是否已拉黑该用户
//   list      列出我拉黑的用户（附昵称与头像，供黑名单页展示）
//
// 数据落在 blocks 集合，_id 用确定性关系 ID，重复点击不会产生重复记录。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const { relationId, isDuplicateKeyError } = require('./relationId')
const { ensureCollection } = require('./ensureCollection')
const { COLLECTION, getBlockedIds } = require('./blocked')

/** 展示名优先级：兽名 > 微信昵称 > 兜底。 */
function displayName(user) {
  if (!user) return '用户'
  return user.furName || user.nickname || '用户'
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext()
  if (!openid) return { code: -1, message: '未登录' }

  const action = event.action || 'list'
  const targetOpenId = String(event.targetOpenId || '').trim()

  // ── 拉黑 ──
  if (action === 'block') {
    if (!targetOpenId) return { code: -1, message: '缺少目标用户' }
    if (targetOpenId === openid) return { code: -1, message: '不能屏蔽自己' }

    try {
      await ensureCollection(db, COLLECTION)
      const _id = relationId('block', openid, targetOpenId)
      try {
        await db.collection(COLLECTION).add({
          data: {
            _id,
            blockerOpenId: openid,
            blockedOpenId: targetOpenId,
            createdAt: db.serverDate()
          }
        })
      } catch (err) {
        // 已在黑名单里：视为成功，保证重复点击幂等。
        if (!isDuplicateKeyError(err)) throw err
      }

      // 同时解除双方关注关系，避免出现「已拉黑但还在关注列表里」的矛盾状态。
      // follows 集合可能不存在，失败不影响拉黑本身。
      await Promise.all([
        db.collection('follows').where({ followerOpenId: openid, followingOpenId: targetOpenId }).remove().catch(() => null),
        db.collection('follows').where({ followerOpenId: targetOpenId, followingOpenId: openid }).remove().catch(() => null)
      ])

      return { code: 0, data: { blocked: true } }
    } catch (err) {
      console.error('拉黑失败:', err)
      return { code: -1, message: '操作失败，请重试' }
    }
  }

  // ── 取消拉黑 ──
  if (action === 'unblock') {
    if (!targetOpenId) return { code: -1, message: '缺少目标用户' }
    try {
      await db.collection(COLLECTION)
        .where({ blockerOpenId: openid, blockedOpenId: targetOpenId })
        .remove()
      return { code: 0, data: { blocked: false } }
    } catch (err) {
      console.error('取消拉黑失败:', err)
      return { code: -1, message: '操作失败，请重试' }
    }
  }

  // ── 查询状态 ──
  if (action === 'status') {
    if (!targetOpenId) return { code: -1, message: '缺少目标用户' }
    const ids = await getBlockedIds(db, openid)
    return { code: 0, data: { blocked: ids.indexOf(targetOpenId) !== -1 } }
  }

  // ── 黑名单列表 ──
  if (action === 'list') {
    const ids = await getBlockedIds(db, openid)
    if (!ids.length) return { code: 0, data: [] }

    let users = []
    try {
      // users 集合用 openId 字段存 openid（不是 _openid）。
      const res = await db.collection('users')
        .where({ openId: _.in(ids) })
        .field({ openId: true, furName: true, nickname: true, avatar: true })
        .limit(ids.length)
        .get()
      users = res.data || []
    } catch (err) {
      console.warn('读取被拉黑用户资料失败，仅返回 openid:', err.message)
    }

    const userMap = new Map(users.map(user => [user.openId, user]))
    return {
      code: 0,
      data: ids.map(id => {
        const user = userMap.get(id)
        return {
          openId: id,
          nickname: displayName(user),
          avatar: (user && user.avatar) || ''
        }
      })
    }
  }

  return { code: -1, message: '不支持的操作' }
}
