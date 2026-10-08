// 云函数：updateContent
// 功能：编辑已发布的地点或动态（仅创建者可操作）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const { checkText, checkImages, describeFailure, resolveModerationStatus, moderationTraceFields, SCENE } = require('./contentSecurity.js')

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

  const { contentType, contentId, data } = event

  if (!contentType || !contentId || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { code: -1, message: '参数不完整' }
  }

  if (!['location', 'post'].includes(contentType)) {
    return { code: -1, message: '不支持的内容类型' }
  }
  if (data.images !== undefined && (!Array.isArray(data.images) || data.images.length > 9 || data.images.some(item => typeof item !== 'string' || !item.startsWith('cloud://')))) {
    return { code: -1, message: '图片数量不能超过 9 张，且必须为已上传的图片' }
  }
  if (data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.length > 5 || data.tags.some(tag => typeof tag !== 'string' || tag.trim().length > 10))) {
    return { code: -1, message: '标签最多 5 个，每个不超过 10 个字符' }
  }
  if (data.content !== undefined && (typeof data.content !== 'string' || data.content.length > 500)) {
    return { code: -1, message: '动态文字不能超过 500 个字符' }
  }
  if (data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 30)) {
    return { code: -1, message: '地点名称需为 1-30 个字符' }
  }

  const collectionName = contentType === 'location' ? 'locations' : 'posts'

  try {
    // 权限校验：只有创建者可以编辑
    const docRes = await db.collection(collectionName).doc(contentId).get()
    const doc = docRes.data

    if (!doc) {
      return { code: -1, message: '内容不存在' }
    }

    if (doc.creatorOpenId !== openid) {
      return { code: -2, message: '无权修改他人内容' }
    }

    // 根据内容类型构建更新数据
    let updateData = { updatedAt: db.serverDate() }
    // 审核结果收集：明确违规 → 拒绝；审核不可用 → 降级放行（记 approved + degraded）。
    const moderationResults = []

    if (contentType === 'location') {
      // 地点可编辑字段
      if (data.name !== undefined) updateData.name = String(data.name).trim()
      if (data.category !== undefined) updateData.category = data.category
      if (data.tags !== undefined) updateData.tags = Array.isArray(data.tags) ? data.tags : []
      if (data.description !== undefined) updateData.description = String(data.description).trim()
      if (data.images !== undefined) updateData.images = Array.isArray(data.images) ? data.images : []
      if (data.address !== undefined) updateData.address = data.address
      if (data.indoor !== undefined) updateData.indoor = Boolean(data.indoor)
      if (data.style !== undefined) updateData.style = data.style
      if (data.facilities !== undefined) updateData.facilities = Array.isArray(data.facilities) ? data.facilities : []
      if (data.bestTime !== undefined) updateData.bestTime = String(data.bestTime).trim().slice(0, 30)
      if (data.season !== undefined) updateData.season = String(data.season).trim().slice(0, 30)
      if (data.notice !== undefined) updateData.notice = String(data.notice).trim().slice(0, 300)
      if (data.visibility !== undefined) updateData.visibility = data.visibility === 'circle' ? 'circle' : 'public'
      if (data.latitude !== undefined && Number.isFinite(Number(data.latitude))) updateData.latitude = Number(data.latitude)
      if (data.longitude !== undefined && Number.isFinite(Number(data.longitude))) updateData.longitude = Number(data.longitude)

      // 内容安全审核
      const combinedText = [updateData.name, updateData.description, updateData.notice, ...(updateData.tags || [])].filter(Boolean).join(' ')
      if (combinedText) {
        const textResult = await checkText(combinedText, { openid, scene: SCENE.LOG })
        moderationResults.push(textResult)
        if (textResult.moderationStatus === 'rejected') {
          return { code: -3, message: describeFailure(textResult, 'text'), suggest: textResult.suggest, moderationStatus: textResult.moderationStatus }
        }
      }
      if (updateData.images && updateData.images.length > 0) {
        const imgResult = await checkImages(updateData.images, { openid })
        moderationResults.push(imgResult)
        if (imgResult.moderationStatus === 'rejected') {
          return { code: -3, message: describeFailure(imgResult, 'image'), suggest: imgResult.suggest, failedIndex: imgResult.failedIndex, moderationStatus: imgResult.moderationStatus }
        }
      }
    } else {
      // 动态可编辑字段
      if (data.content !== undefined) updateData.content = String(data.content).trim()
      if (data.images !== undefined) updateData.images = Array.isArray(data.images) ? data.images : []
      if (data.mood !== undefined) updateData.mood = data.mood
      if (data.tags !== undefined) updateData.tags = Array.isArray(data.tags) ? data.tags : []
      if (data.equipTags !== undefined) updateData.equipTags = Array.isArray(data.equipTags) ? data.equipTags : []
      if (data.visibility !== undefined) updateData.visibility = ['public', 'circle'].includes(data.visibility) ? data.visibility : 'public'
      if (data.location !== undefined) {
        updateData.location = data.location && typeof data.location === 'object' ? data.location : null
        updateData.locationId = updateData.location ? (updateData.location._id || updateData.location.locationId || '') : ''
        // Removing a linked location must also remove its spatial footprint;
        // otherwise the post remains in nearby results despite showing no place.
        if (!updateData.location) {
          updateData.latitude = null
          updateData.longitude = null
          updateData.geoLocation = null
        } else {
          if (Number.isFinite(Number(updateData.location.latitude))) updateData.latitude = Number(updateData.location.latitude)
          if (Number.isFinite(Number(updateData.location.longitude))) updateData.longitude = Number(updateData.location.longitude)
          const latitude = updateData.latitude === undefined ? doc.latitude : updateData.latitude
          const longitude = updateData.longitude === undefined ? doc.longitude : updateData.longitude
          if (Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))) {
            updateData.geoLocation = new db.Geo.Point(Number(longitude), Number(latitude))
          }
        }
      }
      if (data.locationName !== undefined) updateData.locationName = String(data.locationName).trim().slice(0, 100)

      // 内容安全审核
      if (updateData.content) {
        const textResult = await checkText(updateData.content, { openid, scene: SCENE.LOG })
        moderationResults.push(textResult)
        if (textResult.moderationStatus === 'rejected') {
          return { code: -3, message: describeFailure(textResult, 'text'), suggest: textResult.suggest, moderationStatus: textResult.moderationStatus }
        }
      }
      if (updateData.images && updateData.images.length > 0) {
        const imgResult = await checkImages(updateData.images, { openid })
        moderationResults.push(imgResult)
        if (imgResult.moderationStatus === 'rejected') {
          return { code: -3, message: describeFailure(imgResult, 'image'), suggest: imgResult.suggest, failedIndex: imgResult.failedIndex, moderationStatus: imgResult.moderationStatus }
        }
      }
    }

    // 编辑内容同样经过审核：approved 正常公开（含降级放行）。
    updateData.moderationStatus = resolveModerationStatus(...moderationResults)
    // 降级放行的事实落库，便于日后筛出未审核内容补审。
    Object.assign(updateData, moderationTraceFields(...moderationResults))
    await db.collection(collectionName).doc(contentId).update({ data: updateData })

    return { code: 0, message: '修改成功' }
  } catch (err) {
    console.error('updateContent 云函数出错:', err)
    return { code: -1, message: '修改失败', error: err.message }
  }
}
