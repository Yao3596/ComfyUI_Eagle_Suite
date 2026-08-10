# 🦅 Eagle API 节点使用说明

## 节点概览

| 节点 | 用途 |
|------|------|
| 🦅 **API 配置加载器** | 在一个 `api_config.json` 中添加、编辑、删除并选择全部 API 模型 |
| 🦅 **API 多功能调用** | OpenAI 兼容的文本对话、Vision 图像分析和多轮对话 |
| 🦅 **API 生图** | OpenAI Images API 文生图、参考图编辑和遮罩编辑 |
| 🦅 **API Key Input** | 单独提供 API Key，兼容旧工作流 |

## 单文件配置

全部大语言模型和生图模型只使用根目录下的 `api_config.json`。每个非下划线开头的根键就是一组模型配置：

```json
{
  "_comment": "Eagle Suite API 配置文件",
  "_usage": "model_type 使用 llm 或 image",
  "gpt-4o": {
    "api_key": "ENC:Base64内容",
    "base_url": "https://api.example.com/v1",
    "model": "gpt-4o",
    "model_type": "llm"
  },
  "gpt-image-2": {
    "api_key": "ENC:Base64内容",
    "base_url": "https://api.example.com/v1",
    "model": "gpt-image-2",
    "model_type": "image"
  }
}
```

`model_type` 只使用：

- `llm`：文本模型或视觉语言模型；
- `image`：生图或图片编辑模型。

旧版单模型 `api_config.json` 会自动升级为扁平多模型格式。已知名称如 `gpt-image-*`、`dall-e-*`、`flux-*` 缺少类型时会自动识别为 `image`，其他旧配置默认按 `llm` 处理。

### 在节点中管理配置

- “加载本地配置”：重新读取 `api_config.json`；
- “添加模型配置”：选择模型类型并新增根键；
- “编辑当前模型配置”：更新当前根键的 Key、URL 和类型；
- “删除当前模型配置”：从 `api_config.json` 删除当前根键；
- “从 API 刷新模型”：读取 `/v1/models`，选择后写入同一个文件。

增、改、删采用原子写入，成功后会刷新画布中的所有 API 配置加载器。加载器还会监听 `api_config.json` 的文件版本，手动编辑文件后约 2 秒内自动刷新全部模型下拉框。下拉项始终取自文件中的非下划线根键，添加、重命名或删除模型都会同步修改同一个文件。API Key 保存为 `ENC:` Base64 混淆格式。

## 配置连接

推荐只连接一根线：

```text
API 配置加载器.api_config → API 多功能调用.api_config
API 配置加载器.api_config → API 生图.api_config
```

配置优先级：

1. 已连接的 `api_config`；
2. 调用节点内填写的 `api_config_key` / `api_config_url` / `api_config_model`；
3. `api_config.json` 的第一组配置。

配置加载器输出顺序为 `api_key`、`base_url`、`model`、`api_config`、`model_type`。原有四个输出位置保持不变。

## API 多功能调用

该节点固定使用 `/v1/chat/completions`，只接受 `model_type: llm` 的配置。连接生图配置时会返回明确提示，防止把生图请求错误发送到聊天端点。

### 文本对话

- 填写 `user_prompt`；
- 不连接图片；
- 文本从“输出结果”输出。

### Vision 图像分析

- 将图片连接到 `image_1`～`image_9`；
- 在 `user_prompt` 中填写分析要求；
- 输入图片会作为视觉消息发送，不会触发生图。

### 多轮对话

将上一次的“对话历史”连接到下一次的 `history`。

## API 生图

该节点支持 OpenAI 兼容 Images API：

- 文生图：`POST /v1/images/generations`；
- 图片编辑：`POST /v1/images/edits`；
- 支持 `b64_json` 和图片 URL 响应；
- 输出为可直接连接“保存图像”的 ComfyUI `IMAGE` 批次。

### 模式

| 模式 | 行为 |
|------|------|
| `自动` | 未连接参考图时文生图；连接参考图时图片编辑 |
| `文生图` | 始终调用 images/generations |
| `图片编辑` | 始终调用 images/edits，至少需要一张参考图 |

### 参数

| 参数 | 说明 |
|------|------|
| `prompt` | 生成或编辑指令 |
| `size` | API 自动、原图尺寸、比例预设、自定义宽高，或常用固定尺寸（含 2K/4K 横竖版） |
| `aspect_ratio` | 比例预设使用：1:1、16:9、9:16、4:3、3:4、3:2、2:3、4:5、5:4、21:9 |
| `resolution` | 比例预设的最长边级别：1K、2K、3K、4K、6K、8K；例如 4K 16:9 为 3840×2160 |
| `custom_width` / `custom_height` | 自定义最终输出宽高，64～16384，按 16 像素步进 |
| `input_resize_mode` | 参考图上传前可选不缩放、适应留边、裁剪填满或拉伸 |
| `quality` | `auto`、low、medium 或 high |
| `background` | `auto`、opaque 或 transparent |
| `output_format` | png、webp 或 jpeg；透明背景不能使用 jpeg，GPT Image 2 当前不接受 transparent |
| `batch_count` | 请求生成 1～4 张图片 |
| `image_1`～`image_4` | 图片编辑的参考图 |
| `mask` | 可选 ComfyUI MASK；白色区域作为编辑区域 |
| `timeout` | 请求超时，默认 300 秒 |

### 尺寸处理规则

- `原图尺寸`：以第一张参考图的宽高作为最终输出；未连接参考图时会提示错误；
- `比例预设`：按所选比例和 1K～8K 最长边计算最终尺寸，并对齐到 16 像素；
- `自定义宽高`：最终结果精确缩放到用户填写的宽高；
- GPT Image 2 会直接请求满足官方限制的目标尺寸。超过其原生边长、像素总量或比例限制时，节点先请求可接受的最大尺寸，再用 Lanczos 缩放到最终尺寸；
- 其他 OpenAI Images 兼容模型使用最接近方向的兼容请求尺寸，收到结果后再统一为目标尺寸；
- 参考图选择“适应留边 / 裁剪填满 / 拉伸”时，所有输入图与 MASK 会使用同一请求画布，保证图片编辑接口要求的格式和尺寸一致；
- 高分辨率批量图会占用大量内存，节点会阻止可能明显耗尽内存的“尺寸 × 批次”组合。

状态信息会同时显示“请求尺寸”和“输出尺寸”，便于判断尺寸由服务端原生生成还是由节点后处理完成。

### 输出

| 输出 | 说明 |
|------|------|
| `图像` | ComfyUI IMAGE，多个结果组成批次 |
| `状态信息` | 模式、张数、耗时、模型和 token 信息 |
| `修订提示词` | 服务商返回 `revised_prompt` 时输出 |

## URL 规范化

配置可填写域名、`/v1` 地址或完整聊天/生图端点。节点会先统一为 Base URL，再按调用类型追加端点。

```text
https://api.example.com
https://api.example.com/v1
https://api.example.com/v1/chat/completions
https://api.example.com/v1/images/generations
```

以上格式都会归一化为 `https://api.example.com/v1`。

## 凭据安全

- `api_config.json` 和备份已加入 `.gitignore`；
- `ENC:` 是编码混淆，不是真正加密；
- 不要在截图、工作流或公开仓库中暴露真实 API Key。

## 常见问题

- **Profile 下拉为空**：点击“加载本地配置”或先添加模型配置；
- **生图模型在聊天节点失败**：改连“🦅 API 生图”节点；
- **图片编辑提示缺少参考图**：连接至少一个 `IMAGE`；
- **原图尺寸报错**：该模式必须连接至少一张参考图；
- **透明背景报错**：JPEG 不支持透明；GPT Image 2 请改用 `auto` 或 `opaque`；
- **模型列表和文件不一致**：等待约 2 秒或点击“加载本地配置”；若 JSON 正在编辑或格式损坏，节点会保留原下拉列表并阻止覆盖；
- **前端仍显示旧按钮**：重启 ComfyUI 后按 `Ctrl+F5`；
- **依赖安装**：运行 `E:\ComfyUI-AKI\python\python.exe -m pip install -r requirements.txt`。
