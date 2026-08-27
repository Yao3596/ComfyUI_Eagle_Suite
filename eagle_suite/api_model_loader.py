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
import math
import re
import time
import requests
import torch
import numpy as np
import urllib.request
import urllib.parse
import ipaddress
import socket
from PIL import Image, ImageOps

# ── API Key 解码与配置管理（统一使用 api_config_manager）───────────────
from . import api_config_manager as _cfg
from .logger import logger
from .prompt_format import (
    PROMPT_PRESETS,
    get_system_prompt,
    get_user_suffix,
    format_output as _format_prompt_output,
)

# 保留旧别名，避免外部引用断裂
PROMPT_FORMAT_TEMPLATES = {k: v.get("system_prompt", "") for k, v in PROMPT_PRESETS.items()}
_decode_api_key = _cfg.decode_api_key
_save_api_config = _cfg.save_api_config
_load_config = _cfg.load_config
_normalize_url = _cfg.normalize_url

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
        logger.debug(f"[EagleAPI] 历史解析失败: {e}")
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
                logger.debug(f"[EagleAPI] 帧 {idx} 编码失败: {e}")
        return results
    except Exception as e:
        logger.warning(f"[EagleAPI] 图像编码失败: {e}")
        return []

def _normalize_url_local(url: str) -> str:
    """节点内部使用的 URL 规范化（兼容 api_config_manager.normalize_url）。"""
    return _cfg.normalize_url(url)


# ── 输出图像提取 ──────────────────────────────────────────────
_IMAGE_URL_PATTERNS = [
    re.compile(r'!\[.*?\]\((https?://[^\s\)]+)\)', re.IGNORECASE),
    re.compile(r'\b(https?://[^\s\)]+\.(?:png|jpg|jpeg|gif|webp|bmp))\b', re.IGNORECASE),
    re.compile(r'<img[^>]+src=["\'](https?://[^"\']+)["\']', re.IGNORECASE),
]
_MAX_REMOTE_IMAGE_BYTES = 64 * 1024 * 1024
_MAX_REMOTE_IMAGE_PIXELS = 80_000_000


def _validate_public_image_url(url: str) -> None:
    parsed = urllib.parse.urlparse(str(url or ""))
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("图片 URL 无效")
    for info in socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80)):
        address = ipaddress.ip_address(info[4][0])
        if not address.is_global:
            raise ValueError("图片 URL 指向本机或私有网络")


def _open_limited_image(data: bytes) -> Image.Image:
    if len(data) > _MAX_REMOTE_IMAGE_BYTES:
        raise ValueError("图片响应超过 64 MiB")
    image = Image.open(io.BytesIO(data))
    if image.width * image.height > _MAX_REMOTE_IMAGE_PIXELS:
        raise ValueError("图片像素数量超过安全上限")
    image.load()
    return image.convert("RGB")


def _requests_download_image(url: str, timeout: int) -> Image.Image:
    _validate_public_image_url(url)
    with requests.get(url, timeout=timeout, stream=True) as response:
        response.raise_for_status()
        _validate_public_image_url(str(response.url))
        if not (response.headers.get("Content-Type") or "").lower().startswith("image/"):
            raise ValueError("远端响应不是图片")
        chunks, total = [], 0
        for chunk in response.iter_content(256 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > _MAX_REMOTE_IMAGE_BYTES:
                raise ValueError("图片响应超过 64 MiB")
            chunks.append(chunk)
    return _open_limited_image(b"".join(chunks))


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
    return _requests_download_image(url, timeout)


def _decode_base64_image(b64_text: str) -> Image.Image:
    """解码 base64 图片字符串为 PIL RGB 图像。"""
    if len(b64_text) > (_MAX_REMOTE_IMAGE_BYTES * 4 // 3 + 8):
        raise ValueError("Base64 图片超过 64 MiB")
    return _open_limited_image(base64.b64decode(b64_text, validate=True))


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
            logger.debug(f"[EagleAPI] 请求 URL: {url}")
            logger.debug(f"[EagleAPI] 模型: {payload.get('model', 'unknown')}")
            start_time = time.time()
            resp = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
            elapsed = time.time() - start_time
            logger.debug(f"[EagleAPI] 响应状态: {resp.status_code} | 耗时: {elapsed:.2f}s")
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
                "api_config_key": ("STRING", {"default": "", "multiline": False, "placeholder": "API Key（留空使用 api_config.json）"}),
                "api_config_url": ("STRING", {"default": "", "multiline": False, "placeholder": "Base URL（留空使用 api_config.json）"}),
                "api_config_model": ("STRING", {"default": "", "multiline": False, "placeholder": "Model（留空使用 api_config.json）"}),
                "prompt_model_type": (list(PROMPT_PRESETS.keys()), {"default": "自然语言"}),
                "system_template": (["custom"] + list(SYSTEM_TEMPLATES.keys()), {"default": "default"}),
                "system_prompt": ("STRING", {"default": "You are a helpful assistant.", "multiline": True}),
                "user_prompt": ("STRING", {"default": "", "multiline": True}),
                "filter_intro": ("BOOLEAN", {"default": True}),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.1}),
                "max_tokens": ("INT", {"default": 4096, "min": 1, "max": 128000}),
                "seed": ("INT", {"default": -1, "min": -1, "max": 2147483647, "control_after_generate": True}),
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

    @classmethod
    def IS_CHANGED(cls, api_config_key, api_config_url, api_config_model, **kwargs):
        """导出/保存工作流时，不将 API Key 等敏感信息写入 JSON。"""
        return float("NaN")

    def process(self, api_config_key, api_config_url, api_config_model,
                prompt_model_type,
                system_template, system_prompt, user_prompt, filter_intro,
                temperature, max_tokens, seed, top_p,
                response_format, batch_mode, max_image_size, timeout,
                api_config=None, history="", **kwargs):

        self.timeout = timeout

        # 优先使用 api_config 复合端口
        if api_config:
            try:
                cfg_key, cfg_url, cfg_model = api_config
                if cfg_key: api_config_key = cfg_key
                if cfg_url: api_config_url = cfg_url
                if cfg_model: api_config_model = cfg_model
                logger.info(f"[EagleAPI] 已采用 api_config 复合端口: model={cfg_model}")
            except Exception as e:
                logger.warning(f"[EagleAPI] api_config 解析失败，回退到独立字段: {e}")

        # 独立字段为空时，回退到 api_config.json
        saved = _load_config()
        key = _decode_api_key(api_config_key) or _decode_api_key(saved.get("api_key", ""))
        url = _normalize_url_local(api_config_url.strip() or saved.get("base_url", ""))
        mdl = api_config_model.strip() or saved.get("model", "")

        if not key or not url or not mdl:
            missing = []
            if not key: missing.append("api_key")
            if not url: missing.append("base_url")
            if not mdl: missing.append("model")
            err = f"❌ 缺失配置: {', '.join(missing)}（请连接 API 配置加载器或填写独立字段）"
            logger.error(f"[EagleAPI] {err}")
            return ("", err, history, None)

        profile = _cfg.get_profile(mdl)
        model_type = _cfg.normalize_model_type(
            profile.get("model_type") if profile else None,
            mdl,
        )
        if model_type == _cfg.MODEL_TYPE_IMAGE:
            err = "❌ 当前配置是生图模型，请改用“🦅 API 生图”节点"
            logger.warning(f"[EagleAPI] {err}: model={mdl}")
            return ("", err, history, None)

        # 保存本次实际使用的配置到统一 api_config.json
        _save_api_config(api_key=key, base_url=url, model=mdl)

        # 根据 prompt_model_type 动态注入 system prompt 和 user suffix
        sys_prompt = SYSTEM_TEMPLATES.get(system_template, system_prompt.strip())
        sys_prompt += "\n" + get_system_prompt(prompt_model_type)

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
            content.append({"type": "text", "text": prompt_txt + get_user_suffix(prompt_model_type)})
            api_messages.append({"role": "user", "content": content})
        else:
            prompt_txt = user_prompt.strip()
            if not prompt_txt:
                return ("", "❌ 请输入提示词", history, None)
            api_messages.append({"role": "user", "content": prompt_txt + get_user_suffix(prompt_model_type)})

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

# ── OpenAI Images API 生图/编辑节点 ────────────────────────────

class EagleAPIImageNode:
    """调用 OpenAI 兼容 Images API，支持文生图、参考图编辑、尺寸适配和遮罩编辑。"""

    _ASPECT_RATIOS = {
        "1:1": (1, 1),
        "16:9": (16, 9),
        "9:16": (9, 16),
        "4:3": (4, 3),
        "3:4": (3, 4),
        "3:2": (3, 2),
        "2:3": (2, 3),
        "4:5": (4, 5),
        "5:4": (5, 4),
        "21:9": (21, 9),
    }
    _RESOLUTION_LONG_EDGE = {
        "1K": 1024,
        "2K": 2048,
        "3K": 3072,
        "4K": 3840,
        "6K": 6144,
        "8K": 7680,
    }
    _LEGACY_IMAGE_SIZES = {
        (1024, 1024), (1536, 1024), (1024, 1536),
    }
    _MAX_COMBINED_OUTPUT_PIXELS = 80_000_000

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "api_config_key": ("STRING", {
                    "default": "", "multiline": False,
                    "placeholder": "API Key（推荐连接 api_config）",
                }),
                "api_config_url": ("STRING", {
                    "default": "", "multiline": False,
                    "placeholder": "Base URL（推荐连接 api_config）",
                }),
                "api_config_model": ("STRING", {
                    "default": "", "multiline": False,
                    "placeholder": "生图模型（推荐连接 api_config）",
                }),
                "prompt": ("STRING", {
                    "default": "", "multiline": True,
                    "placeholder": "描述要生成或编辑的图像",
                }),
                "mode": (["自动", "文生图", "图片编辑"], {"default": "自动"}),
                "size": ([
                    "auto", "原图尺寸", "比例预设", "自定义宽高",
                    "1024x1024", "1536x1024", "1024x1536",
                    "2048x2048", "2048x1152", "1152x2048",
                    "3840x2160", "2160x3840",
                ], {
                    "default": "auto",
                }),
                "quality": (["auto", "low", "medium", "high"], {
                    "default": "auto",
                }),
                "background": (["auto", "opaque", "transparent"], {
                    "default": "auto",
                }),
                "output_format": (["png", "webp", "jpeg"], {"default": "png"}),
                "batch_count": ("INT", {"default": 1, "min": 1, "max": 4}),
                "timeout": ("INT", {"default": 300, "min": 30, "max": 900}),
                # 新字段统一追加在旧字段之后，避免旧工作流 widgets_values 索引错位。
                "aspect_ratio": (list(cls._ASPECT_RATIOS.keys()), {
                    "default": "1:1",
                }),
                "resolution": (list(cls._RESOLUTION_LONG_EDGE.keys()), {
                    "default": "1K",
                }),
                "custom_width": ("INT", {
                    "default": 1024, "min": 64, "max": 16384, "step": 16,
                }),
                "custom_height": ("INT", {
                    "default": 1024, "min": 64, "max": 16384, "step": 16,
                }),
                "input_resize_mode": (["不缩放", "适应留边", "裁剪填满", "拉伸"], {
                    "default": "适应留边",
                }),
            },
            "optional": {
                "api_config": ("API_CONFIG", {"forceInput": True}),
                "image_1": ("IMAGE", {}),
                "image_2": ("IMAGE", {}),
                "image_3": ("IMAGE", {}),
                "image_4": ("IMAGE", {}),
                "mask": ("MASK", {}),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("图像", "状态信息", "修订提示词")
    FUNCTION = "process"
    CATEGORY = "🦅 Eagle/API"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    @staticmethod
    def _resize_pil(image: Image.Image, target_size, resize_mode: str, resample) -> Image.Image:
        """按指定策略统一参考图/遮罩尺寸。"""
        if not target_size or resize_mode == "不缩放" or image.size == target_size:
            return image.copy()
        target_size = (int(target_size[0]), int(target_size[1]))
        if resize_mode == "拉伸":
            return image.resize(target_size, resample)
        if resize_mode == "裁剪填满":
            return ImageOps.fit(image, target_size, method=resample, centering=(0.5, 0.5))

        contained = ImageOps.contain(image, target_size, method=resample)
        if image.mode == "L":
            canvas = Image.new("L", target_size, 0)
        elif image.mode == "RGBA":
            canvas = Image.new("RGBA", target_size, (255, 255, 255, 0))
        else:
            canvas = Image.new("RGB", target_size, (255, 255, 255))
            if contained.mode != "RGB":
                contained = contained.convert("RGB")
        left = (target_size[0] - contained.size[0]) // 2
        top = (target_size[1] - contained.size[1]) // 2
        canvas.paste(contained, (left, top))
        return canvas

    @classmethod
    def _image_to_png_bytes(cls, image_tensor, target_size=None, resize_mode="不缩放") -> bytes:
        images = tensor2pil(image_tensor)
        if not images:
            raise ValueError("参考图转换失败")
        image = images[0]
        image = cls._resize_pil(image, target_size, resize_mode, Image.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()

    @classmethod
    def _mask_to_png_bytes(cls, mask_tensor, target_size, resize_mode="不缩放") -> bytes:
        if not isinstance(mask_tensor, torch.Tensor):
            raise ValueError("遮罩不是有效的 MASK 张量")
        mask = mask_tensor.detach().cpu().numpy()
        while mask.ndim > 2:
            mask = mask[0]
        mask = np.clip(mask, 0.0, 1.0)
        mask_image = Image.fromarray((255.0 * mask).astype(np.uint8), mode="L")
        mask_image = cls._resize_pil(
            mask_image, target_size, resize_mode, Image.NEAREST
        )
        if mask_image.size != target_size:
            mask_image = mask_image.resize(target_size, Image.NEAREST)
        alpha_image = ImageOps.invert(mask_image)
        rgba = Image.new("RGBA", target_size, (255, 255, 255, 255))
        rgba.putalpha(alpha_image)
        buffer = io.BytesIO()
        rgba.save(buffer, format="PNG")
        return buffer.getvalue()

    @staticmethod
    def _error_message(response) -> str:
        try:
            data = response.json()
            error = data.get("error", data) if isinstance(data, dict) else data
            if isinstance(error, dict):
                message = error.get("message") or error.get("detail") or str(error)
                code = error.get("code")
                return f"{message} ({code})" if code else str(message)
            return str(error)
        except Exception:
            return response.text[:500] or f"HTTP {response.status_code}"

    @staticmethod
    def _decode_response_image(item, timeout: int) -> Image.Image:
        if isinstance(item, str):
            if item.startswith(("http://", "https://")):
                return _requests_download_image(item, timeout)
            payload = item
        elif isinstance(item, dict):
            url = item.get("url") or item.get("image_url")
            if url:
                return _requests_download_image(url, timeout)
            payload = (
                item.get("b64_json")
                or item.get("base64")
                or item.get("b64")
                or item.get("image")
                or ""
            )
        else:
            raise ValueError("无法识别的图片响应项")

        if isinstance(payload, str) and payload.startswith("data:image/"):
            payload = payload.split(",", 1)[-1]
        if not payload:
            raise ValueError("响应项不包含 b64_json 或 url")
        return _decode_base64_image(payload)

    @classmethod
    def _parse_images(cls, data: dict, timeout: int, target_size=None) -> tuple:
        if not isinstance(data, dict):
            raise ValueError("API 返回不是 JSON 对象")
        items = data.get("data") or data.get("images") or []
        if isinstance(items, dict):
            items = [items]
        if not items and any(key in data for key in ("b64_json", "url", "image")):
            items = [data]
        if not isinstance(items, list) or not items:
            raise ValueError("API 响应中没有图片数据")

        images = []
        revised_prompts = []
        failures = []
        for index, item in enumerate(items):
            try:
                image = cls._decode_response_image(item, timeout)
                if target_size and image.size != target_size:
                    image = image.resize(target_size, Image.LANCZOS)
                images.append(image)
                if isinstance(item, dict) and item.get("revised_prompt"):
                    revised_prompts.append(str(item["revised_prompt"]))
            except Exception as exc:
                failures.append(f"#{index + 1}: {exc}")
        if not images:
            raise ValueError("；".join(failures) or "所有图片解析失败")

        width, height = images[0].size
        normalized = [images[0]]
        for image in images[1:]:
            if image.size != (width, height):
                image = image.resize((width, height), Image.LANCZOS)
            normalized.append(image)
        tensor = torch.cat([_pil_to_tensor(image) for image in normalized], dim=0)
        return tensor, "\n".join(revised_prompts), failures

    @staticmethod
    def _round_to_16(value: float) -> int:
        return max(16, int(round(float(value) / 16.0)) * 16)

    @classmethod
    def _resolve_target_size(
        cls, size, aspect_ratio, resolution, custom_width, custom_height, references
    ):
        size = str(size or "auto").strip()
        if size in {"auto", "API自动", "API 自动"}:
            return None
        if size in {"原图尺寸", "same_as_input"}:
            if not references:
                raise RuntimeError("选择‘原图尺寸’时必须连接至少一张参考图")
            return tensor2pil(references[0])[0].size
        if size in {"自定义宽高", "custom"}:
            return int(custom_width), int(custom_height)
        if size in {"比例预设", "ratio_preset"}:
            ratio_w, ratio_h = cls._ASPECT_RATIOS.get(aspect_ratio, (1, 1))
            long_edge = cls._RESOLUTION_LONG_EDGE.get(resolution, 1024)
            if ratio_w >= ratio_h:
                width = long_edge
                height = long_edge * ratio_h / ratio_w
            else:
                height = long_edge
                width = long_edge * ratio_w / ratio_h
            return cls._round_to_16(width), cls._round_to_16(height)
        match = re.fullmatch(r"(\d+)\s*[xX×]\s*(\d+)", size)
        if match:
            return int(match.group(1)), int(match.group(2))
        raise RuntimeError(f"无法识别的尺寸设置: {size}")

    @classmethod
    def _gpt_image_2_request_size(cls, target_size):
        """把目标尺寸约束到 GPT Image 2 的服务端原生范围。"""
        width, height = (float(target_size[0]), float(target_size[1]))
        if width / height > 3.0:
            width = height * 3.0
        elif height / width > 3.0:
            height = width * 3.0

        max_pixels = 8_294_400
        min_pixels = 655_360
        scale = min(1.0, 3840.0 / max(width, height))
        if width * height * scale * scale > max_pixels:
            scale = min(scale, math.sqrt(max_pixels / (width * height)))
        width *= scale
        height *= scale
        if width * height < min_pixels:
            grow = math.sqrt(min_pixels / (width * height))
            width *= grow
            height *= grow

        request_width = cls._round_to_16(width)
        request_height = cls._round_to_16(height)
        while (
            max(request_width, request_height) > 3840
            or request_width * request_height > max_pixels
        ):
            if request_width >= request_height:
                request_width -= 16
            else:
                request_height -= 16
        while request_width * request_height < min_pixels:
            if request_width >= request_height:
                request_height += 16
            else:
                request_width += 16
        return request_width, request_height

    @classmethod
    def _request_size_for_model(cls, model: str, target_size):
        if not target_size:
            return None
        model_lower = str(model or "").lower()
        if "gpt-image-2" in model_lower:
            return cls._gpt_image_2_request_size(target_size)
        if tuple(target_size) in cls._LEGACY_IMAGE_SIZES:
            return tuple(target_size)
        ratio = target_size[0] / max(target_size[1], 1)
        if ratio > 1.15:
            return 1536, 1024
        if ratio < 0.87:
            return 1024, 1536
        return 1024, 1024

    def process(
        self,
        api_config_key,
        api_config_url,
        api_config_model,
        prompt,
        mode,
        size,
        quality,
        background,
        output_format,
        batch_count,
        timeout,
        aspect_ratio,
        resolution,
        custom_width,
        custom_height,
        input_resize_mode,
        api_config=None,
        image_1=None,
        image_2=None,
        image_3=None,
        image_4=None,
        mask=None,
    ):
        if api_config:
            try:
                values = list(api_config)
                if len(values) >= 3:
                    api_config_key = values[0] or api_config_key
                    api_config_url = values[1] or api_config_url
                    api_config_model = values[2] or api_config_model
            except Exception as exc:
                logger.warning(f"[EagleAPIImage] api_config 解析失败: {exc}")

        saved = _load_config()
        key = _decode_api_key(api_config_key) or _decode_api_key(saved.get("api_key", ""))
        url = _normalize_url_local(str(api_config_url or "").strip() or saved.get("base_url", ""))
        model = str(api_config_model or "").strip() or saved.get("model", "")
        prompt = str(prompt or "").strip()

        missing = []
        if not key:
            missing.append("api_key")
        if not url:
            missing.append("base_url")
        if not model:
            missing.append("model")
        if not prompt:
            missing.append("prompt")
        if missing:
            raise RuntimeError(f"缺失配置: {', '.join(missing)}")
        if background == "transparent" and output_format == "jpeg":
            raise RuntimeError("透明背景不支持 JPEG，请选择 PNG 或 WebP")
        if "gpt-image-2" in model.lower() and background == "transparent":
            raise RuntimeError("GPT Image 2 当前不支持透明背景，请选择 auto 或 opaque")

        references = [
            image for image in (image_1, image_2, image_3, image_4)
            if image is not None
        ]
        is_edit = mode == "图片编辑" or (mode == "自动" and bool(references))
        if is_edit and not references:
            raise RuntimeError("图片编辑模式至少需要连接一张参考图")

        target_size = self._resolve_target_size(
            size, aspect_ratio, resolution, custom_width, custom_height, references
        )
        if target_size:
            width, height = target_size
            if width < 64 or height < 64 or width > 16384 or height > 16384:
                raise RuntimeError("目标宽高必须在 64–16384 像素之间")
            combined_pixels = width * height * int(batch_count)
            if combined_pixels > self._MAX_COMBINED_OUTPUT_PIXELS:
                raise RuntimeError(
                    "目标尺寸 × 批次数过大，可能耗尽内存；请降低分辨率或 batch_count"
                )
        request_size = self._request_size_for_model(model, target_size)

        _save_api_config(
            api_key=key,
            base_url=url,
            model=model,
            model_type=_cfg.MODEL_TYPE_IMAGE,
        )

        parameters = {
            "model": model,
            "prompt": prompt,
            "n": int(batch_count),
            "output_format": output_format,
        }
        if request_size:
            parameters["size"] = f"{request_size[0]}x{request_size[1]}"
        if quality != "auto":
            parameters["quality"] = quality
        if background != "auto":
            parameters["background"] = background

        headers = {"Authorization": f"Bearer {key}"}
        start = time.time()
        try:
            if is_edit:
                files = []
                reference_sizes = []
                for index, image in enumerate(references, start=1):
                    original_size = tensor2pil(image)[0].size
                    upload_target = (
                        request_size if request_size and input_resize_mode != "不缩放"
                        else None
                    )
                    png_bytes = self._image_to_png_bytes(
                        image, upload_target, input_resize_mode
                    )
                    reference_sizes.append(upload_target or original_size)
                    files.append((
                        "image[]",
                        (f"image_{index}.png", png_bytes, "image/png"),
                    ))
                if mask is not None:
                    mask_bytes = self._mask_to_png_bytes(
                        mask, reference_sizes[0], input_resize_mode
                    )
                    files.append(("mask", ("mask.png", mask_bytes, "image/png")))
                response = requests.post(
                    f"{url}/images/edits",
                    headers=headers,
                    data=parameters,
                    files=files,
                    timeout=int(timeout),
                )
                operation = "图片编辑"
            else:
                response = requests.post(
                    f"{url}/images/generations",
                    headers={**headers, "Content-Type": "application/json"},
                    json=parameters,
                    timeout=int(timeout),
                )
                operation = "文生图"
        except requests.RequestException as exc:
            raise RuntimeError(f"API 请求失败: {exc}") from exc

        elapsed = time.time() - start
        if not response.ok:
            raise RuntimeError(
                f"API 返回 HTTP {response.status_code}: {self._error_message(response)}"
            )
        try:
            data = response.json()
        except Exception as exc:
            raise RuntimeError("API 返回的不是有效 JSON") from exc
        if isinstance(data, dict) and data.get("error"):
            raise RuntimeError(f"API 返回错误: {data['error']}")

        image_tensor, revised_prompt, failures = self._parse_images(
            data, int(timeout), target_size=target_size
        )
        image_count = int(image_tensor.shape[0])
        final_height = int(image_tensor.shape[1])
        final_width = int(image_tensor.shape[2])
        usage = data.get("usage", {}) if isinstance(data, dict) else {}
        token_text = ""
        if isinstance(usage, dict) and usage.get("total_tokens") is not None:
            token_text = f" | {usage.get('total_tokens')} tokens"
        failure_text = f" | {len(failures)} 张解析失败" if failures else ""
        status = (
            f"✅ {operation} | {image_count} 张 | {elapsed:.2f}s | {model}"
            f" | 请求 {parameters.get('size', 'auto')} | 输出 {final_width}x{final_height}"
            f"{token_text}{failure_text}"
        )
        return (image_tensor, status, revised_prompt)


__all__ = ["EagleAPIUnifiedNode", "EagleAPIImageNode"]
