# -*- coding: utf-8 -*-
"""Standalone async regression tests for H3 pending-review recovery.

Run directly with ComfyUI's embedded Python.  The module is loaded by file path
so importing this test never imports ComfyUI or the Eagle Suite package root.
"""

from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_PATH = ROOT / "eagle_suite" / "h3_pipeline" / "review_runtime.py"
SPEC = importlib.util.spec_from_file_location("standalone_h3_review_runtime", RUNTIME_PATH)
assert SPEC and SPEC.loader
RUNTIME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME)


class PendingReviewRecoveryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tokens = []

    def open(self, node_id, run_name):
        token, future = RUNTIME.open_review(node_id, run_name=run_name)
        self.tokens.append(token)
        return token, future

    def tearDown(self):
        for token in self.tokens:
            RUNTIME.close_review(token)

    async def test_exact_run_and_display_node_recovers_only_its_token(self):
        token_a, _ = self.open("29.0.0.86", "run-a")
        token_b, _ = self.open("30.0.0.86", "run-b")
        self.assertTrue(RUNTIME.publish_review(token_a, {
            "run_name": "run-a",
            "node_id": "29.0.0.86",
            "awaiting_review": True,
        }))
        self.assertTrue(RUNTIME.publish_review(token_b, {
            "run_name": "run-b",
            "node_id": "30.0.0.86",
            "awaiting_review": True,
        }))

        status, payload = RUNTIME.lookup_pending_review("run-a", "86")
        self.assertEqual(status, "ok")
        self.assertEqual(payload["token"], token_a)
        self.assertEqual(payload["node_id"], "29.0.0.86")
        self.assertEqual(RUNTIME.lookup_pending_review("run-a", "28"), ("not_found", None))
        self.assertEqual(RUNTIME.lookup_pending_review("run-missing", "86"), ("not_found", None))
        self.assertEqual(RUNTIME.lookup_pending_review("run-b", "86")[1]["token"], token_b)

    async def test_wrong_run_does_not_resolve_or_wake_future(self):
        token, future = self.open("29.0.0.86", "run-a")
        self.assertTrue(RUNTIME.publish_review(token, {
            "run_name": "run-a",
            "node_id": "29.0.0.86",
        }))
        self.assertFalse(RUNTIME.resolve_review(token, {
            "run_name": "run-b",
            "decision": "approve",
        }))
        await asyncio.sleep(0)
        self.assertFalse(future.done())
        self.assertEqual(RUNTIME.lookup_pending_review("run-a", "86")[0], "ok")

    async def test_ambiguous_same_run_and_display_node_is_refused(self):
        token_a, _ = self.open("29.0.0.86", "run-a")
        token_b, _ = self.open("31.0.0.86", "run-a")
        for token, node_id in ((token_a, "29.0.0.86"), (token_b, "31.0.0.86")):
            self.assertTrue(RUNTIME.publish_review(token, {
                "run_name": "run-a",
                "node_id": node_id,
            }))
        self.assertEqual(RUNTIME.lookup_pending_review("run-a", "86"), ("ambiguous", None))

    async def test_resolved_and_closed_reviews_disappear(self):
        token, future = self.open("29.0.0.86", "run-a")
        self.assertTrue(RUNTIME.publish_review(token, {
            "run_name": "run-a",
            "node_id": "29.0.0.86",
        }))
        self.assertTrue(RUNTIME.resolve_review(token, {
            "run_name": "run-a",
            "decision": "approve",
        }))
        self.assertEqual((await future)["decision"], "approve")
        self.assertEqual(RUNTIME.lookup_pending_review("run-a", "86"), ("not_found", None))
        RUNTIME.close_review(token)
        self.assertEqual(RUNTIME.lookup_pending_review("run-a", "86"), ("not_found", None))

        token_closed, future_closed = self.open("40.0.0.86", "run-closed")
        RUNTIME.close_review(token_closed)
        await asyncio.sleep(0)
        self.assertTrue(future_closed.cancelled())
        self.assertEqual(
            RUNTIME.lookup_pending_review("run-closed", "86"),
            ("not_found", None),
        )

    async def test_decision_filename_is_path_safe_for_untrusted_token(self):
        filename = RUNTIME.review_decision_filename("../../outside\\evil:token")
        self.assertRegex(filename, r"^review_decision_[0-9a-f]{64}\.json$")
        self.assertEqual(Path(filename).name, filename)
        self.assertNotIn("..", filename)
        with self.assertRaises(ValueError):
            RUNTIME.review_decision_filename("")

        routes_source = (
            ROOT / "eagle_suite" / "h3_pipeline" / "routes.py"
        ).read_text(encoding="utf-8")
        self.assertIn("review_file = run_path / decision_filename", routes_source)
        self.assertNotIn('f"review_decision_{token', routes_source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
