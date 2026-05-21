# -*- coding: utf-8 -*-
"""
Eagle Suite 节点注册入口
VHS 风格重构版本 - 所有节点统一从本地子包导入
"""

from .video_nodes import (
    EagleImagesToVideo,
    EagleVideoConverter,
)
from .audio_nodes import (
    EagleAudioExtractor,
    EagleAudioMixer,
)
from .eagle_loader import EagleLoader
from .eagle_saver import EagleSaver
from .batch_video_nodes import (
    EagleBatchVideoLoader,
    EagleVideoFrameExtractor,
    EagleVideoInfo,
)
from .api_key_node import EagleAPIKeyNode, EagleAPILoader
from .api_model_loader import EagleAPIUnifiedNode
from .local_loader import LocalImageLoader
from .wallhaven_gallery import WallhavenGalleryNode
from .eagle_gallery import EagleGalleryNode

# ── 节点映射 ─────────────────────────────────────────────

NODE_CLASS_MAPPINGS = {
    # 视频处理
    "EagleImagesToVideo":  EagleImagesToVideo,
    "EagleVideoConverter": EagleVideoConverter,

    # 音频处理
    "EagleAudioExtractor": EagleAudioExtractor,
    "EagleAudioMixer":     EagleAudioMixer,

    # Eagle 基础
    "EagleLoader":   EagleLoader,
    "EagleSaver":    EagleSaver,
    "LocalImageLoader": LocalImageLoader,

    # 批量视频处理
    "EagleBatchVideoLoader":    EagleBatchVideoLoader,
    "EagleVideoFrameExtractor": EagleVideoFrameExtractor,
    "EagleVideoInfo":           EagleVideoInfo,

    # API
    "EagleAPIUnifiedNode": EagleAPIUnifiedNode,
    "EagleAPIKeyNode":      EagleAPIKeyNode,
    "EagleAPILoader":       EagleAPILoader,

    # 图库
    "WallhavenGalleryNode": WallhavenGalleryNode,
    "EagleGalleryNode": EagleGalleryNode,
}


NODE_DISPLAY_NAME_MAPPINGS = {
    # 视频处理
    "EagleImagesToVideo":  "🦅 图像序列 → 视频",
    "EagleVideoConverter": "🦅 视频格式转换",

    # 音频处理
    "EagleAudioExtractor": "🦅 音频提取",
    "EagleAudioMixer":     "🦅 音频混音",

    # Eagle 基础
    "EagleLoader":   "🦅 Eagle 图片加载",
    "EagleSaver":    "🦅 Eagle 图片保存",
    "LocalImageLoader": "🦅 本地图片加载",

    # 批量视频处理
    "EagleBatchVideoLoader":    "🦅 批量视频加载",
    "EagleVideoFrameExtractor": "🦅 视频帧提取",
    "EagleVideoInfo":           "🦅 视频信息",

    # API
    "EagleAPIUnifiedNode": "🦅 API 多功能调用",
    "EagleAPIKeyNode":      "🦅 API Key Input",
    "EagleAPILoader":       "🦅 API 配置加载器",

    # 图库
    "WallhavenGalleryNode": "🌊 Wallhaven Gallery",
    "EagleGalleryNode": "🦅 Eagle Gallery",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
