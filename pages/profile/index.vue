<template>
  <view class="profile-page">
    <!-- 顶部用户信息 -->
    <view class="profile-header safe-area-top">
      <view class="header-bg"></view>

      <view class="user-info">
        <view class="avatar-wrap" @click="changeAvatar">
          <image class="avatar" :src="userInfo.avatar" mode="aspectFill"></image>
          <view class="avatar-edit">
            <text class="iconfont icon-camera"></text>
          </view>
        </view>

        <view class="user-details">
          <text class="nickname">{{ userInfo.nickname }}</text>
          <text class="user-id">ID: {{ userInfo.id }}</text>
        </view>

        <view class="edit-btn" @click="goToEditProfile">
          <text class="iconfont icon-edit"></text>
          <text>编辑</text>
        </view>
      </view>

      <!-- 统计数据 -->
      <view class="stats-row">
        <view class="stat-item" @click="goToFollowing">
          <text class="stat-value">{{ userInfo.followingCount }}</text>
          <text class="stat-label">关注</text>
        </view>
        <view class="stat-divider"></view>
        <view class="stat-item" @click="goToFollowers">
          <text class="stat-value">{{ userInfo.followerCount }}</text>
          <text class="stat-label">粉丝</text>
        </view>
        <view class="stat-divider"></view>
        <view class="stat-item">
          <text class="stat-value">{{ userInfo.annotationCount }}</text>
          <text class="stat-label">标注</text>
        </view>
      </view>
    </view>

    <!-- 功能列表 -->
    <view class="function-section">
      <view class="section-title">我的</view>
      <view class="function-list">
        <view class="function-item" @click="goToMyAnnotations">
          <view class="func-icon" style="background: rgba(255, 107, 74, 0.15);">
            <text class="iconfont icon-location" style="color: #FF6B4A;"></text>
          </view>
          <text class="func-text">我的标注</text>
          <text class="iconfont icon-arrow-right"></text>
        </view>
        <view class="function-item" @click="goToMyFavorites">
          <view class="func-icon" style="background: rgba(225, 112, 85, 0.15);">
            <text class="iconfont icon-heart" style="color: #E17055;"></text>
          </view>
          <text class="func-text">我的收藏</text>
          <text class="iconfont icon-arrow-right"></text>
        </view>
        <view class="function-item" @click="goToMyGroups">
          <view class="func-icon" style="background: rgba(74, 144, 217, 0.15);">
            <text class="iconfont icon-group" style="color: #4A90D9;"></text>
          </view>
          <text class="func-text">我的群组</text>
          <text class="iconfont icon-arrow-right"></text>
        </view>
      </view>
    </view>

    <view class="function-section">
      <view class="section-title">社交</view>
      <view class="function-list">
        <view class="function-item" @click="goToFriends">
          <view class="func-icon" style="background: rgba(0, 184, 148, 0.15);">
            <text class="iconfont icon-friend" style="color: #00B894;"></text>
          </view>
          <text class="func-text">好友列表</text>
          <view class="func-badge" v-if="friendRequestCount > 0">{{ friendRequestCount }}</view>
          <text class="iconfont icon-arrow-right"></text>
        </view>
        <view class="function-item" @click="goToQrCode">
          <view class="func-icon" style="background: rgba(155, 89, 182, 0.15);">
            <text class="iconfont icon-qrcode" style="color: #9B59B6;"></text>
          </view>
          <text class="func-text">我的二维码</text>
          <text class="iconfont icon-arrow-right"></text>
        </view>
      </view>
    </view>

    <view class="function-section">
      <view class="section-title">更多</view>
      <view class="function-list">
        <view class="function-item" @click="goToSettings">
          <view class="func-icon" style="background: rgba(99, 110, 114, 0.15);">
            <text class="iconfont icon-settings" style="color: #636E72;"></text>
          </view>
          <text class="func-text">设置</text>
          <text class="iconfont icon-arrow-right"></text>
        </view>
        <view class="function-item" @click="goToHelp">
          <view class="func-icon" style="background: rgba(253, 203, 110, 0.15);">
            <text class="iconfont icon-help" style="color: #FDCB6E;"></text>
          </view>
          <text class="func-text">帮助与反馈</text>
          <text class="iconfont icon-arrow-right"></text>
        </view>
        <view class="function-item" @click="goToAbout">
          <view class="func-icon" style="background: rgba(149, 165, 166, 0.15);">
            <text class="iconfont icon-info" style="color: #95A5A6;"></text>
          </view>
          <text class="func-text">关于出毛地图</text>
          <text class="version-text">v1.0.0</text>
          <text class="iconfont icon-arrow-right"></text>
        </view>
      </view>
    </view>

    <!-- 底部导航 -->
    <view class="bottom-bar safe-area-bottom">
      <view class="tab-bar">
        <view
          v-for="item in tabBarItems"
          :key="item.pagePath"
          :class="['tab-item', { active: isActiveTab(item.pagePath) }]"
          @click="switchTabPage(item.pagePath)"
        >
          <text :class="['iconfont', isActiveTab(item.pagePath) ? item.selectedIcon : item.icon]"></text>
          <text class="tab-text">{{ item.text }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      userInfo: {
        id: '',
        nickname: '探索家',
        avatar: 'https://picsum.photos/200/200?random=100',
        followingCount: 12,
        followerCount: 88,
        annotationCount: 0
      },
      friendRequestCount: 1,
      tabBarItems: [
        { pagePath: '/pages/index/index', text: '地图', icon: 'icon-map', selectedIcon: 'icon-map' },
        { pagePath: '/pages/share/index', text: '共享', icon: 'icon-share', selectedIcon: 'icon-share' },
        { pagePath: '/pages/message/index', text: '消息', icon: 'icon-message', selectedIcon: 'icon-message' },
        { pagePath: '/pages/profile/index', text: '我的', icon: 'icon-profile', selectedIcon: 'icon-profile' }
      ]
    }
  },
  onLoad() {
    this.loadUserInfo()
    this.loadStats()
  },
  onShow() {
    this.loadStats()
  },
  methods: {
    loadUserInfo() {
      const userId = uni.getStorageSync('userId') || 'anonymous'
      this.userInfo.id = userId

      const savedNickname = uni.getStorageSync('nickname')
      if (savedNickname) {
        this.userInfo.nickname = savedNickname
      }

      const savedAvatar = uni.getStorageSync('avatar')
      if (savedAvatar) {
        this.userInfo.avatar = savedAvatar
      }
    },

    loadStats() {
      // 统计标注数量
      const annotations = uni.getStorageSync('annotations') || []
      const userId = uni.getStorageSync('userId') || 'anonymous'
      this.userInfo.annotationCount = annotations.filter(a => a.creatorId === userId).length

      // 统计好友请求
      const friendRequests = uni.getStorageSync('friendRequests') || []
      this.friendRequestCount = friendRequests.filter(r => !r.accepted && !r.rejected).length
    },

    isActiveTab(pagePath) {
      return pagePath === '/pages/profile/index'
    },

    switchTabPage(pagePath) {
      if (pagePath !== '/pages/profile/index') {
        uni.switchTab({ url: pagePath })
      }
    },

    changeAvatar() {
      uni.chooseImage({
        count: 1,
        sourceType: ['album', 'camera'],
        success: (res) => {
          this.userInfo.avatar = res.tempFilePaths[0]
          uni.setStorageSync('avatar', res.tempFilePaths[0])
        }
      })
    },

    goToEditProfile() {
      uni.showToast({
        title: '编辑功能开发中',
        icon: 'none'
      })
    },

    goToFollowing() {
      uni.showToast({
        title: '关注列表开发中',
        icon: 'none'
      })
    },

    goToFollowers() {
      uni.showToast({
        title: '粉丝列表开发中',
        icon: 'none'
      })
    },

    goToMyAnnotations() {
      uni.showToast({
        title: '我的标注开发中',
        icon: 'none'
      })
    },

    goToMyFavorites() {
      uni.showToast({
        title: '我的收藏开发中',
        icon: 'none'
      })
    },

    goToMyGroups() {
      uni.switchTab({ url: '/pages/share/index' })
    },

    goToFriends() {
      uni.showToast({
        title: '好友列表开发中',
        icon: 'none'
      })
    },

    goToQrCode() {
      uni.showToast({
        title: '二维码开发中',
        icon: 'none'
      })
    },

    goToSettings() {
      uni.navigateTo({ url: '/pages/settings/index' })
    },

    goToHelp() {
      uni.showToast({
        title: '帮助与反馈开发中',
        icon: 'none'
      })
    },

    goToAbout() {
      uni.showToast({
        title: '关于出毛地图 v1.0.0',
        icon: 'none'
      })
    }
  }
}
</script>

<style lang="scss" scoped>
.profile-page {
  min-height: 100vh;
  background: var(--background);
  padding-bottom: 120rpx;
}

.profile-header {
  position: relative;
  padding: 48rpx 32rpx;
  padding-top: calc(48rpx + constant(safe-area-inset-top));
  padding-top: calc(48rpx + env(safe-area-inset-top));
  background: linear-gradient(135deg, var(--primary) 0%, #FF8F7A 100%);

  .header-bg {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 200rpx;
    background: linear-gradient(135deg, var(--primary) 0%, #FF8F7A 100%);
  }

  .user-info {
    position: relative;
    display: flex;
    align-items: center;
    gap: 24rpx;
    margin-bottom: 48rpx;
  }

  .avatar-wrap {
    position: relative;
    width: 140rpx;
    height: 140rpx;
    border-radius: 50%;
    border: 4rpx solid rgba(255, 255, 255, 0.5);
    overflow: hidden;

    .avatar {
      width: 100%;
      height: 100%;
      background: var(--divider);
    }

    .avatar-edit {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 8rpx;
      background: rgba(0, 0, 0, 0.5);
      text-align: center;

      .iconfont {
        font-size: 24rpx;
        color: #FFFFFF;
      }
    }
  }

  .user-details {
    flex: 1;

    .nickname {
      display: block;
      font-size: 36rpx;
      font-weight: 700;
      color: #FFFFFF;
      margin-bottom: 8rpx;
    }

    .user-id {
      font-size: 24rpx;
      color: rgba(255, 255, 255, 0.7);
    }
  }

  .edit-btn {
    display: flex;
    align-items: center;
    gap: 8rpx;
    padding: 12rpx 24rpx;
    background: rgba(255, 255, 255, 0.2);
    border-radius: var(--radius-full);
    color: #FFFFFF;
    font-size: 24rpx;
  }

  .stats-row {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 48rpx;
    padding: 32rpx;
    background: var(--surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8rpx;

      .stat-value {
        font-size: 40rpx;
        font-weight: 700;
        color: var(--text-primary);
      }

      .stat-label {
        font-size: 24rpx;
        color: var(--text-secondary);
      }
    }

    .stat-divider {
      width: 1rpx;
      height: 60rpx;
      background: var(--divider);
    }
  }
}

.function-section {
  padding: 32rpx;
  padding-bottom: 0;

  .section-title {
    font-size: 24rpx;
    font-weight: 600;
    color: var(--text-hint);
    margin-bottom: 16rpx;
    text-transform: uppercase;
    letter-spacing: 2rpx;
  }

  .function-list {
    background: var(--surface);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .function-item {
    display: flex;
    align-items: center;
    gap: 20rpx;
    padding: 28rpx 24rpx;
    border-bottom: 1rpx solid var(--divider);
    transition: background var(--transition-fast);

    &:active {
      background: var(--background);
    }

    &:last-child {
      border-bottom: none;
    }

    .func-icon {
      width: 64rpx;
      height: 64rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-md);

      .iconfont {
        font-size: 32rpx;
      }
    }

    .func-text {
      flex: 1;
      font-size: 28rpx;
      color: var(--text-primary);
    }

    .func-badge {
      padding: 4rpx 16rpx;
      background: var(--error);
      border-radius: var(--radius-full);
      color: #FFFFFF;
      font-size: 22rpx;
      font-weight: 500;
    }

    .version-text {
      font-size: 24rpx;
      color: var(--text-hint);
      margin-right: 8rpx;
    }

    .icon-arrow-right {
      font-size: 28rpx;
      color: var(--text-hint);
    }
  }
}

.bottom-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--surface);
  box-shadow: 0 -4rpx 20rpx rgba(0, 0, 0, 0.05);

  .tab-bar {
    display: flex;
    justify-content: space-around;
    padding: 12rpx 0;
    padding-bottom: calc(12rpx + constant(safe-area-inset-bottom));
    padding-bottom: calc(12rpx + env(safe-area-inset-bottom));

    .tab-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4rpx;
      padding: 8rpx 24rpx;

      .iconfont {
        font-size: 40rpx;
        color: var(--text-hint);
      }

      .tab-text {
        font-size: 20rpx;
        color: var(--text-hint);
      }

      &.active {
        .iconfont {
          color: var(--primary);
        }

        .tab-text {
          color: var(--primary);
        }
      }
    }
  }
}
</style>
