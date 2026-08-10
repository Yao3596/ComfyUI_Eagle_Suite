# -*- coding: utf-8 -*-
"""
EagleFileTools — 音频浏览器（移植自 HugoTools）
支持搜索音频、重命名、播放预览
"""

import os
import math
import json

import folder_paths

from ..tools_utils import AUDIO_EXTENSIONS, find_files, get_setting
from ..eagle_suite.logger import logger

# ── 延迟路由装饰器 ──────────────────────────
from aiohttp import web
from ..eagle_suite.route_registry import route
def _get_audio_directory():
    custom = get_setting('EagleFileTools.audio_path')
    if custom:
        return custom
    return os.path.join(folder_paths.models_dir, "TTS", "MegaTTS3", "speakers")


def convert_audio_path(file_path):
    url_base = "/eagle/tts"
    audio_dir = _get_audio_directory()
    return file_path.replace(audio_dir, url_base).replace("\\", "/")


# ── 路由 ───────────────────────────────────────────────────


@route("GET", "/eagle/tts/{path:.*}")
async def tts_static(request):
    """提供 TTS 音频文件访问"""
    path = request.match_info['path']
    fp = os.path.join(_get_audio_directory(), path)
    if os.path.isfile(fp):
        return web.FileResponse(fp)
    return web.Response(status=404)

@route("GET", "/EagleAudioList/search_audio")
async def search_audio(request):
    try:
        keyword = request.query.get("keyword", "").strip()
        page = int(request.query.get("page", 1))
        page_size = int(get_setting('EagleFileTools.audio_pagesize', 30))

        audio_dir = _get_audio_directory()
        files = find_files(audio_dir, "audio")
        items = []
        for i, f in enumerate(files):
            items.append({
                'id': i + 1,
                'name': os.path.basename(f), 'path': f,
                'src': convert_audio_path(f),
                'size': os.path.getsize(f),
            })

        if keyword:
            kw = keyword.lower()
            items = [d for d in items if kw in d['name'].lower()]

        total = len(items)
        total_pages = max(1, math.ceil(total / page_size))
        start = (page - 1) * page_size
        page_items = items[start:start + page_size]

        return web.json_response({
            "success": True, "data": {
                "list_data": page_items, "total_pagenum": total_pages,
                "audio_directory": audio_dir,
            }
        })
    except Exception as e:
        logger.error(f"[EagleFileTools] search_audio 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)

@route("POST", "/EagleAudioList/rename_audio")
async def rename_audio(request):
    try:
        data = await request.json()
        path = data.get("path", "")
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
        npy_old = os.path.splitext(path)[0] + ".npy"
        if os.path.isfile(npy_old):
            os.rename(npy_old, os.path.splitext(new_path)[0] + ".npy")
        return web.json_response({"success": True, "path": new_path})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


# ── 节点类 ─────────────────────────────────────────────────

class EagleAudioList:
    """音频浏览器（移植自 HugoTools）"""

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio_path": ("STRING", {"multiline": False, "default": ""}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("audio_path",)
    FUNCTION = "process"
    CATEGORY = "🦅 Eagle/工具"

    def process(self, audio_path):
        return (audio_path or "",)
