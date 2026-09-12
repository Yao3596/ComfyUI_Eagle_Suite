# 🦅 ComfyUI Eagle Suite

一款功能丰富的 ComfyUI 插件，集成 **Eagle 素材管理**、**图库浏览**、**LoRA 管理**、**视频/音频处理**、**H3 导演台**、**OpenAI 兼容 API 调用** 等一站式工作流增强工具。

[![GitHub](https://img.shields.io/badge/GitHub-Yao3596/ComfyUI_Eagle_Suite-181717?logo=github)](https://github.com/Yao3596/ComfyUI_Eagle_Suite)

---
## ✅ 稳定版与运行环境

最新稳定版：**v1.4.0-stable（2026-08-25）**。

当前仓库开发基线：**v1.5.0-dev（2026-08-31）**，新增 H3 原生制片循环、审片恢复、完整示例工作流与 Vue 节点统一主题。

Danbooru 标签搜索新增本地词库管理：限速续传、Wiki 释义检索、本地/在线模型翻译细分类、审核抽卡与词典导出，见 [使用说明与调研依据](docs/DANBOORU_LIBRARY.md)。

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

---

## ✨ 功能概览与节点指南

### 🎬 H3 导演台与导演技能库

专为 MiniMax H3 / 海螺 AI 视频生成模型设计的导演级创作与预设套件。

| 节点 | 类别菜单 | 说明 |
|------|----------|------|
| 🦅 **H3 导演台** | `🦅 Eagle Suite/H3 导演台` | MiniMax H3 专属视频导演控制台，支持场景多镜头动作编排、分镜台词整理、风格生成与 ethanfel Plan 格式导出 |
| 🦅 **H3 媒体集成端口** | `🦅 Eagle Suite/H3 导演台` | 可选的手动展开/直连节点；按视频、视频原声、独立音频、参考图片和映射分区排列 |
| 🦅 **导演技能库** | `🦅 Eagle Suite/H3 导演台` | 与其他 H3 节点同级；集中管理 Markdown 导演技能文档与素材胶片，支持自定义保存路径、底部路径显示与 JSON 导出/导入 |
| 🦅 **H3 · 循环开始** | `🦅 Eagle Suite/H3 导演台` | 直接承接导演台 Plan，合并预检、初始化/恢复与原生循环入口，输出尺寸、FPS 和 Eagle 私有 state |
| 🦅 **H3 · 镜头与上下文** | `🦅 Eagle Suite/H3 导演台` | 输出当前镜头提示词、参考素材、首图/上一镜末帧和可复现 seed |
| 🦅 **H3 · 参考条件路由** | `🦅 Eagle Suite/H3 导演台` | 将导演台 `media_bundle` 按当前场景的 `<Picture #>` / `<Video #>` / `<Audio #>` 标签展开为官方 H3 独立参考槽位，并可注入上一镜上下文 Guide |
| 🦅 **H3 · 分段保存与审片** | `🦅 Eagle Suite/H3 导演台` | 合并裁剪、分段保存、检查点、审片、通过/重试/换种/停止及恢复功能 |
| 🦅 **H3 · 循环结束与合成** | `🦅 Eagle Suite/H3 导演台` | 推进下一个镜头并在全部场景完成后自动合成最终视频；支持 ComfyUI 本地目录 + Eagle 文件夹双目标保存 |

- **H3 导演台**：集成世界构建、镜头序列动作分解、音频/台词时间轴；Skill 可按“当前场景”或动态数量的“全部场景”依次生成台本 → 分镜 → 台词，并严格回填到对应场景；画面提示词模板与台词文本语言分开设置，默认采用 **English 画面模板 + 中文台词**；
- **H3 编译契约**：T2VA/I2VA/FL2VA/L2VA 严格输出三字段，Ref2VA 严格输出六字段；L2VA 已拆成独立尾帧模式。发声者按首次出现生成稳定 `(S1)/(S2)`，台词默认编译为 `<d>[Chinese] 原文</d>`；
- **参考素材三层语义**：`图片/视频/音频` 只决定物理端口；每个素材还要选择一个主要用途（人物、首尾帧、动作、运镜、节奏、音色等）以及保留/复制强度。主体素材会编译为 `<Subject N>`，并由对应的 `<Picture N>` / `<Video N>` 定义来源；复杂项目建议在“用途说明”中写清绑定对象与控制范围；
- **参考标签**：`<Subject N>`、`<Picture N>`、`<Video N>`、`<Audio N>` 与 `<d>...</d>` 在台本中保持稳定语义；物理素材标签在重排或删除时会同步改写。音频不能作为唯一参考输入，必须同时存在图片或视频；参考视频原声默认不启用，只有勾选“启用该视频原声为音频参考”后才进入 H3 音频槽；
- **时长与比例**：每个场景的实际时长会进入台本和分镜模板，分镜 `estSeconds` 总和按场景时长约束；生成比例直接继承导演台尺寸设置，不再维护重复比例参数；
- **导演技能库**：与提示词预设共享后端能力，支持 Markdown 实时渲染预览、素材胶片图片拖拽绑定，可配置 `local_paths` 存储目录，自带 `⬇ 导出` 与 `⬆ 导入` 功能。

#### H3 推荐主链

```text
H3 导演台.plan
  → H3 · 循环开始
  → H3 · 镜头与上下文
  → H3 · 参考条件路由
  → [MiniMax H3 模型 / 采样 / 解码]
  → H3 · 重叠帧与音频裁剪
  → H3 · 分段保存与审片
  → H3 · 循环结束与合成
```

导演台的 `media_bundle` 只需一条线连接“参考条件路由”。路由会从包内读取图片、视频、视频原声、独立音频和 `media_mapping`，再按当前场景动态绑定官方 H3 槽位。需要手动查看或直连官方槽位时，可使用“H3 媒体集成端口”：其端口已按视频、视频原声、独立音频、参考图片和映射分区。旧工作流的交错端口节点会按语义自动迁移并重连，不需要手工重接。不建议把大量可变端口搬到导演台上，因为 LiteGraph 端口索引会随素材变化而使历史链路错位。参考图片、视频和音频必须保留为独立语义槽位；不要先拼成宫格。

导演台不对世界设定、场景提示词、用途说明或导演 Skill 文本设置字符上限，也不会截断内容；编译预览仅显示实时字数，方便用户自行判断模型成本与可读性。

“参考条件路由”的参考图尺寸使用单一档位列表：`match` 跟随生成画布，界面中的 `1.2 · 768px` 至 `3.1 · 1984px` 会同时显示倍率及对应短边上限，`max` 对应 `2048px`。数值档位以 640px 为基准按 0.1 递增；只会缩小过大的参考图，不会放大低分辨率素材。旧工作流保存的纯 `1.2–3.1` 数值仍可解析。

在 **H3 导演台** 节点右键选择“创建 H3 核心主链”，可自动建立并连接 6 个承接节点（循环开始、镜头上下文、参考条件、重叠裁剪、分段审片、循环结束）；模型、VAE、采样和解码接入中间预留端口即可。“参考条件路由”现在通过 Motion Context 返回真实 `trim_frames`，裁剪节点据此移除 VAE 解码结果中的重复首帧并同步校正音频长度；裁剪后的 `images / audio / images_with_overlap` 可直接接“分段保存与审片”，不必先额外生成一次预览视频。H3 采样器的同一个 `output` 必须同时接解码器、审片节点和循环结束节点：循环只把尾帧与紧凑的双流 AV latent 传给下一镜，交互式重启则从上一镜 `.pt` 检查点恢复。自动模式会在同一次执行中推进全部场景，交互模式则在每个镜头后停留等待审片。

导演台前六个输出与 Context Loop Plan 的后端契约对齐为 `plan / summary / clip_count / width / height / video_blend_frames`。`plan` 使用共享 `H3_CHAIN_PLAN`；运行链则使用 `EAGLE_H3_STATE` / `EAGLE_H3_FLOW`，不与第三方 `H3_CHAIN_STATE` 做错误直连。端口颜色只是 LiteGraph 的显示结果，契约以 `INPUT_TYPES / RETURN_TYPES` 和实际对象结构为准。上一镜片段已收入 state，“镜头与上下文”无需再暴露 `prev_clip` 输入。

- 可直接导入以 **Ref2VA 全能参考** checkpoint 为基线的完整示例：[example_workflows/eagle_h3_full_workflow.json](example_workflows/eagle_h3_full_workflow.json)
- 详细职责与连接说明：[docs/H3_DIRECTOR_PIPELINE.md](docs/H3_DIRECTOR_PIPELINE.md)
- Context Loop 对齐记录：[docs/H3_CONTEXT_LOOP_ALIGNMENT_2026-08-31.md](docs/H3_CONTEXT_LOOP_ALIGNMENT_2026-08-31.md)

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

### 🛠️ 文本与提示词工具

| 节点 | 类别菜单 | 说明 |
|------|----------|------|
| 🦅 **文本** | `🦅 Eagle Suite/文本` | 一个多行编辑框、一个标准 `STRING` 输出；原样透传，不截断、不改写空白 |
| 🦅 **智能文本工作台** | `🦅 Eagle Suite/文本` | 外接文本优先、分行、转换、替换、统计、JSON 校验和结果预览 |
| 🦅 **提示词预设** | `🦅 Eagle Suite/文本` | 三卡片式设置面板（Obsidian 集成/存储路径/下拉分类），支持自定义分类和模板编辑 |
| 🦅 **变量输入 / 多重文本切换** | `🦅 Eagle Suite/文本` | 变量注入、动态多路切换、随机选择或全部拼接 |
| 🦅 **保存 / 加载文本** | `🦅 Eagle Suite/文本` | 文本文件读写 |
| 🦅 **行数统计** | `🦅 Eagle Suite/文本` | 为旧工作流保留；新工作流使用智能文本工作台 |

---

### 🖼️ 图库与媒体浏览（Gallery & Media）

在 ComfyUI 节点内直接浏览、搜索、选择媒体文件，选中后输出为 `IMAGE` 或 `VIDEO` 张量。

| 节点 | 类别菜单 | 说明 |
|------|----------|------|
| 🦅 **Eagle Gallery** | `🦅 Eagle Suite/画廊` | 浏览本地 Eagle 素材库，支持文件夹树筛选、关键词搜索、星级/比例/标签过滤及跨文件夹全局选择 |
| 🌊 **Wallhaven Gallery** | `🦅 Eagle Suite/画廊` | 浏览 Wallhaven 在线壁纸库，支持分类、纯度、排序筛选 |
| 🧬 **LoRA Gallery** | `🦅 Eagle Suite/画廊` | 在节点内浏览并加载本地 LoRA，管理多层模型树、权重、触发词、预览图和 Civitai 信息 |
| 🦅 **统一媒体浏览器** | `🦅 Eagle Suite/媒体` | 浏览本地图片/视频，支持递归、比例筛选与顺序/随机批次输出 |

- LoRA 已选列表直接集成启用/忽略状态：点击状态即可切换，忽略的 LoRA 保留配置但不会应用到模型；删除使用列表内紧凑 `×`，减少节点空间占用。
- LoRA、Eagle、Wallhaven、Danbooru 与导演台等 Vue 节点统一使用共享主题变量：ComfyUI 默认主题下呈现深蓝色系，其他自定义主题下继承宿主背景、文字和边框色，避免主题切换后割裂。

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
| 🦅 **媒体剪辑台** | `🦅 Eagle Suite/视频` | 节点内拖拽多段视频与双音轨，完成裁剪、切分、顺序拼接、原声控制、混音、锁定比例缩放，并按需输出原生 `VIDEO`、`IMAGE` 帧序列和 `AUDIO` |
| 🦅 **视频信息** | `🦅 Eagle Suite/视频` | 获取时长、帧率、分辨率和编码信息 |
| 🦅 **GIF 压缩保存** | `🦅 Eagle Suite/视频` | 支持尺寸缩放、减色、抽帧加速、帧时长与可选 gifsicle 优化，在画质和体积之间进行可控压缩 |
| 🦅 **音频提取 / 混音 / 浏览器** | `🦅 Eagle Suite/音频` | 从视频提取音频轨道、多轨道音频混合与本地音频库浏览 |

- **媒体剪辑台**采用 V1 顺序视频轨与 A1/A2 独立音频轨：支持把本机媒体拖入节点、调整片段入点/出点与音量/淡入淡出、在播放头切分、复制/删除/重排视频片段，并把工程完整保存进工作流。渲染由本地 FFmpeg 完成；“原声分离”指提取和独立控制视频自带音轨，并非 AI 人声/伴奏分轨。详见 [媒体剪辑台说明](docs/MEDIA_TIMELINE_EDITOR.md)。

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

## 🔒 本地媒体与凭据安全配置

- 媒体浏览 HTTP 接口默认只允许 ComfyUI 的 `input`、`output`、`temp`，以及设置中的 `EagleFileTools.image_path` / `EagleFileTools.audio_path`。额外媒体根目录可通过环境变量 `EAGLE_MEDIA_ROOTS` 添加；Windows 下用分号分隔多个目录。
- 提示词预设额外扫描根目录使用 `EAGLE_PROMPT_ROOTS`；Obsidian API 默认只允许本机地址，额外可信主机使用 `EAGLE_OBSIDIAN_HOSTS`（逗号分隔）。
- 本地 LLM 服务默认只允许环回地址；额外可信主机使用 `EAGLE_LOCAL_LLM_HOSTS`（逗号分隔）。
- API 密钥不会返回浏览器或写入工作流/localStorage。Windows 优先保存到系统凭据库；不可用时使用当前用户目录中的独立随机密钥加密。旧 `ENC:` 配置在下次保存时自动迁移。
- 批量视频帧默认同时受 `2048` 帧和约 `1024 MiB` 内存预算限制；可用 `EAGLE_MAX_BATCH_VIDEO_FRAMES`、`EAGLE_MAX_BATCH_VIDEO_MB` 调整。

---

## 📁 项目结构

```
ComfyUI_Eagle_Suite/
├── eagle_suite/              # 核心节点主包
│   ├── nodes.py              # 节点注册与菜单分配唯一入口
│   ├── h3_director_node.py      # H3 导演台控制中心节点
│   ├── h3_pipeline/             # H3 四节点原生循环、上下文、审片、恢复与合成
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
│   ├── workflow_metadata.py  # 工作流元数据提取、嵌入与旁车 JSON
│   └── text_nodes.py         # 字符串工具节点集合
├── nodes/                    # 工具后端
│   ├── prompt_presets.py     # 提示词预设 & 导演技能库数据后端
│   ├── audio_browser.py      # 音频浏览器
│   ├── string_tools.py       # 字符串辅助工具
│   └── prompts/              # 预设模板与导演技能存储目录
│       └── director_skills/  # 导演技能文档 (skills.json) 与素材胶片
├── web/                      # 前端 Vue 3 资源
│   ├── js/                   # Vue 节点脚本、H3 流水线前端与共享深蓝主题
│   └── lib/                  # Vue 3 等内置第三方前端库
├── example_workflows/        # 可直接导入的完整工作流示例
├── docs/                     # H3 架构、Context Loop 对齐与生成质量评估
├── api_config.example.json   # 可提交的空白 API 配置示例
├── api_config.json           # 本地 API 配置（自动生成，Git 忽略）
├── requirements.txt          # Python 依赖
└── README.md                 # 本说明文档
```

---

## 📝 更新日志

### v1.5.0-dev (2026-08-31)
- ✨ **H3 端口互操作层**：`plan` 保持公共 `H3_CHAIN_PLAN`；计划 JSON、状态/上一片段使用专用桥，媒体统一由一个双向“标准媒体桥”接入。参考图片与视频帧批次均为 `IMAGE`，但采用明确端口名；音频使用 `AUDIO`，素材映射使用 `STRING`。Eagle 的检查点 state 与递归 flow 继续使用严格私有类型，避免只因颜色相同而产生假兼容。
- ✨ **H3 节点重新归并**：将原本零散的计划、上下文、裁剪、检查点、审片、推进与合成功能收敛为 4 个核心承接节点，并支持在导演台右键一键创建主链。
- ✨ **原生循环与恢复**：自动模式使用 ComfyUI 动态图递归推进全部场景；交互模式支持逐镜审片、重试、换种、停止、检查点恢复与最终合成。
- ✨ **导演台生成对齐**：全部场景批量生成按实际场景数执行，台本 → 分镜 → 台词严格串联；场景时长、参考素材及原子标签与输出 Plan 一致。
- ✨ **MiniMax H3 语言规范**：生成页可切换 English/中文画面模板，并独立选择台词文本语言；原生 `<Picture N>/<Video N>/<Audio N>` 与官方运镜命令保持不可拆分。
- ✨ **Context Loop Plan JSON**：导演台保留 `context_loop_plan_json` 开放输出，供需要时手动接入第三方 Plan；Eagle 不再自动插入或创建 Context Loop 跳接节点。
- ✨ **最终整片双保存**：循环结束节点仅在全部镜头通过后合成，可将最终视频额外复制到本地目录，并导入指定 Eagle 文件夹；分段检查点不会重复导入 Eagle。
- ✨ **统一 Vue 深蓝主题**：默认 ComfyUI 主题下统一使用 Eagle 深蓝视觉，自定义主题下自动继承宿主颜色变量。
- ✨ **媒体工具增强**：GIF 压缩增加尺寸、减色和抽帧控制；LoRA 已选项支持列表内启用/忽略；视频、音频与批处理节点补齐元数据和稳定性处理。
- 📦 新增可直接导入的 `example_workflows/eagle_h3_full_workflow.json`、H3 架构文档和自动化回归测试。

### v1.4.0-stable (2026-08-25)
- ✨ **新增 H3 导演台 & 导演技能库**：MiniMax H3 / 海螺 AI 专属控制台，支持场景分镜动作分解、提示词编译与 ethanfel Plan 格式导出；导演技能库支持 Markdown 编辑、胶片拖拽、多路径管理及 JSON 导入/导出。
- ✨ **Danbooru 标签搜索升级**：集成 BGE-M3 语义向量搜索，支持 `models/text_encoders/bge-m3` 或 `models/LLM/bge-m3` 本地路径离线部署与全自动下载。
- ✨ **提示词预设 UI 重构**：三卡片设置面板（Obsidian/存储路径/分类）、详情页指令模板 `<textarea>` 内联编辑失焦自存、54px 紧凑封面排版。

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
