# -*- coding: utf-8 -*-
"""Eagle Suite - 多重 Latent 随机切换。"""

import random

import torch


MAX_INPUTS = 9
INPUT_PREFIX = "latent_"


def _empty_latent(width, height, batch_size):
    """按 ComfyUI Empty Latent Image 的数据契约生成兜底 LATENT。"""
    try:
        import comfy.model_management

        device = comfy.model_management.intermediate_device()
    except Exception:
        # 单元测试或脱离 ComfyUI 导入时仍可验证节点逻辑。
        device = "cpu"

    samples = torch.zeros(
        [int(batch_size), 4, int(height) // 8, int(width) // 8],
        dtype=torch.float32,
        device=device,
    )
    return {"samples": samples}


class EagleLatentSwitchMulti:
    """从已连接的多个 LATENT 中随机选择一个，始终只输出一个 LATENT。"""

    @classmethod
    def INPUT_TYPES(cls):
        optional = {
            f"{INPUT_PREFIX}{i}": ("LATENT", {"forceInput": True})
            for i in range(1, MAX_INPUTS + 1)
        }
        return {
            "required": {
                "输入数量": ("INT", {"default": 4, "min": 1, "max": MAX_INPUTS, "step": 1}),
                "width": ("INT", {"default": 1024, "min": 16, "max": 16384, "step": 8}),
                "height": ("INT", {"default": 1024, "min": 16, "max": 16384, "step": 8}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 4096, "step": 1}),
                "seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFFFFFFFFFF,
                        "control_after_generate": True,
                    },
                ),
            },
            "optional": optional,
        }

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("latent",)
    FUNCTION = "run"
    CATEGORY = "🦅 Eagle/工具"

    def run(self, 输入数量, width, height, batch_size, seed, **kwargs):
        connected = []
        for index in range(1, int(输入数量) + 1):
            value = kwargs.get(f"{INPUT_PREFIX}{index}")
            if isinstance(value, dict) and value.get("samples") is not None:
                connected.append(value)

        if connected:
            # 不复制、不插值所选 LATENT，保留噪声、batch 及第三方附加字段。
            return (random.Random(int(seed)).choice(connected),)

        # 没有任何有效连线时仍给出标准空 LATENT；此时尺寸由用户明确设置。
        return (_empty_latent(width, height, batch_size),)


NODE_CLASS_MAPPINGS = {
    "EagleLatentSwitchMulti": EagleLatentSwitchMulti,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "EagleLatentSwitchMulti": "🦅 多重 Latent 随机切换",
}
