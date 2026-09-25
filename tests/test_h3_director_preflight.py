"""Director preflight contracts for multi-scene authoring and workload notices."""

import importlib.util
import os
import pathlib
import sys
import unittest


REPO = pathlib.Path(__file__).resolve().parents[1]
COMFY_ROOT = os.environ.get("COMFYUI_ROOT")
if COMFY_ROOT:
    sys.path.insert(0, str(pathlib.Path(COMFY_ROOT).expanduser()))
SPEC = importlib.util.spec_from_file_location(
    "eagle_suite_test_package",
    REPO / "__init__.py",
    submodule_search_locations=[str(REPO)],
)
PACKAGE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PACKAGE
SPEC.loader.exec_module(PACKAGE)

from eagle_suite_test_package.eagle_suite.h3_director_node import (
    EagleH3DirectorNode,
    _attach_connected_stage_preflight,
    _build_plan_preflight,
    _connected_stage_workload,
)


def valid_shot(index):
    return {
        "id": f"scene_{index:02d}",
        "prompt": (
            "integrated_multimodal_description:\n镜头内容\n"
            "overall_soundscape:\n环境声\n"
            "non_diegetic_music:\n无"
        ),
        "raw_frames": 192,
        "delivered_frames": 168,
        "generation_start_frame": (index - 1) * 168,
        "duration_seconds": 7,
    }


class DirectorPreflightTests(unittest.TestCase):
    def setUp(self):
        self.plan = {
            "shots": [valid_shot(1), valid_shot(2)],
            "compatibility": {"width": 960, "height": 544},
            "reference_media": [],
        }
        self.project = {
            "mode": "t2v",
            "referencePolicy": "off",
            "workflowType": "character_interaction",
            "interaction": {"outputMode": "single_loop"},
        }

    def test_multi_scene_single_loop_warns_about_continuity(self):
        report = _build_plan_preflight(self.project, self.plan)
        self.assertTrue(report["ok"], report)
        self.assertTrue(any("H3-W202" in warning for warning in report["warnings"]))

    def test_continuous_chain_has_no_mode_conflict_warning(self):
        self.project["interaction"]["outputMode"] = "continuous_chain"
        report = _build_plan_preflight(self.project, self.plan)
        self.assertFalse(any("H3-W202" in warning for warning in report["warnings"]))

    def test_workload_notice_does_not_mislabel_base_as_peak(self):
        report = _build_plan_preflight(self.project, self.plan)
        warning = next(item for item in report["warnings"] if "H3-W201" in item)
        self.assertIn("首次采样工作量", warning)
        self.assertIn("未计入", warning)
        self.assertIn("RTX", warning)

    def test_connected_workflow_reports_dual_sampler_and_upscales(self):
        self.plan["preflight"] = _build_plan_preflight(self.project, self.plan)
        prompt = {
            "34": {"class_type": "EagleH3DirectorNode", "inputs": {}},
            "36": {"class_type": "EagleH3NativeLoopStartNode",
                   "inputs": {"plan": ["34", 0]}},
            "45": {"class_type": "SamplerCustomAdvanced",
                   "inputs": {"latent_image": ["36", 0]}},
            "84": {"class_type": "MinimaxH3LatentUpscaler3D",
                   "inputs": {"samples": ["45", 0], "mode.scale": 2}},
            "47": {"class_type": "SamplerCustomAdvanced",
                   "inputs": {"latent_image": ["84", 0]}},
            "77": {"class_type": "RTXVideoSuperResolution",
                   "inputs": {"images": ["47", 0], "resize_type.scale": 1.5}},
            "51": {"class_type": "RTXVideoSuperResolution",
                   "inputs": {"resize_type.scale": 8}},
        }
        estimate = _connected_stage_workload(prompt, "34", self.plan)
        self.assertEqual(estimate["sampler_count"], 2)
        self.assertEqual([(stage["width"], stage["height"])
                          for stage in estimate["stages"]],
                         [(960, 544), (1920, 1088), (2880, 1632)])
        _attach_connected_stage_preflight(self.plan, prompt, "34")
        report = self.plan["preflight"]
        self.assertTrue(any("H3-W203" in item for item in report["warnings"]))
        self.assertEqual(report["connected_stage_workload"]["sampler_count"], 2)

    def test_hidden_prompt_is_read_only_optional_input(self):
        hidden = EagleH3DirectorNode.INPUT_TYPES()["hidden"]
        self.assertEqual(hidden["prompt"], "PROMPT")
        self.assertIsNone(_connected_stage_workload(None, "34", self.plan))


if __name__ == "__main__":
    unittest.main()
