# ComfyUI_Eagle_Suite

**Eagle 资源库 × ComfyUI 集成套件** — 一站式解决图片/视频/音频在 ComfyUI 与 Eagle 之间的加载、保存与转换。

---

## 功能亮点

- **Eagle 原生集成** — 直接通过 Eagle API 加载/保存图片，支持文件夹 ID、名称、路径多种输入方式
- **视频全流程** — 批量加载视频 → 帧提取 → 图像序列转视频 → 格式转换，一条龙
- **音频处理** — 从视频提取音频、多轨混音，配合视频节点使用
- **LLM 接入** — 统一 API 节点，支持 Kimi / OpenAI / Claude / Qwen，可做图像反推、提示词生成
- **本地文件支持** — 不依赖 Eagle，纯本地/网络路径图片加载也完全可用

---

## 节点列表

### 🦅 Eagle 基础

| 节点 | 功能 |
|------|------|
| **Eagle 图片加载** | 从 Eagle 文件夹按索引/随机/标签筛选加载图片，支持预览 |
| **Eagle 图片保存** | 将生成图片保存到 Eagle 文件夹（同时可选保存到本地路径） |
| **本地图片加载** | 从本地/网络路径加载图片，支持排序、筛选、子文件夹递归 |

### 🎬 视频处理

| 节点 | 功能 |
|------|------|
| **批量视频加载** | 加载文件夹内多个视频，支持格式筛选、帧跳过、预览首帧 |
| **视频帧提取** | 从视频按帧号/时间/均匀采样提取帧，带预览条 |
| **视频信息** | 读取视频 FPS、分辨率、时长、帧数，不加载画面 |
| **图像序列 → 视频** | 将 IMAGE 序列保存为 mp4/webm/avi/mov，支持分辨率/帧率/质量调控 |
| **视频格式转换** | 输入视频文件路径，转换格式/分辨率/帧率/音频，支持导出图片序列 |

### 🔊 音频处理

| 节点 | 功能 |
|------|------|
| **音频提取** | 从视频文件提取音频，输出 AUDIO 类型供下游使用 |
| **音频混音** | 多路音频混合，支持淡入淡出、音量调节 |

### 🤖 API 工具

| 节点 | 功能 |
|------|------|
| **API 多功能调用** | 统一节点支持文本生成/单图分析/多图分析，兼容多家 API |
| **API Key Input** | 独立密钥输入节点，密码框显示，可连接至其他节点的 api_key 端口 |

---

## 安装方法

### 方法一：复制到 custom_nodes（推荐）

1. 将 `ComfyUI_Eagle_Suite` 整个文件夹复制到 ComfyUI 的 `custom_nodes` 目录：
   ```
   ComfyUI/
   └── custom_nodes/
       └── ComfyUI_Eagle_Suite/
   ```

2. 安装依赖：
   ```bash
   cd ComfyUI/custom_nodes/ComfyUI_Eagle_Suite
   pip install -r requirements.txt
   ```

3. 重启 ComfyUI

### 方法二：通过 ComfyUI Manager

在 ComfyUI Manager 中搜索 `Eagle Suite`，找到后点击 Install。

---

## 依赖说明

| 依赖 | 用途 | 是否必需 |
|------|------|--------|
| `opencv-python` | 视频读取/帧提取 | 视频功能必需 |
| `imageio-ffmpeg` | 视频编码/格式转换 | 视频功能必需 |
| `requests` | Eagle API 通信 | Eagle 功能必需 |
| `Pillow` | 图像处理 | 必需 |
| `numpy` | 数组运算 | 必需 |
| `torch` | ComfyUI 内置 | 已由 ComfyUI 提供 |

---

## 注意事项

- **Eagle 功能**需要 Eagle 客户端正在运行（默认 API 地址 `http://localhost:41595`）
- **视频功能**需要系统已安装 `ffmpeg`，或自动使用 `imageio-ffmpeg` 内置版本
- **API 节点**首次使用需在节点内填写 API Key，密钥会保存到本地配置文件（`api_config.json`），不会出现在工作流 JSON 中
- 如不需要 API 功能，可以不安装 `requests` 以外的额外依赖，API 节点会自动禁用

---

## 文件结构

```
ComfyUI_Eagle_Suite/
├── __init__.py              # 插件入口
├── api_config.json          # API 密钥配置（自动生成）
├── requirements.txt         # Python 依赖
├── nodes/
│   ├── eagle_loader.py     # Eagle 图片加载
│   ├── eagle_saver.py     # Eagle 图片保存
│   ├── local_loader.py     # 本地图片加载
│   ├── batch_video_loader.py  # 批量视频加载/帧提取/视频信息
│   ├── video_nodes.py     # 图像转视频/视频转换
│   ├── audio_nodes.py     # 音频提取/混音
│   └── api_model_loader.py # API 统一调用节点
└── web/js/
    ├── seed_control.js     # seed 控件扩展
    ├── api_unified.js     # API 节点前端扩展
    ├── api_key_input.js   # API Key 密码框前端
    ├── video_saver.js     # 视频保存节点前端
    └── video_type.js      # 视频类型前端辅助
```
