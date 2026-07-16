# -*- coding: utf-8 -*-
"""
EagleFileTools — 图片浏览器（移植自 HugoTools）
支持搜索、上传、删除、重命名、复制、分页
"""

import os
import math
import json
import time
import shutil

import numpy as np
import torch
import folder_paths
import node_helpers
from PIL import Image, ImageOps, ImageSequence

from ..tools_utils import IMAGE_EXTENSIONS, find_files, get_setting, get_image_directory, set_setting
from ..eagle_suite.logger import logger

# ── 延迟路由装饰器 ──────────────────────────
from aiohttp import web
from ..eagle_suite.route_registry import route

list_data_cache = {}

def convert_path(file_path, image_directory):
    url_base = "/eagle/image"
    return file_path.replace(image_directory, url_base).replace("\\", "/")


# ── 路由 ───────────────────────────────────────────────────


@route("POST", "/EagleImageList/upload")
async def upload_images(request):
    try:
        data = await request.post()
        files = data.getall('files')
        image_directory = folder_paths.get_input_directory()
        os.makedirs(image_directory, exist_ok=True)
        uploaded_files = []
        for i, f in enumerate(files):
            if not hasattr(f, 'filename'):
                continue
            _, ext = os.path.splitext(f.filename)
            name = f"{int(time.time() * 1000)}{ext}"
            fp = os.path.join(image_directory, name)
            with open(fp, 'wb') as fh:
                fh.write(f.file.read())
            uploaded_files.append({
                'id': i + 1, 'name': name, 'path': fp,
                'src': convert_path(fp, image_directory),
            })
        cache_key = image_directory
        list_data_cache.pop(cache_key, None)
        return web.json_response({"success": True, "message": f"成功上传 {len(uploaded_files)} 个文件", "files": uploaded_files})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=400)

@route("GET", "/eagle/{file_type}/{path:.*}")
async def load_static(request):
    """通用静态文件服务（CSS、图片）"""
    path = request.match_info['path']
    file_type = request.match_info['file_type']
    base_dir = os.path.dirname(os.path.dirname(__file__))

    if file_type == "node_css":
        fp = os.path.join(base_dir, "web", path)
        if os.path.isfile(fp):
            return web.FileResponse(fp)
        return web.Response(status=404)

    elif file_type == "image":
        img_dir = get_image_directory()
        candidates = [
            os.path.join(img_dir, path),
            os.path.join(folder_paths.get_input_directory(), path),
            os.path.join(folder_paths.get_input_directory(), "clipspace", path),
        ]
        for p in candidates:
            if os.path.isfile(p):
                return web.FileResponse(p)
        return web.Response(status=404, text="File not found")

    return web.Response(status=404)

@route("GET", "/EagleImageList/loadImageList")
async def load_image_list(request):
    try:
        keyword = request.query.get("keyword", None)
        sort_option = request.query.get("sort_option", "name")
        sort_direction = request.query.get("sort_direction", "asc")
        image_directory = get_image_directory()
        comfyui_root = folder_paths.base_path
        page = int(request.query.get("page", 1))
        page_size = int(request.query.get("page_size", get_setting('EagleTools.image_node.pagesize', 30)))

        cache_key = image_directory
        if cache_key in list_data_cache:
            list_data = list_data_cache[cache_key]
        else:
            files = find_files(image_directory, 'image')
            list_data = []
            for i, f in enumerate(files):
                list_data.append({
                    'id': i + 1, 'name': os.path.basename(f),
                    'path': f, 'src': convert_path(f, image_directory),
                    'created_time': os.path.getctime(f),
                })
            list_data_cache[cache_key] = list_data

        if sort_option == "name":
            list_data.sort(key=lambda x: x['name'], reverse=(sort_direction == "desc"))
        elif sort_option == "created_time":
            list_data.sort(key=lambda x: x['created_time'], reverse=(sort_direction == "desc"))

        total_pagenum = max(1, math.ceil(len(list_data) / page_size))

        if keyword:
            kw = keyword.lower()
            filtered = [d for d in list_data if kw in d['name'].lower()]
            total_pagenum = max(1, math.ceil(len(filtered) / page_size))
            start = (page - 1) * page_size
            list_data = filtered[start:start + page_size]
        else:
            start = (page - 1) * page_size
            list_data = list_data[start:start + page_size]

        return web.json_response({
            'success': True, 'data': {
                'list_data': list_data, 'total_pagenum': total_pagenum,
                'comfyui_root_directory': comfyui_root,
                'select_options': [folder_paths.get_input_directory(), folder_paths.get_output_directory(), folder_paths.get_temp_directory()],
                "image_directory": image_directory,
            }
        })
    except Exception as e:
        return web.Response(status=500, text=json.dumps({"error": str(e)}))

@route("POST", "/EagleImageList/deleteImage")
async def delete_image(request):
    try:
        data = await request.json()
        path = data.get("image_path", "")
        if not path or not os.path.exists(path):
            return web.Response(status=400, text=json.dumps({"error": "文件不存在"}))
        os.remove(path)
        list_data_cache.clear()
        return web.json_response({"success": True, "message": "删除图片成功"})
    except Exception as e:
        return web.Response(status=500, text=json.dumps({"error": str(e)}))

@route("POST", "/EagleImageList/copyImage")
async def copy_image(request):
    try:
        data = await request.json()
        src = data.get("source_path", "")
        dst = data.get("target_path", "")
        if not src or not dst:
            return web.Response(status=400, text=json.dumps({"error": "缺少参数"}))
        ext = os.path.splitext(src)[1]
        name = str(int(time.time())) + ext
        dest = os.path.join(dst, name)
        shutil.copy2(src, dest)
        new_img = {
            'id': int(time.time() * 1000), 'name': name, 'path': dest,
            'src': convert_path(dest, folder_paths.get_input_directory()),
        }
        return web.json_response({"success": True, 'data': new_img})
    except Exception as e:
        return web.Response(status=500, text=str(e))

@route("POST", "/EagleImageList/clearCache")
async def clear_image_cache(request):
    list_data_cache.clear()
    return web.json_response({"success": True, "message": "缓存已清除"})

@route("POST", "/EagleImageList/changeDir")
async def change_image_directory(request):
    try:
        data = await request.json()
        directory = data.get("directory", "")
        if directory and os.path.isdir(directory):
            set_setting("EagleFileTools.image_path", directory)
            list_data_cache.clear()
            return web.json_response({"success": True, "message": "目录已切换"})
        return web.json_response({"success": False, "error": "目录无效"}, status=400)
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)

@route("POST", "/EagleImageList/renameImage")
async def rename_image(request):
    try:
        data = await request.json()
        path = data.get("image_path", "")
        new_name = data.get("new_name", "")
        if not path or not new_name:
            return web.Response(status=400, text=json.dumps({"error": "缺少参数"}))
        if not os.path.exists(path):
            return web.Response(status=404, text=json.dumps({"error": "文件不存在"}))
        ext = os.path.splitext(path)[1]
        if not new_name.endswith(ext):
            new_name += ext
        new_path = os.path.join(os.path.dirname(path), new_name)
        if os.path.exists(new_path) and path != new_path:
            return web.Response(status=400, text=json.dumps({"success": False, "error": "同名文件已存在"}))
        os.rename(path, new_path)
        list_data_cache.clear()
        img_dir = get_image_directory()
        src = convert_path(new_path, img_dir)
        if not src.startswith("/eagle/image"):
            src = convert_path(new_path, os.path.join(folder_paths.get_input_directory(), 'clipspace'))
            if not src.startswith("/eagle/image"):
                src = convert_path(new_path, folder_paths.get_input_directory())
        return web.json_response({"success": True, "message": "图片重命名成功", "data": {
            "id": int(time.time() * 1000), "name": new_name, "path": new_path, "src": src,
        }})
    except Exception as e:
        return web.Response(status=500, text=json.dumps({"error": str(e)}))


# ── 节点类 ─────────────────────────────────────────────────

class EagleImageList:
    """图片浏览器（移植自 HugoTools）"""

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_path": ("STRING", {"multiline": False, "default": ""}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "image_path", "width", "height")
    OUTPUT_NODE = True
    FUNCTION = "process"
    CATEGORY = "🦅 Eagle/工具"

    def process(self, image_path):
        if not image_path or not os.path.exists(image_path):
            raise ValueError("❌ 图片路径不存在，请重新选择图片")

        img = node_helpers.pillow(Image.open, image_path)
        output_images = []
        output_masks = []
        w, h = None, None

        for i in ImageSequence.Iterator(img):
            i = node_helpers.pillow(ImageOps.exif_transpose, i)
            if i.mode == 'I':
                i = i.point(lambda v: v * (1 / 255))
            image = i.convert("RGB")
            if len(output_images) == 0:
                w, h = image.size
            if image.size != (w, h):
                continue

            arr = np.array(image).astype(np.float32) / 255.0
            t = torch.from_numpy(arr)[None,]

            if 'A' in i.getbands():
                mask = np.array(i.getchannel('A')).astype(np.float32) / 255.0
                mask = 1. - torch.from_numpy(mask)
            elif i.mode == 'P' and 'transparency' in i.info:
                mask = np.array(i.convert('RGBA').getchannel('A')).astype(np.float32) / 255.0
                mask = 1. - torch.from_numpy(mask)
            else:
                mask = torch.zeros((64, 64), dtype=torch.float32)

            output_images.append(t)
            output_masks.append(mask.unsqueeze(0))

        if len(output_images) > 1 and img.format not in ['MPO']:
            img_tensor = torch.cat(output_images, dim=0)
            mask_tensor = torch.cat(output_masks, dim=0)
        else:
            img_tensor = output_images[0]
            mask_tensor = output_masks[0]

        return (img_tensor, mask_tensor, image_path, w, h)
