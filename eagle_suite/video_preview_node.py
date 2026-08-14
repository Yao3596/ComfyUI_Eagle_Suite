# -*- coding: utf-8 -*-
"""
Eagle Suite - EagleVideoGifPreviewNode
视频 / GIF / WEBP 预览节点

接 VIDEO 对象（原生 comfy_api VideoInput，比如"创建视频"节点的输出）或 IMAGE 序列，
保存到 ComfyUI temp 目录，在节点自身上内联播放/查看，不落地到 output 目录、不产生
下游文件输出——纯预览用途，和 ComfyUI 原生 PreviewImage 的定位一致，只是换成视频/动图。

UI 数据走当前 ComfyUI 的原生媒体约定：视频使用 ``video``，GIF/WebP 使用
``images`` 并附加 ``animated`` 标记。前端据此接收
{filename, subfolder, type, format} 并拼接 /view 请求地址。
"""

import os
import time

import numpy as np
import torch
from PIL import Image
import folder_paths

from .logger import logger


class EagleVideoGifPreviewNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "video": ("VIDEO",),
                "images": ("IMAGE",),
                "fps": ("FLOAT", {"default": 8.0, "min": 0.1, "max": 120.0, "step": 0.1}),
                "format": (["gif", "webp", "mp4"], {"default": "gif"}),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "preview"
    CATEGORY = "🦅 Eagle/预览"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # 纯预览节点，每次都应该重新渲染当前上游输出，不吃缓存
        return float("nan")

    def preview(self, video=None, images=None, fps=8.0, format="gif"):
        output_dir = folder_paths.get_temp_directory()
        os.makedirs(output_dir, exist_ok=True)
        prefix = f"eagle_preview_{int(time.time() * 1000)}"

        # 优先用原生 VIDEO 对象：直接调用它自带的 save_to，
        # 音轨、编码这些它自己会处理好，没必要自己重新走一遍 ffmpeg。
        if video is not None:
            filename = f"{prefix}.mp4"
            full_path = os.path.join(output_dir, filename)
            try:
                video.save_to(full_path)
            except Exception as e:
                logger.error(f"[EagleVideoGifPreview] VIDEO.save_to 失败: {e}")
                return {"ui": {"video": []}}
            return {"ui": {"video": [{
                "filename": filename, "subfolder": "", "type": "temp", "format": "video/mp4",
            }]}}

        # IMAGE 序列：当动图/视频序列处理
        if images is not None and len(images) > 0:
            frames = []
            for img in images:
                arr = (img.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
                frames.append(Image.fromarray(arr))

            duration_ms = max(1, int(1000 / max(fps, 0.1)))

            if format == "gif":
                filename = f"{prefix}.gif"
                full_path = os.path.join(output_dir, filename)
                frames[0].save(full_path, save_all=True, append_images=frames[1:],
                                duration=duration_ms, loop=0)
                mime = "image/gif"
            elif format == "webp":
                filename = f"{prefix}.webp"
                full_path = os.path.join(output_dir, filename)
                frames[0].save(full_path, save_all=True, append_images=frames[1:],
                                duration=duration_ms, loop=0)
                mime = "image/webp"
            else:
                try:
                    import cv2
                except ImportError:
                    logger.warning("[EagleVideoGifPreview] 缺少 opencv-python，mp4 预览自动回退为动态 WebP")
                    filename = f"{prefix}.webp"
                    full_path = os.path.join(output_dir, filename)
                    frames[0].save(
                        full_path,
                        save_all=True,
                        append_images=frames[1:],
                        duration=duration_ms,
                        loop=0,
                    )
                    mime = "image/webp"
                else:
                    filename = f"{prefix}.mp4"
                    full_path = os.path.join(output_dir, filename)
                    w, h = frames[0].size
                    writer = cv2.VideoWriter(full_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
                    for f in frames:
                        writer.write(cv2.cvtColor(np.array(f), cv2.COLOR_RGB2BGR))
                    writer.release()
                    mime = "video/mp4"

            media = {
                "filename": filename,
                "subfolder": "",
                "type": "temp",
                "format": mime,
            }
            if mime.startswith("video/"):
                return {"ui": {"video": [media]}}
            return {"ui": {"images": [media], "animated": (len(frames) > 1,)}}

        return {"ui": {"images": []}}


NODE_CLASS_MAPPINGS = {
    "EagleVideoGifPreviewNode": EagleVideoGifPreviewNode,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "EagleVideoGifPreviewNode": "🦅 视频/GIF 预览",
}
