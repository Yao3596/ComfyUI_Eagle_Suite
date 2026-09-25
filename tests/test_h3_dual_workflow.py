"""Topology regressions for the non-destructive H3 dual-loop migrator."""

from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "repair_h3_dual_loop_workflow.py"
BASELINE = Path(os.environ.get(
    "EAGLE_H3_BASELINE_WORKFLOW",
    ROOT / "tests" / "fixtures" / "eagle_h3_full.json",
))
SPEC = importlib.util.spec_from_file_location("repair_h3_dual_loop_workflow", SCRIPT)
repair = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(repair)


def node(workflow, node_id):
    return next(item for item in workflow["nodes"] if int(item["id"]) == node_id)


def by_type(workflow, node_type):
    return [item for item in workflow["nodes"] if item["type"] == node_type]


def input_link(workflow, node_id, input_name):
    target = node(workflow, node_id)
    input_ = next(item for item in target["inputs"] if item["name"] == input_name)
    return next((row for row in workflow["links"] if row[0] == input_.get("link")), None)


def assert_link(test, workflow, source_id, output_slot, target_id, input_name):
    row = input_link(workflow, target_id, input_name)
    test.assertIsNotNone(row, f"{target_id}.{input_name} is disconnected")
    test.assertEqual(tuple(row[1:5]), (source_id, output_slot, target_id,
                                      next(i for i, value in enumerate(node(workflow, target_id)["inputs"])
                                           if value["name"] == input_name)))


def ancestors(workflow, target_id):
    incoming = {}
    for row in workflow["links"]:
        incoming.setdefault(int(row[3]), set()).add(int(row[1]))
    seen = set()
    stack = [target_id]
    while stack:
        current = stack.pop()
        for parent in incoming.get(current, ()):
            if parent not in seen:
                seen.add(parent)
                stack.append(parent)
    return seen


def set_widget(workflow, node_id, name, value):
    current = node(workflow, node_id)
    names = [
        item["widget"]["name"] for item in current["inputs"]
        if isinstance(item.get("widget"), dict)
    ]
    current["widgets_values"][names.index(name)] = value


@unittest.skipUnless(BASELINE.is_file(), "authored Eagle H3 baseline is not installed")
class DualLoopWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = json.loads(BASELINE.read_text(encoding="utf-8"))

    def repaired(self):
        return repair.repair_workflow(self.original)[0]

    def test_preserves_every_authored_node_and_complex_widgets(self):
        repaired = self.repaired()
        before = {int(item["id"]): item for item in self.original["nodes"]}
        after = {int(item["id"]): item for item in repaired["nodes"]}
        self.assertTrue(set(before).issubset(after))
        for node_id, old in before.items():
            if node_id in (28, 29, 33, 86):
                continue
            self.assertEqual(after[node_id].get("widgets_values"), old.get("widgets_values"))
            self.assertEqual(after[node_id].get("mode"), old.get("mode"))
        # Director scene/API snapshots and SolAttn/RTX/user acceleration values are opaque data.
        for node_id in (34, 35, 36, 38, 44, 46, 77, 84):
            self.assertEqual(after[node_id].get("widgets_values"), before[node_id].get("widgets_values"))
        start = after[33]
        start_widget_names = [
            value["widget"]["name"] for value in start["inputs"]
            if isinstance(value.get("widget"), dict)
        ]
        start_values = dict(zip(start_widget_names, start["widgets_values"]))
        self.assertEqual(start_values["run_name_override"], "eagle_h3_dual_loop_v2")
        self.assertEqual(start_values["resume_policy"], "resume")

    def test_refined_dual_sampler_is_the_delivery_and_loop_source(self):
        repaired = self.repaired()
        adapter = by_type(repaired, "EagleH3RefineHandoffNode")[0]
        guider = next(item for item in repaired["nodes"] if item.get("title") == "H3 二采 Guider（适配画布）")
        assert_link(self, repaired, 45, 1, 48, "av_latent")
        assert_link(self, repaired, 31, 0, adapter["id"], "positive")
        assert_link(self, repaired, 49, 0, adapter["id"], "latent")
        assert_link(self, repaired, 3, 0, adapter["id"], "vae")
        assert_link(self, repaired, 45, 0, adapter["id"], "source_latent")
        assert_link(self, repaired, 42, 0, guider["id"], "model")
        assert_link(self, repaired, adapter["id"], 0, guider["id"], "conditioning")
        assert_link(self, repaired, guider["id"], 0, 47, "guider")
        assert_link(self, repaired, adapter["id"], 1, 47, "latent_image")
        self.assertIsNone(next(value for value in node(repaired, 46)["inputs"] if value["name"] == "step")["link"])
        self.assertEqual(node(repaired, 46)["widgets_values"], node(self.original, 46)["widgets_values"])

        assert_link(self, repaired, 47, 0, 52, "samples")
        assert_link(self, repaired, 47, 0, 78, "samples")
        assert_link(self, repaired, 52, 0, 30, "images")
        assert_link(self, repaired, 78, 0, 30, "audio")
        assert_link(self, repaired, 30, 0, 77, "images")
        for target, name in ((86, "images"), (29, "images"), (80, "images")):
            assert_link(self, repaired, 77, 0, target, name)
        for target in (86, 29):
            assert_link(self, repaired, 47, 0, target, "sampled_latent")
        assert_link(self, repaired, 30, 1, 86, "audio")
        assert_link(self, repaired, 30, 1, 80, "audio")
        assert_link(self, repaired, 33, 4, 80, "fps")

        main = ancestors(repaired, 29)
        self.assertTrue({31, 41, 45, 48, 84, 49, adapter["id"], guider["id"],
                         47, 52, 78, 30, 77, 86}.issubset(main))
        self.assertNotIn(51, main)
        self.assertEqual(node(repaired, 51)["mode"], 0)
        self.assertIn("单采对照", node(repaired, 51)["title"])

    def test_svelte_review_is_only_writer_and_legacy_panel_is_read_only(self):
        repaired = self.repaired()
        assert_link(self, repaired, 86, 1, 28, "state")
        assert_link(self, repaired, 86, 0, 28, "video")
        for name in ("images", "audio", "images_with_overlap", "sampled_latent"):
            self.assertIsNone(next(value for value in node(repaired, 28)["inputs"] if value["name"] == name)["link"])
        self.assertEqual(node(repaired, 28)["title"], "H3 历史回看（只读，不重复保存）")
        for node_id, expected in ((28, True), (86, False)):
            current = node(repaired, node_id)
            self.assertIn("read_only", [value["name"] for value in current["inputs"]])
            widget_names = [
                value["widget"]["name"] for value in current["inputs"]
                if isinstance(value.get("widget"), dict)
            ]
            self.assertEqual(current["widgets_values"][widget_names.index("read_only")], expected)
        workspace_names = [value["name"] for value in node(repaired, 86)["inputs"]]
        self.assertLess(workspace_names.index("workspace_state"), workspace_names.index("read_only"))
        original_workspace = node(self.original, 86)["widgets_values"][10]
        self.assertEqual(node(repaired, 86)["widgets_values"][10], original_workspace)
        assert_link(self, repaired, 86, 1, 29, "state")
        assert_link(self, repaired, 86, 2, 29, "decision")

    def test_repairs_legacy_defaults_and_all_link_contracts(self):
        repaired = self.repaired()
        end = node(repaired, 29)
        end_names = [
            value["widget"]["name"] for value in end["inputs"]
            if isinstance(value.get("widget"), dict)
        ]
        end_values = dict(zip(end_names, end["widgets_values"]))
        self.assertEqual(end_values["fps_override"], 0)
        self.assertEqual(end_values["local_save_path"], "")
        self.assertEqual(end_values["eagle_folder"], "")
        self.assertIs(end_values["auto_assemble"], True)
        self.assertEqual(repair.validate_links(repaired), [])
        self.assertEqual(next(row for row in repaired["links"] if row[0] == 19)[5], "MODEL")

    def test_transform_is_idempotent(self):
        first, _ = repair.repair_workflow(self.original)
        second, report = repair.repair_workflow(first)
        self.assertEqual(second, first)
        self.assertEqual(report["added_node_ids"], [])

    def test_preserves_valid_user_run_review_and_export_values(self):
        custom = deepcopy(self.original)
        set_widget(custom, 33, "run_name_override", "my_dual_run")
        set_widget(custom, 28, "review_decision", "approve")
        set_widget(custom, 28, "retry_prompt", "keep this authored retry")
        set_widget(custom, 28, "retry_seed", 1234)
        set_widget(custom, 29, "filename", "my_final")
        set_widget(custom, 29, "format", "mkv")
        set_widget(custom, 29, "fps_override", 48)
        set_widget(custom, 29, "local_save_path", r"X:\__eagle_test_only__\renders")
        set_widget(custom, 29, "eagle_folder", "PV/final")
        repaired, report = repair.repair_workflow(custom)
        self.assertEqual(report["run_name_override"], "my_dual_run")
        self.assertFalse(report["assigned_fresh_run_name"])
        for node_id, name, expected in (
            (28, "review_decision", "approve"),
            (28, "retry_prompt", "keep this authored retry"),
            (28, "retry_seed", 1234),
            (29, "filename", "my_final"), (29, "format", "mkv"),
            (29, "fps_override", 48),
            (29, "local_save_path", r"X:\__eagle_test_only__\renders"),
            (29, "eagle_folder", "PV/final"),
        ):
            current = node(repaired, node_id)
            names = [
                item["widget"]["name"] for item in current["inputs"]
                if isinstance(item.get("widget"), dict)
            ]
            self.assertEqual(current["widgets_values"][names.index(name)], expected)


if __name__ == "__main__":
    unittest.main()
