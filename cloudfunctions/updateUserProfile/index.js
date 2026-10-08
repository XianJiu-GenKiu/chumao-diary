const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const { checkText: secCheckText, checkImage: secCheckImage, describeFailure, moderationTraceFields, SCENE } = require('./contentSecurity.js')

async function isUserActive(openid) {
  const result = await db.collection('users').where({ openId: openid }).limit(1).get()
  return !result.data.length || result.data[0].status !== 'banned'
}

async function checkText(text, openid) {
  if (!text) return { pass: true, moderationStatus: 'approved' }
  return secCheckText(text, { openid, scene: SCENE.PROFILE })
}

async function checkImage(fileID, openid) {
  if (!fileID) return { pass: true, moderationStatus: 'approved' }
  // Only Cloud Storage files are accepted by the current uploader. Refusing
  // other sources prevents bypassing image moderation with an external URL.
  if (!fileID.startsWith('cloud://')) return { pass: false, moderationStatus: 'rejected' }
  return secCheckImage(fileID, { openid })
}

async function findUserByOpenId(openid) {
  const userRes = await db.collection('users')
    .where(_.or([
      { openId: openid },
      { openid },
      { _openid: openid }
    ]))
    .limit(1)
    .get()
  return userRes.data[0] || null
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext()
  if (!openid) return { code: -1, message: '未登录' }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }

  const nickname = String(event.nickname || '').trim().slice(0, 20)
  const furName = String(event.furName || '').trim().slice(0, 20)
  const signature = String(event.signature || '').trim().slice(0, 100)
  const avatar = String(event.avatar || '').trim()
  const profileBg = String(event.profileBg || event.backgroundImage || '').trim()

  if (!nickname) return { code: -1, message: '请输入昵称' }

  // Never rely on a client-supplied "changed" flag for a security decision.
  // Compare the submitted values with the persisted user record instead.
  const user = await findUserByOpenId(openid)

  // 只有「明确违规」才拒绝保存资料；审核服务不可用时放行，
  // 否则审核接口一旦异常，用户连昵称都改不了。
  const textCheck = await checkText([nickname, furName, signature].filter(Boolean).join(' '), openid)
  if (textCheck.moderationStatus === 'rejected') {
    return { code: -3, message: describeFailure(textCheck, 'text') }
  }
  // Re-check only a newly selected image. Previously saved cloud files have
  // already passed moderation, and forcing another check made plain profile
  // edits fail whenever a historical image was too large or unavailable.
  const imageChecks = await Promise.all([
    avatar && avatar !== (user && (user.avatar || user.avatarUrl || '')) ? checkImage(avatar, openid) : { pass: true, moderationStatus: 'approved' },
    profileBg && profileBg !== (user && (user.profileBg || user.backgroundImage || user.coverUrl || '')) ? checkImage(profileBg, openid) : { pass: true, moderationStatus: 'approved' }
  ])
  const rejectedImage = imageChecks.find(result => result.moderationStatus === 'rejected')
  if (rejectedImage) {
    // 用 describeFailure 区分「图片过大」与「确实违规」，避免把体积问题
    // 说成「未通过安全审核」，用户会误以为内容违规而反复换图。
    return { code: -3, message: describeFailure(rejectedImage, 'image') }
  }

  try {
    const patch = {
      openId: openid,
      nickname,
      furName,
      signature,
      // 降级放行（审核接口不可用）的事实落库，便于日后筛出未审核资料补审。
      ...moderationTraceFields(textCheck, ...imageChecks),
      updatedAt: db.serverDate()
    }
    if (avatar) patch.avatar = avatar
    if (profileBg) {
      patch.profileBg = profileBg
      patch.backgroundImage = profileBg
    }

    let userId = user && user._id
    if (userId) {
      const updateRes = await db.collection('users').doc(userId).update({ data: patch })
      if (updateRes.stats && updateRes.stats.updated < 1) {
        return { code: -1, message: '保存失败' }
      }
    } else {
      const addRes = await db.collection('users').add({
        data: {
          ...patch,
          avatar,
          profileBg,
          backgroundImage: profileBg,
          gender: 0,
          friendIds: [],
          followingIds: [],
          groupIds: [],
          createdAt: db.serverDate(),
          lastLoginAt: db.serverDate()
        }
      })
      userId = addRes._id
    }

    const savedRes = await db.collection('users').doc(userId).get()
    const saved = savedRes.data || {}
    return {
      code: 0,
      data: {
        ...saved,
        openId: openid,
        nickname,
        furName,
        signature,
        avatar: saved.avatar || avatar || '',
        profileBg: saved.profileBg || saved.backgroundImage || profileBg || '',
        backgroundImage: saved.backgroundImage || saved.profileBg || profileBg || ''
      }
    }
  } catch (err) {
    console.error('updateUserProfile failed:', err)
    return { code: -1, message: '保存失败', error: err.message }
  }
}
