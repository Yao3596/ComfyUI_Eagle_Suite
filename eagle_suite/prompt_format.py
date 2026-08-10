# -*- coding: utf-8 -*-
"""
Eagle Suite - 提示词输出格式统一模块
供 API 调用节点、本地大模型反推节点共用。

定义 5 种输出风格：
- 自然语言：通用图像描述
- SDXL：    SDXL/SD1.5 逗号分隔 tags（支持 Danbooru tags，空格不转义）
- SD3：     SD3/SD3.5 tags + 少量自然语言短语
- FLUX：    FLUX.1 详细自然语言段落
- anima：   动漫/Danbooru 风格，下划线转空格，允许少量英文描述

每种风格包含：
- system_prompt：  模型身份 + 格式约束
- user_suffix：    追加到 user prompt 末尾的格式示例
- post_processor： 后处理函数
"""

import re
from typing import Callable, Dict


# ═══════════════════════════════════════════════════════════════
#  风格定义
# ═══════════════════════════════════════════════════════════════

PROMPT_PRESETS: Dict[str, Dict[str, object]] = {
    "自然语言": {
        "system_prompt": (
            "You are a helpful image analysis assistant. "
            "Describe the image clearly and naturally in the user's language."
        ),
        "user_suffix": (
            "\n\n[输出要求]\n"
            "用自然语言描述图像内容，保持流畅。"
        ),
        "post_processor": lambda text: _clean_natural_language(text),
    },

    "SDXL": {
        "system_prompt": (
            "You are an expert image tagger for Stable Diffusion XL (SDXL/SD1.5/Pony). "
            "Analyze the image and output a high-quality prompt. "
            "Use English comma-separated tags. You may include Danbooru-style tags. "
            "Do not write full sentences or explanations."
        ),
        "user_suffix": (
            "\n\n[REQUIRED OUTPUT FORMAT]\n"
            "Output ONLY English comma-separated tags for SDXL. "
            "No sentences, no explanations. "
            "Example: masterpiece, best quality, 1girl, solo, blue hair, long hair, "
            "looking at viewer, sunlight, upper body, outdoors,"
        ),
        "post_processor": lambda text: _format_sdxl(text),
    },

    "SD3": {
        "system_prompt": (
            "You are an expert prompt engineer for Stable Diffusion 3. "
            "Analyze the image and output a concise prompt. "
            "Use English comma-separated descriptive tags and short natural phrases. "
            "Avoid long paragraphs."
        ),
        "user_suffix": (
            "\n\n[REQUIRED OUTPUT FORMAT]\n"
            "Output comma-separated English tags mixed with short natural phrases for Stable Diffusion 3. "
            "No long paragraphs, no explanations. "
            "Example: masterpiece, best quality, 1girl, solo, standing in a sunlit forest, "
            "soft lighting, detailed background,"
        ),
        "post_processor": lambda text: _format_sd3(text),
    },

    "FLUX": {
        "system_prompt": (
            "You are an expert prompt engineer for FLUX image generation models. "
            "Analyze the image and write one rich, detailed natural-language paragraph. "
            "Include subject, scene, lighting, style, mood, composition, and colors."
        ),
        "user_suffix": (
            "\n\n[REQUIRED OUTPUT FORMAT]\n"
            "Write ONE detailed natural-language paragraph for FLUX. "
            "Describe the subject, environment, lighting, style, mood, and composition. "
            "Do not output tag lists or bullet points."
        ),
        "post_processor": lambda text: _clean_natural_language(text),
    },

    "anima": {
        "system_prompt": (
            "You are an expert anime image prompt engineer. "
            "Analyze the image and output a prompt optimized for anime/Danbooru-style generation models. "
            "Use English tags separated by commas. Convert Danbooru underscores to spaces. "
            "You may include a small amount of natural English description for complex atmosphere or poses. "
            "Do not write full sentences or explanations."
        ),
        "user_suffix": (
            "\n\n[REQUIRED OUTPUT FORMAT]\n"
            "Output English comma-separated anime tags for Danbooru-style models. "
            "Convert underscores to spaces (e.g. blue_hair -> blue hair). "
            "A small amount of natural English description is allowed. "
            "Always end the prompt with a comma. "
            "Example: masterpiece, best quality, 1girl, solo, blue hair, long hair, "
            "looking at viewer, soft lighting, school uniform,"
        ),
        "post_processor": lambda text: _format_anima(text),
    },
}


# ═══════════════════════════════════════════════════════════════
#  公共工具函数
# ═══════════════════════════════════════════════════════════════

def _split_tags(text: str) -> list:
    """按逗号/换行分割 tags，过滤空值。"""
    if not text:
        return []
    parts = re.split(r"[,，\n]", text)
    return [p.strip() for p in parts if p.strip()]


def _dedup_preserve_order(items: list) -> list:
    """去重并保持顺序。"""
    seen = set()
    result = []
    for it in items:
        key = it.lower()
        if key not in seen:
            seen.add(key)
            result.append(it)
    return result


def _ensure_trailing_comma(text: str) -> str:
    """确保末尾有逗号+空格。"""
    text = text.strip()
    if not text:
        return ""
    if text.endswith(","):
        return text + " "
    return text + ", "


def _clean_natural_language(text: str) -> str:
    """自然语言清理：去除多余空行和首尾空白。"""
    if not text:
        return text
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n\n".join(lines)


# ═══════════════════════════════════════════════════════════════
#  各风格后处理
# ═══════════════════════════════════════════════════════════════

def _format_sdxl(text: str) -> str:
    """SDXL：小写、去重、末尾补逗号。保留 artist 括号原样。"""
    tags = _split_tags(text)
    # 转小写
    tags = [t.lower() for t in tags]
    # 去重
    tags = _dedup_preserve_order(tags)
    # 拼接并补末尾逗号
    return _ensure_trailing_comma(", ".join(tags))


def _format_sd3(text: str) -> str:
    """SD3：去重、末尾补逗号，保持大小写。"""
    tags = _split_tags(text)
    tags = _dedup_preserve_order(tags)
    return _ensure_trailing_comma(", ".join(tags))


def _format_anima(text: str) -> str:
    """anima：下划线转空格、去重、末尾补逗号。"""
    # 下划线转空格（但保留 weighted artist 括号内的原始格式）
    text = text.replace("_", " ")
    tags = _split_tags(text)
    tags = _dedup_preserve_order(tags)
    return _ensure_trailing_comma(", ".join(tags))


# ═══════════════════════════════════════════════════════════════
#  主入口
# ═══════════════════════════════════════════════════════════════

def get_preset(style: str) -> Dict[str, object]:
    """获取指定风格的完整配置。"""
    return PROMPT_PRESETS.get(style, PROMPT_PRESETS["自然语言"])


def get_system_prompt(style: str) -> str:
    """获取 system prompt。"""
    return str(get_preset(style).get("system_prompt", ""))


def get_user_suffix(style: str) -> str:
    """获取需要追加到 user prompt 的格式要求。"""
    return str(get_preset(style).get("user_suffix", ""))


def format_output(text: str, style: str) -> str:
    """对模型输出进行后处理。"""
    preset = get_preset(style)
    processor = preset.get("post_processor")
    if isinstance(processor, Callable):
        return processor(text)
    return text


__all__ = [
    "PROMPT_PRESETS",
    "get_preset",
    "get_system_prompt",
    "get_user_suffix",
    "format_output",
]
