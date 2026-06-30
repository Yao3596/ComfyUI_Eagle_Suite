# -*- coding: utf-8 -*-
"""
Eagle Suite 核心包（VHS 风格重构）
导出工具函数和日志
"""

from .logger import logger
from .utils import (
    get_cached_ffmpeg,
    is_safe_path,
    validate_path,
    strip_path,
    is_url,
    hash_path,
    get_sorted_dir_files,
    get_audio,
    LazyAudioMap,
    cached,
    ensure_dir,
    get_extension,
    decode_api_key,
    VIDEO_EXTENSIONS,
    IMAGE_EXTENSIONS,
    AUDIO_EXTENSIONS,
)

# 节点映射（供根 __init__.py 使用）
from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__all__ = [
    "logger",
    "get_cached_ffmpeg",
    "is_safe_path",
    "validate_path",
    "strip_path",
    "is_url",
    "hash_path",
    "get_sorted_dir_files",
    "get_audio",
    "LazyAudioMap",
    "cached",
    "ensure_dir",
    "get_extension",
    "VIDEO_EXTENSIONS",
    "IMAGE_EXTENSIONS",
    "AUDIO_EXTENSIONS",
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
]
