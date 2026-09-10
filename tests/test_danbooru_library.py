"""Offline tests: no ComfyUI startup, API calls or model loading."""
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location("library_under_test", pathlib.Path(__file__).resolve().parents[1] / "eagle_suite/danbooru_library.py")
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)


def tag(name="sitting", id=10, **extra):
    return {"id": id, "name": name, "category": 0, "post_count": 10000, "is_deprecated": False, **extra}


def draft(name="sitting", **extra):
    return {"name": name, "cn_name": "坐姿", "facets": ["pose.posture"], "confidence": .9,
            "rating": "safe", "note": "依据官方定义", **extra}


class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.lib = mod.Library(pathlib.Path(self.tmp.name) / "tags.sqlite3")
        self.lib.save_page("tags", [tag()], {"cursor": 10})

    def test_data_and_cursor_are_atomic(self):
        with self.assertRaises(ValueError):
            self.lib.save_page("tags", [tag("running", 9), tag("broken", 8, category=2)], {"cursor": 8})
        self.assertEqual(self.lib.checkpoint("tags"), {"cursor": 10})
        self.assertNotIn("running", self.lib.lookup(["running"]))

    def test_empty_legacy_checkpoint_is_recoverable(self):
        with self.lib.connect() as db:
            db.execute("INSERT OR REPLACE INTO checkpoints VALUES(?,?)", ("groups", ""))
        self.assertEqual({}, self.lib.checkpoint("groups"))
        self.assertEqual({}, self.lib.status()["checkpoints"]["groups"])

    def test_sync_resume_and_complete(self):
        client = Mock()
        client.get.side_effect = [[tag("walking", 9)], []]
        state = mod.sync(self.lib, client, pages=2)
        self.assertTrue(state["complete"])
        self.assertEqual(client.get.call_args_list[0].args[1]["page"], "b10")
        self.assertEqual(client.get.call_args_list[0].args[1]["search[hide_empty]"], "true")
        self.assertEqual(client.get.call_args_list[1].args[1]["page"], "b9")
        self.assertEqual(self.lib.status()["total"], 2)

    def test_bootstrap_resumes_stages_and_is_idempotent_after_completion(self):
        library = mod.Library(pathlib.Path(self.tmp.name) / "bootstrap.sqlite3")
        client = Mock()
        client.get.side_effect = [
            [{"id": 20, "title": "tag_group:posture", "body": "[[sitting]]"}], [],
            [tag("walking", 9)], [],
        ]
        states = mod.bootstrap(library, client)
        self.assertTrue(states["groups"]["complete"])
        self.assertTrue(states["tags"]["complete"])
        self.assertEqual(client.get.call_count, 4)

        complete_client = Mock()
        repeated = mod.bootstrap(library, complete_client)
        self.assertTrue(repeated["groups"]["skipped"])
        self.assertTrue(repeated["tags"]["skipped"])
        complete_client.get.assert_not_called()

    def test_repeated_cursor_stops(self):
        with self.assertRaises(ValueError):
            mod.sync(self.lib, Mock(get=Mock(return_value=[tag()])), pages=1)
        self.assertEqual(self.lib.checkpoint("tags"), {"cursor": 10})

    def test_group_filter_and_first_page_force_id_order(self):
        client = Mock(get=Mock(return_value=[{"id": 20, "title": "tag_group:posture", "body": "[[sitting]]"}]))
        mod.sync(self.lib, client, "groups", pages=1)
        params = client.get.call_args.args[1]
        self.assertEqual(params["search[title_like]"], "tag_group:*")
        self.assertEqual(params["page"], "b2147483647")
        self.assertEqual(self.lib.checkpoint("groups")["cursor"], 20)

    def test_ignored_group_filter_or_wrong_order_never_commits(self):
        for rows in [[{"id": 20, "title": "unrelated"}],
                     [{"id": 19, "title": "tag_group:a"}, {"id": 20, "title": "tag_group:b"}]]:
            with self.assertRaises(ValueError):
                mod.sync(self.lib, Mock(get=Mock(return_value=rows)), "groups", pages=1)
            self.assertFalse(self.lib.checkpoint("groups"))

    def test_pending_never_changes_search_or_sampling(self):
        self.lib.save_drafts([draft()], [tag()], "test-model")
        self.assertEqual(self.lib.search("sitting"), [])  # unknown safety
        self.assertEqual(self.lib.sample_pool(["pose.posture"]), [])
        self.lib.review("sitting", True)
        self.assertEqual(self.lib.search("坐姿")[0]["name"], "sitting")
        self.assertEqual(len(self.lib.sample_pool(["pose.posture"])), 1)

    def test_official_refresh_preserves_reviewed_annotation(self):
        self.lib.save_drafts([draft()], [tag()], "test-model")
        self.lib.review("sitting", True)
        self.lib.save_page("tags", [tag(post_count=20000)], {})
        item = self.lib.lookup(["sitting"])["sitting"]
        self.assertEqual(item["cn_name"], "坐姿")
        self.assertEqual(item["post_count"], 20000)

    def test_malformed_batch_is_not_partially_saved(self):
        for item in [draft(name="made_up"), draft(facets=["not_a_facet"]), draft(confidence=float("nan")), draft(rating="maybe")]:
            with self.assertRaises(ValueError):
                self.lib.save_drafts([item], [tag()], "test")
        self.assertEqual(self.lib.pending(), [])

    def test_multiple_facets_and_rejection(self):
        self.lib.save_drafts([draft(facets=["pose.posture", "action.object"])], [tag()], "test")
        self.lib.review("sitting", False)
        self.assertEqual(self.lib.pending(), [])
        self.assertEqual(self.lib.approved(), {})
        self.assertEqual(self.lib.candidates(), [])  # rejection isn't immediately retried

    def test_deprecated_never_sampled(self):
        self.lib.save_drafts([draft()], [tag()], "test")
        self.lib.review("sitting", True)
        self.lib.save_page("tags", [tag(is_deprecated=True)], {})
        self.assertEqual(self.lib.search("坐姿", show_nsfw=True), [])
        self.assertEqual(self.lib.sample_pool(["pose.posture"]), [])

    def test_empty_tags_never_appear_in_search(self):
        self.lib.save_page("tags", [tag("empty_tag", 9, post_count=0)], {})
        self.assertEqual(self.lib.search("empty_tag", show_nsfw=True), [])

    def test_wiki_groups_are_candidates_and_refresh_replaces_links(self):
        page = {"title": "tag_group:posture", "body": "[[sitting|坐]] [[tag_group:body]] [[sitting]]"}
        self.lib.save_page("groups", [page], {})
        self.assertEqual(self.lib.candidates()[0]["groups"], ["tag_group:posture"])
        self.assertEqual(self.lib.approved(), {})
        self.lib.save_page("groups", [{**page, "body": "[[standing]]"}], {})
        self.assertEqual(self.lib.candidates()[0]["groups"], [])

    def test_wiki_missing_is_cached_and_long_text_not_truncated(self):
        client = Mock(get=Mock(return_value=[{"id": 1, "title": "sitting", "body": "释义" * 6000}]))
        self.lib.fetch_candidate_wikis(client, 1)
        self.lib.fetch_candidate_wikis(client, 1)
        self.assertEqual(client.get.call_count, 1)
        _, prompt = mod.translation_prompt(self.lib.candidates(1))
        self.assertIn("释义" * 6000, prompt)

    def test_export_includes_pending_and_escapes_markdown(self):
        self.lib.save_drafts([draft(note="<script>|hello\nworld")], [tag()], "test")
        path = pathlib.Path(self.tmp.name) / "export.jsonl"
        self.lib.export(path)
        self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["status"], "pending")
        self.lib.review("sitting", True)
        self.lib.export(path)
        text = path.with_suffix(".md").read_text(encoding="utf-8")
        self.assertIn("&lt;script&gt;&#124;hello<br>world", text)

    def test_literal_search_wildcards(self):
        self.lib.save_page("tags", [tag("test_tag", 9), tag("testXtag", 8)], {})
        self.assertEqual([r["name"] for r in self.lib.search("test_tag", show_nsfw=True)], ["test_tag"])

    def test_semantic_catalog_is_bounded_and_prioritizes_enriched_rows(self):
        self.lib.save_page("tags", [
            tag("approved_cold", 9, post_count=5),
            tag("hot_english", 8, post_count=9000),
            tag("cold_english", 7, post_count=4),
        ], {})
        row = tag("approved_cold", 9, post_count=5)
        self.lib.save_drafts([draft(name="approved_cold", cn_name="已审核冷门词")], [row], "test")
        self.lib.review("approved_cold", True)

        names = [item["name"] for item in self.lib.semantic_catalog(limit=1000, min_count=5000)]
        self.assertIn("approved_cold", names)
        self.assertIn("hot_english", names)
        self.assertNotIn("cold_english", names)
        self.assertEqual(self.lib.translation_map()["approved_cold"], "已审核冷门词")
        self.assertGreaterEqual(self.lib.semantic_revision()["approved"], 1)


class NetworkPolicyTests(unittest.TestCase):
    def client(self, responses):
        session = Mock()
        session.get.side_effect = responses
        event = Mock(wait=Mock(return_value=False))
        return mod.PoliteClient(session, event), session, event

    def response(self, code=200, headers=None, data=None):
        return Mock(status_code=code, headers=headers or {"Content-Type": "application/json"}, json=Mock(return_value=[] if data is None else data))

    def test_429_obeys_retry_after(self):
        client, session, event = self.client([self.response(429, {"Retry-After": "17"}), self.response()])
        self.assertEqual(client.get("/tags.json", {}), [])
        self.assertIn(unittest.mock.call(17.0), event.wait.call_args_list)
        self.assertEqual(session.get.call_count, 2)

    def test_denial_and_html_stop_without_bypass(self):
        for response in [self.response(403), self.response(302), self.response(200, {"Content-Type": "text/html"})]:
            client, session, _ = self.client([response])
            with self.assertRaises(RuntimeError):
                client.get("/tags.json", {})
            self.assertEqual(session.get.call_count, 1)

    def test_stop_interrupts_before_request(self):
        client, session, event = self.client([])
        event.wait.return_value = True
        with self.assertRaises(InterruptedError):
            client.get("/tags.json", {})
        session.get.assert_not_called()

    def test_configured_base_url_and_periodic_long_pause(self):
        session = Mock()
        session.get.side_effect = [self.response(), self.response()]
        event = Mock(wait=Mock(return_value=False))
        client = mod.PoliteClient(
            session, event, interval=2, jitter=0,
            pause_every=1, pause_seconds=7,
            base_url="https://metadata.example.test/",
        )
        with patch.object(mod.random, "uniform", return_value=0):
            client.get("/tags.json", {})
            client.get("/tags.json", {})
        self.assertEqual(session.get.call_args_list[0].args[0], "https://metadata.example.test/tags.json")
        self.assertIn(unittest.mock.call(7.0), event.wait.call_args_list)


if __name__ == "__main__":
    unittest.main()
