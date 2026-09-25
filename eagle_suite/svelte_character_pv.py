# -*- coding: utf-8 -*-
"""Standalone Svelte character-PV planner using the H3 Director PV field contract."""

from __future__ import annotations

import json
from typing import Any


SCHEMA = "eagle.character_pv.v1"
PRODUCTION_LEVELS = ("S", "SR", "SSR", "UR")
DURATIONS = (5, 7, 10, 15)
OUTPUT_MODES = ("single_clip", "single_loop", "optional_chain", "continuous_chain")
THEMES = ("auto", "hero_origin", "neon_idol", "fantasy_relic", "urban_chase", "dream_archive", "dark_rival", "festival_stage", "tech_interface", "fashion_editorial", "quiet_portrait")
VISUAL_STYLES = ("auto", "anime_cel", "live_action_cinematic", "graphic_comic", "y2k_digital", "retro_film", "luxury_editorial", "minimal_monochrome", "holographic", "ink_paper")
TEMPLATES = ("character_reveal", "kinetic_typography", "image_flash", "mixed_pv", "action_showcase", "emotional_memory", "fashion_editorial")
RHYTHMS = ("beat_sync", "impact_accents", "smooth_cinematic", "glitch_cut", "syncopated", "crescendo")
EDIT_GRAMMARS = ("auto", "detail_to_hero", "match_on_action", "shape_match", "color_match", "eyeline_bridge", "beat_strobe", "time_remap", "split_screen", "freeze_smash", "foreground_wipe")
ACTION_PROFILES = ("calm", "graceful", "energetic", "combat", "idol", "mysterious", "comedic")
TEXT_TREATMENTS = ("safe_title", "hero_nameplate", "kinetic_words", "subtitle_card", "no_text")
TRANSITIONS = {"hard_cut", "cut_on_action", "flash_cut", "match_cut", "graphic_match", "whip_pan", "whip_zoom", "foreground_wipe", "luma_wipe", "mask_wipe", "split_screen_push", "parallax_push", "speed_ramp", "freeze_smash", "film_burn", "glitch_slice", "zoom_blur", "light_sweep", "dip_to_color"}
EFFECTS = {"deep_glow", "bokeh", "rgb_split", "pixel_sort", "jpeg_glitch", "frame_echo", "light_leak", "thick_stroke", "halftone", "chromatic_trails", "particle_burst", "scanline", "film_grain", "lens_distortion", "bloom_pulse", "silhouette", "posterize", "ink_spread", "hologram", "graphic_shapes"}

DEFAULT_STATE = {
    "schema": SCHEMA,
    "enabled": True,
    "productionLevel": "SSR",
    "durationSeconds": 10,
    "outputMode": "optional_chain",
    "theme": "auto",
    "visualStyle": "auto",
    "template": "character_reveal",
    "rhythm": "beat_sync",
    "editGrammar": "match_on_action",
    "actionProfile": "graceful",
    "cutDensity": "medium",
    "bpm": 120,
    "beatOffsetMs": 0,
    "title": "",
    "subtitle": "",
    "textTreatment": "hero_nameplate",
    "reserveTitleSafeArea": True,
    "allowVideoReference": False,
    "transitions": ["flash_cut", "match_cut", "whip_zoom"],
    "effects": ["deep_glow", "bokeh", "rgb_split"],
    "creativeBrief": "围绕角色标志性外观和性格完成一次有记忆点的登场展示",
    "actionDirection": "",
    "notes": "",
    "adultMode": False,
    "ageVerified": False,
    "allCharactersAdult": False,
    "consentConfirmed": False,
}

_THEME_TEXT = {
    "auto": "infer a coherent theme from the character and brief",
    "hero_origin": "hero origin and identity reveal", "neon_idol": "neon idol stage and fan-energy spectacle",
    "fantasy_relic": "fantasy relic awakening and magical lore", "urban_chase": "urban pursuit and kinetic street energy",
    "dream_archive": "dream archive, memory fragments and symbolism", "dark_rival": "dark rival confrontation and controlled menace",
    "festival_stage": "festival stage and celebratory rhythmic performance", "tech_interface": "future interface and holographic systems",
    "fashion_editorial": "fashion editorial and material detail", "quiet_portrait": "quiet portrait and restrained atmosphere",
}
_STYLE_TEXT = {
    "auto": "preserve and infer the reference medium", "anime_cel": "clean 2D anime linework and readable key poses",
    "live_action_cinematic": "physically weighted live-action motion and cinematic optics", "graphic_comic": "graphic comic panels and bold shapes",
    "y2k_digital": "Y2K digital graphics and chrome accents", "retro_film": "analog film texture and optical light",
    "luxury_editorial": "luxury editorial lighting and material detail", "minimal_monochrome": "high-contrast monochrome forms and negative space",
    "holographic": "holographic separation and translucent layers", "ink_paper": "ink-and-paper texture and brush transitions",
}
_TEMPLATE_TEXT = {
    "character_reveal": "detail inserts, identity reveal, signature action, then a clean hero hold",
    "kinetic_typography": "graphic masks and title-safe plates; exact typography is added in post",
    "image_flash": "rhythmic image-flash montage with readable poses and detail inserts",
    "mixed_pv": "character reveal, action inserts, graphic title plates and a decisive end card",
    "action_showcase": "anticipation, peak pose, impact insert and controlled recovery",
    "emotional_memory": "lyrical memory fragments and expressive close-ups building to a hero frame",
    "fashion_editorial": "editorial posing, material details and precise visual punctuation",
}
_RHYTHM_TEXT = {
    "beat_sync": "cut and accent on the declared beat grid", "impact_accents": "hold between a few strong impact accents",
    "smooth_cinematic": "longer phrases and restrained motivated transitions", "glitch_cut": "concise glitch interruptions while keeping the character readable",
    "syncopated": "alternate on-beat anchors with restrained off-beat inserts", "crescendo": "increase cut frequency gradually and resolve on a clean hero frame",
}
_ACTION_TEXT = {
    "calm": "restrained breathing, gaze and a confident hero hold", "graceful": "elegant turn and costume gesture with smooth recovery",
    "energetic": "clear anticipation, readable action accents and stable recovery", "combat": "guard, wind-up, one decisive technique and a readable impact silhouette",
    "idol": "performance gesture, audience-facing eyeline and rhythmic pose changes", "mysterious": "partial reveal, controlled gaze and restrained prop interaction",
    "comedic": "concise reaction, readable exaggeration and a clean loopable reset",
}


def _choice(value: Any, allowed: tuple, fallback: Any) -> Any:
    return value if value in allowed else fallback


def _as_bool(value: Any, fallback: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return fallback if value is None else bool(value)


def _bounded_int(value: Any, low: int, high: int, fallback: int) -> int:
    try:
        return max(low, min(high, int(float(value))))
    except (TypeError, ValueError):
        return fallback


def _clean_list(value: Any, allowed: set) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    result = []
    for item in value:
        item = str(item)
        if item in allowed and item not in result:
            result.append(item)
    return result


def normalize_pv_state(raw: Any) -> dict:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw.strip() else {}
        except (TypeError, ValueError, json.JSONDecodeError):
            raw = {}
    source = raw if isinstance(raw, dict) else {}
    state = dict(DEFAULT_STATE)
    state.update(source)
    state["schema"] = SCHEMA
    state["productionLevel"] = _choice(state.get("productionLevel"), PRODUCTION_LEVELS, "SSR")
    try:
        duration = int(float(state.get("durationSeconds", 10)))
    except (TypeError, ValueError):
        duration = 10
    state["durationSeconds"] = _choice(duration, DURATIONS, 10)
    state["outputMode"] = _choice(state.get("outputMode"), OUTPUT_MODES, "optional_chain")
    for key, allowed, fallback in (
        ("theme", THEMES, "auto"), ("visualStyle", VISUAL_STYLES, "auto"),
        ("template", TEMPLATES, "character_reveal"), ("rhythm", RHYTHMS, "beat_sync"),
        ("editGrammar", EDIT_GRAMMARS, "match_on_action"), ("actionProfile", ACTION_PROFILES, "graceful"),
        ("textTreatment", TEXT_TREATMENTS, "hero_nameplate"),
    ):
        state[key] = _choice(state.get(key), allowed, fallback)
    state["cutDensity"] = _choice(state.get("cutDensity"), ("sparse", "medium", "dense"), "medium")
    state["bpm"] = _bounded_int(state.get("bpm"), 40, 240, 120)
    state["beatOffsetMs"] = _bounded_int(state.get("beatOffsetMs"), -2000, 2000, 0)
    for key in ("enabled", "reserveTitleSafeArea", "allowVideoReference", "adultMode", "ageVerified", "allCharactersAdult", "consentConfirmed"):
        state[key] = _as_bool(state.get(key), DEFAULT_STATE.get(key, False))
    for key in ("title", "subtitle", "creativeBrief", "actionDirection", "notes"):
        state[key] = str(state.get(key) or "").strip()[:2000]
    state["transitions"] = _clean_list(state.get("transitions"), TRANSITIONS)
    state["effects"] = _clean_list(state.get("effects"), EFFECTS)
    state["adultGateSatisfied"] = bool(state["adultMode"] and state["ageVerified"] and state["allCharactersAdult"] and state["consentConfirmed"])
    return state


def build_pv_prompt(state: dict) -> str:
    loop = state["outputMode"] in {"single_loop", "continuous_chain"}
    lines = [
        "CHARACTER PV / MOTION-GRAPHICS CONTRACT:",
        f"- Duration budget: {state['durationSeconds']} seconds; production level {state['productionLevel']}; output mode {state['outputMode']}.",
        f"- Theme: {_THEME_TEXT[state['theme']] }.",
        f"- Visual style: {_STYLE_TEXT[state['visualStyle']] }.",
        f"- Template: {_TEMPLATE_TEXT[state['template']] }.",
        f"- Rhythm: {_RHYTHM_TEXT[state['rhythm']] }; beat grid {state['bpm']} BPM with {state['beatOffsetMs']} ms offset.",
        f"- Editing grammar: {state['editGrammar']}; edit density: {state['cutDensity']}.",
        f"- Character action profile: {_ACTION_TEXT[state['actionProfile']] }.",
        "- Planned transitions for post: " + (", ".join(state["transitions"]) or "clean_cut") + ".",
        "- Planned effects for post: " + (", ".join(state["effects"]) or "none") + ".",
        "- Generate clean, temporally stable character plates; preserve identity, face, hairstyle, costume, proportions, signature props and palette across every cut.",
        "- Treat flashes, RGB split, pixel sorting, glitches, exact masks and final typography as post-production cues; never deform the character to imitate them.",
        "- Do not draw readable titles, logos, UI or watermarks inside generated footage.",
        f"- Typography treatment for post: {state['textTreatment']}.",
    ]
    if state["reserveTitleSafeArea"]:
        lines.append("- Reserve uncluttered title-safe negative space without covering the face, hands or costume details.")
    lines.append("- Match the final pose, gaze, lighting and graphic phase to the opening frame for a seamless loop." if loop else "- Keep a stable editorial tail frame for cutting or optional assembly.")
    lines.append("- Video motion reference is allowed when supplied." if state["allowVideoReference"] else "- Do not require video reference; infer motion from character intent and action semantics.")
    if state["title"]:
        lines.append("- Exact post title (metadata only): " + state["title"])
    if state["subtitle"]:
        lines.append("- Exact post subtitle (metadata only): " + state["subtitle"])
    if state["creativeBrief"]:
        lines.append("- Creative brief: " + state["creativeBrief"])
    if state["actionDirection"]:
        lines.append("- Selected action direction: " + state["actionDirection"])
    if state["notes"]:
        lines.append("- User PV direction: " + state["notes"])
    lines.append("- Adult gate satisfied; remain within model and platform rules." if state["adultGateSatisfied"] else "- General-audience content profile; S/SR/SSR/UR indicates production complexity only.")
    return "\n".join(lines)


def build_director_patch(state: dict) -> dict:
    pv_keys = (
        "enabled", "theme", "visualStyle", "editGrammar", "actionProfile", "textTreatment",
        "template", "rhythm", "cutDensity", "bpm", "beatOffsetMs", "title", "subtitle",
        "reserveTitleSafeArea", "allowVideoReference", "transitions", "effects",
        "creativeBrief", "actionDirection", "notes",
    )
    return {
        "schema": SCHEMA,
        "workflowType": "character_pv",
        "globalDuration": state["durationSeconds"],
        "interaction": {
            "productionLevel": state["productionLevel"],
            "outputMode": state["outputMode"],
            "adultEnabled": state["adultGateSatisfied"],
            "adultTier": "R18" if state["adultGateSatisfied"] else "off",
            "adultSubjectsVerified": bool(state["ageVerified"] and state["allCharactersAdult"]),
            "consentConfirmed": state["consentConfirmed"],
        },
        "pv": {key: state[key] for key in pv_keys},
    }


def build_post_production(state: dict) -> dict:
    overlays = []
    if state["title"]:
        overlays.append({"role": "title", "text": state["title"], "treatment": state["textTreatment"], "stage": "post_production"})
    if state["subtitle"]:
        overlays.append({"role": "subtitle", "text": state["subtitle"], "treatment": state["textTreatment"], "stage": "post_production"})
    return {
        "schema": "eagle-character-pv-post@1.0",
        "render_stage": "post_production",
        "generation_stage": "clean_character_plates",
        "generation_can_render_exact_text": False,
        "duration_seconds": state["durationSeconds"],
        "output_mode": state["outputMode"],
        "bpm": state["bpm"],
        "beat_offset_ms": state["beatOffsetMs"],
        "transitions": state["transitions"],
        "effects": state["effects"],
        "text_overlays": overlays,
    }


class EagleSvelteCharacterPVNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"pv_state": ("STRING", {"default": "{}", "multiline": True, "dynamicPrompts": False, "tooltip": "Svelte 面板维护的角色 PV JSON 状态。"})}}

    RETURN_TYPES = ("STRING", "STRING", "STRING", "INT", "STRING")
    RETURN_NAMES = ("director_project_patch", "prompt_fragment", "post_production_json", "duration_seconds", "production_level")
    OUTPUT_TOOLTIPS = (
        "与 H3 导演台 workflowType/interaction/pv 字段兼容的项目补丁。",
        "可直接作为角色 PV 镜头或场景的 H3 提示词片段。",
        "剪辑台可消费的转场、特效、节拍与文字叠加元数据。",
        "标准 5/7/10/15 秒片段时长。",
        "S/SR/SSR/UR 制作复杂度等级。",
    )
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台"
    DESCRIPTION = "独立角色 PV 动效规划器：生成稳定角色底片提示词与后期制作元数据，不加载视频模型。"

    def execute(self, pv_state="{}"):
        state = normalize_pv_state(pv_state)
        return (
            json.dumps(build_director_patch(state), ensure_ascii=False, indent=2),
            build_pv_prompt(state),
            json.dumps(build_post_production(state), ensure_ascii=False, indent=2),
            state["durationSeconds"],
            state["productionLevel"],
        )


__all__ = ["EagleSvelteCharacterPVNode", "normalize_pv_state", "build_pv_prompt", "build_director_patch", "build_post_production"]
