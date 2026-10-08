/**
 * 云端 / 本地 云函数代码漂移审计
 *
 * 背景：本项目的小程序云开发资源已授权给腾讯云 CloudBase，
 *       微信开发者工具无法直接部署，只能通过 CloudBase 侧核对。
 *
 * 做法：逐个拉取云端函数详情（CodeInfo = 入口文件源码），
 *       与本地 cloudfunctions/<name>/index.js 逐字比对，
 *       输出「一致 / 不一致 / 本地缺失 / 云端缺失」四类结果。
 *
 * 用法：
 *   node scripts/audit-cloud-drift.js [envId]
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ENV_ID = process.argv[2] || 'your-cloud-env-id'
const PROJECT_ROOT = path.resolve(__dirname, '..')
const FN_ROOT = path.join(PROJECT_ROOT, 'cloudfunctions')
const CLI = 'C:/Users/123/.workbuddy/binaries/node/cli-connector-packages/node_modules/@cloudbase/cli/bin/tcb'
const NODE = process.execPath

function runTcb(args) {
  const out = execFileSync(NODE, [CLI, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024
  })
  return out
}

function parseJson(raw) {
  try {
    return JSON.parse(raw)
  } catch (e) {
    const i = raw.indexOf('{')
    const j = raw.lastIndexOf('}')
    if (i < 0 || j < 0) return null
    try { return JSON.parse(raw.slice(i, j + 1)) } catch (_) { return null }
  }
}

function normalize(text) {
  return String(text || '').replace(/\r\n/g, '\n').trim()
}

function main() {
  const listRaw = runTcb(['fn', 'list', '-e', ENV_ID, '--limit', '100', '--json'])
  const listJson = parseJson(listRaw)
  const payload = listJson && listJson.data
  // tcb 的 --json 结构为 { data: { Functions: [...] } }；这里做兼容兜底。
  const fns = (payload && payload.Functions) || (Array.isArray(payload) ? payload : [])
  if (!fns.length) {
    console.error('未能获取云函数列表')
    process.exit(1)
  }

  const localNames = fs.readdirSync(FN_ROOT).filter(n => {
    const p = path.join(FN_ROOT, n)
    return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'index.js'))
  })

  const cloudNames = fns.map(f => f.FunctionName)
  const rows = []

  for (const name of cloudNames) {
    let detail = null
    try {
      detail = parseJson(runTcb(['fn', 'detail', name, '-e', ENV_ID, '--json']))
    } catch (e) {
      rows.push({ name, verdict: '拉取失败', note: String(e.message).slice(0, 60) })
      continue
    }
    const d = (detail && detail.data) || {}
    const cloudCode = normalize(d.CodeInfo)
    const localPath = path.join(FN_ROOT, name, 'index.js')

    if (!fs.existsSync(localPath)) {
      rows.push({ name, verdict: '本地缺失', runtime: d.Runtime, modTime: d.ModTime, size: d.CodeSize })
      continue
    }
    const localCode = normalize(fs.readFileSync(localPath, 'utf8'))

    if (cloudCode === localCode) {
      rows.push({ name, verdict: '一致', runtime: d.Runtime, modTime: d.ModTime, size: d.CodeSize })
    } else {
      rows.push({
        name,
        verdict: '不一致（云端落后）',
        runtime: d.Runtime,
        modTime: d.ModTime,
        size: d.CodeSize,
        cloudBytes: Buffer.byteLength(cloudCode),
        localBytes: Buffer.byteLength(localCode),
        cloudHasEnsure: cloudCode.includes('ensureCollection'),
        localHasEnsure: localCode.includes('ensureCollection')
      })
    }
  }

  const localOnly = localNames.filter(n => !cloudNames.includes(n))

  const groups = {}
  for (const r of rows) (groups[r.verdict] = groups[r.verdict] || []).push(r)

  console.log('='.repeat(78))
  console.log(`环境: ${ENV_ID}`)
  console.log(`云端函数: ${cloudNames.length} 个 | 本地函数: ${localNames.length} 个`)
  console.log('='.repeat(78))
  for (const v of Object.keys(groups)) {
    console.log(`\n【${v}】${groups[v].length} 个`)
    for (const r of groups[v]) {
      let extra = ''
      if (r.verdict === '不一致（云端落后）') {
        extra = ` 云端${r.cloudBytes}B/本地${r.localBytes}B 云端有ensure=${r.cloudHasEnsure} 本地有ensure=${r.localHasEnsure}`
      }
      console.log(`   - ${r.name.padEnd(22)} ${String(r.runtime || '').padEnd(12)} ${r.modTime || ''}${extra}`)
    }
  }
  if (localOnly.length) {
    console.log(`\n【本地有、云端无】${localOnly.length} 个`)
    for (const n of localOnly) console.log(`   - ${n}`)
  }

  const outFile = path.join(PROJECT_ROOT, 'scripts', '.cloud-drift-report.json')
  fs.writeFileSync(outFile, JSON.stringify({ envId: ENV_ID, generatedAt: new Date().toISOString(), rows, localOnly }, null, 2))
  console.log(`\n明细已写入: ${outFile}`)
}

main()
