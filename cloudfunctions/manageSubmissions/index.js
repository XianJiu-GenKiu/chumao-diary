// 云函数：manageSubmissions
//
// location_submissions 集合的**唯一**读取方，仅 ADMIN_OPENIDS 白名单可调用。
//
// 合规要点（公开展示型降级版）：
//   1. 返回给前端的字段经过白名单裁剪，**刻意不返回 submitterOpenId**。
//      这样即便后台界面被截图/转发，也不存在「谁能看到谁提交了什么」的
//      关联信息 —— 提交者身份在对外可见面上完全不存在。
//   2. 本函数只改 location_submissions 的状态，**不写 locations**。
//      公开地点仍由运营方在 location-upload 里手动录入，让「发布」这一步
//      始终由运营方本人完成。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const COLLECTION = 'location_submissions'
const STATUSES = ['pending', 'accepted', 'rejected']

function isAdmin(openid) {
  return String(process.env.ADMIN_OPENIDS || '').split(',').map(id => id.trim()).filter(Boolean).includes(openid)
}

/** 对外返回字段白名单：不含 submitterOpenId（见文件头合规说明 1）。 */
function toPublicSubmission(doc) {
  return {
    _id: doc._id,
    name: doc.name || '',
    category: doc.category || '',
    note: doc.note || '',
    address: doc.address || '',
    latitude: doc.latitude == null ? null : doc.latitude,
    longitude: doc.longitude == null ? null : doc.longitude,
    status: doc.status || 'pending',
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null
  }
}

exports.main = async event => {
  const { OPENID: openid } = cloud.getWXContext()
  const { action = 'list', submissionId, status, page = 1, pageSize = 20 } = event

  if (!openid || !isAdmin(openid)) return { code: -403, message: '无管理员权限' }

  try {
    if (action === 'count') {
      try {
        const res = await db.collection(COLLECTION).where({ status: 'pending' }).count()
        return { code: 0, data: { pending: res.total || 0 } }
      } catch (err) {
        // 集合尚未建立 = 还没有任何提交，按 0 处理而非报错。
        return { code: 0, data: { pending: 0 } }
      }
    }

    if (action === 'list') {
      const safePage = Math.max(1, Math.floor(Number(page) || 1))
      const safeSize = Math.min(50, Math.max(1, Math.floor(Number(pageSize) || 20)))
      const query = status && STATUSES.includes(status) ? { status } : {}
      let result
      try {
        result = await db.collection(COLLECTION).where(query).orderBy('createdAt', 'desc')
          .skip((safePage - 1) * safeSize).limit(safeSize).get()
      } catch (err) {
        // 集合不存在时返回空列表，让后台显示空态而不是错误态。
        return { code: 0, data: { list: [], hasMore: false } }
      }
      return {
        code: 0,
        data: {
          list: result.data.map(toPublicSubmission),
          hasMore: result.data.length === safeSize
        }
      }
    }

    if (action === 'update' && submissionId && STATUSES.includes(status)) {
      await db.collection(COLLECTION).doc(submissionId).update({
        data: { status, reviewedBy: openid, reviewedAt: db.serverDate(), updatedAt: db.serverDate() }
      })
      return { code: 0, message: '处理成功' }
    }

    return { code: -1, message: '参数错误' }
  } catch (err) {
    console.error('manageSubmissions failed:', err)
    return { code: -1, message: '操作失败', error: err.message }
  }
}
