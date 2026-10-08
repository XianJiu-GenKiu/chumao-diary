#!/usr/bin/env node
/**
 * 出毛日记 · 云数据库集合自举
 *
 * 背景：微信云开发的集合「首次写入才存在」，但多个写入路径依赖 ensureCollection，
 * 而 ensureCollection 只在函数**已部署的新版本**里才有。旧版本部署缺失时，
 * 第一个用户点收藏就会拿到 -502005，集合永远建不出来。
 *
 * 本脚本用 `tcb db nosql execute` 跑 MongoDB 原生命令，把代码引用但线上缺失的集合建出来。
 * 幂等：已存在的集合跳过。**只创建，不删除任何东西。**
 *
 * 用法：
 *   node scripts/create-missing-collections.js --dry-run   只列出差异
 *   node scripts/create-missing-collections.js             创建缺失集合
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const CLOUD_DIR = path.join(ROOT, 'cloudfunctions')
const ENV_ID = 'your-cloud-env-id'

const TCB_ENTRY = [
  path.join(path.dirname(path.dirname(process.execPath)), 'cli-connector-packages', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb'),
  path.join(path.dirname(process.execPath), 'cli-connector-packages', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb'),
  'C:/Users/123/.workbuddy/binaries/node/cli-connector-packages/node_modules/@cloudbase/cli/bin/tcb'
].map(p => p.replace(/\\/g, '/')).find(p => fs.existsSync(p))

function runTcb(args) {
  return execFileSync(process.execPath, [TCB_ENTRY, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
    killSignal: 'SIGKILL'
  })
}

function tcbJson(args) {
  const out = runTcb([...args, '--json'])
  const start = out.indexOf('{')
  if (start < 0) throw new Error(`未返回 JSON: ${out.slice(0, 300)}`)
  return JSON.parse(out.slice(start))
}

/** 代码里所有被引用的集合名 */
function referencedCollections() {
  const names = new Set()
  for (const dir of fs.readdirSync(CLOUD_DIR)) {
    const file = path.join(CLOUD_DIR, dir, 'index.js')
    if (!fs.existsSync(file)) continue
    const src = fs.readFileSync(file, 'utf8')
    for (const m of src.matchAll(/collection\(\s*'([a-zA-Z_][a-zA-Z0-9_]*)'\s*\)/g)) names.add(m[1])
    for (const m of src.matchAll(/ensureCollection\(\s*db\s*,\s*'([a-zA-Z_][a-zA-Z0-9_]*)'\s*\)/g)) names.add(m[1])
  }
  return [...names].sort()
}

/** 线上现有集合（listCollections） */
function onlineCollections() {
  const res = tcbJson([
    'db', 'nosql', 'execute', '-e', ENV_ID,
    '--command', JSON.stringify([{
      TableName: 'users',
      CommandType: 'COMMAND',
      Command: JSON.stringify({ listCollections: 1, nameOnly: true })
    }])
  ])
  const found = []
  const walk = node => {
    if (!node || typeof node !== 'object') return
    if (node.name && node.type === 'collection') found.push(node.name)
    for (const value of Object.values(node)) walk(value)
  }
  walk(res)
  return [...new Set(found)].sort()
}

function createCollection(name) {
  const res = tcbJson([
    'db', 'nosql', 'execute', '-e', ENV_ID,
    '--command', JSON.stringify([{
      TableName: name,
      CommandType: 'COMMAND',
      Command: JSON.stringify({ create: name })
    }])
  ])
  const text = JSON.stringify(res)
  // 已存在（NamespaceExists / already exists）视为成功
  if (/already exists|NamespaceExists|CollectionAlreadyExist/i.test(text)) return { created: false, note: '已存在' }
  if (res.error) throw new Error(res.error.message || text.slice(0, 300))
  if (/"errmsg"\s*:\s*"[^"]+"/i.test(text)) throw new Error(text.slice(0, 300))
  return { created: true }
}

function main() {
  const dryRun = process.argv.includes('--dry-run')

  if (!TCB_ENTRY) {
    console.error('找不到 tcb 入口')
    process.exit(2)
  }

  console.log(`环境: ${ENV_ID}\n`)

  const need = referencedCollections()
  const have = onlineCollections()
  const missing = need.filter(n => !have.includes(n))
  const orphan = have.filter(n => !need.includes(n))

  console.log(`代码引用集合 ${need.length} 个，线上存在 ${have.length} 个`)
  console.log(`缺失 ${missing.length} 个: ${missing.join(' ') || '(无)'}`)
  console.log(`线上多余 ${orphan.length} 个: ${orphan.join(' ') || '(无)'}  （只报告，不删除）\n`)

  if (!missing.length) {
    console.log('无需创建。')
    return
  }

  if (dryRun) {
    console.log('（dry-run，未创建任何集合）')
    return
  }

  const results = []
  let ok = 0
  let skipped = 0
  let failed = 0

  for (const name of missing) {
    try {
      const r = createCollection(name)
      if (r.created) {
        ok++
        console.log(`  ✓ ${name.padEnd(18)} 已创建`)
      } else {
        skipped++
        console.log(`  = ${name.padEnd(18)} ${r.note}`)
      }
      results.push({ name, ...r })
    } catch (err) {
      failed++
      console.log(`  ✗ ${name.padEnd(18)} 创建失败: ${err.message}`)
      results.push({ name, error: err.message })
    }
  }

  const after = onlineCollections()
  const stillMissing = need.filter(n => !after.includes(n))

  fs.writeFileSync(path.join(__dirname, '.collections-report.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    envId: ENV_ID,
    referenced: need,
    onlineBefore: have,
    onlineAfter: after,
    created: results,
    stillMissing,
    orphan
  }, null, 2))

  console.log(`\n汇总: 创建 ${ok}，跳过 ${skipped}，失败 ${failed}`)
  console.log(`复查线上集合 ${after.length} 个: ${after.sort().join(' ')}`)
  if (stillMissing.length) console.log(`仍缺失: ${stillMissing.join(' ')}`)
  process.exit(failed ? 1 : 0)
}

main()
