// 云函数：reportContent
// 功能：用户举报违规内容（地点/动态/评论）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

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

  const { targetId, targetType, targetName = '', reason } = event

  if (!targetId || !targetType) {
    return { code: -1, message: '参数不完整' }
  }

  if (!['location', 'post', 'comment'].includes(targetType)) {
    return { code: -1, message: '不支持的内容类型' }
  }

  if (!reason) {
    return { code: -1, message: '请选择举报原因' }
  }

  try {
    await ensureCollection('reports')

    // 防止重复举报（同一用户对同一内容只能举报一次）
    const existingRes = await db.collection('reports').where({
      reporterOpenId: openid,
      targetId,
      targetType
    }).limit(1).get()

    if (existingRes.data.length > 0) {
      return { code: -2, message: '您已举报过此内容，请等待管理员处理' }
    }

    const report = {
      reporterOpenId: openid,
      targetId,
      targetType,
      targetName,
      reason,
      status: 'pending', // pending | reviewing | resolved | dismissed
      createdAt: db.serverDate()
    }

    await db.collection('reports').add({ data: report })

    return { code: 0, message: '举报已提交，管理员将尽快处理' }
  } catch (err) {
    console.error('reportContent 云函数出错:', err)
    return { code: -1, message: '举报失败', error: err.message }
  }
}
