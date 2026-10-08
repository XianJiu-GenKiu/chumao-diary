/**
 * SVG 图标组件
 * 使用 Feather Icons (MIT) 风格的线条图标
 * 支持动态颜色和尺寸
 */

// 图标 SVG path 定义（viewBox 0 0 24 24，stroke 风格）
const ICON_PATHS = {
  // 导航 & 操作
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'map-pin': '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'message-circle': '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  
  // 状态 & 反馈
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  'star-outline': '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  'heart-outline': '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  'thumbs-up': '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
  'thumbs-down': '<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
  
  // 内容 & 分类
  'clipboard': '<rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  'image': '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  'bookmark': '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  fire: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  
  // 功能
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  'home-outline': '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'more-horizontal': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'check': '<polyline points="20 6 9 17 4 12"/>',
  'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  'map': '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  
  // 天气
  'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  'cloud': '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  'cloud-rain': '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>',
  'cloud-sun': '<path d="M12 2v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="M20 12h2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M15.947 12.65a4 4 0 0 0-5.325-5.325"/><path d="M13.5 6.5h.01"/><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  
  // 其他
  paw: '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  'trending-up': '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'user-plus': '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  'mail': '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  
  // 地图浮窗专用
  navigation: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  tag: '<path d="M12 2H2v10l9.17 9.17a2 2 0 0 0 2.83 0l7-7a2 2 0 0 0 0-2.83Z"/><path d="M7 7h.01"/>'
}

// 补充图标定义（追加到 ICON_PATHS）
Object.assign(ICON_PATHS, {
  'plus-circle': '<circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'chevron-up': '<path d="m18 15-6-6-6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  // 以下三个此前被页面引用但漏了定义，图标会渲染成空白；补齐。
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  'alert-circle': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  'wifi-off': '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>'
})

// ── 兽头心情图标（出毛日记原创，emoji 风格）──────────────────
// 造型：圆角三角耳 + 圆脸 + 圆润小鼻 + 猫式 w 嘴，八个图标只改变
//       「耳朵姿态 / 眼睛 / 嘴部」，远看始终是同一个兽头。
//
// 设计要点：
//   1. 实心填充 + 配色（暖金毛色 / 粉内耳 / 粉腮红），风格接近 emoji，
//      小尺寸下辨识度高于纯线条画
//   2. 眼睛为「深棕眼珠 + 白色高光」，是 emoji 的典型画法
//   3. 不使用 SVG 渐变：部分端对 data URI 内渐变支持不一致，
//      失败时整块会渲染成黑色；改用纯色 + 浅色高光块模拟光泽
//   4. 这些图标自带配色，渲染时不参与主题换色（见 _updateSrc）
const MOOD_FUR = '#F8C25E'      // 主体毛色
const MOOD_INNER = '#F79EA8'    // 内耳粉
const MOOD_EYE = '#4A3222'      // 眼珠深棕
const MOOD_LINE = '#8A5A2B'     // 鼻 / 嘴线
const MOOD_BLUSH_C = '#F79EA8'  // 腮红
const MOOD_TONGUE = '#F2708A'   // 舌头
const MOOD_MOUTH_IN = '#7B3A3A' // 口腔
const MOOD_SWEAT_C = '#8FD3F4'  // 汗滴
const MOOD_HEART = '#F2607A'    // 爱心眼
const MOOD_WHITE = '#FFFFFF'

// ── 头部：实心圆 + 左上浅色高光（emoji 光泽感）──
const MOOD_HEAD_C =
  `<circle cx="12" cy="13.3" r="7.3" fill="${MOOD_FUR}"/>` +
  `<ellipse cx="8.9" cy="9.7" rx="2.1" ry="1.35" fill="${MOOD_WHITE}" opacity="0.22" transform="rotate(-28 8.9 9.7)"/>`

// ── 耳朵 ──
const MOOD_EARS_UP =
  `<path d="M5.6 10.2 4.15 4.05a.5.5 0 0 1 .78-.55L10.4 6.7Z" fill="${MOOD_FUR}"/>` +
  `<path d="M6.35 8.6 5.4 5.1l2.7 1.75Z" fill="${MOOD_INNER}"/>` +
  `<path d="M18.4 10.2 19.85 4.05a.5.5 0 0 0-.78-.55L13.6 6.7Z" fill="${MOOD_FUR}"/>` +
  `<path d="M17.65 8.6 18.6 5.1l-2.7 1.75Z" fill="${MOOD_INNER}"/>`

const MOOD_EARS_BACK =
  `<path d="M5.3 10.4 2.9 5.0a.5.5 0 0 1 .6-.7l5.1 2.2Z" fill="${MOOD_FUR}"/>` +
  `<path d="M6.2 8.7 4.5 5.5l2.9 1.3Z" fill="${MOOD_INNER}"/>` +
  `<path d="M18.7 10.4 21.1 5.0a.5.5 0 0 0-.6-.7l-5.1 2.2Z" fill="${MOOD_FUR}"/>` +
  `<path d="M17.8 8.7 19.5 5.5l-2.9 1.3Z" fill="${MOOD_INNER}"/>`

// ── 眼睛 ──
// 睁眼：深棕眼珠 + 白色高光（emoji 经典画法）
const MOOD_EYE_OPEN_C =
  `<ellipse cx="9.4" cy="12.55" rx="1.4" ry="1.65" fill="${MOOD_EYE}"/>` +
  `<circle cx="9.9" cy="11.95" r="0.55" fill="${MOOD_WHITE}"/>` +
  `<ellipse cx="14.6" cy="12.55" rx="1.4" ry="1.65" fill="${MOOD_EYE}"/>` +
  `<circle cx="15.1" cy="11.95" r="0.55" fill="${MOOD_WHITE}"/>`

// 笑眼（^ ^）：向上弯的粗弧
const MOOD_EYE_HAPPY =
  `<path d="M8.05 12.95q1.35-1.65 2.7 0" fill="none" stroke="${MOOD_EYE}" stroke-width="1.2" stroke-linecap="round"/>` +
  `<path d="M13.25 12.95q1.35-1.65 2.7 0" fill="none" stroke="${MOOD_EYE}" stroke-width="1.2" stroke-linecap="round"/>`

// 睡眼：向下弯的弧
const MOOD_EYE_SLEEP =
  `<path d="M8.05 12.6q1.35 1.5 2.7 0" fill="none" stroke="${MOOD_EYE}" stroke-width="1.2" stroke-linecap="round"/>` +
  `<path d="M13.25 12.6q1.35 1.5 2.7 0" fill="none" stroke="${MOOD_EYE}" stroke-width="1.2" stroke-linecap="round"/>`

// 疲惫：半圆（上眼睑压下来的感觉）
const MOOD_EYE_HALF =
  `<path d="M8.05 12.95a1.35 1.35 0 0 1 2.7 0Z" fill="${MOOD_EYE}"/>` +
  `<path d="M13.25 12.95a1.35 1.35 0 0 1 2.7 0Z" fill="${MOOD_EYE}"/>`

// 专注：压扁的眼形
const MOOD_EYE_NARROW =
  `<ellipse cx="9.4" cy="12.65" rx="1.4" ry="0.92" fill="${MOOD_EYE}"/>` +
  `<circle cx="9.82" cy="12.3" r="0.42" fill="${MOOD_WHITE}"/>` +
  `<ellipse cx="14.6" cy="12.65" rx="1.4" ry="0.92" fill="${MOOD_EYE}"/>` +
  `<circle cx="15.02" cy="12.3" r="0.42" fill="${MOOD_WHITE}"/>`

// 不服气：斜眉 + 睁眼
const MOOD_EYE_ANGRY_C =
  `<path d="M7.85 10.15 10.5 11.6" fill="none" stroke="${MOOD_EYE}" stroke-width="1.15" stroke-linecap="round"/>` +
  `<path d="M16.15 10.15 13.5 11.6" fill="none" stroke="${MOOD_EYE}" stroke-width="1.15" stroke-linecap="round"/>` +
  MOOD_EYE_OPEN_C

// 爱心眼
const MOOD_EYE_HEART =
  `<path d="M9.4 13.95c-1.62-1.28-2.33-2.13-2.33-2.9a1.28 1.28 0 0 1 2.33-.72 1.28 1.28 0 0 1 2.33.72c0 .77-.71 1.62-2.33 2.9Z" fill="${MOOD_HEART}"/>` +
  `<path d="M14.6 13.95c-1.62-1.28-2.33-2.13-2.33-2.9a1.28 1.28 0 0 1 2.33-.72 1.28 1.28 0 0 1 2.33.72c0 .77-.71 1.62-2.33 2.9Z" fill="${MOOD_HEART}"/>`

// 星星眼：白星 + 深棕描边（黄底上才有对比）
const moodStarPath = (cx, cy) => {
  const R = 1.78, r = 0.82
  const pts = []
  for (let k = 0; k < 10; k++) {
    const a = (-90 + k * 36) * Math.PI / 180
    const rad = k % 2 === 0 ? R : r
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`)
  }
  return `M${pts.join('L')}Z`
}
const MOOD_EYE_STAR_C =
  `<path d="${moodStarPath(9.4, 12.35)}" fill="${MOOD_WHITE}" stroke="${MOOD_EYE}" stroke-width="0.55" stroke-linejoin="round"/>` +
  `<path d="${moodStarPath(14.6, 12.35)}" fill="${MOOD_WHITE}" stroke="${MOOD_EYE}" stroke-width="0.55" stroke-linejoin="round"/>`

// ── 鼻子与嘴 ──
// 鼻子收小成圆角小三角（初稿偏大，与嘴糊成一坨深色块）
const MOOD_NOSE_C =
  `<path d="M11.3 15.2h1.4a.38.38 0 0 1 .28.64l-.7.78a.38.38 0 0 1-.56 0l-.7-.78a.38.38 0 0 1 .28-.64Z" fill="${MOOD_LINE}"/>`

// 猫式 w 嘴：从鼻尖两侧向下分开，线条细一点更精致
const MOOD_MOUTH_W_C =
  `<path d="M12 16.6q-.8.72-1.6-.03" fill="none" stroke="${MOOD_LINE}" stroke-width="0.9" stroke-linecap="round"/>` +
  `<path d="M12 16.6q.8.72 1.6-.03" fill="none" stroke="${MOOD_LINE}" stroke-width="0.9" stroke-linecap="round"/>`

const MOOD_MOUTH_FLAT_C =
  `<path d="M10.8 16.7h2.4" fill="none" stroke="${MOOD_LINE}" stroke-width="0.9" stroke-linecap="round"/>`

const MOOD_MOUTH_FROWN_C =
  `<path d="M12 16.75q-.8-.7-1.6.04" fill="none" stroke="${MOOD_LINE}" stroke-width="0.9" stroke-linecap="round"/>` +
  `<path d="M12 16.75q.8-.7 1.6.04" fill="none" stroke="${MOOD_LINE}" stroke-width="0.9" stroke-linecap="round"/>`

// 张嘴：口腔 + 舌头（下移避开鼻尖）
const MOOD_MOUTH_OPEN_C =
  `<ellipse cx="12" cy="17.7" rx="1.5" ry="1.2" fill="${MOOD_MOUTH_IN}"/>` +
  `<ellipse cx="12" cy="18.2" rx="0.95" ry="0.5" fill="${MOOD_TONGUE}"/>`

// 吐舌：笑弧 + 悬垂的舌头
const MOOD_MOUTH_TONGUE_C =
  `<path d="M10.7 16.6q1.3 1.0 2.6 0" fill="none" stroke="${MOOD_LINE}" stroke-width="0.9" stroke-linecap="round"/>` +
  `<path d="M11.3 17.15h1.4v.35a.7.7 0 0 1-1.4 0Z" fill="${MOOD_TONGUE}"/>`

// ── 腮红 ──
const MOOD_BLUSH_CIRC =
  `<ellipse cx="6.75" cy="15.35" rx="1.45" ry="0.92" fill="${MOOD_BLUSH_C}" opacity="0.8"/>` +
  `<ellipse cx="17.25" cy="15.35" rx="1.45" ry="0.92" fill="${MOOD_BLUSH_C}" opacity="0.8"/>`

// ── 装饰 ──
const MOOD_SWEAT_CIRC = `<path d="M19.35 8.35q1 1.35 1 2.25a1 1 0 0 1-2 0q0-.9 1-2.25Z" fill="${MOOD_SWEAT_C}"/>`
const MOOD_ZZZ_C =
  `<path d="M19.0 9.9h1.65l-1.65 2.05h1.65" fill="none" stroke="${MOOD_LINE}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="M17.5 13.75h1.25l-1.25 1.55h1.25" fill="none" stroke="${MOOD_LINE}" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>`

// 兴奋用的闪烁星（画在耳朵外侧空白处）
const MOOD_SPARKLE =
  `<path d="M20.3 8.1 20.7 9.0l.9.4-.9.4-.4.9-.4-.9-.9-.4.9-.4Z" fill="#FFD84D"/>` +
  `<path d="M3.7 8.1 4.1 9.0l.9.4-.9.4-.4.9-.4-.9-.9-.4.9-.4Z" fill="#FFD84D"/>`

Object.assign(ICON_PATHS, {
  // 种草 —— 爱心眼 + 猫式笑 + 腮红
  'mood-like': MOOD_EARS_UP + MOOD_HEAD_C + MOOD_EYE_HEART + MOOD_NOSE_C + MOOD_MOUTH_W_C + MOOD_BLUSH_CIRC,
  // 踩雷 —— 压眉瞪眼 + 撇嘴
  'mood-dislike': MOOD_EARS_BACK + MOOD_HEAD_C + MOOD_EYE_ANGRY_C + MOOD_NOSE_C + MOOD_MOUTH_FROWN_C,
  // 出发啦 —— 星星眼 + 张嘴 + 闪烁
  'mood-excited': MOOD_EARS_UP + MOOD_SPARKLE + MOOD_HEAD_C + MOOD_EYE_STAR_C + MOOD_NOSE_C + MOOD_MOUTH_OPEN_C + MOOD_BLUSH_CIRC,
  // 拍摄中 —— 专注眯眼
  'mood-focused': MOOD_EARS_UP + MOOD_HEAD_C + MOOD_EYE_NARROW + MOOD_NOSE_C + MOOD_MOUTH_FLAT_C,
  // 毛茸茸 —— 笑眼 + 猫式笑 + 腮红
  'mood-cozy': MOOD_EARS_UP + MOOD_HEAD_C + MOOD_EYE_HAPPY + MOOD_NOSE_C + MOOD_MOUTH_W_C + MOOD_BLUSH_CIRC,
  // 累了 —— 半闭眼 + 汗滴
  'mood-tired': MOOD_EARS_BACK + MOOD_HEAD_C + MOOD_EYE_HALF + MOOD_SWEAT_CIRC + MOOD_NOSE_C + MOOD_MOUTH_FLAT_C,
  // 好天气 —— 笑眼 + 吐舌 + 腮红
  'mood-sunny': MOOD_EARS_UP + MOOD_HEAD_C + MOOD_EYE_HAPPY + MOOD_NOSE_C + MOOD_MOUTH_TONGUE_C + MOOD_BLUSH_CIRC,
  // 收工啦 —— 睡眼 + Z
  'mood-rest': MOOD_EARS_BACK + MOOD_HEAD_C + MOOD_EYE_SLEEP + MOOD_ZZZ_C + MOOD_NOSE_C + MOOD_MOUTH_W_C
})

Component({
  properties: {
    name: {
      type: String,
      value: ''
    },
    size: {
      type: Number,
      value: 48
    },
    color: {
      type: String,
      value: '#666666'
    },
    strokeWidth: {
      type: Number,
      value: 2
    },
    fill: {
      type: Boolean,
      value: false
    }
  },

  data: {
    src: ''
  },

  observers: {
    'name, color, size, strokeWidth, fill': function (name, color, size, strokeWidth, fill) {
      this._updateSrc()
    }
  },

  lifetimes: {
    attached() {
      this._updateSrc()
    }
  },

  methods: {
    _updateSrc() {
      const { name, color, strokeWidth, fill } = this.properties
      const path = ICON_PATHS[name]
      if (!path) {
        this.setData({ src: '' })
        return
      }

      // 兽头心情图标是 emoji 风格的彩色实心图形，自带完整配色。
      // 若套用下面的通用渲染（stroke=color、fill=none），会把彩色图形改回
      // 单色描边，失去 emoji 观感；因此这类图标直接输出原始 SVG。
      if (name.indexOf('mood-') === 0) {
        const moodSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${path}</svg>`
        this.setData({
          src: 'data:image/svg+xml,' + encodeURIComponent(moodSvg)
        })
        return
      }

      const fillAttr = fill ? color : 'none'
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${fillAttr}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`

      this.setData({
        src: 'data:image/svg+xml,' + encodeURIComponent(svg)
      })
    }
  }
})
