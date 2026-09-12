# -*- coding: utf-8 -*-
"""
H3 导演台下游循环链路节点。

消费 EagleH3DirectorNode 输出的 H3_CHAIN_PLAN，实现上下文视频衔接、
分段检查点、审阅门、循环推进、视频拼接、PNG 序列导出、接缝探测。
"""

import asyncio
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
    from server import PromptServer
except Exception:
    PromptServer = None

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

from ..h3_director_node import H3_MEDIA_BUNDLE_TYPE, H3_PLAN_TYPE
from ..eagle_client import eagle_client
from ..logger import logger
from ..utils import ensure_dir, get_cached_ffmpeg

from .constants import (
    H3_LOOP_FLOW,
    H3_MANIFEST,
    H3_RUN_STATE,
    H3_SEGMENT,
    MANIFEST_VERSION,
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
from .review_runtime import close_review, open_review
from .state import (
    advance,
    apply_shot_overrides,
    build_summary,
    init_state,
    load_state,
    record_shot_result,
    restore_from_scene,
    save_state,
    shot_params,
)


# ══════════════════════════════════════════════════════════════════════════════
# 工具函数
# ══════════════════════════════════════════════════════════════════════════════

def _clone_state(state):
    """复制状态容器，同时保留仅在本次循环中传递的张量引用。

    ``previous_frames`` / ``previous_latent`` 是 ComfyUI 动态循环的运行期
    数据，不能经过 JSON 往返。这里复制 dict/list 以隔离状态修改，但不复制
    张量本体；循环结束节点会在写入状态前把真正需要承接的尾部张量压到 CPU。
    """
    if isinstance(state, dict):
        return {key: _clone_state(value) for key, value in state.items()}
    if isinstance(state, list):
        return [_clone_state(value) for value in state]
    if isinstance(state, tuple):
        return tuple(_clone_state(value) for value in state)
    return state


def _portable_state(state):
    """生成不含运行期张量的 manifest/JSON 边界快照。"""
    if not isinstance(state, dict):
        return state
    return _clone_state({
        key: value for key, value in state.items()
        if key not in ("previous_frames", "previous_latent")
    })


def _reserve_numbered_video_path(directory, prefix, extension, start=1, padding=4):
    """Atomically reserve ``prefix_0001.ext`` style paths without overwriting."""
    target_dir = Path(directory)
    ensure_dir(str(target_dir))
    safe_prefix = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", str(prefix or "video"))
    safe_prefix = safe_prefix.strip(" .") or "video"
    safe_extension = re.sub(r"[^A-Za-z0-9]+", "", str(extension or "mp4").lower()) or "mp4"
    counter = max(1, int(start or 1))
    while counter <= 99999999:
        candidate = target_dir / f"{safe_prefix}_{counter:0{padding}d}.{safe_extension}"
        try:
            descriptor = os.open(str(candidate), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            counter += 1
            continue
        os.close(descriptor)
        return str(candidate)
    raise RuntimeError(f"无法为 {safe_prefix} 分配可用的视频编号")


def _json_snapshot(value):
    """稳定、可读的 JSON 边界格式，供通用文本/存储节点交换。"""
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)


def _coerce_json_object(source, label):
    """接受已解码 dict 或 STRING JSON，并给出明确的结构错误。"""
    if isinstance(source, dict):
        # 先浅拷贝以便识别第三方 state 中的张量；直接 JSON 深拷贝会在给出
        # 有意义的契约错误之前因 tensor 不可序列化而失败。
        return dict(source)
    if not isinstance(source, str) or not source.strip():
        raise ValueError(f"{label} 必须是对象或非空 JSON 字符串")
    try:
        value = json.loads(source)
    except Exception as error:
        raise ValueError(f"{label} 不是有效 JSON: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} JSON 顶层必须是对象")
    return value


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


def _latent_streams(latent):
    """按 H3 的 NestedTensor/列表契约解包视频与音频 latent。"""
    if not isinstance(latent, dict) or "samples" not in latent:
        raise ValueError("H3 latent 必须是包含 samples 的对象")
    samples = latent["samples"]
    if hasattr(samples, "unbind"):
        parts = list(samples.unbind())
    elif isinstance(samples, (tuple, list)):
        parts = list(samples)
    else:
        raise ValueError(
            "采样结果不是 MiniMax H3 AV latent（需要视频/音频双流）"
        )
    if len(parts) < 2:
        raise ValueError("MiniMax H3 循环需要采样后的双流 AV latent")
    return parts


def _compact_h3_latent(latent):
    """只承接 H3 的视频/音频两路 latent，并释放其余采样附加数据。"""
    parts = _latent_streams(latent)
    compact = []
    for value in parts[:2]:
        if not torch.is_tensor(value):
            raise ValueError("MiniMax H3 AV latent 的视频/音频流必须是张量")
        compact.append(value.detach().cpu().contiguous().clone())
    return {"samples": compact}


def _previous_latent_from_state(state, current_index):
    """取本次递归携带的 latent，或从上一镜版本检查点恢复。"""
    runtime = state.get("previous_latent") if isinstance(state, dict) else None
    if runtime is not None:
        try:
            return _compact_h3_latent(runtime), "runtime"
        except (TypeError, ValueError) as error:
            logger.warning(f"[H3Chain] 运行期上一镜 latent 无效: {error}")

    previous_index = int(current_index) - 1
    previous = next(
        (
            item for item in (state.get("shots") or [])
            if int(item.get("index", -1)) == previous_index
        ),
        None,
    )
    latent_path = str((previous or {}).get("latent") or "")
    if not latent_path or not os.path.isfile(latent_path):
        return None, "missing"
    try:
        try:
            loaded = torch.load(latent_path, map_location="cpu", weights_only=True)
        except TypeError:  # PyTorch < 2.0
            loaded = torch.load(latent_path, map_location="cpu")
        return _compact_h3_latent(loaded), "checkpoint"
    except Exception as error:
        logger.warning(f"[H3Chain] 无法恢复上一镜 AV latent {latent_path}: {error}")
        return None, "invalid_checkpoint"


def _context_storage_length(state):
    """计算后续任意场景可能需要的最大视觉上下文帧数。"""
    plan = (state or {}).get("plan") or {}
    compatibility = plan.get("compatibility") or {}
    values = [
        int(compatibility.get(
            "context_storage_length", compatibility.get("context_length", 0)
        ) or 0)
    ]
    for shot in plan.get("shots") or []:
        value = shot.get("context_length") if isinstance(shot, dict) else None
        if value not in (None, ""):
            try:
                values.append(int(value))
            except (TypeError, ValueError):
                pass
    return max([value for value in values if value > 0] or [1])


def _context_tail(state, images):
    """克隆交付画面的最短必要尾段，避免视图持有整段 GPU 帧。"""
    if not torch.is_tensor(images) or images.ndim != 4 or int(images.shape[0]) < 1:
        raise ValueError("H3 循环结束需要连接裁剪后的 images")
    count = min(_context_storage_length(state), int(images.shape[0]))
    return images[-count:].detach().cpu().contiguous().clone()


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


def _next_revision(state, index):
    for item in state.get("shots", []):
        if int(item.get("index", -1)) == int(index):
            revisions = item.get("revisions") or []
            return max(
                [int(value.get("revision", 0) or 0) for value in revisions] +
                [int(item.get("active_revision", 0) or 0)]
            ) + 1
    return 1


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

    RETURN_TYPES = (H3_RUN_STATE, H3_MANIFEST, "STRING", "STRING")
    RETURN_NAMES = ("state", "manifest", "manifest_path", "summary")
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

    RETURN_TYPES = (H3_PLAN_TYPE, "BOOLEAN", "STRING", "STRING")
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


class EagleH3PlanInteropNode:
    """H3_CHAIN_PLAN 与通用 STRING JSON 的双向边界。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "source": (f"{H3_PLAN_TYPE},STRING", {
                    "forceInput": True,
                    "tooltip": "可连接 H3_CHAIN_PLAN，或任意节点提供的计划 JSON 字符串。",
                }),
            },
        }

    RETURN_TYPES = (H3_PLAN_TYPE, "STRING", "STRING", "INT", "INT", "INT")
    RETURN_NAMES = ("plan", "plan_json", "summary", "clip_count", "width", "height")
    OUTPUT_TOOLTIPS = (
        "校验后的公共 H3_CHAIN_PLAN。",
        "完整计划快照 JSON；可接任意 STRING 预览、保存、网络或数据库节点。",
        "计划摘要。",
        "镜头数量。",
        "生成宽度。",
        "生成高度。",
    )
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台/互操作"
    DESCRIPTION = (
        "不依赖来源节点身份，只按 H3_CHAIN_PLAN 的实际字段校验。"
        "用于第三方计划节点、文本节点和外部存储之间的安全转换。"
    )

    def execute(self, source):
        plan = _coerce_json_object(source, "plan")
        if "shots" not in plan and isinstance(plan.get("plan"), dict):
            plan = plan["plan"]
        plan = _validate_plan(plan)
        compatibility = plan.get("compatibility") or {}
        shots = plan.get("shots") or []
        summary = str(plan.get("summary") or f"{len(shots)} clips")
        return (
            plan,
            _json_snapshot(plan),
            summary,
            len(shots),
            int(compatibility.get("width", 0) or 0),
            int(compatibility.get("height", 0) or 0),
        )


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


class EagleH3StateInteropNode:
    """Eagle 运行状态与标准 JSON/VIDEO/数值端口之间的安全边界。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "source": (f"{H3_RUN_STATE},STRING", {
                    "forceInput": True,
                    "tooltip": (
                        "接受 Eagle H3 state，或先前导出的 state_json。"
                        "第三方 H3_CHAIN_STATE 含张量且契约不同，不能伪装直连。"
                    ),
                }),
            },
        }

    RETURN_TYPES = (
        H3_RUN_STATE, "STRING", H3_PLAN_TYPE, "VIDEO", "STRING",
        "INT", "INT", "BOOLEAN", "STRING",
    )
    RETURN_NAMES = (
        "state", "state_json", "plan", "prev_clip", "manifest_path",
        "clip_index", "clip_count", "done", "summary",
    )
    OUTPUT_TOOLTIPS = (
        "校验后的 Eagle 强类型状态，供原生循环内部使用。",
        "不含媒体张量的状态 JSON，可接通用 STRING 节点。",
        "状态中携带的公共 H3_CHAIN_PLAN。",
        "上一段已保存视频，使用 ComfyUI 标准 VIDEO 类型。",
        "当前运行清单 manifest.json 路径。",
        "当前一基镜头序号。",
        "总镜头数。",
        "是否已完成或停止。",
        "人类可读状态摘要。",
    )
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台/互操作"
    DESCRIPTION = (
        "开放 Eagle 状态中的可移植部分，同时保留内部 EAGLE_H3_STATE 强类型。"
        "这样普通 JSON/VIDEO 节点可以参与流程，而不会破坏递归状态契约。"
    )

    @staticmethod
    def _validated_state(source):
        state = _coerce_json_object(source, "state")
        if "version" not in state and isinstance(state.get("state"), dict):
            state = state["state"]
        if state.get("version") != MANIFEST_VERSION:
            if "index" in state and "previous_frames" in state:
                raise ValueError(
                    "收到的是第三方 H3_CHAIN_STATE；它包含张量/潜空间状态，"
                    "不能无损转换为 EAGLE_H3_STATE。请在各自循环边界使用标准媒体端口交换。"
                )
            raise ValueError(f"不支持的 Eagle state 版本: {state.get('version')}")
        _validate_plan(state.get("plan"))
        if not isinstance(state.get("shots", []), list):
            raise ValueError("state.shots 必须是数组")
        total = int(state.get("total_shots", len(state["plan"]["shots"])) or 0)
        index = int(state.get("current_index", 0) or 0)
        if total < 0 or index < 0:
            raise ValueError("state 的镜头索引不能为负数")
        state["total_shots"] = total
        state["current_index"] = index
        return _clone_state(state)

    def execute(self, source):
        state = self._validated_state(source)
        plan = state["plan"]
        index = int(state.get("current_index", 0) or 0)
        total = int(state.get("total_shots", len(plan.get("shots") or [])) or 0)
        previous_path = _prev_clip_from_state(state, index)
        previous_video = (
            native_video(previous_path)
            if previous_path and os.path.isfile(previous_path)
            else None
        )
        base_dir = str(state.get("base_dir") or "")
        manifest_path = str(Path(base_dir) / "manifest.json") if base_dir else ""
        done = bool(state.get("stop") or index >= total)
        return (
            state,
            _json_snapshot(_portable_state(state)),
            plan,
            previous_video,
            manifest_path,
            min(index + 1, total) if total else 0,
            total,
            done,
            build_summary(state),
        )


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
    """初始化/恢复计划并进入原生动态图循环；flow 必须直连 End。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "plan": (H3_PLAN_TYPE,),
                "start_index": ("INT", {"default": 1, "min": 1, "max": 1000, "step": 1}),
                "run_name_override": ("STRING", {"default": ""}),
                "output_dir": ("STRING", {"default": "", "placeholder": "留空使用 ComfyUI output 目录"}),
                "resume_policy": (["fail", "overwrite", "resume"], {"default": "resume"}),
                "mode": (["auto", "interactive"], {"default": "auto"}),
                "max_shots": ("INT", {"default": 0, "min": 0, "max": 1000, "step": 1}),
            },
            "hidden": {"initial_state": (H3_RUN_STATE,)},
        }

    RETURN_TYPES = (H3_LOOP_FLOW, H3_RUN_STATE, "INT", "INT", "INT", "STRING", "INT")
    RETURN_NAMES = ("flow", "state", "width", "height", "fps", "status", "clip_count")
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 核心"

    @classmethod
    def IS_CHANGED(cls, *args, **kwargs):
        return float("NaN")

    def execute(self, plan, start_index=1, run_name_override="", output_dir="",
                resume_policy="resume", mode="auto", max_shots=0,
                initial_state=None):
        if initial_state is None:
            initialized = EagleH3PlanNode().execute(
                plan,
                run_name_override=run_name_override,
                output_dir=output_dir,
                resume_policy=resume_policy,
                mode=mode,
                max_shots=max_shots,
            )
            initialized_state = (
                initialized["result"][0] if isinstance(initialized, dict) else initialized[0]
            )
            started = EagleH3StartNode().execute(initialized_state, start_index=start_index)
            if isinstance(started, dict):
                state, width, height, fps = started["result"]
            else:
                state, width, height, fps = started
        else:
            state = _clone_state(initial_state)
            original_plan = _validate_plan(plan)
            recursive_plan = state.get("plan") or {}
            if original_plan.get("plan_hash") != recursive_plan.get("plan_hash"):
                raise ValueError("[H3NativeLoop] 递归执行期间导演台计划已变更")
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
                "completed_shots": len(state.get("shots") or []),
                "queue_contract": "single_prompt_dynamic",
                "summary": status,
                "native_loop": True,
            }},
            "result": (
                "eagle_h3_native_loop", state, width, height, fps, status,
                int(state.get("total_shots", 0) or 0),
            ),
        }


class EagleH3CurrentShotNode:
    """🦅 H3 链 · 当前镜头：提取当前分镜参数。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"run_state": (H3_RUN_STATE,)}
        }

    RETURN_TYPES = ("STRING", "INT", "INT", "INT", "INT", "INT", "STRING", "STRING", "BOOLEAN", "STRING")
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
            int(params.get("effective_seed", shot.get("seed", 0)) or 0),
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

    RETURN_TYPES = ("IMAGE", "INT", "BOOLEAN", "STRING")
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

        # auto 模式的下一次递归直接继承上一镜的无损尾帧；交互模式重新
        # Queue 后状态从 manifest 恢复，再走下面的磁盘视频抽帧兜底。
        previous_frames = state.get("previous_frames")
        if torch.is_tensor(previous_frames) and previous_frames.ndim == 4:
            available = int(previous_frames.shape[0])
            if available > 0 and ctx > 0:
                count = min(int(ctx), available)
                frames = previous_frames[-count:].detach().cpu().contiguous().clone()
                return (
                    frames, count, True,
                    f"已承接 {count} 帧运行期上下文（{params['continuation_mode']} 模式）",
                )

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
            "required": {"state": (H3_RUN_STATE,)},
            "optional": {
                "context_frames_override": (
                    "INT", {"default": 0, "min": 0, "max": 500, "step": 1}
                ),
                "seed_image": ("IMAGE",),
            },
        }

    RETURN_TYPES = (
        H3_RUN_STATE, "STRING", "INT", "INT", "INT", "INT", "INT", "STRING",
        "STRING", "BOOLEAN", "IMAGE", "INT", "BOOLEAN", "STRING",
    )
    RETURN_NAMES = (
        "state", "prompt", "seed", "steps", "length", "delivered_frames",
        "blend_frames", "continuation_mode", "shot_id", "is_first", "context_image",
        "context_frames", "has_context", "summary",
    )
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 核心"

    def execute(self, state, context_frames_override=0, seed_image=None):
        state = _clone_state(state)
        shot_values = EagleH3CurrentShotNode().execute(state)
        context_image, context_frames, has_context, context_note = EagleH3ContextNode().execute(
            state,
            prev_clip=None,
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
# 5. Reference conditioning router
# ══════════════════════════════════════════════════════════════════════════════

_REFERENCE_TAG_RE = re.compile(r"<(Picture|Video|Audio)\s+(\d+)>", re.IGNORECASE)
_REFERENCE_TAG_KIND = {"picture": "image", "video": "video", "audio": "audio"}
_REFERENCE_TAG_LABEL = {"image": "Picture", "video": "Video", "audio": "Audio"}
_REFERENCE_SLOT_LIMIT = {"image": 9, "video": 3, "audio": 3}


def _canonical_reference_tag(label, index):
    kind = _REFERENCE_TAG_KIND[str(label).lower()]
    return f"<{_REFERENCE_TAG_LABEL[kind]} {int(index)}>"


def _reference_media_entries(bundle):
    """Pair media_mapping rows with their loaded tensor/audio slots."""
    raw = bundle.get("media_mapping", "[]") if isinstance(bundle, dict) else "[]"
    try:
        mapping = json.loads(raw) if isinstance(raw, str) else list(raw or [])
    except Exception:
        mapping = []
    images = list((bundle or {}).get("ref_images") or [])
    videos = list((bundle or {}).get("video_slots") or [])
    video_audios = list((bundle or {}).get("video_audio_slots") or [])
    audios = list((bundle or {}).get("audio_slots") or [])
    slots = {"image": images, "video": videos, "audio": audios}
    counters = {"image": 0, "video": 0, "audio": 0}
    result = []
    for row in mapping if isinstance(mapping, list) else []:
        if not isinstance(row, dict):
            continue
        kind = str(row.get("type") or "image").lower()
        if kind not in counters:
            continue
        slot = counters[kind]
        counters[kind] += 1
        value = slots[kind][slot] if slot < len(slots[kind]) else None
        paired_audio = (
            video_audios[slot]
            if kind == "video" and slot < len(video_audios)
            else None
        )
        item = dict(row)
        item.update({
            "kind": kind,
            "source_index": slot + 1,
            "source_tag": f"<{_REFERENCE_TAG_LABEL[kind]} {slot + 1}>",
            "value": value,
            "paired_audio": paired_audio,
        })
        result.append(item)
    return result


def _is_usable_reference(kind, value):
    if kind in ("image", "video"):
        return bool(
            torch.is_tensor(value)
            and value.ndim == 4
            and int(value.shape[0]) >= (5 if kind == "video" else 1)
            and int(value.shape[1]) > 1
            and int(value.shape[2]) > 1
            and int(value.shape[-1]) >= 3
        )
    return isinstance(value, dict) and value.get("waveform") is not None


def _limit_reference_short_edge(image, target_short_edge):
    """Downscale an NHWC reference to a configurable short-edge ceiling."""
    if not _is_usable_reference("image", image):
        return image
    target = max(640, min(2048, int(target_short_edge or 768)))
    height, width = int(image.shape[1]), int(image.shape[2])
    short_edge = min(height, width)
    if short_edge <= target:
        return image
    scale = target / float(short_edge)
    out_width = max(32, int(round(width * scale / 32.0)) * 32)
    out_height = max(32, int(round(height * scale / 32.0)) * 32)
    nchw = image.movedim(-1, 1)
    resized = torch.nn.functional.interpolate(
        nchw, size=(out_height, out_width), mode="bilinear", align_corners=False
    )
    return resized.movedim(1, -1)


# MiniMax H3 参考图尺寸档位。界面倍率值以 640px 为基准：
# 1.2 -> 768、1.3 -> 832，依次递增到 3.1 -> 1984。
REF_IMAGE_SIZE_CHOICES = (
    "match",
    *(
        f"{value / 10:.1f} · {value * 64}px"
        for value in range(12, 32)
    ),
    "max",
)
REF_IMAGE_SIZE_SHORT_EDGES = {
    f"{value / 10:.1f}": value * 64
    for value in range(12, 32)
}


def _reference_short_edge(size_mode):
    """Resolve a UI size preset to its short-edge ceiling."""
    mode = str(size_mode or "match").strip().lower()
    if mode == "match":
        return None
    if mode == "max":
        return 2048
    # Safe fallback for workflows saved before the list replaced "custom".
    if mode == "custom":
        return 768
    # New choices expose the real short-edge limit (for example
    # ``1.2 · 768px``), while old workflows still carry the bare ``1.2``.
    numeric_mode = mode.split("·", 1)[0].strip()
    return REF_IMAGE_SIZE_SHORT_EDGES.get(numeric_mode)


def _compact_reference_prompt(prompt, active_tag_map, all_source_tags):
    """Drop inactive definition rows and compact native H3 reference numbers."""
    active_lower = {key.lower(): value for key, value in active_tag_map.items()}
    known_lower = {tag.lower() for tag in all_source_tags}
    lines = []
    for line in str(prompt or "").splitlines():
        matches = list(_REFERENCE_TAG_RE.finditer(line))
        # subject_definitions / retention_analysis rows become invalid if their
        # source is inactive, so remove the whole metadata row instead of leaving
        # an orphaned "is a reference" fragment.
        stripped = line.lstrip()
        if matches and stripped.startswith("<"):
            row_tags = {
                _canonical_reference_tag(match.group(1), match.group(2)).lower()
                for match in matches
            }
            if row_tags and not any(tag in active_lower for tag in row_tags):
                continue

        def replace(match):
            source = _canonical_reference_tag(match.group(1), match.group(2))
            lowered = source.lower()
            if lowered in active_lower:
                return active_lower[lowered]
            if lowered in known_lower:
                return ""
            return match.group(0)

        lines.append(_REFERENCE_TAG_RE.sub(replace, line))
    text = "\n".join(lines)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r" {2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _prepare_reference_condition(run_state, media_bundle, prompt, reference_scope="scene_tags"):
    """Resolve the current scene into concrete official H3 Autogrow bindings."""
    state = run_state if isinstance(run_state, dict) else {}
    plan = state.get("plan") or {}
    shots = plan.get("shots") or []
    if "current_index" in state:
        # Eagle 的运行索引从 0 开始。
        index = int(state.get("current_index", 0) or 0)
        state_contract = "eagle"
    elif "index" in state:
        # MiniMaxH3-Context-Loop 的 Current Shot state 从 1 开始。
        index = max(0, int(state.get("index", 1) or 1) - 1)
        state_contract = "context_loop"
    else:
        index = 0
        state_contract = "plan_only"
    shot = shots[index] if 0 <= index < len(shots) and isinstance(shots[index], dict) else {}
    entries = _reference_media_entries(media_bundle if isinstance(media_bundle, dict) else {})
    all_tags = {entry["source_tag"] for entry in entries}
    disabled = {
        _canonical_reference_tag(match.group(1), match.group(2))
        for token in shot.get("disabled_reference_tags") or []
        for match in _REFERENCE_TAG_RE.finditer(str(token))
    }
    scene_tags = {
        _canonical_reference_tag(match.group(1), match.group(2))
        for token in (shot.get("scene_reference_tags") or [])
        for match in _REFERENCE_TAG_RE.finditer(str(token))
    }
    if not scene_tags:
        scene_text = str(shot.get("scene_prompt") or "")
        scene_tags = {
            _canonical_reference_tag(match.group(1), match.group(2))
            for match in _REFERENCE_TAG_RE.finditer(scene_text)
        }
    use_all = reference_scope == "all" or not scene_tags

    active = []
    skipped = []
    for entry in entries:
        tag = entry["source_tag"]
        if tag in disabled:
            skipped.append({"tag": tag, "reason": "ignored_in_director"})
        elif not use_all and tag not in scene_tags:
            skipped.append({"tag": tag, "reason": "not_used_in_scene"})
        elif not _is_usable_reference(entry["kind"], entry.get("value")):
            skipped.append({"tag": tag, "reason": "missing_or_invalid_media"})
        else:
            active.append(entry)

    grouped = {"image": [], "video": [], "audio": []}
    for entry in active:
        grouped[entry["kind"]].append(entry)
    for kind, limit in _REFERENCE_SLOT_LIMIT.items():
        overflow = grouped[kind][limit:]
        skipped.extend(
            {"tag": entry["source_tag"], "reason": "official_slot_limit"}
            for entry in overflow
        )
        grouped[kind] = grouped[kind][:limit]
    # The public active list must describe only values that will actually be
    # wired into the stock node.  Its order also mirrors Ref2VA presentation.
    active = [entry for kind in ("image", "video", "audio") for entry in grouped[kind]]

    active_tag_map = {}
    for kind in ("image", "video"):
        for target_index, entry in enumerate(grouped[kind], start=1):
            active_tag_map[entry["source_tag"]] = (
                f"<{_REFERENCE_TAG_LABEL[kind]} {target_index}>"
            )
            entry["target_index"] = target_index

    # Stock H3 numbers a reference video's paired soundtrack before standalone
    # audios. Offset standalone <Audio N> tags so director semantics remain exact.
    paired_audio_count = sum(
        1 for entry in grouped["video"]
        if _is_usable_reference("audio", entry.get("paired_audio"))
    )
    for target_index, entry in enumerate(grouped["audio"], start=1):
        native_index = paired_audio_count + target_index
        active_tag_map[entry["source_tag"]] = f"<Audio {native_index}>"
        entry["target_index"] = target_index
        entry["native_audio_index"] = native_index

    compiled = _compact_reference_prompt(prompt, active_tag_map, all_tags)
    public_active = [
        {
            "type": entry["kind"],
            "source": entry["source_tag"],
            "native": active_tag_map.get(entry["source_tag"], entry["source_tag"]),
            "name": entry.get("name") or entry.get("filename") or "",
            "role": entry.get("role") or "",
            "purpose": entry.get("purpose") or "",
            "retention": entry.get("retention") or "",
            "paired_audio": bool(
                entry["kind"] == "video"
                and _is_usable_reference("audio", entry.get("paired_audio"))
            ),
        }
        for entry in active
    ]
    report = {
        "scene_index": index + 1,
        "state_contract": state_contract,
        "scope": "all" if use_all else "scene_tags",
        "active": public_active,
        "skipped": skipped,
        "paired_audio_count": paired_audio_count,
    }
    return compiled, grouped, report


class EagleH3ReferenceConditionNode:
    """Director media bundle -> stock MiniMax H3 Ref2VA + optional context guide."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "clip": ("CLIP",),
                "vae": ("VAE",),
                "audio_vae": ("VAE",),
                "media_bundle": (H3_MEDIA_BUNDLE_TYPE,),
                "state": (f"{H3_RUN_STATE},H3_CHAIN_STATE", {
                    "tooltip": (
                        "接受 Eagle 循环的 EAGLE_H3_STATE，或第三方 Context Loop Current Shot "
                        "的 H3_CHAIN_STATE；这里只读取 plan 与当前镜头索引，不转换递归状态。"
                    ),
                }),
                "prompt": ("STRING", {
                    "multiline": True,
                    "dynamicPrompts": True,
                    "forceInput": True,
                    "tooltip": "必须连接“镜头与上下文.prompt”，逐镜读取当前场景提示词。",
                }),
                "width": ("INT", {
                    "default": 960, "min": 32, "max": 4096, "step": 32,
                    "forceInput": True,
                    "tooltip": "必须连接“循环开始.width”，保持整条 H3 链的画布一致。",
                }),
                "height": ("INT", {
                    "default": 544, "min": 32, "max": 4096, "step": 32,
                    "forceInput": True,
                    "tooltip": "必须连接“循环开始.height”，保持整条 H3 链的画布一致。",
                }),
                "length": ("INT", {
                    "default": 124, "min": 5, "max": 3600, "step": 17,
                    "forceInput": True,
                    "tooltip": (
                        "必须连接“镜头与上下文.length”。这是当前镜头的实际生成帧数，"
                        "不能固定为 124。"
                    ),
                }),
                "reference_scope": (["scene_tags", "all"], {"default": "scene_tags"}),
                "ref_image_size": (list(REF_IMAGE_SIZE_CHOICES), {
                    "default": "match",
                    "tooltip": "match 跟随生成画布；倍率后直接显示对应短边像素；max 对应 2048px。只缩小，不放大。",
                }),
                "use_context_guide": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "context_image": ("IMAGE",),
                "has_context": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = ("CONDITIONING", "LATENT", "STRING", "STRING", "STRING", "INT")
    RETURN_NAMES = (
        "positive", "latent", "compiled_prompt", "active_references", "summary",
        "trim_frames",
    )
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台/参考条件"

    def execute(self, clip, vae, audio_vae, media_bundle, state, prompt,
                width, height, length, reference_scope="scene_tags",
                ref_image_size="match", use_context_guide=True,
                context_image=None, has_context=False):
        if GraphBuilder is None:
            raise RuntimeError("H3 参考条件路由需要 ComfyUI GraphBuilder")
        compiled, grouped, report = _prepare_reference_condition(
            state, media_bundle, prompt, reference_scope=reference_scope
        )
        graph = GraphBuilder()
        ref2va = graph.node("MiniMaxH3ReferenceToVideo", "EagleH3Ref2VA")
        target_short_edge = _reference_short_edge(ref_image_size)
        stock_size_mode = "match" if target_short_edge is None else "max"
        for key, value in (
            ("clip", clip), ("vae", vae), ("audio_vae", audio_vae),
            ("prompt", compiled), ("width", int(width)),
            ("height", int(height)), ("length", int(length)),
            ("ref_image_size", stock_size_mode),
        ):
            ref2va.set_input(key, value)
        for offset, entry in enumerate(grouped["image"]):
            image = entry["value"]
            if target_short_edge is not None:
                image = _limit_reference_short_edge(image, target_short_edge)
            ref2va.set_input(f"ref_images.ref_image_{offset}", image)
        for offset, entry in enumerate(grouped["video"]):
            ref2va.set_input(f"ref_videos.ref_video_{offset}", entry["value"])
            if _is_usable_reference("audio", entry.get("paired_audio")):
                ref2va.set_input(
                    f"ref_video_audios.ref_video_audio_{offset}", entry["paired_audio"]
                )
        for offset, entry in enumerate(grouped["audio"]):
            ref2va.set_input(f"ref_audios.ref_audio_{offset}", entry["value"])

        positive = ref2va.out(0)
        latent = ref2va.out(1)
        # The first shot may expose its seed image through context_image, but
        # that single still is not previous-clip motion context.  Treating it
        # as such instantiated MiniMaxH3MotionContext before sampling and also
        # collided with attention packs that patch H3's PackedLayout.
        is_first_shot = int(report.get("scene_index", 1) or 1) <= 1
        seed_context = bool(
            is_first_shot and has_context
            and _is_usable_reference("image", context_image)
        )
        current_index = int(report.get("scene_index", 1) or 1) - 1
        previous_latent, latent_source = _previous_latent_from_state(
            state, current_index
        ) if not is_first_shot else (None, "first_shot")
        compatibility = (state.get("plan") or {}).get("compatibility") or {}
        plan_shots = (state.get("plan") or {}).get("shots") or []
        current_shot = (
            plan_shots[current_index]
            if 0 <= current_index < len(plan_shots)
            and isinstance(plan_shots[current_index], dict)
            else {}
        )
        audio_mode = str(compatibility.get("audio_mode", "generated_audio"))
        generated_audio_context = audio_mode in (
            "generated_audio", "source_plus_timeline"
        )
        audio_context = current_shot.get("audio_context_length")
        if audio_context in (None, ""):
            audio_context = compatibility.get(
                "audio_context_length",
                current_shot.get("context_length", compatibility.get("context_length", 22)),
            )
        audio_context = int(audio_context or 0) if generated_audio_context else 0
        if (
            not is_first_shot and use_context_guide
            and generated_audio_context and audio_context > 0
            and previous_latent is None
        ):
            raise ValueError(
                "H3 续镜缺少上一镜 sampled AV latent；请确认采样器 output 同时连接"
                "分段保存与审片和循环结束节点。旧的无 latent 检查点需要从上一镜重生成。"
            )
        visual_context = bool(
            has_context and _is_usable_reference("image", context_image)
        )
        context_used = bool(
            not is_first_shot and use_context_guide
            and (
                visual_context
                or (generated_audio_context and previous_latent is not None)
            )
        )
        trim_frames = 0
        if context_used:
            try:
                import nodes as comfy_nodes
                motion_class = comfy_nodes.NODE_CLASS_MAPPINGS.get("MiniMaxH3MotionContext")
                motion_schema = motion_class.INPUT_TYPES() if motion_class else {}
            except Exception:
                motion_class = None
                motion_schema = {}
            if motion_class is None:
                raise RuntimeError(
                    "H3 续镜需要 MiniMaxH3MotionContext；请启用 ComfyUI-H3-Motion-Context"
                )
            declared = {
                **(motion_schema.get("required") or {}),
                **(motion_schema.get("optional") or {}),
            }
            motion = graph.node("MiniMaxH3MotionContext", "EagleH3MotionContext")
            motion.set_input("conditioning", positive)
            motion.set_input("vae", vae)
            motion.set_input("latent", latent)
            if visual_context and "context_frames" in declared:
                motion.set_input("context_frames", context_image)
            requested_context = int(
                current_shot.get("context_length", compatibility.get("context_length", 22))
                or compatibility.get("context_length", 22) or 22
            )
            if previous_latent is None and visual_context:
                requested_context = min(requested_context, int(context_image.shape[0]))
            context_spec = declared.get("context_length", ())
            context_choices = context_spec[0] if context_spec else None
            if isinstance(context_choices, (list, tuple)):
                numeric_choices = []
                for choice in context_choices:
                    try:
                        numeric_choices.append((int(choice), choice))
                    except (TypeError, ValueError):
                        pass
                if numeric_choices:
                    context_value = min(
                        numeric_choices, key=lambda pair: abs(pair[0] - requested_context)
                    )[1]
                else:
                    context_value = context_choices[0]
            else:
                context_value = requested_context
            motion.set_input("context_length", context_value)
            for name, value in (
                ("encode_mode", str(compatibility.get("encode_mode", "video"))),
                ("anchor_mode", str(compatibility.get("anchor_mode", "head"))),
                ("crop", str(compatibility.get("crop", "disabled"))),
            ):
                if name in declared:
                    motion.set_input(name, value)
            # 对 generated_audio 链，sampled latent 同时承接原生视频块与
            # 音频块；source_track 不注入上一段音频，继续使用像素尾帧。
            use_latent_context = bool(
                generated_audio_context and previous_latent is not None
                and "context_latent" in declared
            )
            if use_latent_context:
                motion.set_input("context_latent", previous_latent)
            if "audio_context_length" in declared:
                motion.set_input("audio_context_length", audio_context)
            if "audio_mode" in declared:
                motion.set_input("audio_mode", "timeline")
            positive = motion.out(0)
            trim_frames = motion.out(1)
        else:
            use_latent_context = False
        report["context_guide"] = context_used
        report["seed_context"] = seed_context
        report["latent_handoff"] = use_latent_context
        report["latent_source"] = latent_source
        report["ref_image_size"] = ref_image_size
        report["ref_short_edge"] = target_short_edge
        active_json = json.dumps(report, ensure_ascii=False, indent=2)
        summary = (
            f"场景 {report['scene_index']} · 参考 "
            f"{len(grouped['image'])}图/{len(grouped['video'])}视频/"
            f"{len(grouped['audio'])}音频 · "
            f"上下文 Guide={'开' if context_used else '关'}"
            + (
                f" · AV Latent={'运行期' if latent_source == 'runtime' else '检查点'}"
                if use_latent_context else ""
            )
            + (" · 首镜种子图" if seed_context else "")
        )
        return {
            "result": (positive, latent, compiled, active_json, summary, trim_frames),
            "expand": graph.finalize(),
        }


# ══════════════════════════════════════════════════════════════════════════════
# 6. Trim 节点
# ══════════════════════════════════════════════════════════════════════════════

class EagleH3FrameTrimNode:
    """移除续镜重复首帧，并让解码音频与交付帧严格等长。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "trim_frames": (
                    "INT", {"default": 0, "min": 0, "max": 4096, "step": 1}
                ),
            },
            "optional": {
                "audio": ("AUDIO",),
                "fps": ("INT", {"default": 24, "min": 1, "max": 240, "step": 1}),
                "match_tail": ("BOOLEAN", {"default": True}),
                "retain_overlap_frames": (
                    "INT", {"default": 0, "min": 0, "max": 4096, "step": 1}
                ),
                "target_frames": (
                    "INT", {"default": 0, "min": 0, "max": 3592, "step": 1}
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "IMAGE", "INT")
    RETURN_NAMES = ("images", "audio", "images_with_overlap", "overlap_frames")
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 核心"
    DESCRIPTION = (
        "连接“镜头与上下文.context_frames”到 trim_frames；连接当前 VAE 解码帧和音频。"
        "输出交付帧、同步音频及可选的重叠拼接帧；"
        "target_frames 用于去除 17k+5 网格造成的尾部多余帧。"
    )

    def execute(self, images, trim_frames=0, audio=None, fps=24.0,
                match_tail=True, retain_overlap_frames=0, target_frames=0):
        if not torch.is_tensor(images) or images.ndim != 4:
            raise ValueError("[H3FrameTrim] images 必须是 NHWC IMAGE 批次")
        total = int(images.shape[0])
        trim = max(0, int(trim_frames or 0))
        if trim >= total:
            raise ValueError(
                f"[H3FrameTrim] 不能从 {total} 帧中裁掉 {trim} 帧；请检查上下文长度"
            )

        delivered = images[trim:] if trim else images
        target = max(0, int(target_frames or 0))
        if target:
            if int(delivered.shape[0]) < target:
                raise ValueError(
                    f"[H3FrameTrim] 去除 {trim} 帧上下文后仅剩 "
                    f"{int(delivered.shape[0])} 帧，不足以交付目标 {target} 帧"
                )
            delivered = delivered[:target]
        retained = min(trim, max(0, int(retain_overlap_frames or 0)))
        overlap = (
            images[trim - retained:trim + int(delivered.shape[0])]
            if retained else delivered
        )
        synced_audio = self._trim_audio(
            audio, trim, int(delivered.shape[0]), float(fps or 24.0), bool(match_tail)
        )
        return (delivered, synced_audio, overlap, retained)

    @staticmethod
    def _trim_audio(audio, trim_frames, delivered_frames, fps, match_tail):
        if not isinstance(audio, dict) or audio.get("waveform") is None:
            return audio
        waveform = audio["waveform"]
        if not torch.is_tensor(waveform):
            waveform = torch.as_tensor(waveform)
        sample_rate = int(audio.get("sample_rate", 44100) or 44100)
        cut = max(0, int(round(trim_frames / fps * sample_rate)))
        if cut >= int(waveform.shape[-1]):
            raise ValueError("[H3FrameTrim] 音频短于需要裁掉的重复首帧时长")
        result = waveform[..., cut:] if cut else waveform
        if match_tail:
            target = max(1, int(round(delivered_frames / fps * sample_rate)))
            current = int(result.shape[-1])
            if current > target:
                result = result[..., :target]
            elif current < target:
                result = torch.nn.functional.pad(result, (0, target - current))
        output = dict(audio)
        output["waveform"] = result
        output["sample_rate"] = sample_rate
        return output

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
            },
            "optional": {
                "video": ("VIDEO",),
                "images": ("IMAGE",),
                "images_with_overlap": ("IMAGE",),
                "sampled_latent": ("LATENT",),
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

    def execute(self, run_state, video=None, trim_start=0.0, trim_end=0.0,
                audio=None, images=None, images_with_overlap=None,
                sampled_latent=None, prompt=None, extra_pnginfo=None):
        state = _clone_state(run_state)
        params = shot_params(state)
        if params is None:
            return ("", state, "❌ 无当前镜头")

        in_path = _resolve_video_path(video)
        has_images = torch.is_tensor(images) and images.ndim == 4 and int(images.shape[0]) > 0
        if not in_path and not has_images:
            return ("", state, "❌ 需要连接 video 或裁剪后的 images")

        idx = params["index"]
        shot_dir = _shot_dir(state["base_dir"], idx)
        ensure_dir(str(shot_dir))
        revision = _next_revision(state, idx)
        stem = f"clip_r{revision:04d}"
        clip_path = str(shot_dir / f"{stem}.mp4")

        fps = params["fps"]
        delivered = params["shot"].get("delivered_frames", 0)
        overlap_path = ""

        try:
            if has_images:
                frame_array = _tensor_to_np(images)
                if delivered and int(frame_array.shape[0]) != int(delivered):
                    raise ValueError(
                        f"交付帧数不匹配：计划 {delivered}，实际 {frame_array.shape[0]}；"
                        "请先连接 H3 重叠帧裁剪节点"
                    )
                crf = int((state.get("plan", {}).get("compatibility", {}) or {}).get("segment_crf", 18) or 18)
                frames_to_video(frame_array, clip_path, fps=fps, crf=crf)
                if (
                    torch.is_tensor(images_with_overlap)
                    and images_with_overlap.ndim == 4
                    and int(images_with_overlap.shape[0]) > int(images.shape[0])
                ):
                    overlap_path = str(shot_dir / f"{stem}_with_overlap.mp4")
                    frames_to_video(_tensor_to_np(images_with_overlap), overlap_path, fps=fps, crf=crf)
            # 显式首尾裁剪优先；否则按计划 delivered_frames 限长。
            elif trim_end and trim_end > trim_start:
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
                audio_path = str(shot_dir / f"{stem}.wav")
                try:
                    self._save_audio(audio, audio_path)
                    merged_path = str(shot_dir / f"{stem}_with_audio.mp4")
                    merge_audio_video(clip_path, audio_path, merged_path)
                    os.replace(merged_path, clip_path)
                except Exception as e:
                    logger.warning(f"[H3Chain] 合并音频失败: {e}")

            latent_path = ""
            if sampled_latent is not None:
                latent_path = str(shot_dir / f"{stem}.pt")
                # 检查点只保存采样器输出中的 H3 视频/音频双流；这是下一镜
                # 无损承接的输入，不保存噪声、mask 等可能滞留显存的附加项。
                torch.save(_compact_h3_latent(sampled_latent), latent_path)

            effective_shot = params.get("shot") or {}
            prompt_text = str(effective_shot.get("prompt") or "")
            prompt_path = str(shot_dir / f"{stem}.prompt.txt")
            Path(prompt_path).write_text(prompt_text, encoding="utf-8")
            checkpoint_path = str(shot_dir / f"{stem}.json")
            checkpoint_meta = {
                "version": MANIFEST_VERSION,
                "run_name": state.get("run_name"),
                "index": idx,
                "scene_number": idx + 1,
                "revision": revision,
                "clip": clip_path,
                "overlap_clip": overlap_path,
                "latent": latent_path,
                "prompt": prompt_text,
                "prompt_path": prompt_path,
                "prompt_hash": effective_shot.get("prompt_hash", ""),
                "seed": int(params.get("effective_seed", effective_shot.get("seed", 0)) or 0),
                "raw_frames": int(effective_shot.get("raw_frames", effective_shot.get("length", 0)) or 0),
                "delivered_frames": int(delivered or 0),
                "fps": fps,
                "plan_hash": (state.get("plan") or {}).get("plan_hash", ""),
                "created_at": datetime.now().isoformat(),
            }
            Path(checkpoint_path).write_text(
                json.dumps(checkpoint_meta, ensure_ascii=False, indent=2), encoding="utf-8"
            )

            entry = record_shot_result(
                state,
                clip_path=clip_path,
                delivered_frames=delivered,
                decision="pending",
                meta={
                    "fps": fps,
                    "audio": audio is not None,
                    "overlap_clip": overlap_path,
                    "latent": latent_path,
                    "prompt_path": prompt_path,
                    "checkpoint": checkpoint_path,
                    "revision": revision,
                    "seed": int(params.get("effective_seed", params["shot"].get("seed", 0)) or 0),
                },
            )
            save_state(state)
            return (
                native_video(clip_path), state,
                f"✅ 已保存场景 {idx + 1} 版本 r{entry.get('active_revision', revision):04d}: {clip_path}",
            )
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
                "retry_prompt": ("STRING", {"default": "", "multiline": True}),
                "retry_seed": ("INT", {"default": -1, "min": -1, "max": 9223372036854775807}),
                "retry_length": ("INT", {"default": 0, "min": 0, "max": 3592, "step": 1}),
                "resume_scene": ("INT", {"default": 0, "min": 0, "max": 1000, "step": 1}),
                "assemble_partial_on_stop": ("BOOLEAN", {"default": True}),
                "auto_continue_timeout_minutes": (
                    "FLOAT", {"default": 0.0, "min": 0.0, "max": 1440.0, "step": 0.5}
                ),
                "unload_models_while_waiting": ("BOOLEAN", {"default": False}),
            },
            "hidden": {"unique_id": "UNIQUE_ID"}
        }

    RETURN_TYPES = (H3_RUN_STATE, "STRING", "BOOLEAN", "BOOLEAN", "STRING")
    RETURN_NAMES = ("run_state", "decision", "awaiting_review", "approved", "summary")
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle Suite/H3 导演台"
    DEPRECATED = True

    @staticmethod
    def _history(state):
        """Expose persisted takes without sending the whole runtime state to the UI."""
        rows = []
        for item in sorted(
            state.get("shots") or [], key=lambda value: int(value.get("index", 0))
        ):
            clip_path = str(item.get("clip") or "")
            if not clip_path:
                continue
            revisions = item.get("revisions") or []
            if not revisions:
                revisions = [item]
            for revision in revisions:
                revision_clip = str(revision.get("clip") or clip_path)
                if not revision_clip:
                    continue
                rows.append({
                    "index": int(item.get("index", 0)),
                    "shot_id": str(item.get("shot_id") or ""),
                    "revision": int(revision.get("revision", item.get("active_revision", 1)) or 1),
                    "active": int(revision.get("revision", 1) or 1) == int(item.get("active_revision", 1) or 1),
                    "clip_path": revision_clip,
                    "decision": str(revision.get("decision") or item.get("decision") or ""),
                    "seed": str(revision.get("seed", item.get("seed", "")) or ""),
                    "delivered_frames": int(revision.get("delivered_frames", item.get("delivered_frames", 0)) or 0),
                })
        return rows

    @staticmethod
    def _set_active_decision(state, decision):
        if not state.get("shots"):
            return
        item = state["shots"][-1]
        item["decision"] = decision
        active_revision = int(item.get("active_revision", 0) or 0)
        for revision in item.get("revisions") or []:
            if int(revision.get("revision", 0) or 0) == active_revision:
                revision["decision"] = decision

    def _ui_payload(self, state, preview_path, awaiting, approved, decision, summary, mode):
        params = shot_params(state)
        shot = (params or {}).get("shot") or {}
        return {
            "awaiting_review": bool(awaiting),
            "approved": bool(approved),
            "decision": str(decision or ""),
            "summary": summary,
            "mode": mode,
            "run_name": state.get("run_name"),
            "current_index": state.get("current_index", 0),
            "clip_count": int(state.get("total_shots", 0) or 0),
            "preview_clip": preview_path,
            "history": self._history(state),
            "prompt": str(shot.get("prompt") or ""),
            "seed": int((params or {}).get("effective_seed", shot.get("seed", 0)) or 0),
            "length": int(shot.get("raw_frames", shot.get("length", 0)) or 0),
            "can_resume": bool(state.get("shots")),
            "reset_decision": bool(decision),
        }

    async def execute(self, run_state, preview_clip, review_decision="", retry_prompt="",
                      retry_seed=-1, retry_length=0, resume_scene=0,
                      assemble_partial_on_stop=True, auto_continue_timeout_minutes=0.0,
                      unload_models_while_waiting=False, unique_id=None):
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
            # interactive 模式在本次执行内暂停，避免审批时重跑采样链。
            if state.get("shots"):
                self._set_active_decision(state, "reviewing")
            state["awaiting_review"] = True
            save_state(state)
            token, future = open_review(unique_id)
            pending_payload = self._ui_payload(
                state, preview_path, True, False, "", build_summary(state), mode
            )
            pending_payload["token"] = token
            pending_payload["node_id"] = str(unique_id or "")
            if PromptServer is not None and getattr(PromptServer, "instance", None) is not None:
                PromptServer.instance.send_sync("eagle_h3_review_pending", pending_payload)
            if unload_models_while_waiting:
                try:
                    import comfy.model_management as model_management
                    model_management.unload_all_models()
                    model_management.soft_empty_cache()
                except Exception as error:
                    logger.warning(f"[H3Chain] 审片等待时卸载模型失败: {error}")
            try:
                timeout = max(0.0, float(auto_continue_timeout_minutes or 0.0)) * 60.0
                body = await asyncio.wait_for(future, timeout) if timeout else await future
            except asyncio.TimeoutError:
                body = {"decision": "approve"}
            finally:
                close_review(token)
            decision = str(body.get("decision") or "approve").strip().lower()
            retry_prompt = body.get("retry_prompt", retry_prompt)
            retry_seed = body.get("retry_seed", retry_seed)
            retry_length = body.get("retry_length", retry_length)
            resume_scene = body.get("resume_scene", resume_scene)
            assemble_partial_on_stop = body.get(
                "assemble_partial_on_stop", assemble_partial_on_stop
            )

        if decision not in ("approve", "retry", "reroll", "stop", "approve_stop", "resume", "auto"):
            decision = "approve"

        if decision == "auto":
            decision = "approve"

        ui_decision = decision
        if decision == "resume":
            restore_from_scene(state, resume_scene)
            decision = "retry"
        elif decision == "retry":
            apply_shot_overrides(
                state,
                prompt=retry_prompt,
                seed=retry_seed if int(retry_seed) >= 0 else None,
                length=retry_length,
            )
            self._set_active_decision(state, "retry")
        elif decision == "reroll":
            self._set_active_decision(state, "reroll")
        elif decision == "approve_stop":
            self._set_active_decision(state, "approved")
            state["assemble_partial_on_stop"] = bool(assemble_partial_on_stop)
            decision = "stop"
        else:
            self._set_active_decision(state, "approved" if decision == "approve" else decision)

        # 把 decision 写入 state.pending_decision，供 End 读取
        state["pending_decision"] = decision
        state["awaiting_review"] = False
        save_state(state)

        approved = ui_decision in ("approve", "approve_stop")
        summary = build_summary(state)
        return {
            "ui": {
                "h3_review": self._ui_payload(
                    state, preview_path, False, approved, ui_decision, summary, mode
                )
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

    RETURN_TYPES = (H3_RUN_STATE, "BOOLEAN", "INT", "BOOLEAN", "STRING")
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
                "state": (H3_RUN_STATE,),
                "images": ("IMAGE", {
                    "tooltip": (
                        "连接 H3 重叠帧裁剪的 images；接受当前镜头后，尾帧会作为"
                        "下一镜视觉上下文。"
                    ),
                }),
                "sampled_latent": ("LATENT", {
                    "tooltip": (
                        "连接当前 H3 采样器的原始 output_ad / output。视频与音频"
                        "双流 latent 会无损承接到下一镜。"
                    ),
                }),
            },
            "optional": {
                "decision": ("STRING", {"default": ""}),
                "filename": ("STRING", {
                    "default": "",
                    "tooltip": "文件名前缀；自动按 前缀_0001、前缀_0002… 保存，留空使用运行名称。",
                }),
                "format": (["mp4", "mov", "mkv"], {"default": "mp4"}),
                "fps_override": ("INT", {"default": 0, "min": 0, "max": 120, "step": 1}),
                "local_save_path": ("STRING", {
                    "default": "",
                    "tooltip": "最终整片额外复制到此目录；留空则只保存在 ComfyUI/output/h3_eagle_chains。",
                }),
                "eagle_folder": ("STRING", {
                    "default": "",
                    "tooltip": "最终整片导入的 Eagle 文件夹名称、层级路径、ID 或 eagle://folder/ 地址；留空不导入。",
                }),
                "auto_assemble": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "开启时在循环结束后直接合成；关闭时仅输出 manifest，可接独立最终装配节点。",
                }),
            },
            "hidden": {
                "dynprompt": "DYNPROMPT",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = (
        H3_RUN_STATE, "VIDEO", "BOOLEAN", "INT", "STRING", H3_MANIFEST,
        "BOOLEAN", "IMAGE", "LATENT",
    )
    RETURN_NAMES = (
        "state", "video", "done", "next_index", "summary", "manifest",
        "partial", "last_context_frames", "last_context_latent",
    )
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

    @staticmethod
    def _copy_final_to_local(source_path, local_save_path):
        value = str(local_save_path or "").strip()
        if not value:
            return source_path, ""
        target_dir = Path(value).expanduser()
        if not target_dir.is_absolute():
            target_dir = Path(folder_paths.get_output_directory()) / target_dir
        ensure_dir(str(target_dir))
        destination = target_dir / Path(source_path).name
        try:
            if destination.resolve() == Path(source_path).resolve():
                return source_path, f"✅ 本地整片: {destination}"
        except OSError:
            pass
        reserved = False
        try:
            descriptor = os.open(str(destination), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(descriptor)
            reserved = True
        except FileExistsError:
            source_stem = Path(source_path).stem
            numbered = re.match(r"^(.*)_(\d{4})$", source_stem)
            prefix = numbered.group(1) if numbered else source_stem
            start = int(numbered.group(2)) + 1 if numbered else 1
            destination = Path(_reserve_numbered_video_path(
                target_dir, prefix, Path(source_path).suffix.lstrip("."), start=start
            ))
            reserved = True
        try:
            shutil.copy2(source_path, destination)
        except Exception:
            if reserved:
                destination.unlink(missing_ok=True)
            raise
        return str(destination), f"✅ 本地整片: {destination}"

    @staticmethod
    def _import_final_to_eagle(source_path, eagle_folder):
        value = str(eagle_folder or "").strip()
        if not value:
            return ""
        parsed, input_type = eagle_client.parse_folder_input(value)
        if input_type == "eagle_id":
            folder_id, _corrected = eagle_client.resolve_folder_id(parsed)
        elif input_type == "eagle_name":
            folder_id = eagle_client.find_folder_id_by_path(parsed)
        else:
            folder_id = None
        if not folder_id:
            return f"⚠️ Eagle 文件夹不存在或无法解析: {value}"
        response = eagle_client.add_item_from_path(
            source_path,
            folder_id=folder_id,
            name=Path(source_path).stem,
            tags=["H3", "Eagle Suite"],
            annotation="由 Eagle H3 导演台循环结束节点自动合成",
        )
        if response.get("status") == "success":
            return f"✅ 已导入 Eagle: {value}"
        return "⚠️ Eagle 导入失败: " + str(response.get("message") or response)

    def execute(self, flow, state, images, sampled_latent, decision="", filename="", format="mp4",
                fps_override=0, local_save_path="", eagle_folder="", auto_assemble=True,
                dynprompt=None, unique_id=None):
        effective_decision = str(
            decision or state.get("pending_decision") or (
                "approve" if state.get("mode") == "auto" else ""
            )
        ).strip().lower()
        accepted_current = effective_decision not in ("", "retry", "reroll")
        if accepted_current:
            # 这两项只活在当前动态递归状态中。save_state 会从 manifest 副本
            # 剔除张量；交互模式下一次 Queue 则从镜头 .pt 检查点恢复 latent。
            state = _clone_state(state)
            state["previous_frames"] = _context_tail(state, images)
            state["previous_latent"] = _compact_h3_latent(sampled_latent)

        advanced = EagleH3EndNode().execute(state, decision=decision)
        if isinstance(advanced, dict):
            state, done, next_index, loop_again, summary = advanced["result"]
        else:
            state, done, next_index, loop_again, summary = advanced

        # 审片模式每镜一次执行；下一次 Queue 从 manifest 继续。
        if loop_again and state.get("mode") != "auto":
            summary += "\n交互审片模式：已保存当前镜头，请再次执行生成下一镜。"
            return (
                state, None, False, next_index, summary, _portable_state(state), False,
                state.get("previous_frames", _empty_image_tensor()),
                state.get("previous_latent", {"samples": []}),
            )

        if loop_again:
            return self._recurse(flow, state, dynprompt, unique_id)

        partial = bool(state.get("stop") or int(state.get("current_index", 0) or 0) < int(state.get("total_shots", 0) or 0))
        state["manifest_status"] = "partial" if partial else ("complete" if done else "running")
        save_state(state)

        final_video = None
        should_assemble = bool(auto_assemble) and (
            not partial or bool(state.get("assemble_partial_on_stop", True))
        )
        if done and state.get("shots") and should_assemble:
            final_video, assemble_status = EagleH3AssembleNode().execute(
                state, filename=filename, format=format, fps_override=fps_override
            )
            summary += "\n" + assemble_status
            final_path = _resolve_video_path(final_video)
            if final_path and os.path.isfile(final_path):
                export_path = final_path
                try:
                    export_path, local_status = self._copy_final_to_local(
                        final_path, local_save_path
                    )
                    if local_status:
                        summary += "\n" + local_status
                except Exception as error:
                    logger.exception("H3 最终整片本地复制失败")
                    summary += f"\n⚠️ 最终整片本地复制失败: {error}"
                try:
                    eagle_status = self._import_final_to_eagle(export_path, eagle_folder)
                    if eagle_status:
                        summary += "\n" + eagle_status
                except Exception as error:
                    logger.exception("H3 最终整片 Eagle 导入失败")
                    summary += f"\n⚠️ 最终整片 Eagle 导入失败: {error}"
                final_video = native_video(export_path)
        elif done and partial and auto_assemble:
            summary += "\n已停止；按当前设置保留检查点，未自动合成部分成片。"
        elif done and not auto_assemble:
            summary += "\n已输出 manifest，等待独立最终装配节点。"
        result = (
            state, final_video, done, next_index, summary, _portable_state(state), partial,
            state.get("previous_frames", _empty_image_tensor()),
            state.get("previous_latent", {"samples": []}),
        )
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
            decision = str(shot.get("decision") or "approved").lower()
            if decision not in {"approved", "approve", "auto", "approve_stop"}:
                continue
            clip = shot.get("clip")
            if clip and os.path.isfile(clip):
                clip_paths.append(clip)

        if not clip_paths:
            return ("", "❌ 没有有效的分段视频")

        run_name = state.get("run_name", "h3_pipeline")
        out_name = Path(filename.strip() or run_name).stem or "h3_pipeline"
        final_dir = Path(safe_output_path(
            state["base_dir"], "final", ".", create_dirs=True
        ))
        out_path = _reserve_numbered_video_path(final_dir, out_name, format)

        try:
            fps = fps_override or int(state["plan"]["compatibility"].get("fps", 24) or 24)
            concat_videos(clip_paths, out_path, fps=fps)
            return (native_video(out_path), f"✅ 已合成: {out_path} ({len(clip_paths)} 段)")
        except Exception as e:
            Path(out_path).unlink(missing_ok=True)
            return ("", f"❌ 合成失败: {e}")


class EagleH3ManifestAssembleNode:
    """从循环 manifest 独立装配完整或部分成片。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"manifest": (H3_MANIFEST,)},
            "optional": {
                "filename": ("STRING", {"default": ""}),
                "format": (["mp4", "mov", "mkv"], {"default": "mp4"}),
                "fps_override": ("INT", {"default": 0, "min": 0, "max": 120, "step": 1}),
                "local_save_path": ("STRING", {"default": ""}),
                "eagle_folder": ("STRING", {"default": ""}),
            },
        }

    RETURN_TYPES = ("VIDEO", "STRING", "BOOLEAN", "STRING")
    RETURN_NAMES = ("video", "file_path", "partial", "summary")
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle Suite/H3 核心"

    def execute(self, manifest, filename="", format="mp4", fps_override=0,
                local_save_path="", eagle_folder=""):
        state = _clone_state(manifest)
        if not isinstance(state, dict) or not state.get("base_dir"):
            return (None, "", False, "❌ manifest 结构无效")
        partial = str(state.get("manifest_status") or "").lower() == "partial"
        video, summary = EagleH3AssembleNode().execute(
            state, filename=filename, format=format, fps_override=fps_override
        )
        output_path = _resolve_video_path(video) or ""
        if output_path and os.path.isfile(output_path):
            export_path = output_path
            if local_save_path:
                export_path, local_status = EagleH3NativeLoopEndNode._copy_final_to_local(
                    output_path, local_save_path
                )
                if local_status:
                    summary += "\n" + local_status
            if eagle_folder:
                eagle_status = EagleH3NativeLoopEndNode._import_final_to_eagle(
                    export_path, eagle_folder
                )
                if eagle_status:
                    summary += "\n" + eagle_status
            video = native_video(export_path)
            output_path = export_path
        return (video, output_path, partial, summary)


# ══════════════════════════════════════════════════════════════════════════════
# 组合节点：检查点 + 审查门 / 推进 + 合成
# ══════════════════════════════════════════════════════════════════════════════

class EagleH3CheckpointReviewNode:
    """保存当前镜头并完成审片决策，替代原来的两个串联节点。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "state": (H3_RUN_STATE,),
            },
            "optional": {
                "video": ("VIDEO",),
                "images": ("IMAGE",),
                "audio": ("AUDIO",),
                "images_with_overlap": ("IMAGE",),
                "sampled_latent": ("LATENT",),
                "trim_start": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 999999.0, "step": 0.01}),
                "trim_end": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 999999.0, "step": 0.01}),
                "review_decision": ("STRING", {"default": "", "multiline": False}),
                "retry_prompt": ("STRING", {"default": "", "multiline": True}),
                "retry_seed": ("INT", {"default": -1, "min": -1, "max": 9223372036854775807}),
                "retry_length": ("INT", {"default": 0, "min": 0, "max": 3592, "step": 1}),
                "resume_scene": ("INT", {"default": 0, "min": 0, "max": 1000, "step": 1}),
                "assemble_partial_on_stop": ("BOOLEAN", {"default": True}),
                "auto_continue_timeout_minutes": (
                    "FLOAT", {"default": 0.0, "min": 0.0, "max": 1440.0, "step": 0.5}
                ),
                "unload_models_while_waiting": ("BOOLEAN", {"default": False}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = (
        "VIDEO", H3_RUN_STATE, "STRING", "BOOLEAN", "BOOLEAN", "STRING", "STRING",
        H3_SEGMENT, H3_MANIFEST,
    )
    RETURN_NAMES = (
        "clip", "state", "decision", "awaiting_review", "approved",
        "clip_path", "summary", "segment", "manifest",
    )
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle Suite/H3 核心"

    async def execute(self, state, video=None, images=None, audio=None,
                      images_with_overlap=None, sampled_latent=None,
                      trim_start=0.0, trim_end=0.0, review_decision="",
                      retry_prompt="", retry_seed=-1, retry_length=0, resume_scene=0,
                      assemble_partial_on_stop=True, auto_continue_timeout_minutes=0.0,
                      unload_models_while_waiting=False,
                      unique_id=None, prompt=None, extra_pnginfo=None):
        checkpoint_state = _clone_state(state)
        current_index = int(checkpoint_state.get("current_index", 0) or 0)
        existing = next(
            (
                item for item in checkpoint_state.get("shots", [])
                if int(item.get("index", -1)) == current_index
                and item.get("clip") and os.path.isfile(str(item.get("clip")))
                and str(item.get("decision") or "") in {"pending", "reviewing"}
            ),
            None,
        )
        # A review-button click queues the graph again. Reuse the already saved take;
        # otherwise merely approving it would create a duplicate revision.
        if review_decision and existing is not None:
            clip = native_video(existing["clip"])
            checkpoint_status = f"✅ 复用待审版本 r{int(existing.get('active_revision', 1) or 1):04d}"
        else:
            clip, checkpoint_state, checkpoint_status = EagleH3SegmentCheckpointNode().execute(
                checkpoint_state,
                video=video,
                images=images,
                images_with_overlap=images_with_overlap,
                sampled_latent=sampled_latent,
                trim_start=trim_start,
                trim_end=trim_end,
                audio=audio,
                prompt=prompt,
                extra_pnginfo=extra_pnginfo,
            )
        clip_path = _resolve_video_path(clip) or ""
        if not clip_path:
            return (
                None, checkpoint_state, "error", False, False, "", checkpoint_status,
                {}, _portable_state(checkpoint_state),
            )

        review = await EagleH3ReviewGateNode().execute(
            checkpoint_state,
            clip,
            review_decision=review_decision,
            retry_prompt=retry_prompt,
            retry_seed=retry_seed,
            retry_length=retry_length,
            resume_scene=resume_scene,
            assemble_partial_on_stop=assemble_partial_on_stop,
            auto_continue_timeout_minutes=auto_continue_timeout_minutes,
            unload_models_while_waiting=unload_models_while_waiting,
            unique_id=unique_id,
        )
        if isinstance(review, dict):
            result = review.get("result", ())
            state, decision, awaiting, approved, summary = result
            payload = dict(review)
            active_segment = next(
                (item for item in state.get("shots", []) if item.get("clip") == clip_path), {}
            )
            payload["result"] = (
                clip, state, decision, awaiting, approved, clip_path, summary,
                _clone_state(active_segment), _portable_state(state),
            )
            return payload
        state, decision, awaiting, approved, summary = review
        active_segment = next(
            (item for item in state.get("shots", []) if item.get("clip") == clip_path), {}
        )
        return (
            clip, state, decision, awaiting, approved, clip_path, summary,
            _clone_state(active_segment), _portable_state(state),
        )


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

    RETURN_TYPES = (H3_RUN_STATE, "VIDEO", "BOOLEAN", "INT", "BOOLEAN", "STRING")
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
                "state": (H3_RUN_STATE,),
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

    def execute(self, state, frames, export_name="frames", first_frame_number=1, png_compression=3):
        state = _clone_state(state)
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
                "state": (H3_RUN_STATE,),
                "prev_clip": ("VIDEO",),
                "cur_clip": ("VIDEO",),
                "blend_frames": ("INT", {"default": 5, "min": 1, "max": 100, "step": 1}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "INT")
    RETURN_NAMES = ("seam_preview", "report", "recommended_offset")
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 工具"

    def execute(self, state, prev_clip, cur_clip, blend_frames=5):
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
    "EagleH3PlanInteropNode": EagleH3PlanInteropNode,
    "EagleH3StateInteropNode": EagleH3StateInteropNode,
    "EagleH3LoadManifestNode": EagleH3LoadManifestNode,
    "EagleH3NativeLoopStartNode": EagleH3NativeLoopStartNode,
    "EagleH3ShotContextNode": EagleH3ShotContextNode,
    "EagleH3ReferenceConditionNode": EagleH3ReferenceConditionNode,
    "EagleH3FrameTrimNode": EagleH3FrameTrimNode,
    "EagleH3CheckpointReviewNode": EagleH3CheckpointReviewNode,
    "EagleH3NativeLoopEndNode": EagleH3NativeLoopEndNode,
    "EagleH3ManifestAssembleNode": EagleH3ManifestAssembleNode,
    "EagleH3ExportPNGSequenceNode": EagleH3ExportPNGSequenceNode,
    "EagleH3SeamProbeNode": EagleH3SeamProbeNode,
    "EagleH3SmartSplitNode": EagleH3SmartSplitNode,
}

NODE_DISPLAY_NAME_MAPPINGS_H3PIPELINE = {
    "EagleH3PlanInteropNode": "🦅 H3 互操作 · 计划 JSON 桥",
    "EagleH3StateInteropNode": "🦅 H3 互操作 · 状态与上一片段",
    "EagleH3LoadManifestNode": "🦅 H3 · 恢复运行清单",
    "EagleH3NativeLoopStartNode": "🦅 H3 · 循环开始",
    "EagleH3ShotContextNode": "🦅 H3 · 镜头与上下文",
    "EagleH3ReferenceConditionNode": "🦅 H3 · 参考条件路由",
    "EagleH3FrameTrimNode": "🦅 H3 · 重叠帧与音频裁剪",
    "EagleH3CheckpointReviewNode": "🦅 H3 · 分段保存与审片",
    "EagleH3NativeLoopEndNode": "🦅 H3 · 循环结束与合成",
    "EagleH3ManifestAssembleNode": "🦅 H3 · 最终装配（Manifest）",
    "EagleH3ExportPNGSequenceNode": "🦅 H3 工具 · 导出 PNG 序列",
    "EagleH3SeamProbeNode": "🦅 H3 工具 · 接缝分析",
    "EagleH3SmartSplitNode": "🦅 H3 工具 · 智能分镜",
}

__all__ = [
    "EagleH3PlanNode",
    "EagleH3PlanInteropNode",
    "EagleH3PreflightNode",
    "EagleH3LoadManifestNode",
    "EagleH3StateInteropNode",
    "EagleH3StartNode",
    "EagleH3NativeLoopStartNode",
    "EagleH3CurrentShotNode",
    "EagleH3ContextNode",
    "EagleH3ShotContextNode",
    "EagleH3ReferenceConditionNode",
    "EagleH3FrameTrimNode",
    "EagleH3TrimNode",
    "EagleH3SegmentCheckpointNode",
    "EagleH3ReviewGateNode",
    "EagleH3EndNode",
    "EagleH3NativeLoopEndNode",
    "EagleH3ManifestAssembleNode",
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
