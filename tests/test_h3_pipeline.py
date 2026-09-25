# -*- coding: utf-8 -*-
"""
H3 链下游承接节点单元/集成测试。
"""

import asyncio
import importlib.util
import json
import os
import pathlib
import shutil
import sys
import tempfile
import unittest

import numpy as np
import torch


REPO = pathlib.Path(__file__).resolve().parents[1]
COMFY_ROOT = os.environ.get("COMFYUI_ROOT")
if COMFY_ROOT:
    COMFY_ROOT = pathlib.Path(COMFY_ROOT).expanduser()
    sys.path.insert(0, str(COMFY_ROOT))
SPEC = importlib.util.spec_from_file_location(
    "eagle_suite_test_package",
    REPO / "__init__.py",
    submodule_search_locations=[str(REPO)],
)
PACKAGE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PACKAGE
SPEC.loader.exec_module(PACKAGE)

from eagle_suite_test_package.eagle_suite.h3_pipeline import state as h3_state
from eagle_suite_test_package.eagle_suite.h3_pipeline import media_utils
from eagle_suite_test_package.eagle_suite.h3_pipeline import nodes as h3_nodes
from eagle_suite_test_package.eagle_suite.h3_pipeline.nodes import (
    EagleH3PlanNode,
    EagleH3PlanInteropNode,
    EagleH3PreflightNode,
    EagleH3StartNode,
    EagleH3StateInteropNode,
    EagleH3NativeLoopStartNode,
    EagleH3NativeLoopEndNode,
    EagleH3CurrentShotNode,
    EagleH3ShotContextNode,
    EagleH3ReferenceConditionNode,
    EagleH3FrameTrimNode,
    EagleH3ReviewGateNode,
    EagleH3EndNode,
    EagleH3AssembleNode,
    EagleH3ContextNode,
    EagleH3CheckpointReviewNode,
    EagleH3FinalizeNode,
    REF_IMAGE_SIZE_SHORT_EDGES,
    _limit_reference_short_edge,
    _prepare_reference_condition,
    _reference_short_edge,
)
from eagle_suite_test_package.eagle_suite.h3_director_node import (
    compile_h3_params,
    export_context_loop_plan_json,
)
from eagle_suite_test_package.eagle_suite.h3_director_node import (
    EagleH3MediaBridgeNode,
)


def _sample_plan():
    return {
        "version": 2,
        "run_name": "test_run",
        "prompt_prefix": "prefix",
        "shots": [
            {
                "index": 1,
                "id": "scene_01_intro",
                "scene_prompt": "intro scene",
                "prompt": "prefix\n\nintro scene",
                "prompt_hash": "abc",
                "seed": 123,
                "steps": 8,
                "raw_frames": 245,
                "delivered_frames": 223,
                "generation_start_frame": 0,
                "audio_start_seconds": 0.0,
                "audio_duration_seconds": 9.29,
            },
            {
                "index": 2,
                "id": "scene_02_continue",
                "scene_prompt": "continue scene",
                "prompt": "prefix\n\ncontinue scene",
                "prompt_hash": "def",
                "seed": 456,
                "steps": 8,
                "raw_frames": 245,
                "delivered_frames": 223,
                "generation_start_frame": 223,
                "audio_start_seconds": 9.29,
                "audio_duration_seconds": 9.29,
            },
        ],
        "compatibility": {
            "fps": 24,
            "width": 1080,
            "height": 1920,
            "context_length": 22,
            "encode_mode": "video",
            "anchor_mode": "head",
            "crop": "disabled",
            "audio_mode": "generated_audio",
            "audio_context_length": 22,
            "segment_crf": 18,
            "video_blend_frames": 0,
            "generation_fingerprint": "1",
        },
        "segment_crf": 18,
        "total_delivered_frames": 446,
        "reference_media": [],
        "plan_hash": "testhash",
        "summary": "2 clips",
    }


class H3ChainTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = pathlib.Path(tempfile.mkdtemp(prefix="h3chain_test_"))

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_plan_node_initializes_state(self):
        plan = _sample_plan()
        node = EagleH3PlanNode()
        out = node.execute(plan, output_dir=str(self.tmpdir), resume_policy="overwrite")
        self.assertEqual(len(node.RETURN_TYPES), len(out["result"]))
        state, manifest, manifest_path, summary = out["result"]
        self.assertIn("run_name", state)
        self.assertEqual(0, state["current_index"])
        self.assertEqual(2, state["total_shots"])
        self.assertEqual(2, manifest["total_shots"])
        self.assertEqual(plan, manifest["plan"])
        self.assertEqual(
            pathlib.Path(state["base_dir"]) / "manifest.json",
            pathlib.Path(manifest_path),
        )
        self.assertTrue(pathlib.Path(manifest_path).exists())
        self.assertIn("test_run", summary)

    def test_run_name_override_is_the_runtime_identity_on_create_and_resume(self):
        plan = _sample_plan()
        state = h3_state.init_state(
            plan, str(self.tmpdir), run_name_override="dual/loop:v2",
            resume_policy="overwrite",
        )
        self.assertEqual("dual_loop_v2", state["run_name"])
        self.assertEqual("test_run", state["plan"]["run_name"])
        self.assertEqual("dual_loop_v2", pathlib.Path(state["base_dir"]).name)

        state["current_index"] = 1
        h3_state.save_state(state)
        resumed = h3_state.init_state(
            plan, str(self.tmpdir), run_name_override="dual/loop:v2",
            resume_policy="resume",
        )
        self.assertEqual("dual_loop_v2", resumed["run_name"])
        self.assertEqual(1, resumed["current_index"])

    def test_masked_av_plan_rejects_predecessor_shorter_than_context(self):
        plan = _sample_plan()
        plan["compatibility"]["continuation_mode"] = "masked_av"
        plan["shots"][1]["context_length"] = 243
        with self.assertRaisesRegex(ValueError, "上一镜仅交付 223 帧"):
            h3_nodes._validate_plan(plan)

        plan["shots"][1]["context_length"] = 209
        self.assertIs(plan, h3_nodes._validate_plan(plan))

        plan["shots"][1]["context_length"] = 6
        with self.assertRaisesRegex(ValueError, "17k\\+5"):
            h3_nodes._validate_plan(plan)

    def test_plan_interop_accepts_typed_plan_and_string_json(self):
        plan = _sample_plan()
        node = EagleH3PlanInteropNode()
        typed = node.execute(plan)
        encoded = node.execute(json.dumps(plan))
        self.assertEqual("H3_CHAIN_PLAN,STRING", node.INPUT_TYPES()["required"]["source"][0])
        self.assertEqual(plan, typed[0])
        self.assertEqual(plan, encoded[0])
        self.assertEqual(2, encoded[3])
        self.assertEqual((1080, 1920), encoded[4:6])

    def test_state_interop_exports_open_snapshot_and_standard_video(self):
        state = self._init_state(_sample_plan())
        node = EagleH3StateInteropNode()
        exported = node.execute(state)
        restored = node.execute(exported[1])
        self.assertEqual("EAGLE_H3_STATE,STRING", node.INPUT_TYPES()["required"]["source"][0])
        self.assertEqual(state, restored[0])
        self.assertEqual(_sample_plan(), restored[2])
        self.assertIsNone(restored[3])
        self.assertTrue(restored[4].endswith("manifest.json"))
        self.assertEqual((1, 2, False), restored[5:8])

    def test_state_interop_rejects_third_party_tensor_state(self):
        foreign = {
            "plan": _sample_plan(),
            "index": 1,
            "previous_frames": torch.zeros((1, 8, 8, 3)),
        }
        with self.assertRaisesRegex(ValueError, "H3_CHAIN_STATE"):
            EagleH3StateInteropNode().execute(foreign)

    def test_standard_media_bridge_round_trip_has_unambiguous_ports(self):
        images = torch.rand((2, 8, 8, 3), dtype=torch.float32)
        video_frames = torch.rand((5, 8, 8, 3), dtype=torch.float32)
        audio = {"waveform": torch.ones((1, 1, 800)), "sample_rate": 8000}
        result = EagleH3MediaBridgeNode().execute(
            ref_images=images,
            ref_video_0=video_frames,
            ref_video_audio_0=audio,
            ref_audio_0=audio,
        )
        bundle = result[0]
        self.assertEqual(2, result[12])
        self.assertEqual(1, result[13])
        self.assertEqual(1, result[14])
        self.assertIs(result[1], bundle["ref_images"][0])
        self.assertEqual((1, 8, 8, 3), tuple(result[1].shape))
        self.assertIs(result[2], video_frames)
        self.assertIs(result[5], audio)
        self.assertIs(result[8], audio)
        self.assertEqual(2, len(bundle["ref_images"]))

    def test_standard_media_bridge_first_image_is_not_a_comfy_list_output(self):
        self.assertEqual(
            "first_reference_image", EagleH3MediaBridgeNode.RETURN_NAMES[1]
        )
        self.assertFalse(EagleH3MediaBridgeNode.OUTPUT_IS_LIST[1])
        optional = EagleH3MediaBridgeNode.INPUT_TYPES()["optional"]
        self.assertIn("ref_images", optional)
        self.assertIn("ref_video_0", optional)
        self.assertIn("ref_video_audio_0", optional)
        self.assertIn("ref_audio_0", optional)
        self.assertNotIn("video_frames_1", optional)

    def test_start_node_outputs_dimensions(self):
        plan = _sample_plan()
        out = EagleH3PlanNode().execute(plan, output_dir=str(self.tmpdir), resume_policy="overwrite")
        state = out["result"][0]
        out = EagleH3StartNode().execute(state, 1)
        state, width, height, fps = out["result"]
        self.assertEqual(width, 1080)
        self.assertEqual(height, 1920)
        self.assertEqual(fps, 24)
        self.assertEqual(state["current_index"], 0)

    def test_native_start_exposes_direct_flow_and_validates_recursive_plan(self):
        plan = _sample_plan()
        out = EagleH3NativeLoopStartNode().execute(
            plan, 1, output_dir=str(self.tmpdir), resume_policy="overwrite"
        )
        flow, native_state, width, height, fps, status, clip_count = out["result"]
        self.assertEqual(flow, "eagle_h3_native_loop")
        self.assertEqual((width, height, fps), (1080, 1920, 24))
        self.assertEqual(native_state["plan"]["plan_hash"], "testhash")
        self.assertEqual(clip_count, 2)
        self.assertTrue(status)

    def test_native_start_repairs_legacy_zero_shot_manifest_from_plan(self):
        plan = _sample_plan()
        initialized = EagleH3PlanNode().execute(
            plan, output_dir=str(self.tmpdir), resume_policy="overwrite"
        )
        manifest_path = pathlib.Path(initialized["result"][2])
        legacy = json.loads(manifest_path.read_text(encoding="utf-8"))
        legacy["total_shots"] = 0
        manifest_path.write_text(
            json.dumps(legacy, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        out = EagleH3NativeLoopStartNode().execute(
            plan, 1, output_dir=str(self.tmpdir), resume_policy="resume",
            unique_id="native-start",
        )
        _flow, state, _width, _height, _fps, status, clip_count = out["result"]
        payload = out["ui"]["h3_start"][0]
        self.assertEqual(2, state["total_shots"])
        self.assertEqual(2, clip_count)
        self.assertEqual(2, payload["total_shots"])
        self.assertEqual(2, payload["plan_shot_count"])
        self.assertEqual(2, payload["clip_count"])
        self.assertEqual("native-start", payload["execution_node_id"])
        self.assertNotIn("/0", status)

        from execution import get_output_from_returns
        _merged_output, merged_ui, _has_subgraph = get_output_from_returns(
            [out], EagleH3NativeLoopStartNode()
        )
        self.assertIsInstance(merged_ui["h3_start"][0], dict)
        self.assertEqual(2, merged_ui["h3_start"][0]["clip_count"])

    def test_native_loop_graphbuilder_advances_all_four_scenes(self):
        from comfy_execution.graph import DynamicPrompt

        plan = json.loads(json.dumps(_sample_plan()))
        template = plan["shots"][-1]
        for index in range(2, 4):
            shot = dict(template)
            shot.update({
                "index": index + 1,
                "id": f"scene_{index + 1:02d}",
                "prompt": f"scene {index + 1}",
                "prompt_hash": f"hash-{index + 1}",
                "generation_start_frame": index * 223,
                "audio_start_seconds": index * 9.29,
            })
            plan["shots"].append(shot)
        plan["plan_hash"] = "four-scene-plan"
        plan["summary"] = "4 clips"

        original_prompt = {
            "1": {"class_type": "EagleH3DirectorNode", "inputs": {}},
            "2": {
                "class_type": "EagleH3NativeLoopStartNode",
                "inputs": {"plan": ["1", 0], "start_index": 1},
            },
            "3": {
                "class_type": "EagleH3ShotContextNode",
                "inputs": {"state": ["2", 1]},
            },
            "4": {
                "class_type": "EagleH3NativeLoopEndNode",
                "inputs": {"flow": ["2", 0], "state": ["3", 0]},
            },
            "5": {
                "class_type": "PreviewImage",
                "inputs": {"images": ["3", 10]},
            },
        }
        dynprompt = DynamicPrompt(original_prompt)
        state = self._init_state(plan)
        self.assertEqual(4, state["total_shots"])
        flow = ["2", 0]
        end_id = "4"
        all_expansion_ids = set()
        original_prefix = (
            h3_nodes.GraphBuilder._default_prefix_root,
            h3_nodes.GraphBuilder._default_prefix_call_index,
            h3_nodes.GraphBuilder._default_prefix_graph_index,
        )
        try:
            for processed_scene in range(4):
                h3_nodes.GraphBuilder.set_default_prefix(end_id, 0, 0)
                result = EagleH3NativeLoopEndNode().execute(
                    flow,
                    state,
                    images=torch.zeros((24, 8, 8, 3), dtype=torch.float32),
                    sampled_latent={"samples": [
                        torch.zeros((1, 16, 3, 2, 2)),
                        torch.zeros((1, 32, 2, 8)),
                    ]},
                    dynprompt=dynprompt,
                    unique_id=end_id,
                )
                if processed_scene == 3:
                    self.assertNotIn("expand", result)
                    final_state, _video, done, next_index = result["result"][:4]
                    self.assertTrue(done)
                    self.assertEqual(4, final_state["current_index"])
                    self.assertEqual(4, final_state["total_shots"])
                    self.assertEqual(4, next_index)
                    self.assertNotIn("5/4", result["result"][4])
                    break

                expansion = result["expand"]
                expansion_ids = set(expansion)
                self.assertTrue(expansion_ids.isdisjoint(all_expansion_ids))
                all_expansion_ids.update(expansion_ids)
                for node_id, node_info in expansion.items():
                    dynprompt.add_ephemeral_node(
                        node_id,
                        node_info,
                        parent_id=end_id,
                        display_id=node_info.get("override_display_id", end_id),
                    )

                start_id = next(
                    node_id for node_id, info in expansion.items()
                    if info["class_type"] == "EagleH3NativeLoopStartNode"
                )
                end_id = next(
                    node_id for node_id, info in expansion.items()
                    if info["class_type"] == "EagleH3NativeLoopEndNode"
                )
                preview_id = next(
                    node_id for node_id, info in expansion.items()
                    if info["class_type"] == "PreviewImage"
                )
                self.assertEqual("2", expansion[start_id]["override_display_id"])
                self.assertEqual("4", expansion[end_id]["override_display_id"])
                self.assertEqual("5", expansion[preview_id]["override_display_id"])
                self.assertEqual("2", dynprompt.get_display_node_id(start_id))
                self.assertEqual("4", dynprompt.get_display_node_id(end_id))
                self.assertEqual("5", dynprompt.get_display_node_id(preview_id))

                recursive_state = expansion[start_id]["inputs"]["initial_state"]
                started = EagleH3NativeLoopStartNode().execute(
                    plan,
                    initial_state=recursive_state,
                    unique_id=start_id,
                )
                state = started["result"][1]
                payload = started["ui"]["h3_start"][0]
                self.assertEqual(processed_scene + 1, state["current_index"])
                self.assertEqual(4, state["total_shots"])
                self.assertEqual(4, started["result"][-1])
                self.assertEqual(4, payload["clip_count"])
                flow = expansion[end_id]["inputs"]["flow"]
        finally:
            h3_nodes.GraphBuilder.set_default_prefix(*original_prefix)

    def test_native_recurse_keeps_dual_sampler_save_preview_without_fake_end_id(self):
        """复现真实 eagle_h3_full 的三级采样、主审片、重复审片旁路、
        高级保存与预览旁路。第二层不得伪造 29.0.0.29。
        """
        from comfy_execution.graph import DynamicPrompt
        import nodes as comfy_nodes

        class OutputNode:
            OUTPUT_NODE = True

        output_classes = (
            "EagleH3NativeLoopEndNode",
            "EagleH3CheckpointReviewNode",
            "EagleH3ReviewWorkspaceNode",
            "EagleAdvancedVideoSaver",
        )
        previous_mappings = {
            name: comfy_nodes.NODE_CLASS_MAPPINGS.get(name)
            for name in output_classes
        }
        comfy_nodes.NODE_CLASS_MAPPINGS.update({
            name: OutputNode for name in output_classes
        })

        prompt = {
            "33": {"class_type": "EagleH3NativeLoopStartNode", "inputs": {}},
            "32": {"class_type": "EagleH3ShotContextNode", "inputs": {
                "state": ["33", 1],
            }},
            "31": {"class_type": "EagleH3ReferenceConditionNode", "inputs": {
                "state": ["32", 0], "prompt": ["32", 1],
                "width": ["33", 2], "height": ["33", 3],
            }},
            "45": {"class_type": "SamplerCustomAdvanced", "inputs": {
                "latent_image": ["31", 1],
            }},
            "47": {"class_type": "SamplerCustomAdvanced", "inputs": {
                "latent_image": ["45", 1],
            }},
            "51": {"class_type": "SamplerCustomAdvanced", "inputs": {
                "latent_image": ["47", 1],
            }},
            "52": {"class_type": "VAEDecode", "inputs": {"samples": ["51", 0]}},
            "78": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["51", 0]}},
            "30": {"class_type": "EagleH3FrameTrimNode", "inputs": {
                "images": ["52", 0], "audio": ["78", 0],
            }},
            # 已接入 End 状态/决策的唯一主审片节点。
            "86": {"class_type": "EagleH3ReviewWorkspaceNode", "inputs": {
                "state": ["32", 0], "images": ["30", 0],
                "audio": ["30", 1], "sampled_latent": ["51", 0],
            }},
            "29": {"class_type": "EagleH3NativeLoopEndNode", "inputs": {
                "flow": ["33", 0], "state": ["86", 1],
                "images": ["30", 0], "sampled_latent": ["51", 0],
                "decision": ["86", 2],
            }},
            # 留在画布的历史审片节点：普通模式不得作为旁路重复写检查点。
            "28": {"class_type": "EagleH3CheckpointReviewNode", "inputs": {
                "state": ["32", 0], "images": ["30", 0],
                "sampled_latent": ["51", 0], "read_only": False,
            }},
            # read_only 只输出历史/预览 UI，没有持久化和等待副作用，可保留。
            "27": {"class_type": "EagleH3CheckpointReviewNode", "inputs": {
                "state": ["86", 1], "video": ["86", 0], "read_only": True,
            }},
            # 这两个是必须保留的无状态输出旁路。
            "80": {"class_type": "EagleAdvancedVideoSaver", "inputs": {
                "images": ["30", 0], "audio": ["30", 1],
            }},
            "81": {"class_type": "PreviewImage", "inputs": {
                "images": ["30", 0],
            }},
        }
        dynprompt = DynamicPrompt(prompt)
        flow = ["33", 0]
        end_id = "29"
        seen_ids = set()
        original_prefix = (
            h3_nodes.GraphBuilder._default_prefix_root,
            h3_nodes.GraphBuilder._default_prefix_call_index,
            h3_nodes.GraphBuilder._default_prefix_graph_index,
        )
        try:
            for round_index in range(3):
                h3_nodes.GraphBuilder.set_default_prefix(end_id, 0, 0)
                result = EagleH3NativeLoopEndNode()._recurse(
                    flow, {"current_index": round_index + 1}, dynprompt, end_id
                )
                expansion = result["expand"]
                self.assertTrue(set(expansion).isdisjoint(seen_ids))
                seen_ids.update(expansion)
                self.assertEqual(
                    3,
                    sum(info["class_type"] == "SamplerCustomAdvanced"
                        for info in expansion.values()),
                )
                self.assertEqual(
                    1,
                    sum(info["class_type"] == "EagleAdvancedVideoSaver"
                        for info in expansion.values()),
                )
                self.assertEqual(
                    1,
                    sum(info["class_type"] == "PreviewImage"
                        for info in expansion.values()),
                )
                read_only_reviews = [
                    info for info in expansion.values()
                    if info["class_type"] == "EagleH3CheckpointReviewNode"
                ]
                self.assertEqual(1, len(read_only_reviews))
                self.assertIs(True, read_only_reviews[0]["inputs"]["read_only"])
                self.assertFalse(any(
                    str(node_id).endswith(".29") for node_id in expansion
                ))

                for node_id, node_info in expansion.items():
                    dynprompt.add_ephemeral_node(
                        node_id, node_info, parent_id=end_id,
                        display_id=node_info.get("override_display_id", end_id),
                    )
                start_id = next(
                    node_id for node_id, info in expansion.items()
                    if info["class_type"] == "EagleH3NativeLoopStartNode"
                )
                end_id = next(
                    node_id for node_id, info in expansion.items()
                    if info["class_type"] == "EagleH3NativeLoopEndNode"
                )
                flow = expansion[end_id]["inputs"]["flow"]
                self.assertEqual("33", dynprompt.get_display_node_id(start_id))
                self.assertEqual("29", dynprompt.get_display_node_id(end_id))
        finally:
            h3_nodes.GraphBuilder.set_default_prefix(*original_prefix)
            for name, previous in previous_mappings.items():
                if previous is None:
                    comfy_nodes.NODE_CLASS_MAPPINGS.pop(name, None)
                else:
                    comfy_nodes.NODE_CLASS_MAPPINGS[name] = previous

    def test_native_end_expands_body_in_auto_mode(self):
        state = self._init_state(_sample_plan())

        class FakeDynPrompt:
            nodes = {
                "1": {"class_type": "EagleH3DirectorNode", "inputs": {}},
                "2": {"class_type": "EagleH3NativeLoopStartNode", "inputs": {"plan": ["1", 0], "start_index": 1}},
                "3": {"class_type": "EagleH3ShotContextNode", "inputs": {"state": ["2", 1]}},
                "4": {"class_type": "EagleH3NativeLoopEndNode", "inputs": {"flow": ["2", 0], "state": ["3", 0]}},
            }

            def get_node(self, node_id):
                return self.nodes[str(node_id)]

            def get_display_node_id(self, node_id):
                return str(node_id)

        result = EagleH3NativeLoopEndNode().execute(
            ["2", 0], state,
            images=torch.zeros((24, 8, 8, 3), dtype=torch.float32),
            sampled_latent={"samples": [
                torch.zeros((1, 16, 3, 2, 2)),
                torch.zeros((1, 32, 2, 8)),
            ]},
            dynprompt=FakeDynPrompt(), unique_id="4"
        )
        self.assertIn("expand", result)
        self.assertEqual(len(result["result"]), len(EagleH3NativeLoopEndNode.RETURN_TYPES))
        classes = {item["class_type"] for item in result["expand"].values()}
        self.assertIn("EagleH3NativeLoopStartNode", classes)
        self.assertIn("EagleH3NativeLoopEndNode", classes)

    def test_interactive_native_end_approve_retry_and_stop_contract(self):
        class FakeDynPrompt:
            nodes = {
                "1": {"class_type": "EagleH3DirectorNode", "inputs": {}},
                "2": {
                    "class_type": "EagleH3NativeLoopStartNode",
                    "inputs": {"plan": ["1", 0], "start_index": 1},
                },
                "3": {
                    "class_type": "EagleH3ShotContextNode",
                    "inputs": {"state": ["2", 1]},
                },
                "4": {
                    "class_type": "EagleH3NativeLoopEndNode",
                    "inputs": {"flow": ["2", 0], "state": ["3", 0]},
                },
            }

            def get_node(self, node_id):
                return self.nodes[str(node_id)]

            def get_display_node_id(self, node_id):
                return str(node_id)

        def run(decision):
            state = self._init_state(_sample_plan())
            state["mode"] = "interactive"
            h3_nodes.GraphBuilder.set_default_prefix("interactive-end", 0, 0)
            return EagleH3NativeLoopEndNode().execute(
                ["2", 0], state,
                images=torch.zeros((24, 8, 8, 3), dtype=torch.float32),
                sampled_latent={"samples": [
                    torch.zeros((1, 16, 3, 2, 2)),
                    torch.zeros((1, 32, 2, 8)),
                ]},
                decision=decision,
                dynprompt=FakeDynPrompt(), unique_id="4",
            )

        approved = run("approve")
        approved_start = next(
            item for item in approved["expand"].values()
            if item["class_type"] == "EagleH3NativeLoopStartNode"
        )
        self.assertEqual(1, approved_start["inputs"]["initial_state"]["current_index"])

        retried = run("retry")
        retried_start = next(
            item for item in retried["expand"].values()
            if item["class_type"] == "EagleH3NativeLoopStartNode"
        )
        self.assertEqual(0, retried_start["inputs"]["initial_state"]["current_index"])
        self.assertEqual(0, retried_start["inputs"]["initial_state"]["reroll_index"])

        stopped = run("stop")
        self.assertNotIn("expand", stopped)
        self.assertTrue(stopped["result"][2])
        self.assertTrue(stopped["result"][6])

    def test_plan_preflight_reports_invalid_reference_tag(self):
        project = {
            "fps": 24,
            "width": 960,
            "height": 544,
            "referencePolicy": "strict",
            "mediaRefs": [{"type": "image", "filename": "one.png", "duration": 0}],
        }
        scenes = [{
            "title": "tag check",
            "defaultSeconds": 2,
            "preamble": "Use <Picture 2> as the subject.",
            "shots": [],
            "dialogues": [],
        }]
        plan = compile_h3_params(project, scenes)
        self.assertFalse(plan["preflight"]["ok"])
        self.assertTrue(any("<Picture 2>" in item for item in plan["preflight"]["errors"]))
        passthrough, ok, report_json, summary = EagleH3PreflightNode().execute(plan)
        self.assertIs(passthrough, plan)
        self.assertFalse(ok)
        self.assertIn("Picture 2", report_json)
        self.assertIn("FAILED", summary)

    def test_director_reference_roles_compile_and_audio_only_is_rejected(self):
        project = {
            "mode": "r2v", "fps": 24, "width": 960, "height": 544,
            "foundation": "Rainy-night character short with restrained camera motion.",
            "mediaRefs": [
                {"type": "image", "filename": "hero.png", "name": "Nali",
                 "role": "subject_person", "purpose": "lock Nali's identity and outfit",
                 "retention": "fully_preserved"},
                {"type": "video", "filename": "move.mp4", "name": "walk cycle",
                 "role": "motion_reference", "purpose": "copy walking cadence only",
                 "retention": "attribute_transfer", "useEmbeddedAudio": False},
                {"type": "audio", "filename": "voice.wav", "name": "Nali voice",
                 "role": "voice_timbre", "purpose": "bind to Nali", "speakerId": "S1",
                 "retention": "reference"},
            ],
        }
        scenes = [{"id": 1, "defaultSeconds": 6, "preamble": "Use <Picture 1>, <Video 1>, and <Audio 1>.",
                   "shots": [], "dialogues": []}]
        plan = compile_h3_params(project, scenes)
        prefix = plan["prompt_prefix"]
        self.assertIn("<Subject 1> is Nali, defined by <Picture 1>", prefix)
        self.assertIn("summary:\n  Task type: audio reference.", prefix)
        self.assertIn("<Audio 1>", prefix)
        self.assertIn("Bind voice identity to (S1)", prefix)
        self.assertFalse(plan["reference_media"][1]["use_embedded_audio"])
        self.assertEqual("motion_reference", plan["reference_media"][1]["role"])

        audio_only = dict(project)
        audio_only["mediaRefs"] = [project["mediaRefs"][2]]
        invalid = compile_h3_params(audio_only, scenes)
        self.assertFalse(invalid["preflight"]["ok"])
        self.assertTrue(any("音频不能单独" in item for item in invalid["preflight"]["errors"]))

    def test_ref2va_full_reference_workflow_compiles_all_scenes_before_loop(self):
        """Use Ref2VA as the integration baseline for the Director/H3 chain."""
        project = {
            "mode": "r2v", "fps": 24, "width": 960, "height": 544,
            "foundation": "A rainy-night 2D animated short with stable identity and restrained camera motion.",
            "referencePolicy": "strict",
            "skill": {"dialogueLanguage": "Chinese"},
            "mediaRefs": [
                {"id": "hero", "type": "image", "filename": "hero.png", "name": "Nali",
                 "role": "subject_person", "purpose": "lock identity and outfit",
                 "retention": "fully_preserved"},
                {"id": "motion", "type": "video", "filename": "walk.mp4", "name": "walk",
                 "role": "motion_reference", "purpose": "walking cadence only",
                 "retention": "attribute_transfer", "useEmbeddedAudio": True},
                {"id": "voice", "type": "audio", "filename": "voice.wav", "name": "voice",
                 "role": "voice_timbre", "purpose": "bind Nali voice", "speakerId": "S1",
                 "retention": "reference"},
            ],
        }
        scenes = [
            {"id": 1, "title": "arrival", "defaultSeconds": 6,
             "preamble": "Use <Picture 1>, <Video 1>, and <Audio 1> only for their declared roles.",
             "shots": [{"title": "arrival", "time": "00:00.000", "framing": "wide_shot",
                        "content": "Nali enters the lantern-lit corridor.", "camera": "Tracking Shot at slow speed",
                        "action": "She walks toward the door.", "sound": "rain and footsteps", "estSeconds": 6}],
             "dialogues": [{"role": "Nali", "text": "我到了。", "time": "00:04.000"}]},
            {"id": 2, "title": "door", "defaultSeconds": 6,
             "preamble": "Use <Picture 1>, <Video 1>, and <Audio 1> while preserving the prior ending state.",
             "shots": [{"title": "door", "time": "00:00.000", "framing": "medium_shot",
                        "content": "Nali stops at the same door and raises her hand.", "camera": "Static Shot",
                        "action": "Her fingertips reach the handle.", "sound": "rain bridge and cloth movement",
                        "estSeconds": 6}],
             "dialogues": []},
        ]
        plan = compile_h3_params(project, scenes)
        self.assertTrue(plan["preflight"]["ok"], plan["preflight"])
        self.assertEqual("h3-prompt-spec@1.0", plan["spec"])
        self.assertEqual(2, len(plan["shots"]))
        self.assertEqual(2, len({shot["prompt_hash"] for shot in plan["shots"]}))
        expected = ["subject_definitions:", "summary:", "retention_analysis:",
                    "detailed_description:", "overall_soundscape:", "non_diegetic_music:"]
        for shot in plan["shots"]:
            positions = [shot["prompt"].index(field) for field in expected]
            self.assertEqual(sorted(positions), positions)
            self.assertNotIn("integrated_multimodal_description:", shot["prompt"])
        first_prompt = plan["shots"][0]["prompt"]
        self.assertIn("Nali (S1) says: <d>[Chinese] 我到了。</d>", first_prompt)
        self.assertIn("Background: weak_reference", first_prompt)

        state = self._init_state(plan)
        current = EagleH3CurrentShotNode().execute(state)
        self.assertEqual(plan["shots"][0]["prompt"], current[0])
        self.assertTrue(current[8])

        image = torch.zeros((1, 8, 8, 3), dtype=torch.float32)
        video = torch.ones((6, 8, 8, 3), dtype=torch.float32)
        audio = {"waveform": torch.zeros((1, 1, 1600)), "sample_rate": 16000}
        bundle = {
            "ref_images": [image],
            "video_slots": [video, None, None],
            "video_audio_slots": [audio, None, None],
            "audio_slots": [audio, None, None],
            "media_mapping": json.dumps(plan["reference_media"]),
        }
        compiled, grouped, report = _prepare_reference_condition(
            state, bundle, first_prompt, reference_scope="scene_tags"
        )
        self.assertIn("<Picture 1>", compiled)
        self.assertIn("<Video 1>", compiled)
        # Embedded video audio occupies Audio 1; the standalone voice compacts to Audio 2.
        self.assertIn("<Audio 2>", compiled)
        self.assertEqual((1, 1, 1), tuple(len(grouped[k]) for k in ("image", "video", "audio")))
        self.assertEqual(1, report["paired_audio_count"])

        frames = torch.zeros((8, 8, 8, 3), dtype=torch.float32)
        delivered, synced, _with_overlap, overlap = EagleH3FrameTrimNode().execute(
            frames, trim_frames=2, audio=audio, fps=24.0, match_tail=True,
            retain_overlap_frames=2,
        )
        self.assertEqual(6, delivered.shape[0])
        self.assertEqual(2, overlap)
        self.assertIn("waveform", synced)

        advanced, done, next_index, loop_again, _summary = EagleH3EndNode().execute(
            state, decision="approve"
        )["result"]
        self.assertFalse(done)
        self.assertTrue(loop_again)
        self.assertEqual(2, next_index)
        self.assertEqual(1, advanced["current_index"])

    def test_full_workflow_example_uses_ref2va_checkpoint_and_core_chain(self):
        workflow = json.loads((REPO / "example_workflows" / "eagle_h3_full_workflow.json").read_text(encoding="utf-8"))
        nodes = {node["type"]: node for node in workflow["nodes"]}
        self.assertIn("ref2va", str(nodes["UNETLoader"]["widgets_values"][0]).lower())
        for node_type in (
            "EagleH3DirectorNode", "EagleH3NativeLoopStartNode", "EagleH3ShotContextNode",
            "EagleH3ReferenceConditionNode", "EagleH3FrameTrimNode",
            "EagleH3CheckpointReviewNode", "EagleH3NativeLoopEndNode",
            "MiniMaxChunkFeedForward",
        ):
            self.assertIn(node_type, nodes)

        by_id = {node["id"]: node for node in workflow["nodes"]}
        edges = set()
        for link_id, origin_id, origin_slot, target_id, target_slot, *_ in workflow["links"]:
            origin = by_id[origin_id]
            target = by_id[target_id]
            output = origin["outputs"][origin_slot]
            input_ = target["inputs"][target_slot]
            self.assertEqual(link_id, input_.get("link"))
            self.assertEqual(output["type"], input_["type"])
            self.assertIn(link_id, output.get("links") or [])
            edges.add((origin["type"], output["name"], target["type"], input_["name"]))

        required_edges = {
            ("EagleH3DirectorNode", "plan", "EagleH3NativeLoopStartNode", "plan"),
            ("EagleH3DirectorNode", "media_bundle", "EagleH3ReferenceConditionNode", "media_bundle"),
            ("EagleH3NativeLoopStartNode", "state", "EagleH3ShotContextNode", "state"),
            ("EagleH3NativeLoopStartNode", "width", "EagleH3ReferenceConditionNode", "width"),
            ("EagleH3NativeLoopStartNode", "height", "EagleH3ReferenceConditionNode", "height"),
            ("EagleH3ShotContextNode", "state", "EagleH3ReferenceConditionNode", "state"),
            ("EagleH3ShotContextNode", "prompt", "EagleH3ReferenceConditionNode", "prompt"),
            ("EagleH3ShotContextNode", "length", "EagleH3ReferenceConditionNode", "length"),
            ("EagleH3ShotContextNode", "context_image", "EagleH3ReferenceConditionNode", "context_image"),
            ("EagleH3ShotContextNode", "has_context", "EagleH3ReferenceConditionNode", "has_context"),
            ("EagleH3ReferenceConditionNode", "trim_frames", "EagleH3FrameTrimNode", "trim_frames"),
            ("EagleH3ShotContextNode", "delivered_frames", "EagleH3FrameTrimNode", "target_frames"),
            ("SamplerCustomAdvanced", "output", "EagleH3CheckpointReviewNode", "sampled_latent"),
            ("EagleH3CheckpointReviewNode", "state", "EagleH3NativeLoopEndNode", "state"),
            ("EagleH3FrameTrimNode", "images", "EagleH3NativeLoopEndNode", "images"),
            ("SamplerCustomAdvanced", "output", "EagleH3NativeLoopEndNode", "sampled_latent"),
        }
        self.assertTrue(required_edges.issubset(edges), required_edges - edges)
        self.assertEqual(
            ["h3_state", "LLM_HINT", "foundation_input", "api_config", "local_model",
             "skill_request", "director_skill"],
            [item["name"] for item in nodes["EagleH3DirectorNode"]["inputs"]],
        )
        checkpoint = nodes["EagleH3CheckpointReviewNode"]
        loop_end = nodes["EagleH3NativeLoopEndNode"]
        self.assertIn("sampled_latent", [item["name"] for item in checkpoint["inputs"]])
        self.assertIn("retry_prompt", [item["name"] for item in checkpoint["inputs"]])
        self.assertIn("resume_scene", [item["name"] for item in checkpoint["inputs"]])
        self.assertEqual(
            ["segment", "manifest"],
            [item["name"] for item in checkpoint["outputs"][-2:]],
        )
        self.assertIn("auto_assemble", [item["name"] for item in loop_end["inputs"]])
        self.assertEqual(
            ["manifest", "partial", "last_context_frames", "last_context_latent"],
            [item["name"] for item in loop_end["outputs"][-4:]],
        )

    def test_h3_frontend_repairs_native_and_context_loop_authoring_links(self):
        source = (REPO / "web" / "js" / "h3_pipeline.js").read_text(encoding="utf-8")
        self.assertIn('"length", reference, "length"', source)
        self.assertIn('output.name = "length"', source)
        self.assertIn('"delivered_frames", trim, "target_frames"', source)
        self.assertIn('sampler, samplerOutput, review, "sampled_latent"', source)
        self.assertIn('sampler, samplerOutput, end, "sampled_latent"', source)
        self.assertIn('repairNativeCoreLinks(app.graph', source)
        self.assertIn('repairReferenceConditionWidgets(this, serialized)', source)
        self.assertIn('disconnectDirectorPlanOverride(graph, director, plan)', source)
        self.assertIn('syncContextLoopPlanWidget(director)', source)
        self.assertIn('syncNativeLoopStartInfo(director)', source)
        self.assertIn('单次队列 · 动态 {{ info.total_shots }} 场景', source)
        self.assertIn('累计预览: {{ history.length }} / {{ review.clip_count }}', source)
        self.assertIn('_eagleSyncContextLoopBridges', source)
        self.assertIn('"MiniMaxH3ChainScenePromptEditor"', source)
        self.assertIn('"MiniMaxH3ChainLoopStart"', source)
        self.assertIn('editor, "plan", loopStart, "plan"', source)
        self.assertIn('createMissing: true', source)
        self.assertIn('repairContextLoopReferenceLinks(app.graph)', source)
        self.assertIn('["length", "length"]', source)
        self.assertIn('filename.label = "文件名前缀"', source)
        self.assertIn('前缀_0001、前缀_0002', source)

    def test_director_authoring_json_is_accepted_by_installed_context_loop_plan(self):
        plugin_root = COMFY_ROOT / "custom_nodes" / "ComfyUI-MiniMaxH3-Contex-Loop"
        if not (plugin_root / "chain_nodes.py").is_file():
            self.skipTest("MiniMaxH3-Context-Loop is not installed")
        custom_nodes = str(COMFY_ROOT / "custom_nodes")
        if custom_nodes not in sys.path:
            sys.path.insert(0, custom_nodes)
        chain_nodes = __import__(
            "ComfyUI-MiniMaxH3-Contex-Loop.chain_nodes",
            fromlist=["MiniMaxH3ChainPlan"],
        )
        project = {
            "mode": "t2va", "fps": 24, "width": 960, "height": 544,
            "foundation": "A concise cinematic test.",
        }
        scenes = [{
            "id": "scene_01", "title": "test", "defaultSeconds": 5,
            "preamble": "A slow push-in on a quiet room.", "shots": [], "dialogues": [],
        }]
        payload = export_context_loop_plan_json(compile_h3_params(project, scenes))
        result = chain_nodes.MiniMaxH3ChainPlan().build(
            "[]", "eagle_context_loop_test", "2", 960, 544, 22,
            "video", "head", "disabled", "generated_audio", 22,
            5.0, 8, 0, 18, 0, "guide", plan_json_input=payload,
        )
        plan = result[0]
        self.assertEqual("H3_CHAIN_PLAN", chain_nodes.PLAN_TYPE)
        self.assertEqual(1, len(plan["shots"]))
        self.assertEqual((960, 544), (result[3], result[4]))

    def test_director_plan_exposes_context_loop_aliases_and_atomic_ignores(self):
        project = {
            "fps": 24, "width": 960, "height": 544,
            "mediaRefs": [{"id": "one", "type": "image", "filename": "one.png", "name": "Nali"}],
        }
        scenes = [{
            "id": 17, "title": "tag check", "defaultSeconds": 6,
            "preamble": "Use <Picture 1>. <d>[Nali] 不要这句</d>",
            "disabledTokens": ["<Picture 1>", "<d>[Nali] 不要这句</d>"],
            "shots": [], "dialogues": [{"role": "Nali", "text": "不要这句"}],
        }]
        plan = compile_h3_params(project, scenes)
        shot = plan["shots"][0]
        self.assertEqual("17", shot["source_scene_id"])
        self.assertEqual(shot["raw_frames"], shot["length"])
        self.assertEqual(6, shot["duration_seconds"])
        self.assertNotIn("<d>[Nali] 不要这句</d>", shot["scene_prompt"])
        self.assertNotIn("Use <Picture 1>", shot["scene_prompt"])
        self.assertEqual(["<Picture 1>"], shot["disabled_reference_tags"])
        self.assertEqual([], shot["scene_reference_tags"])
        self.assertIn("reference_fingerprint", plan["compatibility"])

    def test_character_pv_contract_reaches_prompt_plan_and_skill_generation(self):
        from eagle_suite_test_package.eagle_suite.h3_director_node import _build_skill_prompts

        project = {
            "workflowType": "character_pv",
            "fps": 24,
            "width": 960,
            "height": 544,
            "pv": {
                "enabled": True,
                "template": "image_flash",
                "rhythm": "beat_sync",
                "cutDensity": "dense",
                "bpm": 120,
                "beatOffsetMs": 250,
                "title": "EAGLE",
                "subtitle": "Character PV",
                "reserveTitleSafeArea": True,
                "transitions": ["flash_cut", "mask_wipe"],
                "effects": ["deep_glow", "pixel_sort"],
            },
        }
        scene = {
            "id": 1, "title": "PV", "defaultSeconds": 5,
            "preamble": "The character turns toward camera.",
            "shots": [], "dialogues": [],
        }
        plan = compile_h3_params(project, [scene])
        shot = plan["shots"][0]
        self.assertEqual("character_pv", plan["workflow_type"])
        self.assertEqual("eagle-character-pv-post@1.0", plan["post_production"]["schema"])
        self.assertEqual([0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75, 4.25, 4.75],
                         shot["post_production_cues"]["beat_times_seconds"])
        self.assertIn("CHARACTER PV / MOTION-GRAPHICS CONTRACT", shot["scene_prompt"])
        self.assertIn("Exact post title (metadata only; do not render in generation): EAGLE", shot["scene_prompt"])
        self.assertIn("pixel_sort", shot["scene_prompt"])
        _system, user = _build_skill_prompts("script", project, scene, "", request={"pv": project["pv"]})
        self.assertIn("【项目专项合同】", user)
        self.assertIn("CHARACTER PV / MOTION-GRAPHICS CONTRACT", user)

    def test_character_interaction_contract_is_not_frontend_only(self):
        project = {
            "workflowType": "character_interaction",
            "fps": 24, "width": 960, "height": 544,
            "interaction": {
                "enabled": True,
                "productionLevel": "SSR",
                "visualStyle": "anime",
                "dynamicType": "gesture",
                "outputMode": "single_loop",
                "interactionIntent": "wave once, then return to the opening pose",
            },
        }
        scene = {"id": 1, "defaultSeconds": 5, "preamble": "Character portrait.", "shots": [], "dialogues": []}
        prompt = compile_h3_params(project, [scene])["shots"][0]["scene_prompt"]
        self.assertIn("CHARACTER INTERACTION CONTRACT", prompt)
        self.assertIn("wave once", prompt)
        self.assertIn("ANIME PERFORMANCE", prompt)
        self.assertIn("avoid photoreal skin", prompt)
        self.assertIn("Adult-content profile: OFF", prompt)

    def test_legacy_size_preset_is_authoritative_and_custom_dimensions_snap(self):
        scene = [{"id": 1, "defaultSeconds": 5, "preamble": "test",
                  "shots": [], "dialogues": []}]
        legacy = compile_h3_params(
            {"fps": 24, "sizePreset": "16:9|mp0.5|960|544"}, scene
        )
        self.assertEqual((960, 544), (
            legacy["compatibility"]["width"], legacy["compatibility"]["height"]
        ))
        custom = compile_h3_params(
            {"fps": 24, "sizePreset": "custom", "width": 1001, "height": 557}, scene
        )
        self.assertEqual((992, 544), (
            custom["compatibility"]["width"], custom["compatibility"]["height"]
        ))

    def test_all_required_h3_size_presets_resolve_exactly(self):
        scene = [{"id": 1, "defaultSeconds": 5, "preamble": "test",
                  "shots": [], "dialogues": []}]
        required = {
            "0.2": (608, 352), "0.3": (736, 416), "0.4": (864, 480),
            "0.5": (960, 544), "0.6": (1056, 608), "0.7": (1152, 640),
            "0.8": (1216, 672), "0.9": (1280, 736), "0.98": (1344, 768),
            "1.0": (1376, 768), "1.2": (1504, 832), "1.5": (1664, 928),
            "1.8": (1824, 1024), "2.0": (1920, 1088),
        }
        for megapixels, (width, height) in required.items():
            with self.subTest(megapixels=megapixels, aspect="16:9"):
                plan = compile_h3_params({
                    "fps": 24,
                    "sizePreset": f"16:9|mp{megapixels}|{width}|{height}",
                }, scene)
                self.assertEqual((width, height), (
                    plan["compatibility"]["width"], plan["compatibility"]["height"]
                ))
            with self.subTest(megapixels=megapixels, aspect="9:16"):
                plan = compile_h3_params({
                    "fps": 24,
                    "sizePreset": f"9:16|mp{megapixels}|{height}|{width}",
                }, scene)
                self.assertEqual((height, width), (
                    plan["compatibility"]["width"], plan["compatibility"]["height"]
                ))

    def test_editorial_duration_is_exact_while_h3_generation_uses_legal_grid(self):
        project = {
            "fps": 24, "sizePreset": "16:9|mp0.5|960|544",
            "contextLength": 22, "anchorMode": "head",
        }
        scenes = [
            {"id": 1, "defaultSeconds": 10, "preamble": "first",
             "shots": [], "dialogues": []},
            {"id": 2, "defaultSeconds": 10, "preamble": "second",
             "shots": [], "dialogues": []},
        ]
        plan = compile_h3_params(project, scenes)
        first, second = plan["shots"]
        self.assertEqual((240, 243, 3), (
            first["delivered_frames"], first["raw_frames"], first["tail_trim_frames"]
        ))
        self.assertEqual((240, 277, 22, 15), (
            second["delivered_frames"], second["raw_frames"],
            second["context_trim_frames"], second["tail_trim_frames"]
        ))
        self.assertEqual(480, plan["total_delivered_frames"])
        self.assertIn("20.000s", plan["summary"])

    def test_structured_shots_replace_script_shot_blocks_without_duplication(self):
        project = {"fps": 24, "width": 960, "height": 544}
        scenes = [{
            "id": 1, "defaultSeconds": 5,
            "preamble": "Director setup.\n\n[Shot 1] obsolete draft shot.",
            "shots": [{"id": 1, "time": "00:00.000", "content": "authoritative shot",
                       "estSeconds": 5}],
            "dialogues": [],
        }]
        prompt = compile_h3_params(project, scenes)["shots"][0]["scene_prompt"]
        self.assertIn("Director setup.", prompt)
        self.assertIn("authoritative shot", prompt)
        self.assertNotIn("obsolete draft shot", prompt)
        self.assertEqual(1, prompt.count("[Shot 1]"))

    def test_reference_condition_routes_scene_media_without_grid_or_batch_collapse(self):
        image_a = torch.zeros((1, 8, 8, 3), dtype=torch.float32)
        image_b = torch.ones((1, 8, 8, 3), dtype=torch.float32)
        video = torch.ones((5, 8, 8, 3), dtype=torch.float32)
        audio = {"waveform": torch.zeros((1, 1, 1600)), "sample_rate": 16000}
        paired = {"waveform": torch.zeros((1, 1, 1600)), "sample_rate": 16000}
        mapping = [
            {"type": "image", "filename": "one.png", "name": "one"},
            {"type": "image", "filename": "two.png", "name": "two"},
            {"type": "video", "filename": "motion.mp4", "name": "motion"},
            {"type": "audio", "filename": "voice.wav", "name": "voice"},
        ]
        bundle = {
            "ref_images": [image_a, image_b],
            "video_slots": [video, None, None],
            "video_audio_slots": [paired, None, None],
            "audio_slots": [audio, None, None],
            "media_mapping": json.dumps(mapping),
        }
        prompt = (
            "subject_definitions:\n"
            "  <Picture 1> is ignored.\n"
            "  <Picture 2> is hero.\n"
            "  <Video 1> is motion.\n"
            "  <Audio 1> is voice.\n\n"
            "Use <Picture 2>, <Video 1>, and <Audio 1>."
        )
        state = {
            "current_index": 0,
            "plan": {"shots": [{
                "scene_prompt": "Use <Picture 2>, <Video 1>, and <Audio 1>.",
                "scene_reference_tags": ["<Picture 2>", "<Video 1>", "<Audio 1>"],
                "disabled_reference_tags": ["<Picture 1>"],
            }]},
        }
        compiled, grouped, report = _prepare_reference_condition(
            state, bundle, prompt, reference_scope="scene_tags"
        )
        self.assertEqual([image_b], [item["value"] for item in grouped["image"]])
        self.assertEqual(1, len(grouped["video"]))
        self.assertEqual(1, len(grouped["audio"]))
        self.assertNotIn("is ignored", compiled)
        self.assertIn("<Picture 1> is hero", compiled)
        self.assertIn("<Audio 2> is voice", compiled)
        self.assertEqual(1, report["paired_audio_count"])
        self.assertTrue(any(item["reason"] == "ignored_in_director" for item in report["skipped"]))

        context_loop_state = {
            "index": 2,
            "plan": {"shots": [state["plan"]["shots"][0], {
                "scene_prompt": "Use <Picture 1>.",
                "scene_reference_tags": ["<Picture 1>"],
                "disabled_reference_tags": [],
            }]},
        }
        _compiled, context_grouped, context_report = _prepare_reference_condition(
            context_loop_state, bundle, prompt, reference_scope="scene_tags"
        )
        self.assertEqual([image_a], [item["value"] for item in context_grouped["image"]])
        self.assertEqual(2, context_report["scene_index"])
        self.assertEqual("context_loop", context_report["state_contract"])

    def test_reference_condition_node_contract(self):
        inputs = EagleH3ReferenceConditionNode.INPUT_TYPES()
        self.assertEqual("H3_MEDIA_BUNDLE", inputs["required"]["media_bundle"][0])
        self.assertIn("state", inputs["required"])
        self.assertEqual("EAGLE_H3_STATE,H3_CHAIN_STATE", inputs["required"]["state"][0])
        self.assertNotIn("run_state", inputs["required"])
        self.assertEqual(("CONDITIONING", "LATENT"), EagleH3ReferenceConditionNode.RETURN_TYPES[:2])
        self.assertEqual("BOOLEAN", EagleH3ReferenceConditionNode.RETURN_TYPES[-1])
        self.assertEqual("is_continuation", EagleH3ReferenceConditionNode.RETURN_NAMES[-1])
        for name in ("prompt", "width", "height", "length"):
            self.assertTrue(inputs["required"][name][1].get("forceInput"), name)

    def test_first_shot_seed_does_not_instantiate_motion_context(self):
        created = []

        class FakeNode:
            def __init__(self, name):
                self.name = name

            def set_input(self, _name, _value):
                return None

            def out(self, index):
                return (self.name, index)

        class FakeGraph:
            def node(self, name, _label):
                created.append(name)
                return FakeNode(name)

            def finalize(self):
                return {}

        import nodes as comfy_nodes
        original = h3_nodes.GraphBuilder
        original_chain = comfy_nodes.NODE_CLASS_MAPPINGS.pop(
            "MiniMaxH3ChainContext", None
        )
        h3_nodes.GraphBuilder = FakeGraph
        try:
            result = EagleH3ReferenceConditionNode().execute(
                clip=object(), vae=object(), audio_vae=object(),
                media_bundle={"media_mapping": "[]"},
                state={"current_index": 0, "plan": {"shots": [{}]}},
                prompt="first shot", width=960, height=544, length=124,
                use_context_guide=True,
                context_image=torch.zeros((1, 8, 8, 3), dtype=torch.float32),
                has_context=True,
            )
        finally:
            h3_nodes.GraphBuilder = original
            if original_chain is not None:
                comfy_nodes.NODE_CLASS_MAPPINGS["MiniMaxH3ChainContext"] = original_chain

        self.assertEqual(
            ["MiniMaxH3ReferenceToVideo", "MiniMaxH3AddGuide"], created
        )
        report = json.loads(result["result"][3])
        self.assertTrue(report["seed_context"])
        self.assertFalse(report["context_guide"])
        self.assertEqual(0, result["result"][5])
        self.assertEqual(("MiniMaxH3AddGuide", 0), result["result"][0])

    def test_continuation_wires_previous_av_latent_into_motion_context(self):
        created = {}

        class FakeNode:
            def __init__(self, name):
                self.name = name
                self.inputs = {}

            def set_input(self, name, value):
                self.inputs[name] = value

            def out(self, index):
                return (self.name, index)

        class FakeGraph:
            def node(self, name, _label):
                node = FakeNode(name)
                created[name] = node
                return node

            def finalize(self):
                return {}

        class FakeMotion:
            @classmethod
            def INPUT_TYPES(cls):
                return {
                    "required": {
                        "conditioning": ("CONDITIONING",),
                        "vae": ("VAE",),
                        "latent": ("LATENT",),
                        "context_length": (["22", "5", "39", "56"],),
                        "audio_context_length": ("INT",),
                    },
                    "optional": {
                        "context_frames": ("IMAGE",),
                        "context_latent": ("LATENT",),
                    },
                }

        state = self._init_state(_sample_plan())
        state["current_index"] = 1
        state["previous_latent"] = {"samples": [
            torch.ones((1, 16, 3, 2, 2)),
            torch.ones((1, 32, 2, 8)),
        ]}
        import nodes as comfy_nodes
        original_graph = h3_nodes.GraphBuilder
        original_motion = comfy_nodes.NODE_CLASS_MAPPINGS.get("MiniMaxH3MotionContext")
        original_chain = comfy_nodes.NODE_CLASS_MAPPINGS.pop(
            "MiniMaxH3ChainContext", None
        )
        h3_nodes.GraphBuilder = FakeGraph
        comfy_nodes.NODE_CLASS_MAPPINGS["MiniMaxH3MotionContext"] = FakeMotion
        try:
            result = EagleH3ReferenceConditionNode().execute(
                clip=object(), vae=object(), audio_vae=object(),
                media_bundle={"media_mapping": "[]"}, state=state,
                prompt="continued shot", width=1080, height=1920, length=245,
                context_image=torch.zeros((22, 16, 16, 3)), has_context=True,
            )
        finally:
            h3_nodes.GraphBuilder = original_graph
            if original_motion is None:
                comfy_nodes.NODE_CLASS_MAPPINGS.pop("MiniMaxH3MotionContext", None)
            else:
                comfy_nodes.NODE_CLASS_MAPPINGS["MiniMaxH3MotionContext"] = original_motion
            if original_chain is not None:
                comfy_nodes.NODE_CLASS_MAPPINGS["MiniMaxH3ChainContext"] = original_chain

        motion_inputs = created["MiniMaxH3MotionContext"].inputs
        self.assertEqual(2, len(motion_inputs["context_latent"]["samples"]))
        self.assertEqual(22, motion_inputs["audio_context_length"])
        report = json.loads(result["result"][3])
        self.assertTrue(report["latent_handoff"])
        self.assertEqual("runtime", report["latent_source"])
        self.assertTrue(result["result"][-1])

    def test_masked_av_routes_through_native_chain_context(self):
        created = {}

        class FakeNode:
            def __init__(self, name):
                self.name = name
                self.inputs = {}

            def set_input(self, name, value):
                self.inputs[name] = value

            def out(self, index):
                return (self.name, index)

        class FakeGraph:
            def node(self, name, _label):
                node = FakeNode(name)
                created[name] = node
                return node

            def finalize(self):
                return {}

        class FakeChainContext:
            RETURN_TYPES = ("CONDITIONING", "INT", "BOOLEAN", "LATENT")
            RETURN_NAMES = (
                "conditioning", "trim_frames", "is_continuation", "latent",
            )

        state = self._init_state(_sample_plan())
        state["current_index"] = 1
        state["plan"]["compatibility"].update({
            "context_length": 39,
            "audio_context_length": 39,
            "continuation_mode": "masked_av",
        })
        state["previous_frames"] = torch.zeros((39, 16, 16, 3))
        state["previous_latent"] = {"samples": [
            torch.ones((1, 16, 4, 2, 2)),
            torch.ones((1, 32, 2, 65)),
        ]}

        import nodes as comfy_nodes
        original_graph = h3_nodes.GraphBuilder
        original_chain = comfy_nodes.NODE_CLASS_MAPPINGS.get("MiniMaxH3ChainContext")
        h3_nodes.GraphBuilder = FakeGraph
        comfy_nodes.NODE_CLASS_MAPPINGS["MiniMaxH3ChainContext"] = FakeChainContext
        try:
            result = EagleH3ReferenceConditionNode().execute(
                clip=object(), vae=object(), audio_vae=object(),
                media_bundle={"media_mapping": "[]"}, state=state,
                prompt="same shot continuation", width=1080, height=1920,
                length=260, has_context=False,
            )
        finally:
            h3_nodes.GraphBuilder = original_graph
            if original_chain is None:
                comfy_nodes.NODE_CLASS_MAPPINGS.pop("MiniMaxH3ChainContext", None)
            else:
                comfy_nodes.NODE_CLASS_MAPPINGS["MiniMaxH3ChainContext"] = original_chain

        context = created["MiniMaxH3ChainContext"]
        self.assertEqual(2, context.inputs["state"]["index"])
        self.assertEqual(
            "masked_av",
            context.inputs["state"]["plan"]["compatibility"]["continuation_mode"],
        )
        self.assertEqual(("MiniMaxH3ChainContext", 3), result["result"][1])
        self.assertEqual(("MiniMaxH3ChainContext", 1), result["result"][5])
        self.assertEqual(("MiniMaxH3ChainContext", 2), result["result"][6])
        report = json.loads(result["result"][3])
        self.assertEqual("masked_av", report["continuation_mode"])
        self.assertTrue(report["context_guide"])
        self.assertTrue(report["latent_handoff"])

    def test_native_chain_context_requires_four_output_contract(self):
        class FakeNode:
            def set_input(self, _name, _value):
                return None

            def out(self, index):
                return ("fake", index)

        class FakeGraph:
            def node(self, _name, _label):
                return FakeNode()

        class OldChainContext:
            RETURN_TYPES = ("CONDITIONING", "INT", "BOOLEAN")
            RETURN_NAMES = (
                "conditioning", "trim_frames", "is_continuation",
            )

        state = self._init_state(_sample_plan())
        state["current_index"] = 1
        state["plan"]["compatibility"].update({
            "context_length": 22,
            "audio_context_length": 22,
            "continuation_mode": "masked_av",
        })
        state["previous_frames"] = torch.zeros((22, 8, 8, 3))
        state["previous_latent"] = {"samples": [
            torch.ones((1, 16, 3, 2, 2)),
            torch.ones((1, 32, 2, 8)),
        ]}

        import nodes as comfy_nodes
        original_graph = h3_nodes.GraphBuilder
        original_chain = comfy_nodes.NODE_CLASS_MAPPINGS.get(
            "MiniMaxH3ChainContext"
        )
        h3_nodes.GraphBuilder = FakeGraph
        comfy_nodes.NODE_CLASS_MAPPINGS[
            "MiniMaxH3ChainContext"
        ] = OldChainContext
        try:
            with self.assertRaisesRegex(RuntimeError, "端口合同过旧"):
                EagleH3ReferenceConditionNode().execute(
                    clip=object(), vae=object(), audio_vae=object(),
                    media_bundle={"media_mapping": "[]"}, state=state,
                    prompt="continued shot", width=1080, height=1920,
                    length=245,
                )
        finally:
            h3_nodes.GraphBuilder = original_graph
            if original_chain is None:
                comfy_nodes.NODE_CLASS_MAPPINGS.pop(
                    "MiniMaxH3ChainContext", None
                )
            else:
                comfy_nodes.NODE_CLASS_MAPPINGS[
                    "MiniMaxH3ChainContext"
                ] = original_chain

    def test_native_chain_context_accepts_v3_schema_contract(self):
        class Output:
            def __init__(self, io_type, output_id):
                self.io_type = io_type
                self.id = output_id

            def get_io_type(self):
                return self.io_type

        class Schema:
            outputs = [
                Output("CONDITIONING", "conditioning"),
                Output("INT", "trim_frames"),
                Output("BOOLEAN", "is_continuation"),
                Output("LATENT", "latent"),
            ]

        class V3ChainContext:
            @classmethod
            def define_schema(cls):
                return Schema()

        self.assertIsNone(
            h3_nodes._validate_native_chain_context_contract(V3ChainContext)
        )

    def test_masked_av_rejects_short_runtime_frame_context(self):
        class FakeNode:
            def set_input(self, _name, _value):
                return None

            def out(self, index):
                return ("fake", index)

        class FakeGraph:
            def node(self, _name, _label):
                return FakeNode()

        class FakeChainContext:
            RETURN_TYPES = ("CONDITIONING", "INT", "BOOLEAN", "LATENT")
            RETURN_NAMES = (
                "conditioning", "trim_frames", "is_continuation", "latent",
            )

        state = self._init_state(_sample_plan())
        state["current_index"] = 1
        state["plan"]["compatibility"].update({
            "context_length": 22,
            "audio_context_length": 22,
            "continuation_mode": "masked_av",
        })
        state["previous_frames"] = torch.zeros((5, 8, 8, 3))
        state["previous_latent"] = {"samples": [
            torch.ones((1, 16, 3, 2, 2)),
            torch.ones((1, 32, 2, 8)),
        ]}

        import nodes as comfy_nodes
        original_graph = h3_nodes.GraphBuilder
        original_chain = comfy_nodes.NODE_CLASS_MAPPINGS.get(
            "MiniMaxH3ChainContext"
        )
        h3_nodes.GraphBuilder = FakeGraph
        comfy_nodes.NODE_CLASS_MAPPINGS[
            "MiniMaxH3ChainContext"
        ] = FakeChainContext
        try:
            with self.assertRaisesRegex(ValueError, "需要 22 帧.*仅恢复 5 帧"):
                EagleH3ReferenceConditionNode().execute(
                    clip=object(), vae=object(), audio_vae=object(),
                    media_bundle={"media_mapping": "[]"}, state=state,
                    prompt="continued shot", width=1080, height=1920,
                    length=245,
                )
        finally:
            h3_nodes.GraphBuilder = original_graph
            if original_chain is None:
                comfy_nodes.NODE_CLASS_MAPPINGS.pop(
                    "MiniMaxH3ChainContext", None
                )
            else:
                comfy_nodes.NODE_CLASS_MAPPINGS[
                    "MiniMaxH3ChainContext"
                ] = original_chain

    def test_reference_size_presets_map_and_downscale_only(self):
        large = torch.ones((1, 1600, 2400, 3), dtype=torch.float32)
        resized = _limit_reference_short_edge(large, 768)
        self.assertEqual((1, 768, 1152, 3), tuple(resized.shape))
        small = torch.ones((1, 512, 768, 3), dtype=torch.float32)
        self.assertIs(small, _limit_reference_short_edge(small, 1024))
        inputs = EagleH3ReferenceConditionNode.INPUT_TYPES()
        choices = inputs["required"]["ref_image_size"][0]
        self.assertEqual("match", choices[0])
        self.assertEqual("max", choices[-1])
        self.assertNotIn("custom", choices)
        self.assertIn("1.2 · 768px", choices)
        self.assertIn("3.1 · 1984px", choices)
        self.assertNotIn("ref_short_edge", inputs["optional"])
        self.assertEqual(768, REF_IMAGE_SIZE_SHORT_EDGES["1.2"])
        self.assertEqual(832, REF_IMAGE_SIZE_SHORT_EDGES["1.3"])
        self.assertEqual(1984, REF_IMAGE_SIZE_SHORT_EDGES["3.1"])
        self.assertIsNone(_reference_short_edge("match"))
        self.assertEqual(768, _reference_short_edge("1.2 · 768px"))
        self.assertEqual(768, _reference_short_edge("1.2"))
        self.assertEqual(2048, _reference_short_edge("max"))

    def test_reference_router_enforces_official_autogrow_limits(self):
        images = [torch.ones((1, 8, 8, 3), dtype=torch.float32) for _ in range(10)]
        mapping = [
            {"type": "image", "filename": f"{index}.png", "name": str(index)}
            for index in range(1, 11)
        ]
        bundle = {
            "ref_images": images,
            "video_slots": [],
            "video_audio_slots": [],
            "audio_slots": [],
            "media_mapping": json.dumps(mapping),
        }
        prompt = "\n".join(f"<Picture {index}> is ref {index}." for index in range(1, 11))
        state = {"current_index": 0, "plan": {"shots": [{}]}}
        compiled, grouped, report = _prepare_reference_condition(
            state, bundle, prompt, reference_scope="all"
        )
        self.assertEqual(9, len(grouped["image"]))
        self.assertNotIn("<Picture 10>", compiled)
        self.assertTrue(any(
            item["tag"] == "<Picture 10>" and item["reason"] == "official_slot_limit"
            for item in report["skipped"]
        ))

    def test_scene_chain_settings_inherit_global_and_allow_explicit_overrides(self):
        project = {"fps": 24, "width": 960, "height": 544,
                   "contextLength": 39, "audioContextLength": 39, "globalSteps": 12}
        scenes = [
            {"id": 1, "defaultSeconds": 6, "preamble": "one", "shots": [], "dialogues": []},
            {"id": 2, "defaultSeconds": 6, "defaultSteps": 20,
             "contextLength": 22, "audioContextLength": 22,
             "preamble": "two", "shots": [], "dialogues": []},
        ]
        plan = compile_h3_params(project, scenes)
        self.assertNotIn("context_length", plan["shots"][0])
        self.assertNotIn("audio_context_length", plan["shots"][0])
        self.assertEqual(12, plan["shots"][0]["steps"])
        self.assertEqual(22, plan["shots"][1]["context_length"])
        self.assertEqual(22, plan["shots"][1]["audio_context_length"])
        self.assertEqual(20, plan["shots"][1]["steps"])

    def test_resume_invalidates_from_first_changed_scene(self):
        plan = _sample_plan()
        state = h3_state.init_state(plan, str(self.tmpdir), resume_policy="overwrite")
        for index in range(2):
            state["current_index"] = index
            h3_state.record_shot_result(state, f"/fake/{index}.mp4", delivered_frames=100)
        state["current_index"] = 2
        h3_state.save_state(state)

        changed = json.loads(json.dumps(plan))
        changed["shots"][1]["prompt_hash"] = "changed"
        changed["plan_hash"] = "changed-plan"
        resumed = h3_state.init_state(changed, str(self.tmpdir), resume_policy="resume")
        self.assertEqual(1, resumed["current_index"])
        self.assertEqual([0], [item["index"] for item in resumed["shots"]])
        self.assertEqual(1, resumed["invalidated_from"])

    def test_start_node_skips_completed_shots_on_resume(self):
        plan = _sample_plan()
        out = EagleH3PlanNode().execute(plan, output_dir=str(self.tmpdir), resume_policy="overwrite")
        state = out["result"][0]
        state["current_index"] = 1
        h3_state.save_state(state)
        # reload 并 start：start_index 不应回退
        state2 = h3_state.load_state(state["base_dir"])
        out2 = EagleH3StartNode().execute(state2, 1)
        state2 = out2["result"][0]
        self.assertEqual(state2["current_index"], 1)

    def test_current_shot_outputs_prompt_and_seed(self):
        plan = _sample_plan()
        out = EagleH3PlanNode().execute(plan, output_dir=str(self.tmpdir), resume_policy="overwrite")
        state = out["result"][0]
        out = EagleH3StartNode().execute(state, 1)
        state = out["result"][0]
        (prompt, seed, steps, raw_frames, delivered_frames,
         blend_frames, continuation_mode, shot_id, is_first, summary) = EagleH3CurrentShotNode().execute(state)
        self.assertIn("intro scene", prompt)
        self.assertEqual(seed, 123)
        self.assertEqual(steps, 8)
        self.assertEqual(raw_frames, 245)
        self.assertEqual(delivered_frames, 223)
        self.assertTrue(is_first)

    def _init_state(self, plan):
        out = EagleH3PlanNode().execute(plan, output_dir=str(self.tmpdir), resume_policy="overwrite")
        state = out["result"][0]
        state = EagleH3StartNode().execute(state, 1)["result"][0]
        return state

    def test_context_first_shot_uses_seed_image(self):
        import torch
        state = self._init_state(_sample_plan())  # current_index = 0 (shot 1)
        seed = torch.zeros((1, 8, 8, 3), dtype=torch.float32)
        img, frames, has_ctx, note = EagleH3ContextNode().execute(state, seed_image=seed)
        self.assertTrue(has_ctx)
        self.assertEqual(frames, 1)
        self.assertIn("seed_image", note)
        self.assertEqual(tuple(img.shape), (1, 8, 8, 3))

    def test_shot_context_combines_shot_metadata_and_reference_context(self):
        state = self._init_state(_sample_plan())
        seed = torch.zeros((1, 8, 8, 3), dtype=torch.float32)
        result = EagleH3ShotContextNode().execute(state, seed_image=seed)
        (returned_state, prompt, seed_value, steps, raw_frames, delivered_frames,
         blend_frames, continuation_mode, shot_id, is_first,
         context_image, context_frames, has_context, summary) = result
        self.assertEqual(returned_state, state)
        self.assertIn("intro scene", prompt)
        self.assertEqual(seed_value, 123)
        self.assertEqual(steps, 8)
        self.assertEqual(raw_frames, 245)
        self.assertEqual(delivered_frames, 223)
        self.assertEqual(shot_id, "scene_01_intro")
        self.assertTrue(is_first)
        self.assertTrue(has_context)
        self.assertEqual(context_frames, 1)
        self.assertEqual(tuple(context_image.shape), (1, 8, 8, 3))
        self.assertIn("seed_image", summary)

    def test_context_first_shot_without_seed_is_empty(self):
        state = self._init_state(_sample_plan())
        img, frames, has_ctx, note = EagleH3ContextNode().execute(state)
        self.assertFalse(has_ctx)
        self.assertEqual(frames, 0)

    def test_context_continuation_derives_prev_clip_from_state(self):
        import torch
        plan = _sample_plan()
        state = self._init_state(plan)
        # 记录上一镜（index 0）clip 路径，并推进到续镜（index 1）
        h3_state.record_shot_result(state, clip_path=str(self.tmpdir / "prev_clip.mp4"),
                                    delivered_frames=223, decision="approved")
        state["current_index"] = 1
        h3_state.save_state(state)
        state = h3_state.load_state(state["base_dir"])
        # 不传 prev_clip，应从 run_state 自动读取上一镜 clip（此处路径不存在，应给出警告而非崩溃）
        img, frames, has_ctx, note = EagleH3ContextNode().execute(state)
        self.assertFalse(has_ctx)  # 路径无法解析 -> 空（但逻辑已走到 state 派生分支）
        self.assertIn("无法解析", note)

    def test_end_advances_index(self):
        plan = _sample_plan()
        out = EagleH3PlanNode().execute(plan, output_dir=str(self.tmpdir), resume_policy="overwrite")
        state = out["result"][0]
        state = h3_state.load_state(state["base_dir"])
        out = EagleH3EndNode().execute(state, "approve")
        state, done, next_index, loop_again, summary = out["result"]
        self.assertFalse(done)
        self.assertEqual(state["current_index"], 1)
        self.assertTrue(loop_again)

    def test_end_clamps_final_next_index_and_reports_exact_counts(self):
        state = self._init_state(_sample_plan())
        state["current_index"] = 1
        h3_state.save_state(state)
        out = EagleH3EndNode().execute(state, "approve")
        state, done, next_index, loop_again, summary = out["result"]
        payload = out["ui"]["h3_loop"][0]
        self.assertTrue(done)
        self.assertFalse(loop_again)
        self.assertEqual(2, state["current_index"])
        self.assertEqual(2, next_index)
        self.assertEqual(1, payload["processed_index"])
        self.assertEqual(2, payload["current_index"])
        self.assertEqual(2, payload["next_index"])
        self.assertEqual(2, payload["total_shots"])
        self.assertNotIn("3/2", summary)

    def test_end_stops(self):
        plan = _sample_plan()
        out = EagleH3PlanNode().execute(plan, output_dir=str(self.tmpdir), resume_policy="overwrite")
        state = out["result"][0]
        out = EagleH3EndNode().execute(state, "stop")
        state, done, next_index, loop_again, summary = out["result"]
        self.assertTrue(done)
        self.assertFalse(loop_again)

    def test_end_retries_keep_index(self):
        plan = _sample_plan()
        out = EagleH3PlanNode().execute(plan, output_dir=str(self.tmpdir), resume_policy="overwrite")
        state = out["result"][0]
        out = EagleH3EndNode().execute(state, "retry")
        state, done, next_index, loop_again, summary = out["result"]
        self.assertFalse(done)
        self.assertTrue(loop_again)
        self.assertEqual(state["current_index"], 0)
        self.assertEqual(state["reroll_index"], 0)

    def test_reroll_changes_effective_seed_without_mutating_plan(self):
        plan = _sample_plan()
        state = self._init_state(plan)
        original = h3_state.shot_params(state)["effective_seed"]
        advanced, loop_again, done = h3_state.advance(state, "reroll")
        self.assertTrue(loop_again)
        self.assertFalse(done)
        self.assertEqual(advanced["current_index"], 0)
        self.assertEqual(advanced["plan"]["shots"][0]["seed"], original)
        self.assertNotEqual(h3_state.shot_params(advanced)["effective_seed"], original)

    def test_review_overrides_prompt_seed_and_h3_length_without_mutating_plan(self):
        state = self._init_state(_sample_plan())
        original_prompt = state["plan"]["shots"][0]["prompt"]
        h3_state.apply_shot_overrides(
            state, prompt="revised scene", seed=9876, length=124
        )
        params = h3_state.shot_params(state)
        self.assertEqual("revised scene", params["shot"]["prompt"])
        self.assertEqual(9876, params["effective_seed"])
        self.assertEqual(124, params["shot"]["raw_frames"])
        self.assertEqual(124, params["shot"]["delivered_frames"])
        self.assertEqual(original_prompt, state["plan"]["shots"][0]["prompt"])
        with self.assertRaisesRegex(ValueError, "17k\\+5"):
            h3_state.apply_shot_overrides(state, length=120)

    def test_checkpoint_history_retains_immutable_revisions(self):
        state = self._init_state(_sample_plan())
        first = h3_state.record_shot_result(
            state, "/fake/clip_r0001.mp4", delivered_frames=100,
            decision="retry", meta={"revision": 1, "seed": 11},
        )
        second = h3_state.record_shot_result(
            state, "/fake/clip_r0002.mp4", delivered_frames=100,
            decision="reviewing", meta={"revision": 2, "seed": 22},
        )
        self.assertEqual(1, first["active_revision"])
        self.assertEqual(2, second["active_revision"])
        self.assertEqual(2, len(second["revisions"]))
        self.assertEqual(
            ["/fake/clip_r0001.mp4", "/fake/clip_r0002.mp4"],
            [item["clip"] for item in second["revisions"]],
        )

    def test_restore_from_scene_preserves_only_predecessor_approvals(self):
        state = self._init_state(_sample_plan())
        h3_state.record_shot_result(state, "/fake/scene_1.mp4", decision="approved")
        state["current_index"] = 1
        h3_state.record_shot_result(state, "/fake/scene_2.mp4", decision="approved")
        h3_state.restore_from_scene(state, 2)
        self.assertEqual(1, state["current_index"])
        self.assertEqual([0], [item["index"] for item in state["shots"]])
        self.assertFalse(state["stop"])

    def test_review_payload_lists_all_persisted_scene_previews(self):
        state = self._init_state(_sample_plan())
        h3_state.record_shot_result(
            state, str(self.tmpdir / "scene_01.mp4"), delivered_frames=120,
            meta={"seed": 101},
        )
        state["current_index"] = 1
        h3_state.record_shot_result(
            state, str(self.tmpdir / "scene_02.mp4"), delivered_frames=168,
            meta={"seed": 202},
        )
        payload = EagleH3ReviewGateNode()._ui_payload(
            state, str(self.tmpdir / "scene_02.mp4"), True, False, "", "2 scenes", "auto"
        )
        self.assertEqual(2, payload["clip_count"])
        self.assertEqual([0, 1], [item["index"] for item in payload["history"]])
        self.assertEqual(["101", "202"], [item["seed"] for item in payload["history"]])

    def test_interactive_review_timeout_continues_same_execution(self):
        state = self._init_state(_sample_plan())
        state["mode"] = "interactive"
        clip = self.tmpdir / "review.mp4"
        clip.write_bytes(b"preview")
        h3_state.record_shot_result(state, str(clip), decision="pending")
        result = asyncio.run(EagleH3ReviewGateNode().execute(
            state,
            str(clip),
            auto_continue_timeout_minutes=0.00001,
        ))
        reviewed_state, decision, awaiting, approved, _summary = result["result"]
        self.assertEqual("approve", decision)
        self.assertFalse(awaiting)
        self.assertTrue(approved)
        self.assertEqual("approved", reviewed_state["shots"][0]["decision"])

    def test_interactive_review_retry_applies_editable_fields(self):
        state = self._init_state(_sample_plan())
        state["mode"] = "interactive"
        clip = self.tmpdir / "review_retry.mp4"
        clip.write_bytes(b"preview")
        h3_state.record_shot_result(state, str(clip), decision="reviewing")
        result = asyncio.run(EagleH3ReviewGateNode().execute(
            state,
            str(clip),
            review_decision="retry",
            retry_prompt="new movement",
            retry_seed=456,
            retry_length=124,
        ))
        reviewed_state, decision, awaiting, approved, _summary = result["result"]
        params = h3_state.shot_params(reviewed_state)
        self.assertEqual("retry", decision)
        self.assertFalse(awaiting)
        self.assertFalse(approved)
        self.assertEqual("new movement", params["shot"]["prompt"])
        self.assertEqual(456, params["effective_seed"])
        self.assertEqual(124, params["shot"]["raw_frames"])

    def test_manifest_round_trip(self):
        plan = _sample_plan()
        state = h3_state.init_state(plan, str(self.tmpdir), resume_policy="overwrite")
        h3_state.record_shot_result(state, "/fake/clip.mp4", delivered_frames=100, decision="approved")
        h3_state.save_state(state)
        loaded = h3_state.load_state(state["base_dir"])
        self.assertEqual(loaded["current_index"], state["current_index"])
        self.assertEqual(len(loaded["shots"]), 1)
        self.assertEqual(loaded["shots"][0]["delivered_frames"], 100)
        manifest_node_result = h3_nodes.EagleH3LoadManifestNode().execute(
            "", base_dir=state["base_dir"]
        )
        self.assertEqual(2, len(manifest_node_result))

    def test_manifest_omits_runtime_frame_and_latent_tensors(self):
        state = self._init_state(_sample_plan())
        state["previous_frames"] = torch.zeros((2, 8, 8, 3))
        state["previous_latent"] = {"samples": [
            torch.zeros((1, 16, 2, 2, 2)),
            torch.zeros((1, 32, 2, 4)),
        ]}
        h3_state.save_state(state)
        loaded = h3_state.load_state(state["base_dir"])
        self.assertNotIn("previous_frames", loaded)
        self.assertNotIn("previous_latent", loaded)
        self.assertIn("previous_latent", state)

        exported = EagleH3StateInteropNode().execute(state)
        portable = json.loads(exported[1])
        self.assertNotIn("previous_frames", portable)
        self.assertNotIn("previous_latent", portable)
        self.assertIn("previous_latent", exported[0])

    def test_previous_av_latent_restores_from_active_checkpoint(self):
        state = self._init_state(_sample_plan())
        latent_path = self.tmpdir / "previous.pt"
        torch.save({"samples": [
            torch.ones((1, 16, 2, 2, 2)),
            torch.ones((1, 32, 2, 4)),
        ]}, latent_path)
        state["shots"] = [{"index": 0, "latent": str(latent_path)}]
        restored, source = h3_nodes._previous_latent_from_state(state, 1)
        self.assertEqual("checkpoint", source)
        self.assertEqual(2, len(restored["samples"]))

    def test_context_restores_lossless_frames_from_checkpoint_after_restart(self):
        state = self._init_state(_sample_plan())
        frames = torch.arange(30 * 2 * 2 * 3, dtype=torch.float32).reshape(
            30, 2, 2, 3
        )
        checkpoint = self.tmpdir / "lossless_context.pt"
        torch.save({
            "samples": [
                torch.ones((1, 16, 2, 2, 2)),
                torch.ones((1, 32, 2, 4)),
            ],
            "context_frames": frames,
        }, checkpoint)
        state["shots"] = [{
            "index": 0,
            "latent": str(checkpoint),
            "clip": "",
        }]
        state["current_index"] = 1
        h3_state.save_state(state)

        restarted = h3_state.load_state(state["base_dir"])
        self.assertNotIn("previous_frames", restarted)
        image, count, has_context, note = EagleH3ContextNode().execute(
            restarted
        )
        self.assertTrue(has_context)
        self.assertEqual(22, count)
        self.assertTrue(torch.equal(frames[-22:], image))
        self.assertIn("检查点无损上下文", note)

    def test_legacy_latent_checkpoint_falls_back_to_previous_mp4(self):
        state = self._init_state(_sample_plan())
        checkpoint = self.tmpdir / "legacy.pt"
        torch.save({"samples": [
            torch.ones((1, 16, 2, 2, 2)),
            torch.ones((1, 32, 2, 4)),
        ]}, checkpoint)
        clip = self.tmpdir / "legacy.mp4"
        clip.write_bytes(b"legacy")
        state["shots"] = [{
            "index": 0,
            "latent": str(checkpoint),
            "clip": str(clip),
        }]
        state["current_index"] = 1
        fallback = np.full((22, 2, 2, 3), 128, dtype=np.uint8)
        original = h3_nodes._cached_context_frames
        h3_nodes._cached_context_frames = lambda _path, _count: fallback
        try:
            image, count, has_context, note = EagleH3ContextNode().execute(
                state
            )
        finally:
            h3_nodes._cached_context_frames = original
        self.assertTrue(has_context)
        self.assertEqual(22, count)
        self.assertEqual((22, 2, 2, 3), tuple(image.shape))
        self.assertIn("已取 22 帧上下文", note)

    def test_segment_checkpoint_persists_exact_context_frame_tail(self):
        state = self._init_state(_sample_plan())
        images = torch.arange(223 * 2 * 2 * 3, dtype=torch.float32).reshape(
            223, 2, 2, 3
        )
        sampled_latent = {"samples": [
            torch.ones((1, 16, 2, 2, 2)),
            torch.ones((1, 32, 2, 4)),
        ]}
        original = h3_nodes.frames_to_video

        def fake_frames_to_video(_frames, output_path, **_kwargs):
            pathlib.Path(output_path).write_bytes(b"video")

        h3_nodes.frames_to_video = fake_frames_to_video
        try:
            _clip, saved_state, _clip_path = (
                h3_nodes.EagleH3SegmentCheckpointNode().execute(
                    state, images=images, sampled_latent=sampled_latent
                )
            )
        finally:
            h3_nodes.frames_to_video = original

        latent_path = pathlib.Path(saved_state["shots"][0]["latent"])
        payload = torch.load(
            latent_path, map_location="cpu", weights_only=True
        )
        self.assertEqual(2, len(payload["samples"]))
        self.assertEqual(22, payload["context_frames"].shape[0])
        self.assertTrue(torch.equal(images[-22:], payload["context_frames"]))

    def test_native_end_carries_compact_av_latent_and_frame_tail(self):
        state = self._init_state(_sample_plan())
        state["mode"] = "interactive"
        # 只验证最后一镜的运行态交接，避免在本测试重复搭建动态图。
        state["total_shots"] = 1
        images = torch.arange(30 * 2 * 2 * 3, dtype=torch.float32).reshape(
            30, 2, 2, 3
        )
        latent = {"samples": [
            torch.ones((1, 16, 4, 2, 2)),
            torch.ones((1, 32, 2, 10)),
            torch.full((1,), 99.0),
        ]}
        result = EagleH3NativeLoopEndNode().execute(
            ["2", 0], state, images, latent, decision="approve"
        )
        carried = result["result"][0]
        self.assertEqual(22, carried["previous_frames"].shape[0])
        self.assertEqual(2, len(carried["previous_latent"]["samples"]))
        self.assertTrue(carried["previous_frames"].device.type == "cpu")
        self.assertEqual("last_context_latent", EagleH3NativeLoopEndNode.RETURN_NAMES[-1])

    def test_media_utils_frames_to_video_and_extract(self):
        frames = np.random.randint(0, 255, (10, 64, 64, 3), dtype=np.uint8)
        out_path = self.tmpdir / "test_video.mp4"
        media_utils.frames_to_video(frames, str(out_path), fps=8)
        self.assertTrue(out_path.exists())
        extracted = media_utils.extract_frames(str(out_path), last=5)
        self.assertEqual(len(extracted), 5)
        self.assertEqual(extracted.shape[1:3], (64, 64))

    def test_media_utils_concat(self):
        frames_a = np.full((5, 32, 32, 3), 255, dtype=np.uint8)
        frames_b = np.full((5, 32, 32, 3), 0, dtype=np.uint8)
        path_a = self.tmpdir / "a.mp4"
        path_b = self.tmpdir / "b.mp4"
        media_utils.frames_to_video(frames_a, str(path_a), fps=5)
        media_utils.frames_to_video(frames_b, str(path_b), fps=5)
        out_path = self.tmpdir / "concat.mp4"
        media_utils.concat_videos([str(path_a), str(path_b)], str(out_path), fps=5)
        self.assertTrue(out_path.exists())

    def test_assemble_with_fake_clips(self):
        # CPU 生成两个真实可解码片段，帧率与计划一致；完整装配必须成功。
        for i in range(2):
            frames = np.full((5, 32, 32, 3), 128, dtype=np.uint8)
            shot_dir = self.tmpdir / "shots" / f"shot_{i+1:02d}"
            shot_dir.mkdir(parents=True)
            media_utils.frames_to_video(frames, str(shot_dir / "clip.mp4"), fps=24)
        plan = _sample_plan()
        for planned_shot in plan["shots"]:
            planned_shot["delivered_frames"] = 5
        state = h3_state.init_state(plan, str(self.tmpdir), resume_policy="overwrite")
        h3_state.record_shot_result(
            state, str(self.tmpdir / "shots" / "shot_01" / "clip.mp4"),
            delivered_frames=5, decision="approved", meta={"fps": 24}
        )
        state["current_index"] = 1
        h3_state.record_shot_result(
            state, str(self.tmpdir / "shots" / "shot_02" / "clip.mp4"),
            delivered_frames=5, decision="approved", meta={"fps": 24}
        )
        h3_state.save_state(state)
        out, summary = EagleH3AssembleNode().execute(state)
        self.assertTrue(out)
        first_path = pathlib.Path(media_utils._resolve_video_path(out))
        self.assertTrue(first_path.exists())
        self.assertEqual("test_run_0001.mp4", first_path.name)
        out_again, _summary_again = EagleH3AssembleNode().execute(state)
        second_path = pathlib.Path(media_utils._resolve_video_path(out_again))
        self.assertTrue(second_path.exists())
        self.assertEqual("test_run_0002.mp4", second_path.name)
        self.assertNotEqual(first_path, second_path)
        self.assertTrue(first_path.exists())

        local_dir = self.tmpdir / "manual_exports"
        first_copy, _ = EagleH3NativeLoopEndNode._copy_final_to_local(first_path, local_dir)
        second_copy, _ = EagleH3NativeLoopEndNode._copy_final_to_local(first_path, local_dir)
        self.assertEqual("test_run_0001.mp4", pathlib.Path(first_copy).name)
        self.assertEqual("test_run_0002.mp4", pathlib.Path(second_copy).name)
        self.assertTrue(pathlib.Path(first_copy).exists())

    def test_assemble_rejects_missing_and_undecodable_planned_scenes(self):
        plan = _sample_plan()
        for planned_shot in plan["shots"]:
            planned_shot["delivered_frames"] = 5
        state = h3_state.init_state(plan, str(self.tmpdir), resume_policy="overwrite")
        first_clip = self.tmpdir / "first.mp4"
        media_utils.frames_to_video(
            np.full((5, 32, 32, 3), 128, dtype=np.uint8), str(first_clip), fps=5
        )
        h3_state.record_shot_result(
            state, str(first_clip), delivered_frames=5, decision="approved"
        )
        video, status = EagleH3AssembleNode().execute(state)
        self.assertFalse(video)
        self.assertIn("场景 2", status)
        self.assertFalse((pathlib.Path(state["base_dir"]) / "final").exists())

        state["current_index"] = 1
        second_clip = self.tmpdir / "broken.mp4"
        second_clip.write_bytes(b"not a decodable video")
        h3_state.record_shot_result(
            state, str(second_clip), delivered_frames=5, decision="approved"
        )
        video, status = EagleH3AssembleNode().execute(state)
        self.assertFalse(video)
        self.assertIn("无法解码计帧", status)

    def test_stale_manifest_revision_and_atomic_saver_numbering_do_not_overwrite(self):
        from eagle_suite_test_package.eagle_suite.advanced_video_saver import EagleAdvancedVideoSaver

        shot_dir = self.tmpdir / "shots" / "shot_01"
        shot_dir.mkdir(parents=True)
        old_take = shot_dir / "clip_r0001.mp4"
        old_take.write_bytes(b"existing user take")
        revision, reserved = h3_nodes._reserve_shot_revision(shot_dir, {"shots": []}, 0)
        self.assertEqual(2, revision)
        self.assertEqual(b"existing user take", old_take.read_bytes())
        self.assertTrue(pathlib.Path(reserved).exists())

        output_dir = self.tmpdir / "advanced"
        output_dir.mkdir()
        (output_dir / "video_00001.mp4").write_bytes(b"existing video")
        (output_dir / "video_00002.json").write_text("{}", encoding="utf-8")
        first_counter, _, first_path = EagleAdvancedVideoSaver._reserve_output_path(
            output_dir, "video", "mp4"
        )
        second_counter, _, second_path = EagleAdvancedVideoSaver._reserve_output_path(
            output_dir, "video", "mp4"
        )
        self.assertEqual((3, 4), (first_counter, second_counter))
        self.assertNotEqual(first_path, second_path)
        self.assertEqual(b"existing video", (output_dir / "video_00001.mp4").read_bytes())

    def test_advanced_saver_commits_complete_video_to_own_reserved_name(self):
        from eagle_suite_test_package.eagle_suite.advanced_video_saver import EagleAdvancedVideoSaver

        output_dir = self.tmpdir / "actual_advanced_save"
        output_dir.mkdir()
        original = output_dir / "video_00001.mp4"
        original.write_bytes(b"existing user video")
        result = EagleAdvancedVideoSaver().save_video(
            "", str(output_dir), "video", 5, "mp4", "h264", "high", 0,
            preview=False, images=torch.zeros((3, 32, 32, 3)),
        )
        saved_path = pathlib.Path(result["result"][3])
        self.assertEqual("video_00002.mp4", saved_path.name)
        self.assertGreater(saved_path.stat().st_size, 0)
        self.assertEqual(3, media_utils.probe_decoded_frame_count(saved_path))
        self.assertEqual(b"existing user video", original.read_bytes())

    def test_native_end_terminal_missing_take_is_not_marked_complete(self):
        state = self._init_state(_sample_plan())
        state["current_index"] = 1
        latent = {"samples": [
            torch.zeros((1, 16, 2, 2, 2)),
            torch.zeros((1, 32, 2, 4)),
        ]}
        result = EagleH3NativeLoopEndNode().execute(
            "flow", state, torch.zeros((1, 8, 8, 3)), latent,
            decision="approve", auto_assemble=False,
        )
        final_state = result["result"][0]
        self.assertTrue(result["result"][2])  # loop terminated; output not verified
        self.assertEqual("incomplete", final_state["manifest_status"])
        self.assertEqual("incomplete", h3_state.load_state(state["base_dir"])["manifest_status"])
        self.assertIn("未标记完成", result["result"][4])

    def test_combined_nodes_use_native_video_contract(self):
        self.assertEqual("EAGLE_H3_STATE", EagleH3ShotContextNode.RETURN_TYPES[0])
        self.assertEqual("state", EagleH3ShotContextNode.RETURN_NAMES[0])
        shot_inputs = EagleH3ShotContextNode.INPUT_TYPES()
        self.assertIn("state", shot_inputs["required"])
        self.assertNotIn("prev_clip", shot_inputs.get("optional", {}))
        start_inputs = EagleH3NativeLoopStartNode.INPUT_TYPES()
        self.assertIn("plan", start_inputs["required"])
        self.assertNotIn("run_state", start_inputs["required"])
        self.assertEqual("EAGLE_H3_FLOW", EagleH3NativeLoopStartNode.RETURN_TYPES[0])
        self.assertEqual("clip_count", EagleH3NativeLoopStartNode.RETURN_NAMES[-1])
        review_inputs = EagleH3CheckpointReviewNode.INPUT_TYPES()
        self.assertIn("state", review_inputs["required"])
        self.assertEqual("VIDEO", review_inputs["optional"]["video"][0])
        self.assertEqual("IMAGE", review_inputs["optional"]["images"][0])
        self.assertEqual("IMAGE", review_inputs["optional"]["images_with_overlap"][0])
        self.assertEqual("VIDEO", EagleH3CheckpointReviewNode.RETURN_TYPES[0])
        self.assertEqual("VIDEO", EagleH3NativeLoopEndNode.RETURN_TYPES[1])
        required_end = EagleH3NativeLoopEndNode.INPUT_TYPES()["required"]
        self.assertEqual("IMAGE", required_end["images"][0])
        self.assertEqual("LATENT", required_end["sampled_latent"][0])
        optional = EagleH3NativeLoopEndNode.INPUT_TYPES()["optional"]
        self.assertIn("local_save_path", optional)
        self.assertIn("eagle_folder", optional)
        self.assertIn("auto_assemble", optional)
        self.assertEqual("EAGLE_H3_MANIFEST", EagleH3NativeLoopEndNode.RETURN_TYPES[5])
        self.assertEqual("partial", EagleH3NativeLoopEndNode.RETURN_NAMES[6])
        self.assertEqual(
            ("last_context_frames", "last_context_latent"),
            EagleH3NativeLoopEndNode.RETURN_NAMES[-2:],
        )

    def test_frame_trim_removes_overlap_and_matches_audio_tail(self):
        images = torch.arange(8 * 2 * 2 * 3, dtype=torch.float32).reshape(8, 2, 2, 3)
        audio = {
            "waveform": torch.ones((1, 1, 9000), dtype=torch.float32),
            "sample_rate": 1000,
        }
        delivered, synced, with_overlap, overlap_frames = EagleH3FrameTrimNode().execute(
            images,
            trim_frames=2,
            audio=audio,
            fps=2.0,
            match_tail=True,
            retain_overlap_frames=1,
        )
        self.assertEqual(6, delivered.shape[0])
        self.assertEqual(7, with_overlap.shape[0])
        self.assertEqual(1, overlap_frames)
        self.assertEqual(3000, synced["waveform"].shape[-1])

    def test_frame_trim_caps_h3_grid_tail_to_exact_target(self):
        images = torch.zeros((243, 2, 2, 3), dtype=torch.float32)
        audio = {"waveform": torch.ones((1, 1, 11000)), "sample_rate": 1000}
        delivered, synced, overlap, overlap_frames = EagleH3FrameTrimNode().execute(
            images, trim_frames=0, audio=audio, fps=24.0,
            match_tail=True, retain_overlap_frames=0, target_frames=240,
        )
        self.assertEqual(240, delivered.shape[0])
        self.assertEqual(240, overlap.shape[0])
        self.assertEqual(0, overlap_frames)
        self.assertEqual(10000, synced["waveform"].shape[-1])


class H3ReviewSafetyTests(unittest.TestCase):
    def test_completed_resume_does_not_silently_resample_last_scene(self):
        state = {"plan": _sample_plan(), "current_index": 2, "total_shots": 2, "shots": []}
        with self.assertRaisesRegex(ValueError, "已全部完成"):
            EagleH3StartNode().execute(state)
        self.assertEqual(state["current_index"], 2)

    def test_read_only_history_never_saves_or_waits(self):
        from unittest.mock import patch
        state = {"plan": _sample_plan(), "current_index": 0, "total_shots": 2,
                 "mode": "interactive", "shots": []}
        with patch.object(h3_nodes.EagleH3SegmentCheckpointNode, "execute") as save:
            with patch.object(h3_nodes.EagleH3ReviewGateNode, "execute") as review:
                out = asyncio.run(h3_nodes.EagleH3CheckpointReviewNode().execute(state, read_only=True))
        save.assert_not_called()
        review.assert_not_called()
        self.assertEqual(out["ui"]["h3_review"][0]["mode"], "history")
        self.assertEqual(out["result"][2], "")
        self.assertEqual(state["current_index"], 0)

    def test_checkpoint_failure_raises_before_review_or_advance(self):
        from unittest.mock import patch
        state = {"plan": _sample_plan(), "current_index": 0, "total_shots": 2, "shots": []}
        with patch.object(h3_nodes.EagleH3SegmentCheckpointNode, "execute", return_value=("", state, "disk full")):
            with self.assertRaisesRegex(RuntimeError, "不推进"):
                asyncio.run(h3_nodes.EagleH3CheckpointReviewNode().execute(state))
        with self.assertRaisesRegex(ValueError, "不推进"):
            h3_state.advance(state, "error")
        self.assertEqual(state["current_index"], 0)

    def test_resume_drops_stale_runtime_context(self):
        state = {"current_index": 3, "total_shots": 4, "shots": [],
                 "previous_frames": "scene3", "previous_latent": "scene3"}
        h3_state.restore_from_scene(state, 2)
        self.assertEqual(state["current_index"], 1)
        self.assertNotIn("previous_frames", state)
        self.assertNotIn("previous_latent", state)


if __name__ == "__main__":
    unittest.main()
