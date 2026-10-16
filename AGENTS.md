# 出毛日记 — 项目上下文

微信小程序「出毛日记」（面向福瑞 / 兽装爱好者：出毛足迹、出毛适宜度、兽聚与场地）。
技术栈：原生微信小程序 + 微信云开发（Tencent CloudBase）。

## 项目背景与全部开发对话：思源笔记

完整背景、历次审计 / 修复 / 发布经过、降级改造决策和当前待办，都按时间线归档在
**思源笔记**的「出毛日记」笔记本里，共 11 篇（2026-07-22 → 2026-10-13）。
**动这个仓库之前先读它**，里面有大量「为什么这么改」的结论和踩坑记录。

- 笔记本 ID：`20261012012311-76i3oj6`
- 数据目录：`D:\ai-shared-db\new folder\data\20261012012311-76i3oj6`
  （Docker 容器 `siyuan` 的工作区 bind mount 是 `D:/ai-shared-db/new folder`）

### 怎么读

在项目根目录执行：

```powershell
powershell -NoProfile -File scripts\siyuan-notes.ps1          # 列出所有笔记本
powershell -NoProfile -File scripts\siyuan-notes.ps1 -List    # 列出「出毛日记」的文档
powershell -NoProfile -File scripts\siyuan-notes.ps1 -Doc 08  # 导出单篇（标题片段或 ID 前缀，可多个）
powershell -NoProfile -File scripts\siyuan-notes.ps1 -All     # 导出整本
```

脚本把 `.sy` 块树转成 Markdown 输出到 stdout。

### 注意事项

- **不要直接读 `.sy`**，那是思源的块树 JSON，噪音大；用上面的脚本。
- 思源每次保存都会把内容写回 `.sy`，所以每次调用读到的就是最新内容，不存在「要先同步」这回事。
- 这些文件在工作区之外，**只能读、不能写**（DSH 沙箱只允许写工作区）。
- `scripts\siyuan-notes.ps1` 必须保持**纯 ASCII**：Windows PowerShell 5.1 会把无 BOM 的
  脚本按 GBK 解析，非 ASCII 字符串字面量会被拆坏（这台机器上也只有 5.1，没有 pwsh）。
  中文说明就写在这个文件里，别写进脚本。
- 思源的官方 HTTP API 目前不通，但**不是思源的问题**：容器内的 6806 落在 Windows 保留
  端口段 `6761-6860` 内（`netsh int ipv4 show excludedportrange protocol=tcp`），Docker
  的宿主端口映射被静默丢弃（`docker port siyuan` 为空、宿主机无监听）。要打通就换一个
  保留段外的端口重建容器，例如 `-p 127.0.0.1:16806:6806`（数据全在 bind mount 里，不会丢），
  然后用 `Authorization: Token <conf.json 的 api.token>` 调 `/api/export/exportMdContent`、
  `/api/query/sql` 等接口。
