# 出毛日记：云函数与数据一致性审计（收藏 / 计数 / 消息 / 审核）

- **审计范围**：收藏、点赞/种草、评论/签到等计数写入；`messages` 通知；发布、编辑、评论的内容安全与举报下架；地点详情、发现、个人收藏、排行榜和分享卡片的读取链路。
- **审计方式**：静态源码审计。未访问或修改云开发环境，未假设云函数、集合、索引或内容安全 OpenAPI 已实际部署。
- **严重度口径**：P0＝可造成数据错误或中断主流程；P1＝明显状态不一致/体验受损；P2＝优化或运维风险。

## 1. 流程概述

### 1.1 收藏与展示

1. 地点详情页调用 `toggleFavorite(location)`，帖子详情调用 `post-favorite(post)`；两者都在 `favorites` 写 `{ targetId, targetType, userOpenId }` 关系。
2. 地点详情 `getLocationDetail` 使用 `favorites.count()` 计算收藏数；发现页 `getLocations` 对当前页地点查 `favorites`，但最多只取 100 条再内存累加；个人中心收藏页只查询本人收藏的**地点**；排行榜则读取 `locations.favoriteCount` 文档字段。
3. 但是收藏写入函数并未更新 `locations.favoriteCount` 或任何 `posts.favoriteCount` 字段；新建地点也没有初始化 `favoriteCount`。因此不同入口不是同一真相来源。

### 1.2 计数与通知

- 点赞、种草、评论、签到均为“先写关系/评论，再 `_.inc()` 写目标文档计数”的串行两步操作；没有事务或请求幂等键。
- 收藏、点赞、种草、评论、评论点赞会尝试向 `messages` 写通知，但大多数生产者没有初始化 `messages` 集合，且将通知异常吞掉以保证主操作成功。
- `getMessages` 能尝试创建 `messages`，但这发生在**读取消息时**，不能补回此前丢失的通知。

### 1.3 审核

- 动态、地点、评论和编辑分别携带近似但不一致的 `contentSecurity` 实现。
- 审核 API 异常时，评论会写 `moderationStatus: 'review'`；首次发动态/地点并不写该状态；编辑会写该状态。所有常规读取又只排除 `hidden`，没有排除 `review`，使“待复审”内容仍对公众可见。

## 2. 发现的问题清单

| 严重度 | 问题 | 证据 | 用户/数据影响 | 可执行修复方案 |
|---|---|---|---|---|
| **P0** | **收藏关系是“先查后写”，无唯一约束、无事务；并发点击/重试可产生重复收藏，取消时只删第一条。** | `cloudfunctions/toggleFavorite/index.js:40-60` 先 `where(targetId,targetType,userOpenId)` 再 `add()`；`cloudfunctions/toggleFavorite/index.js:48-50` 取消只删 `favRes.data[0]`。帖子路径重复同样模式：`cloudfunctions/post-favorite/index.js:38-54`、`cloudfunctions/post-favorite/index.js:74-76`。 | 两个并发“收藏”请求都可能读到空结果并各插入一条。之后取消仅删除一条却返回 `favorited:false`；下次读取仍为已收藏。地点详情的 `count()` 还会将重复行当成多个收藏，个人收藏统计也会被重复放大。 | 以 `SHA-256(targetType + ':' + targetId + ':' + openid)` 作为确定性的 `favoriteId`（或确定性文档 `_id`），在**同一数据库事务**中读取该文档、`set/remove` 收藏关系、对目标计数 `_.inc(+1/-1)`；返回事务的最终 `favorited` 和 `favoriteCount`。不要继续用“where 后 add”。先做一次迁移：按三元组去重、重建每个目标的计数。 |
| **P0** | **其它关系型计数同样跨多次写入，写入半途失败或并发时会出现“关系/内容存在但计数错误”，失败重试还可能重复创建。** | 评论先 `comments.add()`，后增目标 `commentCount`：`cloudfunctions/comment-create/index.js:108-120`；任一步异常统一返回失败：`cloudfunctions/comment-create/index.js:141-145`。帖子点赞先写/删 `likes` 后更新 `likeCount`：`cloudfunctions/post-like/index.js:38-59`、`79-84`；种草关系和计数也分步：`cloudfunctions/toggleReaction/index.js:32-65`；签到同理：`cloudfunctions/checkInLocation/index.js:31-35`。 | 例如评论已插入、目标计数更新失败时，前端收到“评论失败”而用户重试，会有两条评论，`commentCount` 仍可能少计。并发点赞/种草/签到也可能生成重复关系或计数偏差。此类偏差会进入动态热度、地点热度、详情计数和榜单。 | 为每一种“关系 + 目标计数”建立一个复用的事务辅助函数。点赞/种草/签到采用确定性关系 ID（签到键应包含 `dateKey`）；评论由客户端生成 `requestId`，以该 ID 幂等写评论并在同一事务更新 `commentCount`。失败时返回可重试的幂等结果而不是重复创建。对存量做“按关系表重算/修复计数”的后台任务。 |
| **P1** | **地点收藏数/热度的读取来源不一致，发现页还会把超过 100 条的真实收藏截断；排行榜读取一个从未被收藏流程维护的字段。** | 新地点仅初始化 `rating/viewCount`，没有 `favoriteCount`：`cloudfunctions/addLocation/index.js:159-167`；`toggleFavorite` 只删/加 `favorites`，未更新目标：`cloudfunctions/toggleFavorite/index.js:48-75`；帖子收藏函数也只写关系：`cloudfunctions/post-favorite/index.js:46-76`。地点详情精确 `count()`：`cloudfunctions/getLocationDetail/index.js:95-112`；发现页却只 `.limit(100).get()` 再累加：`cloudfunctions/getLocations/index.js:79-87`，并在 `:109` 用可能陈旧/不存在的 `item.favoriteCount` 兜底。发现热度直接使用该值：`pages/discover/discover.js:64-72`；排行榜也使用文档字段：`cloudfunctions/getLeaderboard/index.js:11-13`。 | 同一地点有 150 条收藏时，详情可显示 150，发现页最多显示 100；新地点的排行榜收藏权重通常为 0（字段从未维护）。发现页热度标签也随错误收藏数变化，用户会在列表、详情、排行榜见到不一致的“热门”结论。 | 选定**单一规范来源**：推荐在 `locations` 和 `posts` 均初始化 `favoriteCount: 0`，并由上项事务作为唯一写入者；所有列表、详情、热度、排行榜均只读该计数。高热点写入冲突时使用 10–20 个分片计数器并在读取端聚合/异步回填。若坚持读时聚合，则所有入口都必须使用精确 `count()`/聚合（不可 `.limit(100)` 后计数），且排行榜不能依赖文档旧字段。前端应采用服务端返回的规范 `favoriteCount`，不要只按本地 `±1` 猜测。 |
| **P1** | **个人中心“收藏”统计和列表不是同一集合语义；被下架地点仍可能留在收藏列表中。** | 帖子详情允许收藏帖子：`pages/post-detail/post-detail.js:151-159`；统计查询所有 `favorites`：`cloudfunctions/getUserStats/index.js:37-49`；但个人收藏 tab 固定筛 `targetType: 'location'`：`cloudfunctions/getUserContent/index.js:32-55`，并原样返回地点，未过滤 `visibility/moderationStatus`。个人中心同时展示该统计和该 tab：`pages/profile/profile.js:6-8`、`pages/profile/profile.wxml:87-89`、`149-168`。而详情会拒绝下架地点：`cloudfunctions/getLocationDetail/index.js:32-36`。 | 用户收藏帖子后，“收藏”数字增加但收藏页没有对应条目；收藏的地点被下架后仍显示在收藏页，点开才报已下架。这是可见的统计—清单不一致。 | 明确产品语义并统一实现：若“收藏”统计代表全部内容，个人页至少分为“地点/动态”两个列表，并按收藏记录顺序分别批量查询；若页面只支持地点，则统计也应 `targetType:'location'`。查询目标文档时过滤 `visibility !== 'hidden'` 与 `moderationStatus !== 'hidden'`，对已删除/下架项目不渲染（可保留关系或异步清理）。 |
| **P1** | **通知生产者未确保 `messages` 集合存在，首次收藏/点赞/评论等通知可能被静默丢弃；主流程仍返回成功。** | 读取端才调用 `ensureCollection('messages')`：`cloudfunctions/getMessages/index.js:14-22,37-39`。收藏通知 `add()` 失败后仅 `console.warn`：`cloudfunctions/post-favorite/index.js:63-70`、`cloudfunctions/toggleFavorite/index.js:65-72`；点赞/评论/种草也吞掉异常：`cloudfunctions/post-like/index.js:68-75`、`cloudfunctions/comment-create/index.js:124-139`、`cloudfunctions/toggleReaction/index.js:72-78`。对照之下，关注通知会先初始化集合：`cloudfunctions/followUser/index.js:71-96`。 | 若环境中尚无 `messages`，用户第一次收藏、点赞、评论仍会成功，作者却永远收不到该通知；之后打开消息页才可能建集合，历史通知不可恢复。吞异常让收藏/评论主流程不被通知故障中断是正确的，但当前没有补偿机制。 | 部署/环境初始化脚本显式创建 `messages`（而不是依赖首个用户读消息）；所有通知生产者复用同一个 `enqueueNotification()`。该函数写入可重试的 outbox（含幂等键，例如操作 ID + 接收者），由 worker 投递到 `messages`；通知失败只记录 outbox 和告警，不回滚主业务。为 `messages` 建索引后再切换流量。 |
| **P1** | **“全部标为已读”返回的是更新前的未读数，并且页面忽略业务失败后仍提示成功。** | `getMessages` 在 `markRead` 更新前就统计未读：`cloudfunctions/getMessages/index.js:69-79`，随后才更新所有未读：`:70-75`，但仍把旧的 `unreadRes.total` 返回：`:107-115`。页面 `markAllRead` 仅 `await loadMessages(true)` 后无条件提示成功：`pages/messages/messages.js:77-88`；而 `loadMessages` 对 `res.code !== 0` 只 toast/置 loading，不抛异常：`:50-68`。 | 点击“全部已读”后当前页的 `unreadTotal` 可以仍显示旧值；云函数业务失败也会显示“已全部标记为已读”，造成消息状态误导。 | 先执行 `markRead` 更新，再统一重新执行 `unreadTotal` 和各类型未读计数；删除重复的二次逐条更新，或将其限定为 `markReadIds`。令 `loadMessages` 在非 0 `code` 时 `throw`/返回 `false`，`markAllRead` 仅在确认成功后提示成功并用服务端新计数刷新 UI。 |
| **P1** | **内容安全在“服务不可用”时的降级状态不一致，且 `review` 状态未被公开读取链路隔离，待审核内容事实上仍公开可见。** | 评论审核异常返回 `pass:true, warning`：`cloudfunctions/comment-create/contentSecurity.js:8-12`，创建评论据此写 `moderationStatus: 'review'`：`cloudfunctions/comment-create/index.js:95-105`；评论列表只排除 `visibility:'hidden'`：`cloudfunctions/comment-list/index.js:23-29`，地点详情也仅排除 `moderationStatus:'hidden'`：`cloudfunctions/getLocationDetail/index.js:87-94`。动态/地点首次发布虽在审核异常时得到 `warning`（`cloudfunctions/post-create/contentSecurity.js:9-13`、`cloudfunctions/addLocation/contentSecurity.js:104-116`），但创建文档分别未写 `moderationStatus`：`cloudfunctions/post-create/index.js:133-160`、`cloudfunctions/addLocation/index.js:137-167`；编辑才写入 `review`：`cloudfunctions/updateContent/index.js:127-145`，列表仍只排除 hidden：`cloudfunctions/getPosts/index.js:65-69`、`cloudfunctions/getLocations/index.js:74-76`。 | 内容审核 API 故障时，首次发布地点/动态可直接公开且没有可复审标记；评论/编辑虽标记 `review`，仍被普通读接口返回。各流程对同一故障得到不同安全结果，审核队列无法可靠建立。 | 把审核收敛至一个共享模块，并定义统一状态机 `approved/review/rejected/hidden`。建议：API 故障采用 fail-open 时，**所有**新建/编辑内容都写 `review`、记录 `auditFailureReason` 和重试任务，普通用户读接口只返回 `approved`（作者和管理员可见 review）；或针对高风险场景统一 fail-closed。管理员端增加 review 队列和批准/拒绝动作，不要复用仅有的举报 `hidden` 流程。收藏本身不含用户文本，无需内容审核，但其通知文本必须仅引用已通过上述可见性规则的内容。 |
| **P1** | **云函数未部署（常见 `errCode: 501000`）没有可见的统一识别/重试引导；帖子收藏还会先报成功再静默回滚。** | 帖子收藏先立即显示“已收藏/已取消收藏”：`pages/post-detail/post-detail.js:152-159`；`catch` 只回滚状态，无失败 toast/重试入口：`:160-162`。地点详情只有“操作失败”：`pages/location-detail/location-detail.js:211-224`；发现页虽提示“操作失败，请重试”，没有识别部署错误：`pages/discover/discover.js:1138-1153`；消息页业务失败不进入带重试的 `errorMessage` 状态：`pages/messages/messages.js:50-68`。审计到的页面源码没有 `501000` 分支；而任务说明指定的 `app.js` 和 `utils/common.js` 在当前快照中不存在，无法确认是否有未展示的全局包装。 | 云函数未部署/发布中时，用户无法理解“刚刚显示收藏成功为什么又恢复”；消息页还可能把服务失败表现为空列表。用户只能盲目重试。 | 在可用的 `app.callCloud` 单一封装中将 `errCode === 501000` 映射为结构化 `SERVICE_UNAVAILABLE`，文案为“服务暂不可用，请稍后重试”，并保留原始函数名用于日志；页面在 rollback 后明确 toast，并提供重试按钮/错误态。`loadMessages` 等列表请求非 0 code 必须设 `errorMessage` 以渲染既有 `error-state` 重试入口。补回并纳入版本控制 `app.js`、`utils/common.js` 后添加 501000 自动化用例。 |

## 3. 收藏数/热度来源核对

| 展示入口 | 当前来源 | 结论 |
|---|---|---|
| 地点详情 | `favorites.where({targetId,targetType}).count()`，`cloudfunctions/getLocationDetail/index.js:95-112` | 相对存储的收藏记录无 100 条截断，但会把重复关系也计入。 |
| 发现页地点卡/热度 | `getLocations` 对 `favorites` 只取最多 100 条并内存累加，随后 `pages/discover/discover.js:64-72` 用该值算热度 | 与详情不一致；热门地点会低估。 |
| 个人收藏页 | 收藏关系只用于找出地点；返回原始 `locations`，`cloudfunctions/getUserContent/index.js:34-55`；UI 只显示名称、图片、地址，`pages/profile/profile.wxml:149-168` | 当前**没有展示收藏数/热度**，但收藏范围与顶部统计不一致（见 P1）。 |
| 分享海报 | `getLocationDetail` 后，海报只显示 `reactionUpCount/likeCount` 与 `checkinCount`，`pages/share-card/share-card.js:91-107` | 当前**不展示收藏数或发现页热度**，因此不存在“海报收藏数不同”的直接 UI 冲突；但它也不是发现页热度的同一口径。 |
| 地点排行榜 | 直接使用文档 `item.favoriteCount`，`cloudfunctions/getLeaderboard/index.js:7-13` | 与详情/发现页关系集合聚合不一致，且当前写链路不维护该字段。 |

## 4. favorites 查询与索引建议

当前关键查询模式为：

1. 防重/状态读取：`targetId + targetType + userOpenId`（`cloudfunctions/toggleFavorite/index.js:40-44`、`cloudfunctions/post-favorite/index.js:38-42`）。
2. 地点总数：`targetType + targetId IN [...]`（`cloudfunctions/getLocations/index.js:81-84`）。
3. 个人收藏时间线：`userOpenId + targetType`，按 `createdAt desc`（`cloudfunctions/getUserContent/index.js:34-39`）。

建议在云开发控制台或可版本化的数据库索引配置中显式创建并验收：

- `favorites(targetType ASC, targetId ASC, userOpenId ASC)`：状态读取；实施确定性关系 ID 后，查询应 `.limit(1)`，历史数据去重前仍需处理多行。
- `favorites(targetType ASC, targetId ASC, createdAt DESC)`：按目标统计/运营查询（读时聚合方案需要）。
- `favorites(userOpenId ASC, targetType ASC, createdAt DESC)`：个人收藏列表。
- `messages(toOpenId ASC, createdAt DESC)`、`messages(toOpenId ASC, isRead ASC)`、`messages(toOpenId ASC, type ASC, createdAt DESC)`：分别覆盖列表、未读和 tab 查询。

> 静态快照中未发现数据库索引定义文件，且无法连接云开发控制台；上述索引是否已部署、是否为复合索引，属于必须上线前确认的运行时假设。即使存在普通复合索引，它也不能替代收藏关系的幂等键/事务来防重。

## 5. 已验证正确的部分

1. **收藏目标和访问控制有服务端校验**：`toggleFavorite` 校验登录、封禁、目标存在/下架/圈内可见性（`cloudfunctions/toggleFavorite/index.js:14-37`）；帖子专用路径也做同类校验（`cloudfunctions/post-favorite/index.js:13-36`）。
2. **地点详情没有采用 100 条截断的收藏计数**：使用数据库 `count()`（`cloudfunctions/getLocationDetail/index.js:95-112`）。这不能消除重复关系造成的逻辑错误，但避免了发现页的固定上限截断。
3. **通知故障不阻断收藏、点赞、评论等主操作**：通知写入被局部捕获，主函数仍可返回成功（如 `cloudfunctions/post-favorite/index.js:55-71`、`cloudfunctions/comment-create/index.js:122-141`）。这是正确的主/次链路隔离；需配合 outbox 解决“通知丢失”。
4. **消息已读按消息所属用户校验**：`markReadIds` 会先读消息并比较 `toOpenId === openid` 后才更新（`cloudfunctions/getMessages/index.js:40-46`），不存在仅凭任意消息 ID 标记他人消息为已读的明显路径。
5. **评论回复绑定目标校验存在**：创建回复时确认 parent 的 `targetId/targetType` 属于当前内容（`cloudfunctions/comment-create/index.js:81-86`），避免跨内容挂接回复。
6. **举报下架使用统一的 `visibility:'hidden', moderationStatus:'hidden'`**：`cloudfunctions/manageReports/index.js:48-62`；常规帖子/地点读取会过滤 hidden（`cloudfunctions/getPosts/index.js:65-69`、`cloudfunctions/getLocations/index.js:74-76`）。

## 6. 未验证的假设与上线前检查

1. **云函数/集合/权限**：静态审计无法确认 `favorites`、`messages`、`likes`、`reactions`、`comments`、`checkins`、`ratings` 是否在目标环境存在、是否允许云函数读写、相关云函数是否已部署。因此“messages 首次写入丢失”是由代码在“集合尚不存在”条件下必然发生的缺陷；该条件是否已在环境中触发需要用真实环境验证。
2. **索引**：当前源码快照未包含数据库索引配置，无法确认上节的复合索引是否已建立；应在预发布环境用 explain/压测验证三元组查询、个人收藏排序、消息未读统计。
3. **`app.js` 与 `utils/common.js` 缺失**：任务说明指定 `/home/ubuntu/chumao/app.js`、`/home/ubuntu/chumao/utils/common.js`，但当前共享快照中这两个路径不存在；多个页面仍 `getApp()`/`require('../../utils/common')`。因此无法静态核验 `app.callCloud` 是否全局翻译 501000、`submitComment` 是否另行做幂等或错误提示。报告中对页面局部错误处理的结论不依赖这两个文件；全局兜底需在补齐源码后复审。
4. **内容安全 OpenAPI**：无法验证 `msgSecCheck/imgSecCheck` 的资质、配额、返回策略和管理员复审作业是否实际配置。代码已证明 API 异常的降级路径存在，需用模拟超时/权限拒绝测试 `approved/review/hidden` 的可见性矩阵。

## 7. 建议修复优先级

1. **先修 P0**：为 favorites、likes、reactions、checkins 建立确定性关系 ID + 事务；评论增加请求幂等键；执行去重与计数回填。
2. **统一收藏计数**：初始化并只由事务维护 `locations.favoriteCount`/`posts.favoriteCount`，所有热度、列表、详情、榜单改读该规范值；移除发现页的 100 条内存计数。
3. **补可靠通知**：部署期建集合、outbox + 幂等投递 + 失败监控；消息页修正已读统计和成功提示。
4. **统一审核状态机**：将异常降级、待审可见性、后台审核队列一起交付，避免只写 `review` 不消费。
5. **补全应用入口/公共工具并测试错误态**：特别覆盖 501000、集合不存在、事务冲突、通知失败、审核 API 超时、重复点击和断网重试。
