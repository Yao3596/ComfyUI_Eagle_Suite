# -*- coding: utf-8 -*-
"""
Eagle 图片加载器 (重构版)
"""

import os
import random
import io
import torch
import numpy as np
from PIL import Image
import folder_paths

from .eagle_client import eagle_client
from .logger import logger

class EagleLoader:
    """Eagle 图片加载器 - 通过 Eagle API 加载图片"""

    SAFETY_MAX = 10000
    SUPPORTED_EXT = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif'}

    def __init__(self):
        pass

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        mode = kwargs.get("control_mode", "固定")
        if mode in ("增加", "减少", "随机"):
            return float("nan")
        return kwargs.get("index", 0)

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "preview": ("BOOLEAN", {"default": True}),
                "folder_input": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "Eagle 文件夹 ID / 名称 / 路径"
                }),
                "control_mode": (["固定", "增加", "减少", "随机", "指定索引"],),
            },
            "optional": {
                "index": ("INT", {"default": 0, "min": 0, "max": 0x7FFFFFFF, "step": 1}),
                "sort_by": (["名称 (A-Z)", "添加日期", "修改日期", "创建日期", "文件大小", "扩展名", "评分"], {"default": "添加日期"}),
                "sort_order": (["升序", "降序"], {"default": "降序"}),
                "max_count": ("INT", {"default": 0, "min": 0, "max": 99999, "step": 1}),
                "tags_filter": ("STRING", {"default": "", "multiline": False, "placeholder": "用逗号分隔多个标签"}),
                "star_filter": (["全部", "未评分", "1星", "2星", "3星", "4星", "5星"], {"default": "全部"}),
                "aspect_filter": (["全部", "横向", "纵向", "方形"], {"default": "全部"}),
                "include_subfolders": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "INT", "INT", "STRING")
    RETURN_NAMES = ("图片", "图像路径", "详细信息", "图片总数", "当前值", "图片元数据")
    FUNCTION = "load_image"
    CATEGORY = "🦅 Eagle"
    OUTPUT_NODE = True

    def load_image(self, preview, folder_input, control_mode,
                   index=0, sort_by="添加日期", sort_order="降序", max_count=0,
                   tags_filter="", star_filter="全部", aspect_filter="全部",
                   include_subfolders=True):

        # 1. 解析文件夹
        val, itype = eagle_client.parse_folder_input(folder_input)
        if not val:
            raise Exception("❌ 请输入有效的 Eagle 文件夹信息")

        folder_id = val
        if itype == "eagle_name":
            folder_id = eagle_client.find_folder_id_by_path(val)
            if not folder_id:
                raise Exception(f"❌ 找不到文件夹: {val}")

        # 2. 获取图片列表
        if max_count == 0:
            actual_count = eagle_client.get_folder_item_count(folder_id, include_subfolders)
            max_count = min(actual_count, self.SAFETY_MAX) if actual_count > 0 else self.SAFETY_MAX
        
        items = eagle_client.get_items_in_folder(folder_id, limit=max_count, include_subfolders=include_subfolders)
        if not items:
            raise Exception("❌ 文件夹内没有图片")

        # 3. 筛选与排序
        items, filters_applied = self._filter_items(items, tags_filter, star_filter, aspect_filter)
        items = self._sort_items(items, sort_by, sort_order)
        
        total = len(items)
        if total == 0:
            raise Exception("❌ 筛选后没有符合条件的图片")

        # 4. 选择图片索引
        image_index = self._select_index(control_mode, index, total)
        target_item = items[image_index]
        item_id = target_item.get("id")

        # 5. 三级回退加载图片
        img, actual_path = self._load_item_image(item_id, target_item)
        if not img:
            raise Exception(f"❌ 无法加载图片: {target_item.get('name')}")

        # 6. 后处理与预览
        img = img.convert("RGB")
        img_tensor = torch.from_numpy(np.array(img).astype(np.float32) / 255.0)[None,]

        preview_ui = []
        if preview:
            tmp_name = f"eagle_prev_{item_id}.png"
            tmp_path = os.path.join(folder_paths.get_temp_directory(), tmp_name)
            img.save(tmp_path, compress_level=4)
            preview_ui.append({"filename": tmp_name, "subfolder": "", "type": "temp"})

        info = self._format_info(folder_input, target_item, image_index, total, img.size, index, control_mode, filters_applied)
        metadata = self._format_metadata(target_item, img.size)

        return {
            "ui": {"images": preview_ui},
            "result": (img_tensor, actual_path, info, total, index, metadata)
        }

    def _filter_items(self, items, tags_f, star_f, aspect_f):
        filtered = items
        applied = []
        if tags_f:
            tags = [t.strip().lower() for t in tags_f.split(",") if t.strip()]
            filtered = [i for i in filtered if any(t in [it.lower() for it in i.get("tags",[])] for t in tags)]
            applied.append(f"标签:{tags_f}")
        
        if star_f != "全部":
            val = 0 if star_f == "未评分" else int(star_f[0])
            filtered = [i for i in filtered if i.get("star",0) == val]
            applied.append(f"评分:{star_f}")
            
        if aspect_f != "全部":
            res = []
            for i in filtered:
                w, h = i.get("width",0), i.get("height",0)
                if w == 0 or h == 0: continue
                ratio = w / h
                if aspect_f == "横向" and ratio > 1.1: res.append(i)
                elif aspect_f == "纵向" and ratio < 0.9: res.append(i)
                elif aspect_f == "方形" and 0.9 <= ratio <= 1.1: res.append(i)
            filtered = res
            applied.append(f"宽高比:{aspect_f}")
        return filtered, applied

    def _sort_items(self, items, by, order):
        sort_map = {"名称 (A-Z)": "name", "添加日期": "mtime", "修改日期": "modificationTime", "创建日期": "btime", "文件大小": "size", "扩展名": "ext", "评分": "star"}
        key = sort_map.get(by, "mtime")
        rev = (order == "降序")
        return sorted(items, key=lambda x: x.get(key, 0), reverse=rev)

    def _load_item_image(self, item_id, item_data):
        # 1. API 路径
        info = eagle_client.get_item_info(item_id)
        if info and info.get("filePath"):
            p = info["filePath"]
            if os.path.exists(p):
                return Image.open(p), p
        
        # 2. 资源库猜测
        lib = eagle_client.get_library_path()
        if lib:
            p = os.path.join(lib, "images", f"{item_id}.info", f"{item_data.get('name')}.{item_data.get('ext')}")
            if os.path.exists(p): return Image.open(p), p
            
        # 3. 缩略图回退
        thumb = eagle_client.get_item_thumbnail(item_id)
        if thumb:
            return Image.open(io.BytesIO(thumb)), f"eagle://thumb/{item_id}"
            
        return None, ""

    def _select_index(self, mode, index, total):
        if mode == "随机":
            return random.Random(index).randint(0, total - 1)
        return index % total

    def _format_info(self, folder, item, idx, total, size, cur_val, mode, filters):
        return f"📁 文件夹: {folder}\n🖼️ 图片: {item.get('name')}\n📊 位置: {idx+1}/{total}\n📐 尺寸: {size[0]}x{size[1]}\n🎯 模式: {mode}({cur_val})"

    def _format_metadata(self, item, size):
        data = item.copy()
        data.update({"width": size[0], "height": size[1]})
        return json.dumps(data, ensure_ascii=False, indent=2)
