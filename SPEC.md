# 出毛地图 - 产品规范文档

## 1. Concept & Vision

**出毛地图**是一款以地图为核心的地点标注与社交分享平台。"出毛"寓意探索与发现，鼓励用户走出日常，发现并分享独特的地点。整体感觉应当是：**探险家的私人地图册 + 社交网络**——既有手绘地图的温暖感，又有现代科技带来的流畅体验。

设计关键词：**探索感、温暖、手绘质感、活力社交**

---

## 2. Design Language

### 2.1 Aesthetic Direction
采用"现代探险"风格——融合手绘地图的温暖质感与现代扁平设计的简洁。地图区域保持克制，让地图本身成为主角；交互界面使用活泼的色彩点缀，传递探索的乐趣。

### 2.2 Color Palette
```
Primary:     #D4890E  (琥珀金 - 对齐 Figma 修复清单)
Secondary:   #4A90D9  (天空蓝 - 地图与信任)
Accent:      #FFD93D  (向日葵黄 - 高亮标记)
Background:  #FAFAFA  (云白)
Surface:     #FFFFFF  (纯白卡片)
Text-Primary:#2D3436  (深灰)
Text-Secondary:#636E72 (中灰)
Success:     #00B894  (薄荷绿)
Warning:     #FDCB6E  (暖黄)
Error:       #E17055  (砖红)
```

### 2.3 Typography
- **Display/标题**: "ZCOOL KuaiLe" (站酷快乐体) - 活泼有趣
- **Body/正文**: "Noto Sans SC" - 清晰易读
- **Fallback**: system-ui, sans-serif

### 2.4 Spatial System
- 基础单位: 8px
- 页面边距: 16px
- 卡片圆角: 16px
- 按钮圆角: 24px (全圆角胶囊按钮)
- 阴影: 0 4px 20px rgba(0,0,0,0.08)

### 2.5 Motion Philosophy
- 页面切换: slide + fade, 300ms ease-out
- 卡片出现: translateY(20px) + fade, staggered 80ms
- 按钮点击: scale(0.95) + scale(1), 150ms
- 地图标记: bounce-in + pulse 呼吸效果
- 评分滑动: 星星逐个亮起, 100ms间隔

---

## 3. Layout & Structure

### 3.1 整体架构 (Tab Bar Navigation)
底部4个Tab：
1. **地图** (icon: 地图图标) - 主界面，占据70%核心区域
2. **共享** (icon: 分享图标) - 群组标注共享
3. **消息** (icon: 消息气泡) - 社交消息
4. **我的** (icon: 用户头像) - 个人中心

### 3.2 页面结构

#### 3.2.1 地图页 (主界面)
```
┌─────────────────────────────┐
│ [搜索框] [筛选按钮] [定位]   │  <- 顶部操作栏 (安全区)
├─────────────────────────────┤
│                             │
│                             │
│         地图区域             │  <- 地图占据主要空间
│    (支持缩放、拖拽、标记)     │
│                             │
│                             │
├─────────────────────────────┤
│ [添加标注] (FAB浮动按钮)     │  <- 右下角悬浮
└─────────────────────────────┘
│ [地图] [共享] [消息] [我的]  │  <- Tab Bar
└─────────────────────────────┘
```

#### 3.2.2 标注详情页 (Modal/Sheet)
从底部滑出的半屏Sheet：
- 地点名称、分类标签
- 评分星级、评论数
- 缩略图轮播
- 操作按钮：导航去这里、收藏、分享、加入群组

#### 3.2.3 共享页 (群组列表)
```
┌─────────────────────────────┐
│ 我的群组        [创建群组]    │
├─────────────────────────────┤
│ ┌─────────────────────────┐  │
│ │ 群组封面 + 名称 + 成员数  │  │
│ │ 最近标注预览 (3个缩略图)  │  │
│ └─────────────────────────┘  │
│ ┌─────────────────────────┐  │
│ │        群组卡片...        │  │
│ └─────────────────────────┘  │
└─────────────────────────────┘
```

#### 3.2.4 消息页
- 消息分类：评论、赞、群组动态、好友请求
- 每条消息显示：头像、来源、预览内容、时间

#### 3.2.5 我的页
```
┌─────────────────────────────┐
│      [头像] [昵称]           │
│      [0 关注] [0 粉丝]       │
├─────────────────────────────┤
│ 我的标注 | 我的收藏 | 我的群组 │
├─────────────────────────────┤
│ 设置 | 帮助与反馈            │
└─────────────────────────────┘
```

---

## 4. Features & Interactions

### 4.1 地图核心功能

#### 4.1.1 地图显示
- 使用 **腾讯地图** 作为基础（微信原生支持）
- 支持：缩放、拖拽、旋转
- 显示已标注位置的自定义Marker
- Marker颜色根据分类变化

#### 4.1.2 位置标注
- **长按地图** 或 点击 **"+"** 按钮添加标注
- 标注表单：
  - 地点名称 (必填, 最多30字)
  - 分类标签 (单选: 美食/风景/娱乐/住宿/购物/其他)
  - 描述 (选填, 最多200字)
  - 照片 (最多9张, 从相册选择或拍照)
  - 可见性: 公开/仅好友/指定群组
- 标注成功后：Marker动画弹入 + Toast提示

#### 4.1.3 导入第三方地图坐标
- 支持解析：
  - 百度地图链接 (map.baidu.com)
  - 高德地图链接 (AMap)
- 用户粘贴链接 → 系统解析经纬度 → 自动创建标注
- 解析失败时提示："无法识别该链接，请手动添加"

#### 4.1.4 地图筛选
- 按分类筛选 (多选)
- 按评分筛选 (3星以上/4星以上/5星)
- 按时间筛选 (最近一周/一月/全部)

### 4.2 评分与评论

#### 4.2.1 评分
- 5星制，支持半星
- 显示平均分和评分人数
- 滑动选择评分，松开确认

#### 4.2.2 评论
- 评论列表：头像、昵称、评分、评论内容、时间
- 支持回复评论
- 支持点赞评论
- 每页20条，分页加载

### 4.3 群组功能 (共享)

#### 4.3.1 创建群组
- 群组名称 (必填, 最多20字)
- 群组描述 (选填)
- 群组封面 (选填，默认随机风景图)
- 初始成员：仅创建者

#### 4.3.2 群组管理
- 邀请好友加入 (生成分享链接/二维码)
- 设置群组权限：所有人可添加标注 / 仅管理员可添加
- 解散群组 (仅创建者)

#### 4.3.3 群组地图
- 进入群组后，地图仅显示该群组的标注
- 所有成员都可以查看和添加标注
- 群组内标注自动同步

### 4.4 社交功能

#### 4.4.1 好友系统
- 搜索用户 (手机号/昵称)
- 发送好友请求
- 接受/拒绝请求
- 好友列表管理

#### 4.4.2 互动
- 对标注：点赞、评论、收藏
- 对用户：关注、访问主页
- 消息通知：评论回复、赞、好友请求、群组动态

### 4.5 分类管理
- 用户可创建自定义分类
- 自定义分类名称和图标
- 默认分类不可删除，自定义分类可编辑/删除
- 分类颜色自定义

---

## 5. Component Inventory

### 5.1 MapMarker (地图标记)
- **Default**: 分类颜色圆点 + 白色图标
- **Selected**: 放大1.2x + 阴影加深 + 脉冲动画
- **Cluster**: 显示数量的大圆点

### 5.2 AnnotationCard (标注卡片)
- 封面图 (16:9圆角)
- 标题 + 分类标签
- 评分星级 + 评论数
- 距离 (当前定位计算)
- **Hover/Press**: scale(0.98) + 阴影变化

### 5.3 RatingStars (评分星级)
- 5颗星星，支持半星
- **Empty**: 灰色空心
- **Half**: 左半亮色右半灰色
- **Full**: 金色实心
- **Interactive**: 滑动选择

### 5.4 CommentItem (评论项)
- 头像 (32px圆形)
- 昵称 + 评分
- 评论内容
- 时间 + 点赞数
- 回复按钮

### 5.5 GroupCard (群组卡片)
- 封面图 (圆角矩形)
- 群组名称 + 描述预览
- 成员头像堆叠 (最多显示5个)
- 标注数量

### 5.6 BottomSheet (底部弹出)
- 圆角顶部 (24px)
- 拖拽指示条
- 可下滑关闭
- 背景遮罩 (黑色50%)

### 5.7 TabBar (底部导航)
- 4个Tab项
- 图标 + 文字
- **Active**: Primary色 + 放大图标
- **Inactive**: 灰色
- 中间项可上滑显示更多信息

### 5.8 FABButton (浮动按钮)
- 圆形 (56px)
- Primary色背景
- 白色图标
- 阴影深度感
- **Press**: scale(0.9)

---

## 6. Technical Approach

### 6.1 框架选择
**uni-app** - 一套代码，编译到：
- 微信小程序
- QQ小程序
- H5 (备用)

### 6.2 项目结构
```
chumao-map/
├── pages/                 # 页面
│   ├── index/            # 地图首页
│   ├── map/              # 地图相关
│   ├── share/            # 共享群组
│   ├── message/          # 消息中心
│   ├── profile/          # 个人中心
│   ├── annotation/      # 标注详情
│   ├── create/          # 创建标注
│   └── group/           # 群组详情
├── components/          # 组件
│   ├── map-marker/
│   ├── annotation-card/
│   ├── rating-stars/
│   ├── comment-item/
│   ├── group-card/
│   └── bottom-sheet/
├── static/              # 静态资源
│   ├── icons/
│   └── images/
├── utils/               # 工具函数
├── services/            # API服务
├── store/               # 状态管理
├── styles/             # 全局样式
└── manifest.json       # uni-app配置
```

### 6.3 数据模型

#### Annotation (标注)
```javascript
{
  id: string,
  name: string,
  description: string,
  latitude: number,
  longitude: number,
  category: string,
  images: string[],
  rating: number,
  ratingCount: number,
  creatorId: string,
  groupIds: string[],
  visibility: 'public' | 'friends' | 'group',
  createdAt: timestamp,
  updatedAt: timestamp
}
```

#### Group (群组)
```javascript
{
  id: string,
  name: string,
  description: string,
  coverImage: string,
  ownerId: string,
  memberIds: string[],
  permission: 'all' | 'admin',
  annotationCount: number,
  createdAt: timestamp
}
```

#### User (用户)
```javascript
{
  id: string,
  nickname: string,
  avatar: string,
  phone: string,
  friendIds: string[],
  followingIds: string[],
  groupIds: string[],
  createdAt: timestamp
}
```

#### Comment (评论)
```javascript
{
  id: string,
  annotationId: string,
  userId: string,
  content: string,
  rating: number,
  parentId: string | null,
  likeCount: number,
  createdAt: timestamp
}
```

### 6.4 地图集成
- **微信小程序**: 使用 `wx.createMapContext` + 腾讯地图
- **QQ小程序**: 使用 `qq.createMapContext` + 腾讯地图
- 地图SDK通过 `<map>` 组件使用

### 6.5 第三方地图链接解析
- 百度地图链接格式: `http://map.baidu.com/m?qt=nb&..."
- 高德地图链接格式: `https://www.amap.com/place/..."
- 解析出经纬度后，使用腾讯坐标转换API统一坐标

### 6.6 状态管理
- 使用 `pinia` 进行状态管理
- 分模块：user, annotation, group, message

### 6.7 数据存储
- **开发阶段**: 本地存储 (uni.setStorageSync)
- **生产阶段**: 需对接后端API (预留接口)

---

## 7. 页面路由

| 路径 | 页面 | 说明 |
|------|------|------|
| /pages/index/index | 地图首页 | 主Tab |
| /pages/share/index | 共享群组 | 主Tab |
| /pages/message/index | 消息中心 | 主Tab |
| /pages/profile/index | 个人中心 | 主Tab |
| /pages/annotation/detail | 标注详情 | 弹窗Sheet |
| /pages/annotation/create | 创建标注 | 新建页面 |
| /pages/group/detail | 群组详情 | 详情页面 |
| /pages/group/create | 创建群组 | 新建页面 |
| /pages/user/profile | 用户主页 | 详情页面 |
| /pages/settings/index | 设置页 | 详情页面 |

---

## 8. 验收标准

- [ ] 地图页面正常显示，可缩放拖拽
- [ ] 可通过长按或按钮添加标注
- [ ] 标注详情页正确显示所有信息
- [ ] 评分和评论功能可用
- [ ] 群组创建和加入功能可用
- [ ] 群组地图显示该群组标注
- [ ] TabBar导航正常切换
- [ ] 消息列表正确分类显示
- [ ] 个人中心信息正确展示
- [ ] 第三方地图链接可解析
- [ ] 可正确编译为微信小程序和QQ小程序
