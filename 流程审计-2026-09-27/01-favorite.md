# 出毛日记｜地点收藏流程静态代码审计

- **审计范围**：地点详情收藏、发现页返回同步、我的收藏与统计、作者通知、加入合集、未登录路径。
- **审计方式**：静态源码审阅；未执行云函数、未连接云数据库。
- **结论摘要**：收藏关系的字段契约整体统一，详情重载时也会从 `favorites` 直接计算正确总数；但当前实现存在一个会产生重复收藏记录的并发数据完整性缺陷。另有地点列表计数截断/无单一真源、从详情返回发现页不刷新、详情页无登录引导、以及加入合集网络失败无反馈等问题。

## 一、流程概述

1. 用户从发现页进入地点详情：`pages/discover/discover.js:848-850` 通过 `navigateTo` 打开详情；详情页在 `onLoad` 调用 `loadLocationDetail()`（`pages/location-detail/location-detail.js:79-84`），后者调用 `getLocationDetail`（`pages/location-detail/location-detail.js:111-118`）。
2. `getLocationDetail` 用 `targetId + targetType + userOpenId` 查当前人的收藏关系（`cloudfunctions/getLocationDetail/index.js:45-60`），并对该地点的 `favorites` 做 `count()`，将结果作为详情 `favoriteCount` 返回（`cloudfunctions/getLocationDetail/index.js:95-113`）。
3. 详情页点击收藏后，前端立即切换 `location.isFavorited`、本地加/减 `location.favoriteCount`（`pages/location-detail/location-detail.js:196-209`），再调用 `toggleFavorite`（`pages/location-detail/location-detail.js:211-216`）。
4. `toggleFavorite` 以相同字段检索 `favorites`，再删除第一条或新增一条记录（`cloudfunctions/toggleFavorite/index.js:40-60`）；新增时向非本人作者写一条 `messages` 通知（`cloudfunctions/toggleFavorite/index.js:61-72`）。
5. “我的收藏”由个人页 `getUserContent(tab=favorite)` 加载（`pages/profile/profile.js:5-8`）；云函数按同一 `userOpenId / targetType=location` 查询收藏，再以 `targetId` 回表 `locations`（`cloudfunctions/getUserContent/index.js:32-55`）。个人统计则直接统计该用户所有 `favorites`（`cloudfunctions/getUserStats/index.js:37-49`）。
6. “加入合集”先拉取合集；空合集时引导创建，选中后调用 `manageCollections(addLocation)`（`pages/location-detail/location-detail.js:379-394`）。服务端以 `locationIds` 数组保存地点，并做集合内去重（`cloudfunctions/manageCollections/index.js:71-79`）。

## 二、发现的问题（按严重度排序）

### P0｜快速连点/重试可写入重复 favorites，取消一次后仍是“已收藏”

**证据**

- 详情页 `toggleFavorite()` 每次点击都会立即发起新请求，没有 `isTogglingFavorite` 锁、按钮禁用态或请求序号；其乐观状态基于当时本地值反转：`pages/location-detail/location-detail.js:196-216`。模板中的收藏控件始终可点击：`pages/location-detail/location-detail.wxml:214-217`。
- 云函数先 `where(...).get()` 判断，再独立 `add()`：`cloudfunctions/toggleFavorite/index.js:40-46`、`cloudfunctions/toggleFavorite/index.js:52-60`；两次请求都可在任一 `add()` 完成前读到空集，进而各自插入一条记录。
- 取消时仅删除查询结果中的第一条：`cloudfunctions/toggleFavorite/index.js:48-50`。已有重复记录时，一次取消必然留下其他记录。
- 云函数虽返回了权威的 `favorited`，详情页成功分支未采用此返回值：`cloudfunctions/toggleFavorite/index.js:75`、`pages/location-detail/location-detail.js:211-217`。失败回滚也不是原始快照，而是按本次计算的值反向加减（`pages/location-detail/location-detail.js:217-223`），会覆盖后续点击已写入的乐观状态。

**影响**

用户快速点两次（意图为“收藏后立即取消”）时，两个云函数可能同时判定“未收藏”并插入两条记录；页面本地状态却已回到未收藏。后续一次取消只删一条，刷新详情后仍显示已收藏、收藏数为 1；个人统计也不会回退到预期值。重复新增还可能给作者写入多条收藏通知（`cloudfunctions/toggleFavorite/index.js:61-72`）。这是收藏关系数据错误，符合 P0。

即使请求没有并发写入，第一笔失败在第二笔成功之后才返回时，第一笔 `catch` 仍会把第二笔的页面结果回滚掉，造成当前页面状态/计数错误。

**可执行修复**

1. 将 `toggleFavorite` 改为幂等的“设定状态”接口，例如 `setFavorite({ targetId, targetType, favorited, operationId })`；不要依赖服务端“读取后翻转”的隐式状态。客户端每次意图生成 `operationId`，重试复用该 ID。
2. 服务端为 `(userOpenId, targetType, targetId)` 使用确定性唯一文档 ID（必要时以哈希生成），并在数据库事务内读取、创建/删除该文档；至少在事务内重读并处理，不可继续 `where().get()` 后裸 `add()`。同时对历史数据做去重迁移，并在部署层建立该组合唯一约束（若云环境支持）。
3. 详情页增加 `isTogglingFavorite`，请求未完成时禁用收藏控件；或使用递增 `favoriteMutationSeq`，只有最后一次请求才能提交/回滚 UI。开始请求前保存完整 `{ isFavorited, favoriteCount }` 快照，失败时仅在该请求仍是最新请求时回滚。
4. 服务端成功响应必须返回权威 `{ favorited, favoriteCount }`；客户端仅在请求序号仍最新时用该值落地，而非忽略 `res.data`。通知仅在事务判定为从未收藏到已收藏时发送一次。

---

### P1｜地点收藏数没有完整的一致性模型，发现页可长期显示错误计数/热度

**证据**

- `toggleFavorite` 只删除/新增 `favorites`，没有任何 `locations.update()` 或 `favoriteCount` 递增/递减：`cloudfunctions/toggleFavorite/index.js:48-60`。
- 新建地点也未初始化 `favoriteCount`：`cloudfunctions/addLocation/index.js:159-167`。
- 详情读路径不信任 `locations.favoriteCount`，而是直接聚合 `favorites`：`cloudfunctions/getLocationDetail/index.js:95-113`，因此详情重新加载后通常是准确的。
- 发现页的 `getLocations` 读路径却一次性取“本页所有地点”的收藏记录，并硬性 `limit(100)`：`cloudfunctions/getLocations/index.js:78-87`；随后返回 `favoriteCountMap[item._id] || item.favoriteCount || 0`：`cloudfunctions/getLocations/index.js:105-115`。当这些地点的收藏关系总数超过 100 时，后续记录被静默截断；而回退字段又从未由收藏写路径维护。
- 发现页热度使用该列表返回的 `favoriteCount`：`pages/discover/discover.js:64-72`。故错误不仅影响数字，也影响热度标签/排序展示依据。

**影响**

同一地点在详情（直查并 `count`）和发现地图卡片（至多扫描 100 条并回退陈旧字段）可长期不一致。收藏较多时，部分地点可被显示为 0 收藏或低热度，且不会靠后续收藏自动修复 `locations.favoriteCount`。

**可执行修复**

选择并统一一个计数真源，推荐：

1. 在 P0 所述事务内，只有真实新增时对 `locations.favoriteCount` 原子 `inc(1)`，只有真实删除时 `inc(-1)`（下限保护为 0）；在 `addLocation` 显式初始化 `favoriteCount: 0`。
2. `getLocations` 直接返回已维护的 `locations.favoriteCount`，不再用总量为 100 的跨地点扫描做计数。`getLocationDetail` 也返回该字段，或将 `favorites.count()` 仅保留为异步校验/修复任务。
3. 对已有地点运行一次离线回填：按 `favorites(targetType='location', targetId)` 的精确总数写回 `locations.favoriteCount`，并告警负数/重复记录。
4. 如果暂不引入反范式计数，`getLocations` 必须逐地点做精确 `count()`（或用聚合查询）并保证每个地点的完整结果，不能以 `limit(100)` 的不完整集合计数；这是正确性优先但性能较差的过渡方案。

---

### P1｜从地点详情返回发现页不刷新，收藏状态、计数和热度仍是进入前旧值

**证据**

- 发现页初次加载地点列表仅在 `onLoad` 调用 `pager.load()`：`pages/discover/discover.js:247-250`；手动下拉才会重新拉取：`pages/discover/discover.js:822-827`。
- 返回页面时执行的 `onShow` 只同步用户、深色模式、城市/天气，没有重新加载 `locationList`，也没有处理收藏变更事件：`pages/discover/discover.js:347-360`。
- 用户从发现页进入详情的路径为 `navigateTo`：`pages/discover/discover.js:848-850`；详情页收藏完成后也未发出跨页同步事件（`pages/location-detail/location-detail.js:196-224`）。
- 对照而言，个人页每次 `onShow` 都会重新加载统计和当前 tab（包括 favorite）：`pages/profile/profile.js:49-70`，因此“我的-收藏”在从详情返回个人页时会刷新。

**影响**

用户在详情收藏/取消后返回发现页，旧的 `locationList` 仍持有旧 `isFavorited`、`favoriteCount` 和以它计算的热度；再次打开地图标点可能看到错误状态，直到用户主动下拉刷新或重新进入页面。“我的-收藏”路径已具备刷新，问题主要在发现页。

**可执行修复**

- 在详情成功确认服务端状态后，向应用事件总线发布 `favoriteChanged({ targetId, targetType, favorited, favoriteCount })`；发现页在 `onLoad/onUnload` 订阅/注销事件，并精确更新 `locationList`、`selectedPoi` 和热度相关字段。P0 修复后使用服务端返回的权威值。
- 再增加兜底：发现页记录 `favoriteRevision` 或 `needsLocationRefresh`，在 `onShow` 检测后执行 `pager.load(this, true)`、`_buildMapMarkers()`。不可只依赖用户下拉刷新。
- 个人页目前 `onShow` 已刷新，可保留；为减请求可仅在收到 `favoriteChanged` 或版本变化时刷新当前 tab 和 `loadStats()`。

---

### P1｜地点详情页未登录点击收藏没有登录引导，且服务端可能接受未完成应用登录的身份

**证据**

- 地点详情 `toggleFavorite()` 在本地乐观更新后直接调用云函数，没有检查 `app.globalData.isLoggedIn`，也没有“去登录”弹窗：`pages/location-detail/location-detail.js:196-224`。
- 同一发现页 POI 收藏路径已有明确的未登录拦截和跳转个人页逻辑：`pages/discover/discover.js:1118-1128`，两条入口体验不一致。
- 云函数仅检查 `cloud.getWXContext().OPENID`（`cloudfunctions/toggleFavorite/index.js:14-20`）；其 `isUserActive` 在找不到 `users` 记录时返回 `true`（`cloudfunctions/toggleFavorite/index.js:9-12`）。因此若云环境为匿名访问者提供 OPENID，未完成应用登录的用户仍可直接写入 `favorites`；若运行时无 OPENID，则前端最终只显示笼统的“操作失败”（`pages/location-detail/location-detail.js:217-223`），仍无登录指引。

**影响**

未登录用户没有可预期的流程：可能成功写入一条与当前“未登录”个人页不匹配的收藏，或看到“操作失败”却不知道需登录。收藏入口的行为也与发现页 POI 卡片矛盾。

**可执行修复**

1. 抽取 `app.requireLogin()`；在详情页 `toggleFavorite()` 的任何乐观更新前调用。未登录时弹出“登录后才能收藏地点”，确认后 `switchTab('/pages/profile/profile')`，与发现页保持统一。
2. `toggleFavorite` 服务端除 OPENID 外还应验证应用账号/登录标识（例如存在有效 `users` 记录、未封禁），不要将“没有 users 记录”视为已激活。对产品允许的游客收藏另建游客态和后续绑定机制，不能复用正式收藏而不提示。
3. 对 `code === -1` 且消息为“未登录”单独提示/跳登录，不应统一映射为“操作失败”。

---

### P1｜“加入合集”网络/调用异常会静默失败

**证据**

- `addToCollection()` 的外层 `try/catch` 只包住首次 `manageCollections(list)` 和打开 ActionSheet：`pages/location-detail/location-detail.js:379-394`。
- 用户选择合集后的异步回调中，`await app.callCloud('manageCollections', { action: 'addLocation', ... })` 没有局部 `try/catch`：`pages/location-detail/location-detail.js:388-393`。回调在外层 `try` 已结束后执行，Promise reject 不会进入外层 `catch`。
- 服务端会对地点不存在、下架、权限等情况返回非 0 code：`cloudfunctions/manageCollections/index.js:71-79`，这类正常响应会显示 toast；但网络异常/云调用 reject 没有任何用户反馈。

**影响**

用户选中合集后，若网络断开、云函数调用异常或 SDK reject，界面没有成功/失败提示，用户无法判断是否已加入，易导致反复操作。

**可执行修复**

在 `showActionSheet.success` 内部包裹完整 `try/catch/finally`：请求期间设 `isAddingToCollection` 或显示 loading；成功仅在 `code===0` 时提示；`catch` 显示“加入合集失败，请重试”。同时为 ActionSheet 的 `fail` 区分用户取消与异常，取消不提示、异常记录日志/给必要反馈。

---

### P2｜重复加入同一地点被误报为“已加入合集”

**证据**

- 服务端用 `ids.includes(locationId) ? ids : [...ids, locationId]` 去重，重复操作不会实际新增，仍返回 `code: 0`：`cloudfunctions/manageCollections/index.js:77-79`。
- 前端只要 `code === 0` 就统一提示“已加入合集”：`pages/location-detail/location-detail.js:391-393`。

**影响**

数据没有重复，这是正确的；但用户重复点击时会收到暗示“刚刚新增成功”的错误反馈，无法知道地点本来已在该合集里。

**可执行修复**

服务端在 `ids.includes(locationId)` 时返回 `data: { alreadyInCollection: true, locationIds: ids }`（或专用业务码）；前端据此提示“该地点已在此合集”，只在真正新增时显示“已加入合集”。

## 三、已验证正确的部分

- **favorites 字段命名一致**：地点切换收藏写/查使用 `targetId`、`targetType`、`userOpenId`（`cloudfunctions/toggleFavorite/index.js:40-60`）；地点详情使用同一组合（`cloudfunctions/getLocationDetail/index.js:45-60`）；“我的收藏”也使用 `userOpenId` 和 `targetType: 'location'` 后用 `targetId` 查地点（`cloudfunctions/getUserContent/index.js:32-55`）。帖子收藏函数同样采用该字段模型（`cloudfunctions/post-favorite/index.js:37-53`）。在这些已读读写路径间，**不存在字段名不一致导致“已收藏却显示未收藏”的问题**。
- **详情页重载以收藏关系为准**：`getLocationDetail` 对当前人的收藏关系和该地点总收藏数均直接读 `favorites`（`cloudfunctions/getLocationDetail/index.js:45-60`、`95-113`），不是盲目信任旧 `locations.favoriteCount`。
- **收藏成功会通知非本人作者**：仅新增收藏分支会向 `messages` 写入 `type: 'favorite'`，并排除作者自己收藏自己（`cloudfunctions/toggleFavorite/index.js:52-72`）。取消收藏不会发送“取消”消息，符合通常通知预期。
- **个人统计正常路径会纳入并可随取消回退**：`getUserStats` 直接 `count` 当前用户的全部 `favorites`（`cloudfunctions/getUserStats/index.js:37-49`），取消路径会删除一条收藏记录（`cloudfunctions/toggleFavorite/index.js:48-50`）；个人页和设置页在 `onShow` 获取统计（`pages/profile/profile.js:49-70`、`pages/settings/settings.js:18-21,58-63`）。因此在无 P0 重复记录的正常单请求场景，收藏会计入统计、取消后会回退。
- **“无合集”有明确引导**：列表为空时详情页弹出“还没有合集”，确认后跳转合集创建页（`pages/location-detail/location-detail.js:379-387`）；合集页面提供“新建合集”入口（`pages/collections/collections.js:14-22`、`pages/collections/collections.wxml:1`）。
- **发现页内直接收藏已做局部同步**：POI 卡片收藏成功后会将权威意图更新回 `locationList`（`pages/discover/discover.js:1138-1146`），且其未登录引导已实现（`pages/discover/discover.js:1118-1128`）。这不能修复“从详情返回发现页”的问题，但该入口本身的同步意图是正确的。

## 四、未验证的假设与静态审计边界

1. 任务说明指定的 `/home/ubuntu/chumao/app.js` 与 `/home/ubuntu/chumao/utils/common.js` 在当前共享源码中不存在；静态检索也未找到同名文件。因此无法核验 `app.callCloud` 的错误码包装、`isLoggedIn/openId` 的真实赋值，以及 `createPager` 的分页/`hasMore` 实现。这不应被当作已证实的业务缺陷，但应补齐源码后复审。
2. `pages/discover/discover.json` 引用的 `components/poi-preview-card/poi-preview-card` 也不在当前快照，故未核验 POI 卡片内收藏数的具体视觉呈现；本文关于发现页计数的结论来自其数据接口、`computeHeat` 和返回生命周期，均为已读代码。
3. 未连接云环境，无法验证 `favorites` 是否在控制台上配置了 `(userOpenId, targetType, targetId)` 唯一约束、复合索引或事务支持细节。源码自身没有该约束/事务保证；即便外部唯一索引阻止重复插入，当前客户端仍会因并发失败回滚覆盖而出现状态错误，且应按 P0 方案改为幂等。
4. `cloud.getWXContext().OPENID` 对“未完成应用登录”的访问者在目标云环境中是否总是存在、以及 `users` 集合的登录态语义，需在真机和云环境验证；但详情入口缺少登录引导、服务端允许无 `users` 记录这一源码事实已确认。
5. 未验证云函数部署、集合存在性、数据库权限规则、历史 `favorites` 重复数据和真实数据量；尤其需以超过 100 条跨地点收藏关系的测试数据回归 `getLocations` 计数。

## 五、建议回归用例

1. 连续快速点详情收藏两次、三次；通过 `favorites` 查询确认同一 `(openid, targetType, targetId)` 始终最多一条，页面、详情重进、个人统计和作者通知均与最终意图一致。
2. 构造同一发现页 10 个地点合计超过 100 条收藏；比较发现页返回的每个 `favoriteCount`、热度与详情页精确值。
3. 从发现页进入详情收藏/取消并返回；无需手动下拉，标点卡片的心形、计数和热度立即一致。
4. 未登录点击详情收藏；应在任何乐观更新前出现登录引导，且 `favorites` 不新增正式收藏记录。
5. 加入合集时分别测试无合集、真实首次加入、重复加入、非 0 业务码、断网/Promise reject；每种都应有准确反馈。
