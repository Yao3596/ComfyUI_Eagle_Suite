# -*- coding: utf-8 -*-
"""
Eagle GIF 压缩保存支持本地保存 + Eagle 库导"""
import os
import re
import json
import time
import uuid
import tempfile
import requests
import torch
import numpy as np
from PIL import Image
from datetime import datetime
from .logger import logger

class GifCompressorNode:
    """
    将 ComfyUI IMAGE 张量序列压缩为优化后的 GIF，支持保存到 Eagle    """
    def __init__(self):
        self.eagle_api_url = "http://localhost:41595/api"
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE",),
                "eagle_folder": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "Eagle 文件夹路径/ID (留空仅保存本地)"
                }),
                "max_colors": ("INT", {
                    "default": 128,
                    "min": 2,
                    "max": 256,
                    "step": 1,
                    "display": "slider"""
                }),
                "scale": ("FLOAT", {
                    "default": 1.0,
                    "min": 0.1,
                    "max": 1.0,
                    "step": 0.05,
                    "display": "slider"""
                }),
                "frame_skip": ("INT", {
                    "default": 1,
                    "min": 1,
                    "max": 10,
                    "step": 1
                }),
                "duration_ms": ("INT", {
                    "default": 100,
                    "min": 10,
                    "max": 5000,
                    "step": 10
                }),
            },
            "optional": {
                "local_save_path": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "留空则保存到 ComfyUI/output"""
                }),
                "filename_prefix": ("STRING", {
                    "default": "eagle_gif",
                    "multiline": False,
                }),
                "tags": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "用逗号分隔"""
                }),
                "star": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 5,
                    "step": 1,
                }),
                "annotation": ("STRING", {
                    "default": "",
                    "multiline": True,
                }),
            }
        }
    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("preview", "file_path", "状态信息")
    FUNCTION = "compress_gif"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle"
    # ── 工具方法 ──
    def generate_unique_filename(self, prefix):
        date_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        short_id = uuid.uuid4().hex[:6]
        return f"{prefix}_{date_str}_{short_id}"""
    # ── 主函数──
    def compress_gif(self, images, eagle_folder, max_colors, scale,
                     frame_skip, duration_ms,
                     local_save_path="", filename_prefix="eagle_gif",
                     tags="", star=0, annotation=""):
        # 1. 抽帧
        if frame_skip > 1:
            images = images[::frame_skip]
        # 2. 张量PIL         frames = []
        for i in range(images.shape[0]):
            frame_np = (images[i].cpu().numpy() * 255).astype(np.uint8)
            img = Image.fromarray(frame_np).convert("RGB")
            if scale < 1.0:
                new_size = (int(img.width * scale), int(img.height * scale))
                img = img.resize(new_size, Image.Resampling.LANCZOS)
            frames.append(img)
        if not frames:
            return (torch.zeros((1, 64, 64, 3)), "", "无有效帧")
        # 3. 生成文件        unique_name = self.generate_unique_filename(filename_prefix)
        gif_filename = f"{unique_name}.gif"""
        # 4. 确定保存路径
        save_to_eagle = bool(eagle_folder.strip())
        if local_save_path.strip():
            output_dir = local_save_path.strip()
        else:
            from folder_paths import get_output_directory
            output_dir = get_output_directory()
        os.makedirs(output_dir, exist_ok=True)
        # 5. 压缩并保GIF
        output_path = os.path.join(output_dir, gif_filename)
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
            )
            logger.info(f"GIF 已保 {output_path}")
        except Exception as e:
            msg = f"GIF 压缩失败: {e}"""
            return (images[0:1], "", msg)
        # 6. 导入 Eagle(如指定了文件夹        eagle_result = ""
        if save_to_eagle:
            try:
                # 上传Eagle
                with open(output_path, "rb") as f:
                    files = {"file": (gif_filename, f, "image/gif")}
                    data = {"folderId": eagle_folder.strip()}
                    if star > 0:
                        data["star"] = star
                    resp = requests.post(
                        f"{self.eagle_api_url}/item/addFromFile",
                        files=files, data=data, timeout=60
                    )
                if resp.status_code == 200:
                    result = resp.json()
                    if result.get("status") == "success":
                        item_id = result.get("data", {}).get("id")
                        tags_list = [t.strip() for t in re.split(r'[,，]', tags) if t.strip()]
                        # 更新标签和备                        update_data = {"id": item_id}
                        if tags_list:
                            update_data["tags"] = tags_list
                        if annotation:
                            update_data["annotation"] = annotation
                        if tags_list or annotation:
                            requests.post(
                                f"{self.eagle_api_url}/item/update",
                                json=update_data, timeout=30
                            )
                        eagle_result = "Eagle 导入成功"""
                    else:
                        eagle_result = f"⚠️ Eagle 导入失败: {result.get('message', '')}"""
                else:
                    eagle_result = f"⚠️ Eagle API 错误: {resp.status_code}"""
            except Exception as e:
                eagle_result = f"⚠️ Eagle 连接失败: {e}"""
        # 7. 返回预览 + 结果
        preview_np = np.array(frames[0].convert("RGB")).astype(np.float32) / 255.0
        preview_tensor = torch.from_numpy(preview_np).unsqueeze(0)
        status = f"GIF 已保 {output_path}"""
        if eagle_result:
            status += f" | {eagle_result}"""
        return (preview_tensor, output_path, status)