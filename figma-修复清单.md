# Figma 设计规范修复清单

> 按此顺序操作，约 **2-3 小时**可完成。每完成一项打勾 ✅。

---

## 第一步：创建 Color Styles（约 30 分钟）

### 操作步骤
1. 选中「00_设计规范」画布上的每个色块 Rectangle
2. 右侧面板 → Fill 区域 → 点击 **4 个点图标** → 「**Create Style**」
3. 命名格式：`color / 语义 / 层级`

### 需要创建的 Color Styles：

```
color / primary / base          #D4890E   ← 🆕 加深后主色
color / primary / light         #F5A623   原主色(仅装饰用)
color / primary / bg            #FFF7E6

color / secondary / base        #5BA81A   ← 🆕 加深后辅助色
color / secondary / light       #7ED321
color / secondary / bg          #F0FAE5

color / danger / base           #E02020   ← 🆕 加深后警示色
color / danger / light          #FF4D4F
color / danger / bg             #FFF1F0

color / warning / base          #C7850A   ← 🆕 加深后预警色
color / warning / light         #FAAD14
color / warning / bg            #FFFBE6

color / bg / page               #F7F8FA
color / bg / card               #FFFFFF

color / gray / 50               #FAFAFA
color / gray / 100              #F0F0F0
color / gray / 200              #E5E5E5
color / gray / 300              #D0D0D0
color / gray / 400              #B0B0B0
color / gray / 500              #909090
color / gray / 600              #707070
color / gray / 700              #505050
color / gray / 800              #333333
color / gray / 900              #1A1A1A

color / text / primary          #1A1A1A
color / text / secondary        #707070
color / text / hint             #909090
color / text / disabled         #B0B0B0
color / text / inverse          #FFFFFF

color / border / default        #E5E5E5
color / border / light          #F0F0F0
color / divider                 #F0F0F0
```

---

## 第二步：创建 Text Styles（约 20 分钟）

### 操作步骤
1. 选中「00_设计规范」画布上的每个文字示例
2. 右侧面板 → Text 区域 → 点击 **4 个点图标** → 「**Create Style**」
3. 字体改为：`PingFang SC`（选中的文字可能显示为 Inter，改为 PingFang SC 才能正确渲染中文）
4. 行高改为相对值 → Auto（让 Figma 自动计算，而不是之前的百分比模式）

### 需要创建的 Text Styles：

```
text / 2xl / bold        24px  Bold    行高 Auto  — 页面标题
text / xl / bold         20px  Bold    行高 Auto  — 模块标题
text / lg / semibold     17px  Semibold 行高 Auto — 内容小标题
text / md / medium       15px  Medium  行高 Auto  — 重要信息
text / base / regular    14px  Regular 行高 Auto  — 默认正文
text / sm / regular      13px  Regular 行高 Auto  — 辅助说明
text / xs / regular      12px  Regular 行高 Auto  — 标签/时间
text / 2xs / medium      10px  Medium  行高 Auto  — Badge
```

---

## 第三步：创建 Effect Styles（约 10 分钟）

```
effect / shadow / sm     0 1px 2px rgba(0,0,0,0.05)
effect / shadow / md     0 4px 12px rgba(0,0,0,0.08)
effect / shadow / lg     0 8px 24px rgba(0,0,0,0.12)
effect / shadow / card   0 2px 8px rgba(0,0,0,0.06)
```

---

## 第四步：创建核心 Components（约 60 分钟）

### 按钮 Button

创建 3 个 Variants 在一个 Component Set 中：

| Variant | 背景色 | 文字色 | 圆角 | 高度 |
|---------|--------|--------|------|------|
| primary | #D4890E | #FFFFFF | 8px | 48px ← 🆕 满足最小触控 |
| secondary | #F0F0F0 | #333333 | 8px | 48px |
| danger | #E02020 | #FFFFFF | 8px | 48px |

再加状态 Variants（用 Boolean property）：
- **default** / **disabled**（disabled 时文字 ~40% 透明度）
- **default** / **loading**（加旋转图标）

**操作**：
1. 创建一个 375×48 的 Frame
2. 加 Auto Layout（Horizontal, Center）
3. 填入文字 "按钮"
4. 选中 Frame → 顶部工具栏 → 「Create Component」
5. 复制 2 个 → 命名 primary / secondary / danger
6. 全选 3 个 → 「Create Component Set」
7. 在右侧 Properties 面板添加 Variant

### 卡片 Card

创建一个带 Auto Layout 的卡片：
- 宽度：343px（375 - 16×2）
- 内边距：16px
- 圆角：12px
- 背景：#FFFFFF
- 阴影：shadow / card

### 输入框 Input

- 高度：48px
- 内边距：12px 16px
- 圆角：8px
- 背景：#F0F0F0（默认）/ #FFFFFF（聚焦）
- 边框：1px #E5E5E5（聚焦时变 #D4890E）

### 底部弹出面板 Bottom Sheet

- 顶部圆角：16px 16px 0 0
- 背景：#FFFFFF
- 顶部拖拽指示条：32×4px 圆角条，灰色

### Tab 切换

- 高度：44px
- 选中态：文字 primary color + 底部 2px 指示线
- 未选中：文字 gray-500

### 标签 Tag / Badge

- 高度：24px（角标）/ 28px（标签）
- 内边距：4px 8px
- 圆角：4px（sm）或 9999（药丸形）
- 🆕 最小 10px 字号保留，但仅用于视觉装饰，不作为独立触控目标

---

## 第五步：应用到已有页面（约 30 分钟）

用新创建的 Components 替换各页面中的原始 Frame：
1. 打开「01_首页-筛选」
2. Ctrl+Shift+R 运行「Select all with same properties」选中旧元素
3. 拖入新 Component 替换
4. 重复操作其余页面

---

## 第六步：最终检查

- [ ] 所有颜色引用的是 Color Styles（右侧 Fill 显示「●●●」而不是色值）
- [ ] 所有文字引用的是 Text Styles（右侧 Text 显示「T●」而不是独立设置）
- [ ] 重复 UI 元素全部是 Component Instance（图层图标是 ◇ 而不是 □）
- [ ] 每个 Frame 使用 Auto Layout（方便内容变化时自适应）
- [ ] 底座页面 Frame 宽度统一为 **375px**
- [ ] 顶部 StatusBar 区域预留 **44px**，底部 TabBar 预留 **50px + 安全区**
