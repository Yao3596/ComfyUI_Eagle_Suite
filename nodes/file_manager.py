# -*- coding: utf-8 -*-
"""
EagleFileTools — 文件管理
删除/移动/复制文件
"""

import os
import shutil

from ..tools_utils import is_image_file, normalize_path


class AnyType(str):
    def __eq__(self, _) -> bool:
        return True

    def __ne__(self, __value: object) -> bool:
        return False


any = AnyType("*")


class EagleFileDelete:
    """删除文件（支持图片、文本等）"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "file_path": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "要删除的文件路径"
                }),
            },
            "optional": {
                "anything": (any, {}),
            }
        }

    RETURN_TYPES = (any, "STRING")
    RETURN_NAMES = ("output", "状态")
    OUTPUT_NODE = True
    FUNCTION = "delete_file"
    CATEGORY = "🦅 Eagle/工具"

    def delete_file(self, file_path, anything=None):
        path = file_path.strip().strip('"\'')
        if not path:
            return (anything if anything is not None else "", "❌ 路径为空")
        if not os.path.exists(path):
            return (anything if anything is not None else "", f"❌ 文件不存在: {path}")
        try:
            os.remove(path)
            return (anything if anything is not None else "", f"✅ 已删除: {os.path.basename(path)}")
        except Exception as e:
            return (anything if anything is not None else "", f"❌ 删除失败: {e}")


class EagleFileCopy:
    """复制文件到目标目录"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "source_path": ("STRING", {"default": "", "placeholder": "原文件路径"}),
                "target_dir": ("STRING", {"default": "", "placeholder": "目标目录"}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("结果路径", "状态")
    OUTPUT_NODE = True
    FUNCTION = "copy_file"
    CATEGORY = "🦅 Eagle/工具"

    def copy_file(self, source_path, target_dir):
        src = source_path.strip().strip('"\'')
        dst = target_dir.strip().strip('"\'')
        if not src or not dst:
            return ("", "❌ 请填写源路径和目标目录")
        if not os.path.exists(src):
            return ("", f"❌ 源文件不存在: {src}")

        try:
            os.makedirs(dst, exist_ok=True)
            name = os.path.basename(src)
            dest = os.path.join(dst, name)
            shutil.copy2(src, dest)
            return (dest, f"✅ 已复制到: {dest}")
        except Exception as e:
            return ("", f"❌ 复制失败: {e}")
