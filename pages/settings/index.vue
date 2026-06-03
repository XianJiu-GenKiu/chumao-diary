<template>
  <view class="settings-page">
    <!-- 顶部导航 -->
    <view class="nav-bar safe-area-top">
      <view class="nav-back" @click="goBack">
        <text class="iconfont icon-arrow-left"></text>
      </view>
      <view class="nav-title">设置</view>
    </view>

    <!-- 设置列表 -->
    <view class="settings-list">
      <!-- 账号设置 -->
      <view class="settings-group">
        <view class="group-title">账号</view>
        <view class="setting-item" @click="goToAccount">
          <text class="iconfont icon-user setting-icon"></text>
          <text class="setting-text">账户信息</text>
          <text class="iconfont icon-arrow-right"></text>
        </view>
        <view class="setting-item" @click="goToPrivacy">
          <text class="iconfont icon-lock setting-icon"></text>
          <text class="setting-text">隐私设置</text>
          <text class="iconfont icon-arrow-right"></text>
        </view>
      </view>

      <!-- 通知设置 -->
      <view class="settings-group">
        <view class="group-title">通知</view>
        <view class="setting-item">
          <text class="iconfont icon-bell setting-icon"></text>
          <text class="setting-text">评论通知</text>
          <switch :checked="notifySettings.comment" @change="toggleNotify('comment')" />
        </view>
        <view class="setting-item">
          <text class="iconfont icon-bell setting-icon"></text>
          <text class="setting-text">赞通知</text>
          <switch :checked="notifySettings.like" @change="toggleNotify('like')" />
        </view>
        <view class="setting-item">
          <text class="iconfont icon-bell setting-icon"></text>
          <text class="setting-text">好友请求通知</text>
          <switch :checked="notifySettings.friend" @change="toggleNotify('friend')" />
        </view>
        <view class="setting-item">
          <text class="iconfont icon-bell setting-icon"></text>
          <text class="setting-text">群组动态通知</text>
          <switch :checked="notifySettings.group" @change="toggleNotify('group')" />
        </view>
      </view>

      <!-- 地图设置 -->
      <view class="settings-group">
        <view class="group-title">地图</view>
        <view class="setting-item">
          <text class="iconfont icon-location setting-icon"></text>
          <text class="setting-text">默认地图</text>
          <text class="setting-value" @click="changeMapProvider">{{ currentMapProvider }}</text>
        </view>
        <view class="setting-item">
          <text class="iconfont icon-compass setting-icon"></text>
          <text class="setting-text">显示定位</text>
          <switch :checked="mapSettings.showLocation" @change="toggleMapSetting('showLocation')" />
        </view>
      </view>

      <!-- 通用设置 -->
      <view class="settings-group">
        <view class="group-title">通用</view>
        <view class="setting-item">
          <text class="iconfont icon-theme setting-icon"></text>
          <text class="setting-text">深色模式</text>
          <switch :checked="generalSettings.darkMode" @change="toggleGeneral('darkMode')" />
        </view>
        <view class="setting-item">
          <text class="iconfont icon-global setting-icon"></text>
          <text class="setting-text">语言</text>
          <text class="setting-value" @click="changeLanguage">简体中文</text>
        </view>
        <view class="setting-item">
          <text class="iconfont icon-clean setting-icon"></text>
          <text class="setting-text">清除缓存</text>
          <text class="setting-value" @click="clearCache">{{ cacheSize }}</text>
        </view>
      </view>

      <!-- 关于 -->
      <view class="settings-group">
        <view class="group-title">关于</view>
        <view class="setting-item" @click="goToTerms">
          <text class="iconfont icon-doc setting-icon"></text>
          <text class="setting-text">用户协议</text>
          <text class="iconfont icon-arrow-right"></text>
        </view>
        <view class="setting-item" @click="goToPrivacyPolicy">
          <text class="iconfont icon-shield setting-icon"></text>
          <text class="setting-text">隐私政策</text>
          <text class="iconfont icon-arrow-right"></text>
        </view>
        <view class="setting-item">
          <text class="iconfont icon-info setting-icon"></text>
          <text class="setting-text">版本信息</text>
          <text class="setting-value">v1.0.0</text>
        </view>
      </view>

      <!-- 退出登录 -->
      <view class="logout-btn-wrap">
        <view class="logout-btn" @click="logout">
          <text>退出登录</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      notifySettings: {
        comment: true,
        like: true,
        friend: true,
        group: true
      },
      mapSettings: {
        showLocation: true
      },
      generalSettings: {
        darkMode: false
      },
      currentMapProvider: '腾讯地图',
      cacheSize: '0 MB'
    }
  },
  onLoad() {
    this.loadSettings()
    this.calculateCache()
  },
  methods: {
    loadSettings() {
      const settings = uni.getStorageSync('settings')
      if (settings) {
        this.notifySettings = { ...this.notifySettings, ...settings.notifySettings }
        this.mapSettings = { ...this.mapSettings, ...settings.mapSettings }
        this.generalSettings = { ...this.generalSettings, ...settings.generalSettings }
        if (settings.currentMapProvider) {
          this.currentMapProvider = settings.currentMapProvider
        }
      }
    },

    saveSettings() {
      uni.setStorageSync('settings', {
        notifySettings: this.notifySettings,
        mapSettings: this.mapSettings,
        generalSettings: this.generalSettings,
        currentMapProvider: this.currentMapProvider
      })
    },

    toggleNotify(key) {
      this.notifySettings[key] = !this.notifySettings[key]
      this.saveSettings()
      uni.showToast({
        title: '设置已保存',
        icon: 'success'
      })
    },

    toggleMapSetting(key) {
      this.mapSettings[key] = !this.mapSettings[key]
      this.saveSettings()
    },

    toggleGeneral(key) {
      this.generalSettings[key] = !this.generalSettings[key]
      this.saveSettings()

      if (key === 'darkMode') {
        uni.showToast({
          title: this.generalSettings.darkMode ? '深色模式已开启' : '深色模式已关闭',
          icon: 'none'
        })
      }
    },

    changeMapProvider() {
      uni.showActionSheet({
        itemList: ['腾讯地图', '百度地图', '高德地图'],
        success: (res) => {
          const providers = ['腾讯地图', '百度地图', '高德地图']
          this.currentMapProvider = providers[res.tapIndex]
          this.saveSettings()
          uni.showToast({
            title: `已切换到${this.currentMapProvider}`,
            icon: 'success'
          })
        }
      })
    },

    changeLanguage() {
      uni.showToast({
        title: '仅支持简体中文',
        icon: 'none'
      })
    },

    calculateCache() {
      // 简化：估算缓存大小
      try {
        const info = uni.getStorageInfoSync()
        const sizeKB = info.currentSize
        if (sizeKB > 1024) {
          this.cacheSize = (sizeKB / 1024).toFixed(1) + ' MB'
        } else {
          this.cacheSize = sizeKB + ' KB'
        }
      } catch (e) {
        this.cacheSize = '0 MB'
      }
    },

    clearCache() {
      uni.showModal({
        title: '确认清除',
        content: '确定要清除所有缓存吗？',
        success: (res) => {
          if (res.confirm) {
            uni.clearStorageSync()
            this.calculateCache()
            uni.showToast({
              title: '缓存已清除',
              icon: 'success'
            })
            // 重新初始化
            setTimeout(() => {
              uni.reLaunch({ url: '/pages/index/index' })
            }, 1500)
          }
        }
      })
    },

    goBack() {
      uni.navigateBack()
    },

    goToAccount() {
      uni.showToast({
        title: '账户信息开发中',
        icon: 'none'
      })
    },

    goToPrivacy() {
      uni.showToast({
        title: '隐私设置开发中',
        icon: 'none'
      })
    },

    goToTerms() {
      uni.showToast({
        title: '用户协议开发中',
        icon: 'none'
      })
    },

    goToPrivacyPolicy() {
      uni.showToast({
        title: '隐私政策开发中',
        icon: 'none'
      })
    },

    logout() {
      uni.showModal({
        title: '确认退出',
        content: '确定要退出登录吗？',
        success: (res) => {
          if (res.confirm) {
            uni.clearStorageSync()
            uni.showToast({
              title: '已退出登录',
              icon: 'success'
            })
            setTimeout(() => {
              // 返回首页
              uni.reLaunch({ url: '/pages/index/index' })
            }, 1500)
          }
        }
      })
    }
  }
}
</script>

<style lang="scss" scoped>
.settings-page {
  min-height: 100vh;
  background: var(--background);
}

.nav-bar {
  display: flex;
  align-items: center;
  height: 88rpx;
  padding: 0 16rpx;
  background: var(--surface);
  border-bottom: 1rpx solid var(--divider);

  .nav-back {
    width: 80rpx;
    height: 80rpx;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .nav-title {
    flex: 1;
    text-align: center;
    font-size: 32rpx;
    font-weight: 600;
  }

  .iconfont {
    font-size: 36rpx;
    color: var(--text-primary);
  }
}

.settings-list {
  padding: 24rpx 32rpx;
}

.settings-group {
  margin-bottom: 32rpx;

  .group-title {
    font-size: 24rpx;
    font-weight: 600;
    color: var(--text-hint);
    margin-bottom: 16rpx;
    padding-left: 8rpx;
  }
}

.setting-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 28rpx 24rpx;
  background: var(--surface);
  border-radius: var(--radius-md);
  margin-bottom: 2rpx;

  &:first-child {
    border-radius: var(--radius-md) var(--radius-md) 0 0;
  }

  &:last-child {
    border-radius: 0 0 var(--radius-md) var(--radius-md);
    margin-bottom: 0;
  }

  &:only-child {
    border-radius: var(--radius-md);
    margin-bottom: 0;
  }

  .setting-icon {
    font-size: 36rpx;
    color: var(--text-secondary);
  }

  .setting-text {
    flex: 1;
    font-size: 28rpx;
    color: var(--text-primary);
  }

  .setting-value {
    font-size: 26rpx;
    color: var(--text-hint);
  }

  .icon-arrow-right {
    font-size: 28rpx;
    color: var(--text-hint);
  }

  switch {
    transform: scale(0.8);
  }
}

.logout-btn-wrap {
  margin-top: 48rpx;
}

.logout-btn {
  padding: 28rpx;
  text-align: center;
  background: var(--surface);
  border-radius: var(--radius-md);
  color: var(--error);
  font-size: 28rpx;
}
</style>
