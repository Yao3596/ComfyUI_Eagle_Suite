# -*- coding: utf-8 -*-
"""Svelte UI pilot: normalize a character-interaction preset into prompt data."""

from __future__ import annotations

import json
from typing import Any


SCHEMA = "eagle.character_interaction.v1"
PRODUCTION_LEVELS = ("S", "SR", "SSR", "UR")
DYNAMIC_TYPES = (
    "live_idle", "greeting", "expression_sticker", "showcase",
    "dramatic", "action", "short_drama",
)
DURATIONS = (5, 7, 10, 15)
OUTPUT_MODES = ("single_clip", "single_loop", "optional_chain", "continuous_chain")

DEFAULT_STATE = {
    "schema": SCHEMA,
    "productionLevel": "SR",
    "dynamicType": "live_idle",
    "durationSeconds": 7,
    "outputMode": "single_loop",
    "interactionIntent": "角色面向观众，保持自然呼吸和目光交流",
    "aiMotionAutofill": True,
    "autoScene": True,
    "autoEffects": True,
    "autoCamera": True,
    "preserveIdentity": True,
    "allowVideoReference": False,
    "contentRating": "general",
    "adultMode": False,
    "ageVerified": False,
    "allCharactersAdult": False,
    "consentConfirmed": False,
}

_LEVEL_NOTES = {
    "S": "单一动作、固定镜头、轻量生成",
    "SR": "完整动作弧线与表情变化",
    "SSR": "场景、镜头和特效协同",
    "UR": "多段叙事设计与高复杂度调度",
}

_DYNAMIC_LABELS = {
    "live_idle": "Live 待机互动",
    "greeting": "招呼或登场",
    "expression_sticker": "动态表情包",
    "showcase": "角色展示",
    "dramatic": "情绪演出",
    "action": "动作或战斗",
    "short_drama": "AI 短剧镜头",
}


def _choice(value: Any, allowed: tuple, fallback: Any) -> Any:
    return value if value in allowed else fallback


def _as_bool(value: Any, fallback: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    if value is None:
        return fallback
    return bool(value)


def normalize_interaction_state(raw: Any) -> dict:
    """Parse and normalize untrusted workflow state into the stable v1 contract."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw.strip() else {}
        except (TypeError, ValueError, json.JSONDecodeError):
            raw = {}
    source = raw if isinstance(raw, dict) else {}
    state = dict(DEFAULT_STATE)
    state.update(source)
    state["schema"] = SCHEMA
    state["productionLevel"] = _choice(state.get("productionLevel"), PRODUCTION_LEVELS, "SR")
    state["dynamicType"] = _choice(state.get("dynamicType"), DYNAMIC_TYPES, "live_idle")
    try:
        duration = int(state.get("durationSeconds", 7))
    except (TypeError, ValueError):
        duration = 7
    state["durationSeconds"] = _choice(duration, DURATIONS, 7)
    state["outputMode"] = _choice(state.get("outputMode"), OUTPUT_MODES, "single_loop")
    state["interactionIntent"] = str(state.get("interactionIntent") or DEFAULT_STATE["interactionIntent"]).strip()[:2000]

    bool_keys = (
        "aiMotionAutofill", "autoScene", "autoEffects", "autoCamera",
        "preserveIdentity", "allowVideoReference", "adultMode",
        "ageVerified", "allCharactersAdult", "consentConfirmed",
    )
    for key in bool_keys:
        state[key] = _as_bool(state.get(key), DEFAULT_STATE.get(key, False))

    state["adultGateSatisfied"] = bool(
        state["adultMode"]
        and state["ageVerified"]
        and state["allCharactersAdult"]
        and state["consentConfirmed"]
    )
    state["effectiveContentRating"] = "adult" if state["adultGateSatisfied"] else "general"
    if state["adultMode"] and not state["adultGateSatisfied"]:
        state["contentFallbackReason"] = "adult_gate_incomplete"
    else:
        state.pop("contentFallbackReason", None)
    return state


def build_prompt_fragment(state: dict) -> str:
    loop_enabled = state["outputMode"] in {"single_loop", "continuous_chain"}
    lines = [
        f"【角色交互】{_DYNAMIC_LABELS[state['dynamicType']]}",
        f"【制作强度】{state['productionLevel']}：{_LEVEL_NOTES[state['productionLevel']]}",
        f"【时长与输出】{state['durationSeconds']} 秒；{state['outputMode']}",
        f"【表演意图】{state['interactionIntent']}",
    ]
    lines.append(
        "【角色一致性】锁定脸部、发型、服装、体型与主色，不漂移、不换装。"
        if state["preserveIdentity"] else
        "【角色一致性】允许适度造型变化，但保持角色可识别。"
    )
    lines.append(
        "【动作补全】补齐预备、主动作、缓冲与收势；保持重心、惯性、衣发延迟和视线连续。"
        if state["aiMotionAutofill"] else
        "【动作补全】关闭，只执行输入中明确描述的动作。"
    )
    lines.append(
        "【循环约束】首尾姿态、视线、光照、粒子相位与背景运动闭合；避免停顿、跳帧和重复卡点。"
        if loop_enabled else
        "【循环约束】不强制首尾闭环，保留自然收势与可剪辑尾帧。"
    )
    lines.append(
        f"【自动化】场景 {'开' if state['autoScene'] else '关'}；"
        f"特效 {'开' if state['autoEffects'] else '关'}；"
        f"镜头 {'开' if state['autoCamera'] else '关'}。"
    )
    lines.append(
        "【动作参考】允许视频参考输入；无参考时仍按动作语义推演。"
        if state["allowVideoReference"] else
        "【动作参考】不依赖参考视频，由 AI 根据角色、场景与动作语义推演。"
    )
    if state["effectiveContentRating"] == "adult":
        lines.append("【内容分级】成人向安全闸门已满足；具体生成仍须遵守模型与平台规则。")
    elif state["adultMode"]:
        lines.append("【内容分级】成人向闸门未满足，已自动回退普通级。")
    else:
        lines.append("【内容分级】普通级；S/SR/SSR/UR 只表示制作强度，不表示成人尺度。")
    return "\n".join(lines)


class EagleSvelteCharacterInteractionNode:
    """UI-first character interaction preset that does not load a model."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "interaction_state": (
                    "STRING",
                    {
                        "default": "{}",
                        "multiline": True,
                        "dynamicPrompts": False,
                        "tooltip": "Svelte 面板维护的角色交互 JSON 状态。",
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "INT", "STRING")
    RETURN_NAMES = ("interaction_config", "prompt_fragment", "duration_seconds", "production_level")
    OUTPUT_TOOLTIPS = (
        "规范化后的角色交互 JSON，可供导演台或技能库读取。",
        "可拼接到 H3 场景或镜头提示词的结构化片段。",
        "5/7/10/15 秒标准片段时长。",
        "S/SR/SSR/UR 制作复杂度等级，与成人内容分级独立。",
    )
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 导演台"
    DESCRIPTION = "Svelte UI 技术验证节点：规划角色动态、循环、拼接、自动化和独立内容分级。"

    def execute(self, interaction_state="{}"):
        state = normalize_interaction_state(interaction_state)
        prompt = build_prompt_fragment(state)
        return (
            json.dumps(state, ensure_ascii=False, indent=2),
            prompt,
            state["durationSeconds"],
            state["productionLevel"],
        )


__all__ = [
    "EagleSvelteCharacterInteractionNode",
    "normalize_interaction_state",
    "build_prompt_fragment",
]
