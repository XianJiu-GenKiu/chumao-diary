# 出毛地图

探索与发现 - 地图位置标注分享平台

## 功能特性

- **地图标注** - 随时随地对喜欢的地点进行标注分享
- **群组共享** - 创建或加入群组，查看所有成员的标注
- **评分评论** - 对标注的地点进行评分和评论
- **自定义分类** - 支持按美食、风景、娱乐等分类管理
- **跨平台** - 支持微信小程序和QQ小程序

## 技术栈

- **框架**: uni-app
- **语言**: Vue 3 + TypeScript
- **样式**: SCSS
- **状态管理**: Pinia

## 开发

### 安装依赖

```bash
npm install
```

### 运行微信小程序

```bash
npm run dev:mp-weixin
```

### 运行QQ小程序

```bash
npm run dev:mp-qq
```

### 运行H5

```bash
npm run dev:h5
```

### 构建

```bash
# 构建微信小程序
npm run build:mp-weixin

# 构建QQ小程序
npm run build:mp-qq

# 构建H5
npm run build:h5
```

## 项目结构

```
chumao-map/
├── pages/                 # 页面目录
│   ├── index/            # 地图首页
│   ├── annotation/        # 标注相关
│   ├── share/            # 共享群组
│   ├── message/          # 消息中心
│   ├── profile/          # 个人中心
│   ├── group/            # 群组相关
│   ├── user/             # 用户页面
│   └── settings/         # 设置页面
├── static/               # 静态资源
├── styles/               # 全局样式
└── components/           # 组件（待扩展）
```

## 注意事项

1. TabBar图标需要放入 `static/tabs/` 目录
2. 地图功能需要配置腾讯地图密钥
3. 第三方地图链接解析需要后端API支持

## License

MIT
