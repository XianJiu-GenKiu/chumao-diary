// 云函数：followUser
// 功能：关注/取消关注用户，同时更新双方统计
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

async function isUserActive(openid) {
  const result = await db.collection('users').where({ openId: openid }).limit(1).get()
  return !result.data.length || result.data[0].status !== 'banned'
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (err) {
    if (!/exist|exists|already|同名集合|已存在/i.test(err.message || '')) {
      console.warn(`ensure collection ${name} failed:`, err.message)
    }
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return { code: -1, message: '未登录' }
  }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }

  const { targetOpenId, action = 'toggle' } = event

  if (!targetOpenId || !['toggle', 'follow', 'unfollow'].includes(action)) {
    return { code: -1, message: '缺少目标用户' }
  }

  if (targetOpenId === openid) {
    return { code: -1, message: '不能关注自己' }
  }

  try {
    await ensureCollection('follows')
    const targetUserRes = await db.collection('users').where({ openId: targetOpenId }).limit(1).get()
    if (!targetUserRes.data.length) {
      return { code: -1, message: '目标用户不存在' }
    }

    // 查询是否已关注
    const existingRes = await db.collection('follows').where({
      followerOpenId: openid,
      followingOpenId: targetOpenId
    }).limit(1).get()

    const isFollowing = existingRes.data.length > 0

    // 确定最终操作
    const shouldFollow = action === 'toggle' ? !isFollowing : action === 'follow'

    if (shouldFollow && !isFollowing) {
      // 关注
      await db.collection('follows').add({
        data: {
          followerOpenId: openid,
          followingOpenId: targetOpenId,
          createdAt: db.serverDate()
        }
      })

      // 发送消息通知
      try {
        await ensureCollection('messages')
        // 获取关注者信息
        const followerRes = await db.collection('users').where({ openId: openid }).limit(1).get()
        const followerName = (followerRes.data[0] && followerRes.data[0].nickname) || '毛毛用户'
        const followerAvatar = (followerRes.data[0] && followerRes.data[0].avatar) || ''

        await db.collection('messages').add({
          data: {
            toOpenId: targetOpenId,
            fromOpenId: openid,
            fromName: followerName,
            fromAvatar: followerAvatar,
            type: 'system',
            content: `${followerName} 关注了你`,
            targetId: openid,
            targetType: 'user',
            targetName: followerName,
            isRead: false,
            createdAt: db.serverDate()
          }
        })
      } catch (e) {
        console.warn('发送关注消息失败（非致命）:', e.message)
      }

      return { code: 0, data: { isFollowing: true } }
    } else if (!shouldFollow && isFollowing) {
      // 取消关注
      await db.collection('follows').doc(existingRes.data[0]._id).remove()
      return { code: 0, data: { isFollowing: false } }
    } else {
      // 状态无变化
      return { code: 0, data: { isFollowing: isFollowing } }
    }
  } catch (err) {
    console.error('followUser 云函数出错:', err)
    return { code: -1, message: '操作失败', error: err.message }
  }
}
