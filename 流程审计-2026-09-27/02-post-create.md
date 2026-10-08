# 发表动态流程代码审计报告

- **项目**：出毛日记微信小程序
- **范围**：发表/编辑动态、图片上传入口、草稿、内容审核、资料引导，以及动态列表/发现页回流
- **审计方式**：静态源码审计；未连接微信云环境、未部署云函数。
- **严重度定义**：P0=用户流程中断或数据错误；P1=体验明显受损或状态不一致；P2=细节优化。

## 1. 流程概述

1. 从 `pages/posts/posts.js:178-181`（动态列表）或 `pages/discover/discover.js:1170-1176`（发现页小聚模式）进入 `pages/post-create/post-create`。
2. `post-create` 在 `onLoad` 中检查登录；编辑模式通过 `editId` 拉取详情（`pages/post-create/post-create.js:33-46,88-108`）。新建模式会在 `onReady` 提示恢复草稿、在 `onUnload` 保存草稿（`63-85`）。
3. 用户选择本地图片、录入内容/标签/可见范围后，`publish()` 先上传图片，再调用 `post-create` 或 `updateContent`（`111-125,189-222`）。
4. 新建云函数做字段校验、资料检查与内容审核后写入 `posts`（`cloudfunctions/post-create/index.js:46-99,133-166`）；编辑云函数单独实现了另一套校验与审核路径（`cloudfunctions/updateContent/index.js:23-145`）。
5. 成功后页面移除草稿并 `redirectTo` 动态详情；失败时关闭 loading、保留页面字段（`pages/post-create/post-create.js:242-265`）。

## 2. 发现的问题清单

### P0-1：本次交付的源码缺少发表页运行所必需的公共模块与应用入口，按当前快照无法构建/运行

**证据**

- `pages/post-create/post-create.js:1-2` 依赖 `getApp()` 且 `require('../../utils/common')`（其中包含 `uploadImages`）。
- `pages/posts/posts.js:1-2`、`pages/discover/discover.js:1-3` 同样依赖该模块和应用全局对象。
- 对 `/home/ubuntu/chumao` 的文件系统核验未找到任务指定的 `/home/ubuntu/chumao/utils/common.js` 和 `/home/ubuntu/chumao/app.js`；对这两个绝对路径的读取均返回“不存在”。

**影响**

按本次沙箱中实际提供的源码，编译阶段即会因找不到 `../../utils/common` 失败；即使绕过该问题，也没有 `app.js` 定义 `callCloud`、登录态及全局数据。发表流程不可执行，因此也无法从源码验证 `uploadImages` 的串/并行、压缩失败回退、超时、部分成功回收以及 `createPager` 的具体行为。

**修复**

恢复并纳入版本控制 `utils/common.js`、`app.js` 及其直接依赖，确保小程序根目录完整；在 CI 中增加“页面 `require` 目标存在”和最小构建检查。恢复后应补测 `uploadImages` 的进度回调、超时、重试/取消、部分成功的清理以及对已有 `cloud://` 图片的幂等处理。本项针对**当前交付快照**；若生产构建在其他仓库/子模块中注入这些文件，需提供其精确版本后复审。

### P0-2：内容审核服务异常时新建和编辑都会放行，且“待复审”内容仍会在公开列表中展示

**证据**

- 新建审核模块在 `cloudfunctions/post-create/contentSecurity.js:9-13,23-26` 捕获文字/图片审核异常后返回 `{ pass: true, suggest: 'review' }`，即 fail-open。
- 新建函数只根据 `pass` 决定拒绝（`cloudfunctions/post-create/index.js:84-99`），未读取 `warning`，写入数据时也没有写入 `moderationStatus: 'review'`（`133-160`）。因此审核 API 出错时帖子按默认公开状态直接创建。
- 编辑审核模块虽会在异常时返回 `warning`（`cloudfunctions/updateContent/contentSecurity.js:9-13,23-25`），`updateContent` 也会设为 `moderationStatus = 'review'`（`cloudfunctions/updateContent/index.js:127-145`），但 `getPosts` 仅排除 `moderationStatus === 'hidden'`，未排除 `review`（`cloudfunctions/getPosts/index.js:65-69`）。故编辑时审核不可用，同样可将未经审核内容公开给非作者。
- 与之不一致的是资料更新在审核不可用时明确拒绝并提示稍后重试（`cloudfunctions/updateUserProfile/index.js:70-86`）。

**影响**

审核依赖故障、权限失效或下载文件失败时，潜在违规文本/图片会直接出现在公开内容流，属于内容安全和数据状态错误。用户也看不到“审核未完成/待复审”的任何提示。

**修复**

优先采用 **fail-closed**：`checkText/checkImage` 返回 `warning` 时，`post-create`/`updateContent` 返回专用错误码（例如 `-5`）和明确文案“内容安全检查暂时不可用，未发布/未保存，请稍后重试”；`pages/post-create/post-create.js:239,262` 已会透传该文案并保留表单。

若业务必须降级放行，则必须统一：在新建、编辑均写入 `moderationStatus: 'review'`、持久化失败原因和时间；`getPosts`/`post-detail` 对非作者排除 `review`，作者详情页展示“审核中”；后台复审任务再转为 `approved` 或 `hidden`。不要仅写 `review` 而继续公开。

### P1-1：成功后提前解锁发布按钮，1.5 秒跳转窗口可重复创建动态

**证据**

- 发布成功后仅在 `pages/post-create/post-create.js:248-258` 用 1.5 秒定时器跳转详情。
- 无论成功或失败，`finally` 都在 `263-265` 执行 `this.setData({ isPublishing: false })`。
- 按钮是否禁用只受 `isPublishing` 控制（`pages/post-create/post-create.wxml:131-139`）。

**影响**

首次请求已经成功但页面尚未跳转的约 1.5 秒内，用户可再次点“发布”；第二次会重新上传并再次调用 `post-create`，生成内容重复的两条动态，且可能多出重复云存储文件。

**修复**

将成功路径与失败路径的解锁分开：成功后保持 `isPublishing=true` 直到 `redirectTo/navigateBack` 发起（或新增不可逆的 `isPublished/isNavigating` 标识）；仅在 `catch`、资料引导 `-4` 分支和页面跳转失败时设回 `false`。也可在成功后立即跳转，使用详情页加载态替代 1.5 秒停留。

### P1-2：草稿持久化了临时图片路径；重启后仍提示可恢复，恢复发布会失败且没有定位/重选引导

**证据**

- 选图时直接将 `wx.chooseMedia` 的 `tempFilePath` 放入 `images`（`pages/post-create/post-create.js:117-125`）。
- 卸载时把整个 `images` 数组原样持久化到 Storage（`67-75`），没有 `wx.saveFile`、fileId 或有效性标记。
- 再次进入时只要数组非空就展示“恢复草稿”，确认后直接恢复这些路径（`78-85`）。
- 发布时将恢复出的路径交给上传函数（`201-207`）；任何失败均被折叠为“图片上传失败，请检查网络后重试”（`204-207,259-264`）。

**影响**

微信临时文件路径不保证跨小程序重启有效。用户重启后会被误导为草稿可完整恢复；恢复后的缩略图可能失效，发布失败时也无法得知是图片失效，必须自行删除并重选，文字和标签虽在但图片草稿实质丢失。

**修复**

在 `_saveDraft` 中不要直接持久化 `tempFilePath`：

1. 要保留图片草稿，选图后调用 `wx.saveFile`，保存稳定 `savedFilePath`，恢复前以 `wx.getFileInfo`/读取校验；在发布成功、丢弃草稿、替换图片时调用 `wx.removeSavedFile` 回收。
2. 或仅持久化文字/标签/地点，记录 `imageCount` 和 `imagesNeedReselect: true`；恢复弹窗与页面明确提示“图片需重新选择”。
3. 恢复时逐张检测失效路径，显示“第 N 张图片已失效，点击重选”，而不是将无效路径提交到 `uploadImages`。

### P1-3：创建与编辑的校验规则分叉，纯文字最小长度和装备标签限制可被绕过/导致失败

**证据**

- 前端只校验“内容或图片至少一个”（`pages/post-create/post-create.js:192-195`），没有对纯文字不足 5 字做前置校验；服务端新建会拒绝（`cloudfunctions/post-create/index.js:64-71`）。
- 前端装备标签允许 10 个（`pages/post-create/post-create.js:183`），新建云函数却限制 8 个（`cloudfunctions/post-create/index.js:60-61`）；WXML 也未展示装备上限，仅写“可选”（`pages/post-create/post-create.wxml:97-112`）。
- 编辑云函数对 `data.equipTags` 仅直接赋值（`cloudfunctions/updateContent/index.js:99-105`），没有数量、字符串类型或长度限制；也没有新建函数 `images.length===0 && content.trim().length < 5` 的同等校验（`99-141`）。
- 普通标签的数量上限 5 在前/后端一致（前端 `180`、新建后端 `57-59`、编辑后端 `35-36`），但前端未限制单个标签长度，仍会在提交后由后端拒绝。

**影响**

- 新建时用户能添加第 9/10 个装备标签或输入超长标签，图片已上传后才收到模糊的“装备标签格式不正确/发布失败”。
- 编辑时，用户可将原本合格的纯文字动态改为 1–4 个字且无图，或保存超过创建规则的装备标签，造成创建/编辑数据标准不一致。

**修复**

抽取一份可复用的 `validatePostPayload(payload, { mode })`：新建与编辑云函数均调用它，至少覆盖内容/图片至少一项、无图文字最少 5 字、内容最多 500、图片最多 9、标签最多 5 且每个最多 10、装备最多 **8** 且每个最多 20；编辑应按最终 payload/旧文档合并后验证不变量。前端在 `publish()` 上传之前复用同一规则（或镜像常量）并增加 `input maxlength="10"/"20"`，将 `addEquipTag` 上限改为 8、WXML 明示 `{{equipTags.length}}/8`。这样既减少无效上传，也消除编辑绕过。

### P1-4：首次发布“完善头像和昵称”的引导存在绕过和循环，资料页保存并不保证满足发布条件

**证据**

- `post-create` 仅在查到 `users` 文档时才检查昵称和头像（`cloudfunctions/post-create/index.js:73-82`）；无文档时直接继续创建。`isUserActive` 又将“查无用户”视为活跃（`10-12`），后续会写入默认作者名和空头像（`105-112`）。
- 资料页/资料云函数只要求昵称：页面 `save()` 仅检查 `nickname`（`pages/profile-edit/profile-edit.js:140-144`），服务端也仅拒绝空昵称（`cloudfunctions/updateUserProfile/index.js:58-65`）。`avatar` 为空时不写入更新 patch（`89-100`），新建用户文档时也可以写入空头像（`109-115`）。
- 发表页收到 `-4` 后正确地导航到资料页并保留当前页面（`pages/post-create/post-create.js:224-235`）；资料页保存成功后 `navigateBack`（`pages/profile-edit/profile-edit.js:180-186`）。

**影响**

无 `users` 文档的登录用户可能绕过“首次发布资料完整”规则，公开帖的作者头像为空/昵称为默认值；已有不完整资料的用户即使不选头像也能在资料页显示“保存成功”，返回发布页后再次得到同一个 `-4`，形成无明确阻断提示的循环。

**修复**

在 `post-create` 改为 `if (!user || !hasNickName || !hasAvatar) return { code: -4, ... }`。将“发表前资料完整”设为资料页的显式完成条件：`profile-edit.save()` 和 `updateUserProfile` 都校验 `avatar` 非空且必须为 `cloud://` 文件，头像必填字段给出视觉标识和保存前提示。保存成功后可检查返回页是否为 `post-create`，调用其 `_ensureProfileComplete` 或设置 `profileCompleted`，避免用户返回后才发现仍不能发。

### P1-5：发布成功后动态列表不会自动刷新；发现页的热门动态逻辑是不可达死代码

**证据**

- 从动态列表进入发布页（`pages/posts/posts.js:178-181`）后，新建成功会替换发布页为详情页（`pages/post-create/post-create.js:246-257`）；从详情返回列表时 `posts.onShow()` 只同步深色模式和用户信息，不调用 `pager.load`（`pages/posts/posts.js:79-84`）。当前已加载的 `postList` 因而不会包含新帖。
- 发现页仅有 `map` 与 `xiaoju` 两种 `viewMode`：数据初值为 `map`（`pages/discover/discover.js:126`），切换函数只会设置 `map/xiaoju`（`539-554`），模板的分段控件也只有“地图/小聚”（`pages/discover/discover.wxml:45-54`）。
- 虽实现了 `_loadHotPosts`（`pages/discover/discover.js:795-816`），但文件中没有首次调用；其重试、下拉、触底条件均判断不可达的 `viewMode === 'hot'`（`818,822-839`），模板也没有 `hotPosts` 渲染区（已读完整模板 `discover.wxml:1-346`）。

**影响**

用户发布并从详情返回“全部动态”时看不到刚刚发布的帖子，需手动下拉刷新。发现页当前也不存在可加载/展示热门动态的可达 UI，发布内容无法在该页及时曝光。

**修复**

为 `posts` 增加 `needsPostRefresh` 或事件总线：发布成功时置位，`onShow` 检测后 `pager.load(this, true)`；也可从详情返回时传递刷新标识。对发现页二选一：实现实际的“热门日记”模式（分段项、`viewMode: 'hot'`、`onLoad/onShow` 调 `_loadHotPosts`、WXML 渲染 `hotPosts`），或删除死代码并明确发现页只承载地点/小聚，避免错误的“发布后发现页可见”预期。

### P1-6：图片先上传、后做服务端拒绝，发布失败没有回收本次已上传文件

**证据**

- 页面总是在调用 `post-create/updateContent` 前完成 `uploadImages`（`pages/post-create/post-create.js:200-222`）。
- 云函数后续仍可能因资料不完整、文字/标签/装备校验或内容审核拒绝（`cloudfunctions/post-create/index.js:51-99`），编辑亦可能拒绝审核（`cloudfunctions/updateContent/index.js:127-140`）。
- 拒绝/异常分支仅 toast，未将已得到的 `imageUrls` 传给任何删除/回收接口（`pages/post-create/post-create.js:224-240,259-264`）。

**影响**

用户例如添加第 9 个装备标签、图片审核不通过或资料不完整时，图片已上传到云存储但帖子未创建；再次尝试可能再次上传同一批图片。会形成孤儿文件、增加存储/审核成本，并使上传失败恢复体验变差。

**修复**

先在客户端完成所有可本地完成的校验（见 P1-3），再上传。为上传建立 `uploadSessionId`：`uploadImages` 返回本次 `fileIds`，若云函数非 0 或网络异常，则调用受鉴权的 `deleteTempUploads({ fileIds, sessionId })` 删除本次新增文件；帖子写入成功后在云函数内将这些文件标记为已引用。为防止客户端崩溃，增加定时任务清理未被 `posts.images` 引用且超过 TTL 的会话文件。部分成功场景的精确行为仍需在缺失的 `utils/common.js` 恢复后补测。

### P2-1：上传阶段只有笼统 loading 和泛化错误，缺少逐图进度、失败图片定位与可恢复动作

**证据**

- 页面仅显示 `wx.showLoading({ title: '发布中...' })`（`pages/post-create/post-create.js:197-199`），`uploadImages` 也没有接收进度/重试回调（`201-207`）。
- WXML 只有按钮的“发布中...”状态，不存在进度数据或失败图片标记（`pages/post-create/post-create.wxml:24-33,131-140`）；WXSS 也未定义上传进度样式（`pages/post-create/post-create.wxss:82-143,234-249`）。
- 上传异常被统一改写为“图片上传失败，请检查网络后重试”（`pages/post-create/post-create.js:203-207,262`），丢失了超时、压缩、格式、单张失败等原始原因。

**影响**

多图（最多 9 张）或弱网时用户不知道当前上传到第几张、是否仍有进展，也不能只替换失败图片；非网络错误会被错误归因为网络。当前页面在错误后会解锁且保留字段，这是正确的，但恢复效率较低。

**修复**

将 `uploadImages` 设计为返回任务状态或接受 `{ onProgress, onFileSuccess, onFileError, timeoutMs }`；页面增加 `uploadProgress`、`uploadingIndex`、`failedImageIndexes`，显示“上传 3/9”和单图重试/替换。保留原始错误码并映射为可执行文案（超时→重试、压缩失败→改用原图/重选、格式不支持→重选）。是否当前实现为串行上传、压缩失败是否回退、是否已设超时，因 `utils/common.js` 缺失不能据此断言。

### P2-2：超过 1 MiB 的审核下载失败被错误提示为“违规图片”，用户无法按真实原因处理

**证据**

- 图片审核模块将下载内容超过 1 MiB 直接判为 `pass:false`，附带 `warning: 'image_too_large'`（`cloudfunctions/post-create/contentSecurity.js:16-25`）。
- 调用方不区分该 warning 与真正违规，统一返回“图片包含违规内容，请更换后重新发布”（`cloudfunctions/post-create/index.js:93-99`）；编辑端同样如此（`cloudfunctions/updateContent/index.js:135-140`）。

**影响**

正常但较大的图片会得到不实的违规提示，用户不知道应压缩、重选还是联系支持；这也会掩盖上传压缩是否有效的问题。

**修复**

将尺寸超限作为独立业务错误（例如 `code: -6, message: '图片过大，审核仅支持 1 MiB 以内，请压缩后重试'`），前端在上传前按审核上限压缩并显示结果；若压缩失败要提供“使用原图（可能无法审核）/重新选择”的明确选项。仍应以云端最终大小校验为准。

## 3. 已验证正确的部分

1. **“内容或图片至少一项”在前后端都有校验**：前端 `pages/post-create/post-create.js:192-195`，新建云函数 `cloudfunctions/post-create/index.js:64-67`。
2. **500 字上限一致且有双层约束**：页面数据和输入截断为 500（`pages/post-create/post-create.js:8-10,142-145`；`post-create.wxml:42-50`），新建/编辑云函数均拒绝 `>500`（`cloudfunctions/post-create/index.js:51-53`；`cloudfunctions/updateContent/index.js:38-40`）。纯文字至少 5 字的规则已在**新建云函数**正确实现（`post-create/index.js:68-71`），问题是前端与编辑分支未同步，见 P1-3。
3. **图片数量上限一致**：前端按剩余额度选择并截断到 9（`pages/post-create/post-create.js:7,111-125`），新建和编辑云函数均限制至 9 且只接受 `cloud://`（`cloudfunctions/post-create/index.js:54-55`；`cloudfunctions/updateContent/index.js:32-33`）。
4. **普通标签数量上限一致**：前端最多 5（`pages/post-create/post-create.js:169-181`），新建/编辑云函数均限制最多 5 且限制单项 10 字（`cloudfunctions/post-create/index.js:57-59`；`cloudfunctions/updateContent/index.js:35-36`）。
5. **失败时页面主状态可恢复且表单未被主动清空**：异常路径关闭 loading 并在 `finally` 重置 `isPublishing`（`pages/post-create/post-create.js:259-265`），未调用清空内容/图片的 `setData`；失败后可直接修改再试。成功后移除草稿，避免旧草稿覆盖成功内容（`242-245`）。P1-1 仅指出成功后的跳转等待期不应过早解锁。
6. **成功跳转对编辑和缺少新建 `postId` 有基本兜底**：编辑始终使用已加载的 `editId` 跳详情（`pages/post-create/post-create.js:249-251`）；新建仅在有 `postId` 时跳详情，否则 `navigateBack`（`253-257`）。新建云函数当前成功响应确实返回 `postId`（`cloudfunctions/post-create/index.js:162-166`）。
7. **资料引导的导航栈本身可返回原发布页**：`-4` 时用 `navigateTo` 打开资料页（`pages/post-create/post-create.js:224-235`），资料保存成功 `navigateBack`（`pages/profile-edit/profile-edit.js:180-186`），因此已填内容仍留在原发布页实例中；资料字段约束不足见 P1-4。
8. **编辑时可见性字段在前端、更新函数、读取权限三处具备基本闭环**：前端仅选择 `public/circle`（`pages/post-create/post-create.js:185-187`；`post-create.wxml:120-128`），编辑服务端白名单归一（`cloudfunctions/updateContent/index.js:103-105`），列表与详情对 `circle` 限制非作者（`cloudfunctions/getPosts/index.js:65-69`；`cloudfunctions/post-detail/index.js:26-31`）。

## 4. 未验证的假设与审计边界

1. **关键源码缺失**：当前路径没有 `utils/common.js` 和 `app.js`（P0-1）。因此无法验证 `uploadImages` 是否串行、是否调用 `wx.compressImage`、压缩失败是否回退、是否设上传超时、`wx.cloud.uploadFile` 部分成功/失败后的清理、是否跳过编辑时既有的 `cloud://` 文件；也无法验证 `createPager` 或 `app.callCloud` 的超时与错误包装。
2. **云环境不可验证**：无法确认 `users/posts/locations` 等集合、权限规则、索引、`ensureCollection` 实际可用性，以及微信内容安全 API 的权限、配额、超时和真实响应。特别是 `post-create` 在 `ensureCollection` 之前就查询 `users`（`cloudfunctions/post-create/index.js:10-12,44,73-75`），集合是否已预建是部署前提。
3. **审核后复审链路不可验证**：未见后台任务/管理操作将 `moderationStatus: 'review'` 审核为 `approved/hidden`；即使有，当前公开读取条件仍需按 P0-2 修正。
4. **用户文档通常何时创建不可验证**：缺失 `app.js`/登录入口完整实现，无法判断线上是否始终在发表前创建 `users` 文档；P1-4 描述的是云函数当前允许“无文档用户”直接发表的确定代码路径。
5. **临时文件跨重启失效为微信运行时行为**：源码没有稳定路径处理。失效发生的具体时点由微信客户端回收策略决定，但不能将 `tempFilePath` 当作持久草稿文件。
