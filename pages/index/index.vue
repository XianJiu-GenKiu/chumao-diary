<template>
  <view class="map-page">
    <!-- 顶部搜索栏 -->
    <view class="search-bar safe-area-top">
      <view class="search-input-wrap" @click="openSearch">
        <text class="iconfont icon-search"></text>
        <text class="placeholder">搜索地点...</text>
      </view>
      <view class="filter-btn" @click="openFilter">
        <text class="iconfont icon-filter"></text>
      </view>
    </view>

    <!-- 地图组件 -->
    <map
      id="mainMap"
      class="map-container"
      :latitude="mapLatitude"
      :longitude="mapLongitude"
      :scale="mapScale"
      :markers="markers"
      :show-location="true"
      :enable-rotate="true"
      :enable-overlooking="true"
      @markertap="onMarkerTap"
      @regionchange="onRegionChange"
      @longpress="onMapLongPress"
    ></map>

    <!-- 定位按钮 -->
    <view class="location-btn" @click="centerToLocation">
      <text class="iconfont icon-location"></text>
    </view>

    <!-- FAB 添加标注按钮 -->
    <view class="fab-btn" @click="goToCreateAnnotation">
      <text class="iconfont icon-add"></text>
    </view>

    <!-- 底部标注预览 (当选中marker时显示) -->
    <view
      class="annotation-preview"
      :class="{ 'show': selectedAnnotation }"
      @click="openAnnotationDetail"
    >
      <view v-if="selectedAnnotation" class="preview-content">
        <view class="preview-image">
          <image
            :src="selectedAnnotation.images[0] || '/static/images/placeholder.png'"
            mode="aspectFill"
          ></image>
          <view class="preview-category">
            <text :class="'tag-' + selectedAnnotation.category">
              {{ getCategoryName(selectedAnnotation.category) }}
            </text>
          </view>
        </view>
        <view class="preview-info">
          <text class="preview-title">{{ selectedAnnotation.name }}</text>
          <view class="preview-meta">
            <view class="preview-rating">
              <text
                v-for="i in 5"
                :key="i"
                :class="['star', i <= Math.round(selectedAnnotation.rating) ? 'active' : '']"
              >★</text>
              <text class="rating-text">{{ selectedAnnotation.rating.toFixed(1) }}</text>
            </view>
            <text class="preview-comments">{{ selectedAnnotation.commentCount || 0 }} 条评论</text>
          </view>
        </view>
        <view class="preview-arrow">
          <text class="iconfont icon-arrow-right"></text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      // 地图中心点
      mapLatitude: 39.908823,
      mapLongitude: 116.397470,
      mapScale: 14,

      // 标注列表
      markers: [],

      // 当前选中的标注
      selectedAnnotation: null,

      // 用户当前位置
      userLatitude: 39.908823,
      userLongitude: 116.397470,

      // 模拟数据
      demoAnnotations: [
        {
          id: '1',
          name: '南锣鼓巷',
          description: '北京最古老的街区之一',
          latitude: 39.933923,
          longitude: 116.403531,
          category: 'scenery',
          images: ['https://picsum.photos/400/300?random=1'],
          rating: 4.5,
          commentCount: 128,
          creatorId: 'user_1'
        },
        {
          id: '2',
          name: '簋街夜市',
          description: '京城夜生活必去之地',
          latitude: 39.918523,
          longitude: 116.413031,
          category: 'food',
          images: ['https://picsum.photos/400/300?random=2'],
          rating: 4.8,
          commentCount: 256,
          creatorId: 'user_2'
        },
        {
          id: '3',
          name: '三里屯太古里',
          description: '时尚购物地标',
          latitude: 39.938523,
          longitude: 116.453031,
          category: 'shopping',
          images: ['https://picsum.photos/400/300?random=3'],
          rating: 4.3,
          commentCount: 89,
          creatorId: 'user_3'
        },
        {
          id: '4',
          name: '故宫博物院',
          description: '中国古代皇家宫殿',
          latitude: 39.916523,
          longitude: 116.397231,
          category: 'scenery',
          images: ['https://picsum.photos/400/300?random=4'],
          rating: 5.0,
          commentCount: 1024,
          creatorId: 'user_4'
        },
        {
          id: '5',
          name: '北京欢乐谷',
          description: '大型主题公园',
          latitude: 39.882523,
          longitude: 116.507031,
          category: 'entertainment',
          images: ['https://picsum.photos/400/300?random=5'],
          rating: 4.2,
          commentCount: 367,
          creatorId: 'user_5'
        }
      ]
    }
  },
  onLoad() {
    this.loadAnnotations()
    this.getUserLocation()
  },
  onShow() {
    // 每次显示时刷新数据
    this.loadAnnotations()
  },
  methods: {
    // 加载标注数据
    loadAnnotations() {
      const annotations = uni.getStorageSync('annotations') || this.demoAnnotations

      // 转换标注为地图 markers
      this.markers = annotations.map(item => ({
        id: item.id,
        latitude: item.latitude,
        longitude: item.longitude,
        width: 40,
        height: 50,
        iconPath: this.getMarkerIcon(item.category),
        callout: {
          display: 'ALWAYS',
          content: item.name,
          color: '#2D3436',
          fontSize: 12,
          borderRadius: 8,
          padding: 6,
          bgColor: '#FFFFFF',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
        }
      }))
    },

    // 获取marker图标
    getMarkerIcon(category) {
      // 实际项目中使用本地图标
      // 这里返回空字符串，使用默认marker
      return ''
    },

    // 获取分类名称
    getCategoryName(categoryId) {
      const categories = uni.getStorageSync('categories') || []
      const cat = categories.find(c => c.id === categoryId)
      return cat ? cat.name : '其他'
    },

    // 获取用户位置
    getUserLocation() {
      uni.getLocation({
        type: 'gcj02',
        success: (res) => {
          this.userLatitude = res.latitude
          this.userLongitude = res.longitude
          this.mapLatitude = res.latitude
          this.mapLongitude = res.longitude
        },
        fail: () => {
          // 使用默认位置
          console.log('获取位置失败，使用默认位置')
        }
      })
    },

    // 居中到用户位置
    centerToLocation() {
      this.mapLatitude = this.userLatitude
      this.mapLongitude = this.userLongitude
    },

    // Marker点击事件
    onMarkerTap(e) {
      const markerId = e.detail.markerId
      const annotations = uni.getStorageSync('annotations') || this.demoAnnotations
      const annotation = annotations.find(a => a.id == markerId)

      if (annotation) {
        this.selectedAnnotation = annotation
      }
    },

    // 地图区域变化
    onRegionChange(e) {
      // 可以在这里加载可见区域的标注
    },

    // 地图长按事件
    onMapLongPress(e) {
      const { latitude, longitude } = e.detail
      // 跳转到创建标注页，携带位置信息
      uni.navigateTo({
        url: `/pages/annotation/create?latitude=${latitude}&longitude=${longitude}`
      })
    },

    // 打开搜索页
    openSearch() {
      uni.showToast({
        title: '搜索功能开发中',
        icon: 'none'
      })
    },

    // 打开筛选面板
    openFilter() {
      uni.showToast({
        title: '筛选功能开发中',
        icon: 'none'
      })
    },

    // 打开标注详情
    openAnnotationDetail() {
      if (this.selectedAnnotation) {
        uni.navigateTo({
          url: `/pages/annotation/detail?id=${this.selectedAnnotation.id}`
        })
      }
    },

    // 跳转到创建标注页
    goToCreateAnnotation() {
      uni.navigateTo({
        url: `/pages/annotation/create?latitude=${this.mapLatitude}&longitude=${this.mapLongitude}`
      })
    }
  }
}
</script>

<style lang="scss" scoped>
.map-page {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
}

// 搜索栏
.search-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 32rpx;
  padding-top: calc(16rpx + constant(safe-area-inset-top));
  padding-top: calc(16rpx + env(safe-area-inset-top));
  background: linear-gradient(to bottom, rgba(255,255,255,1) 0%, rgba(255,255,255,0.9) 100%);

  .search-input-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    height: 72rpx;
    padding: 0 24rpx;
    background: var(--background);
    border-radius: var(--radius-full);
    gap: 12rpx;

    .iconfont {
      color: var(--text-hint);
      font-size: 28rpx;
    }

    .placeholder {
      color: var(--text-hint);
      font-size: 26rpx;
    }
  }

  .filter-btn {
    width: 72rpx;
    height: 72rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-sm);

    .iconfont {
      color: var(--primary);
      font-size: 32rpx;
    }
  }
}

// 地图容器
.map-container {
  width: 100%;
  height: 100%;
}

// 定位按钮
.location-btn {
  position: absolute;
  right: 32rpx;
  bottom: 400rpx;
  width: 88rpx;
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface);
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-md);
  z-index: 100;

  .iconfont {
    color: var(--secondary);
    font-size: 40rpx;
  }
}

// FAB按钮
.fab-btn {
  position: absolute;
  right: 32rpx;
  bottom: 300rpx;
  width: 112rpx;
  height: 112rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary);
  border-radius: var(--radius-full);
  box-shadow: 0 8rpx 24rpx rgba(255, 107, 74, 0.4);
  z-index: 100;
  transition: transform var(--transition-fast);

  &:active {
    transform: scale(0.9);
  }

  .iconfont {
    color: #FFFFFF;
    font-size: 48rpx;
  }
}

// 底部预览
.annotation-preview {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: var(--surface);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  box-shadow: 0 -8rpx 32rpx rgba(0, 0, 0, 0.1);
  padding: 24rpx 32rpx;
  padding-bottom: calc(24rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  transform: translateY(100%);
  transition: transform var(--transition-normal);

  &.show {
    transform: translateY(0);
  }

  .preview-content {
    display: flex;
    align-items: center;
    gap: 24rpx;
  }

  .preview-image {
    position: relative;
    width: 160rpx;
    height: 120rpx;
    border-radius: var(--radius-md);
    overflow: hidden;
    flex-shrink: 0;

    image {
      width: 100%;
      height: 100%;
    }

    .preview-category {
      position: absolute;
      top: 8rpx;
      left: 8rpx;

      .tag {
        font-size: 18rpx;
        padding: 4rpx 10rpx;
      }
    }
  }

  .preview-info {
    flex: 1;
    min-width: 0;

    .preview-title {
      display: block;
      font-size: 32rpx;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 12rpx;
    }

    .preview-meta {
      display: flex;
      align-items: center;
      gap: 24rpx;
    }

    .preview-rating {
      display: flex;
      align-items: center;
      gap: 4rpx;

      .star {
        color: #E8E8E8;
        font-size: 24rpx;

        &.active {
          color: var(--accent);
        }
      }

      .rating-text {
        margin-left: 8rpx;
        font-size: 24rpx;
        color: var(--text-secondary);
      }
    }

    .preview-comments {
      font-size: 24rpx;
      color: var(--text-hint);
    }
  }

  .preview-arrow {
    .iconfont {
      color: var(--text-hint);
      font-size: 32rpx;
    }
  }
}
</style>
