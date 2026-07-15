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
import re
import time
import requests
import torch
import numpy as np
import urllib.request
from PIL import Image

# ── 配置文件路径 ──────────────────────────────────────────
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "api_config.json")

# ── API Key 解码（使用公共函数）───────────────
from .utils import decode_api_key as _decode_api_key
from .logger import logger

# ── 提示词模型类型格式化模板 ────────────────────────────────
PROMPT_FORMAT_TEMPLATES = {
    "自然语言": "[输出格式] 使用流畅的自然语言描述画面，像写一段场景描写文字一样，无需特别的关键词标签格式。",
    "SDXL": "[输出格式] 使用英文逗号分隔的关键词标签(tag)形式，如 'masterpiece, best quality, 1girl, blue hair, sunlight'。只输出标签列表，不要写完整句子或段落。每个标签尽量简洁，控制在3个英文单词以内。",
    "SD3": "[输出格式] 使用英文逗号分隔的关键词标签(tag)形式，可混合少量自然语言短语增强描述。保持简洁，不要写长段落。",
    "FLUX": "[输出格式] 使用详细的自然语言描述，包含场景、主体、光照、风格、构图、氛围、色彩等细节。可用英文关键词穿插增强。输出应为一段完整的描述文字，而非标签列表。",
    "Klein": "[输出格式] 使用自然语言描述，可混合英文关键词增强表达。适合通用图像生成理解即可。",
    "Qwen": "[输出格式] 自然语言描述，适合多模态大模型理解。可中英混合表达。",
    "GPT": "[输出格式] 自然语言描述，适合通用大模型理解。",
    "Gemini": "[输出格式] 自然语言描述，适合多模态大模型理解。",
}

def _format_prompt_output(text: str, model_type: str) -> str:
    """
    根据模型类型对 API 返回的文本做后置格式化。
    - SDXL / SD1.5 / SD3：尝试将自然语言段落转为逗号分隔的 tag 格式
    - 其他类型：保持原样
    """
    if not text:
        return text
    text = text.strip()

    tag_like_types = ("SDXL", "SD3")

    if model_type in tag_like_types:
        # 如果看起来已经是逗号分隔的 tag 格式（有逗号、无句号、无换行），保持原样
        has_comma = "," in text
        has_period = "." in text or "。" in text
        lines = [l for l in text.split("\n") if l.strip()]
        line_count = len(lines)
        
        if has_comma and not has_period and line_count <= 2:
            # 清理多余空格
            parts = [p.strip() for p in text.split(",") if p.strip()]
            return ", ".join(parts)

        # 否则尝试将自然语言转换为逗号分隔的 tag 格式
        # 去掉换行、句号等，转为逗号分隔
        cleaned = text.replace("\n", ", ").replace(".", ", ").replace("。", ", ")
        # 去掉常见的连接词 and 冗余
        for word in ("and", "with", "in the", "of the", "on the", "at the"):
            cleaned = cleaned.replace(f" {word} ", ", ")
        parts = [p.strip() for p in cleaned.split(",") if p.strip() and len(p.strip()) > 1]
        
        # 去重（保持顺序）
        seen = set()
        unique_parts = []
        for p in parts:
            low = p.lower()
            if low not in seen:
                seen.add(low)
                unique_parts.append(p)
        return ", ".join(unique_parts)

    return text

# ── 输出过滤：去掉模型自我介绍 ──────────────────────────────
_INTRO_PATTERNS = [
    r"^(你好|您好|嗨|Hello|Hi)[，,.。！!]?\s*[,，]?\s*我是?\s*[^.\n]{0,30}(助手|AI|模型|智能体|Agent)[^.\n]{0,40}[.。]",
    r"^(你好|您好|嗨|Hello|Hi)[，,.。！!]?\s*[,，]?\s*我是?\s*[^.\n]{0,40}[.。]",
    r"^(你好|您好|嗨|Hello|Hi)[，,.。！!]?\s*[,，]?\s*针对[^。]{0,60}[。]",
    r"^(你好|您好|嗨|Hello|Hi)[，,.。！!]?\s*[,，]?\s*[^。]{0,60}需求[^。]{0,40}[。]",
    r"^(你好|您好|嗨|Hello|Hi)[，,.。！!]?\s*[,，]?\s*[^。]{0,60}为你[^。]{0,40}[。]",
]

def _filter_intro(text: str) -> str:
    """过滤模型开头的自我介绍/问候语，保留实质内容。"""
    if not text:
        return text
    import re
    s = text.strip()
    for _ in range(3):
        changed = False
        for pat in _INTRO_PATTERNS:
            m = re.search(pat, s, flags=re.IGNORECASE)
            if m:
                s = s[m.end():].strip()
                changed = True
                break
        if not changed:
            break
    return s

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
    return _decode_api_key(_load_config().get("api_key", ""))

def _load_saved_base_url() -> str:
    return _load_config().get("base_url", "")

def _load_saved_model() -> str:
    return _load_config().get("model", "")

def _save_api_config(api_key: str = None, base_url: str = None, model: str = None) -> None:
    """只保存 API 连接三要素，不保存 prompt_model_type 等运行时参数。"""
    config = _load_config()
    if api_key is not None:
        config["api_key"] = _decode_api_key(api_key.strip())
    if base_url is not None:
        config["base_url"] = base_url.strip()
    if model is not None:
        config["model"] = model.strip()
    _save_config(config)

# ── 对话历史序列化（安全版）──────────────────────────────────

def _serialize_history(messages: list) -> str:
    """序列化对话历史，过滤 system 消息 and 图像 base64"""
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
    """反序列化对话历史"""
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
                    pil_image = pil_image.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
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
    if not url: return ""
    if "/deployments/" in url or "/openai/deployments/" in url:
        return url
    if url.endswith("/chat/completions"):
        url = url.replace("/chat/completions", "")
    if not url.endswith("/v1"):
        url = url + "/v1"
    return url


# ── 输出图像提取 ──────────────────────────────────────────────
_IMAGE_URL_PATTERNS = [
    re.compile(r'!\[.*?\]\((https?://[^\s\)]+)\)', re.IGNORECASE),
    re.compile(r'\b(https?://[^\s\)]+\.(?:png|jpg|jpeg|gif|webp|bmp))\b', re.IGNORECASE),
    re.compile(r'<img[^>]+src=["\'](https?://[^"\']+)["\']', re.IGNORECASE),
]


def _extract_image_urls(text: str) -> list:
    """从文本/Markdown 中提取图片 URL 列表（去重）。"""
    if not text:
        return []
    urls = []
    for pat in _IMAGE_URL_PATTERNS:
        for m in pat.finditer(text):
            url = m.group(1).strip()
            if url and url not in urls:
                urls.append(url)
    return urls


def _download_image(url: str, timeout: int = 30) -> Image.Image:
    """下载网络图片为 PIL RGB 图像。"""
    headers = {"User-Agent": "ComfyUI-EagleSuite/1.0"}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    img = Image.open(io.BytesIO(data))
    if img.mode != 'RGB':
        img = img.convert('RGB')
    return img


def _decode_base64_image(b64_text: str) -> Image.Image:
    """解码 base64 图片字符串为 PIL RGB 图像。"""
    data = base64.b64decode(b64_text)
    img = Image.open(io.BytesIO(data))
    if img.mode != 'RGB':
        img = img.convert('RGB')
    return img


def _extract_images_from_text(text: str) -> list:
    """从文本中提取所有图片（URL 或 base64），返回 PIL 列表。"""
    images = []
    if not text:
        return images

    # 1) Markdown 图片 / 直接 URL
    for url in _extract_image_urls(text):
        try:
            images.append(_download_image(url))
        except Exception as e:
            logger.warning(f"[EagleAPI] 下载输出图片失败 {url}: {e}")

    # 2) base64 图片（data:image/...;base64,...）
    b64_pattern = re.compile(r'data:image/[^;]+;base64,([A-Za-z0-9+/=]+)')
    for m in b64_pattern.finditer(text):
        try:
            images.append(_decode_base64_image(m.group(1)))
        except Exception as e:
            logger.warning(f"[EagleAPI] 解码 base64 图片失败: {e}")

    return images


def _pil_to_tensor(img: Image.Image) -> torch.Tensor:
    """PIL RGB -> ComfyUI IMAGE 张量 (1, H, W, 3)。"""
    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


# ── API 请求基类 ───────────────────────────────────────────────

class _BaseAPI:
    def __init__(self, timeout=120):
        self.timeout = timeout

    def _request(self, url: str, headers: dict, payload: dict) -> tuple:
        try:
            print(f"[EagleAPI] 请求 URL: {url}")
            print(f"[EagleAPI] 模型: {payload.get('model', 'unknown')}")
            start_time = time.time()
            resp = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
            elapsed = time.time() - start_time
            print(f"[EagleAPI] 响应状态: {resp.status_code} | 耗时: {elapsed:.2f}s")
            if resp.status_code == 200:
                is_stream = payload.get('stream', False)
                if is_stream:
                    return self._parse_stream_response(resp, elapsed)
                data = resp.json()
                if "error" in data:
                    msg = data["error"].get("message", str(data["error"])) if isinstance(data["error"], dict) else str(data["error"])
                    return False, None, msg, elapsed
                return True, data, "", elapsed
            else:
                return False, None, f"HTTP {resp.status_code}: {resp.text[:200]}", elapsed
        except Exception as e:
            return False, None, f"请求异常: {str(e)}", 0

    def _parse_stream_response(self, resp, elapsed) -> tuple:
        try:
            answer_parts = []
            for line in resp.iter_lines(decode_unicode=True):
                if line and line.startswith("data: "):
                    data_str = line[6:]
                    if data_str == "[DONE]": break
                    try:
                        data = json.loads(data_str)
                        if "choices" in data and data["choices"]:
                            content = data["choices"][0].get("delta", {}).get("content", "")
                            if content: answer_parts.append(content)
                    except: continue
            full_content = "".join(answer_parts).strip()
            return (True, {"choices": [{"message": {"role": "assistant", "content": full_content}}]}, "", elapsed) if full_content else (False, None, "流式响应为空", elapsed)
        except Exception as e:
            return False, None, f"解析流式响应失败: {e}", elapsed

# ── 统一节点 ──────────────────────────────────────────────────

class EagleAPIUnifiedNode(_BaseAPI):
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "api_config_key": ("STRING", {"default": _load_saved_key(), "multiline": False}),
                "api_config_url": ("STRING", {"default": _load_saved_base_url(), "multiline": False}),
                "api_config_model": ("STRING", {"default": _load_saved_model(), "multiline": False}),
                "prompt_model_type": (list(PROMPT_FORMAT_TEMPLATES.keys()), {"default": "自然语言"}),
                "system_template": (["custom"] + list(SYSTEM_TEMPLATES.keys()), {"default": "default"}),
                "system_prompt": ("STRING", {"default": "You are a helpful assistant.", "multiline": True}),
                "user_prompt": ("STRING", {"default": "", "multiline": True}),
                "filter_intro": ("BOOLEAN", {"default": True}),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.1}),
                "max_tokens": ("INT", {"default": 4096, "min": 1, "max": 128000}),
                "seed": ("INT", {"default": -1, "min": -1, "max": 2147483647}),
                "top_p": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0}),
                "response_format": (["text", "json_object"], {"default": "text"}),
                "batch_mode": (["first", "all"], {"default": "first"}),
                "max_image_size": ("INT", {"default": 1024, "min": 224, "max": 4096, "step": 64}),
                "timeout": ("INT", {"default": 120, "min": 10, "max": 600}),
            },
            "optional": {
                "api_config": ("API_CONFIG", {"forceInput": True}),
                "history": ("STRING", {"default": "", "multiline": True, "forceInput": True}),
                "image_1": ("IMAGE", {}), "image_2": ("IMAGE", {}), "image_3": ("IMAGE", {}),
                "image_4": ("IMAGE", {}), "image_5": ("IMAGE", {}), "image_6": ("IMAGE", {}),
                "image_7": ("IMAGE", {}), "image_8": ("IMAGE", {}), "image_9": ("IMAGE", {}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "IMAGE")
    RETURN_NAMES = ("输出结果", "状态信息", "对话历史", "输出图像")
    FUNCTION = "process"
    CATEGORY = "🦅 Eagle/API"
    OUTPUT_NODE = True

    def process(self, api_config_key, api_config_url, api_config_model,
                prompt_model_type,
                system_template, system_prompt, user_prompt, filter_intro,
                temperature, max_tokens, seed, top_p,
                response_format, batch_mode, max_image_size, timeout,
                api_config=None, history="", **kwargs):

        self.timeout = timeout

        # ── 诊断日志：端口数据来源 ─────────────────────────────
        api_config_connected = api_config is not None and (
            (isinstance(api_config, (list, tuple)) and len(api_config) >= 3 and any(api_config))
        )
        logger.info(
            f"[EagleAPI] 入口诊断: api_config_connected={api_config_connected}, "
            f"独立字段 key={'<有值>' if api_config_key else '<空>'} "
            f"url={'<有值>' if api_config_url else '<空>'} "
            f"model={'<有值>' if api_config_model else '<空>'} "
            f"history_len={len(history) if history else 0}"
        )

        if api_config:
            try:
                cfg_key, cfg_url, cfg_model = api_config
                if cfg_key: api_config_key = cfg_key
                if cfg_url: api_config_url = cfg_url
                if cfg_model: api_config_model = cfg_model
                logger.info(f"[EagleAPI] 已采用 api_config 复合端口: model={cfg_model}")
            except Exception as e:
                logger.warning(f"[EagleAPI] api_config 解析失败，回退到独立字段: {e}")

        key = _decode_api_key(api_config_key) or _load_saved_key()
        url = _normalize_url(api_config_url.strip() or _load_saved_base_url())
        mdl = api_config_model.strip() or _load_saved_model()

        if not key or not url or not mdl:
            missing = []
            if not key: missing.append("api_key")
            if not url: missing.append("base_url")
            if not mdl: missing.append("model")
            err = f"❌ 缺失配置: {', '.join(missing)}（请连接 API 配置加载器或填写独立字段）"
            logger.error(f"[EagleAPI] {err}")
            return ("", err, history, None)

        _save_api_config(api_key=key, base_url=url, model=mdl)

        sys_prompt = SYSTEM_TEMPLATES.get(system_template, system_prompt.strip())
        if prompt_model_type in PROMPT_FORMAT_TEMPLATES:
            sys_prompt += "\n" + PROMPT_FORMAT_TEMPLATES[prompt_model_type]

        history_msgs = _deserialize_history(history)
        api_messages = [{"role": "system", "content": sys_prompt}] if sys_prompt else []
        api_messages.extend(history_msgs)

        image_tensors = [(k, v) for k, v in kwargs.items() if k.startswith("image_") and v is not None]
        
        failed_images = []
        if image_tensors:
            content = []
            for img_name, img in image_tensors:
                b64s = _tensor_to_base64(img, batch_mode=batch_mode, max_size=max_image_size)
                if not b64s:
                    failed_images.append(img_name)
                    continue
                for b64 in b64s:
                    content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})

            if not content:
                return ("", "❌ 所有图像编码失败", history, None)

            prompt_txt = user_prompt.strip() or ("描述这些图片" if len(content) > 1 else "描述这张图片")
            content.append({"type": "text", "text": prompt_txt})
            api_messages.append({"role": "user", "content": content})
        else:
            prompt_txt = user_prompt.strip()
            if not prompt_txt:
                return ("", "❌ 请输入提示词", history, None)
            api_messages.append({"role": "user", "content": prompt_txt})

        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        payload = {
            "model": mdl, "messages": api_messages, "max_tokens": max_tokens,
            "temperature": temperature, "top_p": top_p, "stream": False
        }
        if seed >= 0:
            payload["seed"] = seed
        if response_format == "json_object":
            payload["response_format"] = {"type": "json_object"}

        ok, data, err, elapsed = self._request(f"{url}/chat/completions", headers, payload)
        if not ok:
            return ("", f"❌ {err}", history, None)

        try:
            text = data["choices"][0]["message"]["content"].strip()
            if filter_intro:
                text = _filter_intro(text)
            text = _format_prompt_output(text, prompt_model_type)

            new_history = _serialize_history(history_msgs + [
                {"role": "user", "content": prompt_txt},
                {"role": "assistant", "content": text}
            ])

            # 尝试从响应中提取图片
            out_images = _extract_images_from_text(text)
            if out_images:
                try:
                    # 尺寸统一：以第一张图为基准，后续同尺寸则堆叠，否则只输出第一张
                    base_w, base_h = out_images[0].size
                    same_size = all(img.size == (base_w, base_h) for img in out_images)
                    if same_size and len(out_images) > 1:
                        image_tensor = torch.cat([_pil_to_tensor(img) for img in out_images], dim=0)
                    else:
                        image_tensor = _pil_to_tensor(out_images[0])
                        if len(out_images) > 1:
                            logger.info(f"[EagleAPI] 检测到 {len(out_images)} 张输出图像但尺寸不一致，仅输出第一张")
                except Exception as e:
                    logger.warning(f"[EagleAPI] 图像张量转换失败: {e}")
                    image_tensor = None
            else:
                image_tensor = None

            usage = data.get("usage", {})
            status = f"✅ {usage.get('total_tokens', 0)} tokens | {elapsed:.2f}s"
            return (text, status, new_history, image_tensor)
        except Exception as e:
            return ("", f"❌ 解析失败: {e}", history, None)

__all__ = ["EagleAPIUnifiedNode"]
