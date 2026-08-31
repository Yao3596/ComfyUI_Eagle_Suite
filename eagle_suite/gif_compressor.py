# -*- coding: utf-8 -*-
"""
Eagle GIF 压缩保存 (重构版)
"""
import os
import torch
import numpy as np
from PIL import Image

from .eagle_client import eagle_client
from .utils import generate_unique_filename, parse_tags, get_cached_ffmpeg
from .logger import logger
from .workflow_metadata import persist_workflow_for_media


def _resize_frame(image, mode, scale, target_width, target_height):
    """Resize while preserving aspect ratio; width/height modes constrain one axis."""
    width, height = image.size
    if mode == "指定宽度":
        new_width = max(1, int(target_width))
        new_height = max(1, int(round(height * new_width / max(1, width))))
    elif mode == "指定高度":
        new_height = max(1, int(target_height))
        new_width = max(1, int(round(width * new_height / max(1, height))))
    elif mode == "比例缩放":
        new_width = max(1, int(round(width * float(scale))))
        new_height = max(1, int(round(height * float(scale))))
    else:
        return image
    if (new_width, new_height) == image.size:
        return image
    return image.resize((new_width, new_height), Image.Resampling.LANCZOS)


def _global_palette(frames, max_colors):
    """Build one palette for all frames to make max_colors real and avoid flicker."""
    count = min(32, len(frames))
    indices = np.linspace(0, len(frames) - 1, count, dtype=int)
    samples = []
    for index in indices:
        sample = frames[int(index)].copy()
        sample.thumbnail((256, 256), Image.Resampling.LANCZOS)
        samples.append(sample)
    sheet_width = max(frame.width for frame in samples)
    sheet_height = sum(frame.height for frame in samples)
    sheet = Image.new("RGB", (sheet_width, sheet_height))
    offset = 0
    for sample in samples:
        sheet.paste(sample, (0, offset))
        offset += sample.height
    return sheet.quantize(
        colors=max(2, min(256, int(max_colors))),
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.NONE,
    )

class GifCompressorNode:
    """将 ComfyUI IMAGE 张量序列压缩为优化后的 GIF，支持保存到 Eagle"""

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE",),
                "eagle_folder": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "Eagle 文件夹名称、路径或 ID (留空仅保存本地)"
                }),
                "max_colors": ("INT", {"default": 128, "min": 2, "max": 256, "step": 1, "display": "slider"}),
                "scale": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 1.0, "step": 0.05, "display": "slider"}),
                "frame_skip": ("INT", {"default": 1, "min": 1, "max": 10, "step": 1}),
                "duration_ms": ("INT", {"default": 100, "min": 10, "max": 5000, "step": 10}),
                "resize_mode": (["原尺寸", "指定宽度", "指定高度", "比例缩放"], {"default": "比例缩放"}),
                "target_width": ("INT", {"default": 512, "min": 16, "max": 8192, "step": 8}),
                "target_height": ("INT", {"default": 512, "min": 16, "max": 8192, "step": 8}),
                "dither_mode": (["Floyd-Steinberg", "无抖动"], {"default": "Floyd-Steinberg"}),
                "保持总时长": ("BOOLEAN", {"default": True}),
                "播放速度": ("FLOAT", {"default": 1.0, "min": 0.25, "max": 4.0, "step": 0.05}),
            },
            "optional": {
                "local_save_path": ("STRING", {"default": "", "multiline": False, "placeholder": "留空则保存到 ComfyUI/output"}),
                "filename_prefix": ("STRING", {"default": "eagle_gif", "multiline": False}),
                "tags": ("STRING", {"default": "", "multiline": False, "placeholder": "用逗号分隔"}),
                "star": ("INT", {"default": 0, "min": 0, "max": 5, "step": 1}),
                "annotation": ("STRING", {"default": "", "multiline": True}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("preview", "file_path", "状态信息")
    FUNCTION = "compress_gif"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle/工具"

    def compress_gif(self, images, eagle_folder, max_colors, scale,
                     frame_skip, duration_ms, resize_mode="比例缩放",
                     target_width=512, target_height=512,
                     dither_mode="Floyd-Steinberg", 保持总时长=True, 播放速度=1.0,
                     local_save_path="", filename_prefix="eagle_gif",
                     tags="", star=0, annotation="", prompt=None, extra_pnginfo=None):
        
        # 1. 抽帧
        if frame_skip > 1:
            images = images[::frame_skip]

        # 2. 张量 -> PIL 并缩放
        frames = []
        for i in range(images.shape[0]):
            frame_np = (images[i].cpu().numpy() * 255).astype(np.uint8)
            img = Image.fromarray(frame_np).convert("RGB")
            img = _resize_frame(img, resize_mode, scale, target_width, target_height)
            frames.append(img)
            
        if not frames:
            return (torch.zeros((1, 64, 64, 3)), "", "无有效帧")

        # 3. 确定路径
        base_name = generate_unique_filename(filename_prefix, extension="gif")
        gif_filename = base_name
        
        if local_save_path.strip():
            output_dir = local_save_path.strip()
        else:
            from folder_paths import get_output_directory
            output_dir = get_output_directory()
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, gif_filename)

        # 4. 全局减色 + 压缩 GIF。显式 quantize，避免 Pillow 忽略 save(colors=...)。
        try:
            palette = _global_palette(frames, max_colors)
            dither = Image.Dither.NONE if dither_mode == "无抖动" else Image.Dither.FLOYDSTEINBERG
            quantized = [frame.quantize(palette=palette, dither=dither) for frame in frames]
            speed = max(0.01, float(播放速度 or 1.0))
            effective_duration = float(duration_ms) * (frame_skip if 保持总时长 else 1) / speed
            effective_duration = max(10, int(round(effective_duration)))
            quantized[0].save(
                output_path,
                save_all=True,
                append_images=quantized[1:],
                duration=effective_duration,
                loop=0,
                optimize=True,
                disposal=1,
            )
        except Exception as e:
            return (images[0:1], "", f"GIF 压缩失败: {e}")

        workflow_storage = persist_workflow_for_media(
            output_path, prompt, extra_pnginfo, get_cached_ffmpeg(), force_companion=True
        )
        workflow_png = workflow_storage.get("companion_path", "")

        # 5. 导入 Eagle
        eagle_status = ""
        if eagle_folder.strip():
            folder_id, itype = eagle_client.parse_folder_input(eagle_folder)
            if itype == "eagle_name":
                folder_id = eagle_client.find_folder_id_by_path(folder_id)
            
            res = eagle_client.add_item_from_file(
                output_path, 
                folder_id=folder_id, 
                name=base_name, 
                tags=parse_tags(tags), 
                annotation=annotation, 
                star=star
            )
            eagle_status = " | Eagle: 成功" if res.get("status") == "success" else f" | Eagle: 失败({res.get('message')})"
            if workflow_png:
                companion = eagle_client.add_item_from_file(
                    workflow_png, folder_id=folder_id,
                    name=os.path.basename(workflow_png),
                    tags=parse_tags(tags) + ["ComfyUI工作流"],
                    annotation=f"{annotation}\n关联 GIF: {gif_filename}".strip(), star=star,
                )
                if companion.get("status") != "success":
                    eagle_status += f" | 工作流PNG导入失败({companion.get('message')})"

        # 6. 返回结果
        preview_np = np.array(frames[0]).astype(np.float32) / 255.0
        preview_tensor = torch.from_numpy(preview_np).unsqueeze(0)
        
        duration_text = effective_duration * len(frames) / 1000.0
        workflow_text = f" | 工作流PNG: {workflow_png}" if workflow_png else ""
        return (preview_tensor, output_path,
                f"GIF 已保存: {gif_filename} | {frames[0].width}x{frames[0].height} | "
                f"{len(frames)}帧/{max_colors}色/{duration_text:.2f}s{workflow_text}{eagle_status}")
