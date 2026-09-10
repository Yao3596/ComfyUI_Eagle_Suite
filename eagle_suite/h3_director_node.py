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
    length = requested + (5 - requested % 17) % 17
    if length > H3_MAX_FRAMES:
        raise ValueError(
            f"H3 shot duration {seconds:.6f}s rounds to {length} frames; "
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
    value = int(value or 1080)
    if value < 32:
        value = 32
    return (value // 32) * 32


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
        return [
            _normalize_media_item(item, index)
            for index, item in enumerate(media)
            if isinstance(item, dict) and item.get("filename")
        ]

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
    match = re.fullmatch(r"(?:(\d+):)?(\d{1,2})(?:\.(\d{1,3}))?", text)
    if not match:
        return None
    minutes = int(match.group(1) or 0)
    seconds = int(match.group(2))
    if seconds >= 60:
        return None
    millis = (match.group(3) or "0").ljust(3, "0")[:3]
    return minutes * 60.0 + seconds + int(millis) / 1000.0


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
    timeline_parts = [item for item in (preamble, detailed_body, dialogue) if item]
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
    # 基础参数提取与合法性修正
    fps = int(_safe_get(project, "fps", H3_FPS) or H3_FPS)
    if fps <= 0:
        fps = H3_FPS

    width = _snap_multiple_of_32(_safe_get(project, "width", 1080))
    height = _snap_multiple_of_32(_safe_get(project, "height", 1920))
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
        resolved_continuation_modes.append(shot_continuation_mode)

        # masked_av 校验
        if shot_context_length and shot_continuation_mode == "masked_av":
            if shot_context_length < 5:
                shot_continuation_mode = "guide"
            elif encode_mode != "video" or anchor_mode != "head":
                shot_continuation_mode = "guide"

        # scene_prompt：不含 prefix
        scene_prompt = _build_scene_prompt(project, s)

        # 完整 prompt = prefix + scene_prompt
        full_prompt_parts = []
        if prompt_prefix:
            full_prompt_parts.append(prompt_prefix)
        if scene_prompt:
            full_prompt_parts.append(scene_prompt)
        full_prompt = "\n\n".join(full_prompt_parts)

        # 计算 H3 合法帧长
        raw_frames = _h3_frame_length(secs)

        if index == 1:
            generation_start_frame = 0
            delivered_frames = raw_frames
        else:
            if shot_context_length and raw_frames <= shot_context_length:
                # 帧数不足以做 overlap，自动降级为 0 context
                shot_context_length = 0
            if anchor_mode == "head" and shot_context_length:
                generation_start_frame = stitched_frames - shot_context_length
                delivered_frames = raw_frames - shot_context_length
            else:
                generation_start_frame = stitched_frames
                delivered_frames = raw_frames

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
            "duration_seconds": secs,
            "length": raw_frames,
            "raw_frames": raw_frames,
            "delivered_frames": delivered_frames,
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

        # 仅当与全局默认值不同才写入覆盖字段
        if shot_context_length != context_length:
            shot["context_length"] = shot_context_length
        if shot_audio_context_length != audio_context_length:
            shot["audio_context_length"] = shot_audio_context_length
        if shot_continuation_mode != continuation_mode:
            shot["continuation_mode"] = shot_continuation_mode

        shots_list.append(shot)
        stitched_frames += delivered_frames

    # 校验每个 shot 的 delivered_frames 能否满足下一个 shot 的 context
    for offset, shot in enumerate(shots_list[:-1]):
        next_context = resolved_context_lengths[offset + 1]
        if next_context and shot["delivered_frames"] < next_context:
            # 自动延长当前 shot 的 raw_frames 到至少能交付 next_context 帧
            needed_raw = next_context + (shot["context_length"] if "context_length" in shot
                                          else context_length)
            if needed_raw <= H3_MAX_FRAMES:
                old_raw = shot["raw_frames"]
                # 向上取到 17k+5
                shot["raw_frames"] = needed_raw + (5 - needed_raw % 17) % 17
                shot["length"] = shot["raw_frames"]
                shot["duration_seconds"] = shot["raw_frames"] / float(fps)
                delta = shot["raw_frames"] - old_raw
                shot["delivered_frames"] += delta
                shot["audio_duration_seconds"] = shot["raw_frames"] / float(fps)
                shot["prompt_hash"] = _fingerprint(shot["prompt"])
                stitched_frames += delta

    # 下一个 shot 的 generation_start_frame 可能因上一个 shot 延长而需要重新校准
    for offset, shot in enumerate(shots_list[1:], start=1):
        prev = shots_list[offset - 1]
        prev_delivered = prev["delivered_frames"]
        shot_context = shot.get("context_length", context_length)
        if anchor_mode == "head" and shot_context:
            shot["generation_start_frame"] = (
                sum(s["delivered_frames"] for s in shots_list[:offset]) - shot_context
            )
        else:
            shot["generation_start_frame"] = sum(s["delivered_frames"] for s in shots_list[:offset])
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
        "run_name": run_name,
        "prompt_prefix": prompt_prefix,
        "defaults": {"duration_seconds": float(_safe_get(project, "globalDuration", 7) or 7), "steps": steps},
        "shots": shots_list,
        "compatibility": compatibility,
        "segment_crf": segment_crf,
        "total_delivered_frames": stitched_frames,
        "reference_media": reference_media,
    }
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


def _build_skill_prompts(task, project, scene, hint, director_skill="", request=None):
    """返回 (system, user) 提示词。"""
    foundation = (project.get("foundation") or "").strip()
    director_skill = (director_skill or project.get("director_skill") or "").strip()
    director_skill = _compose_director_guidance(task, request, director_skill)
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
    )
    reference_ctx = _skill_reference_context(project, scene)
    chain_ctx = str(request.get("_chainContext") or "")
    common_ctx = reference_ctx + (chain_ctx + "\n" if chain_ctx else "")
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
            f"3. 每个镜头写{visual_language}描述（主体 / 动作 / 运镜 / 氛围）且自包含，"
            "不得出现“如前所述”“同上”等承接语；\n"
            f"4. 发声者按首次发声顺序稳定编号，例：角色名 (S1) says: "
            f"<d>[{dialogue_language}] 简洁台词</d>；\n"
            "5. 输出 ONLY JSON：{\"preamble\":\"...\"}\n"
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
            "要求：time 从 00:00.000 起按顺序递增；每个 estSeconds 必须大于 0，"
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

        operation = out["operation"]
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
    # 通用 H3_CHAIN_PLAN 查看器。末尾的 context_loop_plan_json 用于显式
    # 接入真实的第三方 Plan.plan_json_input，避免把运行对象与编辑源混淆。
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
        "Context Loop 可编辑 authoring JSON。只接到第三方 MiniMax H3 Context Loop Plan 的 "
        "plan_json_input，再由该 Plan.plan 输出接 Scene Prompt Editor / Plan Studio。",
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
    """Single, clearly labelled standard-media boundary for H3 workflows."""

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
                "reference_images": ("IMAGE", {"tooltip": "普通参考图片或 IMAGE 批次。"}),
                "video_frames_1": ("IMAGE", {"tooltip": "参考视频 1 的已解码帧批次，不是 VIDEO 对象。"}),
                "video_frames_2": ("IMAGE", {"tooltip": "参考视频 2 的已解码帧批次，不是 VIDEO 对象。"}),
                "video_frames_3": ("IMAGE", {"tooltip": "参考视频 3 的已解码帧批次，不是 VIDEO 对象。"}),
                "video_audio_1": ("AUDIO", {"tooltip": "参考视频 1 的配对原声。"}),
                "video_audio_2": ("AUDIO", {"tooltip": "参考视频 2 的配对原声。"}),
                "video_audio_3": ("AUDIO", {"tooltip": "参考视频 3 的配对原声。"}),
                "reference_audio_1": ("AUDIO",),
                "reference_audio_2": ("AUDIO",),
                "reference_audio_3": ("AUDIO",),
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
        "media_bundle", "reference_images",
        "video_frames_1", "video_frames_2", "video_frames_3",
        "video_audio_1", "video_audio_2", "video_audio_3",
        "reference_audio_1", "reference_audio_2", "reference_audio_3",
        "media_mapping", "image_count", "video_count", "audio_count",
    )
    OUTPUT_IS_LIST = (
        False, True,
        False, False, False,
        False, False, False,
        False, False, False,
        False, False, False, False,
    )
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台"
    DESCRIPTION = (
        "H3 唯一推荐的标准媒体边界。既可展开导演台 media_bundle，也可把外部 "
        "IMAGE/AUDIO 重新打包。video_frames_* 明确表示视频帧 IMAGE 批次，"
        "避免与 ComfyUI 原生 VIDEO 对象混淆。"
    )

    def execute(self, media_mapping="", media_bundle=None, reference_images=None,
                video_frames_1=None, video_frames_2=None, video_frames_3=None,
                video_audio_1=None, video_audio_2=None, video_audio_3=None,
                reference_audio_1=None, reference_audio_2=None, reference_audio_3=None):
        source = media_bundle if isinstance(media_bundle, dict) else {}
        source_videos = (list(source.get("video_slots") or []) + [None, None, None])[:3]
        source_video_audio = (list(source.get("video_audio_slots") or []) + [None, None, None])[:3]
        source_audio = (list(source.get("audio_slots") or []) + [None, None, None])[:3]

        video_overrides = [video_frames_1, video_frames_2, video_frames_3]
        video_audio_overrides = [video_audio_1, video_audio_2, video_audio_3]
        audio_overrides = [reference_audio_1, reference_audio_2, reference_audio_3]
        videos = [value if value is not None else source_videos[index]
                  for index, value in enumerate(video_overrides)]
        video_audios = [value if value is not None else source_video_audio[index]
                        for index, value in enumerate(video_audio_overrides)]
        audios = [value if value is not None else source_audio[index]
                  for index, value in enumerate(audio_overrides)]
        if reference_images is None:
            images = list(source.get("ref_images") or [])
        else:
            images = EagleH3MediaPackNode._split_images(reference_images)

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
        return (
            bundle, images or [None],
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
