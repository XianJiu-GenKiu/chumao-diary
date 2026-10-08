# 发现页浏览与快速收藏流程代码审计

- **审计范围**：发现地图浏览、定位/城市切换、地图 POI 快速收藏、地点详情收藏、搜索/场景筛选与地点跳转。
- **审计方式**：静态源码审计；未连接云环境、未在真机验证。
- **严重度口径**：P0＝流程中断或数据错误；P1＝体验明显受损或状态不一致；P2＝细节优化。

## 流程概述

1. `pages/discover/discover.js` 在 `onLoad` 调用 `pager.load(this, true)` 拉取 `getLocations`，并将 `locationList` 转成地图 marker（`pages/discover/discover.js:247-250,771-793`）。
2. 定位/切城后，发现页更新地图中心并调用 `_loadNearbyLocations()`（`pages/discover/discover.js:362-405,505-525,706-720`）。地图 marker、底图 POI 均可打开 `poi-preview-card`（`pages/discover/discover.wxml:184-215,293-304`）。
3. 卡片收藏在 `onTogglePoiFavorite` 先乐观改 `selectedPoi`，成功后回写 `locationList`（`pages/discover/discover.js:1114-1153`）；地点详情页单独调用 `toggleFavorite`（`pages/location-detail/location-detail.js:196-225`）。
4. 搜索页并行查站内 `searchLocations` 和地图联想 `suggestPlaces`，再依类型跳地点详情或回到发现页加地图标点（`pages/search/search.js:113-145,211-229`）。

## 发现的问题清单

### P0-1：当前沙箱快照缺失发现页的必要运行文件，页面无法按现状构建

- **证据**：发现页注册了 `/components/segmented-control/segmented-control`、`/components/poi-preview-card/poi-preview-card`、`/components/hot-diary-card/hot-diary-card`（`pages/discover/discover.json:6-10`），并在模板实际使用 `poi-preview-card`（`pages/discover/discover.wxml:293-304`）；JS 又强依赖 `../../utils/common` 和 `../../utils/poi-adapter`（`pages/discover/discover.js:1-3`），样式依赖 `../../components/common.wxss`（`pages/discover/discover.wxss:1-2`）。但本次提供的 `/home/ubuntu/chumao` 中不存在 `components/`、`utils/`、根级 `app.js`，也不存在任务指定的两个卡片组件目录。
- **影响**：以当前快照导入开发者工具会因模块/组件路径缺失而无法编译发现页，浏览、卡片详情和快速收藏全部不可用；且无法完成卡片事件参数、原生地图层级遮挡与 `createPager` 错误处理的最终核验。
- **修复**：恢复并纳入版本管理 `app.js`、`utils/common.js`、`utils/poi-adapter.js`、`components/**`、`styles/**`；在 CI 中对 `app.json` / 每页 `usingComponents` 和 `require()` 做存在性校验。恢复后补充真机回归：marker 点击、卡片收藏、详情返回、地图原生层上的卡片点击。
- **说明**：这是**本沙箱源码快照**的 P0；不能据此断言线上仓库同样缺文件。

### P0-2：搜索确认与输入联想共用请求版本号，快速确认搜索可永久停在骨架屏

- **证据**：`onInput` 创建但不在确认搜索时取消的 300ms 联想定时器（`pages/search/search.js:63-72`）；`_fetchSuggestions` 与 `doSearch` 共用 `_requestVersion`（`pages/search/search.js:74-87,113-125`）。`doSearch` 先将 `isSearching` 设为 `true`（`pages/search/search.js:115-117`），若随后旧联想定时器执行，联想会递增版本号；搜索响应在 `version !== this._requestVersion` 时直接 `return`，没有把 `isSearching` 复位（`pages/search/search.js:125-145`）。模板因此持续渲染仅在空结果时展示的骨架屏（`pages/search/search.wxml:109-119`）。
- **影响**：用户输入后在 300ms 内立即按键盘“搜索”，常见情况下搜索请求被旧联想判为过期，`isSearching` 永远为 `true`；页面没有重试/取消入口，搜索流程卡死。
- **修复**：拆分为 `_suggestRequestVersion`、`_searchRequestVersion`，不要让联想使正式搜索失效；`onConfirm`/`doSearch` 开头 `clearTimeout(this._suggestTimer)`；在搜索请求的 `finally` 中仅当仍是当前搜索版本时 `setData({ isSearching: false })`。`loadMore` 也使用独立的搜索版本或请求 token，并为失效请求显式保持/交接 loading 状态。

### P1-1：定位和切城只移动地图中心，“附近推荐”及地图地点查询并未按坐标/城市过滤

- **证据**：发现页把经纬度和 `radius` 传给 `getLocations`（`pages/discover/discover.js:706-719`），定位成功和城市选择均调用该函数（`pages/discover/discover.js:362-405,505-525`）。但云函数只解构 `category`、`page`、`pageSize`，没有读取 `latitude`、`longitude`、`radius` 或城市字段（`cloudfunctions/getLocations/index.js:37-47`），实际仅从 `locations` 取按创建时间排序的窗口（`cloudfunctions/getLocations/index.js:56-77`）。初始地图列表也在定位回调之前即加载（`pages/discover/discover.js:227-250`），定位成功后未重新加载该 pager。
- **影响**：用户看到“附近推荐”或切换城市后，实际仍可能是全库最新地点；地图中心与地点卡片/marker 属于不同城市，属于用户可见的地点数据错误。该问题也放大了定位失败时展示错误城市内容的风险。
- **修复**：为 `getLocations` 明确 `latitude`、`longitude`、`radiusKm`（或 `cityCode`）协议，后端用地理索引/`geoNear` 查询并按距离返回，附加 `distance`；不要静默忽略参数。抽出发现页 `_reloadForLocation({ latitude, longitude, city })`，在定位成功、重新定位、选城后同时重置并加载 `pager` 和 nearby 列表。若产品要展示全国探索，单独标注“全国推荐”，不要复用“附近”。

### P1-2：定位拒绝/失败保留旧地点和默认上海坐标，且用户没有明确的失败态与设置入口

- **证据**：默认地图坐标为上海（`pages/discover/discover.js:181-185`）；`_initLocation` 在全局已准备时会以默认坐标兜底并立刻加载 nearby（`pages/discover/discover.js:362-385`）。`onReLocate` 失败只把文案改为“定位失败”，不清空 marker/nearby/旧坐标（`pages/discover/discover.js:406-439`）；真正模板绑定的定位 FAB 是 `moveToMyLocation`（`pages/discover/discover.wxml:226-228`），其失败仅 toast“请授权位置权限”，没有 `openSetting`、内联重试或失败状态（`pages/discover/discover.js:656-674`）。附近区域空时无差别地显示“暂无地点推荐”（`pages/discover/discover.wxml:269-287`）。
- **影响**：例如用户曾定位成功后撤销权限并点击定位，顶部会显示“定位失败”，面板仍保留上一城市的数据；首次失败时也可能把默认上海作为附近位置。用户难以区分“无结果”“网络失败”“未授权”，也没有清晰的授权后重试路径。
- **修复**：新增 `locationState: locating | ready | denied | failed`、`nearbyError`、`nearbyLocations`，在失败时清空或明确标记旧数据为“上次位置”，禁止把默认坐标当作当前位置；将 `onReLocate` 的 `wx.openSetting` 分支抽成 `_requestLocation()`，让 FAB 也调用它。模板按状态显示“未授权，去设置”“定位失败，重试”“该区域暂无地点”三个不同视图，并把“重试”绑定 `_requestLocation`。

### P1-3：发现地图实际没有后续分页出口，云函数也会在第三页错误宣告无更多数据

- **证据**：发现页只在 `onLoad` 调用一次 `pager.load(this, true)`（`pages/discover/discover.js:247-250`）；`onReachBottom` 只处理永远未切入的 `viewMode === 'hot'`，不会为地图调用 pager（`pages/discover/discover.js:820-840`）。地图面板的滚动容器没有 `bindscrolltolower`（`pages/discover/discover.wxml:269-288`）。后端即使被调用，`scanSize` 在第三页达到 100（`cloudfunctions/getLocations/index.js:40-47`），但 `hasMore` 写成 `result.data.length === scanSize && scanSize < 100`（`cloudfunctions/getLocations/index.js:116-119`），因此第 3 页即使仍有超过 100 条源数据也会返回 `false`。
- **影响**：地图 marker 仅有首次页（配置为每页 10 条，`pages/discover/discover.js:14-19`）可浏览；地点库较大时大量地点永远不可达。即使未来补上前端触底，后端 `hasMore` 仍会过早截断。
- **修复**：给面板 `scroll-view` 增加 `bindscrolltolower="onLocationReachBottom"`，在该函数中调用 `pager.load(this, false)` 并重建 marker；或者提供“加载更多地点”按钮和明确 loading/error/empty 状态。后端改用可持续游标分页（推荐 `createdAt + _id` cursor）或至少读取 `safePageSize + 1` 判断是否有下一页；不要把扫描上限等同于真实列表终点。

### P1-4：发现页快速收藏与地点详情收藏没有双向同步，返回后同一地点状态/数量会不一致

- **证据**：卡片收藏成功后仅回写发现页 `locationList`（`pages/discover/discover.js:1138-1146`）。进入详情前只隐藏卡片，并不登记回传同步（`pages/discover/discover.js:1090-1095`）；发现页 `onShow` 仅同步用户、深色模式和城市，不重拉/对账地点列表（`pages/discover/discover.js:347-359`）。详情页 `toggleFavorite` 只乐观改 `location.isFavorited` / `location.favoriteCount`（`pages/location-detail/location-detail.js:196-224`），成功后也未通知前页。详情与发现卡片的初始状态虽分别由详情云函数和列表云函数计算（`cloudfunctions/getLocationDetail/index.js:39-60,95-117`；`cloudfunctions/getLocations/index.js:90-110`），但返回时没有同步机制。
- **影响**：用户从发现页进入地点详情并收藏/取消收藏，再返回发现页时，marker 卡片仍显示旧“收藏/已收藏”和旧数量；同一地点在相邻页面的数据不一致。
- **修复**：建立唯一的 `applyLocationFavorite({ id, favorited, favoriteCount })`，同时更新发现页的 `locationList`、`nearbyLocations`、`selectedPoi`。详情页云调用成功后通过 `app.emit('locationFavoriteChanged', payload)` 通知，发现页在 `onLoad/onUnload` 订阅/解绑；或在详情 `onUnload` 使用前页公开方法回传。云函数应返回**权威** `favorited` 与 `favoriteCount`，页面不要只依赖本地加减；回滚也应同步所有已更新视图。

### P1-5：收藏接口和两端 UI 都允许重入切换，可能生成重复 favorites 并造成计数错乱

- **证据**：发现卡片每次点击立即翻转状态并发送请求，未设置 pending 锁（`pages/discover/discover.js:1130-1153`）；详情同样没有 pending 锁（`pages/location-detail/location-detail.js:196-225`）。云函数使用“先查、后 add/remove”的两步非事务逻辑（`cloudfunctions/toggleFavorite/index.js:39-60`），没有唯一键或事务；两个并发请求都可能查到空结果并分别 `add`。列表收藏计数又只取最多 100 条收藏记录（`cloudfunctions/getLocations/index.js:78-88`），重复记录会直接放大数量。
- **影响**：快速双击、卡片与详情并行操作或弱网重试可让服务端收藏关系和 UI 最终状态相反，甚至一用户同地点多条收藏，导致收藏数数据错误。
- **修复**：前端按地点维护 `favoritePendingById`，pending 期间禁用/忽略再次点击；接口改为显式 `desiredFavorited`（而非 toggle）并在事务内执行。推荐 favorites 文档使用确定性唯一 ID（例如 `${openid}_${targetType}_${targetId}`）或建立唯一约束，事务后 `count()` 返回权威 `favorited` 和 `favoriteCount`。所有调用方以响应值落盘。

### P1-6：地图识别到“已收录地点”但其不在当前 10 条列表时，详情和收藏会落到外部 POI 身份

- **证据**：云函数识别到内部地点时返回 `matchedLocationId`（`cloudfunctions/getNearbyMapPoi/index.js:154-163`）。前端只在该 ID 恰好存在于当前 `locationList` 时打开内部卡片（`pages/discover/discover.js:1036-1042`）；否则把原始腾讯 POI 交给 `normalizePoi(raw, 'tencent')`（`pages/discover/discover.js:1043-1050`），没有把 `matchedLocationId` 注入详情/收藏目标。详情入口只读取组件传回的 `e.detail.id`（`pages/discover/discover.js:1090-1095`），收藏则以组件 ID 或 `selectedPoi._id` 调 `toggleFavorite`（`pages/discover/discover.js:1114-1139`）。
- **影响**：对已收录但不在第一页的地点，用户可能看见外部 POI 卡片；“详情”没有内部 ID 无法跳转，或者“收藏”把腾讯 `externalId` 当 location 文档 ID，服务端返回目标不存在。快速收藏流程实际失效。
- **修复**：只要 `collectionStatus === 'collected' && matchedLocationId`，就以该 ID 打开内部实体：若 `locationList` 没有该项，调用 `getLocationDetail`/新增 `getLocationSummary` 拉取，或至少构造 `{ ...raw, _id: matchedLocationId, id: matchedLocationId, source: 'internal' }` 并让组件对该 ID 走详情/收藏。`onViewPoiDetail`、`onTogglePoiFavorite` 也优先 `matchedLocationId`，而不是外部 ID。

### P1-7：搜索页切换场景时请求被 `isSearching` 短路，页面可显示“新筛选标签 + 旧筛选结果”

- **证据**：`onSceneFilter` 先写入新 filter 后立刻调用 `doSearch`（`pages/search/search.js:190-195`）；但 `doSearch` 首行在已有请求时直接返回（`pages/search/search.js:113-117`）。旧请求的 `scene` 在发起时已作为参数固化（`pages/search/search.js:120-123`），却仍会正常写回结果（`pages/search/search.js:125-138`）。搜索云函数确实根据 `scene` 过滤地点和帖子（`cloudfunctions/searchLocations/index.js:50-57,77-90`）。
- **影响**：搜索进行中点“森林→室内”等场景，芯片显示“室内”，结果却可能是“森林”，造成筛选结果错误；用户再点当前芯片不会重新查（`pages/search/search.js:191-194`）。
- **修复**：不要以 `isSearching` 阻止新的筛选查询。`doSearch` 每次先递增独立 `_searchRequestVersion` 并发起新请求，旧响应仅丢弃；或把目标条件记为 `pendingSearch`，当前请求结束后自动重查。请求参数从函数入参快照 `{ keyword, scene }` 构建，避免读取不断变化的 `this.data`。

### P1-8：搜索联想模板遗漏 `data-item`，地图 POI 联想无法回到发现页落标

- **证据**：`onSuggestTap` 读取 `e.currentTarget.dataset.item`，并要求其 `_type === 'map_poi'` 且包含经纬度，才调用前页的 `addSearchMarker()` 后返回（`pages/search/search.js:91-104`）。但联想节点只传了 `data-keyword`，没有 `data-item`（`pages/search/search.wxml:35-40`）；对比结果列表正确传了 `data-item="{{item}}"`（`pages/search/search.wxml:123-130`）。
- **影响**：用户点地图 POI 联想时 `item` 恒为空，预期的“回发现页、定位到该 POI”分支不会执行，反而退化成普通文字搜索，丢失经纬度/外部 POI 参数。
- **修复**：在联想节点补 `data-item="{{item}}"`；同时保证 `suggestPlaces` 对地图结果写入 `_type: 'map_poi'`（或在 `_fetchSuggestions` 统一适配）。为 `onSuggestTap` 增加无坐标降级提示，并回归验证“搜索页由发现页进入、点击地图联想、返回后 marker 可见”。

### P1-9：云函数业务失败会被搜索页伪装成“无结果”，地点详情网络失败则落到无数据空页面

- **证据**：`searchLocations` 业务异常返回 `{ code: -1, message }` 而非抛异常（`cloudfunctions/searchLocations/index.js:71-74`）；搜索页没有检查 `localRes.code`，把无 `data` 转为 `[]`（`pages/search/search.js:127-138`；翻页同样如此，`pages/search/search.js:157-172`），模板随即显示“没有找到相关内容”（`pages/search/search.wxml:168-177`），没有错误/重试状态。地点详情的网络 catch 只设 `loading: false`（`pages/location-detail/location-detail.js:168-172`），模板的非 loading 分支立刻读取 `location.name` 等字段（`pages/location-detail/location-detail.wxml:2,15-46`），也没有错误页或重试。
- **影响**：数据库/网络故障时用户被误导为没有地点，搜索无法重试；详情页网络失败会显示大量空字段而不是可恢复错误态。
- **修复**：搜索增加 `searchError`/`loadMoreError`，仅 `res.code === 0 && Array.isArray(res.data)` 才写结果；非 0 显示“加载失败，重试”并保留已有结果，重试调用相同的 keyword/scene/page。详情增加 `error` 与 `retryLoadLocationDetail`，catch 时保留错误态而非渲染 `location === null` 的详情；`loadLocationDetail` 同时保护 `res` 为空的情况。
- **前提**：此项依赖 `app.callCloud` 对 `{ code: -1 }` 的处理方式；若它会把所有非 0 统一 reject，则搜索会进入 catch，但仍未设置错误态，问题仍存在，只是表现从“伪空态”变为无反馈/空态。

### P1-10：热门日记/`hot-diary-card` 的加载分支不可达，发现页无法浏览该列表

- **证据**：模式切换只产出 `'map'` 或 `'xiaoju'`（`pages/discover/discover.js:537-555`），模板也只有“地图 / 小聚”两项（`pages/discover/discover.wxml:47-54`）。但热门日记加载、刷新、触底均判断 `viewMode === 'hot'`（`pages/discover/discover.js:795-840`），没有任何调用 `_loadHotPosts()` 的初始化路径；尽管页面注册了 `hot-diary-card`（`pages/discover/discover.json:6-10`），模板没有渲染该组件。
- **影响**：热门日记代码永远不可执行，用户无法从发现页浏览热门日记；下拉刷新/触底也不会加载它。
- **修复**：若产品要求热门日记，增加可达的 `hot` tab（或把小聚的实现明确替换为热点流），在首次切入时调用 `_loadHotPosts(true)`，WXML 用 `hot-diary-card` 渲染 `hotPosts` 并提供 loading/error/retry/empty。若该功能已下线，应删除死代码和组件声明，避免误导后续维护。

### P2-1：列表收藏数会在热门地点上被最多 100 条的聚合窗口截断

- **证据**：`getLocations` 对一页所有地点只读取 `favorites` 的前 100 条并在内存累加（`cloudfunctions/getLocations/index.js:78-88`），而详情页使用 `.count()` 取得精确收藏数（`cloudfunctions/getLocationDetail/index.js:95-113`）。
- **影响**：当本页地点总收藏记录超过 100 时，发现卡片显示的 `favoriteCount` 会低于详情页，形成数量不一致；不影响当前用户 `isFavorited` 的独立查询（`cloudfunctions/getLocations/index.js:90-110`）。
- **修复**：将计数作为事务维护的 `locations.favoriteCount`（与 P1-5 的收藏事务一起更新），或按地点分组精确 count；不要以无分页 `.limit(100)` 结果作为总数。列表响应应返回同一权威计数源。

## 已验证正确的部分

1. **列表初始收藏状态有用户维度查询**：`getLocations` 会按本页 ID 与当前 openid 查询 favorites，返回 `isFavorited`，并不会仅依赖地点文档字段（`cloudfunctions/getLocations/index.js:90-110`）。详情页也独立查询当前用户关系（`cloudfunctions/getLocationDetail/index.js:39-60`）。
2. **发现卡片具备基本乐观更新与失败回滚**：点击时立即修改 `selectedPoi`，云函数成功后回写 `locationList`，失败时恢复选中卡片（`pages/discover/discover.js:1130-1153`）。本报告的 P1-4 指出的是跨页同步缺失，而非该页内完全未处理。
3. **附近地点详情参数使用 `_id`，未发现该路径的 `id/_id` 混用**：模板 `data-id="{{item._id}}"`，事件仅在存在 id 时导航（`pages/discover/discover.wxml:271-275`；`pages/discover/discover.js:722-725`）。搜索结果亦传递 `item._id`，并按 `location/post` 路由（`pages/search/search.wxml:123-130`；`pages/search/search.js:211-229`）。
4. **地图原生 POI 事件已接入并做了重复事件抑制**：模板同时绑定 `bindtap`、`bindpoitap`（`pages/discover/discover.wxml:184-215`），`onMapPoiTap` 使用时间窗避免与 `tap` 重复查询，并对空结果/云函数失败做了底图名称降级（`pages/discover/discover.js:947-1030`）。地图内的小缩略浮层确实使用了 `cover-view`（`pages/discover/discover.wxml:200-214`）。
5. **热门帖子云函数失败并未被直接当作空数据**：`_loadHotPosts` 对 `code !== 0` 与 reject 都设置了可见错误文案（`pages/discover/discover.js:797-818`）。问题在于该分支当前不可达（P1-10）。
6. **筛选参数本身没有在云函数边界丢失**：发现页将多选 `activeFilters` 作为 `category` 传入（`pages/discover/discover.js:14-19,630-653`），`getLocations` 接受数组并采用全部条件命中（`cloudfunctions/getLocations/index.js:17-35`）；搜索页也把单选 scene 传入并在云端匹配（`pages/search/search.js:120-123`；`cloudfunctions/searchLocations/index.js:77-90`）。实际问题是请求竞态（P1-7）及部分筛选项需要与真实数据字典继续核对。

## 未验证的假设与需要补充的材料

1. **关键文件缺失**：本快照中没有任务点名的 `app.js`、`utils/common.js`、`utils/poi-adapter.js`、`components/poi-preview-card/*`、`components/hot-diary-card/*`，也没有 `components/` 目录。因此无法验证 `createPager` 是否正确处理 `code !== 0`、`hasMore` 和 `errorMessage`，无法验证 `poi-preview-card` 是否总是发出内部 `_id`，也无法在真机确认其是否被原生 `<map>` 遮挡或点击热区失效。
2. **`app.callCloud` 契约未知**：缺失的 `app.js` 使 `{ code: -1 }` 是 resolve 还是 reject、`cityReady` 是否在拒绝定位时必然触发、登录态如何初始化均无法静态确认；P1-9 已说明两种契约下的不同表现。
3. **云环境不可验证**：无法确认 `locations/favorites/...` 集合、地理索引、复合索引、权限规则、历史字段（`facilities` 的 string/object 格式、`style/category/tags` 的场景字典）与实际数据量是否满足代码假设；尤其要核实“附近”是否应按 5km 还是城市范围查询。
4. **腾讯地图环境不可验证**：`getNearbyMapPoi` 依赖环境变量/内置 key 和腾讯 WebService（`cloudfunctions/getNearbyMapPoi/index.js:12,87-119`），本审计未验证 key、配额、域名白名单或实际 POI 返回格式。另其内部地点匹配仅读取前 100 条（`cloudfunctions/getNearbyMapPoi/index.js:140-160`）；若地点库超过该数，仍需改为地理邻近查询并真机回归。
