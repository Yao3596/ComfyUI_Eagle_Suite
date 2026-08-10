# -*- coding: utf-8 -*-
"""
Eagle Suite - 多重文本切换节点

参考 KJNodes「合并字符串（多重）」的交互模式：
  - 输入数量 widget + 更新输入按钮，动态增减 STRING 输入端口（前端 JS 负责）
  - 所有 字符串_N 输入都是可选的，未连接的自动跳过，不强制要求接满

两种输出模式：
  - 随机输出一个：从已连接的输入里，按 seed 随机选一个输出
  - 输出全部：把已连接的输入按端口顺序、用分隔符拼接后输出
"""

import random

# 前端最多支持动态增减到这个数量的输入端口（Python 侧要把 optional 全部声明出来，
# 前端才能在这个上限内自由增减；需要更多可以调大这个数字，两边要保持一致）。
MAX_INPUTS = 32
INPUT_PREFIX = "字符串_"


class EagleTextSwitchMulti:
    @classmethod
    def INPUT_TYPES(cls):
        optional = {}
        for i in range(1, MAX_INPUTS + 1):
            optional[f"{INPUT_PREFIX}{i}"] = ("STRING", {"forceInput": True, "default": ""})

        return {
            "required": {
                "输入数量": ("INT", {"default": 4, "min": 1, "max": MAX_INPUTS, "step": 1}),
                "模式": (["随机输出一个", "输出全部"], {"default": "随机输出一个"}),
                "分隔符": ("STRING", {"default": ", ", "multiline": False}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff, "control_after_generate": True}),
            },
            "optional": optional,
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("字符串",)
    FUNCTION = "run"
    CATEGORY = "🦅 Eagle/文本"

    def run(self, 输入数量, 模式, 分隔符, seed, **kwargs):
        values = []
        for i in range(1, int(输入数量) + 1):
            key = f"{INPUT_PREFIX}{i}"
            v = kwargs.get(key)
            # 未连接的可选输入 v 会是 None（或声明的默认空字符串），两种都跳过
            if v is None or v == "":
                continue
            values.append(v)

        if not values:
            return ("",)

        if 模式 == "随机输出一个":
            rnd = random.Random(seed)
            return (rnd.choice(values),)

        return (分隔符.join(values),)


NODE_CLASS_MAPPINGS = {
    "EagleTextSwitchMulti": EagleTextSwitchMulti,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "EagleTextSwitchMulti": "🦅 多重文本切换",
}
