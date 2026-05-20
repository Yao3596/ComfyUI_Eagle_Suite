# -*- coding: utf-8 -*-
"""
EagleFileTools — 分组工具
用于 workflow 中的节点分组和文字传递
"""


class EagleGroupManager:
    """分组管理器（移植自 HugoTools）"""
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {
                "group_name": "STRING",
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("group_name",)
    OUTPUT_NODE = True
    FUNCTION = "process"
    CATEGORY = "🦅 Eagle/工具"

    def process(self, group_name="No Group"):
        return (group_name,)
