# 微信开发者工具 MCP 集成指南

## 快速开始

### 1. 安装依赖

首先确保已安装 Python 3.9 或更高版本，然后安装必要的依赖：

```bash
# 安装 uv（推荐的包管理器）
pip install uv

# 进入 MCP 服务器目录
cd mcp_wechat_devtools

# 使用 uv 安装依赖
uv sync
```

或者使用 pip：

```bash
pip install -r requirements.txt
```

### 2. 配置 Trae

在 Trae 的 MCP 配置文件中添加以下内容（配置文件通常在用户目录的 `.trae-cn` 文件夹中）：

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

**注意**：
- 请将路径替换为您项目的实际路径
- 如果不使用 uv，也可以直接使用 python 命令

### 3. 验证微信开发者工具路径

确认微信开发者工具的 `cli.bat` 位置，通常在：
- `C:\Program Files\Tencent\微信开发者工具\cli.bat`
- `C:\Program Files (x86)\Tencent\微信开发者工具\cli.bat`
- `%LOCALAPPDATA%\Programs\微信开发者工具\cli.bat`

如果路径不同，可以使用 `set_config` 工具进行配置。

### 4. 使用 MCP 工具

重启 Trae 后，您将可以使用以下工具：

| 工具名称 | 功能 |
|---------|------|
| `get_config` | 获取当前配置信息 |
| `set_config` | 设置配置（开发者工具路径、项目路径等） |
| `open_project` | 在微信开发者工具中打开项目 |
| `preview_project` | 生成小程序预览二维码 |
| `build_project` | 构建并上传小程序 |
| `auto_test` | 启动自动化测试 |

### 5. 工作流程示例

#### 场景 1: 打开项目进行开发

1. 首先检查配置：
   ```
   get_config {}
   ```

2. 如果需要，设置路径：
   ```
   set_config {
     "dev_tool_path": "C:\\Program Files\\Tencent\\微信开发者工具\\cli.bat",
     "project_path": "d:\\出毛地图\\unpackage\\dist\\dev\\mp-weixin"
   }
   ```

3. 打开项目：
   ```
   open_project {}
   ```

#### 场景 2: 生成预览二维码

```
preview_project {}
```

#### 场景 3: 上传小程序

```
build_project {
  "version": "1.0.0",
  "desc": "首次发布"
}
```

## 项目结构

```
mcp_wechat_devtools/
├── __init__.py          # Python 包初始化
├── server.py            # MCP 服务器主文件
├── pyproject.toml       # uv 项目配置
├── requirements.txt     # pip 依赖列表
├── config.json.example  # 配置文件示例
└── README.md            # 详细文档
```

## 微信开发者工具 CLI 参考

MCP 服务器内部使用微信开发者工具的命令行接口，主要命令包括：

- `--open <project_path>` - 打开项目
- `--preview` - 生成预览
- `--upload` - 上传代码
- `--auto-preview` - 自动预览
- `--auto-upload` - 自动上传

## 故障排除

### 问题：找不到微信开发者工具

**解决方案**：
1. 使用 `get_config` 检查当前检测到的路径
2. 使用 `set_config` 手动指定正确的 `cli.bat` 路径

### 问题：MCP 服务器无法启动

**解决方案**：
1. 确认 Python 版本 >= 3.9
2. 确认所有依赖已安装：`uv sync` 或 `pip install -r requirements.txt`
3. 检查 Trae 的 MCP 配置路径是否正确

### 问题：打开项目失败

**解决方案**：
1. 确认项目路径正确（应该是 `unpackage/dist/dev/mp-weixin` 目录）
2. 确认该目录下存在 `app.json` 和 `project.config.json`
3. 尝试先手动在微信开发者工具中打开该项目

## 下一步

- 集成 minium 进行更强大的自动化测试
- 添加更多微信开发者工具 CLI 功能
- 支持多项目管理
- 添加日志和错误处理增强
