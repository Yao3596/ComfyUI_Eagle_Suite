# -*- coding: utf-8 -*-
"""Eagle Suite 节点注册与菜单层级的唯一入口。"""

from .video_nodes import EagleImagesToVideo, EagleVideoConverter
from .audio_nodes import EagleAudioExtractor, EagleAudioMixer
from .eagle_loader import EagleLoader
from .eagle_saver import EagleSaver
from .batch_video_nodes import (
    EagleBatchVideoLoader, EagleVideoFrameExtractor, EagleVideoInfo,
)
from .api_key_node import EagleAPIKeyNode, EagleAPILoader
from .api_model_loader import EagleAPIUnifiedNode, EagleAPIImageNode
from .local_llm_node import EagleLocalLLMLoader, EagleLocalLLMNode, EagleLocalLLMServerNode
from .gif_compressor import GifCompressorNode
from .local_loader import LocalImageLoader
from .wallhaven_gallery import WallhavenGalleryNode
from .text_nodes import NODE_CLASS_MAPPINGS_TEXT, NODE_DISPLAY_NAME_MAPPINGS_TEXT
from .eagle_gallery import EagleGalleryNode
from .lora_gallery import EagleLoraGalleryNode
from .advanced_video_saver import EagleAdvancedVideoSaver
from .danbooru_search import DanbooruVueSearchNode
from .text_switch_node import EagleTextSwitchMulti
from .unified_media_browser import UnifiedMediaBrowser
from .video_preview_node import EagleVideoGifPreviewNode
from .h3_director_node import EagleH3DirectorNode
from .director_skill_node import EagleDirectorSkillNode

# ── 工具节点 ─────────────────────────────────────────────
from ..nodes.audio_browser import EagleAudioList
from ..nodes.prompt_presets import EaglePromptPresets
from ..nodes.string_tools import EagleStringRows
from .prompt_variables_node import EaglePromptVariablesNode

# ── 节点映射 ─────────────────────────────────────────────

NODE_CLASS_MAPPINGS = {
    # 视频处理
    "EagleImagesToVideo":  EagleImagesToVideo,
    "EagleVideoConverter": EagleVideoConverter,
    "EagleAdvancedVideoSaver": EagleAdvancedVideoSaver,
    "EagleVideoGifPreviewNode": EagleVideoGifPreviewNode,

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
    "EagleLocalLLMLoader":      EagleLocalLLMLoader,
    "EagleLocalLLMNode":        EagleLocalLLMNode,
    "EagleLocalLLMServerNode":  EagleLocalLLMServerNode,

    # 动画
    "GifCompressorNode": GifCompressorNode,

    # 图库
    "WallhavenGalleryNode": WallhavenGalleryNode,
    "EagleGalleryNode": EagleGalleryNode,
    "EagleLoraGalleryNode": EagleLoraGalleryNode,
    "UnifiedMediaBrowser": UnifiedMediaBrowser,
    "EagleH3DirectorNode": EagleH3DirectorNode,
    "EagleDirectorSkillNode": EagleDirectorSkillNode,

    # Danbooru
    "DanbooruVueSearchNode": DanbooruVueSearchNode,

    # 文本
    "EagleTextSwitchMulti": EagleTextSwitchMulti,
    "EaglePromptVariablesNode": EaglePromptVariablesNode,

    # 工具
    "EagleAudioList":       EagleAudioList,
    "EaglePromptPresets":   EaglePromptPresets,
    "EagleStringRows":      EagleStringRows,
}
NODE_CLASS_MAPPINGS.update(NODE_CLASS_MAPPINGS_TEXT)


NODE_DISPLAY_NAME_MAPPINGS = {
    # 视频处理
    "EagleImagesToVideo":  "🦅 图像序列 → 视频",
    "EagleVideoConverter": "🦅 视频格式转换",
    "EagleAdvancedVideoSaver": "🦅 高级视频保存",
    "EagleVideoGifPreviewNode": "🦅 视频GIF预览",
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
    "EagleLocalLLMLoader":      "🦅 本地大模型加载器",
    "EagleLocalLLMNode":        "🦅 本地大模型反推",
    "EagleLocalLLMServerNode":  "🦅 本地大模型服务(OpenAI兼容)",

    # 动画
    "GifCompressorNode": "🦅 GIF 压缩保存",

    # 图库
    "WallhavenGalleryNode": "🌊 Wallhaven Gallery",
    "EagleGalleryNode": "🦅 Eagle Gallery",
    "EagleLoraGalleryNode": "🦅 LoRA Gallery",
    "UnifiedMediaBrowser": "🦅 统一媒体浏览器",
    "EagleH3DirectorNode": "🦅 H3 导演台",
    "EagleDirectorSkillNode": "🦅 导演技能库",
    # Danbooru
    "DanbooruVueSearchNode": "🦅 Danbooru 标签搜索",

   # 文本
    "EagleTextSwitchMulti": "🦅 多重文本切换",
    "EaglePromptVariablesNode": "🦅 变量输入",

    # 工具
    "EagleAudioList":     "🦅 音频浏览器",
    "EaglePromptPresets": "🦅 提示词预设",
    "EagleStringRows":    "🦅 行数统计",
}
NODE_DISPLAY_NAME_MAPPINGS.update(NODE_DISPLAY_NAME_MAPPINGS_TEXT)


# ── 菜单层级 ──
# 各实现文件仍可以保留自身 CATEGORY 作为独立调试默认值，
# 但插件正常加载时以这里为唯一的最终分类，避免节点散落到多个根菜单。
MENU_ROOT = "🦅 Eagle Suite"

_CATEGORY_GROUPS = {
    f"{MENU_ROOT}/Eagle": (
        EagleLoader,
        EagleSaver,
    ),
    f"{MENU_ROOT}/画廊": (
        EagleGalleryNode,
        EagleLoraGalleryNode,
        WallhavenGalleryNode,
        DanbooruVueSearchNode,
    ),
    f"{MENU_ROOT}/媒体": (
        LocalImageLoader,
        UnifiedMediaBrowser,
    ),
    f"{MENU_ROOT}/视频": (
        EagleImagesToVideo,
        EagleVideoConverter,
        EagleAdvancedVideoSaver,
        EagleBatchVideoLoader,
        EagleVideoFrameExtractor,
        EagleVideoInfo,
        EagleVideoGifPreviewNode,
        GifCompressorNode,
    ),
    f"{MENU_ROOT}/音频": (
        EagleAudioExtractor,
        EagleAudioMixer,
        EagleAudioList,
    ),
    f"{MENU_ROOT}/API": (
        EagleAPIUnifiedNode,
        EagleAPIImageNode,
        EagleAPIKeyNode,
        EagleAPILoader,
        EagleLocalLLMLoader,
        EagleLocalLLMNode,
        EagleLocalLLMServerNode,
    ),
    f"{MENU_ROOT}/文本": (
        EagleTextSwitchMulti,
        EaglePromptVariablesNode,
        *tuple(NODE_CLASS_MAPPINGS_TEXT.values()),
    ),
    f"{MENU_ROOT}/工具": (
        EaglePromptPresets,
        EagleStringRows,
    ),
    f"{MENU_ROOT}/H3 导演台": (
        EagleH3DirectorNode,
    ),
    f"{MENU_ROOT}/导演技能": (
        EagleDirectorSkillNode,
    ),
}

for _category, _node_classes in _CATEGORY_GROUPS.items():
    for _node_class in _node_classes:
        _node_class.CATEGORY = _category

del _category, _node_classes, _node_class

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]