# -*- coding: utf-8 -*-
"""Explicit, ordered memory release for Eagle and ComfyUI model families."""

import gc

import torch

from .logger import logger
from .utils import MultiInput


ANY_TYPE = MultiInput("*", "*")


def release_memory(target="eagle_local_llm", local_model=None, clear_cuda_cache=True):
    target = str(target or "eagle_local_llm")
    released = []

    if target in {"eagle_local_llm", "eagle_all", "all"}:
        from .local_llm_node import release_local_model_handle
        detail = release_local_model_handle(local_model, clear_cuda_cache=False)
        released.append(f"Eagle LLM {detail['released']} 个句柄/缓存")

    if target in {"eagle_semantic", "eagle_all", "all"}:
        try:
            from .danbooru_search import _unload_semantic_models
            count = int(_unload_semantic_models() or 0)
            released.append(f"语义模型 {count} 个缓存")
        except Exception as error:
            logger.warning(f"[Memory] 语义模型释放失败: {error}")
            released.append("语义模型释放失败")

    if target in {"comfy_models", "all"}:
        try:
            import comfy.model_management as model_management
            before = len(getattr(model_management, "current_loaded_models", []) or [])
            model_management.cleanup_models_gc()
            model_management.unload_all_models()
            model_management.cleanup_models()
            released.append(f"ComfyUI GPU 模型 {before} 个")
        except Exception as error:
            logger.warning(f"[Memory] ComfyUI 模型释放失败: {error}")
            released.append("ComfyUI 模型释放失败")

    gc.collect()
    if clear_cuda_cache:
        try:
            import comfy.model_management as model_management
            model_management.soft_empty_cache()
        except Exception:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                try:
                    torch.cuda.ipc_collect()
                except Exception:
                    pass
    message = "已释放：" + "；".join(released or ["无匹配缓存"])
    logger.info(f"[Memory] {message}")
    return message


class EagleMemoryReleaseNode:
    """Pass-through barrier that releases selected model families in graph order."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "signal": (ANY_TYPE,),
                "target": ([
                    "Eagle 本地 LLM",
                    "Eagle 语义搜索模型",
                    "全部 Eagle 缓存",
                    "ComfyUI GPU 模型",
                    "全部（Eagle + ComfyUI）",
                ], {"default": "Eagle 本地 LLM"}),
                "clear_cuda_cache": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "local_model": ("EAGLE_LOCAL_LLM_MODEL", {
                    "forceInput": True,
                    "tooltip": "可选：连接本地大模型加载器可精确关闭其 transformers/llama.cpp 句柄。",
                }),
            },
        }

    RETURN_TYPES = (ANY_TYPE, "STRING")
    RETURN_NAMES = ("signal", "状态")
    FUNCTION = "release"
    CATEGORY = "🦅 Eagle Suite/工具"
    OUTPUT_NODE = True

    _TARGETS = {
        "Eagle 本地 LLM": "eagle_local_llm",
        "Eagle 语义搜索模型": "eagle_semantic",
        "全部 Eagle 缓存": "eagle_all",
        "ComfyUI GPU 模型": "comfy_models",
        "全部（Eagle + ComfyUI）": "all",
    }

    def release(self, signal, target, clear_cuda_cache=True, local_model=None):
        status = release_memory(
            self._TARGETS.get(target, "eagle_local_llm"),
            local_model=local_model,
            clear_cuda_cache=bool(clear_cuda_cache),
        )
        return signal, status


__all__ = ["EagleMemoryReleaseNode", "release_memory"]
