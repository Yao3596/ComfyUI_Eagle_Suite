# -*- coding: utf-8 -*-
"""
Eagle Suite - 文本节点套件
提供字符串保存/加载、分割/拼接、随机选择、条件分支、模板替换等常用文本操作。
"""

import os
import re
import random
import glob
from pathlib import Path

from .logger import logger


# ── 1. 保存字符串到文件 ───────────────────────────────────────────────────────

class EagleSaveString:
    """将字符串保存到文本文件"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"default": "", "multiline": True}),
                "directory": ("STRING", {"default": "", "multiline": False, "placeholder": "输出目录，留空使用 ComfyUI output"}),
                "file_name": ("STRING", {"default": "prompt", "multiline": False}),
                "extension": ("STRING", {"default": "txt", "multiline": False}),
                "encoding": (["utf-8", "gbk", "utf-8-sig"], {"default": "utf-8"}),
                "save_mode": (["覆盖", "追加"], {"default": "覆盖"}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("file_path",)
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle/文本"

    def save(self, text, directory, file_name, extension, encoding, save_mode):
        try:
            import folder_paths
            base_dir = directory.strip() or folder_paths.get_output_directory()
        except Exception:
            base_dir = directory.strip() or os.getcwd()

        os.makedirs(base_dir, exist_ok=True)
        ext = extension.strip().lstrip(".")
        name = file_name.strip() or "prompt"
        path = os.path.join(base_dir, f"{name}.{ext}")

        mode = "a" if save_mode == "追加" else "w"
        try:
            with open(path, mode, encoding=encoding) as f:
                f.write(text)
                if save_mode == "追加" and text and not text.endswith("\n"):
                    f.write("\n")
            return (path,)
        except Exception as e:
            logger.error(f"[EagleSaveString] 保存失败: {e}")
            return ("",)


# ── 2. 从文件夹加载文本 ───────────────────────────────────────────────────────

class EagleLoadTextFiles:
    """从文件夹按索引加载 .txt 文件"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder_path": ("STRING", {"default": "", "multiline": False, "placeholder": "文本文件所在目录"}),
                "index": ("INT", {"default": 0, "min": 0, "max": 99999}),
                "max_files": ("INT", {"default": 100, "min": 1, "max": 9999}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "INT")
    RETURN_NAMES = ("text", "file_name", "total")
    FUNCTION = "load"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle/文本"

    def load(self, folder_path, index, max_files):
        if not folder_path or not os.path.isdir(folder_path):
            return ("", "", 0)

        files = []
        for ext in ("*.txt", "*.md", "*.json"):
            files.extend(glob.glob(os.path.join(folder_path, ext)))
        files = sorted(files)[:max_files]

        if not files:
            return ("", "", 0)

        idx = min(index, len(files) - 1)
        path = files[idx]
        try:
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
            return (text, os.path.basename(path), len(files))
        except Exception as e:
            logger.error(f"[EagleLoadTextFiles] 读取失败: {e}")
            return ("", os.path.basename(path), len(files))


# ── 3. 文本拼接 ───────────────────────────────────────────────────────────────

class EagleConcatStrings:
    """拼接多个字符串"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "separator": ("STRING", {"default": ", ", "multiline": False}),
            },
            "optional": {
                "text_1": ("STRING", {"default": "", "multiline": True, "forceInput": True}),
                "text_2": ("STRING", {"default": "", "multiline": True, "forceInput": True}),
                "text_3": ("STRING", {"default": "", "multiline": True, "forceInput": True}),
                "text_4": ("STRING", {"default": "", "multiline": True, "forceInput": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "concat"
    CATEGORY = "🦅 Eagle/文本"

    def concat(self, separator, text_1="", text_2="", text_3="", text_4=""):
        parts = [p.strip() for p in [text_1, text_2, text_3, text_4] if p and str(p).strip()]
        return (separator.join(parts),)


# ── 4. 文本分割 ───────────────────────────────────────────────────────────────

class EagleSplitString:
    """按分隔符分割字符串，支持按索引取出单条或全部拼接"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"default": "", "multiline": True}),
                "separator": ("STRING", {"default": ","}),
                "index": ("INT", {"default": -1, "min": -1, "max": 9999}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("result", "original")
    FUNCTION = "split"
    CATEGORY = "🦅 Eagle/文本"

    def split(self, text, separator=",", index=-1):
        if not text.strip():
            return ("", text)
        parts = [p.strip() for p in text.split(separator) if p.strip()]
        if 0 <= index < len(parts):
            return (parts[index], text)
        return (separator.join(parts), text)


# ── 5. 多行文本随机选择 ───────────────────────────────────────────────────────

class EagleRandomLine:
    """从多行文本或按分隔符切分的词组中随机选择 N 条"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"default": "", "multiline": True}),
                "count": ("INT", {"default": 1, "min": 1, "max": 100}),
                "join_separator": ("STRING", {"default": ", ", "tooltip": "输出多条之间的连接符"}),
                "seed": ("INT", {"default": -1, "min": -1, "max": 2147483647}),
            },
            "optional": {
                "split_mode": (["按行", "按分隔符"], {"default": "按行"}),
                "split_separator": ("STRING", {"default": ",", "tooltip": "按分隔符模式下的切分符，如 , 或 ;"}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("result", "all_items")
    FUNCTION = "random"
    CATEGORY = "🦅 Eagle/文本"

    def random(self, text, count, join_separator, seed, split_mode="按行", split_separator=","):
        if split_mode == "按分隔符":
            sep = split_separator if split_separator else ","
            items = [s.strip() for s in text.split(sep) if s.strip()]
        else:
            items = [l.strip() for l in text.split("\n") if l.strip()]

        if not items:
            return ("", text)

        rng = random.Random(seed if seed >= 0 else None)
        if count >= len(items):
            chosen = items
        else:
            chosen = rng.sample(items, count)
        return (join_separator.join(chosen), text)


# ── 6. 文本条件分支 ───────────────────────────────────────────────────────────

class EagleTextSwitch:
    """根据布尔条件选择文本"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "condition": ("BOOLEAN", {"default": True}),
                "text_true": ("STRING", {"default": "", "multiline": True}),
                "text_false": ("STRING", {"default": "", "multiline": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "switch"
    CATEGORY = "🦅 Eagle/文本"

    def switch(self, condition, text_true, text_false):
        return (text_true if condition else text_false,)


# ── 7. 模板替换 ───────────────────────────────────────────────────────────────

class EagleTemplateReplace:
    """模板字符串变量替换，支持 {var1} / {var2} / ..."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "template": ("STRING", {"default": "{positive}, {negative}", "multiline": True}),
            },
            "optional": {
                "var_1": ("STRING", {"default": "", "multiline": True, "forceInput": True}),
                "var_2": ("STRING", {"default": "", "multiline": True, "forceInput": True}),
                "var_3": ("STRING", {"default": "", "multiline": True, "forceInput": True}),
                "var_4": ("STRING", {"default": "", "multiline": True, "forceInput": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "replace"
    CATEGORY = "🦅 Eagle/文本"

    _PATTERN = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")

    def replace(self, template, var_1="", var_2="", var_3="", var_4=""):
        mapping = {
            "var_1": var_1, "var_2": var_2, "var_3": var_3, "var_4": var_4,
            "v1": var_1, "v2": var_2, "v3": var_3, "v4": var_4,
        }

        def repl(m):
            key = m.group(1)
            return mapping.get(key, m.group(0))

        return (self._PATTERN.sub(repl, template),)


# ── 8. 提示词预设 ─────────────────────────────────────────────────────────────

class EaglePromptPreset:
    """提示词预设快速插入（支持多组预设选择）"""

    PRESETS = {
        "画质增强": "masterpiece, best quality, ultra-detailed, 8k uhd, sharp focus",
        "摄影风格": "photorealistic, professional photography, soft lighting, depth of field",
        "动漫风格": "anime style, vibrant colors, cel shading, detailed background",
        "油画风格": "oil painting, classical art, rich colors, canvas texture",
        "赛博朋克": "cyberpunk, neon lights, futuristic city, high tech, dystopian",
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "preset": (list(EaglePromptPreset.PRESETS.keys()), {"default": "画质增强"}),
                "prefix": ("STRING", {"default": "", "multiline": True, "placeholder": "前置文本"}),
                "suffix": ("STRING", {"default": "", "multiline": True, "placeholder": "后置文本"}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "apply"
    CATEGORY = "🦅 Eagle/文本"

    def apply(self, preset, prefix, suffix):
        core = self.PRESETS.get(preset, "")
        parts = [p.strip() for p in [prefix, core, suffix] if p.strip()]
        return (", ".join(parts),)


# ── 导出 ──────────────────────────────────────────────────────────────────────

NODE_CLASS_MAPPINGS_TEXT = {
    "EagleSaveString": EagleSaveString,
    "EagleLoadTextFiles": EagleLoadTextFiles,
    "EagleConcatStrings": EagleConcatStrings,
    "EagleSplitString": EagleSplitString,
    "EagleRandomLine": EagleRandomLine,
    "EagleTextSwitch": EagleTextSwitch,
    "EagleTemplateReplace": EagleTemplateReplace,
    "EaglePromptPreset": EaglePromptPreset,
}

NODE_DISPLAY_NAME_MAPPINGS_TEXT = {
    "EagleSaveString": "🦅 保存字符串",
    "EagleLoadTextFiles": "🦅 加载文本文件",
    "EagleConcatStrings": "🦅 拼接文本",
    "EagleSplitString": "🦅 分割文本",
    "EagleRandomLine": "🦅 随机选择文本",
    "EagleTextSwitch": "🦅 文本条件分支",
    "EagleTemplateReplace": "🦅 模板替换",
    "EaglePromptPreset": "🦅 提示词预设",
}

__all__ = [
    "NODE_CLASS_MAPPINGS_TEXT",
    "NODE_DISPLAY_NAME_MAPPINGS_TEXT",
]
