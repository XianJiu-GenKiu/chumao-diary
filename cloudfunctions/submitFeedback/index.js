const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function isUserActive(openid) {
  const result = await db.collection('users').where({ openId: openid }).limit(1).get()
  return !result.data.length || result.data[0].status !== 'banned'
}

const MISSING_COLLECTION = /collection not exists|DATABASE_COLLECTION_NOT_EXIST|-502005/i

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext()
  const content = String(event.content || '').trim().slice(0, 500)
  if (!openid) return { code: -1, message: '未登录' }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }
  if (content.length < 2) return { code: -1, message: '请至少填写 2 个字' }

  const doc = { userOpenId: openid, content, status: 'new', createdAt: db.serverDate() }

  try {
    await db.collection('feedback').add({ data: doc })
    return { code: 0 }
  } catch (err) {
    // feedback 集合可能从未创建过。这是唯一写入该集合的入口，
    // 直接自愈建集合后重试一次，避免「意见反馈」功能整体不可用。
    if (MISSING_COLLECTION.test(String(err.message || '')) && typeof db.createCollection === 'function') {
      try {
        await db.createCollection('feedback')
        await db.collection('feedback').add({ data: doc })
        return { code: 0 }
      } catch (retryErr) {
        console.error('submitFeedback 重试失败:', retryErr)
        return { code: -1, message: '提交失败', error: retryErr.message }
      }
    }
    console.error('submitFeedback 失败:', err)
    return { code: -1, message: '提交失败', error: err.message }
  }
}
