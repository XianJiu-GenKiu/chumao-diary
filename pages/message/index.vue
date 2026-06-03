<template>
  <view class="message-page">
    <!-- 顶部标题 -->
    <view class="page-header safe-area-top">
      <text class="title-text">消息</text>
    </view>

    <!-- 消息分类 -->
    <view class="category-tabs">
      <view
        v-for="cat in categories"
        :key="cat.value"
        :class="['cat-tab', { active: currentCategory === cat.value }]"
        @click="switchCategory(cat.value)"
      >
        <text>{{ cat.label }}</text>
        <view v-if="cat.unread > 0" class="unread-badge">{{ cat.unread > 99 ? '99+' : cat.unread }}</view>
      </view>
    </view>

    <!-- 消息列表 -->
    <scroll-view class="message-list" scroll-y>
      <!-- 评论消息 -->
      <view v-if="currentCategory === 'comment' || currentCategory === 'all'">
        <view
          v-for="msg in commentMessages"
          :key="msg.id"
          :class="['message-item', { unread: msg.isUnread }]"
          @click="handleMessageClick(msg)"
        >
          <view class="msg-avatar">
            <image :src="msg.avatar" mode="aspectFill"></image>
            <view v-if="msg.isUnread" class="unread-dot"></view>
          </view>
          <view class="msg-content">
            <view class="msg-header">
              <text class="msg-author">{{ msg.nickname }}</text>
              <text class="msg-time">{{ formatTime(msg.createdAt) }}</text>
            </view>
            <text class="msg-text">{{ msg.action }}了你的标注</text>
            <text class="msg-preview">{{ msg.preview }}</text>
          </view>
          <view v-if="msg.annotationCover" class="msg-cover">
            <image :src="msg.annotationCover" mode="aspectFill"></image>
          </view>
        </view>
      </view>

      <!-- 赞的消息 -->
      <view v-if="currentCategory === 'like' || currentCategory === 'all'">
        <view
          v-for="msg in likeMessages"
          :key="msg.id"
          :class="['message-item', { unread: msg.isUnread }]"
          @click="handleMessageClick(msg)"
        >
          <view class="msg-avatar">
            <image :src="msg.avatar" mode="aspectFill"></image>
            <view v-if="msg.isUnread" class="unread-dot"></view>
          </view>
          <view class="msg-content">
            <view class="msg-header">
              <text class="msg-author">{{ msg.nickname }}</text>
              <text class="msg-time">{{ formatTime(msg.createdAt) }}</text>
            </view>
            <text class="msg-text">{{ msg.action }}</text>
          </view>
        </view>
      </view>

      <!-- 好友请求 -->
      <view v-if="currentCategory === 'friend' || currentCategory === 'all'">
        <view
          v-for="msg in friendRequests"
          :key="msg.id"
          :class="['message-item friend-request', { unread: msg.isUnread }]"
          @click="handleFriendRequest(msg)"
        >
          <view class="msg-avatar">
            <image :src="msg.avatar" mode="aspectFill"></image>
            <view v-if="msg.isUnread" class="unread-dot"></view>
          </view>
          <view class="msg-content">
            <view class="msg-header">
              <text class="msg-author">{{ msg.nickname }}</text>
              <text class="msg-time">{{ formatTime(msg.createdAt) }}</text>
            </view>
            <text class="msg-text">发来了好友请求</text>
          </view>
          <view v-if="!msg.accepted && !msg.rejected" class="friend-actions">
            <view class="action-btn accept" @click.stop="acceptFriend(msg)">
              <text>接受</text>
            </view>
            <view class="action-btn reject" @click.stop="rejectFriend(msg)">
              <text>拒绝</text>
            </view>
          </view>
          <view v-else class="friend-status">
            <text>{{ msg.accepted ? '已接受' : '已拒绝' }}</text>
          </view>
        </view>
      </view>

      <!-- 群组动态 -->
      <view v-if="currentCategory === 'group' || currentCategory === 'all'">
        <view
          v-for="msg in groupMessages"
          :key="msg.id"
          :class="['message-item', { unread: msg.isUnread }]"
          @click="handleMessageClick(msg)"
        >
          <view class="msg-avatar group-avatar">
            <image :src="msg.groupCover" mode="aspectFill"></image>
          </view>
          <view class="msg-content">
            <view class="msg-header">
              <text class="msg-author">{{ msg.groupName }}</text>
              <text class="msg-time">{{ formatTime(msg.createdAt) }}</text>
            </view>
            <text class="msg-text">{{ msg.content }}</text>
          </view>
        </view>
      </view>

      <!-- 系统消息 -->
      <view v-if="currentCategory === 'system' || currentCategory === 'all'">
        <view
          v-for="msg in systemMessages"
          :key="msg.id"
          :class="['message-item system', { unread: msg.isUnread }]"
          @click="handleMessageClick(msg)"
        >
          <view class="msg-avatar system-avatar">
            <text class="iconfont icon-system"></text>
          </view>
          <view class="msg-content">
            <view class="msg-header">
              <text class="msg-author">系统通知</text>
              <text class="msg-time">{{ formatTime(msg.createdAt) }}</text>
            </view>
            <text class="msg-text">{{ msg.content }}</text>
          </view>
        </view>
      </view>

      <!-- 空状态 -->
      <view v-if="totalUnread === 0" class="empty-state">
        <text class="iconfont icon-message-empty"></text>
        <text class="empty-text">暂无消息</text>
      </view>
    </scroll-view>

    <!-- 底部导航 -->
    <view class="bottom-bar safe-area-bottom">
      <view class="tab-bar">
        <view
          v-for="item in tabBarItems"
          :key="item.pagePath"
          :class="['tab-item', { active: isActiveTab(item.pagePath) }]"
          @click="switchTabPage(item.pagePath)"
        >
          <view class="tab-icon-wrap">
            <text :class="['iconfont', isActiveTab(item.pagePath) ? item.selectedIcon : item.icon]"></text>
            <view v-if="item.pagePath === '/pages/message/index' && totalUnread > 0" class="tab-badge">
              {{ totalUnread > 99 ? '99+' : totalUnread }}
            </view>
          </view>
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
      currentCategory: 'all',
      categories: [
        { label: '全部', value: 'all', unread: 0 },
        { label: '评论', value: 'comment', unread: 2 },
        { label: '赞', value: 'like', unread: 5 },
        { label: '好友', value: 'friend', unread: 1 },
        { label: '群组', value: 'group', unread: 3 },
        { label: '系统', value: 'system', unread: 0 }
      ],
      tabBarItems: [
        { pagePath: '/pages/index/index', text: '地图', icon: 'icon-map', selectedIcon: 'icon-map' },
        { pagePath: '/pages/share/index', text: '共享', icon: 'icon-share', selectedIcon: 'icon-share' },
        { pagePath: '/pages/message/index', text: '消息', icon: 'icon-message', selectedIcon: 'icon-message' },
        { pagePath: '/pages/profile/index', text: '我的', icon: 'icon-profile', selectedIcon: 'icon-profile' }
      ],
      commentMessages: [
        {
          id: 'c1',
          nickname: '探险家小明',
          avatar: 'https://picsum.photos/100/100?random=40',
          action: '评论',
          preview: '这个地方真的很棒！下次还要再来',
          annotationCover: 'https://picsum.photos/100/100?random=50',
          isUnread: true,
          createdAt: Date.now() - 3600000
        },
        {
          id: 'c2',
          nickname: '美食达人',
          avatar: 'https://picsum.photos/100/100?random=41',
          action: '回复',
          preview: '谢谢推荐！已经去过了，确实不错',
          annotationCover: 'https://picsum.photos/100/100?random=51',
          isUnread: true,
          createdAt: Date.now() - 86400000
        }
      ],
      likeMessages: [
        {
          id: 'l1',
          nickname: '旅行爱好者',
          avatar: 'https://picsum.photos/100/100?random=42',
          action: '赞了你的标注',
          isUnread: true,
          createdAt: Date.now() - 7200000
        },
        {
          id: 'l2',
          nickname: '本地通',
          avatar: 'https://picsum.photos/100/100?random=43',
          action: '赞了你的标注',
          isUnread: false,
          createdAt: Date.now() - 172800000
        }
      ],
      friendRequests: [
        {
          id: 'f1',
          nickname: '户外爱好者',
          avatar: 'https://picsum.photos/100/100?random=44',
          isUnread: true,
          accepted: false,
          rejected: false,
          createdAt: Date.now() - 43200000
        }
      ],
      groupMessages: [
        {
          id: 'g1',
          groupName: '北京美食探店',
          groupCover: 'https://picsum.photos/100/100?random=45',
          content: '小明 添加了新标注：三里屯网红餐厅',
          isUnread: true,
          createdAt: Date.now() - 1800000
        },
        {
          id: 'g2',
          groupName: '旅行打卡地',
          groupCover: 'https://picsum.photos/100/100?random=46',
          content: '小红 评了 5 星：故宫博物院',
          isUnread: false,
          createdAt: Date.now() - 259200000
        }
      ],
      systemMessages: []
    }
  },
  computed: {
    totalUnread() {
      return this.categories.reduce((sum, cat) => {
        if (cat.value === 'all') return sum
        return sum + cat.unread
      }, 0)
    }
  },
  onLoad() {
    this.calculateUnread()
  },
  methods: {
    switchCategory(category) {
      this.currentCategory = category
    },

    isActiveTab(pagePath) {
      return pagePath === '/pages/message/index'
    },

    switchTabPage(pagePath) {
      if (pagePath !== '/pages/message/index') {
        uni.switchTab({ url: pagePath })
      }
    },

    handleMessageClick(msg) {
      msg.isUnread = false
      this.calculateUnread()

      if (msg.annotationCover) {
        // 跳转到标注详情
      }
    },

    handleFriendRequest(msg) {
      msg.isUnread = false
      this.calculateUnread()
    },

    acceptFriend(msg) {
      msg.accepted = true
      uni.showToast({
        title: '已接受好友请求',
        icon: 'success'
      })
    },

    rejectFriend(msg) {
      msg.rejected = true
      uni.showToast({
        title: '已拒绝',
        icon: 'none'
      })
    },

    calculateUnread() {
      this.categories.forEach(cat => {
        if (cat.value === 'all') {
          cat.unread = this.commentMessages.filter(m => m.isUnread).length +
                       this.likeMessages.filter(m => m.isUnread).length +
                       this.friendRequests.filter(m => m.isUnread).length +
                       this.groupMessages.filter(m => m.isUnread).length
        } else if (cat.value === 'comment') {
          cat.unread = this.commentMessages.filter(m => m.isUnread).length
        } else if (cat.value === 'like') {
          cat.unread = this.likeMessages.filter(m => m.isUnread).length
        } else if (cat.value === 'friend') {
          cat.unread = this.friendRequests.filter(m => m.isUnread).length
        } else if (cat.value === 'group') {
          cat.unread = this.groupMessages.filter(m => m.isUnread).length
        } else if (cat.value === 'system') {
          cat.unread = this.systemMessages.filter(m => m.isUnread).length
        }
      })
    },

    formatTime(timestamp) {
      const now = Date.now()
      const diff = now - timestamp
      const minutes = Math.floor(diff / 60000)
      const hours = Math.floor(diff / 3600000)
      const days = Math.floor(diff / 86400000)

      if (minutes < 1) return '刚刚'
      if (minutes < 60) return `${minutes}分钟前`
      if (hours < 24) return `${hours}小时前`
      if (days < 7) return `${days}天前`

      const date = new Date(timestamp)
      return `${date.getMonth() + 1}月${date.getDate()}日`
    }
  }
}
</script>

<style lang="scss" scoped>
.message-page {
  min-height: 100vh;
  background: var(--background);
  padding-bottom: 120rpx;
}

.page-header {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 24rpx 32rpx;
  background: var(--surface);

  .title-text {
    font-size: 36rpx;
    font-weight: 700;
    color: var(--text-primary);
  }
}

.category-tabs {
  display: flex;
  gap: 32rpx;
  padding: 0 32rpx;
  background: var(--surface);
  border-bottom: 1rpx solid var(--divider);
  overflow-x: auto;

  .cat-tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8rpx;
    padding: 24rpx 0;
    white-space: nowrap;
    font-size: 28rpx;
    color: var(--text-secondary);

    &.active {
      color: var(--primary);
      font-weight: 600;
    }

    .unread-badge {
      padding: 4rpx 12rpx;
      background: var(--error);
      border-radius: var(--radius-full);
      color: #FFFFFF;
      font-size: 20rpx;
      font-weight: 500;
    }
  }
}

.message-list {
  padding: 16rpx 0;
  height: calc(100vh - 300rpx);
}

.message-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx 32rpx;
  background: var(--surface);
  border-bottom: 1rpx solid var(--divider);
  transition: background var(--transition-fast);

  &.unread {
    background: rgba(255, 107, 74, 0.03);
  }

  &.friend-request {
    padding: 32rpx;
  }

  &.system {
    .system-avatar {
      background: var(--primary);

      .iconfont {
        font-size: 36rpx;
        color: #FFFFFF;
      }
    }
  }

  .msg-avatar {
    position: relative;
    width: 88rpx;
    height: 88rpx;
    border-radius: 50%;
    overflow: hidden;
    background: var(--divider);
    flex-shrink: 0;

    image {
      width: 100%;
      height: 100%;
    }

    .unread-dot {
      position: absolute;
      top: 4rpx;
      right: 4rpx;
      width: 16rpx;
      height: 16rpx;
      background: var(--error);
      border-radius: 50%;
      border: 2rpx solid var(--surface);
    }
  }

  .msg-content {
    flex: 1;
    min-width: 0;
  }

  .msg-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8rpx;

    .msg-author {
      font-size: 28rpx;
      font-weight: 600;
      color: var(--text-primary);
    }

    .msg-time {
      font-size: 22rpx;
      color: var(--text-hint);
    }
  }

  .msg-text {
    display: block;
    font-size: 26rpx;
    color: var(--text-secondary);
    margin-bottom: 6rpx;
  }

  .msg-preview {
    display: block;
    font-size: 24rpx;
    color: var(--text-hint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .msg-cover {
    width: 100rpx;
    height: 100rpx;
    border-radius: var(--radius-sm);
    overflow: hidden;
    flex-shrink: 0;

    image {
      width: 100%;
      height: 100%;
    }
  }

  .friend-actions {
    display: flex;
    gap: 16rpx;

    .action-btn {
      padding: 12rpx 24rpx;
      border-radius: var(--radius-full);
      font-size: 24rpx;

      &.accept {
        background: var(--primary);
        color: #FFFFFF;
      }

      &.reject {
        background: var(--background);
        color: var(--text-secondary);
      }
    }
  }

  .friend-status {
    font-size: 24rpx;
    color: var(--text-hint);
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 200rpx 0;

  .iconfont {
    font-size: 120rpx;
    color: var(--text-hint);
    margin-bottom: 32rpx;
  }

  .empty-text {
    font-size: 28rpx;
    color: var(--text-hint);
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

      .tab-icon-wrap {
        position: relative;
      }

      .iconfont {
        font-size: 40rpx;
        color: var(--text-hint);
      }

      .tab-badge {
        position: absolute;
        top: -8rpx;
        right: -16rpx;
        min-width: 32rpx;
        height: 32rpx;
        padding: 0 8rpx;
        background: var(--error);
        border-radius: var(--radius-full);
        color: #FFFFFF;
        font-size: 18rpx;
        display: flex;
        align-items: center;
        justify-content: center;
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
