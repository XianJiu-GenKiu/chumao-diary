/**
 * 出毛日记 - 公共工具
 * 所有页面共用的工具函数集中在此
 */

const app = getApp()


// ── 时间格式化 ──

/**
 * 格式化时间
 * @param {Date|string|number} date
 * @param {string} format - 'YYYY-MM-DD' | 'relative'
 */
function formatTime(date, format = 'YYYY-MM-DD') {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''

  const pad = n => String(n).padStart(2, '0')
  const map = {
    'YYYY': d.getFullYear(),
    'MM': pad(d.getMonth() + 1),
    'DD': pad(d.getDate()),
    'HH': pad(d.getHours()),
    'mm': pad(d.getMinutes()),
    'ss': pad(d.getSeconds())
  }

  if (format === 'relative') {
    const diff = Date.now() - d.getTime()
    const sec = Math.floor(diff / 1000)
    if (sec < 60) return '刚刚'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}分钟前`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}小时前`
    const day = Math.floor(hr / 24)
    if (day < 2) return '昨天'
    if (day < 7) return `${day}天前`
    if (day < 30) return `${Math.floor(day / 7)}周前`
    if (day < 365) return `${Math.floor(day / 30)}个月前`
    return `${Math.floor(day / 365)}年前`
  }

  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, m => map[m])
}

/**
 * 友好时间显示（今天显示时间，昨天显示"昨天"，同年显示月日，跨年显示完整日期）
 */
function getFriendlyTime(date) {
  if (!date) return ''
  const d = new Date(date)
  const now = new Date()
  const dayDiff = Math.floor((now - d) / 86400000)

  if (dayDiff === 0) return formatTime(date, 'HH:mm')
  if (dayDiff === 1) return '昨天'
  if (dayDiff < 7) return `${dayDiff}天前`
  if (d.getFullYear() === now.getFullYear()) return formatTime(date, 'MM-DD')
  return formatTime(date, 'YYYY-MM-DD')
}


// ── 导航栏布局 ──

/**
 * 计算自定义导航栏高度（statusBar + titleBar + navBar）
 * @returns {{ statusBarHeight: number, navBarHeight: number, totalNavHeight: number }}
 */
function getNavLayout() {
  // getSystemInfoSync 已废弃，改用 getWindowInfo（提供 statusBarHeight / safeArea）
  const systemInfo = app.globalData.systemInfo || wx.getWindowInfo()
  const safeArea = systemInfo.safeArea || {}
  const statusBarHeight = safeArea.top || systemInfo.statusBarHeight || 20
  const titleHeight = 48
  const navBarHeight = 44
  return {
    statusBarHeight,
    navBarHeight,
    totalNavHeight: statusBarHeight + titleHeight + navBarHeight
  }
}


// ── 防抖 ──

/**
 * 防抖函数
 * @param {Function} fn
 * @param {number} delay
 */
function debounce(fn, delay = 300) {
  let timer = null
  return function (...args) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), delay)
  }
}


// ── 分页加载器 ──

/**
 * 创建分页加载器
 * 用法：const pager = createPager({ cloudFn: 'xxx', dataKey: 'list' })
 *       Page({ data: { ...pager.initData() }, ... })
 *       this._pager.load(this, refresh)
 */
function createPager({ cloudFn, dataKey, pageSize = 10, buildParams, transform }) {
  let version = 0

  return {
    pageSize,

    /** 初始化分页 data 字段 */
    initData() {
      return { [dataKey]: [], page: 1, pageSize, hasMore: true, isLoading: false }
    },

    /**
     * 加载数据
     * @param {Page} ctx - Page 实例 (this)
     * @param {boolean} refresh - 是否重置列表
     * @param {object} extra - 额外参数
     */
    async load(ctx, refresh = false, extra = {}) {
      if (ctx.data.isLoading && !refresh) return

      const v = ++version
      const page = refresh ? 1 : ctx.data.page
      ctx.setData({ isLoading: true, errorMessage: '' })

      try {
        const params = buildParams
          ? { ...buildParams(ctx), ...extra, page, pageSize }
          : { ...extra, page, pageSize }

        const res = await app.callCloud(cloudFn, params)
        if (v !== version) return

        if (!res || res.code !== 0) {
          throw new Error((res && res.message) || '加载失败，请稍后重试')
        }

        let list = res.data || []
        if (transform) list = list.map(transform)

        ctx.setData({
          [dataKey]: refresh ? list : [...ctx.data[dataKey], ...list],
          page: page + 1,
          hasMore: typeof res.hasMore === 'boolean' ? res.hasMore : list.length >= pageSize,
          isLoading: false
        })

        return list
      } catch (err) {
        if (v !== version) return
        console.error(`[${cloudFn}] 加载失败:`, err)
        ctx.setData({ isLoading: false, errorMessage: '加载失败，请检查网络后重试' })
      }
    },

    /** 丢弃过期请求（用于 tab 切换等场景重置版本号） */
    reset() { version = 0 }
  }
}


// ── 图片上传 ──

/**
 * 读取本地文件体积（字节）。拿不到时返回 0，调用方按「未知」处理。
 * @param {string} filePath
 * @returns {Promise<number>}
 */
function getFileSize(filePath) {
  return new Promise(resolve => {
    const done = res => resolve(Number(res && res.size) || 0)
    const fail = () => resolve(0)
    try {
      const fs = wx.getFileSystemManager()
      if (fs && fs.getFileInfo) {
        fs.getFileInfo({ filePath, success: done, fail })
        return
      }
    } catch (e) { /* 退回 wx.getFileInfo */ }
    if (wx.getFileInfo) {
      wx.getFileInfo({ filePath, success: done, fail })
      return
    }
    resolve(0)
  })
}

/**
 * 压缩图片（减少上传体积和带宽消耗）
 * @param {string} src - 本地临时路径
 * @param {number} [maxBytes] - 目标体积上限。传了才会循环降质重压，不传保持旧行为
 * @returns {Promise<{filePath: string, size: number}>}
 */
async function compressForUpload(src, maxBytes) {
  const attempts = maxBytes ? [80, 60, 40, 25] : [80]
  let filePath = src
  let size = 0
  for (const quality of attempts) {
    try {
      const compressRes = await new Promise((resolve, reject) => {
        wx.compressImage({
          src,
          quality,
          compressedWidth: 1080,
          success: resolve,
          fail: reject
        })
      })
      if (compressRes && compressRes.tempFilePath) {
        filePath = compressRes.tempFilePath
        size = maxBytes ? await getFileSize(filePath) : 0
        if (!maxBytes || !size || size <= maxBytes) break
      }
    } catch (e) {
      console.warn('图片压缩失败，使用原图上传:', e.message)
      // 压缩失败时使用原图，由调用方做体积校验
      break
    }
  }
  return { filePath, size }
}

/**
 * 批量上传图片到云存储
 * @param {string[]} images - 本地临时路径或 cloud:// 路径
 * @param {string} folder - 云存储目录名
 * @param {object} [options] - { maxBytes } 体积上限；超出则抛错。不传则不做限制（与旧行为一致）
 * @returns {Promise<string[]>} 云文件 ID 列表
 */
async function uploadImages(images, folder = 'images', options = {}) {
  const maxBytes = Number((options && options.maxBytes) || 0)
  const urls = []
  for (const img of images) {
    if (img.startsWith('cloud://')) {
      urls.push(img)
      continue
    }

    const { filePath, size } = await compressForUpload(img, maxBytes)
    if (maxBytes && size > maxBytes) {
      throw new Error(`图片压缩后仍有 ${(size / 1024 / 1024).toFixed(1)}MB，请换一张更小的图片`)
    }

    const ext = filePath.split('.').pop().split('?')[0] || 'jpg'
    const cloudPath = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
    const res = await wx.cloud.uploadFile({ cloudPath, filePath })
    urls.push(res.fileID)
  }
  return urls
}


// ── 评论提交 ──

/**
 * 提交评论并返回构建好的评论对象（供乐观更新）
 * @param {object} params - { targetId, targetType, content, replyTo? }
 * @returns {Promise<object>} { success, comment?, message? }
 */
async function submitComment(params) {
  const res = await app.callCloud('comment-create', params)
  if (res.code !== 0) return { success: false, message: res.message || '评论失败' }

  const userInfo = app.globalData.userInfo || {}
  return {
    success: true,
    comment: {
      _id: res.data.commentId,
      content: params.content,
      userOpenId: app.globalData.openId,
      authorName: userInfo.nickname || userInfo.name || '我',
      authorAvatar: userInfo.avatar || userInfo.avatarUrl || '',
      likeCount: 0,
      createdAt: new Date(),
      createTimeText: '刚刚',
      _createTimeText: '刚刚',
      parentId: params.replyTo || null
    }
  }
}


// ── 下拉刷新包装 ──

/**
 * 包装 Promise，自动调用 wx.stopPullDownRefresh
 */
function stopRefresh(promise) {
  Promise.resolve(promise).catch(() => {}).then(() => wx.stopPullDownRefresh())
}


// ── 乐观更新辅助 ──

/**
 * 切换布尔字段 + 计数字段的乐观更新
 * @returns {{ prev: boolean, prevCount: number }} 回滚用的旧值
 */
function toggleOptimistic(ctx, boolKey, countKey) {
  const prev = ctx.data[boolKey.replace(/^data\./, '')]
  const prevCount = ctx.data[countKey.replace(/^data\./, '')] || 0
  const next = !prev
  const nextCount = next ? prevCount + 1 : Math.max(prevCount - 1, 0)
  ctx.setData({ [boolKey]: next, [countKey]: nextCount })
  return { prev, prevCount }
}

/**
 * 回滚乐观更新
 */
function rollbackOptimistic(ctx, boolKey, countKey, snapshot) {
  ctx.setData({ [boolKey]: snapshot.prev, [countKey]: snapshot.prevCount })
}


// ── 深色模式同步 ──

/**
 * 深色模式变化事件名。
 * 集中定义，避免字符串在各页面散落 —— app.off 对不存在的监听是静默返回的，
 * 事件名拼错不会报错，只会表现为「偶发深色模式不刷新」，极难排查。
 */
const DARK_MODE_EVENT = 'darkModeChange'

/**
 * 让页面跟随全局深色模式变化（在 onLoad 中调用）。
 * 必须在 onUnload 中调用 unbindDarkMode，否则页面销毁后事件总线仍持有
 * 该页面的 setData 引用，造成内存泄漏与「已销毁页面 setData」告警。
 * @param {object} pageCtx - 页面 this
 */
function bindDarkMode(pageCtx) {
  pageCtx._onDarkModeChange = (value) => pageCtx.setData({ darkMode: value })
  app.on(DARK_MODE_EVENT, pageCtx._onDarkModeChange)
}

/**
 * 解除深色模式监听（在 onUnload 中调用，可安全重复调用）
 * @param {object} pageCtx - 页面 this
 */
function unbindDarkMode(pageCtx) {
  if (pageCtx._onDarkModeChange) {
    app.off(DARK_MODE_EVENT, pageCtx._onDarkModeChange)
    pageCtx._onDarkModeChange = null
  }
}


// ── 页面跳转兜底 ──

/**
 * toast 提示后返回上一页的统一封装。
 * 用于详情页缺少 id、分享链接失效、内容已删除等「不适合停留在当前页」的场景。
 * @param {string} message - 提示文案
 * @param {object} [options]
 * @param {number} [options.delay=1500] - 返回延迟（毫秒）
 * @param {string} [options.icon='none'] - toast 图标，删除成功等场景传 'success'
 */
function redirectWithToast(message, options = {}) {
  const { delay = 1500, icon = 'none' } = options
  wx.showToast({ title: message, icon })
  setTimeout(() => wx.navigateBack(), delay)
}


// ── 调试日志 ──

/**
 * 调试日志开关。
 * 关闭时 debugLog 完全不执行，正式包不会向用户日志输出任何调试信息。
 * 排查线上问题时把这里改为 true 重新上传即可，不必改业务代码。
 *
 * 注意：不要在业务代码里直接写 console.log —— 它在正式版中依然会输出，
 * 既污染用户日志，也会暴露内部实现细节。
 */
const DEBUG_LOG = false

/**
 * 调试日志（受 DEBUG_LOG 开关控制）
 * @param {...any} args
 */
function debugLog(...args) {
  if (DEBUG_LOG) console.log(...args)
}


// ── 错误状态处理 ──

/**
 * 统一的云函数错误处理
 * 设置页面的 errorState 数据，支持重试
 * @param {object} pageCtx - 页面 this
 * @param {Error} err - 错误对象
 * @param {string} retryMethod - 重试时调用的方法名
 * @param {string} customMessage - 自定义错误提示
 */
function handlePageError(pageCtx, err, retryMethod, customMessage) {
  console.error('页面错误:', err)
  const message = customMessage || (err && err.message) || '网络请求失败，请稍后重试'
  pageCtx.setData({
    errorState: {
      show: true,
      message,
      retryMethod
    }
  })
}

/**
 * 清除页面错误状态
 */
function clearPageError(pageCtx) {
  pageCtx.setData({ errorState: { show: false, message: '', retryMethod: '' } })
}

/**
 * 带超时的 Promise 包装
 * @param {Promise} promise - 原始 Promise
 * @param {number} ms - 超时毫秒
 * @param {string} msg - 超时提示
 */
function withTimeout(promise, ms = 10000, msg = '请求超时，请检查网络后重试') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))
  ])
}


module.exports = {
  formatTime,
  getFriendlyTime,
  getNavLayout,
  debounce,
  createPager,
  uploadImages,
  submitComment,
  stopRefresh,
  toggleOptimistic,
  rollbackOptimistic,
  bindDarkMode,
  unbindDarkMode,
  redirectWithToast,
  debugLog,
  DEBUG_LOG,
  handlePageError,
  clearPageError,
  withTimeout,
  DARK_MODE_EVENT
}
