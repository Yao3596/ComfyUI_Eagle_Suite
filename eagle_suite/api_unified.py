# -*- coding: utf-8 -*-
"""
Eagle Suite API 统一模块（v5.0）
合并: api_key_node + api_model_loader + api_model_loader 的 API 路由
- EagleAPIKeyNode: 独立密钥输入（向后兼容）
- EagleAPILoader: 配置文件驱动加载器（推荐）
- EagleAPIUnifiedNode: API 多功能调用
- 统一路由: /api/unified/*
"""

import os
import json
import base64
import io
import time
import math
import urllib.parse
import requests
import torch
import numpy as np
from PIL import Image

from .logger import logger
from .utils import decode_api_key, _ENC_PREFIX

# ── 懒加载 aiohttp / PromptServer ──
try:
    from aiohttp import web
    from server import PromptServer
    _HAS_PROMPT_SERVER = True
except Exception:
    web = None
    PromptServer = None
    _HAS_PROMPT_SERVER = False

# ═══════════════════════════════════════════════════════════════
#  配置管理（共享）
# ═══════════════════════════════════════════════════════════════

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "api_config.json")
PROFILES_PATH = os.path.join(os.path.dirname(__file__), "..", "api_profiles.json")

_DEFAULT_CONFIG = {
    "api_key": "",
    "base_url": "",
    "model": "",
}


def _load_config() -> dict:
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                for k, v in _DEFAULT_CONFIG.items():
                    if k not in data:
                        data[k] = v
                return data
    except Exception:
        pass
    return dict(_DEFAULT_CONFIG)


def _save_config(config: dict) -> None:
    try:
        os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"[APIUnified] 保存配置失败: {e}")


def _encode_api_key(raw: str) -> str:
    """明文 → ENC:Base64"""
    if not raw or not isinstance(raw, str):
        return ""
    s = raw.strip()
    if s.startswith(_ENC_PREFIX):
        return s
    try:
        encoded = urllib.parse.quote(s, safe='')
        b64 = base64.b64encode(encoded.encode('utf-8')).decode('utf-8')
        return _ENC_PREFIX + b64
    except Exception:
        return s


def _strip_path_quotes(path: str) -> str:
    if not path:
        return ""
    s = path.strip()
    while len(s) >= 2 and s[0] in ('"', "'") and s[-1] == s[0]:
        s = s[1:-1].strip()
    return s


def _load_profile_names() -> list:
    try:
        if not os.path.exists(PROFILES_PATH):
            config = _load_config()
            model = (config.get("model") or "").strip()
            return [model] if model else []
        with open(PROFILES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return []
        return [k for k in data.keys() if not k.startswith("_") and isinstance(data[k], dict)]
    except Exception:
        return []


# ═══════════════════════════════════════════════════════════════
#  EagleAPIKeyNode — 简单密钥输入
# ═══════════════════════════════════════════════════════════════

class EagleAPIKeyNode:
    """🦅 API 密钥输入节点（向后兼容）"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "api_key": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "password": True,
                    "placeholder": "输入 API Key（留空使用已保存）"
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("api_key",)
    FUNCTION = "get_key"
    CATEGORY = "🦅 Eagle/API"
    OUTPUT_NODE = True

    def get_key(self, api_key: str):
        return (_encode_api_key(api_key),)


# ═══════════════════════════════════════════════════════════════
#  EagleAPILoader — 配置文件驱动加载器
# ═══════════════════════════════════════════════════════════════

class EagleAPILoader:
    """🦅 API 配置加载器（推荐）
    从 api_profiles.json 读取配置，输出 API_CONFIG 复合端口
    """

    @classmethod
    def INPUT_TYPES(cls):
        profiles = _load_profile_names()
        if profiles:
            return {
                "required": {
                    "model_name": (profiles, {"default": profiles[0]}),
                },
                "optional": {
                    "config_path": ("STRING", {
                        "default": "",
                        "multiline": False,
                        "placeholder": "配置文件路径（留空使用默认）"
                    }),
                }
            }
        return {
            "required": {
                "model_name": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "点击「加载模型」自动填充"
                }),
            },
            "optional": {
                "config_path": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "配置文件路径（留空使用默认）"
                }),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "API_CONFIG")
    RETURN_NAMES = ("api_key", "base_url", "model", "api_config")
    FUNCTION = "load_config"
    CATEGORY = "🦅 Eagle/API"
    OUTPUT_NODE = True

    def load_config(self, model_name: str, config_path: str = ""):
        path = _strip_path_quotes(config_path) if config_path else PROFILES_PATH

        if not os.path.exists(path):
            err = f"❌ 配置文件不存在: {path}"
            logger.error(f"[EagleAPILoader] {err}")
            return ("", err, "", ("", err, ""))

        try:
            with open(path, "r", encoding="utf-8") as f:
                profiles = json.load(f)
        except Exception as e:
            err = f"❌ 读取配置失败: {e}"
            return ("", err, "", ("", err, ""))

        if not isinstance(profiles, dict):
            err = "❌ 配置根必须是 JSON 对象"
            return ("", err, "", ("", err, ""))

        name = model_name.strip()
        if not name:
            err = "❌ 请输入 model_name"
            return ("", err, "", ("", err, ""))

        profile = profiles.get(name)
        if not profile or not isinstance(profile, dict):
            available = ", ".join(profiles.keys())
            err = f"❌ 未找到 '{name}'。可用: {available}"
            return ("", err, "", ("", err, ""))

        raw_key = profile.get("api_key", "")
        raw_url = profile.get("base_url", "")
        model = profile.get("model", "")

        # 对输出到 UI 的内容进行掩码处理
        # 注意：因为 EagleAPIUnifiedNode 现在具备恢复能力，所以 Loader 输出掩码是安全的
        api_key = _mask_string(raw_key)
        base_url = _mask_url_token(raw_url)

        if not raw_key or not raw_url or not model:
            missing = []
            if not raw_key: missing.append("api_key")
            if not raw_url: missing.append("base_url")
            if not model: missing.append("model")
            err = f"❌ 配置 '{name}' 缺少: {', '.join(missing)}"
            return ("", err, "", ("", err, ""))

        logger.info(f"[EagleAPILoader] 加载 '{name}': {base_url}, model={model}")
        return (api_key, base_url, model, (api_key, base_url, model))


# ═══════════════════════════════════════════════════════════════
#  EagleAPIUnifiedNode — API 多功能调用
# ═══════════════════════════════════════════════════════════════

_SYSTEM_TEMPLATES = {
    "default": "You are a helpful assistant.",
    "creative": "You are a creative assistant with vivid imagination. Provide detailed and engaging descriptions.",
    "technical": "You are a technical expert. Provide accurate, detailed technical analysis and explanations.",
    "concise": "You are a concise assistant. Provide brief, to-the-point answers.",
    "image_expert": "You are an image analysis expert. Describe images in detail.",
    "translator": "You are a professional translator. Translate accurately while preserving tone and context.",
    "coder": "You are an expert programmer. Provide clean, efficient code with explanations.",
}

_INTRO_PATTERNS = [
    r"^(你好|您好|嗨|Hello|Hi)[，,.。！!]?\s*[,，]?\s*我是?\s*[^.。\n]{0,30}(助手|AI|模型|智能体|Agent)[^.。\n]{0,40}[.。]",
    r"^(你好|您好|嗨|Hello|Hi)[，,.。！!]?\s*[,，]?\s*我是?\s*[^.。\n]{0,40}[.。]",
    r"^(你好|您好|嗨|Hello|Hi)[，,.。！!]?\s*[,，]?\s*针对[^。]{0,60}[。]",
    r"^(你好|您好|嗨|Hello|Hi)[，,.。！!]?\s*[,，]?\s*[^。]{0,60}需求[^。]{0,40}[。]",
    r"^(你好|您好|嗨|Hello|Hi)[，,.。！!]?\s*[,，]?\s*[^。]{0,60}为你[^。]{0,40}[。]",
]


def _filter_intro(text: str) -> str:
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


def _serialize_history(messages: list) -> str:
    safe = []
    for msg in messages:
        role = msg.get("role", "")
        if role == "system":
            continue
        content = msg.get("content", "")
        if isinstance(content, list):
            text_parts = [part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text"]
            safe_content = " ".join(text_parts).strip()
            if not safe_content:
                continue
        else:
            safe_content = str(content)
        safe.append({"role": role, "content": safe_content})
    return json.dumps(safe, ensure_ascii=False)


def _deserialize_history(history_str: str) -> list:
    if not history_str.strip():
        return []
    try:
        messages = json.loads(history_str.strip())
        if not isinstance(messages, list):
            return []
        return [m for m in messages if isinstance(m, dict) and m.get("role") in {"user", "assistant"} and isinstance(m.get("content", ""), str)]
    except Exception:
        return []


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
        for pil_image in pil_images:
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
            except Exception:
                pass
        return results
    except Exception:
        return []


def _normalize_url(url: str) -> str:
    # 提取基础 URL（不含 query）
    raw = url.strip()
    if not raw:
        return ""
    
    try:
        p = urllib.parse.urlparse(raw)
        # 仅保留协议、域名和路径
        base = f"{p.scheme}://{p.netloc}{p.path}".rstrip("/")
    except Exception:
        base = raw.split('?')[0].rstrip("/")

    # 处理特殊的 Azure / Deployment 路径，不强制加 /v1
    if "/deployments/" in base or "/openai/deployments/" in base:
        return base

    # 移除末尾多余的后缀，以便统一补齐 /v1
    if base.endswith("/chat/completions"):
        base = base[:-17].rstrip("/")
    if base.endswith("/chat"):
        base = base[:-5].rstrip("/")
    if base.endswith("/completions"):
        base = base[:-12].rstrip("/")
    
    # 移除末尾的 /v1 重新对齐 (如果有)
    if base.endswith("/v1"):
        base = base[:-3].rstrip("/")

    # 统一补齐 /v1 (除非是 localhost 或某些特殊内网路径，通常外部服务都需要)
    if base.startswith("http"):
        base = base + "/v1"
        
    return base


def _extract_api_key(url: str, manual_key: str = "") -> str:
    """从统一 URL 或手动输入中提取 API Key"""
    # 1. 尝试从 URL query 中提取
    if url:
        try:
            p = urllib.parse.urlparse(url)
            qs = urllib.parse.parse_qs(p.query)
            # 支持 token 或 key 参数
            token = qs.get("token") or qs.get("key") or qs.get("api_key")
            if token:
                tk = token[0]
                # 如果是掩码，则尝试从存储恢复 (这里暂不恢复，由 process 统一处理)
                return tk
        except Exception:
            pass
    
    # 2. 回退到手动输入
    return manual_key or ""


def _mask_string(s: str) -> str:
    """生成掩码字符串 ENC:****"""
    if not s: return ""
    if s.startswith(_ENC_PREFIX):
        # 如果已经是编码或掩码，先尝试解码看长度
        try:
            from .utils import decode_api_key
            decoded = decode_api_key(s)
            if len(decoded) <= 8: return _ENC_PREFIX + "****"
            return _ENC_PREFIX + decoded[:4] + "****" + decoded[-4:]
        except:
            return _ENC_PREFIX + "****"
    
    if len(s) <= 8: return _ENC_PREFIX + "****"
    return _ENC_PREFIX + s[:4] + "****" + s[-4:]


def _mask_url_token(url: str) -> str:
    """对 URL 中的 token 进行掩码处理"""
    if not url or ("token=" not in url and "key=" not in url and "api_key=" not in url):
        return url
    try:
        p = urllib.parse.urlparse(url)
        qs = urllib.parse.parse_qs(p.query)
        changed = False
        for k in ["token", "key", "api_key"]:
            if k in qs:
                tk = qs[k][0]
                # 如果已经是掩码格式（含有 ****），跳过
                if "****" in tk: continue
                qs[k] = [_mask_string(tk)]
                changed = True
        if not changed: return url
        new_query = urllib.parse.urlencode(qs, doseq=True)
        return urllib.parse.urlunparse((p.scheme, p.netloc, p.path, p.params, new_query, p.fragment))
    except Exception:
        return url


class _BaseAPI:
    def __init__(self, timeout=120):
        self.timeout = timeout

    def _request(self, url: str, headers: dict, payload: dict) -> tuple:
        try:
            start_time = time.time()
            resp = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
            elapsed = time.time() - start_time

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
                    return False, None, f"解析 JSON 失败: {e}", elapsed
            elif resp.status_code == 401:
                return False, None, "API Key 无效 (401)", elapsed
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


class EagleAPIUnifiedNode(_BaseAPI):
    """🦅 API 统一调用节点（安全版 v5.0）"""

    @classmethod
    def INPUT_TYPES(cls):
        saved = _load_config()
        return {
            "required": {
                "api_config_key": ("STRING", {
                    "default": _encode_api_key(saved.get("api_key", "")),
                    "multiline": False,
                    "placeholder": "API Key（留空使用已保存）"
                }),
                "api_config_url": ("STRING", {
                    "default": saved.get("base_url", ""),
                    "multiline": False,
                    "placeholder": "如 https://api.openai.com/v1"
                }),
                "api_config_model": ("STRING", {
                    "default": saved.get("model", ""),
                    "multiline": False,
                    "placeholder": "如 gpt-4o"
                }),
                "system_template": (["custom"] + list(_SYSTEM_TEMPLATES.keys()), {"default": "default"}),
                "system_prompt": ("STRING", {
                    "default": "You are a helpful assistant.",
                    "multiline": True,
                    "placeholder": "系统提示词（custom 时生效）"
                }),
                "user_prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "placeholder": "输入问题或图片分析要求"
                }),
                "filter_intro": ("BOOLEAN", {"default": True, "label_on": "过滤自我介绍", "label_off": "保留原文"}),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.1}),
                "max_tokens": ("INT", {"default": 4096, "min": 1, "max": 128000, "step": 1}),
                "seed": ("INT", {"default": -1, "min": -1, "max": 2147483647, "step": 1}),
                "top_p": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.1}),
                "response_format": (["text", "json_object"], {"default": "text"}),
                "batch_mode": (["first", "all"], {"default": "first"}),
                "timeout": ("INT", {"default": 120, "min": 10, "max": 600, "step": 10}),
            },
            "optional": {
                "api_config": ("API_CONFIG", {"forceInput": True, "tooltip": "API 配置总线（优先使用）"}),
                "history": ("STRING", {"default": "", "multiline": True, "forceInput": True}),
                "image_1": ("IMAGE", {}), "image_2": ("IMAGE", {}), "image_3": ("IMAGE", {}),
                "image_4": ("IMAGE", {}), "image_5": ("IMAGE", {}), "image_6": ("IMAGE", {}),
                "image_7": ("IMAGE", {}), "image_8": ("IMAGE", {}), "image_9": ("IMAGE", {}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("输出结果", "状态信息", "对话历史")
    FUNCTION = "process"
    CATEGORY = "🦅 Eagle/API"
    OUTPUT_NODE = True

    def process(self, api_config_key, api_config_url, api_config_model,
                system_template, system_prompt, user_prompt, filter_intro,
                temperature, max_tokens, seed, top_p,
                response_format, batch_mode, timeout,
                api_config=None, history="",
                image_1=None, image_2=None, image_3=None,
                image_4=None, image_5=None, image_6=None,
                image_7=None, image_8=None, image_9=None):

        self.timeout = timeout
        saved_config = _load_config()

        # 1. 获取输入值
        raw_key = api_config_key
        raw_url = api_config_url
        raw_model = api_config_model

        # 优先使用 api_config 复合端口
        if api_config is not None:
            try:
                raw_key, raw_url, raw_model = api_config
            except Exception as e:
                return ("", f"❌ api_config 格式错误: {e}", "")

        # 2. 处理 URL + Token 合并逻辑
        # 尝试从 URL 提取 Token (如果是掩码则返回掩码)
        extracted_token = _extract_api_key(raw_url)
        
        # 3. 掩码恢复逻辑 (关键安全性补丁)
        # 如果 URL 或 Key 包含掩码 (****)，则尝试从已保存配置中恢复真实值
        final_key = raw_key
        final_url_with_token = raw_url

        def is_masked(s: str) -> bool:
            return s and "****" in s

        # 优先处理 URL 里的 Token
        if is_masked(extracted_token):
            # 恢复 URL 里的真实 token
            saved_url = saved_config.get("base_url", "")
            saved_token = _extract_api_key(saved_url)
            if saved_token and not is_masked(saved_token):
                # 替换掩码回真实 token
                final_url_with_token = raw_url.replace(extracted_token, saved_token)
                final_key = saved_token
            else:
                return ("", "❌ 无法从掩码恢复 URL Token，请重新输入完整链接", "")
        elif extracted_token:
            # 提取到了真实的 Token
            final_key = extracted_token
        
        # 处理独立的 api_config_key 掩码
        if is_masked(final_key):
            saved_key = saved_config.get("api_key", "")
            if saved_key and not is_masked(saved_key):
                final_key = decode_api_key(saved_key)
            else:
                return ("", "❌ 无法从掩码恢复 API Key，请重新输入", "")
        else:
            # 是真实 Key，进行解码 (以防万一它是 ENC:B64 格式)
            final_key = decode_api_key(final_key)

        # 4. 最终参数校验与规范化
        if not final_key:
            return ("", "❌ 缺少 API Key", "")

        url_base = _normalize_url(final_url_with_token)
        if not url_base:
            return ("", "❌ 请输入 API 地址", "")

        model_name = raw_model.strip() or saved_config.get("model", "")
        if not model_name:
            return ("", "❌ 请输入模型名称", "")

        # 5. 保存配置 (保存脱敏前的原始输入以便下次恢复，但 key 部分加密存储)
        _save_config({
            "api_key": _encode_api_key(final_key),
            "base_url": final_url_with_token,
            "model": model_name
        })

        # 系统提示词
        if system_template != "custom" and system_template in _SYSTEM_TEMPLATES:
            final_system = _SYSTEM_TEMPLATES[system_template]
        else:
            final_system = system_prompt.strip()

        # 历史
        history_messages = _deserialize_history(history)

        # 构建消息
        api_messages = []
        if final_system:
            api_messages.append({"role": "system", "content": final_system})
        api_messages.extend(history_messages)

        # 收集图像
        raw_inputs = [image_1, image_2, image_3, image_4, image_5, image_6, image_7, image_8, image_9]
        image_tensors = [(f"图像 {i+1}", img) for i, img in enumerate(raw_inputs) if img is not None]

        failed_images = []
        total_frames = 0

        if image_tensors:
            content = []
            for img_name, img_tensor in image_tensors:
                b64_list = _tensor_to_base64(img_tensor, batch_mode=batch_mode)
                if not b64_list:
                    failed_images.append(img_name)
                    continue
                for b64 in b64_list:
                    content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
                    total_frames += 1

            if not content:
                return ("", "❌ 所有图像编码失败", _serialize_history(history_messages))

            prompt_text = user_prompt.strip() or (f"描述这 {total_frames} 张图片" if total_frames > 1 else "描述这张图片")
            content.append({"type": "text", "text": prompt_text})
            current_user_msg = {"role": "user", "content": content}
        else:
            prompt_text = user_prompt.strip()
            if not prompt_text:
                return ("", "❌ 请输入提示词", _serialize_history(history_messages))
            current_user_msg = {"role": "user", "content": prompt_text}

        api_messages.append(current_user_msg)

        # 发送请求
        headers = {"Authorization": f"Bearer {final_key}", "Content-Type": "application/json"}
        payload = {
            "model": model_name,
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

        ok, data, err, elapsed = self._request(f"{url_base}/chat/completions", headers, payload)
        if not ok:
            return ("", f"❌ {err}", _serialize_history(history_messages))

        # 解析响应
        try:
            choices = data.get("choices", [])
            if not choices:
                return ("", "⚠️ API 返回空 choices", _serialize_history(history_messages))

            message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
            text = message.get("content", "").strip() if isinstance(message, dict) else ""
            if not text:
                return ("", "⚠️ API 返回空内容", _serialize_history(history_messages))

            if filter_intro:
                text = _filter_intro(text)

            updated_history = history_messages + [
                {"role": "user", "content": prompt_text},
                {"role": "assistant", "content": text},
            ]
            new_history = _serialize_history(updated_history)

            usage = data.get("usage", {}) or {}
            prompt_tokens = usage.get('prompt_tokens', 0)
            completion_tokens = usage.get('completion_tokens', 0)

            mode_icon = "🖼️" if image_tensors else "📝"
            mode_text = f"{len(image_tensors)}图" if image_tensors else "文本"
            if image_tensors and batch_mode == "all":
                mode_text += f"({total_frames}帧)"

            truncated = f" ⚠️ 可能截断" if completion_tokens and completion_tokens >= max_tokens * 0.95 else ""
            failed_note = f" | ⚠️ {len(failed_images)}图失败" if failed_images else ""

            status = f"✅ {mode_icon} {mode_text} | {prompt_tokens}→{completion_tokens} tokens | {elapsed:.2f}s{failed_note}{truncated}"

            return (text, status, new_history)

        except Exception as e:
            return ("", f"❌ 解析失败: {e}", _serialize_history(history_messages))


# ═══════════════════════════════════════════════════════════════
#  统一路由注册（仅在 PromptServer 可用时）
# ═══════════════════════════════════════════════════════════════

def register_routes():
    """延迟注册 API Unified 路由，避免模块导入时 PromptServer.instance 尚未就绪。"""
    if not _HAS_PROMPT_SERVER:
        return
    server = PromptServer.instance
    if not server:
        logger.warning("[APIUnified] PromptServer.instance 未就绪，跳过路由注册")
        return
    routes = server.routes

    @routes.post("/api/unified/profiles")
    async def _get_profiles(request):
        try:
            data = await request.json()
            config_path = _strip_path_quotes(data.get("config_path") or "")
            path = config_path if config_path else PROFILES_PATH
            if not os.path.exists(path):
                return web.json_response({"success": False, "error": "配置文件不存在"})
            with open(path, "r", encoding="utf-8") as f:
                profiles = json.load(f)
            if not isinstance(profiles, dict):
                return web.json_response({"success": False, "error": "格式错误"})
            names = [k for k in profiles.keys() if not k.startswith("_") and isinstance(profiles[k], dict)]
            return web.json_response({"success": True, "profiles": names})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/api/unified/profile_info")
    async def _get_profile_info(request):
        try:
            data = await request.json()
            profile_name = (data.get("profile_name") or "").strip()
            config_path = _strip_path_quotes(data.get("config_path") or "")
            path = config_path if config_path else PROFILES_PATH
            if not os.path.exists(path):
                return web.json_response({"success": False, "error": "配置文件不存在"})
            with open(path, "r", encoding="utf-8") as f:
                profiles = json.load(f)
            profile = profiles.get(profile_name)
            if not profile or not isinstance(profile, dict):
                return web.json_response({"success": False, "error": f"未找到 '{profile_name}'"})

            raw_key = profile.get("api_key", "")
            raw_url = profile.get("base_url", "")
            raw_model = profile.get("model", "")

            # 脱敏逻辑：如果 URL 中包含 token，则对 URL 进行掩码，并对独立 Key 也进行掩码
            masked_url = _mask_url_token(raw_url)
            masked_key = _mask_string(raw_key)

            return web.json_response({
                "success": True,
                "base_url": masked_url,
                "api_key": masked_key,
                "model": raw_model
            })
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/api/unified/models")
    async def _get_models(request):
        import asyncio
        try:
            data = await request.json()
            base_url = (data.get("base_url") or "").strip().rstrip("/")
            api_key = (data.get("api_key") or "").strip()
            if not base_url or not api_key:
                return web.json_response({"success": False, "error": "base_url 或 api_key 为空"})
            if not base_url.endswith("/v1"):
                if "/v1" not in base_url:
                    base_url = base_url + "/v1"
            models_url = base_url.rstrip("/") + "/models"

            def _fetch():
                headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
                return requests.get(models_url, headers=headers, timeout=10)

            resp = await asyncio.to_thread(_fetch)
            if resp.status_code == 401:
                return web.json_response({"success": False, "error": "API Key 无效（401）"})
            if resp.status_code != 200:
                return web.json_response({"success": False, "error": f"HTTP {resp.status_code}"})
            result = resp.json()
            # 增强解析：适配某些 API 返回的 data 字段缺失或格式异常
            if isinstance(result, list):
                models_raw = result
            else:
                models_raw = result.get("data", [])

            model_ids = []
            if isinstance(models_raw, list):
                for m in models_raw:
                    if isinstance(m, dict):
                        mid = m.get("id")
                        if mid: model_ids.append(mid)
                    elif isinstance(m, str):
                        model_ids.append(m)

            model_ids = sorted(list(set(model_ids)))
            return web.json_response({"success": True, "models": model_ids})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/api/unified/select_config_file")
    async def _select_config_file(request):
        import tempfile
        try:
            reader = await request.multipart()
            field = await reader.next()
            if not field:
                return web.json_response({"success": False, "error": "未接收到文件"})
            content = await field.read()
            try:
                json.loads(content)
            except json.JSONDecodeError:
                return web.json_response({"success": False, "error": "不是有效 JSON"})
            temp_dir = tempfile.gettempdir()
            dest_path = os.path.join(temp_dir, "eagle_api_profiles_uploaded.json")
            with open(dest_path, "wb") as f:
                f.write(content)
            return web.json_response({"success": True, "path": dest_path})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/api/unified/pick_file")
    async def _pick_file(request):
        try:
            path = _native_file_dialog()
            if path:
                return web.json_response({"success": True, "path": path})
            return web.json_response({"success": False, "error": "未选择文件"})
        except Exception as e:
            return web.json_response({"success": False, "error": str(e)}, status=500)

    logger.info("[APIUnified] API 统一模块路由已注册")


# 注意：路由由 eagle_suite/__init__.py 统一调用 register_routes() 注册，
# 避免在 PromptServer.instance 未就绪时自动注册导致 AttributeError。


def _native_file_dialog() -> str:
    import subprocess
    ps_code = '''
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Filter = "JSON 文件 (*.json)|*.json|所有文件 (*.*)|*.*"
$d.Title = "选择 API 配置文件"
$r = $d.ShowDialog()
if ($r -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }
'''
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_code],
            capture_output=True, text=True, timeout=30
        )
        path = result.stdout.strip()
        if path and os.path.exists(path):
            return path
    except Exception:
        pass

    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        path = filedialog.askopenfilename(title="选择 API 配置文件", filetypes=[("JSON 文件", "*.json"), ("所有文件", "*.*")])
        root.destroy()
        return path if path else ""
    except Exception:
        pass

    return ""


__all__ = ["EagleAPIKeyNode", "EagleAPILoader", "EagleAPIUnifiedNode", "register_routes"]
