# -*- coding: utf-8 -*-
"""
H3 循环链路 REST / WebSocket 路由。

提供运行列表、manifest 读取、审阅决策回写、预览文件流。
"""

import json
import os
from pathlib import Path

from aiohttp import web

import folder_paths

from ..route_registry import route
from ..logger import logger
from ..utils import is_safe_path, strip_path


CHAIN_SUBDIR = "h3_eagle_chains"


def _chain_root():
    return Path(folder_paths.get_output_directory()) / CHAIN_SUBDIR


def _safe_run_path(run_name):
    """校验 run_name 不会越界。"""
    if not run_name:
        return None
    run_name = strip_path(run_name)
    # 禁止 .. 等
    if ".." in run_name or "/" in run_name or "\\" in run_name:
        return None
    base = _chain_root()
    candidate = base / run_name
    try:
        real_base = base.resolve()
        real_candidate = candidate.resolve()
        if real_base not in [real_candidate, *real_candidate.parents]:
            return None
    except Exception:
        return None
    return candidate


@route("GET", "/eagle_h3_pipeline/runs")
@route("GET", "/eagle_h3_chain/runs")
async def list_runs(request):
    """列出所有 h3_eagle_chains 下的运行。"""
    root = _chain_root()
    runs = []
    try:
        for item in sorted(root.iterdir()):
            if item.is_dir():
                manifest = item / "manifest.json"
                if manifest.exists():
                    try:
                        data = json.loads(manifest.read_text(encoding="utf-8"))
                        runs.append({
                            "run_name": data.get("run_name", item.name),
                            "current_index": data.get("current_index", 0),
                            "total_shots": data.get("total_shots", 0),
                            "mode": data.get("mode", "auto"),
                            "updated_at": data.get("updated_at", ""),
                            "summary": data.get("summary", "")[:200],
                        })
                    except Exception:
                        runs.append({
                            "run_name": item.name,
                            "current_index": 0,
                            "total_shots": 0,
                            "mode": "unknown",
                            "updated_at": "",
                            "summary": "manifest 读取失败",
                        })
    except Exception as e:
        logger.warning(f"[H3Chain] 读取 runs 失败: {e}")
    return web.json_response({"runs": runs})


@route("GET", "/eagle_h3_pipeline/manifest")
@route("GET", "/eagle_h3_chain/manifest")
async def get_manifest(request):
    """读取指定运行的 manifest。"""
    run_name = request.query.get("run", "").strip()
    run_path = _safe_run_path(run_name)
    if not run_path:
        return web.json_response({"error": "非法 run_name"}, status=400)
    manifest = run_path / "manifest.json"
    if not manifest.exists():
        return web.json_response({"error": "manifest 不存在"}, status=404)
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
        return web.json_response(data)
    except Exception as e:
        return web.json_response({"error": f"读取 manifest 失败: {e}"}, status=500)


@route("POST", "/eagle_h3_pipeline/review")
@route("POST", "/eagle_h3_chain/review")
async def post_review(request):
    """前端审阅决策回写。把 decision 写入 run 的 review_decision.json，供节点读取。"""
    run_name = request.query.get("run", "").strip()
    run_path = _safe_run_path(run_name)
    if not run_path:
        return web.json_response({"error": "非法 run_name"}, status=400)
    try:
        raw = await request.text()
        if not raw:
            return web.json_response({"error": "请求体为空"}, status=400)
        body = json.loads(raw)
    except Exception as e:
        return web.json_response({"error": f"JSON 解析失败: {e}"}, status=400)

    decision = body.get("decision", "").strip().lower()
    if decision not in ("approve", "retry", "reroll", "stop"):
        return web.json_response({"error": f"无效 decision: {decision}"}, status=400)

    token = body.get("token", "")
    review_file = run_path / f"review_decision_{token or 'default'}.json"
    try:
        with open(review_file, "w", encoding="utf-8") as f:
            json.dump(body, f, ensure_ascii=False, indent=2)
    except Exception as e:
        return web.json_response({"error": f"写入决策失败: {e}"}, status=500)

    return web.json_response({"status": "ok", "decision": decision})


@route("GET", "/eagle_h3_pipeline/preview")
@route("GET", "/eagle_h3_chain/preview")
async def get_preview(request):
    """返回运行目录下的预览文件流（clip / seam 图等）。"""
    run_name = request.query.get("run", "").strip()
    rel_path = request.query.get("path", "").strip()
    if not run_name or not rel_path:
        return web.json_response({"error": "缺少 run 或 path"}, status=400)

    run_path = _safe_run_path(run_name)
    if not run_path:
        return web.json_response({"error": "非法 run_name"}, status=400)

    # 拼接并解析，确保在 run_path 下
    target = (run_path / rel_path).resolve()
    try:
        real_run = run_path.resolve()
        if real_run not in [target, *target.parents]:
            return web.json_response({"error": "非法路径"}, status=400)
    except Exception:
        return web.json_response({"error": "路径解析失败"}, status=400)

    if not target.is_file():
        return web.json_response({"error": "文件不存在"}, status=404)

    # FileResponse 采用流式发送，避免审阅长视频时把整个文件读进内存。
    import mimetypes
    content_type, _ = mimetypes.guess_type(str(target))
    if not content_type:
        content_type = "application/octet-stream"
    try:
        response = web.FileResponse(path=target)
        response.content_type = content_type
        return response
    except Exception as e:
        return web.json_response({"error": f"读取文件失败: {e}"}, status=500)


__all__ = []
