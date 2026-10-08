// 内容安全解析层离线回归用例（不联网、不依赖云环境）
//
// 为什么需要它：checkText/checkImage 的**返回体解析**直接决定审核是开是关。
// 历史事故就是解析读错字段名（蛇形 errcode vs 驼峰 errCode）造成的：
//   ① 先被判成「违规」，全站发布/换头像/评论被 -3 拒绝；
//   ② 改成降级放行后，所有内容静默变成「未审核可见」，审核等于关闭。
// 用例里的返回体是按线上实测结果 1:1 抄下来的。
//
// 用法：node scripts/test-content-security.js
const Module = require('module')
const path = require('path')

// contentSecurity.js 在 require 时会 cloud.init()，这里用最小桩替代 wx-server-sdk。
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    return { init() {}, DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV' }
  }
  return originalLoad.apply(this, arguments)
}

const sec = require(path.join(__dirname, '..', 'cloudfunctions-shared', 'contentSecurity.js'))

let failed = 0
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) console.log(`      期望 ${JSON.stringify(expected)}\n      实际 ${JSON.stringify(actual)}`)
}

// ── 线上实测的 msgSecCheck 成功返回体（关键：驼峰 errCode，结论在 result 里）──
const CLEAN_TEXT_PAYLOAD = {
  detail: [
    { strategy: 'content_model', errcode: 0, suggest: 'pass', label: 100, prob: 90 },
    { strategy: 'keyword', errcode: 0 }
  ],
  result: { suggest: 'pass', label: 100 },
  traceId: '6ac74085-3cb32fa4-32069afd',
  errMsg: 'openapi.security.msgSecCheck:ok',
  errCode: 0
}

const pick = r => ({ pass: r.pass, moderationStatus: r.moderationStatus, degraded: !!r.degraded })

// 1) 正常文本：必须判通过，且不得标记降级
check('文案正常 → 通过（不降级）', pick(sec.parseSecResult(CLEAN_TEXT_PAYLOAD, 'text')),
  { pass: true, moderationStatus: 'approved', degraded: false })
check('文案正常 → suggest/label 解析正确',
  { suggest: sec.parseSecResult(CLEAN_TEXT_PAYLOAD, 'text').suggest, label: sec.parseSecResult(CLEAN_TEXT_PAYLOAD, 'text').label },
  { suggest: 'pass', label: '100' })

// 2) 结论为 review / risky：都是「需处理」，必须拒绝而不是放行
check('文案 review → 拒绝', pick(sec.parseSecResult({ errCode: 0, result: { suggest: 'review', label: 200 } }, 'text')),
  { pass: false, moderationStatus: 'rejected', degraded: false })
check('文案 risky → 拒绝', pick(sec.parseSecResult({ errCode: 0, result: { suggest: 'risky', label: 200 } }, 'text')),
  { pass: false, moderationStatus: 'rejected', degraded: false })

// 3) imgSecCheck 成功是没有结论体的（{ errCode: 0, errMsg: '...:ok' }）——
//    不能因为「没有 suggest」就判违规，否则所有图片都会被拒。
check('图片接口成功（无结论体）→ 通过', pick(sec.parseSecResult({ errCode: 0, errMsg: 'openapi.security.imgSecCheck:ok' }, 'image')),
  { pass: true, moderationStatus: 'approved', degraded: false })

// 4) 87014 是「违规」结论而非接口故障：必须拒绝，不能降级放行
check('图片 87014（违规）→ 拒绝且不降级', pick(sec.degradeFromError({ errCode: 87014, errMsg: 'risky image' }, 'image')),
  { pass: false, moderationStatus: 'rejected', degraded: false })
check('文案 87014（违规）→ 拒绝且不降级', pick(sec.degradeFromError({ errCode: 87014 }, 'text')),
  { pass: false, moderationStatus: 'rejected', degraded: false })

// 5) 真正的接口故障（权限未登记）→ 降级放行，并留下错误码供追溯
check('抛 -604101 → 降级放行', pick(sec.degradeFromError({ errCode: -604101, errMsg: 'permission denied' }, 'text')),
  { pass: true, moderationStatus: 'approved', degraded: true })
check('抛 -604101 → 记录错误码', sec.degradeFromError({ errCode: -604101 }, 'text').degradeCode, -604101)
check('抛未知异常 → 标记 exception', sec.degradeFromError(new Error('socket hang up'), 'text').degradeCode, 'exception')

// 6) 返回体空洞（既无错误码也无结论）→ 按不可用降级，且错误码不能丢成空白
check('空返回体 → 降级并标记 errcode-missing',
  sec.parseSecResult({}, 'text').degradeCode, 'errcode-missing')
check('空返回体 → 仍保证内容可见',
  pick(sec.parseSecResult({}, 'text')), { pass: true, moderationStatus: 'approved', degraded: true })

// 7) 蛇形 errcode 兼容（部分接口/老返回体仍是蛇形）
check('蛇形 errcode:0 → 通过', pick(sec.parseSecResult({ errcode: 0, result: { suggest: 'pass' } }, 'text')),
  { pass: true, moderationStatus: 'approved', degraded: false })

// 8) 降级事实必须能落库；未降级时不留冗余字段
check('未降级 → 无追溯字段', sec.moderationTraceFields({ moderationStatus: 'approved' }), {})
const trace = sec.moderationTraceFields({ moderationStatus: 'approved', degraded: true, degradeCode: -604101 })
check('降级 → 落库标记 + 错误码',
  { flag: trace.moderationDegraded, codes: trace.moderationDegradeCodes },
  { flag: true, codes: [-604101] })
check('降级（无错误码）→ 不产生空数组项',
  sec.moderationTraceFields({ degraded: true, degradeCode: undefined }).moderationDegradeCodes, [])

console.log(failed === 0 ? '\n全部用例通过' : `\n${failed} 个用例失败`)
process.exit(failed === 0 ? 0 : 1)
