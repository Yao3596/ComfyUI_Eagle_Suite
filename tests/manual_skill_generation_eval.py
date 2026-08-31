"""Manual end-to-end evaluator for H3 Director Skill generation.

Uses the first configured LLM profile with a key. It never prints credentials.
Run explicitly; this file is not discovered by unittest because it has no TestCase.
"""

from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import re
import sys


REPO = pathlib.Path(__file__).resolve().parents[1]
COMFY_ROOT = pathlib.Path(os.environ.get("COMFYUI_ROOT", r"E:\ComfyUI-AKI\ComfyUI"))
sys.path.insert(0, str(COMFY_ROOT))
SPEC = importlib.util.spec_from_file_location(
    "eagle_skill_eval_package",
    REPO / "__init__.py",
    submodule_search_locations=[str(REPO)],
)
PACKAGE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PACKAGE
SPEC.loader.exec_module(PACKAGE)

from eagle_skill_eval_package.eagle_suite import api_config_manager
from eagle_skill_eval_package.eagle_suite.h3_director_node import run_director_skill


def _time_seconds(value: str):
    match = re.fullmatch(r"(?:(\d+):)?(\d+)(?:\.(\d+))?", str(value or "").strip())
    if not match:
        return None
    minutes = int(match.group(1) or 0)
    seconds = int(match.group(2) or 0)
    fraction = float("0." + (match.group(3) or "0"))
    return minutes * 60 + seconds + fraction


def _skill_snapshot():
    data = json.loads((REPO / "eagle_suite" / "skills" / "director_skills.json").read_text(encoding="utf-8"))
    wanted = {
        "pro-v1-story-architecture",
        "pro-v1-shot-language",
        "pro-v1-camera-motion",
        "pro-v1-transitions",
        "pro-v1-rhythm",
        "pro-v1-sound-dialogue",
    }
    parts = []
    for skill_id, skill in data.items():
        if skill_id not in wanted:
            continue
        tasks = ", ".join(skill.get("tasks") or [])
        parts.append(
            f"## {skill.get('name', skill_id)}\n\n"
            f"> category: {skill.get('category', 'custom')} | tasks: {tasks}\n\n"
            f"{skill.get('content', '')}"
        )
    return "\n\n---\n\n".join(parts)


def _configured_api():
    # Read-only on purpose: load_profiles() may migrate legacy plaintext keys and
    # therefore write the config/credential store, which a content evaluation must not do.
    raw = json.loads(pathlib.Path(api_config_manager.CONFIG_PATH).read_text(encoding="utf-8"))
    profiles = raw.get("profiles") if isinstance(raw.get("profiles"), dict) else {
        key: value for key, value in raw.items()
        if isinstance(value, dict) and not str(key).startswith("_")
    }
    for name, profile in profiles.items():
        if profile.get("model_type") == "llm" and profile.get("api_key") and profile.get("base_url"):
            return name, (
                profile["api_key"],
                api_config_manager.strip_chat_completions(profile["base_url"]),
                profile.get("model") or name,
            )
    raise RuntimeError("没有配置可用的 LLM API Profile")


def evaluate(result, duration=18.0):
    preamble = str(result.get("preamble") or "")
    shots = result.get("shots") if isinstance(result.get("shots"), list) else []
    dialogues = result.get("dialogues") if isinstance(result.get("dialogues"), list) else []
    required_shot_fields = (
        "title", "time", "framing", "content", "camera", "lens", "intent",
        "action", "sound", "transitionIn", "transitionOut", "estSeconds",
    )
    field_total = len(shots) * len(required_shot_fields)
    field_present = sum(
        1 for shot in shots for field in required_shot_fields
        if field in shot and shot[field] not in (None, "")
    )
    est_values = []
    for shot in shots:
        try:
            est_values.append(float(shot.get("estSeconds") or 0))
        except (TypeError, ValueError):
            est_values.append(0.0)
    shot_times = [_time_seconds(shot.get("time")) for shot in shots]
    dialogue_times = [_time_seconds(item.get("time")) for item in dialogues]
    prompt_terms = ("Nali", "Feiying", "tea-hut", "rain", "lantern", "rifle")
    joined = "\n".join([preamble] + [json.dumps(item, ensure_ascii=False) for item in shots + dialogues])
    metrics = {
        "error": result.get("error"),
        "transport": result.get("transport"),
        "preamble_chars": len(preamble),
        "script_has_shot_markers": bool(re.search(r"\[Shot\s+\d+\]", preamble, re.I)),
        "scene_term_coverage": {
            term: (term.casefold() in joined.casefold()) for term in prompt_terms
        },
        "shot_count": len(shots),
        "shot_field_completion": round(field_present / field_total, 3) if field_total else 0.0,
        "shot_duration_sum": round(sum(est_values), 3),
        "shot_duration_delta": round(abs(sum(est_values) - duration), 3),
        "shot_times_valid": bool(shots) and all(value is not None for value in shot_times),
        "shot_times_monotonic": bool(shots) and all(
            shot_times[index] is not None and shot_times[index - 1] is not None
            and shot_times[index] >= shot_times[index - 1]
            for index in range(1, len(shot_times))
        ),
        "camera_coverage": round(sum(bool(item.get("camera")) for item in shots) / len(shots), 3) if shots else 0.0,
        "intent_coverage": round(sum(bool(item.get("intent")) for item in shots) / len(shots), 3) if shots else 0.0,
        "sound_coverage": round(sum(bool(item.get("sound")) for item in shots) / len(shots), 3) if shots else 0.0,
        "transition_coverage": round(sum(bool(item.get("transitionIn") or item.get("transitionOut")) for item in shots) / len(shots), 3) if shots else 0.0,
        "dialogue_count": len(dialogues),
        "dialogue_fields_complete": bool(dialogues) and all(item.get("role") and item.get("text") and item.get("time") for item in dialogues),
        "dialogue_text_within_30": bool(dialogues) and all(len(str(item.get("text") or "")) <= 30 for item in dialogues),
        "dialogue_times_in_budget": bool(dialogues) and all(value is not None and 0 <= value <= duration for value in dialogue_times),
    }
    checks = {
        "json_chain_completed": not result.get("error") and bool(preamble) and bool(shots) and bool(dialogues),
        "scene_match": sum(metrics["scene_term_coverage"].values()) >= 5,
        "shot_schema": metrics["shot_field_completion"] >= 0.75,
        "duration_match": metrics["shot_duration_delta"] <= 0.5,
        "timeline_match": metrics["shot_times_valid"] and metrics["shot_times_monotonic"],
        "directing_skill_match": min(metrics["camera_coverage"], metrics["intent_coverage"], metrics["sound_coverage"]) >= 0.75,
        "dialogue_match": metrics["dialogue_fields_complete"] and metrics["dialogue_text_within_30"] and metrics["dialogue_times_in_budget"],
    }
    score = round(sum(checks.values()) / len(checks) * 100, 1)
    return {"score": score, "checks": checks, "metrics": metrics}


def main():
    profile_name, api_config = _configured_api()
    project = {
        "foundation": (
            "A cinematic 2D anime rain-night scene inside a weathered wayside tea-hut. "
            "Nali is a white-haired red-eyed dragon maid carrying a red lantern; "
            "Feiying is a pink-haired cat-eared sniper cleaning a pink rifle. "
            "Preserve identity, screen direction, wet bamboo reflections and restrained tension."
        )
    }
    scene = {
        "id": 1,
        "title": "雨夜茶棚里的试探",
        "defaultSeconds": 18,
        "preamble": "",
        "shots": [],
        "dialogues": [],
    }
    request = {
        "sceneId": 1,
        "tasks": ["script", "shots", "dialogue"],
        "temperature": 0.35,
        "modelPref": "api",
        "profile": "cinematic",
        "skillPolicy": "merge",
        "hint": "用灯笼滴水声建立悬念；两人只交换一句含潜台词的简短中文对白。",
    }
    result = run_director_skill(
        project, [scene], request, api_config=api_config,
        director_skill=_skill_snapshot(),
    )
    report = evaluate(result)
    safe_result = {
        "profile": profile_name,
        "report": report,
        "sample": {
            "preamble": result.get("preamble"),
            "shots": result.get("shots"),
            "dialogues": result.get("dialogues"),
        },
    }
    print(json.dumps(safe_result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
