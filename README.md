# 🦅 ComfyUI Eagle Suite

一款功能丰富的 ComfyUI 插件，集成 **Eagle 素材管理**、**图库浏览**、**LoRA 管理**、**视频/音频处理**、**OpenAI 兼容 API 调用** 等一站式工作流增强工具。

[![GitHub](https://img.shields.io/badge/GitHub-Yao3596/ComfyUI_Eagle_Suite-181717?logo=github)](https://github.com/Yao3596/ComfyUI_Eagle_Suite)

---
## ✅ 稳定版与运行环境

当前稳定基线：**v1.3.0-stable（2026-08-14）**。

本版本已在以下 Aki 环境核对：

| 组件 | 已验证环境 |
|------|------------|
| ComfyUI | `0.29.0` |
| ComfyUI Frontend | `1.47.10` |
| Python | `3.13.11`（Aki 内置 Python） |
| Vue | 插件内置 Vue 3，无需 npm 安装 |
| FFmpeg | Aki 内置 FFmpeg / `imageio_ffmpeg` 自动发现 |

以上是已验证环境，不代表硬性最低版本。升级 ComfyUI 前端后若 Gallery 没有刷新，请重启 ComfyUI，并在浏览器中按 `Ctrl+F5` 清除旧模块缓存。

### 🚀 安装

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

4. 重启 ComfyUI。前端文件更新后建议执行一次 `Ctrl+F5` 清除浏览器缓存。

> **说明：** `torch`、`safetensors`、`folder_paths` 和 `comfy` 由 ComfyUI 环境提供，不应由本插件单独覆盖版本。本地大模型节点需要 `transformers` 和 `accelerate`；不使用该功能时无需单独加载本地模型。

---
## ✨ 功能概览

### 🖼️ 图库浏览（Gallery）

在 ComfyUI 节点内直接浏览、搜索、选择图片，选中后输出为 `IMAGE` 张量。

| 节点 | 说明 |
|------|------|
| 🦅 **Eagle Gallery** | 浏览本地 Eagle 素材库，支持文件夹树筛选、关键词搜索、星级/比例/标签过滤及跨文件夹全局选择 |
| 🌊 **Wallhaven Gallery** | 浏览 [Wallhaven](https://wallhaven.cc) 在线壁纸库，支持分类、纯度、排序筛选 |

**Gallery 通用特性：**
- 🔍 实时搜索 + 文件夹树筛选
- ⭐ 星级过滤、比例过滤（横向/纵向/方形）
- 🏷️ 标签过滤（Eagle Gallery）
- 🖱️ 单击选中 / 双击查看 / 底部预览条
- 📌 Eagle Gallery 切换文件夹后保留全局已选预览，右侧画廊提供独立纵向滚动条
- 📤 Eagle Gallery 输出 `IMAGE` 列表、`tags`、`selection_data` 和 `next_index`
- ⚙️ 设置面板支持 Eagle 服务地址或 Wallhaven API Key
- 🧩 Gallery 前端使用插件内置 Vue 3，不依赖外部 CDN

---

### 🧬 LoRA Gallery

| 节点 | 说明 |
|------|------|
| 🦅 **LoRA Gallery** | 在节点内浏览并加载本地 LoRA，管理模型树、权重、触发词、预览图和 Civitai 信息 |

**主要特性：**
- 🌳 多层模型树与悬停预览，可从顶部模型树快速加入右侧已选列表
- 🖼️ 画廊可折叠；折叠后释放缩略图资源并让已选列表占满内容区
- 🏷️ 从本地 sidecar 或 Civitai 读取触发词，支持手动编辑并缓存到模型旁文件
- 💾 将 Civitai 模型、版本、使用说明和触发词归档到模型旁 JSON，远端下线后仍可读取
- 🖼️ 缺少封面时可补全本地预览图，支持 PNG/JPG/WebP/GIF；已有封面默认跳过
- 📤 输出加载后的 `model`、`clip`、LoRA 关键信息 JSON 和合并后的触发词文本

---

### 🎬 视频处理

| 节点 | 说明 |
|------|------|
| 🦅 **图像序列 → 视频** | 将图像批次编码为 GIF、APNG、WebP 或常见视频格式 |
| 🦅 **视频格式转换** | 使用 FFmpeg 转换视频格式、分辨率和帧率 |
| 🦅 **高级视频保存** | `IMAGE` 序列或原生 `VIDEO` 二选一保存，可合并音频、写入 Eagle，并嵌入工作流及保存同名 JSON |
| 🦅 **视频GIF预览** | 使用 ComfyUI 原生预览协议显示 VIDEO，或把 IMAGE 序列临时编码为 GIF/WebP/MP4 |
| 🦅 **批量视频加载** | 批量读取视频帧与文件信息 |
| 🦅 **视频帧提取** | 按范围或间隔提取视频帧 |
| 🦅 **视频信息** | 获取时长、帧率、分辨率和编码信息 |

高级视频保存会优先使用已连接的 `VIDEO`，未连接时使用 `IMAGE` 序列；两者都未连接才会报错。工作流会写入视频 metadata 的 `comment`，同时生成同名 `.json` 作为兼容备份。

---

### 🏷️ Danbooru 标签搜索

| 节点 | 说明 |
|------|------|
| 🦅 **Danbooru 标签搜索** | 组合标签检索、图库选择、中文语义检索、标签编辑与角色外内容抽卡 |

- `character_tags` 输入口用于固定角色特征，抽卡只补充服装、动作、场景、构图与光照等角色外内容
- 输出标签支持拖拽排序、权重、类型、译名、固定/屏蔽状态，双击可临时屏蔽输出
- 支持规则抽卡；只有同时打开节点外部执行开关和设置中的模型模式时，才调用本地/API 模型
- 本地语义数据与模型缓存均为运行时资源，不提交到 Git；设置页可手动重新载入标签数据

---

### 节点菜单层级

所有节点由 `eagle_suite/nodes.py` 统一注册到 `🦅 Eagle Suite`，并按用途分为：`Eagle`、`画廊`、`媒体`、`视频`、`音频`、`API`、`文本`和`工具`。

### 🎵 音频处理

| 节点 | 说明 |
|------|------|
| 🦅 **音频提取** | 从视频提取音频轨道 |
| 🦅 **音频混音** | 多轨道音频混合 |

---

### 🦅 Eagle 素材管理

| 节点 | 说明 |
|------|------|
| 🦅 **Eagle 图片加载** | 从 Eagle 库按 ID/路径加载图片 |
| 🦅 **Eagle 图片保存** | 保存生成结果到 Eagle 库 |
| 🦅 **本地图片加载** | 加载本地文件夹图片 |

---

### 🤖 API 多功能调用

| 节点 | 说明 |
|------|------|
| 🦅 **API 多功能调用** | 支持 OpenAI 兼容接口的文本对话 / 图像分析（Vision），最多支持 9 张图像输入 |
| 🦅 **API 生图** | 支持 Images API 文生图、最多 4 张参考图与遮罩编辑、输入缩放、原图尺寸、1K～8K 比例预设及自定义宽高 |
| 🦅 **API Key Input** | 直接输入 API Key / Base URL / Model |
| 🦅 **API 配置加载器** | 只用 `api_config.json` 统一管理 LLM/生图配置，支持增改删、下拉切换及文件外部修改自动同步 |
| 🦅 **本地大模型反推** | 从 ComfyUI `models/LLM` 或 `models/text_encoders` 选择 Transformers 模型进行文本/图像反推 |
| 🦅 **本地大模型服务(OpenAI兼容)** | 调用本机 vLLM、LM Studio、Ollama 兼容服务，支持文本、图像与多轮历史 |

**兼容的 API 提供商：** OpenAI、Azure OpenAI、阿里云百炼、智谱 AI、DeepSeek 等任何 OpenAI 格式接口。

详细用法请参考 [API 节点使用说明](API节点使用说明.md)。

---

### 🛠️ 实用工具

| 节点 | 说明 |
|------|------|
| 🦅 **统一媒体浏览器** | 浏览本地图片/视频，支持递归、比例筛选与顺序/随机批次输出 |
| 🦅 **音频浏览器** | 浏览音频文件 |
| 🦅 **提示词预设** | 可编辑模板库，支持封面、变量、分类、本地目录与可选 Obsidian Local REST API 同步 |
| 🦅 **提示词清洗** | 清洗/格式化提示词文本 |
| 🦅 **提示词合并** | 合并多段提示词 |
| 🦅 **提示词反推助手** | 辅助处理反推提示词 |
| 🦅 **行数统计** | 统计文本行数 |
| 🦅 **分割文本** | 按分隔符分割文本 |
| 🦅 **GIF 压缩保存** | 优化 GIF 文件大小 |

---

1. 在节点设置面板中填入 Wallhaven API Key（可选，用于 NSFW 内容和高级搜索）
2. API Key 可在 [wallhaven.cc/settings/account](https://wallhaven.cc/settings/account) 获取

### LoRA Gallery

1. 在节点设置面板中配置 Civitai API Key（可选，用于提高请求限额）
2. “补全无封面”只处理没有本地封面的模型，避免重复下载
3. 点击已选模型的 `T` 按钮读取/保存 Civitai 触发词；模型信息与触发词会归档到模型旁 JSON

### 提示词预设与本地配置

- `nodes/prompts/config.json`：Obsidian API Key、本地模板路径等机器配置，Git 忽略
- `nodes/prompts/user_templates.json`：用户自建模板，Git 忽略
- `nodes/prompts/config.example.json`：不含凭据的公开示例
- `nodes/prompts/covers/`、`nodes/prompts/user_templates/`：运行时封面和模板目录，Git 忽略

Obsidian 连接需要安装并启用 **Local REST API** 插件，节点设置中的协议、端口和 API Key 必须与插件配置一致。HTTPS 使用自签名证书时，浏览器访问 `https://127.0.0.1:27124/` 出现警告是常见情况，但后端测试连接仍需该服务正在运行。

### API 多功能调用

详见 [API 节点使用说明](API节点使用说明.md)。

配置文件说明：
- `api_config.json` — LLM 与生图 API 模型的唯一真实配置；每个根键是一组模型，节点增改删直接同步
- `api_config.example.json` — 可提交到仓库的空白示例，不包含真实凭据

真实配置和自动备份均应保持本地使用，已由 `.gitignore` 排除。API Key 的 `ENC:` 格式只是 Base64 编码混淆，并非加密；请勿把配置文件发送给他人或提交到公开仓库。

---

## 📁 项目结构

```
ComfyUI_Eagle_Suite/
├── eagle_suite/              # 主节点包
│   ├── nodes.py              # 节点注册入口
│   ├── eagle_gallery.py      # Eagle Gallery 后端
│   ├── wallhaven_gallery.py  # Wallhaven Gallery 后端
│   ├── video_nodes.py        # 视频处理节点
│   ├── batch_video_nodes.py  # 批量视频处理节点
│   ├── audio_nodes.py        # 音频处理节点
│   ├── api_model_loader.py   # API 对话与生图调用节点
│   ├── api_key_node.py       # API Key / 配置加载器节点
│   ├── api_config_manager.py # 单文件多模型配置管理
│   ├── local_llm_node.py     # 本地模型与 OpenAI 兼容本地服务
│   ├── eagle_loader.py       # Eagle 图片加载
│   ├── eagle_saver.py        # Eagle 图片保存
│   ├── local_loader.py       # 本地图片加载
│   ├── unified_media_browser.py # 图片/视频统一媒体浏览
│   ├── advanced_video_saver.py  # 视频保存、Eagle 与工作流 metadata
│   ├── video_preview_node.py    # 原生 VIDEO / 动图预览
│   ├── danbooru_search.py       # Danbooru 搜索、标签与抽卡
│   ├── gif_compressor.py     # GIF 压缩
│   └── ...
├── nodes/                    # 工具节点
│   ├── audio_browser.py
│   ├── prompt_presets.py
│   ├── prompts/config.example.json
│   └── string_tools.py
├── web/                      # 前端资源
│   ├── js/                   # Gallery 前端脚本
│   └── lib/                  # Vue 3 等第三方库
├── api_config.example.json   # 可提交的空白 API 配置示例
├── api_config.json           # 本地唯一 API 配置（自动生成，Git 忽略）
├── requirements.txt          # Python 依赖
└── README.md                 # 本文件
```

---

## 📝 更新日志

### v1.3.0-stable (2026-08-14)
- ✨ 新增 **统一媒体浏览器**：合并图片/视频浏览，支持递归目录、视频封面、比例筛选及顺序/随机批次输出
- ✨ 新增 **高级视频保存**：图像序列或 VIDEO 二选一输入，支持 Eagle 元数据、工作流嵌入与同名 JSON
- ✨ 新增独立 **视频GIF预览**，统一使用 ComfyUI 原生 UI 返回协议，并移除重复的自动 DOM 视频预览脚本
- ✨ LoRA Gallery 增加多层模型树、画廊折叠、已选列表、Civitai 触发词/模型信息归档和 PNG 封面支持
- 🔧 修复 LoRA Gallery 与统一媒体浏览器重复创建节点时的高度反馈累加，避免 Vue 节点框持续增高或压缩其他组件
- ✨ Danbooru 标签搜索增加角色特征输入、标签权重/排序/屏蔽、角色外内容抽卡及可选本地/API 模型入口
- ✨ 提示词预设重做为模板库，支持编辑、封面、变量、本地路径与可选 Obsidian 同步
- 🔧 本地大模型反推与 OpenAI 兼容本地服务补充 `seed` 和 ComfyUI 生成后控制
- 🗑️ 移除已被统一媒体浏览器替代的图片浏览器、本地视频加载器、Eagle Video Gallery，以及弃用的 HF 下载、文件/分组工具
- 🔒 提示词预设的 Obsidian 密钥、用户模板、封面和 Danbooru 大模型缓存加入 Git 忽略规则

### v1.2.2-stable (2026-08-01)
- 🔧 Eagle Gallery 改为节点级全局选择集合，切换文件夹或筛选后仍显示已选图像预览
- 🔧 Eagle Gallery 右侧网格增加独立且稳定可见的纵向滚动条
- 🔄 API 配置加载器监听 `api_config.json` 版本，文件与画布内所有模型下拉、增改删操作双向同步
- ✨ API 生图新增原图尺寸、比例预设、1K～8K、自定义宽高及参考图适应/裁剪/拉伸
- 🛡️ GPT Image 2 请求尺寸自动校验原生限制，超出范围时区分请求尺寸与最终后处理尺寸，并增加高分辨率内存保护

### v1.2.1-stable (2026-07-31)
- 🔧 Eagle Gallery 恢复经过验证的 Vue 组件实现，修复模块解析和框体挂载异常
- 🔧 Eagle Gallery 配置读取统一复用现有配置管理器，避免引用缺失模块导致启动失败
- ✨ API 配置加载器支持多 Profile 的添加、编辑、删除、切换和远程模型列表读取
- ✨ 新增 **API 生图** 节点，支持 GPT Image 兼容的文生图、参考图编辑和遮罩编辑
- ✨ `api_config.json` 单文件统一管理 `llm` / `image` 两类模型，增改删后同步刷新画布中的加载器节点
- 🔒 Profile API Key 在后端统一转为 `ENC:` 格式，配置采用原子写入以降低中断损坏风险
- 🔒 `api_config.json` 与其备份加入 Git 忽略规则
- 📦 补充 Aki 环境、依赖安装、浏览器缓存和本地配置安全说明

### v1.2.0 (2026-07-18)
- ✨ 新增 **LoRA 浏览器** — 本地 LoRA 模型浏览、触发词管理、Civitai 预览图补全与下载
- ✨ 新增 **文本节点套件** — 提示词预设、清洗、合并、反推助手
- 🔧 Eagle Gallery 重构为 Vue 3 实现，支持标签过滤、整文件夹输出、响应式布局
- 🔧 API 多功能调用支持最多 9 张图像输入，新增 `对话历史` 输出
- 🔧 API 配置加载器支持多 profile 下拉切换
- 🗑️ 移除已弃用的 **Pinterest Gallery** 节点
- 📄 重写 README 和 API 使用说明

### v1.1.0 (2026-05-21)
- ✨ 新增 **Wallhaven Gallery** — 在线壁纸库浏览
- 🔧 Eagle Gallery 全面修复：缩略图加载、Token 认证、路径编码
- 🔧 设置面板增加 GitHub 链接和作者署名
- 📄 重写 README 和 API 使用说明
