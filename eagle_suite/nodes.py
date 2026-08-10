# -*- coding: utf-8 -*-
"""
Eagle Suite 节点注册入口
全部节点统一手动注册
"""

from .eagle_client import eagle_client
from .video_nodes import EagleImagesToVideo, EagleVideoConverter
from .audio_nodes import EagleAudioExtractor, EagleAudioMixer
from .eagle_loader import EagleLoader
from .eagle_saver import EagleSaver
from .batch_video_nodes import (
    EagleBatchVideoLoader, EagleVideoFrameExtractor, EagleVideoInfo,
)
from .api_key_node import EagleAPIKeyNode, EagleAPILoader
from .api_model_loader import EagleAPIUnifiedNode, EagleAPIImageNode
from .local_llm_node import EagleLocalLLMNode, EagleLocalLLMServerNode
from .gif_compressor import GifCompressorNode
from .local_loader import LocalImageLoader
from .wallhaven_gallery import WallhavenGalleryNode
from .text_nodes import NODE_CLASS_MAPPINGS_TEXT, NODE_DISPLAY_NAME_MAPPINGS_TEXT
from .eagle_gallery import EagleGalleryNode
from .eagle_video_gallery import EagleVideoGalleryNode
from .lora_gallery import EagleLoraGalleryNode
from .local_video_loader import EagleLocalVideoLoaderNode
from .advanced_video_saver import EagleAdvancedVideoSaver
from .danbooru_search import DanbooruVueSearchNode
from .text_switch_node import EagleTextSwitchMulti

# ── 工具节点 ─────────────────────────────────────────────
from ..nodes.image_browser import EagleImageList
from ..nodes.audio_browser import EagleAudioList
from ..nodes.prompt_presets import EaglePromptPresets
from ..nodes.string_tools import EagleStringRows, EagleSplitString
from ..nodes.hf_download import EagleHFDownload

# ── 节点映射 ─────────────────────────────────────────────

NODE_CLASS_MAPPINGS = {
    # 视频处理
    "EagleImagesToVideo":  EagleImagesToVideo,
    "EagleVideoConverter": EagleVideoConverter,
    "EagleAdvancedVideoSaver": EagleAdvancedVideoSaver,

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
    "EagleAPIImageNode":   EagleAPIImageNode,
    "EagleAPIKeyNode":      EagleAPIKeyNode,
    "EagleAPILoader":       EagleAPILoader,
    "EagleLocalLLMNode":        EagleLocalLLMNode,
    "EagleLocalLLMServerNode":  EagleLocalLLMServerNode,

    # 动画
    "GifCompressorNode": GifCompressorNode,

    # 图库
    "WallhavenGalleryNode": WallhavenGalleryNode,
    "EagleGalleryNode": EagleGalleryNode,
    "EagleVideoGalleryNode": EagleVideoGalleryNode,
    "EagleLoraGalleryNode": EagleLoraGalleryNode,
    "EagleLocalVideoLoaderNode": EagleLocalVideoLoaderNode,

    # Danbooru
    "DanbooruVueSearchNode": DanbooruVueSearchNode,

    # 文本
    "EagleTextSwitchMulti": EagleTextSwitchMulti,

    # 工具
    "EagleImageList":       EagleImageList,
    "EagleAudioList":       EagleAudioList,
    "EaglePromptPresets":   EaglePromptPresets,
    "EagleStringRows":      EagleStringRows,
    "EagleSplitString":     EagleSplitString,
    "EagleHFDownload":      EagleHFDownload,
}
NODE_CLASS_MAPPINGS.update(NODE_CLASS_MAPPINGS_TEXT)


NODE_DISPLAY_NAME_MAPPINGS = {
    # 视频处理
    "EagleImagesToVideo":  "🦅 图像序列 → 视频",
    "EagleVideoConverter": "🦅 视频格式转换",
    "EagleAdvancedVideoSaver": "🦅 高级视频保存",

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
    "EagleAPIImageNode":   "🦅 API 生图",
    "EagleAPIKeyNode":      "🦅 API Key Input",
    "EagleAPILoader":       "🦅 API 配置加载器",
    "EagleLocalLLMNode":        "🦅 本地大模型反推",
    "EagleLocalLLMServerNode":  "🦅 本地大模型服务(OpenAI兼容)",

    # 动画
    "GifCompressorNode": "🦅 GIF 压缩保存",

    # 图库
    "WallhavenGalleryNode": "🌊 Wallhaven Gallery",
    "EagleGalleryNode": "🦅 Eagle Gallery",
    "EagleVideoGalleryNode": "🦅 Eagle Video Gallery",
    "EagleLoraGalleryNode": "🦅 LoRA Gallery",
    "EagleLocalVideoLoaderNode": "🦅 本地视频加载器",

    # Danbooru
    "DanbooruVueSearchNode": "🦅 Danbooru 标签搜索",

   # 文本
    "EagleTextSwitchMulti": "🦅 多重文本切换",

    # 工具
    "EagleImageList":     "🦅 图片浏览器",
    "EagleAudioList":     "🦅 音频浏览器",
    "EaglePromptPresets": "🦅 提示词预设",
    "EagleStringRows":    "🦅 行数统计",
    "EagleSplitString":   "🦅 分割文本",
    "EagleHFDownload":    "🦅 HF 下载器",
}
NODE_DISPLAY_NAME_MAPPINGS.update(NODE_DISPLAY_NAME_MAPPINGS_TEXT)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
