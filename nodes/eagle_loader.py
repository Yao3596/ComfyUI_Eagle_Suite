# -*- coding: utf-8 -*-
import os
import json
import requests
import torch
import numpy as np
from PIL import Image
import re
import random
import io
import folder_paths


class EagleLoader:
    """Eagle 图片加载器 - 通过 Eagle API 加载图片"""

    SAFETY_MAX = 10000
    SUPPORTED_EXT = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif'}

    def __init__(self):
        self.eagle_api_url = "http://localhost:41595/api"

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
                    "placeholder": "Eagle 文件夹 ID / URL / 名称"
                }),
                "index": ("INT", {"default": 0, "min": 0, "max": 0x7FFFFFFF, "step": 1}),
                "control_mode": (["固定", "增加", "减少", "随机", "指定索引"],),
            },
            "optional": {
                "sort_by": (["名称 (A-Z)", "添加日期", "修改日期", "创建日期", "文件大小", "扩展名", "评分"], {"default": "添加日期"}),
                "sort_order": (["升序", "降序"], {"default": "降序"}),
                "max_count": ("INT", {"default": 0, "min": 0, "max": 99999, "step": 1, "tooltip": "0=自动根据文件夹数量，上限10000"}),
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
    
    # ── 输入解析 ──
    def parse_folder_input(self, folder_input):
        s = folder_input.strip()
        if not s:
            return None, None
        if s.startswith("eagle://folder/"):
            return s.replace("eagle://folder/", ""), "eagle_id"
        if "localhost:41595" in s or "127.0.0.1:41595" in s:
            match = re.search(r'[?&]id=([A-Z0-9]+)', s)
            if match:
                return match.group(1), "eagle_id"
        if len(s) == 13 and s.isalnum() and s.isupper():
            return s, "eagle_id"
        return s, "eagle_name"

    # ── Eagle API ──
    def get_folders(self):
        try:
            resp = requests.get(f"{self.eagle_api_url}/folder/list", timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "success":
                    return data.get("data", [])
        except Exception as e:
            print(f"❌ 获取文件夹列表失败: {e}")
        return []

    def get_eagle_library_path(self):
        try:
            resp = requests.get(f"{self.eagle_api_url}/library/info", timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "success":
                    return data.get("data", {}).get("library", {}).get("path", "")
        except Exception as e:
            print(f"⚠️ 获取资源库路径失败: {e}")
        return None

    # ── 文件夹查找 ──
    def _find_in_tree(self, folder_list, target_id):
        for f in folder_list:
            if f.get("id") == target_id:
                return f
            children = f.get("children", [])
            if children:
                result = self._find_in_tree(children, target_id)
                if result:
                    return result
        return None

    def get_folder_info_by_id(self, folder_id):
        try:
            folders = self.get_folders()
            def search(fl, pp=""):
                for f in fl:
                    cur = f"{pp}/{f.get('name','')}" if pp else f.get('name','')
                    if f.get("id") == folder_id:
                        return {"name": f.get("name",""), "path": cur, "description": f.get("description",""), "icon": f.get("icon",""), "iconColor": f.get("iconColor","")}
                    ch = f.get("children", [])
                    if ch:
                        r = search(ch, cur)
                        if r: return r
                return None
            return search(folders)
        except Exception as e:
            print(f"⚠️ 获取文件夹信息失败: {e}")
            return None

    def find_folder_by_path(self, folders, path):
        parts = [p.strip() for p in path.split("/") if p.strip()]
        def search(fl, d=0):
            if d >= len(parts): return None
            for f in fl:
                if f.get("name") == parts[d]:
                    if d == len(parts)-1: return f.get("id")
                    ch = f.get("children", [])
                    if ch:
                        r = search(ch, d+1)
                        if r: return r
            return None
        return search(folders)

    def get_subfolders(self, folder_id, folders):
        subs = []
        def collect(folder):
            for ch in folder.get("children", []):
                cid = ch.get("id")
                if cid:
                    subs.append(cid)
                    collect(ch)
        target = self._find_in_tree(folders, folder_id)
        if target: collect(target)
        return subs

    # ── 图片计数 ──
    def get_folder_item_count(self, folder_id, include_subfolders=True):
        try:
            folders = self.get_folders()
            target = self._find_in_tree(folders, folder_id)
            if not target: return -1
            def count_f(f):
                c = f.get("imageCount", 0) or f.get("count", 0) or 0
                if include_subfolders:
                    for ch in f.get("children", []):
                        c += count_f(ch)
                return c
            total = count_f(target)
            return total if total > 0 else -1
        except:
            return -1

    # ── Eagle API 图片获取 ──
    def get_folder_images_from_api(self, folder_id, max_count=10000, include_subfolders=True):
        all_items = []
        folders_to_query = [folder_id]
        if include_subfolders:
            try:
                folders = self.get_folders()
                folders_to_query.extend(self.get_subfolders(folder_id, folders))
                print(f"📂 共 {len(folders_to_query)} 个文件夹需要查询")
            except Exception as e:
                print(f"⚠️ 获取子文件夹失败: {e}")
        processed = set()
        for cid in folders_to_query:
            if len(all_items) >= max_count: break
            if cid in processed: continue
            processed.add(cid)
            try:
                offset = 0
                while len(all_items) < max_count:
                    resp = requests.get(f"{self.eagle_api_url}/item/list",
                        params={"folders": cid, "limit": 200, "offset": offset}, timeout=30)
                    if resp.status_code != 200: break
                    data = resp.json()
                    if data.get("status") != "success": break
                    items = data.get("data", [])
                    if not items: break
                    all_items.extend(items)
                    if len(items) < 200: break
                    offset += 200
            except Exception as e:
                print(f"⚠️ 查询文件夹 {cid} 失败: {e}")
        print(f"📊 API 共获取 {len(all_items)} 张图片")
        return all_items[:max_count]

    def get_folder_images(self, folder_id, max_count=10000, include_subfolders=True):
        items = self.get_folder_images_from_api(folder_id, max_count, include_subfolders)
        if items:
            return items
        print(f"❌ API 未获取到任何图片")
        return []

    # ── 筛选与排序 ──
    def filter_images(self, images, tags_filter, star_filter, aspect_filter):
        filtered = images
        filters_applied = []
        if tags_filter:
            tags_list = [t.strip().lower() for t in tags_filter.split(",") if t.strip()]
            if tags_list:
                filtered = [img for img in filtered if any(tag in [t.lower() for t in img.get("tags",[])] for tag in tags_list)]
                filters_applied.append(f"标签: {tags_filter}")
        if star_filter != "全部":
            if star_filter == "未评分":
                filtered = [img for img in filtered if img.get("star",0) == 0]
            else:
                sv = int(star_filter[0])
                filtered = [img for img in filtered if img.get("star",0) == sv]
            filters_applied.append(f"评分: {star_filter}")
        if aspect_filter != "全部":
            result = []
            for img in filtered:
                w, h = img.get("width",0), img.get("height",0)
                if w == 0 or h == 0: continue
                ratio = w / h
                if aspect_filter == "横向" and ratio > 1.1: result.append(img)
                elif aspect_filter == "纵向" and ratio < 0.9: result.append(img)
                elif aspect_filter == "方形" and 0.9 <= ratio <= 1.1: result.append(img)
            filtered = result
            filters_applied.append(f"宽高比: {aspect_filter}")
        return filtered, filters_applied

    def sort_images(self, images, sort_by, sort_order):
        sort_map = {"名称 (A-Z)": "name", "添加日期": "mtime", "修改日期": "modificationTime", "创建日期": "btime", "文件大小": "size", "扩展名": "ext", "评分": "star"}
        key = sort_map.get(sort_by, "mtime")
        reverse = (sort_order == "降序")
        if sort_by == "扩展名":
            return sorted(images, key=lambda x: x.get("ext","").lower(), reverse=reverse)
        numeric = ["size", "mtime", "btime", "star", "modificationTime"]
        return sorted(images, key=lambda x: x.get(key, 0 if key in numeric else ""), reverse=reverse)

    # ── 图片加载 ──
    def get_item_info_from_api(self, item_id):
        try:
            resp = requests.get(f"{self.eagle_api_url}/item/info", params={"id": item_id}, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "success":
                    fp = data.get("data", {}).get("filePath", "")
                    if fp and os.path.exists(fp):
                        return fp
        except Exception as e:
            print(f"⚠️ API 请求异常: {e}")
        return None

    def build_image_path(self, library_path, image_data):
        image_id = image_data.get("id", "")
        name = image_data.get("name", "")
        ext = image_data.get("ext", "png")
        if not image_id or not name: return None
        image_folder = os.path.join(library_path, "images", f"{image_id}.info")
        image_path = os.path.join(image_folder, f"{name}.{ext}")
        if os.path.exists(image_path): return image_path
        if os.path.exists(image_folder):
            for file in os.listdir(image_folder):
                if file.lower().endswith(tuple(self.SUPPORTED_EXT)) and file != "metadata.json":
                    return os.path.join(image_folder, file)
        return None

    def load_image_from_path(self, image_path):
        try:
            img = Image.open(image_path)
            img.load()
            return img, "本地文件"
        except Exception as e:
            print(f"⚠️ 加载失败: {e}")
            return None, ""

    def load_image_from_thumbnail(self, item_id):
        try:
            resp = requests.get(f"{self.eagle_api_url}/item/thumbnail", params={"id": item_id}, timeout=10)
            if resp.status_code == 200:
                ct = resp.headers.get('content-type', '')
                if 'image' in ct and len(resp.content) >= 100:
                    return Image.open(io.BytesIO(resp.content)), "Eagle 缩略图"
        except Exception as e:
            print(f"⚠️ 缩略图加载失败: {e}")
        return None, ""

    # ── 格式化 ──
    def format_info(self, folder, image_name, idx, total, w, h, current_value, mode, filters):
        mode_text = {
            "固定": f"固定索引: {current_value}",
            "增加": f"递增索引: {current_value}",
            "减少": f"递减索引: {current_value}",
            "随机": f"随机种子: {current_value}",
            "指定索引": f"指定索引: {current_value}",
        }
        lines = [f"📁 文件夹: {folder}", f"🖼️ 图片: {image_name}",
                 f"📊 位置: {idx+1}/{total}", f"📐 尺寸: {w}x{h}",
                 f"🎯 {mode_text.get(mode, '')}"]
        if filters:
            lines.append(f"🔍 筛选: {', '.join(filters)}")
        return "\n".join(lines)

    def format_metadata(self, image_data, width, height):
        return json.dumps({
            "id": image_data.get("id",""), "name": image_data.get("name",""),
            "size": image_data.get("size",0), "ext": image_data.get("ext",""),
            "tags": image_data.get("tags",[]), "folders": image_data.get("folders",[]),
            "star": image_data.get("star",0), "annotation": image_data.get("annotation",""),
            "width": width, "height": height,
            "mtime": image_data.get("mtime",0), "btime": image_data.get("btime",0),
        }, ensure_ascii=False, indent=2)

    # ── 主函数 ──
    def load_image(self, preview, folder_input, index, control_mode,
                   sort_by="添加日期", sort_order="降序", max_count=0,
                   tags_filter="", star_filter="全部", aspect_filter="全部",
                   include_subfolders=True):

        print("\n" + "=" * 60)
        print("🦅 Eagle 图片加载器")
        print("=" * 60)

        value, input_type = self.parse_folder_input(folder_input)
        if not value:
            raise Exception("❌ 请输入 Eagle 文件夹 ID、URL 或名称")

        if input_type == "eagle_name":
            folders = self.get_folders()
            folder_id = self.find_folder_by_path(folders, value)
            if not folder_id:
                raise Exception(f"❌ 找不到 Eagle 文件夹: {value}")
            print(f"📂 文件夹路径: {value} → ID: {folder_id}")
        else:
            folder_id = value
            fi = self.get_folder_info_by_id(folder_id)
            if fi:
                icon_map = {"star":"⭐","heart":"❤️","brain":"🧠","tree":"🌳","eye":"👁️","folder":"📁"}
                icon = icon_map.get(fi.get("icon",""), "📂")
                print(f"{icon} 文件夹: {fi['name']}")
                if fi.get("description"):
                    print(f"📝 描述: {fi['description']}")
            print(f"🆔 ID: {folder_id}")

        library_path = self.get_eagle_library_path()
        if library_path:
            print(f"📚 资源库: {library_path}")
        print(f"🔄 子文件夹: {'包含' if include_subfolders else '不包含'}")

        if max_count == 0:
            actual_count = self.get_folder_item_count(folder_id, include_subfolders)
            if actual_count > 0:
                max_count = min(actual_count, self.SAFETY_MAX)
                if actual_count > self.SAFETY_MAX:
                    print(f"⚠️ 共 {actual_count} 张，限制为 {self.SAFETY_MAX}")
                else:
                    print(f"📊 自动模式: 共 {actual_count} 张，全部加载")
            else:
                max_count = self.SAFETY_MAX
                print(f"📊 无法获取数量，使用安全上限: {max_count}")
        else:
            print(f"📊 手动上限: {max_count}")

        images = self.get_folder_images(folder_id, max_count, include_subfolders)
        if not images:
            raise Exception("❌ 文件夹中没有图片")

        valid_images, filters_applied = self.filter_images(
            images, tags_filter, star_filter, aspect_filter)
        if not valid_images:
            raise Exception("❌ 筛选后没有符合条件的图片")

        valid_images = self.sort_images(valid_images, sort_by, sort_order)
        total = len(valid_images)
        print(f"📊 图片: {total} 张 | 排序: {sort_by} ({sort_order})")

        # 选择图片
        image_index = self._select_index(control_mode, index, total)

        target_image = valid_images[image_index]
        item_id = target_image.get("id", "")
        image_name = target_image.get("name", "未知")
        print(f"🎯 选择: {image_name} [{image_index+1}/{total}]")

        # 三级回退加载
        img = None
        actual_image_path = ""

        api_path = self.get_item_info_from_api(item_id)
        if api_path:
            img, load_method = self.load_image_from_path(api_path)
            if img: actual_image_path = api_path

        if img is None and library_path:
            bp = self.build_image_path(library_path, target_image)
            if bp:
                img, load_method = self.load_image_from_path(bp)
                if img: actual_image_path = bp

        if img is None:
            img, load_method = self.load_image_from_thumbnail(item_id)
            if img: actual_image_path = f"eagle://item/{item_id} (缩略图)"

        if img is None:
            raise Exception(f"❌ 无法加载图片: {image_name}")

        # ── 后处理 ──
        actual_width, actual_height = img.size
        print(f"✅ 加载成功: {actual_width}x{actual_height}")

        if img.mode == "RGBA":
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3])
            img = bg
        else:
            img = img.convert("RGB")

        # 预览
        preview_images = []
        if preview:
            temp_dir = folder_paths.get_temp_directory()
            temp_file = f"eagle_preview_{image_index}.png"
            img.save(os.path.join(temp_dir, temp_file), compress_level=4)
            preview_images.append({"filename": temp_file, "subfolder": "", "type": "temp"})

        img_array = np.array(img).astype(np.float32) / 255.0
        img_tensor = torch.from_numpy(img_array)[None,]

        info = self.format_info(folder_input, image_name, image_index,
            total, actual_width, actual_height, index, control_mode, filters_applied)
        info += f"\n📂 文件路径: {actual_image_path}"
        metadata = self.format_metadata(target_image, actual_width, actual_height)

        print("=" * 60 + "\n")
        return {
            "ui": {"images": preview_images},
            "result": (img_tensor, actual_image_path, info, total, index, metadata)
        }

    # ── 索引选择 ──
    def _select_index(self, control_mode, index, total):
        if control_mode == "随机":
            rng = random.Random(index)
            return rng.randint(0, total - 1)
        return index % total
