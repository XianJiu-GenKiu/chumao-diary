# 出毛日记小程序 Bug 与用户体验问题报告

## 一、代码层面 Bug

### 1. 云函数调用错误处理异常
**位置**：`app.js` 第195行
**问题**：`callCloud` 方法中错误地将所有非错误结果的 `code` 强制设为0，覆盖了云函数原本返回的错误码（如-4代表需要完善资料），导致上层无法正确识别业务错误。
```javascript
// 错误代码
if (res.result) return res.result;
return { code: 0, data: res.result };
```
**修复建议**：保留云函数原始返回的错误码，仅在无结果时添加默认值：
```javascript
if (res.result) return res.result;
return { code: res.result?.code || 0, data: res.result }; 
```

### 2. 地图标记无自定义图标
**位置**：`pages/discover/discover.js` 第492-499行
**问题**：构建地图标记时未设置 `iconPath`，导致所有地点仅显示微信默认红点标记，无法区分类型或自定义样式。
**修复建议**：添加默认标记图标，并支持按分类动态切换：
```javascript
return {
  id: idx,
  latitude: item.latitude,
  longitude: item.longitude,
  iconPath: '/images/marker-default.png',
  width: 26,
  height: 32
}
```

### 3. 发布流程重复 Loading 弹窗
**位置**：`pages/post-create/post-create.js` 第184行
**问题**：在图片上传完成后重复调用 `wx.showLoading`，会导致 Loading 弹窗叠加无法正常关闭。
**修复建议**：移除重复的 Loading 调用，保留初始的发布中弹窗：
```javascript
// 删除该行
wx.showLoading({ title: '发布中...' })
```

### 4. 签到逻辑字段未定义
**位置**：`pages/location-detail/location-detail.js` 第333行
**问题**：判断 `res.data.already` 字段，但云函数返回结果中无此字段定义，导致签到成功后的提示逻辑异常。
**修复建议**：使用标准字段替代：
```javascript
// 使用 checkedIn 状态判断
wx.showToast({ title: res.data.checkedIn ? '今天已签到' : '签到成功' })
```

### 5. 并发请求异常处理不足
**位置**：`pages/profile/profile.js` 第115-122行
**问题**：使用 `Promise.all` 同时调用两个关注统计接口，任意一个失败都会导致全部请求失败，无法获取部分有效数据。
**修复建议**：改用 `Promise.allSettled` 保证所有请求都能完成：
```javascript
const results = await Promise.allSettled([
  app.callCloud('getFollowList', { type: 'following', pageSize: 1 }),
  app.callCloud('getFollowList', { type: 'followers', pageSize: 1 })
]);

const followingRes = results[0].status === 'fulfilled' ? results[0].value : null;
const followerRes = results[1].status === 'fulfilled' ? results[1].value : null;
```

### 6. 未登录状态访问受限页面
**位置**：多个页面（如`post-create.js`、`location-upload.js`）
**问题**：发布动态、上传地点等需要登录的页面未提前校验登录状态，用户操作到提交阶段才会收到错误提示。
**修复建议**：在页面 `onLoad` 或跳转前添加登录校验：
```javascript
// 在 post-create.js 中添加
onLoad(options) {
  if (!app.globalData.isLoggedIn) {
    wx.showModal({
      title: '请先登录',
      content: '登录后才能发布动态',
      confirmText: '去登录',
      success: (res) => {
        if (res.confirm) wx.switchTab({ url: '/pages/profile/profile' });
      }
    });
    return;
  }
  // ...其他逻辑
}
```

## 二、用户体验优化点

### 1. 定位相关体验
**问题**：
- 用户拒绝定位权限后，仅显示「未知城市」，无引导开启权限的提示
- 手动重新定位失败时，未跳转至微信设置页面

**优化建议**：
```javascript
// 在 discover.js onReLocate 方法中修改 fail 回调
fail: () => {
  wx.showModal({
    title: '定位权限未开启',
    content: '请在微信设置中开启定位权限，以便为你推荐附近地点',
    confirmText: '去设置',
    success: (res) => {
      if (res.confirm) wx.openSetting();
    }
  });
}
```

### 2. 草稿恢复体验
**问题**：恢复草稿时仅弹窗提示，无预览功能，用户无法确认恢复的内容。
**优化建议**：在恢复草稿弹窗中添加「预览」按钮，或在恢复前显示草稿摘要。

### 3. 图片上传体验
**问题**：图片上传失败时，仅提示「发布失败」，无法告知用户具体是图片上传出错。
**优化建议**：在 `uploadImages` 调用处添加 catch 处理，区分网络错误与上传失败：
```javascript
try {
  const imageUrls = await uploadImages(this.data.images, 'posts');
  // ...发布逻辑
} catch (err) {
  wx.showToast({ title: '图片上传失败，请检查网络后重试', icon: 'none' });
  this.setData({ isPublishing: false });
  return;
}
```

### 4. 评论交互体验
**问题**：
- 发表新评论后未自动滚动到评论列表顶部
- 评论点赞无乐观更新后的反馈提示

**优化建议**：
```javascript
// 在 submitComment 成功后添加滚动
if (!result.success) return wx.showToast({ title: result.message, icon: 'none' });
this.setData({ commentText: '', replyTo: null, commentCount: this.data.commentCount + 1 });
wx.showToast({ title: '评论成功', icon: 'success' });
// 滚动到评论区顶部
wx.pageScrollTo({ selector: '.comment-list', duration: 300 });
this.loadComments(this.data.postId);
```

### 5. 暗色模式同步
**问题**：未监听系统暗色模式变化，无法自动同步微信客户端的暗色模式设置。
**优化建议**：在 `app.js` 中添加主题变化监听：
```javascript
onLaunch() {
  // ...其他初始化逻辑
  // 监听系统主题变化
  wx.onThemeChange((res) => {
    this.globalData.darkMode = res.theme === 'dark';
    wx.setStorageSync('darkMode', this.globalData.darkMode);
    this.emit('themeChanged', this.globalData.darkMode);
  });
}
```

### 6. 地图标签重叠
**问题**：地图标签使用固定坐标排列，地点较多时会严重重叠，无法看清。
**优化建议**：使用动态布局算法或微信原生的标签聚合功能。

### 7. 错误页重试机制
**问题**：多数页面仅在加载失败时设置 `errorMessage`，但未提供重试按钮，用户需手动刷新页面。
**优化建议**：在所有页面添加错误状态重试按钮，参考 `profile.js` 的 `onRetry` 方法实现。

### 8. 输入内容限制
**问题**：动态发布页面的内容输入框未限制最大长度，用户输入超过500字符后仅显示计数，无法主动截断。
**优化建议**：在 `onContentInput` 中添加长度限制：
```javascript
onContentInput(e) {
  const value = e.detail.value.slice(0, this.data.maxContent);
  this.setData({ content: value, contentLength: value.length });
}
```

## 三、潜在风险与改进方向

1.  **云函数部署引导**：首次使用时未部署云函数会频繁报错，可添加初始化引导流程
2.  **性能监控**：未添加页面性能上报，无法监控页面加载时长、API 响应时间等关键指标
3.  **离线支持**：当前无离线缓存逻辑，网络不佳时用户体验较差
4.  **分享卡片自定义**：当前分享卡片使用默认样式，可添加自定义分享图生成功能
5.  **数据埋点完善**：当前埋点仅覆盖核心行为，可补充页面停留时长、按钮点击率等分析数据

## 四、紧急修复优先级

| 优先级 | 问题类型 | 影响范围 |
|--------|----------|----------|
| 高 | 云函数错误处理异常 | 所有业务流程 |
| 高 | 未登录状态访问受限 | 用户核心操作 |
| 中 | 定位权限引导缺失 | 新用户体验 |
| 中 | 图片上传错误提示不明确 | 发布流程 |
| 低 | 地图标签重叠 | 地图页面体验 |
| 低 | 暗色模式同步 | 系统适配 |