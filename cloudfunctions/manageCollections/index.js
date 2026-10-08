const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function isUserActive(openid) {
  const result = await db.collection('users').where({ openId: openid }).limit(1).get()
  return !result.data.length || result.data[0].status !== 'banned'
}

// CloudBase 不会在 collection().add 时自动建集合；首次使用合集前显式初始化。
async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (err) {
    if (!/exist|exists|already|同名集合|已存在/i.test(err.message || '')) {
      console.warn(`ensure collection ${name} failed:`, err.message)
    }
  }
}

exports.main = async event => {
  const { OPENID: openid } = cloud.getWXContext()
  if (!openid) return { code: -1, message: '未登录' }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }
  const { action = 'list', collectionId, name, description = '', locationId, visibility = 'public' } = event
  try {
    await ensureCollection('collections')
    if (action === 'sharedDetail') {
      if (!collectionId) return { code: -1, message: '缺少合集 ID' }
      const current = await db.collection('collections').doc(collectionId).get()
      const collection = current.data
      if (!collection || collection.visibility === 'private') return { code: -2, message: '合集不存在或未公开' }
      const ids = Array.isArray(collection.locationIds) ? collection.locationIds : []
      const locationsRes = ids.length ? await db.collection('locations').where({ _id: db.command.in(ids) }).get() : { data: [] }
      const locationMap = new Map(locationsRes.data.map(item => [item._id, item]))
      const locations = ids.map(id => locationMap.get(id)).filter(item => item && item.visibility !== 'hidden' && item.moderationStatus !== 'hidden')
      return { code: 0, data: { ...collection, locations } }
    }
    if (action === 'list') {
      // 新环境尚未创建合集时展示正常空态；第一次创建会由 add 建立集合。
      const result = await db.collection('collections').where({ ownerOpenId: openid }).orderBy('updatedAt', 'desc').get().catch(() => ({ data: [] }))
      return { code: 0, data: result.data }
    }
    if (action === 'create') {
      const title = String(name || '').trim().slice(0, 30)
      if (!title) return { code: -1, message: '请输入合集名称' }
      const result = await db.collection('collections').add({ data: {
        ownerOpenId: openid, name: title, description: String(description).trim().slice(0, 120),
        locationIds: [], visibility: visibility === 'private' ? 'private' : 'public', createdAt: db.serverDate(), updatedAt: db.serverDate()
      } })
      return { code: 0, data: { collectionId: result._id } }
    }
    if (!collectionId) return { code: -1, message: '缺少合集 ID' }
    const current = await db.collection('collections').doc(collectionId).get()
    const collection = current.data
    // 公开合集允许从分享链接查看路线；编辑、删除等写操作仍仅限创建者。
    if (!collection || (collection.ownerOpenId !== openid && !(action === 'detail' && collection.visibility !== 'private'))) {
      return { code: -2, message: '无权操作此合集' }
    }
    const ids = Array.isArray(collection.locationIds) ? collection.locationIds : []
    if (action === 'detail') {
      if (!ids.length) return { code: 0, data: { ...collection, locations: [] } }
      const locationsRes = await db.collection('locations').where({ _id: db.command.in(ids) }).get()
      const map = new Map(locationsRes.data.map(item => [item._id, item]))
      const locations = ids.map(id => map.get(id)).filter(item => item &&
        item.visibility !== 'hidden' && item.moderationStatus !== 'hidden' &&
        (!item.visibility || item.visibility === 'public' || item.creatorOpenId === openid)
      )
      return { code: 0, data: { ...collection, locations } }
    }
    if (action === 'addLocation') {
      if (!locationId) return { code: -1, message: '缺少地点 ID' }
      const locationRes = await db.collection('locations').doc(locationId).get()
      const location = locationRes.data
      if (!location || location.visibility === 'hidden' || location.moderationStatus === 'hidden') return { code: -1, message: '地点不存在或已下架' }
      if (location.visibility === 'circle' && location.creatorOpenId !== openid) return { code: -1, message: '该地点仅作者可见' }
      const nextIds = ids.includes(locationId) ? ids : [...ids, locationId]
      await db.collection('collections').doc(collectionId).update({ data: { locationIds: nextIds, updatedAt: db.serverDate() } })
      return { code: 0, data: { locationIds: nextIds } }
    }
    if (action === 'removeLocation') {
      const nextIds = ids.filter(id => id !== locationId)
      await db.collection('collections').doc(collectionId).update({ data: { locationIds: nextIds, updatedAt: db.serverDate() } })
      return { code: 0, data: { locationIds: nextIds } }
    }
    if (action === 'delete') {
      await db.collection('collections').doc(collectionId).remove()
      return { code: 0 }
    }
    return { code: -1, message: '不支持的操作' }
  } catch (err) {
    console.error('manageCollections failed:', err)
    return { code: -1, message: '合集操作失败', error: err.message }
  }
}
