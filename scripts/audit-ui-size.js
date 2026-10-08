#!/usr/bin/env node
/**
 * UI 可交互元素尺寸审计
 *
 * 目标：找出「用户要点/要读」但尺寸过小的元素。
 *  - 可交互元素（按钮/标签/点击项）最小触控高度 88rpx(44px)、88rpx 宽
 *  - 可读文字最小 24rpx(12px)
 * 装饰元素（圆点、分割线、进度条、头像、骨架屏）不纳入。
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const MIN_FONT_RPX = 24
const MIN_TOUCH_RPX = 80

// 明确是「可点击/可操作」的类名关键词
const INTERACTIVE = /(^|[-_])(btn|button|action|link|tab|chip|filter|close|remove|delete|send|more|nav|switch|toggle|select|option|entry|item|tag|badge-btn|go|edit|add|submit|cancel|confirm|clear|search|input|picker|stepper-btn|dot-btn|play|pause|share|follow|like|fav|coupon|join|apply)([-_]|$)/i
// 明确是「纯装饰」的类名关键词 —— 命中则跳过
const DECORATIVE = /(dot|divider|handle|bar|track|line|placeholder|gradient|skeleton|sk-|mask|overlay|shadow|glow|ripple|indicator|active|wrap|avatar|cover|icon-only|bullet|decoration|::|progress|thumb|slider-track|rail|grid-line|dot-item)/i
// height 值极小（< 40rpx）基本是装饰线/点
const DECOR_HEIGHT_RPX = 40

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') || name === 'miniprogram_npm') continue
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name.endsWith('.wxss')) out.push(p)
  }
  return out
}

const toRpx = (val, unit) => {
  const n = parseFloat(val)
  if (isNaN(n)) return null
  return unit === 'px' ? n * 2 : n
}

const fontIssues = []
const touchIssues = []

for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  let selector = ''
  lines.forEach((line, i) => {
    const raw = line.trim()
    if (!raw || raw.startsWith('/*') || raw.startsWith('*') || raw.startsWith('//')) return
    if (raw.includes('{') && !raw.startsWith('@')) selector = raw.split('{')[0].trim().slice(0, 70)

    const fm = raw.match(/font-size\s*:\s*([0-9.]+)(px|rpx)/)
    if (fm) {
      const rpx = toRpx(fm[1], fm[2])
      if (rpx !== null && rpx < MIN_FONT_RPX) {
        fontIssues.push({ rel, line: i + 1, sel: selector, value: fm[0].replace(/.*:\s*/, ''), rpx: Math.round(rpx) })
      }
    }

    const hm = raw.match(/(?:^|[;{\s])(min-)?height\s*:\s*([0-9.]+)(px|rpx)/)
    if (hm) {
      const rpx = toRpx(hm[2], hm[3])
      if (rpx === null || rpx <= 0 || rpx >= MIN_TOUCH_RPX) return
      if (rpx < DECOR_HEIGHT_RPX) return
      if (DECORATIVE.test(selector)) return
      if (!INTERACTIVE.test(selector)) return
      touchIssues.push({ rel, line: i + 1, sel: selector, prop: (hm[1] || '') + 'height', value: hm[2] + hm[3], rpx: Math.round(rpx) })
    }
  })
}

console.log('════ 一、过小字号（< ' + MIN_FONT_RPX + 'rpx / 12px）共 ' + fontIssues.length + ' 处 ════')
let cur = ''
for (const it of fontIssues) {
  if (it.rel !== cur) { cur = it.rel; console.log('\n■ ' + cur) }
  console.log('   L' + it.line + '  ' + String(it.rpx).padStart(3) + 'rpx  [' + it.value + ']  ' + it.sel)
}

console.log('\n\n════ 二、过小可交互元素（height < ' + MIN_TOUCH_RPX + 'rpx / 40px）共 ' + touchIssues.length + ' 处 ════')
cur = ''
for (const it of touchIssues) {
  if (it.rel !== cur) { cur = it.rel; console.log('\n■ ' + cur) }
  console.log('   L' + it.line + '  ' + String(it.rpx).padStart(3) + 'rpx  ' + it.prop + ':' + it.value + '  ' + it.sel)
}
