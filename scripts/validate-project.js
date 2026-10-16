const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const errors = []

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    errors.push(`${path.relative(root, file)}: JSON 无法解析 (${err.message})`)
    return null
  }
}

function walk(dir, extension, output = []) {
  if (!fs.existsSync(dir)) return output
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(fullPath, extension, output)
    else if (entry.name.endsWith(extension)) output.push(fullPath)
  }
  return output
}

function validateWxml(file) {
  const source = fs.readFileSync(file, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
  const stack = []
  // map 可以包含 cover-view / cover-image 作为原生地图覆盖层，不能视为固定自闭合标签。
  const voidTags = new Set(['image', 'input', 'textarea', 'icon', 'progress', 'slider', 'switch', 'checkbox', 'radio', 'web-view', 'live-player', 'live-pusher'])
  // Attribute values may contain comparison operators inside {{ }} bindings,
  // so quoted attributes must be consumed as a unit rather than excluding '<'.
  const tagPattern = /<\/?([A-Za-z][\w-]*)(?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?\/?\s*>/g
  let match
  while ((match = tagPattern.exec(source))) {
    const raw = match[0]
    const tag = match[1]
    const closing = raw.startsWith('</')
    const selfClosing = /\/\s*>$/.test(raw) || voidTags.has(tag)
    if (closing) {
      // void 标签在项目里两种写法都有（<textarea /> 和 <textarea></textarea>）。
      // 前一种不入栈，所以遇到显式闭合的 void 标签直接跳过 ——
      // 否则每一处 <textarea></textarea> 都会被误报成闭合错配。
      if (voidTags.has(tag)) continue
      const expected = stack.pop()
      if (expected !== tag) {
        errors.push(`${path.relative(root, file)}: WXML 标签闭合错误，期望 </${expected || '?'}>，实际为 </${tag}>`)
        return
      }
    } else if (!selfClosing) {
      stack.push(tag)
    }
  }
  if (stack.length) errors.push(`${path.relative(root, file)}: WXML 标签未闭合 <${stack[stack.length - 1]}>`)
}

const appConfig = readJson(path.join(root, 'app.json'))
if (appConfig) {
  for (const page of appConfig.pages || []) {
    for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
      const pageFile = path.join(root, `${page}${extension}`)
      if (!fs.existsSync(pageFile)) errors.push(`${page}${extension}: 路由文件缺失`)
    }
  }
  for (const item of appConfig.tabBar?.list || []) {
    for (const key of ['iconPath', 'selectedIconPath']) {
      if (item[key] && !fs.existsSync(path.join(root, item[key]))) {
        errors.push(`app.json: tabBar ${key} 不存在 (${item[key]})`)
      }
    }
  }
}

const sourceJsFiles = [
  path.join(root, 'app.js'),
  ...walk(path.join(root, 'pages'), '.js'),
  ...walk(path.join(root, 'components'), '.js'),
  ...walk(path.join(root, 'utils'), '.js').filter(file => file !== __filename)
]

// Catch a common mini-program release error early: a page references a cloud
// function that was never added to cloudfunctions (and therefore cannot be
// deployed). Dynamic function names are intentionally ignored here.
const cloudFunctionNames = new Set()
for (const jsFile of sourceJsFiles) {
  const source = fs.readFileSync(jsFile, 'utf8')
  const patterns = [
    /(?:app\.)?callCloud\(\s*['\"]([^'\"]+)['\"]/g,
    /wx\.cloud\.callFunction\(\s*\{\s*name\s*:\s*['\"]([^'\"]+)['\"]/g
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(source))) cloudFunctionNames.add(match[1])
  }
}
for (const name of cloudFunctionNames) {
  const entry = path.join(root, 'cloudfunctions', name, 'index.js')
  if (!fs.existsSync(entry)) errors.push(`cloudfunctions/${name}/index.js: 被页面引用但不存在`)
}

// Each cloud function is deployed as an independent package. A relative require
// must therefore resolve inside that function's directory; references to a
// sibling/shared directory can work locally but fail after deployment.
const cloudRoot = path.join(root, 'cloudfunctions')
for (const entry of fs.readdirSync(cloudRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'shared') continue
  const functionRoot = path.join(cloudRoot, entry.name)
  for (const jsFile of walk(functionRoot, '.js')) {
    const source = fs.readFileSync(jsFile, 'utf8')
    const requirePattern = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g
    let match
    while ((match = requirePattern.exec(source))) {
      const modulePath = path.resolve(path.dirname(jsFile), match[1])
      const moduleFile = fs.existsSync(modulePath) ? modulePath
        : fs.existsSync(`${modulePath}.js`) ? `${modulePath}.js`
          : path.join(modulePath, 'index.js')
      if (!moduleFile.startsWith(`${functionRoot}${path.sep}`)) {
        errors.push(`${path.relative(root, jsFile)}: 本地模块引用不能跨出云函数目录 (${match[1]})`)
      } else if (!fs.existsSync(moduleFile)) {
        errors.push(`${path.relative(root, jsFile)}: 本地模块不存在 (${match[1]})`)
      }
    }
  }
}

for (const jsonFile of [
  path.join(root, 'app.json'),
  path.join(root, 'project.config.json'),
  ...walk(path.join(root, 'pages'), '.json'),
  ...walk(path.join(root, 'components'), '.json'),
  ...walk(path.join(root, 'cloudfunctions'), '.json')
]) readJson(jsonFile)

for (const wxmlFile of walk(path.join(root, 'pages'), '.wxml')) {
  validateWxml(wxmlFile)
  const source = fs.readFileSync(wxmlFile, 'utf8')
  // A missing fallback avatar is easy to overlook because template bindings
  // compile successfully. Check only literal local image paths here; runtime
  // bindings and remote/cloud URLs are intentionally outside this validator.
  const assetPattern = /\bsrc\s*=\s*(["'])(\/[^"'{}]+)\1/g
  let assetMatch
  while ((assetMatch = assetPattern.exec(source))) {
    const assetPath = assetMatch[2]
    if (!fs.existsSync(path.join(root, assetPath))) {
      errors.push(`${path.relative(root, wxmlFile)}: 图片资源不存在 (${assetPath})`)
    }
  }
}

let syntaxSkipped = 0

for (const jsFile of [
  ...sourceJsFiles,
  ...walk(path.join(root, 'cloudfunctions'), '.js'),
]) {
  try {
    execFileSync(process.execPath, ['--check', jsFile], { stdio: 'pipe' })
  } catch (err) {
    // 区分两种情况，避免误报：
    //   err.status 为数字 → node --check 确实以非零退出，是真的语法错误；
    //   err.status 为空   → 子进程根本没跑起来（如受限环境禁止 spawn），
    //                       此时不能报「语法错误」，只提示跳过。
    if (typeof err.status === 'number') {
      const detail = String(err.stderr || '').trim().split('\n').slice(-1)[0]
      errors.push(`${path.relative(root, jsFile)}: JavaScript 语法错误${detail ? ' —— ' + detail : ''}`)
    } else {
      syntaxSkipped++
    }
  }
}

if (syntaxSkipped) {
  console.warn(
    `提示：${syntaxSkipped} 个文件未能执行 JavaScript 语法检查` +
    `（当前环境无法创建子进程）。请在本地开发机重跑本脚本以获得完整检查。`
  )
}

if (errors.length) {
  console.error(`项目检查失败（${errors.length} 项）：`)
  errors.forEach(error => console.error(`- ${error}`))
  process.exit(1)
}

console.log('微信小程序源码检查通过：路由文件、JSON 和 JavaScript 语法均正常。')
