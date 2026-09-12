# -*- coding: utf-8 -*-
"""
H3 循环链路的运行期状态管理：manifest 的初始化、加载、推进、保存。
"""

import json
import hashlib
import os
import re
import secrets
import time
from datetime import datetime
from pathlib import Path

from ..utils import ensure_dir, is_safe_path, generate_unique_filename
from ..h3_director_node import H3_PLAN_TYPE
from ..logger import logger

from .constants import MANIFEST_VERSION, RESUME_POLICIES


_RUNTIME_STATE_KEYS = frozenset(("previous_frames", "previous_latent"))


def _safe_run_name(name):
    """把任意字符串处理成适合目录名的 run_name。"""
    name = str(name or "").strip()
    if not name:
        return generate_unique_filename("eagle_h3_pipeline", "").rsplit(".", 1)[0]
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", name)
    name = name.strip(" .")
    return name or "eagle_h3_pipeline"


def _manifest_path(base_dir):
    return Path(base_dir) / "manifest.json"


def _validate_plan(plan):
    """校验传入的是合法的 H3_CHAIN_PLAN dict。"""
    if not isinstance(plan, dict):
        raise ValueError("plan 必须是 dict")
    if plan.get("version") not in (1, 2):
        raise ValueError(f"不支持的 plan 版本: {plan.get('version')}")
    shots = plan.get("shots")
    if not isinstance(shots, list) or not shots:
        raise ValueError("plan.shots 必须是非空列表")
    compatibility = plan.get("compatibility") or {}
    if not isinstance(compatibility, dict):
        raise ValueError("plan.compatibility 必须是 dict")
    return plan


_SHOT_RESUME_KEYS = (
    "id", "prompt_hash", "seed", "steps", "raw_frames", "delivered_frames",
    "context_length", "continuation_mode", "audio_context_length",
)


def _first_changed_shot(old_plan, new_plan):
    """Return the earliest checkpoint index invalidated by a plan change."""
    old_plan = old_plan if isinstance(old_plan, dict) else {}
    new_plan = new_plan if isinstance(new_plan, dict) else {}
    if old_plan.get("compatibility") != new_plan.get("compatibility"):
        return 0
    if old_plan.get("reference_media") != new_plan.get("reference_media"):
        return 0
    old_shots = old_plan.get("shots") or []
    new_shots = new_plan.get("shots") or []
    shared = min(len(old_shots), len(new_shots))
    for index in range(shared):
        old = old_shots[index] if isinstance(old_shots[index], dict) else {}
        new = new_shots[index] if isinstance(new_shots[index], dict) else {}
        if any(old.get(key) != new.get(key) for key in _SHOT_RESUME_KEYS):
            return index
    if len(old_shots) != len(new_shots):
        return shared
    return None


def _default_state(plan, base_dir, mode="auto", max_shots=0):
    """从 plan 构建初始运行状态。"""
    total = len(plan["shots"])
    if max_shots and max_shots < total:
        total = max_shots
    return {
        "version": MANIFEST_VERSION,
        "run_name": plan.get("run_name", "eagle_h3_pipeline"),
        "base_dir": str(base_dir),
        "mode": mode if mode in ("auto", "interactive") else "auto",
        "current_index": 0,
        "reroll_index": None,
        "stop": False,
        "total_shots": total,
        "plan": plan,
        "shots": [],
        "shot_overrides": {},
        "seed_overrides": {},
        "checkpoint_history": [],
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }


def init_state(plan, output_root, run_name_override="", resume_policy="resume", mode="auto", max_shots=0):
    """
    根据 plan 初始化或恢复一个运行状态。
    - output_root: 默认 ComfyUI output 目录。
    - resume_policy: fail / overwrite / resume。
    - run_name: 优先用 run_name_override，否则 plan.run_name，否则自动生成。
    """
    plan = _validate_plan(plan)

    run_name = _safe_run_name(run_name_override or plan.get("run_name"))
    base_dir = Path(output_root) / "h3_eagle_chains" / run_name
    base_dir.mkdir(parents=True, exist_ok=True)

    # 路径安全：确保 base_dir 仍在 output_root 下
    if not is_safe_path(str(base_dir)):
        # is_safe_path 默认以当前工作目录为基准，对 output 目录可能过严；
        # 这里额外做 realpath 兜底。
        real_root = Path(output_root).resolve()
        real_base = base_dir.resolve()
        if real_root not in [real_base, *real_base.parents]:
            raise ValueError(f"非法输出路径: {base_dir}")

    manifest_file = _manifest_path(base_dir)

    if manifest_file.exists():
        if resume_policy == "fail":
            raise FileExistsError(f"manifest 已存在: {manifest_file}，请调整 run_name")
        if resume_policy == "overwrite":
            logger.info(f"[H3Chain] 覆盖已有运行: {run_name}")
            state = _default_state(plan, base_dir, mode=mode, max_shots=max_shots)
            save_state(state)
            return state
        # resume：加载已有状态，但 plan 可能被更新，这里合并 plan
        old = load_state(base_dir)
        # 如果 plan_hash 不同，用户可能修改了导演台后重新排队；允许替换 plan
        old_plan = old.get("plan") or {}
        new_hash = plan.get("plan_hash")
        old_hash = old_plan.get("plan_hash")
        if new_hash and old_hash and new_hash != old_hash:
            invalid_from = _first_changed_shot(old_plan, plan)
            logger.info(
                f"[H3Chain] plan 已变更 ({old_hash[:8]} -> {new_hash[:8]})，"
                f"从场景 {(invalid_from or 0) + 1} 起失效旧检查点"
            )
            old["plan"] = plan
            old["total_shots"] = min(len(plan["shots"]), max_shots or len(plan["shots"]))
            if invalid_from is not None:
                old["shots"] = [
                    item for item in old.get("shots", [])
                    if int(item.get("index", -1)) < invalid_from
                ]
                old["current_index"] = min(int(old.get("current_index", 0)), invalid_from)
                old["reroll_index"] = None
                old["stop"] = False
                old.pop("pending_decision", None)
                for key in ("shot_overrides", "seed_overrides"):
                    old[key] = {
                        str(index): value
                        for index, value in (old.get(key) or {}).items()
                        if int(index) < invalid_from
                    }
                old["invalidated_from"] = invalid_from
        if max_shots and max_shots < old["total_shots"]:
            old["total_shots"] = max_shots
        old["mode"] = mode if mode in ("auto", "interactive") else old.get("mode", "auto")
        old["updated_at"] = datetime.now().isoformat()
        save_state(old)
        return old

    state = _default_state(plan, base_dir, mode=mode, max_shots=max_shots)
    save_state(state)
    return state


def load_state(base_dir):
    """从 manifest.json 加载状态。"""
    path = _manifest_path(base_dir)
    if not path.exists():
        raise FileNotFoundError(f"manifest 不存在: {path}")
    with open(path, "r", encoding="utf-8") as f:
        state = json.load(f)
    if not isinstance(state, dict):
        raise ValueError("manifest 不是有效的 JSON 对象")
    # 兼容：补齐缺失字段
    state.setdefault("version", MANIFEST_VERSION)
    state.setdefault("current_index", 0)
    state.setdefault("reroll_index", None)
    state.setdefault("stop", False)
    state.setdefault("shots", [])
    state.setdefault("shot_overrides", {})
    state.setdefault("seed_overrides", {})
    state.setdefault("checkpoint_history", [])
    state.setdefault("mode", "auto")
    return state


def save_state(state):
    """原子写 manifest.json，不把动态循环张量塞进 JSON 清单。"""
    path = _manifest_path(state["base_dir"])
    tmp = path.with_suffix(f".tmp.{os.getpid()}.{int(time.time()*1000)}")
    state["updated_at"] = datetime.now().isoformat()
    persisted = {
        key: value for key, value in state.items()
        if key not in _RUNTIME_STATE_KEYS
    }
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(persisted, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    return path


def shot_params(state):
    """获取当前镜头的 plan 参数。"""
    plan = state.get("plan") or {}
    shots = plan.get("shots") or []
    idx = state.get("current_index", 0)
    if not (0 <= idx < len(shots)):
        return None
    shot = dict(shots[idx])
    overrides = state.get("shot_overrides") or {}
    shot_override = overrides.get(str(idx), overrides.get(idx, {}))
    if isinstance(shot_override, dict):
        shot.update(shot_override)
    seed_overrides = state.get("seed_overrides") or {}
    effective_seed = seed_overrides.get(str(idx), seed_overrides.get(idx, shot.get("seed", 0)))
    compat = plan.get("compatibility") or {}
    anchor = compat.get("anchor_mode", "head")
    global_blend = int(compat.get("video_blend_frames", 0) or 0) if anchor == "head" else 0
    return {
        "index": idx,
        "total": state.get("total_shots", len(shots)),
        "shot": shot,
        "effective_seed": int(effective_seed or 0),
        "compatibility": compat,
        "blend_frames": shot.get("blend_frames", global_blend),
        "context_length": shot.get("context_length") or compat.get("context_length", 0),
        "continuation_mode": shot.get("continuation_mode") or compat.get("continuation_mode", "guide"),
        "fps": int(compat.get("fps", 24) or 24),
        "width": int(compat.get("width", 1080) or 1080),
        "height": int(compat.get("height", 1920) or 1920),
    }


def _valid_h3_length(value):
    value = int(value or 0)
    return 5 <= value <= 3592 and value % 17 == 5


def apply_shot_overrides(state, prompt="", seed=None, length=0):
    """Apply review-time overrides without mutating the Director plan snapshot."""
    idx = int(state.get("current_index", 0) or 0)
    params = shot_params(state)
    if params is None:
        raise ValueError("无当前镜头，无法应用重试参数")

    overrides = state.setdefault("shot_overrides", {})
    current = dict(overrides.get(str(idx), overrides.get(idx, {})) or {})
    prompt = str(prompt or "").strip()
    if prompt:
        current["prompt"] = prompt
        current["prompt_hash"] = hashlib.sha256(prompt.encode("utf-8")).hexdigest()

    if length:
        length = int(length)
        if not _valid_h3_length(length):
            raise ValueError(
                f"H3 length={length} 无效；必须位于 5..3592 且满足 17k+5（length % 17 == 5）"
            )
        context = int(params.get("context_length", 0) or 0) if idx > 0 else 0
        current["raw_frames"] = length
        current["length"] = length
        current["delivered_frames"] = max(1, length - context)
        current["duration_seconds"] = round(length / float(params.get("fps", 24) or 24), 6)

    if current:
        overrides[str(idx)] = current

    if seed is not None and int(seed) >= 0:
        state.setdefault("seed_overrides", {})[str(idx)] = int(seed)
    return state


def restore_from_scene(state, scene_number):
    """Resume by regenerating the requested one-based scene, preserving older approvals."""
    total = int(state.get("total_shots", 0) or 0)
    scene_number = int(scene_number or 0)
    if not 1 <= scene_number <= total:
        raise ValueError(f"恢复场景必须介于 1..{total}")
    index = scene_number - 1
    state["shots"] = [
        item for item in state.get("shots", [])
        if int(item.get("index", -1)) < index
    ]
    state["current_index"] = index
    state["reroll_index"] = index
    state["stop"] = False
    state.pop("pending_decision", None)
    state["restored_from_scene"] = scene_number
    return state


def advance(state, decision=None):
    """
    推进运行状态。
    decision: None / "approve" / "retry" / "reroll" / "stop"。
    返回 (state, loop_again, done)。
    """
    state["reroll_index"] = None

    if decision == "stop":
        state["stop"] = True
        return state, False, True

    if decision in ("retry", "reroll"):
        # 保持 current_index 不变，重跑当前镜头
        state["reroll_index"] = state["current_index"]
        if decision == "reroll":
            overrides = state.setdefault("seed_overrides", {})
            overrides[str(state["current_index"])] = secrets.randbits(63)
        return state, True, False

    # 正常前进
    state["current_index"] += 1
    if state["current_index"] >= state["total_shots"]:
        return state, False, True
    return state, True, False


def record_shot_result(state, clip_path, delivered_frames=0, decision="approved", meta=None):
    """在 SegmentCheckpoint 后记录单镜结果。"""
    idx = state.get("current_index", 0)
    previous = next(
        (item for item in state.get("shots", []) if int(item.get("index", -1)) == idx),
        None,
    )
    revisions = list((previous or {}).get("revisions") or [])
    if previous and not revisions and previous.get("clip"):
        revisions.append({
            "revision": int(previous.get("active_revision", 1) or 1),
            "clip": str(previous.get("clip")),
            "delivered_frames": int(previous.get("delivered_frames", 0) or 0),
            "decision": str(previous.get("decision") or "approved"),
            "timestamp": str(previous.get("timestamp") or datetime.now().isoformat()),
            "seed": int(previous.get("seed", 0) or 0),
        })
    next_revision = max([int(item.get("revision", 0) or 0) for item in revisions] + [0]) + 1
    revision_number = int((meta or {}).get("revision", next_revision) or next_revision)
    revision = {
        "revision": revision_number,
        "clip": str(clip_path),
        "delivered_frames": int(delivered_frames),
        "decision": decision,
        "timestamp": datetime.now().isoformat(),
    }
    entry = {
        "index": idx,
        "clip": str(clip_path),
        "delivered_frames": int(delivered_frames),
        "decision": decision,
        "timestamp": datetime.now().isoformat(),
        "active_revision": revision_number,
    }
    params = shot_params(state)
    if params and isinstance(params.get("shot"), dict):
        shot = params["shot"]
        entry["shot_id"] = shot.get("id", "")
        entry["prompt_hash"] = shot.get("prompt_hash", "")
        entry["generation_fingerprint"] = (
            params.get("compatibility", {}).get("generation_fingerprint", "")
        )
        entry["seed"] = int(params.get("effective_seed", shot.get("seed", 0)) or 0)
    if isinstance(meta, dict):
        entry.update(meta)
        revision.update(meta)
    revisions.append(revision)
    entry["revisions"] = revisions
    state.setdefault("checkpoint_history", []).append({
        "index": idx,
        "revision": revision_number,
        "clip": str(clip_path),
        "timestamp": revision["timestamp"],
    })
    # 去重：按 index 替换
    state["shots"] = [s for s in state["shots"] if s.get("index") != idx]
    state["shots"].append(entry)
    state["shots"].sort(key=lambda s: s["index"])
    return entry


def build_summary(state):
    """生成人类可读的 summary。"""
    total = state.get("total_shots", 0)
    idx = state.get("current_index", 0)
    done = state.get("stop") or idx >= total
    shots = state.get("shots", [])
    return (
        f"run={state.get('run_name')} | "
        f"mode={state.get('mode')} | "
        f"index={idx+1}/{total} | "
        f"completed={len(shots)} | "
        f"done={'是' if done else '否'}"
    )


__all__ = [
    "init_state",
    "load_state",
    "save_state",
    "shot_params",
    "advance",
    "record_shot_result",
    "apply_shot_overrides",
    "restore_from_scene",
    "build_summary",
]
