<template>
  <view class="create-group-page">
    <!-- 顶部导航 -->
    <view class="nav-bar safe-area-top">
      <view class="nav-cancel" @click="goBack">
        <text>取消</text>
      </view>
      <view class="nav-title">创建群组</view>
      <view class="nav-create">
        <text :class="{ disabled: !canCreate }" @click="createGroup">创建</text>
      </view>
    </view>

    <!-- 表单内容 -->
    <scroll-view class="form-content" scroll-y>
      <!-- 群组封面 -->
      <view class="cover-section">
        <view class="cover-preview" @click="chooseCover">
          <image
            v-if="form.coverImage"
            :src="form.coverImage"
            mode="aspectFill"
          ></image>
          <view v-else class="cover-placeholder">
            <text class="iconfont icon-image"></text>
            <text>添加封面图片</text>
          </view>
        </view>
      </view>

      <!-- 群组名称 -->
      <view class="form-section">
        <view class="form-label">群组名称 <text class="required">*</text></view>
        <input
          v-model="form.name"
          class="input"
          type="text"
          placeholder="给你的群组起个名字"
          maxlength="20"
        />
        <text class="char-count">{{ form.name.length }}/20</text>
      </view>

      <!-- 群组描述 -->
      <view class="form-section">
        <view class="form-label">群组描述</view>
        <textarea
          v-model="form.description"
          class="textarea"
          placeholder="介绍一下这个群组..."
          maxlength="100"
        ></textarea>
        <text class="char-count">{{ form.description.length }}/100</text>
      </view>

      <!-- 可见性 -->
      <view class="form-section">
        <view class="form-label">可见性</view>
        <view class="visibility-options">
          <view
            :class="['visibility-item', { selected: form.visibility === 'public' }]"
            @click="form.visibility = 'public'"
          >
            <text class="iconfont icon-earth"></text>
            <view class="visibility-text">
              <text class="visibility-title">公开群组</text>
              <text class="visibility-desc">任何人都可以查看和加入</text>
            </view>
            <view v-if="form.visibility === 'public'" class="check-icon">
              <text class="iconfont icon-check"></text>
            </view>
          </view>
          <view
            :class="['visibility-item', { selected: form.visibility === 'private' }]"
            @click="form.visibility = 'private'"
          >
            <text class="iconfont icon-lock"></text>
            <view class="visibility-text">
              <text class="visibility-title">私有群组</text>
              <text class="visibility-desc">需要邀请才能加入</text>
            </view>
            <view v-if="form.visibility === 'private'" class="check-icon">
              <text class="iconfont icon-check"></text>
            </view>
          </view>
        </view>
      </view>

      <!-- 群组权限 -->
      <view class="form-section">
        <view class="form-label">添加标注权限</view>
        <view class="permission-options">
          <view
            :class="['permission-item', { selected: form.permission === 'all' }]"
            @click="form.permission = 'all'"
          >
            <text class="permission-title">所有成员</text>
            <text class="permission-desc">所有成员都可以添加标注</text>
          </view>
          <view
            :class="['permission-item', { selected: form.permission === 'admin' }]"
            @click="form.permission = 'admin'"
          >
            <text class="permission-title">仅管理员</text>
            <text class="permission-desc">只有群主和管理员可以添加标注</text>
          </view>
        </view>
      </view>

      <!-- 初始成员 -->
      <view class="form-section">
        <view class="form-label">邀请好友</view>
        <view class="friend-select">
          <view
            v-for="friend in friendList"
            :key="friend.id"
            :class="['friend-item', { selected: form.memberIds.includes(friend.id) }]"
            @click="toggleMember(friend.id)"
          >
            <view class="friend-avatar">
              <image :src="friend.avatar" mode="aspectFill"></image>
              <view v-if="form.memberIds.includes(friend.id)" class="selected-check">
                <text class="iconfont icon-check"></text>
              </view>
            </view>
            <text class="friend-name">{{ friend.nickname }}</text>
          </view>
          <view v-if="friendList.length === 0" class="no-friends">
            <text>暂无好友，请先添加好友</text>
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
      form: {
        name: '',
        description: '',
        coverImage: '',
        visibility: 'public',
        permission: 'all',
        memberIds: []
      },
      friendList: []
    }
  },
  computed: {
    canCreate() {
      return this.form.name.trim().length > 0
    }
  },
  onLoad() {
    this.loadFriends()
  },
  onShow() {
    // 每次显示时刷新好友列表
    this.loadFriends()
  },
  methods: {
    loadFriends() {
      // 从本地存储加载好友列表
      const friends = uni.getStorageSync('friends') || []
      this.friendList = friends

      // 如果没有好友，添加一些示例数据
      if (friends.length === 0) {
        this.friendList = [
          { id: 'f1', nickname: '小明', avatar: 'https://picsum.photos/100/100?random=30' },
          { id: 'f2', nickname: '小红', avatar: 'https://picsum.photos/100/100?random=31' },
          { id: 'f3', nickname: '小刚', avatar: 'https://picsum.photos/100/100?random=32' }
        ]
      }
    },

    chooseCover() {
      uni.chooseImage({
        count: 1,
        sourceType: ['album', 'camera'],
        success: (res) => {
          this.form.coverImage = res.tempFilePaths[0]
        }
      })
    },

    toggleMember(friendId) {
      const index = this.form.memberIds.indexOf(friendId)
      if (index > -1) {
        this.form.memberIds.splice(index, 1)
      } else {
        this.form.memberIds.push(friendId)
      }
    },

    goBack() {
      uni.navigateBack()
    },

    createGroup() {
      if (!this.canCreate) {
        uni.showToast({
          title: '请填写群组名称',
          icon: 'none'
        })
        return
      }

      // 创建群组对象
      const userId = uni.getStorageSync('userId') || 'anonymous'
      const userNickname = uni.getStorageSync('nickname') || '我'

      const group = {
        id: 'group_' + Date.now(),
        name: this.form.name.trim(),
        description: this.form.description.trim(),
        coverImage: this.form.coverImage,
        visibility: this.form.visibility,
        permission: this.form.permission,
        ownerId: userId,
        memberCount: this.form.memberIds.length + 1,
        annotationCount: 0,
        createdAt: Date.now(),
        members: [
          {
            id: userId,
            nickname: userNickname,
            avatar: uni.getStorageSync('avatar') || 'https://picsum.photos/100/100?random=100',
            isOwner: true
          },
          ...this.friendList
            .filter(f => this.form.memberIds.includes(f.id))
            .map(f => ({ ...f, isOwner: false }))
        ]
      }

      // 保存到本地存储
      const groups = uni.getStorageSync('groups') || []
      groups.push(group)
      uni.setStorageSync('groups', groups)

      // 同时保存到我的群组
      const myGroups = uni.getStorageSync('myGroups') || []
      myGroups.push(group)
      uni.setStorageSync('myGroups', myGroups)

      uni.showToast({
        title: '群组创建成功',
        icon: 'success'
      })

      setTimeout(() => {
        uni.navigateBack()
      }, 1500)
    }
  }
}
</script>

<style lang="scss" scoped>
.create-group-page {
  min-height: 100vh;
  background: var(--background);
}

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

  .nav-create {
    font-size: 28rpx;
    font-weight: 500;
    color: var(--primary);

    .disabled {
      color: var(--text-hint);
    }
  }
}

.form-content {
  padding: 32rpx;
}

.cover-section {
  margin-bottom: 32rpx;
}

.cover-preview {
  width: 100%;
  height: 300rpx;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--surface);

  image {
    width: 100%;
    height: 100%;
  }

  .cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16rpx;
    color: var(--text-hint);

    .iconfont {
      font-size: 64rpx;
    }

    text {
      font-size: 28rpx;
    }
  }
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
  height: 160rpx;
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

.visibility-options,
.permission-options {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.visibility-item,
.permission-item {
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

  .visibility-text,
  .permission-title {
    flex: 1;
  }

  .visibility-title,
  .permission-title {
    display: block;
    font-size: 28rpx;
    font-weight: 500;
    color: var(--text-primary);
  }

  .visibility-desc,
  .permission-desc {
    display: block;
    font-size: 24rpx;
    color: var(--text-hint);
  }

  .check-icon {
    .iconfont {
      font-size: 32rpx;
      color: var(--primary);
    }
  }
}

.permission-item {
  flex-direction: column;
  align-items: flex-start;

  .permission-desc {
    margin-top: 8rpx;
  }
}

.friend-select {
  display: flex;
  flex-wrap: wrap;
  gap: 24rpx;
}

.friend-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  width: 140rpx;

  .friend-avatar {
    position: relative;
    width: 100rpx;
    height: 100rpx;
    border-radius: 50%;
    overflow: hidden;
    background: var(--divider);

    image {
      width: 100%;
      height: 100%;
    }

    .selected-check {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 36rpx;
      height: 36rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--primary);
      border-radius: 50%;
      border: 2rpx solid var(--surface);

      .iconfont {
        font-size: 20rpx;
        color: #FFFFFF;
      }
    }
  }

  .friend-name {
    font-size: 24rpx;
    color: var(--text-secondary);
    max-width: 120rpx;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &.selected {
    .friend-avatar {
      border: 3rpx solid var(--primary);
    }
  }
}

.no-friends {
  width: 100%;
  padding: 48rpx;
  text-align: center;
  color: var(--text-hint);
  font-size: 28rpx;
}
</style>
