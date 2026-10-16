/**
 * 城市列表配置
 * 从 discover.js 中抽离，减少页面 JS 体积
 *
 * province 只服务展示层：足迹页的「省份徽章」按它聚合。
 * 城市与天气 / 逆解析的匹配键始终是 name（展示层映射见 config/city-labels.js），
 * 所以加字段不影响既有链路。省份与 mapApi.js 的 CITY_PRESETS.adcode 前缀一致
 * （如广州 440100 → 广东、苏州 320500 → 江苏），改动时两边要一起看。
 */

const CITY_CANDIDATES = [
  { name: '上海', lat: 31.2304, lng: 121.4737, province: '上海' },
  { name: '北京', lat: 39.9042, lng: 116.4074, province: '北京' },
  { name: '广州', lat: 23.1291, lng: 113.2644, province: '广东' },
  { name: '深圳', lat: 22.5431, lng: 114.0579, province: '广东' },
  { name: '杭州', lat: 30.2741, lng: 120.1551, province: '浙江' },
  { name: '成都', lat: 30.5728, lng: 104.0668, province: '四川' },
  { name: '南京', lat: 32.0603, lng: 118.7969, province: '江苏' },
  { name: '武汉', lat: 30.5928, lng: 114.3055, province: '湖北' },
  { name: '重庆', lat: 29.5630, lng: 106.5516, province: '重庆' },
  { name: '西安', lat: 34.3416, lng: 108.9398, province: '陕西' },
  { name: '苏州', lat: 31.2989, lng: 120.5853, province: '江苏' },
  { name: '天津', lat: 39.3434, lng: 117.3616, province: '天津' },
  { name: '青岛', lat: 36.0671, lng: 120.3826, province: '山东' },
  { name: '长沙', lat: 28.2282, lng: 112.9388, province: '湖南' },
  { name: '郑州', lat: 34.7466, lng: 113.6254, province: '河南' },
  { name: '合肥', lat: 31.8206, lng: 117.2272, province: '安徽' },
  { name: '福州', lat: 26.0745, lng: 119.2965, province: '福建' },
  { name: '厦门', lat: 24.4798, lng: 118.0894, province: '福建' },
  { name: '宁波', lat: 29.8683, lng: 121.5440, province: '浙江' },
  { name: '无锡', lat: 31.4912, lng: 120.3124, province: '江苏' },
  { name: '常州', lat: 31.8107, lng: 119.9741, province: '江苏' },
  { name: '南通', lat: 31.9802, lng: 120.8943, province: '江苏' },
  { name: '扬州', lat: 32.3932, lng: 119.4129, province: '江苏' },
  { name: '济南', lat: 36.6512, lng: 117.1201, province: '山东' },
  { name: '烟台', lat: 37.4645, lng: 121.4479, province: '山东' },
  { name: '大连', lat: 38.9140, lng: 121.6147, province: '辽宁' },
  { name: '沈阳', lat: 41.8057, lng: 123.4315, province: '辽宁' },
  { name: '长春', lat: 43.8171, lng: 125.3235, province: '吉林' },
  { name: '哈尔滨', lat: 45.8038, lng: 126.5349, province: '黑龙江' },
  { name: '石家庄', lat: 38.0428, lng: 114.5149, province: '河北' },
  { name: '太原', lat: 37.8706, lng: 112.5489, province: '山西' },
  { name: '呼和浩特', lat: 40.8426, lng: 111.7492, province: '内蒙古' },
  { name: '洛阳', lat: 34.6197, lng: 112.4540, province: '河南' },
  { name: '南昌', lat: 28.6820, lng: 115.8579, province: '江西' },
  { name: '昆明', lat: 25.0389, lng: 102.7183, province: '云南' },
  { name: '贵阳', lat: 26.6470, lng: 106.6302, province: '贵州' },
  { name: '南宁', lat: 22.8170, lng: 108.3669, province: '广西' },
  { name: '海口', lat: 20.0444, lng: 110.1999, province: '海南' },
  { name: '三亚', lat: 18.2528, lng: 109.5119, province: '海南' },
  { name: '兰州', lat: 36.0611, lng: 103.8343, province: '甘肃' },
  { name: '银川', lat: 38.4872, lng: 106.2309, province: '宁夏' },
  { name: '西宁', lat: 36.6171, lng: 101.7782, province: '青海' },
  { name: '乌鲁木齐', lat: 43.8256, lng: 87.6168, province: '新疆' },
  { name: '拉萨', lat: 29.6525, lng: 91.1721, province: '西藏' },
  { name: '香港', lat: 22.3193, lng: 114.1694, province: '香港' },
  { name: '澳门', lat: 22.1987, lng: 113.5439, province: '澳门' },
  { name: '台北', lat: 25.0330, lng: 121.5654, province: '台湾' }
]

/**
 * 城市名 → 省份。足迹页按省聚合时用它给老记录兜底
 * （早期记录没有 province 字段，内置城市一律按本表推导）。
 */
const PROVINCE_OF_CITY = CITY_CANDIDATES.reduce((acc, city) => {
  acc[city.name] = city.province
  return acc
}, {})

/** 城市名 → 地图坐标。键名沿用足迹页既有用法，避免每个调用方各建一份。 */
const CITY_MAP = CITY_CANDIDATES.reduce((acc, city) => {
  acc[city.name] = { latitude: city.lat, longitude: city.lng }
  return acc
}, {})

module.exports = { CITY_CANDIDATES, PROVINCE_OF_CITY, CITY_MAP }
