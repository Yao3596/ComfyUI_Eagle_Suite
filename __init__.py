# -*- coding: utf-8 -*-
"""
Eagle Suite 插件根入口
VHS 风格：从 eagle_suite 子包导入节点映射
"""

from .eagle_suite import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./web/js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
