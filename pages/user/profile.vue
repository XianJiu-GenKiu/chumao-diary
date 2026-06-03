<template>
  <view class="user-profile-page">
    <!-- 顶部导航 -->
    <view class="nav-bar safe-area-top">
      <view class="nav-back" @click="goBack">
        <text class="iconfont icon-arrow-left"></text>
      </view>
      <view class="nav-title">{{ userInfo.nickname }}</view>
      <view class="nav-more" @click="showMoreMenu">
        <text class="iconfont icon-more"></text>
      </view>
    </view>

    <!-- 用户信息 -->
    <view class="profile-header">
      <view class="avatar-wrap">
        <image class="avatar" :src="userInfo.avatar" mode="aspectFill"></image>
      </view>
      <text class="nickname">{{ userInfo.nickname }}</text>

      <view class="stats-row">
        <view class="stat-item">
          <text class="stat-value">{{ userInfo.annotationCount }}</text>
          <text class="stat-label">标注</text>
        </view>
        <view class="stat-divider"></view>
        <view class="stat-item">
          <text class="stat-value">{{ userInfo.followerCount }}</text>
          <text class="stat-label">粉丝</text>
        </view>
        <view class="stat-divider"></view>
        <view class="stat-item">
          <text class="stat-value">{{ userInfo.followingCount }}</text>
          <text class="stat-label">关注</text>
        </view>
      </view>

      <view class="action-buttons">
        <view v-if="!isMe" :class="['action-btn', { following: isFollowing }]" @click="toggleFollow">
          <text>{{ isFollowing ? '已关注' : '关注' }}</text>
        </view>
        <view v-if="!isMe" class="action-btn secondary" @click="sendMessage">
          <text>发消息</text>
        </view>
      </view>
    </view>

    <!-- 用户标注 -->
    <view class="annotations-section">
      <view class="section-header">
        <text class="section-title">他的标注</text>
      </view>
      <view class="annotation-grid">
        <view
          v-for="annotation in userAnnotations"
          :key="annotation.id"
          class="annotation-item"
          @click="goToAnnotationDetail(annotation.id)"
        >
          <image :src="annotation.images[0] || '/static/images/placeholder.png'" mode="aspectFill"></image>
          <view class="annotation-overlay">
            <text class="annotation-name">{{ annotation.name }}</text>
          </view>
        </view>
      </view>

      <view v-if="userAnnotations.length === 0" class="empty-state">
        <text>暂无标注</text>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      userId: '',
      userInfo: {
        id: '',
        nickname: '未知用户',
        avatar: '/static/avatar/default.png',
        annotationCount: 0,
        followerCount: 0,
        followingCount: 0
      },
      isFollowing: false,
      userAnnotations: []
    }
  },
  computed: {
    isMe() {
      const myId = uni.getStorageSync('userId') || 'anonymous'
      return this.userId === myId
    }
  },
  onLoad(options) {
    if (options.id) {
      this.userId = options.id
      this.loadUserInfo()
    }
  },
  methods: {
    loadUserInfo() {
      const myId = uni.getStorageSync('userId') || 'anonymous'

      if (this.userId === myId) {
        // 加载自己的信息
        this.userInfo = {
          id: myId,
          nickname: uni.getStorageSync('nickname') || '我',
          avatar: uni.getStorageSync('avatar') || 'https://picsum.photos/200/200?random=100',
          annotationCount: 0,
          followerCount: 0,
          followingCount: 0
        }
        this.isFollowing = false
      } else {
        // 加载其他用户信息（模拟）
        this.userInfo = {
          id: this.userId,
          nickname: '用户_' + this.userId.substring(0, 6),
          avatar: 'https://picsum.photos/200/200?random=' + this.userId.charCodeAt(5),
          annotationCount: 12,
          followerCount: 88,
          followingCount: 15
        }
        this.isFollowing = false
      }

      this.loadUserAnnotations()
    },

    loadUserAnnotations() {
      const annotations = uni.getStorageSync('annotations') || []
      this.userAnnotations = annotations
        .filter(a => a.creatorId === this.userId)
        .slice(0, 9)

      // 更新标注数量
      this.userInfo.annotationCount = this.userAnnotations.length

      // 如果没有，使用示例数据
      if (this.userAnnotations.length === 0 && !this.isMe) {
        this.userAnnotations = [
          { id: 'ua1', name: '示例地点1', images: ['https://picsum.photos/200/200?random=70'] },
          { id: 'ua2', name: '示例地点2', images: ['https://picsum.photos/200/200?random=71'] },
          { id: 'ua3', name: '示例地点3', images: ['https://picsum.photos/200/200?random=72'] }
        ]
        this.userInfo.annotationCount = 3
      }
    },

    goBack() {
      uni.navigateBack()
    },

    showMoreMenu() {
      const items = this.isMe ? ['设置'] : ['举报', '拉黑']
      uni.showActionSheet({
        itemList: items,
        success: (res) => {
          if (res.tapIndex === 0) {
            if (this.isMe) {
              uni.navigateTo({ url: '/pages/settings/index' })
            }
          }
        }
      })
    },

    toggleFollow() {
      this.isFollowing = !this.isFollowing
      if (this.isFollowing) {
        this.userInfo.followerCount++
        uni.showToast({ title: '已关注', icon: 'success' })
      } else {
        this.userInfo.followerCount--
        uni.showToast({ title: '已取消关注', icon: 'none' })
      }
    },

    sendMessage() {
      uni.showToast({
        title: '消息功能开发中',
        icon: 'none'
      })
    },

    goToAnnotationDetail(annotationId) {
      uni.navigateTo({ url: `/pages/annotation/detail?id=${annotationId}` })
    }
  }
}
</script>

<style lang="scss" scoped>
.user-profile-page {
  min-height: 100vh;
  background: var(--background);
}

.nav-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  height: 88rpx;
  padding: 0 16rpx;
  background: var(--surface);

  .nav-back,
  .nav-more {
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

.profile-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48rpx 32rpx;
  background: var(--surface);

  .avatar-wrap {
    width: 160rpx;
    height: 160rpx;
    border-radius: 50%;
    overflow: hidden;
    background: var(--divider);
    margin-bottom: 24rpx;

    .avatar {
      width: 100%;
      height: 100%;
    }
  }

  .nickname {
    font-size: 36rpx;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 24rpx;
  }

  .stats-row {
    display: flex;
    align-items: center;
    gap: 48rpx;
    margin-bottom: 32rpx;

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8rpx;

      .stat-value {
        font-size: 36rpx;
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
      height: 48rpx;
      background: var(--divider);
    }
  }

  .action-buttons {
    display: flex;
    gap: 24rpx;

    .action-btn {
      padding: 16rpx 48rpx;
      background: var(--primary);
      border-radius: var(--radius-full);
      color: #FFFFFF;
      font-size: 28rpx;
      font-weight: 500;

      &.following {
        background: var(--background);
        color: var(--text-secondary);
        border: 2rpx solid var(--divider);
      }

      &.secondary {
        background: var(--background);
        color: var(--text-primary);
        border: 2rpx solid var(--divider);
      }
    }
  }
}

.annotations-section {
  padding: 32rpx;

  .section-header {
    margin-bottom: 24rpx;

    .section-title {
      font-size: 32rpx;
      font-weight: 600;
      color: var(--text-primary);
    }
  }
}

.annotation-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8rpx;

  .annotation-item {
    position: relative;
    aspect-ratio: 1;
    border-radius: var(--radius-sm);
    overflow: hidden;

    image {
      width: 100%;
      height: 100%;
    }

    .annotation-overlay {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 12rpx;
      background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%);

      .annotation-name {
        color: #FFFFFF;
        font-size: 22rpx;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }
}

.empty-state {
  padding: 80rpx;
  text-align: center;
  color: var(--text-hint);
  font-size: 28rpx;
}
</style>
