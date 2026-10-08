// 云函数：getMapSnapshot
// 调用腾讯位置服务「静态地图 API」，把指定坐标渲染成一张带标记的 PNG，
// 以 base64 data URL 返回给客户端 —— 用作 POI 卡片（外部地点无实拍图时）的封面背景。
// key 读取与 URL 拼装统一走共享模块 mapApi，不在本函数出现明文 key。
const cloud = require('wx-server-sdk')
const https = require('https')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { buildUrl } = require('./mapApi')

/** 拉取二进制响应体（静态图接口返回 PNG，不是 JSON） */
function getBuffer(url, timeout) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeout || 8000 }, res => {
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`静态地图服务返回 ${res.statusCode}`))
      }
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('静态地图请求超时')))
  })
}

exports.main = async (event) => {
  const latitude = Number(event.latitude)
  const longitude = Number(event.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { code: -1, message: '缺少有效的经纬度' }
  }
  const zoom = Math.min(18, Math.max(5, Math.floor(Number(event.zoom) || 15)))

  // 尺寸取 360x225（scale=1）：控制在卡片封面清晰度的下限之上，
  // 同时把 base64 体积压在 ~40KB，方便客户端安全缓存。
  const url = buildUrl('/ws/staticmap/v2/', {
    center: `${latitude},${longitude}`,
    zoom,
    size: '360*225',
    scale: 1,
    markers: `size:large|color:0xD4890E|${latitude},${longitude}`
  })

  try {
    const buf = await getBuffer(url)
    if (!buf || buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) {
      throw new Error('静态地图返回的不是 PNG 图片')
    }
    return { code: 0, data: { src: `data:image/png;base64,${buf.toString('base64')}` } }
  } catch (err) {
    console.error('getMapSnapshot 失败:', err)
    return { code: -1, message: '地图快照生成失败', error: String((err && err.message) || err) }
  }
}
