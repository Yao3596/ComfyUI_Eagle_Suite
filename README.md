# 🦅 ComfyUI Eagle Suite

一款功能丰富的 ComfyUI 插件，集成 **Eagle 素材管理**、**图库浏览**、**LoRA 管理**、**视频/音频处理**、**OpenAI 兼容 API 调用** 等一站式工作流增强工具。

[![GitHub](https://img.shields.io/badge/GitHub-Yao3596/ComfyUI_Eagle_Suite-181717?logo=github)](https://github.com/Yao3596/ComfyUI_Eagle_Suite)

---
## ✅ 稳定版与运行环境

当前稳定基线：**v1.2.2-stable（2026-08-01）**。

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

### 🧬 LoRA 浏览器

| 节点 | 说明 |
|------|------|
| 🦅 **Lora 浏览器** | 在 ComfyUI 节点内浏览本地 LoRA 模型，支持文件夹树、触发词管理、Civitai 预览图补全与模型下载 |

**主要特性：**
- 🌳 文件夹树导航，支持父文件夹包含子文件夹模型
- 🔍 搜索过滤 + 无限滚动加载
- 🏷️ 触发词显示与编辑，支持手动添加触发词
- 🖼️ 自动从 Civitai 补全预览图
- ⬇️ 支持从 Civitai 下载模型
- 📤 输出选中的 `lora_name`、`trigger_words`、`model_url` 等信息

---

### 🎬 视频处理

| 节点 | 说明 |
|------|------|
| 🦅 **图像序列 → 视频** | 将图像批次编码为 GIF、APNG、WebP 或常见视频格式 |
| 🦅 **视频格式转换** | 使用 FFmpeg 转换视频格式、分辨率和帧率 |
| 🦅 **批量视频加载** | 批量读取视频帧与文件信息 |
| 🦅 **视频帧提取** | 按范围或间隔提取视频帧 |
| 🦅 **视频信息** | 获取时长、帧率、分辨率和编码信息 |

---

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

**兼容的 API 提供商：** OpenAI、Azure OpenAI、阿里云百炼、智谱 AI、DeepSeek 等任何 OpenAI 格式接口。

详细用法请参考 [API 节点使用说明](API节点使用说明.md)。

---

### 🛠️ 实用工具

| 节点 | 说明 |
|------|------|
| 🦅 **图片浏览器** | 浏览工作流输出目录中的图片 |
| 🦅 **音频浏览器** | 浏览音频文件 |
| 🦅 **提示词预设** | 快速插入常用提示词模板 |
| 🦅 **提示词清洗** | 清洗/格式化提示词文本 |
| 🦅 **提示词合并** | 合并多段提示词 |
| 🦅 **提示词反推助手** | 辅助处理反推提示词 |
| 🦅 **分组管理器** | 批量管理 ComfyUI 节点分组 |
| 🦅 **复制文件** | 复制文件到目标目录 |
| 🦅 **删除文件** | 删除指定路径文件 |
| 🦅 **行数统计** | 统计文本行数 |
| 🦅 **分割文本** | 按分隔符分割文本 |
| 🦅 **HF 下载器** | 从 HuggingFace 下载模型/文件 |
| 🦅 **GIF 压缩保存** | 优化 GIF 文件大小 |

---

1. 在节点设置面板中填入 Wallhaven API Key（可选，用于 NSFW 内容和高级搜索）
2. API Key 可在 [wallhaven.cc/settings/account](https://wallhaven.cc/settings/account) 获取

### LoRA 浏览器

1. 在节点设置面板中配置 Civitai API Key（可选，用于提高请求限额）
2. 支持通过 Civitai 自动补全缺失的模型预览图
3. 支持手动编辑触发词，已编辑的触发词会保存在 `.json` 文件中

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
│   ├── eagle_loader.py       # Eagle 图片加载
│   ├── eagle_saver.py        # Eagle 图片保存
│   ├── local_loader.py       # 本地图片加载
│   ├── gif_compressor.py     # GIF 压缩
│   └── ...
├── nodes/                    # 工具节点
│   ├── image_browser.py
│   ├── lora_browser.py
│   ├── audio_browser.py
│   ├── prompt_presets.py
│   ├── file_manager.py
│   ├── group_tools.py
│   ├── string_tools.py
│   └── hf_download.py
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
