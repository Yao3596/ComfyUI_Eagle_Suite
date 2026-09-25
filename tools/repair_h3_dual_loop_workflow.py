#!/usr/bin/env python3
"""Repair the authored Eagle H3 dual-sampling loop without replacing its data.

The transformation is deliberately topology-only.  Existing nodes, scene/API
widgets and performance settings are retained; two small routing nodes are
added and the dormant 45 -> 84 -> 47 branch becomes the loop's delivery path.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path
import shutil


class WorkflowContractError(ValueError):
    """The input workflow is not the expected authored H3 graph."""


def _node(workflow, node_id, expected_type=None):
    result = next(
        (item for item in workflow.get("nodes", []) if int(item.get("id", -1)) == node_id),
        None,
    )
    if result is None:
        raise WorkflowContractError(f"missing required node {node_id}")
    if expected_type and result.get("type") != expected_type:
        raise WorkflowContractError(
            f"node {node_id} is {result.get('type')!r}, expected {expected_type!r}"
        )
    return result


def _input(node, name):
    result = next((item for item in node.get("inputs", []) if item.get("name") == name), None)
    if result is None:
        raise WorkflowContractError(f"node {node.get('id')} has no input {name!r}")
    return result


def _output(node, name):
    result = next((item for item in node.get("outputs", []) if item.get("name") == name), None)
    if result is None:
        raise WorkflowContractError(f"node {node.get('id')} has no output {name!r}")
    return result


def _link(workflow, link_id):
    if link_id is None:
        return None
    return next((row for row in workflow.get("links", []) if int(row[0]) == int(link_id)), None)


def _disconnect_input(workflow, node, input_name):
    target = _input(node, input_name)
    link_id = target.get("link")
    if link_id is None:
        return False
    row = _link(workflow, link_id)
    if row is not None:
        origin = _node(workflow, int(row[1]))
        origin_slot = int(row[2])
        if 0 <= origin_slot < len(origin.get("outputs") or []):
            source = origin["outputs"][origin_slot]
            source["links"] = [
                value for value in (source.get("links") or [])
                if int(value) != int(link_id)
            ]
        workflow["links"] = [
            value for value in workflow.get("links", [])
            if int(value[0]) != int(link_id)
        ]
    target["link"] = None
    return True


def _connect(workflow, origin, output_name, target, input_name, link_type):
    source = _output(origin, output_name)
    destination = _input(target, input_name)
    source_slot = origin["outputs"].index(source)
    target_slot = target["inputs"].index(destination)
    current = _link(workflow, destination.get("link"))
    if current and list(current[1:5]) == [
        origin["id"], source_slot, target["id"], target_slot,
    ]:
        current[5] = link_type
        if int(current[0]) not in [int(value) for value in (source.get("links") or [])]:
            source["links"] = list(source.get("links") or []) + [int(current[0])]
        return int(current[0])
    _disconnect_input(workflow, target, input_name)
    workflow["last_link_id"] = max(
        int(workflow.get("last_link_id", 0) or 0),
        max((int(row[0]) for row in workflow.get("links", [])), default=0),
    ) + 1
    link_id = int(workflow["last_link_id"])
    workflow.setdefault("links", []).append([
        link_id, int(origin["id"]), source_slot,
        int(target["id"]), target_slot, link_type,
    ])
    source["links"] = list(source.get("links") or []) + [link_id]
    destination["link"] = link_id
    return link_id


def _insert_widget_input(node, index, name, input_type, default, localized_name=None):
    inputs = node.setdefault("inputs", [])
    existing = next((item for item in inputs if item.get("name") == name), None)
    if existing is not None:
        return existing
    index = max(0, min(int(index), len(inputs)))
    widget_index = sum(
        1 for item in inputs[:index] if isinstance(item.get("widget"), dict)
    )
    spec = {
        "localized_name": localized_name or name,
        "name": name,
        "type": input_type,
        "widget": {"name": name},
        "link": None,
    }
    inputs.insert(index, spec)
    values = list(node.get("widgets_values") or [])
    values.insert(widget_index, default)
    node["widgets_values"] = values
    if isinstance(node.get("widgets_values_named"), dict):
        node["widgets_values_named"][name] = default
    return spec


def _widget_index(node, name):
    names = [
        item.get("widget", {}).get("name")
        for item in node.get("inputs", [])
        if isinstance(item.get("widget"), dict)
    ]
    if name not in names:
        raise WorkflowContractError(f"node {node.get('id')} has no widget {name!r}")
    return names.index(name)


def _set_widget(node, name, value):
    index = _widget_index(node, name)
    values = list(node.get("widgets_values") or [])
    while len(values) <= index:
        values.append(None)
    values[index] = value
    node["widgets_values"] = values
    if isinstance(node.get("widgets_values_named"), dict):
        node["widgets_values_named"][name] = value


def _next_node_id(workflow):
    value = max(
        int(workflow.get("last_node_id", 0) or 0),
        max((int(node.get("id", 0)) for node in workflow.get("nodes", [])), default=0),
    ) + 1
    workflow["last_node_id"] = value
    return value


def _new_refine_adapter(workflow, reference):
    matches = [
        node for node in workflow.get("nodes", [])
        if node.get("type") == "EagleH3RefineHandoffNode"
    ]
    if len(matches) > 1:
        raise WorkflowContractError("more than one EagleH3RefineHandoffNode exists")
    if matches:
        return matches[0], False
    node_id = _next_node_id(workflow)
    properties = deepcopy(reference.get("properties") or {})
    properties["Node name for S&R"] = "EagleH3RefineHandoffNode"
    node = {
        "id": node_id,
        "type": "EagleH3RefineHandoffNode",
        "pos": [1770, -1080],
        "size": [390, 170],
        "flags": {},
        "order": max(
            (int(item.get("order", 0) or 0) for item in workflow.get("nodes", [])),
            default=0,
        ) + 1,
        "mode": 0,
        "title": "H3 二采画布与 AV 蒙版衔接",
        "inputs": [
            {"localized_name": "正向条件", "name": "positive", "type": "CONDITIONING", "link": None},
            {"localized_name": "放大后的 AV Latent", "name": "latent", "type": "LATENT", "link": None},
            {"localized_name": "H3 视频 VAE", "name": "vae", "type": "VAE", "link": None},
            {"localized_name": "一采原始 AV Latent", "name": "source_latent", "type": "LATENT", "link": None},
        ],
        "outputs": [
            {"localized_name": "二采条件", "name": "positive", "type": "CONDITIONING", "links": []},
            {"localized_name": "二采 AV Latent", "name": "latent", "type": "LATENT", "links": []},
            {"localized_name": "摘要", "name": "summary", "type": "STRING", "links": []},
        ],
        "properties": properties,
        "widgets_values": [],
    }
    workflow.setdefault("nodes", []).append(node)
    return node, True


def _new_second_guider(workflow, template):
    matches = [
        node for node in workflow.get("nodes", [])
        if node.get("type") == "BasicGuider"
        and node.get("title") == "H3 二采 Guider（适配画布）"
    ]
    if len(matches) > 1:
        raise WorkflowContractError("more than one second-stage H3 guider exists")
    if matches:
        return matches[0], False
    node = deepcopy(template)
    node["id"] = _next_node_id(workflow)
    node["title"] = "H3 二采 Guider（适配画布）"
    node["pos"] = [1508, -1880]
    node["order"] = max(
        (int(item.get("order", 0) or 0) for item in workflow.get("nodes", [])),
        default=0,
    ) + 1
    for item in node.get("inputs", []):
        item["link"] = None
    for item in node.get("outputs", []):
        item["links"] = []
    workflow.setdefault("nodes", []).append(node)
    return node, True


def _repair_review_contract(review, read_only):
    inputs = review.get("inputs", [])
    _insert_widget_input(
        review, len(inputs), "read_only", "BOOLEAN", bool(read_only), "只读回看"
    )
    _set_widget(review, "read_only", bool(read_only))
    # Old Vue/DOM widgets were once serialized as a trailing empty string even
    # though the current DOM widgets use serialize:false.  Keep exactly the
    # backend widget count so the new BOOLEAN cannot consume that stale value.
    widget_count = sum(
        1 for item in review.get("inputs", []) if isinstance(item.get("widget"), dict)
    )
    review["widgets_values"] = list(review.get("widgets_values") or [])[:widget_count]


def _normalize_known_legacy_widgets(review, loop_end):
    # The baseline predates typed defaults and serialized 0 into STRING/BOOLEAN slots.
    def value(node, name):
        index = _widget_index(node, name)
        values = list(node.get("widgets_values") or [])
        return values[index] if index < len(values) else None

    def repair_type(node, name, predicate, default):
        current = value(node, name)
        if not predicate(current):
            _set_widget(node, name, default)

    is_number = lambda item: isinstance(item, (int, float)) and not isinstance(item, bool)
    is_int = lambda item: isinstance(item, int) and not isinstance(item, bool)
    for name in ("trim_start", "trim_end", "auto_continue_timeout_minutes"):
        repair_type(review, name, is_number, 0.0)
    for name in ("review_decision", "retry_prompt"):
        repair_type(review, name, lambda item: isinstance(item, str), "")
    for name, default in (("retry_seed", -1), ("retry_length", 0), ("resume_scene", 0)):
        repair_type(review, name, is_int, default)
    repair_type(review, "assemble_partial_on_stop", lambda item: isinstance(item, bool), True)
    repair_type(review, "unload_models_while_waiting", lambda item: isinstance(item, bool), False)

    for name in ("decision", "filename", "local_save_path", "eagle_folder"):
        repair_type(loop_end, name, lambda item: isinstance(item, str), "")
    current_format = value(loop_end, "format")
    if not isinstance(current_format, str) or current_format.lower() not in {"mp4", "mov", "mkv"}:
        _set_widget(loop_end, "format", "mp4")
    current_fps = value(loop_end, "fps_override")
    if not is_int(current_fps) or not 0 <= current_fps <= 120:
        _set_widget(loop_end, "fps_override", 0)
    repair_type(loop_end, "auto_assemble", lambda item: isinstance(item, bool), True)
    widget_count = sum(
        1 for item in loop_end.get("inputs", []) if isinstance(item.get("widget"), dict)
    )
    loop_end["widgets_values"] = list(loop_end.get("widgets_values") or [])[:widget_count]


def validate_links(workflow):
    """Return structural/type errors for a serialized LiteGraph workflow."""
    errors = []
    nodes = {int(node["id"]): node for node in workflow.get("nodes", [])}
    links = {int(row[0]): row for row in workflow.get("links", [])}
    for link_id, row in links.items():
        if len(row) < 6:
            errors.append(f"L{link_id}: malformed row")
            continue
        source = nodes.get(int(row[1]))
        target = nodes.get(int(row[3]))
        if source is None or target is None:
            errors.append(f"L{link_id}: missing endpoint")
            continue
        source_slot, target_slot = int(row[2]), int(row[4])
        if not 0 <= source_slot < len(source.get("outputs") or []):
            errors.append(f"L{link_id}: bad source slot")
            continue
        if not 0 <= target_slot < len(target.get("inputs") or []):
            errors.append(f"L{link_id}: bad target slot")
            continue
        output = source["outputs"][source_slot]
        input_ = target["inputs"][target_slot]
        source_type = str(output.get("type") or "")
        target_types = [part.strip() for part in str(input_.get("type") or "").split(",")]
        link_type = str(row[5] or "")
        if not link_type:
            errors.append(f"L{link_id}: empty link type")
        if source_type != "*" and "*" not in target_types and source_type not in target_types:
            errors.append(
                f"L{link_id}: {source.get('id')}.{output.get('name')} {source_type} -> "
                f"{target.get('id')}.{input_.get('name')} {input_.get('type')}"
            )
        if link_type not in (source_type, "*") and source_type != "*":
            errors.append(f"L{link_id}: link type {link_type} != source {source_type}")
        if link_id not in [int(value) for value in (output.get("links") or [])]:
            errors.append(f"L{link_id}: missing source backlink")
        if int(input_.get("link", -1)) != link_id:
            errors.append(f"L{link_id}: wrong target backlink")
    for node in nodes.values():
        for input_ in node.get("inputs", []):
            value = input_.get("link")
            if value is not None and int(value) not in links:
                errors.append(f"node {node['id']} input {input_.get('name')}: dangling L{value}")
        for output in node.get("outputs", []):
            for value in output.get("links") or []:
                if int(value) not in links:
                    errors.append(f"node {node['id']} output {output.get('name')}: dangling L{value}")
    return errors


def repair_workflow(source):
    """Return ``(repaired_copy, report)`` without mutating ``source``."""
    workflow = deepcopy(source)
    original_node_count = len(workflow.get("nodes", []))
    required = {
        3: "VAELoader", 28: "EagleH3CheckpointReviewNode",
        29: "EagleH3NativeLoopEndNode", 30: "EagleH3FrameTrimNode",
        31: "EagleH3ReferenceConditionNode", 32: "EagleH3ShotContextNode",
        33: "EagleH3NativeLoopStartNode", 34: "EagleH3DirectorNode",
        41: "BasicGuider", 42: "Reroute", 45: "SamplerCustomAdvanced",
        46: "SplitSigmas", 47: "SamplerCustomAdvanced",
        48: "LTXVSeparateAVLatent", 49: "LTXVConcatAVLatent",
        51: "SamplerCustomAdvanced", 52: "VAEDecode",
        77: "RTXVideoSuperResolution", 78: "VAEDecodeAudio",
        80: "EagleAdvancedVideoSaver", 84: "MinimaxH3LatentUpscaler3D",
        86: "EagleH3ReviewWorkspaceNode",
    }
    nodes = {node_id: _node(workflow, node_id, kind) for node_id, kind in required.items()}
    adapter, adapter_added = _new_refine_adapter(workflow, nodes[31])
    second_guider, guider_added = _new_second_guider(workflow, nodes[41])

    # This is learned latent upscaling + re-noising, not a same-canvas split
    # with DisableNoise. Preserve the authored x0 prediction for the upscaler;
    # passing a partially noisy output into RandomNoise again double-noises it.
    _connect(workflow, nodes[45], "denoised_output", nodes[48], "av_latent", "LATENT")
    # The adapter re-encodes MiniMax keyframes at the enlarged latent canvas and
    # restores the AV noise mask before the second sampler.
    _connect(workflow, nodes[31], "positive", adapter, "positive", "CONDITIONING")
    _connect(workflow, nodes[49], "latent", adapter, "latent", "LATENT")
    _connect(workflow, nodes[3], "VAE", adapter, "vae", "VAE")
    _connect(workflow, nodes[45], "output", adapter, "source_latent", "LATENT")
    _connect(workflow, nodes[42], "", second_guider, "model", "MODEL")
    _connect(workflow, adapter, "positive", second_guider, "conditioning", "CONDITIONING")
    _connect(workflow, second_guider, "GUIDER", nodes[47], "guider", "GUIDER")
    _connect(workflow, adapter, "latent", nodes[47], "latent_image", "LATENT")

    # Split point 4 is an authored acceleration parameter.  Feeding the full
    # per-shot step count into it left the low-sigma pass with one terminal row.
    _disconnect_input(workflow, nodes[46], "step")

    # Decode the refined AV sample, trim to the plan's delivered duration, then
    # apply the user's RTX enhancement to the video delivery only.
    _connect(workflow, nodes[47], "output", nodes[52], "samples", "LATENT")
    _connect(workflow, nodes[47], "output", nodes[78], "samples", "LATENT")
    _connect(workflow, nodes[52], "IMAGE", nodes[30], "images", "IMAGE")
    _connect(workflow, nodes[78], "AUDIO", nodes[30], "audio", "AUDIO")
    _connect(workflow, nodes[30], "images", nodes[77], "images", "IMAGE")

    # Svelte workspace 86 is the sole writer/reviewer and the only state source
    # for End.  Legacy panel 28 remains available as a read-only history mirror.
    _repair_review_contract(nodes[86], False)
    _connect(workflow, nodes[77], "upscaled_images", nodes[86], "images", "IMAGE")
    _connect(workflow, nodes[30], "audio", nodes[86], "audio", "AUDIO")
    _connect(workflow, nodes[30], "images_with_overlap", nodes[86], "images_with_overlap", "IMAGE")
    _connect(workflow, nodes[47], "output", nodes[86], "sampled_latent", "LATENT")

    _repair_review_contract(nodes[28], True)
    for name in ("images", "audio", "images_with_overlap", "sampled_latent"):
        _disconnect_input(workflow, nodes[28], name)
    _connect(workflow, nodes[86], "state", nodes[28], "state", "EAGLE_H3_STATE")
    _connect(workflow, nodes[86], "clip", nodes[28], "video", "VIDEO")
    nodes[28]["title"] = "H3 历史回看（只读，不重复保存）"

    _connect(workflow, nodes[77], "upscaled_images", nodes[29], "images", "IMAGE")
    _connect(workflow, nodes[47], "output", nodes[29], "sampled_latent", "LATENT")
    _connect(workflow, nodes[77], "upscaled_images", nodes[80], "images", "IMAGE")
    _connect(workflow, nodes[30], "audio", nodes[80], "audio", "AUDIO")
    _connect(workflow, nodes[33], "fps", nodes[80], "fps", "INT")

    nodes[51]["title"] = "H3 单采对照（保留，未接主输出）"
    _normalize_known_legacy_widgets(nodes[28], nodes[29])

    # Existing eagle_h3_director checkpoints were produced by the former
    # single-sampler topology.  A blank override would silently resume those
    # incompatible latents (the observed manifest is already at scene 4/4).
    # Give the repaired graph its own run namespace while preserving any name
    # the author explicitly entered and retaining the non-destructive resume
    # policy for future runs of this repaired topology.
    run_name = list(nodes[33].get("widgets_values") or [])[
        _widget_index(nodes[33], "run_name_override")
    ]
    assigned_run_name = not isinstance(run_name, str) or not run_name.strip()
    if assigned_run_name:
        run_name = "eagle_h3_dual_loop_v2"
        _set_widget(nodes[33], "run_name_override", run_name)

    # One old core-model link in the authored file has a null type.  Its
    # endpoints are both MODEL, so normalize metadata without changing routing.
    for row in workflow.get("links", []):
        if int(row[0]) == 19 and not row[5]:
            row[5] = "MODEL"

    errors = validate_links(workflow)
    if errors:
        raise WorkflowContractError("repaired workflow is invalid:\n" + "\n".join(errors))
    report = {
        "added_node_ids": [
            node["id"] for node, added in (
                (adapter, adapter_added), (second_guider, guider_added)
            ) if added
        ],
        "adapter_id": adapter["id"],
        "second_guider_id": second_guider["id"],
        "preserved_original_node_count": original_node_count,
        "node_count": len(workflow.get("nodes", [])),
        "link_count": len(workflow.get("links", [])),
        "main_sampler_ids": [45, 47],
        "comparison_sampler_id": 51,
        "review_writer_id": 86,
        "history_mirror_id": 28,
        "run_name_override": run_name,
        "assigned_fresh_run_name": assigned_run_name,
        "resume_note": (
            "Do not resume checkpoints created by the old single-sampler graph; "
            "the repaired dual-sampler topology uses its own run namespace."
        ),
    }
    return workflow, report


def _backup(path):
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    destination = path.with_name(f"{path.stem}.backup-{stamp}{path.suffix}")
    shutil.copy2(path, destination)
    return destination


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="source workflow JSON")
    destination = parser.add_mutually_exclusive_group()
    destination.add_argument("--output", type=Path, help="write a repaired copy")
    destination.add_argument("--in-place", action="store_true", help="repair input after creating a backup")
    parser.add_argument("--dry-run", action="store_true", help="validate and print the plan without writing")
    args = parser.parse_args(argv)

    source = args.input.resolve()
    workflow = json.loads(source.read_text(encoding="utf-8"))
    repaired, report = repair_workflow(workflow)
    report["input"] = str(source)
    if args.dry_run or (args.output is None and not args.in_place):
        report["written"] = False
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    output = source if args.in_place else args.output.resolve()
    backup = None
    if output.exists():
        backup = _backup(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(repaired, ensure_ascii=False, indent=2), encoding="utf-8")
    report.update({"written": True, "output": str(output), "backup": str(backup or "")})
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
