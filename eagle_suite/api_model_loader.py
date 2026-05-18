# -*- coding: utf-8 -*-
"""
Eagle Suite API 统一节点（安全版 v4.1）
迁移自 nodes/api_model_loader.py
- history 输出过滤 system 消息和图像 base64
- API Key 不进入任何输出字段
- 内部消息与输出历史分离
"""

import os
import json
import base64
import io
import uuid
import time
import requests
import torch
import numpy as np
from PIL import Image

# ── 配置文件路径 ──────────────────────────────────────────
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "api_config.json")
MACHINE_ID_PATH = os.path.join(os.path.dirname(__file__), "..", "machine_id.txt")

# ── 系统提示词模板 ─────────────────────────────────────────
SYSTEM_TEMPLATES = {
    "default": "You are a helpful assistant.",
    "creative": "You are a creative assistant with vivid imagination. Provide detailed and engaging descriptions.",
    "technical": "You are a technical expert. Provide accurate, detailed technical analysis and explanations.",
    "concise": "You are a concise assistant. Provide brief, to-the-point answers.",
    "image_expert": "You are an image analysis expert. Describe images in detail.",
    "translator": "You are a professional translator. Translate accurately while preserving tone and context.",
    "coder": "You are an expert programmer. Provide clean, efficient code with explanations.",
}

# ── 配置读写 ──────────────────────────────────────────────────

def _load_config() -> dict:
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _save_config(config: dict) -> None:
    try:
        os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[EagleAPI] 保存配置失败: {e}")


def _load_saved_key() -> str:
    return _load_config().get("api_key", "")


def _load_saved_base_url() -> str:
    return _load_config().get("base_url", "")


def _load_saved_model() -> str:
    return _load_config().get("model", "")


def _save_api_config(api_key: str = None, base_url: str = None, model: str = None) -> None:
    config = _load_config()
    if api_key is not None:
        config["api_key"] = api_key.strip()
    if base_url is not None:
        config["base_url"] = base_url.strip()
    if model is not None:
        config["model"] = model.strip()
    _save_config(config)


# ── 本机识别 ─────────────────────────────────────────────────

def _get_machine_id() -> str:
    try:
        if os.path.exists(MACHINE_ID_PATH):
            with open(MACHINE_ID_PATH, "r", encoding="utf-8") as f:
                mid = f.read().strip()
                if mid:
                    return mid
    except Exception:
        pass
    mid = str(uuid.uuid4())
    try:
        os.makedirs(os.path.dirname(MACHINE_ID_PATH), exist_ok=True)
        with open(MACHINE_ID_PATH, "w", encoding="utf-8") as f:
            f.write(mid)
    except Exception as e:
        print(f"[EagleAPI] 保存机器 ID 失败: {e}")
    return mid


_get_machine_id()


# ── 对话历史序列化（安全版）──────────────────────────────────

def _serialize_history(messages: list) -> str:
    """
    序列化对话历史，过滤以下内容避免泄露：
    - system 消息（含系统提示词）
    - 图像 base64 数据（体积大且无需持久化）
    只保留 user 文本和 assistant 回复
    """
    safe_messages = []
    for msg in messages:
        role = msg.get("role", "")
        if role == "system":
            continue

        content = msg.get("content", "")

        if isinstance(content, list):
            text_parts = [
                part.get("text", "")
                for part in content
                if isinstance(part, dict) and part.get("type") == "text"
            ]
            safe_content = " ".join(text_parts).strip()
            if not safe_content:
                continue
        else:
            safe_content = str(content)

        safe_messages.append({"role": role, "content": safe_content})

    return json.dumps(safe_messages, ensure_ascii=False)


def _deserialize_history(history_str: str) -> list:
    """反序列化对话历史，只接受合法的 user/assistant 文本消息"""
    if not history_str.strip():
        return []
    try:
        messages = json.loads(history_str.strip())
        if not isinstance(messages, list):
            return []
        valid_roles = {"user", "assistant"}
        return [
            m for m in messages
            if isinstance(m, dict)
            and m.get("role") in valid_roles
            and isinstance(m.get("content", ""), str)
        ]
    except Exception as e:
        print(f"[EagleAPI] 历史解析失败: {e}")
        return []


# ── 工具函数 ──────────────────────────────────────────────────

def tensor2pil(image):
    batch_count = image.size(0) if len(image.shape) > 3 else 1
    if batch_count > 1:
        out = []
        for i in range(batch_count):
            out.extend(tensor2pil(image[i]))
        return out
    numpy_image = np.clip(255.0 * image.cpu().numpy().squeeze(), 0, 255).astype(np.uint8)
    return [Image.fromarray(numpy_image)]


def _tensor_to_base64(img_tensor, max_size=2048, quality=90, batch_mode="first") -> list:
    """将图像 tensor 转为 base64 列表"""
    try:
        if not isinstance(img_tensor, torch.Tensor):
            return []
        pil_images = tensor2pil(img_tensor)
        if not pil_images:
            return []
        if batch_mode == "first":
            pil_images = [pil_images[0]]

        results = []
        for idx, pil_image in enumerate(pil_images):
            try:
                w, h = pil_image.size
                if max(h, w) > max_size:
                    ratio = max_size / max(h, w)
                    pil_image = pil_image.resize(
                        (int(w * ratio), int(h * ratio)), Image.LANCZOS
                    )
                if pil_image.mode != 'RGB':
                    pil_image = pil_image.convert('RGB')
                buf = io.BytesIO()
                pil_image.save(buf, format="JPEG", quality=quality, optimize=True)
                results.append(base64.b64encode(buf.getvalue()).decode("utf-8"))
            except Exception as e:
                print(f"[EagleAPI] 帧 {idx} 编码失败: {e}")
        return results
    except Exception as e:
        print(f"[EagleAPI] 图像编码失败: {e}")
        return []


def _normalize_url(url: str) -> str:
    url = url.strip().rstrip("/")
    if "/deployments/" in url or "/openai/deployments/" in url:
        return url
    if url.endswith("/chat/completions"):
        url = url.replace("/chat/completions", "")
    if not url.endswith("/v1"):
        url = url + "/v1"
    return url


# ── API 请求基类 ───────────────────────────────────────────────

class _BaseAPI:
    def __init__(self, timeout=120):
        self.timeout = timeout

    def _request(self, url: str, headers: dict, payload: dict) -> tuple:
        try:
            print(f"[EagleAPI] 请求 URL: {url}")
            print(f"[EagleAPI] 模型: {payload.get('model', 'unknown')}")
            print(f"[EagleAPI] 消息数: {len(payload.get('messages', []))}")

            start_time = time.time()
            resp = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
            elapsed = time.time() - start_time
            print(f"[EagleAPI] 响应状态: {resp.status_code} | 耗时: {elapsed:.2f}s")

            if resp.status_code == 200:
                content_type = resp.headers.get('Content-Type', '')
                is_stream = 'text/event-stream' in content_type or payload.get('stream', False)
                if is_stream:
                    return self._parse_stream_response(resp, elapsed)
                try:
                    data = resp.json()
                    if "error" in data:
                        msg = data["error"].get("message", str(data["error"])) if isinstance(data["error"], dict) else str(data["error"])
                        return False, None, msg, elapsed
                    return True, data, "", elapsed
                except Exception as e:
                    return False, None, f"解析响应 JSON 失败: {e}", elapsed
            elif resp.status_code == 401:
                return False, None, "API Key 无效或已过期 (401)", elapsed
            elif resp.status_code == 404:
                return False, None, "API 端点不存在 (404)", elapsed
            elif resp.status_code == 429:
                return False, None, "请求过于频繁 (429)", elapsed
            else:
                error_text = resp.text[:500] if resp.text else "无错误详情"
                return False, None, f"HTTP {resp.status_code}: {error_text}", elapsed

        except requests.exceptions.Timeout:
            return False, None, f"请求超时 ({self.timeout}秒)", 0
        except requests.exceptions.ConnectionError as e:
            return False, None, f"连接失败: {str(e)[:100]}", 0
        except Exception as e:
            return False, None, f"请求异常: {str(e)}", 0

    def _parse_stream_response(self, resp, elapsed) -> tuple:
        try:
            answer_parts = []
            for line in resp.iter_lines(decode_unicode=True):
                if not line:
                    continue
                line = line.strip()
                if not line.startswith("data: "):
                    continue
                data_str = line[6:]
                if data_str == "[DONE]":
                    break
                try:
                    data = json.loads(data_str)
                    if "choices" in data and data["choices"]:
                        delta = data["choices"][0].get("delta", {})
                        if isinstance(delta, dict):
                            content = delta.get("content", "")
                            if content:
                                answer_parts.append(content)
                except json.JSONDecodeError:
                    continue

            full_content = "".join(answer_parts).strip()
            if full_content:
                return True, {
                    "choices": [{"message": {"role": "assistant", "content": full_content}, "finish_reason": "stop"}],
                    "usage": {}
                }, "", elapsed
            return False, None, "流式响应为空", elapsed
        except Exception as e:
            return False, None, f"解析流式响应失败: {e}", elapsed


# ── 统一节点 ──────────────────────────────────────────────────

class EagleAPIUnifiedNode(_BaseAPI):
    """
    🦅 API 统一节点（安全版 v4.1）
    - history 输出只含 user/assistant 文本，不含 system 和图像
    - API Key 不进入任何输出字段
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "api_config_key": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "输入 API Key（留空使用已保存）"
                }),
                "api_config_url": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "如 https://api.openai.com/v1（留空使用已保存）"
                }),
                "api_config_model": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "如 gpt-4o, qwen-vl-max（留空使用已保存）"
                }),
                "system_template": (["custom"] + list(SYSTEM_TEMPLATES.keys()), {
                    "default": "default"
                }),
                "system_prompt": ("STRING", {
                    "default": "You are a helpful assistant.",
                    "multiline": True,
                    "placeholder": "系统提示词（选 custom 时生效）"
                }),
                "user_prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "placeholder": "输入问题或图片分析要求"
                }),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.1}),
                "max_tokens": ("INT", {"default": 4096, "min": 1, "max": 128000, "step": 1}),
                "seed": ("INT", {"default": -1, "min": -1, "max": 2147483647, "step": 1}),
                "top_p": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.1}),
                "response_format": (["text", "json_object"], {"default": "text"}),
                "batch_mode": (["first", "all"], {"default": "first"}),
                "timeout": ("INT", {"default": 120, "min": 10, "max": 600, "step": 10}),
            },
            "optional": {
                "api_config": ("API_CONFIG", {
                    "forceInput": True,
                    "tooltip": "API 配置总线（来自 EagleAPILoader，优先使用，覆盖上方独立字段）"
                }),
                "history": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "forceInput": True,
                    "tooltip": "对话历史（来自上一个节点的 history 输出）"
                }),
                "image_1": ("IMAGE", {"tooltip": "第1张图像（可选）"}),
                "image_2": ("IMAGE", {"tooltip": "第2张图像（可选）"}),
                "image_3": ("IMAGE", {"tooltip": "第3张图像（可选）"}),
                "image_4": ("IMAGE", {"tooltip": "第4张图像（可选）"}),
                "image_5": ("IMAGE", {"tooltip": "第5张图像（可选）"}),
                "image_6": ("IMAGE", {"tooltip": "第6张图像（可选）"}),
                "image_7": ("IMAGE", {"tooltip": "第7张图像（可选）"}),
                "image_8": ("IMAGE", {"tooltip": "第8张图像（可选）"}),
                "image_9": ("IMAGE", {"tooltip": "第9张图像（可选）"}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("输出结果", "状态信息", "对话历史")
    FUNCTION = "process"
    CATEGORY = "🦅 Eagle/API"
    OUTPUT_NODE = True

    def process(self, api_config_key, api_config_url, api_config_model,
                system_template, system_prompt, user_prompt,
                temperature, max_tokens, seed, top_p,
                response_format, batch_mode, timeout,
                api_config=None,
                history="",
                image_1=None, image_2=None, image_3=None,
                image_4=None, image_5=None, image_6=None,
                image_7=None, image_8=None, image_9=None):

        print(f"\n[EagleAPI] ========== 开始处理 ==========")
        self.timeout = timeout

        # ── API 配置解析（优先 api_config 复合端口）─────────────
        if api_config is not None:
            # api_config 是三元组 (api_key, base_url, model)
            try:
                cfg_key, cfg_url, cfg_model = api_config
                api_config_key = cfg_key
                api_config_url = cfg_url
                api_config_model = cfg_model
                print(f"[EagleAPI] 使用 api_config 复合端口: model={cfg_model}")
            except Exception as e:
                return ("", f"❌ api_config 格式错误: {e}", "")

        # ── 参数校验（留空时从 api_config.json 读取已保存值）──────
        key = api_config_key.strip() or _load_saved_key()
        if not key:
            # api_config 错误时 base_url 可能包含错误消息
            err_hint = api_config_url.strip() if api_config_url and api_config_url.startswith("❌") else ""
            msg = err_hint or "❌ 请输入 API Key（或连接 api_config 端口）"
            return ("", msg, "")

        url = _normalize_url(api_config_url.strip() or _load_saved_base_url())
        if not url:
            return ("", "❌ 请输入 API 地址（或连接 api_config 端口）", "")

        mdl = api_config_model.strip() or _load_saved_model()
        if not mdl:
            return ("", "❌ 请输入模型名称（或连接 api_config 端口）", "")

        # 三个字段统一保存到 api_config.json
        _save_api_config(api_key=key, base_url=url, model=mdl)

        # ── 系统提示词 ──────────────────────────────────────────────
        if system_template != "custom" and system_template in SYSTEM_TEMPLATES:
            final_system_prompt = SYSTEM_TEMPLATES[system_template]
        else:
            final_system_prompt = system_prompt.strip()

        # ── 加载对话历史（只含 user/assistant 文本）────────────────
        history_messages = _deserialize_history(history)
        print(f"[EagleAPI] 加载历史消息: {len(history_messages)} 条")

        # ── 构建发送给 API 的完整消息（内部用，不输出）────────────
        api_messages = []
        if final_system_prompt:
            api_messages.append({"role": "system", "content": final_system_prompt})
        api_messages.extend(history_messages)

        # ── 收集图像 ────────────────────────────────────────────────
        raw_inputs = [image_1, image_2, image_3, image_4, image_5,
                      image_6, image_7, image_8, image_9]
        image_tensors = [
            (f"图像 {i+1}", img)
            for i, img in enumerate(raw_inputs)
            if img is not None
        ]
        print(f"[EagleAPI] 图像输入: {len(image_tensors)} 张 | 批次模式: {batch_mode}")

        # ── 构建当前用户消息 ────────────────────────────────────────
        failed_images = []
        total_frames = 0

        if image_tensors:
            content = []
            for img_name, img_tensor in image_tensors:
                b64_list = _tensor_to_base64(img_tensor, batch_mode=batch_mode)
                if not b64_list:
                    failed_images.append(img_name)
                    print(f"[EagleAPI] ⚠️ {img_name} 编码失败，已跳过")
                    continue
                for b64 in b64_list:
                    content.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}"}
                    })
                    total_frames += 1

            if not content:
                return ("", "❌ 所有图像编码失败", _serialize_history(history_messages))

            prompt_text = user_prompt.strip() or (
                f"描述这 {total_frames} 张图片" if total_frames > 1 else "描述这张图片"
            )
            content.append({"type": "text", "text": prompt_text})
            current_user_msg = {"role": "user", "content": content}
        else:
            prompt_text = user_prompt.strip()
            if not prompt_text:
                return ("", "❌ 请输入提示词", _serialize_history(history_messages))
            current_user_msg = {"role": "user", "content": prompt_text}

        api_messages.append(current_user_msg)

        # ── 发送请求 ────────────────────────────────────────────────
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        payload = {
            "model": mdl,
            "messages": api_messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "stream": False,
        }
        if seed >= 0:
            payload["seed"] = seed
        if response_format == "json_object":
            payload["response_format"] = {"type": "json_object"}

        ok, data, err, elapsed = self._request(f"{url}/chat/completions", headers, payload)
        if not ok:
            return ("", f"❌ {err}", _serialize_history(history_messages))

        # ── 解析响应 ────────────────────────────────────────────────
        try:
            choices = data.get("choices", [])
            if not choices:
                return ("", "⚠️ API 返回空 choices", _serialize_history(history_messages))

            message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
            text = message.get("content", "").strip() if isinstance(message, dict) else ""
            if not text:
                return ("", "⚠️ API 返回空内容", _serialize_history(history_messages))

            # ── 更新 history（只存文本，不含 system 和图像）──────────
            updated_history = history_messages + [
                {"role": "user", "content": prompt_text},
                {"role": "assistant", "content": text},
            ]
            new_history = _serialize_history(updated_history)

            # ── 构建状态信息 ─────────────────────────────────────────
            usage = data.get("usage", {}) or {}
            prompt_tokens = usage.get('prompt_tokens', 0)
            completion_tokens = usage.get('completion_tokens', 0)

            mode_icon = "🖼️" if image_tensors else "📝"
            mode_text = f"{len(image_tensors)}图" if image_tensors else "文本"
            if image_tensors and batch_mode == "all":
                mode_text += f"({total_frames}帧)"

            truncated = (
                f" ⚠️ 输出可能被截断（max_tokens={max_tokens}）"
                if completion_tokens and completion_tokens >= max_tokens * 0.95
                else ""
            )
            failed_note = f" | ⚠️ {len(failed_images)}图失败" if failed_images else ""

            status = (
                f"✅ {mode_icon} {mode_text} | "
                f"{prompt_tokens}→{completion_tokens} tokens | "
                f"{elapsed:.2f}s{failed_note}{truncated}"
            )

            print(f"[EagleAPI] 完成，输出: {len(text)} 字符")
            print(f"[EagleAPI] ========== 处理结束 ==========\n")
            return (text, status, new_history)

        except Exception as e:
            import traceback
            traceback.print_exc()
            return ("", f"❌ 解析响应失败: {e}", _serialize_history(history_messages))


__all__ = ["EagleAPIUnifiedNode"]
