/**
 * 内容安全审核工具（统一版）
 *
 * 设计原则：安全但不阻断
 *
 * 三种结果，调用方据此决定如何处理：
 *   1) 审核通过     → { pass: true,  moderationStatus: 'approved' }
 *      内容正常公开。
 *   2) 明确违规     → { pass: false, moderationStatus: 'rejected' }
 *      调用方应拒绝写入，并提示用户修改。
 *      两种来源：① 接口调用成功且 suggest 不是 pass（review / risky）；
 *                ② 接口抛 87014（安全接口用错误码表达的违规结论）。
 *   3) 审核不可用   → { pass: true,  moderationStatus: 'approved', degraded: true, unavailable: true }
 *      调用方**允许写入，且内容按已过审对外可见**（记 approved）。
 *      ⚠️ 这里刻意不复用 pending：读侧（getLeaderboard / getEvents / getEventDetail /
 *      getLocationDetail / getSeasonalLocations）把 pending 定义为「仅作者本人可见」，
 *      一旦把「接口不可用」也标成 pending，就会出现「我发布成功了，别人却看不到」。
 *      降级事实通过 degraded + degradeCode 标注，并由调用方经
 *      moderationTraceFields() 落库（moderationDegraded），供日后筛出未审核内容补审。
 *
 * ⚠️ 字段命名坑（本项目最大的一个坑，改动前务必读 readErrCode 的注释）：
 *   云调用返回体是驼峰 errCode/errMsg，而微信 HTTP 文档写的是蛇形 errcode/errmsg。
 *   历史上只读 result.errcode → 永远 undefined → ①先被判成「违规」把全站发布链路
 *   全部拒掉；②改成降级放行后又让所有内容静默变成「未审核」，审核形同关闭。
 *
 * ── 云调用前置条件（务必确认）──
 * 云函数目录下必须有 config.json 声明接口权限，否则调用抛 -604101：
 *   { "permissions": { "openapi": ["security.msgSecCheck", "security.imgSecCheck"] } }
 *
 * msgSecCheck 2.0 必填参数：content / version=2 / scene / openid，
 * 其中 openid 对应的用户需在近两小时内访问过小程序，否则报 61010。
 *
 * 改动本模块后必须：scripts/sync-shared.js 分发 → 部署所有依赖函数
 * → 跑 scripts/test-content-security.js（离线解析用例）与
 *   scripts/e2e-moderation-degrade.js（真实运行时）。
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 图片审核接口限制：超过 1 MiB 无法送审。
const MAX_IMAGE_BYTES = 1024 * 1024

// 场景枚举：1 资料；2 评论；3 论坛；4 社交日志
const SCENE = { PROFILE: 1, COMMENT: 2, FORUM: 3, LOG: 4 }

// 微信安全接口在「内容违规」时返回的历史错误码（imgSecCheck 1.0 / msgSecCheck 1.0）。
// 它是**业务结论**，不是接口故障，必须按违规处理，绝不能降级放行。
const RISKY_ERRCODE = 87014

/**
 * 读取云调用返回体 / 抛出错对象里的错误码。
 *
 * ⚠️ 这是本项目踩过的最大的一个坑，务必保留两种命名：
 *   wx-server-sdk 的 cloud.openapi 返回体用的是**驼峰** errCode / errMsg
 *   （实测 msgSecCheck 成功返回 { errCode: 0, errMsg: '...:ok', result, detail, traceId }），
 *   而微信 HTTP API 文档写的是**蛇形** errcode / errmsg。
 *   只读 result.errcode 会永远拿到 undefined，于是：
 *     ① 早期实现把 undefined 当成「非 0」→ 判为违规 → 全站发布/换头像/评论被 -3 拒绝；
 *     ② 改成降级放行后，又让所有内容静默变成「未审核可见」→ 审核形同关闭。
 *   两种命名都必须兼容，缺失时才视为「返回体不可用」。
 */
function readErrCode(payload) {
  if (!payload || typeof payload !== 'object') return undefined
  if (payload.errcode !== undefined && payload.errcode !== null) return payload.errcode
  if (payload.errCode !== undefined && payload.errCode !== null) return payload.errCode
  return undefined
}

/**
 * 把一次安全接口返回体解析成统一结论。
 * @param {object} result 云调用返回体
 * @param {'text'|'image'} kind
 * @returns {object} 统一结论（result / degraded / rejected）
 */
function parseSecResult(result, kind) {
  const isImage = kind === 'image'
  const warningUnavailable = isImage ? 'image_check_unavailable' : 'text_check_unavailable'

  const errcode = readErrCode(result)
  // msgSecCheck 2.0 把结论放在 result.result；imgSecCheck 直接放在顶层。
  const detail = (result && (result.result || result)) || null
  const suggest = detail ? detail.suggest : undefined
  const hasPayload = Boolean(detail && (suggest !== undefined || detail.label !== undefined))

  // 调用成功 = 明确 errCode 为 0，或没有错误码但拿到了可判读的结论体。
  // 两者都不满足 → 返回体不可用，按「未审核但可见」放行，并留下错误码/原文便于追溯。
  if (errcode !== 0 && !(errcode === undefined && hasPayload)) {
    const raw = SafeStringify(result)
    console.warn(`secCheck(${kind}) 接口不可用，降级放行（内容未审核）:`, errcode, raw.slice(0, 300))
    return {
      pass: true,
      suggest: 'review',
      label: '',
      moderationStatus: 'approved',
      degraded: true,
      degradeCode: errcode !== undefined ? errcode : 'errcode-missing',
      degradeMessage: String((result && (result.errmsg || result.errMsg)) || '').slice(0, 300),
      degradeRaw: raw.slice(0, 300),
      warning: warningUnavailable,
      errcode,
      unavailable: true
    }
  }

  // 走到这里说明接口调用成功：suggest 才是真正的审核结论。
  // pass / review / risky —— 只有 pass 放行，其余按「需人工复核」拒绝写入。
  // 成功但没有结论体的情况（imgSecCheck 成功即 { errCode: 0, errMsg: '...:ok' }）：
  // 该接口用错误码表达违规（87014，走异常），因此成功即视为通过。
  const resolvedSuggest = hasPayload ? suggest : 'pass'
  const pass = resolvedSuggest === 'pass'
  return {
    pass,
    suggest: resolvedSuggest || 'review',
    label: detail && detail.label !== undefined ? String(detail.label) : '',
    moderationStatus: pass ? 'approved' : 'rejected'
  }
}

/**
 * 云调用抛异常时的处理。
 *
 * 注意：wx-server-sdk 在 errCode ≠ 0 时是**抛异常**而不是返回错误体，
 * 而 87014（内容违规）同样通过抛异常传递 —— 它是业务结论而非接口故障，
 * 必须按违规拒绝，否则违规内容会被当成「接口不可用」直接放行写进库。
 */
function degradeFromError(err, kind) {
  const errcode = readErrCode(err)
  const errmsg = String((err && (err.errMsg || err.message)) || '').slice(0, 300)

  if (errcode === RISKY_ERRCODE) {
    console.warn(`secCheck(${kind}) 判定内容违规（${RISKY_ERRCODE}），拒绝写入`)
    return {
      pass: false,
      suggest: 'risky',
      label: String(RISKY_ERRCODE),
      moderationStatus: 'rejected'
    }
  }

  // 异常路径必须把原因带出来：只 console.warn 的话，云函数日志未开通时
  // 等于把「审核为什么不可用」彻底丢掉，库里查不到、返回值里也查不到。
  console.warn(`secCheck(${kind}) 调用异常，降级放行（内容未审核）:`, errcode, errmsg)
  return {
    pass: true,
    suggest: 'review',
    label: '',
    moderationStatus: 'approved',
    degraded: true,
    degradeCode: errcode !== undefined ? errcode : 'exception',
    degradeMessage: errmsg,
    warning: kind === 'image' ? 'image_check_unavailable' : 'text_check_unavailable',
    errcode,
    unavailable: true
  }
}

function SafeStringify(value) {
  try {
    return JSON.stringify(value) || ''
  } catch (e) {
    return '<unserializable>'
  }
}

/**
 * 文字内容安全检查（msgSecCheck 2.0）
 * @param {string} text 待检测文本
 * @param {object} [options]
 * @param {string} [options.openid] 用户 openid（2.0 版本必填）
 * @param {number} [options.scene] 场景枚举值，默认 4（社交日志）
 * @returns {Promise<{pass: boolean, suggest: string, label: string, moderationStatus: string, warning?: string, unavailable?: boolean}>}
 */
async function checkText(text, options = {}) {
  const content = String(text || '').trim()
  if (!content) {
    return { pass: true, suggest: 'pass', label: '', moderationStatus: 'approved' }
  }
  try {
    const payload = {
      content: content.slice(0, 600),
      // 2.0 版本必填；缺失会直接报 47001（参数缺失）。
      version: 2,
      scene: options.scene || SCENE.LOG
    }
    // openid 为 2.0 必填项；缺失时微信会报错，这里仅在拿到时才带上，
    // 由下面的异常分支按「审核不可用」处理，不影响内容写入。
    if (options.openid) payload.openid = options.openid

    // 返回体是 { errCode: 0, errMsg: '...:ok', result: { suggest, label }, detail, traceId }。
    // ⚠️ 是驼峰 errCode，不是文档里的蛇形 errcode —— 见 readErrCode() 的说明。
    return parseSecResult(await cloud.openapi.security.msgSecCheck(payload), 'text')
  } catch (err) {
    return degradeFromError(err, 'text')
  }
}

/**
 * 图片内容安全检查（imgSecCheck）
 * @param {string} fileID 云存储文件 ID
 * @param {object} [options]
 * @param {string} [options.openid] 用户 openid（接口要求，供后续扩展使用）
 * @returns {Promise<{pass: boolean, suggest: string, label: string, moderationStatus: string, warning?: string, unavailable?: boolean}>}
 */
async function checkImage(fileID, options = {}) {
  if (!fileID) {
    return { pass: true, suggest: 'pass', label: '', moderationStatus: 'approved' }
  }
  try {
    const fileRes = await cloud.downloadFile({ fileID })
    const fileContent = fileRes.fileContent
    if (!fileContent || fileContent.length > MAX_IMAGE_BYTES) {
      // 尺寸问题与「违规」区分开，便于前端给出准确文案。
      return {
        pass: false,
        suggest: 'review',
        label: '',
        moderationStatus: 'rejected',
        warning: 'image_too_large'
      }
    }
    // imgSecCheck 成功返回 { errCode: 0, errMsg: '...:ok' }（无结论体），
    // 违规通过 87014 抛异常表达 —— 两种情况都由统一解析处理。
    return parseSecResult(await cloud.openapi.security.imgSecCheck({
      media: { contentType: 'image/jpeg', value: fileContent }
    }), 'image')
  } catch (err) {
    // imgSecCheck 已停止维护（官方建议改用 mediaCheckAsync 异步审核），
    // 在未接入异步回调前，接口层面的不可用按「未审核但可见」放行，
    // 避免因接口下线而阻断发布；但 87014 仍按违规拒绝。
    return degradeFromError(err, 'image')
  }
}

/**
 * 批量图片审核（顺序执行，遇到失败即返回）
 * @param {string[]} fileIDs
 * @param {object} [options]
 */
async function checkImages(fileIDs, options = {}) {
  if (!Array.isArray(fileIDs) || fileIDs.length === 0) {
    return { pass: true, failedIndex: -1, moderationStatus: 'approved' }
  }
  for (let i = 0; i < fileIDs.length; i++) {
    const result = await checkImage(fileIDs[i], options)
    if (!result.pass) return { pass: false, failedIndex: i, ...result }
  }
  return { pass: true, failedIndex: -1, moderationStatus: 'approved' }
}

/**
 * 把审核结果转成用户可理解的提示文案
 * @param {object} result checkText / checkImages 的返回值
 * @param {string} kind 'text' | 'image'
 */
function describeFailure(result, kind) {
  if (result && result.warning === 'image_too_large') {
    return '图片体积过大，请压缩或换一张后再试'
  }
  if (result && (result.degraded || result.moderationStatus === 'pending')) {
    return kind === 'image'
      ? '图片审核服务暂不可用，内容将先按已通过保存'
      : '内容审核服务暂不可用，内容将先按已通过保存'
  }
  return kind === 'image' ? '图片包含违规内容，请更换后重新提交' : '内容包含违规信息，请修改后重新提交'
}

/**
 * 汇总多处审核结果，得出最终写入状态。
 * 只要有一处「明确违规」→ rejected；否则 → approved
 * （审核不可用已在上游归为 approved + degraded，因此这里不再产生 pending）。
 * @param {...object} results
 * @returns {'approved'|'rejected'|'pending'}
 */
function resolveModerationStatus(...results) {
  const list = results.filter(Boolean)
  if (list.some(item => item.moderationStatus === 'rejected')) return 'rejected'
  if (list.some(item => item.moderationStatus === 'pending')) return 'pending'
  return 'approved'
}

/**
 * 汇总审核结果里的「降级放行」事实，产出可直接落库的追溯字段。
 *
 * 为什么必须落库：审核接口不可用（云调用权限缺失、openid 长期未访问、
 * 参数被微信拒绝等）时内容会按 approved 写入，但它**实际上从未被审核过**。
 * 只写 approved 会让这批内容和「真的审核通过」的内容在库里完全无法区分——
 * 事后既筛不出未审核内容，也没法针对性补审，等于审核的窟窿永久不可见。
 * 降级时额外写入下列字段即可随时筛出来（`moderationDegraded: true`）。
 *
 * @param {...object} results 各次 checkText / checkImage / checkImages 的返回值
 * @returns {object} 需要 spread 进文档的字段；未发生降级时返回空对象（不留冗余字段）
 */
function moderationTraceFields(...results) {
  const degraded = results.filter(item => item && item.degraded)
  if (!degraded.length) return {}
  const codes = [...new Set(
    degraded
      .map(item => item.degradeCode)
      .filter(code => code !== undefined && code !== null)
  )]
  return {
    moderationDegraded: true,
    moderationDegradeCodes: codes,
    moderationDegradedAt: new Date()
  }
}

module.exports = {
  checkText,
  checkImage,
  checkImages,
  describeFailure,
  resolveModerationStatus,
  moderationTraceFields,
  // 以下导出供离线解析用例（scripts/test-content-security.js）使用：
  // 这层解析的正确性直接决定审核是开是关，必须可被单测覆盖。
  readErrCode,
  parseSecResult,
  degradeFromError,
  RISKY_ERRCODE,
  MAX_IMAGE_BYTES,
  SCENE
}
