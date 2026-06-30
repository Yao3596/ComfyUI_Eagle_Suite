# -*- coding: utf-8 -*-
"""
Eagle GIF 压缩保存 (重构版)
"""
import os
import torch
import numpy as np
from PIL import Image

from .eagle_client import eagle_client
from .utils import generate_unique_filename, parse_tags
from .logger import logger

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
            },
            "optional": {
                "local_save_path": ("STRING", {"default": "", "multiline": False, "placeholder": "留空则保存到 ComfyUI/output"}),
                "filename_prefix": ("STRING", {"default": "eagle_gif", "multiline": False}),
                "tags": ("STRING", {"default": "", "multiline": False, "placeholder": "用逗号分隔"}),
                "star": ("INT", {"default": 0, "min": 0, "max": 5, "step": 1}),
                "annotation": ("STRING", {"default": "", "multiline": True}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("preview", "file_path", "状态信息")
    FUNCTION = "compress_gif"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle"

    def compress_gif(self, images, eagle_folder, max_colors, scale,
                     frame_skip, duration_ms,
                     local_save_path="", filename_prefix="eagle_gif",
                     tags="", star=0, annotation=""):
        
        # 1. 抽帧
        if frame_skip > 1:
            images = images[::frame_skip]

        # 2. 张量 -> PIL 并缩放
        frames = []
        for i in range(images.shape[0]):
            frame_np = (images[i].cpu().numpy() * 255).astype(np.uint8)
            img = Image.fromarray(frame_np).convert("RGB")
            if scale < 1.0:
                new_size = (int(img.width * scale), int(img.height * scale))
                img = img.resize(new_size, Image.Resampling.LANCZOS)
            frames.append(img)
            
        if not frames:
            return (torch.zeros((1, 64, 64, 3)), "", "无有效帧")

        # 3. 确定路径
        base_name = generate_unique_filename(filename_prefix, extension="")
        gif_filename = f"{base_name}.gif"
        
        if local_save_path.strip():
            output_dir = local_save_path.strip()
        else:
            from folder_paths import get_output_directory
            output_dir = get_output_directory()
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, gif_filename)

        # 4. 压缩 GIF
        try:
            frames[0].save(
                output_path,
                save_all=True,
                append_images=frames[1:],
                duration=duration_ms,
                loop=0,
                optimize=True,
                quantization=Image.Quantization.MEDIANCUT,
                dither=Image.Dither.FLOYDSTEINBERG,
                colors=max_colors
            )
        except Exception as e:
            return (images[0:1], "", f"GIF 压缩失败: {e}")

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

        # 6. 返回结果
        preview_np = np.array(frames[0]).astype(np.float32) / 255.0
        preview_tensor = torch.from_numpy(preview_np).unsqueeze(0)
        
        return (preview_tensor, output_path, f"GIF 已保存: {gif_filename}{eagle_status}")
