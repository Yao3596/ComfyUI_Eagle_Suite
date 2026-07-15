# 🦅 Eagle API 统一节点 - 使用说明

## 简介

**EagleAPIUnifiedNode（🦅 API 多功能调用）** 支持 OpenAI 兼容接口：
- 文本对话
- Vision 图像分析（最多 9 张图）
- 多轮对话（通过 `history` 串联）

## 快速开始

### 1. 配置 API（三选一）

| 方式 | 说明 |
|------|------|
| 直接输入 | 在节点中填写 `api_config_key` / `api_config_url` / `api_config_model` |
| API Key 节点 | 使用 `🦅 API Key Input` 输出到 `api_config_key` |
| API 配置加载器（推荐） | 使用 `🦅 API 配置加载器` 的 `api_config` 复合端口连入 |

### 2. URL 格式

节点会自动补全为 `/v1/chat/completions`：

```
https://api.example.com       → https://api.example.com/v1/chat/completions
https://api.example.com/v1    → https://api.example.com/v1/chat/completions
```

## 配置文件

| 文件 | 作用 |
|------|------|
| `api_config.json` | 保存最后一次使用的 key/url/model |
| `api_profiles.json` | 保存多组命名 profile |

`api_profiles.json` 示例：

```json
{
  "gpt-4o": {
    "api_key": "sk-xxx",
    "base_url": "https://api.openai.com/v1",
    "model": "gpt-4o"
  }
}
```

## 使用模式

### 文本对话
- 不连接图像
- 填写 `user_prompt`
- 输出 `输出结果`

### Vision 图像分析
- 将图像连接到 `image_1` ~ `image_9`
- 填写分析要求
- 输出 `输出结果`

### 多轮对话
- 将上一个节点的 `对话历史` 输出连接到下一个节点的 `history` 输入

## 主要参数

| 参数 | 说明 |
|------|------|
| `api_config_key` | API Key |
| `api_config_url` | API 基础地址 |
| `api_config_model` | 模型名称 |
| `system_template` | 系统提示词模板 |
| `system_prompt` | 自定义系统提示词（`custom` 时生效） |
| `user_prompt` | 用户提示词 |
| `prompt_model_type` | 输出格式：自然语言 / SDXL / SD3 / FLUX 等 |
| `filter_intro` | 过滤模型开头自我介绍 |
| `temperature` | 采样温度 |
| `max_tokens` | 最大 token 数 |
| `max_image_size` | 输入图像最大边尺寸 |
| `batch_mode` | `first` 只处理第一帧 / `all` 处理所有帧 |
| `timeout` | 请求超时 |

## 输出

| 输出 | 说明 |
|------|------|
| `输出结果` | AI 返回文本 |
| `状态信息` | tokens、耗时、状态摘要 |
| `对话历史` | user/assistant 历史（不含 system 和图像） |
| `输出图像` | 当返回 Markdown/base64 图片时输出 IMAGE |

## 本地大模型节点

| 节点 | 说明 |
|------|------|
| 🦅 **本地大模型反推** | 直接加载 `models/LLM` 中的 transformers 模型 |
| 🦅 **本地大模型服务** | 调用本地 OpenAI 兼容服务 |

模型放置路径：
- `ComfyUI/models/LLM/`
- `ComfyUI/models/text_encoders/`

## 常见问题

- **API Key 无效**：检查 key 是否正确、是否过期
- **连接失败**：检查 `api_config_url` 和网络
- **Vision 不分析图像**：确认模型支持 Vision，且图像端口已连接
- **多轮对话不继承**：确认 `对话历史` 已连到 `history` 端口
