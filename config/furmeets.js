/**
 * 兽聚名录（内置配置）
 *
 * ⚠️ 定位说明（合规关键，改前必读）
 * 这里只是一份**只读的「成就标记库」**，不是活动系统。允许：运营方维护名录、
 * 用户在本机勾选「我去过」、统计自己去的次数。**禁止**在此基础上加：
 * 创建兽聚 / 报名 / 候补 / 参与人列表 / 「谁去过」/ 讨论区 / 评论 / 点赞 /
 * 倒计时 / 订阅消息提醒 / 指向某个兽聚的分享入口 —— 一旦出现任一，
 * 这块就变成「社交 - 活动」，与已删除的 events 模块同类，直接违反个人主体类目限制。
 *
 * 数据来源：**目前是按 47 城写的基础占位条目**，请替换为真实兽聚信息
 * （名称 / 月份以你的实际信息为准）。字段结构与地点库对齐，
 * 将来可平移为云端 `furmeets` 集合 + 运营方在 admin-console 录入，
 * 届时仍须保持「只读名录 + 本地打勾」的形态。
 */

/**
 * 城市显示名映射。
 *
 * 为什么需要它：`config/cities.js` 的 name 是查 adcode / 天气用的**匹配键**（如「香港」），
 * 直接改会破坏 adcode 查表；而展示文案应使用规范全称。
 * 所以这里只做**展示层**映射，不动 cities.js，也不影响任何云端查询。
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

/**
 * 兽聚名录。
 * city 必须与 `config/cities.js` 的 CITY_CANDIDATES[].name 完全一致（有自检脚本校验）。
 * months 是「通常举办的月份」，仅作静态说明，**不用于倒计时或提醒**。
 */
const FURMEETS = [
  // ── 一线 / 主要城市：每城 2 条 ──
  { id: 'sh-annual', city: '上海', name: '上海兽聚', months: [5], tip: '通常在春末举办，以当地兽圈公告为准' },
  { id: 'sh-summer', city: '上海', name: '上海夏日兽聚', months: [7], tip: '暑期场次，注意高温与防晒' },
  { id: 'bj-annual', city: '北京', name: '北京兽聚', months: [5], tip: '通常在春末举办' },
  { id: 'bj-autumn', city: '北京', name: '北京秋日兽聚', months: [10], tip: '秋季场次，昼夜温差大' },
  { id: 'gz-annual', city: '广州', name: '广州兽聚', months: [4], tip: '华南场次，注意回南天湿度' },
  { id: 'gz-winter', city: '广州', name: '广州冬日兽聚', months: [12], tip: '冬季是华南最舒适的出毛季节' },
  { id: 'sz-annual', city: '深圳', name: '深圳兽聚', months: [3], tip: '春季场次' },
  { id: 'sz-winter', city: '深圳', name: '深圳冬日兽聚', months: [12], tip: '冬季场次' },
  { id: 'hz-annual', city: '杭州', name: '杭州兽聚', months: [4], tip: '春季场次，西湖周边场地较多' },
  { id: 'hz-autumn', city: '杭州', name: '杭州秋日兽聚', months: [10], tip: '秋季场次' },
  { id: 'cd-annual', city: '成都', name: '成都兽聚', months: [4], tip: '春季场次' },
  { id: 'cd-autumn', city: '成都', name: '成都秋日兽聚', months: [10], tip: '秋季场次' },
  { id: 'nj-annual', city: '南京', name: '南京兽聚', months: [4], tip: '春季场次' },
  { id: 'nj-autumn', city: '南京', name: '南京秋日兽聚', months: [11], tip: '深秋场次，注意保暖' },
  { id: 'wh-annual', city: '武汉', name: '武汉兽聚', months: [4], tip: '春季场次' },
  { id: 'wh-autumn', city: '武汉', name: '武汉秋日兽聚', months: [10], tip: '秋季场次' },
  { id: 'cq-annual', city: '重庆', name: '重庆兽聚', months: [4], tip: '春季场次' },
  { id: 'cq-autumn', city: '重庆', name: '重庆秋日兽聚', months: [10], tip: '秋季场次' },
  { id: 'xa-annual', city: '西安', name: '西安兽聚', months: [5], tip: '春季场次' },
  { id: 'xa-autumn', city: '西安', name: '西安秋日兽聚', months: [10], tip: '秋季场次' },

  // ── 其他城市：每城 1 条 ──
  { id: 'su-annual', city: '苏州', name: '苏州兽聚', months: [4], tip: '春季场次，园林周边取景较多' },
  { id: 'tj-annual', city: '天津', name: '天津兽聚', months: [5], tip: '春季场次' },
  { id: 'qd-annual', city: '青岛', name: '青岛兽聚', months: [6], tip: '夏季海滨场次，注意风力' },
  { id: 'cs-annual', city: '长沙', name: '长沙兽聚', months: [4], tip: '春季场次' },
  { id: 'zz-annual', city: '郑州', name: '郑州兽聚', months: [5], tip: '春季场次' },
  { id: 'hf-annual', city: '合肥', name: '合肥兽聚', months: [4], tip: '春季场次' },
  { id: 'fz-annual', city: '福州', name: '福州兽聚', months: [4], tip: '春季场次' },
  { id: 'xm-annual', city: '厦门', name: '厦门兽聚', months: [11], tip: '秋冬是厦门最舒适的出毛季节' },
  { id: 'nb-annual', city: '宁波', name: '宁波兽聚', months: [4], tip: '春季场次' },
  { id: 'wx-annual', city: '无锡', name: '无锡兽聚', months: [4], tip: '春季场次' },
  { id: 'cz-annual', city: '常州', name: '常州兽聚', months: [4], tip: '春季场次' },
  { id: 'nt-annual', city: '南通', name: '南通兽聚', months: [4], tip: '春季场次' },
  { id: 'yz-annual', city: '扬州', name: '扬州兽聚', months: [4], tip: '春季场次' },
  { id: 'jn-annual', city: '济南', name: '济南兽聚', months: [5], tip: '春季场次' },
  { id: 'yt-annual', city: '烟台', name: '烟台兽聚', months: [6], tip: '夏季海滨场次' },
  { id: 'dl-annual', city: '大连', name: '大连兽聚', months: [6], tip: '夏季海滨场次，注意海风' },
  { id: 'sy-annual', city: '沈阳', name: '沈阳兽聚', months: [5], tip: '春季场次' },
  { id: 'cc-annual', city: '长春', name: '长春兽聚', months: [6], tip: '夏季场次（东北出毛窗口期较短）' },
  { id: 'hrb-annual', city: '哈尔滨', name: '哈尔滨兽聚', months: [7], tip: '夏季场次，冬季极寒不建议长时间户外' },
  { id: 'sjz-annual', city: '石家庄', name: '石家庄兽聚', months: [4], tip: '春季场次' },
  { id: 'ty-annual', city: '太原', name: '太原兽聚', months: [5], tip: '春季场次' },
  { id: 'hhht-annual', city: '呼和浩特', name: '呼和浩特兽聚', months: [7], tip: '夏季场次，昼夜温差大' },
  { id: 'ly-annual', city: '洛阳', name: '洛阳兽聚', months: [4], tip: '春季场次（牡丹花季人流较大）' },
  { id: 'nc-annual', city: '南昌', name: '南昌兽聚', months: [4], tip: '春季场次' },
  { id: 'km-annual', city: '昆明', name: '昆明兽聚', months: [3], tip: '四季如春，全年都较适宜出毛' },
  { id: 'gy-annual', city: '贵阳', name: '贵阳兽聚', months: [5], tip: '春季场次' },
  { id: 'nn-annual', city: '南宁', name: '南宁兽聚', months: [11], tip: '秋冬场次，夏季湿热不建议' },
  { id: 'hk-annual', city: '海口', name: '海口兽聚', months: [12], tip: '冬季场次，夏季高温不宜' },
  { id: 'sy2-annual', city: '三亚', name: '三亚兽聚', months: [1], tip: '冬季场次，注意紫外线强度' },
  { id: 'lz-annual', city: '兰州', name: '兰州兽聚', months: [7], tip: '夏季场次' },
  { id: 'yc-annual', city: '银川', name: '银川兽聚', months: [7], tip: '夏季场次，紫外线偏强' },
  { id: 'xn-annual', city: '西宁', name: '西宁兽聚', months: [7], tip: '夏季场次，高原紫外线强' },
  { id: 'wlmq-annual', city: '乌鲁木齐', name: '乌鲁木齐兽聚', months: [7], tip: '夏季场次，注意昼夜温差' },
  { id: 'ls-annual', city: '拉萨', name: '拉萨兽聚', months: [7], tip: '夏季场次，高原反应与强紫外线需注意' },
  { id: 'hk-hk', city: '香港', name: '中国香港兽聚', months: [8], tip: '夏季场次，室内场地为主' },
  { id: 'mo-mo', city: '澳门', name: '中国澳门兽聚', months: [8], tip: '夏季场次' },
  { id: 'tp-tp', city: '台北', name: '中国台湾兽聚', months: [2], tip: '冬春场次' }
]

/** id → 兽聚 */
const FURMEET_MAP = FURMEETS.reduce((acc, item) => {
  acc[item.id] = item
  return acc
}, {})

/** 按城市取兽聚列表 */
function listFurmeetsByCity(city) {
  return FURMEETS.filter(item => item.city === city)
}

/** 按 id 取单个兽聚 */
function findFurmeet(id) {
  return FURMEET_MAP[id] || null
}

/** 月份数组 → 展示文案，如 [5,10] → '5、10 月' */
function formatMonths(months) {
  if (!Array.isArray(months) || !months.length) return ''
  return `${months.join('、')} 月`
}

module.exports = {
  FURMEETS,
  FURMEET_MAP,
  CITY_LABELS,
  cityLabel,
  listFurmeetsByCity,
  findFurmeet,
  formatMonths
}
