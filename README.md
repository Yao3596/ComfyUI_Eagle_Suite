# 🦅 Eagle Suite

ComfyUI 插件，集成 Eagle 素材管理、视频/音频处理、API 调用等功能。

## 功能概览

### 🎬 视频处理
| 节点 | 说明 |
|------|------|
| 🦅 图像序列 → 视频 | 将图像序列合成视频/GIF/APNG/WebP，支持透明通道 |
| 🦅 视频格式转换 | 视频转码、裁剪、缩放、抽帧 |
| 🦅 批量视频加载 | 批量加载视频为图像帧序列 |
| 🦅 视频帧提取 | 从视频提取单帧 |
| 🦅 视频信息 | 获取视频元数据（分辨率、时长、帧率等） |

### 🎵 音频处理
| 节点 | 说明 |
|------|------|
| 🦅 音频提取 | 从视频提取音频 |
| 🦅 音频混音 | 多轨道音频混合 |

### 🖼️ Eagle 集成
| 节点 | 说明 |
|------|------|
| 🦅 Eagle 图片加载 | 从 Eagle 库加载图片 |
| 🦅 Eagle 图片保存 | 保存图片到 Eagle 库 |
| 🦅 本地图片加载 | 加载本地文件夹图片 |

### 🤖 API 调用
| 节点 | 说明 |
|------|------|
| 🦅 API 多功能调用 | 支持 OpenAI 兼容接口的文本/图像对话 |
| 🦅 API Key Input | API Key 输入节点 |

## 安装

### 自动安装（推荐）
插件首次加载时自动安装依赖，无需手动操作。

### 手动安装
```bash
cd ComfyUI/custom_nodes/ComfyUI_Eagle_Suite
pip install -r requirements.txt
```

## 依赖

- FFmpeg（视频处理必需）
- Eagle（可选，用于素材管理集成）

## 详细文档

- [API 节点使用说明](API节点使用说明.md)

## 支持格式

### 视频输出
- `h264-mp4` / `h265-mp4` - 标准视频
- `vp9-webm` / `av1-webm` - WebM 视频（VP9 支持透明通道）
- `prores-mov` - ProRes 专业格式（支持透明）
- `gif` - 动画 GIF（支持 1-bit 透明）
- `apng` - 动画 PNG（支持完整 Alpha）
- `webp` - 动画 WebP（支持完整 Alpha）

### 图像输出
- PNG / JPG / WebP / BMP / TIFF

## 更新日志

### 2026-05-21
- 修复 GIF 透明处理（移除 alpha_threshold 强制二值化）
- 优化 VP9-WebM 透明通道滤镜链
- 添加视频预览支持（JS 前端）
