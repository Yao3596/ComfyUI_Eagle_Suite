# -*- coding: utf-8 -*-
"""
EagleFileTools — Lora 模型浏览器（移植自 HugoTools）
支持搜索、删除、重命名、元数据查看
"""

import os
import math
import json
import time
import hashlib
import struct

import folder_paths
import comfy.utils
import comfy.sd

from ..tools_utils import IMAGE_EXTENSIONS, get_setting
from ..eagle_suite.logger import logger

# ── 延迟路由装饰器 ──────────────────────────
from aiohttp import web
from ..eagle_suite.route_registry import route
list_data_cache = {}

def _get_lora_directory():
    try:
        return folder_paths.get_folder_paths("loras")[0]
    except Exception:
        return os.path.join(folder_paths.models_dir, "loras")

def convert_path(file_path, lora_directory):
    url_base = "/eagle/lora"
    return file_path.replace(lora_directory, url_base).replace("\\", "/")


# ── 路由 ───────────────────────────────────────────────────


@route("POST", "/EagleLoraList/clearCache")
async def clear_lora_cache(request):
    list_data_cache.clear()
    return web.json_response({"success": True, "message": "缓存已清除"})

@route("POST", "/EagleLoraList/deleteLora")
async def delete_lora(request):
    try:
        data = await request.json()
        path = data.get("lora_path", "")
        if not path or not os.path.exists(path):
            return web.json_response({"success": False, "error": "文件不存在"})
        os.remove(path)
        for ext in IMAGE_EXTENSIONS:
            thumb = os.path.splitext(path)[0] + ext
            if os.path.isfile(thumb):
                os.remove(thumb)
        list_data_cache.clear()
        return web.json_response({"success": True, "message": "删除成功"})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)

@route("POST", "/eagle/read_file")
async def eagle_read_file(request):
    try:
        data = await request.json()
        fp = data.get("file_path", "")
        if not fp or not os.path.isfile(fp):
            return web.json_response({"success": False, "error": "文件不存在"}, status=404)
        with open(fp, 'r', encoding='utf-8') as f:
            text = f.read()
        return web.json_response({"success": True, "data": text})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)

@route("GET", "/EagleLoraList/loadLoraList")
async def load_lora_list(request):
    try:
        keyword = request.query.get("keyword", None)
        sort_by = request.query.get("sort_option", "name")
        sort_dir = request.query.get("sort_direction", "asc")
        page = int(request.query.get("page", 1))
        page_size = int(request.query.get("page_size", get_setting('EagleTools.lora_node.pagesize', 30)))
        lora_dir = _get_lora_directory()

        cache_key = lora_dir
        if cache_key in list_data_cache:
            list_data = list_data_cache[cache_key]
        else:
            list_data = []
            for root, _, files in os.walk(lora_dir):
                for f in sorted(files):
                    if not f.lower().endswith(('.safetensors', '.ckpt', '.pt', '.pth')):
                        continue
                    fp = os.path.join(root, f)
                    rel = os.path.relpath(fp, lora_dir)
                    list_data.append({
                        'name': rel, 'path': fp,
                        'size': os.path.getsize(fp),
                        'modified_time': os.path.getmtime(fp),
                    })
            list_data_cache[cache_key] = list_data

        if sort_by == "name":
            list_data.sort(key=lambda x: x['name'].lower(), reverse=(sort_dir == "desc"))
        elif sort_by == "size":
            list_data.sort(key=lambda x: x['size'], reverse=(sort_dir == "desc"))
        elif sort_by == "modified_time":
            list_data.sort(key=lambda x: x['modified_time'], reverse=(sort_dir == "desc"))

        total = len(list_data)
        total_pagenum = max(1, math.ceil(total / page_size))

        if keyword:
            kw = keyword.lower()
            list_data = [d for d in list_data if kw in d['name'].lower()]
            total_pagenum = max(1, math.ceil(len(list_data) / page_size))

        start = (page - 1) * page_size
        page_items = list_data[start:start + page_size]

        return web.json_response({
            "success": True, "data": {
                "list_data": page_items, "total_pagenum": total_pagenum,
                "lora_directory": lora_dir,
            }
        })
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)

@route("POST", "/EagleLoraList/rename_lora")
async def rename_lora(request):
    try:
        data = await request.json()
        path = data.get("lora_path", "")
        new_name = data.get("new_name", "")
        if not path or not new_name:
            return web.json_response({"success": False, "error": "参数不足"})
        ext = os.path.splitext(path)[1]
        if not new_name.endswith(ext):
            new_name += ext
        new_path = os.path.join(os.path.dirname(path), new_name)
        if os.path.exists(new_path) and path != new_path:
            return web.json_response({"success": False, "error": "同名文件已存在"})
        os.rename(path, new_path)
        for old_ext in ['.png', '.jpg', '.webp']:
            old_preview = os.path.splitext(path)[0] + old_ext
            if os.path.isfile(old_preview):
                os.rename(old_preview, os.path.splitext(new_path)[0] + old_ext)
        list_data_cache.clear()
        return web.json_response({"success": True, "path": new_path})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)

@route("GET", "/EagleLoraList/getFileHash")
async def get_lora_hash(request):
    try:
        path = request.query.get("path", "")
        if not path or not os.path.isfile(path):
            return web.json_response({"success": False, "error": "文件不存在"})
        h = hashlib.sha256()
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(65536), b''):
                h.update(chunk)
        return web.json_response({"success": True, "hash": h.hexdigest()})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)

@route("GET", "/EagleLoraList/getLoraMetadata")
async def get_lora_metadata(request):
    try:
        path = request.query.get("path", "")
        if not path or not os.path.isfile(path):
            return web.json_response({"success": False, "error": "文件不存在"})
        metadata = {}
        if path.lower().endswith('.safetensors'):
            with open(path, 'rb') as f:
                length = struct.unpack('<Q', f.read(8))[0]
                if length > 0:
                    meta_str = f.read(length).decode('utf-8')
                    metadata = json.loads(meta_str)
        return web.json_response({"success": True, "metadata": metadata})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("GET", "/eagle/lora/{path:.*}")
async def serve_lora_static(request):
    """提供 LoRA 缩略图预览（同名 png/jpg/webp）"""
    path = request.match_info['path']
    if not path:
        return web.Response(status=404)
    try:
        full = folder_paths.get_full_path_or_raise("loras", path)
    except Exception:
        full = ""
    if full and os.path.isfile(full):
        return web.FileResponse(full)
    base = os.path.splitext(full)[0] if full else ""
    for ext in IMAGE_EXTENSIONS:
        thumb = base + ext
        if os.path.isfile(thumb):
            return web.FileResponse(thumb)
    return web.Response(status=404, text="File not found")


# ── 节点类 ─────────────────────────────────────────────────

class EagleLoraList:
    """Lora 模型浏览器（移植自 HugoTools）"""

    def __init__(self):
        self.loaded_lora = None

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "lora_path": ("STRING", {"multiline": False, "default": ""}),
                "model": ("MODEL",),
                "strength_model": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
                "strength_clip": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
            },
            "optional": {
                "clip": ("CLIP",),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("model", "clip", "lora_path")
    FUNCTION = "process"
    CATEGORY = "🦅 Eagle/工具"

    def process(self, lora_path, model, strength_model, strength_clip, clip=None):
        if not lora_path or not os.path.exists(lora_path):
            return (model, clip, lora_path)

        cache_key = f"{lora_path}:{strength_model}:{strength_clip}"
        if self.loaded_lora == cache_key:
            return (model, clip, lora_path)

        try:
            lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
            model, clip = comfy.sd.load_lora_for_models(model, clip, lora, strength_model, strength_clip)
            self.loaded_lora = cache_key
            logger.info(f"[EagleFileTools] Lora 已应用: {os.path.basename(lora_path)}")
        except Exception as e:
            logger.error(f"[EagleFileTools] Lora 加载失败: {e}")

        return (model, clip, lora_path)
