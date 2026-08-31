# -*- coding: utf-8 -*-
"""
Eagle Suite · H3 制片流水线（h3_pipeline）。

本包提供 5 个核心节点与 3 个可选工具，消费 EagleH3DirectorNode 输出的
H3_CHAIN_PLAN。核心链将上下文衔接、分段检查点、审阅门、循环推进和
视频拼接合并为清晰的制片流程，避免把同一阶段拆成重复节点。
"""

from . import routes  # noqa: F401 触发 @route 装饰器登记
from .nodes import NODE_CLASS_MAPPINGS_H3PIPELINE, NODE_DISPLAY_NAME_MAPPINGS_H3PIPELINE

__all__ = [
    "NODE_CLASS_MAPPINGS_H3PIPELINE",
    "NODE_DISPLAY_NAME_MAPPINGS_H3PIPELINE",
]
