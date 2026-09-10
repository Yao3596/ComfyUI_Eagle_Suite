# -*- coding: utf-8 -*-
"""
H3 链下游承接节点单元/集成测试。
"""

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
COMFY_ROOT = pathlib.Path(os.environ.get("COMFYUI_ROOT", r"E:\ComfyUI-AKI\ComfyUI"))
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
from eagle_suite_test_package.eagle_suite.h3_director_node import compile_h3_params
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
        state, summary = out["result"]
        self.assertIn("run_name", state)
        self.assertEqual(0, state["current_index"])
        self.assertEqual(2, state["total_shots"])
        self.assertTrue((pathlib.Path(state["base_dir"]) / "manifest.json").exists())
        self.assertIn("test_run", summary)

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
            reference_images=images,
            video_frames_1=video_frames,
            video_audio_1=audio,
            reference_audio_1=audio,
        )
        bundle = result[0]
        self.assertEqual(2, result[12])
        self.assertEqual(1, result[13])
        self.assertEqual(1, result[14])
        self.assertEqual(2, len(result[1]))
        self.assertIs(result[2], video_frames)
        self.assertIs(result[5], audio)
        self.assertIs(result[8], audio)
        self.assertEqual(2, len(bundle["ref_images"]))

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
        flow, native_state, width, height, fps, status = out["result"]
        self.assertEqual(flow, "eagle_h3_native_loop")
        self.assertEqual((width, height, fps), (1080, 1920, 24))
        self.assertEqual(native_state["plan"]["plan_hash"], "testhash")
        self.assertTrue(status)

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
            ["2", 0], state, dynprompt=FakeDynPrompt(), unique_id="4"
        )
        self.assertIn("expand", result)
        self.assertEqual(len(result["result"]), len(EagleH3NativeLoopEndNode.RETURN_TYPES))
        classes = {item["class_type"] for item in result["expand"].values()}
        self.assertIn("EagleH3NativeLoopStartNode", classes)
        self.assertIn("EagleH3NativeLoopEndNode", classes)

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
        ):
            self.assertIn(node_type, nodes)

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

    def test_reference_condition_node_contract(self):
        inputs = EagleH3ReferenceConditionNode.INPUT_TYPES()
        self.assertEqual("H3_MEDIA_BUNDLE", inputs["required"]["media_bundle"][0])
        self.assertIn("state", inputs["required"])
        self.assertNotIn("run_state", inputs["required"])
        self.assertEqual(("CONDITIONING", "LATENT"), EagleH3ReferenceConditionNode.RETURN_TYPES[:2])

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

    def test_manifest_round_trip(self):
        plan = _sample_plan()
        state = h3_state.init_state(plan, str(self.tmpdir), resume_policy="overwrite")
        h3_state.record_shot_result(state, "/fake/clip.mp4", delivered_frames=100, decision="approved")
        h3_state.save_state(state)
        loaded = h3_state.load_state(state["base_dir"])
        self.assertEqual(loaded["current_index"], state["current_index"])
        self.assertEqual(len(loaded["shots"]), 1)
        self.assertEqual(loaded["shots"][0]["delivered_frames"], 100)

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
        # 创建两个假 clip
        for i in range(2):
            frames = np.full((5, 32, 32, 3), 128, dtype=np.uint8)
            shot_dir = self.tmpdir / "shots" / f"shot_{i+1:02d}"
            shot_dir.mkdir(parents=True)
            media_utils.frames_to_video(frames, str(shot_dir / "clip.mp4"), fps=5)
        plan = _sample_plan()
        state = h3_state.init_state(plan, str(self.tmpdir), resume_policy="overwrite")
        h3_state.record_shot_result(
            state, str(self.tmpdir / "shots" / "shot_01" / "clip.mp4"),
            delivered_frames=5, decision="approved", meta={"fps": 5}
        )
        h3_state.record_shot_result(
            state, str(self.tmpdir / "shots" / "shot_02" / "clip.mp4"),
            delivered_frames=5, decision="approved", meta={"fps": 5}
        )
        h3_state.save_state(state)
        out, summary = EagleH3AssembleNode().execute(state)
        self.assertTrue(out)
        self.assertTrue(pathlib.Path(media_utils._resolve_video_path(out)).exists())

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
        review_inputs = EagleH3CheckpointReviewNode.INPUT_TYPES()
        self.assertIn("state", review_inputs["required"])
        self.assertEqual("VIDEO", review_inputs["optional"]["video"][0])
        self.assertEqual("IMAGE", review_inputs["optional"]["images"][0])
        self.assertEqual("IMAGE", review_inputs["optional"]["images_with_overlap"][0])
        self.assertEqual("VIDEO", EagleH3CheckpointReviewNode.RETURN_TYPES[0])
        self.assertEqual("VIDEO", EagleH3NativeLoopEndNode.RETURN_TYPES[1])
        optional = EagleH3NativeLoopEndNode.INPUT_TYPES()["optional"]
        self.assertIn("local_save_path", optional)
        self.assertIn("eagle_folder", optional)

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


if __name__ == "__main__":
    unittest.main()
