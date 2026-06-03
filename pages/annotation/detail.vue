<template>
  <view class="annotation-detail-page">
    <!-- 顶部导航栏 -->
    <view class="nav-bar safe-area-top">
      <view class="nav-back" @click="goBack">
        <text class="iconfont icon-arrow-left"></text>
      </view>
      <view class="nav-title">标注详情</view>
      <view class="nav-actions">
        <text class="iconfont icon-share" @click="shareAnnotation"></text>
      </view>
    </view>

    <!-- 封面图片轮播 -->
    <view class="cover-section">
      <swiper
        class="cover-swiper"
        :indicator-dots="images.length > 1"
        :autoplay="false"
        :circular="true"
        indicator-color="rgba(255,255,255,0.5)"
        indicator-active-color="#FFFFFF"
      >
        <swiper-item v-for="(img, index) in images" :key="index">
          <image class="cover-image" :src="img" mode="aspectFill"></image>
        </swiper-item>
      </swiper>

      <!-- 图片计数 -->
      <view v-if="images.length > 1" class="image-count">
        {{ currentImageIndex + 1 }} / {{ images.length }}
      </view>
    </view>

    <!-- 主要信息 -->
    <view class="main-content">
      <!-- 标题和分类 -->
      <view class="header-section">
        <view class="title-row">
          <text class="title">{{ annotation.name }}</text>
          <view :class="'tag tag-' + annotation.category">
            {{ getCategoryName(annotation.category) }}
          </view>
        </view>
        <text class="description" v-if="annotation.description">
          {{ annotation.description }}
        </text>
      </view>

      <!-- 评分 -->
      <view class="rating-section card">
        <view class="rating-header">
          <text class="section-title">评分</text>
          <view class="rating-display">
            <text class="rating-score">{{ annotation.rating.toFixed(1) }}</text>
            <view class="rating-stars">
              <view
                v-for="i in 5"
                :key="i"
                :class="['star-item', getStarClass(i)]"
                @click="setRating(i)"
              >
                <text class="star-full">★</text>
                <text
                  v-if="annotation.rating > i - 1 && annotation.rating < i"
                  class="star-half"
                >★</text>
              </view>
            </view>
            <text class="rating-count">({{ annotation.ratingCount || 0 }}人评分)</text>
          </view>
        </view>

        <!-- 添加评分按钮 -->
        <view class="add-rating-btn" @click="showRatingPicker = true">
          <text>为这个地方打分</text>
        </view>
      </view>

      <!-- 操作按钮 -->
      <view class="action-section">
        <view class="action-btn" @click="navigateToLocation">
          <view class="action-icon navigate">
            <text class="iconfont icon-navigate"></text>
          </view>
          <text class="action-text">导航去这里</text>
        </view>
        <view class="action-btn" @click="toggleFavorite">
          <view :class="['action-icon', isFavorite ? 'favorite-active' : 'favorite']">
            <text :class="['iconfont', isFavorite ? 'icon-heart-fill' : 'icon-heart']"></text>
          </view>
          <text class="action-text">{{ isFavorite ? '已收藏' : '收藏' }}</text>
        </view>
        <view class="action-btn" @click="copyLocation">
          <view class="action-icon location">
            <text class="iconfont icon-copy"></text>
          </view>
          <text class="action-text">复制位置</text>
        </view>
      </view>

      <view class="divider"></view>

      <!-- 评论列表 -->
      <view class="comments-section">
        <view class="section-header">
          <text class="section-title">评论</text>
          <text class="comment-count">{{ annotation.commentCount || 0 }}条</text>
        </view>

        <!-- 评论输入框 -->
        <view class="comment-input-wrap" @click="openCommentInput">
          <view class="comment-avatar">
            <image src="/static/avatar/default.png" mode="aspectFill"></image>
          </view>
          <view class="comment-input">
            <text>说点什么...</text>
          </view>
        </view>

        <!-- 评论列表 -->
        <view class="comment-list">
          <view
            v-for="comment in comments"
            :key="comment.id"
            class="comment-item"
          >
            <view class="comment-avatar">
              <image :src="comment.avatar" mode="aspectFill"></image>
            </view>
            <view class="comment-content">
              <view class="comment-header">
                <text class="comment-author">{{ comment.nickname }}</text>
                <view class="comment-rating">
                  <text v-for="s in 5" :key="s" :class="['star', s <= comment.rating ? 'active' : '']">★</text>
                </view>
              </view>
              <text class="comment-text">{{ comment.content }}</text>
              <view class="comment-footer">
                <text class="comment-time">{{ formatTime(comment.createdAt) }}</text>
                <view class="comment-actions">
                  <view class="like-btn" @click="toggleLike(comment)">
                    <text :class="['iconfont', comment.isLiked ? 'icon-heart-fill' : 'icon-heart']"></text>
                    <text>{{ comment.likeCount || 0 }}</text>
                  </view>
                  <view class="reply-btn" @click="openReply(comment)">
                    <text class="iconfont icon-comment"></text>
                    <text>回复</text>
                  </view>
                </view>
              </view>
            </view>
          </view>

          <!-- 加载更多 -->
          <view v-if="hasMoreComments" class="load-more" @click="loadMoreComments">
            <text>加载更多</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 底部固定操作栏 -->
    <view class="bottom-bar safe-area-bottom">
      <view class="input-trigger" @click="openCommentInput">
        <text>说点什么...</text>
      </view>
      <view class="action-icons">
        <view class="icon-btn" @click="toggleFavorite">
          <text :class="['iconfont', isFavorite ? 'icon-heart-fill active' : 'icon-heart']"></text>
          <text class="icon-count">{{ favoriteCount }}</text>
        </view>
        <view class="icon-btn" @click="scrollToComments">
          <text class="iconfont icon-comment"></text>
          <text class="icon-count">{{ annotation.commentCount || 0 }}</text>
        </view>
      </view>
    </view>

    <!-- 评分选择弹窗 -->
    <view v-if="showRatingPicker" class="rating-picker-overlay" @click="showRatingPicker = false">
      <view class="rating-picker" @click.stop>
        <text class="picker-title">为这个地方打分</text>
        <view class="star-picker">
          <view
            v-for="i in 5"
            :key="i"
            :class="['picker-star', i <= newRating ? 'active' : '']"
            @click="selectRating(i)"
          >
            <text>★</text>
          </view>
        </view>
        <text class="rating-label">{{ ratingLabels[newRating - 1] }}</text>
        <button class="btn btn-primary submit-rating" @click="submitRating">提交评分</button>
      </view>
    </view>

    <!-- 评论输入弹窗 -->
    <view v-if="showCommentInput" class="comment-input-overlay" @click="closeCommentInput">
      <view class="comment-input-modal" @click.stop>
        <view class="modal-header">
          <text class="modal-cancel" @click="closeCommentInput">取消</text>
          <text class="modal-title">{{ replyingTo ? '回复' : '评论' }}</text>
          <text class="modal-submit" @click="submitComment">发布</text>
        </view>
        <textarea
          v-model="commentText"
          class="modal-textarea"
          :placeholder="replyingTo ? '回复 @' + replyingTo.nickname : '说点什么...'"
          :maxlength="200"
          auto-focus
        ></textarea>
        <text class="char-count">{{ commentText.length }}/200</text>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      annotationId: '',
      annotation: {
        id: '',
        name: '',
        description: '',
        latitude: 0,
        longitude: 0,
        category: 'other',
        images: [],
        rating: 0,
        ratingCount: 0,
        creatorId: ''
      },
      images: [],
      currentImageIndex: 0,
      isFavorite: false,
      favoriteCount: 0,
      comments: [],
      hasMoreComments: false,
      showRatingPicker: false,
      showCommentInput: false,
      newRating: 0,
      ratingLabels: ['很差', '较差', '一般', '很好', '非常好'],
      commentText: '',
      replyingTo: null
    }
  },
  onLoad(options) {
    if (options.id) {
      this.annotationId = options.id
      this.loadAnnotation()
    }
  },
  methods: {
    loadAnnotation() {
      // 模拟加载数据
      const annotations = uni.getStorageSync('annotations') || []
      const annotation = annotations.find(a => a.id == this.annotationId)

      if (annotation) {
        this.annotation = annotation
        this.images = annotation.images.length > 0
          ? annotation.images
          : ['https://picsum.photos/750/500?random=' + this.annotationId]

        // 检查收藏状态
        const favorites = uni.getStorageSync('favorites') || []
        this.isFavorite = favorites.includes(this.annotationId)

        // 加载评论
        this.loadComments()
      } else {
        // 使用默认数据
        this.annotation = {
          id: this.annotationId,
          name: '示例地点',
          description: '这是一个示例地点的描述信息',
          latitude: 39.908823,
          longitude: 116.397470,
          category: 'scenery',
          images: ['https://picsum.photos/750/500?random=' + this.annotationId],
          rating: 4.5,
          ratingCount: 128,
          creatorId: 'user_1'
        }
        this.images = this.annotation.images
        this.loadComments()
      }
    },

    loadComments() {
      // 模拟评论数据
      this.comments = [
        {
          id: '1',
          nickname: '探险家小明',
          avatar: 'https://picsum.photos/100/100?random=10',
          rating: 5,
          content: '非常棒的地方！风景很美，值得一去。',
          likeCount: 23,
          isLiked: false,
          createdAt: Date.now() - 86400000
        },
        {
          id: '2',
          nickname: '美食达人',
          avatar: 'https://picsum.photos/100/100?random=11',
          rating: 4,
          content: '周边的美食也不错，可以逛一整天',
          likeCount: 15,
          isLiked: true,
          createdAt: Date.now() - 172800000
        }
      ]
    },

    getCategoryName(categoryId) {
      const categories = uni.getStorageSync('categories') || []
      const cat = categories.find(c => c.id === categoryId)
      return cat ? cat.name : '其他'
    },

    getStarClass(i) {
      if (this.annotation.rating >= i) return 'full'
      if (this.annotation.rating >= i - 0.5) return 'half'
      return 'empty'
    },

    goBack() {
      uni.navigateBack()
    },

    shareAnnotation() {
      uni.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline']
      })
    },

    navigateToLocation() {
      const { latitude, longitude, name } = this.annotation
      uni.openLocation({
        latitude,
        longitude,
        name,
        success: () => {
          console.log('打开地图成功')
        }
      })
    },

    toggleFavorite() {
      this.isFavorite = !this.isFavorite
      const favorites = uni.getStorageSync('favorites') || []

      if (this.isFavorite) {
        favorites.push(this.annotationId)
        this.favoriteCount++
      } else {
        const index = favorites.indexOf(this.annotationId)
        if (index > -1) {
          favorites.splice(index, 1)
        }
        this.favoriteCount--
      }

      uni.setStorageSync('favorites', favorites)
      uni.showToast({
        title: this.isFavorite ? '已收藏' : '已取消收藏',
        icon: 'success'
      })
    },

    copyLocation() {
      const { latitude, longitude, name } = this.annotation
      uni.setClipboardData({
        data: `${name}\n坐标: ${latitude}, ${longitude}`,
        success: () => {
          uni.showToast({
            title: '已复制位置信息',
            icon: 'success'
          })
        }
      })
    },

    openCommentInput() {
      this.showCommentInput = true
      this.commentText = ''
      this.replyingTo = null
    },

    closeCommentInput() {
      this.showCommentInput = false
      this.commentText = ''
      this.replyingTo = null
    },

    openReply(comment) {
      this.showCommentInput = true
      this.replyingTo = comment
    },

    submitComment() {
      if (!this.commentText.trim()) {
        uni.showToast({
          title: '请输入评论内容',
          icon: 'none'
        })
        return
      }

      // 模拟提交评论
      const newComment = {
        id: 'c_' + Date.now(),
        nickname: '我',
        avatar: '/static/avatar/default.png',
        rating: 0,
        content: this.commentText,
        likeCount: 0,
        isLiked: false,
        createdAt: Date.now(),
        parentId: this.replyingTo ? this.replyingTo.id : null
      }

      this.comments.unshift(newComment)
      this.annotation.commentCount = (this.annotation.commentCount || 0) + 1

      this.closeCommentInput()
      uni.showToast({
        title: '评论成功',
        icon: 'success'
      })
    },

    toggleLike(comment) {
      comment.isLiked = !comment.isLiked
      comment.likeCount += comment.isLiked ? 1 : -1
    },

    showRatingPicker() {
      this.showRatingPicker = true
      this.newRating = 0
    },

    selectRating(rating) {
      this.newRating = rating
    },

    setRating(rating) {
      // 已有评分时的处理
      this.newRating = rating
      this.showRatingPicker = true
    },

    submitRating() {
      if (this.newRating === 0) {
        uni.showToast({
          title: '请选择评分',
          icon: 'none'
        })
        return
      }

      // 计算新的平均分
      const totalRating = this.annotation.rating * this.annotation.ratingCount + this.newRating
      this.annotation.ratingCount++
      this.annotation.rating = totalRating / this.annotation.ratingCount

      this.showRatingPicker = false
      uni.showToast({
        title: '评分成功',
        icon: 'success'
      })
    },

    scrollToComments() {
      // 滚动到评论区域
      uni.pageScrollTo({
        selector: '.comments-section',
        duration: 300
      })
    },

    loadMoreComments() {
      // 加载更多评论
      uni.showToast({
        title: '加载更多评论',
        icon: 'none'
      })
    },

    formatTime(timestamp) {
      const now = Date.now()
      const diff = now - timestamp
      const days = Math.floor(diff / 86400000)

      if (days === 0) return '今天'
      if (days === 1) return '昨天'
      if (days < 7) return `${days}天前`

      const date = new Date(timestamp)
      return `${date.getMonth() + 1}月${date.getDate()}日`
    }
  }
}
</script>

<style lang="scss" scoped>
.annotation-detail-page {
  min-height: 100vh;
  background: var(--background);
  padding-bottom: 120rpx;
}

// 导航栏
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
  background: transparent;

  .nav-back,
  .nav-actions {
    width: 80rpx;
    height: 80rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.9);
    border-radius: var(--radius-full);
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

// 封面
.cover-section {
  position: relative;
  width: 100%;
  height: 500rpx;

  .cover-swiper {
    width: 100%;
    height: 100%;
  }

  .cover-image {
    width: 100%;
    height: 100%;
  }

  .image-count {
    position: absolute;
    bottom: 24rpx;
    right: 24rpx;
    padding: 8rpx 20rpx;
    background: rgba(0, 0, 0, 0.5);
    border-radius: var(--radius-full);
    color: #FFFFFF;
    font-size: 24rpx;
  }
}

// 主要内容
.main-content {
  padding: 32rpx;
  margin-top: -40rpx;
  background: var(--background);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  position: relative;
}

// 标题区
.header-section {
  margin-bottom: 32rpx;

  .title-row {
    display: flex;
    align-items: center;
    gap: 16rpx;
    margin-bottom: 16rpx;
  }

  .title {
    font-size: 40rpx;
    font-weight: 700;
    color: var(--text-primary);
  }

  .description {
    display: block;
    font-size: 28rpx;
    color: var(--text-secondary);
    line-height: 1.6;
  }
}

// 评分区
.rating-section {
  margin-bottom: 32rpx;

  .rating-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24rpx;
  }

  .section-title {
    font-size: 32rpx;
    font-weight: 600;
  }

  .rating-display {
    display: flex;
    align-items: center;
    gap: 16rpx;
  }

  .rating-score {
    font-size: 48rpx;
    font-weight: 700;
    color: var(--primary);
  }

  .rating-stars {
    display: flex;
    gap: 4rpx;

    .star-item {
      position: relative;
      color: #E8E8E8;
      font-size: 32rpx;

      .star-full {
        color: #E8E8E8;
      }

      &.full .star-full,
      .star-half {
        color: var(--accent);
      }

      &.half .star-half {
        color: var(--accent);
      }
    }
  }

  .rating-count {
    font-size: 24rpx;
    color: var(--text-hint);
  }

  .add-rating-btn {
    padding: 24rpx;
    text-align: center;
    background: rgba(255, 107, 74, 0.1);
    border-radius: var(--radius-md);
    color: var(--primary);
    font-size: 28rpx;
  }
}

// 操作按钮
.action-section {
  display: flex;
  justify-content: space-around;
  margin-bottom: 32rpx;

  .action-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12rpx;

    .action-icon {
      width: 96rpx;
      height: 96rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--background);
      border-radius: var(--radius-full);

      .iconfont {
        font-size: 40rpx;
        color: var(--text-secondary);
      }

      &.navigate .iconfont { color: var(--secondary); }
      &.favorite .iconfont { color: var(--error); }
      &.favorite-active .iconfont { color: var(--error); }
      &.location .iconfont { color: var(--success); }
    }

    .action-text {
      font-size: 24rpx;
      color: var(--text-secondary);
    }
  }
}

.divider {
  height: 16rpx;
  background: var(--divider);
  margin: 0 -32rpx;
}

// 评论区
.comments-section {
  padding-top: 32rpx;

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24rpx;

    .comment-count {
      color: var(--text-hint);
      font-size: 26rpx;
    }
  }
}

.comment-input-wrap {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 24rpx;
  background: var(--surface);
  border-radius: var(--radius-lg);
  margin-bottom: 32rpx;

  .comment-avatar {
    width: 64rpx;
    height: 64rpx;
    border-radius: 50%;
    overflow: hidden;
    background: var(--divider);

    image {
      width: 100%;
      height: 100%;
    }
  }

  .comment-input {
    flex: 1;
    color: var(--text-hint);
    font-size: 28rpx;
  }
}

.comment-list {
  .comment-item {
    display: flex;
    gap: 16rpx;
    margin-bottom: 32rpx;

    .comment-avatar {
      width: 64rpx;
      height: 64rpx;
      border-radius: 50%;
      overflow: hidden;
      background: var(--divider);
      flex-shrink: 0;

      image {
        width: 100%;
        height: 100%;
      }
    }

    .comment-content {
      flex: 1;
      min-width: 0;
    }

    .comment-header {
      display: flex;
      align-items: center;
      gap: 16rpx;
      margin-bottom: 12rpx;

      .comment-author {
        font-size: 28rpx;
        font-weight: 500;
        color: var(--text-primary);
      }

      .comment-rating {
        display: flex;
        gap: 2rpx;

        .star {
          font-size: 20rpx;
          color: #E8E8E8;

          &.active {
            color: var(--accent);
          }
        }
      }
    }

    .comment-text {
      display: block;
      font-size: 28rpx;
      color: var(--text-primary);
      line-height: 1.5;
      margin-bottom: 12rpx;
    }

    .comment-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;

      .comment-time {
        font-size: 22rpx;
        color: var(--text-hint);
      }

      .comment-actions {
        display: flex;
        gap: 32rpx;

        .like-btn,
        .reply-btn {
          display: flex;
          align-items: center;
          gap: 8rpx;
          color: var(--text-hint);
          font-size: 24rpx;

          .iconfont {
            font-size: 28rpx;
          }

          .icon-heart-fill {
            color: var(--error);
          }
        }
      }
    }
  }

  .load-more {
    text-align: center;
    padding: 24rpx;
    color: var(--primary);
    font-size: 28rpx;
  }
}

// 底部栏
.bottom-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 16rpx 32rpx;
  background: var(--surface);
  box-shadow: 0 -4rpx 20rpx rgba(0, 0, 0, 0.05);

  .input-trigger {
    flex: 1;
    padding: 20rpx 32rpx;
    background: var(--background);
    border-radius: var(--radius-full);
    color: var(--text-hint);
    font-size: 28rpx;
  }

  .action-icons {
    display: flex;
    gap: 32rpx;

    .icon-btn {
      display: flex;
      align-items: center;
      gap: 8rpx;

      .iconfont {
        font-size: 40rpx;
        color: var(--text-secondary);

        &.active {
          color: var(--error);
        }
      }

      .icon-count {
        font-size: 24rpx;
        color: var(--text-secondary);
      }
    }
  }
}

// 评分选择弹窗
.rating-picker-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;

  .rating-picker {
    width: 600rpx;
    padding: 48rpx;
    background: var(--surface);
    border-radius: var(--radius-xl);
    text-align: center;

    .picker-title {
      display: block;
      font-size: 32rpx;
      font-weight: 600;
      margin-bottom: 32rpx;
    }

    .star-picker {
      display: flex;
      justify-content: center;
      gap: 16rpx;
      margin-bottom: 24rpx;

      .picker-star {
        font-size: 64rpx;
        color: #E8E8E8;
        transition: transform 0.15s;

        &.active,
        &:active {
          color: var(--accent);
          transform: scale(1.1);
        }
      }
    }

    .rating-label {
      display: block;
      font-size: 28rpx;
      color: var(--text-secondary);
      margin-bottom: 32rpx;
      min-height: 40rpx;
    }

    .submit-rating {
      width: 100%;
    }
  }
}

// 评论输入弹窗
.comment-input-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2000;

  .comment-input-modal {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--surface);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    padding: 32rpx;
    padding-bottom: calc(32rpx + constant(safe-area-inset-bottom));
    padding-bottom: calc(32rpx + env(safe-area-inset-bottom));

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24rpx;

      .modal-cancel,
      .modal-submit {
        font-size: 28rpx;
        padding: 8rpx 16rpx;
      }

      .modal-cancel {
        color: var(--text-secondary);
      }

      .modal-title {
        font-size: 32rpx;
        font-weight: 600;
      }

      .modal-submit {
        color: var(--primary);
        font-weight: 500;
      }
    }

    .modal-textarea {
      width: 100%;
      height: 240rpx;
      padding: 24rpx;
      background: var(--background);
      border-radius: var(--radius-md);
      font-size: 28rpx;
      line-height: 1.6;
    }

    .char-count {
      display: block;
      text-align: right;
      font-size: 24rpx;
      color: var(--text-hint);
      margin-top: 16rpx;
    }
  }
}
</style>
