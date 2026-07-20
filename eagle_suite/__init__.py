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

# 延迟注册可能依赖 PromptServer.instance 的路由。
# 原方案在模块顶层使用 @PromptServer.instance.routes 装饰器，在 ComfyUI 热重载
# 或 PromptServer 尚未就绪的导入阶段会触发 AttributeError。现统一改为：
# 1) 各模块通过 route_registry.route 装饰器登记路由处理函数；
# 2) api_key_node 暴露 register_routes() 函数；
# 3) 在节点映射导入完成后统一注册到 PromptServer.instance。
try:
    from server import PromptServer
    _ps = getattr(PromptServer, "instance", None)
except Exception:
    _ps = None

try:
    from .route_registry import register_all_routes
    register_all_routes(_ps)
except Exception as e:
    logger.warning(f"[EagleSuite] 画廊路由注册延迟失败: {e}")

try:
    from . import api_key_node
    api_key_node.register_routes()
except Exception as e:
    logger.warning(f"[EagleSuite] api_key_node 路由注册延迟失败: {e}")

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
