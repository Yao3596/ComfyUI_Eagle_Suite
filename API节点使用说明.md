# 🦅 Eagle API 统一节点 - 使用说明

## 简介

支持 **OpenAI 兼容接口** 的统一 API 节点，可用于：
- 纯文本对话
- 图像分析（Vision）

## 使用方法

### 1. 基础设置

在节点中填写三个必填项：

| 参数 | 说明 | 示例 |
|------|------|------|
| `api_key` | 你的 API Key | `sk-xxxxxxxx` |
| `base_url` | API 基础地址 | `https://api.openai.com/v1` |
| `model` | 模型名称 | `gpt-4o`, `qwen-vl-max` |

### 2. URL 格式说明

支持多种 URL 格式，节点会自动处理：
- ✅ `https://api.example.com`
- ✅ `https://api.example.com/`
- ✅ `https://api.example.com/v1`
- ✅ `https://api.example.com/v1/`

### 3. 文本对话模式

1. 不连接 `image` 输入
2. 在 `user_prompt` 中输入问题
3. 点击运行

### 4. 图像分析模式

1. 将图像节点连接到 `image` 输入
2. 在 `user_prompt` 中输入分析要求（可选，默认为"描述这张图片"）
3. 点击运行

## 兼容的 API 提供商

任何支持 OpenAI 格式的 API 都可以使用：

- OpenAI (gpt-4o, gpt-4o-mini)
- Azure OpenAI
- 阿里云百炼 (qwen-vl-max)
- 智谱 AI (glm-4v)
- 其他兼容接口

## 调试信息

运行时会在 ComfyUI 控制台输出详细日志：
```
[EagleAPI] ========== 开始处理 ==========
[EagleAPI] 最终 API URL: https://api.xxx.com/v1
[EagleAPI] 模型: gpt-4o
[EagleAPI] 图像输入: 有/无
[EagleAPI] 请求 URL: https://api.xxx.com/v1/chat/completions
[EagleAPI] 响应状态: 200
...
```

## 常见问题

### Q: 显示 "连接失败"
- 检查 `base_url` 是否正确
- 确保 URL 可以访问
- 检查网络连接

### Q: 显示 "API Key 无效 (401)"
- 检查 `api_key` 是否正确
- 确认 Key 没有过期
- 确认 Key 有权限调用该模型

### Q: 显示 "API 端点不存在 (404)"
- 检查 `base_url` 是否指向正确的 API 地址
- 确认 `/v1/chat/completions` 端点存在

### Q: 图像编码失败
- 检查图像输入是否正常
- 确保图像是 RGB/RGBA 格式
