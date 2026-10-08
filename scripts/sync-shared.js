#!/usr/bin/env node
/**
 * 共享模块分发与一致性校验
 *
 * 背景：微信云函数每个函数独立打包，云端不共享目录，因此
 * cloudfunctions-shared/ 下的共享模块必须复制进每个用到它的函数目录。
 * 手工复制容易漏改（例如 contentSecurity.js 有 6 份副本），故用本脚本分发与校验。
 *
 * 用法：
 *   node scripts/sync-shared.js          把母本分发到各函数目录（覆盖副本）
 *   node scripts/sync-shared.js --check  只校验副本与母本是否一致，不一致则退出码 1
 *
 * 注意：根目录的 package.json 已归档到 toolchain-backup/（避免小程序发布时
 * 触发 npm 依赖构建），因此本脚本不通过 npm run 调用，直接 node 运行。
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const SHARED_DIR = path.join(ROOT, 'cloudfunctions-shared')
const CLOUD_DIR = path.join(ROOT, 'cloudfunctions')

/**
 * 分发清单：模块名 → 需要该模块的云函数目录列表。
 * 新增共享模块或新增依赖方时，只需改这里。
 */
const MANIFEST = {
  'contentSecurity.js': [
    'addLocation',
    'comment-create',
    'createEvent',
    'post-create',
    'updateContent',
    'updateUserProfile'
  ],
  'mediaUrl.js': [
    'addLocation',
    'post-create',
    'comment-create',
    'xiaoju'
  ],
  'relationId.js': [
    'checkInLocation',
    'comment-create',
    'post-favorite',
    'post-like',
    'toggleCommentLike',
    'toggleFavorite',
    'toggleReaction',
    'blockUser'
  ],
  'visibility.js': [
    'getPosts',
    'getLocations',
    'searchLocations',
    'comment-list'
  ],
  // 拉黑（屏蔽）关系：读写双方共用同一套判定与过滤逻辑。
  'blocked.js': [
    'blockUser',
    'getPosts',
    'getLocations',
    'searchLocations',
    'comment-list'
  ],
  // 腾讯位置服务统一调用层：key 读取、请求封装、城市表。
  // 下列函数此前各自复制了一份 MAP_KEY 与 https 封装，并共用一个官方示例 key。
  'mapApi.js': [
    'getWeather',
    'getCityByLocation',
    'getCityCandidates',
    'getNearbyMapPoi',
    'suggestPlaces',
    'planRoute'
  ],
  // 集合自愈：这些函数是 likes / reactions / ratings / checkins /
  // events / event_likes / usage_events 的唯一（或首次）写入方
  'ensureCollection.js': [
    'createEvent',
    'checkInLocation',
    'post-like',
    'rateLocation',
    'toggleEventLike',
    'toggleReaction',
    'trackEvent',
    // 以下三个集合（favorites / messages）此前没有任何自愈调用方：
    // favorites 只被 toggleFavorite / post-favorite 写出，messages 只被
    // 各通知分支追加。集合不存在时写入会抛 -502005，表现为
    // 「第一个收藏的用户必定失败」「互动通知静默丢失」。
    'comment-create',
    'toggleFavorite',
    'post-favorite',
    // 拉黑关系表：首次拉黑时集合可能尚未存在
    'blockUser'
  ]
}

function md5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex')
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file)
  } catch (e) {
    return null
  }
}

const checkOnly = process.argv.includes('--check')
let mismatched = 0
let copied = 0
let missing = 0

console.log(checkOnly ? '校验共享模块一致性…' : '分发共享模块…')
console.log('')

for (const [moduleName, targets] of Object.entries(MANIFEST)) {
  const sourcePath = path.join(SHARED_DIR, moduleName)
  const source = readIfExists(sourcePath)

  if (!source) {
    console.error(`  ✗ 母本缺失: cloudfunctions-shared/${moduleName}`)
    missing++
    continue
  }
  const sourceHash = md5(source)
  console.log(`  ${moduleName}  (母本 ${sourceHash.slice(0, 8)}, ${targets.length} 个目标)`)

  for (const fnName of targets) {
    const fnDir = path.join(CLOUD_DIR, fnName)
    if (!fs.existsSync(fnDir)) {
      console.error(`      ✗ 云函数目录不存在: cloudfunctions/${fnName}`)
      missing++
      continue
    }
    const targetPath = path.join(fnDir, moduleName)
    const existing = readIfExists(targetPath)

    if (existing && md5(existing) === sourceHash) {
      console.log(`      = ${fnName} 已一致`)
      continue
    }

    if (checkOnly) {
      console.error(`      ✗ ${fnName} 与母本不一致${existing ? '（副本已过时）' : '（副本缺失）'}`)
      mismatched++
    } else {
      fs.writeFileSync(targetPath, source)
      console.log(`      → ${fnName} 已更新`)
      copied++
    }
  }
}

console.log('')
if (checkOnly) {
  if (mismatched || missing) {
    console.error(`校验失败：${mismatched} 个副本不一致，${missing} 个缺失。`)
    console.error('执行 `node scripts/sync-shared.js` 修复。')
    process.exit(1)
  }
  console.log('校验通过：所有副本与母本一致。')
} else {
  if (missing) {
    console.error(`完成，但有 ${missing} 个目标缺失，请检查 MANIFEST。`)
    process.exit(1)
  }
  console.log(copied ? `分发完成：更新了 ${copied} 个副本。` : '分发完成：所有副本已是最新。')
}
