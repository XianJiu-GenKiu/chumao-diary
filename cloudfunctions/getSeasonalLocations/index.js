const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
// 公开字段出口：剔除已下线功能的遗留字段 + creatorOpenId。
const { toPublicLocation } = require('./locationFields')
function currentSeason() {
  const month = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', month: 'numeric' }).format(new Date()))
  if (month >= 3 && month <= 5) return { name: '春季', words: ['春', '樱', '花'] }
  if (month >= 6 && month <= 8) return { name: '夏季', words: ['夏', '绿', '水'] }
  if (month >= 9 && month <= 11) return { name: '秋季', words: ['秋', '枫', '银杏'] }
  return { name: '冬季', words: ['冬', '雪', '暖'] }
}
exports.main = async () => {
  const { OPENID: openid } = cloud.getWXContext()
  try {
    const season = currentSeason()
    const result = await db.collection('locations').orderBy('createdAt', 'desc').limit(100).get()
    // 季节推荐是公开位：只有 approved 参与；下架与 rejected / pending / review 都不参与。
    const scored = result.data.filter(item => item &&
      item.visibility !== 'hidden' && item.moderationStatus !== 'hidden' &&
      (!item.moderationStatus || item.moderationStatus === 'approved') &&
      (!item.visibility || item.visibility === 'public')).map(item => {
      const text = `${item.season || ''} ${(item.tags || []).join(' ')} ${item.description || ''}`
      return { item, score: season.words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0) }
    }).filter(entry => entry.score > 0)
    // 同分时按创建时间倒序。原先用 reactionUpCount（种草踩雷）做 tie-break，
    // 该功能已下线、字段值恒为 0，等于没有 tie-break，还把下线字段带进了排序语义。
    scored.sort((a, b) => b.score - a.score ||
      ((new Date(b.item.createdAt || 0).getTime() || 0) - (new Date(a.item.createdAt || 0).getTime() || 0)))
    // _score 是内部排序用的临时字段，不下发；其余字段走统一出口。
    const list = scored.slice(0, 20).map(entry => toPublicLocation(entry.item, { openid }))
    return { code: 0, data: { season: season.name, list } }
  } catch (err) { return { code: -1, message: '获取季节推荐失败', error: err.message } }
}
