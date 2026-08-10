# -*- coding: utf-8 -*-
"""
EagleFileTools — 字符串工具
提供字符串行数计算、分割、拼接等功能
"""

import os


class EagleStringRows:
    """计算字符串行数（支持直接输入或从文件读取）"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "content": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "placeholder": "输入文本内容或文件路径"
                }),
            },
            "optional": {
                "mode": (["直接输入", "从文件读取"], {"default": "直接输入"}),
            }
        }

    RETURN_TYPES = ("INT", "STRING")
    RETURN_NAMES = ("行数", "内容")
    FUNCTION = "process"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle/工具"

    def process(self, content, mode="直接输入"):
        if mode == "从文件读取":
            path = content.strip()
            if not os.path.exists(path):
                return (0, f"❌ 文件不存在: {path}")
            try:
                with open(path, "r", encoding="utf-8") as f:
                    text = f.read()
            except Exception as e:
                return (0, f"❌ 读取失败: {e}")
        else:
            text = content

        lines = text.split("\n")
        return (len(lines), text)


class EagleSplitString:
    """按分隔符分割字符串为列表"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"default": "", "multiline": True}),
                "separator": ("STRING", {"default": ","}),
            },
            "optional": {
                "index": ("INT", {"default": -1, "min": -1, "max": 9999}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("结果", "原始文本")
    FUNCTION = "process"
    CATEGORY = "🦅 Eagle/工具"

    def process(self, text, separator=",", index=-1):
        parts = [p.strip() for p in text.split(separator) if p.strip()]
        if 0 <= index < len(parts):
            return (parts[index], text)
        return (", ".join(parts), text)
