const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const { ensureCollection } = require('./ensureCollection')

// 评分维度定义
const RATING_DIMS = ['facilities', 'scenery', 'transport', 'safety', 'amenities']

async function isUserActive(openid) {
  const result = await db.collection('users').where({ openId: openid }).limit(1).get()
  return !result.data.length || result.data[0].status !== 'banned'
}

/**
 * 校验维度评分对象
 */
function validateDimRatings(dimRatings) {
  if (!dimRatings || typeof dimRatings !== 'object') return false
  for (const dim of RATING_DIMS) {
    const val = Number(dimRatings[dim])
    if (!Number.isFinite(val) || !Number.isInteger(val) || val < 1 || val > 5) return false
  }
  return true
}

/**
 * 计算综合评分：各维度平均值，保留一位小数
 */
function computeOverall(dimRatings) {
  const values = RATING_DIMS.map(d => dimRatings[d])
  const sum = values.reduce((a, b) => a + b, 0)
  return Math.round((sum / values.length) * 10) / 10
}

exports.main = async (event) => {
  const { locationId, rating, dimRatings } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return { code: -1, message: '未登录' }
  }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }

  if (!locationId) {
    return { code: -1, message: '缺少地点ID' }
  }

  // 如果传了 dimRatings 则使用多维度评分，否则兼容旧版单一评分
  let useDimRatings = false
  let overallRating

  if (dimRatings && typeof dimRatings === 'object') {
    if (!validateDimRatings(dimRatings)) {
      return { code: -1, message: '请为所有维度评分（1-5星）' }
    }
    useDimRatings = true
    overallRating = computeOverall(dimRatings)
  } else {
    const userRating = Number(rating)
    // 支持整星和半星（0.5 的倍数，1-5 之间）
    if (!Number.isFinite(userRating) || (userRating * 2) % 1 !== 0 || userRating < 1 || userRating > 5) {
      return { code: -1, message: '评分需在 1-5 之间（支持半星）' }
    }
    overallRating = userRating
  }

  try {
    // 检查地点是否存在
    const locRes = await db.collection('locations').doc(locationId).get()
    const location = locRes.data

    if (!location) {
      return { code: -2, message: '地点不存在' }
    }
    if (location.visibility === 'hidden' || location.moderationStatus === 'hidden') {
      return { code: -2, message: '地点已下架' }
    }
    if (location.visibility === 'circle' && location.creatorOpenId !== openid) {
      return { code: -2, message: '该地点仅作者可见' }
    }

    // 检查是否已评分
    // 云开发不会在 add 时自动建集合，首次评分前必须显式确保 ratings 存在，
    // 否则会抛 -502005 database collection not exists。
    await ensureCollection(db, 'ratings')

    const existingRes = await db.collection('ratings').where({
      locationId,
      userOpenId: openid
    }).get().catch(() => ({ data: [] }))

    const isNewRating = existingRes.data.length === 0

    const ratingData = {
      locationId,
      userOpenId: openid,
      rating: overallRating,
      updatedAt: db.serverDate()
    }

    if (useDimRatings) {
      ratingData.dimRatings = {
        facilities: dimRatings.facilities,
        scenery: dimRatings.scenery,
        transport: dimRatings.transport,
        safety: dimRatings.safety,
        amenities: dimRatings.amenities
      }
    }

    if (isNewRating) {
      ratingData.createdAt = db.serverDate()
      await db.collection('ratings').add({ data: ratingData })
    } else {
      await db.collection('ratings').doc(existingRes.data[0]._id).update({ data: ratingData })
    }

    // 重新计算聚合评分
    const creatorRating = Number.isFinite(Number(location.creatorRating))
      ? Number(location.creatorRating)
      : (Number(location.rating) || 0)

    const allRatingsRes = await db.collection('ratings').where({ locationId }).get().catch(() => ({ data: [] }))
    const ratingCount = allRatingsRes.data.length

    // 计算各维度平均分
    const dimAvgs = {}
    const dimCounts = {}
    for (const dim of RATING_DIMS) {
      const dimValues = allRatingsRes.data
        .filter(r => r.dimRatings && Number.isFinite(r.dimRatings[dim]))
        .map(r => r.dimRatings[dim])
      dimCounts[dim] = dimValues.length
      dimAvgs[dim] = dimValues.length > 0
        ? Math.round((dimValues.reduce((s, v) => s + v, 0) / dimValues.length) * 10) / 10
        : 0
    }

    // 用户总体平均分
    const userRatings = allRatingsRes.data.map(r => r.rating).filter(r => Number.isFinite(r))
    const userAvg = userRatings.length > 0
      ? userRatings.reduce((sum, r) => sum + r, 0) / userRatings.length
      : creatorRating

    // 综合评分 = 创建者初始评分 30% + 用户平均评分 70%
    const aggregatedRating = creatorRating > 0
      ? Math.round((creatorRating * 0.3 + userAvg * 0.7) * 10) / 10
      : Math.round(userAvg * 10) / 10

    // 更新地点
    await db.collection('locations').doc(locationId).update({
      data: {
        creatorRating,
        rating: aggregatedRating,
        ratingCount,
        userAvgRating: Math.round(userAvg * 10) / 10,
        dimRatingAvgs: dimAvgs,
        dimRatingCounts: dimCounts
      }
    })

    return {
      code: 0,
      data: {
        rating: aggregatedRating,
        ratingCount,
        userAvgRating: Math.round(userAvg * 10) / 10,
        myRating: overallRating,
        dimRatingAvgs: dimAvgs,
        dimRatingCounts: dimCounts,
        myDimRatings: useDimRatings ? dimRatings : null
      }
    }
  } catch (err) {
    console.error('rateLocation error:', err)
    return { code: -1, message: '评分失败', error: err.message }
  }
}
