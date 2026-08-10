# -*- coding: utf-8 -*-
"""
EagleFileTools — 提示词预设模板（移植自 HugoTools）
"""

import math
import json

from ..eagle_suite.logger import logger

# ── 延迟路由装饰器 ──────────────────────────
from aiohttp import web
from ..eagle_suite.route_registry import route
PROMPT_TEMPLATES = {
    "图片编辑 (kontext)": [
        {"Label": "移除物体", "Instruction": "remove the __TARGET__",
         "example": "remove the grapes on the left"},
        {"Label": "主体微调", "Instruction": "make the object __TARGET__",
         "example": "make the object head gigantic"},
        {"Label": "替换主体", "Instruction": "turn the object into a __TARGET__",
         "example": "turn the object into a mech"},
        {"Label": "添加物件", "Instruction": "give the object a __TARGET__",
         "example": "give the object a hat"},
        {"Label": "更换背景", "Instruction": "Replace the background with a __TARGET__",
         "example": "Replace the background with a desert"},
        {"Label": "添加文字", "Instruction": 'write the words "__TARGET__"',
         "example": 'write the words "Hello World" in the bottom left'},
        {"Label": "移除水印", "Instruction": "remove the watermark",
         "example": "remove the watermark"},
        {"Label": "高清修复", "Instruction": "unblur the photo, make it more clear",
         "example": "unblur the photo"},
    ],
    "风格转换": [
        {"Label": "转动漫风格", "Instruction": "Make this into anime", "example": "Make this into anime"},
        {"Label": "转写实风格", "Instruction": "Make this a real photo", "example": "Make this a real photo"},
        {"Label": "水彩画", "Instruction": "Turn this into a watercolor painting", "example": "Turn this into a watercolor painting"},
        {"Label": "钢笔画", "Instruction": "turn this into a detailed pen and ink sketch", "example": "turn this into a detailed pen and ink sketch"},
        {"Label": "木炭素描", "Instruction": "convert this picture to a charcoal sketch", "example": "convert this picture to a charcoal sketch"},
        {"Label": "黑白漫画", "Instruction": "turn this into a manga panel", "example": "turn this into a manga panel"},
        {"Label": "像素化", "Instruction": "Turn this into pixel art", "example": "Turn this into pixel art"},
        {"Label": "3D化", "Instruction": "turn this into a low poly isometric render", "example": "turn this into a low poly 3d render"},
        {"Label": "吉卜力风格", "Instruction": "This image in the style of Studio Ghibli", "example": "This image in the style of Studio Ghibli"},
        {"Label": "贴纸化", "Instruction": "A sticker of this image", "example": "A sticker of this image"},
    ],
    "镜头/视角": [
        {"Label": "推进镜头", "Instruction": "Zoom in on the object closest to the camera", "example": "Zoom in on the object"},
        {"Label": "拉远镜头", "Instruction": "Zoom out to show the whole scene", "example": "Zoom out to show the whole scene"},
        {"Label": "俯瞰镜头", "Instruction": "show me an aerial view from above", "example": "show me an aerial view from above"},
        {"Label": "无人机视角", "Instruction": "An aerial drone shot of this scene", "example": "An aerial drone shot"},
        {"Label": "侧视图", "Instruction": "Generate a side view of this subject", "example": "Generate a side view"},
        {"Label": "正视图", "Instruction": "Generate a front view of this subject", "example": "Generate a front view"},
    ],
}


# ── 节点类 ─────────────────────────────────────────────────

class EaglePromptPresets:
    """提示词预设模板（移植自 HugoTools）"""

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {
                    "default": "", "multiline": True,
                    "placeholder": "输入提示词，或通过前端选择模板"
                }),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("Prompt",)
    FUNCTION = "process"
    CATEGORY = "🦅 Eagle/工具"

    def process(self, prompt):
        return (prompt,)


# ── 路由 ───────────────────────────────────────────────────


@route("GET", "/eaglePromptPresets/search_template")
async def search_template(request):
    try:
        keyword = request.query.get("keyword", "").strip()
        category = request.query.get("category", "图片编辑 (kontext)")
        page = int(request.query.get("page", 1))
        page_size = int(request.query.get("page_size", 10))

        items = PROMPT_TEMPLATES.get(category, [])
        if keyword:
            kw = keyword.lower()
            items = [d for d in items if kw in d['Label'].lower() or kw in d['Instruction'].lower()]

        total = len(items)
        total_pages = max(1, math.ceil(total / page_size))
        start = (page - 1) * page_size
        paginated = items[start:start + page_size]

        return web.json_response({
            "success": True, "data": {
                "list_data": paginated,
                "total_pagenum": total_pages,
                "total_count": total,
                "categories": list(PROMPT_TEMPLATES.keys()),
            }
        })
    except Exception as e:
        logger.error(f"[EagleFileTools] search_template 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)
