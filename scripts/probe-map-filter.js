/**
 * 出毛日记 · 地图页「类别筛选」布局探针
 *
 * 用途：验证筛选栏里的类别标签是否**全部完整可见**。
 *
 * 历史问题：旧版是单行横向 scroll-view（scroll-x + show-scrollbar=false），
 *   430px 屏下 4 个标签共需 470px、可视区只有 332px：
 *   第 3 个标签被裁一半、第 4 个完全看不到，且没有任何「可横向滑」的提示。
 * 修复后改为换行展示，本探针断言每个标签都完整落在可视区内。
 *
 * 用法：node scripts/probe-map-filter.js
 */
const fs = require('fs')
const path = require('path')

const WS = process.env.MP_WS || 'ws://127.0.0.1:9420'
const OUT = path.join(__dirname, '.probe-map-filter.json')
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  const automator = require('miniprogram-automator')
  const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 })
  console.log('已连接', WS)

  await mp.reLaunch('/pages/discover/discover')
  await sleep(4000)

  const result = await mp.evaluate(() => new Promise(resolve => {
    const pages = getCurrentPages()
    const page = pages[pages.length - 1]
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const query = wx.createSelectorQuery().in(page)

    query.select('.filter-section').boundingClientRect()
    query.select('.filter-container').boundingClientRect()
    query.select('.filter-list').boundingClientRect()
    query.select('.filter-all-btn').boundingClientRect()
    query.selectAll('.filter-tag').boundingClientRect()
    query.exec(res => {
      resolve({
        viewMode: page.data && page.data.viewMode,
        windowWidth: sys.windowWidth,
        section: res[0],
        container: res[1],
        list: res[2],
        allBtn: res[3],
        tags: res[4] || [],
        options: (page.data && page.data.quickFilterOptions || []).map(o => o.name)
      })
    })
  }))

  await mp.disconnect()

  const r = result
  const fmt = box => box
    ? `x=${box.left.toFixed(1)} y=${box.top.toFixed(1)} w=${box.width.toFixed(1)} h=${box.height.toFixed(1)} right=${(box.left + box.width).toFixed(1)} bottom=${(box.top + box.height).toFixed(1)}`
    : '(未取到)'

  console.log('')
  console.log('viewMode =', r.viewMode, '| 窗口', r.windowWidth)
  console.log('选项:', r.options.join(' / '))
  console.log('')
  console.log('.filter-section  ', fmt(r.section))
  console.log('.filter-container', fmt(r.container))
  console.log('.filter-list     ', fmt(r.list))
  console.log('.filter-all-btn  ', fmt(r.allBtn))
  console.log('')
  console.log('各标签:')
  r.tags.forEach((t, i) => console.log(`  [${i}] ${fmt(t)}  ${r.options[i] || ''}`))

  const problems = []

  if (!r.list || !r.section) {
    problems.push('筛选栏没有渲染出来（节点取不到）')
  } else {
    // 1) 数量对得上
    if (r.tags.length !== r.options.length) {
      problems.push(`标签渲染数量 ${r.tags.length} ≠ 数据 ${r.options.length}`)
    }

    // 2) 每个标签都要完整落在 .filter-list 的可视范围内
    const listRight = r.list.left + r.list.width
    const listBottom = r.list.top + r.list.height
    r.tags.forEach((t, i) => {
      const name = r.options[i] || `#${i}`
      if (t.left < r.list.left - 0.5) problems.push(`标签「${name}」左边超出容器`)
      if (t.left + t.width > listRight + 0.5) {
        problems.push(`标签「${name}」右边超出容器 ${(t.left + t.width - listRight).toFixed(1)}px（显示不全）`)
      }
      if (t.top < r.list.top - 0.5) problems.push(`标签「${name}」上边超出容器`)
      if (t.top + t.height > listBottom + 0.5) {
        problems.push(`标签「${name}」下边超出容器 ${(t.top + t.height - listBottom).toFixed(1)}px（被裁）`)
      }
      if (t.left + t.width > r.windowWidth + 0.5) problems.push(`标签「${name}」超出屏幕右边界`)
    })

    // 3) 标签区不能和「全部」按钮重叠
    if (r.allBtn && listRight > r.allBtn.left + 0.5) {
      problems.push('标签区与「全部」按钮重叠了')
    }

    // 4) 容器高度要能容纳换行后的行数
    const rows = new Set(r.tags.map(t => Math.round(t.top)))
    console.log('')
    console.log(`标签行数: ${rows.size} | 标签区高 ${r.list.height.toFixed(1)} | 区块高 ${r.section.height.toFixed(1)}`)
    const expected = rows.size * (r.tags[0] ? r.tags[0].height : 0) + (rows.size - 1) * 8
    if (r.list.height + 1 < expected) {
      problems.push(`标签区高度 ${r.list.height.toFixed(1)} 容不下 ${rows.size} 行（至少需 ${expected.toFixed(1)}）`)
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({ ...r, problems }, null, 2), 'utf8')
  console.log('')
  if (problems.length) {
    console.log('发现的问题:')
    problems.forEach(p => console.log('  - ' + p))
  } else {
    console.log(`所有 ${r.tags.length} 个类别标签都完整可见。`)
  }
  console.log('明细已写入:', OUT)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
