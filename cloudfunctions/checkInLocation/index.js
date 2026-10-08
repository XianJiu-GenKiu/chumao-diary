// 云函数：checkInLocation
// 功能：地点签到（同一用户同一地点每天只计一次）
//
// 一致性设计：签到记录使用确定性 _id（含中国时区日期），
// 「写入签到 + 计数 +1」放在同一事务中；重复签到会命中同一 _id，
// 由数据库唯一性兜底，不再依赖先查询后写入。
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

function dateKey() {
  // 小程序主要面向中国用户；不能用 UTC 日期，否则东八区凌晨会落到前一天。
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date())
}

exports.main = async event => {
  const { OPENID: openid } = cloud.getWXContext()
  const { locationId } = event
  if (!openid) return { code: -1, message: '请先登录' }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }
  if (!locationId) return { code: -1, message: '缺少地点 ID' }
  try {
    const locationRes = await db.collection('locations').doc(locationId).get()
    const location = locationRes.data
    if (!location) return { code: -1, message: '地点不存在' }
    if (location.visibility === 'hidden' || location.moderationStatus === 'hidden') return { code: -1, message: '地点已下架' }
    if (location.visibility === 'circle' && location.creatorOpenId !== openid) return { code: -1, message: '该地点仅作者可见' }

    const key = dateKey()
    const checkinId = relationId('checkin', locationId, openid, key)

    // checkins 集合首次签到前可能不存在；事务内不能建集合，先自愈。
    await ensureCollection(db, 'checkins')

    let existing = null
    try {
      const docRes = await db.collection('checkins').doc(checkinId).get()
      existing = docRes.data || null
    } catch (e) {
      existing = null
    }

    if (existing) {
      return { code: 0, data: { checkedIn: true, checkinCount: Math.max(0, Number(location.checkinCount) || 0), already: true } }
    }

    await db.runTransaction(async transaction => {
      await transaction.collection('checkins').doc(checkinId).set({
        data: { locationId, userOpenId: openid, dateKey: key, createdAt: db.serverDate() }
      })
      await transaction.collection('locations').doc(locationId).update({ data: { checkinCount: _.inc(1) } })
    })

    let checkinCount = Math.max(1, (Number(location.checkinCount) || 0) + 1)
    try {
      const updated = await db.collection('locations').doc(locationId).get()
      checkinCount = Math.max(0, Number(updated.data.checkinCount) || 0)
    } catch (e) { /* 回读失败时保留估算值 */ }

    return { code: 0, data: { checkedIn: true, checkinCount, already: false } }
  } catch (err) {
    console.error('checkInLocation failed:', err)
    // 并发签到：确定性 ID 已存在，视为今天已签到。
    if (isDuplicateKeyError(err)) {
      return { code: 0, data: { checkedIn: true, already: true } }
    }
    return { code: -1, message: '签到失败', error: err.message }
  }
}
