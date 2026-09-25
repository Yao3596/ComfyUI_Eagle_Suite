"""Contract checks for both restored, standalone Svelte backend nodes."""

import importlib.util
import json
from pathlib import Path
import unittest


REPO = Path(__file__).resolve().parents[1]


def load_module(name):
    path = REPO / "eagle_suite" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SvelteBackendContracts(unittest.TestCase):
    def test_interaction_node_keeps_state_and_output_types(self):
        module = load_module("svelte_character_interaction")
        node = module.EagleSvelteCharacterInteractionNode()
        self.assertEqual(("STRING", "STRING", "INT", "STRING"), node.RETURN_TYPES)
        self.assertEqual(("interaction_state",), tuple(node.INPUT_TYPES()["required"]))
        config, prompt, duration, level = node.execute(json.dumps({
            "productionLevel": "SSR",
            "durationSeconds": 5,
            "outputMode": "single_loop",
        }))
        self.assertEqual("SSR", level)
        self.assertEqual(5, duration)
        self.assertEqual("single_loop", json.loads(config)["outputMode"])
        self.assertIn("首尾姿态", prompt)

    def test_pv_node_preserves_clean_plate_post_boundary(self):
        module = load_module("svelte_character_pv")
        node = module.EagleSvelteCharacterPVNode()
        self.assertEqual(("STRING", "STRING", "STRING", "INT", "STRING"), node.RETURN_TYPES)
        self.assertEqual(("pv_state",), tuple(node.INPUT_TYPES()["required"]))
        patch, prompt, post, duration, level = node.execute(json.dumps({
            "title": "ARIA", "durationSeconds": 15, "productionLevel": "UR",
        }))
        self.assertEqual(15, duration)
        self.assertEqual("UR", level)
        self.assertEqual("character_pv", json.loads(patch)["workflowType"])
        self.assertEqual("post_production", json.loads(post)["text_overlays"][0]["stage"])
        self.assertIn("Do not draw readable titles", prompt)


if __name__ == "__main__":
    unittest.main()
