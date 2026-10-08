/**
 * 拉黑过滤 端到端验证（写入路径）
 *
 * ── 为什么需要单独的脚本 ──
 * blockUser 明确拒绝「屏蔽自己」，而模拟器的 openid 是固定的，
 * 因此无法像其他 E2E 那样「自己发帖 → 拉黑自己 → 验证」。
 * 这里改为：由外部先向 posts 注入一条**作者为合成 openid** 的探针文档，
 * 再在本脚本里以「当前登录用户」的身份去读列表，验证过滤是否真的生效。
 *
 * 探针文档的注入与清理由调用方负责（见 scripts/README 或对话记录），
 * 本脚本只做「读 → 拉黑 → 读 → 解除 → 读」这条链路的断言，不改动业务数据。
 *
 * 用法：
 *   NODE_PATH=... node scripts/e2e-block-filter.js <合成作者openid> <探针帖子_id>
 */
const automator = require('miniprogram-automator')

const WS = 'ws://127.0.0.1:9420'

const authorOpenId = process.argv[2]
const postId = process.argv[3]
if (!authorOpenId || !postId) {
  console.error('用法: node scripts/e2e-block-filter.js <合成作者openid> <探针帖子_id>')
  process.exit(2)
}

const results = []
function check(name, pass, detail) {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

;(async () => {
  const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 })

  const call = async (name, data) => mp.evaluate(
    (fn, payload) => new Promise(res => {
      wx.cloud.callFunction({
        name: fn, data: payload,
        success: x => res({ ok: true, result: x.result }),
        fail: e => res({ ok: false, errMsg: String(e && (e.errMsg || e.message)) })
      })
    }), name, data || {}
  )

  /** 从 discover tab 读一页，返回 id 数组。 */
  const readIds = async () => {
    const r = await call('getPosts', { tab: 'discover', page: 1, pageSize: 50 })
    if (!r.ok || !r.result || r.result.code !== 0) {
      throw new Error(`getPosts 失败: ${r.errMsg || (r.result && r.result.message)}`)
    }
    return r.result.data.map(p => p._id)
  }

  try {
    // 0) 前置：确认未处于拉黑状态
    await call('blockUser', { action: 'unblock', targetOpenId: authorOpenId })

    // 1) 拉黑前：探针帖子应出现
    const before = await readIds()
    check('探针帖子在拉黑前可见', before.includes(postId),
      `列表 ${before.length} 条，命中=${before.includes(postId)}`)

    // 2) 拉黑
    const blk = await call('blockUser', { action: 'block', targetOpenId: authorOpenId })
    check('blockUser block 写入成功', blk.ok && (blk.result || {}).code === 0,
      `code=${blk.ok ? (blk.result || {}).code : '-'} msg=${(blk.result || {}).message || blk.errMsg || ''}`)

    // 3) status 应变为 true
    const st = await call('blockUser', { action: 'status', targetOpenId: authorOpenId })
    check('blockUser status 拉黑后为 true', st.ok && (st.result || {}).data && (st.result.data.blocked === true),
      JSON.stringify(st.ok ? st.result.data : st.errMsg))

    // 4) 拉黑后：探针帖子应消失
    const after = await readIds()
    check('拉黑后被拉黑作者的帖子不再返回', !after.includes(postId),
      `列表 ${after.length} 条，命中=${after.includes(postId)}`)

    // 5) 黑名单列表里应能看到该用户
    const ls = await call('blockUser', { action: 'list' })
    const arr = ((ls.result || {}).data || [])
    check('黑名单列表包含该用户', arr.some(u => (u.openId || u.blockedOpenId) === authorOpenId),
      `count=${arr.length}`)

    // 6) 解除拉黑
    const unb = await call('blockUser', { action: 'unblock', targetOpenId: authorOpenId })
    check('blockUser unblock 成功', unb.ok && (unb.result || {}).code === 0,
      `code=${unb.ok ? (unb.result || {}).code : '-'}`)

    // 7) 解除后：探针帖子应重新出现
    const restored = await readIds()
    check('解除拉黑后内容重新可见', restored.includes(postId),
      `列表 ${restored.length} 条，命中=${restored.includes(postId)}`)
  } finally {
    // 无论断言成败，都确保不留下拉黑关系
    await call('blockUser', { action: 'unblock', targetOpenId: authorOpenId }).catch(() => {})
    await mp.disconnect()
  }

  const failed = results.filter(r => !r.pass)
  console.log('\n──────────────────────────────')
  console.log(`共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
  if (failed.length) failed.forEach(f => console.log(`  - ${f.name} ${f.detail || ''}`))
  process.exit(failed.length ? 1 : 0)
})().catch(e => { console.error(String((e && e.stack) || e)); process.exit(1) })
