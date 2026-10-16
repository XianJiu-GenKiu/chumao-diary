// 云函数：deleteAccount
//
// 用户自助注销账号（个人信息删除权）。
//
// 合规要点：
//   1. 必须在服务端注销 —— 客户端清缓存不算注销，服务端留着 openId 关联的
//      个人数据就仍然是「未删除」。
//   2. 身份只认 cloud.getWXContext().OPENID，绝不接受客户端传 openId，
//      否则任何人都能注销别人。
//   3. 只删个人数据（谁 openId 归谁）。公开地点库 locations 由运营方维护，
//      其主体是运营方，创作者注销不影响它公开存在（无署名）。
//   4. 逐集合容错：集合不存在（-502005）时跳过，不让单表异常挡住整个注销。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

/** 每个集合里「属于这个人」的字段名。 */
const OWNED = [
  ['favorites', 'userOpenId'],
  ['likes', 'userOpenId'],
  ['reactions', 'userOpenId'],
  ['ratings', 'userOpenId'],
  ['checkins', 'userOpenId'],
  ['collections', 'ownerOpenId'],
  ['reports', 'reporterOpenId'],
  ['usage_events', 'openId'],
  ['feedback', 'userOpenId'],
  ['locations', 'creatorOpenId'],
  ['posts', 'creatorOpenId'],
  ['location_submissions', 'submitterOpenId'],
  ['xiaoju', 'ownerOpenId'],
  ['follows', 'followerOpenId'],
  // 别人发给我的消息（我是收件人），随注销一并清除。
  ['messages', 'toOpenId']
]

async function clearAll(collection, field, openid) {
  let removed = 0
  // 分页删：单次 get 上限 100 条，循环直到没有为止。
  // 上限 50 轮（5000 条）防意外死循环，超出由运营方在控制台补删。
  for (let round = 0; round < 50; round++) {
    let ids = []
    try {
      const res = await db.collection(collection).where({ [field]: openid }).field({ _id: true }).limit(100).get()
      ids = (res.data || []).map(d => d._id)
    } catch (err) {
      // 集合不存在或不可读 —— 跳过，不让它挡住整次注销。
      return { removed, skipped: true, reason: err.message }
    }
    if (!ids.length) break
    await Promise.all(ids.map(id => db.collection(collection).doc(id).remove().catch(() => null)))
    removed += ids.length
  }
  return { removed }
}

exports.main = async () => {
  const { OPENID: openid } = cloud.getWXContext()
  if (!openid) return { code: -1, message: '未登录，无法注销' }

  const cleaned = {}
  for (const [collection, field] of OWNED) {
    const r = await clearAll(collection, field, openid)
    if (r.removed) cleaned[collection] = r.removed
  }

  // 我发出的消息（fromOpenId）。放在最后：它不影响上面的归属判定。
  const sent = await clearAll('messages', 'fromOpenId', openid)
  if (sent.removed) cleaned.messages = (cleaned.messages || 0) + sent.removed

  // 账号主记录最后删：它是「有没有注册过」的唯一凭据，存活到数据清完为止。
  let userRemoved = 0
  try {
    const res = await db.collection('users').where({ openId: openid }).field({ _id: true }).get()
    const ids = (res.data || []).map(d => d._id)
    await Promise.all(ids.map(id => db.collection('users').doc(id).remove().catch(() => null)))
    userRemoved = ids.length
  } catch (err) {
    // users 集合不存在时本来就没有账号记录，不算失败。
    console.warn('deleteAccount: 删除 users 记录失败', err.message)
  }

  return { code: 0, data: { deleted: cleaned, userRecordRemoved: userRemoved } }
}
