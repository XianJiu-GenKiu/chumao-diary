# 微信开发者工具 MCP - 快速配置指南

## 第一步：安装依赖

打开 PowerShell 或命令提示符，按顺序执行以下命令：

```powershell
# 1. 进入 MCP 服务器目录
cd d:\出毛地图\mcp_wechat_devtools

# 2. 检查 Python 版本（需要 Python 3.9+）
python --version

# 3. 安装 uv 包管理器（如果还没安装）
pip install uv

# 4. 安装项目依赖
uv sync

# 或者使用 pip 安装
pip install -r requirements.txt
```

## 第二步：配置 Trae

### 方式一：通过 Trae 设置界面配置（推荐）

1. 打开 Trae
2. 进入设置（Settings）
3. 找到 MCP 配置选项
4. 添加新的 MCP 服务器，配置如下：

```
名称：wechat-devtools
命令：uv
参数：
  --directory
  d:\出毛地图\mcp_wechat_devtools
  run
  python
  server.py
```

### 方式二：手动编辑配置文件

如果您知道 Trae 的 MCP 配置文件位置，可以直接编辑该文件，添加以下内容：

```json
{
  "mcpServers": {
    "wechat-devtools": {
      "command": "uv",
      "args": [
        "--directory",
        "d:\\出毛地图\\mcp_wechat_devtools",
        "run",
        "python",
        "server.py"
      ]
    }
  }
}
```

**注意**：如果没有安装 uv，可以直接使用 python：

```json
{
  "mcpServers": {
    "wechat-devtools": {
      "command": "python",
      "args": [
        "d:\\出毛地图\\mcp_wechat_devtools\\server.py"
      ]
    }
  }
}
```

## 第三步：重启 Trae

配置完成后，重启 Trae 即可使用。

## 第四步：测试 MCP 工具

重启后，您可以尝试使用以下工具：

1. **检查配置**
   ```
   get_config {}
   ```

2. **如果需要，设置微信开发者工具路径**
   ```
   set_config {
     "dev_tool_path": "C:\\Program Files\\Tencent\\微信开发者工具\\cli.bat",
     "project_path": "d:\\出毛地图\\unpackage\\dist\\dev\\mp-weixin"
   }
   ```

3. **打开项目**
   ```
   open_project {}
   ```

## 常见问题

### Q: 找不到微信开发者工具路径？
A: 微信开发者工具通常安装在以下位置之一：
- `C:\Program Files\Tencent\微信开发者工具\cli.bat`
- `C:\Program Files (x86)\Tencent\微信开发者工具\cli.bat`
- `%LOCALAPPDATA%\Programs\微信开发者工具\cli.bat`

如果不在这些位置，请使用 `set_config` 手动指定路径。

### Q: MCP 服务器无法启动？
A: 请检查：
1. Python 版本是否 >= 3.9
2. 依赖是否已正确安装（运行 `uv sync` 或 `pip install -r requirements.txt`）
3. Trae 的 MCP 配置路径是否正确

### Q: open_project 失败？
A: 请检查：
1. 项目路径是否正确（应该指向 `unpackage\dist\dev\mp-weixin`）
2. 该目录下是否存在 `app.json` 和 `project.config.json`
3. 微信开发者工具是否已正确安装
