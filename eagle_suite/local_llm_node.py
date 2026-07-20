# -*- coding: utf-8 -*-
"""
Eagle Suite - 本地大模型反推节点
包含两个版本：
1. EagleLocalLLMNode：直接从本地模型目录加载 transformers 模型（推荐）。
   支持 Qwen-VL、LLaVA 等视觉语言模型，从 models/LLM 扫描并缓存。
2. EagleLocalLLMServerNode：通过 OpenAI 兼容接口调用本地服务
   （vLLM / Ollama / llama.cpp server / LM Studio 等）。
"""

import os
import json
import base64
import io
import time
import gc
import requests
import torch
import numpy as np
from PIL import Image

from .utils import decode_api_key
from .logger import logger


# ═══════════════════════════════════════════════════════════════
#  共享工具函数
# ═══════════════════════════════════════════════════════════════

from .prompt_format import (
    PROMPT_PRESETS,
    get_system_prompt,
    get_user_suffix,
    format_output as _format_prompt_output,
)

# 保留旧别名，避免外部引用断裂
PROMPT_FORMAT_TEMPLATES = {k: v.get("system_prompt", "") for k, v in PROMPT_PRESETS.items()}


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


_SYSTEM_TEMPLATES = {
    "default": "You are a helpful assistant.",
    "creative": "You are a creative assistant with vivid imagination. Provide detailed and engaging descriptions.",
    "technical": "You are a technical expert. Provide accurate, detailed technical analysis and explanations.",
    "concise": "You are a concise assistant. Provide brief, to-the-point answers.",
    "image_expert": "You are an image analysis expert. Describe images in detail.",
    "translator": "You are a professional translator. Translate accurately while preserving tone and context.",
    "coder": "You are an expert programmer. Provide clean, efficient code with explanations.",
}


def _serialize_history(messages: list) -> str:
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
    if not history_str or not history_str.strip():
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
        logger.warning(f"[LocalLLM] 历史解析失败: {e}")
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
                logger.warning(f"[LocalLLM] 帧 {idx} 编码失败: {e}")
        return results
    except Exception as e:
        logger.warning(f"[LocalLLM] 图像编码失败: {e}")
        return []


# ═══════════════════════════════════════════════════════════════
#  本地模型扫描与加载（文件系统直接加载）
# ═══════════════════════════════════════════════════════════════

_MODEL_CACHE = {}


def _get_comfy_models_dir() -> str:
    """获取 ComfyUI models 目录。优先 folder_paths，否则回退。"""
    try:
        import folder_paths
        return folder_paths.models_dir
    except Exception:
        pass
    # 回退：从本文件所在位置推导（.../ComfyUI/custom_nodes/xxx/eagle_suite/）
    fallback = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "models"))
    return fallback


def _scan_local_models() -> list:
    """扫描 models/LLM 和 models/text_encoders 下包含 config.json 的模型目录。"""
    models_dir = _get_comfy_models_dir()
    candidates = []
    for sub in ("LLM", "text_encoders"):
        d = os.path.join(models_dir, sub)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            path = os.path.join(d, name)
            if not os.path.isdir(path):
                continue
            if os.path.exists(os.path.join(path, "config.json")):
                candidates.append(path)
    return candidates


def _model_dir_name(path: str) -> str:
    """把完整模型路径简化为 models/LLM/xxx 的显示名。"""
    models_dir = _get_comfy_models_dir()
    rel = os.path.relpath(path, models_dir).replace("\\", "/")
    return rel


def _normalize_model_path(path_or_name: str) -> str:
    """支持填写 models/LLM/xxx、xxx 或完整路径。"""
    s = path_or_name.strip()
    if not s:
        return ""
    if os.path.isdir(s) and os.path.exists(os.path.join(s, "config.json")):
        return s
    # 尝试 models/LLM/name
    models_dir = _get_comfy_models_dir()
    for sub in ("LLM", "text_encoders"):
        p = os.path.join(models_dir, sub, s)
        if os.path.isdir(p) and os.path.exists(os.path.join(p, "config.json")):
            return p
    # 尝试 models/LLM/相对路径
    p2 = os.path.join(models_dir, s)
    if os.path.isdir(p2) and os.path.exists(os.path.join(p2, "config.json")):
        return p2
    return s  # 可能用户填的是其他有效路径


def _resolve_dtype(dtype_str: str):
    if dtype_str == "bf16":
        return torch.bfloat16
    if dtype_str == "fp16":
        return torch.float16
    return torch.float32


def _load_local_model(model_path: str, device: str, dtype_str: str):
    """加载本地 transformers 模型与 processor，带缓存。"""
    from transformers import AutoProcessor, AutoModelForImageTextToText, AutoModelForVision2Seq

    key = f"{model_path}||{device}||{dtype_str}"
    if key in _MODEL_CACHE:
        return _MODEL_CACHE[key]

    dtype = _resolve_dtype(dtype_str)
    logger.info(f"[LocalLLM] 正在加载本地模型: {model_path} (device={device}, dtype={dtype_str})")
    start = time.time()

    try:
        processor = AutoProcessor.from_pretrained(model_path, trust_remote_code=True, local_files_only=True)
    except Exception as e:
        raise RuntimeError(f"加载 Processor 失败: {e}")

    load_kwargs = {
        "pretrained_model_name_or_path": model_path,
        "trust_remote_code": True,
        "local_files_only": True,
        "torch_dtype": dtype,
    }
    if device == "cuda":
        load_kwargs["device_map"] = "auto"
    elif device == "cpu":
        load_kwargs["device_map"] = "cpu"
    else:  # auto
        load_kwargs["device_map"] = "auto"

    last_err = None
    for model_cls in (AutoModelForImageTextToText, AutoModelForVision2Seq):
        try:
            model = model_cls.from_pretrained(**load_kwargs)
            break
        except Exception as e:
            last_err = e
            continue
    else:
        raise RuntimeError(f"加载模型失败: {last_err}")

    elapsed = time.time() - start
    logger.info(f"[LocalLLM] 模型加载完成，耗时 {elapsed:.2f}s")

    _MODEL_CACHE[key] = (model, processor)
    return model, processor


# ═══════════════════════════════════════════════════════════════
#  EagleLocalLLMNode — 本地文件直接加载
# ═══════════════════════════════════════════════════════════════

class EagleLocalLLMNode:
    """🦅 本地大模型反推（文件加载）

    直接从 ComfyUI 的 models/LLM 或 models/text_encoders 目录加载视觉语言模型，
    支持 Qwen-VL、Qwen2.5-VL、Qwen3-VL、LLaVA 等 transformers 模型。
    """

    @classmethod
    def INPUT_TYPES(cls):
        models = _scan_local_models()
        model_names = [_model_dir_name(p) for p in models]
        default_model = model_names[0] if model_names else ""

        return {
            "required": {
                "model_path": (model_names + [""], {
                    "default": default_model,
                    "multiline": False,
                    "placeholder": "选择或输入模型路径（如 models/LLM/Qwen3-VL-4B-Instruct）"
                }),
                "device": (["auto", "cuda", "cpu"], {"default": "auto"}),
                "dtype": (["bf16", "fp16", "fp32"], {"default": "bf16"}),
                "prompt_model_type": (list(PROMPT_PRESETS.keys()), {"default": "自然语言"}),
                "system_template": (["custom"] + list(_SYSTEM_TEMPLATES.keys()), {"default": "image_expert"}),
                "system_prompt": ("STRING", {
                    "default": "You are an image analysis expert. Describe images in detail.",
                    "multiline": True,
                    "placeholder": "系统提示词（custom 时生效）"
                }),
                "user_prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "placeholder": "输入问题或图片分析要求（留空使用默认描述）"
                }),
                "filter_intro": ("BOOLEAN", {"default": True, "label_on": "过滤自我介绍", "label_off": "保留原文"}),
                "max_new_tokens": ("INT", {"default": 512, "min": 1, "max": 8192, "step": 1}),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.1}),
                "top_p": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.1}),
                "do_sample": ("BOOLEAN", {"default": True}),
                "batch_mode": (["first", "all"], {"default": "first"}),
                "max_image_size": ("INT", {"default": 1024, "min": 224, "max": 4096, "step": 64}),
            },
            "optional": {
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

    def process(self, model_path, device, dtype, prompt_model_type,
                system_template, system_prompt, user_prompt, filter_intro,
                max_new_tokens, temperature, top_p, do_sample, batch_mode,
                max_image_size, history="",
                image_1=None, image_2=None, image_3=None,
                image_4=None, image_5=None, image_6=None,
                image_7=None, image_8=None, image_9=None):

        # 1. 解析模型路径
        resolved = _normalize_model_path(model_path)
        if not resolved or not os.path.isdir(resolved):
            return ("", f"❌ 模型路径不存在或无效: {model_path}", history)
        if not os.path.exists(os.path.join(resolved, "config.json")):
            return ("", f"❌ 路径下缺少 config.json，不是有效的 transformers 模型: {resolved}", history)

        # 2. 加载模型
        try:
            model, processor = _load_local_model(resolved, device, dtype)
        except Exception as e:
            return ("", f"❌ 模型加载失败: {e}", history)

        # 3. 系统提示词：注入对应输出风格的身份与格式约束
        sys_prompt = _SYSTEM_TEMPLATES.get(system_template, system_prompt.strip())
        sys_prompt += "\n" + get_system_prompt(prompt_model_type)

        # 4. 处理历史
        history_msgs = _deserialize_history(history)
        messages = []
        if sys_prompt:
            messages.append({"role": "system", "content": sys_prompt})
        messages.extend(history_msgs)

        # 5. 处理图像：先编码为 JPEG，再解码为 PIL，并按 max_image_size 缩放
        raw_inputs = [image_1, image_2, image_3, image_4, image_5, image_6, image_7, image_8, image_9]
        image_tensors = [(f"图像 {i+1}", img) for i, img in enumerate(raw_inputs) if img is not None]
        pil_images = []
        failed_images = []
        for img_name, img_tensor in image_tensors:
            b64_list = _tensor_to_base64(img_tensor, batch_mode=batch_mode, max_size=max_image_size)
            if not b64_list:
                failed_images.append(img_name)
                continue
            for b64 in b64_list:
                try:
                    pil_images.append(Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB"))
                except Exception as e:
                    logger.warning(f"[LocalLLM] {img_name} 解码失败: {e}")
                    failed_images.append(img_name)

        # 6. 构建用户消息
        content = []
        for img in pil_images:
            content.append({"type": "image", "image": img})

        prompt_txt = user_prompt.strip()
        if pil_images:
            prompt_txt = prompt_txt or (f"描述这 {len(pil_images)} 张图片" if len(pil_images) > 1 else "描述这张图片")
        else:
            if not prompt_txt:
                return ("", "❌ 请输入提示词", _serialize_history(history_msgs))
        content.append({"type": "text", "text": prompt_txt + get_user_suffix(prompt_model_type)})
        messages.append({"role": "user", "content": content})

        # 7. 应用 chat template 并推理
        try:
            text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
            if pil_images:
                inputs = processor(text=[text], images=pil_images, return_tensors="pt", padding=True)
            else:
                inputs = processor(text=[text], return_tensors="pt", padding=True)

            # 移动到模型所在设备
            if hasattr(model, "hf_device_map"):
                target_device = next(model.parameters()).device
            else:
                target_device = model.device if hasattr(model, "device") else (torch.device("cuda") if torch.cuda.is_available() else torch.device("cpu"))
            inputs = {k: v.to(target_device) if isinstance(v, torch.Tensor) else v for k, v in inputs.items()}

            gen_kwargs = {
                "max_new_tokens": max_new_tokens,
                "do_sample": do_sample,
            }
            if do_sample:
                gen_kwargs["temperature"] = temperature
                gen_kwargs["top_p"] = top_p

            start = time.time()
            with torch.inference_mode():
                output_ids = model.generate(**inputs, **gen_kwargs)
            elapsed = time.time() - start

            # 只取生成部分
            prompt_len = inputs["input_ids"].shape[1]
            generated_ids = output_ids[:, prompt_len:]
            text = processor.batch_decode(generated_ids, skip_special_tokens=True)[0].strip()
        except Exception as e:
            return ("", f"❌ 推理失败: {e}", _serialize_history(history_msgs))

        if not text:
            return ("", "⚠️ 模型返回空内容", _serialize_history(history_msgs))

        if filter_intro:
            text = _filter_intro(text)
        text = _format_prompt_output(text, prompt_model_type)

        new_history = _serialize_history(history_msgs + [
            {"role": "user", "content": prompt_txt},
            {"role": "assistant", "content": text},
        ])

        mode_icon = "🖼️" if pil_images else "📝"
        mode_text = f"{len(pil_images)}图" if pil_images else "文本"
        failed_note = f" | ⚠️ {len(failed_images)}图失败" if failed_images else ""
        status = f"✅ {mode_icon} {mode_text} | {len(text)} 字符 | {elapsed:.2f}s{failed_note}"
        return (text, status, new_history)


# ═══════════════════════════════════════════════════════════════
#  EagleLocalLLMServerNode — OpenAI 兼容本地服务
# ═══════════════════════════════════════════════════════════════

class _BaseAPI:
    def __init__(self, timeout=120):
        self.timeout = timeout

    def _request(self, url: str, headers: dict, payload: dict) -> tuple:
        try:
            start_time = time.time()
            resp = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
            elapsed = time.time() - start_time

            if resp.status_code == 200:
                is_stream = payload.get('stream', False)
                if is_stream:
                    return self._parse_stream_response(resp, elapsed)
                data = resp.json()
                if "error" in data:
                    msg = data["error"].get("message", str(data["error"])) if isinstance(data["error"], dict) else str(data["error"])
                    return False, None, msg, elapsed
                return True, data, "", elapsed
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
                if line and line.startswith("data: "):
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


def _normalize_url(url: str) -> str:
    url = url.strip().rstrip("/")
    if not url:
        return ""
    if "/deployments/" in url or "/openai/deployments/" in url:
        return url
    if url.endswith("/chat/completions"):
        url = url.replace("/chat/completions", "")
    if not url.endswith("/v1"):
        url = url + "/v1"
    return url


class EagleLocalLLMServerNode(_BaseAPI):
    """🦅 本地大模型服务（OpenAI 兼容接口）

    通过 OpenAI 兼容接口调用本地部署的大模型服务，
    适用于 vLLM、Ollama、llama.cpp server、LM Studio 等。
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "base_url": ("STRING", {
                    "default": "http://127.0.0.1:8000/v1",
                    "multiline": False,
                    "placeholder": "本地 OpenAI 兼容接口地址"
                }),
                "model": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "本地模型名，如 qwen2-vl-7b-instruct"
                }),
                "api_key": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "本地服务通常可留空"
                }),
                "prompt_model_type": (list(PROMPT_PRESETS.keys()), {"default": "自然语言"}),
                "system_template": (["custom"] + list(_SYSTEM_TEMPLATES.keys()), {"default": "image_expert"}),
                "system_prompt": ("STRING", {
                    "default": "You are an image analysis expert. Describe images in detail.",
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
                "batch_mode": (["first", "all"], {"default": "first"}),
                "max_image_size": ("INT", {"default": 1024, "min": 224, "max": 4096, "step": 64}),
                "timeout": ("INT", {"default": 120, "min": 10, "max": 600, "step": 10}),
            },
            "optional": {
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

    def process(self, base_url, model, api_key, prompt_model_type,
                system_template, system_prompt, user_prompt, filter_intro,
                temperature, max_tokens, seed, top_p,
                batch_mode, max_image_size, timeout,
                history="",
                image_1=None, image_2=None, image_3=None,
                image_4=None, image_5=None, image_6=None,
                image_7=None, image_8=None, image_9=None):

        self.timeout = timeout

        key = decode_api_key(api_key) if api_key else "not-needed"
        url = _normalize_url(base_url.strip())
        mdl = model.strip()

        if not url:
            return ("", "❌ 请输入本地模型服务地址", history, None)
        if not mdl:
            return ("", "❌ 请输入本地模型名称", history, None)

        sys_prompt = _SYSTEM_TEMPLATES.get(system_template, system_prompt.strip())
        sys_prompt += "\n" + get_system_prompt(prompt_model_type)

        history_msgs = _deserialize_history(history)
        api_messages = [{"role": "system", "content": sys_prompt}] if sys_prompt else []
        api_messages.extend(history_msgs)

        raw_inputs = [image_1, image_2, image_3, image_4, image_5, image_6, image_7, image_8, image_9]
        image_tensors = [(f"图像 {i+1}", img) for i, img in enumerate(raw_inputs) if img is not None]

        failed_images = []
        total_frames = 0

        if image_tensors:
            content = []
            for img_name, img_tensor in image_tensors:
                b64_list = _tensor_to_base64(img_tensor, batch_mode=batch_mode, max_size=max_image_size)
                if not b64_list:
                    failed_images.append(img_name)
                    continue
                for b64 in b64_list:
                    content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
                    total_frames += 1

            if not content:
                return ("", "❌ 所有图像编码失败", _serialize_history(history_msgs), None)

            prompt_txt = user_prompt.strip() or (f"描述这 {total_frames} 张图片" if total_frames > 1 else "描述这张图片")
            content.append({"type": "text", "text": prompt_txt + get_user_suffix(prompt_model_type)})
            current_user_msg = {"role": "user", "content": content}
        else:
            prompt_txt = user_prompt.strip()
            if not prompt_txt:
                return ("", "❌ 请输入提示词", _serialize_history(history_msgs), None)
            current_user_msg = {"role": "user", "content": prompt_txt + get_user_suffix(prompt_model_type)}

        api_messages.append(current_user_msg)

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

        ok, data, err, elapsed = self._request(f"{url}/chat/completions", headers, payload)
        if not ok:
            return ("", f"❌ {err}", _serialize_history(history_msgs), None)

        try:
            choices = data.get("choices", [])
            if not choices:
                return ("", "⚠️ 模型返回空 choices", _serialize_history(history_msgs), None)

            message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
            text = message.get("content", "").strip() if isinstance(message, dict) else ""
            if not text:
                return ("", "⚠️ 模型返回空内容", _serialize_history(history_msgs), None)

            if filter_intro:
                text = _filter_intro(text)
            text = _format_prompt_output(text, prompt_model_type)

            updated_history = history_msgs + [
                {"role": "user", "content": prompt_txt},
                {"role": "assistant", "content": text},
            ]
            new_history = _serialize_history(updated_history)

            # 尝试从响应中提取图片
            out_images = _extract_images_from_text(text)
            image_tensor = None
            if out_images:
                try:
                    base_w, base_h = out_images[0].size
                    same_size = all(img.size == (base_w, base_h) for img in out_images)
                    if same_size and len(out_images) > 1:
                        image_tensor = torch.cat([_pil_to_tensor(img) for img in out_images], dim=0)
                    else:
                        image_tensor = _pil_to_tensor(out_images[0])
                        if len(out_images) > 1:
                            logger.info(f"[LocalLLM] 检测到 {len(out_images)} 张输出图像但尺寸不一致，仅输出第一张")
                except Exception as e:
                    logger.warning(f"[LocalLLM] 图像张量转换失败: {e}")
                    image_tensor = None

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

            return (text, status, new_history, image_tensor)

        except Exception as e:
            return ("", f"❌ 解析失败: {e}", _serialize_history(history_msgs), None)


__all__ = ["EagleLocalLLMNode", "EagleLocalLLMServerNode"]
