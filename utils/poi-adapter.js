/**
 * POI 统一适配层
 * ─────────────────────────────────────────────────────────────
 * 目标：让「小程序自有地点」和「腾讯地图外部地点」输出同一套数据结构，
 * 交给同一个 poi-preview-card 模板渲染，从而保持视觉与交互一致。
 *
 * 卡片只消费本文件产出的统一字段，不直接读取腾讯接口的原始字段，
 * 因此后续更换地图数据源或增加新的来源（高德、用户上报等）时，
 * 只需要新增一个适配器，卡片无需改动。
 *
 * 数据边界（重要）：
 * 外部地点不是小程序内容，没有内部 _id、打卡、种草、收藏关系和真实图片，
 * 因此统一模型用 collectionStatus / can* 字段显式表达「能做什么」，
 * 而不是用假数据伪装成内部地点。
 */

/** 地点收录状态 */
const COLLECTION_STATUS = {
  /** 已被小程序收录，有内部 _id，可收藏 / 查看详情 */
  COLLECTED: 'collected',
  /** 腾讯地图有该地点，但小程序尚未收录，只能导航 / 添加到出毛日记 */
  NOT_COLLECTED: 'not_collected',
  /** 只有坐标，连腾讯地图也识别不出明确地点 */
  UNRESOLVED: 'unresolved'
}

/** 来源标识 */
const SOURCE = {
  INTERNAL: 'internal',
  TENCENT: 'tencent'
}

// 外部地点没有真实图片，用分类映射一个占位图标，避免出现空白图区
const CATEGORY_ICON_MAP = [
  { match: /商场|购物|商业|超市|市场/, icon: 'home' },
  { match: /公园|绿地|广场|景点|风景|景区/, icon: 'sun' },
  { match: /酒店|宾馆|住宿|民宿/, icon: 'home' },
  { match: /餐饮|美食|餐厅|饭店|小吃|咖啡/, icon: 'thumbs-up' },
  { match: /医院|诊所|医疗|药店/, icon: 'info' },
  { match: /学校|大学|中学|小学|教育|培训/, icon: 'flag' },
  { match: /交通|车站|地铁|公交|机场|停车/, icon: 'navigation' },
  { match: /文化|艺术|博物|图书|展览/, icon: 'calendar' }
]

/** 把腾讯的分类串（如「购物:商场」）整理成适合展示的短标签 */
function tidyCategoryName(category) {
  const raw = String(category || '').trim()
  if (!raw) return '地图地点'
  // 腾讯分类通常是「一级:二级」，优先展示二级，更贴近用户认知
  const parts = raw.split(/[:：]/).map(item => item.trim()).filter(Boolean)
  const name = parts.length > 1 ? parts[parts.length - 1] : parts[0]
  return name || '地图地点'
}

/** 根据分类挑一个占位图标名 */
function pickCategoryIcon(category) {
  const raw = String(category || '')
  for (const rule of CATEGORY_ICON_MAP) {
    if (rule.match.test(raw)) return rule.icon
  }
  return 'map-pin'
}

/** 把米数格式化成与内部地点一致的展示文案 */
function formatDistance(meters) {
  const value = Number(meters)
  if (!Number.isFinite(value) || value < 0) return ''
  return value < 1000 ? `${Math.round(value)}m` : `${(value / 1000).toFixed(1)}km`
}

/**
 * 适配小程序自有地点。
 * 保持既有字段不变，仅补齐统一模型所需的来源与能力声明，
 * 因此不会影响现有卡片的信息密度。
 */
function normalizeInternalPoi(location, context = {}) {
  const loc = location || {}
  return {
    ...loc,

    // 模板依赖的公共字段必须存在，缺省时给出空值而不是 undefined，
    // 避免 WXML 读取 undefined 时出现渲染告警。
    address: loc.address || loc.locationName || '',
    distance: loc.distance || context.distance || '',
    categoryName: loc.categoryName || loc.category || loc.style || '',
    tags: Array.isArray(loc.tags) ? loc.tags : [],
    facilities: Array.isArray(loc.facilities) ? loc.facilities : [],
    bestTime: loc.bestTime || '',
    images: Array.isArray(loc.images) ? loc.images : [],
    previewImage: loc.previewImage || loc.coverUrl || '',
    imageCount: Array.isArray(loc.images) ? loc.images.length : 0,

    source: SOURCE.INTERNAL,
    isExternalPoi: false,
    externalSource: '',
    externalId: '',
    collectionStatus: COLLECTION_STATUS.COLLECTED,
    sourceLabel: '出毛日记地点',
    sourceTone: 'internal',

    // 内部地点拥有完整互动能力
    canFavorite: true,
    canNavigate: true,
    canViewDetail: true,
    canAddToDiary: false,

    // 内部地点若确实没有图片，用地图占位而不是分类图标
    placeholderIcon: 'map-pin'
  }
}

/**
 * 适配腾讯地图外部地点。
 * 腾讯周边接口稳定返回名称 / 地址 / 分类 / 坐标 / 距离 / POI ID，
 * 但通常不返回可用图片，因此图片区使用分类占位。
 */
function normalizeExternalPoi(poi, context = {}) {
  const item = poi || {}
  const latitude = Number(item.latitude)
  const longitude = Number(item.longitude)
  const collected = item.collectionStatus === COLLECTION_STATUS.COLLECTED

  return {
    // 外部地点没有小程序 _id，留空即可，卡片据此不会误跳内部详情页
    _id: collected ? (item.matchedLocationId || '') : '',
    source: SOURCE.TENCENT,
    isExternalPoi: true,
    externalSource: 'tencent-map',
    externalId: item.externalId || '',

    name: item.name || '未命名地点',
    categoryName: tidyCategoryName(item.category),
    address: item.address || '',
    latitude,
    longitude,
    distance: formatDistance(item.distance || context.distance),

    // 外部地点没有图片，交给模板渲染分类占位
    images: [],
    previewImage: '',
    imageCount: 0,
    placeholderIcon: pickCategoryIcon(item.category),

    // 互动数据留空而不是填 0，避免被误读为「已收录但没人互动」
    isFavorited: false,
    favoriteCount: 0,
    checkinCount: 0,
    seedCount: 0,
    viewCount: 0,

    heat: null,
    heatPercent: 0,
    heatLabel: collected ? '' : '暂未收录',
    heatTone: 'new',

    collectionStatus: collected ? COLLECTION_STATUS.COLLECTED : COLLECTION_STATUS.NOT_COLLECTED,
    sourceLabel: '腾讯地图地点',
    sourceTone: 'external',

    // 外部地点第一版不开放收藏：内部收藏云函数要求 targetType=location
    // 且依赖内部 _id，直接写入会产生无法恢复的无效收藏记录。
    canFavorite: collected,
    canNavigate: Number.isFinite(latitude) && Number.isFinite(longitude),
    canViewDetail: collected,
    canAddToDiary: !collected
  }
}

/**
 * 适配「只有坐标、没有可识别地点」的情况。
 * 卡片会提示用户在这里直接创建地点。
 */
function normalizeUnresolvedPoi(coordinate, context = {}) {
  const latitude = Number(coordinate && coordinate.latitude)
  const longitude = Number(coordinate && coordinate.longitude)
  return {
    _id: '',
    source: SOURCE.INTERNAL,
    isExternalPoi: true,
    externalSource: '',
    externalId: '',

    name: '这里还没有地点信息',
    categoryName: '未知位置',
    address: context.address || '',
    latitude,
    longitude,
    distance: '',

    images: [],
    previewImage: '',
    imageCount: 0,
    placeholderIcon: 'map-pin',

    isFavorited: false,
    favoriteCount: 0,
    checkinCount: 0,
    seedCount: 0,
    viewCount: 0,

    heat: null,
    heatPercent: 0,
    heatLabel: '暂未收录',
    heatTone: 'new',

    collectionStatus: COLLECTION_STATUS.UNRESOLVED,
    sourceLabel: '未知位置',
    sourceTone: 'external',

    canFavorite: false,
    canNavigate: Number.isFinite(latitude) && Number.isFinite(longitude),
    canViewDetail: false,
    canAddToDiary: true
  }
}

/**
 * 统一入口：无论数据来自哪里，都从这里产出卡片模型。
 * @param {object} raw 原始数据
 * @param {'internal'|'tencent'|'unresolved'} kind 数据来源类型
 */
function normalizePoi(raw, kind, context = {}) {
  if (kind === SOURCE.TENCENT) return normalizeExternalPoi(raw, context)
  if (kind === 'unresolved') return normalizeUnresolvedPoi(raw, context)
  return normalizeInternalPoi(raw, context)
}

module.exports = {
  COLLECTION_STATUS,
  SOURCE,
  normalizePoi,
  normalizeInternalPoi,
  normalizeExternalPoi,
  normalizeUnresolvedPoi,
  formatDistance,
  tidyCategoryName,
  pickCategoryIcon
}
