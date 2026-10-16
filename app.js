/**
 * 读取系统信息（兼容封装）
 *
 * wx.getSystemInfoSync 自基础库 2.20.1 起被官方标记废弃，建议改用
 * getWindowInfo / getDeviceInfo / getAppBaseInfo 三个新接口。
 * 这里优先走新接口并合并为一个对象，保持 systemInfo 的既有字段名
 * （statusBarHeight / safeArea / windowWidth / windowHeight / pixelRatio 等）
 * 向后兼容；低版本基础库回退到旧接口。
 * @returns {object}
 */
function readSystemInfo() {
  if (typeof wx.getWindowInfo === 'function') {
    const windowInfo = wx.getWindowInfo() || {}
    const deviceInfo = typeof wx.getDeviceInfo === 'function' ? (wx.getDeviceInfo() || {}) : {}
    const appBaseInfo = typeof wx.getAppBaseInfo === 'function' ? (wx.getAppBaseInfo() || {}) : {}
    // 三个接口返回的字段互不冲突，合并后等价于旧的 systemInfo。
    return { ...windowInfo, ...deviceInfo, ...appBaseInfo }
  }
  return wx.getSystemInfoSync()
}

const { CLOUD_ENV_ID } = require('./config/env')

App({
  globalData: {
    userInfo: null,
    openId: null,
    isLoggedIn: false,
    statusBarHeight: 0,
    systemInfo: null,
    darkMode: false,
    currentCity: '定位中...',
    currentLatitude: null,
    currentLongitude: null,
    cityReady: false
  },

  // 简易事件总线
  _listeners: {},

  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  },

  off(event, fn) {
    if (!this._listeners[event]) return;
    if (typeof fn === 'function') {
      this._listeners[event] = this._listeners[event].filter(f => f !== fn);
    }
  },

  emit(event, data) {
    if (!this._listeners[event]) return;
    this._listeners[event].forEach(fn => fn(data));
  },

  setLoggedInUser(userInfo) {
    if (!userInfo || !userInfo.openId) return false;
    this.globalData.userInfo = userInfo;
    this.globalData.openId = userInfo.openId;
    this.globalData.isLoggedIn = true;
    wx.setStorageSync('userInfo', userInfo);
    this.emit('loginStateChanged', { isLoggedIn: true, userInfo });
    return true;
  },

  clearLoginState() {
    this.globalData.userInfo = null;
    this.globalData.openId = null;
    this.globalData.isLoggedIn = false;
    wx.removeStorageSync('userInfo');
    this.emit('loginStateChanged', { isLoggedIn: false, userInfo: null });
  },

  onLaunch() {
    // 云开发初始化
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: CLOUD_ENV_ID,
        traceUser: true
      });
    }

    // 获取系统信息
    try {
      const systemInfo = readSystemInfo();
      this.globalData.systemInfo = systemInfo;
      this.globalData.statusBarHeight = systemInfo.statusBarHeight || 20;
    } catch (e) {
      console.warn('获取系统信息失败:', e);
    }

    // 检查登录态
    this._checkLoginState();
    // 首次安装时没有本地 openId，也必须调用登录云函数，
    // 由云端 getWXContext() 取得真机用户身份。
    this.getOpenId(true);

    // 加载深色模式偏好
    this.globalData.darkMode = wx.getStorageSync('darkMode') || false;

    // 跟随微信客户端的系统主题变化，并通知已打开的页面刷新样式。
    if (typeof wx.onThemeChange === 'function') {
      wx.onThemeChange((res) => {
        this.globalData.darkMode = res.theme === 'dark';
        wx.setStorageSync('darkMode', this.globalData.darkMode);
        // 已打开的页面不会重新执行 onShow，直接同步其响应式状态。
        const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
        pages.forEach(page => {
          if (page && page.data && Object.prototype.hasOwnProperty.call(page.data, 'darkMode')) {
            page.setData({ darkMode: this.globalData.darkMode });
          }
        });
        this.emit('darkModeChange', this.globalData.darkMode);
      });
    }

    // 自动定位当前城市
    this._initCity();
  },

  /**
   * 启动时载入城市信息（只读缓存，不主动索取定位）
   *
   * ⚠️ 合规约束 —— 不要改回「启动即 wx.getLocation」：
   * 微信要求权限申请必须由用户主动操作触发，不得在小程序启动/首次进入时索取定位。
   * 因此这里只读本地缓存；没有可用缓存时把城市标为「待定位」，等用户点击城市徽章
   * 或定位按钮时再调 locateCity() 发起真实定位。
   */
  _initCity() {
    const CACHE_KEY = 'cached_city_info'

    try {
      const cached = wx.getStorageSync(CACHE_KEY)
      if (cached && cached.city) {
        const usable = cached.city !== '定位中...' && cached.city !== '定位失败' &&
          cached.city !== '未知城市' && cached.city !== '待定位'
        if (usable) {
          this.globalData.currentCity = cached.city
          this.globalData.currentLatitude = cached.latitude || null
          this.globalData.currentLongitude = cached.longitude || null
          this.globalData.cityReady = true
          this.emit('cityReady', cached)
          return
        }
      }
    } catch (e) { /* ignore */ }

    // 无可用缓存：保持「待定位」，不弹权限框。
    this.globalData.currentCity = '待定位'
    this.globalData.cityReady = true
    this.emit('cityReady', { city: '待定位' })
  },

  /**
   * 用户主动发起的定位。
   *
   * 只能由点击等用户交互调用（城市徽章 / 定位 FAB / 在地图上选点），
   * 禁止在 onLaunch / onShow 里自动调用 —— 那是审核明确禁止的「启动即索权」。
   *
   * @returns {Promise<{ok: boolean, city?: string, denied?: boolean}>}
   *          denied 为 true 表示用户拒绝了位置授权，调用方可据此引导去设置页。
   */
  locateCity() {
    return new Promise(resolve => {
      wx.getLocation({
        type: 'gcj02',
        success: (res) => {
          const { latitude, longitude } = res
          this.globalData.currentLatitude = latitude
          this.globalData.currentLongitude = longitude
          this.callCloud('getCityByLocation', { latitude, longitude }).then(result => {
            const city = (result && result.code === 0 && result.data && result.data.city) || '定位失败'
            if (city === '定位失败') {
              this._cityFallback()
              resolve({ ok: false, city: this.globalData.currentCity })
              return
            }
            this._commitCity(city, latitude, longitude)
            resolve({ ok: true, city })
          }).catch(() => {
            this._cityFallback()
            resolve({ ok: false, city: this.globalData.currentCity })
          })
        },
        fail: (err) => {
          const denied = /auth\s*deny|denied|authorize/i.test(String((err && err.errMsg) || ''))
          this._cityFallback()
          resolve({ ok: false, denied, city: this.globalData.currentCity })
        }
      })
    })
  },

  /** 定位成功后的统一落地：写全局 + 写缓存 + 广播。 */
  _commitCity(city, latitude, longitude) {
    this.globalData.currentCity = city
    this.globalData.currentLatitude = latitude
    this.globalData.currentLongitude = longitude
    this.globalData.cityReady = true
    const info = { city, latitude, longitude, timestamp: Date.now() }
    try { wx.setStorageSync('cached_city_info', info) } catch (e) { /* ignore */ }
    this.emit('cityReady', info)
    return info
  },

  /**
   * 定位失败或接口失败时的兜底
   * 使用上一次成功的缓存（不限过期），否则显示“定位失败”
   */
  _cityFallback() {
    const CACHE_KEY = 'cached_city_info'
    try {
      const cached = wx.getStorageSync(CACHE_KEY)
      if (cached && cached.city && cached.city !== '定位中...' && cached.city !== '定位失败' && cached.city !== '未知城市' && cached.city !== '待定位') {
        this.globalData.currentCity = cached.city
        this.globalData.currentLatitude = cached.latitude || null
        this.globalData.currentLongitude = cached.longitude || null
      } else {
        this.globalData.currentCity = '定位失败'
      }
    } catch (e) {
      this.globalData.currentCity = '定位失败'
    }
    this.globalData.cityReady = true
    this.emit('cityReady', { city: this.globalData.currentCity })
  },

  _checkLoginState() {
    const userInfo = wx.getStorageSync('userInfo');
    // 确保 userInfo 存在且包含有效字段（防止空对象被当作登录态）
    if (userInfo && typeof userInfo === 'object' && userInfo.openId) {
      this.globalData.userInfo = userInfo;
      this.globalData.openId = userInfo.openId;
      this.globalData.isLoggedIn = true;
    } else if (userInfo && typeof userInfo === 'object' && Object.keys(userInfo).length === 0) {
      // 清除空对象缓存
      wx.removeStorageSync('userInfo');
    }
  },

  /**
   * 云函数调用封装（带 10 秒超时）
   */
  callCloud(name, data = {}) {
    const timeout = 10000
    let timeoutId
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('请求超时，请检查网络后重试')), timeout)
    })
    return Promise.race([
      wx.cloud.callFunction({ name, data }),
      timeoutPromise
    ]).then(res => {
      if (res.result && res.result.code === 0) {
        return res.result;
      }
      if (res.result) return res.result;
      return { code: 0, data: res.result };
    }).catch(err => {
      console.error(`云函数 [${name}] 调用失败:`, err);
      const errorText = String(err && (err.errMsg || err.message) || '')
      const isMissingFunction = String(err && err.errCode || '').includes('501000') || /501000|FUNCTION_NOT_FOUND/i.test(errorText)
      if (isMissingFunction) {
        const missingError = new Error(`云函数「${name}」尚未部署，请在云开发中部署后重试`)
        missingError.errCode = err.errCode || -501000
        missingError.cloudFunction = name
        throw missingError
      }
      throw err;
    }).finally(() => clearTimeout(timeoutId));
  },

  trackEvent(name, payload = {}) {
    // Analytics must never block the user-facing workflow.
    return this.callCloud('trackEvent', { name, payload }).catch(() => null)
  },

  /**
   * 列表 → 详情页的数据接力
   *
   * 详情页原本完全依赖云函数返回：一旦这条链路异常（例如依赖的集合缺失、
   * 云函数版本异常），用户点进去只能看到整页报错，而列表里明明已经有数据。
   * 列表页跳转前把这条动态暂存到内存，详情页就能先渲染内容，
   * 再用云函数结果增量补齐互动状态（是否已赞/收藏等）。
   * 只存内存、不上磁盘，退出小程序即消失。
   */
  setPostCache(post) {
    if (!post || !post._id) return;
    if (!this._postCache) this._postCache = {};
    this._postCache[post._id] = post;
    // 只保留最近 20 条，避免长会话内存膨胀
    const keys = Object.keys(this._postCache);
    if (keys.length > 20) delete this._postCache[keys[0]];
  },

  getPostCache(id) {
    return (this._postCache && this._postCache[id]) || null;
  },

  /**
   * 获取用户 openId
   */
  async getOpenId(forceRefresh = false) {
    if (this.globalData.openId && !forceRefresh) return this.globalData.openId;
    try {
      const res = await this.callCloud('login');
      const openId = res && res.data && res.data.openId;
      if (openId) {
        this.globalData.openId = openId;
        return openId;
      }
      if (res && res.code === -403) {
        this.globalData.openId = null;
        this.globalData.userInfo = null;
        this.globalData.isLoggedIn = false;
        wx.removeStorageSync('userInfo');
        this.emit('accountBlocked', { message: res.message || '账号不可用' });
        wx.showModal({ title: '账号不可用', content: res.message || '账号已被封禁，请联系管理员', showCancel: false });
      }
    } catch (e) {
      console.error('获取 openId 失败:', e);
    }
    return null;
  }
});
