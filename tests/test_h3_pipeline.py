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
    EagleH3PreflightNode,
    EagleH3StartNode,
    EagleH3NativeLoopStartNode,
    EagleH3NativeLoopEndNode,
    EagleH3CurrentShotNode,
    EagleH3ShotContextNode,
    EagleH3EndNode,
    EagleH3AssembleNode,
    EagleH3ContextNode,
    EagleH3CheckpointReviewNode,
    EagleH3FinalizeNode,
)
from eagle_suite_test_package.eagle_suite.h3_director_node import compile_h3_params


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
        state = self._init_state(_sample_plan())
        out = EagleH3NativeLoopStartNode().execute(state, 1)
        flow, native_state, width, height, fps, status = out["result"]
        self.assertEqual(flow, "eagle_h3_native_loop")
        self.assertEqual((width, height, fps), (1080, 1920, 24))
        self.assertEqual(native_state["plan"]["plan_hash"], "testhash")
        self.assertTrue(status)

    def test_native_end_expands_body_in_auto_mode(self):
        state = self._init_state(_sample_plan())

        class FakeDynPrompt:
            nodes = {
                "1": {"class_type": "EagleH3PlanNode", "inputs": {}},
                "2": {"class_type": "EagleH3NativeLoopStartNode", "inputs": {"run_state": ["1", 0], "start_index": 1}},
                "3": {"class_type": "EagleH3ShotContextNode", "inputs": {"run_state": ["2", 1]}},
                "4": {"class_type": "EagleH3NativeLoopEndNode", "inputs": {"flow": ["2", 0], "run_state": ["3", 0]}},
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
        self.assertIn("reference_fingerprint", plan["compatibility"])

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
        self.assertEqual("H3_RUN_STATE", EagleH3ShotContextNode.RETURN_TYPES[0])
        self.assertEqual("VIDEO", EagleH3CheckpointReviewNode.INPUT_TYPES()["required"]["video"][0])
        self.assertEqual("VIDEO", EagleH3CheckpointReviewNode.RETURN_TYPES[0])
        self.assertEqual("VIDEO", EagleH3NativeLoopEndNode.RETURN_TYPES[1])


if __name__ == "__main__":
    unittest.main()
