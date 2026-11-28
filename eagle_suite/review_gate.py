# -*- coding: utf-8 -*-
"""A one-click review gate for any ComfyUI value.

The first execution blocks downstream nodes without occupying the prompt queue.
An approval run reads the retained value through a lazy input, so upstream
samplers are not requested again even if their seed widgets have changed.
"""

import asyncio
import io
import logging
import threading
import uuid
from copy import deepcopy
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from aiohttp import web
from comfy_execution.graph_utils import ExecutionBlocker
from PIL import Image, ImageOps

from .route_registry import route


class _AnyType(str):
    def __ne__(self, _other):
        return False


ANY_TYPE = _AnyType("*")
logger = logging.getLogger(__name__)

# Match the credential widgets omitted by Eagle's frontend workflow export.
# The submitted API prompt still contains their runtime values.
_PRIVATE_PROMPT_WIDGETS = {
    "EagleAPIKeyNode": "api_key",
    "EagleAPIUnifiedNode": "api_config_key",
    "EagleAPIImageNode": "api_config_key",
    "EagleLoraGalleryNode": "civitai_api_key",
}


@dataclass(frozen=True)
class _Candidate:
    token: str
    value: object
    prompt: dict | None
    extra_pnginfo: dict | None


def _metadata_prompt(prompt):
    if not isinstance(prompt, dict):
        return None
    snapshot = deepcopy(dict(prompt))
    for entry in snapshot.values():
        if not isinstance(entry, dict):
            continue
        name = _PRIVATE_PROMPT_WIDGETS.get(entry.get("class_type"))
        inputs = entry.get("inputs")
        if name and isinstance(inputs, dict) and isinstance(inputs.get(name), str):
            inputs[name] = ""
    return snapshot


@lru_cache(maxsize=128)
def _thumbnail_png(path, _mtime_ns, _size):
    with Image.open(path) as image, io.BytesIO() as buffer:
        image.thumbnail((128, 128), Image.Resampling.LANCZOS)
        ImageOps.exif_transpose(image).convert("RGBA").save(buffer, format="PNG")
        return buffer.getvalue()


def _read_input_thumbnail(name):
    import folder_paths

    filename, directory = folder_paths.annotated_filepath(name)
    root = Path(directory or folder_paths.get_input_directory()).resolve()
    relative_path = Path(filename)
    path = (root / relative_path).resolve()
    if relative_path.is_absolute() or not path.is_relative_to(root) or not path.is_file():
        raise FileNotFoundError
    stat = path.stat()
    return _thumbnail_png(path, stat.st_mtime_ns, stat.st_size)


@route("GET", "/eagle_review/input_thumbnail")
async def review_input_thumbnail(request):
    name = request.query.get("filename")
    if not name:
        return web.Response(status=400)
    try:
        data = await asyncio.to_thread(_read_input_thumbnail, name)
    except (OSError, RuntimeError, ValueError, Image.DecompressionBombError):
        return web.Response(status=404)
    return web.Response(body=data, content_type="image/png", headers={"Cache-Control": "private, no-cache"})


class EagleReviewGate:
    DESCRIPTION = (
        "支持任意类型输入，可预览原尺寸图像并接入参考图做对比。启用确认时先预览并阻断下游；点击继续后放行本次结果，"
        "重新运行则按工作流原有设置生成新结果。关闭确认时直接透传。"
    )
    SEARCH_ALIASES = ["原图预览", "preview image", "preview confirmation"]
    _pending = {}
    _lock = threading.Lock()

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (ANY_TYPE, {"lazy": True}),
                "需要确认": ("BOOLEAN", {"default": True}),
                "确认令牌": ("STRING", {"default": "", "multiline": False}),
            },
            "optional": {
                "保存后重新开始": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "关闭：本轮下游执行完成后结束。开启：下游执行成功后重新开始；需要确认时，下一轮仍会等待确认。",
                }),
                "对比图像": ("IMAGE", {"tooltip": "可选参考图，用于滑动对比。结果端口输出 value 输入的最终图像。"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID", "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO", "dynprompt": "DYNPROMPT",
            },
        }

    RETURN_TYPES = (ANY_TYPE,)
    RETURN_NAMES = ("结果",)
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle Suite/工具"

    @classmethod
    def IS_CHANGED(cls, **_kwargs):
        # A pending blocker must be reevaluated on each explicit workflow run.
        return float("nan")

    @classmethod
    def clear_pending_for_tests(cls):
        with cls._lock:
            cls._pending.clear()

    @classmethod
    def pending_metadata(cls, node_id, token):
        with cls._lock:
            entry = cls._pending.get(str(node_id or ""))
            if entry and entry.token == token:
                return entry.prompt, entry.extra_pnginfo

    def check_lazy_status(self, 需要确认=True, 确认令牌="", unique_id=None, value=None,
                          保存后重新开始=False, 对比图像=None, **_metadata):
        if 需要确认 and 确认令牌:
            # Missing/expired tokens must block, never generate a fresh image
            # and accidentally save it as though it were approved.
            return []
        return ["value"] if value is None else []

    @staticmethod
    def _describe(value):
        if hasattr(value, "shape"):
            shape = " × ".join(str(part) for part in value.shape)
            return f"{type(value).__name__} · {shape}"
        if isinstance(value, str):
            return "文本 · " + value[:240]
        if isinstance(value, (list, tuple, dict)):
            return f"{type(value).__name__} · {len(value)} 项"
        return type(value).__name__

    @staticmethod
    def _save_preview_images(value, filename_prefix, limit=None, *, prompt=None, extra_pnginfo=None):
        if not hasattr(value, "shape"):
            return [], None

        try:
            import torch
            from nodes import PreviewImage

            if not isinstance(value, torch.Tensor) or value.ndim != 4:
                return [], None
            count, height, width, channels = value.shape
            if not count or not height or not width or channels not in (1, 3, 4):
                return [], None

            images = value[:limit].detach()
            if channels == 1:
                images = images.squeeze(-1)
            if images.dtype not in (torch.float16, torch.float32, torch.float64):
                images = images.to(device="cpu", dtype=torch.float32)
            preview = PreviewImage().save_images(
                images, filename_prefix=filename_prefix, prompt=prompt, extra_pnginfo=extra_pnginfo,
            )
            return preview["ui"]["images"], f"{width} × {height} 像素"
        except Exception as error:
            logger.warning("生成预览确认原图失败: %s", error)
            return [], None

    @classmethod
    def _preview_payload(cls, value, reference, prompt, extra_pnginfo):
        images, dimensions = cls._save_preview_images(
            value, "eagle_review/Preview", prompt=prompt, extra_pnginfo=extra_pnginfo,
        )
        payload = {"summary": dimensions or cls._describe(value), "images": images}
        workflow = extra_pnginfo.get("workflow") if extra_pnginfo else None
        if images and isinstance(workflow, dict) and workflow:
            payload["workflow"] = deepcopy(workflow)
        if images and reference is not None:
            payload["reference_images"], _ = cls._save_preview_images(reference, "eagle_review/Reference", len(images))
        return payload

    def run(self, value=None, 需要确认=True, 确认令牌="", unique_id=None, 保存后重新开始=False,
            对比图像=None, prompt=None, extra_pnginfo=None, dynprompt=None):
        node_id = str(unique_id or "")
        if 需要确认 and 确认令牌:
            if getattr(prompt, "conflicting_review_approvals", False):
                return {
                    "ui": {"eagle_review": [{"state": "error", "summary": "候选来自不同轮次，请分别确认。"}]},
                    "result": (ExecutionBlocker(None),),
                }
            with self._lock:
                entry = self._pending.get(node_id)
                if entry and entry.token == 确认令牌:
                    self._pending.pop(node_id, None)
                else:
                    entry = None
            if entry:
                if (dynprompt is not None and entry.prompt is not None
                        and getattr(prompt, "review_approval_metadata", None) == (entry.prompt, entry.extra_pnginfo)):
                    # Only the hidden PROMPT getter changes for this executor.
                    # Its runnable graph still has no upstream generation edge.
                    approved_prompt = deepcopy(entry.prompt)
                    dynprompt.get_original_prompt = lambda: approved_prompt
                return {"ui": {"eagle_review": [{"state": "approved"}]}, "result": (entry.value,)}
            return {
                "ui": {"eagle_review": [{"state": "expired"}]},
                "result": (ExecutionBlocker(None),),
            }

        if value is None or not 需要确认:
            with self._lock:
                self._pending.pop(node_id, None)
        if value is None and 需要确认:
            return {
                "ui": {"eagle_review": [{"state": "empty", "images": [], "summary": ""}]},
                "result": (ExecutionBlocker(None),),
            }

        candidate_prompt = _metadata_prompt(getattr(prompt, "review_source_prompt", None) or prompt)
        candidate_extra = deepcopy(extra_pnginfo) if isinstance(extra_pnginfo, dict) else None
        if candidate_extra and isinstance(candidate_extra.get("prompt"), dict):
            candidate_extra["prompt"] = _metadata_prompt(candidate_extra["prompt"])
        token = uuid.uuid4().hex if 需要确认 else None
        if token is not None:
            with self._lock:
                self._pending[node_id] = _Candidate(token, value, candidate_prompt, candidate_extra)

        preview = self._preview_payload(value, 对比图像, candidate_prompt, candidate_extra)
        if token is None:
            return {"ui": {"eagle_review": [{"state": "bypass", **preview}]}, "result": (value,)}
        payload = {
            "state": "pending",
            "token": token,
            **preview,
        }
        return {"ui": {"eagle_review": [payload]}, "result": (ExecutionBlocker(None),)}


class EagleReviewGateEager(EagleReviewGate):
    """Internal initial-run variant: do not mark the gate active before input."""

    DEPRECATED = True
    CATEGORY = "_EagleInternal"

    @classmethod
    def INPUT_TYPES(cls):
        definition = super().INPUT_TYPES()
        definition["required"]["value"][1]["lazy"] = False
        return definition


class EagleReviewGateResume(EagleReviewGate):
    """Internal resume endpoint with no dependency on the generation branch."""

    DEPRECATED = True
    CATEGORY = "_EagleInternal"

    @classmethod
    def INPUT_TYPES(cls):
        definition = super().INPUT_TYPES()
        value = definition["required"].pop("value")
        definition["optional"] = {"value": value, **definition.get("optional", {})}
        return definition
