<template>
  <view class="create-annotation-page">
    <!-- 顶部导航 -->
    <view class="nav-bar safe-area-top">
      <view class="nav-cancel" @click="goBack">
        <text>取消</text>
      </view>
      <view class="nav-title">创建标注</view>
      <view class="nav-publish" @click="submitAnnotation">
        <text :class="{ disabled: !canSubmit }">发布</text>
      </view>
    </view>

    <!-- 表单内容 -->
    <scroll-view class="form-content" scroll-y>
      <!-- 地点名称 -->
      <view class="form-section">
        <view class="form-label">地点名称 <text class="required">*</text></view>
        <input
          v-model="form.name"
          class="input"
          type="text"
          placeholder="给这个地点起个名字"
          maxlength="30"
        />
        <text class="char-count">{{ form.name.length }}/30</text>
      </view>

      <!-- 分类选择 -->
      <view class="form-section">
        <view class="form-label">分类 <text class="required">*</text></view>
        <view class="category-grid">
          <view
            v-for="cat in categories"
            :key="cat.id"
            :class="['category-item', { selected: form.category === cat.id }]"
            @click="selectCategory(cat.id)"
          >
            <view class="category-icon" :style="{ background: cat.color + '20', color: cat.color }">
              <text :class="'iconfont icon-' + cat.icon"></text>
            </view>
            <text class="category-name">{{ cat.name }}</text>
          </view>
        </view>
      </view>

      <!-- 描述 -->
      <view class="form-section">
        <view class="form-label">描述</view>
        <textarea
          v-model="form.description"
          class="textarea"
          placeholder="介绍一下这个地方..."
          maxlength="200"
        ></textarea>
        <text class="char-count">{{ form.description.length }}/200</text>
      </view>

      <!-- 照片 -->
      <view class="form-section">
        <view class="form-label">照片</view>
        <view class="image-grid">
          <view
            v-for="(img, index) in form.images"
            :key="index"
            class="image-item"
          >
            <image :src="img" mode="aspectFill"></image>
            <view class="image-remove" @click="removeImage(index)">
              <text class="iconfont icon-close"></text>
            </view>
          </view>
          <view
            v-if="form.images.length < 9"
            class="image-add"
            @click="chooseImage"
          >
            <text class="iconfont icon-camera"></text>
            <text class="add-text">{{ form.images.length }}/9</text>
          </view>
        </view>
      </view>

      <!-- 位置信息 -->
      <view class="form-section">
        <view class="form-label">位置</view>
        <view class="location-card card">
          <view class="location-info">
            <text class="iconfont icon-location"></text>
            <view class="location-text">
              <text class="location-coord">
                {{ form.latitude.toFixed(6) }}, {{ form.longitude.toFixed(6) }}
              </text>
              <text class="location-desc">地理坐标</text>
            </view>
          </view>
          <view class="location-actions">
            <view class="loc-btn" @click="chooseLocation">
              <text>重新选择</text>
            </view>
            <view class="loc-btn" @click="importFromLink">
              <text>导入链接</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 导入链接面板 -->
      <view v-if="showLinkImport" class="form-section">
        <view class="form-label">从第三方地图导入</view>
        <view class="link-input-wrap">
          <input
            v-model="importLink"
            class="input"
            type="text"
            placeholder="粘贴百度/高德地图分享链接"
          />
          <button class="btn btn-primary btn-sm" @click="parseImportLink">解析</button>
        </view>
        <text v-if="linkParseError" class="error-text">{{ linkParseError }}</text>
      </view>

      <!-- 可见性 -->
      <view class="form-section">
        <view class="form-label">可见性</view>
        <view class="visibility-options">
          <view
            v-for="option in visibilityOptions"
            :key="option.value"
            :class="['visibility-item', { selected: form.visibility === option.value }]"
            @click="form.visibility = option.value"
          >
            <text :class="['iconfont', option.icon]"></text>
            <view class="visibility-text">
              <text class="visibility-title">{{ option.label }}</text>
              <text class="visibility-desc">{{ option.desc }}</text>
            </view>
            <view v-if="form.visibility === option.value" class="check-icon">
              <text class="iconfont icon-check"></text>
            </view>
          </view>
        </view>
      </view>

      <!-- 加入群组 -->
      <view class="form-section">
        <view class="form-label">加入群组</view>
        <view class="group-select">
          <view
            v-for="group in myGroups"
            :key="group.id"
            :class="['group-item', { selected: form.groupIds.includes(group.id) }]"
            @click="toggleGroup(group.id)"
          >
            <view class="group-cover">
              <image :src="group.coverImage || '/static/images/default-group.png'" mode="aspectFill"></image>
            </view>
            <text class="group-name">{{ group.name }}</text>
            <view v-if="form.groupIds.includes(group.id)" class="check-icon">
              <text class="iconfont icon-check"></text>
            </view>
          </view>
        </view>
      </view>

      <view style="height: 120rpx;"></view>
    </scroll-view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      categories: [
        { id: 'food', name: '美食', icon: 'food', color: '#FF6B4A' },
        { id: 'scenery', name: '风景', icon: 'scenery', color: '#00B894' },
        { id: 'entertainment', name: '娱乐', icon: 'entertainment', color: '#9B59B6' },
        { id: 'hotel', name: '住宿', icon: 'hotel', color: '#3498DB' },
        { id: 'shopping', name: '购物', icon: 'shopping', color: '#F39C12' },
        { id: 'other', name: '其他', icon: 'other', color: '#95A5A6' }
      ],
      visibilityOptions: [
        {
          value: 'public',
          label: '公开',
          desc: '所有用户可见',
          icon: 'icon-earth'
        },
        {
          value: 'friends',
          label: '仅好友',
          desc: '仅好友可见',
          icon: 'icon-friend'
        },
        {
          value: 'group',
          label: '群组',
          desc: '仅群组成员可见',
          icon: 'icon-group'
        }
      ],
      form: {
        name: '',
        category: 'other',
        description: '',
        images: [],
        latitude: 39.908823,
        longitude: 116.397470,
        visibility: 'public',
        groupIds: []
      },
      showLinkImport: false,
      importLink: '',
      linkParseError: '',
      myGroups: []
    }
  },
  computed: {
    canSubmit() {
      return this.form.name.trim().length > 0
    }
  },
  onLoad(options) {
    // 获取位置信息
    if (options.latitude && options.longitude) {
      this.form.latitude = parseFloat(options.latitude)
      this.form.longitude = parseFloat(options.longitude)
    }

    // 加载群组列表
    this.loadMyGroups()
  },
  methods: {
    goBack() {
      uni.navigateBack()
    },

    selectCategory(categoryId) {
      this.form.category = categoryId
    },

    chooseImage() {
      uni.chooseImage({
        count: 9 - this.form.images.length,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          this.form.images = [...this.form.images, ...res.tempFilePaths]
        }
      })
    },

    removeImage(index) {
      this.form.images.splice(index, 1)
    },

    chooseLocation() {
      uni.chooseLocation({
        success: (res) => {
          this.form.latitude = res.latitude
          this.form.longitude = res.longitude
        }
      })
    },

    importFromLink() {
      this.showLinkImport = !this.showLinkImport
      this.linkParseError = ''
    },

    parseImportLink() {
      if (!this.importLink.trim()) {
        this.linkParseError = '请输入地图链接'
        return
      }

      // 百度地图链接解析
      if (this.importLink.includes('map.baidu.com')) {
        // 简化解析，实际需要使用百度地图API
        this.linkParseError = '百度地图链接解析需要后端支持'
        return
      }

      // 高德地图链接解析
      if (this.importLink.includes('amap.com')) {
        this.linkParseError = '高德地图链接解析需要后端支持'
        return
      }

      // 腾讯地图链接解析
      if (this.importLink.includes('qq.com')) {
        this.linkParseError = '腾讯地图链接解析需要后端支持'
        return
      }

      this.linkParseError = '无法识别该链接格式'
    },

    loadMyGroups() {
      const groups = uni.getStorageSync('myGroups') || []
      this.myGroups = groups
    },

    toggleGroup(groupId) {
      const index = this.form.groupIds.indexOf(groupId)
      if (index > -1) {
        this.form.groupIds.splice(index, 1)
      } else {
        this.form.groupIds.push(groupId)
      }
    },

    submitAnnotation() {
      if (!this.canSubmit) {
        uni.showToast({
          title: '请填写地点名称',
          icon: 'none'
        })
        return
      }

      // 创建标注对象
      const annotation = {
        id: 'ann_' + Date.now(),
        ...this.form,
        rating: 0,
        ratingCount: 0,
        commentCount: 0,
        creatorId: uni.getStorageSync('userId') || 'anonymous',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      // 保存到本地存储
      const annotations = uni.getStorageSync('annotations') || []
      annotations.push(annotation)
      uni.setStorageSync('annotations', annotations)

      // 如果选择了群组，也保存到群组
      if (this.form.groupIds.length > 0) {
        this.form.groupIds.forEach(groupId => {
          const groups = uni.getStorageSync('groups') || []
          const group = groups.find(g => g.id === groupId)
          if (group) {
            if (!group.annotations) group.annotations = []
            group.annotations.push(annotation.id)
            uni.setStorageSync('groups', groups)
          }
        })
      }

      uni.showToast({
        title: '标注创建成功',
        icon: 'success'
      })

      // 返回上一页
      setTimeout(() => {
        uni.navigateBack()
      }, 1500)
    }
  }
}
</script>

<style lang="scss" scoped>
.create-annotation-page {
  min-height: 100vh;
  background: var(--background);
}

// 导航栏
.nav-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 88rpx;
  padding: 0 32rpx;
  background: var(--surface);

  .nav-cancel {
    font-size: 28rpx;
    color: var(--text-secondary);
  }

  .nav-title {
    font-size: 32rpx;
    font-weight: 600;
  }

  .nav-publish {
    font-size: 28rpx;
    font-weight: 500;
    color: var(--primary);

    .disabled {
      color: var(--text-hint);
    }
  }
}

// 表单内容
.form-content {
  padding: 32rpx;
}

.form-section {
  margin-bottom: 48rpx;
}

.form-label {
  font-size: 28rpx;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 16rpx;

  .required {
    color: var(--error);
  }
}

.input {
  width: 100%;
  padding: 24rpx 32rpx;
  background: var(--surface);
  border: 2rpx solid var(--divider);
  border-radius: var(--radius-md);
  font-size: 28rpx;

  &:focus {
    border-color: var(--primary);
  }
}

.textarea {
  width: 100%;
  height: 200rpx;
  padding: 24rpx;
  background: var(--surface);
  border: 2rpx solid var(--divider);
  border-radius: var(--radius-md);
  font-size: 28rpx;
  line-height: 1.6;

  &:focus {
    border-color: var(--primary);
  }
}

.char-count {
  display: block;
  text-align: right;
  font-size: 22rpx;
  color: var(--text-hint);
  margin-top: 8rpx;
}

.error-text {
  display: block;
  color: var(--error);
  font-size: 24rpx;
  margin-top: 12rpx;
}

// 分类网格
.category-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24rpx;
}

.category-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  padding: 24rpx 16rpx;
  background: var(--surface);
  border-radius: var(--radius-md);
  border: 2rpx solid transparent;
  transition: all var(--transition-fast);

  &.selected {
    border-color: var(--primary);
    background: rgba(255, 107, 74, 0.05);
  }

  .category-icon {
    width: 80rpx;
    height: 80rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);

    .iconfont {
      font-size: 36rpx;
    }
  }

  .category-name {
    font-size: 26rpx;
    color: var(--text-primary);
  }
}

// 图片网格
.image-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16rpx;
}

.image-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--radius-md);
  overflow: hidden;

  image {
    width: 100%;
    height: 100%;
  }

  .image-remove {
    position: absolute;
    top: 8rpx;
    right: 8rpx;
    width: 40rpx;
    height: 40rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 50%;

    .iconfont {
      font-size: 24rpx;
      color: #FFFFFF;
    }
  }
}

.image-add {
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  background: var(--surface);
  border: 2rpx dashed var(--divider);
  border-radius: var(--radius-md);

  .iconfont {
    font-size: 48rpx;
    color: var(--text-hint);
  }

  .add-text {
    font-size: 22rpx;
    color: var(--text-hint);
  }
}

// 位置卡片
.location-card {
  .location-info {
    display: flex;
    align-items: center;
    gap: 16rpx;
    margin-bottom: 24rpx;

    .iconfont {
      font-size: 40rpx;
      color: var(--secondary);
    }

    .location-text {
      .location-coord {
        display: block;
        font-size: 28rpx;
        color: var(--text-primary);
      }

      .location-desc {
        display: block;
        font-size: 24rpx;
        color: var(--text-hint);
      }
    }
  }

  .location-actions {
    display: flex;
    gap: 16rpx;

    .loc-btn {
      flex: 1;
      padding: 16rpx;
      text-align: center;
      background: var(--background);
      border-radius: var(--radius-sm);
      font-size: 26rpx;
      color: var(--primary);
    }
  }
}

// 链接导入
.link-input-wrap {
  display: flex;
  gap: 16rpx;

  .input {
    flex: 1;
  }

  .btn {
    flex-shrink: 0;
  }
}

// 可见性选项
.visibility-options {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.visibility-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 24rpx;
  background: var(--surface);
  border-radius: var(--radius-md);
  border: 2rpx solid transparent;
  transition: all var(--transition-fast);

  &.selected {
    border-color: var(--primary);
    background: rgba(255, 107, 74, 0.05);
  }

  .iconfont {
    font-size: 40rpx;
    color: var(--text-secondary);
  }

  .visibility-text {
    flex: 1;

    .visibility-title {
      display: block;
      font-size: 28rpx;
      font-weight: 500;
      color: var(--text-primary);
    }

    .visibility-desc {
      display: block;
      font-size: 24rpx;
      color: var(--text-hint);
    }
  }

  .check-icon {
    .iconfont {
      font-size: 32rpx;
      color: var(--primary);
    }
  }
}

// 群组选择
.group-select {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.group-item {
  position: relative;
  width: 200rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx;
  background: var(--surface);
  border-radius: var(--radius-md);
  border: 2rpx solid transparent;

  &.selected {
    border-color: var(--primary);
  }

  .group-cover {
    width: 120rpx;
    height: 120rpx;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--divider);

    image {
      width: 100%;
      height: 100%;
    }
  }

  .group-name {
    font-size: 24rpx;
    color: var(--text-primary);
    text-align: center;
  }

  .check-icon {
    position: absolute;
    top: 8rpx;
    right: 8rpx;
    width: 36rpx;
    height: 36rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--primary);
    border-radius: 50%;

    .iconfont {
      font-size: 20rpx;
      color: #FFFFFF;
    }
  }
}
</style>
