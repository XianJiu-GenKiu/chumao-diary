const app = getApp()
const { getNavLayout, bindDarkMode, unbindDarkMode } = require('../../utils/common')

Page({
  data: {
    statusBarHeight: 0,
    keyword: '',
    isFocused: true,
    suggestList: [],
    isSuggesting: false,
    hotKeywords: ['有换装间', '人少景美', '城市公园', '森林公园', '河边散步', '毛毛聚会', '夜景拍摄', '草地露营', '室内拍摄', '出片圣地'],
    historyList: [],
    resultList: [],
    isSearching: false,
    hasSearched: false,
    page: 1,
    pageSize: 10,
    hasMore: true,
    searchError: '',
    darkMode: false,
    sceneFilters: [
      { key: 'all', name: '全部' },
      { key: 'forest', name: '森林' },
      { key: 'urban', name: '城市' },
      { key: 'water', name: '水景' },
      { key: 'ancient', name: '古风' },
      { key: 'indoor', name: '室内' },
      { key: 'outdoor', name: '室外' },
      { key: 'shade', name: '遮阳' },
      { key: 'restroom', name: '厕所' },
      { key: 'changing', name: '换装' },
      { key: 'parking', name: '停车' }
    ],
    activeSceneFilter: 'all'
  },

  // 联想与正式搜索必须使用各自的版本号：共用同一个版本号时，
  // 输入触发的联想请求会让正在进行的正式搜索被判定为过期并丢弃，
  // 而 isSearching 又不会被复位，最终表现为骨架屏永久转圈。
  _suggestVersion: 0,
  _searchVersion: 0,
  _suggestTimer: null,

  onLoad(options) {
    const nav = getNavLayout()
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      totalNavHeight: nav.totalNavHeight,
      darkMode: app.globalData.darkMode || false
    })

    const history = wx.getStorageSync('searchHistory') || []
    this.setData({ historyList: history })

    if (options?.keyword) {
      this.setData({ keyword: options.keyword })
      this.doSearch(options.keyword)
    }
    // 深色模式实时同步（统一走 utils/common 的 bindDarkMode）
    bindDarkMode(this)
  },

  onUnload() {
    unbindDarkMode(this)
  },

  onInput(e) {
    const keyword = e.detail.value
    this.setData({ keyword })
    if (this._suggestTimer) clearTimeout(this._suggestTimer)
    if (!keyword.trim()) {
      this.setData({ suggestList: [] })
      return
    }
    this._suggestTimer = setTimeout(() => this._fetchSuggestions(keyword.trim()), 300)
  },

  async _fetchSuggestions(keyword) {
    if (!keyword || this.data.isSuggesting) return
    const version = ++this._suggestVersion
    this.setData({ isSuggesting: true })

    try {
      const res = await app.callCloud('suggestPlaces', { keyword, region: '全国' })
      if (version !== this._suggestVersion) return
      const list = (res && res.data) ? res.data : []
      this.setData({ suggestList: list.slice(0, 6), isSuggesting: false })
    } catch (err) {
      if (version !== this._suggestVersion) return
      console.error('联想失败:', err)
      this.setData({ isSuggesting: false })
    }
  },

  onSuggestTap(e) {
    const { keyword, item } = e.currentTarget.dataset
    this.setData({ keyword, suggestList: [] })

    if (item?._type === 'map_poi' && item.latitude && item.longitude) {
      const pages = getCurrentPages()
      const prevPage = pages[pages.length - 2]
      if (prevPage?.addSearchMarker) {
        prevPage.addSearchMarker({ name: item.name, latitude: item.latitude, longitude: item.longitude, address: item.address })
        wx.navigateBack()
        return
      }
    }
    this.doSearch(keyword)
  },

  onConfirm(e) {
    const keyword = (e.detail.value || this.data.keyword).trim()
    if (!keyword) return
    // 确认搜索时取消尚未触发的联想，避免它稍后覆盖搜索结果。
    if (this._suggestTimer) { clearTimeout(this._suggestTimer); this._suggestTimer = null }
    this._suggestVersion++
    this.doSearch(keyword)
  },

  async doSearch(keyword) {
    if (!keyword || this.data.isSearching) return
    const version = ++this._searchVersion
    this._saveHistory(keyword)
    this.setData({ isSearching: true, hasSearched: true, resultList: [], suggestList: [], page: 1, searchError: '' })

    try {
      const [localRes, mapRes] = await Promise.all([
        app.callCloud('searchLocations', { keyword, page: 1, pageSize: this.data.pageSize, scene: this.data.activeSceneFilter !== 'all' ? this.data.activeSceneFilter : undefined }),
        app.callCloud('suggestPlaces', { keyword, region: '全国' }).catch(() => ({ data: [] }))
      ])

      if (version !== this._searchVersion) return

      // 业务失败不能伪装成“无结果”。
      if (!localRes || localRes.code !== 0) {
        this.setData({ isSearching: false, searchError: (localRes && localRes.message) || '搜索失败，请稍后重试' })
        return
      }

      const localList = (localRes && localRes.data) ? localRes.data : []
      // 腾讯 POI 没有与业务场景一致的结构化字段；开启场景筛选时只展示可验证的站内地点。
      const mapList = this.data.activeSceneFilter === 'all' && mapRes && mapRes.data
        ? mapRes.data.map(item => ({ ...item, _type: 'map_poi' }))
        : []

      this.setData({
        resultList: [...localList, ...mapList],
        page: 2,
        hasMore: localList.length >= this.data.pageSize,
        isSearching: false,
        searchError: ''
      })
      app.trackEvent('search', { resultCount: localList.length + mapList.length })
    } catch (err) {
      if (version !== this._searchVersion) return
      console.error('搜索失败:', err)
      this.setData({ isSearching: false, searchError: (err && err.message) || '搜索失败，请检查网络后重试' })
    }
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.isSearching && this.data.keyword) {
      this.loadMore()
    }
  },

  async loadMore() {
    const version = ++this._searchVersion
    this.setData({ isSearching: true })

    try {
      const res = await app.callCloud('searchLocations', {
        keyword: this.data.keyword,
        page: this.data.page,
        pageSize: this.data.pageSize,
        scene: this.data.activeSceneFilter !== 'all' ? this.data.activeSceneFilter : undefined
      })
      if (version !== this._searchVersion) return
      if (!res || res.code !== 0) {
        this.setData({ isSearching: false, searchError: (res && res.message) || '加载更多失败' })
        return
      }

      const list = (res && res.data) ? res.data : []
      this.setData({
        resultList: [...this.data.resultList, ...list],
        page: this.data.page + 1,
        hasMore: list.length >= this.data.pageSize,
        isSearching: false,
        searchError: ''
      })
    } catch (err) {
      if (version !== this._searchVersion) return
      console.error('加载更多失败:', err)
      this.setData({ isSearching: false, searchError: (err && err.message) || '加载更多失败' })
    }
  },

  onHotTap(e) {
    this.setData({ keyword: e.currentTarget.dataset.keyword })
    this.doSearch(e.currentTarget.dataset.keyword)
  },

  onHistoryTap(e) {
    this.setData({ keyword: e.currentTarget.dataset.keyword })
    this.doSearch(e.currentTarget.dataset.keyword)
  },

  onSceneFilter(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activeSceneFilter) return
    this.setData({ activeSceneFilter: key })
    if (this.data.hasSearched && this.data.keyword) this.doSearch(this.data.keyword)
  },

  clearHistory() {
    wx.showModal({
      title: '提示',
      content: '确定清空搜索历史？',
      success: (res) => {
        if (res.confirm) {
          this.setData({ historyList: [] })
          wx.setStorageSync('searchHistory', [])
          wx.showToast({ title: '已清空', icon: 'success' })
        }
      }
    })
  },

  onResultTap(e) {
    const { id, type, item } = e.currentTarget.dataset

    if (type === 'map_poi' && item?.latitude && item?.longitude) {
      const pages = getCurrentPages()
      const prevPage = pages[pages.length - 2]
      if (prevPage?.addSearchMarker) {
        prevPage.addSearchMarker({ name: item.name, latitude: item.latitude, longitude: item.longitude, address: item.address })
        wx.navigateBack()
        return
      }
    }

    if (type === 'location') {
      wx.navigateTo({ url: `/pages/location-detail/location-detail?id=${id}` })
    } else if (type === 'post') {
      wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${id}` })
    }
  },

  onCancel() { wx.navigateBack() },

  onClearInput() {
    this.setData({ keyword: '', resultList: [], hasSearched: false })
  },

  onRetrySearch() {
    if (this.data.keyword) this.doSearch(this.data.keyword)
  },

  _saveHistory(keyword) {
    let history = this.data.historyList.filter(item => item !== keyword)
    history.unshift(keyword)
    history = history.slice(0, 20)
    this.setData({ historyList: history })
    wx.setStorageSync('searchHistory', history)
  }
})
