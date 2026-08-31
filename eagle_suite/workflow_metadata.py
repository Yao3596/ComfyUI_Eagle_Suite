# -*- coding: utf-8 -*-
"""ComfyUI workflow metadata helpers for video and animated-image outputs."""

import base64
import json
import os
import subprocess
import tempfile
import zlib
from datetime import datetime
from pathlib import Path

import av
from PIL import Image, ImageDraw
from PIL.PngImagePlugin import PngInfo

from .logger import logger


NATIVE_VIDEO_METADATA_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm"}
COMPANION_REQUIRED_EXTENSIONS = {".avi", ".gif", ".apng", ".webp"}
WORKFLOW_MARKER = "COMFYUI_WORKFLOW_ZLIB_BASE64:"


def _json_text(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def build_workflow_bundle(prompt=None, extra_pnginfo=None):
    """Return both the UI workflow and API prompt in a portable structure."""
    extra = extra_pnginfo if isinstance(extra_pnginfo, dict) else {}
    workflow = extra.get("workflow") if isinstance(extra.get("workflow"), dict) else {}
    api_prompt = prompt if isinstance(prompt, dict) else {}
    return {
        "schema": "comfyui.workflow.bundle.v1",
        "created_at": datetime.now().isoformat(),
        "workflow": workflow,
        "prompt": api_prompt,
        "extra_pnginfo": {key: value for key, value in extra.items() if key != "workflow"},
    }


def _has_workflow_data(bundle):
    return bool(bundle.get("workflow") or bundle.get("prompt"))


def _escape_ffmetadata(value):
    return (str(value).replace("\\", "\\\\").replace("=", "\\=")
            .replace(";", "\\;").replace("#", "\\#").replace("\n", "\\\n"))


def embed_workflow_in_media(media_path, bundle, ffmpeg_path):
    """Embed native ``workflow``/``prompt`` tags and verify them by reading back."""
    media_path = Path(media_path)
    if not _has_workflow_data(bundle):
        return {"success": False, "message": "当前执行没有可保存的 workflow 或 prompt"}
    if media_path.suffix.lower() not in NATIVE_VIDEO_METADATA_EXTENSIONS:
        return {"success": False, "message": f"{media_path.suffix or '该格式'} 不支持可靠的原生工作流标签"}

    workflow_text = _json_text(bundle.get("workflow", {}))
    prompt_text = _json_text(bundle.get("prompt", {}))
    extra_text = _json_text(bundle.get("extra_pnginfo", {}))
    compressed = base64.b64encode(zlib.compress(_json_text(bundle).encode("utf-8"), 9)).decode("ascii")
    tags = {
        "workflow": workflow_text,
        "prompt": prompt_text,
        "extra_pnginfo": extra_text,
        "comment": WORKFLOW_MARKER + compressed,
    }

    metadata_path = None
    embedded_path = None
    try:
        metadata_fd, metadata_name = tempfile.mkstemp(
            prefix="comfy_workflow_", suffix=".ffmeta", dir=str(media_path.parent)
        )
        embedded_fd, embedded_name = tempfile.mkstemp(
            prefix="comfy_embedded_", suffix=media_path.suffix, dir=str(media_path.parent)
        )
        os.close(metadata_fd)
        os.close(embedded_fd)
        metadata_path = Path(metadata_name)
        embedded_path = Path(embedded_name)
        metadata_lines = [";FFMETADATA1"] + [
            f"{key}={_escape_ffmetadata(value)}" for key, value in tags.items()
        ]
        metadata_path.write_text("\n".join(metadata_lines) + "\n", encoding="utf-8")

        command = [
            str(ffmpeg_path), "-y", "-i", str(media_path),
            "-f", "ffmetadata", "-i", str(metadata_path),
            "-map", "0", "-map_metadata", "1", "-c", "copy",
        ]
        if media_path.suffix.lower() in {".mp4", ".mov"}:
            command += ["-movflags", "use_metadata_tags+faststart"]
        command.append(str(embedded_path))
        result = subprocess.run(command, capture_output=True, text=True, timeout=300, check=False)
        if result.returncode != 0 or not embedded_path.is_file() or embedded_path.stat().st_size == 0:
            detail = (result.stderr or "FFmpeg 未生成有效文件").strip().splitlines()[-1]
            return {"success": False, "message": f"容器元数据写入失败: {detail}"}

        with av.open(str(embedded_path), mode="r") as container:
            actual = {str(key).lower(): str(value) for key, value in container.metadata.items()}
        if actual.get("workflow") != workflow_text or actual.get("prompt") != prompt_text:
            return {"success": False, "message": "工作流标签写入后回读校验失败"}

        os.replace(embedded_path, media_path)
        return {"success": True, "message": "已写入并校验 ComfyUI 原生 workflow/prompt 标签"}
    except Exception as error:
        logger.warning(f"工作流嵌入媒体失败: {error}")
        return {"success": False, "message": str(error)}
    finally:
        for path in (metadata_path, embedded_path):
            if path:
                try:
                    Path(path).unlink(missing_ok=True)
                except OSError:
                    pass


def save_workflow_companion_png(media_path, bundle, ffmpeg_path):
    """Create ``<media>.workflow.png`` with standard ComfyUI PNG metadata."""
    if not _has_workflow_data(bundle):
        return ""
    media_path = Path(media_path)
    companion_path = media_path.with_name(media_path.stem + ".workflow.png")
    extracted_path = None
    temp_output = None
    try:
        extracted_fd, extracted_name = tempfile.mkstemp(
            prefix="workflow_frame_", suffix=".png", dir=str(media_path.parent)
        )
        os.close(extracted_fd)
        extracted_path = Path(extracted_name)
        result = subprocess.run(
            [str(ffmpeg_path), "-y", "-i", str(media_path), "-frames:v", "1", str(extracted_path)],
            capture_output=True, timeout=120, check=False,
        )
        if result.returncode == 0 and extracted_path.is_file() and extracted_path.stat().st_size:
            with Image.open(extracted_path) as source:
                preview = source.convert("RGB")
        else:
            preview = Image.new("RGB", (512, 512), (24, 28, 36))
            canvas = ImageDraw.Draw(preview)
            canvas.text((32, 230), "ComfyUI Workflow", fill=(225, 230, 240))
            canvas.text((32, 260), media_path.name, fill=(145, 155, 175))

        preview.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        pnginfo = PngInfo()
        pnginfo.add_text("prompt", _json_text(bundle.get("prompt", {})))
        pnginfo.add_text("workflow", _json_text(bundle.get("workflow", {})))
        for key, value in bundle.get("extra_pnginfo", {}).items():
            if key not in {"prompt", "workflow"}:
                pnginfo.add_text(str(key), _json_text(value))
        pnginfo.add_text("eagle_suite_media", media_path.name)

        output_fd, output_name = tempfile.mkstemp(
            prefix=f".{companion_path.name}.", suffix=".tmp.png", dir=str(media_path.parent)
        )
        os.close(output_fd)
        temp_output = Path(output_name)
        preview.save(temp_output, format="PNG", pnginfo=pnginfo, optimize=True)
        os.replace(temp_output, companion_path)
        return str(companion_path)
    except Exception as error:
        logger.warning(f"生成工作流伴随 PNG 失败: {error}")
        return ""
    finally:
        for path in (extracted_path, temp_output):
            if path:
                try:
                    Path(path).unlink(missing_ok=True)
                except OSError:
                    pass


def persist_workflow_for_media(media_path, prompt, extra_pnginfo, ffmpeg_path, force_companion=False):
    """Prefer native video metadata; create a workflow PNG when unavailable."""
    bundle = build_workflow_bundle(prompt, extra_pnginfo)
    embedded = embed_workflow_in_media(media_path, bundle, ffmpeg_path)
    needs_companion = force_companion or not embedded["success"]
    companion_path = save_workflow_companion_png(media_path, bundle, ffmpeg_path) if needs_companion else ""
    return {
        "bundle": bundle,
        "embedded": embedded,
        "companion_path": companion_path,
        "success": embedded["success"] or bool(companion_path),
    }


__all__ = [
    "build_workflow_bundle",
    "embed_workflow_in_media",
    "persist_workflow_for_media",
    "save_workflow_companion_png",
]
