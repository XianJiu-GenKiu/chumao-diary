const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
function currentSeason() {
  const month = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', month: 'numeric' }).format(new Date()))
  if (month >= 3 && month <= 5) return { name: '春季', words: ['春', '樱', '花'] }
  if (month >= 6 && month <= 8) return { name: '夏季', words: ['夏', '绿', '水'] }
  if (month >= 9 && month <= 11) return { name: '秋季', words: ['秋', '枫', '银杏'] }
  return { name: '冬季', words: ['冬', '雪', '暖'] }
}
exports.main = async () => {
  try {
    const season = currentSeason()
    const result = await db.collection('locations').orderBy('createdAt', 'desc').limit(100).get()
    // 季节推荐是公开位：只有 approved 参与；下架与 rejected / pending / review 都不参与。
    const list = result.data.filter(item => item &&
      item.visibility !== 'hidden' && item.moderationStatus !== 'hidden' &&
      (!item.moderationStatus || item.moderationStatus === 'approved') &&
      (!item.visibility || item.visibility === 'public')).map(item => {
      const text = `${item.season || ''} ${(item.tags || []).join(' ')} ${item.description || ''}`
      return { ...item, _score: season.words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0) }
    }).filter(item => item._score > 0).sort((a, b) => b._score - a._score || (b.reactionUpCount || 0) - (a.reactionUpCount || 0)).slice(0, 20)
    return { code: 0, data: { season: season.name, list } }
  } catch (err) { return { code: -1, message: '获取季节推荐失败', error: err.message } }
}
