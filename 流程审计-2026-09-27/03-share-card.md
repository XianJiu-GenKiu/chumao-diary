# 出毛日记：分享地址名片 / 海报流程代码审计

- **审计对象**：地点、活动、合集路线、帖子详情进入的分享卡片；原生微信转发；小程序码；保存相册。
- **审计方式**：静态源码审计。未调用真实云环境、未生成实际小程序码、未在真机验证相册授权状态。
- **结论摘要**：扫码小程序码的主链路当前必然无法将 `scene` 还原为详情 ID，属于 **P0**；帖子页面暴露的“生成分享卡片”入口必然报“不支持”，活动/合集海报又将业务数据绘制进地点字段，属于 **P1**。另有二维码失败被静默降级、分享计数永不写入、保存授权不能续办等问题。

## 1. 流程概述

1. **详情页入口**
   - 地点详情的底部原生转发按钮为 `open-type="share"`，更多菜单可进入地点海报：`pages/location-detail/location-detail.wxml:224-227`、`pages/location-detail/location-detail.js:415-437`。
   - 活动详情的“分享”按钮实际进入海报页：`pages/event-detail/event-detail.wxml:78-88`、`pages/event-detail/event-detail.js:132-137`。
   - 合集路线有“生成分享卡片”入口：`pages/route-plan/route-plan.wxml:1`、`pages/route-plan/route-plan.js:79-82`。
   - 帖子更多菜单也暴露了“生成分享卡片”：`pages/post-detail/post-detail.js:265-287`。
2. **海报生成**：`share-card` 按 `type` 拉取详情、请求 `generateShareCode`、下载封面及小程序码、在 630×1000 逻辑画布绘制，最后可导出为 1260×2000 图片：`pages/share-card/share-card.js:31-48, 123-159, 162-228, 252-264`。
3. **小程序码目标**：云函数白名单允许地点、活动和合集路线页，将 `scene` 原样传给 `wxacode.getUnlimited`：`cloudfunctions/generateShareCode/index.js:5-25`。
4. **原生转发**：地点、活动、合集、帖子均提供了 `onShareAppMessage`，返回的普通转发路径采用 `?id=`：`pages/location-detail/location-detail.js:94-100`、`pages/event-detail/event-detail.js:139-148`、`pages/route-plan/route-plan.js:83-85`、`pages/post-detail/post-detail.js:189-197`。

## 2. 发现的问题（按严重度排序）

| 严重度 | 问题与证据 | 用户影响 | 可执行修复方案 |
|---|---|---|---|
| **P0** | **小程序码扫码无法解析详情 ID。** 海报请求传入 `scene: \`id=${this.data.id}\``：`pages/share-card/share-card.js:123-135`；云函数将它原样交给 `getUnlimited`：`cloudfunctions/generateShareCode/index.js:13-19`。但三个落地页只读取 `options.id`，未读取/`decodeURIComponent(options.scene)`：地点 `pages/location-detail/location-detail.js:79-84`，活动 `pages/event-detail/event-detail.js:17-23`，路线 `pages/route-plan/route-plan.js:13-15`。 | 扫描已保存或转发海报上的码时，微信会将参数放进 `options.scene`，而非 `options.id`。地点页不会加载详情且会停留在加载骨架；活动页带 `undefined` 请求后报不存在并返回；路线页直接 `navigateBack`。海报最核心的扫码回流完全中断。 | 在三个页面的 `onLoad` 统一先解析 ID，例如新增 `parseSceneId(options)`：当 `options.id` 不存在时，安全执行 `decodeURIComponent(options.scene || '')`，按 `&`/`=` 解析并取 `id`；再校验非空后调用现有加载函数。建议抽至公共工具，避免三个页面再次分叉。无法取到 ID 时应结束 loading 并渲染“链接参数无效/返回”状态，**不要**让路线页直接返回或地点页一直 loading。对 `id` 采用与云函数一致的长度/字符校验。 |
| **P1** | **帖子详情的“生成分享卡片”入口是死入口。** 帖子菜单点击后固定跳转 `type=post`：`pages/post-detail/post-detail.js:265-287`；但海报页仅支持 `event`、`location`、`collection`，其它类型直接抛出“不支持”：`pages/share-card/share-card.js:31-42`。即使绕过该分支，小程序码目标页选择也没有 `post` 分支，默认会走地点页：`pages/share-card/share-card.js:123-131`；云函数白名单也没有帖子详情页：`cloudfunctions/generateShareCode/index.js:6-10`。 | 用户从帖子更多菜单进入后只能看到“暂不支持生成此类海报”并反复重试，无法完成入口承诺的流程。 | 二选一且保持界面一致：**推荐实现帖子海报**，在 `share-card.js` 加 `post` 分支及 `_loadPostData(id)`（调用现有 `post-detail`），映射帖子首图、正文截断、地点、互动数据；在 `_loadMiniProgramCode` 增加 `pages/post-detail/post-detail`，并加入云函数 `allowedPages`；同时给渲染文案增加 post 专用配置。若产品不提供帖子海报，则从 `post-detail.js` 的菜单删除“生成分享卡片”，不要保留不可用入口。 |
| **P1** | **活动/合集复用地点版字段，造成海报文案和数据语义错误。** 活动把 `timeText`、`joinCount`、人数上限分别写进 `bestTime`、`season`、`rating`：`pages/share-card/share-card.js:53-72`；合集也把地点数、路线收藏、待探索塞入同一组地点字段：`pages/share-card/share-card.js:110-120`。绘制层无条件使用“最佳拍摄 / 推荐季节 / 地点评分”，并对非“暂无评分”的 `rating` 追加 ` / 5`：`pages/share-card/share-card.js:203-211`。因此活动会显示“推荐季节：N 人已报名”“地点评分：上限 N 人 / 5”。合集顶部品牌及二维码 CTA 也会被当作地点：`pages/share-card/share-card.js:184-189, 217-227`。 | 已保存和已转发的活动/合集海报向用户呈现错误甚至荒谬的数据含义；特别是人数上限被伪装为评分，会误导报名决策，也降低海报可信度。 | 改为结构化海报模型，而不是复用地点字段：例如 data 中增加 `brandText`、`infoTiles: [{label,value}]`、`ctaTitle`、`ctaSubtitle`。`_loadEventData` 输出“活动时间/已报名/人数上限”，`_loadCollectionData` 输出“收录地点/路线主题/浏览提示”，地点才输出“最佳拍摄/推荐季节/地点评分”。`_render` 遍历 `infoTiles`，仅地点评分使用 `/ 5`；同时按 type 设置“出毛日记·合集”和“扫码查看合集路线”等顶部、底部文案。 |
| **P1** | **小程序码失败被吞掉，海报页无真正失败态或单独重试。** `_loadMiniProgramCode` 捕获包括云函数返回失败、下载失败在内的所有异常后只 `console.warn`：`pages/share-card/share-card.js:123-139`。随后画布照常绘制一个非二维码的“出”字占位，并写“小程序码正在准备中”：`pages/share-card/share-card.js:213-228`。`loadError` 仅由 `_loadData` 外层异常设置：`pages/share-card/share-card.js:31-48`，模板中的重试也只调用整个 `_loadData`：`pages/share-card/share-card.wxml:16-19`。 | 云函数未部署、权限/网络失败或下载失败时，用户会保存一个无法扫码的图片；“正在准备中”没有任何后台任务或完成通知，用户无法知道失败，更没有针对二维码的重试入口。 | 给 `_loadMiniProgramCode` 返回显式结果并维护 `qrLoadError`/`qrCodePath`。若扫码是海报的必要能力，则在无 `fileID`、`res.code !== 0` 或下载失败时抛错，使 `loadError` 显示并禁止“保存海报”；若允许无二维码海报，则在 `share-card.wxml` 显示明确“二维码生成失败，点击重试”，新增 `retryQrCode()` 只重试码的生成、下载和重新绘制，避免把占位描述成“正在准备”。 |
| **P1** | **`shareCount` 只初始化和读取，从未在分享流程写入，热点排序却把它计入分数。** 帖子创建时固定为 0：`cloudfunctions/post-create/index.js:151-159`；详情页和详情云函数只读取：`pages/post-detail/post-detail.js:60-71`、`cloudfunctions/post-detail/index.js:65-78`；全项目分享相关检索未发现 `shareCount` 的更新，`getPosts` 却把它加入 `hotScore`：`cloudfunctions/getPosts/index.js:120-130`。各 `onShareAppMessage` 也只返回分享参数，例如帖子 `pages/post-detail/post-detail.js:189-197`。 | 所有帖子分享后 `shareCount` 仍为 0；若运营或热度排序依赖此字段，数据长期失真，真实分享无法贡献热点排序。 | 明确定义为“发起分享次数”（客户端无法可靠验证收件人是否真正打开），新增受控云函数如 `recordShare`，服务端校验 `targetType/targetId` 后使用 `db.command.inc(1)` 原子更新 `posts.shareCount`，并可记录用户/日期去重。地点、活动若也需要计数应统一数据模型。客户端在用户触发分享入口时调用该函数，且只在请求成功后更新本地显示；若不打算统计，则从 `hotScore` 和页面字段删除该伪指标。 |
| **P2** | **相册授权后不续办保存，且无防重复保存。** `saveToAlbum` 在授权拒绝时仅调用 `wx.openSetting()`，不在用户返回并授权后重试本次导出/保存：`pages/share-card/share-card.js:252-264`。保存按钮无 `isSaving` 状态、无 disabled 绑定：`pages/share-card/share-card.wxml:12-15`。非授权失败时已有“保存失败，请重试”提示，属于已覆盖部分。 | 首次拒绝授权的用户即使在设置页打开权限，仍须回页面重新点击保存；快速连点会并发导出和触发多次相册保存，可能产生重复图片/重复系统提示。 | data 增加 `isSaving`，`saveToAlbum` 开头防重入，按钮加 `loading/disabled="{{isSaving}}"`。封装 `exportAndSave()`；`openSetting` 的 `success` 回调检查 `authSetting['scope.writePhotosAlbum']`，为 `true` 时自动再次调用 `exportAndSave()`，否则明确提示“未授予相册权限”。保留当前非授权失败 toast。 |
| **P2** | **超长标题被硬截为两行且没有省略提示。** `_wrapText` 可产生任意行，渲染时只绘制前两行：`pages/share-card/share-card.js:191-198`；没有像副标题/分类那样调用 `_truncate` 加 `…`（后两者见 `pages/share-card/share-card.js:198-201, 240-241`）。 | 长地点名、活动名、合集名会在海报上无提示地丢失结尾，名称相近时难以区分，降低分享识别性。 | 新增 `_wrapTextWithEllipsis(ctx, text, maxWidth, maxLines)`：保留前两行，在存在第 3 行时对第 2 行按像素宽度回退并加 `…`。用其替换 `_render` 的 `lines.slice(0, 2)`；保持现有 `subY` 计算。 |

## 3. 已验证正确的部分

1. **普通链接转发路径正确**：地点、活动、合集和帖子 `onShareAppMessage` 都构造了对应详情页的 `?id=` 路径（地点 `pages/location-detail/location-detail.js:94-100`；活动 `pages/event-detail/event-detail.js:139-148`；合集 `pages/route-plan/route-plan.js:83-85`；帖子 `pages/post-detail/post-detail.js:189-197`）。这与小程序普通链接参数形式匹配；问题只在小程序码的 `scene`。
2. **地点和帖子原生转发按钮已正确接入 handler**：模板中的 `open-type="share"` 分别位于地点 `pages/location-detail/location-detail.wxml:224-227` 和帖子 `pages/post-detail/post-detail.wxml:103-106`，页面均实现了 `onShareAppMessage`。地点/帖子同时在更多菜单提供海报入口，两个入口并非同一行为。
3. **无封面有可用的视觉降级**：封面下载失败被捕获，画布在 `cover` 为空时填充渐变背景而非调用空图片，见 `pages/share-card/share-card.js:142-146, 167-181`。这不会阻断保存。
4. **`cloud://` 封面下载链路已覆盖**：`_downloadImage` 对 `cloud://` 先调用 `wx.cloud.getTempFileURL`，再通过 `wx.downloadFile` 得到本地临时路径，见 `pages/share-card/share-card.js:243-250`。
5. **画布与导出尺寸逻辑一致，二维码区域有白底**：逻辑画布为 630×1000，按 DPR 建立 backing store：`pages/share-card/share-card.js:147-158`；导出为同一比例的 1260×2000：`pages/share-card/share-card.js:252-259`。二维码区先填白色背景、码图尺寸为 100×100：`pages/share-card/share-card.js:213-219`。
6. **地点无评分不被错误追加 `/5`**：地点数据缺评分时设为“暂无评分”：`pages/share-card/share-card.js:91-107`；绘制层对该值做了特殊处理：`pages/share-card/share-card.js:207-209`。
7. **主数据加载失败有展示和全量重试，非法 `type` 不会白屏**：不支持类型会抛错：`pages/share-card/share-card.js:34-42`，外层落入 `loadError`：`pages/share-card/share-card.js:45-51`，模板展示错误和“重新生成”：`pages/share-card/share-card.wxml:16-19`。缺少 ID 最终也会进入相应详情请求的失败分支（具体提示依赖云函数），不是无提示白屏；但应按 P0 修复后在前端提前校验。
8. **保存的一般失败已提示**：除授权拒绝外，`saveToAlbum` catch 会显示“保存失败，请重试”：`pages/share-card/share-card.js:260-263`。

## 4. 未验证的假设 / 需要上线前确认

1. **源码包不完整**：指定的 `/home/ubuntu/chumao/app.js` 与 `/home/ubuntu/chumao/utils/common.js` 在本次实际目录中不存在；目录只有 `pages/`、`cloudfunctions/` 和已有 `audit/`。因此无法验证 `app.callCloud` 是否将云函数业务错误规范化、`wx.cloud` 是否在入口初始化、页面是否已在最终 `app.json` 注册。上述结论仅依据当前可读页面/云函数源码。
2. **云环境依赖未验证**：无法确认 `generateShareCode` 是否已部署、调用方是否拥有 `wxacode.getUnlimited` 权限、存储路径 `share-codes/` 可写，以及生成的 `fileID` 是否可由客户端 `wx.cloud.downloadFile` 下载。P1 的“二维码失败被静默”在这些任一条件不满足时将实际触发。
3. **ID 格式兼容性待以生产数据确认**：云函数把 scene 限为 `id=[A-Za-z0-9_-]{1,28}`（`cloudfunctions/generateShareCode/index.js:7-10`）。应抽样核对 locations/events/collections/posts 的真实 `_id` 是否均只含该字符集且不超过 28；否则海报码生成会被拒绝。由于未连接数据库，不能将其判定为已发生缺陷。
4. **相册授权和真机画布兼容性未验证**：静态代码显示了相应 API 调用，但不同微信版本的实际 `errMsg`、`openSetting` 返回以及 2D canvas 的导出质量需要 Android/iOS 真机回归。

## 5. 建议回归用例

1. 分别为地点、活动、合集生成海报，扫码进入目标详情，覆盖 `scene` 已 URL 编码和未编码的情况。
2. 使用无封面、`cloud://` 封面、下载失败封面、超长标题、地点无评分、活动有人/无人报名、合集无地点等数据生成并保存海报。
3. 模拟 `generateShareCode` 云函数返回非 0、无 `fileID`、下载失败，确认界面可解释且可单独重试，不能误导为可扫码。
4. 首次拒绝相册权限后在设置页授予权限，验证自动继续；快速连点保存，验证只产生一次保存任务。
5. 从地点/帖子原生分享、活动/合集海报入口及帖子海报入口分别执行，确认入口和功能承诺一致；验证 `shareCount` 指标定义和原子更新策略。
