# -*- coding: utf-8 -*-
"""A one-click review gate for any ComfyUI value.

The first execution blocks downstream nodes without occupying the prompt queue.
An approval run reads the retained value through a lazy input, so upstream
samplers are not requested again even if their seed widgets have changed.
"""

import logging
import threading
import uuid

from comfy_execution.graph_utils import ExecutionBlocker


class _AnyType(str):
    def __ne__(self, _other):
        return False


ANY_TYPE = _AnyType("*")
logger = logging.getLogger(__name__)


class EagleReviewGate:
    DESCRIPTION = (
        "可单独预览原尺寸图像，支持任意类型输入。启用确认时先预览并阻断下游；点击继续后仅放行本次结果，"
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
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
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
    def _has_snapshot(cls, node_id, token):
        with cls._lock:
            entry = cls._pending.get(str(node_id or ""))
            return bool(entry and entry[0] == token)

    def check_lazy_status(self, 需要确认=True, 确认令牌="", unique_id=None, value=None, 保存后重新开始=False):
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

    @classmethod
    def _preview_payload(cls, value):
        payload = {"summary": cls._describe(value), "images": []}
        if not hasattr(value, "shape"):
            return payload

        try:
            import torch
            from nodes import PreviewImage

            if not isinstance(value, torch.Tensor) or value.ndim != 4:
                return payload
            count, height, width, channels = value.shape
            if not count or not height or not width or channels not in (1, 3, 4):
                return payload

            images = value.detach()
            if channels == 1:
                images = images.squeeze(-1)
            if images.dtype not in (torch.float16, torch.float32, torch.float64):
                images = images.to(device="cpu", dtype=torch.float32)
            preview = PreviewImage().save_images(images, filename_prefix="eagle_review/Preview")
            payload["images"] = preview["ui"]["images"]
            payload["summary"] = f"{width} × {height} 像素"
        except Exception as error:
            logger.warning("生成预览确认原图失败: %s", error)
        return payload

    def run(self, value=None, 需要确认=True, 确认令牌="", unique_id=None, 保存后重新开始=False):
        node_id = str(unique_id or "")
        if not 需要确认:
            with self._lock:
                self._pending.pop(node_id, None)
            return {
                "ui": {"eagle_review": [{"state": "bypass", **self._preview_payload(value)}]},
                "result": (value,),
            }

        if 确认令牌:
            with self._lock:
                entry = self._pending.get(node_id)
                if entry and entry[0] == 确认令牌:
                    self._pending.pop(node_id, None)
                else:
                    entry = None
            if entry:
                return {"ui": {"eagle_review": [{"state": "approved"}]}, "result": (entry[1],)}
            return {
                "ui": {"eagle_review": [{"state": "expired"}]},
                "result": (ExecutionBlocker(None),),
            }

        if value is None:
            return {
                "ui": {"eagle_review": [{"state": "empty", "images": [], "summary": ""}]},
                "result": (ExecutionBlocker(None),),
            }

        token = uuid.uuid4().hex
        with self._lock:
            # A new run supersedes the previous candidate from this gate.
            self._pending[node_id] = (token, value)
        payload = {
            "state": "pending",
            "token": token,
            **self._preview_payload(value),
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
