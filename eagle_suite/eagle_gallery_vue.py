# -*- coding: utf-8 -*-
"""
Eagle Suite - EagleGalleryVueNode
Eagle 图片浏览器节点（Vue 3 版本）

与 EagleGalleryNode 功能完全一致，前端使用 Vue 3 重构。
- 后端：复用同一套 API 路由（/eagle_gallery/*）
- 前端：Vue 3 Composition API + ESM 直引模式
- 新节点注册名：EagleGalleryVueNode
- CSS 前缀：egv-（避免与原节点 eg- 冲突）
"""

import os
import json

import torch
import numpy as np
from PIL import Image

from .eagle_gallery import (
    EagleGalleryNode,
    _eagle_request,
    _load_settings,
    _save_settings,
    _get_eagle_url,
    DEFAULT_EAGLE_URL,
)
from .logger import logger


class EagleGalleryVueNode(EagleGalleryNode):
    """
    Eagle Gallery (Vue) — 使用 Vue 3 前端重构的图片浏览器节点。
    后端逻辑完全继承自 EagleGalleryNode，仅前端渲染方式不同。
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "selection_data": ("STRING", {"default": "{}", "multiline": False}),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("images", "tags", "selection_data")
    OUTPUT_IS_LIST = (True, True, False)
    FUNCTION = "load_images"
    CATEGORY = "🦅 Eagle"
    OUTPUT_NODE = False

    # load_images 方法直接继承自 EagleGalleryNode，无需重写


__all__ = ["EagleGalleryVueNode"]
