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

/**
 * 程序生成合集标题：`${昵称}的路线`。
 * 降级版的核心合规约束——合集的「名称」不能由用户自由填写，
 * 否则用户撰写的文本会构成「用户生成内容」，从而落入「社交-笔记」类目。
 */
async function buildCollectionTitle(openid) {
  const userRes = await db.collection('users').where({ openId: openid }).limit(1).get().catch(() => ({ data: [] }))
  const user = userRes.data[0] || {}
  const displayName = String(user.furName || user.nickname || '').trim().slice(0, 12) || '我'
  return `${displayName}的路线`
}

/** 老数据只有 name，无 title；读侧统一兜底，避免前端渲染出 undefined。 */
function withTitle(collection) {
  return { ...collection, title: collection.title || collection.name || '地点合集' }
}

exports.main = async event => {
  const { OPENID: openid } = cloud.getWXContext()
  if (!openid) return { code: -1, message: '未登录' }
  if (!await isUserActive(openid)) return { code: -403, message: '账号已被封禁' }
  const { action = 'list', collectionId, locationId } = event
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
      return { code: 0, data: { ...withTitle(collection), locations } }
    }
    if (action === 'list') {
      // 新环境尚未创建合集时展示正常空态；第一次创建会由 add 建立集合。
      const result = await db.collection('collections').where({ ownerOpenId: openid }).orderBy('updatedAt', 'desc').get().catch(() => ({ data: [] }))
      return { code: 0, data: result.data.map(withTitle) }
    }
    if (action === 'create') {
      // 降级版：合集标题由服务端程序生成，不接收任何用户自由文本。
      // 用户对合集的动作只剩「挑选地点 + 排序」，不再产生用户生成内容。
      const title = await buildCollectionTitle(openid)
      const result = await db.collection('collections').add({ data: {
        ownerOpenId: openid,
        title,
        locationIds: [],
        // 默认私有：只有用户显式「分享」时才转为公开，作为唯一的对外出口。
        visibility: 'private',
        createdAt: db.serverDate(), updatedAt: db.serverDate()
      } })
      return { code: 0, data: { collectionId: result._id, title } }
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
      // isOwner 供前端区分「自己的合集（可编辑）」与「分享进入（只读）」。
      const base = { ...withTitle(collection), isOwner: collection.ownerOpenId === openid }
      if (!ids.length) return { code: 0, data: { ...base, locations: [] } }
      const locationsRes = await db.collection('locations').where({ _id: db.command.in(ids) }).get()
      const map = new Map(locationsRes.data.map(item => [item._id, item]))
      const locations = ids.map(id => map.get(id)).filter(item => item &&
        item.visibility !== 'hidden' && item.moderationStatus !== 'hidden' &&
        (!item.visibility || item.visibility === 'public' || item.creatorOpenId === openid)
      )
      return { code: 0, data: { ...base, locations } }
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
    if (action === 'share') {
      // 分享是合集唯一的对外出口：仅由创建者在「分享」动作中显式触发。
      // 从私有转为公开后，链接/小程序码可被他人只读查看。
      await db.collection('collections').doc(collectionId).update({ data: { visibility: 'public', updatedAt: db.serverDate() } })
      return { code: 0, data: { visibility: 'public' } }
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
