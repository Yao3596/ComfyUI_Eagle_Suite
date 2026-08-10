# -*- coding: utf-8 -*-
"""
EagleFileTools — 图片浏览器（移植自 HugoTools）
支持搜索、上传、删除、重命名、复制
改进：异步懒加载、手动输入路径、无限滚动
"""

import os
import math
import json
import time
import shutil
import asyncio
import threading
from io import BytesIO

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
thumbnail_cache = {}
thumbnail_cache_lock = threading.Lock()
THUMBNAIL_SIZE = 256
THUMBNAIL_CACHE_MAX = 512  # 增加缓存容量


def _clear_thumbnail_cache():
    with thumbnail_cache_lock:
        thumbnail_cache.clear()


def _build_thumbnail(image_path, size):
    """解码单张原图并生成轻量 WebP；动画只取第一帧。"""
    stat = os.stat(image_path)
    cache_key = (image_path, stat.st_mtime_ns, stat.st_size, size)
    with thumbnail_cache_lock:
        cached = thumbnail_cache.get(cache_key)
    if cached is not None:
        return cached

    with Image.open(image_path) as image:
        try:
            image.seek(0)
        except Exception:
            pass
        try:
            image.draft("RGB", (size, size))
        except Exception:
            pass
        image = ImageOps.exif_transpose(image)
        resampling = getattr(Image, "Resampling", Image)
        image.thumbnail((size, size), resampling.LANCZOS)
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "transparency" in image.info else "RGB")
        output = BytesIO()
        try:
            image.save(output, format="WEBP", quality=78, method=3)
            result = (output.getvalue(), "image/webp")
        except Exception:
            output = BytesIO()
            image.save(output, format="PNG", optimize=True)
            result = (output.getvalue(), "image/png")

    with thumbnail_cache_lock:
        thumbnail_cache[cache_key] = result
        while len(thumbnail_cache) > THUMBNAIL_CACHE_MAX:
            thumbnail_cache.pop(next(iter(thumbnail_cache)))
    return result


def _thumbnail_url(src, modified_time):
    separator = "&" if "?" in src else "?"
    return f"{src}{separator}thumbnail=1&size={THUMBNAIL_SIZE}&v={int(modified_time * 1000)}"

def convert_path(file_path, image_directory):
    url_base = "/eagle/image"
    return file_path.replace(image_directory, url_base).replace("\\", "/")


# ── 路由 ───────────────────────────────────────────────────


@route("POST", "/EagleImageList/upload")
async def upload_images(request):
    try:
        data = await request.post()
        files = data.getall('files')
        target_dir = data.get('target_directory', folder_paths.get_input_directory())
        
        if not os.path.isdir(target_dir):
            target_dir = folder_paths.get_input_directory()
        
        os.makedirs(target_dir, exist_ok=True)
        uploaded_files = []
        
        for i, f in enumerate(files):
            if not hasattr(f, 'filename'):
                continue
            _, ext = os.path.splitext(f.filename)
            name = f"{int(time.time() * 1000)}_{i}{ext}"
            fp = os.path.join(target_dir, name)
            with open(fp, 'wb') as fh:
                fh.write(f.file.read())
            
            modified_time = os.path.getmtime(fp)
            src = convert_path(fp, target_dir)
            uploaded_files.append({
                'id': f"{fp}_{int(modified_time * 1000)}", 
                'name': name, 
                'path': fp,
                'src': src,
                'thumb_src': _thumbnail_url(src, modified_time),
                'modified_time': modified_time,
            })
        
        # 清除对应目录的缓存
        cache_key = target_dir
        list_data_cache.pop(cache_key, None)
        
        return web.json_response({
            "success": True, 
            "message": f"成功上传 {len(uploaded_files)} 个文件", 
            "files": uploaded_files
        })
    except Exception as e:
        logger.error(f"上传失败: {str(e)}")
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
                if request.query.get("thumbnail") == "1":
                    try:
                        size = max(96, min(512, int(request.query.get("size", THUMBNAIL_SIZE))))
                        image_bytes, content_type = await asyncio.to_thread(_build_thumbnail, p, size)
                        stat = os.stat(p)
                        return web.Response(body=image_bytes, headers={
                            "Content-Type": content_type,
                            "Cache-Control": "public, max-age=86400, immutable",
                            "ETag": f'"thumb-{stat.st_mtime_ns:x}-{stat.st_size:x}-{size}"',
                        })
                    except Exception as error:
                        logger.warning(f"[ImageBrowser] 生成缩略图失败 {p}: {error}")
                        placeholder = b"""<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#17171d"/><text x="128" y="132" text-anchor="middle" fill="#666" font-size="14">Thumbnail unavailable</text></svg>"""
                        return web.Response(body=placeholder, headers={
                            "Content-Type": "image/svg+xml",
                            "Cache-Control": "no-store",
                        })
                return web.FileResponse(p)
        return web.Response(status=404, text="File not found")

    return web.Response(status=404)


@route("GET", "/EagleImageList/loadImageList")
async def load_image_list(request):
    """
    异步懒加载图片列表
    参数:
    - directory: 目标目录（必需）
    - keyword: 搜索关键词
    - sort_option: 排序方式 (name/created_time/modified_time)
    - sort_direction: 排序方向 (asc/desc)
    - offset: 已加载的数量
    - limit: 本次加载数量（默认50）
    """
    try:
        target_dir = request.query.get("directory", "")
        
        if not target_dir or not os.path.isdir(target_dir):
            return web.json_response({
                'success': False, 
                'error': '目录不存在或未指定'
            }, status=400)
        
        keyword = request.query.get("keyword", "").strip()
        sort_option = request.query.get("sort_option", "name")
        sort_direction = request.query.get("sort_direction", "asc")
        offset = int(request.query.get("offset", 0))
        limit = max(1, min(200, int(request.query.get("limit", 50))))

        cache_key = target_dir
        
        # 检查缓存
        if cache_key in list_data_cache:
            list_data = list_data_cache[cache_key]
        else:
            # 扫描目录
            files = find_files(target_dir, 'image')
            list_data = []
            
            for f in files:
                try:
                    modified_time = os.path.getmtime(f)
                    created_time = os.path.getctime(f)
                    src = convert_path(f, target_dir)
                    
                    list_data.append({
                        'id': f"{f}_{int(modified_time * 1000)}",  # 唯一ID
                        'name': os.path.basename(f),
                        'path': f,
                        'src': src,
                        'thumb_src': _thumbnail_url(src, modified_time),
                        'created_time': created_time,
                        'modified_time': modified_time,
                        'size': os.path.getsize(f),
                    })
                except Exception as e:
                    logger.warning(f"无法读取文件信息: {f}, 错误: {e}")
                    continue
            
            list_data_cache[cache_key] = list_data

        # 关键词过滤
        if keyword:
            kw = keyword.lower()
            filtered = [d for d in list_data if kw in d['name'].lower()]
        else:
            filtered = list_data

        # 排序
        reverse = (sort_direction == "desc")
        if sort_option == "name":
            filtered.sort(key=lambda x: x['name'].lower(), reverse=reverse)
        elif sort_option == "created_time":
            filtered.sort(key=lambda x: x['created_time'], reverse=reverse)
        elif sort_option == "modified_time":
            filtered.sort(key=lambda x: x['modified_time'], reverse=reverse)
        elif sort_option == "size":
            filtered.sort(key=lambda x: x['size'], reverse=reverse)

        # 分页数据
        total_count = len(filtered)
        page_data = filtered[offset:offset + limit]
        has_more = (offset + limit) < total_count

        return web.json_response({
            'success': True,
            'data': {
                'list_data': page_data,
                'total_count': total_count,
                'offset': offset,
                'limit': limit,
                'has_more': has_more,
                'directory': target_dir,
            }
        })
        
    except Exception as e:
        logger.error(f"加载图片列表失败: {str(e)}")
        return web.json_response({
            'success': False, 
            'error': str(e)
        }, status=500)


@route("POST", "/EagleImageList/deleteImage")
async def delete_image(request):
    try:
        data = await request.json()
        path = data.get("image_path", "")
        if not path or not os.path.exists(path):
            return web.Response(status=400, text=json.dumps({"error": "文件不存在"}))
        os.remove(path)
        
        # 清除父目录缓存
        parent_dir = os.path.dirname(path)
        list_data_cache.pop(parent_dir, None)
        _clear_thumbnail_cache()
        
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
        name = str(int(time.time() * 1000)) + ext
        dest = os.path.join(dst, name)
        shutil.copy2(src, dest)
        
        list_data_cache.pop(dst, None)
        _clear_thumbnail_cache()
        
        modified_time = os.path.getmtime(dest)
        src_url = convert_path(dest, dst)
        new_img = {
            'id': f"{dest}_{int(modified_time * 1000)}", 
            'name': name, 
            'path': dest,
            'src': src_url,
            'thumb_src': _thumbnail_url(src_url, modified_time),
        }
        return web.json_response({"success": True, 'data': new_img})
    except Exception as e:
        return web.Response(status=500, text=str(e))


@route("POST", "/EagleImageList/clearCache")
async def clear_image_cache(request):
    list_data_cache.clear()
    _clear_thumbnail_cache()
    return web.json_response({"success": True, "message": "缓存已清除"})


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
        
        parent_dir = os.path.dirname(path)
        list_data_cache.pop(parent_dir, None)
        _clear_thumbnail_cache()
        
        modified_time = os.path.getmtime(new_path)
        src = convert_path(new_path, parent_dir)
        
        return web.json_response({
            "success": True, 
            "message": "图片重命名成功", 
            "data": {
                "id": f"{new_path}_{int(modified_time * 1000)}", 
                "name": new_name, 
                "path": new_path, 
                "src": src,
                "thumb_src": _thumbnail_url(src, modified_time),
            }
        })
    except Exception as e:
        return web.Response(status=500, text=json.dumps({"error": str(e)}))


@route("POST", "/EagleImageList/validateDirectory")
async def validate_directory(request):
    """验证目录是否存在且有效"""
    try:
        data = await request.json()
        directory = data.get("directory", "")
        
        if not directory:
            return web.json_response({
                "success": False,
                "error": "目录路径为空"
            }, status=400)
        
        if not os.path.exists(directory):
            return web.json_response({
                "success": False,
                "error": "目录不存在"
            }, status=400)
        
        if not os.path.isdir(directory):
            return web.json_response({
                "success": False,
                "error": "路径不是目录"
            }, status=400)
        
        # 统计图片数量
        files = find_files(directory, 'image')
        
        return web.json_response({
            "success": True,
            "data": {
                "directory": directory,
                "image_count": len(files),
                "exists": True,
            }
        })
        
    except Exception as e:
        return web.json_response({
            "success": False,
            "error": str(e)
        }, status=500)


# ── 节点类 ─────────────────────────────────────────────────

class EagleImageList:
    """图片浏览器 - 支持手动输入路径、异步懒加载"""

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        # 获取常用目录作为提示
        default_dirs = [
            folder_paths.get_input_directory(),
            folder_paths.get_output_directory(),
            folder_paths.get_temp_directory(),
        ]
        default_path = get_setting("EagleFileTools.image_path", default_dirs[0])
        
        return {
            "required": {
                "image_path": ("STRING", {
                    "multiline": False, 
                    "default": ""
                }),
            },
            "optional": {
                "directory": ("STRING", {
                    "multiline": False,
                    "default": default_path,
                    "placeholder": "输入图片目录路径..."
                }),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "image_path", "width", "height")
    OUTPUT_NODE = True
    FUNCTION = "process"
    CATEGORY = "🦅 Eagle/工具"

    def process(self, image_path, directory=""):
        if not image_path or not os.path.exists(image_path):
            raise ValueError("❌ 图片路径不存在，请重新选择图片")

        # 保存目录设置
        if directory and os.path.isdir(directory):
            set_setting("EagleFileTools.image_path", directory)

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
