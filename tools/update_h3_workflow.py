#!/usr/bin/env python3
"""Upgrade an Eagle H3 workflow without replacing its authored scene data."""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path


def _find(nodes, node_type):
    return next((node for node in nodes if node.get("type") == node_type), None)


def _output(node, name):
    return next(item for item in node.get("outputs", []) if item.get("name") == name)


def _input(node, name):
    return next(item for item in node.get("inputs", []) if item.get("name") == name)


def _set_input_link(node, name, link_id):
    _input(node, name)["link"] = link_id


def _set_widget(node, name, value):
    """Set a serialized widget by its declared input name, not a magic index."""
    widget_names = [
        item.get("widget", {}).get("name")
        for item in node.get("inputs", [])
        if isinstance(item.get("widget"), dict)
    ]
    if name not in widget_names:
        return False
    index = widget_names.index(name)
    values = list(node.get("widgets_values") or [])
    while len(values) <= index:
        values.append(None)
    values[index] = value
    node["widgets_values"] = values
    if "widgets_values_named" in node:
        node["widgets_values_named"][name] = value
    return True


def _add_link(workflow, origin, origin_slot, target, target_slot, link_type):
    workflow["last_link_id"] = int(workflow.get("last_link_id", 0) or 0) + 1
    link_id = workflow["last_link_id"]
    workflow.setdefault("links", []).append(
        [link_id, origin["id"], origin_slot, target["id"], target_slot, link_type]
    )
    return link_id


def _link_by_id(workflow, link_id):
    return next((row for row in workflow.get("links", []) if row[0] == link_id), None)


def _disconnect_input(workflow, node, input_name):
    target = _input(node, input_name)
    link_id = target.get("link")
    if link_id is None:
        return False
    row = _link_by_id(workflow, link_id)
    if row is not None:
        origin = next(
            (item for item in workflow.get("nodes", []) if item.get("id") == row[1]),
            None,
        )
        if origin is not None and 0 <= int(row[2]) < len(origin.get("outputs") or []):
            output = origin["outputs"][int(row[2])]
            output["links"] = [
                item for item in (output.get("links") or []) if item != link_id
            ]
        workflow["links"] = [item for item in workflow.get("links", []) if item[0] != link_id]
    target["link"] = None
    return True


def _connect(workflow, origin, output_name, target, input_name, link_type):
    output = _output(origin, output_name)
    input_ = _input(target, input_name)
    output_slot = origin["outputs"].index(output)
    target_slot = target["inputs"].index(input_)
    current = _link_by_id(workflow, input_.get("link"))
    if current and current[1:5] == [origin["id"], output_slot, target["id"], target_slot]:
        if len(current) > 5:
            current[5] = link_type
        return current[0]
    _disconnect_input(workflow, target, input_name)
    link_id = _add_link(
        workflow, origin, output_slot, target, target_slot, link_type
    )
    output["links"] = list(output.get("links") or []) + [link_id]
    input_["link"] = link_id
    return link_id


def _remove_nodes(workflow, node_ids):
    node_ids = set(node_ids)
    if not node_ids:
        return
    workflow["nodes"] = [
        node for node in workflow.get("nodes", []) if node.get("id") not in node_ids
    ]
    workflow["links"] = [
        row for row in workflow.get("links", [])
        if row[1] not in node_ids and row[3] not in node_ids
    ]
    valid_links = {row[0] for row in workflow.get("links", [])}
    for node in workflow.get("nodes", []):
        for input_ in node.get("inputs") or []:
            if input_.get("link") not in valid_links:
                input_["link"] = None
        for output in node.get("outputs") or []:
            output["links"] = [
                link_id for link_id in (output.get("links") or [])
                if link_id in valid_links
            ]


def _insert_input(workflow, node, index, spec, default=None):
    """Insert one serialized input while preserving link and widget positions."""
    inputs = node.setdefault("inputs", [])
    name = spec["name"]
    if any(item.get("name") == name for item in inputs):
        return False

    index = max(0, min(int(index), len(inputs)))
    widget_index = sum(
        1 for item in inputs[:index] if isinstance(item.get("widget"), dict)
    )
    for row in workflow.get("links", []):
        if row[3] == node["id"] and int(row[4]) >= index:
            row[4] = int(row[4]) + 1
    inputs.insert(index, spec)

    if isinstance(spec.get("widget"), dict):
        values = list(node.get("widgets_values") or [])
        values.insert(widget_index, default)
        node["widgets_values"] = values
        if "widgets_values_named" in node:
            node["widgets_values_named"][name] = default
    return True


def _append_output(node, name, output_type, localized_name=None):
    outputs = node.setdefault("outputs", [])
    if any(item.get("name") == name for item in outputs):
        return False
    outputs.append({
        "localized_name": localized_name or name,
        "name": name,
        "type": output_type,
        "links": [],
    })
    return True


def _ensure_review_manifest_contract(workflow, checkpoint, loop_end):
    """Persist the current review/revision/manifest schema in older workflows."""
    checkpoint_inputs = checkpoint.setdefault("inputs", [])
    trim_index = next(
        (index for index, item in enumerate(checkpoint_inputs)
         if item.get("name") == "trim_start"),
        len(checkpoint_inputs),
    )
    _insert_input(workflow, checkpoint, trim_index, {
        "localized_name": "采样 Latent（可选）",
        "name": "sampled_latent",
        "shape": 7,
        "type": "LATENT",
        "link": None,
    })

    review_widgets = (
        ("retry_prompt", "重试提示词", "STRING", ""),
        ("retry_seed", "重试种子", "INT", -1),
        ("retry_length", "重试 H3 帧长", "INT", 0),
        ("resume_scene", "恢复到场景", "INT", 0),
        ("assemble_partial_on_stop", "停止时装配部分成片", "BOOLEAN", True),
        ("auto_continue_timeout_minutes", "自动继续超时（分钟）", "FLOAT", 0.0),
        ("unload_models_while_waiting", "等待审片时卸载模型", "BOOLEAN", False),
    )
    for name, label, input_type, default in review_widgets:
        _insert_input(workflow, checkpoint, len(checkpoint["inputs"]), {
            "localized_name": label,
            "name": name,
            "shape": 7,
            "type": input_type,
            "widget": {"name": name},
            "link": None,
        }, default=default)

    _append_output(checkpoint, "segment", "EAGLE_H3_SEGMENT", "当前版本片段")
    _append_output(checkpoint, "manifest", "EAGLE_H3_MANIFEST", "运行清单")

    # 与 MiniMax 原生循环相同：End 必须拿到交付帧和采样器的原始 AV
    # latent，才能构造下一镜的 previous_frames / previous_latent。
    _insert_input(workflow, loop_end, 2, {
        "localized_name": "交付画面",
        "name": "images",
        "shape": 7,
        "type": "IMAGE",
        "link": None,
    })
    _insert_input(workflow, loop_end, 3, {
        "localized_name": "采样 AV Latent",
        "name": "sampled_latent",
        "shape": 7,
        "type": "LATENT",
        "link": None,
    })

    _insert_input(workflow, loop_end, len(loop_end.setdefault("inputs", [])), {
        "localized_name": "自动装配",
        "name": "auto_assemble",
        "shape": 7,
        "type": "BOOLEAN",
        "widget": {"name": "auto_assemble"},
        "link": None,
    }, default=True)
    _append_output(loop_end, "manifest", "EAGLE_H3_MANIFEST", "运行清单")
    _append_output(loop_end, "partial", "BOOLEAN", "是否部分成片")
    _append_output(loop_end, "last_context_frames", "IMAGE", "末镜上下文帧")
    _append_output(loop_end, "last_context_latent", "LATENT", "末镜 AV Latent")


def _ensure_native_start_clip_count(start):
    outputs = start.get("outputs") or []
    if any(item.get("name") == "clip_count" for item in outputs):
        return
    outputs.append({
        "name": "clip_count",
        "localized_name": "场景队列数",
        "type": "INT",
        "links": [],
    })
    start["outputs"] = outputs


def _ensure_reference_context_contract(reference):
    """Append the explicit continuation flag without shifting existing slots."""
    _append_output(
        reference,
        "is_continuation",
        "BOOLEAN",
        "已应用上下文接力",
    )


def _primary_h3_sampler(workflow):
    """Find the full-pass sampler directly conditioned by Eagle Ref2VA."""
    nodes = workflow.get("nodes") or []
    by_id = {node.get("id"): node for node in nodes}
    reference = _find(nodes, "EagleH3ReferenceConditionNode")
    if reference is None:
        return None
    candidates = []
    for sampler in (node for node in nodes if node.get("type") == "SamplerCustomAdvanced"):
        latent_input = next(
            (item for item in sampler.get("inputs") or [] if item.get("name") == "latent_image"),
            None,
        )
        row = _link_by_id(workflow, latent_input.get("link") if latent_input else None)
        if row and row[1] == reference["id"]:
            sigma_input = next(
                (item for item in sampler.get("inputs") or [] if item.get("name") == "sigmas"),
                None,
            )
            sigma_row = _link_by_id(workflow, sigma_input.get("link") if sigma_input else None)
            sigma_source = by_id.get(sigma_row[1]) if sigma_row else None
            candidates.append((
                bool(sigma_source and sigma_source.get("type") == "BasicScheduler"),
                sampler,
            ))
    return next(
        (sampler for direct, sampler in candidates if direct),
        candidates[0][1] if candidates else None,
    )


def _ensure_latent_handoff(workflow, frame_trim, checkpoint, loop_end):
    """Wire one sampler output to decode, checkpoint, and recursive End."""
    sampler = _primary_h3_sampler(workflow)
    if sampler is None:
        raise RuntimeError("no direct H3 SamplerCustomAdvanced was found")
    _connect(workflow, sampler, "output", checkpoint, "sampled_latent", "LATENT")
    _connect(workflow, sampler, "output", loop_end, "sampled_latent", "LATENT")
    _connect(workflow, frame_trim, "images", loop_end, "images", "IMAGE")
    return sampler


def _ensure_safe_core_sampling(workflow, shot_context, frame_trim):
    """Restore the native 1-pass H3 sampling contract.

    Latent spatial upscaling between H3 conditioning and sampling changes the
    token grid while retaining the original condition layout.  That produces
    the model.py indexing/broadcast mismatch seen before the second sampler.
    Keep the user-authored Director state, but route the direct H3 sampler to
    both decoders and keep the requested Director dimensions through trim/save.
    """
    nodes = workflow.get("nodes") or []
    by_id = {node.get("id"): node for node in nodes}
    reference = _find(nodes, "EagleH3ReferenceConditionNode")
    decoders = [node for node in nodes if node.get("type") in ("VAEDecode", "VAEDecodeAudio")]
    if reference is None or not decoders:
        raise RuntimeError("workflow is missing its H3 condition/decoder nodes")

    safe_sampler = _primary_h3_sampler(workflow)
    if safe_sampler is None:
        raise RuntimeError("no direct H3 SamplerCustomAdvanced was found")

    # Capture the old decoder ancestry before replacing the active path.
    old_roots = []
    for decoder in decoders:
        row = _link_by_id(workflow, _input(decoder, "samples").get("link"))
        if row and row[1] != safe_sampler["id"]:
            old_roots.append(row[1])

    post_process_ids = set()
    saver = _find(nodes, "EagleAdvancedVideoSaver")
    for target in (frame_trim, saver):
        if target is None:
            continue
        image_input = next(
            (item for item in target.get("inputs") or [] if item.get("name") == "images"),
            None,
        )
        row = _link_by_id(workflow, image_input.get("link") if image_input else None)
        origin = by_id.get(row[1]) if row else None
        if origin and origin.get("type") == "RTXVideoSuperResolution":
            post_process_ids.add(origin["id"])

    for decoder in decoders:
        _connect(workflow, safe_sampler, "output", decoder, "samples", "LATENT")

    # The sampler's own scheduler must use the per-scene step count.
    sigma_input = _input(safe_sampler, "sigmas")
    sigma_link = _link_by_id(workflow, sigma_input.get("link"))
    scheduler = by_id.get(sigma_link[1]) if sigma_link else None
    if scheduler and scheduler.get("type") == "BasicScheduler":
        _connect(workflow, shot_context, "steps", scheduler, "steps", "INT")

    image_decoder = next(
        (node for node in decoders if node.get("type") == "VAEDecode"), None
    )
    if image_decoder is not None:
        _connect(workflow, image_decoder, "IMAGE", frame_trim, "images", "IMAGE")
        if saver is not None:
            _connect(workflow, image_decoder, "IMAGE", saver, "images", "IMAGE")

    removable_types = {
        "BasicGuider", "KSamplerSelect", "BasicScheduler", "RandomNoise",
        "SamplerCustomAdvanced", "H3SigmaRefiner", "SplitSigmas",
        "LTXVSeparateAVLatent", "LTXVConcatAVLatent",
        "MinimaxH3LatentUpscaler3D",
    }
    protected = {safe_sampler["id"], reference["id"], shot_context["id"]}
    remove_ids = set()
    pending = list(old_roots)
    while pending:
        node_id = pending.pop()
        if node_id in protected or node_id in remove_ids:
            continue
        node = by_id.get(node_id)
        if node is None or node.get("type") not in removable_types:
            continue
        remove_ids.add(node_id)
        for input_ in node.get("inputs") or []:
            row = _link_by_id(workflow, input_.get("link"))
            if row:
                pending.append(row[1])

    # A post-decode super-resolution node also violates the Director's selected
    # width/height.  Remove it only when it was directly feeding trim/save.
    remove_ids.update(post_process_ids)

    _remove_nodes(workflow, remove_ids)
    return sorted(remove_ids)


def _ensure_preview_frame_budget(workflow, shot_context):
    """Keep model-step previews independent from the full H3 clip length.

    ``preview_frames`` controls how many frames are decoded during every
    sampling preview. Wiring the per-shot ``length`` output here makes a
    124/243/... frame preview run at each step and can exhaust a 16 GB GPU
    before the final VAE decode. Preserve the preview node, but restore its
    local one-frame budget when that semantic mismatch is present.
    """
    disconnected = []
    outputs = shot_context.get("outputs") or []
    for node in workflow.get("nodes") or []:
        if node.get("type") != "ModelPreviewOverrideKJ":
            continue
        preview = next(
            (item for item in node.get("inputs") or []
             if item.get("name") == "preview_frames"),
            None,
        )
        if preview is None:
            continue
        row = _link_by_id(workflow, preview.get("link"))
        source_name = ""
        if row and row[1] == shot_context.get("id"):
            slot = int(row[2])
            if 0 <= slot < len(outputs):
                source_name = str(outputs[slot].get("name") or "")
        if source_name in ("length", "raw_frames"):
            link_id = preview.get("link")
            _disconnect_input(workflow, node, "preview_frames")
            disconnected.append(link_id)
        _set_widget(node, "preview_frames", 1)
    return disconnected


def _upgrade_director_state(node):
    values = list(node.get("widgets_values") or [])
    named = node.get("widgets_values_named") or {}
    raw = named.get("h3_state") or (values[0] if values else "{}")
    try:
        state = json.loads(raw or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        return
    if not state:
        return
    if (
        set(state) == {"project"}
        and set((state.get("project") or {}).keys())
        <= {"width", "height", "sizeLocked", "sizeRatio"}
    ):
        encoded = "{}"
        values[0] = encoded
        node["widgets_values"] = values
        if named:
            named["h3_state"] = encoded
            node["widgets_values_named"] = named
        return
    project = state.setdefault("project", {})
    parts = str(project.get("sizePreset") or "").split("|")
    if len(parts) >= 4:
        project.setdefault("width", int(parts[2]))
        project.setdefault("height", int(parts[3]))
    project.setdefault("width", 960)
    project.setdefault("height", 544)
    project.setdefault("sizeLocked", True)
    project.setdefault("sizeRatio", project["width"] / max(1, project["height"]))
    encoded = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
    if values:
        values[0] = encoded
    else:
        values = [encoded]
    node["widgets_values"] = values
    if named:
        named["h3_state"] = encoded
        node["widgets_values_named"] = named


def _ensure_exact_trim(workflow, shot_context, frame_trim):
    inputs = frame_trim.setdefault("inputs", [])
    target = next((item for item in inputs if item.get("name") == "target_frames"), None)
    if target is None:
        target = {
            "localized_name": "目标交付帧数",
            "name": "target_frames",
            "shape": 7,
            "type": "INT",
            "widget": {"name": "target_frames"},
            "link": None,
        }
        inputs.append(target)
        frame_trim.setdefault("widgets_values", []).append(0)
        if "widgets_values_named" in frame_trim:
            frame_trim["widgets_values_named"]["target_frames"] = 0
        connectable = (
            frame_trim.setdefault("properties", {})
            .setdefault("ue_properties", {})
            .setdefault("widget_ue_connectable", {})
        )
        connectable["target_frames"] = True

    delivered = _output(shot_context, "delivered_frames")
    existing = next(
        (
            row for row in workflow.get("links", [])
            if row[1] == shot_context["id"]
            and row[2] == shot_context["outputs"].index(delivered)
            and row[3] == frame_trim["id"]
            and row[4] == inputs.index(target)
        ),
        None,
    )
    if existing is None:
        link_id = _add_link(
            workflow,
            shot_context,
            shot_context["outputs"].index(delivered),
            frame_trim,
            inputs.index(target),
            "INT",
        )
        delivered["links"] = list(delivered.get("links") or []) + [link_id]
        target["link"] = link_id


def _ensure_chunk_feedforward(workflow, sigma):
    nodes = workflow.setdefault("nodes", [])
    chunk = _find(nodes, "MiniMaxChunkFeedForward")
    if chunk is not None:
        chunk["mode"] = 0
        return

    sigma_slot = next(
        index for index, item in enumerate(sigma.get("outputs", []))
        if item.get("type") == "MODEL"
    )
    outgoing = [
        row for row in workflow.get("links", [])
        if row[1] == sigma["id"] and row[2] == sigma_slot
    ]
    if not outgoing:
        return
    first = outgoing[0]
    downstream = next(node for node in nodes if node.get("id") == first[3])
    downstream_slot = first[4]
    workflow["last_node_id"] = int(workflow.get("last_node_id", 0) or 0) + 1
    node_id = workflow["last_node_id"]
    pos = sigma.get("pos") or [0, 0]
    chunk = {
        "id": node_id,
        "type": "MiniMaxChunkFeedForward",
        "pos": [float(pos[0]) + 120, float(pos[1]) + 170],
        "size": [280, 120],
        "flags": {},
        "order": max([int(node.get("order", 0) or 0) for node in nodes] or [0]) + 1,
        "mode": 0,
        "inputs": [
            {"name": "model", "type": "MODEL", "link": first[0]},
            {"name": "chunks", "type": "INT", "widget": {"name": "chunks"}},
            {"name": "seq_threshold", "type": "INT", "widget": {"name": "seq_threshold"}},
        ],
        "outputs": [{"name": "model", "type": "MODEL", "links": []}],
        "properties": {
            "cnr_id": "comfyui-kjnodes",
            "Node name for S&R": "MiniMaxChunkFeedForward",
        },
        "widgets_values": [4, 4096],
        "widgets_values_named": {"chunks": 4, "seq_threshold": 4096},
        "title": "16GB 显存安全·Chunk FeedForward",
    }
    nodes.append(chunk)

    # Reuse the first link for sigma -> chunk, preserving the Sigma output link.
    first[3] = chunk["id"]
    first[4] = 0
    if len(first) > 5:
        first[5] = "MODEL"
    new_first = _add_link(
        workflow, chunk, 0, downstream, downstream_slot, "MODEL"
    )
    _set_input_link(downstream, downstream["inputs"][downstream_slot]["name"], new_first)
    chunk["outputs"][0]["links"].append(new_first)

    # If Sigma also fed a scheduler/guider directly, route those links through
    # the same cloned model patch without changing their link IDs.
    for row in outgoing[1:]:
        row[1] = chunk["id"]
        row[2] = 0
        chunk["outputs"][0]["links"].append(row[0])
    sigma["outputs"][sigma_slot]["links"] = [first[0]]


def _ensure_media_bridge_seed_contract(workflow, bridge, shot_context):
    """Expose a scalar first image and repair old video/list-to-seed links."""
    aliases = {
        "reference_images": "ref_images",
        "video_frames_1": "ref_video_0",
        "video_frames_2": "ref_video_1",
        "video_frames_3": "ref_video_2",
        "video_audio_1": "ref_video_audio_0",
        "video_audio_2": "ref_video_audio_1",
        "video_audio_3": "ref_video_audio_2",
        "reference_audio_1": "ref_audio_0",
        "reference_audio_2": "ref_audio_1",
        "reference_audio_3": "ref_audio_2",
    }
    for item in bridge.get("inputs") or []:
        item["name"] = aliases.get(item.get("name"), item.get("name"))
    for item in bridge.get("outputs") or []:
        item["name"] = aliases.get(item.get("name"), item.get("name"))
    outputs = bridge.get("outputs") or []
    if len(outputs) < 2:
        raise RuntimeError("EagleH3MediaBridgeNode is missing its image output")
    first_image = outputs[1]
    first_image["name"] = "first_reference_image"
    first_image["localized_name"] = "首张参考图"
    first_image["type"] = "IMAGE"
    first_image.pop("shape", None)

    seed = _input(shot_context, "seed_image")
    link_id = seed.get("link")
    if link_id is None:
        return
    link = next((row for row in workflow.get("links", []) if row[0] == link_id), None)
    if not link or link[1] != bridge["id"] or link[2] == 1:
        return
    old_slot = int(link[2])
    old_output = outputs[old_slot] if 0 <= old_slot < len(outputs) else {}
    if old_slot != 2 and old_output.get("name") not in (
        "video_frames_1", "reference_images", "ref_video_0"
    ):
        return
    old_output["links"] = [
        item for item in (old_output.get("links") or []) if item != link_id
    ]
    link[2] = 1
    if len(link) > 5:
        link[5] = "IMAGE"
    first_image["links"] = list(first_image.get("links") or [])
    if link_id not in first_image["links"]:
        first_image["links"].append(link_id)


def _ensure_shot_length_contract(shot_context):
    """Expose the generated-frame count as the official H3 `length` port."""
    output = next(
        (item for item in shot_context.get("outputs") or []
         if item.get("name") in ("length", "raw_frames")),
        None,
    )
    if output is None:
        raise RuntimeError("EagleH3ShotContextNode is missing its length output")
    output["name"] = "length"
    output["localized_name"] = "H3 生成帧长"
    output["type"] = "INT"


def _ensure_sol_attn_motion_context_compatibility(sol_attn):
    """Keep sparse attention without letting it own H3 PackedLayout.

    H3 Motion Context needs the layout constructor for interior anchors.
    Sol-Attn only installs its competing constructor wrapper when Morton or
    H3 conditioning sinks are enabled, so both features remain usable when
    those two optional controls are off.
    """
    if sol_attn is None:
        return
    _set_widget(sol_attn, "sink_conditioning", "off")
    _set_widget(sol_attn, "morton", False)


def upgrade(path: Path, backup=False, safe_core_sampling=False):
    workflow = json.loads(path.read_text(encoding="utf-8"))
    nodes = workflow.get("nodes") or []
    director = _find(nodes, "EagleH3DirectorNode")
    shot_context = _find(nodes, "EagleH3ShotContextNode")
    reference = _find(nodes, "EagleH3ReferenceConditionNode")
    frame_trim = _find(nodes, "EagleH3FrameTrimNode")
    sigma = _find(nodes, "MiniMaxH3SigmaShift")
    if not all((director, shot_context, reference, frame_trim, sigma)):
        raise RuntimeError("workflow is missing an Eagle H3 core node")

    _upgrade_director_state(director)
    _ensure_shot_length_contract(shot_context)
    _ensure_reference_context_contract(reference)
    native_start = _find(nodes, "EagleH3NativeLoopStartNode")
    if native_start is not None:
        _ensure_native_start_clip_count(native_start)
    checkpoint = _find(nodes, "EagleH3CheckpointReviewNode")
    loop_end = _find(nodes, "EagleH3NativeLoopEndNode")
    if checkpoint is not None and loop_end is not None:
        _ensure_review_manifest_contract(workflow, checkpoint, loop_end)
    _ensure_exact_trim(workflow, shot_context, frame_trim)
    _ensure_chunk_feedforward(workflow, sigma)
    bridge = _find(nodes, "EagleH3MediaBridgeNode")
    if bridge is not None:
        _ensure_media_bridge_seed_contract(workflow, bridge, shot_context)
    _ensure_sol_attn_motion_context_compatibility(_find(nodes, "SolAttnPatch"))
    preview_links_removed = _ensure_preview_frame_budget(workflow, shot_context)
    removed = []
    if safe_core_sampling:
        removed = _ensure_safe_core_sampling(workflow, shot_context, frame_trim)
    if checkpoint is not None and loop_end is not None:
        _ensure_latent_handoff(workflow, frame_trim, checkpoint, loop_end)

    note = _find(nodes, "Note")
    if note and note.get("title") == "使用说明":
        text = str((note.get("widgets_values") or [""])[0])
        additions = (
            "\n10. 导演台时长是精确剪辑时长；H3 会向上取 17k+5 合法生成帧，"
            "并由 target_frames 自动裁掉尾部多余帧。"
            "\n11. 16GB 工作流已启用 Chunk FeedForward（4 块）；导演台顶部尺寸设置"
            "是执行宽高的唯一界面显示。"
            "\n12. H3 采样器 output 同时连接检查点与循环结束；每镜只承接尾帧"
            "和双流 AV latent，不经过二次 latent 放大采样。"
        )
        if "target_frames" not in text:
            text += additions
            note["widgets_values"][0] = text
            if "widgets_values_named" in note:
                note["widgets_values_named"]["text"] = text

    if backup:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_path = path.with_name(path.stem + f".backup-{stamp}" + path.suffix)
        shutil.copy2(path, backup_path)
        print(f"backup={backup_path}")
    path.write_text(
        json.dumps(workflow, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"updated={path} nodes={len(workflow['nodes'])} "
        f"links={len(workflow['links'])} last={workflow['last_node_id']}/{workflow['last_link_id']} "
        f"removed_unsafe={removed} preview_links_removed={preview_links_removed}"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("--backup", action="store_true")
    parser.add_argument(
        "--safe-core-sampling", action="store_true",
        help="remove incompatible latent/post upscalers and restore direct H3 sampling",
    )
    args = parser.parse_args()
    upgrade(
        args.path.resolve(), backup=args.backup,
        safe_core_sampling=args.safe_core_sampling,
    )


if __name__ == "__main__":
    main()
