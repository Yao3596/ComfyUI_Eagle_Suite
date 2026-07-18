# 🦅 ComfyUI Eagle Suite

一款功能丰富的 ComfyUI 插件，集成 **Eagle 素材管理**、**图库浏览**、**LoRA 管理**、**视频/音频处理**、**OpenAI 兼容 API 调用** 等一站式工作流增强工具。

[![GitHub](https://img.shields.io/badge/GitHub-Yao3596/ComfyUI_Eagle_Suite-181717?logo=github)](https://github.com/Yao3596/ComfyUI_Eagle_Suite)

---
## ✨ 功能概览

### 🖼️ 图库浏览（Gallery）

在 ComfyUI 节点内直接浏览、搜索、选择图片，选中后输出为 `IMAGE` 张量。

| 节点 | 说明 |
|------|------|
| 🦅 **Eagle Gallery** | 浏览本地 Eagle 素材库，支持文件夹树筛选、关键词搜索、星级/比例/标签过滤 |
| 🌊 **Wallhaven Gallery** | 浏览 [Wallhaven](https://wallhaven.cc) 在线壁纸库，支持分类、纯度、排序筛选 |

**Gallery 通用特性：**
- 🔍 实时搜索 + 文件夹树筛选
- ⭐ 星级过滤、比例过滤（横向/纵向/方形）
- 🏷️ 标签过滤（Eagle Gallery）
- 🖱️ 单击选中 / 双击查看 / 底部预览条
- 📤 选中后自动输出 `IMAGE` 张量、`tags` 文本、`masks` 遮罩、`file_paths` 本地路径
- ⚙️ 设置面板支持 API Key / Token 配置

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
- `gif` — 动画 GIF（支持 1-bit 透明）
- `apng` — 动画 PNG（支持完整 Alpha）
- `webp` — 动画 WebP（支持完整 Alpha）

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
| 🦅 **API Key Input** | 直接输入 API Key / Base URL / Model |
| 🦅 **API 配置加载器** | 从 `api_profiles.json` 加载多组命名配置，支持下拉切换 |

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
- `api_config.json` — 保存最后一次使用的 API key / url / model
- `api_profiles.json` — 保存多组命名 profile，供 `🦅 API 配置加载器` 下拉切换

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
│   ├── api_model_loader.py   # API 统一调用节点
│   ├── api_key_node.py       # API Key / 配置加载器节点
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
├── api_config.json           # 最后一次 API 配置
├── api_profiles.json         # 命名 API 配置 profile
├── requirements.txt          # Python 依赖
└── README.md                 # 本文件
```

---

## 📝 更新日志

### v1.2.0 (2026-07-18)
- ✨ 新增 **LoRA 浏览器** — 本地 LoRA 模型浏览、触发词管理、Civitai 预览图补全与下载
- ✨ 新增 **文本节点套件** — 提示词预设、清洗、合并、反推助手
- 🔧 Eagle Gallery 重构为 Vue 3 实现，支持标签过滤、整文件夹输出、响应式布局
- 🔧 API 多功能调用支持最多 9 张图像输入，新增 `对话历史` 输出
- 🔧 API 配置加载器支持 `api_profiles.json` 多 profile 下拉切换
- 🗑️ 移除已弃用的 **Pinterest Gallery** 节点
- 📄 重写 README 和 API 使用说明

### v1.1.0 (2026-05-21)
- ✨ 新增 **Wallhaven Gallery** — 在线壁纸库浏览
- 🔧 Eagle Gallery 全面修复：缩略图加载、Token 认证、路径编码
- 🔧 设置面板增加 GitHub 链接和作者署名
- 📄 重写 README 和 API 使用说明