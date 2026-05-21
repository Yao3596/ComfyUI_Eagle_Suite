# -*- coding: utf-8 -*-
"""本地图片加载器 - 纯本地/网络路径"""
import os
import json
import numpy as np
from PIL import Image, ImageOps
import random
import torch
import folder_paths


class LocalImageLoader:

    SUPPORTED_EXT = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff', '.tif'}

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "preview": ("BOOLEAN", {"default": True}),
                "folder_path": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "本地路径或网络路径"
                }),
                "index": ("INT", {"default": 0, "min": 0, "max": 0x7FFFFFFF, "step": 1, "forceInput": True}),
                "control_mode": (["固定", "增加", "减少", "随机", "指定索引"],),
            },
            "optional": {
                "sort_by": (["文件名", "修改日期", "创建日期", "文件大小"],),
                "sort_order": (["升序", "降序"],),
                "max_count": ("INT", {"default": 200, "min": 1, "max": 999999}),
                "file_filter": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "如: png,jpg,webp"
                }),
                "aspect_filter": (["全部", "横向", "纵向", "正方形"],),
                "include_subfolders": ("BOOLEAN", {"default": False}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "INT", "INT", "STRING")
    RETURN_NAMES = ("图片", "图像路径", "详细信息", "图片总数", "当前值", "图片元数据")
    FUNCTION = "load_image"
    CATEGORY = "🦅 Eagle"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        mode = kwargs.get("control_mode", "固定")
        if mode in ("增加", "减少", "随机"):
            return float("nan")
        return kwargs.get("index", 0)

    def scan_images(self, folder_path, include_sub, allowed_ext):
        images = []
        if include_sub:
            for root, _, files in os.walk(folder_path):
                for f in files:
                    if os.path.splitext(f)[1].lower() in allowed_ext:
                        images.append(os.path.join(root, f))
        else:
            for f in os.listdir(folder_path):
                full = os.path.join(folder_path, f)
                if os.path.isfile(full) and os.path.splitext(f)[1].lower() in allowed_ext:
                    images.append(full)
        return images

    def sort_images(self, paths, sort_by, order):
        rev = (order == "降序")
        keys = {
            "文件名": lambda x: os.path.basename(x).lower(),
            "修改日期": os.path.getmtime,
            "创建日期": os.path.getctime,
            "文件大小": os.path.getsize,
        }
        paths.sort(key=keys.get(sort_by, keys["文件名"]), reverse=rev)
        return paths

    def filter_aspect(self, paths, mode):
        if mode == "全部":
            return paths
        out = []
        for p in paths:
            try:
                with Image.open(p) as img:
                    w, h = img.size
                if mode == "横向" and w > h:
                    out.append(p)
                elif mode == "纵向" and h > w:
                    out.append(p)
                elif mode == "正方形" and w == h:
                    out.append(p)
            except Exception:
                continue
        return out

    def load_image(self, preview, folder_path, index, control_mode,
                   sort_by="文件名", sort_order="升序", max_count=200,
                   file_filter="", aspect_filter="全部",
                   include_subfolders=False, unique_id=None):

        # 向后兼容：旧工作流可能传入字符串值
        if isinstance(index, str):
            try:
                index = int(index)
            except (ValueError, TypeError):
                index = 0
        index = int(index) if index is not None else 0

        # 向后兼容：旧工作流可能传入数字 control_mode
        if isinstance(control_mode, (int, float)):
            mode_map = {0: "固定", 1: "增加", 2: "减少", 3: "随机", 4: "指定索引"}
            control_mode = mode_map.get(int(control_mode), "固定")
        elif not isinstance(control_mode, str) or control_mode not in ["固定", "增加", "减少", "随机", "指定索引"]:
            control_mode = "固定"

        print("\n" + "=" * 60)
        print("🖼️ 本地图片加载器")
        print("=" * 60)

        folder_path = folder_path.strip()
        if not folder_path:
            raise Exception("❌ 请输入文件夹路径")
        if not os.path.isdir(folder_path):
            raise Exception(f"❌ 路径无效: {folder_path}")

        print(f"📂 {folder_path}")
        print(f"🔄 子文件夹: {'包含' if include_subfolders else '不包含'}")

        # 扩展名
        if file_filter.strip():
            allowed = set()
            for e in file_filter.split(","):
                e = e.strip().lower()
                if not e.startswith('.'):
                    e = '.' + e
                allowed.add(e)
        else:
            allowed = self.SUPPORTED_EXT

        # 扫描
        paths = self.scan_images(folder_path, include_subfolders, allowed)
        total_on_disk = len(paths)
        print(f"📊 磁盘共 {total_on_disk} 张图片")

        if not paths:
            raise Exception(f"❌ 没有找到图片: {folder_path}")

        # 宽高比
        if aspect_filter != "全部":
            paths = self.filter_aspect(paths, aspect_filter)
            print(f"📐 过滤后: {len(paths)} 张")
            if not paths:
                raise Exception("❌ 没有符合条件的图片")

        # 排序 + 截断
        paths = self.sort_images(paths, sort_by, sort_order)
        if len(paths) > max_count:
            paths = paths[:max_count]

        total = len(paths)
        print(f"📊 加载: {total} 张 | 排序: {sort_by} ({sort_order})")

        # 选图
        if control_mode == "随机":
            idx = random.Random(index).randint(0, total - 1)
        else:
            idx = index % total

        selected = paths[idx]
        name = os.path.splitext(os.path.basename(selected))[0]
        print(f"🎯 {name} [{idx + 1}/{total}]")

        # 加载
        img = Image.open(selected)
        img = ImageOps.exif_transpose(img)
        if img.mode != 'RGB':
            img = img.convert('RGB')
        w, h = img.size
        print(f"✅ {w}x{h}")
        print("=" * 60)

        # 预览
        ui_images = []
        if preview and unique_id:
            temp_dir = folder_paths.get_temp_directory()
            os.makedirs(temp_dir, exist_ok=True)
            filename = f"local_preview_{unique_id}_{idx}.png"
            img.save(os.path.join(temp_dir, filename), format="PNG")
            ui_images.append({"filename": filename, "subfolder": "", "type": "temp"})

        tensor = torch.from_numpy(
            np.array(img).astype(np.float32) / 255.0
        ).unsqueeze(0)

        mode_text = {
            "固定": "固定索引", "增加": "递增索引",
            "减少": "递减索引", "随机": "随机种子", "指定索引": "指定索引",
        }
        folder_name = os.path.basename(folder_path.rstrip("/\\"))
        detail = (
            f"📁 {folder_name} "
            f"🖼 {name} "
            f"📊 {idx + 1}/{total} "
            f"📐 {w}x{h} "
            f"🎯 {mode_text.get(control_mode, '')}: {index} "
            f"📂 {selected}"
        )

        stat = os.stat(selected)
        meta = json.dumps({
            "name": name,
            "ext": os.path.splitext(selected)[1].lstrip('.'),
            "size": stat.st_size,
            "width": w, "height": h,
            "mtime": int(stat.st_mtime * 1000),
            "path": selected,
        }, ensure_ascii=False)

        return {"ui": {"images": ui_images}, "result": (tensor, selected, detail, total, index, meta)}


__all__ = ["LocalImageLoader"]
