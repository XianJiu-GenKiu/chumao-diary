#!/usr/bin/env node
/**
 * 生成地图标点 PNG（无第三方依赖，纯 Node zlib + 自写 PNG 编码）
 *
 * 产出：
 *   images/map/marker-footprint.png  品牌橙 —— 个人足迹点
 *   images/map/marker-furmeet.png    青绿   —— 兽聚点（与足迹点在成就地图上区分）
 *
 * 为什么要自己生成：微信 map 组件的 marker 需要 iconPath 指向真实图片文件，
 * 而项目里只有一张通用 /images/marker.png，无法在成就地图上区分「我去过的地方」
 * 与「我去过的兽聚」。
 *
 * 跑法：node scripts/gen-map-markers.js
 */

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'images', 'map')

// ── 最小 PNG 编码器（RGBA / 8bit / 无交错） ──

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePNG(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // color type: RGBA
  ihdr[10] = 0  // compression
  ihdr[11] = 0  // filter
  ihdr[12] = 0  // interlace

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ── 形状绘制（3x 超采样抗锯齿） ──

const W = 64
const H = 80
const SS = 3

function pointInTriangle(px, py, a, b, c) {
  const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1])
  const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1])
  const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1])
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

/**
 * @param {[number,number,number]} body 主体色
 * @param {[number,number,number]} accent 中心圆点色
 */
function renderPin(body, accent) {
  const cx = W / 2
  const cy = 25
  const r = 19
  const tailTipY = 76

  const tailVerts = pad => {
    const s = 1 + pad / 22
    const A = [cx - r * 0.66, cy + r * 0.30]
    const B = [cx + r * 0.66, cy + r * 0.30]
    const C = [cx, tailTipY]
    const gx = (A[0] + B[0] + C[0]) / 3
    const gy = (A[1] + B[1] + C[1]) / 3
    return [[A, B, C].map(p => [gx + (p[0] - gx) * s, gy + (p[1] - gy) * s])]
  }

  const tail = tailVerts(0)[0]
  const tailPad = tailVerts(2.6)[0]

  const inShape = (px, py, pad) => {
    const rr = r + pad
    const dx = px - cx
    const dy = py - cy
    if (dx * dx + dy * dy <= rr * rr) return true
    const t = pad ? tailPad : tail
    return pointInTriangle(px, py, t[0], t[1], t[2])
  }

  const rgba = Buffer.alloc(W * H * 4)
  const n = SS * SS

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let rAcc = 0, gAcc = 0, bAcc = 0, aAcc = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS
          const dx = px - cx
          const dy = py - cy
          const inDot = dx * dx + dy * dy <= (r * 0.42) * (r * 0.42)

          if (inShape(px, py, 0)) {
            if (inDot) { rAcc += accent[0]; gAcc += accent[1]; bAcc += accent[2] } else { rAcc += body[0]; gAcc += body[1]; bAcc += body[2] }
            aAcc += 255
          } else if (inShape(px, py, 2.6)) {
            rAcc += 255; gAcc += 255; bAcc += 255; aAcc += 255
          }
        }
      }
      const i = (y * W + x) * 4
      const cov = aAcc / n
      if (cov <= 0) continue
      // 颜色按覆盖到的子样本平均，避免边缘发暗
      const colored = aAcc / 255
      rgba[i] = Math.round(rAcc / colored)
      rgba[i + 1] = Math.round(gAcc / colored)
      rgba[i + 2] = Math.round(bAcc / colored)
      rgba[i + 3] = Math.round(cov)
    }
  }

  return encodePNG(W, H, rgba)
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const targets = [
    { file: 'marker-footprint.png', body: [0xd4, 0x89, 0x0e], accent: [255, 255, 255] }, // 品牌橙
    { file: 'marker-furmeet.png', body: [0x2e, 0x9e, 0x8f], accent: [255, 255, 255] }    // 青绿
  ]

  targets.forEach(t => {
    const png = renderPin(t.body, t.accent)
    const out = path.join(OUT_DIR, t.file)
    fs.writeFileSync(out, png)
    console.log(`✅ ${path.relative(ROOT, out)}  ${png.length} bytes`)
  })
}

main()
