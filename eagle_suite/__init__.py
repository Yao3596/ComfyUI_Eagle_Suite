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

# 触发 H3 制片流水线路由登记。
from . import h3_pipeline  # noqa: F401

# ComfyUI normally creates PromptServer before importing custom nodes. During
# early import or hot reload, its instance (or route table) can still be absent.
# Register immediately when ready, otherwise retry synchronously at the end of
# the next PromptServer constructor, before ComfyUI adds the route table to app.
try:
    from server import PromptServer
    from . import api_key_node
    from .route_registry import register_all_routes, register_when_ready

    def _register_eagle_routes(server):
        register_all_routes(server)
        api_key_node.register_routes()

    register_when_ready(PromptServer, _register_eagle_routes, callback_key=__name__)
except Exception as e:
    logger.warning(f"[EagleSuite] 路由注册延迟失败: {e}")

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
