#!/usr/bin/env node
/**
 * 提审前合规项自检（纯静态，不需要微信工具链）。
 *
 *   node scripts/audit-preflight.js
 *
 * 覆盖 2026-10-13 审计列出的四类缺口，任何一项回归都会在这里失败：
 *   1. 用户协议 / 隐私政策不得再承诺 UGC（动态分享、评论、他人内容、举报入口）
 *   2. 必须有账号自助注销入口，且服务端有对应云函数
 *   3. 用户提交的文字必须送内容安全审核
 *   4. app.json 的隐私相关声明（requiredPrivateInfos / 隐私协议框架开关）
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const readJson = p => JSON.parse(read(p))

let failed = 0
function check(ok, label, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? `  —— ${detail}` : ''}`)
  if (!ok) failed++
}

console.log('提审前合规自检\n')

// ── 1. 协议文本不得再承诺 UGC ──
const agreement = read('pages/agreement/agreement.wxml')
// 「评论」只允许出现在明确的否定句里（如「不提供…评论…功能」）。
const ugcClaims = [
  ['动态分享', /动态分享/],
  ['评论互动/发布评论', /评论互动|发布评?论|评论等/],
  ['发布内容/发布地点', /您(发布|可以对)[^，。]{0,8}(的内容|发布)|(发布|上传)的?(地点|动态|内容)/],
  ['举报功能', /举报.{0,6}功能/],
  ['联系客服处理注销', /联系客服处理/]
]
for (const [label, re] of ugcClaims) {
  check(!re.test(agreement), `协议中不再出现「${label}」`, '仍有 UGC 表述，审核会认为功能与描述不符')
}
check(/注销账号/.test(agreement), '协议写明自助注销路径')
check(/由运营方[^。]{0,12}录入/.test(agreement), '协议写明地点由运营方录入（公开展示型）')

// ── 2. 账号注销：入口 + 云函数 ──
const settings = read('pages/settings/settings.js')
check(/label:\s*'注销账号'/.test(settings), '设置页有「注销账号」入口')
check(/^\s{2}deleteAccount\(\)\s*\{/m.test(settings), '设置页实现 deleteAccount()')
check(/callCloud\('deleteAccount'/.test(settings), '注销走 deleteAccount 云函数')
check(/clearLoginState\(\)/.test(settings), '注销后清理本地登录态')

const delFnPath = 'cloudfunctions/deleteAccount/index.js'
check(fs.existsSync(path.join(ROOT, delFnPath)), `云函数 ${delFnPath} 存在`)
if (fs.existsSync(path.join(ROOT, delFnPath))) {
  const delFn = read(delFnPath)
  // 身份必须取自服务端上下文，绝不能用客户端传参。
  check(/cloud\.getWXContext\(\)/.test(delFn), '注销身份取自 getWXContext，不接受客户端 openId')
  check(!/event\.(openId|openid|OPENID)/.test(delFn), '注销不接受客户端传入的 openId')
  check(/'users'/.test(delFn) && /openId/.test(delFn), '注销会删除 users 账号记录')
}

// ── 3. 用户提交的文字必须送审核 ──
const subFn = read('cloudfunctions/submitLocationFeedback/index.js')
check(/require\('\.\/contentSecurity'\)/.test(subFn), 'submitLocationFeedback 引入共享审核模块')
check(/checkText\(/.test(subFn), 'submitLocationFeedback 调用 checkText')
check(/moderationStatus === 'rejected'/.test(subFn), '审核拒绝时阻断写入')
check(/moderationTraceFields/.test(subFn), '审核结论随文档落库，便于补审')
check(
  fs.existsSync(path.join(ROOT, 'cloudfunctions/submitLocationFeedback/contentSecurity.js')),
  'contentSecurity.js 已分发到 submitLocationFeedback（跑 scripts/sync-shared.js）'
)
check(
  read('cloudfunctions/submitLocationFeedback/contentSecurity.js') === read('cloudfunctions-shared/contentSecurity.js'),
  'contentSecurity.js 副本与母本一致'
)

// ── 4. app.json 隐私声明 ──
const appJson = readJson('app.json')
const priv = appJson.requiredPrivateInfos || []
check(priv.includes('getLocation'), 'requiredPrivateInfos 含 getLocation')
check(priv.includes('chooseLocation'), 'requiredPrivateInfos 含 chooseLocation')
check(
  !!(appJson.permission && appJson.permission['scope.userLocation'] && appJson.permission['scope.userLocation'].desc),
  'scope.userLocation.desc 已填写'
)
check(appJson.__usePrivacyCheck__ === true, '已开启隐私协议框架 __usePrivacyCheck__')
check(/wx\.openPrivacyContract/.test(settings), '设置页可打开隐私保护指引')

console.log('')
if (failed) {
  console.error(`自检未通过：${failed} 项失败。`)
  process.exit(1)
}
console.log('自检通过：协议文本 / 注销入口 / 内容审核 / 隐私声明 全部就位。')
