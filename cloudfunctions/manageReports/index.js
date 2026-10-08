const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isAdmin(openid) {
  return String(process.env.ADMIN_OPENIDS || '').split(',').map(id => id.trim()).filter(Boolean).includes(openid)
}

exports.main = async event => {
  const { OPENID: openid } = cloud.getWXContext()
  const { action = 'list', reportId, status, page = 1, pageSize = 20 } = event

  // whoami：探测当前用户是否运营方。它本身就是校验接口，因此不做管理员前置校验；
  // 前端只用结果决定是否展示运营入口，真正的写入门禁仍在下面各管理 action 上。
  if (action === 'whoami') {
    return { code: 0, data: { isAdmin: !!openid && isAdmin(openid) } }
  }

  if (!openid || !isAdmin(openid)) return { code: -403, message: '无管理员权限' }
  try {
    if (action === 'backfillPostGeo') {
      const safePage = Math.max(1, Math.floor(Number(page) || 1))
      const batchSize = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 100)))
      const result = await db.collection('posts').orderBy('createdAt', 'desc')
        .skip((safePage - 1) * batchSize).limit(batchSize).get()
      const validPosts = result.data.filter(post =>
        Number.isFinite(Number(post.latitude)) && Number.isFinite(Number(post.longitude))
      )
      await Promise.all(validPosts.map(post =>
        db.collection('posts').doc(post._id).update({ data: {
          geoLocation: new db.Geo.Point(Number(post.longitude), Number(post.latitude))
        } })
      ))
      return {
        code: 0,
        data: {
          page: safePage,
          processed: result.data.length,
          updated: validPosts.length,
          hasMore: result.data.length === batchSize
        },
        message: `已回填 ${validPosts.length} 条动态的地理位置`
      }
    }
    if (action === 'list') {
      const query = status ? { status } : {}
      const result = await db.collection('reports').where(query).orderBy('createdAt', 'desc')
        .skip((Math.max(1, page) - 1) * Math.min(pageSize, 50)).limit(Math.min(pageSize, 50)).get()
      return { code: 0, data: { list: result.data, hasMore: result.data.length === Math.min(pageSize, 50) } }
    }
    if (action === 'update' && reportId && ['reviewing', 'resolved', 'dismissed'].includes(status)) {
      await db.collection('reports').doc(reportId).update({ data: { status, reviewedBy: openid, reviewedAt: db.serverDate() } })
      return { code: 0, message: '处理成功' }
    }
    if (action === 'takeDown' && reportId) {
      const reportResult = await db.collection('reports').doc(reportId).get()
      const report = reportResult.data
      const collectionMap = { post: 'posts', location: 'locations', comment: 'comments' }
      const collection = report && collectionMap[report.targetType]
      if (!collection || !report.targetId) return { code: -1, message: '举报目标无效' }

      await db.collection(collection).doc(report.targetId).update({ data: {
        visibility: 'hidden', moderationStatus: 'hidden', moderatedBy: openid,
        moderatedAt: db.serverDate(), moderationReason: report.reason || '举报审核下架'
      } })
      await db.collection('reports').where({ targetId: report.targetId, targetType: report.targetType }).update({ data: {
        status: 'resolved', reviewedBy: openid, reviewedAt: db.serverDate(), action: 'taken_down'
      } })
      return { code: 0, message: '内容已下架' }
    }
    if (action === 'banAuthor' && reportId) {
      const reportResult = await db.collection('reports').doc(reportId).get()
      const report = reportResult.data
      const collectionMap = { post: 'posts', location: 'locations', comment: 'comments' }
      const collection = report && collectionMap[report.targetType]
      if (!collection || !report.targetId) return { code: -1, message: '举报目标无效' }

      const targetResult = await db.collection(collection).doc(report.targetId).get()
      const target = targetResult.data
      const authorOpenId = target && (target.creatorOpenId || target.userOpenId)
      if (!authorOpenId) return { code: -1, message: '无法识别内容作者' }
      if (isAdmin(authorOpenId)) return { code: -1, message: '不能封禁管理员账号' }

      const userResult = await db.collection('users').where({ openId: authorOpenId }).limit(1).get()
      const banData = { status: 'banned', bannedBy: openid, bannedAt: db.serverDate(), banReason: report.reason || '举报审核封禁' }
      if (userResult.data.length) {
        await db.collection('users').doc(userResult.data[0]._id).update({ data: banData })
      } else {
        await db.collection('users').add({ data: { openId: authorOpenId, ...banData, createdAt: db.serverDate() } })
      }

      await Promise.all([
        db.collection('posts').where({ creatorOpenId: authorOpenId }).update({ data: { visibility: 'hidden', moderationStatus: 'hidden', moderatedBy: openid, moderatedAt: db.serverDate() } }),
        db.collection('locations').where({ creatorOpenId: authorOpenId }).update({ data: { visibility: 'hidden', moderationStatus: 'hidden', moderatedBy: openid, moderatedAt: db.serverDate() } }),
        db.collection('comments').where({ userOpenId: authorOpenId }).update({ data: { visibility: 'hidden', moderationStatus: 'hidden', moderatedBy: openid, moderatedAt: db.serverDate() } })
      ])
      await db.collection('reports').where({ targetId: report.targetId, targetType: report.targetType }).update({ data: {
        status: 'resolved', reviewedBy: openid, reviewedAt: db.serverDate(), action: 'author_banned'
      } })
      return { code: 0, message: '作者已封禁，其公开内容已下架' }
    }
    return { code: -1, message: '参数错误' }
  } catch (err) {
    console.error('manageReports failed:', err)
    return { code: -1, message: '举报处理失败', error: err.message }
  }
}
