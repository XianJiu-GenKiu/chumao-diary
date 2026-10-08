#!/usr/bin/env node
/**
 * 生成 tabBar「足迹」图标（爪印，81x81 PNG，无第三方依赖）
 *
 * 产出：
 *   images/tabbar/footprints.png         灰  #909090（未选中）
 *   images/tabbar/footprints-active.png  橙  #D4890E（选中）
 *
 * 跑法：node scripts/gen-tabbar-footprint.js
 */

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'images', 'tabbar')

// ── 最小 PNG 编码器（RGBA / 8bit） ──

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
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ── 爪印绘制（3x 超采样抗锯齿） ──

const W = 81
const H = 81
const SS = 3

/** 点是否在椭圆内（cx, cy 中心；rx, ry 半径；允许外扩 pad 抗锯齿） */
function inEllipse(px, py, cx, cy, rx, ry, pad) {
  const dx = (px - cx) / (rx + pad)
  const dy = (py - cy) / (ry + pad)
  return dx * dx + dy * dy <= 1
}

/** 爪印：一个大掌垫 + 上方弧线分布的 4 个趾垫 */
function inPaw(px, py, pad) {
  // 掌垫：底部偏大椭圆
  if (inEllipse(px, py, 40.5, 52, 16, 13.5, pad)) return true
  // 四个趾垫，沿上方弧线分布（左→右）
  if (inEllipse(px, py, 16, 33, 7.5, 9, pad)) return true
  if (inEllipse(px, py, 32, 22, 7.5, 9.5, pad)) return true
  if (inEllipse(px, py, 49, 22, 7.5, 9.5, pad)) return true
  if (inEllipse(px, py, 65, 33, 7.5, 9, pad)) return true
  return false
}

function renderPaw(rgb) {
  const rgba = Buffer.alloc(W * H * 4)
  const n = SS * SS
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let aAcc = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS
          if (inPaw(px, py, 0)) aAcc += 255
        }
      }
      const cov = aAcc / n
      if (cov <= 0) continue
      const i = (y * W + x) * 4
      rgba[i] = rgb[0]
      rgba[i + 1] = rgb[1]
      rgba[i + 2] = rgb[2]
      rgba[i + 3] = Math.round(cov)
    }
  }
  return encodePNG(W, H, rgba)
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const targets = [
    { file: 'footprints.png', rgb: [0x90, 0x90, 0x90] },
    { file: 'footprints-active.png', rgb: [0xd4, 0x89, 0x0e] }
  ]
  targets.forEach(t => {
    const png = renderPaw(t.rgb)
    const out = path.join(OUT_DIR, t.file)
    fs.writeFileSync(out, png)
    console.log(`OK ${path.relative(ROOT, out)}  ${png.length} bytes`)
  })
}

main()
