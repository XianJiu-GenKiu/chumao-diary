# 06｜登录、个人资料与“我的-收藏”流程代码审计

- **审计对象**：福瑞向出毛/外景拍摄日记小程序「出毛日记」
- **范围**：登录、个人资料、设置页收藏入口、我的页收藏 Tab；并沿调用链检查发布、收藏、评论、关注、封禁处理和用户主页。
- **审计方法**：静态源码审计。未连接云环境，未验证云函数部署状态、集合索引、权限规则及真实微信运行时。
- **严重度定义**：P0 = 用户流程中断或数据错误；P1 = 体验明显受损或状态不一致；P2 = 细节优化。

> **源码完整性说明**：本次交付目录实际只包含 `pages/`、`cloudfunctions/` 和 `audit/`。题目指定的 `/home/ubuntu/chumao/app.js`、`/home/ubuntu/chumao/app.json`、`/home/ubuntu/chumao/utils/common.js` 均不存在。因而无法阅读或验证 `app.getOpenId`、`setLoggedInUser`、`callCloud` 与 `createPager/submitComment` 的实际实现。下文把能由现有调用方和云函数确定的问题列为缺陷；把依赖缺失源码才能确认的内容列入“未验证假设”。

## 一、流程概述

1. **登录**：我的页的“上毛”按钮先检查本地协议，再获取 `wx.login` 凭证与可选微信资料，调用 `login` 云函数，并以 `app.setLoggedInUser(result.data)` 建立应用态（`pages/profile/profile.js:227-305`）。云函数按 OpenID 查询/创建 `users` 记录，已封禁用户返回 `-403`（`cloudfunctions/login/index.js:22-68`）。
2. **资料**：资料编辑页读取 `app.globalData.userInfo` 或本地缓存，允许选择头像、背景图，保存时调用 `updateUserProfile`，再只更新 `app.globalData.userInfo` 与本地 `userInfo`（`pages/profile-edit/profile-edit.js:52-63, 140-186`）。动态和地点首次发布都会要求昵称和头像（`cloudfunctions/post-create/index.js:73-82`；`cloudfunctions/addLocation/index.js:91-100`）。
3. **我的/收藏**：我的页将 `favorite` 传给 `getUserContent`，并渲染为地点卡片（`pages/profile/profile.js:5-8, 156-168`；`pages/profile/profile.wxml:149-169`）。设置页通过全局 `profileInitialTab` 切到该 Tab（`pages/settings/settings.js:126-129`；`pages/profile/profile.js:58-63`）。
4. **详情交互**：地点详情调用通用 `toggleFavorite`；动态详情调用 `post-favorite`，两者服务端都写入 `favorites`（`pages/location-detail/location-detail.js:196-224`；`pages/post-detail/post-detail.js:151-162`）。评论 UI 委托缺失的 `utils/common.submitComment`，服务端实际入口为 `comment-create`（`pages/post-detail/post-detail.js:251-258`；`cloudfunctions/comment-create/index.js:28-35`）。

## 二、发现的问题清单

### P0-1｜本次交付源码缺少应用入口和公共工具，审计范围内页面会在加载时中断

- **证据**：
  - `pages/profile/profile.js:1-2`、`pages/profile-edit/profile-edit.js:1-2`、`pages/settings/settings.js:1-2`、`pages/user-home/user-home.js:1-2` 均依赖 `getApp()` 或 `../../utils/common`；动态/地点详情同样直接依赖该模块（`pages/post-detail/post-detail.js:1-2`；`pages/location-detail/location-detail.js:1-2`）。
  - 本地树核验显示 `/home/ubuntu/chumao/app.js`、`/home/ubuntu/chumao/app.json`、`/home/ubuntu/chumao/utils/common.js` 不存在；而 `profile.js` 的 `createPager`、`post-detail.js` 的 `submitComment` 等均由缺失模块提供。
- **影响**：按当前交付内容打包，`require('../../utils/common')` 无法解析，至少我的页、资料页、设置页、用户主页及详情页会在脚本装载阶段失败。更重要的是，题目要求核查的 `app.getOpenId / setLoggedInUser`、统一云调用封装、分页刷新和评论登录引导没有源码，无法完成可复核审计。
- **修复**：将生产版本的 `app.js`、`app.json` 与完整 `utils/common.js` 一并纳入仓库/审计包；在 CI 增加小程序构建或静态依赖检查，确保所有相对 `require` 可解析。补齐后重点复审 `getOpenId`、`setLoggedInUser`、`clearLoginState`、`callCloud`、`createPager.load(refresh)`、`submitComment`。

### P1-1｜“我的收藏”只查询地点，动态收藏会显示在收藏计数中却永远不出现在列表

- **证据**：
  - 动态收藏功能实际写入 `{ targetId, targetType: 'post', userOpenId }`（`cloudfunctions/post-favorite/index.js:37-52`），详情页也暴露了收藏操作（`pages/post-detail/post-detail.js:151-159`；`pages/post-detail/post-detail.wxml:99-102`）。
  - 我的页的 `favorite` 请求虽存在（`pages/profile/profile.js:5-8`），但云函数限定 `targetType: 'location'`，只回查 `locations`（`cloudfunctions/getUserContent/index.js:32-55`）。模板把收藏项硬编码为地点卡片和 `data-type="location"`（`pages/profile/profile.wxml:149-168`）。
  - 统计却不区分类型地统计全部 `favorites`（`cloudfunctions/getUserStats/index.js:37-49`）。
- **影响**：用户收藏一条动态后，个人页“收藏”数字增加，但收藏 Tab 可能显示“还没有收藏”；已收藏动态也无法从“我的收藏”回访。这是可见的数据呈现不一致。
- **修复**：改造 `getUserContent` 的 `favorite` 分支：先按用户取分页后的所有 `favorites`（**不得**限制 `targetType`），按 `targetType` 分别批量查询 `posts` 和 `locations`，合并为按收藏时间排序的统一 DTO，例如 `{ ...content, favoriteTargetType: 'post' | 'location', favoriteCreatedAt }`。同步改造 `pages/profile/profile.wxml` 以按 `favoriteTargetType` 渲染动态/地点卡片，并让 `onItemTap` 路由到 `post-detail` 或 `location-detail`。若产品只计划支持地点收藏，应删除 `post-favorite` 入口并把统计改为只计地点，二者必须一致。

### P1-2｜应用级未登录用户可绕过登录/协议直接写入收藏、点赞、反应、关注或评论，且收藏入口没有统一友好引导

- **证据**：
  - 发布入口有明确的应用态门槛和“去登录”提示（`pages/post-create/post-create.js:49-61`；`pages/location-upload/location-upload.js:95-107`），但地点收藏不检查 `app.globalData.isLoggedIn`，直接乐观更新并调用云函数（`pages/location-detail/location-detail.js:196-224`）；动态收藏同样直接调用（`pages/post-detail/post-detail.js:151-162`）。
  - 动态点赞和地点/动态反应也没有本地登录检查（`pages/post-detail/post-detail.js:113-148`；`pages/location-detail/location-detail.js:344-372`）；用户主页的关注亦无检查（`pages/user-home/user-home.js:119-143`）。
  - 后端把“没有 users 记录”视为 active：`return !result.data.length || result.data[0].status !== 'banned'`，因此仅凭微信云上下文的 OpenID 即可通过状态检查（`cloudfunctions/toggleFavorite/index.js:9-21`；同一模式见 `cloudfunctions/comment-create/index.js:11-35`、`cloudfunctions/toggleReaction/index.js:7-17`、`cloudfunctions/followUser/index.js:9-31`）。这些云函数随后会直接写入对应集合，例如收藏写入 `favorites`（`cloudfunctions/toggleFavorite/index.js:39-60`）、评论写入 `comments`（`cloudfunctions/comment-create/index.js:89-119`）。
  - 评论按钮仅委托给缺失的 `submitComment`，调用方没有本地登录拦截（`pages/post-detail/post-detail.js:251-258`；`pages/location-detail/location-detail.js:239-252`）。
- **影响**：产品定义的“登录”（接受协议、建立 `app.globalData.isLoggedIn`、建立用户资料）与服务端写操作脱节。未点“上毛”的用户可能已产生收藏/评论/关注等数据，但我的页仍显示未登录；即使因调用封装拒绝，详情页也没有统一“请先登录→去登录”的提示，造成静默回滚或模糊的“操作失败”。这也绕开了登录协议流程。
- **修复**：
  1. 在完整的 `app.js` 建立唯一 `requireLogin({ action, requireProfile })`：先判定可信的应用会话，未登录时显示统一 modal（“登录后才能{action}”）并在确认后 `switchTab('/pages/profile/profile')`；需要资料时再跳 `profile-edit`。
  2. 所有写操作（`toggleFavorite`、`post-favorite`、`post-like`、`toggleReaction`、`followUser`、`submitComment`、评分、签到、合集）在调用前均使用此函数；不要只依赖云函数返回后的错误处理。发布页现有 `_ensureLoggedIn` 应收敛到该统一函数。
  3. 服务端应区分“微信 OpenID 存在”和“已注册为产品用户”：将 `isUserActive` 改为返回用户记录，缺记录返回明确的 `code: -1, message: '请先登录'`，封禁返回 `-403`。如希望在首次资料保存创建账号，则只能由登录/资料完成的受控流程创建，而非任意交互云函数隐式创建数据。
  4. 补回 `utils/common.js` 后核对 `submitComment` 是否也使用同一守卫；若没有，应在该函数中实现，避免两个详情页再次分叉。

### P1-3｜未登录也可进入资料编辑并保存，成功后只写 userInfo、不写登录态，形成“资料已保存但我的页仍未登录”的状态裂缝

- **证据**：
  - 未登录状态下我的页仍展示设置按钮，且没有条件判断（`pages/profile/profile.wxml:3-5`；`pages/profile/profile.js:184-186`）；设置项始终包含“编辑资料”（`pages/settings/settings.js:34-42`），`onSettingTap` 对该 URL 不做登录检查（`pages/settings/settings.js:65-71`）。
  - `profile-edit` 的 `onLoad` 允许用空对象加载，未检查 `isLoggedIn`（`pages/profile-edit/profile-edit.js:52-63`）。保存后只设置 `app.globalData.userInfo` 和本地缓存（`pages/profile-edit/profile-edit.js:153-173`）。
  - 我的页真正判定登录则同时要求 `userInfo.openId` 与 `app.globalData.isLoggedIn`（`pages/profile/profile.js:49-57`），而资料保存没有设置后者；云函数在找不到用户时还会新增用户记录（`cloudfunctions/updateUserProfile/index.js:103-125`）。
- **影响**：访客可从设置进入资料编辑，填昵称/头像后服务端可能已新增 `users`，但返回我的页仍被当作未登录且数据被重置。用户会看到“保存成功”却仍是“尚未登录”，后续仍被发布门槛拦截；同时协议同意状态也被绕开。
- **修复**：首选在 `profile-edit.onLoad` 调用统一 `app.requireLogin({ action: '编辑资料' })`，未登录即回到登录页，阻止绕过协议。若产品明确允许“填写资料即完成注册”，则保存成功后必须调用 `app.setLoggedInUser(nextUser)`（不要手写部分 globalData 字段），确保同时设置 `openId`、`isLoggedIn`、缓存和事件通知；并在 `updateUserProfile` 中仅允许受控的首次注册路径创建用户。

### P1-4｜封禁（-403）在读取、互动和前端提示之间不一致；部分路径把明确原因吞成“操作失败”或完全静默

- **证据**：
  - 登录云函数对已封禁用户返回明确原因（`cloudfunctions/login/index.js:24-28`），我的页登录失败会展示 `result.message`（`pages/profile/profile.js:290-302`）。资料保存、动态发布、地点发布也会向用户透传服务端 message（`pages/profile-edit/profile-edit.js:153-183`；`pages/post-create/post-create.js:224-262`；`pages/location-upload/location-upload.js:388-405`）。
  - 但地点收藏对任何非 0 都抛错后只显示“操作失败”（`pages/location-detail/location-detail.js:211-224`）；动态收藏先提示“已收藏/已取消收藏”，失败时只回滚、没有任何失败或封禁提示（`pages/post-detail/post-detail.js:152-162`）。关注仅在 `code === 0` 时显示结果，`-403` 等非成功响应直接落空（`pages/user-home/user-home.js:119-143`）。
  - `getUserContent` 和 `getUserStats` 不检查 `users.status`（`cloudfunctions/getUserContent/index.js:17-72`；`cloudfunctions/getUserStats/index.js:12-54`），已封禁账号仍可读取我的内容/统计；而消息云函数会返回 `-403`（`cloudfunctions/getMessages/index.js:24-32`），我的页 `loadUnreadCount` 对非成功码不提示（`pages/profile/profile.js:107-115`）。评论点赞云函数甚至返回英文封禁文案 `Account is banned`（`cloudfunctions/toggleCommentLike/index.js:17-20`）。
- **影响**：封禁账号可能还能看到完整“我的”数据，却在点击不同互动按钮时分别遇到静默回滚、普通“操作失败”、中文或英文封禁文案。用户不知道是网络问题、内容状态问题还是账号受限，支持排障和封禁告知均不完整。
- **修复**：在 `app.callCloud`（待补齐源码）集中识别 `res.code === -403`，统一调用例如 `handleAccountBanned(message)`：清理本地登录态、停止当前加载、显示“账号已被封禁；如有疑问请联系管理员”的不可取消提示，并跳转/停留在说明页。所有页面必须在收到业务 `res` 时调用该逻辑，不能只在 `catch` 中处理异常。统一所有云函数使用 `{ code, message }` 和中文消息；决定并一致实施封禁策略：若封禁应完全阻断账号功能，则给 `getUserContent`、`getUserStats` 加同一 `isUserActive` 检查；若允许只读，则前端要明确说明“账号已限制互动”。

### P1-5｜个人资料字段与用户主页读取字段不一致，兽设名和简介会在公开用户主页丢失

- **证据**：
  - 编辑页读写的是 `furName`、`signature`（`pages/profile-edit/profile-edit.js:58-62, 153-169`），云函数也只持久化这两个字段（`cloudfunctions/updateUserProfile/index.js:58-62, 89-100`）。自己的我的页正是读取 `userInfo.furName`、`userInfo.signature`（`pages/profile/profile.wxml:28-30`）。
  - 公开用户主页云函数却只输出旧字段 `bio`、`fursuitName`（`cloudfunctions/getUserPublicContent/index.js:66-72`），用户主页模板也只显示 `user.fursuitName` 和 `user.bio`（`pages/user-home/user-home.wxml:14-19`）。
- **影响**：用户在“编辑资料”中保存的兽设名、个人简介在自己的我的页可见，但其他人打开 `user-home` 时为空，构成真实资料展示不一致。
- **修复**：确定统一用户 schema（建议 `nickname`、`avatar`、`furName`、`signature`）。在 `getUserPublicContent` 映射兼容字段：`furName: user.furName || user.fursuitName || ''`、`signature: user.signature || user.bio || ''`；相应改 `user-home.wxml` 使用新字段。对历史数据执行一次迁移或在 `updateUserProfile` 过渡期同步写别名，待数据迁移后删除兼容分支。

### P1-6｜用户主页业务失败后仍保持 loading=true，错误用户/请求失败会永久显示骨架屏

- **证据**：`loadData` 初始 `loading: true`（`pages/user-home/user-home.js:4-20`）；当云函数返回 `code !== 0` 时仅 toast 后 `return`，没有清除 loading 或写错误态（`pages/user-home/user-home.js:47-57`）。模板在 `loading` 时只显示骨架，并且仅在 `!loading && user` 时显示正文，没有错误/重试分支（`pages/user-home/user-home.wxml:4-12`）。云函数确实会在缺少目标 ID、用户不存在或异常时返回非 0（`cloudfunctions/getUserPublicContent/index.js:22-32, 87-90`）。
- **影响**：打开已失效用户链接、被删除账号或云函数返回业务错误时，用户先看到一次 toast，随后界面永久停在骨架屏，无法理解或恢复。
- **修复**：给 `data` 增加 `errorMessage`；在 `res.code !== 0` 分支设置 `{ loading: false, errorMessage: res.message || '加载失败' }`，在 `catch` 同样设置，模板增加空错误态和“重试”按钮，重试调用 `loadData`。对于 `-403` 复用统一封禁处理，不应只留骨架。

## 三、已验证正确的部分

1. **登录协议和加载防抖**：登录入口先检查 `agreementAccepted`，未同意时展示协议弹窗；`loginLoading` 防止重复提交，并在 `finally` 恢复状态（`pages/profile/profile.js:227-245, 276-305`）。
2. **登录时的封禁提示可达**：`login` 对已存在且 `status === 'banned'` 的用户返回明确 `-403`，前端登录分支会直接展示服务端 message（`cloudfunctions/login/index.js:24-28`；`pages/profile/profile.js:290-302`）。
3. **发布的登录和资料门槛基本合理且可自助解除**：动态/地点发布页在进入时给出“请先登录→去登录”指引（`pages/post-create/post-create.js:49-61`；`pages/location-upload/location-upload.js:95-107`）；服务端仅在缺昵称或头像时返回 `-4`（`cloudfunctions/post-create/index.js:73-82`；`cloudfunctions/addLocation/index.js:91-100`），前端可跳转资料编辑（`pages/post-create/post-create.js:224-235`；`pages/location-upload/location-upload.js:388-397`）。资料页提供头像选择和昵称输入（`pages/profile-edit/profile-edit.js:70-75, 140-144`；`pages/profile-edit/profile-edit.wxml:20-29`），所以**已登录用户不存在无法自助补齐昵称+头像的死循环**。
4. **设置页跳转收藏 Tab（已登录路径）正确传递和消费**：设置页设置 `app.globalData.profileInitialTab = 'favorite'` 后 `switchTab`（`pages/settings/settings.js:126-129`）；我的页 `onShow` 校验 key、设置 `activeTab/activeTabIndex` 并清空一次性参数（`pages/profile/profile.js:58-63`），随后在登录状态加载当前 Tab（`pages/profile/profile.js:64-70`）。
5. **取消地点收藏后存在返回我的页即请求刷新当前 Tab 的调用链**：地点详情取消收藏成功或失败会维护详情页状态（`pages/location-detail/location-detail.js:196-224`）；从详情返回时我的页 `onShow` 会调用 `_loadCurrentTab(true)`（`pages/profile/profile.js:49-70`）。这满足“返回我的-收藏时触发刷新”的页面层设计；但 `createPager.load(..., true)` 的具体清空、错误写入和分页行为因 `utils/common.js` 缺失而无法最终验证。
6. **我的页模板已包含骨架、空态和错误组件的展示分支**：错误态、骨架、收藏空态均在模板中定义（`pages/profile/profile.wxml:112-121, 200-224`），且 `error-state` 已在页面配置声明（`pages/profile/profile.json:1-6`）。实际是否由 pager 正确赋值 `errorMessage/isLoading/hasMore` 仍依赖缺失公共工具。
7. **资料更新云函数存在昵称校验、文本/图片安全审核和封禁拦截**（`cloudfunctions/updateUserProfile/index.js:53-86`）；正常保存后前端会更新上一个我的页的数据（`pages/profile-edit/profile-edit.js:174-181`）。

## 四、未验证的假设与待补充材料

| 项目 | 原因与需要验证的内容 |
|---|---|
| `app.getOpenId / setLoggedInUser / clearLoginState / callCloud` | `app.js` 实际缺失。无法确认 OpenID 获取时机、是否以 `code` 兑换会话、是否统一处理 `-403`、以及登录状态的持久化和失效策略。 |
| `createPager` 的刷新、分页、错误态 | `utils/common.js` 实际缺失。虽可确认我的页在返回时调用 `_loadCurrentTab(true)`，但无法确认 `refresh=true` 是否清空 `favoriteList`、是否防并发、是否把业务非 0 转为 `errorMessage`。 |
| 评论的客户端登录引导 | 两个详情页均委托缺失的 `submitComment`。调用方未设守卫、服务端也接受未建 users 记录的 OpenID；但不能在没有 helper 源码时断言该 helper 是否已有 modal 引导。 |
| 云数据库真实部署与权限 | 无法验证 `users/favorites/posts/locations/comments` 等集合是否存在、权限规则是否阻止客户端绕过云函数、索引能否支持排序查询、以及 `users.status` 的实际数据形态。 |
| 微信云上下文行为 | “未登录”在本报告指产品的 `app.globalData.isLoggedIn` 为 false；微信云函数是否始终能取得 `OPENID` 依赖部署与会话环境。现有云函数代码本身已把有 OpenID但无 users 记录视为 active。 |

## 五、建议修复优先级

1. **先修 P0**：补齐并构建验证 `app.js`、`app.json`、`utils/common.js`，否则无法运行或完整回归本流程。
2. **再修收藏数据模型**：支持 `post` 和 `location` 两类收藏的统一列表/路由，确保统计与列表口径一致。
3. **建立单一身份与封禁中间层**：前端 `requireLogin` + `callCloud` 的 `-403` 统一处理，服务端不再把“无 users 记录”当已登录产品用户。
4. **收敛用户 schema 并补错误态**：修复 `furName/signature` 与 `fursuitName/bio` 漂移，修复 `user-home` 的永久骨架屏。
