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
import re
import glob

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
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("VIDEO", "IMAGE")
    RETURN_NAMES = ("video", "images")
    FUNCTION = "preview"
    CATEGORY = "🦅 Eagle/预览"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # 纯预览节点，每次都应该重新渲染当前上游输出，不吃缓存
        return float("nan")

    @staticmethod
    def _is_video_object(obj):
        """判断对象是否为 ComfyUI VIDEO 对象（而非 IMAGE 张量）。"""
        return obj is not None and hasattr(obj, "save_to") and callable(obj.save_to)

    @staticmethod
    def _tensor_to_pil_frames(tensor):
        """把 IMAGE 张量 [B,H,W,C] 或 [H,W,C] 转成 PIL 帧列表。"""
        if tensor is None:
            return []
        if hasattr(tensor, "cpu"):
            tensor = tensor.cpu().numpy()
        arr = np.asarray(tensor)
        if arr.ndim == 3:
            arr = arr[np.newaxis, ...]
        frames = []
        for img in arr:
            img = (img * 255).clip(0, 255).astype(np.uint8)
            frames.append(Image.fromarray(img))
        return frames

    @staticmethod
    def _video_to_pil_frames(video_obj):
        """从 VIDEO 对象提取帧；失败时返回空列表。"""
        try:
            if hasattr(video_obj, "get_components"):
                comps = video_obj.get_components()
                images = comps.images
                # VideoComponents.images 通常是 ImageInput / tensor
                if hasattr(images, "cpu"):
                    return EagleVideoGifPreviewNode._tensor_to_pil_frames(images)
                if isinstance(images, (list, tuple)):
                    return [Image.fromarray(np.asarray(f)) for f in images]
            # 兜底：尝试把 VIDEO 对象直接当张量处理
            return EagleVideoGifPreviewNode._tensor_to_pil_frames(video_obj)
        except Exception as e:
            logger.warning(f"[EagleVideoGifPreview] 从 VIDEO 对象提取帧失败: {e}")
            return []

    def preview(self, video=None, images=None, fps=8.0, format="gif", unique_id=None):
        output_dir = folder_paths.get_temp_directory()
        os.makedirs(output_dir, exist_ok=True)
        node_key = re.sub(r"[^A-Za-z0-9_-]+", "_", str(unique_id or "default"))[:80]
        prefix = f"eagle_preview_{node_key}"
        # One preview file per node: repeated queues overwrite rather than grow temp forever.
        for stale in glob.glob(os.path.join(output_dir, prefix + ".*")):
            try:
                os.remove(stale)
            except OSError:
                pass

        # ── 端口穿透：video/images 都可接 VIDEO 对象或 IMAGE 张量 ──
        video_is_obj = self._is_video_object(video)
        images_is_obj = self._is_video_object(images)

        # 1. 当 video 端口接到原生 VIDEO 对象时，优先直接保存为 MP4（保留音频/编码）
        if video_is_obj:
            filename = f"{prefix}.mp4"
            full_path = os.path.join(output_dir, filename)
            try:
                video.save_to(full_path)
                ui = {"images": [{
                    "filename": filename, "subfolder": "", "type": "temp", "format": "video/mp4",
                }], "animated": (True,)}
                return {"ui": ui, "result": (video, images)}
            except Exception as e:
                logger.error(f"[EagleVideoGifPreview] VIDEO.save_to 失败: {e}")
                # 失败则回退到提取帧再处理
                frames = self._video_to_pil_frames(video)
                if frames:
                    return self._save_frames_with_passthrough(
                        frames, prefix, output_dir, fps, format, video, images
                    )
                return {"ui": {"images": [], "animated": (False,)}, "result": (video, images)}

        # 2. 当 images 端口接到原生 VIDEO 对象时，提取帧再按 format 输出
        if images_is_obj:
            frames = self._video_to_pil_frames(images)
            if frames:
                return self._save_frames_with_passthrough(
                    frames, prefix, output_dir, fps, format, video, images
                )
            return {"ui": {"images": [], "animated": (False,)}, "result": (video, images)}

        # 3. 处理 IMAGE 张量（video 或 images 端口均可）
        frames = []
        if video is not None:
            frames = self._tensor_to_pil_frames(video)
        if not frames and images is not None:
            frames = self._tensor_to_pil_frames(images)

        if frames:
            return self._save_frames_with_passthrough(
                frames, prefix, output_dir, fps, format, video, images
            )

        return {"ui": {"images": [], "animated": (False,)}, "result": (video, images)}

    def _save_frames_with_passthrough(self, frames, prefix, output_dir, fps, format, video_in, images_in):
        """保存 PIL 帧序列并同时把原始输入从右侧端口穿透输出。"""
        ui = self._save_frames(frames, prefix, output_dir, fps, format)
        return {"ui": ui, "result": (video_in, images_in)}

    def _save_frames(self, frames, prefix, output_dir, fps, format):
        """把 PIL 帧序列保存为 gif/webp/mp4 并返回 ComfyUI UI 数据。"""
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
        # 统一使用 images 键返回，前端通过 format 识别视频/动图
        return {"ui": {"images": [media], "animated": (len(frames) > 1 or mime.startswith("video/"),)}}


NODE_CLASS_MAPPINGS = {
    "EagleVideoGifPreviewNode": EagleVideoGifPreviewNode,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "EagleVideoGifPreviewNode": "🦅 视频/GIF 预览",
}
