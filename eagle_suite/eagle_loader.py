# -*- coding: utf-8 -*-
"""
Eagle 图片加载器 (重构版)
"""

import os
import json
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
        actual_size = img.size
        img_tensor = self._pil_to_rgb_tensor(img)

        preview_ui = []
        if preview:
            tmp_name = f"eagle_prev_{item_id}.png"
            tmp_path = os.path.join(folder_paths.get_temp_directory(), tmp_name)
            img.save(tmp_path, compress_level=4)
            preview_ui.append({"filename": tmp_name, "subfolder": "", "type": "temp"})

        info = self._format_info(folder_input, target_item, image_index, total, actual_size, index, control_mode, filters_applied)
        metadata = self._format_metadata(target_item, actual_size)

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
        """加载 Eagle 图片。优先使用资源库原图，失败再回退到 API 缩略图。
        Eagle V1 API 不返回 filePath，因此根据 item_data 中的 name + ext
        直接定位 {library}/images/{item_id}.info/{name}.{ext}。
        """
        lib = eagle_client.get_library_path()
        if lib:
            info_dir = os.path.join(lib, "images", f"{item_id}.info")

            # 1. 确定性原图路径：name + ext
            name = (item_data or {}).get("name", "")
            ext = (item_data or {}).get("ext", "")
            if name and ext:
                candidate = os.path.join(info_dir, f"{name}.{ext}")
                img = self._open_image(candidate)
                if img:
                    return img, candidate

            # 2. 扫描 .info 目录，排除缩略图，选面积最大的图片
            scanned = self._scan_info_folder(info_dir)
            if scanned:
                img = self._open_image(scanned)
                if img:
                    return img, scanned

        # 3. 缩略图回退
        thumb = eagle_client.get_item_thumbnail(item_id)
        if thumb:
            try:
                img = Image.open(io.BytesIO(thumb))
                img.load()
                return img, f"eagle://thumb/{item_id}"
            except Exception as e:
                logger.warning(f"[EagleLoader] 缩略图加载失败 {item_id}: {e}")

        return None, ""

    def _open_image(self, path):
        """打开本地图片并强制加载，失败返回 None"""
        if not path or not os.path.exists(path):
            return None
        try:
            img = Image.open(path)
            img.load()
            return img
        except Exception as e:
            logger.warning(f"[EagleLoader] 打开图片失败 {path}: {e}")
            return None

    def _scan_info_folder(self, info_dir):
        """扫描 Eagle 的 .info 文件夹，优先返回原图路径。
        策略：
        1. 读取 metadata.json 中的 name + ext 组合成文件名
        2. 排除 _thumbnail* 缩略图，选择面积最大的图片
        """
        if not info_dir or not os.path.isdir(info_dir):
            return None
        try:
            # 1. 优先从 metadata.json 读取 name + ext
            meta_path = os.path.join(info_dir, "metadata.json")
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                    name = meta.get("name", "")
                    ext = meta.get("ext", "")
                    if name and ext:
                        candidate = os.path.join(info_dir, f"{name}.{ext}")
                        if os.path.exists(candidate):
                            return candidate
                except Exception as e:
                    logger.warning(f"[EagleLoader] 读取 metadata.json 失败: {e}")

            # 2. 扫描目录，排除缩略图，选面积最大的
            candidates = []
            for fname in os.listdir(info_dir):
                low = fname.lower()
                if low == "metadata.json" or low.startswith("_thumbnail"):
                    continue
                if low.endswith(tuple(self.SUPPORTED_EXT)):
                    fpath = os.path.join(info_dir, fname)
                    try:
                        w, h = self._fast_image_size(fpath)
                        candidates.append((w * h, fpath))
                    except Exception:
                        candidates.append((0, fpath))
            if candidates:
                candidates.sort(key=lambda x: x[0], reverse=True)
                return candidates[0][1]
        except Exception as e:
            logger.warning(f"[EagleLoader] 扫描目录失败 {info_dir}: {e}")
        return None

    def _fast_image_size(self, path):
        """不加载完整图片即可获取尺寸"""
        with Image.open(path) as im:
            return im.size

    def _pil_to_rgb_tensor(self, img):
        """将 PIL Image 转为 RGB torch tensor [1,H,W,3]，RGBA 图片用白色背景合成"""
        if img.mode == "RGBA":
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3])
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")
        return torch.from_numpy(np.array(img).astype(np.float32) / 255.0)[None,]

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
