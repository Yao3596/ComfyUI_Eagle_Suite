# -*- coding: utf-8 -*-
"""
Eagle Suite 核心包
"""

# 仅导出 NODE 映射，避免循环引用
from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
]
