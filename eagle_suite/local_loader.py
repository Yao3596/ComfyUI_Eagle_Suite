# -*- coding: utf-8 -*-
"""本地图片加载器 - 纯本地/网络路径"""
import os
import json
import numpy as np
from PIL import Image, ImageOps
import random
import torch
import folder_paths
import hashlib
import threading
from .logger import logger


class LocalImageLoader:

    SUPPORTED_EXT = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff', '.tif'}

    # 按 unique_id 维护递增/递减/随机状态，解决 ComfyUI 批次运行时前端 index 来不及更新的问题
    _state = {}
    _state_lock = threading.RLock()

    @classmethod
    def _state_key(cls, unique_id, index):
        """生成状态键；没有 unique_id 时使用全局回退键。"""
        if unique_id is not None:
            return f"local_loader:{unique_id}"
        return f"local_loader:__global__:{index}"

    @classmethod
    def _get_effective_index(cls, control_mode, index, total, unique_id):
        """根据控制模式计算实际索引，并在后端维护递增/递减/随机状态。"""
        if total <= 0:
            return 0

        key = cls._state_key(unique_id, index)

        if len(cls._state) > 512:
            with cls._state_lock:
                cls._state.pop(next(iter(cls._state)), None)

        if control_mode not in ("增加", "减少", "随机"):
            # 固定 / 指定索引：直接使用控件值，并清理旧状态避免意外。
            cls._state.pop(key, None)
            return index % total

        state = cls._state.get(key)
        if (
            not isinstance(state, dict)
            or state.get("mode") != control_mode
            or state.get("anchor") != index
        ):
            state = {
                "mode": control_mode,
                "anchor": index,
                "current": None,
                "counter": 0,
            }
            cls._state[key] = state

        if control_mode == "随机":
            # index 是随机序列的锚点，counter 保证同一批队列内每次执行都变化。
            current = random.Random(f"{index}:{state['counter']}").randint(0, total - 1)
            state["current"] = current
            state["counter"] += 1
            return current

        if control_mode == "增加":
            cur = state["current"] if state["current"] is not None else index - 1
            cur = (cur + 1) % total
            state["current"] = cur
            state["counter"] += 1
            return cur

        if control_mode == "减少":
            cur = state["current"] if state["current"] is not None else index + 1
            cur = (cur - 1) % total
            state["current"] = cur
            state["counter"] += 1
            return cur

        return index % total

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
                "control_mode": (["固定", "增加", "减少", "随机", "指定索引"],),
            },
            "optional": {
                "index": ("INT", {"default": 0, "min": 0, "max": 0x7FFFFFFF, "step": 1}),
                "sort_by": (["文件名", "修改日期", "创建日期", "文件大小"],),
                "sort_order": (["升序", "降序"],),
                "max_count": ("INT", {"default": 2000, "min": 1, "max": 999999}),
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
        index = kwargs.get("index", 0)
        unique_id = kwargs.get("unique_id")
        key = cls._state_key(unique_id, index)

        if mode in ("增加", "减少", "随机"):
            # 首次执行或用户改变起始 index 时强制刷新；之后用后端计数器绕过缓存。
            state = cls._state.get(key)
            if (
                not isinstance(state, dict)
                or state.get("mode") != mode
                or state.get("anchor") != index
            ):
                return float("nan")
            return f"{mode}:{index}:{state.get('counter', 0)}:{state.get('current')}"

        # 固定 / 指定索引：清理状态并返回控件值
        cls._state.pop(key, None)
        folder = str(kwargs.get("folder_path") or "").strip()
        try:
            entries = []
            recursive = bool(kwargs.get("include_subfolders", False))
            iterator = os.walk(folder) if recursive else [(folder, [], os.listdir(folder))]
            for root, _, names in iterator:
                for name in names:
                    path = os.path.join(root, name)
                    if os.path.isfile(path):
                        stat = os.stat(path)
                        entries.append((os.path.relpath(path, folder), stat.st_mtime_ns, stat.st_size))
            digest = hashlib.sha256(repr(sorted(entries)).encode("utf-8", "surrogatepass")).hexdigest()
        except OSError:
            digest = "missing"
        return f"{index}:{digest}"

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

    def load_image(self, preview, folder_path, control_mode,
                   index=0, sort_by="文件名", sort_order="升序", max_count=200,
                   file_filter="", aspect_filter="全部",
                   include_subfolders=False, unique_id=None):

        logger.debug("本地图片加载器开始执行")

        folder_path = folder_path.strip()
        if not folder_path:
            raise Exception("❌ 请输入文件夹路径")
        if not os.path.isdir(folder_path):
            raise Exception(f"❌ 路径无效: {folder_path}")

        logger.debug(f"本地图片目录: {folder_path}; 子文件夹: {include_subfolders}")

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
        logger.debug(f"磁盘共 {total_on_disk} 张图片")

        if not paths:
            raise Exception(f"❌ 没有找到图片: {folder_path}")

        # 宽高比
        if aspect_filter != "全部":
            paths = self.filter_aspect(paths, aspect_filter)
            logger.debug(f"比例过滤后: {len(paths)} 张")
            if not paths:
                raise Exception("❌ 没有符合条件的图片")

        # 排序 + 截断
        paths = self.sort_images(paths, sort_by, sort_order)
        if len(paths) > max_count:
            paths = paths[:max_count]

        total = len(paths)
        logger.debug(f"加载: {total} 张 | 排序: {sort_by} ({sort_order})")

        # 选图（后端维护递增/递减/随机状态，兼容批次运行）
        idx = self._get_effective_index(control_mode, index, total, unique_id)
        selected = paths[idx]
        name = os.path.splitext(os.path.basename(selected))[0]
        logger.debug(f"选中 {name} [{idx + 1}/{total}]")

        # 加载
        img = Image.open(selected)
        img = ImageOps.exif_transpose(img)
        if img.mode != 'RGB':
            img = img.convert('RGB')
        w, h = img.size
        logger.debug(f"已加载尺寸 {w}x{h}")

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
            "减少": "递减索引", "随机": "随机索引", "指定索引": "指定索引",
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
            "index": idx,
        }, ensure_ascii=False)

        return {
            "ui": {"images": ui_images, "current_index": [idx], "total": [total]},
            "result": (tensor, selected, detail, total, idx, meta),
        }


__all__ = ["LocalImageLoader"]
