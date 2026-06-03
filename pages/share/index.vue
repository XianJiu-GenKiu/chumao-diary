<template>
  <view class="share-page">
    <!-- 顶部标题 -->
    <view class="page-header safe-area-top">
      <view class="header-title">
        <text class="title-text">共享群组</text>
      </view>
      <view class="header-create" @click="goToCreateGroup">
        <text class="iconfont icon-add"></text>
        <text>创建</text>
      </view>
    </view>

    <!-- 搜索框 -->
    <view class="search-section">
      <view class="search-input-wrap">
        <text class="iconfont icon-search"></text>
        <input
          v-model="searchKeyword"
          class="search-input"
          type="text"
          placeholder="搜索群组"
        />
      </view>
    </view>

    <!-- Tab分类 -->
    <view class="tab-section">
      <view
        v-for="tab in tabs"
        :key="tab.value"
        :class="['tab-item', { active: currentTab === tab.value }]"
        @click="switchTab(tab.value)"
      >
        <text>{{ tab.label }}</text>
        <view v-if="currentTab === tab.value" class="tab-indicator"></view>
      </view>
    </view>

    <!-- 群组列表 -->
    <scroll-view class="group-list" scroll-y>
      <view
        v-for="group in filteredGroups"
        :key="group.id"
        class="group-card card card-hover stagger-item"
        @click="goToGroupDetail(group.id)"
      >
        <!-- 封面 -->
        <view class="group-cover">
          <image
            :src="group.coverImage || '/static/images/default-group-cover.png'"
            mode="aspectFill"
          ></image>
          <view class="cover-overlay">
            <text class="group-name">{{ group.name }}</text>
          </view>
        </view>

        <!-- 群组信息 -->
        <view class="group-info">
          <text class="group-desc" v-if="group.description">{{ group.description }}</text>
          <text class="group-desc placeholder" v-else>暂无群组描述</text>

          <view class="group-meta">
            <!-- 成员头像 -->
            <view class="member-avatars">
              <view
                v-for="(member, index) in group.members.slice(0, 5)"
                :key="member.id"
                :class="['member-avatar', { 'more': index === 4 && group.members.length > 5 }]"
                :style="{ zIndex: 5 - index }"
              >
                <image :src="member.avatar" mode="aspectFill"></image>
                <text v-if="index === 4 && group.members.length > 5" class="more-count">
                  +{{ group.members.length - 5 }}
                </text>
              </view>
            </view>

            <view class="meta-right">
              <view class="meta-item">
                <text class="iconfont icon-location"></text>
                <text>{{ group.annotationCount || 0 }} 标注</text>
              </view>
              <view class="meta-item">
                <text class="iconfont icon-team"></text>
                <text>{{ group.members.length }} 成员</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- 空状态 -->
      <view v-if="filteredGroups.length === 0" class="empty-state">
        <image class="empty-icon" src="/static/images/empty-group.png" mode="aspectFit"></image>
        <text class="empty-text">{{ currentTab === 'my' ? '暂无群组' : '暂无公开群组' }}</text>
        <view v-if="currentTab === 'my'" class="empty-action" @click="goToCreateGroup">
          <text>创建第一个群组</text>
        </view>
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
      searchKeyword: '',
      currentTab: 'my', // my | public
      tabs: [
        { label: '我的群组', value: 'my' },
        { label: '公开群组', value: 'public' }
      ],
      tabBarItems: [
        { pagePath: '/pages/index/index', text: '地图', icon: 'icon-map', selectedIcon: 'icon-map' },
        { pagePath: '/pages/share/index', text: '共享', icon: 'icon-share', selectedIcon: 'icon-share' },
        { pagePath: '/pages/message/index', text: '消息', icon: 'icon-message', selectedIcon: 'icon-message' },
        { pagePath: '/pages/profile/index', text: '我的', icon: 'icon-profile', selectedIcon: 'icon-profile' }
      ],
      myGroups: [],
      publicGroups: []
    }
  },
  computed: {
    filteredGroups() {
      let groups = this.currentTab === 'my' ? this.myGroups : this.publicGroups

      if (this.searchKeyword) {
        const keyword = this.searchKeyword.toLowerCase()
        groups = groups.filter(g =>
          g.name.toLowerCase().includes(keyword) ||
          (g.description && g.description.toLowerCase().includes(keyword))
        )
      }

      return groups
    }
  },
  onLoad() {
    this.loadGroups()
  },
  onShow() {
    this.loadGroups()
  },
  methods: {
    loadGroups() {
      // 加载我的群组
      const myGroupsData = uni.getStorageSync('myGroups') || []
      this.myGroups = myGroupsData

      // 加载公开群组（示例数据）
      if (myGroupsData.length === 0) {
        this.publicGroups = this.getDemoPublicGroups()
      } else {
        this.publicGroups = this.getDemoPublicGroups()
      }
    },

    getDemoPublicGroups() {
      return [
        {
          id: 'pub_1',
          name: '北京美食探店',
          description: '分享北京好吃的餐厅',
          coverImage: 'https://picsum.photos/400/200?random=20',
          members: [
            { id: 'u1', avatar: 'https://picsum.photos/100/100?random=30' },
            { id: 'u2', avatar: 'https://picsum.photos/100/100?random=31' },
            { id: 'u3', avatar: 'https://picsum.photos/100/100?random=32' }
          ],
          annotationCount: 56
        },
        {
          id: 'pub_2',
          name: '旅行打卡地',
          description: '记录旅途中的美好瞬间',
          coverImage: 'https://picsum.photos/400/200?random=21',
          members: [
            { id: 'u4', avatar: 'https://picsum.photos/100/100?random=33' },
            { id: 'u5', avatar: 'https://picsum.photos/100/100?random=34' }
          ],
          annotationCount: 128
        },
        {
          id: 'pub_3',
          name: '周末去哪儿',
          description: '发现城市周边好去处',
          coverImage: 'https://picsum.photos/400/200?random=22',
          members: [
            { id: 'u6', avatar: 'https://picsum.photos/100/100?random=35' }
          ],
          annotationCount: 89
        }
      ]
    },

    switchTab(tab) {
      this.currentTab = tab
    },

    isActiveTab(pagePath) {
      return pagePath === '/pages/share/index'
    },

    switchTabPage(pagePath) {
      if (pagePath !== '/pages/share/index') {
        uni.switchTab({ url: pagePath })
      }
    },

    goToCreateGroup() {
      uni.navigateTo({ url: '/pages/group/create' })
    },

    goToGroupDetail(groupId) {
      uni.navigateTo({ url: `/pages/group/detail?id=${groupId}` })
    }
  }
}
</script>

<style lang="scss" scoped>
.share-page {
  min-height: 100vh;
  background: var(--background);
  padding-bottom: 120rpx;
}

// 顶部标题
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24rpx 32rpx;
  background: var(--surface);

  .header-title {
    .title-text {
      font-size: 40rpx;
      font-weight: 700;
      color: var(--text-primary);
    }
  }

  .header-create {
    display: flex;
    align-items: center;
    gap: 8rpx;
    padding: 12rpx 24rpx;
    background: var(--primary);
    border-radius: var(--radius-full);
    color: #FFFFFF;
    font-size: 26rpx;

    .iconfont {
      font-size: 28rpx;
    }
  }
}

// 搜索框
.search-section {
  padding: 0 32rpx 24rpx;
  background: var(--surface);

  .search-input-wrap {
    display: flex;
    align-items: center;
    gap: 12rpx;
    padding: 16rpx 24rpx;
    background: var(--background);
    border-radius: var(--radius-full);

    .iconfont {
      color: var(--text-hint);
      font-size: 28rpx;
    }

    .search-input {
      flex: 1;
      font-size: 28rpx;
    }
  }
}

// Tab分类
.tab-section {
  display: flex;
  gap: 48rpx;
  padding: 0 32rpx;
  background: var(--surface);
  border-bottom: 1rpx solid var(--divider);

  .tab-item {
    position: relative;
    padding: 24rpx 0;
    font-size: 28rpx;
    color: var(--text-secondary);
    transition: color var(--transition-fast);

    &.active {
      color: var(--primary);
      font-weight: 600;
    }

    .tab-indicator {
      position: absolute;
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 48rpx;
      height: 6rpx;
      background: var(--primary);
      border-radius: 3rpx;
    }
  }
}

// 群组列表
.group-list {
  padding: 24rpx 32rpx;
  height: calc(100vh - 400rpx);
}

.group-card {
  margin-bottom: 24rpx;
  padding: 0;
  overflow: hidden;

  .group-cover {
    position: relative;
    width: 100%;
    height: 200rpx;

    image {
      width: 100%;
      height: 100%;
    }

    .cover-overlay {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 24rpx;
      background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%);

      .group-name {
        color: #FFFFFF;
        font-size: 32rpx;
        font-weight: 600;
      }
    }
  }

  .group-info {
    padding: 24rpx;

    .group-desc {
      display: block;
      font-size: 26rpx;
      color: var(--text-secondary);
      margin-bottom: 20rpx;
      line-height: 1.4;

      &.placeholder {
        color: var(--text-hint);
      }
    }

    .group-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .member-avatars {
      display: flex;

      .member-avatar {
        position: relative;
        width: 48rpx;
        height: 48rpx;
        border-radius: 50%;
        border: 3rpx solid var(--surface);
        margin-left: -16rpx;
        overflow: hidden;
        background: var(--divider);

        &:first-child {
          margin-left: 0;
        }

        image {
          width: 100%;
          height: 100%;
        }

        .more-count {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.5);
          color: #FFFFFF;
          font-size: 18rpx;
        }
      }
    }

    .meta-right {
      display: flex;
      gap: 24rpx;

      .meta-item {
        display: flex;
        align-items: center;
        gap: 6rpx;
        font-size: 22rpx;
        color: var(--text-hint);

        .iconfont {
          font-size: 24rpx;
        }
      }
    }
  }
}

// 空状态
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 100rpx 0;

  .empty-icon {
    width: 200rpx;
    height: 200rpx;
    margin-bottom: 32rpx;
    opacity: 0.5;
  }

  .empty-text {
    font-size: 28rpx;
    color: var(--text-hint);
    margin-bottom: 32rpx;
  }

  .empty-action {
    padding: 16rpx 32rpx;
    background: var(--primary);
    border-radius: var(--radius-full);
    color: #FFFFFF;
    font-size: 26rpx;
  }
}

// 底部导航
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
