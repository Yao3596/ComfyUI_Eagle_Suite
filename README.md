# 🦅 ComfyUI Eagle Suite

一款功能丰富的 ComfyUI 插件，集成 **Eagle 素材管理**、**图库浏览**、**LoRA 管理**、**视频/音频处理**、**H3 导演台**、**OpenAI 兼容 API 调用** 等一站式工作流增强工具。

[![GitHub](https://img.shields.io/badge/GitHub-Yao3596/ComfyUI_Eagle_Suite-181717?logo=github)](https://github.com/Yao3596/ComfyUI_Eagle_Suite)

---
## ✅ 稳定版与运行环境

当前稳定基线：**v1.4.0-stable（2026-08-25）**。

本版本已在以下 Aki 环境核对：

| 组件 | 已验证环境 |
|------|------------|
| ComfyUI | `0.29.0`+ |
| ComfyUI Frontend | `1.47.10`+ |
| Python | `3.11` ~ `3.13`（Aki 内置 Python） |
| Vue | 插件内置 Vue 3，无需 npm 安装 |
| FFmpeg | Aki 内置 FFmpeg / `imageio_ffmpeg` 自动发现 |

以上是已验证环境，不代表硬性最低版本。升级 ComfyUI 前端后若 Gallery 或 Vue 节点没有刷新，请重启 ComfyUI，并在浏览器中按 `Ctrl+F5` 清除旧模块缓存。

---

### 🚀 安装与部署

1. 进入 ComfyUI 自定义节点目录：
```bash
cd ComfyUI/custom_nodes
```

2. 克隆仓库：
```bash
git clone https://github.com/Yao3596/ComfyUI_Eagle_Suite.git
```

3. 安装依赖：
```bash
cd ComfyUI_Eagle_Suite
pip install -r requirements.txt
```

4. **一键全节点工作流**：仓库根目录下附带 `all_eagle_suite_nodes_workflow.json`，直接拖入 ComfyUI 界面即可一键导入全量 39 个 Eagle Suite 节点！

---

## ✨ 功能概览与节点指南

### 🎬 H3 导演台与导演技能库

专为 MiniMax H3 / 海螺 AI 视频生成模型设计的导演级创作与预设套件。

| 节点 | 类别菜单 | 说明 |
|------|----------|------|
| 🦅 **H3 导演台** | `🦅 Eagle Suite/H3 导演台` | MiniMax H3 专属视频导演控制台，支持场景多镜头动作编排、分镜台词整理、风格生成与 ethanfel Plan 格式导出 |
| 🦅 **导演技能库** | `🦅 Eagle Suite/H3 导演台` | 集中管理 Markdown 导演技能文档与素材胶片，支持自定义保存路径、底部路径显示与 JSON 导出/导入 |

- **H3 导演台**：集成世界构建、镜头序列动作分解、音频/台词时间轴，支持一键编译生成 H3 提示词并连线控制下游启动节点；
- **导演技能库**：与提示词预设共享后端能力，支持 Markdown 实时渲染预览、素材胶片图片拖拽绑定，可配置 `local_paths` 存储目录，自带 `⬇ 导出` 与 `⬆ 导入` 功能。

---

### 🏷️ Danbooru 标签搜索 (BGE-M3)

| 节点 | 类别菜单 | 说明 |
|------|----------|------|
| 🦅 **Danbooru 标签搜索** | `🦅 Eagle Suite/画廊` | 组合标签检索、图库选择、中文语义检索、标签编辑与角色外内容抽卡 |

- **向量模型说明**：首次使用语义搜索时，节点会自动从 HuggingFace 下载 **`BAAI/bge-m3`** 向量模型，首次加载可能需要一些时间（取决于网络状况）。
- **离线 / 手动部署方式**：
  若网络受限或希望手动部署，可直接下载 `bge-m3` 模型（包含 `config.json` 等权重文件），放置于 ComfyUI 根目录下的以下任意路径：
  - `ComfyUI/models/text_encoders/bge-m3`
  - 或 `ComfyUI/models/LLM/bge-m3`
  然后在 Danbooru 节点设置面板中，将 **本地模型路径 (`model_path`)** 填入对应路径即可实现纯离线极速加载。
- `character_tags` 输入口用于固定角色特征，抽卡只补充服装、动作场景、构图与光照等角色外内容；
- 输出标签支持拖拽排序、权重、类型、译名、固定/屏蔽状态，双击可临时屏蔽输出。

---

### 🛠️ 提示词预设与工具套件

| 节点 | 类别菜单 | 说明 |
|------|----------|------|
| 🦅 **提示词预设** | `🦅 Eagle Suite/工具` | 重构三卡片式设置面板（Obsidian 集成/存储路径/下拉分类），指令模板支持详情页 `<textarea>` 内联编辑失焦自存，封面优化为 54px 紧凑展示 |
| 🦅 **变量输入** | `🦅 Eagle Suite/文本` | 自定义快捷文本变量注入 |
| 🦅 **多重文本切换** | `🦅 Eagle Suite/文本` | 多路文本分支快速切换控制 |
| 🦅 **行数统计 / 字符串工具** | `🦅 Eagle Suite/文本` | 包含保存/加载/拼接/分割/随机选择/模板替换等全套文本处理节点 |

---

### 🖼️ 图库与媒体浏览（Gallery & Media）

在 ComfyUI 节点内直接浏览、搜索、选择媒体文件，选中后输出为 `IMAGE` 或 `VIDEO` 张量。

| 节点 | 类别菜单 | 说明 |
|------|----------|------|
| 🦅 **Eagle Gallery** | `🦅 Eagle Suite/画廊` | 浏览本地 Eagle 素材库，支持文件夹树筛选、关键词搜索、星级/比例/标签过滤及跨文件夹全局选择 |
| 🌊 **Wallhaven Gallery** | `🦅 Eagle Suite/画廊` | 浏览 Wallhaven 在线壁纸库，支持分类、纯度、排序筛选 |
| 🧬 **LoRA Gallery** | `🦅 Eagle Suite/画廊` | 在节点内浏览并加载本地 LoRA，管理多层模型树、权重、触发词、预览图和 Civitai 信息 |
| 🦅 **统一媒体浏览器** | `🦅 Eagle Suite/媒体` | 浏览本地图片/视频，支持递归、比例筛选与顺序/随机批次输出 |

---

### 🎬 视频与音频处理

| 节点 | 类别菜单 | 说明 |
|------|----------|------|
| 🦅 **图像序列 → 视频** | `🦅 Eagle Suite/视频` | 将图像批次编码为 GIF、APNG、WebP 或常见视频格式 |
| 🦅 **视频格式转换** | `🦅 Eagle Suite/视频` | 使用 FFmpeg 转换视频格式、分辨率和帧率 |
| 🦅 **高级视频保存** | `🦅 Eagle Suite/视频` | `IMAGE` 序列或原生 `VIDEO` 二选一保存，可合并音频、写入 Eagle，并嵌入工作流及保存同名 JSON |
| 🦅 **视频GIF预览** | `🦅 Eagle Suite/视频` | 使用 ComfyUI 原生预览协议显示 VIDEO，或把 IMAGE 序列临时编码为 GIF/WebP/MP4 |
| 🦅 **批量视频加载** | `🦅 Eagle Suite/视频` | 批量读取视频帧与文件信息 |
| 🦅 **视频帧提取** | `🦅 Eagle Suite/视频` | 按范围或间隔提取视频帧 |
| 🦅 **视频信息** | `🦅 Eagle Suite/视频` | 获取时长、帧率、分辨率和编码信息 |
| 🦅 **GIF 压缩保存** | `🦅 Eagle Suite/视频` | 优化 GIF 文件大小 |
| 🦅 **音频提取 / 混音 / 浏览器** | `🦅 Eagle Suite/音频` | 从视频提取音频轨道、多轨道音频混合与本地音频库浏览 |

---

### 🤖 API 多功能调用与本地大模型

| 节点 | 类别菜单 | 说明 |
|------|----------|------|
| 🦅 **API 多功能调用** | `🦅 Eagle Suite/API` | 支持 OpenAI 兼容接口的文本对话 / 图像分析（Vision），最多支持 9 张图像输入 |
| 🦅 **API 生图** | `🦅 Eagle Suite/API` | 支持 Images API 文生图、最多 4 张参考图与遮罩编辑、原图尺寸/比例预设及自定义宽高 |
| 🦅 **API Key Input** | `🦅 Eagle Suite/API` | 单独输入 API Key / Base URL / Model 凭据 |
| 🦅 **API 配置加载器** | `🦅 Eagle Suite/API` | 使用 `api_config.json` 统一管理 LLM/生图配置，支持增改删与下拉切换 |
| 🦅 **本地大模型反推** | `🦅 Eagle Suite/API` | 从 ComfyUI `models/LLM` 或 `models/text_encoders` 选择 Transformers 模型进行反推 |
| 🦅 **本地大模型服务(OpenAI兼容)** | `🦅 Eagle Suite/API` | 调用本机 vLLM、LM Studio、Ollama 兼容服务，支持文本、图像与多轮历史 |

---

## 📁 项目结构

```
ComfyUI_Eagle_Suite/
├── eagle_suite/              # 核心节点主包
│   ├── nodes.py              # 节点注册与菜单分配唯一入口
│   ├── h3_director_node.py      # H3 导演台控制中心节点
│   ├── director_skill_node.py   # 导演技能库文档与素材胶片节点
│   ├── danbooru_search.py       # Danbooru 语义搜索、标签与抽卡 (BGE-M3)
│   ├── eagle_gallery.py      # Eagle Gallery 画廊后端
│   ├── wallhaven_gallery.py  # Wallhaven Gallery 后端
│   ├── lora_gallery.py       # LoRA 管理与触发词归档后端
│   ├── unified_media_browser.py # 图片/视频统一媒体浏览
│   ├── advanced_video_saver.py  # 视频保存、Eagle 与工作流 metadata
│   ├── video_preview_node.py    # 原生 VIDEO / 动图预览
│   ├── video_nodes.py        # 视频编码与转换
│   ├── batch_video_nodes.py  # 批量视频读取与帧提取
│   ├── audio_nodes.py        # 音频提取与混音
│   ├── api_model_loader.py   # API 对话与生图调用
│   ├── api_key_node.py       # API Key 与配置加载器
│   ├── api_config_manager.py # 单文件 API 配置管理
│   ├── local_llm_node.py     # 本地模型与 OpenAI 兼容服务
│   ├── eagle_loader.py       # Eagle 图片加载
│   ├── eagle_saver.py        # Eagle 图片保存
│   ├── local_loader.py       # 本地图片加载
│   ├── gif_compressor.py     # GIF 压缩
│   └── text_nodes.py         # 字符串工具节点集合
├── nodes/                    # 工具后端
│   ├── prompt_presets.py     # 提示词预设 & 导演技能库数据后端
│   ├── audio_browser.py      # 音频浏览器
│   ├── string_tools.py       # 字符串辅助工具
│   └── prompts/              # 预设模板与导演技能存储目录
│       └── director_skills/  # 导演技能文档 (skills.json) 与素材胶片
├── web/                      # 前端 Vue 3 资源
│   ├── js/                   # 各节点的 Vue 3 前端渲染与交互脚本
│   └── lib/                  # Vue 3 等内置第三方前端库
├── all_eagle_suite_nodes_workflow.json # 包含全量 39 个节点的样例工作流 JSON
├── api_config.example.json   # 可提交的空白 API 配置示例
├── api_config.json           # 本地 API 配置（自动生成，Git 忽略）
├── requirements.txt          # Python 依赖
└── README.md                 # 本说明文档
```

---

## 📝 更新日志

### v1.4.0-stable (2026-08-25)
- ✨ **新增 H3 导演台 & 导演技能库**：MiniMax H3 / 海螺 AI 专属控制台，支持场景分镜动作分解、提示词编译与 ethanfel Plan 格式导出；导演技能库支持 Markdown 编辑、胶片拖拽、多路径管理及 JSON 导入/导出。
- ✨ **Danbooru 标签搜索升级**：集成 BGE-M3 语义向量搜索，支持 `models/text_encoders/bge-m3` 或 `models/LLM/bge-m3` 本地路径离线部署与全自动下载。
- ✨ **提示词预设 UI 重构**：三卡片设置面板（Obsidian/存储路径/分类）、详情页指令模板 `<textarea>` 内联编辑失焦自存、54px 紧凑封面排版。
- 📦 **提供全节点标准工作流 JSON**：根目录下生成 `all_eagle_suite_nodes_workflow.json`，一键导入全部 39 个节点。

### v1.3.0-stable (2026-08-14)
- ✨ 新增 **统一媒体浏览器**：合并图片/视频浏览，支持递归目录、视频封面、比例筛选及顺序/随机批次输出。
- ✨ 新增 **高级视频保存**：图像序列或 VIDEO 二选一输入，支持 Eagle 元数据、工作流嵌入与同名 JSON。
- ✨ 新增独立 **视频GIF预览**，统一使用 ComfyUI 原生 UI 返回协议，并移除重复的自动 DOM 视频预览脚本。
- ✨ LoRA Gallery 增加多层模型树、画廊折叠、已选列表、Civitai 触发词/模型信息归档和 PNG 封面支持。

### v1.2.2-stable (2026-08-01)
- 🔧 Eagle Gallery 改为节点级全局选择集合，切换文件夹或筛选后仍显示已选图像预览。
- 🔧 Eagle Gallery 右侧网格增加独立且稳定可见的纵向滚动条。
- 🔄 API 配置加载器监听 `api_config.json` 版本，文件与画布内所有模型下拉、增改删操作双向同步。
- ✨ API 生图新增原图尺寸、比例预设、1K～8K、自定义宽高及参考图适应/裁剪/拉伸。
