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

from aiohttp import web

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

_KIND_NOUN = {
    "person": "a character",
    "prop": "a prop",
    "style": "an art style",
    "environment": "an environment",
    "composition": "a composition",
}


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
        return [item for item in media if isinstance(item, dict) and item.get("filename")]

    legacy = _safe_get(project, "refs", []) or []
    migrated = []
    for index, item in enumerate(legacy):
        if not isinstance(item, dict) or not item.get("filename"):
            continue
        migrated.append({
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
        })
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


def _used_ref_indices(project):
    """返回有 filename 的参考槽下标列表（0-based）。"""
    images = [item for item in _project_media(project) if item.get("type", "image") == "image"]
    return list(range(len(images)))


def build_subject_definitions(project):
    lines = []
    for r, number, tag_name in _numbered_media(project):
        kind = r.get("kind", "person")
        if r.get("type", "image") == "image":
            noun = _KIND_NOUN.get(kind, "an image")
        elif r.get("type") == "video":
            noun = "a video"
        else:
            noun = "an audio"
        name = (r.get("name") or "").strip()
        of_name = f" of {name}" if name else ""
        lines.append(f"  <{tag_name} {number}> is {noun}{of_name} reference.")
    return "\n".join(lines)


def build_retention(project):
    lines = []
    image_number = 0
    for r in _project_media(project):
        if r.get("type", "image") != "image":
            continue
        image_number += 1
        ret = r.get("retention", "fully_preserved") or "fully_preserved"
        name = (r.get("name") or "").strip()
        name_tag = f" ({name})" if name else ""
        line = f"  <Picture {image_number}>{name_tag}: {ret}."
        if r.get("kind") == "person":
            line += " Do not copy the background of the reference image; keep only the character design."
        lines.append(line)
    return "\n".join(lines)


def _build_shot_blocks(shots):
    if not shots:
        return ""
    lines = []
    for i, s in enumerate(shots):
        if not isinstance(s, dict):
            continue
        parts = []
        if s.get("time"):
            parts.append(f"At {s['time']},")
        if s.get("framing"):
            parts.append(f"[{s['framing']}]")
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
        lines.append(f"[Shot {i + 1}: {s.get('title') or 'untitled'}] " + " ".join(parts))
    if not lines:
        return ""
    return "detailed_description:\n  " + "\n\n  ".join(lines)


def _build_dialogue_block(dialogues):
    items = []
    for d in dialogues:
        if not isinstance(d, dict):
            continue
        role = (d.get("role") or "").strip()
        text = (d.get("text") or "").strip()
        if role and text:
            items.append(f"  <d>[{role}] {text}</d>")
    if not items:
        return ""
    return "Dialogue:\n" + "\n".join(items)


def _strip_dialogue_tags(text):
    """移除文本中所有 <d>...</d> 标签，压缩多余空行。"""
    text = re.sub(r"<d>.*?</d>", "", text, flags=re.S)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _build_body(project, scene):
    preamble = _strip_dialogue_tags(_safe_get(scene, "preamble", ""))
    detailed = _build_shot_blocks(_safe_get(scene, "shots", []) or [])
    dialogue = _build_dialogue_block(_safe_get(scene, "dialogues", []) or [])
    sections = [x for x in [preamble, detailed, dialogue] if x]
    return "\n\n".join(sections)


def _build_alignment(project):
    """按生成模式追加对齐/一致性指令（原型未做，v1 新增）。"""
    mode = _safe_get(project, "mode", "t2v")
    used = _used_ref_indices(project)
    if mode in ("i2v", "fl2v"):
        if not used:
            return ""
        n = used[0] + 1
        if mode == "fl2v":
            return (
                "alignment:\n"
                f"  For the target video, the first and last frames must match <Picture {n}> composition and subject.\n"
                "  How the reference pictures align with the described shots: keep subject identity and key framing."
            )
        return (
            "alignment:\n"
            f"  The first frame must match <Picture {n}> as the starting image.\n"
            "  How the reference pictures align with the described shots: maintain subject and style continuity."
        )
    if mode in ("r2v", "rv2v"):
        return (
            "character_consistency:\n"
            "  Maintain strict identity, outfit, and silhouette across all shots using the provided character references."
        )
    return ""


def compile_scene_prompt(project, scene):
    """编译单个场景为标准 H3 提示词字符串。"""
    if not isinstance(project, dict):
        project = {}
    if not isinstance(scene, dict):
        scene = {}

    parts = []
    mode = (_safe_get(project, "mode", "t2v") or "t2v").upper()
    secs = _safe_get(scene, "defaultSeconds", 10) or 10
    aspect = _safe_get(project, "aspect", "9:16")
    resolution = _safe_get(project, "resolution", "720p")
    fps = _safe_get(project, "fps", 24) or 24

    # 1. Task
    parts.append(f"Task: {mode}, {secs}s, {aspect}, {resolution}, {fps}fps.")

    # 2. subject_definitions
    subj = build_subject_definitions(project)
    if subj:
        parts.append("subject_definitions:\n" + subj)

    # 3. integrated_multimodal_description
    foundation = _safe_get(project, "foundation", "").strip()
    if foundation:
        parts.append("integrated_multimodal_description:\n  " + foundation.replace("\n", "\n  "))

    # 4. retention_analysis
    ret = build_retention(project)
    if ret:
        parts.append("retention_analysis:\n" + ret)

    # 5. 正文（preamble + 镜头块 + 台词块）
    body = _build_body(project, scene)
    if body:
        parts.append(body)

    # 6. overall_soundscape（仅在镜头有音效时输出，避免默认占位词污染视频）
    shots = _safe_get(scene, "shots", []) or []
    sounds = [s.get("sound") for s in shots if isinstance(s, dict) and s.get("sound")]
    if sounds:
        parts.append("overall_soundscape:\n  " + ", ".join(sounds))

    # 7. non_diegetic_music（仅在全局配置了音乐时输出）
    global_music = _safe_get(project, "globalMusic", "").strip()
    if global_music:
        parts.append("non_diegetic_music:\n  " + global_music.replace("\n", "\n  "))

    # 模式对齐指令
    align = _build_alignment(project)
    if align:
        parts.append(align)

    return "\n\n".join(parts)


def _build_global_prefix(project):
    """编译全局共享前缀（prompt_prefix），与每个 scene_prompt 拼接组成完整 prompt。"""
    parts = []

    # subject_definitions
    subj = build_subject_definitions(project)
    if subj:
        parts.append("subject_definitions:\n" + subj)

    # integrated_multimodal_description
    foundation = _safe_get(project, "foundation", "").strip()
    if foundation:
        if foundation.lstrip().startswith("integrated_multimodal_description:"):
            parts.append(foundation)
        else:
            parts.append("integrated_multimodal_description:\n" + foundation)

    # retention_analysis
    ret = build_retention(project)
    if ret:
        parts.append("retention_analysis:\n" + ret)

    # 全局 overall_soundscape / non_diegetic_music（从 project 取，场景级会覆盖）
    global_sound = _safe_get(project, "globalSoundscape", "").strip()
    global_music = _safe_get(project, "globalMusic", "").strip()
    if global_sound:
        parts.append("overall_soundscape:\n  " + global_sound.replace("\n", "\n  "))
    if global_music:
        parts.append("non_diegetic_music:\n  " + global_music.replace("\n", "\n  "))

    return "\n\n".join(parts)


def _build_scene_prompt(project, scene):
    """编译单个场景的独有部分（不含 prompt_prefix），供 Scene Prompt Editor 展示。"""
    parts = []
    detailed = _build_shot_blocks(_safe_get(scene, "shots", []) or [])
    if detailed:
        parts.append(detailed)

    # 台词块追加到 body（如果存在）
    dialogue = _build_dialogue_block(_safe_get(scene, "dialogues", []) or [])
    if dialogue:
        parts.append(dialogue)

    # preamble（去除已有的 <d> 台词标签，避免重复）
    preamble = _strip_dialogue_tags(_safe_get(scene, "preamble", ""))
    if preamble:
        # 放到最前面（场景前言）
        parts.insert(0, preamble)

    # 场景级 overall_soundscape（无默认值，避免污染 scene_prompt）
    shots = _safe_get(scene, "shots", []) or []
    sounds = [s.get("sound") for s in shots if isinstance(s, dict) and s.get("sound")]
    if sounds:
        parts.append("overall_soundscape:\n  " + ", ".join(sounds))

    # 场景级 non_diegetic_music：目前 UI 无 per-scene music，由 _build_global_prefix 统一输出全局音乐，
    # 此处仅当 scene 显式携带 music 字段时才覆盖，避免与 prefix 重复。
    scene_music = _safe_get(scene, "music", "").strip()
    if scene_music:
        parts.append("non_diegetic_music:\n  " + scene_music.replace("\n", "\n  "))

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

        # scene 级 context_length 覆盖
        shot_context_length = _snap_context_length(_safe_get(s, "contextLength", None))
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
            "scene_prompt": scene_prompt,
            "prompt": full_prompt,
            "prompt_hash": _fingerprint(full_prompt),
            "seed": seed,
            "steps": steps,
            "raw_frames": raw_frames,
            "delivered_frames": delivered_frames,
            "generation_start_frame": generation_start_frame,
            "audio_start_seconds": generation_start_frame / float(fps),
            "audio_duration_seconds": raw_frames / float(fps),
        }

        # 仅当与全局默认值不同才写入覆盖字段
        if shot_context_length != context_length:
            shot["context_length"] = shot_context_length
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
        "generation_fingerprint": generation_fingerprint,
    }
    if continuation_mode != "guide":
        compatibility["continuation_mode"] = continuation_mode
    context_storage_length = max([context_length] + resolved_context_lengths)
    if context_storage_length > context_length:
        compatibility["context_storage_length"] = context_storage_length

    plan = {
        "version": H3_PLAN_VERSION,
        "run_name": run_name,
        "prompt_prefix": prompt_prefix,
        "shots": shots_list,
        "compatibility": compatibility,
        "segment_crf": segment_crf,
        "total_delivered_frames": stitched_frames,
        "reference_media": [
            {
                "id": item.get("id", ""),
                "type": item.get("type", "image"),
                "filename": item.get("filename", ""),
                "name": item.get("name", ""),
                "duration": float(item.get("duration", 0.0) or 0.0),
                "trim_start": float(item.get("trimStart", 0.0) or 0.0),
                "trim_end": float(item.get("trimEnd", item.get("duration", 0.0)) or 0.0),
            }
            for item in _project_media(project)
        ],
    }
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
        f"refs={media_counts['image']}/{media_counts['video']}/{media_counts['audio']}; run={run_name}"
    )

    return plan


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
            return ("local", {"path": local_model["path"]})
    else:  # local 优先（默认）
        if local_ok:
            return ("local", {"path": local_model["path"]})
        if api_ok:
            return ("api", {"key": api_key, "base": api_base, "model": api_model})
    if api_ok:
        return ("api", {"key": api_key, "base": api_base, "model": api_model})
    if local_ok:
        return ("local", {"path": local_model["path"]})
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
    from .local_llm_node import generate_local_text
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


def _build_skill_prompts(task, project, scene, hint, director_skill="", request=None):
    """返回 (system, user) 提示词。"""
    foundation = (project.get("foundation") or "").strip()
    director_skill = (director_skill or project.get("director_skill") or "").strip()
    director_skill = _compose_director_guidance(task, request, director_skill)
    title = (scene.get("title") or "").strip() or "未命名场景"
    preamble = (scene.get("preamble") or "").strip()
    director_ctx = ""
    if director_skill:
        director_ctx = "【导演技能库 / Director Skill】\n" + director_skill + "\n\n"
    if task == "script":
        user = (
            "【Shared prompt / 世界构建】\n" + (foundation or "(无，请自行设定统一风格)") + "\n\n"
            "【场景标题】" + title + "\n"
            "【用户额外指令】" + (hint or "(无)") + "\n\n"
            "请撰写该场景的完整台本（screenplay）。要求：\n"
            "1. 用 [Shot 1]、[Shot 2]… 标记划分镜头；\n"
            "2. 每个镜头写英文描述（主体 / 动作 / 运镜 / 氛围），单镜头约 10 秒且自包含，"
            "不得出现“如前所述”“同上”等承接语；\n"
            "3. 角色台词用内联标签：<d>[角色名] 中文台词（≤30 字）</d>；\n"
            "4. 输出 ONLY JSON：{\"preamble\":\"...\"}\n"
        )
        return _SKILL_SYSTEM, director_ctx + user
    if task == "shots":
        user = (
            "【场景标题】" + title + "\n"
            "【现有台本】\n" + (preamble or "(空)") + "\n\n"
            "请将台本拆分为镜头条目。输出 ONLY JSON：\n"
            "{\"shots\":[{\"title\":\"\",\"time\":\"00:00.000\",\"framing\":\"\","
            "\"content\":\"\",\"camera\":\"\",\"lens\":\"\",\"intent\":\"\","
            "\"action\":\"\",\"sound\":\"\",\"transitionIn\":\"\",\"transitionOut\":\"\","
            "\"estSeconds\":2.5}]}\n"
            "要求：time 顺序递增；estSeconds 之和约等于场景时长；framing 用 "
            "extreme_close_up / close_up / medium_shot / cowboy_shot / full_body / wide_shot "
            "之一或空；content 为英文镜头描述。"
        )
        return _SKILL_SYSTEM, director_ctx + user
    if task == "dialogue":
        user = (
            "【场景标题】" + title + "\n"
            "【现有台本】\n" + (preamble or "(空)") + "\n\n"
            "请提取 / 补全所有台词。输出 ONLY JSON：\n"
            "{\"dialogues\":[{\"role\":\"角色名\",\"text\":\"中文台词（≤30 字）\",\"time\":\"00:00.000\"}]}\n"
            "要求：text 为简洁中文，≤30 字；time 为该句出现的大致时间码。"
        )
        return _SKILL_SYSTEM, director_ctx + user
    return _SKILL_SYSTEM, ""


def run_director_skill(project, scenes, request, api_config=None, local_model=None, director_skill=""):
    """运行导演 Skill，返回 {scene_id, preamble, dialogues, shots, transport, error}。"""
    out = {
        "scene_id": request.get("sceneId"),
        "sceneId": request.get("sceneId"),
        "preamble": None, "dialogues": None, "shots": None,
        "transport": None, "error": None,
        "skill_profile": request.get("profile", "balanced"),
        "skill_policy": request.get("skillPolicy", "merge"),
    }
    try:
        tasks = request.get("tasks") or []
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
        for s in scenes:
            if s.get("id") == out["scene_id"]:
                scene = s
                break
        if scene is None and scenes:
            scene = scenes[0]
        if scene is None:
            out["error"] = "没有可用场景。"
            return out
        out["scene_id"] = scene.get("id")
        out["sceneId"] = scene.get("id")

        cur = {
            "preamble": scene.get("preamble", ""),
            "shots": scene.get("shots", []),
            "dialogues": scene.get("dialogues", []),
        }
        for task in tasks:
            if task not in ("script", "shots", "dialogue"):
                continue
            sys_p, user_p = _build_skill_prompts(
                task, project, cur, hint, director_skill, request=request
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
    """从 REF_DIR 加载单张参考图，按 max_megapixels 限制缩放，返回 [1,H,W,3] float32 张量；失败返回 None。"""
    try:
        from PIL import Image
        import numpy as np
        import torch
        path = os.path.join(REF_DIR, os.path.basename(filename))
        if not os.path.isfile(path):
            return None
        img = Image.open(path).convert("RGB")
        img = _fit_to_max_megapixels(img, max_megapixels, filename=filename)
        arr = np.array(img).astype(np.float32) / 255.0
        return torch.from_numpy(arr)[None,]
    except Exception as e:
        logger.warning(f"[EagleH3Director] 参考图加载失败 {filename}: {e}")
        return None


def _media_path(filename):
    """Resolve a saved director media filename without allowing directory traversal."""
    if not filename:
        return ""
    path = os.path.join(REF_DIR, os.path.basename(str(filename)))
    return path if os.path.isfile(path) else ""


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

    # 与 ethanfel MiniMaxH3ChainPlan 对齐：plan 为 H3_CHAIN_PLAN 自定义类型
    # MiniMax H3 的 Autogrow 参考输入每个插槽接收一个普通 IMAGE/AUDIO，
    # 不能接 ComfyUI 的 list-output。因此视频与音频按目标插槽逐路输出。
    # 前 10 个输出的位置保持不变，减少旧工作流迁移成本。
    RETURN_TYPES = (H3_PLAN_TYPE, "IMAGE", "INT", "INT", "INT", "INT", "STRING",
                    "IMAGE", "AUDIO", "STRING",
                    "AUDIO", "IMAGE", "AUDIO", "IMAGE", "AUDIO", "AUDIO", "AUDIO")
    RETURN_NAMES = ("plan", "REF_IMAGES", "width", "height", "clip_count",
                    "video_blend_frames", "summary",
                    "ref_videos.ref_video_0", "ref_audios.ref_audio_0", "media_mapping",
                    "ref_video_audios.ref_video_audio_0",
                    "ref_videos.ref_video_1", "ref_video_audios.ref_video_audio_1",
                    "ref_videos.ref_video_2", "ref_video_audios.ref_video_audio_2",
                    "ref_audios.ref_audio_1", "ref_audios.ref_audio_2")
    OUTPUT_IS_LIST = (False, True, False, False, False, False, False,
                      False, False, False, False, False, False, False, False, False, False)
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

        # 导演技能库节点输出的技能内容，作为生成上下文（关联导演技能库）
        if director_skill and director_skill.strip():
            if not isinstance(project, dict):
                project = {}
            project["director_skill"] = director_skill.strip()

        # ── 导演 Skill 生成（手动「生成」按钮触发）──
        if skill_request and skill_request.strip():
            try:
                req = json.loads(skill_request)
                if req.get("run"):
                    result = run_director_skill(
                        project, scenes, req, api_config=api_config, local_model=local_model,
                        director_skill=director_skill
                    )
                    result["node_id"] = node_id
                    try:
                        from server import PromptServer
                        ps = getattr(PromptServer, "instance", None)
                        if ps:
                            ps.send_sync("h3_director_skill_result", result)
                    except Exception as e:
                        logger.warning(f"[EagleH3Director] 推送 skill 结果失败: {e}")
            except Exception as e:
                logger.warning(f"[EagleH3Director] skill_request 解析失败: {e}")

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
            ref_video_audios.append(_load_audio_clip(
                item.get("filename", ""), trim_start, trim_end
            ))

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

        return (plan_data, ref_images, width_val, height_val,
                clip_count, video_blend_frames_val, summary,
                video_slots[0], audio_slots[0], media_mapping,
                video_audio_slots[0],
                video_slots[1], video_audio_slots[1],
                video_slots[2], video_audio_slots[2],
                audio_slots[1], audio_slots[2])


# ────────────────────────────────────────────────────────────────────────────
# 路由：多模态参考素材上传 / 预览
# ────────────────────────────────────────────────────────────────────────────

_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
_VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"}
_AUDIO_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".opus"}


@route("POST", "/h3_director/upload_media")
async def upload_media(request):
    """Save one director-owned image/video/audio reference and return normalized metadata."""
    try:
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
        out_path = os.path.join(REF_DIR, filename)
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
                with Image.open(out_path) as uploaded:
                    if uploaded.width * uploaded.height > 80_000_000:
                        raise ValueError("image pixel count too large")
                    uploaded.verify()
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
                "filename": filename,
                "originalName": original_name,
                "name": "",
                "kind": "person" if media_type == "image" else "reference",
                "retention": "fully_preserved",
                "duration": round(duration, 4),
                "trimStart": 0.0,
                "trimEnd": round(duration, 4),
                "url": "/h3_director/media?filename=" + filename,
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
    filename = os.path.basename(request.query.get("filename", ""))
    if not filename.startswith(("media_", "ref_")):
        return web.json_response({"success": False, "error": "invalid filename"}, status=400)
    path = _media_path(filename)
    if not path:
        return web.json_response({"success": True, "deleted": False})
    try:
        os.remove(path)
        return web.json_response({"success": True, "deleted": True})
    except OSError as error:
        return web.json_response({"success": False, "error": str(error)}, status=500)

@route("POST", "/h3_director/upload_ref")
async def upload_ref(request):
    """接收前端上传的参考图，保存到 REF_DIR，返回 {filename}。"""
    try:
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
        out_path = os.path.join(REF_DIR, safe_name)
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
            with Image.open(out_path) as uploaded:
                if uploaded.width * uploaded.height > 80_000_000:
                    raise ValueError("image pixel count too large")
                uploaded.verify()
        except Exception as validation_error:
            try:
                os.remove(out_path)
            except OSError:
                pass
            return web.json_response({"success": False, "error": str(validation_error)}, status=400)
        return web.json_response({"success": True, "filename": safe_name})
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
        path = os.path.join(REF_DIR, os.path.basename(filename))
        if not os.path.isfile(path):
            return web.Response(status=404)
        return web.FileResponse(path)
    except Exception as e:
        logger.warning(f"[EagleH3Director] ref_proxy 失败: {e}")
        return web.Response(status=500)


__all__ = ["EagleH3DirectorNode"]
