// 云函数：toggleFavorite
// 功能：切换收藏状态（支持 location / post），同步更新收藏数
//
// 数据一致性设计：
// 1) 收藏关系使用确定性 _id（scope + targetType + targetId + openId 的摘要），
//    同一用户对同一目标只会有一条记录，重复请求天然幂等，不再依赖「先查询再写入」。
// 2) 关系写入与目标 favoriteCount 增减放在同一个数据库事务中，避免出现
//    「关系写了但计数没变」或反之的半完成状态。
// 3) favoriteCount 由本函数统一维护，成为列表 / 详情 / 排行榜的唯一真源。
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

  const { targetId, targetType = 'location' } = event

  if (!targetId || !['post', 'location'].includes(targetType)) {
    return { code: -1, message: '缺少目标 ID' }
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

    const favoriteId = relationId('fav', targetType, targetId, openid)

    // favorites 集合只在「有人第一次收藏」时才被写出。若集合尚不存在，
    // 事务里的 doc().set() 会直接抛 -502005，表现为「第一个用户点收藏必定失败」，
    // 随后 getLocationDetail / getUserStats 等读接口也会因为集合缺失而整页报错。
    // createCollection 不能在事务内调用，必须在这里提前自愈。
    await ensureCollection(db, 'favorites')

    // 以确定性 ID 直接读取关系，无需先做模糊查询。
    let existing = null
    try {
      const docRes = await db.collection('favorites').doc(favoriteId).get()
      existing = docRes.data || null
    } catch (e) {
      existing = null // 文档不存在
    }

    const nowFavorited = !existing

    // 关系与计数在同一事务内完成，保证两者要么都成功要么都回滚。
    await db.runTransaction(async transaction => {
      const targetRef = transaction.collection(targetCollection).doc(targetId)
      if (existing) {
        await transaction.collection('favorites').doc(favoriteId).remove()
        await targetRef.update({ data: { favoriteCount: _.inc(-1) } })
      } else {
        await transaction.collection('favorites').doc(favoriteId).set({
          data: {
            targetId,
            targetType,
            userOpenId: openid,
            createdAt: db.serverDate()
          }
        })
        await targetRef.update({ data: { favoriteCount: _.inc(1) } })
      }
    })

    // 收藏数按事务结果回读，避免客户端自行加减造成漂移。
    let favoriteCount = Math.max(0, Number(target.favoriteCount) || 0)
    try {
      const freshRes = await db.collection(targetCollection).doc(targetId).get()
      favoriteCount = Math.max(0, Number(freshRes.data.favoriteCount) || 0)
    } catch (e) { /* 回读失败时保留估算值 */ }

    // 公开展示型：不再向作者发送「谁收藏了你」的通知。
    // 那是整条链路里唯一一处「A 的行为被 B 看见」的跨用户可见点，
    // 移除后收藏彻底成为纯个人事务。
    return { code: 0, data: { favorited: nowFavorited, favoriteCount } }
  } catch (err) {
    console.error('toggleFavorite 云函数出错:', err)
    // 并发写入同一关系时可能出现 _id 冲突：此时关系已存在，按幂等成功处理。
    if (isDuplicateKeyError(err)) {
      return { code: 0, data: { favorited: true } }
    }
    return { code: -1, message: '操作失败', error: err.message }
  }
}
