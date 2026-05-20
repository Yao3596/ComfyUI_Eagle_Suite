# 🦅 Eagle API 统一节点 - 使用说明

## 简介

**EagleAPIUnifiedNode** 是一个支持 **OpenAI 兼容接口** 的统一 API 调用节点，可用于：

- 💬 纯文本对话
- 🖼️ 图像分析（Vision / 多模态理解）

支持通过 **API Key 节点** 或 **API 配置加载器** 灵活管理认证信息。

---

## 快速开始

### 1. 基础设置（三选一）

#### 方式 A：直接输入（简单场景）

在 `API 多功能调用` 节点中直接填写：

| 参数 | 说明 | 示例 |
|------|------|------|
| `api_key` | 你的 API Key | `sk-xxxxxxxx` |
| `base_url` | API 基础地址 | `https://api.openai.com/v1` |
| `model` | 模型名称 | `gpt-4o`, `qwen-vl-max` |

#### 方式 B：API Key 节点（推荐）

将 `🦅 API Key Input` 节点连接到 `api_key` 输入端口，便于复用和管理。

#### 方式 C：API 配置加载器（高级）

使用 `🦅 API 配置加载器` 加载预设的配置文件，支持多配置切换。

---

### 2. URL 格式说明

支持多种 URL 格式，节点会自动补全：

| 输入 | 实际请求地址 |
|------|-------------|
| `https://api.example.com` | `https://api.example.com/v1/chat/completions` |
| `https://api.example.com/` | `https://api.example.com/v1/chat/completions` |
| `https://api.example.com/v1` | `https://api.example.com/v1/chat/completions` |
| `https://api.example.com/v1/` | `https://api.example.com/v1/chat/completions` |

---

## 使用模式

### 💬 文本对话模式

1. 不连接 `image` 输入端口
2. 在 `user_prompt` 中输入问题或指令
3. 点击运行，节点输出文本回复

**适用场景：** 提示词优化、文本生成、代码辅助、翻译等。

---

### 🖼️ 图像分析模式（Vision）

1. 将图像节点（如 `Load Image`）连接到 `image` 输入端口
2. 在 `user_prompt` 中输入分析要求（可选，默认为"描述这张图片"）
3. 点击运行，节点返回对图片的描述或分析

**适用场景：**
- 自动提取图片内容描述作为提示词
- 分析图像构图、风格、色彩
- 图生图工作流中的自动反推

**支持的模型：**
- OpenAI: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`
- 阿里云百炼: `qwen-vl-max`, `qwen-vl-plus`
- 智谱 AI: `glm-4v`
- 其他支持 OpenAI Vision 格式的模型

---

## 兼容的 API 提供商

任何支持 OpenAI Chat Completions 格式的 API 均可使用：

| 提供商 | 示例 base_url | 代表模型 |
|--------|--------------|---------|
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4o-mini` |
| **Azure OpenAI** | `https://your-resource.openai.azure.com/openai/deployments/your-deployment` | `gpt-4o` |
| **阿里云百炼** | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-vl-max` |
| **智谱 AI** | `https://open.bigmodel.cn/api/paas/v4` | `glm-4v` |
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat` |
| **自定义接口** | 任意兼容地址 | 任意兼容模型 |

---

## 参数详解

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `api_key` | STRING | 是 | API 认证密钥 |
| `base_url` | STRING | 是 | API 服务基础地址 |
| `model` | STRING | 是 | 模型标识符 |
| `user_prompt` | STRING | 是 | 用户输入的提示词 |
| `image` | IMAGE | 否 | 输入图像（用于 Vision 模式） |
| `system_prompt` | STRING | 否 | 系统提示词（控制 AI 行为） |
| `temperature` | FLOAT | 否 | 采样温度（默认 0.7） |
| `max_tokens` | INT | 否 | 最大生成 token 数 |

---

## 输出

| 输出 | 类型 | 说明 |
|------|------|------|
| `text` | STRING | AI 返回的文本内容 |
| `full_response` | STRING | 完整的 API 原始响应（JSON） |

---

## 调试信息

运行时会在 ComfyUI 控制台输出详细日志：

```
[EagleAPI] ========== 开始处理 ==========
[EagleAPI] 最终 API URL: https://api.xxx.com/v1
[EagleAPI] 模型: gpt-4o
[EagleAPI] 图像输入: 有/无
[EagleAPI] 请求 URL: https://api.xxx.com/v1/chat/completions
[EagleAPI] 响应状态: 200
[EagleAPI] 响应内容: {...}
[EagleAPI] ========== 处理完成 ==========
```

---

## 常见问题

### Q: 显示 "连接失败"
- 检查 `base_url` 是否正确（注意是否需要 `/v1` 后缀）
- 确保 URL 可以访问，尝试在浏览器中打开
- 检查网络连接，确认没有代理或防火墙拦截

### Q: 显示 "API Key 无效 (401)"
- 检查 `api_key` 是否正确（注意是否有多余空格）
- 确认 Key 没有过期
- 确认 Key 有权限调用该模型（部分 Key 仅限特定模型）

### Q: 显示 "API 端点不存在 (404)"
- 检查 `base_url` 是否指向正确的 API 地址
- 确认 `/v1/chat/completions` 端点在该服务上存在
- 某些服务使用不同的路径，请查阅对应文档

### Q: 图像编码失败
- 检查图像输入是否正常（图像尺寸是否过大）
- 确保图像是 RGB/RGBA 格式
- 尝试降低图像分辨率后重新输入

### Q: Vision 模式没有分析图像
- 确认连接的模型支持 Vision（多模态）
- 检查 `image` 输入端口是否已正确连接
- 查看控制台日志确认图像是否被正确编码

---

## 安全提示

⚠️ **API Key 安全**
- 不要在公开分享的工作流中硬编码 API Key
- 使用 `🦅 API Key Input` 节点单独管理 Key
- 使用 `🦅 API 配置加载器` 将配置保存在本地安全位置
- 本插件的 `.gitignore` 已排除敏感配置文件，提交代码时不会泄露

---

## 进阶技巧

### 批量图像反推
将 `Load Image` → `🦅 API 多功能调用(Vision)` → `Save Text` 串联，配合 `Batch` 节点可实现批量图像反推提示词。

### 动态系统提示
通过 `system_prompt` 参数控制 AI 的输出风格：
- `"你是一个专业的 Stable Diffusion 提示词工程师"` — 优化提示词
- `"请用一句话描述图片的主要内容和风格"` — 简洁描述
- `"请分析图片的构图、光影、色彩运用"` — 专业分析
