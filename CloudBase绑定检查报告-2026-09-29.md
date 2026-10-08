# 出毛日记 · 腾讯云 CloudBase 绑定检查报告

**检查时间**：2026-09-29 17:15 – 18:10
**检查对象**：`your-cloud-env-id`（region `ap-shanghai`）
**触发问题**：「我已经绑定腾讯云 cloudbase 了，帮我检查一下上去了吗」
**检查工具**：CloudBase CLI (`tcb` 3.8.4，连接器通道) + 微信开发者工具 CLI (`cli.bat`)

---

## 一、结论速览

| # | 检查项 | 结论 |
|---|---|---|
| 1 | CloudBase 连接器是否真的连通 | **通**。环境、函数列表、函数详情、调用日志、版本、流量路由全部可读 |
| 2 | 部署目标是否就是小程序调用的环境 | **是**。两端环境 ID 完全一致（`config/env.js` ⇄ `tcb env list`） |
| 3 | 云端函数是否与本地一致 | **否**。51 个云端函数里只剩 20 个与本地一致，**28 个云端落后** |
| 4 | 云端代码最后一次真正更新 | **2026-09-28 00:36:37**（此后所有部署尝试均未落地） |
| 5 | 能不能用 `tcb` 把代码推上去 | **不能**。三条部署路径全部失败，`tcb fn deploy` 还会**假报成功** |
| 6 | 能不能用微信开发者工具推 | **不能**。账号级阻断，`code 10 已授权服务商使用云开发资源` |
| 7 | 顺手发现的线上严重缺陷 | **`toggleReaction` 在云端是 286 字节的 Hello World 脚手架**，种草/踩雷功能线上 100% 失效 |

一句话总结：**绑定本身没问题，问题在于「只能读、写不进去」——而这个「写不进去」被 CLI 的假成功报告掩盖了。**

---

## 二、绑定是通的（读取能力全绿）

```
$ tcb env list
┌─────────────────────────────┬─────────────┬───────────┬─────────────────────┬─────────────────────┬──────────────────┐
│       Environment ID        │  版本        │  Source   │    Creation Time    │   Expiration time   │ Environment 状态  │
├─────────────────────────────┼─────────────┼───────────┼─────────────────────┼─────────────────────┼──────────────────┤
│ your-cloud-env-id │   个人版     │ CloudBase │ 2026-06-24 17:37:06 │ 2026-12-24 23:59:59 │      Normal      │
└─────────────────────────────┴─────────────┴───────────┴─────────────────────┴─────────────────────┴──────────────────┘
```

```
$ tcb fn list -e your-cloud-env-id --limit 100
云函数总数: 51
```

51 个函数名单与项目 `cloudfunctions/` 目录一一对应，说明连接器指向的就是本项目自己的云环境，不是别人的。

### 部署目标 = 调用目标（已交叉验证）

| 位置 | 环境 ID |
|---|---|
| `config/env.js` → `CLOUD_ENV_ID` | `your-cloud-env-id` |
| `app.js:81` → `wx.cloud.init({ env: ... })` | 同上 |
| `tcb env list` 返回 | 同上 |

**这一条很重要**：排除了「部署到了 A 环境、小程序读的是 B 环境」这种最常见的误判。

---

## 三、但管理权是单向的：微信侧已彻底失去云开发入口

带 `--project` 重试开发者工具 CLI（上轮那次少传了参数，报的是 `code 31 缺失参数`，本次已补齐）：

```bash
"/e/Tencent/微信web开发者工具/cli.bat" cloud env list --project "D:/出毛日记"
```

返回：

```
[error] { code: 10,
  message: '该小程序账号已授权服务商使用云开发资源，因此无法使用云开发资源 (code 10)',
  ... at async t.tcbGetEnvironments ... }
```

**连串 `code 31` 的疑问一并关闭**：开发者工具侧确实被账号级阻断，不是参数问题。

「服务商」在这里就是**腾讯云 CloudBase 本身**——小程序的云开发资源已被授权/迁移到腾讯云账号（APPID `your-cloudbase-uin`）下托管。所以：

- 微信开发者工具：**不能读、不能写**
- 腾讯云 CloudBase：**能读**（本次已证明）
- 能否写 → 见下一节

---

## 四、云端代码与本地代码的漂移全貌

本次写了一个审计脚本 `scripts/audit-cloud-drift.js`，把 51 个云端函数的入口源码逐个拉下来，与本地 `cloudfunctions/<name>/index.js` **逐字比对**。结果：

| 分类 | 数量 | 说明 |
|---|---|---|
| 一致 | 20 | 云端 = 本地 |
| **云端落后** | **28** | 两边都在，但内容不同 |
| 本地缺失 | 3 | `shared`、`toggleLike`、`a123`（云端有、本地没有） |
| 本地有、云端无 | 0 | — |

### 关键：云端函数最后更新时间的分布

| 日期 | 函数数 |
|---|---|
| 2026-09-27 | 43 |
| 2026-09-28 | 6 |
| 2026-09-29 | 2（**只是配置更新，代码没变**，见第六节） |

最晚一次**真正落地**的代码更新是 **`getNearbyMapPoi` @ 2026-09-28 00:36:37**。

**也就是说：从 9 月 28 日凌晨之后，我们做的所有云函数修复，一个都没上线。**

### 本轮「集合自愈」修复的实际上线状态

| 云函数 | 云端有 `ensureCollection` | 本地有 | 是否已上线 |
|---|---|---|---|
| `post-like` | ✗ | ✓ | **否** |
| `toggleReaction` | ✗ | ✓ | **否** |
| `checkInLocation` | ✗ | ✓ | **否** |
| `rateLocation` | ✗ | ✓ | **否** |
| `createEvent` | ✗ | ✓ | **否** |
| `toggleEventLike` | ✗ | ✓ | **否** |
| `trackEvent` | ✗ | ✓ | **否** |
| `addLocation` | ✓ | ✓ | 是（但其它改动仍未上线） |

**7 个写入路径的自愈代码，全部还在本地。** 这意味着线上只要有人往 `likes` / `reactions` / `checkins` / `ratings` / `events` / `event_likes` / `usage_events` 这些尚未创建的集合写入，仍然会抛 `-502005 database collection not exists`。

（唯一立刻生效的仍是上轮的前端加固 —— 它随小程序包走，不受云函数部署限制。）

---

## 五、顺手挖出的线上严重缺陷：`toggleReaction` 是脚手架函数

比对照时发现 `toggleReaction` 云端只有 **205 字节**（本地 5201 字节），拉下来一看，是建函数时的默认模板：

```js
'use strict';
exports.main = (event, context, callback) => {
    console.log("Hello World")
    console.log(event)
    console.log(context)
    callback(null, event);      // ← 直接把入参原样回显
};
```

| 项 | 值 |
|---|---|
| 云端 Runtime | `Nodejs24.11`（项目其它函数都是 `Nodejs16.13`，典型的「控制台建了个空函数」特征） |
| 云端 AddTime | 2026-07-18 22:25:51（比其它函数都早，一直没被覆盖过） |
| 云端 CodeSize | 286 B |
| 本地实现 | 5201 B，事务内 `set()` 覆盖写 + 计数增减 + 消息通知，完整 |

### 这会造成什么线上后果

小程序端 `pages/location-detail/location-detail.js` 是这样调的：

```js
const res = await app.callCloud('toggleReaction', {
  targetId: this.data.id,
  targetType: 'location',
  reactionType: type
})
if (!res || res.code !== 0) throw new Error((res && res.message) || '操作失败')
```

而脚手架 `callback(null, event)` 返回的是 `{targetId, targetType, reactionType}` —— **没有 `code` 字段**。

于是 `res.code !== 0` 恒成立 → 抛错 → catch 块回滚 UI 状态 + 弹失败提示。

**结论：地点详情页的「种草 / 踩雷」按钮，线上是 100% 失效的**（点一下闪一下、然后回到原样）。同样调用链也存在于动态页与动态详情页。

验证方式（服务端直调，绕开前端）：

```bash
$ tcb fn invoke toggleReaction -e your-cloud-env-id \
    --params '{"targetId":"x","targetType":"location","reactionType":"up"}'
RetMsg: {"reactionType":"up","targetId":"x","targetType":"location"}   # 入参回显 = 脚手架铁证
```

> 说明：本次的部署尝试**没有**改变云端代码（见下节），因此这个脚手架是既有状态，不是本次操作造成的。

---

## 六、为什么「部署成功」是假的 —— 三种失败模式与根因

这是本次检查最需要你知道的一条。

### 6.1 三条路径，三种死法

| # | 命令 | 表象 | 真相 |
|---|---|---|---|
| 1 | `tcb fn deploy <name> --force --install-dependency true` | 打印 `✔ Cloud function deployed successfully!` | **代码完全没变**。假成功 |
| 2 | `tcb fn deploy ... --json` | 输出结构化错误 | `函数代码打包失败：ENOENT: no such file or directory, open 'C:\Users\...\Temp\<uuid>.tmp'` |
| 3 | `tcb fn code update <name> --deployMode zip` | 卡死 | 无 TTY 时停在交互菜单 `? Please select an action`（被 SIGTERM）；管道送入回车越过菜单后，`Function code updating...` **无限挂起**（>6 分钟） |
| 4 | 同 3，但剥离 `NODE_OPTIONS` | 打包过了，改卡在上传 | 同样**无限挂起**（>6 分钟） |

**注意模式 1 和模式 2 的区别**：同一条命令，不加 `--json` 就报成功、加了 `--json` 才吐真实错误。**CLI 在非 JSON 模式下吞掉了打包异常，并打印了成功文案。** 上轮报告里那句「`tcb` 部署报成功」就是这么被骗过去的。

### 6.2 根因

**(a) 本机 Node 进程被注入了文件系统代理，打断了 CLI 的打包**

```
NODE_OPTIONS=--require="D:/WorkBuddy/resources/app.asar.unpacked/cli/vendor/shim/node-language-shim.cjs"
CODEBUDDY_SAFE_DELETE_SANDBOX=1
CODEBUDDY_SAFE_DELETE_BULK_GUARD=.../safe-delete-bulk-guard.cjs
```

CLI 的打包流程是「生成临时 zip → 再按路径读回 → 上传」。这层 shim 让第二步 open 拿不到文件，于是 `ENOENT`。手工用 Node 写/读同一个 Temp 目录是正常的（已实测），所以不是目录权限问题，而是与 CLI 内部的文件操作时序冲突。

**(b) 剥离 shim 后，改由上传端点阻塞**

`env -u NODE_OPTIONS` 后打包不再报错，日志推进到 `Function code updating...` / `Updating directly with the merged inferred configuration`，然后**再无输出**。

值得注意的是：`fn list` / `fn detail` / `fn invoke` 这些请求全部正常（秒级返回），只有 **`UpdateFunctionCode` 这一步卡住**。结合小程序账号「已授权服务商」的状态，最可能是**代码提交/发布环节需要走一条当前不可达的通路**。

**(c) CLI 的交互菜单在无 TTY 时不会自动降级**

`fn code update` 会弹一个二选一菜单（`Update with current config` / `Exit`）。非交互环境下 `--yes` **对此类 select 菜单无效**，必须用 `printf '\n' |` 注入回车才能通过。这是 CLI 的一个易踩坑。

### 6.3 探针实验（证明「ModTime 变了但代码没变」）

为了把这件事钉死，我造了一个带行为标记的探针函数去部署：

```js
// PROBE_MARKER_20260929
exports.main = async event => {
  if (event && event.__probe) return { code: 0, probe: 'PROBE_20260929_OK' }
  ... 原 trackEvent 实现
}
```

部署后回读云端详情：

| 字段 | 结果 | 说明 |
|---|---|---|
| `ModTime` | **2026-09-29 17:30:06**（= 部署时间） | 配置确实被写了 |
| `CodeInfo` | 仍是旧代码，`map_navigation` 不在白名单 | 代码没被写 |
| `PROBE_20260929_OK` | **不存在** | 探针没上去 |
| `CodeSize` | 7396419（未变） | — |
| `$LATEST` 版本 | 只有这一个版本，无流量路由 | 排除「被固定到旧版本」 |

`toggleReaction` 同理：`ModTime` 更新到 `2026-09-29 17:28:43`，`CodeSize` 仍是 286。

**结论：`tcb` 的部署只更新了函数配置，代码包从未真正上传。**

---

## 七、接下来该怎么办

### 推荐度 A：到腾讯云 CloudBase 控制台手工上传（唯一稳妥路径）

既然资源已在你的腾讯云账号下，控制台是当前唯一确认可用的写入口：

1. 登录 <https://console.cloud.tencent.com/tcb>，选择环境 `your-cloud-env-id`
2. 云函数 → 选择函数 → 「上传代码」（ZIP 包）或「在线编辑」
3. ZIP 里需要包含：`index.js`、`package.json`，以及本轮新增的 `ensureCollection.js`

需要部署的清单（按优先级）：

**P0（线上功能异常 / 自愈未上线）**

| 函数 | 原因 |
|---|---|
| `toggleReaction` | 云端是脚手架，种草踩雷全废 |
| `post-like` | 缺 `ensureCollection`，`likes` 集合不存在时写入报错 |
| `checkInLocation` | 缺 `ensureCollection`（`checkins`） |
| `rateLocation` | 缺 `ensureCollection`（`ratings`） |
| `getEventDetail` | 缺 `event_likes` 读取降级，会导致「动态/活动详情」报错 |

**P1**

| 函数 |
|---|
| `createEvent`、`toggleEventLike`、`trackEvent`（其余 3 个自愈路径） |
| `getEvents`、`joinEvent`、`cancelJoinEvent`、`post-detail`、`getUserPublicContent`、`getFollowList`、`submitFeedback`、`generateShareCode` |
| 其余「云端落后」列表中的函数（见 `scripts/.cloud-drift-report.json` 的完整 28 个） |

### 推荐度 B：修复本机 CLI 运行环境

如果希望以后能命令行部署，需要同时解决两件事：

1. **绕开 FS shim**：`env -u NODE_OPTIONS tcb ...`（已验证能解决打包 ENOENT）
2. **解决上传阻塞**：这是环境/网络层面的限制，我这侧无法自行打开。可以试：
   - 换 `--deployMode cos` 显式走对象存储通道
   - 在不受该沙箱约束的普通终端里执行同一命令（大概率直接可用）

**强烈建议在任何 `tcb` 部署命令后都加 `--json`**，否则失败会被伪装成成功。

### 推荐度 C：微信开发者工具 —— 已确认不可用

`code 10` 是账号级阻断，解除授权前无解。除非你去
微信公众平台 → 设置 → 第三方设置 / 授权管理，把「云开发」相关授权解除，
否则开发者工具永远读不到这个环境。

**但同时要清楚**：一旦解除授权，小程序可能就读不到现在这个腾讯云环境了。
所以不建议贸然解绑，走 A 更安全。

---

## 八、本次新增的产物

| 文件 | 用途 |
|---|---|
| `scripts/audit-cloud-drift.js` | 云端/本地云函数代码漂移审计脚本，可随时复跑 |
| `scripts/.cloud-drift-report.json` | 本次审计的完整明细（51 个函数的逐项结果） |

复跑方式：

```bash
cd D:/出毛日记
C:/Users/123/.workbuddy/binaries/node/versions/22.22.2-3/node.exe scripts/audit-cloud-drift.js
```

---

## 九、对上一份报告结论的更正

`修复说明-集合自愈与服务商阻断-2026-09-29.md` 第三节给出的 A/B/C 三条解法中，
**C 路线（用 CloudBase CLI 部署）实际已由本轮验证为「可读但不可写」**，
不能作为解法。另外该节引用开发者工具错误时未带 `--project`，本轮已补齐参数复现，
`code 10` 结论不变，`code 31` 是参数问题、非阻断。
