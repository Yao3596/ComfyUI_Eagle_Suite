# -*- coding: utf-8 -*-
"""
Eagle H3 导演台节点（后端）

职责：
  - 解析前端写入的 h3_state JSON（世界构建基础 + 全局参数 + 场景/镜头/台词/参考）
  - 编译成 ethanfel MiniMax H3 Contex Loop 兼容的 plan 对象（H3_CHAIN_PLAN 类型）
  - 直接替代 MiniMax H3 Contex Loop Plan + Scene Prompt Editor 两个节点
  - 输出 plan（H3_CHAIN_PLAN）/ REF_IMAGES（参考图）/ width / height / clip_count /
    video_blend_frames / summary

前端：web/js/h3_director.js
路由：upload_ref（参考图上传）/ ref_proxy（缩略图预览），经 route_registry 延迟注册
"""

import os
import re
import json
import time
import math
import hashlib
import uuid
import random
from pathlib import Path

from aiohttp import web
from PIL import Image
import folder_paths

from .route_registry import route
from .logger import logger

try:
    from .api_config_manager import decode_api_key
except Exception:
    try:
        from .utils import decode_api_key
    except Exception:
        decode_api_key = None

NODE_DIR = os.path.dirname(os.path.abspath(__file__))
# 参考图保存目录：插件根 / input / h3_refs
REF_DIR = os.path.abspath(os.path.join(NODE_DIR, "..", "input", "h3_refs"))
try:
    os.makedirs(REF_DIR, exist_ok=True)
except Exception:
    pass


def _comfy_input_root():
    return Path(folder_paths.get_input_directory()).resolve()


def _director_media_dir():
    path = _comfy_input_root() / "h3_director"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_input_path(relative_name):
    """Resolve a ComfyUI/input relative path without permitting traversal."""
    value = str(relative_name or "").replace("\\", "/").lstrip("/")
    if not value or "\x00" in value:
        return None
    root = _comfy_input_root()
    try:
        candidate = (root / value).resolve()
        if root not in (candidate, *candidate.parents):
            return None
        return candidate
    except (OSError, RuntimeError, ValueError):
        return None

_KIND_NOUN = {
    "person": "a character",
    "prop": "a prop",
    "style": "an art style",
    "environment": "an environment",
    "composition": "a composition",
}

_LEGACY_KIND_ROLE = {
    "person": "subject_person",
    "prop": "subject_prop",
    "style": "style_reference",
    "environment": "scene_reference",
    "composition": "composition_reference",
    "reference": "motion_reference",
}

_MEDIA_ROLE_DESCRIPTIONS = {
    "subject_person": "a person or character identity reference",
    "subject_animal": "an animal or creature identity reference",
    "subject_prop": "an object, costume, or prop identity reference",
    "scene_reference": "a scene or environment reference",
    "style_reference": "a visual style reference",
    "action_reference": "an action or pose reference",
    "expression_reference": "an expression reference",
    "composition_reference": "a composition or storyboard reference",
    "first_frame": "the required first-frame anchor",
    "last_frame": "the required last-frame anchor",
    "keyframe": "a keyframe anchor",
    "storyboard": "a storyboard or composition anchor",
    "subject_reference": "a subject appearance reference",
    "motion_reference": "a motion reference",
    "camera_reference": "a camera-movement reference",
    "rhythm_reference": "an editing rhythm and timing reference",
    "edit_source": "a source clip to edit",
    "continuation_source": "a source clip to continue",
    "voice_timbre": "a speaker voice-timbre reference",
    "music_style": "a music style reference",
    "dialogue_content": "dialogue content to reuse",
    "sound_effect": "a sound-effect reference",
    "full_track": "an audio track to reuse",
}

_SUBJECT_ROLES = {
    "subject_person", "subject_animal", "subject_prop", "subject_reference",
}

_VISIBLE_RETENTION = {
    "fully_preserved", "partially_preserved", "attribute_transfer", "weak_reference",
}
_AUDIO_RETENTION = {"fully_copy", "partially_copy", "reference", "weak_reference"}


def _default_media_role(media_type, legacy_kind=""):
    media_type = str(media_type or "image").lower()
    if media_type == "video":
        return "motion_reference"
    if media_type == "audio":
        return "voice_timbre"
    return _LEGACY_KIND_ROLE.get(str(legacy_kind or "person"), "subject_person")


def _normalize_media_item(item, index=0):
    """Normalize the Director media contract without coupling roles to socket types."""
    source = dict(item or {})
    media_type = str(source.get("type") or "image").lower()
    if media_type not in _MEDIA_TAG_NAMES:
        media_type = "image"
    legacy_kind = str(source.get("kind") or ("person" if media_type == "image" else "reference"))
    role = str(source.get("role") or _default_media_role(media_type, legacy_kind)).strip()
    if role not in _MEDIA_ROLE_DESCRIPTIONS:
        role = _default_media_role(media_type, legacy_kind)
    retention = str(source.get("retention") or "").strip()
    allowed_retention = _AUDIO_RETENTION if media_type == "audio" else _VISIBLE_RETENTION
    if retention == "style_only":
        retention = "attribute_transfer"
    if retention not in allowed_retention:
        retention = "reference" if media_type == "audio" else "fully_preserved"
    source.update({
        "id": source.get("id") or f"media-{index + 1}",
        "type": media_type,
        "kind": legacy_kind,
        "role": role,
        "purpose": str(source.get("purpose") or "").strip(),
        "retention": retention,
        "useEmbeddedAudio": bool(source.get("useEmbeddedAudio", False)) if media_type == "video" else False,
        "speakerId": str(source.get("speakerId") or "").strip(),
    })
    return source


# ────────────────────────────────────────────────────────────────────────────
# ethanfel H3 Contex Loop 兼容常量和工具
# ────────────────────────────────────────────────────────────────────────────

H3_FPS = 24
H3_MAX_SEED = 0xFFFFFFFFFFFFFFFF
H3_MAX_FRAMES = 3592
H3_CONTEXT_LENGTHS = (1, 5, 22, 39, 56, 73, 90, 107, 124,
                      141, 158, 175, 192, 209, 226, 243)
H3_AUDIO_MODES = ("source_track", "generated_audio", "source_plus_timeline")
H3_CONTINUATION_MODES = ("guide", "masked_av")
H3_PLAN_VERSION = 2
H3_PLAN_TYPE = "H3_CHAIN_PLAN"
H3_MEDIA_BUNDLE_TYPE = "H3_MEDIA_BUNDLE"


def _h3_frame_length(seconds):
    """Round a duration up to H3's valid 17k+5 frame grid."""
    seconds = float(seconds)
    if not math.isfinite(seconds) or seconds <= 0:
        raise ValueError("H3 shot duration must be a finite positive number.")
    requested = max(5, int(math.ceil(seconds * H3_FPS - 1e-9)))
    return _h3_frame_length_for_frames(requested)


def _h3_frame_length_for_frames(requested):
    """Round a requested frame count up to H3's legal ``17k+5`` grid."""
    requested = max(5, int(requested or 5))
    length = requested + (5 - requested % 17) % 17
    if length > H3_MAX_FRAMES:
        raise ValueError(
            f"H3 requested frame count {requested} rounds to {length} frames; "
            f"the largest valid 17k+5 length is {H3_MAX_FRAMES} frames."
        )
    return length


def _derived_seed(base_seed, index, shot_id):
    """Derive a stable uint64 seed from base_seed + index + shot_id."""
    payload = "%d:%d:%s" % (int(base_seed), int(index), str(shot_id))
    return int.from_bytes(hashlib.sha256(payload.encode("utf-8")).digest()[:8], "big")


def _canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _fingerprint(value):
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _safe_name(value, fallback="chain"):
    text = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "").strip())
    text = text.strip("._-")
    return (text or fallback)[:96]


def _snap_context_length(value):
    """把任意 context length 对齐到 H3 支持的最近合法值。"""
    value = int(value or 22)
    if value <= 0:
        return 0
    if value in H3_CONTEXT_LENGTHS:
        return value
    # 向上取到最近的合法值
    for v in H3_CONTEXT_LENGTHS:
        if v >= value:
            return v
    return H3_CONTEXT_LENGTHS[-1]


def _snap_multiple_of_32(value):
    value = int(value or 32)
    if value < 32:
        value = 32
    return max(32, min(4096, int(round(value / 32.0)) * 32))


def _resolve_project_dimensions(project):
    """Resolve dimensions from explicit fields or the legacy preset value.

    Older Director states persisted only ``sizePreset``.  Falling through to a
    portrait default made a visible 960x544 preset execute at 1056x1920, so the
    preset is now an authoritative compatibility fallback.
    """
    raw_width = _safe_get(project, "width", None)
    raw_height = _safe_get(project, "height", None)
    if raw_width in (None, "") or raw_height in (None, ""):
        parts = str(_safe_get(project, "sizePreset", "") or "").split("|")
        if len(parts) >= 4:
            try:
                raw_width = int(parts[2]) if raw_width in (None, "") else raw_width
                raw_height = int(parts[3]) if raw_height in (None, "") else raw_height
            except (TypeError, ValueError):
                pass
    return (
        _snap_multiple_of_32(raw_width if raw_width not in (None, "") else 960),
        _snap_multiple_of_32(raw_height if raw_height not in (None, "") else 544),
    )


# ────────────────────────────────────────────────────────────────────────────
# 编译引擎（H3 六段格式，后端为权威）
# ────────────────────────────────────────────────────────────────────────────

def _safe_get(d, key, default=""):
    v = d.get(key, default) if isinstance(d, dict) else default
    return v if v is not None else default


_MEDIA_TAG_NAMES = {"image": "Picture", "video": "Video", "audio": "Audio"}


def _project_media(project):
    """Return normalized multimodal references, migrating legacy image slots in memory."""
    media = _safe_get(project, "mediaRefs", []) or []
    if isinstance(media, list) and any(isinstance(item, dict) and item.get("filename") for item in media):
        normalized = [
            _normalize_media_item(item, index)
            for index, item in enumerate(media)
            if isinstance(item, dict) and item.get("filename")
        ]
        workflow_type = str(_safe_get(project, "workflowType", "ai_drama") or "ai_drama")
        allow_video = True
        if workflow_type == "character_interaction":
            interaction = _safe_get(project, "interaction", {}) or {}
            allow_video = bool(isinstance(interaction, dict) and interaction.get("allowVideoReference", False))
        elif workflow_type == "character_pv":
            pv = _safe_get(project, "pv", {}) or {}
            allow_video = bool(isinstance(pv, dict) and pv.get("enabled", True) and pv.get("allowVideoReference", True))
        elif workflow_type == "ai_drama":
            allow_video = str(_safe_get(project, "mode", "t2v") or "t2v").lower() in ("r2v", "rv2v", "v2v")
        if not allow_video:
            normalized = [item for item in normalized if item.get("type") != "video"]
        return normalized

    legacy = _safe_get(project, "refs", []) or []
    migrated = []
    for index, item in enumerate(legacy):
        if not isinstance(item, dict) or not item.get("filename"):
            continue
        migrated.append(_normalize_media_item({
            "id": item.get("id") or f"legacy-image-{index + 1}",
            "type": "image",
            "filename": item.get("filename", ""),
            "originalName": item.get("name") or item.get("filename", ""),
            "name": item.get("name", ""),
            "kind": item.get("kind", "person"),
            "retention": item.get("retention", "fully_preserved"),
            "duration": 0.0,
            "trimStart": 0.0,
            "trimEnd": 0.0,
        }, index))
    return migrated


def _numbered_media(project):
    counters = {"image": 0, "video": 0, "audio": 0}
    result = []
    for item in _project_media(project):
        media_type = item.get("type", "image")
        if media_type not in counters:
            continue
        counters[media_type] += 1
        result.append((item, counters[media_type], _MEDIA_TAG_NAMES[media_type]))
    return result


_MEDIA_TAG_RE = re.compile(r"<(Picture|Video|Audio)\s+(-?\d+)>", re.IGNORECASE)
_FIELD_HEADER_RE = re.compile(
    r"(?m)^(subject_definitions|summary|retention_analysis|detailed_description|"
    r"integrated_multimodal_description|overall_soundscape|non_diegetic_music)\s*:",
    re.IGNORECASE,
)


def _parse_h3_timecode(value):
    text = str(value or "").strip()
    match = re.fullmatch(r"(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?", text)
    if not match:
        # Backward-compatible MM:SS.mmm parser. The first expression above also
        # accepts HH:MM:SS.mmm for long editorial timelines.
        match = re.fullmatch(r"(\d+):(\d{2})(?:\.(\d{1,3}))?", text)
        if not match:
            return None
        hours = 0
        minutes = int(match.group(1))
        seconds = int(match.group(2))
        millis_raw = match.group(3)
    else:
        hours = int(match.group(1) or 0)
        minutes = int(match.group(2))
        seconds = int(match.group(3))
        millis_raw = match.group(4)
        if minutes >= 60:
            return None
    if seconds >= 60:
        return None
    millis = (millis_raw or "0").ljust(3, "0")[:3]
    return hours * 3600.0 + minutes * 60.0 + seconds + int(millis) / 1000.0


def _format_h3_timecode(seconds):
    """Format a stable editorial timecode without millisecond carry bugs."""
    value = float(seconds or 0.0)
    if not math.isfinite(value):
        value = 0.0
    total_ms = max(0, int(round(value * 1000.0)))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"
    return f"{minutes:02d}:{secs:02d}.{millis:03d}"


def _scene_shot_timeline(scene, fps=H3_FPS):
    """Build an exact, frame-addressable editorial timeline for one scene.

    ``end_frame_exclusive`` follows normal media-tool conventions, so a range
    [0, 120) contains exactly 120 frames. H3's rounded 17k+5 generation length
    is deliberately not used here; it is separate model execution metadata.
    """
    shots = list(_safe_get(scene, "shots", []) or [])
    if not shots:
        return []
    try:
        duration = max(0.0, float(_safe_get(scene, "defaultSeconds", 10) or 10))
    except (TypeError, ValueError):
        duration = 10.0
    fps = max(1, int(fps or H3_FPS))
    total_frames = max(len(shots), int(round(duration * fps)))
    starts = []
    for index, shot in enumerate(shots):
        parsed = _parse_h3_timecode(_safe_get(shot, "time", "")) if isinstance(shot, dict) else None
        if index == 0:
            parsed = 0.0
        if parsed is None:
            parsed = duration * index / max(1, len(shots))
        frame = int(round(parsed * fps))
        minimum = starts[index - 1] + 1 if index else 0
        maximum = total_frames - (len(shots) - index)
        starts.append(max(minimum, min(maximum, frame)))
    starts[0] = 0

    result = []
    for index, shot in enumerate(shots):
        start_frame = starts[index]
        end_frame = starts[index + 1] if index + 1 < len(starts) else total_frames
        end_frame = max(start_frame + 1, min(total_frames, end_frame))
        start_seconds = start_frame / float(fps)
        end_seconds = end_frame / float(fps)
        result.append({
            "index": index + 1,
            "id": str(_safe_get(shot, "id", index + 1)) if isinstance(shot, dict) else str(index + 1),
            "start_timecode": _format_h3_timecode(start_seconds),
            "end_timecode": _format_h3_timecode(end_seconds),
            "start_seconds": start_seconds,
            "end_seconds": end_seconds,
            "duration_seconds": (end_frame - start_frame) / float(fps),
            "start_frame": start_frame,
            "end_frame_exclusive": end_frame,
            "frame_count": end_frame - start_frame,
        })
    return result


def _build_plan_preflight(project, plan, source_scenes=None):
    """在进入耗时的 H3 生成链之前检查计划与素材引用。

    warn 只记录错误标签，strict 会阻止流水线，off 则不检查文本标签。
    端口数量与裁剪区间属于数据完整性问题，始终作为硬错误。
    """
    policy = str(_safe_get(project, "referencePolicy", "warn") or "warn").lower()
    if policy not in ("off", "warn", "strict"):
        policy = "warn"
    errors, warnings = [], []
    media = list(plan.get("reference_media") or [])
    counts = {
        kind: sum(1 for item in media if item.get("type") == kind)
        for kind in ("image", "video", "audio")
    }

    limits = {"image": 9, "video": 3, "audio": 3}
    for kind, limit in limits.items():
        if counts[kind] > limit:
            errors.append(f"{kind} 参考素材 {counts[kind]} 个，超过端口上限 {limit} 个")

    if sum(counts.values()) > 12:
        errors.append(f"混合参考素材共 {sum(counts.values())} 个，超过 MiniMax H3 上限 12 个")
    if counts["audio"] and not (counts["image"] or counts["video"]):
        errors.append("音频不能单独作为 H3 参考输入；请至少添加一张参考图或一段参考视频")

    mode = str(_safe_get(project, "mode", "t2v") or "t2v").lower()
    roles = [str(item.get("role") or "") for item in media]
    if mode == "i2v" and counts["image"] < 1:
        errors.append("I2VA 至少需要一张首帧参考图")
    if mode == "fl2v" and counts["image"] < 2:
        errors.append("FL2VA 需要首帧和尾帧两张参考图")
    if mode == "l2v" and counts["image"] < 1:
        errors.append("L2VA 至少需要一张尾帧参考图")
    if mode == "fl2v" and counts["image"] >= 2:
        if "first_frame" not in roles or "last_frame" not in roles:
            warnings.append("首尾帧模式建议分别把两张图片用途设为“首帧锚点”和“尾帧锚点”")
    if mode == "l2v" and counts["image"] >= 1 and "last_frame" not in roles:
        warnings.append("L2VA 建议把目标图片用途设为“尾帧锚点”")
    if mode in ("r2v", "rv2v", "v2v") and not media:
        errors.append("Ref2VA 模式至少需要一个参考素材")

    seen_names = set()
    for offset, item in enumerate(media, start=1):
        filename = str(item.get("filename") or "").strip()
        key = (str(item.get("type") or "image"), filename.casefold())
        if filename and key in seen_names:
            warnings.append(f"参考素材重复: {filename}")
        seen_names.add(key)
        if not str(item.get("role") or "").strip():
            errors.append(f"素材 {offset} 未指定主要用途")
        if not str(item.get("purpose") or "").strip():
            warnings.append(f"素材 {offset} 未填写用途说明；复杂场景建议注明绑定主体/动作/运镜/声音")
        duration = float(item.get("duration", 0.0) or 0.0)
        trim_start = float(item.get("trim_start", 0.0) or 0.0)
        trim_end = float(item.get("trim_end", duration) or 0.0)
        if trim_start < 0 or trim_end < 0:
            errors.append(f"素材 {offset} 的裁剪时间不能为负数")
        if duration > 0 and trim_start >= duration:
            errors.append(f"素材 {offset} 的裁剪起点超出时长")
        if trim_end > 0 and trim_end <= trim_start:
            errors.append(f"素材 {offset} 的裁剪终点必须大于起点")
        if duration > 0 and trim_end > duration + 0.01:
            errors.append(f"素材 {offset} 的裁剪终点超出时长")

    if policy != "off":
        tag_counts = {"picture": counts["image"], "video": counts["video"], "audio": counts["audio"]}
        invalid_tags = []
        for shot in plan.get("shots") or []:
            text = str(shot.get("prompt") or "")
            for match in _MEDIA_TAG_RE.finditer(text):
                label = match.group(1)
                index = int(match.group(2))
                available = tag_counts[label.lower()]
                if index < 1 or index > available:
                    invalid_tags.append(
                        f"{shot.get('id', '未命名镜头')}: <{label} {index}> 无对应素材（可用 {available}）"
                    )
        if policy == "strict":
            errors.extend(invalid_tags)
        else:
            warnings.extend(invalid_tags)

    previous_start = -1
    for offset, shot in enumerate(plan.get("shots") or [], start=1):
        raw_frames = int(shot.get("raw_frames", 0) or 0)
        delivered = int(shot.get("delivered_frames", 0) or 0)
        start = int(shot.get("generation_start_frame", 0) or 0)
        if raw_frames <= 0 or raw_frames % 17 != 5:
            errors.append(f"镜头 {offset} 的帧数 {raw_frames} 不是 H3 合法长度 17k+5")
        if delivered <= 0 or delivered > raw_frames:
            errors.append(f"镜头 {offset} 的交付帧数 {delivered} 无效")
        if start < previous_start:
            errors.append(f"镜头 {offset} 的时间线起点逆序")
        previous_start = start

    compatibility = plan.get("compatibility") or {}
    width = int(compatibility.get("width", 0) or 0)
    height = int(compatibility.get("height", 0) or 0)
    max_raw_frames = max(
        [int(shot.get("raw_frames", 0) or 0) for shot in plan.get("shots") or []]
        or [0]
    )
    # 960x544 x 124f is the conservative 0.5MP/roughly-five-second baseline
    # used by the bundled 16GB workflow.  This is a warning rather than a hard
    # gate because quantization, offload and patch nodes change the real limit.
    baseline_volume = 960 * 544 * 124
    workload_ratio = (
        (width * height * max_raw_frames) / float(baseline_volume)
        if width and height and max_raw_frames else 0.0
    )
    if workload_ratio > 1.5:
        warnings.append(
            f"[H3-W201] 单段峰值工作量约为 0.5MP/124帧基线的 {workload_ratio:.1f}× "
            f"({width}×{height}, {max_raw_frames}帧)。16GB 显存建议使用 "
            "MiniMax Chunk FeedForward，必要时缩短单场景时长。"
        )

    # Knowledge-backed prompt contract checks. These run before any sampler or
    # loop node so an invalid plan cannot consume the expensive generation path.
    reference_mode = mode in ("r2v", "rv2v", "v2v")
    expected_fields = (
        ["subject_definitions", "summary", "retention_analysis", "detailed_description",
         "overall_soundscape", "non_diegetic_music"]
        if reference_mode else
        ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"]
    )
    for offset, shot in enumerate(plan.get("shots") or [], start=1):
        prompt = str(shot.get("prompt") or "")
        actual_fields = [match.group(1).lower() for match in _FIELD_HEADER_RE.finditer(prompt)]
        missing = [field for field in expected_fields if field not in actual_fields]
        if missing:
            errors.append(f"[H3-E011] 场景 {offset} 缺少必填字段: {', '.join(missing)}")
        present_expected = [field for field in actual_fields if field in expected_fields]
        if present_expected != [field for field in expected_fields if field in present_expected]:
            errors.append(f"[H3-E012] 场景 {offset} 的 H3 字段顺序不符合当前模式")
        forbidden = (
            {"subject_definitions", "summary", "retention_analysis", "detailed_description"}
            if not reference_mode else {"integrated_multimodal_description"}
        )
        mixed = sorted(set(actual_fields) & forbidden)
        if mixed:
            errors.append(
                f"[H3-E013] 场景 {offset} 混用了其他模式的字段: {', '.join(mixed)}"
            )
        duration = float(shot.get("duration_seconds", 0.0) or 0.0)
        if duration < 4.0 or duration > 15.0:
            errors.append(
                f"[H3-E006] 场景 {offset} 时长 {duration:g}s 超出 MiniMax H3 的 4–15s 范围"
            )

    scenes = source_scenes if isinstance(source_scenes, list) else []
    for scene_index, scene in enumerate(scenes, start=1):
        if not isinstance(scene, dict):
            continue
        duration = float(_safe_get(scene, "defaultSeconds", 10) or 10)
        inner_shots = _safe_get(scene, "shots", []) or []
        previous_cut = 0.0
        for shot_index, inner in enumerate(inner_shots, start=1):
            if not isinstance(inner, dict):
                continue
            estimate = float(inner.get("estSeconds", 0.0) or 0.0)
            if estimate > 15.0:
                errors.append(
                    f"[H3-E006] 场景 {scene_index} / Shot {shot_index} 预估 {estimate:g}s，单镜不得超过 15s"
                )
            if shot_index == 1:
                continue
            cut = _parse_h3_timecode(inner.get("time"))
            if cut is None:
                errors.append(
                    f"[H3-E005] 场景 {scene_index} / Shot {shot_index} 缺少合法切镜时间 MM:SS.mmm"
                )
            elif cut <= previous_cut or cut >= duration:
                errors.append(
                    f"[H3-E005] 场景 {scene_index} / Shot {shot_index} 切镜时间 {inner.get('time')} "
                    f"必须严格递增且小于 {duration:g}s"
                )
            else:
                previous_cut = cut

    issues = []
    for severity, entries in (("error", errors), ("warning", warnings)):
        for message in entries:
            code_match = re.match(r"\[([^\]]+)\]\s*", str(message))
            issues.append({
                "severity": severity,
                "code": code_match.group(1) if code_match else ("H3-E000" if severity == "error" else "H3-W100"),
                "message": re.sub(r"^\[[^\]]+\]\s*", "", str(message)),
            })

    return {
        "spec": "h3-prompt-spec@1.0",
        "ok": not errors,
        "policy": policy,
        "errors": errors,
        "warnings": warnings,
        "media_counts": counts,
        "checked_shots": len(plan.get("shots") or []),
        "issues": issues,
    }


def _used_ref_indices(project):
    """返回有 filename 的参考槽下标列表（0-based）。"""
    images = [item for item in _project_media(project) if item.get("type", "image") == "image"]
    return list(range(len(images)))


def build_subject_definitions(project):
    lines = []
    subject_number = 0
    for r, number, tag_name in _numbered_media(project):
        role = r.get("role") or _default_media_role(r.get("type"), r.get("kind"))
        description = _MEDIA_ROLE_DESCRIPTIONS.get(role, "a multimodal reference")
        name = (r.get("name") or "").strip()
        purpose = (r.get("purpose") or "").strip()
        source_tag = f"<{tag_name} {number}>"
        identity = name or purpose or description
        if role in _SUBJECT_ROLES:
            subject_number += 1
            line = f"  <Subject {subject_number}> is {identity}, defined by {source_tag}; {description}."
        else:
            line = f"  {source_tag} is {description}"
            if name:
                line += f" named {name}"
            line += "."
        if purpose and purpose != name:
            line += f" Primary use: {purpose}."
        if r.get("type") == "video" and r.get("useEmbeddedAudio"):
            line += " Its synchronized source audio is explicitly enabled."
        if r.get("type") == "audio" and r.get("speakerId"):
            line += f" Bind voice identity to ({r['speakerId']})."
        lines.append(line)
    return "\n".join(lines)


def build_retention(project):
    lines = []
    subject_number = 0
    for r, number, tag_name in _numbered_media(project):
        role = r.get("role") or _default_media_role(r.get("type"), r.get("kind"))
        ret = r.get("retention", "fully_preserved") or "fully_preserved"
        name = (r.get("name") or "").strip()
        name_tag = f" ({name})" if name else ""
        source_tag = f"<{tag_name} {number}>"
        if role in _SUBJECT_ROLES:
            subject_number += 1
            label = f"<Subject {subject_number}> [{source_tag}]"
        else:
            label = source_tag
        line = f"  {label}{name_tag}: {ret}."
        if role in ("subject_person", "subject_animal", "subject_prop") and r.get("type") == "image":
            line += (
                " Background: weak_reference; do not copy the reference-image background, "
                "keep only the declared subject design."
            )
        lines.append(line)
    return "\n".join(lines)


def _reference_task_summary(project):
    """Describe one explicit Ref2VA task instead of leaving reference intent ambiguous."""
    media = _project_media(project)
    roles = {item.get("role") for item in media}
    if "edit_source" in roles:
        task = "video editing"
    elif "continuation_source" in roles:
        task = "video continuation"
    elif roles & {"first_frame", "last_frame", "keyframe", "storyboard"}:
        task = "keyframe completion"
    elif any(item.get("type") == "audio" and item.get("retention") in {"fully_copy", "partially_copy"} for item in media):
        task = "audio reuse"
    elif any(item.get("type") == "audio" for item in media):
        task = "audio reference"
    else:
        task = "reference generation"
    foundation = str(_safe_get(project, "foundation", "") or "").strip()
    if foundation.startswith("integrated_multimodal_description:"):
        foundation = foundation.split(":", 1)[1].strip()
    detail = foundation or "Generate the requested scene while applying each reference only to its declared primary use."
    return f"  Task type: {task}. {detail}"


def _strip_field_header(value, field_name):
    """Keep user text while avoiding duplicated H3 section headers."""
    text = str(value or "").strip()
    pattern = rf"^\s*{re.escape(field_name)}\s*:\s*"
    return re.sub(pattern, "", text, count=1, flags=re.IGNORECASE).strip()


def _dialogue_language(project):
    skill = _safe_get(project, "skill", {}) or {}
    if not isinstance(skill, dict):
        skill = {}
    return str(
        skill.get("dialogueLanguage")
        or _safe_get(project, "dialogueLanguage", "Chinese")
        or "Chinese"
    ).strip() or "Chinese"


def _build_shot_blocks(shots, include_header=True):
    if not shots:
        return ""
    lines = []
    for i, s in enumerate(shots):
        if not isinstance(s, dict):
            continue
        parts = []
        # Official H3 syntax omits the timestamp on Shot 1. Later shots use a
        # strictly increasing cut time and an explicit cut verb.
        if i > 0 and s.get("time"):
            parts.append(f"At {s['time']}, the camera cuts to")
        if s.get("framing"):
            parts.append(str(s["framing"]))
        if s.get("title"):
            parts.append(f"a shot titled {s['title']}.")
        if s.get("transitionIn"):
            parts.append(f"Transition in: {s['transitionIn']}.")
        parts.append(s.get("content") or "(no content)")
        if s.get("intent"):
            parts.append(f"Narrative intent: {s['intent']}.")
        if s.get("action"):
            parts.append(f"Action: {s['action']}.")
        if s.get("camera"):
            parts.append(f"Camera: {s['camera']}.")
        if s.get("lens"):
            parts.append(f"Lens/focus: {s['lens']}.")
        if s.get("sound"):
            parts.append(f"Sound: {s['sound']}.")
        if s.get("transitionOut"):
            parts.append(f"Transition out: {s['transitionOut']}.")
        lines.append(f"[Shot {i + 1}] " + " ".join(parts))
    if not lines:
        return ""
    body = "\n\n  ".join(lines)
    return ("detailed_description:\n  " + body) if include_header else body


def _build_dialogue_block(dialogues, language="Chinese", include_header=False):
    items = []
    speakers = {}
    for d in dialogues:
        if not isinstance(d, dict):
            continue
        role = (d.get("role") or "").strip()
        text = (d.get("text") or "").strip()
        if role and text:
            if role not in speakers:
                speakers[role] = f"S{len(speakers) + 1}"
            speaker_id = speakers[role]
            time_code = str(d.get("time") or "").strip()
            prefix = f"At {time_code}, " if time_code else ""
            if d.get("voiceover"):
                line = (
                    f"{prefix}{role} ({speaker_id}) says in an off-screen voiceover: "
                    f"<d>[{language}] {text}</d> while the on-screen character's lips remain completely closed."
                )
            else:
                line = f"{prefix}{role} ({speaker_id}) says: <d>[{language}] {text}</d>"
            items.append("  " + line)
    if not items:
        return ""
    body = "\n".join(items)
    return ("Dialogue:\n" + body) if include_header else body


def _strip_dialogue_tags(text):
    """移除文本中所有 <d>...</d> 标签，压缩多余空行。"""
    text = re.sub(r"<d>.*?</d>", "", text, flags=re.S)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _disabled_scene_tokens(scene):
    values = _safe_get(scene, "disabledTokens", []) or []
    if not isinstance(values, list):
        return []
    return [str(value) for value in values if str(value or "").strip()]


def _active_scene_text(scene, value):
    """Remove UI-disabled atomic tokens without changing the stored screenplay."""
    text = str(value or "")
    for token in _disabled_scene_tokens(scene):
        text = text.replace(token, "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _build_body(project, scene):
    preamble = _strip_dialogue_tags(_active_scene_text(scene, _safe_get(scene, "preamble", "")))
    detailed = _build_shot_blocks(_safe_get(scene, "shots", []) or [])
    disabled = set(_disabled_scene_tokens(scene))
    dialogues = []
    for item in _safe_get(scene, "dialogues", []) or []:
        if not isinstance(item, dict):
            continue
        token = f"<d>[{(item.get('role') or '').strip()}] {(item.get('text') or '').strip()}</d>"
        if token not in disabled:
            dialogues.append(item)
    dialogue = _build_dialogue_block(dialogues, _dialogue_language(project))
    sections = [x for x in [preamble, detailed, dialogue] if x]
    return "\n\n".join(sections)


def _build_interaction_directive(project, scene):
    """Compile the character-interaction UI contract into the executable prompt."""
    if str(_safe_get(project, "workflowType", "") or "") != "character_interaction":
        return ""
    cfg = _safe_get(project, "interaction", {}) or {}
    if not isinstance(cfg, dict) or not cfg.get("enabled", True):
        return ""
    duration = max(4.0, min(15.0, float(_safe_get(scene, "defaultSeconds", _safe_get(project, "globalDuration", 7)) or 7)))
    production = {
        "S": "restrained: one readable interaction beat, stable camera, subtle secondary motion, zero or one lightweight effect layer",
        "SR": "standard: anticipation, main action and reaction, one motivated camera move, one or two effect layers",
        "SSR": "advanced: two or three readable performance beats, layered foreground/background motion, motivated camera and effects",
        "UR": "showcase: a polished hero performance with at most three clear beats, coordinated camera, environment response and layered effects",
    }.get(str(cfg.get("productionLevel") or "SR"), "standard")
    visual_style = {
        "auto": "Infer live-action versus anime motion language from the authoritative references and preserve that medium.",
        "live_action": (
            "LIVE-ACTION PERFORMANCE: use physically weighted motion, realistic inertia and joint limits, "
            "subtle facial micro-expression, natural blinking and cinematic camera response; avoid anime "
            "smear frames, cel-shaded motion shorthand and exaggerated holds."
        ),
        "anime": (
            "ANIME PERFORMANCE: preserve 2D linework and cel shading, favor readable key poses, controlled "
            "anticipation/holds and selective stylized follow-through; avoid photoreal skin, live-action "
            "motion blur and 3D-render drift."
        ),
    }.get(str(cfg.get("visualStyle") or "auto"), "")
    dynamics = {
        "auto": "Infer a character-appropriate interaction from visible design, scene intent and supplied text.",
        "idle_loop": "Use subtle breathing, blink, gaze shift, small head motion, hair and garment follow-through.",
        "expression_reaction": "Use a clear facial reaction supported by restrained head, shoulder and hand motion.",
        "gesture": "Use one readable communicative gesture with anticipation, action, reaction and recovery.",
        "dialogue_lipsync": "Use conversational acting with natural lip motion, blink, gaze and restrained gesture.",
        "action": "Use a readable action with stable anatomy, center-of-frame staging and controlled follow-through.",
        "dance_performance": "Use a short rhythmic performance with a limited move vocabulary and clear recovery pose.",
        "transformation": "Stage a transformation while preserving identity and costume continuity across effects.",
        "vfx_showcase": "Make effects respond to the character action and never obscure the face.",
        "environment_interaction": "Let the character touch or react to one clearly defined environmental element.",
        "meme_loop": "Use a concise, exaggerated reaction suitable for a looping reaction clip.",
    }.get(str(cfg.get("dynamicType") or "auto"), "")
    output = {
        "single_clip": "Deliver one self-contained clip with a natural ending; no stitching handoff is required.",
        "single_loop": "Deliver a seamless loop; match first/last pose, framing, velocity, hair/cloth direction, lighting and effect phase without freezing the seam.",
        "optional_chain": "Keep the clip independent and additionally expose compatible handoff_in/handoff_out states.",
        "continuous_chain": "Plan explicit pose, gaze, position, camera, lighting, effect and sound continuity handoffs.",
    }.get(str(cfg.get("outputMode") or "single_loop"), "")
    lines = [
        "CHARACTER INTERACTION CONTRACT:",
        f"- Duration budget: {duration:.3f} seconds.",
        f"- Production strength: {production}.",
        f"- Visual performance system: {visual_style}",
        f"- Dynamic type: {dynamics}",
        f"- Output strategy: {output}",
        "- Preserve identity, facial structure, hairstyle, costume construction, signature accessories, body proportions, palette and visual style.",
        "- Keep the primary action readable in the central 70% of frame and describe timing, amplitude, direction, reaction and recovery.",
    ]
    if cfg.get("aiMotionAutofill", True):
        lines.append("- Invent physically coherent micro-motion and secondary motion without requiring a reference video.")
    if not cfg.get("allowVideoReference", False):
        lines.append("- Reference-video transfer is disabled; build motion from still-image anchors and stated intent only.")
    intent = str(cfg.get("interactionIntent") or "").strip()
    if intent:
        lines.append("- User interaction intent: " + intent)
    adult_ready = bool(
        cfg.get("adultEnabled") and str(cfg.get("adultTier") or "off") != "off"
        and cfg.get("adultSubjectsVerified") and cfg.get("consentConfirmed")
    )
    if adult_ready:
        lines.append(
            "- Adult profile: %s; all depicted people are verified adults and all intimacy is consensual. "
            "Remain within the separately enabled safety skill." % str(cfg.get("adultTier"))
        )
    else:
        lines.append("- Adult-content profile: OFF; keep the result general-audience.")
    return "\n".join(lines)


_PV_TEMPLATES = {
    "character_reveal": "hero character reveal: detail inserts, identity reveal, signature action, then a clean hero hold",
    "kinetic_typography": "motion-graphics plates with graphic masks and title-safe negative space; exact typography is added in post",
    "image_flash": "rhythmic image-flash montage with short readable poses, detail inserts and strong graphic contrast",
    "mixed_pv": "character reveal, action inserts, graphic title plates and a decisive end card without overcrowding any beat",
    "action_showcase": "match-on-action character showcase with anticipation, peak pose, impact insert and controlled recovery",
    "emotional_memory": "lyrical memory fragments, expressive close-ups and visual echoes that build to an emotional hero frame",
    "fashion_editorial": "fashion-editorial posing, material detail inserts, graphic negative space and precise visual punctuation",
}
_PV_RHYTHMS = {
    "beat_sync": "cut and accent on the declared beat grid",
    "impact_accents": "hold between a few strong impact accents and reserve flash frames for real emphasis",
    "smooth_cinematic": "use longer phrases, motivated match cuts and restrained glow transitions",
    "glitch_cut": "use concise glitch interruptions while keeping the character readable",
    "syncopated": "alternate on-beat anchors with restrained off-beat inserts to avoid a mechanical edit pattern",
    "crescendo": "begin with spacious holds, increase cut frequency gradually, then resolve on one clean hero frame",
}
_PV_THEMES = {
    "auto": "infer a coherent theme from the character, references and brief",
    "hero_origin": "hero origin and identity reveal",
    "neon_idol": "neon idol stage and fan-energy spectacle",
    "fantasy_relic": "fantasy relic awakening and magical lore",
    "urban_chase": "urban pursuit and kinetic street energy",
    "dream_archive": "dream archive, memory fragments and emotional symbolism",
    "dark_rival": "dark rival confrontation and controlled menace",
    "festival_stage": "festival stage, celebratory color and rhythmic performance",
    "tech_interface": "future interface, scanning graphics and holographic systems",
    "fashion_editorial": "fashion editorial, material detail and confident posing",
    "quiet_portrait": "quiet portrait, intimate expression and restrained atmosphere",
}
_PV_VISUAL_STYLES = {
    "auto": "preserve and infer the reference medium",
    "anime_cel": "clean 2D anime linework, cel-shaded color and readable key poses",
    "live_action_cinematic": "physically weighted live-action movement and cinematic optics",
    "graphic_comic": "graphic comic panels, bold shapes and controlled halftone accents",
    "y2k_digital": "Y2K digital graphics, chrome accents and playful interface motifs",
    "retro_film": "analog film texture, optical light and restrained period color",
    "luxury_editorial": "luxury editorial lighting, material detail and minimal typography",
    "minimal_monochrome": "high-contrast monochrome forms with deliberate negative space",
    "holographic": "holographic color separation, scanning light and translucent layers",
    "ink_paper": "ink-and-paper texture, brush transitions and graphic silhouettes",
}
_PV_EDIT_GRAMMARS = {
    "auto": "choose cuts from action, gaze, shape, color and story continuity",
    "detail_to_hero": "move from costume/prop details to a full identity reveal",
    "match_on_action": "cut across views on the same readable character action",
    "shape_match": "bridge shots through matched silhouettes and graphic shapes",
    "color_match": "use one palette accent to motivate each cut",
    "eyeline_bridge": "follow gaze and reaction to reveal the next visual beat",
    "beat_strobe": "use very short beat inserts around longer readable anchor shots",
    "time_remap": "use speed ramps only around clear action peaks and recovery poses",
    "split_screen": "build parallel character details or before/after states in graphic panels",
    "freeze_smash": "freeze a peak pose, add post graphics, then smash-cut into motion",
    "foreground_wipe": "hide cuts behind a foreground object, cloth, hair or light sweep",
}
_PV_TRANSITIONS = {
    "hard_cut", "cut_on_action", "flash_cut", "match_cut", "graphic_match",
    "whip_pan", "whip_zoom", "foreground_wipe", "luma_wipe", "mask_wipe",
    "split_screen_push", "parallax_push", "speed_ramp", "freeze_smash",
    "film_burn", "glitch_slice", "zoom_blur", "light_sweep", "dip_to_color",
}
_PV_EFFECTS = {
    "deep_glow", "bokeh", "rgb_split", "pixel_sort", "jpeg_glitch",
    "frame_echo", "light_leak", "thick_stroke", "halftone", "chromatic_trails",
    "particle_burst", "scanline", "film_grain", "lens_distortion", "bloom_pulse",
    "silhouette", "posterize", "ink_spread", "hologram", "graphic_shapes",
}
_PV_TEXT_TREATMENTS = {
    "safe_title": "single title in reserved negative space",
    "hero_nameplate": "character nameplate after the identity reveal",
    "kinetic_words": "short kinetic words animated in post on beat accents",
    "subtitle_card": "title plus one restrained subtitle line",
    "no_text": "no typography, only image and motion",
}
_PV_ACTION_PROFILES = {
    "calm": "restrained breathing, gaze, hair/cloth follow-through and a confident hero hold",
    "graceful": "elegant turn, hand or costume gesture with smooth recovery",
    "energetic": "clear anticipation, fast readable action accents and stable recovery poses",
    "combat": "guard, wind-up, one decisive technique and a readable impact silhouette",
    "idol": "performance gesture, audience-facing eyeline and rhythmic pose changes",
    "mysterious": "partial reveal, controlled gaze, prop interaction and restrained movement",
    "comedic": "concise reaction, readable exaggeration and a clean loopable reset",
}


def _pv_settings(project):
    cfg = _safe_get(project, "pv", {}) or {}
    cfg = cfg if isinstance(cfg, dict) else {}
    template = str(cfg.get("template") or "character_reveal")
    if template not in _PV_TEMPLATES:
        template = "character_reveal"
    rhythm = str(cfg.get("rhythm") or "beat_sync")
    if rhythm not in _PV_RHYTHMS:
        rhythm = "beat_sync"
    density = str(cfg.get("cutDensity") or "medium")
    if density not in {"sparse", "medium", "dense"}:
        density = "medium"
    try:
        bpm = max(40.0, min(240.0, float(cfg.get("bpm") or 120)))
    except (TypeError, ValueError):
        bpm = 120.0
    try:
        offset_ms = max(-2000, min(2000, int(float(cfg.get("beatOffsetMs") or 0))))
    except (TypeError, ValueError):
        offset_ms = 0
    transitions = [str(x) for x in (cfg.get("transitions") or []) if str(x) in _PV_TRANSITIONS]
    effects = [str(x) for x in (cfg.get("effects") or []) if str(x) in _PV_EFFECTS]
    theme = str(cfg.get("theme") or "auto")
    if theme not in _PV_THEMES:
        theme = "auto"
    visual_style = str(cfg.get("visualStyle") or "auto")
    if visual_style not in _PV_VISUAL_STYLES:
        visual_style = "auto"
    edit_grammar = str(cfg.get("editGrammar") or "auto")
    if edit_grammar not in _PV_EDIT_GRAMMARS:
        edit_grammar = "auto"
    action_profile = str(cfg.get("actionProfile") or "calm")
    if action_profile not in _PV_ACTION_PROFILES:
        action_profile = "calm"
    text_treatment = str(cfg.get("textTreatment") or "safe_title")
    if text_treatment not in _PV_TEXT_TREATMENTS:
        text_treatment = "safe_title"
    return {
        "enabled": bool(cfg.get("enabled", True)),
        "template": template,
        "rhythm": rhythm,
        "cut_density": density,
        "bpm": bpm,
        "beat_offset_ms": offset_ms,
        "theme": theme,
        "visual_style": visual_style,
        "edit_grammar": edit_grammar,
        "action_profile": action_profile,
        "text_treatment": text_treatment,
        "title": str(cfg.get("title") or "").strip(),
        "subtitle": str(cfg.get("subtitle") or "").strip(),
        "reserve_title_safe_area": bool(cfg.get("reserveTitleSafeArea", True)),
        "allow_video_reference": bool(cfg.get("allowVideoReference", True)),
        "transitions": transitions,
        "effects": effects,
        "creative_brief": str(cfg.get("creativeBrief") or "").strip(),
        "action_direction": str(cfg.get("actionDirection") or "").strip(),
        "title_concept": str(cfg.get("titleConcept") or "").strip(),
        "selected_card_id": str(cfg.get("selectedCardId") or "").strip(),
        "notes": str(cfg.get("notes") or "").strip(),
    }


def _build_pv_directive(project, scene):
    """Keep H3 plate generation stable while exporting exact post-production intent."""
    if str(_safe_get(project, "workflowType", "") or "") != "character_pv":
        return ""
    cfg = _pv_settings(project)
    if not cfg["enabled"]:
        return ""
    duration = max(1.0, float(_safe_get(scene, "defaultSeconds", _safe_get(project, "globalDuration", 7)) or 7))
    lines = [
        "CHARACTER PV / MOTION-GRAPHICS CONTRACT:",
        f"- Duration budget: {duration:.3f} seconds.",
        "- Theme: " + _PV_THEMES[cfg["theme"]] + ".",
        "- Visual style: " + _PV_VISUAL_STYLES[cfg["visual_style"]] + ".",
        "- Template: " + _PV_TEMPLATES[cfg["template"]] + ".",
        "- Rhythm: " + _PV_RHYTHMS[cfg["rhythm"]] + ".",
        "- Editing grammar: " + _PV_EDIT_GRAMMARS[cfg["edit_grammar"]] + ".",
        "- Character action profile: " + _PV_ACTION_PROFILES[cfg["action_profile"]] + ".",
        f"- Beat grid: {cfg['bpm']:g} BPM with {cfg['beat_offset_ms']} ms offset.",
        f"- Edit density: {cfg['cut_density']}.",
        "- Planned transitions for post: " + (", ".join(cfg["transitions"]) or "clean_cut") + ".",
        "- Planned effects for post: " + (", ".join(cfg["effects"]) or "none") + ".",
        "- Generate clean, temporally stable character plates; preserve identity, face, hairstyle, costume, proportions, signature props and palette across every cut.",
        "- Treat flashes, RGB split, pixel sorting, JPEG glitches, film burns, exact masks and final typography as post-production cues; never deform the character to imitate them.",
        "- Do not draw readable titles, logos, UI or watermarks inside generated footage.",
        "- Typography treatment for post: " + _PV_TEXT_TREATMENTS[cfg["text_treatment"]] + ".",
    ]
    if cfg["reserve_title_safe_area"]:
        lines.append("- Reserve uncluttered title-safe negative space without covering the face, hands or signature costume details.")
    if cfg["title"]:
        lines.append("- Exact post title (metadata only; do not render in generation): " + cfg["title"])
    if cfg["subtitle"]:
        lines.append("- Exact post subtitle (metadata only; do not render in generation): " + cfg["subtitle"])
    if cfg["creative_brief"]:
        lines.append("- Creative brief: " + cfg["creative_brief"])
    if cfg["action_direction"]:
        lines.append("- Selected action direction: " + cfg["action_direction"])
    if cfg["notes"]:
        lines.append("- User PV direction: " + cfg["notes"])
    return "\n".join(lines)


def _pv_post_production(project, duration_seconds=None):
    """Return editor-facing metadata; this is intentionally separate from H3 pixels."""
    if str(_safe_get(project, "workflowType", "") or "") != "character_pv":
        return None
    cfg = _pv_settings(project)
    if not cfg["enabled"]:
        return None
    payload = dict(cfg)
    payload["schema"] = "eagle-character-pv-post@1.0"
    payload["render_stage"] = "post_production"
    payload["generation_stage"] = "clean_character_plates"
    payload["generation_can_render_exact_text"] = False
    payload["text_overlays"] = []
    if cfg["title"]:
        payload["text_overlays"].append({
            "role": "title", "text": cfg["title"], "treatment": cfg["text_treatment"],
            "stage": "post_production",
        })
    if cfg["subtitle"]:
        payload["text_overlays"].append({
            "role": "subtitle", "text": cfg["subtitle"], "treatment": cfg["text_treatment"],
            "stage": "post_production",
        })
    payload["beat_interval_seconds"] = round(60.0 / cfg["bpm"], 6)
    if duration_seconds is not None:
        duration = max(0.0, float(duration_seconds or 0.0))
        offset = cfg["beat_offset_ms"] / 1000.0
        beat = offset
        while beat < 0:
            beat += payload["beat_interval_seconds"]
        beat_times = []
        while beat < duration - 1e-9 and len(beat_times) < 1000:
            beat_times.append(round(beat, 6))
            beat += payload["beat_interval_seconds"]
        payload["duration_seconds"] = duration
        payload["beat_times_seconds"] = beat_times
    return payload


def _build_alignment(project, duration_seconds=0.0, shot_count=1):
    """Return the exact leading keyframe instruction used by H3 base modes."""
    mode = _safe_get(project, "mode", "t2v")
    images = [item for item in _project_media(project) if item.get("type") == "image"]
    used = list(range(len(images)))
    if mode in ("i2v", "fl2v", "l2v"):
        if not used:
            return ""
        first_index = next((i for i, item in enumerate(images) if item.get("role") == "first_frame"), 0)
        n = first_index + 1
        if mode == "fl2v":
            last_index = next(
                (i for i, item in enumerate(images) if item.get("role") == "last_frame"),
                1 if len(images) > 1 else first_index,
            )
            end_time = max(0.0, float(duration_seconds or 0.0))
            final_shot = max(1, int(shot_count or 1))
            return (
                "How the reference pictures align with the target video — "
                f"Picture {n} (from Shot 1) aligns with the 0.00-second mark of the target video; "
                f"Picture {last_index + 1} (from Shot {final_shot}) aligns with the "
                f"{end_time:.2f}-second mark of the target video."
            )
        if mode == "l2v":
            last_index = next(
                (i for i, item in enumerate(images) if item.get("role") == "last_frame"),
                0,
            )
            end_time = max(0.0, float(duration_seconds or 0.0))
            final_shot = max(1, int(shot_count or 1))
            return (
                "How the reference pictures align with the target video — "
                f"<Picture {last_index + 1}> (from [Shot {final_shot}]) aligns with the "
                f"{end_time:.2f}-second mark of the target video."
            )
        return (
            "For the target video, at 0.00 seconds into the target video, "
            f"<Picture {n}> (from [Shot 1]) is fully referenced."
        )
    return ""


def compile_scene_prompt(project, scene):
    """Compile one scene using the exact base/Ref2VA field contract."""
    if not isinstance(project, dict):
        project = {}
    if not isinstance(scene, dict):
        scene = {}

    prefix = _build_global_prefix(project)
    body = _build_scene_prompt(project, scene)
    return "\n\n".join(item for item in (prefix, body) if item)


def _build_global_prefix(project):
    """编译全局共享前缀（prompt_prefix），与每个 scene_prompt 拼接组成完整 prompt。"""
    parts = []
    reference_mode = str(_safe_get(project, "mode", "t2v") or "t2v").lower() in (
        "r2v", "rv2v", "v2v",
    )

    # Base modes are a three-field document per scene. Their foundation must
    # live inside integrated_multimodal_description, not in a shared Ref2VA
    # prefix containing subject/retention sections.
    if not reference_mode:
        return ""

    # Ref2VA section 1: subject_definitions
    subj = build_subject_definitions(project)
    parts.append("subject_definitions:\n" + (subj or "  N/A"))

    # Ref2VA section 2: summary
    parts.append("summary:\n" + _reference_task_summary(project))

    # Ref2VA section 3: retention_analysis
    ret = build_retention(project)
    parts.append("retention_analysis:\n" + (ret or "  N/A"))

    return "\n\n".join(parts)


def _build_scene_prompt(project, scene):
    """Compile the per-scene portion while preserving the mode's field order."""
    parts = []
    mode = str(_safe_get(project, "mode", "t2v") or "t2v").lower()
    reference_mode = mode in ("r2v", "rv2v", "v2v")
    shots = _safe_get(scene, "shots", []) or []
    detailed_body = _build_shot_blocks(shots, include_header=False)

    # 台词块追加到 body（如果存在）
    disabled = set(_disabled_scene_tokens(scene))
    active_dialogues = []
    for item in _safe_get(scene, "dialogues", []) or []:
        if not isinstance(item, dict):
            continue
        token = f"<d>[{(item.get('role') or '').strip()}] {(item.get('text') or '').strip()}</d>"
        if token not in disabled:
            active_dialogues.append(item)
    dialogue = _build_dialogue_block(active_dialogues, _dialogue_language(project))

    # preamble（去除已有的 <d> 台词标签，避免重复）
    preamble = _strip_dialogue_tags(_active_scene_text(scene, _safe_get(scene, "preamble", "")))
    # The script task can return a complete [Shot N] screenplay and the shots
    # task subsequently creates structured shot rows from it.  Once structured
    # rows exist, keep only setup text before the first shot header or the same
    # shot descriptions are sent to H3 twice.
    if shots:
        preamble = re.split(r"(?im)^\s*\[Shot\s+\d+\]", preamble, maxsplit=1)[0].strip()
    interaction_directive = _build_interaction_directive(project, scene)
    pv_directive = _build_pv_directive(project, scene)
    timeline_parts = [
        item for item in (
            interaction_directive, pv_directive, preamble, detailed_body, dialogue
        ) if item
    ]
    timeline = "\n\n".join(timeline_parts) or "N/A"

    if reference_mode:
        # Ref2VA section 4.
        parts.append("detailed_description:\n  " + timeline.replace("\n", "\n  "))
    else:
        # Base modes: exact optional alignment line followed by three fields.
        alignment = _build_alignment(
            project,
            _safe_get(scene, "defaultSeconds", 10) or 10,
            len(shots) or 1,
        )
        if alignment:
            parts.append(alignment)
        foundation = _strip_field_header(
            _safe_get(project, "foundation", ""),
            "integrated_multimodal_description",
        )
        integrated = "\n\n".join(item for item in (foundation, timeline) if item)
        parts.append("integrated_multimodal_description:\n  " + integrated.replace("\n", "\n  "))

    # 场景级 overall_soundscape（无默认值，避免污染 scene_prompt）
    sounds = [s.get("sound") for s in shots if isinstance(s, dict) and s.get("sound")]
    global_sound = _safe_get(project, "globalSoundscape", "").strip()
    resolved_sound = ", ".join(sounds) or global_sound
    parts.append("overall_soundscape:\n  " + (resolved_sound or "N/A").replace("\n", "\n  "))

    # 场景级 non_diegetic_music：目前 UI 无 per-scene music，由 _build_global_prefix 统一输出全局音乐，
    # 此处仅当 scene 显式携带 music 字段时才覆盖，避免与 prefix 重复。
    scene_music = _safe_get(scene, "music", "").strip()
    global_music = _safe_get(project, "globalMusic", "").strip()
    resolved_music = scene_music or global_music
    parts.append("non_diegetic_music:\n  " + (resolved_music or "N/A").replace("\n", "\n  "))

    return "\n\n".join(parts)


def _slugify(text, max_len=40):
    """将场景标题转为 id slug（保留 ASCII 字母数字，中文用拼音首字母，其余用下划线）。"""
    import re
    text = str(text or "").strip()
    # 只保留英文字母、数字、空格、连字符
    slug = re.sub(r"[^\w\s-]", "", text.lower())
    slug = re.sub(r"[\s_-]+", "_", slug).strip("_")
    return slug[:max_len] if slug else "scene"


def compile_h3_params(project, scenes, llm_hint=""):
    """编译 ethanfel-compatible H3_CHAIN_PLAN dict，可直接接入 Loop Start / Scene Prompt Editor。"""
    if not isinstance(project, dict):
        project = {}
    workflow_type = str(_safe_get(project, "workflowType", "ai_drama") or "ai_drama")
    if workflow_type not in ("ai_drama", "character_interaction", "character_pv"):
        workflow_type = "ai_drama"
    # 基础参数提取与合法性修正
    fps = int(_safe_get(project, "fps", H3_FPS) or H3_FPS)
    if fps <= 0:
        fps = H3_FPS

    width, height = _resolve_project_dimensions(project)
    context_length = _snap_context_length(_safe_get(project, "contextLength", 22))
    audio_context_length = _snap_context_length(_safe_get(project, "audioContextLength", 22))
    video_blend_frames = int(_safe_get(project, "videoBlendFrames", 0) or 0)
    if video_blend_frames < 0:
        video_blend_frames = 0
    if context_length and video_blend_frames > context_length:
        video_blend_frames = context_length

    encode_mode = _safe_get(project, "encodeMode", "video") or "video"
    if encode_mode not in ("video", "frames"):
        encode_mode = "video"
    anchor_mode = _safe_get(project, "anchorMode", "head") or "head"
    if anchor_mode not in ("head", "before"):
        anchor_mode = "head"
    crop = _safe_get(project, "crop", "disabled") or "disabled"
    if crop not in ("disabled", "center"):
        crop = "disabled"
    audio_mode = _safe_get(project, "audioMode", "generated_audio") or "generated_audio"
    if audio_mode not in H3_AUDIO_MODES:
        audio_mode = "generated_audio"
    continuation_mode = _safe_get(project, "continuationMode", "guide") or "guide"
    if continuation_mode not in H3_CONTINUATION_MODES:
        continuation_mode = "guide"
    # before 模式不支持 blend
    if anchor_mode != "head" and video_blend_frames:
        video_blend_frames = 0

    segment_crf = int(_safe_get(project, "segmentCrf", _safe_get(project, "segmentRef", 18)) or 18)
    segment_crf = max(0, min(51, segment_crf))
    steps = int(_safe_get(project, "globalSteps", 8) or 8)
    steps = max(1, min(10000, steps))
    base_seed = int(_safe_get(project, "baseSeed", 0) or 0)
    base_seed = max(0, min(H3_MAX_SEED, base_seed))
    generation_fingerprint = str(_safe_get(project, "generationFingerprint", "1") or "1").strip()

    run_name = _safe_name((llm_hint or "").strip() or "eagle_h3_director", "eagle_h3_director")

    # 全局共享前缀
    prompt_prefix = _build_global_prefix(project)

    # shots 构建与 normalize
    shots_list = []
    stitched_frames = 0
    resolved_continuation_modes = []
    resolved_context_lengths = []

    for i, s in enumerate(scenes):
        if not isinstance(s, dict):
            continue
        index = i + 1
        secs = float(_safe_get(s, "defaultSeconds", 10) or 10)
        if not math.isfinite(secs) or secs <= 0:
            secs = 10.0

        title = str(_safe_get(s, "title", "")).strip() or f"scene_{index:02d}"
        scene_id = f"scene_{index:02d}_{_slugify(title)}"

        # scene 级 context/audio/steps 覆盖；空值必须继承全局，不能意外回落到 22。
        scene_context_value = _safe_get(s, "contextLength", None)
        shot_context_length = (
            context_length if scene_context_value in (None, "")
            else _snap_context_length(scene_context_value)
        )
        scene_audio_context_value = _safe_get(s, "audioContextLength", None)
        shot_audio_context_length = (
            audio_context_length if scene_audio_context_value in (None, "")
            else _snap_context_length(scene_audio_context_value)
        )
        shot_steps = int(_safe_get(s, "defaultSteps", steps) or steps)
        shot_steps = max(1, min(10000, shot_steps))
        resolved_context_lengths.append(shot_context_length)

        # scene 级 continuation_mode 覆盖
        shot_continuation_mode = _safe_get(s, "continuationMode", continuation_mode)
        if shot_continuation_mode not in H3_CONTINUATION_MODES:
            shot_continuation_mode = continuation_mode

        # masked_av 校验
        if shot_context_length and shot_continuation_mode == "masked_av":
            if shot_context_length < 5:
                shot_continuation_mode = "guide"
            elif encode_mode != "video" or anchor_mode != "head":
                shot_continuation_mode = "guide"
        resolved_continuation_modes.append(shot_continuation_mode)

        # scene_prompt：不含 prefix
        scene_prompt = _build_scene_prompt(project, s)

        # 完整 prompt = prefix + scene_prompt
        full_prompt_parts = []
        if prompt_prefix:
            full_prompt_parts.append(prompt_prefix)
        if scene_prompt:
            full_prompt_parts.append(scene_prompt)
        full_prompt = "\n\n".join(full_prompt_parts)

        # 剪辑时长与 H3 生成帧长是两个独立合同。前者精确按 fps
        # 交付；后者为了满足 17k+5 且在续镜时包含头部上下文，可以更长。
        timeline_frames = max(1, int(round(secs * fps)))
        generation_context_frames = (
            shot_context_length
            if index > 1 and anchor_mode == "head" and shot_context_length
            else 0
        )
        raw_frames = _h3_frame_length_for_frames(
            timeline_frames + generation_context_frames
        )
        delivered_frames = timeline_frames
        generation_start_frame = max(0, stitched_frames - generation_context_frames)
        tail_trim_frames = max(
            0, raw_frames - generation_context_frames - delivered_frames
        )

        # seed
        seed = _derived_seed(base_seed, index, scene_id)

        shot = {
            "index": index,
            "id": scene_id,
            "source_scene_id": str(_safe_get(s, "id", index)),
            "scene_prompt": scene_prompt,
            "prompt": full_prompt,
            "prompt_hash": _fingerprint(full_prompt),
            "seed": seed,
            "steps": shot_steps,
            # Native Context Loop aliases make the plan directly inspectable
            # by its Plan/Review tooling while Eagle keeps resolved fields.
            # Editorial time and model execution time are separate contracts.
            # duration_seconds remains the requested scene budget for Context
            # Loop compatibility; generated_duration_seconds reflects 17k+5.
            "duration_seconds": secs,
            "timeline_duration_seconds": secs,
            "timeline_frames": timeline_frames,
            "timeline_start_timecode": "00:00.000",
            "timeline_end_timecode": _format_h3_timecode(secs),
            "shot_timeline": _scene_shot_timeline(s, fps),
            "length": raw_frames,
            "raw_frames": raw_frames,
            "generated_duration_seconds": raw_frames / float(fps),
            "delivered_frames": delivered_frames,
            "context_trim_frames": generation_context_frames,
            "tail_trim_frames": tail_trim_frames,
            "generation_start_frame": generation_start_frame,
            "audio_start_seconds": generation_start_frame / float(fps),
            "audio_duration_seconds": raw_frames / float(fps),
            "reference_tags": sorted(set(
                match.group(0) for match in _MEDIA_TAG_RE.finditer(full_prompt)
            )),
            # full_prompt 的全局 subject_definitions 会列出全部素材；路由节点需要
            # 单独知道本场景正文真正使用了哪些标签，以及 UI 明确忽略了哪些标签。
            "scene_reference_tags": sorted(set(
                match.group(0) for match in _MEDIA_TAG_RE.finditer(scene_prompt)
            )),
            "disabled_reference_tags": sorted(set(
                match.group(0)
                for token in _disabled_scene_tokens(s)
                for match in _MEDIA_TAG_RE.finditer(token)
            )),
        }
        post_production_cues = _pv_post_production(project, secs)
        if post_production_cues:
            shot["post_production_cues"] = post_production_cues

        # 仅当与全局默认值不同才写入覆盖字段
        if shot_context_length != context_length:
            shot["context_length"] = shot_context_length
        if shot_audio_context_length != audio_context_length:
            shot["audio_context_length"] = shot_audio_context_length
        if shot_continuation_mode != continuation_mode:
            shot["continuation_mode"] = shot_continuation_mode

        shots_list.append(shot)
        stitched_frames += delivered_frames

    # 下一个 shot 以精确交付时间线校准；H3 网格补帧不参与时间线累加。
    for offset, shot in enumerate(shots_list[1:], start=1):
        shot_context = int(shot.get("context_trim_frames", 0) or 0)
        shot["generation_start_frame"] = max(
            0, sum(s["delivered_frames"] for s in shots_list[:offset]) - shot_context
        )
        shot["audio_start_seconds"] = shot["generation_start_frame"] / float(fps)

    reference_media = [
        {
            "id": item.get("id", ""),
            "type": item.get("type", "image"),
            "filename": item.get("filename", ""),
            "name": item.get("name", ""),
            "role": item.get("role", ""),
            "purpose": item.get("purpose", ""),
            "retention": item.get("retention", ""),
            "use_embedded_audio": bool(item.get("useEmbeddedAudio", False)),
            "speaker_id": item.get("speakerId", ""),
            "duration": float(item.get("duration", 0.0) or 0.0),
            "trim_start": float(item.get("trimStart", 0.0) or 0.0),
            "trim_end": float(item.get("trimEnd", item.get("duration", 0.0)) or 0.0),
        }
        for item in _project_media(project)
    ]
    reference_fingerprint = _fingerprint(reference_media)
    external_generation_fingerprint = str(generation_fingerprint or "").strip()
    resolved_generation_fingerprint = _fingerprint({
        "external": external_generation_fingerprint,
        "references": reference_fingerprint,
    })

    compatibility = {
        "fps": fps,
        "width": width,
        "height": height,
        "context_length": context_length,
        "encode_mode": encode_mode,
        "anchor_mode": anchor_mode,
        "crop": crop,
        "audio_mode": audio_mode,
        "audio_context_length": audio_context_length,
        "segment_crf": segment_crf,
        "video_blend_frames": video_blend_frames,
        "generation_fingerprint": resolved_generation_fingerprint,
        "generation_fingerprint_source": external_generation_fingerprint,
        "reference_fingerprint": reference_fingerprint,
    }
    if continuation_mode != "guide":
        compatibility["continuation_mode"] = continuation_mode
    context_storage_length = max([context_length] + resolved_context_lengths)
    if context_storage_length > context_length:
        compatibility["context_storage_length"] = context_storage_length

    plan = {
        "spec": "h3-prompt-spec@1.0",
        "version": H3_PLAN_VERSION,
        "workflow_type": workflow_type,
        "run_name": run_name,
        "prompt_prefix": prompt_prefix,
        "defaults": {"duration_seconds": float(_safe_get(project, "globalDuration", 7) or 7), "steps": steps},
        "shots": shots_list,
        "compatibility": compatibility,
        "segment_crf": segment_crf,
        "total_delivered_frames": stitched_frames,
        "reference_media": reference_media,
    }
    post_production = _pv_post_production(project)
    if post_production:
        plan["post_production"] = post_production
    plan["preflight"] = _build_plan_preflight(project, plan, scenes)
    plan["plan_hash"] = _fingerprint({
        "compatibility": compatibility,
        "reference_media": plan["reference_media"],
        "shots": [{k: v for k, v in shot.items()
                   if k not in ("prompt", "scene_prompt")}
                  for shot in shots_list],
    })

    continuation_summary = (
        resolved_continuation_modes[0]
        if len(set(resolved_continuation_modes)) == 1 else "mixed"
    )
    media_counts = {
        media_type: sum(1 for item in plan["reference_media"] if item.get("type") == media_type)
        for media_type in ("image", "video", "audio")
    }
    plan["summary"] = (
        f"{len(shots_list)} clips; {stitched_frames} delivered frames "
        f"({stitched_frames / float(fps):.3f}s) at {width}x{height}; "
        f"context={context_length}/{continuation_summary}; "
        f"blend={video_blend_frames}; audio={audio_mode}; "
        f"refs={media_counts['image']}/{media_counts['video']}/{media_counts['audio']}; "
        f"preflight={'ok' if plan['preflight']['ok'] else 'failed'}"
        f"/{len(plan['preflight']['warnings'])}w; run={run_name}"
    )

    return plan


def export_context_loop_plan_json(plan):
    """Return the editable JSON contract consumed by Context Loop's Plan node.

    Eagle's runtime Plan contains both ``prompt_prefix`` and a resolved full
    ``prompt`` per scene.  Passing that dict back into the third-party Plan node
    would prepend the shared prefix twice, so the bridge intentionally exports
    each scene's ``scene_prompt`` as its authoring prompt.
    """
    plan = plan if isinstance(plan, dict) else {}
    shots = []
    for source in plan.get("shots") or []:
        if not isinstance(source, dict):
            continue
        shot = {
            "id": source.get("id", ""),
            "prompt": source.get("scene_prompt", source.get("prompt", "")),
            "length": source.get("raw_frames", source.get("length")),
            "seed": str(source.get("seed", 0)),
            "steps": source.get("steps", 8),
        }
        for key in (
            "context_length", "audio_context_length", "continuation_mode",
            "video_blend_frames",
        ):
            if key in source:
                shot[key] = source[key]
        shots.append(shot)
    payload = {
        "prompt_prefix": plan.get("prompt_prefix", ""),
        "defaults": dict(plan.get("defaults") or {}),
        "shots": shots,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


# ────────────────────────────────────────────────────────────────────────────
# 导演 Skill（LLM 生成台本 / 分镜 / 台词）
# ────────────────────────────────────────────────────────────────────────────
#
# 设计：手动「生成」按钮 → 前端写入 skill_request 隐藏控件并 queuePrompt →
# execute() 消费该请求，按 skill 配置调用 API / 本地模型，结果经
# PromptServer.send_sync 推回前端回填。本地优先（避免把数据发给第三方 API）。

_SKILL_SYSTEM = (
    "You are a professional H3 (MiniMax H3) video director assistant. "
    "You turn dramatic intent into editable, camera-ready coverage for AI video generation. "
    "Every camera move and cut must have a narrative motivation. Preserve screen direction, "
    "eyelines, action continuity, subject identity, spatial geography, and duration budget. "
    "Prefer precise staging, shot scale, motion path, speed curve, transition bridge, sound cue, "
    "and end composition over vague cinematic adjectives. "
    "Always respond with valid JSON only, no extra commentary."
)

_INTERNAL_DIRECTOR_PROFILES = {
    "balanced": (
        "Use classical coverage: establish geography, develop action with motivated medium coverage, "
        "reserve close-ups for emotional or informational turns, and finish on a visual or sound hook."
    ),
    "cinematic": (
        "Favor controlled blocking, layered foreground/midground/background composition, motivated "
        "dolly or arc movement, restrained lens changes, and visual match cuts. Avoid random camera motion."
    ),
    "dynamic": (
        "Build escalating kinetic coverage using tracking, leading/trailing movement, cut-on-action, "
        "foreground wipes and speed contrast. Keep axis, direction and action phase continuous."
    ),
    "intimate": (
        "Prioritize performance, eyelines, breath, hands and reaction shots. Use slow push-ins, selective "
        "focus and sound bridges; keep movement subtle and let emotional beats breathe."
    ),
    "commercial": (
        "Use clean product/subject reveals, graphic composition, controlled highlights, rhythmic inserts, "
        "feature-to-benefit causality and a decisive hero ending."
    ),
}


def _filter_director_skill_for_task(text, task):
    """Keep only composed Markdown skill sections applicable to the current task."""
    text = str(text or "").strip()
    if not text:
        return ""
    sections = re.split(r"\n\s*---\s*\n", text)
    selected = []
    for section in sections:
        task_match = re.search(r"tasks\s*:\s*([^\n>|]+)", section, flags=re.I)
        if task_match:
            allowed = {item.strip().lower() for item in task_match.group(1).split(",") if item.strip()}
            if allowed and task.lower() not in allowed and "all" not in allowed:
                continue
        selected.append(section.strip())
    return "\n\n---\n\n".join(item for item in selected if item)


def _compose_director_guidance(task, request, director_skill):
    request = request if isinstance(request, dict) else {}
    profile_name = str(request.get("profile") or "balanced").lower()
    profile = _INTERNAL_DIRECTOR_PROFILES.get(profile_name, _INTERNAL_DIRECTOR_PROFILES["balanced"])
    external = _filter_director_skill_for_task(director_skill, task)
    policy = str(request.get("skillPolicy") or "merge").lower()
    if policy == "external_only" and external:
        return external
    if policy == "internal_only" or not external:
        return "## Internal directing profile: %s\n\n%s" % (profile_name, profile)
    return (
        "## Internal directing profile: %s\n\n%s\n\n---\n\n"
        "## Connected Director Skill layers\n\n%s" % (profile_name, profile, external)
    )


def _select_transport(api_config, local_model, pref):
    """返回 (kind, transport_dict)。kind 为 'api' / 'local' / None。"""
    local_ok = isinstance(local_model, dict) and bool(local_model.get("path"))
    api_key, api_base, api_model = "", "", ""
    api_ok = False
    if isinstance(api_config, (tuple, list)) and len(api_config) >= 3:
        api_key, api_base, api_model = api_config[0], api_config[1], api_config[2]
        if api_key and api_base and api_model:
            api_ok = True
    pref = (pref or "local").lower()
    if pref == "api":
        if api_ok:
            return ("api", {"key": api_key, "base": api_base, "model": api_model})
        if local_ok:
            return ("local", {"path": local_model["path"], "handle": local_model})
    else:  # local 优先（默认）
        if local_ok:
            return ("local", {"path": local_model["path"], "handle": local_model})
        if api_ok:
            return ("api", {"key": api_key, "base": api_base, "model": api_model})
    if api_ok:
        return ("api", {"key": api_key, "base": api_base, "model": api_model})
    if local_ok:
        return ("local", {"path": local_model["path"], "handle": local_model})
    return (None, None)


def _run_api(transport, system, user, temperature):
    import requests
    key = transport["key"]
    if decode_api_key:
        key = decode_api_key(key) or key
    base = (transport["base"] or "").rstrip("/")
    url = base + "/chat/completions"
    payload = {
        "model": transport["model"],
        "temperature": max(0.0, min(2.0, float(temperature))),
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "response_format": {"type": "json_object"},
    }
    try:
        resp = requests.post(
            url,
            headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
            json=payload, timeout=180,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        raise RuntimeError("API 调用失败: " + str(e))


def _run_local(transport, system, user, temperature):
    from .local_llm_node import (
        generate_local_text, _run_llamacpp_inference, ensure_local_model_handle,
    )
    handle = transport.get("handle") if isinstance(transport, dict) else None
    if isinstance(handle, dict) and handle.get("released"):
        ensure_local_model_handle(handle)
    if isinstance(handle, dict) and handle.get("backend") == "llama.cpp" and handle.get("llm") is not None:
        text, error, _elapsed = _run_llamacpp_inference(
            handle["llm"], [], user, system,
            2048, max(0.05, min(2.0, float(temperature))), 0.95, True, -1,
            bool(handle.get("thinking", False)), int(handle.get("thinking_budget", 4096) or 4096), 1.0,
        )
        if error:
            raise RuntimeError(error)
        return text
    return generate_local_text(
        model_path=transport["path"],
        system_prompt=system,
        user_prompt=user,
        device="auto",
        dtype="bf16",
        max_new_tokens=2048,
        temperature=max(0.05, min(2.0, float(temperature))),
        top_p=0.95,
    )


def _call_llm(kind, transport, system, user, temperature):
    if kind == "api":
        return _run_api(transport, system, user, temperature)
    if kind == "local":
        return _run_local(transport, system, user, temperature)
    raise RuntimeError("未连接任何模型（API / 本地大模型）。")


def _extract_json(text):
    """从模型输出中稳健提取 JSON 对象。"""
    if not text:
        return None
    text = text.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    s = text.find("{")
    e = text.rfind("}")
    if s != -1 and e != -1 and e > s:
        try:
            return json.loads(text[s:e + 1])
        except Exception:
            return None
    return None


def _pv_history_records(value):
    """Normalize workflow/node PV history without trusting its shape."""
    if isinstance(value, str):
        try:
            value = json.loads(value) if value.strip() else []
        except Exception:
            value = []
    if isinstance(value, dict):
        value = value.get("records") or value.get("history") or []
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value[-50:] if isinstance(item, dict)]


def _pv_action_profile(text):
    value = str(text or "").lower()
    keyword_groups = (
        ("combat", ("combat", "battle", "fight", "sword", "weapon", "warrior", "战斗", "武器", "剑", "攻击", "招式")),
        ("idol", ("idol", "stage", "dance", "sing", "concert", "偶像", "舞台", "跳舞", "唱歌", "演出")),
        ("energetic", ("run", "jump", "chase", "sport", "energetic", "奔跑", "跳跃", "追逐", "运动", "活力")),
        ("mysterious", ("mystery", "dark", "shadow", "mask", "secret", "神秘", "暗", "阴影", "面具", "秘密")),
        ("comedic", ("comic", "funny", "meme", "cute reaction", "搞笑", "喜剧", "表情包", "反应")),
        ("graceful", ("elegant", "grace", "fashion", "dress", "dance", "优雅", "礼服", "时尚", "舞蹈")),
    )
    for profile, keywords in keyword_groups:
        if any(keyword in value for keyword in keywords):
            return profile
    return "calm"


def _pv_card_fingerprint(card):
    keys = ("theme", "visualStyle", "editGrammar", "template", "rhythm", "actionProfile")
    raw = "|".join(str(card.get(key) or "") for key in keys)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _pv_choice(rng, values, preferred=None):
    values = list(values)
    preferred = [item for item in (preferred or []) if item in values]
    if preferred and rng.random() < 0.72:
        return rng.choice(preferred)
    return rng.choice(values)


def _pv_director_skill(card):
    transitions = ", ".join(card.get("transitions") or []) or "hard_cut"
    effects = ", ".join(card.get("effects") or []) or "none"
    return (
        "## H3 Character PV creative card\n\n"
        f"- Theme: {_PV_THEMES.get(card.get('theme'), card.get('theme', 'auto'))}.\n"
        f"- Visual style: {_PV_VISUAL_STYLES.get(card.get('visualStyle'), card.get('visualStyle', 'auto'))}.\n"
        f"- Editing grammar: {_PV_EDIT_GRAMMARS.get(card.get('editGrammar'), card.get('editGrammar', 'auto'))}.\n"
        f"- Character action: {_PV_ACTION_PROFILES.get(card.get('actionProfile'), card.get('actionProfile', 'calm'))}.\n"
        f"- Rhythm: {_PV_RHYTHMS.get(card.get('rhythm'), card.get('rhythm', 'beat_sync'))}; "
        f"{card.get('bpm', 120)} BPM; {card.get('cutDensity', 'medium')} density.\n"
        f"- Post transitions: {transitions}.\n- Post effects: {effects}.\n"
        f"- Action direction: {card.get('actionDirection') or 'derive one readable action from the character and brief'}.\n"
        "- Generate stable, clean plates. Do not paint exact text, logos, glitches or transition artifacts into H3 frames.\n"
        f"- Typography metadata: {_PV_TEXT_TREATMENTS.get(card.get('textTreatment'), 'post-production title')}.\n"
        "- Avoid repeating the recent action signature, shot order and transition pair recorded in creative history."
    )


def generate_pv_cards(character_context="", creative_brief="", draw_mode="character_match",
                      card_count=3, seed=0, history=None, model_mode="auto",
                      api_config=None, local_model=None, model_pref="local", temperature=0.75):
    """Create constrained AE/PV cards locally and optionally let an attached LLM select/refine one."""
    history_records = _pv_history_records(history)
    recent_fingerprints = {str(item.get("fingerprint") or "") for item in history_records[-24:]}
    try:
        count = max(1, min(8, int(card_count or 3)))
    except (TypeError, ValueError):
        count = 3
    try:
        seed_value = int(seed or 0)
    except (TypeError, ValueError):
        seed_value = 0
    rng = random.Random(seed_value)
    profile = _pv_action_profile("\n".join((str(character_context or ""), str(creative_brief or ""))))
    preferences = {
        "calm": {
            "theme": ["quiet_portrait", "dream_archive", "fashion_editorial"],
            "style": ["luxury_editorial", "retro_film", "minimal_monochrome"],
            "grammar": ["detail_to_hero", "eyeline_bridge", "color_match"],
            "template": ["character_reveal", "emotional_memory", "fashion_editorial"],
        },
        "graceful": {
            "theme": ["fashion_editorial", "dream_archive", "festival_stage"],
            "style": ["luxury_editorial", "anime_cel", "ink_paper"],
            "grammar": ["detail_to_hero", "foreground_wipe", "match_on_action"],
            "template": ["fashion_editorial", "character_reveal", "emotional_memory"],
        },
        "energetic": {
            "theme": ["urban_chase", "festival_stage", "tech_interface"],
            "style": ["y2k_digital", "holographic", "live_action_cinematic"],
            "grammar": ["match_on_action", "time_remap", "beat_strobe"],
            "template": ["action_showcase", "image_flash", "mixed_pv"],
        },
        "combat": {
            "theme": ["dark_rival", "fantasy_relic", "urban_chase"],
            "style": ["anime_cel", "graphic_comic", "live_action_cinematic"],
            "grammar": ["match_on_action", "freeze_smash", "foreground_wipe"],
            "template": ["action_showcase", "mixed_pv", "character_reveal"],
        },
        "idol": {
            "theme": ["neon_idol", "festival_stage", "tech_interface"],
            "style": ["anime_cel", "y2k_digital", "holographic"],
            "grammar": ["beat_strobe", "color_match", "split_screen"],
            "template": ["image_flash", "mixed_pv", "kinetic_typography"],
        },
        "mysterious": {
            "theme": ["dark_rival", "fantasy_relic", "dream_archive"],
            "style": ["minimal_monochrome", "retro_film", "ink_paper"],
            "grammar": ["detail_to_hero", "shape_match", "foreground_wipe"],
            "template": ["character_reveal", "emotional_memory", "mixed_pv"],
        },
        "comedic": {
            "theme": ["festival_stage", "tech_interface", "hero_origin"],
            "style": ["graphic_comic", "y2k_digital", "anime_cel"],
            "grammar": ["freeze_smash", "beat_strobe", "shape_match"],
            "template": ["image_flash", "mixed_pv", "action_showcase"],
        },
    }.get(profile, {})
    if draw_mode == "surprise":
        preferences = {}
    elif draw_mode == "balanced":
        preferences = {key: value[:1] for key, value in preferences.items()}

    cards = []
    attempts = 0
    while len(cards) < count and attempts < count * 80:
        attempts += 1
        card = {
            "schema": "eagle-h3-pv-card@1.0",
            "theme": _pv_choice(rng, [key for key in _PV_THEMES if key != "auto"], preferences.get("theme")),
            "visualStyle": _pv_choice(rng, [key for key in _PV_VISUAL_STYLES if key != "auto"], preferences.get("style")),
            "editGrammar": _pv_choice(rng, [key for key in _PV_EDIT_GRAMMARS if key != "auto"], preferences.get("grammar")),
            "template": _pv_choice(rng, _PV_TEMPLATES, preferences.get("template")),
            "rhythm": _pv_choice(rng, _PV_RHYTHMS, ["beat_sync", "syncopated", "crescendo"]),
            "cutDensity": _pv_choice(rng, ("sparse", "medium", "dense"), ["medium"]),
            "bpm": rng.randrange(84, 161, 4),
            "beatOffsetMs": 0,
            "transitions": rng.sample(sorted(_PV_TRANSITIONS), rng.randint(2, 4)),
            "effects": rng.sample(sorted(_PV_EFFECTS), rng.randint(2, 4)),
            "actionProfile": profile,
            "textTreatment": rng.choice(list(_PV_TEXT_TREATMENTS)),
            "reserveTitleSafeArea": True,
            "allowVideoReference": True,
            "actionDirection": _PV_ACTION_PROFILES[profile],
            "creativeBrief": str(creative_brief or "").strip(),
        }
        card["fingerprint"] = _pv_card_fingerprint(card)
        if card["fingerprint"] in recent_fingerprints or any(
                item.get("fingerprint") == card["fingerprint"] for item in cards):
            continue
        card["id"] = "pv-card-" + card["fingerprint"]
        card["name"] = "%s · %s" % (
            card["theme"].replace("_", " ").title(),
            card["editGrammar"].replace("_", " ").title(),
        )
        card["directorSkill"] = _pv_director_skill(card)
        cards.append(card)

    if not cards:
        raise RuntimeError("无法创建不重复的 PV 创意卡。")

    selected_index = 0
    transport_kind = "local_cards"
    model_note = "未调用语言模型；使用受控创意库与角色动作匹配。"
    kind, transport = _select_transport(api_config, local_model, model_pref)
    should_use_model = str(model_mode or "auto") != "local_only" and bool(kind)
    if should_use_model:
        system = (
            "You are an expert character-PV editor. Select the strongest constrained candidate for "
            "the supplied character and brief. Do not invent unsupported enum values. Return JSON only. "
            "Exact readable typography must remain post-production metadata, never generated pixels."
        )
        user = (
            "Character/context:\n" + (str(character_context or "").strip() or "(not supplied)") +
            "\n\nCreative brief:\n" + (str(creative_brief or "").strip() or "(open brief)") +
            "\n\nCandidates:\n" + json.dumps(cards, ensure_ascii=False) +
            "\n\nReturn ONLY: {\"selected_index\":0,\"reason\":\"...\","
            "\"action_direction\":\"one concrete non-repetitive action arc\","
            "\"title_concept\":\"post-production typography concept\"}."
        )
        try:
            parsed = _extract_json(_call_llm(kind, transport, system, user, temperature))
            if isinstance(parsed, dict):
                selected_index = max(0, min(len(cards) - 1, int(parsed.get("selected_index", 0) or 0)))
                selected = cards[selected_index]
                if str(parsed.get("reason") or "").strip():
                    selected["aiReason"] = str(parsed["reason"]).strip()[:1200]
                if str(parsed.get("action_direction") or "").strip():
                    selected["actionDirection"] = str(parsed["action_direction"]).strip()[:1600]
                if str(parsed.get("title_concept") or "").strip():
                    selected["titleConcept"] = str(parsed["title_concept"]).strip()[:800]
                selected["directorSkill"] = _pv_director_skill(selected)
                transport_kind = kind
                model_note = "已由%s模型按角色和简述择优并精修动作。" % ("本地" if kind == "local" else "API")
        except Exception as exc:
            model_note = "模型精修失败，已安全回退到本地抽卡：" + str(exc)
    elif str(model_mode or "auto") == "model_refine" and not kind:
        model_note = "未连接可用模型，已回退到本地抽卡。"

    selected = cards[selected_index]
    record = {
        "fingerprint": selected["fingerprint"],
        "theme": selected["theme"],
        "visualStyle": selected["visualStyle"],
        "editGrammar": selected["editGrammar"],
        "actionProfile": selected["actionProfile"],
        "actionDirection": selected.get("actionDirection", ""),
        "createdAt": int(time.time()),
    }
    updated_history = (history_records + [record])[-50:]
    summary = "%s｜%s｜%s｜%s" % (
        selected["theme"], selected["visualStyle"], selected["editGrammar"], model_note,
    )
    return {
        "schema": "eagle-h3-pv-draw@1.0",
        "cards": cards,
        "selected_index": selected_index,
        "selected": selected,
        "history": updated_history,
        "history_schema": "eagle-h3-pv-history@1.0",
        "transport": transport_kind,
        "summary": summary,
        "model_note": model_note,
    }


def _scene_duration_budget(scene):
    """Return a stable scene duration budget for all chained skill tasks."""
    try:
        seconds = float(scene.get("defaultSeconds", 10) or 10)
    except (TypeError, ValueError):
        seconds = 10.0
    seconds = max(0.1, seconds)
    label = f"{seconds:.3f}".rstrip("0").rstrip(".")
    return seconds, label


def _skill_reference_context(project, scene):
    """Describe stable native reference tags to the model without reading media pixels."""
    disabled = set(_disabled_scene_tokens(scene))
    lines = []
    for item, number, tag_name in _numbered_media(project):
        token = f"<{tag_name} {number}>"
        if token in disabled:
            continue
        media_type = str(item.get("type") or "image")
        name = str(item.get("name") or item.get("originalName") or item.get("filename") or "").strip()
        kind = str(item.get("kind") or "reference").strip()
        role = str(item.get("role") or _default_media_role(media_type, kind)).strip()
        purpose = str(item.get("purpose") or "").strip()
        retention = str(item.get("retention") or "").strip()
        details = [media_type, role]
        if name:
            details.append(name)
        if purpose:
            details.append("用途=" + purpose)
        if retention:
            details.append(retention)
        if media_type == "video":
            details.append("原声=" + ("启用" if item.get("useEmbeddedAudio") else "关闭"))
        lines.append(f"- {token}: " + " | ".join(details))
    if not lines:
        return "【当前场景可用参考素材】\n(无)\n"
    return (
        "【当前场景可用参考素材】\n" + "\n".join(lines) + "\n"
        "仅在语义确实匹配时使用上述原生标签；必须逐字保留标签，"
        "不得虚构未列出的 <Picture N>/<Video N>/<Audio N>。\n"
    )


def _adjacent_scene_context(scenes, scene_index):
    """Compact handoff context for chained generation across an arbitrary scene count."""
    if not isinstance(scenes, list) or not (0 <= scene_index < len(scenes)):
        return ""
    lines = []
    if scene_index > 0:
        previous = scenes[scene_index - 1] if isinstance(scenes[scene_index - 1], dict) else {}
        previous_text = _active_scene_text(previous, previous.get("preamble", ""))
        previous_shots = previous.get("shots") or []
        tail = ""
        if previous_shots and isinstance(previous_shots[-1], dict):
            tail = str(previous_shots[-1].get("content") or "").strip()
        if not tail:
            tail = previous_text[-1200:]
        lines.append(
            "上一场景：%s（%s 秒）\n承接结尾：%s" % (
                str(previous.get("title") or "未命名"),
                str(previous.get("defaultSeconds") or 10),
                tail or "(尚无内容)",
            )
        )
    if scene_index + 1 < len(scenes):
        following = scenes[scene_index + 1] if isinstance(scenes[scene_index + 1], dict) else {}
        lines.append(
            "下一场景：%s（%s 秒）；当前场景结尾应留下可执行的视觉/动作承接。" % (
                str(following.get("title") or "未命名"),
                str(following.get("defaultSeconds") or 10),
            )
        )
    return "【相邻场景承接】\n" + "\n\n".join(lines) + "\n" if lines else ""


def _generation_memory_context(project, scenes, scene_index):
    """Summarize already-used creative choices so the next LLM pass can vary them deliberately."""
    records = project.get("generationHistory") if isinstance(project, dict) else []
    records = records if isinstance(records, list) else []
    used_actions, used_cameras, used_transitions = [], [], []
    for record in records[-24:]:
        if not isinstance(record, dict):
            continue
        used_actions.extend(str(item).strip() for item in (record.get("actions") or []) if str(item).strip())
        used_cameras.extend(str(item).strip() for item in (record.get("cameras") or []) if str(item).strip())
        used_transitions.extend(str(item).strip() for item in (record.get("transitions") or []) if str(item).strip())
    if isinstance(scenes, list):
        for prior in scenes[:max(0, scene_index)]:
            if not isinstance(prior, dict):
                continue
            for shot in (prior.get("shots") or []):
                if not isinstance(shot, dict):
                    continue
                for target, key in ((used_actions, "action"), (used_cameras, "camera")):
                    value = str(shot.get(key) or "").strip()
                    if value:
                        target.append(value)
                for key in ("transitionIn", "transitionOut"):
                    value = str(shot.get(key) or "").strip()
                    if value:
                        used_transitions.append(value)
    pv_cfg = _safe_get(project, "pv", {}) or {}
    pv_history = _pv_history_records(pv_cfg.get("history", []) if isinstance(pv_cfg, dict) else [])
    recent_cards = [
        "%s/%s/%s/%s" % (
            item.get("theme", ""), item.get("visualStyle", ""),
            item.get("editGrammar", ""), item.get("actionProfile", ""),
        ) for item in pv_history[-8:]
    ]
    def unique_tail(values, limit=8):
        out = []
        for value in values:
            compact = re.sub(r"\s+", " ", value).strip()
            if compact and compact not in out:
                out.append(compact)
        return out[-limit:]
    actions = unique_tail(used_actions)
    cameras = unique_tail(used_cameras)
    transitions = unique_tail(used_transitions)
    if not any((actions, cameras, transitions, recent_cards)):
        return ""
    lines = [
        "【创作记忆 / 去重复约束】",
        "以下是已使用内容，不得逐字复刻动作弧、连续相同景别顺序或相同转场组合；剧情必须承接时可保留主体意图，但应改变动作路径、机位或节奏。",
    ]
    if actions:
        lines.append("- 近期动作：" + " | ".join(actions))
    if cameras:
        lines.append("- 近期运镜：" + " | ".join(cameras))
    if transitions:
        lines.append("- 近期转场：" + " | ".join(transitions))
    if recent_cards:
        lines.append("- 近期 PV 卡：" + " | ".join(recent_cards))
    lines.append("- 优先匹配角色当前姿态、道具、服装活动范围与情绪，再选择可自然衔接的相似动作；禁止仅替换同义词制造伪变化。")
    return "\n".join(lines) + "\n"


def _scene_memory_record(scene):
    shots = scene.get("shots") if isinstance(scene, dict) else []
    shots = shots if isinstance(shots, list) else []
    actions, cameras, transitions = [], [], []
    for shot in shots:
        if not isinstance(shot, dict):
            continue
        if str(shot.get("action") or "").strip():
            actions.append(str(shot["action"]).strip()[:300])
        if str(shot.get("camera") or "").strip():
            cameras.append(str(shot["camera"]).strip()[:300])
        for key in ("transitionIn", "transitionOut"):
            if str(shot.get(key) or "").strip():
                transitions.append(str(shot[key]).strip()[:160])
    raw = json.dumps([actions, cameras, transitions], ensure_ascii=False, sort_keys=True)
    return {
        "sceneId": scene.get("id"),
        "fingerprint": hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16],
        "actions": actions[-8:], "cameras": cameras[-8:], "transitions": transitions[-8:],
        "createdAt": int(time.time()),
    }


def _build_skill_prompts(task, project, scene, hint, director_skill="", request=None):
    """返回 (system, user) 提示词。"""
    foundation = (project.get("foundation") or "").strip()
    director_skill = (director_skill or project.get("director_skill") or "").strip()
    director_skill = _compose_director_guidance(task, request, director_skill)
    if str(project.get("workflowType") or "") == "character_pv":
        director_skill += (
            "\n\n## Adaptive PV grammar override\n\n"
            "The Hook/Reveal/Signature/Impact/Hero-Hold pattern is optional vocabulary, not a mandatory "
            "five-part template. Build the number and order of beats from the selected theme, editing "
            "grammar, character action, source material, duration and music. Vary action paths, shot order "
            "and transition pairs against creative memory; preserve intentional story continuity. Keep "
            "readable text as post-production metadata only."
        )
    title = (scene.get("title") or "").strip() or "未命名场景"
    preamble = _active_scene_text(scene, scene.get("preamble") or "")
    _duration_seconds, duration_label = _scene_duration_budget(scene)
    duration_context = f"【场景时长预算】{duration_label} 秒（以导演台当前场景设置为准）\n"
    director_ctx = ""
    if director_skill:
        director_ctx = "【导演技能库 / Director Skill】\n" + director_skill + "\n\n"
    request = request if isinstance(request, dict) else {}
    prompt_language = str(request.get("promptLanguage") or "en").lower()
    prompt_language = "zh" if prompt_language == "zh" else "en"
    dialogue_language = str(request.get("dialogueLanguage") or "Chinese").strip() or "Chinese"
    visual_language = "简体中文" if prompt_language == "zh" else "English"
    format_rules = (
        "【MiniMax H3 输出规范】\n"
        f"- 所有画面、主体、动作、场景、灯光、镜头与声音描述必须统一使用 {visual_language}，不得中英混写。\n"
        f"- 台词必须写为 <d>[{dialogue_language}] 原文</d>；角色名和稳定 (S1)/(S2) 编号写在标签外。\n"
        "- 每镜按 主体与动作 → 环境与光线 → 景别与构图 → 运镜 → 声音 的顺序写成自包含描述。\n"
        "- camera 字段使用自然语言运镜：Truck/Pan/Push/Pull/Pedestal/Tilt/Zoom/"
        "Arc Shot/Tracking Shot/Static Shot，必要时补充幅度与速度；不要堆叠方括号命令。\n"
        "- 原生 <Picture N>/<Video N>/<Audio N> 标签必须逐字保留，不能翻译、改号或拆开。\n"
        "- 剪辑时间统一使用 MM:SS.mmm；区间使用 start --> end，帧区间使用半开区间 [start,end)。"
        " 剪辑时间不得用 H3 的 17k+5 生成帧长反向改写。\n"
    )
    reference_ctx = _skill_reference_context(project, scene)
    chain_ctx = str(request.get("_chainContext") or "")
    directive_project = dict(project)
    if isinstance(request.get("interaction"), dict):
        directive_project["interaction"] = request["interaction"]
    if isinstance(request.get("pv"), dict):
        directive_project["pv"] = request["pv"]
    project_directives = "\n\n".join(filter(None, (
        _build_interaction_directive(directive_project, scene),
        _build_pv_directive(directive_project, scene),
    )))
    memory_ctx = str(request.get("_memoryContext") or "")
    common_ctx = reference_ctx + (chain_ctx + "\n" if chain_ctx else "")
    if memory_ctx:
        common_ctx += memory_ctx + "\n"
    if project_directives:
        common_ctx += "【项目专项合同】\n" + project_directives + "\n"
    if task == "script":
        user = (
            "【Shared prompt / 世界构建】\n" + (foundation or "(无，请自行设定统一风格)") + "\n\n"
            + common_ctx + "\n" + format_rules + "\n"
            "【场景标题】" + title + "\n"
            + duration_context +
            "【用户额外指令】" + (hint or "(无)") + "\n\n"
            "请撰写该场景的完整台本（screenplay）。要求：\n"
            "1. 用 [Shot 1]、[Shot 2]… 标记划分镜头；\n"
            f"2. 根据 {duration_label} 秒的场景总预算决定镜头数量和节奏；"
            f"各镜头时长合计约为 {duration_label} 秒，"
            "不要套用固定的 10 秒单镜头假设；\n"
            f"3. 每镜单独写一行精确剪辑区间：Time range: MM:SS.mmm --> MM:SS.mmm | "
            f"frames [start,end) @ {int(project.get('fps') or H3_FPS)} fps | Duration: 0.000 s；"
            "最后一镜出点必须等于场景总预算；\n"
            f"4. 每个镜头写{visual_language}描述（主体 / 动作 / 运镜 / 氛围）且自包含，"
            "不得出现“如前所述”“同上”等承接语；\n"
            f"5. 发声者按首次发声顺序稳定编号，例：角色名 (S1) says: "
            f"<d>[{dialogue_language}] 简洁台词</d>；\n"
            "6. 输出 ONLY JSON：{\"preamble\":\"...\"}\n"
        )
        return _SKILL_SYSTEM, director_ctx + user
    if task == "shots":
        user = (
            "【场景标题】" + title + "\n"
            + duration_context +
            common_ctx + "\n" + format_rules + "\n" +
            "【现有台本】\n" + (preamble or "(空)") + "\n\n"
            "请将台本拆分为镜头条目。输出 ONLY JSON：\n"
            "{\"shots\":[{\"title\":\"\",\"time\":\"00:00.000\",\"framing\":\"\","
            "\"content\":\"\",\"camera\":\"\",\"lens\":\"\",\"intent\":\"\","
            "\"action\":\"\",\"sound\":\"\",\"transitionIn\":\"\",\"transitionOut\":\"\","
            "\"estSeconds\":2.5}]}\n"
            f"要求：time 从 00:00.000 起并对齐 {int(project.get('fps') or H3_FPS)} fps 帧边界；"
            "每个 estSeconds 必须大于 0，"
            f"所有 estSeconds 之和约等于 {duration_label} 秒，且不得超出该场景预算；framing 用 "
            "extreme_close_up / close_up / medium_shot / cowboy_shot / full_body / wide_shot "
            f"之一或空；content、camera、action、sound 均使用 {visual_language}，"
            "camera 用自然语言表达运镜类型、幅度和速度。"
        )
        return _SKILL_SYSTEM, director_ctx + user
    if task == "dialogue":
        shots_context = json.dumps(scene.get("shots") or [], ensure_ascii=False)
        user = (
            "【场景标题】" + title + "\n"
            + duration_context +
            common_ctx + "\n" + format_rules + "\n" +
            "【现有台本】\n" + (preamble or "(空)") + "\n\n"
            "【已生成分镜】\n" + (shots_context or "[]") + "\n\n"
            "请提取 / 补全所有台词。输出 ONLY JSON：\n"
            f"{{\"dialogues\":[{{\"role\":\"角色名\",\"text\":\"{dialogue_language} 台词\",\"time\":\"00:00.000\"}}]}}\n"
            f"要求：text 为简洁的 {dialogue_language} 台词；time 为该句出现的大致时间码，"
            f"必须落在 0 至 {duration_label} 秒的场景范围内。"
        )
        return _SKILL_SYSTEM, director_ctx + user
    return _SKILL_SYSTEM, ""


def _build_skill_extraction_prompts(project, scene, source_prompt, hint=""):
    """Build a text-only request that turns a proven reference-video prompt into a reusable Skill."""
    source_prompt = str(source_prompt or "").strip()[:16000]
    reference_context = _skill_reference_context(project, scene)
    system = (
        "You are a senior prompt-systems designer. Extract a reusable H3 Director Skill from an "
        "existing video/image editing prompt. Generalize the method and constraints; do not copy "
        "character names, costumes, body traits, locations, or other one-off subject facts into the "
        "Skill. Preserve native placeholders such as <Picture N> and <Video N> as generic examples. "
        "A Director Skill is a Markdown playbook, not a finished shot prompt. Return valid JSON only."
    )
    user = (
        "【Available media roles (metadata only; media pixels are not inspected in this text pass)】\n"
        + reference_context + "\n"
        "【Successful/current prompt to reverse-engineer】\n" + (source_prompt or "(empty)") + "\n\n"
        "【Optional extraction note】\n" + (str(hint or "").strip() or "(none)") + "\n\n"
        "Return ONLY one JSON object with this schema:\n"
        '{"name":"short Chinese name","category":"video_to_image_editing",'
        '"tasks":["script","shots"],"tags":["video-reference","identity-lock"],'
        '"content":"Markdown"}\n'
        "The Markdown content must contain: Purpose, Required Inputs, Reference Ownership, "
        "Immutable Locks, Editable Dimensions, Motion/Camera Transfer, Prompt Construction Order, "
        "Forbidden Changes, and Validation Checklist. Explain how a reference video contributes "
        "motion, timing, camera, pose progression, or composition while a reference image owns "
        "identity/appearance. State an explicit fallback when either medium is absent."
    )
    return system, user


def run_director_skill(project, scenes, request, api_config=None, local_model=None, director_skill=""):
    """运行导演 Skill，返回 {scene_id, preamble, dialogues, shots, transport, error}。"""
    out = {
        "scene_id": request.get("sceneId"),
        "sceneId": request.get("sceneId"),
        "preamble": None, "dialogues": None, "shots": None,
        "transport": None, "error": None,
        "skill_profile": request.get("profile", "balanced"),
        "skill_policy": request.get("skillPolicy", "merge"),
        "requestId": request.get("requestId", ""),
        "batchId": request.get("batchId", ""),
        "batchIndex": request.get("batchIndex", 0),
        "batchTotal": request.get("batchTotal", 1),
        "mergeMode": request.get("mergeMode", "overwrite"),
        "operation": str(request.get("operation") or "generate_scene").strip().lower(),
    }
    try:
        requested_tasks = set(request.get("tasks") or [])
        # The generation chain is semantic, not checkbox-click order.
        tasks = [task for task in ("script", "shots", "dialogue") if task in requested_tasks]
        temperature = request.get("temperature", 0.7) or 0.7
        pref = request.get("modelPref", "local")
        hint = request.get("hint", "") or ""

        operation = out["operation"]
        if operation == "pv_draw":
            scene = next(
                (item for item in scenes if isinstance(item, dict)
                 and str(item.get("id")) == str(out.get("scene_id"))),
                {},
            )
            project_pv = project.get("pv") if isinstance(project.get("pv"), dict) else {}
            character_context = str(request.get("characterContext") or "").strip()
            if not character_context:
                character_context = "\n".join(filter(None, (
                    str(project.get("foundation") or "").strip(),
                    str(scene.get("title") or "").strip(),
                    _active_scene_text(scene, scene.get("preamble", ""))[:5000] if scene else "",
                )))
            draw = generate_pv_cards(
                character_context=character_context,
                creative_brief=request.get("creativeBrief") or project_pv.get("creativeBrief") or hint,
                draw_mode=request.get("drawMode") or project_pv.get("drawMode") or "character_match",
                card_count=request.get("cardCount") or project_pv.get("drawCount") or 3,
                seed=request.get("seed", project.get("baseSeed", 0)),
                history=request.get("history") or project_pv.get("history") or [],
                model_mode=request.get("modelMode") or project_pv.get("modelMode") or "auto",
                api_config=api_config, local_model=local_model, model_pref=pref,
                temperature=temperature,
            )
            out.update({
                "pvCards": draw["cards"], "selectedPv": draw["selected"],
                "pvHistory": draw["history"], "pvSummary": draw["summary"],
                "transport": draw["transport"],
            })
            return out

        kind, transport = _select_transport(api_config, local_model, pref)
        if not kind:
            out["error"] = ("未连接 API 或本地大模型，无法生成。请在节点上连接 "
                            "API_CONFIG（API 配置加载器）或 EAGLE_LOCAL_LLM_MODEL（本地大模型加载器）。")
            return out
        out["transport"] = kind

        scene = None
        scene_index = -1
        for index, candidate in enumerate(scenes):
            if str(candidate.get("id")) == str(out["scene_id"]):
                scene = candidate
                scene_index = index
                break
        if scene is None:
            out["error"] = f"目标场景不存在或 sceneId 已过期: {out['scene_id']}"
            return out
        out["scene_id"] = scene.get("id")
        out["sceneId"] = scene.get("id")

        if operation == "extract_skill":
            system_prompt, user_prompt = _build_skill_extraction_prompts(
                project,
                scene,
                request.get("sourcePrompt") or _active_scene_text(scene, scene.get("preamble", "")),
                request.get("hint", ""),
            )
            raw = _call_llm(kind, transport, system_prompt, user_prompt, temperature)
            parsed = _extract_json(raw)
            if not isinstance(parsed, dict) or not str(parsed.get("content") or "").strip():
                out["error"] = "Skill 反推失败：模型未返回有效的 Skill JSON。"
                return out
            out["skillDraft"] = {
                "name": str(parsed.get("name") or "视频参考编辑 Skill").strip(),
                "category": str(parsed.get("category") or "video_to_image_editing").strip(),
                "tasks": [
                    str(item).strip() for item in (parsed.get("tasks") or ["script", "shots"])
                    if str(item).strip() in ("script", "shots", "dialogue", "all")
                ] or ["script", "shots"],
                "tags": [str(item).strip() for item in (parsed.get("tags") or []) if str(item).strip()],
                "content": str(parsed.get("content") or "").strip(),
                "filmstrip": [],
            }
            return out

        cur = {
            "id": scene.get("id"),
            "title": scene.get("title", ""),
            "defaultSeconds": scene.get("defaultSeconds", 10),
            "preamble": scene.get("preamble", ""),
            "shots": scene.get("shots", []),
            "dialogues": scene.get("dialogues", []),
            "disabledTokens": scene.get("disabledTokens", []),
        }
        request_context = dict(request)
        request_context["_chainContext"] = _adjacent_scene_context(scenes, scene_index)
        request_context["_memoryContext"] = _generation_memory_context(project, scenes, scene_index)
        for task in tasks:
            if task not in ("script", "shots", "dialogue"):
                continue
            sys_p, user_p = _build_skill_prompts(
                task, project, cur, hint, director_skill, request=request_context
            )
            raw = _call_llm(kind, transport, sys_p, user_p, temperature)
            parsed = _extract_json(raw)
            if not parsed:
                out["error"] = (out.get("error") or "") + f" [{task}] 模型未返回有效 JSON。"
                continue
            if task == "script" and parsed.get("preamble") is not None:
                cur["preamble"] = parsed["preamble"]
            if task == "shots" and isinstance(parsed.get("shots"), list):
                cur["shots"] = parsed["shots"]
            if task == "dialogue" and isinstance(parsed.get("dialogues"), list):
                cur["dialogues"] = parsed["dialogues"]

        out["preamble"] = cur["preamble"]
        out["shots"] = cur["shots"]
        out["dialogues"] = cur["dialogues"]
        out["memoryRecord"] = _scene_memory_record(cur)
    except Exception as e:
        out["error"] = "生成失败: " + str(e)
    return out


# ────────────────────────────────────────────────────────────────────────────
# 参考图加载
# ────────────────────────────────────────────────────────────────────────────

def _fit_to_max_megapixels(img, max_mp, filename=None):
    """按最大百万像素限制等比缩放，保持 32 倍数（便于模型处理）。"""
    if not max_mp or max_mp <= 0:
        return img
    from PIL import Image
    w, h = img.size
    mp = (w * h) / 1_000_000.0
    if mp <= max_mp:
        return img
    scale = (max_mp / mp) ** 0.5
    new_w = max(32, int(round(w * scale / 32)) * 32)
    new_h = max(32, int(round(h * scale / 32)) * 32)
    try:
        resample = Image.LANCZOS if hasattr(Image, "LANCZOS") else Image.BILINEAR
        resized = img.resize((new_w, new_h), resample)
    except Exception:
        resized = img.resize((new_w, new_h), Image.BILINEAR)
    name = filename or "?"
    logger.info(
        f"[EagleH3Director] 参考图 {name} 从 {w}x{h} ({mp:.2f}MP) "
        f"缩放至 {new_w}x{new_h} (<= {max_mp}MP)"
    )
    return resized


def _load_ref_tensor(filename, max_megapixels=1.5):
    """加载单张参考图并限制像素量；兼容旧私有目录与 ComfyUI/input。"""
    try:
        from PIL import Image
        import numpy as np
        import torch
        path = _media_path(filename)
        if not path:
            return None
        img = Image.open(path).convert("RGB")
        img = _fit_to_max_megapixels(img, max_megapixels, filename=filename)
        arr = np.array(img).astype(np.float32) / 255.0
        return torch.from_numpy(arr)[None,]
    except Exception as e:
        logger.warning(f"[EagleH3Director] 参考图加载失败 {filename}: {e}")
        return None


def _media_path(filename):
    """Resolve legacy director media or a safe ComfyUI/input relative path."""
    if not filename:
        return ""
    value = str(filename).replace("\\", "/")

    input_path = _safe_input_path(value)
    if input_path and input_path.is_file():
        return str(input_path)

    legacy = os.path.join(REF_DIR, os.path.basename(value))
    return legacy if os.path.isfile(legacy) else ""


def _probe_media_duration(path, media_type):
    try:
        if media_type == "video":
            import cv2
            cap = cv2.VideoCapture(path)
            try:
                fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
                frames = float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
                return frames / fps if fps > 0 else 0.0
            finally:
                cap.release()
        if media_type == "audio":
            try:
                import soundfile as sf
                return float(sf.info(path).duration)
            except Exception:
                import torchaudio
                info = torchaudio.info(path)
                return float(info.num_frames) / float(info.sample_rate) if info.sample_rate else 0.0
    except Exception as e:
        logger.warning(f"[EagleH3Director] 无法读取媒体时长 {path}: {e}")
    return 0.0


def _load_video_tensor(filename, trim_start=0.0, trim_end=0.0, target_fps=24):
    path = _media_path(filename)
    if not path:
        return None
    cap = None
    try:
        import cv2
        import numpy as np
        import torch

        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            return None
        source_fps = float(cap.get(cv2.CAP_PROP_FPS) or target_fps or 24)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        duration = total_frames / source_fps if source_fps > 0 else 0.0
        start = max(0.0, float(trim_start or 0.0))
        end = float(trim_end or 0.0)
        if end <= start or (duration > 0 and end > duration):
            end = duration
        start_frame = max(0, int(round(start * source_fps)))
        end_frame = total_frames if end <= 0 else min(total_frames, int(round(end * source_fps)))
        step = max(1, int(round(source_fps / max(1, int(target_fps or 24)))))
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        frames = []
        frame_index = start_frame
        max_frames = H3_MAX_FRAMES
        while frame_index < end_frame and len(frames) < max_frames:
            ok, frame = cap.read()
            if not ok:
                break
            if (frame_index - start_frame) % step == 0:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                frames.append(torch.from_numpy(np.ascontiguousarray(rgb)).float() / 255.0)
            frame_index += 1
        return torch.stack(frames) if frames else None
    except Exception as e:
        logger.warning(f"[EagleH3Director] 参考视频加载失败 {filename}: {e}")
        return None
    finally:
        if cap is not None:
            cap.release()


def _load_audio_clip(filename, trim_start=0.0, trim_end=0.0):
    path = _media_path(filename)
    if not path:
        return None
    try:
        import torch
        try:
            # ComfyUI 自带的 PyAV 解码器同时支持音频文件和视频容器中的音轨。
            from comfy_extras.nodes_audio import load as comfy_load_audio
            waveform, sample_rate = comfy_load_audio(path)
        except Exception:
            try:
                import torchaudio
                waveform, sample_rate = torchaudio.load(path)
            except Exception:
                import soundfile as sf
                data, sample_rate = sf.read(path, always_2d=True, dtype="float32")
                waveform = torch.from_numpy(data.T.copy())
        start = max(0, int(round(float(trim_start or 0.0) * sample_rate)))
        end_seconds = float(trim_end or 0.0)
        end = int(round(end_seconds * sample_rate)) if end_seconds > 0 else waveform.shape[-1]
        end = min(waveform.shape[-1], max(start + 1, end))
        waveform = waveform[:, start:end].unsqueeze(0)
        return {"waveform": waveform, "sample_rate": int(sample_rate), "path": path}
    except Exception as e:
        logger.warning(f"[EagleH3Director] 参考音频加载失败 {filename}: {e}")
        return None


# ────────────────────────────────────────────────────────────────────────────
# 节点类
# ────────────────────────────────────────────────────────────────────────────

class EagleH3PVCreativeCardsNode:
    """Standalone constrained creative-card generator for character PV planning."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "character_context": ("STRING", {
                    "default": "", "multiline": True,
                    "tooltip": "角色外观、性格、道具、姿态或现有台本。用于匹配动作与主题，不读取图像像素。",
                }),
                "creative_brief": ("STRING", {
                    "default": "", "multiline": True,
                    "tooltip": "本轮 PV 方向、情绪、用途或必须避开的内容。",
                }),
                "draw_mode": (["角色匹配", "均衡探索", "惊喜随机"], {
                    "default": "角色匹配",
                }),
                "model_mode": (["自动（有模型则精修）", "仅本地抽卡", "必须模型精修（无模型时回退）"], {
                    "default": "自动（有模型则精修）",
                }),
                "card_count": ("INT", {"default": 3, "min": 1, "max": 8, "step": 1}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            },
            "optional": {
                "history_json": ("STRING", {
                    "default": "[]", "multiline": True, "forceInput": True,
                    "tooltip": "接回本节点 history_json，可跨队列避免重复创意组合。",
                }),
                "api_config": ("API_CONFIG", {"forceInput": True}),
                "local_model": ("EAGLE_LOCAL_LLM_MODEL", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("pv_cards_json", "selected_card_json", "director_skill", "history_json", "summary")
    OUTPUT_TOOLTIPS = (
        "本轮全部候选卡 JSON。", "模型/规则选中的 PV 卡 JSON。",
        "可接 H3 导演台 director_skill 的编排指令。",
        "去重复历史；接回 history_json 输入可在多次执行间延续。", "本轮抽卡摘要。",
    )
    DESCRIPTION = (
        "像抽卡一样组合角色 PV 的主题、风格、切镜语法、转场、特效与动作。"
        "未接模型时使用本地受控库；接入本地/API 模型后按角色和简述择优精修。"
    )
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台"

    def execute(self, character_context="", creative_brief="", draw_mode="角色匹配",
                model_mode="自动（有模型则精修）", card_count=3, seed=0,
                history_json="[]", api_config=None, local_model=None):
        draw_modes = {"角色匹配": "character_match", "均衡探索": "balanced", "惊喜随机": "surprise"}
        model_modes = {
            "自动（有模型则精修）": "auto", "仅本地抽卡": "local_only",
            "必须模型精修（无模型时回退）": "model_refine",
        }
        draw = generate_pv_cards(
            character_context=character_context, creative_brief=creative_brief,
            draw_mode=draw_modes.get(draw_mode, "character_match"),
            card_count=card_count, seed=seed, history=history_json,
            model_mode=model_modes.get(model_mode, "auto"),
            api_config=api_config, local_model=local_model,
        )
        return (
            json.dumps(draw["cards"], ensure_ascii=False, indent=2),
            json.dumps(draw["selected"], ensure_ascii=False, indent=2),
            draw["selected"]["directorSkill"],
            json.dumps({"schema": draw["history_schema"], "records": draw["history"]}, ensure_ascii=False),
            draw["summary"],
        )


class EagleH3DirectorNode:
    """Eagle H3 导演台：编剧工作台，输出标准 H3 提示词与参数。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "h3_state": ("STRING", {
                    "default": "{}",
                    "multiline": True,
                    "dynamicPrompts": False,
                    "tooltip": "导演台内部 JSON 状态。体积较大时由前端自动维护，"
                               "不需要手动编辑。",
                }),
            },
            "optional": {
                "LLM_HINT": ("STRING", {
                    "forceInput": True,
                    "tooltip": "AI 扩写提示；同时作为 run_name 注入 plan。",
                }),
                "foundation_input": ("STRING", {
                    "forceInput": True,
                    "tooltip": "世界构建基础（上下文输入，连线优先于前端文本框）。",
                }),
                "api_config": ("API_CONFIG", {
                    "forceInput": True,
                    "tooltip": "接入 API 配置加载器输出，供导演 Skill 调用远程模型。",
                }),
                "local_model": ("EAGLE_LOCAL_LLM_MODEL", {
                    "forceInput": True,
                    "tooltip": "接入本地大模型加载器输出，供导演 Skill 本地推理（优先于 API）。",
                }),
                "skill_request": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": "导演 Skill 生成请求（由前端「生成」按钮写入，正常留空）。",
                }),
                "director_skill": ("STRING", {
                    "forceInput": True,
                    "tooltip": "接入「导演技能库」节点输出，作为生成台本/分镜/台词时的导演技能上下文。",
                }),
            },
            "hidden": {
                "node_id": "UNIQUE_ID",
            },
        }

    # 导演台只输出编排数据与一个媒体总线。参考条件路由节点直接消费
    # media_bundle 并动态绑定官方 Ref2VA 插槽，避免 DOM 面板被大量端口挤压越框。
    # EagleH3MediaPortsNode 仅保留给旧工作流和底层排障。
    # 前六个端口与 MiniMax H3 Context Loop Plan 保持相同的后端数据契约。
    # 注意：第三方 Scene Prompt Editor 的前端还会硬编码查找
    # ``MiniMaxH3ChainPlan`` 节点及其 plan_json/run_name 控件，所以它不是
    # 通用 H3_CHAIN_PLAN 查看器。末尾的 context_loop_plan_json 用于无界面的
    # 外部导入；页面编辑器需要真实第三方 Plan 节点的 plan_json 控件，
    # Eagle 前端会把导演台当前计划镜像到该控件，保留其可编辑性。
    RETURN_TYPES = (
        H3_PLAN_TYPE, "STRING", "INT", "INT", "INT", "INT",
        H3_MEDIA_BUNDLE_TYPE, "STRING",
    )
    RETURN_NAMES = (
        "plan", "summary", "clip_count", "width", "height",
        "video_blend_frames", "media_bundle", "context_loop_plan_json",
    )
    OUTPUT_TOOLTIPS = (
        "标准 H3_CHAIN_PLAN 运行对象，可接 Eagle“循环开始”或其他通用后端消费节点。"
        "第三方 Context Loop 网页编辑器会额外校验来源节点类型；Eagle 不会自动插入跳接节点。",
        "计划摘要。",
        "场景/片段数量。",
        "生成宽度。",
        "生成高度。",
        "场景边界视频融合帧数。",
        "Eagle 私有 H3_MEDIA_BUNDLE，仅用于参考条件路由或媒体端口展开。",
        "Context Loop authoring JSON，用于无界面调用、文本预览或外部存储。"
        "需使用第三方编辑器时请用右键兼容编辑链，避免外部输入覆盖页面修改。",
    )
    DESCRIPTION = (
        "编辑并编译 MiniMax H3 多场景计划。plan 是运行数据；"
        "context_loop_plan_json 是开放的计划 JSON，可按需手动接入第三方节点。"
    )
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台"

    def execute(self, h3_state="{}", LLM_HINT="", foundation_input="", **kwargs):
        skill_request = kwargs.get("skill_request", "") or ""
        director_skill = kwargs.get("director_skill", "") or ""
        api_config = kwargs.get("api_config", None)
        local_model = kwargs.get("local_model", None)
        node_id = kwargs.get("node_id", "")

        # 解析状态
        try:
            state = json.loads(h3_state) if isinstance(h3_state, str) and h3_state.strip() else {}
        except Exception as e:
            logger.warning(f"[EagleH3Director] h3_state 解析失败: {e}")
            state = {}

        project = state.get("project", {}) if isinstance(state, dict) else {}
        scenes = state.get("scenes", []) if isinstance(state, dict) else []
        if not isinstance(scenes, list):
            scenes = []

        # foundation_input 连线优先于前端文本框
        if foundation_input and foundation_input.strip():
            if not isinstance(project, dict):
                project = {}
            project["foundation"] = foundation_input.strip()

        # 导演台内置选择与外接“导演技能库”节点可以同时工作；完全相同的快照不重复。
        if not isinstance(project, dict):
            project = {}
        embedded_skill = str(project.get("director_skill") or "").strip()
        connected_skill = str(director_skill or "").strip()
        skill_layers = []
        for layer in (embedded_skill, connected_skill):
            if layer and layer not in skill_layers:
                skill_layers.append(layer)
        effective_director_skill = "\n\n---\n\n".join(skill_layers)
        project["director_skill"] = effective_director_skill

        # ── 导演 Skill 生成（手动「生成」按钮触发）──
        if skill_request and skill_request.strip():
            block_skill_queue = True
            try:
                req = json.loads(skill_request)
                if req.get("run"):
                    block_skill_queue = bool(req.get("blockDownstream", True))
                    result = run_director_skill(
                        project, scenes, req, api_config=api_config, local_model=local_model,
                        director_skill=effective_director_skill
                    )
                    result["skill_layers"] = len(skill_layers)
                    result["node_id"] = node_id
                    if req.get("releaseAfter") and result.get("transport") == "local":
                        try:
                            from .local_llm_node import release_local_model_handle
                            released = release_local_model_handle(local_model)
                            result["memory_release"] = released
                        except Exception as e:
                            result["memory_release_error"] = str(e)
                    try:
                        from server import PromptServer
                        ps = getattr(PromptServer, "instance", None)
                        if ps:
                            ps.send_sync("h3_director_skill_result", result)
                    except Exception as e:
                        logger.warning(f"[EagleH3Director] 推送 skill 结果失败: {e}")
            except Exception as e:
                logger.warning(f"[EagleH3Director] skill_request 解析失败: {e}")
            if block_skill_queue:
                try:
                    from comfy_execution.graph_utils import ExecutionBlocker
                    return tuple(ExecutionBlocker(None) for _ in self.RETURN_TYPES)
                except Exception as e:
                    logger.warning(f"[EagleH3Director] 当前 ComfyUI 不支持静默阻断下游: {e}")

        # plan dict — ethanfel H3_CHAIN_PLAN 对象
        plan_data = compile_h3_params(project, scenes, LLM_HINT or "")

        # 参考图：按槽位占位，确保 REF_IMAGES[i] 严格对应 @ref(i+1)
        import torch
        ref_images = []
        media_refs = _project_media(project)
        refs = [item for item in media_refs if item.get("type", "image") == "image"]
        max_mp = float(project.get("refMaxMegapixels", 1.5) or 1.5)
        for i in range(len(refs)):
            r = refs[i] if i < len(refs) else {}
            fn = r.get("filename") if isinstance(r, dict) else None
            t = _load_ref_tensor(fn, max_megapixels=max_mp) if fn else None
            if t is None:
                t = torch.zeros((1, 1, 1, 3))   # 占位：height==1 可被下游过滤
            ref_images.append(t)

        if not ref_images:
            ref_images = [torch.zeros((1, 64, 64, 3))]

        ref_videos = []
        ref_video_audios = []
        for item in media_refs:
            if item.get("type") != "video":
                continue
            trim_start = float(item.get("trimStart", 0.0) or 0.0)
            trim_end = float(item.get("trimEnd", item.get("duration", 0.0)) or 0.0)
            tensor = _load_video_tensor(
                item.get("filename", ""),
                trim_start,
                trim_end,
                target_fps=int(project.get("fps", 24) or 24),
            )
            # 即使某个文件加载失败也保留槽位，确保 <Video N> 编号不串位。
            ref_videos.append(tensor)
            # MiniMax H3 把参考视频画面和其原声放在两个同编号插槽中。
            # 无音轨或当前音频后端不支持该容器时返回 None，仍可只使用画面。
            ref_video_audios.append(
                _load_audio_clip(item.get("filename", ""), trim_start, trim_end)
                if item.get("useEmbeddedAudio") else None
            )

        ref_audios = []
        for item in media_refs:
            if item.get("type") != "audio":
                continue
            audio = _load_audio_clip(
                item.get("filename", ""),
                float(item.get("trimStart", 0.0) or 0.0),
                float(item.get("trimEnd", item.get("duration", 0.0)) or 0.0),
            )
            # 保留空槽，避免后一个音频错误顶替 <Audio N> 的编号。
            ref_audios.append(audio)

        media_mapping = json.dumps(plan_data.get("reference_media", []), ensure_ascii=False)

        # 独立输出端口值
        cfg = plan_data.get("compatibility", {})
        width_val = int(cfg.get("width", 1080))
        height_val = int(cfg.get("height", 1920))
        clip_count = len(plan_data.get("shots", []))
        video_blend_frames_val = int(cfg.get("video_blend_frames", 0))
        summary = plan_data.get("summary", "")

        video_slots = (ref_videos + [None, None, None])[:3]
        video_audio_slots = (ref_video_audios + [None, None, None])[:3]
        audio_slots = (ref_audios + [None, None, None])[:3]

        media_bundle = {
            "ref_images": ref_images,
            "video_slots": video_slots,
            "video_audio_slots": video_audio_slots,
            "audio_slots": audio_slots,
            "media_mapping": media_mapping,
        }
        plan_json = export_context_loop_plan_json(plan_data)
        result = (plan_data, summary, clip_count, width_val, height_val,
                  video_blend_frames_val, media_bundle, plan_json)
        return {
            "ui": {"h3_context_loop_plan_json": [plan_json]},
            "result": result,
        }


class EagleH3MediaPortsNode:
    """旧版兼容节点：把导演台媒体包展开为固定插槽。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"media_bundle": (H3_MEDIA_BUNDLE_TYPE,)}}

    RETURN_TYPES = (
        "IMAGE", "IMAGE", "AUDIO", "STRING", "AUDIO",
        "IMAGE", "AUDIO", "IMAGE", "AUDIO", "AUDIO", "AUDIO",
    )
    RETURN_NAMES = (
        "REF_IMAGES",
        "ref_videos.ref_video_0", "ref_audios.ref_audio_0", "media_mapping",
        "ref_video_audios.ref_video_audio_0",
        "ref_videos.ref_video_1", "ref_video_audios.ref_video_audio_1",
        "ref_videos.ref_video_2", "ref_video_audios.ref_video_audio_2",
        "ref_audios.ref_audio_1", "ref_audios.ref_audio_2",
    )
    OUTPUT_IS_LIST = (True, False, False, False, False, False, False, False, False, False, False)
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台/诊断与兼容"
    DEPRECATED = True
    DESCRIPTION = (
        "仅供旧工作流和底层排障。新工作流请直接连接"
        "“H3 导演台.media_bundle → H3 · 参考条件路由.media_bundle”。"
        "REF_IMAGES 与 media_mapping 作为 media_bundle 内部数据仍会被路由正常使用，"
        "无需独立连线。"
    )

    def execute(self, media_bundle):
        bundle = media_bundle if isinstance(media_bundle, dict) else {}
        ref_images = bundle.get("ref_images") or []
        video_slots = list(bundle.get("video_slots") or [])
        video_audio_slots = list(bundle.get("video_audio_slots") or [])
        audio_slots = list(bundle.get("audio_slots") or [])
        video_slots = (video_slots + [None, None, None])[:3]
        video_audio_slots = (video_audio_slots + [None, None, None])[:3]
        audio_slots = (audio_slots + [None, None, None])[:3]
        return (
            ref_images,
            video_slots[0], audio_slots[0], bundle.get("media_mapping", "[]"),
            video_audio_slots[0],
            video_slots[1], video_audio_slots[1],
            video_slots[2], video_audio_slots[2],
            audio_slots[1], audio_slots[2],
        )


class EagleH3MediaPortsV2Node:
    """按视频、音频、图片分区展开导演台媒体包。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"media_bundle": (H3_MEDIA_BUNDLE_TYPE,)}}

    RETURN_TYPES = (
        "IMAGE", "IMAGE", "IMAGE",
        "AUDIO", "AUDIO", "AUDIO",
        "AUDIO", "AUDIO", "AUDIO",
        "IMAGE", "STRING",
    )
    RETURN_NAMES = (
        "ref_video_0", "ref_video_1", "ref_video_2",
        "video_audio_0", "video_audio_1", "video_audio_2",
        "ref_audio_0", "ref_audio_1", "ref_audio_2",
        "REF_IMAGES", "media_mapping",
    )
    OUTPUT_IS_LIST = (
        False, False, False,
        False, False, False,
        False, False, False,
        True, False,
    )
    OUTPUT_TOOLTIPS = (
        "兼容端口：视频 1 的已解码 IMAGE 帧批次，不是原生 VIDEO。",
        "兼容端口：视频 2 的已解码 IMAGE 帧批次，不是原生 VIDEO。",
        "兼容端口：视频 3 的已解码 IMAGE 帧批次，不是原生 VIDEO。",
        "视频 1 原声：对应官方 ref_video_audios.ref_video_audio_0。",
        "视频 2 原声：对应官方 ref_video_audios.ref_video_audio_1。",
        "视频 3 原声：对应官方 ref_video_audios.ref_video_audio_2。",
        "独立音频 1：对应官方 ref_audios.ref_audio_0。",
        "独立音频 2：对应官方 ref_audios.ref_audio_1。",
        "独立音频 3：对应官方 ref_audios.ref_audio_2。",
        "全部参考图片（IMAGE 列表）。",
        "稳定标签、素材用途与张量槽位的 JSON 映射。",
    )
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台"
    DEPRECATED = True
    DESCRIPTION = (
        "旧版标准输出，仅用于已有工作流兼容。新工作流使用“H3 标准媒体桥”；"
        "其中 ref_video_* 其实是已解码 IMAGE 帧批次，不是原生 VIDEO。"
    )

    def execute(self, media_bundle):
        bundle = media_bundle if isinstance(media_bundle, dict) else {}
        video_slots = (list(bundle.get("video_slots") or []) + [None, None, None])[:3]
        video_audio_slots = (
            list(bundle.get("video_audio_slots") or []) + [None, None, None]
        )[:3]
        audio_slots = (list(bundle.get("audio_slots") or []) + [None, None, None])[:3]
        ref_images = bundle.get("ref_images") or []
        return (
            video_slots[0], video_slots[1], video_slots[2],
            video_audio_slots[0], video_audio_slots[1], video_audio_slots[2],
            audio_slots[0], audio_slots[1], audio_slots[2],
            ref_images, bundle.get("media_mapping", "[]"),
        )


class EagleH3MediaPackNode:
    """把 ComfyUI 标准媒体端口收拢为导演台媒体包。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "media_mapping": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "dynamicPrompts": False,
                    "tooltip": (
                        "可选 JSON 素材映射。留空时按已连接端口自动生成 "
                        "<Picture N>/<Video N>/<Audio N> 顺序。"
                    ),
                }),
            },
            "optional": {
                "ref_video_0": ("IMAGE",),
                "ref_video_1": ("IMAGE",),
                "ref_video_2": ("IMAGE",),
                "video_audio_0": ("AUDIO",),
                "video_audio_1": ("AUDIO",),
                "video_audio_2": ("AUDIO",),
                "ref_audio_0": ("AUDIO",),
                "ref_audio_1": ("AUDIO",),
                "ref_audio_2": ("AUDIO",),
                "ref_images": ("IMAGE",),
            },
        }

    RETURN_TYPES = (H3_MEDIA_BUNDLE_TYPE, "STRING", "INT", "INT", "INT")
    RETURN_NAMES = (
        "media_bundle", "media_mapping", "image_count", "video_count", "audio_count",
    )
    OUTPUT_TOOLTIPS = (
        "Eagle H3 内部媒体总线，可接参考条件路由或标准媒体输出。",
        "规范化后的素材标签与用途 JSON。",
        "参考图片数量。",
        "参考视频数量。",
        "独立参考音频数量。",
    )
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台"
    DEPRECATED = True
    DESCRIPTION = (
        "旧版标准输入，仅用于已有工作流兼容。新工作流使用“H3 标准媒体桥”。"
    )

    @staticmethod
    def _split_images(value):
        if value is None:
            return []
        try:
            import torch
            if torch.is_tensor(value) and value.ndim == 4:
                return [value[index:index + 1] for index in range(int(value.shape[0]))]
        except Exception:
            pass
        if isinstance(value, (list, tuple)):
            return [item for item in value if item is not None]
        return [value]

    @staticmethod
    def _normalized_mapping(raw_mapping, image_count, video_slots, audio_slots):
        text = str(raw_mapping or "").strip()
        if text:
            try:
                mapping = json.loads(text)
            except Exception as error:
                raise ValueError(f"media_mapping 不是有效 JSON: {error}") from error
            if not isinstance(mapping, list) or not all(isinstance(row, dict) for row in mapping):
                raise ValueError("media_mapping 必须是 JSON 对象数组")
            return mapping

        mapping = []
        for index in range(image_count):
            mapping.append({
                "type": "image",
                "name": f"Picture {index + 1}",
                "role": "reference",
                "purpose": f"<Picture {index + 1}> external reference",
            })
        for index, value in enumerate(video_slots):
            if value is not None:
                mapping.append({
                    "type": "video",
                    "name": f"Video {index + 1}",
                    "role": "reference",
                    "purpose": f"<Video {index + 1}> external reference",
                })
        for index, value in enumerate(audio_slots):
            if value is not None:
                mapping.append({
                    "type": "audio",
                    "name": f"Audio {index + 1}",
                    "role": "reference",
                    "purpose": f"<Audio {index + 1}> external reference",
                })
        return mapping

    def execute(self, media_mapping="", ref_video_0=None, ref_video_1=None,
                ref_video_2=None, video_audio_0=None, video_audio_1=None,
                video_audio_2=None, ref_audio_0=None, ref_audio_1=None,
                ref_audio_2=None, ref_images=None):
        images = self._split_images(ref_images)
        videos = [ref_video_0, ref_video_1, ref_video_2]
        video_audios = [video_audio_0, video_audio_1, video_audio_2]
        audios = [ref_audio_0, ref_audio_1, ref_audio_2]
        mapping = self._normalized_mapping(
            media_mapping, len(images), videos, audios
        )
        mapping_json = json.dumps(mapping, ensure_ascii=False)
        bundle = {
            "version": 1,
            "ref_images": images,
            "video_slots": videos,
            "video_audio_slots": video_audios,
            "audio_slots": audios,
            "media_mapping": mapping_json,
        }
        return (
            bundle,
            mapping_json,
            len(images),
            sum(value is not None for value in videos),
            sum(value is not None for value in audios),
        )


class EagleH3MediaBridgeNode:
    """Single, clearly labelled standard-media boundary for H3 workflows.

    ``IMAGE`` batches and ComfyUI list outputs are different contracts.  The
    bridge therefore exposes one ordinary ``IMAGE`` for first-shot seeding;
    the complete reference-image collection remains inside ``media_bundle``.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "media_mapping": ("STRING", {
                    "default": "", "multiline": True, "dynamicPrompts": False,
                    "tooltip": "可选素材映射 JSON；留空时自动生成 Picture/Video/Audio 顺序。",
                }),
            },
            "optional": {
                "media_bundle": (H3_MEDIA_BUNDLE_TYPE, {
                    "tooltip": "接导演台或参考条件链的 H3 媒体包；标准端口可按槽位覆盖它。",
                }),
                "ref_images": ("IMAGE", {"tooltip": "普通参考图片或 IMAGE 批次。"}),
                "ref_video_0": ("IMAGE", {"tooltip": "参考视频 0 的已解码 IMAGE 帧批次，不是 VIDEO 对象。"}),
                "ref_video_1": ("IMAGE", {"tooltip": "参考视频 1 的已解码 IMAGE 帧批次，不是 VIDEO 对象。"}),
                "ref_video_2": ("IMAGE", {"tooltip": "参考视频 2 的已解码 IMAGE 帧批次，不是 VIDEO 对象。"}),
                "ref_video_audio_0": ("AUDIO", {"tooltip": "参考视频 0 的配对原声。"}),
                "ref_video_audio_1": ("AUDIO", {"tooltip": "参考视频 1 的配对原声。"}),
                "ref_video_audio_2": ("AUDIO", {"tooltip": "参考视频 2 的配对原声。"}),
                "ref_audio_0": ("AUDIO",),
                "ref_audio_1": ("AUDIO",),
                "ref_audio_2": ("AUDIO",),
            },
        }

    RETURN_TYPES = (
        H3_MEDIA_BUNDLE_TYPE, "IMAGE",
        "IMAGE", "IMAGE", "IMAGE",
        "AUDIO", "AUDIO", "AUDIO",
        "AUDIO", "AUDIO", "AUDIO",
        "STRING", "INT", "INT", "INT",
    )
    RETURN_NAMES = (
        "media_bundle", "first_reference_image",
        "ref_video_0", "ref_video_1", "ref_video_2",
        "ref_video_audio_0", "ref_video_audio_1", "ref_video_audio_2",
        "ref_audio_0", "ref_audio_1", "ref_audio_2",
        "media_mapping", "image_count", "video_count", "audio_count",
    )
    OUTPUT_IS_LIST = (
        False, False,
        False, False, False,
        False, False, False,
        False, False, False,
        False, False, False, False,
    )
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台"
    DESCRIPTION = (
        "H3 唯一推荐的标准媒体边界。既可展开导演台 media_bundle，也可把外部 "
        "IMAGE/AUDIO 重新打包。ref_video_* 按官方 H3 的 0 基槽位命名，"
        "明确表示视频帧 IMAGE 批次，"
        "避免与 ComfyUI 原生 VIDEO 对象混淆。first_reference_image "
        "是普通单张 IMAGE，可直接接入首镜 seed_image；全部参考图保留在媒体包内。"
    )

    def execute(self, media_mapping="", media_bundle=None, ref_images=None,
                ref_video_0=None, ref_video_1=None, ref_video_2=None,
                ref_video_audio_0=None, ref_video_audio_1=None, ref_video_audio_2=None,
                ref_audio_0=None, ref_audio_1=None, ref_audio_2=None):
        source = media_bundle if isinstance(media_bundle, dict) else {}
        source_videos = (list(source.get("video_slots") or []) + [None, None, None])[:3]
        source_video_audio = (list(source.get("video_audio_slots") or []) + [None, None, None])[:3]
        source_audio = (list(source.get("audio_slots") or []) + [None, None, None])[:3]

        video_overrides = [ref_video_0, ref_video_1, ref_video_2]
        video_audio_overrides = [
            ref_video_audio_0, ref_video_audio_1, ref_video_audio_2,
        ]
        audio_overrides = [ref_audio_0, ref_audio_1, ref_audio_2]
        videos = [value if value is not None else source_videos[index]
                  for index, value in enumerate(video_overrides)]
        video_audios = [value if value is not None else source_video_audio[index]
                        for index, value in enumerate(video_audio_overrides)]
        audios = [value if value is not None else source_audio[index]
                  for index, value in enumerate(audio_overrides)]
        if ref_images is None:
            images = list(source.get("ref_images") or [])
        else:
            images = EagleH3MediaPackNode._split_images(ref_images)

        raw_mapping = str(media_mapping or "").strip() or source.get("media_mapping", "")
        mapping = EagleH3MediaPackNode._normalized_mapping(
            raw_mapping, len(images), videos, audios
        )
        mapping_json = json.dumps(mapping, ensure_ascii=False)
        bundle = {
            "version": 2,
            "ref_images": images,
            "video_slots": videos,
            "video_audio_slots": video_audios,
            "audio_slots": audios,
            "media_mapping": mapping_json,
        }
        first_reference_image = images[0] if images else None
        return (
            bundle, first_reference_image,
            videos[0], videos[1], videos[2],
            video_audios[0], video_audios[1], video_audios[2],
            audios[0], audios[1], audios[2], mapping_json,
            len(images), sum(value is not None for value in videos),
            sum(value is not None for value in audios),
        )


# ────────────────────────────────────────────────────────────────────────────
# 路由：多模态参考素材上传 / 预览
# ────────────────────────────────────────────────────────────────────────────

_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
_VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"}
_AUDIO_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".opus"}


def _validate_uploaded_image(path):
    """Decode and verify an uploaded image before exposing it through the proxy."""
    with Image.open(path) as uploaded:
        if uploaded.width * uploaded.height > 80_000_000:
            raise ValueError("image pixel count too large")
        uploaded.verify()


@route("GET", "/h3_director/input_images")
async def list_input_images(request):
    """List safe image references under ComfyUI/input for the director picker."""
    try:
        root = _comfy_input_root()
        items = []
        if root.is_dir():
            for path in root.rglob("*"):
                if len(items) >= 5000:
                    break
                try:
                    if not path.is_file() or path.suffix.lower() not in _IMAGE_EXTENSIONS:
                        continue
                    resolved = path.resolve()
                    if root not in resolved.parents:
                        continue
                    relative = path.relative_to(root).as_posix()
                    stat = path.stat()
                    items.append({
                        "path": relative,
                        "name": path.name,
                        "subfolder": path.parent.relative_to(root).as_posix()
                            if path.parent != root else "",
                        "size": int(stat.st_size),
                        "mtime": int(stat.st_mtime_ns),
                    })
                except (OSError, RuntimeError, ValueError):
                    continue
        items.sort(key=lambda item: item["path"].lower())
        return web.json_response({"success": True, "items": items})
    except Exception as error:
        logger.warning(f"[EagleH3Director] input 图片列表失败: {error}")
        return web.json_response({"success": False, "error": str(error)}, status=500)


@route("POST", "/h3_director/upload_media")
async def upload_media(request):
    """Save one director-owned image/video/audio reference and return normalized metadata."""
    try:
        media_dir = _director_media_dir()
        reader = await request.multipart()
        field = await reader.next()
        if field is None:
            return web.json_response({"success": False, "error": "no file"}, status=400)
        original_name = os.path.basename(field.filename or "media")
        ext = os.path.splitext(original_name)[1].lower()
        if ext in _IMAGE_EXTENSIONS:
            media_type = "image"
        elif ext in _VIDEO_EXTENSIONS:
            media_type = "video"
        elif ext in _AUDIO_EXTENSIONS:
            media_type = "audio"
        else:
            return web.json_response({"success": False, "error": "unsupported type"}, status=400)

        filename = f"media_{time.strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:10]}{ext}"
        out_path = str(media_dir / filename)
        relative_name = f"h3_director/{filename}"
        total = 0
        max_bytes = {
            "image": 64 * 1024 * 1024,
            "video": 1024 * 1024 * 1024,
            "audio": 256 * 1024 * 1024,
        }[media_type]
        with open(out_path, "wb") as stream:
            while True:
                chunk = await field.read_chunk(size=1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    stream.close()
                    try:
                        os.remove(out_path)
                    except OSError:
                        pass
                    return web.json_response({"success": False, "error": "file too large"}, status=413)
                stream.write(chunk)
        if total <= 0:
            try:
                os.remove(out_path)
            except OSError:
                pass
            return web.json_response({"success": False, "error": "empty"}, status=400)

        duration = _probe_media_duration(out_path, media_type)
        try:
            if media_type == "image":
                _validate_uploaded_image(out_path)
            elif duration <= 0:
                raise ValueError("media stream could not be validated")
        except Exception as validation_error:
            try:
                os.remove(out_path)
            except OSError:
                pass
            return web.json_response({"success": False, "error": str(validation_error)}, status=400)
        return web.json_response({
            "success": True,
            "item": {
                "id": f"media-{uuid.uuid4().hex}",
                "type": media_type,
                "filename": relative_name,
                "originalName": original_name,
                "name": "",
                "kind": "person" if media_type == "image" else "reference",
                "role": _default_media_role(media_type, "person" if media_type == "image" else "reference"),
                "purpose": "",
                "retention": "reference" if media_type == "audio" else "fully_preserved",
                "useEmbeddedAudio": False,
                "speakerId": "",
                "duration": round(duration, 4),
                "trimStart": 0.0,
                "trimEnd": round(duration, 4),
                "source": "input",
                "managed": True,
                "url": "",
            },
        })
    except Exception as e:
        logger.warning(f"[EagleH3Director] upload_media 失败: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("GET", "/h3_director/media")
async def media_proxy(request):
    try:
        filename = request.query.get("filename", "")
        path = _media_path(filename)
        if not path:
            return web.Response(status=404)
        return web.FileResponse(path)
    except Exception as e:
        logger.warning(f"[EagleH3Director] media_proxy 失败: {e}")
        return web.Response(status=500)


@route("DELETE", "/h3_director/media")
async def delete_media(request):
    """Delete only files created inside the director reference directory."""
    raw_name = request.query.get("filename", "")
    filename = os.path.basename(str(raw_name).replace("\\", "/"))
    if not filename.startswith(("media_", "ref_")):
        return web.json_response({"success": False, "error": "invalid filename"}, status=400)
    legacy_candidate = Path(REF_DIR) / filename
    path = str(legacy_candidate) if legacy_candidate.is_file() else ""
    input_candidate = _safe_input_path(raw_name)
    director_root = _director_media_dir().resolve()
    if input_candidate and input_candidate.is_file() and director_root in input_candidate.parents:
        path = str(input_candidate)
    elif path:
        try:
            legacy_root = Path(REF_DIR).resolve()
            if legacy_root not in Path(path).resolve().parents:
                path = ""
        except (OSError, RuntimeError, ValueError):
            path = ""
    if not path:
        return web.json_response({"success": True, "deleted": False})
    try:
        os.remove(path)
        return web.json_response({"success": True, "deleted": True})
    except OSError as error:
        return web.json_response({"success": False, "error": str(error)}, status=500)

@route("POST", "/h3_director/upload_ref")
async def upload_ref(request):
    """接收前端上传的参考图，保存到 ComfyUI/input/h3_director。"""
    try:
        media_dir = _director_media_dir()
        reader = await request.multipart()
        field = await reader.next()
        if field is None:
            return web.json_response({"success": False, "error": "no file"}, status=400)
        # 仅允许图片扩展名
        disp = field.filename or ""
        ext = os.path.splitext(disp)[1].lower()
        if ext not in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"):
            return web.json_response({"success": False, "error": "unsupported type"}, status=400)
        stamp = time.strftime("%Y%m%d%H%M%S")
        safe_name = f"ref_{stamp}_{abs(hash(disp)) & 0xffffffff}{ext}"
        out_path = str(media_dir / safe_name)
        relative_name = f"h3_director/{safe_name}"
        total = 0
        max_bytes = 25 * 1024 * 1024
        with open(out_path, "wb") as f:
            while True:
                chunk = await field.read_chunk(size=1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    f.close()
                    try:
                        os.remove(out_path)
                    except OSError:
                        pass
                    return web.json_response(
                        {"success": False, "error": "file too large (max 25 MiB)"},
                        status=413,
                    )
                f.write(chunk)
        if total <= 0:
            try:
                os.remove(out_path)
            except OSError:
                pass
            return web.json_response({"success": False, "error": "empty"}, status=400)
        try:
            _validate_uploaded_image(out_path)
        except Exception as validation_error:
            try:
                os.remove(out_path)
            except OSError:
                pass
            return web.json_response({"success": False, "error": str(validation_error)}, status=400)
        return web.json_response({"success": True, "filename": relative_name,
                                  "source": "input", "managed": True})
    except Exception as e:
        logger.warning(f"[EagleH3Director] upload_ref 失败: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("GET", "/h3_director/ref_proxy")
async def ref_proxy(request):
    """返回已上传参考图的缩略图/原图，供前端预览。"""
    try:
        filename = request.query.get("filename", "")
        if not filename:
            return web.Response(status=404)
        path = _media_path(filename)
        if not path:
            return web.Response(status=404)
        return web.FileResponse(path)
    except Exception as e:
        logger.warning(f"[EagleH3Director] ref_proxy 失败: {e}")
        return web.Response(status=500)


__all__ = [
    "EagleH3DirectorNode",
    "EagleH3MediaBridgeNode",
    "H3_MEDIA_BUNDLE_TYPE",
    "H3_PLAN_TYPE",
]
