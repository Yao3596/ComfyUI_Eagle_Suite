# -*- coding: utf-8 -*-
"""
Eagle Suite 节点包
向后兼容 shim - 重定向到 eagle_suite.nodes
"""

# 从新的 eagle_suite 子包重新导出
from ..eagle_suite.nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
