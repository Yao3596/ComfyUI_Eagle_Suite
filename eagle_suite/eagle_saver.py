# -*- coding: utf-8 -*-
"""
Eagle 图片保存器 (重构版)
"""

import os
import tempfile
import time
import numpy as np
import torch
from PIL import Image

from .eagle_client import eagle_client
from .utils import generate_unique_filename, parse_tags
from .logger import logger
from .api_config_manager import load_saver_config, save_saver_config

class EagleSaver:
    """Eagle 图片保存器 - 将 ComfyUI 图像保存到 Eagle 软件或本地"""

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        cfg = load_saver_config()
        return {
            "required": {
                "images": ("IMAGE",),
                "eagle_folder": ("STRING", {
                    "default": cfg.get("eagle_folder", ""),
                    "multiline": False,
                    "placeholder": "Eagle 文件夹名称、路径或 ID"
                }),
            },
            "optional": {
                "local_save_path": ("STRING", {
                    "default": cfg.get("local_save_path", ""),
                    "multiline": False,
                    "placeholder": "留空则不保存到本地"
                }),
                "filename_prefix": ("STRING", {
                    "default": cfg.get("filename_prefix", "ComfyUI"),
                    "multiline": False,
                }),
                "tags": ("STRING", {
                    "default": cfg.get("tags", ""),
                    "multiline": False,
                    "placeholder": "用逗号分隔"
                }),
                "star": ("INT", {
                    "default": cfg.get("star", 0),
                    "min": 0, "max": 5, "step": 1,
                }),
                "annotation": ("STRING", {
                    "default": cfg.get("annotation", ""),
                    "multiline": True,
                }),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("保存结果",)
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle"

    def save_images(self, images, eagle_folder, local_save_path="",
                    filename_prefix="ComfyUI", tags="", star=0, annotation=""):

        save_to_eagle = bool(eagle_folder.strip())
        save_to_local = bool(local_save_path.strip())

        if not save_to_eagle and not save_to_local:
            return ("❌ 请至少指定 Eagle 文件夹或本地保存路径",)

        # 1. 解析 Eagle 文件夹 ID
        folder_id = None
        if save_to_eagle:
            value, itype = eagle_client.parse_folder_input(eagle_folder)
            if itype == "eagle_id":
                folder_id = value
            elif itype == "eagle_name":
                folder_id = eagle_client.find_folder_id_by_path(value)
                if not folder_id:
                    return (f"❌ 找不到 Eagle 文件夹: {value}",)
            elif itype == "local_path":
                logger.warning("检测到 Eagle 文件夹处填写了本地路径，已忽略 Eagle 保存")
                save_to_eagle = False

        tags_list = parse_tags(tags)
        success_count = 0
        local_count = 0
        temp_files = []

        # 2. 处理每一张图片
        for idx, image in enumerate(images):
            try:
                # 张量转 PIL
                i = 255. * image.cpu().numpy()
                img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
                
                base_name = generate_unique_filename(filename_prefix, extension="")
                filename = f"{base_name}.png"

                # A. 本地保存
                if save_to_local:
                    try:
                        os.makedirs(local_save_path, exist_ok=True)
                        full_path = os.path.join(local_save_path, filename)
                        img.save(full_path, format="PNG")
                        local_count += 1
                    except Exception as e:
                        logger.error(f"本地保存失败: {e}")

                # B. Eagle 保存
                if save_to_eagle:
                    temp_path = os.path.join(tempfile.gettempdir(), filename)
                    img.save(temp_path, format="PNG")
                    temp_files.append(temp_path)

                    res = eagle_client.add_item_from_path(
                        temp_path, 
                        folder_id=folder_id, 
                        name=base_name, 
                        tags=tags_list, 
                        annotation=annotation, 
                        star=star
                    )
                    if res.get("status") == "success":
                        success_count += 1
                    else:
                        logger.error(f"Eagle 导入失败: {res.get('message')}")

            except Exception as e:
                logger.error(f"处理第 {idx+1} 张图片时出错: {e}")

        # 3. 延时清理临时文件
        if temp_files:
            time.sleep(1.0) # 给 Eagle 一点响应时间
            for tf in temp_files:
                try:
                    if os.path.exists(tf): os.unlink(tf)
                except: pass

        # 4. 汇总与配置持久化
        summary = f"保存完成 - Eagle: {success_count}/{len(images)}, 本地: {local_count}/{len(images)}"
        save_saver_config({
            "eagle_folder": eagle_folder,
            "local_save_path": local_save_path,
            "filename_prefix": filename_prefix,
            "tags": tags,
            "star": star,
            "annotation": annotation,
        })
        
        return (summary,)

__all__ = ["EagleSaver"]
