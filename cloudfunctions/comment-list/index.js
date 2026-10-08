// 云函数：comment-list
// 功能：获取帖子的评论列表（分页），支持 targetId+targetType 和向后兼容 postId
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const { isPubliclyVisible, isRemoved, notRemovedFilter } = require('./visibility')
const { getBlockedIds, filterBlocked } = require('./blocked')

exports.main = async (event, context) => {
  const { OPENID: openid } = cloud.getWXContext()
  // 兼容 targetId + targetType（新格式）和 postId（旧格式）
  const targetId = event.targetId || event.postId
  const targetType = event.targetType || 'post'
  const safePage = Math.max(1, Math.floor(Number(event.page) || 1))
  const safePageSize = Math.min(50, Math.max(1, Math.floor(Number(event.pageSize) || 20)))

  if (!targetId) {
    return { code: -1, message: '缺少目标 ID' }
  }
  if (!['post', 'location'].includes(targetType)) {
    return { code: -1, message: '不支持的内容类型' }
  }

  const skip = (safePage - 1) * safePageSize

  try {
    // 读取评论前必须先校验目标内容的可见性：否则只要知道 ID，
    // 就能读到圈内内容或已下架内容的评论，绕过 post-detail 的权限校验。
    const targetCollection = targetType === 'post' ? 'posts' : 'locations'
    let target = null
    try {
      const targetRes = await db.collection(targetCollection).doc(targetId).get()
      target = targetRes.data
    } catch (e) {
      return { code: -1, message: '目标内容不存在或已删除' }
    }
    if (!target || isRemoved(target)) {
      return { code: -1, message: '目标内容已下架' }
    }
    // 审核未通过（pending / rejected）的内容同样只对作者可见，
    // 此前这里只判断了 hidden，导致待复审内容可被他人读到。
    if (!isPubliclyVisible(target, openid)) {
      return { code: -1, message: '该内容仅作者可见' }
    }

    // 顶层评论（非回复）按时间正序；被隐藏或待复审的评论不对外展示。
    const result = await db.collection('comments')
      .where({
        targetId,
        targetType,
        parentId: null,
        ...notRemovedFilter(_)
      })
      .orderBy('createdAt', 'asc')
      .skip(skip)
      .limit(safePageSize)
      .get()

    // 说明：评论文档的作者字段是 userOpenId（posts/locations 用的是 creatorOpenId）。
    // 只有 approved 的评论对他人可见，pending / rejected 仅作者本人可见——
    // 这一层无法用单条 where 表达，故与 getPosts / getLocations 一致，在内存中过滤。
    // 拉黑过滤：被当前用户拉黑的用户，其评论与回复都不再展示。
    const blockedIds = await getBlockedIds(db, openid)
    const comments = filterBlocked(
      result.data.filter(c => isPubliclyVisible(c, openid, 'userOpenId')),
      blockedIds,
      'userOpenId'
    )

    // 批量获取回复
    if (comments.length > 0) {
      const commentIds = comments.map(c => c._id)
      const replyRes = await db.collection('comments')
        .where({
          parentId: _.in(commentIds),
          ...notRemovedFilter(_)
        })
        .orderBy('createdAt', 'asc')
        .limit(100)
        .get()

      // 按 parentId 分组（回复同样只展示对当前查看者可见、且未被拉黑的部分）
      const replyMap = {}
      filterBlocked(
        replyRes.data.filter(r => isPubliclyVisible(r, openid, 'userOpenId')),
        blockedIds,
        'userOpenId'
      )
        .forEach(r => {
          if (!replyMap[r.parentId]) replyMap[r.parentId] = []
          replyMap[r.parentId].push(r)
        })

      // 将回复挂到主评论上
      comments.forEach(c => {
        c.replies = replyMap[c._id] || []
      })
    }

    return { code: 0, data: comments }
  } catch (err) {
    console.error('comment-list 云函数出错:', err)
    return { code: -1, message: '获取评论失败', error: err.message }
  }
}
