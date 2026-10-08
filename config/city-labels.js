/**
 * 城市展示名映射（合规要求：境外城市必须带「中国」前缀展示）
 *
 * 从原 config/furmeets.js 提取——兽聚名录已改为用户本机自建（fur_furmeets_v1），
 * 该文件随之删除；展示映射仍被足迹页 / 海报页使用，故独立成文件。
 */
const CITY_LABELS = {
  '香港': '中国香港',
  '澳门': '中国澳门',
  '台北': '中国台湾'
}

/** 城市展示名（未在映射表里的城市原样返回） */
function cityLabel(name) {
  if (!name) return ''
  return CITY_LABELS[name] || name
}

module.exports = { CITY_LABELS, cityLabel }
