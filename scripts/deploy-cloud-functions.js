#!/usr/bin/env node
/**
 * 出毛日记 · 云函数批量部署 / 一致性校验
 *
 * 背景：本机 `tcb fn deploy` 与 `tcb fn code update` 的代码上传路径不可用 ——
 * 命令会停在 `- [xxx] Function code updating...` 无限挂起（cos / zip 两种模式都挂，
 * 但 `tcb storage upload` 与 `tcb fn code download` 均正常，说明是上传实现本身的问题）。
 *
 * 因此本脚本改走 **腾讯云 SCF 原生接口 UpdateFunctionCode + ZipFile(base64)**：
 *   1) 本地用内置的极简 ZIP 写入器打包（index.js 置于包根，排除 node_modules）；
 *   2) base64 内联进请求体，通过 `tcb api scf UpdateFunctionCode` 提交；
 *   3) 用 `tcb fn detail` 返回的 CodeInfo 与本地 index.js 逐字符比对，确认真正落地。
 *
 * 函数级配置（Runtime / InstallDependency / Timeout 等）完全不动 ——
 * 只更新代码包，避免误改生产配置。
 *
 * 用法：
 *   node scripts/deploy-cloud-functions.js --dry-run        只打包并报告体积，不部署
 *   node scripts/deploy-cloud-functions.js --verify         只校验云端 index.js 与本地是否一致
 *   node scripts/deploy-cloud-functions.js                  部署全部本地云函数
 *   node scripts/deploy-cloud-functions.js --skip-unchanged 断点续传：本次已成功部署且包内容未变的跳过
 *   node scripts/deploy-cloud-functions.js rateLocation getPosts   只部署指定函数
 *
 * 注意：`--skip-unchanged` 依据 `scripts/.deploy-state.json` 里的**整包 sha256** 判断，
 * 不是比对云端 index.js —— 云端只回传 index.js，比对不出共享模块
 * （ensureCollection.js / visibility.js / contentSecurity.js 等）的变化。
 */

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const CLOUD_DIR = path.join(ROOT, 'cloudfunctions')
const ENV_ID = 'your-cloud-env-id'
const HANDLER = 'index.main'

// tcb CLI 的真实入口（sh 包装脚本最终 exec 的就是它）。
// 直接调入口可以避开 Windows cmd.exe 8191 字符的命令行长度限制。
// 候选路径覆盖「managed node」与「系统 node」两种布局。
const TCB_ENTRY = [
  path.join(path.dirname(path.dirname(process.execPath)), 'cli-connector-packages', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb'),
  path.join(path.dirname(process.execPath), 'cli-connector-packages', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb'),
  'C:/Users/123/.workbuddy/binaries/node/cli-connector-packages/node_modules/@cloudbase/cli/bin/tcb'
].map(p => p.replace(/\\/g, '/')).find(p => fs.existsSync(p))

// 打包时排除的文件/目录
const SKIP = new Set(['node_modules', '.git', '.DS_Store', 'package-lock.json', '__pycache__'])

/* ────────────────────────── 极简 ZIP 写入器 ────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

// 固定时间戳，保证同一份源码每次打出的包完全一致
const DOS_TIME = (12 << 11) | (0 << 5) | 0
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1

/**
 * @param {{name: string, data: Buffer}[]} entries
 * @returns {Buffer}
 */
function buildZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const deflated = zlib.deflateRawSync(data, { level: 9 })
    const useDeflate = deflated.length < data.length
    const payload = useDeflate ? deflated : data
    const method = useDeflate ? 8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)

    localParts.push(local, nameBuf, payload)
    centralParts.push(central, nameBuf)
    offset += local.length + nameBuf.length + payload.length
  }

  const centralDir = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDir, eocd])
}

/* ────────────────────────── 打包 ────────────────────────── */

function packFunction(fnName) {
  const dir = path.join(CLOUD_DIR, fnName)
  const files = fs.readdirSync(dir)
    .filter(name => !SKIP.has(name) && fs.statSync(path.join(dir, name)).isFile())
    .sort()
  const entries = files.map(name => ({ name, data: fs.readFileSync(path.join(dir, name)) }))
  if (!files.includes('index.js')) {
    throw new Error(`${fnName} 缺少 index.js，打包后函数会启动失败`)
  }
  const zip = buildZip(entries)
  return { zip, files, bytes: zip.length }
}

/* ────────────────────────── tcb 调用 ────────────────────────── */

// 单次 tcb 调用上限。没有它时，任意一次网络挂起都会让整批部署永久卡死
// （曾经卡死约 2 小时：execFileSync 默认无限等待）。
const TCB_TIMEOUT_MS = Number(process.env.TCB_TIMEOUT_MS || 120000)

function runTcb(args) {
  return execFileSync(process.execPath, [TCB_ENTRY, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: TCB_TIMEOUT_MS,
    killSignal: 'SIGKILL'
  })
}

function tcbJson(args) {
  const out = runTcb([...args, '--json'])
  const start = out.indexOf('{')
  if (start < 0) throw new Error(`未返回 JSON: ${out.slice(0, 200)}`)
  return JSON.parse(out.slice(start))
}

function deployOne(fnName, zip) {
  const body = {
    FunctionName: fnName,
    Namespace: ENV_ID,
    Handler: HANDLER,
    ZipFile: zip.toString('base64'),
    Publish: 'false'
  }
  const bodyJson = JSON.stringify(body)
  // 兜底：Windows CreateProcess 的命令行上限约 32767 字符
  if (bodyJson.length > 30000) {
    throw new Error(`请求体 ${bodyJson.length} 字符，超过命令行长度上限，需改走 COS 中转`)
  }
  const res = tcbJson([
    'api', 'scf', 'UpdateFunctionCode',
    '--api-version', '2018-04-16',
    '-e', ENV_ID,
    '--body', bodyJson
  ])
  if (res.error) throw new Error(res.error.message || JSON.stringify(res.error))
  return res.data && res.data.RequestId
}

function fetchDetail(fnName) {
  const res = tcbJson(['fn', 'detail', fnName, '-e', ENV_ID])
  if (res.error) throw new Error(res.error.message || JSON.stringify(res.error))
  return res.data
}

const normalize = text => String(text || '').replace(/\r\n/g, '\n').trim()

/**
 * execFileSync 抛错时 error.message 会把整条命令（含 base64 代码包）带进来，
 * 直接把日志撑爆。这里只保留「命令名 + 前 140 字符」，并附上 stderr 尾部。
 */
function explainExecError(err) {
  const signal = err && err.signal
  const code = err && err.code
  if (signal === 'SIGKILL' || code === 'ETIMEDOUT' || code === 'ABORT_ERR') {
    return `调用超时（>${TCB_TIMEOUT_MS}ms，已强制终止）`
  }
  const raw = String((err && err.message) || err)
  // error.message 形如 "Command failed: <cmd>\n<stderr>"
  const cleaned = raw.replace(/ZipFile":"[A-Za-z0-9+/=]{40,}"/g, 'ZipFile":"<base64 省略>"')
  const stderr = err && err.stderr ? String(err.stderr).replace(/ZipFile":"[A-Za-z0-9+/=]{40,}"/g, 'ZipFile":"<省略>"') : ''
  const parts = [cleaned.slice(0, 260)]
  if (stderr.trim()) parts.push(`stderr: ${stderr.trim().slice(0, 400)}`)
  if (err && err.code !== undefined) parts.push(`code=${err.code}`)
  return parts.join(' | ')
}

const STATE_PATH = path.join(__dirname, '.deploy-state.json')

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    return { functions: parsed.functions || {} }
  } catch {
    return { functions: {} }
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify({
    updatedAt: new Date().toISOString(),
    envId: ENV_ID,
    functions: state.functions
  }, null, 2))
}

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex')

/* ────────────────────────── 主流程 ────────────────────────── */

function main() {
  const argv = process.argv.slice(2)
  const flags = argv.filter(a => a.startsWith('--'))
  const names = argv.filter(a => !a.startsWith('--'))

  const dryRun = flags.includes('--dry-run')
  const verifyOnly = flags.includes('--verify')
  const skipUnchanged = flags.includes('--skip-unchanged')

  if (!fs.existsSync(TCB_ENTRY)) {
    console.error(`找不到 tcb 入口: ${TCB_ENTRY}`)
    process.exit(2)
  }

  const targets = names.length
    ? names
    : fs.readdirSync(CLOUD_DIR)
      .filter(name => fs.existsSync(path.join(CLOUD_DIR, name, 'index.js')))
      .sort()

  console.log(`环境: ${ENV_ID}`)
  console.log(`模式: ${dryRun ? '只打包（dry-run）' : verifyOnly ? '只校验' : '部署'}`)
  console.log(`目标: ${targets.length} 个云函数\n`)

  const report = []
  let deployed = 0
  let skipped = 0
  let failed = 0
  let mismatched = 0

  const state = loadState()

  for (const fnName of targets) {
    const label = fnName.padEnd(22)
    let packed
    try {
      packed = packFunction(fnName)
    } catch (err) {
      console.log(`  ✗ ${label} 打包失败: ${err.message}`)
      report.push({ fnName, ok: false, stage: 'pack', error: err.message })
      failed++
      continue
    }

    const zipSha = sha256(packed.zip)

    // 断点续传：本次已成功部署且包内容一字未改 → 跳过
    if (skipUnchanged && state.functions[fnName] && state.functions[fnName].zipSha === zipSha) {
      skipped++
      console.log(`  = ${label} 已部署且内容未变，跳过  ModTime ${state.functions[fnName].modTime}`)
      report.push({ fnName, ok: true, skipped: true, zipSha })
      continue
    }

    let detail = null
    try {
      detail = fetchDetail(fnName)
    } catch (err) {
      console.log(`  ✗ ${label} 读取云端信息失败: ${explainExecError(err)}`)
      report.push({ fnName, ok: false, stage: 'detail', error: explainExecError(err) })
      failed++
      continue
    }

    const localSource = normalize(fs.readFileSync(path.join(CLOUD_DIR, fnName, 'index.js'), 'utf8'))
    const wasInSync = normalize(detail.CodeInfo) === localSource

    if (dryRun) {
      console.log(`  · ${label} 包 ${String(packed.bytes).padStart(5)}B  ${packed.files.length} 文件  ` +
        `云端${wasInSync ? '已一致' : '不一致(' + detail.ModTime + ')'}`)
      report.push({ fnName, ok: true, dryRun: true, zipBytes: packed.bytes, inSync: wasInSync })
      continue
    }

    if (verifyOnly) {
      const ok = wasInSync
      if (!ok) mismatched++
      console.log(`${ok ? '  ✓' : '  ✗'} ${label} ${ok ? '云端与本地一致' : '云端与本地不一致'}  云端 ${detail.ModTime}`)
      report.push({ fnName, ok, stage: 'verify', inSync: ok, cloudModTime: detail.ModTime })
      continue
    }

    let requestId
    try {
      requestId = deployOne(fnName, packed.zip)
    } catch (err) {
      console.log(`  ✗ ${label} 部署失败: ${explainExecError(err)}`)
      report.push({ fnName, ok: false, stage: 'deploy', error: explainExecError(err) })
      failed++
      continue
    }

    // 回读校验：函数代码更新是异步生效的，轮询几次直到与本地一致
    let after = null
    let inSync = false
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        after = fetchDetail(fnName)
      } catch (err) {
        break
      }
      inSync = normalize(after.CodeInfo) === localSource
      if (inSync) break
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500)
    }

    if (inSync) {
      deployed++
      // 立即落盘：中途崩溃也不丢进度，续跑时可精确跳过
      state.functions[fnName] = {
        zipSha,
        files: packed.files,
        zipBytes: packed.bytes,
        modTime: after.ModTime,
        deployedAt: new Date().toISOString()
      }
      saveState(state)
      console.log(`  ✓ ${label} 已部署并校验一致  ModTime ${after.ModTime}  Runtime ${after.Runtime}  ${after.Status}`)
    } else {
      mismatched++
      // index.js 未回读一致时不记状态，续跑会重试
      console.log(`  ⚠ ${label} 已提交但回读仍不一致  ModTime ${after && after.ModTime}  Status ${after && after.Status}`)
    }
    report.push({
      fnName,
      ok: inSync,
      stage: 'deploy',
      requestId,
      inSync,
      zipSha,
      cloudModTime: after && after.ModTime,
      runtime: after && after.Runtime,
      status: after && after.Status,
      zipBytes: packed.bytes
    })
  }

  const out = path.join(__dirname, '.deploy-report.json')
  fs.writeFileSync(out, JSON.stringify({
    generatedAt: new Date().toISOString(),
    envId: ENV_ID,
    mode: dryRun ? 'dry-run' : verifyOnly ? 'verify' : 'deploy',
    summary: { total: targets.length, deployed, skipped, failed, mismatched },
    report
  }, null, 2))

  console.log(`\n汇总: 目标 ${targets.length}，部署并校验一致 ${deployed}，跳过 ${skipped}，失败 ${failed}，回读不一致 ${mismatched}`)
  console.log(`明细已写入 ${path.relative(ROOT, out)}`)
  process.exit(failed || mismatched ? 1 : 0)
}

// 作为 CLI 运行时才执行；被 require 时只导出工具函数，便于外部补记/校验部署状态。
if (require.main === module) main()

module.exports = {
  packFunction,
  sha256,
  fetchDetail,
  normalize,
  loadState,
  saveState,
  TCB_ENTRY,
  ENV_ID,
  CLOUD_DIR
}
