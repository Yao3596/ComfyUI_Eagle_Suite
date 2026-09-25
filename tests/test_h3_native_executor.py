# -*- coding: utf-8 -*-
"""Real PromptExecutor regressions for the Eagle H3 native dynamic loop.

The sampler, decoder and output branches are deliberately tiny CPU-only test
nodes.  Start, interactive Review Gate, dynamic End, state persistence,
ComfyUI scheduling, caching and GraphBuilder expansion are the production
implementations.
"""

from collections import deque
import importlib.util
import json
import os
import pathlib
import shutil
import sys
import tempfile
import threading
import unittest

import torch


REPO = pathlib.Path(__file__).resolve().parents[1]
COMFY_ROOT = os.environ.get("COMFYUI_ROOT")
if COMFY_ROOT:
    sys.path.insert(0, str(pathlib.Path(COMFY_ROOT).expanduser()))

PACKAGE_NAME = "eagle_suite_native_executor_test_package"
if PACKAGE_NAME not in sys.modules:
    SPEC = importlib.util.spec_from_file_location(
        PACKAGE_NAME,
        REPO / "__init__.py",
        submodule_search_locations=[str(REPO)],
    )
    PACKAGE = importlib.util.module_from_spec(SPEC)
    sys.modules[SPEC.name] = PACKAGE
    SPEC.loader.exec_module(PACKAGE)

from execution import PromptExecutor
import nodes as comfy_nodes

from eagle_suite_native_executor_test_package.eagle_suite.h3_pipeline import nodes as h3_nodes
from eagle_suite_native_executor_test_package.eagle_suite.h3_pipeline import review_runtime


def _four_scene_plan():
    shots = []
    for index in range(4):
        shots.append({
            "index": index + 1,
            "id": f"executor_scene_{index + 1:02d}",
            "scene_prompt": f"executor scene {index + 1}",
            "prompt": f"prefix\n\nexecutor scene {index + 1}",
            "prompt_hash": f"executor-hash-{index + 1}",
            "seed": 1000 + index,
            "steps": 4,
            "raw_frames": 22,
            "delivered_frames": 17,
            "generation_start_frame": index * 17,
            "audio_start_seconds": round(index * 17 / 24.0, 6),
            "audio_duration_seconds": round(17 / 24.0, 6),
        })
    return {
        "version": 2,
        "run_name": "test_run",
        "prompt_prefix": "prefix",
        "shots": shots,
        "compatibility": {
            "fps": 24,
            "width": 64,
            "height": 64,
            "context_length": 5,
            "encode_mode": "video",
            "anchor_mode": "head",
            "crop": "disabled",
            "audio_mode": "generated_audio",
            "audio_context_length": 5,
            "segment_crf": 18,
            "video_blend_frames": 0,
            "generation_fingerprint": "executor-test-v1",
        },
        "segment_crf": 18,
        "total_delivered_frames": 68,
        "reference_media": [],
        "plan_hash": "executor-four-scenes",
        "summary": "4 clips",
    }


class _FakeServer:
    client_id = None
    last_node_id = None
    sockets_metadata = {}

    def __init__(self):
        self.messages = []

    def send_sync(self, event, data, client_id=None):
        self.messages.append((event, data, client_id))


class H3NativePromptExecutorTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = pathlib.Path(tempfile.mkdtemp(prefix="h3_native_executor_"))
        self.sampler_calls = []
        self.saver_calls = []
        self.preview_calls = []
        self.review_submissions = []
        self.review_timers = []
        self.original_open_review = h3_nodes.open_review

        sampler_calls = self.sampler_calls
        saver_calls = self.saver_calls
        preview_calls = self.preview_calls

        class CpuSamplerStage:
            @classmethod
            def INPUT_TYPES(cls):
                return {"required": {
                    "state": (h3_nodes.H3_RUN_STATE,),
                    "stage": ("INT", {"default": 1}),
                }}

            RETURN_TYPES = (h3_nodes.H3_RUN_STATE, "IMAGE", "LATENT", "VIDEO")
            RETURN_NAMES = ("state", "images", "latent", "video")
            FUNCTION = "execute"

            def execute(self, state, stage):
                scene = int(state["current_index"])
                sampler_calls.append((int(stage), scene))
                images = torch.full(
                    (6, 2, 2, 3), float(scene) / 10.0, dtype=torch.float32
                )
                latent = {"samples": [
                    torch.full((1, 16, 2, 1, 1), float(scene)),
                    torch.full((1, 32, 2, 4), float(scene)),
                ]}
                if int(stage) != 3:
                    return (state, images, latent, None)

                # The final CPU stage stands in for a real checkpoint: a
                # decodable, correctly sized take is required before a run may
                # claim that its manifest is complete. Retry writes a distinct
                # revision, just as the production segment saver does.
                revision = sum(
                    1 for prior_stage, prior_scene in sampler_calls
                    if prior_stage == 3 and prior_scene == scene
                )
                shot_dir = pathlib.Path(state["base_dir"]) / "shots" / f"shot_{scene + 1:02d}"
                shot_dir.mkdir(parents=True, exist_ok=True)
                clip_path = shot_dir / f"cpu_take_{revision:04d}.mp4"
                frames = h3_nodes.np.full(
                    (17, 64, 64, 3), min(255, scene * 40 + revision * 15), dtype=h3_nodes.np.uint8
                )
                h3_nodes.frames_to_video(frames, str(clip_path), fps=24)
                h3_nodes.record_shot_result(
                    state, str(clip_path), delivered_frames=17,
                    decision="approved", meta={"fps": 24},
                )
                return (state, images, latent, h3_nodes.native_video(str(clip_path)))

        class CpuSaver:
            @classmethod
            def INPUT_TYPES(cls):
                return {"required": {
                    "state": (h3_nodes.H3_RUN_STATE,),
                    "images": ("IMAGE",),
                }}

            RETURN_TYPES = ()
            FUNCTION = "execute"
            OUTPUT_NODE = True

            def execute(self, state, images):
                del images
                saver_calls.append(int(state["current_index"]))
                return ()

        class CpuPreview:
            @classmethod
            def INPUT_TYPES(cls):
                return {"required": {
                    "state": (h3_nodes.H3_RUN_STATE,),
                    "images": ("IMAGE",),
                }}

            RETURN_TYPES = ()
            FUNCTION = "execute"
            OUTPUT_NODE = True

            def execute(self, state, images):
                del images
                preview_calls.append(int(state["current_index"]))
                return ()

        self.mapping_updates = {
            "EagleH3NativeLoopStartNode": h3_nodes.EagleH3NativeLoopStartNode,
            "EagleH3ReviewGateNode": h3_nodes.EagleH3ReviewGateNode,
            "EagleH3NativeLoopEndNode": h3_nodes.EagleH3NativeLoopEndNode,
            "EagleH3CheckpointReviewNode": h3_nodes.EagleH3CheckpointReviewNode,
            "EagleTestCpuSamplerStage": CpuSamplerStage,
            "EagleTestCpuSaver": CpuSaver,
            "EagleTestCpuPreview": CpuPreview,
        }
        self.previous_mappings = {
            name: comfy_nodes.NODE_CLASS_MAPPINGS.get(name)
            for name in self.mapping_updates
        }
        comfy_nodes.NODE_CLASS_MAPPINGS.update(self.mapping_updates)

    def tearDown(self):
        h3_nodes.open_review = self.original_open_review
        for timer in self.review_timers:
            timer.join(timeout=1.0)
        for name, previous in self.previous_mappings.items():
            if previous is None:
                comfy_nodes.NODE_CLASS_MAPPINGS.pop(name, None)
            else:
                comfy_nodes.NODE_CLASS_MAPPINGS[name] = previous
        self.assertEqual(0, review_runtime.pending_count())
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _install_review_decisions(self, decisions):
        remaining = deque(decisions)

        def open_and_submit(node_id=None, run_name=None):
            token, future = self.original_open_review(node_id, run_name)
            if not remaining:
                raise AssertionError("unexpected extra H3 review request")
            decision = remaining.popleft()
            record = {
                "token": token,
                "run_name": str(run_name or ""),
                "node_id": str(node_id or ""),
                "decision": decision,
                "resolved": None,
            }
            self.review_submissions.append(record)

            def submit():
                record["resolved"] = review_runtime.resolve_review(token, {
                    "decision": decision,
                    "run_name": str(run_name or ""),
                })

            timer = threading.Timer(0.01, submit)
            timer.daemon = True
            self.review_timers.append(timer)
            timer.start()
            return token, future

        h3_nodes.open_review = open_and_submit
        return remaining

    def _prompt(self, mode):
        return {
            "start": {"class_type": "EagleH3NativeLoopStartNode", "inputs": {
                "plan": _four_scene_plan(),
                "start_index": 1,
                "run_name_override": "",
                "output_dir": str(self.tmpdir),
                "resume_policy": "overwrite",
                "mode": mode,
                "max_shots": 0,
            }},
            # Three serial CPU stages emulate a base sample + second sample/refine
            # + decoder/upscale stage without loading any model weights.
            "sample_base": {"class_type": "EagleTestCpuSamplerStage", "inputs": {
                "state": ["start", 1], "stage": 1,
            }},
            "sample_refine": {"class_type": "EagleTestCpuSamplerStage", "inputs": {
                "state": ["sample_base", 0], "stage": 2,
            }},
            "sample_decode": {"class_type": "EagleTestCpuSamplerStage", "inputs": {
                "state": ["sample_refine", 0], "stage": 3,
            }},
            "review": {"class_type": "EagleH3ReviewGateNode", "inputs": {
                "run_state": ["sample_decode", 0],
                "preview_clip": ["sample_decode", 3],
                # Hard upper bound for a failed test reviewer: never wait forever.
                "auto_continue_timeout_minutes": 0.01,
            }},
            "end": {"class_type": "EagleH3NativeLoopEndNode", "inputs": {
                "flow": ["start", 0],
                "state": ["review", 0],
                "images": ["sample_decode", 1],
                "sampled_latent": ["sample_decode", 2],
                "decision": ["review", 1],
                "auto_assemble": False,
            }},
            "save": {"class_type": "EagleTestCpuSaver", "inputs": {
                "state": ["review", 0], "images": ["sample_decode", 1],
            }},
            "preview": {"class_type": "EagleTestCpuPreview", "inputs": {
                "state": ["review", 0], "images": ["sample_decode", 1],
            }},
            # This second review-style OUTPUT_NODE is intentionally read-only.
            # It must be cloned as a UI history side branch without persisting,
            # waiting, deciding, or duplicating the main Review Gate.
            "history": {"class_type": "EagleH3CheckpointReviewNode", "inputs": {
                "state": ["review", 0],
                "video": ["sample_decode", 3],
                "read_only": True,
            }},
        }

    def _run(self, mode, decisions=()):
        remaining = None
        if mode == "interactive":
            remaining = self._install_review_decisions(decisions)

        server = _FakeServer()
        executor = PromptExecutor(
            server,
            cache_type=False,
            cache_args={"ram": 0.0, "ram_inactive": 0.0},
        )
        executor.execute(
            self._prompt(mode),
            f"h3-native-executor-{mode}-{'-'.join(decisions) or 'auto'}",
            execute_outputs=["end", "save", "preview", "history"],
        )

        for timer in self.review_timers:
            timer.join(timeout=1.0)
        errors = [
            data for event, data in executor.status_messages
            if event == "execution_error"
        ]
        self.assertFalse(errors, errors)
        self.assertTrue(executor.success)
        self.assertTrue(any(
            event == "execution_success" for event, _data in executor.status_messages
        ))
        if remaining is not None:
            self.assertEqual([], list(remaining))
            self.assertTrue(all(item["resolved"] is True for item in self.review_submissions))
        self.assertEqual(0, review_runtime.pending_count())

        manifest_path = self.tmpdir / "h3_eagle_chains" / "test_run" / "manifest.json"
        self.assertTrue(manifest_path.is_file())
        with manifest_path.open("r", encoding="utf-8") as handle:
            manifest = json.load(handle)
        return executor, manifest

    def _assert_branch_counts(self, expected_scenes):
        self.assertEqual(list(expected_scenes), sorted(self.saver_calls))
        self.assertEqual(list(expected_scenes), sorted(self.preview_calls))

    def test_auto_four_scenes_runs_multistage_and_read_only_branches(self):
        executor, manifest = self._run("auto")

        self.assertEqual(
            [(stage, scene) for scene in range(4) for stage in (1, 2, 3)],
            self.sampler_calls,
        )
        self._assert_branch_counts(range(4))
        self.assertEqual(4, manifest["current_index"])
        self.assertEqual(4, manifest["total_shots"])
        self.assertEqual("complete", manifest["manifest_status"])
        self.assertEqual([], self.review_submissions)
        self.assertTrue(any(
            item.get("done") and item.get("next_index") == 4
            for output in executor.history_result["outputs"].values()
            for item in output.get("h3_native_loop", [])
        ))

    def test_interactive_approve_continues_all_four_scenes(self):
        _executor, manifest = self._run(
            "interactive", ("approve", "approve", "approve", "approve")
        )

        self.assertEqual(
            [(stage, scene) for scene in range(4) for stage in (1, 2, 3)],
            self.sampler_calls,
        )
        self._assert_branch_counts(range(4))
        self.assertEqual(4, len(self.review_submissions))
        self.assertEqual(4, manifest["current_index"])
        self.assertEqual("complete", manifest["manifest_status"])

    def test_interactive_retry_repeats_scene_then_continues(self):
        _executor, manifest = self._run(
            "interactive",
            ("retry", "approve", "approve", "approve", "approve"),
        )

        self.assertEqual(
            [(stage, scene) for scene in (0, 0, 1, 2, 3) for stage in (1, 2, 3)],
            self.sampler_calls,
        )
        self.assertEqual([0, 0, 1, 2, 3], sorted(self.saver_calls))
        self.assertEqual([0, 0, 1, 2, 3], sorted(self.preview_calls))
        self.assertEqual(5, len(self.review_submissions))
        self.assertEqual(4, manifest["current_index"])
        self.assertEqual("complete", manifest["manifest_status"])

    def test_interactive_stop_rejects_unapproved_current_take(self):
        _executor, manifest = self._run("interactive", ("approve", "stop"))

        self.assertEqual(
            [(stage, scene) for scene in (0, 1) for stage in (1, 2, 3)],
            self.sampler_calls,
        )
        self._assert_branch_counts((0, 1))
        self.assertEqual(2, len(self.review_submissions))
        self.assertEqual(1, manifest["current_index"])
        self.assertTrue(manifest["stop"])
        self.assertEqual("incomplete", manifest["manifest_status"])

    def test_interactive_approve_stop_finishes_valid_partial_without_next_scene(self):
        _executor, manifest = self._run("interactive", ("approve", "approve_stop"))

        self.assertEqual(
            [(stage, scene) for scene in (0, 1) for stage in (1, 2, 3)],
            self.sampler_calls,
        )
        self._assert_branch_counts((0, 1))
        self.assertEqual(2, len(self.review_submissions))
        self.assertEqual(1, manifest["current_index"])
        self.assertTrue(manifest["stop"])
        self.assertEqual("partial", manifest["manifest_status"])


if __name__ == "__main__":
    unittest.main()
