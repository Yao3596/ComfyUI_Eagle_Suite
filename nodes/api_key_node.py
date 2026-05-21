# -*- coding: utf-8 -*-
"""
Eagle API Key Input Node - 独立密钥输入节点
- 密码输入框（前端显示为点）
- 密钥保存到 localStorage，Reload 后自动恢复
- 输出字符串可直接连接到其他节点的 api_key 输入
"""

import os
import json

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

class EagleAPIKeyNode:
    """
    🦅 API 密钥输入节点
    独立的密码输入框，输出 api_key 字符串
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "api_key": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "password": True,
                    "placeholder": "输入 API Key（留空使用已保存）"
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("api_key",)
    FUNCTION = "get_key"
    CATEGORY = "🦅 Eagle/API"
    OUTPUT_NODE = True

    def get_key(self, api_key: str):
        return (api_key.strip(),)


# ── 注册 ────────────────────────────────────────────────────────
NODE_CLASS_MAPPINGS["EagleAPIKeyNode"] = EagleAPIKeyNode
NODE_DISPLAY_NAME_MAPPINGS["EagleAPIKeyNode"] = "🦅 API Key Input"

__all__ = ["EagleAPIKeyNode"]

api_key_node_mappings = {
    "EagleAPIKeyNode": EagleAPIKeyNode,
}
api_key_node_display_names = {
    "EagleAPIKeyNode": "🦅 API Key Input",
}
