# 🦅 ComfyUI Eagle Suite

一款 ComfyUI 插件，集成 Eagle 素材管理、图库浏览、LoRA 加载、视频/音频处理、API 调用、本地大模型反推等工具。

[![GitHub](https://img.shields.io/badge/GitHub-Yao3596/ComfyUI_Eagle_Suite-181717?logo=github)](https://github.com/Yao3596/ComfyUI_Eagle_Suite)

---

## ✨ 重点节点

### 🖼️ 图库
| 节点 | 说明 |
|------|------|
| 🦅 **Eagle Gallery** | 浏览本地 Eagle 图片库 |
| 🦅 **Eagle Video Gallery** | 浏览本地 Eagle 视频库 |
| 🌊 **Wallhaven Gallery** | 浏览 Wallhaven 在线壁纸 |

### 🧬 LoRA
| 节点 | 说明 |
|------|------|
| 🦅 **LoRA 画廊加载器** | 可视化浏览 `models/loras`，支持触发词管理、Civitai 预览图补全与下载 |

### 🤖 API / 本地模型
| 节点 | 说明 |
|------|------|
| 🦅 **API 多功能调用** | OpenAI 兼容接口，支持文本对话 / Vision 图像分析（最多 9 张图） |
| 🦅 **API 配置加载器** | 从 `api_profiles.json` 加载多组 API 配置 |
| 🦅 **本地大模型反推** | 从 `models/LLM` 加载 Qwen-VL / LLaVA 等模型 |
| 🦅 **本地大模型服务** | 通过 OpenAI 兼容接口调用本地 vLLM / Ollama / LM Studio |

### 🎬 视频 / 音频
| 节点 | 说明 |
|------|------|
| 🦅 **图像序列 → 视频** | 图像序列合成视频/GIF/WebP 等 |
| 🦅 **视频格式转换** | 转码、裁剪、缩放 |
| 🦅 **批量视频加载** | 批量加载视频为帧序列 |
| 🦅 **视频帧提取** | 提取单帧 |
| 🦅 **视频信息** | 获取分辨率、时长、帧率 |
| 🦅 **音频提取 / 混音** | 音频处理 |

### 📝 文本 / 工具
| 节点 | 说明 |
|------|------|
| 🦅 **提示词预设 / 模板替换 / 拼接 / 分割** | 文本处理工具 |
| 🦅 **保存字符串 / 加载文本文件** | 文本文件读写 |
| 🦅 **图片浏览器 / Lora 浏览器 / 音频浏览器** | 资源浏览器 |
| 🦅 **HF 下载器 / GIF 压缩 / 分组管理器** | 实用工具 |

---

## 📦 安装

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Yao3596/ComfyUI_Eagle_Suite.git
cd ComfyUI_Eagle_Suite
pip install -r requirements.txt
```

或在 ComfyUI Manager 中搜索 `ComfyUI_Eagle_Suite` 安装。

---

## 🔧 配置

### Eagle Gallery
- Eagle App 启动并开启插件 API
- 节点 URL 默认：`http://localhost:41595`
- 有 Token 时：`http://localhost:41595/?token=xxx`

### Wallhaven Gallery
- 可选填 Wallhaven API Key，用于 NSFW 和高级搜索

### LoRA 画廊
- 可选配置 Civitai API Key
- 支持 Civitai 预览图补全与模型下载

### API 调用
- 详见 [API节点使用说明](API节点使用说明.md)
- `api_config.json`：保存最后一次使用的配置
- `api_profiles.json`：保存多组命名配置，供 `API 配置加载器` 使用

### 本地大模型
- 将模型放入 `ComfyUI/models/LLM/` 或 `models/text_encoders/`
- 节点会自动扫描并下拉选择

---

## 📁 项目结构

```
ComfyUI_Eagle_Suite/
├── eagle_suite/              # 主节点包
│   ├── nodes.py              # 节点注册入口
│   ├── eagle_gallery.py      # Eagle Gallery
│   ├── eagle_video_gallery.py
│   ├── wallhaven_gallery.py
│   ├── lora_gallery.py       # LoRA 画廊
│   ├── api_model_loader.py   # API 多功能调用
│   ├── api_key_node.py       # API 配置加载器
│   ├── local_llm_node.py     # 本地大模型
│   ├── text_nodes.py         # 文本节点
│   ├── video_nodes.py
│   └── ...
├── nodes/                    # 工具节点
├── web/                      # 前端脚本
├── api_profiles.json         # API 配置 profile（需自行创建）
├── requirements.txt
└── README.md
```

---

## 📝 更新日志

### v1.2.0
- 新增 LoRA 画廊加载器
- 新增本地大模型反推 / 本地大模型服务节点
- 新增文本节点套件
- API 多功能调用支持 9 图输入、输出格式模板、图像输出
- 移除已弃用的 Pinterest Gallery

### v1.1.0
- 新增 Wallhaven Gallery
- Eagle Gallery 重构与修复

### v1.0.0
- 视频 / 音频 / Eagle / API / 工具集基础功能

---

## 👤 作者

**Yao3596**

- GitHub: [@Yao3596](https://github.com/Yao3596)
- 项目主页: [ComfyUI_Eagle_Suite](https://github.com/Yao3596/ComfyUI_Eagle_Suite)

---

## 📄 License

MIT License
