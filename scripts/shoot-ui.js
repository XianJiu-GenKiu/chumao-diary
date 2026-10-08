#!/usr/bin/env node
/**
 * UI 视觉采样：逐页截图，用于人工比对尺寸调整前后的一致性。
 *
 * 用法：
 *   NODE_PATH=<node_modules> node scripts/shoot-ui.js <前缀>
 *   例：node scripts/shoot-ui.js before    → scripts/.ui/before-*.png
 *
 * 依赖开发者工具已开启自动化：cli.bat auto --project <dir> --auto-port 9420
 */
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')

const PREFIX = process.argv[2] || 'shot'
const OUT = path.resolve(__dirname, '.ui')
const WS = process.env.WB_WS || 'ws://127.0.0.1:9420'

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))

// 每页：路由 + 等待时间；detail 页用真实 id
const PAGES = [
  { name: 'discover', route: '/pages/discover/discover', wait: 5200 },
  { name: 'nearby-services', route: '/pages/nearby-services/nearby-services', wait: 4200 },
  { name: 'profile', route: '/pages/profile/profile', wait: 4600 },
  { name: 'post-create', route: '/pages/post-create/post-create', wait: 3600 },
  { name: 'location-upload', route: '/pages/location-upload/location-upload', wait: 3600 },
  { name: 'xiaoju-create', route: '/pages/xiaoju-create/xiaoju-create', wait: 3600 },
  { name: 'leaderboard', route: '/pages/leaderboard/leaderboard', wait: 3600 },
  { name: 'settings', route: '/pages/settings/settings', wait: 2600 },
  { name: 'nearby-services-2', route: '/pages/nearby-services/nearby-services', wait: 3000, pre: 'nearby' }
]

const DETAIL_PAGES = [
  { name: 'location-detail', route: '/pages/location-detail/location-detail?id=4a9432da6a677fd5019dd52d31b32e3f', wait: 5600 },
  { name: 'post-detail', route: '/pages/post-detail/post-detail?id=d666a8c26a5bbb0a00ee7c130fa1d59f', wait: 4800 },
  { name: 'xiaoju-detail', route: '/pages/xiaoju-detail/xiaoju-detail?id=bbb07a276abbe1e0006f3ffa7bffa53b', wait: 5200 },
  { name: 'events', route: '/pages/events/events', wait: 4200 },
  { name: 'search', route: '/pages/search/search', wait: 3000 },
  { name: 'messages', route: '/pages/messages/messages', wait: 3600 }
]

async function shoot(mp, item) {
  try {
    if (DETAIL_PAGES.includes(item) || item.route.includes('?')) {
      await mp.navigateTo(item.route)
    } else {
      const tabs = ['/pages/discover/discover', '/pages/posts/posts', '/pages/profile/profile']
      if (tabs.includes(item.route)) await mp.switchTab(item.route)
      else await mp.reLaunch(item.route)
    }
    await sleep(item.wait)
    const file = path.join(OUT, `${PREFIX}-${item.name}.png`)
    await mp.screenshot({ path: file })
    console.log('  ✓ ' + item.name + ' → ' + path.relative(process.cwd(), file))
  } catch (e) {
    console.log('  ✗ ' + item.name + ' : ' + String((e && e.message) || e).slice(0, 120))
  }
}

;(async () => {
  console.log('连接 ' + WS + ' …')
  const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 })
  console.log('已连接，开始采样（前缀 ' + PREFIX + '）\n')

  // 首页列表类
  for (const item of PAGES) await shoot(mp, item)
  // 详情类：回到首页再进，保证栈干净
  for (const item of DETAIL_PAGES) {
    try { await mp.reLaunch('/pages/discover/discover') } catch (e) {}
    await sleep(1600)
    await shoot(mp, item)
  }

  await mp.disconnect()
  console.log('\n完成。输出目录：' + OUT)
})().catch(e => {
  console.error('失败:', String((e && e.stack) || e))
  process.exit(1)
})
