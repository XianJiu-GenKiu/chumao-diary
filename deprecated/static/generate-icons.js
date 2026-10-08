/**
 * TabBar 图标生成脚本
 * 生成微信小程序 tabBar 所需的 PNG 图标文件
 * 使用纯代码生成 81x81 像素的 PNG 图标
 *
 * 运行方式: node static/generate-icons.js
 */

const fs = require('fs');
const path = require('path');

// PNG 文件结构生成器（不依赖任何第三方库）
function createPNG(width, height, pixelData) {
  // PNG 签名
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createChunk('IHDR', ihdrData);

  // IDAT chunk - 图像数据
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    rawData[rowOffset] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const dataOffset = (y * width + x) * 4;
      rawData[pixelOffset] = pixelData[dataOffset];     // R
      rawData[pixelOffset + 1] = pixelData[dataOffset + 1]; // G
      rawData[pixelOffset + 2] = pixelData[dataOffset + 2]; // B
      rawData[pixelOffset + 3] = pixelData[dataOffset + 3]; // A
    }
  }

  // zlib 压缩（使用 Node.js 内置 zlib）
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(rawData);
  const idat = createChunk('IDAT', compressed);

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// CRC32 计算
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }

  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 绘制像素辅助函数
function setPixel(data, x, y, width, r, g, b, a = 255) {
  const offset = (y * width + x) * 4;
  data[offset] = r;
  data[offset + 1] = g;
  data[offset + 2] = b;
  data[offset + 3] = a;
}

function fillCircle(data, cx, cy, radius, width, r, g, b, a = 255) {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      if (x < 0 || x >= width || y < 0 || y >= width) continue;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= radius) {
        // 边缘抗锯齿
        const edgeAlpha = dist > radius - 1 ? Math.max(0, (radius - dist)) * a : a;
        const offset = (y * width + x) * 4;
        // Alpha 混合
        const srcA = edgeAlpha / 255;
        const dstA = data[offset + 3] / 255;
        const outA = srcA + dstA * (1 - srcA);
        data[offset] = Math.round((r * srcA + data[offset] * dstA * (1 - srcA)) / outA);
        data[offset + 1] = Math.round((g * srcA + data[offset + 1] * dstA * (1 - srcA)) / outA);
        data[offset + 2] = Math.round((b * srcA + data[offset + 2] * dstA * (1 - srcA)) / outA);
        data[offset + 3] = Math.round(outA * 255);
      }
    }
  }
}

function fillRect(data, x1, y1, x2, y2, width, r, g, b, a = 255) {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (x >= 0 && x < width && y >= 0 && y < width) {
        setPixel(data, x, y, width, r, g, b, a);
      }
    }
  }
}

function fillRoundRect(data, x1, y1, x2, y2, radius, width, r, g, b, a = 255) {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (x >= 0 && x < width && y >= 0 && y < width) {
        // 检查是否在圆角内
        let inside = true;
        // 四个角
        if (x < x1 + radius && y < y1 + radius) {
          const dx = x - (x1 + radius);
          const dy = y - (y1 + radius);
          if (Math.sqrt(dx * dx + dy * dy) > radius) inside = false;
        }
        if (x > x2 - radius && y < y1 + radius) {
          const dx = x - (x2 - radius);
          const dy = y - (y1 + radius);
          if (Math.sqrt(dx * dx + dy * dy) > radius) inside = false;
        }
        if (x < x1 + radius && y > y2 - radius) {
          const dx = x - (x1 + radius);
          const dy = y - (y2 - radius);
          if (Math.sqrt(dx * dx + dy * dy) > radius) inside = false;
        }
        if (x > x2 - radius && y > y2 - radius) {
          const dx = x - (x2 - radius);
          const dy = y - (y2 - radius);
          if (Math.sqrt(dx * dx + dy * dy) > radius) inside = false;
        }
        if (inside) {
          setPixel(data, x, y, width, r, g, b, a);
        }
      }
    }
  }
}

// ==================== 图标绘制函数 ====================

const SIZE = 81;

/**
 * 发现图标 - 指南针/探索
 */
function drawDiscoverIcon(active) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const color = active ? [245, 166, 35] : [153, 153, 153]; // #F5A623 / #999999

  // 外圈
  fillCircle(data, 40, 40, 30, SIZE, ...color, 255);
  // 内圈（白色）
  fillCircle(data, 40, 40, 24, SIZE, 255, 255, 255, 255);

  // 指针 - 北（实心三角）
  const triPoints = [
    [40, 18], [35, 38], [45, 38]
  ];
  for (let y = 18; y <= 38; y++) {
    for (let x = 35; x <= 45; x++) {
      // 简单的三角形填充
      const progress = (y - 18) / (38 - 18);
      const halfWidth = progress * 5;
      if (Math.abs(x - 40) <= halfWidth) {
        setPixel(data, x, y, SIZE, ...color, 255);
      }
    }
  }

  // 指针 - 南（空心三角）
  for (let y = 42; y <= 58; y++) {
    for (let x = 37; x <= 43; x++) {
      const progress = (y - 42) / (58 - 42);
      const halfWidth = (1 - progress) * 3;
      if (Math.abs(x - 40) <= halfWidth) {
        setPixel(data, x, y, SIZE, ...color, 255);
      }
    }
  }

  // 中心点
  fillCircle(data, 40, 40, 3, SIZE, ...color, 255);

  return data;
}

/**
 * 发布图标 - 加号/创建
 */
function drawPublishIcon(active) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const color = active ? [245, 166, 35] : [153, 153, 153];

  // 圆形背景
  fillCircle(data, 40, 40, 30, SIZE, ...color, 255);

  // 加号（白色）
  // 横线
  fillRect(data, 25, 38, 55, 42, SIZE, 255, 255, 255, 255);
  // 竖线
  fillRect(data, 38, 25, 42, 55, SIZE, 255, 255, 255, 255);

  return data;
}

/**
 * 记录图标 - 日记本/书本
 */
function drawRecordsIcon(active) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const color = active ? [245, 166, 35] : [153, 153, 153];

  // 书本外框
  fillRoundRect(data, 18, 16, 62, 62, 6, SIZE, ...color, 255);

  // 书本内页（白色）
  fillRoundRect(data, 22, 20, 58, 58, 4, SIZE, 255, 255, 255, 255);

  // 书脊线
  fillRect(data, 38, 20, 40, 58, SIZE, ...color, 200);

  // 左页横线
  fillRect(data, 26, 30, 36, 31, SIZE, ...color, 180);
  fillRect(data, 26, 36, 34, 37, SIZE, ...color, 180);
  fillRect(data, 26, 42, 36, 43, SIZE, ...color, 180);
  fillRect(data, 26, 48, 32, 49, SIZE, ...color, 180);

  // 右页横线
  fillRect(data, 42, 30, 54, 31, SIZE, ...color, 180);
  fillRect(data, 42, 36, 52, 37, SIZE, ...color, 180);
  fillRect(data, 42, 42, 54, 43, SIZE, ...color, 180);
  fillRect(data, 42, 48, 50, 49, SIZE, ...color, 180);

  return data;
}

/**
 * 我的图标 - 用户头像
 */
function drawProfileIcon(active) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const color = active ? [245, 166, 35] : [153, 153, 153];

  // 头（圆形）
  fillCircle(data, 40, 30, 14, SIZE, ...color, 255);

  // 身体（半圆弧）
  for (let y = 48; y <= 72; y++) {
    for (let x = 12; x <= 68; x++) {
      const dx = (x - 40) / 28;
      const dy = (y - 48) / 24;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= 1) {
        const edgeAlpha = dist > 0.9 ? Math.max(0, (1 - dist) * 10) * 255 : 255;
        const offset = (y * SIZE + x) * 4;
        const srcA = edgeAlpha / 255;
        const dstA = data[offset + 3] / 255;
        const outA = srcA + dstA * (1 - srcA);
        if (outA > 0) {
          data[offset] = Math.round((color[0] * srcA + data[offset] * dstA * (1 - srcA)) / outA);
          data[offset + 1] = Math.round((color[1] * srcA + data[offset + 1] * dstA * (1 - srcA)) / outA);
          data[offset + 2] = Math.round((color[2] * srcA + data[offset + 2] * dstA * (1 - srcA)) / outA);
          data[offset + 3] = Math.round(outA * 255);
        }
      }
    }
  }

  return data;
}

// ==================== 生成并保存图标 ====================

const outputDir = path.join(__dirname);

const icons = [
  { name: 'tab-discover.png', draw: () => drawDiscoverIcon(false) },
  { name: 'tab-discover-active.png', draw: () => drawDiscoverIcon(true) },
  { name: 'tab-publish.png', draw: () => drawPublishIcon(false) },
  { name: 'tab-publish-active.png', draw: () => drawPublishIcon(true) },
  { name: 'tab-records.png', draw: () => drawRecordsIcon(false) },
  { name: 'tab-records-active.png', draw: () => drawRecordsIcon(true) },
  { name: 'tab-profile.png', draw: () => drawProfileIcon(false) },
  { name: 'tab-profile-active.png', draw: () => drawProfileIcon(true) }
];

console.log('开始生成 TabBar 图标...\n');

icons.forEach(icon => {
  const pixelData = icon.draw();
  const png = createPNG(SIZE, SIZE, Buffer.from(pixelData));
  const filePath = path.join(outputDir, icon.name);
  fs.writeFileSync(filePath, png);
  const sizeKB = (png.length / 1024).toFixed(1);
  console.log(`  [OK] ${icon.name} (${SIZE}x${SIZE}, ${sizeKB} KB)`);
});

console.log('\n图标生成完成！共 8 个文件。');
console.log('输出目录:', outputDir);
