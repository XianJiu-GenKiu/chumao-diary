#!/usr/bin/env node
/**
 * 打包范围检查
 *
 * 按 project.config.json 的 packOptions.ignore 计算「实际会被上传的文件数与体积」，
 * 并按顶层目录汇总，用于发现意外被打包进小程序的大目录
 * （典型：cloudfunctions 下的 node_modules、.git、设计稿、交付物）。
 *
 * 用法：node scripts/check-package-scope.js
 *
 * 背景：曾因云函数目录下的 node_modules 合计约 370MB 被算进上传体积，
 * 导致小程序发布失败且界面不提示原因。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const configPath = path.join(ROOT, 'project.config.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const patterns = (config.packOptions && config.packOptions.ignore ? config.packOptions.ignore : [])
  .map(item => item.value)

/** 把 glob 转成正则：支持 `**`、`*`，其余字符按字面量处理 */
function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` 匹配任意层级（含 0 层），`**` 匹配任意字符
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2 } else { re += '.*'; i += 1 }
      } else {
        re += '[^/]*'
      }
    } else if ('\\^$.|?+()[]{}'.includes(ch)) {
      re += '\\' + ch
    } else {
      re += ch
    }
  }
  return new RegExp('^' + re + '$')
}

const matchers = patterns.map(globToRegExp)
const isIgnored = rel => matchers.some(re => re.test(rel))

let totalBytes = 0
let fileCount = 0
const byTop = Object.create(null)

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = path.relative(ROOT, full).split(path.sep).join('/')
    if (isIgnored(rel)) continue
    if (entry.isDirectory()) {
      walk(full)
    } else {
      const size = fs.statSync(full).size
      totalBytes += size
      fileCount++
      const top = rel.split('/')[0]
      byTop[top] = (byTop[top] || 0) + size
    }
  }
}

walk(ROOT)

const MB = 1024 * 1024
console.log(`打包范围内：${fileCount} 个文件，共 ${(totalBytes / MB).toFixed(2)} MB`)
console.log('')
console.log('按顶层条目汇总（降序）：')
Object.entries(byTop)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([name, size]) => {
    const kb = size / 1024
    const shown = kb >= 1024 ? (kb / 1024).toFixed(2) + ' MB' : kb.toFixed(1) + ' KB'
    console.log(`  ${name.padEnd(34)} ${shown}`)
  })

console.log('')
// 小程序主包上限 2MB、整包上限 20MB；这里给出体积预警
if (totalBytes > 20 * MB) {
  console.error(`⚠️  超出小程序整包上限 20MB，发布必然失败。请检查上表中占比过大的目录。`)
  process.exit(1)
} else if (totalBytes > 2 * MB) {
  console.warn('提示：已超过主包 2MB 上限，需确认是否已配置分包（subPackages）。')
} else {
  console.log('✅ 体积未超主包 2MB 上限。')
}
