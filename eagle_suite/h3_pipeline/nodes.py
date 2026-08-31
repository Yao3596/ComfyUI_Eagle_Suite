# -*- coding: utf-8 -*-
"""
H3 导演台下游循环链路节点。

消费 EagleH3DirectorNode 输出的 H3_CHAIN_PLAN，实现上下文视频衔接、
分段检查点、审阅门、循环推进、视频拼接、PNG 序列导出、接缝探测。
"""

import json
import os
import re
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import torch
from PIL import Image

import folder_paths

try:
    from comfy_execution.graph_utils import GraphBuilder, is_link
except Exception:  # 兼容不带动态图 API 的旧版 ComfyUI
    GraphBuilder = None

    def is_link(value):
        return (
            isinstance(value, list)
            and len(value) == 2
            and isinstance(value[0], str)
            and isinstance(value[1], (int, float))
        )

from ..h3_director_node import H3_PLAN_TYPE
from ..logger import logger
from ..utils import ensure_dir, generate_unique_filename, get_cached_ffmpeg

from .constants import (
    H3_LOOP_FLOW,
    H3_MANIFEST,
    H3_RUN_STATE,
    H3_SEGMENT,
)
from .media_utils import (
    _resolve_video_path,
    concat_videos,
    extract_frames,
    extract_audio,
    frames_to_video,
    load_image_tensor,
    merge_audio_video,
    native_video,
    safe_output_path,
    seam_analysis,
    trim_video,
)
from .state import (
    advance,
    build_summary,
    init_state,
    load_state,
    record_shot_result,
    save_state,
    shot_params,
)


# ══════════════════════════════════════════════════════════════════════════════
# 工具函数
# ══════════════════════════════════════════════════════════════════════════════

def _clone_state(state):
    """深拷贝运行状态，避免 ComfyUI 缓存复用导致串扰。"""
    if state is None:
        return None
    return json.loads(json.dumps(state, ensure_ascii=False))


# 上下文抽帧缓存：同一 (prev_clip + 帧数) 不再重复抽帧，对应 AIMixer 的 .pre 指纹思路。
_CTX_CACHE = {}
_CTX_CACHE_MAX = 16


def _cached_context_frames(path, ctx):
    """带指纹缓存的上下文抽帧（末尾 ctx 帧）。"""
    key = (path, ctx)
    if key in _CTX_CACHE:
        return _CTX_CACHE[key]
    frames = extract_frames(path, last=ctx)
    if len(_CTX_CACHE) >= _CTX_CACHE_MAX:
        _CTX_CACHE.pop(next(iter(_CTX_CACHE)))
    _CTX_CACHE[key] = frames
    return frames


def _validate_plan(plan):
    if not isinstance(plan, dict):
        raise ValueError("[H3Chain] plan 必须是 dict")
    if plan.get("version") not in (1, 2):
        raise ValueError(f"[H3Chain] 不支持的 plan 版本: {plan.get('version')}")
    shots = plan.get("shots")
    if not isinstance(shots, list) or not shots:
        raise ValueError("[H3Chain] plan.shots 必须是非空列表")
    preflight = plan.get("preflight") or {}
    errors = preflight.get("errors") or []
    if errors:
        raise ValueError("[H3Chain] 计划预检失败: " + "; ".join(str(x) for x in errors))
    return plan


def _empty_image_tensor(w=64, h=64):
    arr = np.zeros((1, h, w, 3), dtype=np.float32)
    return torch.from_numpy(arr)


def _np_to_tensor(frames):
    """np.uint8 (N,H,W,3) -> torch.float32 (N,H,W,3)。"""
    if frames is None or frames.size == 0:
        return _empty_image_tensor()
    arr = frames.astype(np.float32) / 255.0
    return torch.from_numpy(arr)


def _normalize_seed(img):
    """将 seed_image（ComfyUI IMAGE）规范化为 (1,H,W,3) float[0,1]，仅取首帧。"""
    if isinstance(img, torch.Tensor):
        t = img.float()
    elif isinstance(img, np.ndarray):
        t = torch.from_numpy(img.astype(np.float32))
    else:
        t = torch.from_numpy(np.asarray(img, dtype=np.float32))
    if t.dim() == 3:
        t = t.unsqueeze(0)
    if t.numel() > 0 and t.max() > 1.0:
        t = t / 255.0
    if t.shape[0] > 1:  # H3 first_frame 只取 [:1]
        t = t[:1]
    return t


def _prev_clip_from_state(state, idx):
    """从 run_state 已记录的分镜中取上一镜 clip 路径（避免图内回环）。"""
    prev_idx = idx - 1
    for s in state.get("shots", []):
        if s.get("index") == prev_idx:
            return s.get("clip") or ""
    return ""


def _tensor_to_np(frames):
    """torch (N,H,W,3) -> np.uint8 (N,H,W,3)。"""
    if isinstance(frames, torch.Tensor):
        frames = frames.cpu().numpy()
    if frames.max() <= 1.0:
        frames = (frames * 255).clip(0, 255).astype(np.uint8)
    else:
        frames = frames.astype(np.uint8)
    return frames


def _shot_dir(base_dir, index):
    return Path(base_dir) / "shots" / f"shot_{index + 1:02d}"


# ══════════════════════════════════════════════════════════════════════════════
# 1. Plan 节点
# ══════════════════════════════════════════════════════════════════════════════

class EagleH3PlanNode:
    """🦅 H3 链 · 计划：初始化/恢复运行状态。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "plan": (H3_PLAN_TYPE,),
                "run_name_override": ("STRING", {"default": ""}),
                "output_dir": ("STRING", {"default": "", "placeholder": "留空使用 ComfyUI output 目录"}),
                "resume_policy": (["fail", "overwrite", "resume"], {"default": "resume"}),
                "mode": (["auto", "interactive"], {"default": "auto"}),
                "max_shots": ("INT", {"default": 0, "min": 0, "max": 1000, "step": 1}),
            }
        }

    RETURN_TYPES = (H3_RUN_STATE, "STRING")
    RETURN_NAMES = ("run_state", "summary")
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle Suite/H3 核心"

    def execute(self, plan, run_name_override="", output_dir="", resume_policy="resume", mode="auto", max_shots=0):
        plan = _validate_plan(plan)
        preflight = _clone_state(plan.get("preflight") or {
            "ok": True, "errors": [], "warnings": [], "checked_shots": len(plan.get("shots") or []),
        })
        preflight_ok = bool(preflight.get("ok", not preflight.get("errors"))) and not preflight.get("errors")
        output_root = output_dir.strip() or folder_paths.get_output_directory()
        state = init_state(
            plan,
            output_root=output_root,
            run_name_override=run_name_override.strip(),
            resume_policy=resume_policy,
            mode=mode,
            max_shots=max_shots,
        )
        summary = build_summary(state)
        if preflight.get("errors") or preflight.get("warnings"):
            summary += (
                f" · 预检 {'通过' if preflight_ok else '失败'} "
                f"({len(preflight.get('errors') or [])} 错误 / {len(preflight.get('warnings') or [])} 警告)"
            )
        return {
            "ui": {
                "h3_plan": {
                    "run_name": state.get("run_name"),
                    "mode": state.get("mode"),
                    "total_shots": state.get("total_shots"),
                    "summary": summary,
                    "base_dir": state.get("base_dir"),
                    "preflight_ok": preflight_ok,
                    "preflight": preflight,
                }
            },
            "result": (state, summary),
        }


class EagleH3PreflightNode:
    """计划预检：在加载模型前暴露素材标签、裁剪与时间线问题。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"plan": (H3_PLAN_TYPE,)}}

    RETURN_TYPES = (H3_PLAN_TYPE, "BOOL", "STRING", "STRING")
    RETURN_NAMES = ("plan", "ok", "report_json", "summary")
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 制片流水线"

    def execute(self, plan):
        if not isinstance(plan, dict):
            raise ValueError("[H3Preflight] plan 必须是 dict")
        report = _clone_state(plan.get("preflight") or {
            "ok": True,
            "policy": "legacy",
            "errors": [],
            "warnings": ["旧计划未包含预检结果，建议重新执行导演台"],
            "checked_shots": len(plan.get("shots") or []),
        })
        errors = report.get("errors") or []
        warnings = report.get("warnings") or []
        ok = bool(report.get("ok", not errors)) and not errors
        summary = (
            f"{'OK' if ok else 'FAILED'} · {report.get('checked_shots', 0)} 镜头 · "
            f"{len(errors)} 错误 / {len(warnings)} 警告"
        )
        return (plan, ok, json.dumps(report, ensure_ascii=False, indent=2), summary)


# ══════════════════════════════════════════════════════════════════════════════
# 2. Load Manifest 节点
# ══════════════════════════════════════════════════════════════════════════════

class EagleH3LoadManifestNode:
    """🦅 H3 链 · 载入清单：从已有运行恢复状态。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "run_name": ("STRING", {"default": ""}),
                "base_dir": ("STRING", {"default": "", "placeholder": "留空使用 output/h3_eagle_chains/<run_name>"}),
            }
        }

    RETURN_TYPES = (H3_RUN_STATE, "STRING")
    RETURN_NAMES = ("run_state", "summary")
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台"

    def execute(self, run_name, base_dir=""):
        if base_dir.strip():
            base = Path(base_dir.strip())
        else:
            base = Path(folder_paths.get_output_directory()) / "h3_eagle_chains" / run_name.strip()
        state = load_state(str(base))
        return (state, build_summary(state))


# ══════════════════════════════════════════════════════════════════════════════
# 3. Start 节点
# ══════════════════════════════════════════════════════════════════════════════

class EagleH3StartNode:
    """🦅 H3 链 · 开始：启动或续跑循环。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "run_state": (H3_RUN_STATE,),
                "start_index": ("INT", {"default": 1, "min": 1, "max": 1000, "step": 1}),
            }
        }

    RETURN_TYPES = (H3_RUN_STATE, "INT", "INT", "INT")
    RETURN_NAMES = ("run_state", "width", "height", "fps")
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle Suite/H3 导演台"

    def execute(self, run_state, start_index=1):
        state = _clone_state(run_state)
        plan = state.get("plan") or {}
        compat = plan.get("compatibility") or {}

        # 仅在首次启动且 start_index > 1 时生效；否则保留 resume 的 current_index
        if state.get("current_index", 0) == 0 and start_index > 1:
            state["current_index"] = min(start_index - 1, state.get("total_shots", 1) - 1)
        state["current_index"] = max(0, min(state["current_index"], state.get("total_shots", 1) - 1))

        # reroll_index 优先
        if state.get("reroll_index") is not None:
            state["current_index"] = state["reroll_index"]

        save_state(state)
        summary = build_summary(state)
        return {
            "ui": {
                "h3_start": {
                    "run_name": state.get("run_name"),
                    "mode": state.get("mode"),
                    "current_index": state.get("current_index", 0),
                    "total_shots": state.get("total_shots"),
                    "summary": summary,
                }
            },
            "result": (
                state,
                int(compat.get("width", 1080) or 1080),
                int(compat.get("height", 1920) or 1920),
                int(compat.get("fps", 24) or 24),
            ),
        }


# ══════════════════════════════════════════════════════════════════════════════
# 4. Current Shot 节点
# ══════════════════════════════════════════════════════════════════════════════

class EagleH3NativeLoopStartNode:
    """原生动态图循环起点；flow 必须直连 Native Loop End。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "run_state": (H3_RUN_STATE,),
                "start_index": ("INT", {"default": 1, "min": 1, "max": 1000, "step": 1}),
            },
            "hidden": {"initial_state": (H3_RUN_STATE,)},
        }

    RETURN_TYPES = (H3_LOOP_FLOW, H3_RUN_STATE, "INT", "INT", "INT", "STRING")
    RETURN_NAMES = ("flow", "run_state", "width", "height", "fps", "status")
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 核心"

    @classmethod
    def IS_CHANGED(cls, *args, **kwargs):
        return float("NaN")

    def execute(self, run_state, start_index=1, initial_state=None):
        if initial_state is None:
            started = EagleH3StartNode().execute(run_state, start_index=start_index)
            if isinstance(started, dict):
                state, width, height, fps = started["result"]
            else:
                state, width, height, fps = started
        else:
            state = _clone_state(initial_state)
            original_plan = (run_state or {}).get("plan") or {}
            recursive_plan = state.get("plan") or {}
            if original_plan.get("plan_hash") != recursive_plan.get("plan_hash"):
                raise ValueError("[H3NativeLoop] 递归执行期间导演台计划已变更")
            if run_state.get("run_name") != state.get("run_name"):
                raise ValueError("[H3NativeLoop] 递归状态与当前运行名不一致")
            compat = recursive_plan.get("compatibility") or {}
            width = int(compat.get("width", 1080) or 1080)
            height = int(compat.get("height", 1920) or 1920)
            fps = int(compat.get("fps", 24) or 24)
        status = build_summary(state)
        return {
            "ui": {"h3_start": {
                "run_name": state.get("run_name"),
                "mode": state.get("mode"),
                "current_index": state.get("current_index", 0),
                "total_shots": state.get("total_shots"),
                "summary": status,
                "native_loop": True,
            }},
            "result": ("eagle_h3_native_loop", state, width, height, fps, status),
        }


class EagleH3CurrentShotNode:
    """🦅 H3 链 · 当前镜头：提取当前分镜参数。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"run_state": (H3_RUN_STATE,)}
        }

    RETURN_TYPES = ("STRING", "INT", "INT", "INT", "INT", "INT", "STRING", "STRING", "BOOL", "STRING")
    RETURN_NAMES = (
        "prompt", "seed", "steps", "raw_frames", "delivered_frames",
        "blend_frames", "continuation_mode", "shot_id", "is_first", "summary",
    )
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台"

    def execute(self, run_state):
        state = _clone_state(run_state)
        params = shot_params(state)
        if params is None:
            return ("", 0, 0, 0, 0, 0, "guide", "", False, "无当前镜头")
        shot = params["shot"]
        return (
            str(shot.get("prompt", "")),
            int(shot.get("seed", 0)),
            int(shot.get("steps", 8)),
            int(shot.get("raw_frames", 0)),
            int(shot.get("delivered_frames", 0)),
            int(params["blend_frames"]),
            str(params["continuation_mode"]),
            str(shot.get("id", "")),
            bool(params["index"] == 0),
            build_summary(state),
        )


# ══════════════════════════════════════════════════════════════════════════════
# 5. Context 上下文节点
# ══════════════════════════════════════════════════════════════════════════════

class EagleH3ContextNode:
    """🦅 H3 链 · 上下文：首镜用 seed_image，续镜从 run_state 自动取上一镜末帧。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "run_state": (H3_RUN_STATE,),
            },
            "optional": {
                "prev_clip": ("VIDEO",),
                "context_frames_override": ("INT", {"default": 0, "min": 0, "max": 500, "step": 1}),
                "seed_image": ("IMAGE",),
            }
        }

    RETURN_TYPES = ("IMAGE", "INT", "BOOL", "STRING")
    RETURN_NAMES = ("context_image", "context_frames", "has_context", "note")
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台"

    def execute(self, run_state, prev_clip=None, context_frames_override=0, seed_image=None):
        state = _clone_state(run_state)
        params = shot_params(state)
        if params is None:
            return (_empty_image_tensor(), 0, False, "无当前镜头")

        idx = params["index"]
        ctx = context_frames_override or params["context_length"]

        # 首镜：优先使用 seed_image，否则返回空（由 MiniMaxH3 first_frame 决定行为）
        if idx == 0:
            if seed_image is not None:
                return (_normalize_seed(seed_image), 1, True, "首镜使用 seed_image 作为起始帧")
            return (_empty_image_tensor(), 0, False, "首镜且无 seed_image")

        # 续镜：解析上一镜 clip 路径（显式 prev_clip 优先，否则从 run_state 取）
        clip_path = _resolve_video_path(prev_clip) or _prev_clip_from_state(state, idx)
        if not clip_path or ctx <= 0:
            return (_empty_image_tensor(), 0, False, "无上下文（无上一镜 clip 或未设置 ctx）")

        path = _resolve_video_path(clip_path)
        if not path:
            return (_empty_image_tensor(), 0, False, f"无法解析上一段视频: {clip_path}")

        try:
            frames = _cached_context_frames(path, ctx)
            img = _np_to_tensor(frames)
            note = f"已取 {len(frames)} 帧上下文（{params['continuation_mode']} 模式）"
            return (img, len(frames), True, note)
        except Exception as e:
            logger.warning(f"[H3Chain] 上下文抽帧失败: {e}")
            return (_empty_image_tensor(), 0, False, f"上下文抽帧失败: {e}")


class EagleH3ShotContextNode:
    """当前镜头参数与续镜上下文的一体化承接节点。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"run_state": (H3_RUN_STATE,)},
            "optional": {
                "prev_clip": ("VIDEO",),
                "context_frames_override": (
                    "INT", {"default": 0, "min": 0, "max": 500, "step": 1}
                ),
                "seed_image": ("IMAGE",),
            },
        }

    RETURN_TYPES = (
        H3_RUN_STATE, "STRING", "INT", "INT", "INT", "INT", "INT", "STRING",
        "STRING", "BOOL", "IMAGE", "INT", "BOOL", "STRING",
    )
    RETURN_NAMES = (
        "run_state", "prompt", "seed", "steps", "raw_frames", "delivered_frames",
        "blend_frames", "continuation_mode", "shot_id", "is_first", "context_image",
        "context_frames", "has_context", "summary",
    )
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 核心"

    def execute(self, run_state, prev_clip=None, context_frames_override=0, seed_image=None):
        state = _clone_state(run_state)
        shot_values = EagleH3CurrentShotNode().execute(state)
        context_image, context_frames, has_context, context_note = EagleH3ContextNode().execute(
            state,
            prev_clip=prev_clip,
            context_frames_override=context_frames_override,
            seed_image=seed_image,
        )
        (
            prompt, seed, steps, raw_frames, delivered_frames, blend_frames,
            continuation_mode, shot_id, is_first, shot_summary,
        ) = shot_values
        summary = shot_summary + ("\n" + context_note if context_note else "")
        return (
            state, prompt, seed, steps, raw_frames, delivered_frames, blend_frames,
            continuation_mode, shot_id, is_first, context_image, context_frames,
            has_context, summary,
        )


# ══════════════════════════════════════════════════════════════════════════════
# 6. Trim 节点
# ══════════════════════════════════════════════════════════════════════════════

class EagleH3TrimNode:
    """🦅 H3 链 · 裁剪：裁剪视频。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video": ("VIDEO",),
                "start": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 999999.0, "step": 0.01}),
                "end": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 999999.0, "step": 0.01}),
                "unit": (["sec", "frame"], {"default": "sec"}),
                "fps": ("INT", {"default": 24, "min": 1, "max": 120, "step": 1}),
            }
        }

    RETURN_TYPES = ("VIDEO", "STRING")
    RETURN_NAMES = ("video", "info")
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台"

    def execute(self, video, start, end, unit="sec", fps=24):
        in_path = _resolve_video_path(video)
        if not in_path:
            return ("", "❌ 无法解析输入视频")
        if end <= 0 or (unit == "frame" and end <= start):
            return (native_video(in_path), "无需裁剪")
        out_path = safe_output_path(
            folder_paths.get_output_directory(),
            "h3_eagle_chains/.tmp",
            f"trim_{int(time.time()*1000)}.mp4",
        )
        try:
            trim_video(in_path, out_path, start, end, unit=unit, fps=fps)
            return (native_video(out_path), f"已裁剪: {start} -> {end} {unit}")
        except Exception as e:
            return ("", f"❌ 裁剪失败: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# 7. Segment + Checkpoint 节点
# ══════════════════════════════════════════════════════════════════════════════

class EagleH3SegmentCheckpointNode:
    """🦅 H3 链 · 分段+检查点：保存单镜成片并更新 manifest。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "run_state": (H3_RUN_STATE,),
                "video": ("VIDEO",),
            },
            "optional": {
                "trim_start": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 999999.0, "step": 0.01}),
                "trim_end": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 999999.0, "step": 0.01}),
                "audio": ("AUDIO",),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            }
        }

    RETURN_TYPES = ("VIDEO", H3_RUN_STATE, "STRING")
    RETURN_NAMES = ("clip", "run_state", "clip_path")
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台"
    DEPRECATED = True

    def execute(self, run_state, video, trim_start=0.0, trim_end=0.0, audio=None, prompt=None, extra_pnginfo=None):
        state = _clone_state(run_state)
        params = shot_params(state)
        if params is None:
            return ("", state, "❌ 无当前镜头")

        in_path = _resolve_video_path(video)
        if not in_path:
            return ("", state, "❌ 无法解析输入视频")

        idx = params["index"]
        shot_dir = _shot_dir(state["base_dir"], idx)
        ensure_dir(str(shot_dir))
        clip_path = str(shot_dir / "clip.mp4")

        fps = params["fps"]
        delivered = params["shot"].get("delivered_frames", 0)

        try:
            # 显式首尾裁剪优先；否则按计划 delivered_frames 限长。
            if trim_end and trim_end > trim_start:
                trim_video(in_path, clip_path, trim_start, trim_end, unit="sec", fps=fps)
            elif trim_start > 0:
                src_duration = _probe_duration(in_path)
                if src_duration > trim_start:
                    trim_video(in_path, clip_path, trim_start, src_duration, unit="sec", fps=fps)
                else:
                    raise ValueError("裁剪起点超过视频时长")
            elif delivered and delivered > 0:
                duration = delivered / float(fps)
                src_duration = _probe_duration(in_path)
                if src_duration and duration < src_duration:
                    trim_video(in_path, clip_path, 0, duration, unit="sec", fps=fps)
                else:
                    shutil.copy2(in_path, clip_path)
            else:
                shutil.copy2(in_path, clip_path)

            # 合并音频
            if audio is not None:
                audio_path = str(shot_dir / "audio.wav")
                try:
                    self._save_audio(audio, audio_path)
                    merged_path = str(shot_dir / "clip_with_audio.mp4")
                    merge_audio_video(clip_path, audio_path, merged_path)
                    os.replace(merged_path, clip_path)
                except Exception as e:
                    logger.warning(f"[H3Chain] 合并音频失败: {e}")

            record_shot_result(
                state,
                clip_path=clip_path,
                delivered_frames=delivered,
                decision="pending",
                meta={"fps": fps, "audio": audio is not None},
            )
            save_state(state)
            return (native_video(clip_path), state, f"✅ 已保存 clip_{idx + 1:02d}: {clip_path}")
        except Exception as e:
            logger.error(f"[H3Chain] 分段保存失败: {e}")
            return ("", state, f"❌ 分段保存失败: {e}")

    def _save_audio(self, audio, output_path):
        try:
            import soundfile as sf
        except ImportError:
            raise RuntimeError("需要安装 soundfile 以保存音频")
        if isinstance(audio, dict):
            waveform = audio.get("waveform")
            if waveform is None:
                waveform = audio.get("audio")
            sample_rate = audio.get("sample_rate", 44100)
        else:
            waveform = audio
            sample_rate = 44100
        if waveform is None:
            raise ValueError("AUDIO 输入缺少 waveform")
        if isinstance(waveform, torch.Tensor):
            waveform = waveform.cpu().numpy()
        if waveform.ndim == 3:
            waveform = waveform[0]
        if waveform.ndim == 2 and waveform.shape[0] > waveform.shape[1]:
            waveform = waveform.T
        sf.write(output_path, waveform.T if waveform.ndim == 2 else waveform, sample_rate)


# ══════════════════════════════════════════════════════════════════════════════
# 8. Review Gate 节点
# ══════════════════════════════════════════════════════════════════════════════

class EagleH3ReviewGateNode:
    """🦅 H3 链 · 审查门：可交互审阅当前镜头。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "run_state": (H3_RUN_STATE,),
                "preview_clip": ("VIDEO",),
            },
            "optional": {
                "review_decision": ("STRING", {"default": "", "multiline": False}),
            },
            "hidden": {"unique_id": "UNIQUE_ID"}
        }

    RETURN_TYPES = (H3_RUN_STATE, "STRING", "BOOL", "BOOL", "STRING")
    RETURN_NAMES = ("run_state", "decision", "awaiting_review", "approved", "summary")
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle Suite/H3 导演台"
    DEPRECATED = True

    def execute(self, run_state, preview_clip, review_decision="", unique_id=None):
        state = _clone_state(run_state)
        preview_path = _resolve_video_path(preview_clip) or ""
        params = shot_params(state)
        if params is None:
            return (state, "none", False, False, "无当前镜头")

        mode = state.get("mode", "auto")
        decision = (review_decision or "").strip().lower()

        # auto 模式直接通过
        if mode == "auto":
            decision = decision or "approve"

        if not decision:
            # interactive 模式下，没有决策则暂停等待前端
            if state.get("shots"):
                state["shots"][-1]["decision"] = "reviewing"
                save_state(state)
            return {
                "ui": {
                    "h3_review": {
                        "awaiting_review": True,
                        "approved": False,
                        "decision": "",
                        "summary": build_summary(state),
                        "mode": mode,
                        "run_name": state.get("run_name"),
                        "current_index": state.get("current_index", 0),
                        "preview_clip": preview_path,
                    }
                },
                "result": (state, "", True, False, build_summary(state)),
            }

        if decision not in ("approve", "retry", "reroll", "stop", "auto"):
            decision = "approve"

        if decision == "auto":
            decision = "approve"

        # 记录决策到最新 segment
        if state.get("shots"):
            state["shots"][-1]["decision"] = decision

        # 把 decision 写入 state.pending_decision，供 End 读取
        state["pending_decision"] = decision
        state["awaiting_review"] = False
        save_state(state)

        approved = decision == "approve"
        summary = build_summary(state)
        return {
            "ui": {
                "h3_review": {
                    "awaiting_review": False,
                    "approved": approved,
                    "decision": decision,
                    "summary": summary,
                    "mode": mode,
                    "run_name": state.get("run_name"),
                    "current_index": state.get("current_index", 0),
                    "preview_clip": preview_path,
                }
            },
            "result": (state, decision, False, approved, summary),
        }


# ══════════════════════════════════════════════════════════════════════════════
# 9. End 节点
# ══════════════════════════════════════════════════════════════════════════════

class EagleH3EndNode:
    """🦅 H3 链 · 结束：推进循环索引，决定是否继续。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "run_state": (H3_RUN_STATE,),
            },
            "optional": {
                "decision": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = (H3_RUN_STATE, "BOOL", "INT", "BOOL", "STRING")
    RETURN_NAMES = ("run_state", "done", "next_index", "loop_again", "summary")
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台"
    DEPRECATED = True

    def execute(self, run_state, decision=""):
        state = _clone_state(run_state)
        # 优先用显式 decision 输入，否则用 state.pending_decision
        if not decision:
            decision = state.get("pending_decision", "")
        decision = (decision or "").strip().lower()
        if not decision:
            decision = "approve" if state.get("mode") == "auto" else ""

        if not decision:
            # 无决策不推进
            return (state, False, state.get("current_index", 0) + 1, False, build_summary(state))

        state, loop_again, done = advance(state, decision=decision)
        state["pending_decision"] = None
        save_state(state)
        summary = build_summary(state)
        return {
            "ui": {
                "h3_loop": {
                    "done": done,
                    "loop_again": loop_again,
                    "next_index": state.get("current_index", 0) + 1,
                    "summary": summary,
                    "mode": state.get("mode"),
                    "run_name": state.get("run_name"),
                }
            },
            "result": (state, done, state.get("current_index", 0) + 1, loop_again, summary),
        }


# ══════════════════════════════════════════════════════════════════════════════
# 10. Assemble 节点
# ══════════════════════════════════════════════════════════════════════════════

class EagleH3NativeLoopEndNode:
    """
    原生动态图循环终点。

    auto 模式在同一次 ComfyUI 执行中克隆 Start 与 End 之间的子图；
    interactive 模式保持一镜一次执行，以免上一镜的审片决定泄漏到下一镜。
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flow": (H3_LOOP_FLOW, {"rawLink": True}),
                "run_state": (H3_RUN_STATE,),
            },
            "optional": {
                "decision": ("STRING", {"default": ""}),
                "filename": ("STRING", {"default": ""}),
                "format": (["mp4", "mov", "mkv"], {"default": "mp4"}),
                "fps_override": ("INT", {"default": 0, "min": 0, "max": 120, "step": 1}),
            },
            "hidden": {
                "dynprompt": "DYNPROMPT",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = (H3_RUN_STATE, "VIDEO", "BOOL", "INT", "STRING")
    RETURN_NAMES = ("run_state", "video", "done", "next_index", "summary")
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle Suite/H3 核心"

    @classmethod
    def IS_CHANGED(cls, *args, **kwargs):
        return float("NaN")

    @staticmethod
    def _display_id(dynprompt, node_id):
        getter = getattr(dynprompt, "get_display_node_id", None)
        return str(getter(node_id)) if getter else str(node_id)

    def _explore_dependencies(self, node_id, dynprompt, downstream, parent_ids):
        node_info = dynprompt.get_node(node_id)
        for value in (node_info.get("inputs") or {}).values():
            if not is_link(value):
                continue
            parent_id = str(value[0])
            display_id = self._display_id(dynprompt, parent_id)
            display_node = dynprompt.get_node(display_id)
            if display_node.get("class_type") != "EagleH3NativeLoopEndNode":
                parent_ids.append(display_id)
            if parent_id not in downstream:
                downstream[parent_id] = []
                self._explore_dependencies(parent_id, dynprompt, downstream, parent_ids)
            if str(node_id) not in downstream[parent_id]:
                downstream[parent_id].append(str(node_id))

    def _include_branched_output_nodes(self, dynprompt, downstream, parent_ids):
        """保留循环体内的预览/保存等输出分支。"""
        try:
            import nodes as comfy_nodes
            mappings = comfy_nodes.NODE_CLASS_MAPPINGS
            original_prompt = dynprompt.get_original_prompt()
        except Exception:
            return
        output_links = {}
        for node_id, node_info in original_prompt.items():
            class_def = mappings.get(node_info.get("class_type"))
            if not class_def or not getattr(class_def, "OUTPUT_NODE", False):
                continue
            for value in (node_info.get("inputs") or {}).values():
                if is_link(value):
                    output_links.setdefault(str(node_id), []).append(value)
        parent_set = set(parent_ids)
        for parent_id in list(downstream):
            display_id = self._display_id(dynprompt, parent_id)
            for output_id, links in output_links.items():
                if any(str(link[0]) in parent_set and display_id == str(link[0]) for link in links):
                    child_id = output_id
                    if "." in str(parent_id):
                        parts = str(parent_id).split(".")
                        parts[-1] = output_id
                        child_id = ".".join(parts)
                    if child_id not in downstream[parent_id]:
                        downstream[parent_id].append(child_id)

    def _collect_contained(self, node_id, downstream, contained):
        for child_id in downstream.get(str(node_id), []):
            if child_id in contained:
                continue
            contained.add(child_id)
            self._collect_contained(child_id, downstream, contained)

    def _recurse(self, flow, next_state, dynprompt, unique_id):
        if GraphBuilder is None:
            raise RuntimeError(
                "Eagle H3 原生循环需要支持 comfy_execution.graph_utils.GraphBuilder 的 ComfyUI"
            )
        if dynprompt is None or unique_id is None:
            raise RuntimeError("Eagle H3 原生循环未收到 DYNPROMPT/UNIQUE_ID")
        if not is_link(flow):
            raise ValueError("Native Loop End 的 flow 必须直接连自 Native Loop Start")

        end_id = str(unique_id)
        start_id = str(flow[0])
        start_info = dynprompt.get_node(start_id)
        if start_info.get("class_type") != "EagleH3NativeLoopStartNode":
            raise ValueError("Native Loop End 的 flow 必须直接连自 Native Loop Start")

        downstream, parent_ids = {}, []
        self._explore_dependencies(end_id, dynprompt, downstream, parent_ids)
        self._include_branched_output_nodes(dynprompt, downstream, list(set(parent_ids)))
        contained = {end_id, start_id}
        self._collect_contained(start_id, downstream, contained)
        if end_id not in contained:
            raise ValueError("Native Loop Start 与 End 之间没有完整的数据路径")

        graph = GraphBuilder()
        for node_id in contained:
            original = dynprompt.get_node(node_id)
            clone_id = "Recurse" if node_id == end_id else node_id
            clone = graph.node(original["class_type"], clone_id)
            clone.set_override_display_id(node_id)
        for node_id in contained:
            original = dynprompt.get_node(node_id)
            clone_id = "Recurse" if node_id == end_id else node_id
            clone = graph.lookup_node(clone_id)
            for key, value in (original.get("inputs") or {}).items():
                if is_link(value) and str(value[0]) in contained:
                    clone.set_input(key, graph.lookup_node(str(value[0])).out(value[1]))
                else:
                    clone.set_input(key, value)
        graph.lookup_node(start_id).set_input("initial_state", next_state)
        recurse = graph.lookup_node("Recurse")
        return {
            "result": tuple(recurse.out(i) for i in range(len(self.RETURN_TYPES))),
            "expand": graph.finalize(),
        }

    def execute(self, flow, run_state, decision="", filename="", format="mp4",
                fps_override=0, dynprompt=None, unique_id=None):
        advanced = EagleH3EndNode().execute(run_state, decision=decision)
        if isinstance(advanced, dict):
            state, done, next_index, loop_again, summary = advanced["result"]
        else:
            state, done, next_index, loop_again, summary = advanced

        # 审片模式每镜一次执行；下一次 Queue 从 manifest 继续。
        if loop_again and state.get("mode") != "auto":
            summary += "\n交互审片模式：已保存当前镜头，请再次执行生成下一镜。"
            return (state, None, False, next_index, summary)

        if loop_again:
            return self._recurse(flow, state, dynprompt, unique_id)

        final_video = None
        if done and state.get("shots"):
            final_video, assemble_status = EagleH3AssembleNode().execute(
                state, filename=filename, format=format, fps_override=fps_override
            )
            summary += "\n" + assemble_status
        result = (state, final_video, done, next_index, summary)
        return {
            "ui": {"h3_native_loop": {
                "done": done,
                "next_index": next_index,
                "summary": summary,
                "mode": state.get("mode"),
                "run_name": state.get("run_name"),
            }},
            "result": result,
        }


class EagleH3AssembleNode:
    """🦅 H3 链 · 合成：拼接所有分段为最终视频。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "run_state": (H3_RUN_STATE,),
            },
            "optional": {
                "filename": ("STRING", {"default": ""}),
                "format": (["mp4", "mov", "mkv"], {"default": "mp4"}),
                "fps_override": ("INT", {"default": 0, "min": 0, "max": 120, "step": 1}),
            }
        }

    RETURN_TYPES = ("VIDEO", "STRING")
    RETURN_NAMES = ("video", "summary")
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台"
    DEPRECATED = True

    def execute(self, run_state, filename="", format="mp4", fps_override=0):
        state = _clone_state(run_state)
        shots = state.get("shots", [])
        if not shots:
            return ("", "❌ 没有可拼接的分段")

        clip_paths = []
        for shot in sorted(shots, key=lambda s: s.get("index", 0)):
            clip = shot.get("clip")
            if clip and os.path.isfile(clip):
                clip_paths.append(clip)

        if not clip_paths:
            return ("", "❌ 没有有效的分段视频")

        run_name = state.get("run_name", "h3_pipeline")
        out_name = filename.strip() or run_name
        out_path = safe_output_path(
            state["base_dir"], "final", f"{out_name}.{format}", create_dirs=True
        )

        try:
            fps = fps_override or int(state["plan"]["compatibility"].get("fps", 24) or 24)
            concat_videos(clip_paths, out_path, fps=fps)
            return (native_video(out_path), f"✅ 已合成: {out_path} ({len(clip_paths)} 段)")
        except Exception as e:
            return ("", f"❌ 合成失败: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# 组合节点：检查点 + 审查门 / 推进 + 合成
# ══════════════════════════════════════════════════════════════════════════════

class EagleH3CheckpointReviewNode:
    """保存当前镜头并完成审片决策，替代原来的两个串联节点。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "run_state": (H3_RUN_STATE,),
                "video": ("VIDEO",),
            },
            "optional": {
                "audio": ("AUDIO",),
                "trim_start": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 999999.0, "step": 0.01}),
                "trim_end": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 999999.0, "step": 0.01}),
                "review_decision": ("STRING", {"default": "", "multiline": False}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("VIDEO", H3_RUN_STATE, "STRING", "BOOL", "BOOL", "STRING", "STRING")
    RETURN_NAMES = (
        "clip", "run_state", "decision", "awaiting_review", "approved",
        "clip_path", "summary",
    )
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle Suite/H3 核心"

    def execute(self, run_state, video, audio=None, trim_start=0.0, trim_end=0.0,
                review_decision="", unique_id=None, prompt=None, extra_pnginfo=None):
        clip, checkpoint_state, checkpoint_status = EagleH3SegmentCheckpointNode().execute(
            run_state, video, trim_start, trim_end, audio, prompt, extra_pnginfo
        )
        clip_path = _resolve_video_path(clip) or ""
        if not clip_path:
            return (None, checkpoint_state, "error", False, False, "", checkpoint_status)

        review = EagleH3ReviewGateNode().execute(
            checkpoint_state, clip, review_decision=review_decision, unique_id=unique_id
        )
        if isinstance(review, dict):
            result = review.get("result", ())
            state, decision, awaiting, approved, summary = result
            payload = dict(review)
            payload["result"] = (clip, state, decision, awaiting, approved, clip_path, summary)
            return payload
        state, decision, awaiting, approved, summary = review
        return (clip, state, decision, awaiting, approved, clip_path, summary)


class EagleH3FinalizeNode:
    """推进镜头循环；最后一镜完成时自动合成整片。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"run_state": (H3_RUN_STATE,)},
            "optional": {
                "decision": ("STRING", {"default": ""}),
                "filename": ("STRING", {"default": ""}),
                "format": (["mp4", "mov", "mkv"], {"default": "mp4"}),
                "fps_override": ("INT", {"default": 0, "min": 0, "max": 120, "step": 1}),
            },
        }

    RETURN_TYPES = (H3_RUN_STATE, "VIDEO", "BOOL", "INT", "BOOL", "STRING")
    RETURN_NAMES = ("run_state", "video", "done", "next_index", "loop_again", "summary")
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle Suite/H3 制片流水线"

    def execute(self, run_state, decision="", filename="", format="mp4", fps_override=0):
        advanced = EagleH3EndNode().execute(run_state, decision=decision)
        ui = {}
        if isinstance(advanced, dict):
            ui = advanced.get("ui", {})
            state, done, next_index, loop_again, summary = advanced.get("result", ())
        else:
            state, done, next_index, loop_again, summary = advanced

        final_video = None
        if done and state.get("shots"):
            final_video, assemble_status = EagleH3AssembleNode().execute(
                state, filename=filename, format=format, fps_override=fps_override
            )
            summary = summary + "\n" + assemble_status

        result = (state, final_video, done, next_index, loop_again, summary)
        return {"ui": ui, "result": result} if ui else result


# ══════════════════════════════════════════════════════════════════════════════
# 11. Export PNG Sequence 节点
# ══════════════════════════════════════════════════════════════════════════════

class EagleH3ExportPNGSequenceNode:
    """🦅 H3 链 · 导出 PNG 序列：把当前帧序列写入磁盘。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "run_state": (H3_RUN_STATE,),
                "frames": ("IMAGE",),
            },
            "optional": {
                "export_name": ("STRING", {"default": "frames"}),
                "first_frame_number": ("INT", {"default": 1, "min": 1, "max": 99999, "step": 1}),
                "png_compression": ("INT", {"default": 3, "min": 0, "max": 9, "step": 1}),
            }
        }

    RETURN_TYPES = ("STRING", "INT", "STRING")
    RETURN_NAMES = ("output_directory", "frame_count", "status")
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 工具"

    def execute(self, run_state, frames, export_name="frames", first_frame_number=1, png_compression=3):
        state = _clone_state(run_state)
        params = shot_params(state)
        idx = params["index"] if params else 0
        out_dir = Path(state["base_dir"]) / "frames" / export_name
        ensure_dir(str(out_dir))

        np_frames = _tensor_to_np(frames)
        count = 0
        for i, frame in enumerate(np_frames, start=first_frame_number):
            img = Image.fromarray(frame)
            img.save(out_dir / f"frame_{i:05d}.png", compress_level=png_compression)
            count += 1

        # 写 export 元数据
        meta = {
            "shot_index": idx,
            "count": count,
            "first_frame_number": first_frame_number,
            "exported_at": datetime.now().isoformat(),
        }
        with open(out_dir / "export.json", "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

        return (str(out_dir), count, f"✅ 已导出 {count} 帧到 {out_dir}")


# ══════════════════════════════════════════════════════════════════════════════
# 12. Seam Probe 节点
# ══════════════════════════════════════════════════════════════════════════════

class EagleH3SeamProbeNode:
    """🦅 H3 链 · 接缝探测：分析两段视频拼接处的连续性。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "run_state": (H3_RUN_STATE,),
                "prev_clip": ("VIDEO",),
                "cur_clip": ("VIDEO",),
                "blend_frames": ("INT", {"default": 5, "min": 1, "max": 100, "step": 1}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "INT")
    RETURN_NAMES = ("seam_preview", "report", "recommended_offset")
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 工具"

    def execute(self, run_state, prev_clip, cur_clip, blend_frames=5):
        prev_path = _resolve_video_path(prev_clip)
        cur_path = _resolve_video_path(cur_clip)
        if not prev_path or not cur_path:
            img = _empty_image_tensor()
            return (img, "❌ 无法解析输入视频", 0)
        try:
            preview, report, offset = seam_analysis(prev_path, cur_path, blend_frames)
            return (_np_to_tensor(preview[None, ...]), report, offset)
        except Exception as e:
            return (_empty_image_tensor(), f"❌ 接缝分析失败: {e}", 0)


# ══════════════════════════════════════════════════════════════════════════════
# 13. 智能分镜 节点
# ══════════════════════════════════════════════════════════════════════════════

def _detect_scene_timestamps(video_path, threshold, min_sec):
    """ffmpeg scene 检测，返回镜头切换时间点（秒）。失败返回 []。"""
    ff = get_cached_ffmpeg()
    if not ff:
        return []
    try:
        cmd = [ff, "-hide_banner", "-i", str(video_path),
               "-filter:v", "select='gt(scene,%s)',showinfo" % threshold,
               "-vsync", "vfr", "-f", "null", "-"]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        pts = []
        for line in result.stderr.splitlines():
            m = re.search(r"pts_time:([0-9.]+)", line)
            if not m:
                continue
            t = float(m.group(1))
            if pts and (t - pts[-1]) < min_sec:
                continue
            pts.append(t)
        return pts
    except Exception as e:
        logger.warning("[H3Chain] scene 检测失败: %s", e)
        return []


def _extract_single_frame(video_path, t_sec, size):
    """在 t 秒处抽一帧，返回 np 数组或 None。"""
    ff = get_cached_ffmpeg()
    if not ff:
        return None
    import tempfile
    fd, tmp = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    try:
        cmd = [ff, "-hide_banner", "-ss", "%.3f" % t_sec, "-i", str(video_path),
               "-frames:v", "1", "-vf", "scale=%d:-1" % size, "-y", tmp]
        subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if not os.path.exists(tmp) or os.path.getsize(tmp) == 0:
            return None
        return np.array(Image.open(tmp).convert("RGB"))
    except Exception:
        return None
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def _make_grid(imgs, size, cols=8):
    """把多张缩略图拼成网格预览图（暗色底）。"""
    if not imgs:
        return _empty_image_tensor()
    cols = max(1, min(cols, len(imgs)))
    rows = (len(imgs) + cols - 1) // cols
    canvas = np.full((rows * size, cols * size, 3), 24, dtype=np.uint8)
    for idx, im in enumerate(imgs):
        r = idx // cols
        c = idx % cols
        pil = Image.fromarray(im).resize((size, size), Image.LANCZOS)
        canvas[r * size:(r + 1) * size, c * size:(c + 1) * size, :] = np.array(pil)
    return _np_to_tensor(canvas)


class EagleH3SmartSplitNode:
    """🦅 H3 链 · 智能分镜：按场景自动切分，或按手动点切分，输出分割点与预览。"""

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # 自动模式每次重新检测（nan），手动模式按视频+手动点参与缓存。
        if kwargs.get("mode") == "自动场景检测":
            return float("nan")
        return ((_resolve_video_path(kwargs.get("video")) or "") + "|" + (kwargs.get("manual_points") or ""))

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video": ("VIDEO",),
                "mode": (["自动场景检测", "手动分割点"], {"default": "自动场景检测"}),
            },
            "optional": {
                "detect_threshold": ("FLOAT", {"default": 0.3, "min": 0.05, "max": 0.8, "step": 0.01}),
                "min_scene_sec": ("FLOAT", {"default": 1.0, "min": 0.2, "max": 10.0, "step": 0.1}),
                "manual_points": ("STRING", {"default": "", "multiline": True,
                              "placeholder": "手动分割点（秒），逗号/换行分隔，如 3.5, 8.2, 12.0"}),
                "preview_size": ("INT", {"default": 220, "min": 64, "max": 512, "step": 16}),
            },
        }

    RETURN_TYPES = ("STRING", "IMAGE", "INT")
    RETURN_NAMES = ("segments_json", "preview", "segment_count")
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 工具"

    def execute(self, video, mode, detect_threshold=0.3, min_scene_sec=1.0, manual_points="", preview_size=220):
        path = _resolve_video_path(video)
        if not path:
            return ("{}", _empty_image_tensor(), 0)

        info = _ffprobe_streams(path)
        fps = 24.0
        dur = 0.0
        if info:
            fr = info.get("avg_frame_rate") or "24/1"
            try:
                a, b = fr.split("/")
                fps = float(a) / max(1.0, float(b or 1))
            except Exception:
                fps = 24.0
            try:
                dur = float(info.get("duration") or 0)
            except Exception:
                dur = 0.0

        if mode == "手动分割点":
            pts = []
            for p in re.split(r"[,\n\r ]+", (manual_points or "").strip()):
                p = p.strip().rstrip(".")
                if p:
                    try:
                        pts.append(float(p))
                    except ValueError:
                        pass
            pts = sorted(set(pts))
        else:
            pts = _detect_scene_timestamps(path, detect_threshold, min_scene_sec)
            if not pts and dur:
                n = max(1, int(dur // 10) or 1)
                pts = [round(i * (dur / n), 3) for i in range(1, n)]

        boundaries = sorted({0.0} | set(pts))
        if dur:
            boundaries = sorted(b for b in boundaries if 0 <= b < dur)
            boundaries.append(dur)
        if len(boundaries) < 2:
            boundaries = [0.0, dur or 10.0]

        segments = []
        thumbs = []
        for i in range(len(boundaries) - 1):
            start, end = boundaries[i], boundaries[i + 1]
            rec = {
                "index": i + 1,
                "start": round(start, 3),
                "end": round(end, 3),
                "duration": round(end - start, 3),
                "duration_frames": int(round((end - start) * fps)),
            }
            segments.append(rec)
            thumb = _extract_single_frame(path, (start + end) / 2.0, preview_size)
            if thumb is not None:
                thumbs.append(thumb)

        preview = _make_grid(thumbs, preview_size)
        return (json.dumps({"segments": segments, "fps": round(fps, 3)}, ensure_ascii=False),
                preview, len(segments))


# ══════════════════════════════════════════════════════════════════════════════
# 节点注册表
# ══════════════════════════════════════════════════════════════════════════════

NODE_CLASS_MAPPINGS_H3PIPELINE = {
    "EagleH3PlanNode": EagleH3PlanNode,
    "EagleH3NativeLoopStartNode": EagleH3NativeLoopStartNode,
    "EagleH3ShotContextNode": EagleH3ShotContextNode,
    "EagleH3CheckpointReviewNode": EagleH3CheckpointReviewNode,
    "EagleH3NativeLoopEndNode": EagleH3NativeLoopEndNode,
    "EagleH3ExportPNGSequenceNode": EagleH3ExportPNGSequenceNode,
    "EagleH3SeamProbeNode": EagleH3SeamProbeNode,
    "EagleH3SmartSplitNode": EagleH3SmartSplitNode,
}

NODE_DISPLAY_NAME_MAPPINGS_H3PIPELINE = {
    "EagleH3PlanNode": "🦅 H3 · 计划",
    "EagleH3NativeLoopStartNode": "🦅 H3 · 循环开始",
    "EagleH3ShotContextNode": "🦅 H3 · 镜头与上下文",
    "EagleH3CheckpointReviewNode": "🦅 H3 · 分段保存与审片",
    "EagleH3NativeLoopEndNode": "🦅 H3 · 循环结束与合成",
    "EagleH3ExportPNGSequenceNode": "🦅 H3 工具 · 导出 PNG 序列",
    "EagleH3SeamProbeNode": "🦅 H3 工具 · 接缝分析",
    "EagleH3SmartSplitNode": "🦅 H3 工具 · 智能分镜",
}

__all__ = [
    "EagleH3PlanNode",
    "EagleH3PreflightNode",
    "EagleH3LoadManifestNode",
    "EagleH3StartNode",
    "EagleH3NativeLoopStartNode",
    "EagleH3CurrentShotNode",
    "EagleH3ContextNode",
    "EagleH3ShotContextNode",
    "EagleH3TrimNode",
    "EagleH3SegmentCheckpointNode",
    "EagleH3ReviewGateNode",
    "EagleH3EndNode",
    "EagleH3NativeLoopEndNode",
    "EagleH3AssembleNode",
    "EagleH3ExportPNGSequenceNode",
    "EagleH3SeamProbeNode",
    "EagleH3SmartSplitNode",
    "EagleH3CheckpointReviewNode",
    "EagleH3FinalizeNode",
    "NODE_CLASS_MAPPINGS_H3PIPELINE",
    "NODE_DISPLAY_NAME_MAPPINGS_H3PIPELINE",
]


def _probe_duration(video_path):
    """获取视频时长（秒），失败返回 0。"""
    ffmpeg = get_cached_ffmpeg()
    if not ffmpeg:
        return 0
    try:
        cmd = [ffmpeg, "-i", str(video_path), "-f", "null", "-"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        m = re.search(r"Duration:\s+(\d+):(\d+):(\d+\.\d+)", result.stderr)
        if m:
            h, mn, s = m.groups()
            return int(h) * 3600 + int(mn) * 60 + float(s)
    except Exception:
        pass
    return 0
