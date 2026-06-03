<template>
  <view class="group-detail-page">
    <!-- 顶部导航 -->
    <view class="nav-bar safe-area-top">
      <view class="nav-back" @click="goBack">
        <text class="iconfont icon-arrow-left"></text>
      </view>
      <view class="nav-title">{{ groupInfo.name }}</view>
      <view class="nav-more" @click="showGroupMenu">
        <text class="iconfont icon-more"></text>
      </view>
    </view>

    <!-- 群组封面 -->
    <view class="group-cover">
      <image
        :src="groupInfo.coverImage || '/static/images/default-group-cover.png'"
        mode="aspectFill"
      ></image>
      <view class="cover-overlay">
        <text class="group-name">{{ groupInfo.name }}</text>
        <text class="group-desc" v-if="groupInfo.description">{{ groupInfo.description }}</text>
      </view>
    </view>

    <!-- 群组信息 -->
    <view class="info-section card">
      <view class="info-row">
        <view class="info-item">
          <text class="info-value">{{ groupInfo.memberCount || 0 }}</text>
          <text class="info-label">成员</text>
        </view>
        <view class="info-divider"></view>
        <view class="info-item">
          <text class="info-value">{{ groupInfo.annotationCount || 0 }}</text>
          <text class="info-label">标注</text>
        </view>
        <view class="info-divider"></view>
        <view class="info-item">
          <text class="info-value">{{ groupInfo.visibility === 'public' ? '公开' : '私有' }}</text>
          <text class="info-label">类型</text>
        </view>
      </view>
    </view>

    <!-- 成员列表 -->
    <view class="member-section">
      <view class="section-header">
        <text class="section-title">成员</text>
        <view class="more-btn" @click="showAllMembers">
          <text>全部 {{ groupInfo.memberCount || 0 }}</text>
          <text class="iconfont icon-arrow-right"></text>
        </view>
      </view>
      <scroll-view class="member-list" scroll-x>
        <view
          v-for="member in groupInfo.members"
          :key="member.id"
          class="member-item"
          @click="goToMemberProfile(member.id)"
        >
          <view class="member-avatar">
            <image :src="member.avatar" mode="aspectFill"></image>
            <view v-if="member.isOwner" class="owner-badge">
              <text>群主</text>
            </view>
          </view>
          <text class="member-name">{{ member.nickname }}</text>
        </view>
      </scroll-view>
    </view>

    <!-- 群组标注地图 -->
    <view class="map-section">
      <view class="section-header">
        <text class="section-title">群组标注</text>
        <view class="more-btn" @click="showAllAnnotations">
          <text>查看全部</text>
          <text class="iconfont icon-arrow-right"></text>
        </view>
      </view>
      <view class="map-preview" @click="openGroupMap">
        <map
          class="preview-map"
          :latitude="groupInfo.centerLat || 39.908823"
          :longitude="groupInfo.centerLng || 116.397470"
          :scale="12"
          :markers="groupMarkers"
          :enable-zoom="false"
          :enable-scroll="false"
        ></map>
        <view class="map-mask">
          <text class="mask-text">点击查看完整地图</text>
        </view>
      </view>
    </view>

    <!-- 最新标注 -->
    <view class="annotations-section">
      <view class="section-header">
        <text class="section-title">最新标注</text>
      </view>
      <view class="annotation-list">
        <view
          v-for="annotation in groupAnnotations"
          :key="annotation.id"
          class="annotation-item card card-hover"
          @click="goToAnnotationDetail(annotation.id)"
        >
          <view class="annotation-cover">
            <image
              :src="annotation.images[0] || '/static/images/placeholder.png'"
              mode="aspectFill"
            ></image>
          </view>
          <view class="annotation-info">
            <text class="annotation-name">{{ annotation.name }}</text>
            <view class="annotation-meta">
              <view :class="'tag tag-' + annotation.category">
                {{ getCategoryName(annotation.category) }}
              </view>
              <view class="rating">
                <text class="star">★</text>
                <text>{{ annotation.rating.toFixed(1) }}</text>
              </view>
            </view>
            <text class="annotation-creator">by {{ annotation.creatorName }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 底部操作栏 -->
    <view class="bottom-bar safe-area-bottom">
      <view class="action-btn" @click="addAnnotation">
        <text class="iconfont icon-add"></text>
        <text>添加标注</text>
      </view>
      <view class="action-btn secondary" @click="shareGroup">
        <text class="iconfont icon-share"></text>
        <text>分享群组</text>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      groupId: '',
      groupInfo: {
        id: '',
        name: '',
        description: '',
        coverImage: '',
        memberCount: 0,
        annotationCount: 0,
        visibility: 'public',
        members: [],
        centerLat: 39.908823,
        centerLng: 116.397470
      },
      groupMarkers: [],
      groupAnnotations: []
    }
  },
  onLoad(options) {
    if (options.id) {
      this.groupId = options.id
      this.loadGroupInfo()
    }
  },
  methods: {
    loadGroupInfo() {
      // 模拟加载群组数据
      const groups = uni.getStorageSync('groups') || []
      const group = groups.find(g => g.id == this.groupId)

      if (group) {
        this.groupInfo = group
      } else {
        // 示例数据
        this.groupInfo = {
          id: this.groupId,
          name: '北京美食探店',
          description: '分享北京好吃的餐厅和小吃',
          coverImage: 'https://picsum.photos/400/200?random=20',
          memberCount: 8,
          annotationCount: 56,
          visibility: 'public',
          centerLat: 39.908823,
          centerLng: 116.397470,
          members: [
            { id: 'u1', nickname: '小明', avatar: 'https://picsum.photos/100/100?random=30', isOwner: true },
            { id: 'u2', nickname: '小红', avatar: 'https://picsum.photos/100/100?random=31', isOwner: false },
            { id: 'u3', nickname: '小刚', avatar: 'https://picsum.photos/100/100?random=32', isOwner: false },
            { id: 'u4', nickname: '小丽', avatar: 'https://picsum.photos/100/100?random=33', isOwner: false }
          ]
        }
      }

      // 加载群组标注
      this.loadGroupAnnotations()
    },

    loadGroupAnnotations() {
      const annotations = uni.getStorageSync('annotations') || []

      // 筛选属于该群组的标注
      this.groupAnnotations = annotations
        .filter(a => a.groupIds && a.groupIds.includes(this.groupId))
        .slice(0, 5)

      // 如果没有，使用示例数据
      if (this.groupAnnotations.length === 0) {
        this.groupAnnotations = [
          {
            id: 'a1',
            name: '南锣鼓巷小吃',
            category: 'food',
            images: ['https://picsum.photos/200/150?random=60'],
            rating: 4.5,
            creatorName: '小明'
          },
          {
            id: 'a2',
            name: '簋街夜市',
            category: 'food',
            images: ['https://picsum.photos/200/150?random=61'],
            rating: 4.8,
            creatorName: '小红'
          }
        ]
      }

      // 更新markers
      this.groupMarkers = this.groupAnnotations.map(a => ({
        id: a.id,
        latitude: a.latitude || 39.908823,
        longitude: a.longitude || 116.397470,
        width: 30,
        height: 40,
        iconPath: ''
      }))
    },

    getCategoryName(categoryId) {
      const categories = uni.getStorageSync('categories') || []
      const cat = categories.find(c => c.id === categoryId)
      return cat ? cat.name : '其他'
    },

    goBack() {
      uni.navigateBack()
    },

    showGroupMenu() {
      uni.showActionSheet({
        itemList: ['邀请好友', '群组设置', '退出群组'],
        success: (res) => {
          if (res.tapIndex === 0) {
            this.inviteFriend()
          } else if (res.tapIndex === 1) {
            this.groupSettings()
          } else if (res.tapIndex === 2) {
            this.leaveGroup()
          }
        }
      })
    },

    inviteFriend() {
      uni.showToast({
        title: '邀请功能开发中',
        icon: 'none'
      })
    },

    groupSettings() {
      uni.showToast({
        title: '群组设置开发中',
        icon: 'none'
      })
    },

    leaveGroup() {
      uni.showModal({
        title: '确认退出',
        content: '确定要退出该群组吗？',
        success: (res) => {
          if (res.confirm) {
            uni.showToast({
              title: '已退出群组',
              icon: 'success'
            })
            setTimeout(() => {
              uni.switchTab({ url: '/pages/share/index' })
            }, 1500)
          }
        }
      })
    },

    showAllMembers() {
      uni.showToast({
        title: '成员列表开发中',
        icon: 'none'
      })
    },

    showAllAnnotations() {
      uni.showToast({
        title: '标注列表开发中',
        icon: 'none'
      })
    },

    openGroupMap() {
      uni.showToast({
        title: '群组地图开发中',
        icon: 'none'
      })
    },

    goToMemberProfile(memberId) {
      uni.navigateTo({ url: `/pages/user/profile?id=${memberId}` })
    },

    goToAnnotationDetail(annotationId) {
      uni.navigateTo({ url: `/pages/annotation/detail?id=${annotationId}` })
    },

    addAnnotation() {
      uni.navigateTo({
        url: `/pages/annotation/create?groupId=${this.groupId}`
      })
    },

    shareGroup() {
      uni.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline']
      })
    }
  }
}
</script>

<style lang="scss" scoped>
.group-detail-page {
  min-height: 100vh;
  background: var(--background);
  padding-bottom: 140rpx;
}

.nav-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  height: 88rpx;
  padding: 0 16rpx;
  background: rgba(0, 0, 0, 0.3);

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
    color: #FFFFFF;
  }

  .iconfont {
    font-size: 36rpx;
    color: #FFFFFF;
  }
}

.group-cover {
  position: relative;
  width: 100%;
  height: 400rpx;

  image {
    width: 100%;
    height: 100%;
  }

  .cover-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 32rpx;
    background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%);

    .group-name {
      display: block;
      font-size: 40rpx;
      font-weight: 700;
      color: #FFFFFF;
      margin-bottom: 8rpx;
    }

    .group-desc {
      display: block;
      font-size: 26rpx;
      color: rgba(255, 255, 255, 0.8);
    }
  }
}

.info-section {
  margin: -60rpx 32rpx 32rpx;
  position: relative;
  z-index: 100;

  .info-row {
    display: flex;
    justify-content: space-around;
    align-items: center;
  }

  .info-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8rpx;

    .info-value {
      font-size: 36rpx;
      font-weight: 700;
      color: var(--text-primary);
    }

    .info-label {
      font-size: 24rpx;
      color: var(--text-secondary);
    }
  }

  .info-divider {
    width: 1rpx;
    height: 60rpx;
    background: var(--divider);
  }
}

.member-section,
.map-section,
.annotations-section {
  padding: 0 32rpx;
  margin-bottom: 32rpx;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;

  .section-title {
    font-size: 32rpx;
    font-weight: 600;
    color: var(--text-primary);
  }

  .more-btn {
    display: flex;
    align-items: center;
    gap: 8rpx;
    font-size: 26rpx;
    color: var(--primary);

    .iconfont {
      font-size: 24rpx;
    }
  }
}

.member-list {
  display: flex;
  gap: 24rpx;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;

  &::-webkit-scrollbar {
    display: none;
  }
}

.member-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;

  .member-avatar {
    position: relative;
    width: 96rpx;
    height: 96rpx;
    border-radius: 50%;
    overflow: hidden;
    background: var(--divider);

    image {
      width: 100%;
      height: 100%;
    }

    .owner-badge {
      position: absolute;
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
      padding: 4rpx 12rpx;
      background: var(--primary);
      border-radius: var(--radius-full);
      color: #FFFFFF;
      font-size: 18rpx;
      white-space: nowrap;
    }
  }

  .member-name {
    font-size: 24rpx;
    color: var(--text-secondary);
    max-width: 100rpx;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.map-preview {
  position: relative;
  height: 300rpx;
  border-radius: var(--radius-lg);
  overflow: hidden;

  .preview-map {
    width: 100%;
    height: 100%;
  }

  .map-mask {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.3);

    .mask-text {
      padding: 16rpx 32rpx;
      background: rgba(255, 255, 255, 0.9);
      border-radius: var(--radius-full);
      font-size: 26rpx;
      color: var(--text-primary);
    }
  }
}

.annotation-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.annotation-item {
  display: flex;
  gap: 20rpx;
  padding: 20rpx;

  .annotation-cover {
    width: 160rpx;
    height: 120rpx;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--divider);
    flex-shrink: 0;

    image {
      width: 100%;
      height: 100%;
    }
  }

  .annotation-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 10rpx;
  }

  .annotation-name {
    font-size: 28rpx;
    font-weight: 600;
    color: var(--text-primary);
  }

  .annotation-meta {
    display: flex;
    align-items: center;
    gap: 16rpx;

    .rating {
      display: flex;
      align-items: center;
      gap: 4rpx;
      font-size: 24rpx;
      color: var(--text-secondary);

      .star {
        color: var(--accent);
      }
    }
  }

  .annotation-creator {
    font-size: 22rpx;
    color: var(--text-hint);
  }
}

.bottom-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 24rpx;
  padding: 16rpx 32rpx;
  background: var(--surface);
  box-shadow: 0 -4rpx 20rpx rgba(0, 0, 0, 0.05);

  .action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8rpx;
    padding: 24rpx;
    background: var(--primary);
    border-radius: var(--radius-full);
    color: #FFFFFF;
    font-size: 28rpx;
    font-weight: 500;

    .iconfont {
      font-size: 32rpx;
    }

    &.secondary {
      background: var(--background);
      color: var(--text-primary);
      border: 2rpx solid var(--divider);
    }
  }
}
</style>
