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
import re
import json
import base64
import io
import time
import gc
import shutil
import math
import glob
import tempfile
import subprocess
import requests
import ipaddress
import socket
from urllib.parse import urlparse
import torch
import numpy as np
from PIL import Image

from .utils import decode_api_key
from .logger import logger

# llama.cpp 可选依赖：聊天处理器（多模态支持）
try:
    from llama_cpp.llama_chat_format import Qwen3VLChatHandler
except Exception:
    Qwen3VLChatHandler = None
try:
    from llama_cpp.llama_chat_format import Qwen35ChatHandler
except Exception:
    Qwen35ChatHandler = None


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


def _filter_think_blocks(text: str) -> str:
    """过滤 Qwen3 等模型的 <think>...</think> 推理块。"""
    if not text:
        return text
    return re.sub(r"<think>[\s\S]*?</think>", "", text).strip()


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


def unload_local_models() -> int:
    """释放此扩展缓存的 Transformers 生成模型，供设置页和显存互斥策略调用。"""
    count = len(_MODEL_CACHE)
    _MODEL_CACHE.clear()
    try:
        import gc
        gc.collect()
    except Exception:
        pass
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    logger.info(f"[LocalLLM] 已释放 {count} 个本地生成模型缓存")
    return count


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


def _get_model_search_roots() -> list:
    """返回所有应扫描的模型根目录：ComfyUI 标准目录 + folder_paths 额外映射路径。

    每个元素为 (root_path, display_prefix)。当模型直接放在 llm/ 或 text_encoders/
    根目录下时，display_prefix 为空，UI 中不再显示多余的上层层级。
    """
    roots = []
    seen = set()

    def _add(path: str, prefix: str = ""):
        if not path:
            return
        norm = os.path.normcase(os.path.abspath(path))
        if norm not in seen and os.path.isdir(path):
            seen.add(norm)
            roots.append((path, prefix))

    # 1) folder_paths 注册的额外路径（extra_model_paths.yaml 等映射）
    try:
        import folder_paths
        for name in ("LLM", "llm", "text_encoders"):
            try:
                for p in folder_paths.get_folder_paths(name):
                    _add(p, "")  # 直接映射到 llm/text_encoders 根，前缀为空
            except Exception:
                pass
        # 2) 基于 models_dir 的标准子目录（兼容大小写）
        base = folder_paths.models_dir
        for name in ("LLM", "llm", "text_encoders"):
            _add(os.path.join(base, name), "")
    except Exception:
        pass

    # 3) 回退：从本文件推导的 models 目录
    if not roots:
        base = _get_comfy_models_dir()
        for name in ("LLM", "llm", "text_encoders"):
            _add(os.path.join(base, name), "")

    return roots


def _model_dir_name(path: str, root_path: str = None) -> str:
    """把完整模型路径简化为相对于扫描根的显示名；无法相对时返回文件名。"""
    base = root_path if root_path else _get_comfy_models_dir()
    try:
        rel = os.path.relpath(path, base).replace("\\", "/")
        return rel
    except Exception:
        return os.path.basename(path)


def _scan_local_models() -> list:
    """递归扫描所有模型根目录，寻找含 config.json 的 Transformers 模型。

    显示名仍相对于扫描根，因此不会带出 models/ComfyUI 等上层路径。
    """
    candidates = []
    for root_path, _ in _get_model_search_roots():
        for root, dirs, files in os.walk(root_path):
            dirs.sort()
            if "config.json" in files:
                candidates.append((root, root_path))
                # 找到模型目录后不再继续深入该目录，避免重复列出 tokenizer/processor 子目录。
                dirs[:] = []
    return sorted(set(candidates), key=lambda item: _model_dir_name(item[0], item[1]).lower())


def _scan_gguf_models() -> list:
    """递归扫描所有模型根目录下的 .gguf 主模型文件（排除 mmproj）。"""
    candidates = []
    for root_path, _ in _get_model_search_roots():
        for root, dirs, files in os.walk(root_path):
            dirs.sort()
            for f in sorted(files):
                if f.lower().endswith(".gguf") and "mmproj" not in f.lower():
                    candidates.append((os.path.join(root, f), root_path))
    return sorted(set(candidates), key=lambda item: _model_dir_name(item[0], item[1]).lower())


def _scan_mmproj_models() -> list:
    """递归扫描所有模型根目录下的视觉投影 mmproj 文件。"""
    candidates = []
    for root_path, _ in _get_model_search_roots():
        for root, dirs, files in os.walk(root_path):
            dirs.sort()
            for f in sorted(files):
                if f.lower().endswith(".gguf") and "mmproj" in f.lower():
                    candidates.append((os.path.join(root, f), root_path))
    return sorted(set(candidates), key=lambda item: _model_dir_name(item[0], item[1]).lower())


def _resolve_model_path_by_name(name_or_path: str) -> str:
    """把加载器下拉的显示名（根目录下直接子项名称）或完整路径解析为真实路径。"""
    s = (name_or_path or "").strip()
    if not s:
        return ""
    if os.path.isfile(s) or os.path.isdir(s):
        return s

    # 1) 尝试 folder_paths 的 full_path（覆盖额外映射）
    try:
        import folder_paths
        for name in ("LLM", "llm", "text_encoders"):
            try:
                p = folder_paths.get_full_path(name, s)
                if p and os.path.exists(p):
                    return p
            except Exception:
                pass
    except Exception:
        pass

    # 2) 在所有扫描根目录下直接查找该名称（兼容大小写）
    for root_path, _ in _get_model_search_roots():
        p = os.path.join(root_path, s)
        if os.path.exists(p):
            return p
        try:
            for entry in os.listdir(root_path):
                if entry == s or entry.lower() == s.lower():
                    return os.path.join(root_path, entry)
        except Exception:
            continue

    # 3) 最后回退到 models_dir
    models_dir = _get_comfy_models_dir()
    p = os.path.join(models_dir, s)
    if os.path.exists(p):
        return p
    return s


def _normalize_model_path(path_or_name: str) -> str:
    """支持填写直接子项名、xxx 或完整路径。"""
    s = path_or_name.strip()
    if not s:
        return ""
    resolved = _resolve_model_path_by_name(s)
    if os.path.isdir(resolved) and os.path.exists(os.path.join(resolved, "config.json")):
        return resolved
    # 兼容旧写法：直接子目录名
    for root_path, _ in _get_model_search_roots():
        p = os.path.join(root_path, s)
        if os.path.isdir(p) and os.path.exists(os.path.join(p, "config.json")):
            return p
    return resolved


def _list_loader_model_entries() -> tuple:
    """返回 (display_names, paths)，包含 transformers 目录与 gguf 主模型。"""
    transformers = _scan_local_models()
    gguf = _scan_gguf_models()
    items = transformers + gguf
    names = [_model_dir_name(p, root) for p, root in items]
    paths = [p for p, _ in items]
    return names, paths


def _list_mmproj_entries() -> tuple:
    """返回 (display_names, paths) 的 mmproj 列表。"""
    mmproj = _scan_mmproj_models()
    names = [_model_dir_name(p, root) for p, root in mmproj]
    paths = [p for p, _ in mmproj]
    return names, paths


def _get_ffmpeg_binary() -> str:
    """定位 ComfyUI 自带的 ffmpeg；找不到返回空串。"""
    found = shutil.which("ffmpeg")
    if found:
        return found
    models_dir = _get_comfy_models_dir()
    comfy_root = os.path.dirname(models_dir)
    for base in (comfy_root, os.path.abspath(os.path.join(comfy_root, ".."))):
        for name in ("ffmpeg", "ffmpeg.exe"):
            p = os.path.join(base, "python", name)
            if os.path.isfile(p):
                return p
    return ""


def _get_video_duration(video_path: str, ffmpeg: str) -> float:
    """用 ffmpeg 解析视频时长（秒），失败返回 0。"""
    try:
        proc = subprocess.run(
            [ffmpeg, "-hide_banner", "-i", video_path],
            capture_output=True, text=True, timeout=30,
        )
        out = proc.stderr
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", out)
        if m:
            h, mm, ss = map(float, [m.group(1), m.group(2), m.group(3)])
            return h * 3600 + mm * 60 + ss
    except Exception:
        pass
    return 0.0


def _extract_video_frames(video_path: str, max_frames: int = 8, max_size: int = 1024):
    """用 ffmpeg 从视频均匀抽帧，返回 (base64_list, error_msg)。"""
    if not video_path or not os.path.isfile(video_path):
        return None, f"视频文件不存在: {video_path}"
    ffmpeg = _get_ffmpeg_binary()
    if not ffmpeg:
        return None, "未找到 ffmpeg，无法抽帧（可改用图像序列输入）"
    tmp = tempfile.mkdtemp(prefix="eagle_vid_")
    try:
        duration = _get_video_duration(video_path, ffmpeg)
        # 估算帧步长（假设约 30fps），保证全片均匀抽帧
        est_total = max(1, int(duration * 30)) if duration > 0 else max_frames * 4
        step = max(1, int(est_total / max_frames))
        out_pattern = os.path.join(tmp, "f%05d.jpg")
        vf = f"select=not(mod(n\\,{step})),scale='min({max_size},iw)':-2"
        cmd = [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-i", video_path,
            "-vf", vf, "-vsync", "vfr", "-frames:v", str(max_frames * 4), out_pattern,
        ]
        subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=180)
        files = sorted(glob.glob(os.path.join(tmp, "*.jpg")))
        if not files:
            return None, "ffmpeg 抽帧失败（视频可能无视频流或编码不支持）"
        if len(files) > max_frames:
            idxs = [round(i * (len(files) - 1) / (max_frames - 1)) for i in range(max_frames)]
            files = [files[i] for i in idxs]
        results = []
        for fp in files:
            try:
                with open(fp, "rb") as fh:
                    results.append(base64.b64encode(fh.read()).decode("utf-8"))
            except Exception:
                continue
        return results, ""
    except subprocess.TimeoutExpired:
        return None, "ffmpeg 抽帧超时"
    except Exception as e:
        return None, f"抽帧异常: {e}"
    finally:
        try:
            shutil.rmtree(tmp, ignore_errors=True)
        except Exception:
            pass


def _model_generation_capability(path: str, source: str) -> tuple[bool, str]:
    """根据 config.json 做保守能力判断，避免把纯编码器当作生成模型。"""
    if source.lower() == "llm":
        return True, "LLM 目录"
    try:
        with open(os.path.join(path, "config.json"), "r", encoding="utf-8") as handle:
            config = json.load(handle) or {}
        architectures = config.get("architectures") or []
        if isinstance(architectures, str):
            architectures = [architectures]
        names = " ".join(str(value) for value in list(architectures) + [config.get("model_type", "")]).lower()
        markers = (
            "causallm", "conditionalgeneration", "vision2seq", "imagetexttotext",
            "qwen", "llava", "mllama", "gemma", "phi3", "chatglm",
        )
        capable = any(marker in names for marker in markers)
        return capable, "配置声明生成架构" if capable else "纯文本编码器/未知架构"
    except Exception as error:
        return False, f"配置读取失败: {error}"


def list_local_models() -> list:
    """供其他 Eagle 节点复用的本地模型清单。"""
    models = []
    models_dir = _get_comfy_models_dir()
    for path, root in _scan_local_models():
        rel = _model_dir_name(path, root)
        source = rel.split("/", 1)[0] if "/" in rel else "models"
        generative, reason = _model_generation_capability(path, source)
        models.append({
            "name": rel,
            "path": path,
            "source": source,
            "generative": generative,
            "capability_reason": reason,
            "models_dir": models_dir,
        })
    return models


def _resolve_dtype(dtype_str: str):
    if dtype_str == "bf16":
        return torch.bfloat16
    if dtype_str == "fp16":
        return torch.float16
    return torch.float32


def _load_local_model(model_path: str, device: str, dtype_str: str):
    """加载本地 transformers 模型与 processor，带缓存。"""
    from transformers import (
        AutoProcessor,
        AutoTokenizer,
        AutoModelForImageTextToText,
        AutoModelForVision2Seq,
        AutoModelForCausalLM,
        AutoModelForSeq2SeqLM,
    )

    key = f"{model_path}||{device}||{dtype_str}"
    if key in _MODEL_CACHE:
        return _MODEL_CACHE[key]

    dtype = _resolve_dtype(dtype_str)
    logger.info(f"[LocalLLM] 正在加载本地模型: {model_path} (device={device}, dtype={dtype_str})")
    start = time.time()

    try:
        processor = AutoProcessor.from_pretrained(model_path, trust_remote_code=False, local_files_only=True)
    except Exception as processor_error:
        try:
            processor = AutoTokenizer.from_pretrained(model_path, trust_remote_code=False, local_files_only=True)
        except Exception as tokenizer_error:
            raise RuntimeError(f"加载 Processor/Tokenizer 失败: {processor_error}; {tokenizer_error}")

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
    for model_cls in (
        AutoModelForImageTextToText,
        AutoModelForVision2Seq,
        AutoModelForCausalLM,
        AutoModelForSeq2SeqLM,
    ):
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


def generate_local_text(
    model_path: str,
    system_prompt: str,
    user_prompt: str,
    device: str = "auto",
    dtype: str = "bf16",
    max_new_tokens: int = 512,
    temperature: float = 0.8,
    top_p: float = 0.95,
) -> str:
    """使用与本地反推节点相同的缓存执行纯文本生成。"""
    resolved = _normalize_model_path(model_path)
    if not resolved or not os.path.isdir(resolved):
        raise ValueError(f"本地模型路径不存在: {model_path}")
    if not os.path.isfile(os.path.join(resolved, "config.json")):
        raise ValueError(f"本地模型缺少 config.json: {resolved}")

    actual_device = device if device in {"auto", "cuda", "cpu"} else "auto"
    if actual_device == "cuda" and not torch.cuda.is_available():
        actual_device = "cpu"
    actual_dtype = dtype if dtype in {"bf16", "fp16", "fp32"} else "bf16"
    if (actual_device == "cpu" or (actual_device == "auto" and not torch.cuda.is_available())) and actual_dtype == "fp16":
        actual_dtype = "fp32"

    model, processor = _load_local_model(resolved, actual_device, actual_dtype)
    messages = []
    if system_prompt.strip():
        messages.append({"role": "system", "content": system_prompt.strip()})
    messages.append({"role": "user", "content": user_prompt.strip()})

    try:
        if hasattr(processor, "apply_chat_template"):
            prompt_text = processor.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        else:
            prompt_text = "\n\n".join(
                f"{item['role'].upper()}: {item['content']}" for item in messages
            ) + "\n\nASSISTANT:"
        inputs = processor(text=[prompt_text], return_tensors="pt", padding=True)
        target_device = next(model.parameters()).device
        inputs = {
            key: value.to(target_device) if isinstance(value, torch.Tensor) else value
            for key, value in inputs.items()
        }
        generation = {
            "max_new_tokens": max(32, min(2048, int(max_new_tokens))),
            "do_sample": temperature > 0,
        }
        if generation["do_sample"]:
            generation["temperature"] = max(0.05, min(2.0, float(temperature)))
            generation["top_p"] = max(0.05, min(1.0, float(top_p)))
        with torch.inference_mode():
            output_ids = model.generate(**inputs, **generation)
        prompt_len = inputs.get("input_ids").shape[1] if inputs.get("input_ids") is not None else 0
        generated_ids = output_ids[:, prompt_len:] if prompt_len else output_ids
        return processor.batch_decode(generated_ids, skip_special_tokens=True)[0].strip()
    except Exception as error:
        raise RuntimeError(f"本地模型文本生成失败: {error}") from error


# ═══════════════════════════════════════════════════════════════
#  模型句柄封装
# ═══════════════════════════════════════════════════════════════

def _map_kv_cache_type(label: str) -> str | None:
    """把 UI 显示的 KV 缓存类型映射为 llama.cpp 内部值；默认(F16) 表示不强制指定。"""
    if not label:
        return None
    s = str(label).strip().lower()
    if s in ("默认(f16)", "默认", "f16", "fp16"):
        return None
    if "q8_0" in s:
        return "q8_0"
    if "q4_0" in s:
        return "q4_0"
    return s if s else None


def _create_chat_handler(mmproj_path: str, model_series: str, thinking: bool, keep_history_think: bool):
    """根据模型系列创建 llama.cpp 多模态 chat_handler。"""
    if not mmproj_path or not os.path.isfile(mmproj_path):
        return None

    def _try_handler(handler_cls, **kwargs):
        try:
            return handler_cls(mmproj_path=mmproj_path, **kwargs)
        except TypeError as exc:
            error_text = str(exc)
            if "mmproj_path" in error_text and "unexpected" in error_text.lower():
                return handler_cls(clip_model_path=mmproj_path, **kwargs)
            if "clip_model_path" in error_text and "required" in error_text.lower():
                return handler_cls(clip_model_path=mmproj_path, **kwargs)
            raise

    if model_series == "Qwen3-VL" and Qwen3VLChatHandler is not None:
        for kw in ({"force_reasoning": thinking, "verbose": False},
                   {"use_think_prompt": thinking, "verbose": False},
                   {"verbose": False}):
            try:
                return _try_handler(Qwen3VLChatHandler, **kw)
            except TypeError:
                continue
        return None

    if model_series in ("Qwen3.5-VL", "Qwen3.6-VL", "Qwen3.8-VL") and Qwen35ChatHandler is not None:
        candidates = [
            {"enable_thinking": thinking, "add_vision_id": True, "preserve_thinking": keep_history_think, "verbose": False},
            {"enable_thinking": thinking, "preserve_thinking": keep_history_think, "verbose": False},
            {"enable_thinking": thinking, "add_vision_id": True, "verbose": False},
            {"enable_thinking": thinking, "verbose": False},
        ]
        for kw in candidates:
            try:
                return _try_handler(Qwen35ChatHandler, **kw)
            except TypeError:
                continue
        return None

    return None


def _create_local_llm_handle(model_path: str, device: str, dtype: str,
                              model_series: str = "Auto", enable_thinking: bool = False,
                              keep_history_think: bool = False, qwen38_reasoning_effort: str = "xhigh"):
    """加载本地模型并封装为可在节点间传递的句柄。"""
    resolved = _normalize_model_path(model_path)
    if not resolved or not os.path.isdir(resolved):
        raise ValueError(f"本地模型路径不存在或无效: {model_path}")
    if not os.path.exists(os.path.join(resolved, "config.json")):
        raise ValueError(f"路径下缺少 config.json，不是有效的 transformers 模型: {resolved}")

    actual_device = device if device in {"auto", "cuda", "cpu"} else "auto"
    if actual_device == "cuda" and not torch.cuda.is_available():
        actual_device = "cpu"
    actual_dtype = dtype if dtype in {"bf16", "fp16", "fp32"} else "bf16"
    if (actual_device == "cpu" or (actual_device == "auto" and not torch.cuda.is_available())) and actual_dtype == "fp16":
        actual_dtype = "fp32"

    model, processor = _load_local_model(resolved, actual_device, actual_dtype)
    return {
        "backend": "transformers",
        "model": model,
        "processor": processor,
        "device": actual_device,
        "dtype": actual_dtype,
        "path": resolved,
        "model_series": model_series,
        "thinking": enable_thinking,
        "keep_history_think": keep_history_think,
        "qwen38_reasoning_effort": qwen38_reasoning_effort,
    }


def _create_llamacpp_handle(gguf_path: str, mmproj_path: str,
                            n_ctx: int = 8192, n_gpu_layers: int = -1,
                            kv_cache_type_k: str = "默认(F16)", kv_cache_type_v: str = "默认(F16)",
                            thinking: bool = False, thinking_budget: int = 4096,
                            model_series: str = "Auto", keep_history_think: bool = False,
                            moe_experts_on_cpu: bool = False, first_n_layers_on_cpu: int = 0,
                            qwen38_reasoning_effort: str = "xhigh"):
    """加载 GGUF（llama.cpp）模型与可选 mmproj 视觉投影，封装为句柄。"""
    try:
        from llama_cpp import Llama
        import inspect
    except Exception as e:
        raise RuntimeError(
            "未安装 llama-cpp-python，无法加载 GGUF。请安装对应 wheel"
            "（可参考 ComfyUI TE 整合包），装好后重启 ComfyUI。"
        )

    if not gguf_path or not os.path.isfile(gguf_path):
        raise ValueError(f"GGUF 主模型文件不存在: {gguf_path}")

    type_k = _map_kv_cache_type(kv_cache_type_k)
    type_v = _map_kv_cache_type(kv_cache_type_v)

    load_kwargs = {
        "model_path": gguf_path,
        "n_ctx": int(n_ctx),
        "n_gpu_layers": int(n_gpu_layers),
        "verbose": False,
    }
    if type_k is not None:
        load_kwargs["type_k"] = type_k
    if type_v is not None:
        load_kwargs["type_v"] = type_v

    mmproj_resolved = _resolve_model_path_by_name(mmproj_path) if mmproj_path and mmproj_path != _MMPROJ_NONE else ""
    if mmproj_resolved and os.path.isfile(mmproj_resolved):
        chat_handler = _create_chat_handler(
            mmproj_resolved, model_series, thinking, keep_history_think
        )
        if chat_handler is not None:
            load_kwargs["chat_handler"] = chat_handler
        else:
            load_kwargs["mmproj"] = mmproj_resolved

    # MoE 参数：在 Qwen3.5/3.6/3.8（MoE 架构）且 llama-cpp 支持时传入
    if model_series in ("Qwen3.5-VL", "Qwen3.6-VL", "Qwen3.8-VL"):
        sig = inspect.signature(Llama.__init__)
        params = sig.parameters
        wants_cpu_moe = moe_experts_on_cpu
        wants_n_cpu_moe = first_n_layers_on_cpu > 0 and not moe_experts_on_cpu
        if wants_cpu_moe and "cpu_moe" in params:
            load_kwargs["cpu_moe"] = True
        elif wants_n_cpu_moe and "n_cpu_moe" in params:
            load_kwargs["n_cpu_moe"] = int(first_n_layers_on_cpu)

    llm = Llama(**load_kwargs)
    return {
        "backend": "llama.cpp",
        "llm": llm,
        "mmproj": mmproj_resolved if (mmproj_resolved and os.path.isfile(mmproj_resolved)) else None,
        "model_series": model_series,
        "thinking": thinking,
        "keep_history_think": keep_history_think,
        "thinking_budget": thinking_budget,
        "moe_experts_on_cpu": moe_experts_on_cpu,
        "first_n_layers_on_cpu": first_n_layers_on_cpu,
        "qwen38_reasoning_effort": qwen38_reasoning_effort,
        "params": {
            "n_ctx": n_ctx,
            "n_gpu_layers": n_gpu_layers,
            "cache_type_k": kv_cache_type_k,
            "cache_type_v": kv_cache_type_v,
        },
        "path": gguf_path,
    }


def _run_llamacpp_inference(llm, pil_images, user_text, system_text,
                            max_new_tokens, temperature, top_p, do_sample, seed,
                            thinking=False, thinking_budget=4096,
                            repetition_penalty=1.0):
    """用 llama.cpp 的 Llama 实例做多模态推理，返回 (text, error, elapsed)。"""
    if llm is None:
        return "", "❌ llama.cpp 句柄缺少 llm 实例", 0.0
    try:
        content = []
        for img in pil_images:
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=90, optimize=True)
            b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
            content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
        if not user_text:
            user_text = "描述这张图片" if pil_images else "请回答。"
        content.append({"type": "text", "text": user_text})

        messages = []
        if system_text:
            messages.append({"role": "system", "content": system_text})
        messages.append({"role": "user", "content": content})

        gen_kwargs = {
            "max_tokens": int(max_new_tokens),
            "temperature": float(temperature) if do_sample else 0.0,
            "top_p": float(top_p),
            "repeat_penalty": float(repetition_penalty),
        }
        if seed >= 0:
            gen_kwargs["seed"] = int(seed)
        # 注：llama.cpp 的思考由加载时的 chat handler 决定，这里不强行传参以免报错；
        # thinking 开关主要体现在 transformers 路径（enable_thinking）。

        start = time.time()
        resp = llm.create_chat_completion(messages=messages, **gen_kwargs)
        elapsed = time.time() - start
        text = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
        return text, "", elapsed
    except Exception as e:
        return "", f"❌ llama.cpp 推理失败: {e}", 0.0


# ═══════════════════════════════════════════════════════════════
#  EagleLocalLLMLoader — 外部模型加载器（可被多个反推节点复用）
# ═══════════════════════════════════════════════════════════════

# UI 显示中文，内部处理仍用英文 key
_MODEL_SERIES_LABELS = {
    "自动探测": "Auto",
    "通义千问3-VL": "Qwen3-VL",
    "通义千问3.5-VL": "Qwen3.5-VL",
    "通义千问3.6-VL": "Qwen3.6-VL",
    "通义千问3.8-VL(社区/自定义)": "Qwen3.8-VL",
    "LLaVA": "LLaVA",
    "其他": "Other",
}

# mmproj 下拉“不使用视觉投影”的哨兵值
_MMPROJ_NONE = "无"

class EagleLocalLLMLoader:
    """🦅 本地大模型加载器（双模式：transformers 非量化 / llama.cpp GGUF）

    将本地模型加载为可在节点间复用的句柄，供 EagleLocalLLMNode 通过 model 端口接入，
    避免重复加载。支持：
    - transformers：非量化全模型（safetensors 整包）
    - llama.cpp：GGUF 量化模型 + 可选 mmproj 视觉投影（需 llama-cpp-python）
    """

    @classmethod
    def INPUT_TYPES(cls):
        model_names, _ = _list_loader_model_entries()
        default_model = model_names[0] if model_names else ""
        mmproj_names, _ = _list_mmproj_entries()
        default_mmproj = mmproj_names[0] if mmproj_names else ""

        # 与 comfyUI-llama-TE 字段顺序保持一致
        return {
            "required": {
                "model_series": (list(_MODEL_SERIES_LABELS.keys()), {"default": "自动探测"}),
                "model_path": (model_names + [""], {
                    "default": default_model,
                    "multiline": False,
                    "placeholder": "选择模型：transformers 目录 或 .gguf 主模型"
                }),
                "mmproj_path": ([_MMPROJ_NONE] + mmproj_names, {
                    "default": _MMPROJ_NONE,
                    "multiline": False,
                    "placeholder": "视觉投影 mmproj（选“无”则不绑定 mmproj，可加载纯文本/音频等非 VLM 模型）"
                }),
                "enable_thinking": ("BOOLEAN", {"default": False, "label_on": "思考", "label_off": "直接回答"}),
                "keep_history_think": ("BOOLEAN", {"default": False, "label_on": "保留", "label_off": "不保留"}),
                "n_ctx": ("INT", {"default": 8192, "min": 512, "max": 327680, "step": 256}),
                "n_gpu_layers": ("INT", {"default": -1, "min": -1, "max": 9999, "step": 1}),
                "kv_cache_type_k": (["默认(F16)", "q8_0"], {"default": "默认(F16)"}),
                "kv_cache_type_v": (["默认(F16)", "q8_0"], {"default": "默认(F16)"}),
                "moe_experts_on_cpu": ("BOOLEAN", {"default": False, "label_on": "开启", "label_off": "关闭"}),
                "first_n_layers_on_cpu": ("INT", {"default": 0, "min": 0, "max": 256, "step": 1}),
                "qwen38_reasoning_effort": (["xhigh", "medium", "low"], {"default": "xhigh"}),
            },
            "optional": {
                "device": (["auto", "cuda", "cpu"], {"default": "auto"}),
                "dtype": (["bf16", "fp16", "fp32"], {"default": "bf16"}),
                "thinking_budget": ("INT", {"default": 4096, "min": 0, "max": 32768, "step": 256}),
            }
        }

    RETURN_TYPES = ("EAGLE_LOCAL_LLM_MODEL", "STRING")
    RETURN_NAMES = ("model", "状态")
    FUNCTION = "load"
    CATEGORY = "🦅 Eagle/API"
    OUTPUT_NODE = False

    def load(self, model_series, model_path, mmproj_path, enable_thinking, keep_history_think,
             n_ctx, n_gpu_layers, kv_cache_type_k, kv_cache_type_v,
             moe_experts_on_cpu, first_n_layers_on_cpu, qwen38_reasoning_effort,
             device="auto", dtype="bf16", thinking_budget=4096):
        try:
            # UI 中文标签映射回内部英文 key
            model_series = _MODEL_SERIES_LABELS.get(model_series, model_series)

            resolved = _resolve_model_path_by_name(model_path)
            if not resolved:
                return ({}, "❌ 未选择模型")
            is_gguf = resolved.lower().endswith(".gguf")

            # 模型系列自动推断（仅用于 llama.cpp 选择 chat handler / MoE 参数）
            inferred_series = model_series
            if inferred_series == "Auto" and is_gguf:
                base = os.path.basename(resolved).lower()
                if "qwen3.8" in base:
                    inferred_series = "Qwen3.8-VL"
                elif "qwen3.6" in base:
                    inferred_series = "Qwen3.6-VL"
                elif "qwen3.5" in base:
                    inferred_series = "Qwen3.5-VL"
                elif "qwen3" in base:
                    inferred_series = "Qwen3-VL"
                elif "llava" in base:
                    inferred_series = "LLaVA"

            common_kwargs = {
                "model_series": inferred_series,
                "enable_thinking": enable_thinking,
                "keep_history_think": keep_history_think,
                "qwen38_reasoning_effort": qwen38_reasoning_effort,
            }

            # 自动根据文件类型选择后端：.gguf -> llama.cpp，目录 -> transformers
            if is_gguf:
                mmproj = _resolve_model_path_by_name(mmproj_path) if mmproj_path and mmproj_path != _MMPROJ_NONE else ""
                handle = _create_llamacpp_handle(
                    resolved, mmproj,
                    n_ctx=n_ctx, n_gpu_layers=n_gpu_layers,
                    kv_cache_type_k=kv_cache_type_k, kv_cache_type_v=kv_cache_type_v,
                    thinking=enable_thinking, thinking_budget=thinking_budget,
                    moe_experts_on_cpu=moe_experts_on_cpu,
                    first_n_layers_on_cpu=first_n_layers_on_cpu,
                    **common_kwargs,
                )
                rel = os.path.basename(handle["path"])
                status = (f"✅ [llama.cpp] 已加载: {rel} | n_gpu_layers={n_gpu_layers} "
                          f"| kv={kv_cache_type_k}/{kv_cache_type_v} | 思考={enable_thinking}")
            else:
                handle = _create_local_llm_handle(resolved, device, dtype, **common_kwargs)
                rel = os.path.basename(handle["path"])
                status = (f"✅ [transformers] 已加载: {rel} | device={handle['device']} "
                          f"| dtype={handle['dtype']} | 思考={enable_thinking}")

            handle["thinking"] = enable_thinking
            handle["thinking_budget"] = thinking_budget
            return (handle, status)
        except Exception as e:
            return ({}, f"❌ 模型加载失败: {e}")


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
        model_names = [_model_dir_name(p, root) for p, root in models]
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
                "repetition_penalty": ("FLOAT", {"default": 1.0, "min": 1.0, "max": 2.0, "step": 0.05, "tooltip": ">1.0 时抑制重复 token，对标签提取/密集描述比较实用"}),
                "batch_mode": (["first", "all"], {"default": "first"}),
                "max_image_size": ("INT", {"default": 1024, "min": 224, "max": 4096, "step": 64}),
                "seed": ("INT", {"default": -1, "min": -1, "max": 2147483647, "step": 1, "control_after_generate": True}),
                "output_think": ("BOOLEAN", {"default": False, "label_on": "输出", "label_off": "过滤", "tooltip": "是否保留 Qwen3 等模型的 <think>...</think> 推理块"}),
            },
            "optional": {
                "model": ("EAGLE_LOCAL_LLM_MODEL", {"forceInput": True}),
                "qwen_model": ("QWENLLAMA", {"forceInput": True, "tooltip": "可直接接入 comfyUI-llama-TE 的 Qwen llama TE 模型加载器输出"}),
                "history": ("STRING", {"default": "", "multiline": True, "forceInput": True}),
                "video": ("VIDEO", {"tooltip": "视频帧序列，连接 Load Video / 加载视频 等节点输出"}),
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
                max_new_tokens, temperature, top_p, do_sample, repetition_penalty,
                batch_mode, max_image_size, seed, output_think,
                history="", model=None, qwen_model=None,
                video=None,
                image_1=None, image_2=None, image_3=None,
                image_4=None, image_5=None, image_6=None,
                image_7=None, image_8=None, image_9=None):

        # 1. 解析并加载模型：优先使用外部加载器传入的模型句柄（双后端）
        backend = "transformers"
        thinking = False
        thinking_budget = 4096
        processor = None

        # 1.1 优先接入 comfyUI-llama-TE 的 QWENLLAMA 输出（解决“接口不通用”问题）
        if qwen_model is not None and hasattr(qwen_model, "llm") and qwen_model.llm is not None:
            backend = "llama.cpp"
            model_obj = qwen_model.llm
            settings = getattr(qwen_model, "settings", {}) or {}
            thinking = bool(settings.get("think", False))
            thinking_budget = int(settings.get("thinking_budget", 4096) or 4096)
            resolved = getattr(qwen_model, "path", "") or settings.get("model", "")
            loaded_by = "TE加载器(QWENLLAMA)"
        elif model and isinstance(model, dict) and model.get("backend") == "llama.cpp" and model.get("llm") is not None:
            backend = "llama.cpp"
            model_obj = model["llm"]
            thinking = model.get("thinking", False)
            thinking_budget = model.get("thinking_budget", 4096)
            resolved = model.get("path", "")
            loaded_by = "外部加载器(llama.cpp)"
        elif model and isinstance(model, dict) and model.get("model") and model.get("processor"):
            model_obj = model["model"]
            processor = model["processor"]
            resolved = model.get("path", "")
            thinking = model.get("thinking", False)
            thinking_budget = model.get("thinking_budget", 4096)
            loaded_by = "外部加载器"
        else:
            resolved = _normalize_model_path(model_path)
            if not resolved or not os.path.isdir(resolved):
                return ("", f"❌ 模型路径不存在或无效: {model_path}", history)
            if not os.path.exists(os.path.join(resolved, "config.json")):
                return ("", f"❌ 路径下缺少 config.json，不是有效的 transformers 模型: {resolved}", history)

            try:
                model_obj, processor = _load_local_model(resolved, device, dtype)
                loaded_by = "本节点"
            except Exception as e:
                return ("", f"❌ 模型加载失败: {e}", history)

        model = model_obj

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
        #    支持 9 路独立图像、以及 video 端口输入的视频帧序列（IMAGE 批次）
        raw_inputs = [image_1, image_2, image_3, image_4, image_5, image_6, image_7, image_8, image_9, video]
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

        # 7. 推理（按 backend 分流）
        try:
            if backend == "llama.cpp":
                text, err, elapsed = _run_llamacpp_inference(
                    model, pil_images, prompt_txt, sys_prompt,
                    max_new_tokens, temperature, top_p, do_sample, seed,
                    thinking, thinking_budget, repetition_penalty)
                if err:
                    return ("", err, _serialize_history(history_msgs))
            else:
                try:
                    text = processor.apply_chat_template(
                        messages, tokenize=False, add_generation_prompt=True,
                        enable_thinking=thinking)
                except TypeError:
                    text = processor.apply_chat_template(
                        messages, tokenize=False, add_generation_prompt=True)
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
                    "repetition_penalty": float(repetition_penalty),
                }
                if do_sample:
                    gen_kwargs["temperature"] = temperature
                    gen_kwargs["top_p"] = top_p

                start = time.time()
                with torch.inference_mode():
                    if do_sample and seed >= 0:
                        devices = [target_device] if target_device.type == "cuda" else []
                        with torch.random.fork_rng(devices=devices):
                            torch.manual_seed(seed)
                            if target_device.type == "cuda":
                                torch.cuda.manual_seed_all(seed)
                            output_ids = model.generate(**inputs, **gen_kwargs)
                    else:
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

        if not output_think:
            text = _filter_think_blocks(text)
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
        status = f"✅ {mode_icon} {mode_text} | {len(text)} 字符 | {elapsed:.2f}s | 来源:{loaded_by}{failed_note}"
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
            resp = requests.post(
                url, json=payload, headers=headers, timeout=self.timeout,
                allow_redirects=False,
            )
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
    parsed = urlparse(url)
    allowed_hosts = {"localhost", "127.0.0.1", "::1"}
    allowed_hosts.update(filter(None, os.environ.get("EAGLE_LOCAL_LLM_HOSTS", "").lower().split(",")))
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        return ""
    if parsed.hostname.lower() not in allowed_hosts:
        try:
            addresses = {
                ipaddress.ip_address(info[4][0])
                for info in socket.getaddrinfo(parsed.hostname, parsed.port or 80)
            }
        except OSError:
            return ""
        if not addresses or not all(address.is_loopback for address in addresses):
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
                "seed": ("INT", {"default": -1, "min": -1, "max": 2147483647, "step": 1, "control_after_generate": True}),
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


__all__ = [
    "EagleLocalLLMLoader",
    "EagleLocalLLMNode",
    "EagleLocalLLMServerNode",
    "list_local_models",
    "generate_local_text",
]
