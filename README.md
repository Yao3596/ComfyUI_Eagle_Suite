# 🦅 ComfyUI Eagle Suite

一款功能丰富的 ComfyUI 插件，集成 **Eagle 素材管理**、**图库浏览**、**视频/音频处理**、**API 调用** 等一站式工作流增强工具。

[![GitHub](https://img.shields.io/badge/GitHub-Yao3596/ComfyUI_Eagle_Suite-181717?logo=github)](https://github.com/Yao3596/ComfyUI_Eagle_Suite)

---

## ✨ 功能概览

### 🖼️ 图库浏览（Gallery）

在 ComfyUI 节点内直接浏览、搜索、选择图片，选中后输出为 IMAGE 张量。

| 节点 | 说明 |
|------|------|
| 🦅 **Eagle Gallery** | 浏览本地 Eagle 素材库，支持文件夹筛选、关键词搜索、星级/比例过滤 |
| 🦅 **Eagle Gallery (Vue)** | Vue 3 重构版 Eagle 图库，响应式交互、现代化 UI |
| 🌊 **Wallhaven Gallery** | 浏览 [Wallhaven](https://wallhaven.cc) 壁纸库，支持分类、纯度、排序筛选 |

**Gallery 通用特性：**
- 🔍 实时搜索 + 文件夹树筛选
- ⭐ 星级过滤、比例过滤（横向/纵向/方形）
- 🖱️ 单击选中 / 双击跳转 / 底部预览条
- 📤 选中后自动输出 `IMAGE` 张量 + `tags` 文本
- ⚙️ 设置面板支持 API Key / Token 配置

### 🎬 视频处理

| 节点 | 说明 |
|------|------|
| 🦅 **图像序列 → 视频** | 将图像序列合成视频/GIF/APNG/WebP，支持透明通道 |
| 🦅 **视频格式转换** | 视频转码、裁剪、缩放、抽帧 |
| 🦅 **批量视频加载** | 批量加载视频为图像帧序列 |
| 🦅 **视频帧提取** | 从视频提取单帧 |
| 🦅 **视频信息** | 获取视频元数据（分辨率、时长、帧率等） |

**支持输出格式：**
- `h264-mp4` / `h265-mp4` — 标准视频
- `vp9-webm` / `av1-webm` — WebM 视频（VP9 支持透明通道）
- `prores-mov` — ProRes 专业格式（支持透明）
- `gif` — 动画 GIF（支持 1-bit 透明）
- `apng` — 动画 PNG（支持完整 Alpha）
- `webp` — 动画 WebP（支持完整 Alpha）

### 🎵 音频处理

| 节点 | 说明 |
|------|------|
| 🦅 **音频提取** | 从视频提取音频轨道 |
| 🦅 **音频混音** | 多轨道音频混合 |

### 🦅 Eagle 素材管理

| 节点 | 说明 |
|------|------|
| 🦅 **Eagle 图片加载** | 从 Eagle 库按 ID/路径加载图片 |
| 🦅 **Eagle 图片保存** | 保存生成结果到 Eagle 库 |
| 🦅 **本地图片加载** | 加载本地文件夹图片 |

### 🤖 API 多功能调用

| 节点 | 说明 |
|------|------|
| 🦅 **API 多功能调用** | 支持 OpenAI 兼容接口的文本对话 / 图像分析（Vision） |
| 🦅 **API Key Input** | API Key 输入节点 |
| 🦅 **API 配置加载器** | 加载保存的 API 配置 |

**兼容的 API 提供商：** OpenAI、Azure OpenAI、阿里云百炼、智谱 AI 等任何 OpenAI 格式接口。

### 🛠️ 实用工具

| 节点 | 说明 |
|------|------|
| 🦅 **图片浏览器** | 浏览工作流输出目录中的图片 |
| 🦅 **Lora 浏览器** | 浏览和管理 Lora 模型 |
| 🦅 **音频浏览器** | 浏览音频文件 |
| 🦅 **提示词预设** | 快速插入常用提示词模板 |
| 🦅 **分组管理器** | 批量管理 ComfyUI 节点分组 |
| 🦅 **行数统计** | 统计文本行数 |
| 🦅 **分割文本** | 按分隔符分割文本 |
| 🦅 **删除文件** | 删除指定路径文件 |
| 🦅 **复制文件** | 复制文件到目标目录 |
| 🦅 **HF 下载器** | 从 HuggingFace 下载模型/文件 |
| 🦅 **GIF 压缩保存** | 优化 GIF 文件大小 |

---

## 📦 安装

### 方法一：ComfyUI Manager（推荐）

在 ComfyUI Manager 中搜索 `ComfyUI_Eagle_Suite`，点击安装。

### 方法二：手动安装

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Yao3596/ComfyUI_Eagle_Suite.git
cd ComfyUI_Eagle_Suite
pip install -r requirements.txt
```

### 方法三：便携包/整合包

将本项目解压到 `ComfyUI/custom_nodes/ComfyUI_Eagle_Suite`，重启 ComfyUI 即可自动安装依赖。

---

## 📋 依赖

### Python 包

插件首次加载时会自动安装以下依赖（也可手动 `pip install -r requirements.txt`）：

| 包名 | 用途 |
|------|------|
| `imageio_ffmpeg>=0.4.9` | 视频编码/解码 |
| `opencv-python>=4.8.0` | 图像处理 |
| `aiohttp>=3.9.0` | 异步 HTTP 服务（图库代理） |
| `requests>=2.31.0` | HTTP 请求（API 调用、图库） |
| `Pillow>=10.0.0` | 图像读写 |
| `numpy>=1.24.0` | 数值计算 |

### 外部工具

- **FFmpeg** — 视频处理必需，请确保已添加到系统 PATH
- **Eagle App**（可选）— 用于 Eagle Gallery 和素材管理集成

---

## 🔧 配置说明

### Eagle Gallery

1. 确保 Eagle App 已启动且 **插件 API** 已启用（设置 → 插件 → 开启 API）
2. 在节点设置面板中填入 Eagle API URL，默认：`http://localhost:41595`
3. 如果 Eagle 启用了 Token 认证，在 URL 末尾添加 `?token=xxx`，例如：
   ```
   http://localhost:41595/?token=your_token_here
   ```

### Wallhaven Gallery

1. 在节点设置面板中填入 Wallhaven API Key（可选，用于 NSFW 内容和高级搜索）
2. API Key 可在 [wallhaven.cc/settings/account](https://wallhaven.cc/settings/account) 获取

### API 多功能调用

详见 [API 节点使用说明](API节点使用说明.md)。

---

## 📁 项目结构

```
ComfyUI_Eagle_Suite/
├── eagle_suite/          # 主节点包
│   ├── nodes.py          # 节点注册入口
│   ├── eagle_gallery.py  # Eagle Gallery 后端
│   ├── eagle_gallery_vue.py  # Eagle Gallery Vue 版后端
│   ├── wallhaven_gallery.py  # Wallhaven Gallery 后端
│   ├── video_nodes.py    # 视频处理节点
│   ├── audio_nodes.py    # 音频处理节点
│   ├── api_model_loader.py   # API 调用节点
│   └── ...
├── nodes/                # 工具节点
├── web/                  # 前端资源
│   ├── js/               # Gallery 前端脚本
│   └── lib/              # Vue 3 等第三方库
├── requirements.txt      # Python 依赖
└── README.md             # 本文件
```

---

## 📝 更新日志

### v1.1.0 (2026-05-21)
- ✨ 新增 **Eagle Gallery (Vue)** — Vue 3 重构版，响应式 UI
- ✨ 新增 **Wallhaven Gallery** — 在线壁纸库浏览
- 🔧 Eagle Gallery 全面修复：缩略图加载、Token 认证、路径编码
- 🔧 设置面板增加 GitHub 链接和作者署名
- 📄 重写 README 和 API 使用说明

### v1.0.0 (2025-05-13)
- 🎬 视频处理：序列合成、格式转换、批量加载、帧提取
- 🎵 音频处理：提取、混音
- 🦅 Eagle 集成：加载、保存、本地浏览
- 🤖 API 调用：OpenAI 兼容接口
- 🛠️ 工具集：图片/Lora/音频浏览器、提示词预设、文件管理

---

## 👤 作者

**Yao3596**

- GitHub: [@Yao3596](https://github.com/Yao3596)
- 项目主页: [ComfyUI_Eagle_Suite](https://github.com/Yao3596/ComfyUI_Eagle_Suite)

---

## 📄 License

MIT License
