import importlib.util
import asyncio
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

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


class RegressionTests(unittest.TestCase):
    def test_eagle_gallery_first_run_restores_mode_and_sequence_index(self):
        from PIL import Image
        from eagle_suite_test_package.eagle_suite import eagle_gallery

        selection_data = json.dumps({
            "selections": [
                {"id": "first", "filePath": "first.png", "tags": ["first"]},
                {"id": "second", "filePath": "second.png", "tags": ["second"]},
            ],
            "output_mode": "rgba",
            "sequence_index": 1,
        })
        with mock.patch.object(eagle_gallery, "_get_cached_selection", return_value={}), \
             mock.patch.object(eagle_gallery, "_selection_cache", {}), \
             mock.patch.object(
                 eagle_gallery, "_resolve_image_path",
                 side_effect=lambda selection: (Image.new("RGBA", (2, 2)), selection["id"]),
             ):
            images, tags, restored, next_index = eagle_gallery.EagleGalleryNode().load_images(
                selection_data=selection_data, node_id="restore-test"
            )

        self.assertEqual(4, images[0].shape[-1])
        self.assertEqual("second", tags[0])
        self.assertEqual(0, next_index)
        self.assertEqual("rgba", json.loads(restored)["output_mode"])

    def test_eagle_tags_use_reviewed_danbooru_bilingual_taxonomy(self):
        from eagle_suite_test_package.eagle_suite import eagle_gallery
        from eagle_suite_test_package.eagle_suite.danbooru_library import Library
        with tempfile.TemporaryDirectory() as directory:
            db_path = str(pathlib.Path(directory) / "tags.sqlite3")
            library = Library(db_path)
            row = {"id": 1, "name": "blue_eyes", "category": 0, "post_count": 10000}
            library.save_page("tags", [row], {})
            library.save_drafts([{
                "name": "blue_eyes", "cn_name": "蓝眼睛", "facets": ["face.eyes"],
                "confidence": .95, "rating": "safe", "note": "test",
            }], [row], "mock")
            library.review("blue_eyes", True)

            result = eagle_gallery._enrich_eagle_tags([
                {"name": "blue eyes", "count": 7},
                {"name": "private_tag", "count": 2},
            ], db_path)
            self.assertEqual(result[0]["cn_name"], "蓝眼睛")
            self.assertEqual(result[0]["facet_labels"], ["面部/眼睛"])
            self.assertEqual(result[0]["group"], "面部")
            self.assertEqual(result[0]["taxonomy_status"], "reviewed")
            self.assertEqual(result[1]["group"], "Eagle / 未归类")

    def test_danbooru_reviewed_facets_search_and_seed_reproducibility(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search
        from eagle_suite_test_package.eagle_suite.danbooru_library import Library
        with tempfile.TemporaryDirectory() as directory:
            db_path = str(pathlib.Path(directory) / "tags.sqlite3")
            library = Library(db_path)
            rows = [{"id": i, "name": name, "category": 0, "post_count": 10000}
                    for i, name in enumerate(["sitting", "standing", "walking"], 1)]
            library.save_page("tags", rows, {})
            for row in rows:
                library.save_drafts([{"name": row["name"], "cn_name": "审核译名", "facets": ["pose.posture"],
                    "confidence": .9, "rating": "safe", "note": "test"}], [row], "mock")
                library.review(row["name"], True)
            settings = {**search.DEFAULT_SETTINGS, "gacha_allocation_mode": "exact", "gacha_facet_counts": {"pose.posture": 1}}
            with mock.patch.object(search, "LIBRARY_PATH", db_path), mock.patch.object(search, "load_settings", return_value=settings), mock.patch.object(search, "_tag_catalog", []):
                first = search._database_gacha(seed=42)
                second = search._database_gacha(seed=42)
                self.assertEqual(first["tags"], second["tags"])
                self.assertEqual(first["tags"][0]["facets"], ["pose.posture"])
                results = search._direct_catalog_search("审核译名")
                self.assertEqual(len(results), 3)
                self.assertEqual(results[0]["facets"], ["pose.posture"])

    def test_danbooru_fixed_identity_skips_body_but_allows_deterministic_pose_rules(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search
        with tempfile.TemporaryDirectory() as directory:
            settings = {**search.DEFAULT_SETTINGS, "gacha_allocation_mode": "exact", "gacha_facet_counts": {"body.build": 1, "pose.hands": 1}}
            with mock.patch.object(search, "LIBRARY_PATH", str(pathlib.Path(directory) / "empty.sqlite3")), mock.patch.object(search, "load_settings", return_value=settings):
                result = search._database_gacha("blue_eyes", seed=42)
                self.assertTrue(all("body.build" not in item.get("facets", []) for item in result["tags"]))
                self.assertTrue(all("pose.hands" in item.get("facets", []) for item in result["tags"]))
                self.assertIn("已锁定", result["warning"])

    def test_danbooru_smart_gacha_plans_ranges_and_respects_intent(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search

        settings = {
            **search.DEFAULT_SETTINGS,
            "gacha_allocation_mode": "smart",
            "gacha_density": "balanced",
            "gacha_category_modes": {
                **search.DEFAULT_SETTINGS["gacha_category_modes"],
                "outfit": "required", "scene": "off",
            },
        }
        counts = search._planned_category_counts(settings, "dynamic running portrait", __import__("random").Random(7))
        self.assertGreaterEqual(sum(counts.values()), 7)
        self.assertLessEqual(sum(counts.values()), 10)
        self.assertGreaterEqual(counts["outfit"], 1)
        self.assertEqual(0, counts["scene"])

    def test_danbooru_gacha_catalog_prefers_sqlite_and_reports_source(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search
        from eagle_suite_test_package.eagle_suite.danbooru_library import Library

        with tempfile.TemporaryDirectory() as directory:
            db_path = str(pathlib.Path(directory) / "tags.sqlite3")
            library = Library(db_path)
            row = {"id": 1, "name": "running", "category": 0, "post_count": 20000}
            library.save_page("tags", [row], {})
            library.save_drafts([{
                "name": "running", "cn_name": "奔跑", "facets": ["action.movement"],
                "confidence": .98, "rating": "safe", "note": "test",
            }], [row], "mock")
            library.review("running", True)
            settings = {
                **search.DEFAULT_SETTINGS,
                "gacha_density": "compact",
                "gacha_category_modes": {
                    **search.DEFAULT_SETTINGS["gacha_category_modes"],
                    "outfit": "off", "expression": "off", "scene": "off",
                    "environment": "off", "composition": "off", "lighting": "off",
                    "action": "required",
                },
            }
            with mock.patch.object(search, "LIBRARY_PATH", db_path), mock.patch.object(
                search, "load_settings", return_value=settings
            ), mock.patch.object(search, "_gacha_buckets", None), mock.patch.object(
                search, "_gacha_catalog_source", None
            ):
                result = search._database_gacha(seed=42)
            self.assertEqual("sqlite", result["data_source"])
            self.assertEqual(["running"], [item["tag"] for item in result["tags"]])

    def test_danbooru_semantic_snapshot_merges_sqlite_before_csv(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search
        from eagle_suite_test_package.eagle_suite.danbooru_library import Library
        import csv

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            db_path = root / "tags.sqlite3"
            csv_path = root / "seed.csv"
            snapshot = root / "cache" / "semantic.csv"
            csv_path.write_text(
                "name,cn_name,wiki,post_count,category,nsfw\nseed_only,种子词,,6000,0,0\n",
                encoding="utf-8-sig",
            )
            library = Library(db_path)
            library.save_page("tags", [{
                "id": 1, "name": "database_only", "category": 0,
                "post_count": 8000, "is_deprecated": False,
            }], {})
            settings = {
                **search.DEFAULT_SETTINGS,
                "semantic_use_library": True,
                "semantic_library_limit": 1000,
                "semantic_library_min_post_count": 100,
            }
            with mock.patch.object(search, "LIBRARY_PATH", str(db_path)), mock.patch.object(
                search, "TAGS_CSV_PATH", str(csv_path)
            ), mock.patch.object(search, "SEMANTIC_CATALOG_PATH", str(snapshot)), mock.patch.object(
                search, "EMBEDDING_CACHE_DIR", str(snapshot.parent)
            ), mock.patch.object(search, "_tag_catalog", None), mock.patch.object(
                search, "_semantic_catalog_dirty", True
            ):
                result_path = search._prepare_semantic_catalog(settings, True)
                with open(result_path, encoding="utf-8-sig", newline="") as handle:
                    rows = list(csv.DictReader(handle))
            self.assertEqual({"database_only", "seed_only"}, {row["name"] for row in rows})
            self.assertEqual("sqlite+csv", search._semantic_catalog_info["source"])

    def test_danbooru_semantic_probe_checks_bilingual_vectors(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search

        class FakeEncoder:
            def __init__(self, *_args, **_kwargs):
                pass

            def encode(self, *_args, **_kwargs):
                return np.asarray([
                    [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                    [0.8, 0.6, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                ], dtype=np.float32)

        fake_module = type(sys)("sentence_transformers")
        fake_module.SentenceTransformer = FakeEncoder
        with mock.patch.dict(sys.modules, {"sentence_transformers": fake_module}), mock.patch.object(
            search, "_engine", None
        ), mock.patch.object(torch.cuda, "is_available", return_value=False):
            result = search._probe_semantic_model("fake-encoder")
        self.assertTrue(result["passed"])
        self.assertEqual(8, result["dimension"])
        self.assertAlmostEqual(0.8, result["bilingual_similarity"])

    def test_danbooru_model_card_supports_complete_categories_and_filters_disabled(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search

        card = search._extract_llm_json(json.dumps({
            "name": "test", "outfit": ["school_uniform"], "action": ["running"],
            "expression": ["smile"], "scene": ["street"], "environment": ["rain"],
            "composition": ["full_body"], "lighting": ["backlighting"],
        }))
        settings = {
            **search.DEFAULT_SETTINGS,
            "gacha_category_modes": {**search.DEFAULT_SETTINGS["gacha_category_modes"], "scene": "off"},
        }
        with mock.patch.object(search, "LIBRARY_PATH", ""), mock.patch.object(
            search, "_gacha_item_allowed", return_value=True
        ):
            normalized = search._normalize_llm_card(card, settings)
        kinds = {item["kind"] for item in normalized["tags"]}
        self.assertIn("expression", kinds)
        self.assertIn("environment", kinds)
        self.assertNotIn("scene", kinds)

    def test_danbooru_structured_constraints_separate_pose_holding_and_content(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search

        safe = {**search.DEFAULT_SETTINGS, "gacha_holding_mode": "daily", "gacha_content_level": 0}
        self.assertTrue(search._gacha_item_allowed({"tag": "holding_cup", "rating": "safe"}, safe))
        self.assertFalse(search._gacha_item_allowed({"tag": "holding_knife", "rating": "safe"}, safe))
        self.assertTrue(search._gacha_item_allowed({"tag": "kneeling", "rating": "safe"}, safe))
        self.assertIn("pose.posture", search._infer_gacha_facets({"tag": "kneeling"}))
        self.assertIn("camera.angle", search._infer_gacha_facets({"tag": "low_angle"}))
        adult = {**safe, "gacha_content_level": 3, "gacha_holding_mode": "any"}
        self.assertTrue(search._gacha_item_allowed({"tag": "masturbation", "rating": "explicit"}, adult))
        self.assertFalse(search._gacha_item_allowed({"tag": "masturbation", "rating": "explicit"}, safe))
        blocked = {**adult, "gacha_excluded_tags": "holding_*, low_angle"}
        self.assertFalse(search._gacha_item_allowed({"tag": "holding_cup", "rating": "safe"}, blocked))

    def test_danbooru_reference_passthrough_and_sdxl_anima_outputs(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search

        reference = torch.rand((1, 24, 32, 3))
        payload = json.dumps({
            "selected_tags": [{"tag": "crossed_legs", "kind": "action", "enabled": True}],
            "gacha_content_level": 0,
        })
        result = search.DanbooruVueSearchNode().execute(payload, reference_image=reference)
        self.assertEqual(5, len(result))
        self.assertIs(reference, result[4])
        self.assertIn("masterpiece, best quality, highres", result[2])
        self.assertIn("masterpiece, best quality, score_7, safe", result[3])
        self.assertIn("crossed legs", result[3])

    def test_danbooru_prompt_locks_external_design_and_exposes_policies(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search

        _, prompt = search._gacha_prompts("green_hair, orange_bikini", {
            **search.DEFAULT_SETTINGS,
            "gacha_content_level": 2,
            "gacha_holding_mode": "weapon",
            "gacha_excluded_tags": "gun, holding_*",
        })
        self.assertIn("outfit, held objects", prompt)
        self.assertIn("adult/questionable", prompt)
        self.assertIn("only be weapons", prompt)
        self.assertIn("gun, holding_*", prompt)

    def test_danbooru_auto_gacha_uses_explicitly_connected_generative_planner(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search

        settings = {
            **search.DEFAULT_SETTINGS,
            "enable_model_calls": True,
            "gacha_allocation_mode": "smart",
            "gacha_model_planning": True,
        }
        card = {"name": "planned", "provider": "connected_model", "tags": [
            {"tag": "running", "kind": "action", "source": "gacha", "enabled": True, "weight": 1.0},
        ]}
        with mock.patch.object(search, "load_settings", return_value=settings), mock.patch.object(
            search, "_connected_model_gacha", return_value=card
        ) as planner:
            result = search.DanbooruVueSearchNode().execute(
                json.dumps({"auto_gacha": True, "selected_tags": []}),
                character_tags="1girl", enable_language_model=True,
                local_model={"path": "model.gguf"}, node_id="42",
            )
        planner.assert_called_once()
        self.assertIn("running", result[1])

    def test_danbooru_library_model_requires_opt_in(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search
        with self.assertRaisesRegex(ValueError, "总开关"):
            search._library_model([], {"enable_model_calls": False})

    def test_danbooru_library_model_treats_legacy_null_provider_as_default(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search
        with self.assertRaisesRegex(ValueError, "ComfyUI 本地生成模型"):
            search._library_model([], {
                "enable_model_calls": True,
                "library_model_provider": None,
                "gacha_comfy_model": "",
            })

    def test_danbooru_library_canvas_ports_and_local_priority(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search

        inputs = search.DanbooruVueSearchNode.INPUT_TYPES()
        self.assertEqual("API_CONFIG", inputs["optional"]["api_config"][0])
        self.assertEqual("EAGLE_LOCAL_LLM_MODEL", inputs["optional"]["local_model"][0])
        self.assertEqual("IMAGE", inputs["optional"]["reference_image"][0])
        self.assertEqual(("IMAGE", "STRING", "STRING", "STRING", "IMAGE"), search.DanbooruVueSearchNode.RETURN_TYPES)
        self.assertTrue(search.DanbooruVueSearchNode.OUTPUT_NODE)

        local = {"path": r"C:\models\local", "backend": "transformers"}
        kind, transport = search._select_library_port_transport(
            ("", "http://127.0.0.1:11434/v1", "qwen3.8:27b"), local
        )
        self.assertEqual("local", kind)
        self.assertIs(local, transport["handle"])
        kind, transport = search._select_library_port_transport(
            ("", "http://127.0.0.1:11434/v1", "gemma4:12b"), None
        )
        self.assertEqual("api", kind)
        self.assertEqual("", transport["key"])
        with self.assertRaisesRegex(ValueError, "本地模型端口"):
            search._select_library_port_transport(
                ("billing-key", "https://example.invalid/v1", "paid-model"),
                {"path": ""},
            )

    def test_danbooru_connected_api_transport_is_offline_mocked_and_key_decoded(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search
        from eagle_suite_test_package.eagle_suite import api_config_manager as manager

        rows = [{"name": "sitting", "category": 0, "post_count": 10000,
                 "groups": [], "official_wiki": None}]
        payload = [{"name": "sitting", "cn_name": "坐姿", "kind": "action",
                    "facets": ["pose.posture"], "confidence": .95,
                    "rating": "unknown", "note": "待人工核定"}]
        response = mock.Mock(status_code=200)
        response.json.return_value = {"choices": [{"finish_reason": "stop",
            "message": {"content": json.dumps(payload, ensure_ascii=False)}}]}
        with mock.patch.object(manager, "decode_api_key", return_value="decoded-key"), \
             mock.patch("requests.post", return_value=response) as post:
            result, label = search._library_model_from_ports(rows, api_config={
                "api_key": "encoded-key", "base_url": "https://example.invalid/v1",
                "model": "paid-model",
            })
        self.assertEqual(payload, result)
        self.assertEqual("api:paid-model", label)
        self.assertEqual("https://example.invalid/v1/chat/completions", post.call_args.args[0])
        self.assertEqual("Bearer decoded-key", post.call_args.kwargs["headers"]["Authorization"])
        self.assertEqual("paid-model", post.call_args.kwargs["json"]["model"])
        self.assertEqual(rows[0]["name"], json.loads(post.call_args.kwargs["json"]["messages"][1]["content"])[0]["name"])

    def test_danbooru_library_canvas_fill_is_one_shot(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search
        from eagle_suite_test_package.eagle_suite.danbooru_library import Library

        with tempfile.TemporaryDirectory() as directory:
            db_path = str(pathlib.Path(directory) / "tags.sqlite3")
            library = Library(db_path)
            row = {"id": 1, "name": "sitting", "category": 0, "post_count": 10000}
            library.save_page("tags", [row], {})
            payload = [{
                "name": "sitting", "cn_name": "坐姿", "facets": ["pose.posture"],
                "confidence": .95, "rating": "safe", "note": "test",
            }]
            request = {"id": "request-1", "batch": 1}
            local = {"path": r"C:\models\local", "backend": "transformers"}
            with search._library_job_lock:
                search._library_job.update(running=False, message="test")
            with mock.patch.object(search, "LIBRARY_PATH", db_path), mock.patch.object(
                search, "_library_model_from_ports", return_value=(payload, "local:test")
            ) as generate:
                search._run_library_port_fill(request, "42", local_model=local)
                search._run_library_port_fill(request, "42", local_model=local)
            self.assertEqual(1, generate.call_count)
            self.assertEqual(1, library.status()["annotations"]["pending"])
            self.assertEqual("request-1", library.checkpoint("port_fill:42")["request_id"])

    def test_danbooru_selected_tags_fill_is_targeted_pending_and_one_shot(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search
        from eagle_suite_test_package.eagle_suite.danbooru_library import Library

        with tempfile.TemporaryDirectory() as directory:
            db_path = str(pathlib.Path(directory) / "tags.sqlite3")
            library = Library(db_path)
            library.save_page("tags", [{"id": 1, "name": "sitting", "category": 0,
                "post_count": 90000}], {})
            catalog = [{"tag": "blue_eyes", "category": "general", "post_count": 25000,
                "cn_name": "", "wiki": "", "nsfw": False}]
            selected = [{"tag": "blue eyes", "enabled": True},
                {"tag": "not_a_real_tag", "enabled": True},
                {"tag": "sitting", "enabled": False}]
            generated = []
            def model(rows, api_config, local_model):
                generated.append([row["name"] for row in rows])
                return ([{"name": "blue_eyes", "cn_name": "蓝眼睛", "kind": "face",
                    "facets": ["face.eyes"], "confidence": .95, "rating": "safe", "note": "test"}], "api:mock")
            with search._library_job_lock:
                search._library_job.update(running=False, message="test")
            with mock.patch.object(search, "LIBRARY_PATH", db_path), \
                 mock.patch.object(search, "_tag_catalog", catalog), \
                 mock.patch.object(search, "_library_model_from_ports", side_effect=model):
                request = {"id": "target-1", "node_id": "42", "selected_only": True,
                    "batch": 10, "tags": ["blue_eyes", "sitting"]}
                search._run_library_port_fill(request, "42", api_config={"model": "mock"}, selected_tags=selected)
                search._run_library_port_fill(request, "42", api_config={"model": "mock"}, selected_tags=selected)
            self.assertEqual(generated, [["blue_eyes"]])
            self.assertEqual(library.status()["annotations"], {"pending": 1})
            self.assertEqual(library.lookup(["blue_eyes"])["blue_eyes"]["source"], "selected_catalog")
            self.assertEqual(library.checkpoint("selected_tag_fill:42")["request_id"], "target-1")
            self.assertNotIn("not_a_real_tag", library.lookup(["not_a_real_tag"]))
            self.assertNotIn("sitting", library.approved())
            with self.assertRaisesRegex(ValueError, "显式发起"):
                search._run_library_port_fill({"id": "bad", "selected_only": True, "continuous": True}, "42", selected_tags=selected)

    def test_danbooru_selected_fill_model_failure_keeps_drafts_and_checkpoint_empty(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search
        from eagle_suite_test_package.eagle_suite.danbooru_library import Library

        with tempfile.TemporaryDirectory() as directory:
            db_path = str(pathlib.Path(directory) / "tags.sqlite3")
            library = Library(db_path)
            library.save_page("tags", [{"id": 1, "name": "blue_eyes", "category": 0,
                "post_count": 10000}], {})
            request = {"id": "failed-target", "node_id": "42", "selected_only": True,
                "tags": ["blue_eyes"], "batch": 1}
            with search._library_job_lock:
                search._library_job.update(running=False, message="test")
            with mock.patch.object(search, "LIBRARY_PATH", db_path), \
                 mock.patch.object(search, "_tag_catalog", []), \
                 mock.patch.object(search, "_library_model_from_ports",
                                   side_effect=ValueError("模型输出被截断；本批未写入")):
                with self.assertRaisesRegex(ValueError, "本批未写入"):
                    search._run_library_port_fill(request, "42", local_model={"path": "mock.gguf"},
                        selected_tags=[{"tag": "blue_eyes", "enabled": True}])
            self.assertEqual([], library.pending())
            self.assertEqual({}, library.checkpoint("selected_tag_fill:42"))
            self.assertEqual("unknown", library.lookup(["blue_eyes"])["blue_eyes"]["rating"])

    def test_danbooru_metadata_route_returns_only_approved_purpose(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search
        from eagle_suite_test_package.eagle_suite.danbooru_library import Library

        with tempfile.TemporaryDirectory() as directory:
            db_path = str(pathlib.Path(directory) / "tags.sqlite3")
            library = Library(db_path)
            row = {"id": 1, "name": "blue_eyes", "category": 0, "post_count": 10000}
            library.save_page("tags", [row], {})
            library.save_drafts([{"name": "blue_eyes", "cn_name": "蓝眼睛", "kind": "face",
                "facets": ["face.eyes"], "confidence": .95, "rating": "safe", "note": "test"}], [row], "api:mock")
            request = mock.Mock(json=mock.AsyncMock(return_value={"tags": ["blue_eyes"]}))
            with mock.patch.object(search, "LIBRARY_PATH", db_path), mock.patch.object(search, "_tag_translations", None):
                pending = json.loads(asyncio.run(search.route_translate_batch(request)).text)
                self.assertEqual(pending["metadata"], {})
                library.review("blue_eyes", True)
                search._tag_translations = None
                approved = json.loads(asyncio.run(search.route_translate_batch(request)).text)
            self.assertEqual(approved["translations"]["blue_eyes"], "蓝眼睛")
            self.assertEqual(approved["metadata"]["blue_eyes"]["kind"], "face")
            self.assertEqual(approved["metadata"]["blue_eyes"]["rating"], "safe")
            self.assertEqual(approved["metadata"]["blue_eyes"]["nsfw"], 0)

    def test_danbooru_catalog_unknown_safety_is_not_sfw(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search
        with tempfile.TemporaryDirectory() as directory:
            catalog = [
                {"tag": "safe_foo", "cn_name": "", "wiki": "", "category": "general",
                 "post_count": 100, "nsfw": False},
                {"tag": "unknown_foo", "cn_name": "", "wiki": "", "category": "general",
                 "post_count": 100, "nsfw": None},
            ]
            with mock.patch.object(search, "_tag_catalog", catalog), \
                 mock.patch.object(search, "LIBRARY_PATH", str(pathlib.Path(directory) / "absent.sqlite3")):
                sfw = search._direct_catalog_search("foo")
                all_levels = search._direct_catalog_search("foo", show_nsfw=True)
            self.assertEqual([item["tag"] for item in sfw], ["safe_foo"])
            self.assertEqual(next(item for item in all_levels if item["tag"] == "unknown_foo")["nsfw"], None)
            self.assertEqual(next(item for item in all_levels if item["tag"] == "unknown_foo")["rating"], "unknown")

    def test_danbooru_library_fill_toggle_runs_one_batch_per_queue(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search
        from eagle_suite_test_package.eagle_suite.danbooru_library import Library

        with tempfile.TemporaryDirectory() as directory:
            db_path = str(pathlib.Path(directory) / "tags.sqlite3")
            library = Library(db_path)
            rows = [
                {"id": 1, "name": "sitting", "category": 0, "post_count": 10000},
                {"id": 2, "name": "standing", "category": 0, "post_count": 9000},
            ]
            library.save_page("tags", rows, {})
            payloads = [
                ([{"name": "sitting", "cn_name": "坐姿", "facets": ["pose.posture"],
                   "confidence": .95, "rating": "safe", "note": "test"}], "local:test"),
                ([{"name": "standing", "cn_name": "站立", "facets": ["pose.posture"],
                   "confidence": .95, "rating": "safe", "note": "test"}], "local:test"),
            ]
            with search._library_job_lock:
                search._library_job.update(running=False, message="test")
            with mock.patch.object(search, "LIBRARY_PATH", db_path), mock.patch.object(
                search, "_library_model_from_ports", side_effect=payloads
            ) as generate:
                search._run_library_port_fill({"continuous": True, "batch": 1}, "42", local_model={"path": "x"})
                search._run_library_port_fill({"continuous": True, "batch": 1}, "42", local_model={"path": "x"})
            self.assertEqual(2, generate.call_count)
            self.assertEqual(2, library.status()["annotations"]["pending"])
            self.assertEqual({}, library.checkpoint("port_fill:42"))
            self.assertTrue(np.isnan(search.DanbooruVueSearchNode.IS_CHANGED(
                json.dumps({"library_enrichment_enabled": True})
            )))

    def test_danbooru_library_model_payload_parser_handles_wrappers_and_empty_output(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search

        row = {"name": "sitting"}
        self.assertEqual([row], search._parse_library_model_payload(
            '<think>ignore ["example"]</think>\n```json\n{"items":[{"name":"sitting"}]}\n```'
        ))
        with self.assertRaisesRegex(ValueError, "空内容") as caught:
            search._parse_library_model_payload("")
        self.assertNotIn("Expecting value", str(caught.exception))

    def test_danbooru_gallery_popularity_filters_use_official_metatags(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search

        with mock.patch.object(search, "load_settings", return_value={"hide_ai": False}), mock.patch.object(
            search, "_danbooru_get", return_value=[]
        ) as request:
            search._fetch_posts("1girl", 1, 40, "general", False, "favcount", 25, 10)
        params = request.call_args.args[1]
        self.assertIn("order:favcount", params["tags"])
        self.assertIn("score:>=25", params["tags"])
        self.assertIn("favcount:>=10", params["tags"])

    def test_danbooru_pool_search_is_on_demand_and_series_only(self):
        from eagle_suite_test_package.eagle_suite import danbooru_search as search

        class Request:
            async def json(self):
                return {"query": "Fate stay", "category": "series", "limit": 20}

        rows = [{"id": 7, "name": "fate_stay_night", "category": "series", "post_count": 123}]
        with mock.patch.object(search, "_danbooru_get", return_value=rows) as get:
            response = asyncio.run(search.route_pools(Request()))
        payload = json.loads(response.text)
        self.assertTrue(payload["success"])
        self.assertEqual(7, payload["pools"][0]["id"])
        self.assertEqual("/pools.json", get.call_args.args[0])
        self.assertEqual("*Fate_stay*", get.call_args.args[1]["search[name_matches]"])
        self.assertEqual("series", get.call_args.args[1]["search[category]"])

    def test_llamacpp_uses_reasoning_content_when_final_content_is_empty(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        llm = mock.Mock()
        llm.create_chat_completion.return_value = {
            "choices": [{"message": {"content": "", "reasoning_content": "fallback"}}]
        }
        text, error, _elapsed = local_llm_node._run_llamacpp_inference(
            llm, [], "question", "system", 32, .1, .9, False, -1,
        )
        self.assertEqual("fallback", text)
        self.assertEqual("", error)

    def test_image_saver_blank_targets_use_comfy_output(self):
        from eagle_suite_test_package.eagle_suite import eagle_saver
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            eagle_saver.folder_paths, "get_output_directory", return_value=directory
        ):
            result = eagle_saver.EagleSaver().save_images(
                torch.zeros((1, 8, 8, 3)), "", "", filename_prefix="fallback"
            )[0]
            self.assertTrue(pathlib.Path(directory, "fallback_0000.png").is_file())
            self.assertIn("ComfyUI 默认 output", result)

    def test_api_loader_allows_keyless_local_openai_profile(self):
        from eagle_suite_test_package.eagle_suite import api_key_node
        profiles = {"profiles": {"gemma4:12b": {
            "api_key": "", "base_url": "http://127.0.0.1:11434/v1",
            "model": "gemma4:12b", "model_type": "llm",
        }}, "active_profile": "gemma4:12b"}
        with mock.patch.object(api_key_node._profile_mgr, "load_profiles", return_value=profiles):
            result = api_key_node.EagleAPILoader().load_config("gemma4:12b")
        self.assertEqual("", result[0])
        self.assertEqual("http://127.0.0.1:11434/v1", result[1])
        self.assertEqual(("", "http://127.0.0.1:11434/v1", "gemma4:12b"), result[3])

    def test_director_skill_json_request_compatibility(self):
        from eagle_suite_test_package.nodes.prompt_presets import _read_json_request

        class FakeRequest:
            def __init__(self, body):
                self.body = body

            async def text(self):
                return self.body

        body, error = asyncio.run(_read_json_request(FakeRequest('{"name":"Direct payload"}'), "测试"))
        self.assertEqual({"name": "Direct payload"}, body)
        self.assertIsNone(error)

        body, error = asyncio.run(_read_json_request(FakeRequest("  "), "测试"))
        self.assertIsNone(body)
        self.assertIn("请求体为空", error)

    def test_director_skill_endpoints_accept_legacy_direct_payloads(self):
        from eagle_suite_test_package.nodes import prompt_presets

        class FakeRequest:
            def __init__(self, body):
                self.body = body

            async def text(self):
                return self.body

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            config_file = root / "config.json"
            skills_file = root / "director_skills.json"
            with mock.patch.object(prompt_presets, "CONFIG_FILE", config_file), mock.patch.object(
                prompt_presets, "DIRECTOR_SKILLS_FILE", skills_file
            ):
                config_response = asyncio.run(prompt_presets.update_config(FakeRequest('{"auto_sync":false}')))
                self.assertEqual(200, config_response.status)
                saved_config = json.loads(config_file.read_text(encoding="utf-8"))
                self.assertFalse(saved_config["auto_sync"])
                self.assertIn("obsidian", saved_config)

                skill_response = asyncio.run(prompt_presets.save_director_skill(
                    FakeRequest('{"name":"兼容测试","content":"test"}')
                ))
                self.assertEqual(200, skill_response.status)
                saved_skills = json.loads(skills_file.read_text(encoding="utf-8"))
                self.assertEqual("兼容测试", next(iter(saved_skills.values()))["name"])

                empty_response = asyncio.run(prompt_presets.save_director_skill(FakeRequest("")))
                self.assertEqual(400, empty_response.status)

    def test_director_skill_storage_reports_effective_fallback(self):
        from eagle_suite_test_package.nodes import prompt_presets

        with tempfile.TemporaryDirectory() as directory:
            default_file = pathlib.Path(directory) / "skills" / "director_skills.json"
            obsidian_config = {
                "director_skills": {"source": "obsidian"},
                "obsidian": {"vault_path": str(pathlib.Path(directory) / "missing")},
            }
            with mock.patch.object(prompt_presets, "DIRECTOR_SKILLS_FILE", default_file):
                status = prompt_presets.director_skill_storage_status(obsidian_config)
            self.assertEqual("obsidian", status["configured_source"])
            self.assertEqual("eagle", status["effective_source"])
            self.assertTrue(status["fallback_reason"])
            self.assertEqual(str(default_file.resolve()), status["storage_path"])

    def test_prompt_preset_cover_storage_uses_stable_user_reference(self):
        from PIL import Image
        from eagle_suite_test_package.nodes import prompt_presets

        buffer = __import__("io").BytesIO()
        Image.new("RGBA", (3, 2), (20, 40, 60, 255)).save(buffer, format="PNG")

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            covers = root / "user-data" / "prompt_presets" / "covers"
            with mock.patch.object(prompt_presets, "COVERS_DIR", covers):
                reference = prompt_presets._store_cover_bytes(buffer.getvalue())
                self.assertRegex(
                    reference,
                    r"^eagle-user://prompt-presets/covers/cover_[0-9a-f]{32}\.png$",
                )
                filename = prompt_presets._managed_cover_filename(reference)
                self.assertTrue((covers / filename).is_file())
                self.assertEqual((covers / filename).resolve(), prompt_presets._allowed_cover_path(reference))

                response = prompt_presets._cover_response(reference)
                self.assertEqual(reference, response["cover"])
                self.assertEqual(reference, response["path"])
                self.assertIn("eagle-user%3A%2F%2Fprompt-presets%2Fcovers%2F", response["url"])

            with mock.patch.dict(
                os.environ, {"EAGLE_SUITE_USER_DATA_DIR": str(root / "configured")}, clear=False
            ):
                self.assertEqual(
                    (root / "configured" / "prompt_presets").resolve(),
                    prompt_presets._default_persistent_data_dir(),
                )

    def test_prompt_preset_multiple_preview_images_are_ordered_and_backward_compatible(self):
        from eagle_suite_test_package.nodes import prompt_presets

        self.assertEqual(
            ["covers/legacy.png"],
            prompt_presets._preview_image_sources({"cover": "covers/legacy.png"}),
        )
        self.assertEqual(
            [],
            prompt_presets._preview_image_sources({
                "cover": "covers/legacy.png",
                "preview_images": [],
            }),
        )

        template = {
            "cover": "covers/stale.png",
            "preview_images": ["https://example.invalid/first.png", "https://example.invalid/second.png"],
        }
        prompt_presets._normalize_loaded_preview_images(template)
        self.assertEqual("https://example.invalid/first.png", template["cover"])
        self.assertEqual([
            "https://example.invalid/first.png",
            "https://example.invalid/second.png",
        ], template["preview_images"])

        too_many = {"preview_images": [f"https://example.invalid/{index}.png" for index in range(13)]}
        with self.assertRaisesRegex(ValueError, "最多 12 张"):
            prompt_presets._persist_template_preview_images(too_many, allow_external=True)

    def test_prompt_preset_preview_images_round_trip_through_markdown(self):
        from eagle_suite_test_package.nodes import prompt_presets

        original = {
            "id": "multi-preview",
            "Label": "多效果预设",
            "Instruction": "apply {{style}}",
            "example": "apply watercolor",
            "category": "风格转换",
            "tags": ["style"],
            "cover": "https://example.invalid/stale.png",
            "preview_images": [
                "https://example.invalid/one.png",
                "https://example.invalid/two.png",
            ],
        }
        markdown = prompt_presets.template_to_markdown(original)
        parsed = prompt_presets.parse_markdown_templates(markdown, "multi.md", source="user")
        self.assertEqual(1, len(parsed))
        self.assertEqual(original["preview_images"], parsed[0]["preview_images"])
        self.assertEqual(original["preview_images"][0], parsed[0]["cover"])

        legacy_markdown = """---
label: Legacy
cover: https://example.invalid/legacy.png
---

## 指令
legacy prompt
"""
        legacy = prompt_presets.parse_markdown_templates(legacy_markdown, "legacy.md", source="user")
        self.assertEqual(["https://example.invalid/legacy.png"], legacy[0]["preview_images"])
        self.assertEqual("https://example.invalid/legacy.png", legacy[0]["cover"])

    def test_prompt_preset_legacy_cover_is_lazily_migrated(self):
        from PIL import Image
        from eagle_suite_test_package.nodes import prompt_presets

        buffer = __import__("io").BytesIO()
        Image.new("RGB", (2, 2), (200, 100, 50)).save(buffer, format="PNG")
        filename = "cover_" + ("a" * 32) + ".png"

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            legacy = root / "plugin" / "prompts" / "covers"
            persistent = root / "user" / "__eagle_suite" / "prompt_presets" / "covers"
            legacy.mkdir(parents=True)
            (legacy / filename).write_bytes(buffer.getvalue())
            with mock.patch.object(prompt_presets, "LEGACY_COVERS_DIR", legacy), mock.patch.object(
                prompt_presets, "COVERS_DIR", persistent
            ):
                resolved = prompt_presets._allowed_cover_path("covers/" + filename)

            self.assertEqual((persistent / filename).resolve(), resolved)
            self.assertTrue((persistent / filename).is_file())
            # Migration is deliberately non-destructive so an older plugin can
            # still read the same workflow if the user rolls back.
            self.assertTrue((legacy / filename).is_file())

    def test_prompt_preset_cover_path_traversal_and_remote_import_are_rejected(self):
        from PIL import Image
        from eagle_suite_test_package.nodes import prompt_presets

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            base = root / "plugin" / "prompts"
            skill = root / "plugin" / "skills"
            covers = root / "user" / "covers"
            legacy = base / "covers"
            for folder in (base, skill, covers, legacy):
                folder.mkdir(parents=True, exist_ok=True)

            buffer = __import__("io").BytesIO()
            Image.new("RGB", (1, 1), (1, 2, 3)).save(buffer, format="PNG")
            (base / "inside.png").write_bytes(buffer.getvalue())
            outside = root / "outside.png"
            outside.write_bytes(buffer.getvalue())

            patches = (
                mock.patch.object(prompt_presets, "BASE_DIR", base),
                mock.patch.object(prompt_presets, "SKILL_DIR", skill),
                mock.patch.object(prompt_presets, "COVERS_DIR", covers),
                mock.patch.object(prompt_presets, "LEGACY_COVERS_DIR", legacy),
                mock.patch.object(
                    prompt_presets,
                    "load_config",
                    return_value={"local_paths": [], "obsidian": {}},
                ),
            )
            with patches[0], patches[1], patches[2], patches[3], patches[4]:
                for malicious in (
                    "../../outside.png",
                    "%2e%2e/%2e%2e/outside.png",
                    "covers/../inside.png",
                    "eagle-user://prompt-presets/covers/../inside.png",
                    "eagle-user://prompt-presets/covers/%2e%2e%2finside.png",
                ):
                    self.assertIsNone(
                        prompt_presets._allowed_cover_path(malicious),
                        msg=f"traversal unexpectedly resolved: {malicious}",
                    )
                self.assertIsNone(prompt_presets._allowed_cover_path(str(outside)))
                with self.assertRaisesRegex(ValueError, "请先下载"):
                    prompt_presets._persist_cover_source("https://example.invalid/cover.png")
                with self.assertRaisesRegex(ValueError, "blob"):
                    prompt_presets._persist_cover_source("blob:https://example.invalid/id")

    def test_director_skill_obsidian_markdown_matches_vault_contract_and_round_trips(self):
        from eagle_suite_test_package.nodes.prompt_presets import (
            _director_skills_from_markdown,
            _director_skills_to_markdown,
        )

        skills = {"skill-1": {
            "id": "skill-1",
            "name": "镜头节奏",
            "category": "camera",
            "tasks": ["shots"],
            "tags": ["timing"],
            "content": "# 原技能标题\n\n## 方法\n\n正文",
        }}
        markdown = _director_skills_to_markdown(skills)
        self.assertTrue(markdown.startswith("---\ntitle: Eagle Director Skills\n"))
        for field in ("type:", "tags:", "created:", "updated:"):
            self.assertIn("\n" + field, markdown)
        self.assertIn("eagle_schema: eagle-director-skills/v2", markdown)
        self.assertEqual(1, len(re.findall(r"(?m)^# [^#]", markdown)))
        self.assertIn("### 镜头节奏", markdown)
        self.assertIn("#### 原技能标题", markdown)
        self.assertIn("##### 方法", markdown)
        parsed = _director_skills_from_markdown(markdown)
        self.assertEqual("镜头节奏", parsed["skill-1"]["name"])
        self.assertIn("#### 原技能标题", parsed["skill-1"]["content"])

    def test_lora_selection_can_be_ignored_without_loading(self):
        from eagle_suite_test_package.eagle_suite import lora_gallery

        model, clip = object(), object()
        selection = json.dumps({
            "selections": [{"id": "test", "name": "Test LoRA", "weight": 0.75, "enabled": False}],
            "weights": {"test": 0.75},
            "enabled": {"test": False},
        })
        scanned = {"items": [{
            "id": "test", "name": "Test LoRA", "path": "never-loaded.safetensors",
            "rel": "folder/Test LoRA.safetensors", "triggerWords": ["should_not_emit"],
        }]}
        with mock.patch.object(lora_gallery, "_scan_loras", return_value=scanned), \
             mock.patch.object(lora_gallery.comfy.utils, "load_torch_file") as load_file:
            out_model, out_clip, info_json, triggers = lora_gallery.EagleLoraGalleryNode().load_loras(
                model, selection, clip=clip
            )
        info = json.loads(info_json)
        self.assertIs(model, out_model)
        self.assertIs(clip, out_clip)
        load_file.assert_not_called()
        self.assertEqual(0, info["count"])
        self.assertEqual(1, info["selectedCount"])
        self.assertEqual(1, info["ignoredCount"])
        self.assertFalse(info["loras"][0]["enabled"])
        self.assertEqual("", triggers)

    def test_lora_card_places_civitai_button_beside_trigger_words(self):
        source = (REPO / "web" / "js" / "lora_gallery.js").read_text(encoding="utf-8")
        self.assertIn('class: "lg-card-meta"', source)
        self.assertIn(".lg-card-meta{display:flex;align-items:center", source)
        self.assertIn(".lg-civ-btn{position:static;flex:0 0 auto", source)
        self.assertIn(".lg-img-box{position:relative;width:100%;height:164px", source)

    def test_prompt_preset_editor_uses_existing_or_custom_category(self):
        source = (REPO / "web" / "js" / "prompt_presets.js").read_text(encoding="utf-8")
        self.assertIn("categories: Array", source)
        self.assertIn("__eagle_custom_category__", source)
        self.assertIn("＋ 自定义分类…", source)
        self.assertIn("categorySelection.value === CUSTOM_CATEGORY ? h(\"input\"", source)
        self.assertIn("syncCategoryEditor(form.category)", source)

    def test_node_output_contracts(self):
        self.assertGreaterEqual(len(PACKAGE.NODE_CLASS_MAPPINGS), 29)
        self.assertNotIn("EagleH3MediaPortsNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertNotIn("EagleH3MediaPackNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleH3MediaBridgeNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertNotIn("EagleH3MediaPortsV2Node", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleH3PlanInteropNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleH3StateInteropNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleH3LoadManifestNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleH3ManifestAssembleNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertNotIn("EagleH3PlanNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleH3ShotContextNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleH3ReferenceConditionNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleH3FrameTrimNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleH3CheckpointReviewNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleH3NativeLoopEndNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleMemoryReleaseNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleText", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleTextStudio", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleLatentSwitchMulti", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleSvelteCharacterInteractionNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleSvelteCharacterPVNode", PACKAGE.NODE_CLASS_MAPPINGS)
        hidden_implementation_nodes = {
            "EagleH3PreflightNode", "EagleH3StartNode",
            "EagleH3PlanNode",
            "EagleH3CurrentShotNode", "EagleH3ContextNode", "EagleH3TrimNode",
            "EagleH3SegmentCheckpointNode", "EagleH3ReviewGateNode", "EagleH3EndNode",
            "EagleH3AssembleNode", "EagleH3FinalizeNode",
        }
        self.assertTrue(hidden_implementation_nodes.isdisjoint(PACKAGE.NODE_CLASS_MAPPINGS))
        h3_nodes = (
            "EagleH3DirectorNode", "EagleH3MediaBridgeNode", "EagleH3PlanInteropNode",
            "EagleH3StateInteropNode", "EagleH3NativeLoopStartNode", "EagleH3ShotContextNode",
            "EagleH3ReferenceConditionNode", "EagleH3FrameTrimNode",
            "EagleH3CheckpointReviewNode", "EagleH3NativeLoopEndNode",
            "EagleH3LoadManifestNode", "EagleH3ManifestAssembleNode",
            "EagleH3ExportPNGSequenceNode", "EagleH3SeamProbeNode", "EagleH3SmartSplitNode",
            "EagleSvelteCharacterInteractionNode", "EagleSvelteCharacterPVNode",
        )
        for name in h3_nodes:
            self.assertEqual("🦅 Eagle Suite/H3 导演台", PACKAGE.NODE_CLASS_MAPPINGS[name].CATEGORY, name)
        self.assertEqual(
            "🦅 Eagle Suite/H3 导演台",
            PACKAGE.NODE_CLASS_MAPPINGS["EagleDirectorSkillNode"].CATEGORY,
        )
        for name, node in PACKAGE.NODE_CLASS_MAPPINGS.items():
            returns = tuple(getattr(node, "RETURN_TYPES", ()))
            names = tuple(getattr(node, "RETURN_NAMES", returns))
            self.assertEqual(len(returns), len(names), name)
            output_is_list = getattr(node, "OUTPUT_IS_LIST", None)
            if output_is_list is not None:
                self.assertEqual(len(returns), len(output_is_list), name)

    def test_compact_text_is_an_exact_minimal_passthrough(self):
        from eagle_suite_test_package.eagle_suite.text_nodes import EagleText

        schema = EagleText.INPUT_TYPES()
        self.assertEqual(("text",), tuple(schema["required"]))
        self.assertNotIn("optional", schema)
        self.assertEqual(("STRING",), EagleText.RETURN_TYPES)
        self.assertEqual(("text",), EagleText.RETURN_NAMES)
        value = "  第一行\n\nthird line  "
        self.assertEqual((value,), EagleText().execute(value))
        self.assertEqual("🦅 Eagle Suite/文本", EagleText.CATEGORY)

    def test_multi_latent_switch_selects_one_and_has_custom_empty_size(self):
        from eagle_suite_test_package.eagle_suite.latent_switch_node import EagleLatentSwitchMulti

        node = EagleLatentSwitchMulti()
        schema = node.INPUT_TYPES()
        self.assertEqual(9, schema["required"]["输入数量"][1]["max"])
        self.assertEqual(
            [f"latent_{index}" for index in range(1, 10)],
            list(schema["optional"]),
        )
        first = {"samples": torch.ones((1, 4, 8, 8)), "custom": "first"}
        second = {"samples": torch.zeros((2, 4, 16, 12)), "custom": "second"}
        chosen = node.run(4, 768, 1344, 3, 7, latent_1=first, latent_3=second)[0]
        self.assertTrue(any(chosen is candidate for candidate in (first, second)))
        self.assertIs(chosen, node.run(4, 768, 1344, 3, 7, latent_1=first, latent_3=second)[0])

        fallback = node.run(4, 768, 1344, 3, 7)[0]
        self.assertEqual((3, 4, 168, 96), tuple(fallback["samples"].shape))
        self.assertEqual(("LATENT",), EagleLatentSwitchMulti.RETURN_TYPES)
        self.assertEqual(("latent",), EagleLatentSwitchMulti.RETURN_NAMES)
        self.assertEqual("🦅 Eagle Suite/工具", EagleLatentSwitchMulti.CATEGORY)

    def test_multi_text_switch_is_capped_at_nine_inputs(self):
        from eagle_suite_test_package.eagle_suite.text_switch_node import EagleTextSwitchMulti

        schema = EagleTextSwitchMulti.INPUT_TYPES()
        self.assertEqual(9, schema["required"]["输入数量"][1]["max"])
        self.assertEqual(
            [f"字符串_{index}" for index in range(1, 10)],
            list(schema["optional"]),
        )

    def test_text_split_defaults_to_comma(self):
        from eagle_suite_test_package.eagle_suite.text_nodes import EagleSplitString, EagleTextStudio

        self.assertEqual(",", EagleSplitString.INPUT_TYPES()["required"]["separator"][1]["default"])
        self.assertEqual(",", EagleTextStudio.INPUT_TYPES()["required"]["separator"][1]["default"])

    def test_text_nodes_use_one_flat_menu_and_remove_replaced_nodes(self):
        from eagle_suite_test_package.eagle_suite.text_nodes import EaglePromptPreset
        from eagle_suite_test_package.nodes.string_tools import EagleStringRows

        self.assertTrue(EagleStringRows.DEPRECATED)
        text_nodes = (
            "EagleText", "EagleTextStudio", "EagleStringRows",
            "EagleTextSwitchMulti", "EaglePromptVariablesNode", "EaglePromptPresets",
            "EagleSaveString", "EagleLoadTextFiles", "EagleSplitString",
            "EagleRandomLine",
        )
        for name in text_nodes:
            self.assertEqual("🦅 Eagle Suite/文本", PACKAGE.NODE_CLASS_MAPPINGS[name].CATEGORY, name)
        self.assertNotIn("EagleConcatStrings", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertNotIn("EagleTemplateReplace", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertNotIn("EaglePromptPreset", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertNotIn("EagleTextSwitch", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertNotIn("EagleConditioningPresetSelector", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertNotIn("EaglePVPostProductionNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertNotIn("EagleTextSwitch", PACKAGE.NODE_DISPLAY_NAME_MAPPINGS)
        self.assertNotIn("EagleConditioningPresetSelector", PACKAGE.NODE_DISPLAY_NAME_MAPPINGS)
        self.assertNotIn("EaglePVPostProductionNode", PACKAGE.NODE_DISPLAY_NAME_MAPPINGS)
        self.assertNotIn(EaglePromptPreset, PACKAGE.NODE_CLASS_MAPPINGS.values())

    def test_text_studio_prefers_external_text_and_processes_lines(self):
        from eagle_suite_test_package.eagle_suite.text_nodes import EagleTextStudio

        output = EagleTextStudio().process(
            text="编辑框内容",
            source_mode="外接优先",
            separator=r"\n",
            transform="行去重",
            replace_mode="普通替换",
            find_text="苹果",
            replace_text="梨",
            case_sensitive=True,
            input_text="苹果\n苹果\n香蕉",
        )
        text_value, lines, stats_json, char_count, line_count, json_valid = output["result"]
        self.assertEqual("梨\n香蕉", text_value)
        self.assertEqual(["梨", "香蕉"], lines)
        self.assertEqual(len(text_value), char_count)
        self.assertEqual(2, line_count)
        self.assertFalse(json_valid)
        self.assertEqual("处理完成", json.loads(stats_json)["status"])

    def test_text_studio_json_and_invalid_regex_are_safe(self):
        from eagle_suite_test_package.eagle_suite.text_nodes import EagleTextStudio

        node = EagleTextStudio()
        formatted = node.process(
            text='{"人物":"飞影","镜头":2}', source_mode="编辑框", separator=r"\n",
            transform="JSON 美化", replace_mode="关闭", find_text="", replace_text="",
            case_sensitive=True,
        )
        self.assertIn('"人物": "飞影"', formatted["result"][0])
        self.assertTrue(formatted["result"][-1])

        invalid_regex = node.process(
            text="保持原文", source_mode="编辑框", separator=r"\n", transform="原样",
            replace_mode="正则替换", find_text="[", replace_text="x", case_sensitive=True,
        )
        self.assertEqual("保持原文", invalid_regex["result"][0])
        self.assertIn("正则表达式无效", invalid_regex["ui"]["status"][0])

    def test_text_studio_frontend_has_live_result_preview(self):
        source = (REPO / "web" / "js" / "text_studio.js").read_text(encoding="utf-8")
        self.assertIn('nodeData.name !== "EagleTextStudio"', source)
        self.assertIn('data.text', source)
        self.assertIn('addDOMWidget("text_studio_preview"', source)
        self.assertIn('String(widget.value ?? "") === "\\\\n"', source)
        self.assertIn('widget.value = ","', source)

    def test_director_skill_queue_is_silently_blocked_before_h3_downstream(self):
        from comfy_execution.graph_utils import ExecutionBlocker
        from eagle_suite_test_package.eagle_suite import h3_director_node

        state = {"project": {}, "scenes": [{"id": 1, "title": "one"}]}
        request = {"run": True, "sceneId": 1, "tasks": ["script"], "blockDownstream": True}
        fake_result = {
            "scene_id": 1, "sceneId": 1, "preamble": "done", "shots": [],
            "dialogues": [], "transport": "api", "error": None,
        }
        node = h3_director_node.EagleH3DirectorNode()
        with mock.patch.object(h3_director_node, "run_director_skill", return_value=fake_result), \
             mock.patch.object(h3_director_node, "compile_h3_params") as compile_plan:
            outputs = node.execute(
                h3_state=json.dumps(state), skill_request=json.dumps(request), node_id="test"
            )
        self.assertEqual(8, len(outputs))
        self.assertTrue(all(isinstance(value, ExecutionBlocker) for value in outputs))
        compile_plan.assert_not_called()

    def test_eagle_local_llm_release_drops_cache_and_linked_handle_refs(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        model, processor = object(), object()
        local_llm_node._MODEL_CACHE["test"] = (model, processor)
        handle = {"backend": "transformers", "model": model, "processor": processor, "path": "x"}
        released = local_llm_node.release_local_model_handle(handle, clear_cuda_cache=False)
        self.assertGreaterEqual(released["released"], 1)
        self.assertFalse(local_llm_node._MODEL_CACHE)
        self.assertIsNone(handle["model"])
        self.assertIsNone(handle["processor"])
        self.assertTrue(handle["released"])

    def test_eagle_local_llm_rehydrates_released_transformers_handle(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        handle = {
            "backend": "transformers", "model": None, "processor": None,
            "path": "x", "device": "cpu", "dtype": "fp32", "released": True,
        }
        restored_model, restored_processor = object(), object()
        with mock.patch.object(
            local_llm_node, "_load_local_model",
            return_value=(restored_model, restored_processor),
        ) as loader:
            returned = local_llm_node.ensure_local_model_handle(handle)
        self.assertIs(returned, handle)
        self.assertIs(handle["model"], restored_model)
        self.assertIs(handle["processor"], restored_processor)
        self.assertFalse(handle["released"])
        loader.assert_called_once_with("x", "cpu", "fp32")

    def test_eagle_local_llm_prefers_eagle_model_over_qwen_and_internal_path(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        eagle_llm = object()
        qwen_llm = object()

        class QwenHandle:
            llm = qwen_llm
            settings = {}
            path = "qwen.gguf"

        node = local_llm_node.EagleLocalLLMNode()
        with mock.patch.object(
            local_llm_node, "_run_llamacpp_inference",
            return_value=("外接模型结果", "", 0.01),
        ) as inference, mock.patch.object(
            local_llm_node, "_normalize_model_path",
            side_effect=AssertionError("外接模型有效时不应读取 model_path"),
        ):
            result = node.process(
                model_path="internal-model", device="cpu", dtype="fp32",
                prompt_model_type="自然语言", system_template="image_expert",
                system_prompt="", user_prompt="测试", filter_intro=False,
                max_new_tokens=32, temperature=0.1, top_p=1.0,
                do_sample=False, repetition_penalty=1.0,
                batch_mode="first", max_image_size=512, seed=-1,
                output_think=False,
                model={"backend": "llama.cpp", "llm": eagle_llm, "path": "eagle.gguf"},
                qwen_model=QwenHandle(),
            )

        self.assertIs(inference.call_args.args[0], eagle_llm)
        self.assertEqual("外接模型结果", result[0])
        self.assertIn("来源:外部加载器(llama.cpp)", result[1])

    def test_eagle_local_llm_accepts_current_qwen_te_handle_contract(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        external_llm = object()

        class QwenHandle:
            llm = external_llm
            settings = {
                "family": "Qwen3.5-VL",
                "model": "qwen3.5llm/Qwen3.5-4B-Q4_K_M.gguf",
                "mmproj": "qwen3.5llm/3.5mmproj-BF16.gguf",
                "think": False,
                "thinking_budget": 4096,
            }

        with mock.patch.object(
            local_llm_node, "_run_llamacpp_inference",
            return_value=("外部 TE 结果", "", 0.02),
        ) as inference:
            result = local_llm_node.EagleLocalLLMNode().process(
                model_path="", device="cpu", dtype="fp32",
                prompt_model_type="自然语言", system_template="image_expert",
                system_prompt="", user_prompt="测试", filter_intro=False,
                max_new_tokens=32, temperature=0.1, top_p=1.0,
                do_sample=False, repetition_penalty=1.0,
                batch_mode="first", max_image_size=512, seed=-1,
                output_think=False, qwen_model=QwenHandle(),
            )

        self.assertIs(inference.call_args.args[0], external_llm)
        self.assertEqual("外部 TE 结果", result[0])
        self.assertIn("来源:TE加载器(QWENLLAMA)", result[1])

    def test_eagle_local_llm_does_not_silently_fallback_from_invalid_external_handle(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        node = local_llm_node.EagleLocalLLMNode()
        with mock.patch.object(local_llm_node, "_normalize_model_path") as normalize:
            result = node.process(
                model_path="internal-model", device="cpu", dtype="fp32",
                prompt_model_type="自然语言", system_template="image_expert",
                system_prompt="", user_prompt="测试", filter_intro=False,
                max_new_tokens=32, temperature=0.1, top_p=1.0,
                do_sample=False, repetition_penalty=1.0,
                batch_mode="first", max_image_size=512, seed=-1,
                output_think=False, model={},
            )

        normalize.assert_not_called()
        self.assertIn("外部加载器未提供有效模型句柄", result[1])
        self.assertIn("不会静默回退", result[1])

    def test_local_llm_loader_optional_probe_exercises_downstream_path(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        handle = {"backend": "llama.cpp", "llm": object(), "path": "model.gguf", "mmproj": "vision.gguf"}
        with mock.patch.object(
            local_llm_node.EagleLocalLLMNode, "process",
            return_value=("OK", "✅ test", ""),
        ) as process:
            probe = local_llm_node._probe_local_model_handle(handle)
        self.assertTrue(probe["passed"])
        self.assertEqual("vision", probe["kind"])
        self.assertIsNotNone(process.call_args.kwargs["image_1"])
        self.assertIs(process.call_args.kwargs["model"], handle)

    def test_local_llm_loader_reports_real_inference_validation(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        handle = {"backend": "llama.cpp", "llm": object(), "path": "model.gguf", "mmproj": None}
        with mock.patch.object(local_llm_node, "_resolve_model_path_by_name", return_value="model.gguf"), \
             mock.patch.object(local_llm_node.os.path, "exists", return_value=True), \
             mock.patch.object(local_llm_node, "_create_llamacpp_handle", return_value=handle), \
             mock.patch.object(local_llm_node, "_probe_local_model_handle", return_value={
                 "passed": True, "kind": "text", "elapsed": 0.02, "sample": "OK",
             }):
            result = local_llm_node.EagleLocalLLMLoader().load(
                "自动探测", "model.gguf", "无", False, False,
                8192, -1, "默认(F16)", "默认(F16)", False, 0, "xhigh",
                validation_mode="最小推理校验",
            )
        self.assertIs(result[0], handle)
        self.assertTrue(result[0]["validation"]["passed"])
        self.assertIn("推理校验=通过", result[1])
        self.assertIn("视觉=未绑定（仅文本）", result[1])

    def test_local_llm_loader_gguf_call_matches_real_handle_signature(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        captured = {}

        # Keep an explicit signature here.  A generic Mock accepts arbitrary
        # keywords and previously hid the production-only ``enable_thinking``
        # TypeError that made the loader return an empty handle in ~0.1 s.
        def create_handle(
            gguf_path, mmproj_path, n_ctx=8192, n_gpu_layers=-1,
            kv_cache_type_k="默认(F16)", kv_cache_type_v="默认(F16)",
            thinking=False, thinking_budget=4096, model_series="Auto",
            keep_history_think=False, moe_experts_on_cpu=False,
            first_n_layers_on_cpu=0, qwen38_reasoning_effort="xhigh",
        ):
            captured.update(locals())
            return {
                "backend": "llama.cpp", "llm": object(), "path": gguf_path,
                "mmproj": mmproj_path, "model_series": model_series,
            }

        with mock.patch.object(
            local_llm_node, "_resolve_model_path_by_name",
            side_effect=lambda value: str(value),
        ), mock.patch.object(
            local_llm_node, "_create_llamacpp_handle", side_effect=create_handle,
        ), mock.patch.object(
            local_llm_node.os.path, "exists", return_value=True,
        ):
            handle, status = local_llm_node.EagleLocalLLMLoader().load(
                "自动探测", "Qwen3.5-4B-Q8_K_XL.gguf", "3.5mmproj-BF16.gguf",
                False, False, 8192, -1, "默认(F16)", "默认(F16)", False, 0,
                "xhigh", validation_mode="仅加载",
            )

        self.assertIsNotNone(handle["llm"])
        self.assertEqual("Qwen3.5-VL", captured["model_series"])
        self.assertFalse(captured["thinking"])
        self.assertIn("已加载", status)

    def test_local_llm_loader_rejects_missing_selected_mmproj(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        def resolve(value):
            return "model.gguf" if value == "model.gguf" else ""

        with mock.patch.object(local_llm_node, "_resolve_model_path_by_name", side_effect=resolve), \
             mock.patch.object(local_llm_node.os.path, "exists", side_effect=lambda value: value == "model.gguf"), \
             mock.patch.object(local_llm_node, "_create_llamacpp_handle") as create, \
             self.assertRaisesRegex(RuntimeError, "已选择 mmproj"):
            local_llm_node.EagleLocalLLMLoader().load(
                "自动探测", "model.gguf", "missing-mmproj.gguf", False, False,
                8192, -1, "默认(F16)", "默认(F16)", False, 0, "xhigh",
            )
        create.assert_not_called()

    def test_local_llm_loader_reports_stale_workflow_selection_with_candidates(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        with mock.patch.object(
            local_llm_node, "_resolve_model_path_by_name",
            return_value="Qwen3.5-4B-UD-Q8_K_XL.gguf",
        ), mock.patch.object(
            local_llm_node, "_list_loader_model_entries",
            return_value=(
                ["qwen3.5llm/Qwen3.5-4B-Q4_K_M.gguf", "gemma4/gemma4-12b.gguf"],
                ["D:/models/qwen.gguf", "D:/models/gemma.gguf"],
            ),
        ), self.assertRaisesRegex(
            RuntimeError, "模型选项已失效.*Qwen3.5-4B-Q4_K_M"
        ):
            local_llm_node.EagleLocalLLMLoader().load(
                "自动探测", "Qwen3.5-4B-UD-Q8_K_XL.gguf", "无", False, False,
                8192, -1, "默认(F16)", "默认(F16)", False, 0, "xhigh",
            )

    def test_local_llm_resolves_unique_model_basename_after_folder_move(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        moved = os.path.normpath("D:/models/LLM/qwen/Qwen3.5-4B-Q4_K_M.gguf")
        with mock.patch.object(local_llm_node, "_get_model_search_roots", return_value=[]), \
             mock.patch.object(local_llm_node, "_scan_local_models", return_value=[]), \
             mock.patch.object(local_llm_node, "_scan_gguf_models", return_value=[(moved, "D:/models/LLM")]), \
             mock.patch.object(local_llm_node, "_scan_mmproj_models", return_value=[]), \
             mock.patch.object(local_llm_node.os.path, "isfile", return_value=False), \
             mock.patch.object(local_llm_node.os.path, "isdir", return_value=False), \
             mock.patch.object(local_llm_node.os.path, "exists", return_value=False):
            resolved = local_llm_node._resolve_model_path_by_name("Qwen3.5-4B-Q4_K_M.gguf")

        self.assertEqual(moved, resolved)

    def test_local_llm_auto_detects_gemma_from_model_or_mmproj_name(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        self.assertEqual(
            "Gemma4",
            local_llm_node._infer_llamacpp_model_series(
                "gemma-4-12b-it-Q8_0.gguf", "mmproj-model-f16.gguf"
            ),
        )

    def test_local_llm_detects_compact_qwen_mmproj_names_and_rejects_mismatch(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        self.assertEqual(
            "Qwen3.5-VL",
            local_llm_node._infer_series_hint("qwen3.5llm/3.5mmproj-BF16.gguf"),
        )
        actual, error = local_llm_node._resolve_model_series(
            "Qwen3.6-VL",
            "Qwen3.5-4B-Q4_K_M.gguf",
            "3.5mmproj-BF16.gguf",
        )
        self.assertEqual("Qwen3.6-VL", actual)
        self.assertIn("自动识别为 Qwen3.5-VL", error)

        _actual, conflict = local_llm_node._resolve_model_series(
            "Auto",
            "Qwen3.5-4B-Q4_K_M.gguf",
            "qwen3.6-mmproj-BF16.gguf",
        )
        self.assertIn("主模型识别为 Qwen3.5-VL", conflict)
        self.assertIn("mmproj 识别为 Qwen3.6-VL", conflict)

    def test_local_llm_auto_matches_only_unambiguous_projection(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        main = os.path.normpath("D:/models/qwen/Qwen3.5-4B-Q4_K_M.gguf")
        projection = os.path.normpath("D:/models/qwen/3.5mmproj-BF16.gguf")
        elsewhere = os.path.normpath("D:/models/other/qwen3.5-mmproj-f16.gguf")
        with mock.patch.object(
            local_llm_node,
            "_scan_mmproj_models",
            return_value=[(projection, "D:/models"), (elsewhere, "D:/models")],
        ):
            matched, note = local_llm_node._auto_match_mmproj(main)
        self.assertEqual(projection, matched)
        self.assertEqual("自动匹配", note)

        with mock.patch.object(
            local_llm_node,
            "_scan_mmproj_models",
            return_value=[
                (projection, "D:/models"),
                (os.path.normpath("D:/models/qwen/qwen3.5-mmproj-f32.gguf"), "D:/models"),
            ],
        ):
            matched, note = local_llm_node._auto_match_mmproj(main)
        self.assertEqual("", matched)
        self.assertIn("多个 Qwen3.5-VL mmproj", note)

    def test_local_llm_loader_defaults_to_auto_projection_matching(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        choices, options = local_llm_node.EagleLocalLLMLoader.INPUT_TYPES()["required"]["mmproj_path"]
        self.assertEqual(local_llm_node._MMPROJ_AUTO, choices[0])
        self.assertEqual(local_llm_node._MMPROJ_AUTO, options["default"])

    def test_local_llm_rejects_mismatched_te_handle_before_inference(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        class QwenHandle:
            llm = object()
            settings = {
                "family": "Qwen3.6-VL",
                "model": "Qwen3.5-4B-Q4_K_M.gguf",
                "mmproj": "3.5mmproj-BF16.gguf",
            }

        result = local_llm_node.EagleLocalLLMNode().process(
            model_path="", device="cpu", dtype="fp32",
            prompt_model_type="自然语言", system_template="image_expert",
            system_prompt="", user_prompt="测试", filter_intro=False,
            max_new_tokens=32, temperature=0.1, top_p=1.0,
            do_sample=False, repetition_penalty=1.0,
            batch_mode="first", max_image_size=512, seed=-1,
            output_think=False, qwen_model=QwenHandle(),
        )
        self.assertEqual("", result[0])
        self.assertIn("TE qwen_model 配置不一致", result[1])
        self.assertEqual(
            "Gemma3",
            local_llm_node._infer_llamacpp_model_series(
                "vision-model.gguf", "gemma-3-mmproj-f16.gguf"
            ),
        )

    def test_local_llm_gemma4_builds_model_specific_vision_handler(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        calls = {}

        class FakeGemma4Handler:
            def __init__(self, mmproj_path=None, **kwargs):
                calls["mmproj_path"] = mmproj_path
                calls.update(kwargs)

        with tempfile.NamedTemporaryFile(suffix=".gguf") as projection, \
             mock.patch.object(local_llm_node, "Gemma4ChatHandler", FakeGemma4Handler):
            handler = local_llm_node._create_chat_handler(
                projection.name, "Gemma4", False, False
            )

        self.assertIsInstance(handler, FakeGemma4Handler)
        self.assertEqual(projection.name, calls["mmproj_path"])
        self.assertFalse(calls["enable_thinking"])

    def test_local_llm_generic_mmproj_uses_supported_parameter_name(self):
        from eagle_suite_test_package.eagle_suite import local_llm_node

        captured = {}
        fake_module = types.ModuleType("llama_cpp")

        class FakeLlama:
            def __init__(self, **kwargs):
                captured.update(kwargs)

        fake_module.Llama = FakeLlama
        with tempfile.NamedTemporaryFile(suffix=".gguf") as model_file, \
             tempfile.NamedTemporaryFile(suffix=".gguf") as projection, \
             mock.patch.dict(sys.modules, {"llama_cpp": fake_module}), \
             mock.patch.object(local_llm_node, "_resolve_model_path_by_name", return_value=projection.name), \
             mock.patch.object(local_llm_node, "_create_chat_handler", return_value=None):
            handle = local_llm_node._create_llamacpp_handle(
                model_file.name, projection.name, model_series="Other"
            )

        self.assertEqual(projection.name, captured["mmproj_path"])
        self.assertNotIn("mmproj", captured)
        self.assertEqual(projection.name, handle["mmproj"])

    def test_save_nodes_share_multiline_metadata_and_star_choices(self):
        from eagle_suite_test_package.eagle_suite.eagle_saver import EagleSaver
        from eagle_suite_test_package.eagle_suite.video_nodes import (
            EagleImagesToVideo,
            EagleVideoConverter,
        )

        for node_class in (EagleSaver, EagleImagesToVideo, EagleVideoConverter):
            optional = node_class.INPUT_TYPES()["optional"]
            self.assertTrue(optional["tags"][1]["multiline"])
            self.assertTrue(optional["annotation"][1]["multiline"])
            choices, options = optional["star"]
            self.assertEqual("0 ☆☆☆☆☆", options["default"])
            self.assertEqual("5 ★★★★★", choices[-1])
        image_order = list(EagleSaver.INPUT_TYPES()["optional"])
        self.assertLess(image_order.index("star"), image_order.index("tags"))
        self.assertLess(image_order.index("tags"), image_order.index("annotation"))

    def test_multi_text_switch_defaults_to_all_output(self):
        from eagle_suite_test_package.eagle_suite.text_switch_node import EagleTextSwitchMulti

        choices, options = EagleTextSwitchMulti.INPUT_TYPES()["required"]["模式"]
        self.assertEqual("输出全部", choices[0])
        self.assertEqual("输出全部", options["default"])

    def test_local_llm_frontend_disables_internal_model_controls_when_linked(self):
        source = (REPO / "web" / "js" / "local_llm_source_state.js").read_text(encoding="utf-8")
        self.assertIn('new Set(["model_path", "device", "dtype"])', source)
        self.assertIn('hasLink(node, "model")', source)
        self.assertIn('hasLink(node, "qwen_model")', source)
        self.assertIn("widget.options.disabled = disabled", source)
        self.assertIn("外部模型接管", source)

    def test_api_unified_is_text_only_output_node(self):
        from eagle_suite_test_package.eagle_suite.api_model_loader import EagleAPIUnifiedNode
        self.assertEqual(("STRING", "STRING", "STRING"), EagleAPIUnifiedNode.RETURN_TYPES)
        self.assertEqual(("输出结果", "状态信息", "对话历史"), EagleAPIUnifiedNode.RETURN_NAMES)

    def test_director_media_ports_are_split(self):
        from eagle_suite_test_package.eagle_suite.h3_director_node import (
            EagleH3DirectorNode,
            EagleH3MediaBridgeNode,
            H3_MEDIA_BUNDLE_TYPE,
        )
        self.assertEqual(
            ("plan", "summary", "clip_count", "width", "height", "video_blend_frames"),
            EagleH3DirectorNode.RETURN_NAMES[:6],
        )
        self.assertEqual(H3_MEDIA_BUNDLE_TYPE, EagleH3DirectorNode.RETURN_TYPES[6])
        self.assertEqual("media_bundle", EagleH3DirectorNode.RETURN_NAMES[6])
        self.assertEqual("context_loop_plan_json", EagleH3DirectorNode.RETURN_NAMES[7])
        self.assertEqual(8, len(EagleH3DirectorNode.RETURN_TYPES))
        self.assertEqual(8, len(EagleH3DirectorNode.OUTPUT_TOOLTIPS))
        self.assertEqual("first_reference_image", EagleH3MediaBridgeNode.RETURN_NAMES[1])
        self.assertEqual("ref_video_0", EagleH3MediaBridgeNode.RETURN_NAMES[2])
        self.assertFalse(EagleH3MediaBridgeNode.OUTPUT_IS_LIST[1])

        frontend = (REPO / "web" / "js" / "h3_pipeline.js").read_text(encoding="utf-8")
        self.assertIn("function repairMediaBridgeSeedLink(graph)", frontend)
        self.assertIn('bridge, "first_reference_image", shot, "seed_image"', frontend)

    def test_legacy_media_ports_are_migrated_by_semantic_output_name(self):
        source = (REPO / "web" / "js" / "h3_pipeline.js").read_text(encoding="utf-8")
        self.assertIn('"EagleH3MediaPortsV2Node"', source)
        self.assertIn('"ref_videos.ref_video_0": "ref_video_0"', source)
        self.assertIn('"ref_audios.ref_audio_2": "ref_audio_2"', source)
        self.assertIn("migrateLegacyMediaPorts();", source)

    def test_director_does_not_reject_long_prompt_by_character_count(self):
        from eagle_suite_test_package.eagle_suite.h3_director_node import _build_plan_preflight

        prompt = (
            "integrated_multimodal_description:\n" + ("镜头内容 " * 1500) +
            "\noverall_soundscape:\n环境声\n"
            "non_diegetic_music:\n无"
        )
        report = _build_plan_preflight(
            {"mode": "t2v", "referencePolicy": "off"},
            {"shots": [{
                "id": "scene_01", "prompt": prompt,
                "raw_frames": 73, "delivered_frames": 73,
                "generation_start_frame": 0, "duration_seconds": 4,
            }]},
        )
        messages = list(report.get("errors", [])) + list(report.get("warnings", []))
        self.assertFalse(any("H3-E001" in item or "7000" in item for item in messages))

    def test_director_creates_explicit_context_loop_authoring_source(self):
        source = (REPO / "web" / "js" / "h3_pipeline.js").read_text(encoding="utf-8")
        self.assertIn('createH3Node(graph, "MiniMaxH3ChainPlan"', source)
        self.assertIn("创建 Context Loop 兼容编辑链", source)
        self.assertNotIn("migrateDirectorContextLoopLinks", source)
        self.assertNotIn("installContextLoopAutoBridge", source)
        self.assertNotIn("eagleDirectorPlanBridge", source)

    def test_h3_interop_nodes_have_director_quick_add_actions(self):
        source = (REPO / "web" / "js" / "h3_pipeline.js").read_text(encoding="utf-8")
        self.assertIn('"EagleH3PlanInteropNode"', source)
        self.assertIn('"EagleH3StateInteropNode"', source)
        self.assertIn('"EagleH3MediaBridgeNode"', source)
        self.assertIn("添加计划 JSON 互操作桥", source)
        self.assertIn("添加状态 / 上一片段互操作桥", source)
        self.assertIn("添加标准媒体桥", source)
        director_source = (REPO / "web" / "js" / "h3_director.js").read_text(encoding="utf-8")
        self.assertIn('_h3ContextLoopPlanJson', director_source)
        self.assertIn('prompt: compilePrompt(sourceProject, scene)', director_source)

    def test_director_execution_publishes_exact_context_loop_preview_json(self):
        from eagle_suite_test_package.eagle_suite.h3_director_node import EagleH3DirectorNode

        state = {
            "project": {"fps": 24, "globalDuration": 3, "globalSteps": 8},
            "scenes": [{"id": 1, "title": "测试", "defaultSeconds": 3, "preamble": "镜头内容"}],
        }
        output = EagleH3DirectorNode().execute(h3_state=json.dumps(state))
        self.assertIsInstance(output, dict)
        self.assertEqual(8, len(output["result"]))
        self.assertEqual(
            output["result"][-1],
            output["ui"]["h3_context_loop_plan_json"][0],
        )

    def test_director_timecodes_and_timeline_are_frame_addressable(self):
        from eagle_suite_test_package.eagle_suite.h3_director_node import (
            _format_h3_timecode,
            _parse_h3_timecode,
            _scene_shot_timeline,
        )

        self.assertEqual(3723.456, _parse_h3_timecode("01:02:03.456"))
        self.assertEqual("01:00.000", _format_h3_timecode(59.9996))
        timeline = _scene_shot_timeline({
            "defaultSeconds": 10,
            "shots": [
                {"id": 1, "time": "00:00.000"},
                {"id": 2, "time": "00:05.000"},
            ],
        }, 24)
        self.assertEqual("00:00.000", timeline[0]["start_timecode"])
        self.assertEqual("00:05.000", timeline[0]["end_timecode"])
        self.assertEqual(120, timeline[0]["frame_count"])
        self.assertEqual(120, timeline[0]["end_frame_exclusive"])
        self.assertEqual("00:10.000", timeline[1]["end_timecode"])

    def test_director_plan_separates_editorial_and_h3_generated_duration(self):
        from eagle_suite_test_package.eagle_suite.h3_director_node import compile_h3_params

        project = {"fps": 24, "globalDuration": 5, "globalSteps": 8}
        scenes = [{
            "id": 1,
            "title": "timing",
            "defaultSeconds": 5,
            "preamble": "scene",
            "shots": [{"id": 1, "time": "00:00.000", "content": "one"}],
        }]
        shot = compile_h3_params(project, scenes)["shots"][0]
        self.assertEqual(5, shot["duration_seconds"])
        self.assertEqual(120, shot["timeline_frames"])
        self.assertEqual("00:05.000", shot["timeline_end_timecode"])
        self.assertEqual(124, shot["raw_frames"])
        self.assertAlmostEqual(124 / 24, shot["generated_duration_seconds"])
        self.assertEqual(120, shot["shot_timeline"][0]["frame_count"])

    def test_director_context_loop_plan_json_does_not_duplicate_shared_prompt(self):
        from eagle_suite_test_package.eagle_suite.h3_director_node import export_context_loop_plan_json

        payload = json.loads(export_context_loop_plan_json({
            "prompt_prefix": "shared world",
            "defaults": {"duration_seconds": 6, "steps": 8},
            "shots": [{
                "id": "scene_01", "scene_prompt": "scene-only prompt",
                "prompt": "shared world\n\nscene-only prompt", "raw_frames": 124,
                "seed": 42, "steps": 8,
            }],
        }))
        self.assertEqual("shared world", payload["prompt_prefix"])
        self.assertEqual("scene-only prompt", payload["shots"][0]["prompt"])
        self.assertNotIn("shared world", payload["shots"][0]["prompt"])

    def test_director_skill_prompts_use_scene_duration_without_size_duplication(self):
        from eagle_suite_test_package.eagle_suite.h3_director_node import _build_skill_prompts

        project = {"aspect": "9:16", "resolution": "720p", "foundation": "world 100% real"}
        scene = {
            "title": "雨夜追逐",
            "defaultSeconds": 18,
            "preamble": "[Shot 1] A runner crosses the street.",
        }
        for task in ("script", "shots", "dialogue"):
            _system, user = _build_skill_prompts(task, project, scene, "", request={})
            self.assertIn("【场景时长预算】18 秒", user)
            self.assertNotIn("9:16", user)
            self.assertNotIn("720p", user)
        _system, script = _build_skill_prompts("script", project, scene, "", request={})
        self.assertNotIn("单镜头约 10 秒", script)
        self.assertIn("不要套用固定的 10 秒单镜头假设", script)
        _system, shots = _build_skill_prompts("shots", project, scene, "", request={})
        self.assertIn("estSeconds 之和约等于 18 秒", shots)
        self.assertIn("MM:SS.mmm --> MM:SS.mmm", script)
        self.assertIn("帧区间使用半开区间 [start,end)", shots)

    def test_director_frontend_uses_precise_frame_timing_helpers(self):
        source = (REPO / "web" / "js" / "h3_director.js").read_text(encoding="utf-8")
        self.assertIn("function parseTimecode(value)", source)
        self.assertIn("function buildShotTimings(scene, fps, equalDistribution)", source)
        self.assertIn("endFrameExclusive", source)
        self.assertNotIn("prev.time.replace(':','.')", source)

    def test_director_frontend_uses_exact_size_table_and_flushes_saved_state(self):
        source = (REPO / "web" / "js" / "h3_director.js").read_text(encoding="utf-8")
        for preset in (
            "16:9|mp0.2|608|352", "16:9|mp0.5|960|544",
            "16:9|mp0.98|1344|768", "16:9|mp2.0|1920|1088",
            "9:16|mp0.5|544|960", "9:16|mp2.0|1088|1920",
        ):
            self.assertIn(preset, source)
        self.assertIn('option value="custom"', source)
        self.assertIn("function onCustomDimension(axis)", source)
        self.assertIn("async beforePromptQueued()", source)
        self.assertIn("props.node._h3FlushState", source)
        self.assertIn("generationInfo.deliveredFrames", source)
        statusbar = source.split('<div class="h3d-statusbar">', 1)[1].split("</div>", 1)[0]
        self.assertIn("场景队列", statusbar)
        self.assertNotIn("store.project.width", statusbar)
        self.assertNotIn("store.project.height", statusbar)

    def test_character_interaction_skill_distinguishes_live_action_and_anime(self):
        skills = json.loads(
            (REPO / "eagle_suite" / "skills" / "director_skills.json").read_text(encoding="utf-8")
        )
        content = skills["pro-v2-h3-character-interaction-automation"]["content"]
        self.assertIn("##### 表现风格", content)
        self.assertIn("`live_action`", content)
        self.assertIn("`anime`", content)
        self.assertIn("严格保留 2D/cel/anime", content)

    def test_director_frontend_exposes_character_pv_motion_graphics_project(self):
        source = (REPO / "web" / "js" / "h3_director.js").read_text(encoding="utf-8")
        self.assertIn("function defaultPv()", source)
        self.assertIn("function buildPvDirective(project, scene)", source)
        self.assertIn('option value="character_pv"', source)
        self.assertIn("角色 PV · 类 AE 动效规划", source)
        self.assertIn("post_production 元数据", source)
        for effect in ("flash_cut", "mask_wipe", "deep_glow", "pixel_sort", "jpeg_glitch"):
            self.assertIn(effect, source)

        skills = json.loads(
            (REPO / "eagle_suite" / "skills" / "director_skills.json").read_text(encoding="utf-8")
        )
        skill = skills["pro-v3-h3-character-pv-motion-graphics"]
        self.assertEqual("character_pv_motion_graphics", skill["category"])
        self.assertIn("post_production_cues", skill["content"])

    def test_pv_creative_cards_are_deterministic_bounded_and_history_aware(self):
        from eagle_suite_test_package.eagle_suite import h3_director_node

        first = h3_director_node.generate_pv_cards(
            "anime sword warrior with a flowing cape", "fast character reveal",
            card_count=3, seed=81, model_mode="local_only",
        )
        repeated = h3_director_node.generate_pv_cards(
            "anime sword warrior with a flowing cape", "fast character reveal",
            card_count=3, seed=81, model_mode="local_only",
        )
        self.assertEqual(first["cards"], repeated["cards"])
        self.assertEqual("combat", first["selected"]["actionProfile"])
        self.assertTrue(set(first["selected"]["transitions"]).issubset(h3_director_node._PV_TRANSITIONS))
        self.assertTrue(set(first["selected"]["effects"]).issubset(h3_director_node._PV_EFFECTS))

        next_draw = h3_director_node.generate_pv_cards(
            "anime sword warrior with a flowing cape", "fast character reveal",
            card_count=3, seed=81, history=first["history"], model_mode="local_only",
        )
        self.assertNotEqual(first["selected"]["fingerprint"], next_draw["selected"]["fingerprint"])
        self.assertEqual(2, len(next_draw["history"]))

    def test_pv_creative_cards_can_use_attached_model_to_select_candidate(self):
        from eagle_suite_test_package.eagle_suite import h3_director_node

        response = json.dumps({
            "selected_index": 1, "reason": "matches the costume rhythm",
            "action_direction": "turn, reveal the prop, then settle into a distinct hero pose",
            "title_concept": "post-only diagonal nameplate",
        })
        with mock.patch.object(h3_director_node, "_call_llm", return_value=response):
            draw = h3_director_node.generate_pv_cards(
                "fashion idol", "editorial PV", card_count=3, seed=9,
                model_mode="model_refine", local_model={"path": "fake.gguf"},
            )
        self.assertEqual(1, draw["selected_index"])
        self.assertEqual("local", draw["transport"])
        self.assertIn("distinct hero pose", draw["selected"]["actionDirection"])
        self.assertIn("Do not paint exact text", draw["selected"]["directorSkill"])

    def test_pv_card_node_is_registered_at_h3_level(self):
        node = PACKAGE.NODE_CLASS_MAPPINGS["EagleH3PVCreativeCardsNode"]
        self.assertEqual("🦅 Eagle Suite/H3 导演台", node.CATEGORY)
        self.assertEqual(
            ("pv_cards_json", "selected_card_json", "director_skill", "history_json", "summary"),
            node.RETURN_NAMES,
        )
        source = (REPO / "web" / "js" / "h3_director.js").read_text(encoding="utf-8")
        self.assertIn("🎴 AI 创意抽卡", source)
        self.assertIn("operation:'pv_draw'", source)
        self.assertIn("generationHistory", source)

    def test_director_generation_memory_reaches_next_scene_prompt(self):
        from eagle_suite_test_package.eagle_suite.h3_director_node import (
            _build_skill_prompts, _generation_memory_context,
        )

        scenes = [
            {"id": "s1", "title": "first", "shots": [{
                "action": "raises the sword and turns left", "camera": "fast Arc Shot",
                "transitionOut": "flash_cut",
            }]},
            {"id": "s2", "title": "second", "defaultSeconds": 5, "shots": []},
        ]
        project = {
            "generationHistory": [{
                "sceneId": "s1", "actions": ["raises the sword and turns left"],
                "cameras": ["fast Arc Shot"], "transitions": ["flash_cut"],
            }],
            "pv": {"history": [{
                "theme": "dark_rival", "visualStyle": "anime_cel",
                "editGrammar": "match_on_action", "actionProfile": "combat",
            }]},
        }
        memory = _generation_memory_context(project, scenes, 1)
        self.assertIn("创作记忆 / 去重复约束", memory)
        self.assertIn("raises the sword", memory)
        self.assertIn("dark_rival/anime_cel/match_on_action/combat", memory)
        _system, user = _build_skill_prompts(
            "shots", project, scenes[1], "", request={"_memoryContext": memory}
        )
        self.assertIn("禁止仅替换同义词制造伪变化", user)

    def test_director_skill_extraction_generalizes_video_editing_prompt(self):
        from eagle_suite_test_package.eagle_suite.h3_director_node import _build_skill_extraction_prompts

        project = {"media": [
            {"type": "image", "name": "hero.png", "role": "identity"},
            {"type": "video", "name": "motion.mp4", "role": "motion", "useEmbeddedAudio": False},
        ]}
        scene = {"preamble": "<Picture 1> owns identity; <Video 1> owns camera motion."}
        system, user = _build_skill_extraction_prompts(project, scene, scene["preamble"])
        self.assertIn("reusable H3 Director Skill", system)
        self.assertIn("media pixels are not inspected", user)
        self.assertIn("Immutable Locks", user)
        self.assertIn("Motion/Camera Transfer", user)
        self.assertIn("<Video 1>", user)

    def test_director_skill_extraction_returns_editable_draft(self):
        from eagle_suite_test_package.eagle_suite import h3_director_node

        project = {}
        scenes = [{"id": 1, "title": "edit", "preamble": "source prompt"}]
        request = {"sceneId": 1, "operation": "extract_skill", "modelPref": "local"}
        local_model = {"path": "fake.gguf"}
        response = json.dumps({
            "name": "参考视频改图", "category": "video_to_image_editing",
            "tasks": ["script", "shots"], "tags": ["identity-lock"],
            "content": "## Purpose\nTransfer motion while preserving identity.",
        })
        with mock.patch.object(h3_director_node, "_call_llm", return_value=response):
            result = h3_director_node.run_director_skill(
                project, scenes, request, local_model=local_model
            )
        self.assertIsNone(result["error"])
        self.assertEqual("extract_skill", result["operation"])
        self.assertEqual("参考视频改图", result["skillDraft"]["name"])
        self.assertIn("preserving identity", result["skillDraft"]["content"])

    def test_director_skill_separates_visual_and_dialogue_languages(self):
        from eagle_suite_test_package.eagle_suite.h3_director_node import _build_skill_prompts

        scene = {"title": "雨夜", "defaultSeconds": 6, "preamble": ""}
        request = {"promptLanguage": "en", "dialogueLanguage": "Chinese"}
        _system, script = _build_skill_prompts("script", {}, scene, "", request=request)
        self.assertIn("统一使用 English", script)
        self.assertIn("<d>[Chinese] 原文</d>", script)
        self.assertIn("Tracking Shot", script)
        self.assertNotIn("[Tracking shot]", script)
        _system, chinese = _build_skill_prompts(
            "shots", {}, scene, "", request={"promptLanguage": "zh", "dialogueLanguage": "Japanese"}
        )
        self.assertIn("统一使用 简体中文", chinese)
        self.assertIn("<d>[Japanese] 原文</d>", chinese)

    def test_chained_skill_tasks_keep_scene_metadata(self):
        from eagle_suite_test_package.eagle_suite import h3_director_node

        prompts = []
        responses = iter([
            '{"preamble":"[Shot 1] generated"}',
            '{"shots":[{"content":"generated shot","estSeconds":18}]}',
        ])

        def fake_call(_kind, _transport, _system, user, _temperature):
            prompts.append(user)
            return next(responses)

        scene = {"id": 7, "title": "雨夜追逐", "defaultSeconds": 18,
                 "preamble": "", "shots": [], "dialogues": []}
        request = {"sceneId": 7, "tasks": ["script", "shots"], "modelPref": "api"}
        with mock.patch.object(h3_director_node, "_select_transport", return_value=("api", {})), \
             mock.patch.object(h3_director_node, "_call_llm", side_effect=fake_call):
            result = h3_director_node.run_director_skill({}, [scene], request)

        self.assertIsNone(result["error"])
        self.assertEqual(2, len(prompts))
        self.assertIn("【场景标题】雨夜追逐", prompts[1])
        self.assertIn("【场景时长预算】18 秒", prompts[1])

    def test_skill_generation_orders_tasks_and_passes_references_and_shots(self):
        from eagle_suite_test_package.eagle_suite import h3_director_node

        prompts = []
        responses = iter([
            '{"preamble":"Use <Picture 1>. <d>[Nali] 走吧</d>"}',
            '{"shots":[{"content":"Nali continues walking","estSeconds":8}]}',
            '{"dialogues":[{"role":"Nali","text":"走吧","time":"00:01.000"}]}',
        ])

        def fake_call(_kind, _transport, _system, user, _temperature):
            prompts.append(user)
            return next(responses)

        project = {"mediaRefs": [{
            "id": "nali", "type": "image", "filename": "nali.png",
            "name": "Nali", "kind": "person", "retention": "fully_preserved",
        }]}
        scenes = [
            {"id": 1, "title": "开场", "defaultSeconds": 8,
             "preamble": "", "shots": [], "dialogues": []},
            {"id": 2, "title": "续场", "defaultSeconds": 8,
             "preamble": "", "shots": [], "dialogues": []},
        ]
        request = {"sceneId": 2, "tasks": ["dialogue", "shots", "script"], "modelPref": "api"}
        with mock.patch.object(h3_director_node, "_select_transport", return_value=("api", {})), \
             mock.patch.object(h3_director_node, "_call_llm", side_effect=fake_call):
            result = h3_director_node.run_director_skill(project, scenes, request)

        self.assertIsNone(result["error"])
        self.assertIn("<Picture 1>: image | subject_person | Nali", prompts[0])
        self.assertIn("上一场景：开场", prompts[0])
        self.assertIn("【已生成分镜】", prompts[2])
        self.assertIn("Nali continues walking", prompts[2])

    def test_skill_generation_rejects_stale_scene_id(self):
        from eagle_suite_test_package.eagle_suite import h3_director_node

        request = {"sceneId": 999, "tasks": ["script"], "modelPref": "api"}
        with mock.patch.object(h3_director_node, "_select_transport", return_value=("api", {})), \
             mock.patch.object(h3_director_node, "_call_llm") as call:
            result = h3_director_node.run_director_skill({}, [{"id": 1}], request)
        self.assertIn("sceneId", result["error"])
        call.assert_not_called()

    def test_filename_prefix_is_contained(self):
        from eagle_suite_test_package.eagle_suite.utils import generate_unique_filename
        name = generate_unique_filename(r"..\outside/evil", "png")
        self.assertEqual(name, os.path.basename(name))
        self.assertTrue(name.endswith(".png"))

    def test_media_path_allowlist_blocks_escape(self):
        from eagle_suite_test_package.tools_utils import resolve_allowed_media_path
        with tempfile.TemporaryDirectory() as allowed, tempfile.TemporaryDirectory() as outside:
            inside_file = pathlib.Path(allowed, "inside.wav")
            outside_file = pathlib.Path(outside, "outside.wav")
            inside_file.write_bytes(b"RIFF")
            outside_file.write_bytes(b"RIFF")
            previous = os.environ.get("EAGLE_MEDIA_ROOTS")
            os.environ["EAGLE_MEDIA_ROOTS"] = allowed
            try:
                self.assertTrue(resolve_allowed_media_path(str(inside_file), "audio", "file"))
                self.assertEqual("", resolve_allowed_media_path(str(outside_file), "audio", "file"))
            finally:
                if previous is None:
                    os.environ.pop("EAGLE_MEDIA_ROOTS", None)
                else:
                    os.environ["EAGLE_MEDIA_ROOTS"] = previous

    def test_session_media_root_authorization(self):
        from eagle_suite_test_package.tools_utils import (
            authorize_media_root,
            clear_authorized_media_roots,
            resolve_allowed_media_path,
        )
        with tempfile.TemporaryDirectory() as directory:
            media_file = pathlib.Path(directory, "clip.mp4")
            media_file.write_bytes(b"video")
            clear_authorized_media_roots()
            try:
                self.assertEqual("", resolve_allowed_media_path(str(media_file), "all", "file"))
                self.assertTrue(authorize_media_root(directory, "all"))
                self.assertTrue(resolve_allowed_media_path(str(media_file), "all", "file"))
            finally:
                clear_authorized_media_roots()

    def test_video_workflow_metadata_round_trip(self):
        import av
        from eagle_suite_test_package.eagle_suite.utils import get_cached_ffmpeg
        from eagle_suite_test_package.eagle_suite.workflow_metadata import (
            build_workflow_bundle,
            embed_workflow_in_media,
        )
        ffmpeg = get_cached_ffmpeg()
        with tempfile.TemporaryDirectory() as directory:
            video_path = pathlib.Path(directory, "workflow.mp4")
            created = subprocess.run(
                [ffmpeg, "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.2",
                 "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video_path)],
                capture_output=True, check=False,
            )
            self.assertEqual(0, created.returncode)
            workflow = {"last_node_id": 1, "nodes": [], "links": [], "version": 0.4}
            prompt = {"1": {"class_type": "Test", "inputs": {}}}
            result = embed_workflow_in_media(
                video_path, build_workflow_bundle(prompt, {"workflow": workflow}), ffmpeg
            )
            self.assertTrue(result["success"], result["message"])
            with av.open(str(video_path)) as container:
                metadata = {str(k).lower(): str(v) for k, v in container.metadata.items()}
            self.assertEqual(workflow, json.loads(metadata["workflow"]))
            self.assertEqual(prompt, json.loads(metadata["prompt"]))

    def test_video_ports_use_native_comfyui_contract(self):
        from comfy_api.input import VideoInput
        from eagle_suite_test_package.eagle_suite.advanced_video_saver import EagleAdvancedVideoSaver
        from eagle_suite_test_package.eagle_suite.audio_nodes import EagleAudioExtractor
        from eagle_suite_test_package.eagle_suite.batch_video_nodes import (
            EagleBatchVideoLoader,
            EagleVideoFrameExtractor,
            EagleVideoInfo,
            _native_videos,
            _passthrough_video,
        )
        from eagle_suite_test_package.eagle_suite.video_nodes import (
            EagleImagesToVideo,
            EagleVideoConverter,
            _coerce_native_video,
            _native_video,
        )
        from eagle_suite_test_package.eagle_suite.utils import get_cached_ffmpeg

        self.assertEqual(("VIDEO", "VIDEO"), EagleImagesToVideo.RETURN_TYPES[2::2])
        self.assertEqual("VIDEO", EagleImagesToVideo.INPUT_TYPES()["optional"]["input_video"][0])
        self.assertEqual("VIDEO", EagleVideoConverter.INPUT_TYPES()["optional"]["video"][0])
        self.assertEqual("VIDEO", EagleVideoConverter.RETURN_TYPES[3])
        self.assertEqual("VIDEO", EagleBatchVideoLoader.RETURN_TYPES[6])
        self.assertTrue(EagleBatchVideoLoader.OUTPUT_IS_LIST[6])
        self.assertEqual("VIDEO", EagleVideoFrameExtractor.RETURN_TYPES[4])
        self.assertEqual("AUDIO", EagleVideoFrameExtractor.RETURN_TYPES[-1])
        self.assertEqual("VIDEO", EagleVideoInfo.RETURN_TYPES[-1])
        self.assertEqual("VIDEO", EagleAudioExtractor.INPUT_TYPES()["required"]["video_path"][0])
        self.assertEqual(("VIDEO", "VIDEO", "AUDIO"), EagleAdvancedVideoSaver.RETURN_TYPES[:3])

        with tempfile.TemporaryDirectory() as directory:
            video_path = pathlib.Path(directory, "native.mp4")
            created = subprocess.run(
                [get_cached_ffmpeg(), "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.1",
                 "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video_path)],
                capture_output=True, check=False,
            )
            self.assertEqual(0, created.returncode)
            native = _native_video(str(video_path))
            self.assertIsInstance(native, VideoInput)
            self.assertIsInstance(_coerce_native_video(str(video_path)), VideoInput)
            self.assertEqual(1, len(_native_videos([str(video_path)])))
            self.assertIsInstance(_native_videos([str(video_path)])[0], VideoInput)
            self.assertIsInstance(_passthrough_video(str(video_path)), VideoInput)

        error_result = EagleAdvancedVideoSaver._error_result("test")["result"]
        self.assertIsNone(error_result[0])
        self.assertIsNone(error_result[1])

    def test_video_frame_extractor_vue_selection_returns_exact_frames_and_previews(self):
        from eagle_suite_test_package.eagle_suite import batch_video_nodes as video_nodes
        from eagle_suite_test_package.eagle_suite.utils import get_cached_ffmpeg

        inputs = video_nodes.EagleVideoFrameExtractor.INPUT_TYPES()
        self.assertEqual("预览选择", inputs["required"]["time_mode"][0][0])
        self.assertIn("video_file", inputs["required"])
        self.assertIn("video_path", inputs["optional"])
        self.assertIn("selected_frames", inputs["optional"])
        self.assertEqual(0, inputs["required"]["resize_width"][1]["default"])
        self.assertEqual(120, inputs["optional"]["preview_count"][1]["max"])
        self.assertTrue(inputs["optional"]["lock_aspect_ratio"][1]["default"])
        self.assertEqual(["frames", "video", "both"], inputs["optional"]["output_mode"][0])
        self.assertTrue(video_nodes.EagleVideoFrameExtractor.OUTPUT_NODE)
        self.assertEqual([3, 1], video_nodes._selected_frame_indices('[3, 1, 3, 999]', 4))
        self.assertEqual(
            (512, 344),
            video_nodes._resolve_frame_output_size(96, 64, 512, 512, "custom", True, "width"),
        )
        self.assertEqual(
            (768, 512),
            video_nodes._resolve_frame_output_size(96, 64, 512, 512, "custom", True, "height"),
        )

        with tempfile.TemporaryDirectory() as directory:
            video_path = pathlib.Path(directory, "selector.mp4")
            created = subprocess.run(
                [get_cached_ffmpeg(), "-y", "-f", "lavfi", "-i", "testsrc2=s=96x64:r=8:d=1",
                 "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=1",
                 "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(video_path)],
                capture_output=True, check=False,
            )
            self.assertEqual(0, created.returncode, created.stderr.decode("utf-8", errors="replace"))
            preview_root = pathlib.Path(directory, "previews")
            with mock.patch.object(video_nodes, "_FRAME_PREVIEW_ROOT", str(preview_root)), mock.patch.object(
                video_nodes.folder_paths, "get_temp_directory", return_value=directory
            ):
                output = video_nodes.EagleVideoFrameExtractor().extract_frames(
                    str(video_path), "预览选择", 0, 4, 0, 0, True,
                    preview_count=4, selection_mode="multiple", selected_frames="[2, 5]",
                    size_mode="original", trim_start=0.25, trim_end=0.75, extract_audio=True,
                    output_mode="both",
                )

            self.assertIsInstance(output, dict)
            self.assertEqual(4, len(output["ui"]["frame_previews"]))
            self.assertEqual(12, len(output["ui"]["timeline_previews"]))
            self.assertTrue(output["ui"]["waveform_preview"])
            self.assertEqual([2, 5], output["ui"]["selected_frames"])
            self.assertTrue(output["ui"]["video_url"])
            self.assertEqual(96, output["ui"]["video_meta"][0]["width"])
            self.assertEqual(2, len(output["result"][0]))
            self.assertEqual((1, 64, 96, 3), tuple(output["result"][0][0].shape))
            audio = output["result"][5]
            self.assertEqual(44100, audio["sample_rate"])
            self.assertGreater(audio["waveform"].shape[-1], 20000)
            self.assertLess(audio["waveform"].shape[-1], 24000)
            self.assertIsNotNone(output["result"][4])
            self.assertTrue(all((pathlib.Path(directory) / item["subfolder"] / item["filename"]).is_file()
                                for item in output["ui"]["frame_previews"]))
            with mock.patch.object(video_nodes, "_FRAME_PREVIEW_ROOT", str(preview_root)):
                odd_clip, odd_status = video_nodes._create_trimmed_video(
                    str(video_path), 0.0, 0.5, 1.0, 511, 337, True,
                )
            self.assertIsNotNone(odd_clip)
            self.assertIn("510×336", odd_status)

            with mock.patch.object(video_nodes.folder_paths, "get_annotated_filepath", return_value=str(video_path)), mock.patch.object(
                video_nodes, "_FRAME_PREVIEW_ROOT", str(preview_root)
            ), mock.patch.object(video_nodes.folder_paths, "get_temp_directory", return_value=directory):
                direct = video_nodes.EagleVideoFrameExtractor().extract_frames(
                    video_path=None, video_file=video_path.name, time_mode="单帧提取", frame_index=1,
                    sample_count=1, resize_width=0, resize_height=0, preview_strip=False,
                    size_mode="original",
                )
            self.assertEqual((1, 64, 96, 3), tuple(direct["result"][0][0].shape))
            self.assertIsNone(direct["result"][4])

    def test_advanced_video_saver_preview_uses_current_comfyui_ui_contract(self):
        from eagle_suite_test_package.eagle_suite import advanced_video_saver
        with tempfile.TemporaryDirectory() as output_directory, tempfile.TemporaryDirectory() as temp_directory:
            video_path = pathlib.Path(output_directory, "preview.mp4")
            video_path.write_bytes(b"preview-contract")
            with mock.patch.object(
                advanced_video_saver.folder_paths, "get_output_directory", return_value=output_directory
            ), mock.patch.object(
                advanced_video_saver.folder_paths, "get_temp_directory", return_value=temp_directory
            ):
                result = advanced_video_saver.EagleAdvancedVideoSaver()._generate_preview(
                    video_path, "test", video_path.name
                )
            self.assertNotIn("videos", result)
            self.assertEqual("preview.mp4", result["images"][0]["filename"])
            self.assertEqual("video/mp4", result["images"][0]["format"])
            self.assertEqual((True,), result["animated"])

    def test_gif_creates_standard_workflow_png(self):
        from PIL import Image
        from eagle_suite_test_package.eagle_suite.utils import get_cached_ffmpeg
        from eagle_suite_test_package.eagle_suite.workflow_metadata import (
            build_workflow_bundle,
            save_workflow_companion_png,
        )
        workflow = {"last_node_id": 0, "nodes": [], "links": [], "version": 0.4}
        prompt = {"1": {"class_type": "Test", "inputs": {}}}
        with tempfile.TemporaryDirectory() as directory:
            gif_path = pathlib.Path(directory, "animation.gif")
            Image.new("RGB", (32, 32), "black").save(gif_path, format="GIF")
            png_path = save_workflow_companion_png(
                gif_path, build_workflow_bundle(prompt, {"workflow": workflow}), get_cached_ffmpeg()
            )
            self.assertTrue(png_path)
            with Image.open(png_path) as companion:
                self.assertEqual(workflow, json.loads(companion.info["workflow"]))
                self.assertEqual(prompt, json.loads(companion.info["prompt"]))

    def test_route_decorator_is_idempotent(self):
        from eagle_suite_test_package.eagle_suite import route_registry
        before = len(route_registry._route_handlers)

        async def handler(request):
            return request

        route_registry.route("GET", "/__eagle_test_idempotent")(handler)
        route_registry.route("GET", "/__eagle_test_idempotent")(handler)
        self.assertEqual(before + 1, len(route_registry._route_handlers))

    def test_h3_media_upload_routes_are_declared(self):
        from eagle_suite_test_package.eagle_suite import route_registry
        routes = {(method, path) for method, path, _handler in route_registry._route_handlers}
        self.assertIn(("GET", "/h3_director/input_images"), routes)
        self.assertIn(("POST", "/h3_director/upload_media"), routes)
        self.assertIn(("POST", "/h3_director/upload_ref"), routes)

    def test_h3_input_image_listing_and_safe_resolution(self):
        from PIL import Image
        from eagle_suite_test_package.eagle_suite import h3_director_node

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            nested = root / "references"
            nested.mkdir()
            image_path = nested / "hero.png"
            Image.new("RGB", (20, 12), "blue").save(image_path)
            (nested / "ignore.txt").write_text("no", encoding="utf-8")
            with mock.patch.object(h3_director_node, "_comfy_input_root", return_value=root.resolve()):
                response = asyncio.run(h3_director_node.list_input_images(None))
                payload = json.loads(response.body.decode("utf-8"))
                self.assertTrue(payload["success"])
                self.assertEqual(["references/hero.png"], [item["path"] for item in payload["items"]])
                self.assertEqual(str(image_path.resolve()), h3_director_node._media_path("references/hero.png"))
                self.assertEqual("", h3_director_node._media_path("../outside.png"))

    def test_gif_resize_palette_and_frame_skip_duration(self):
        from PIL import Image
        from eagle_suite_test_package.eagle_suite.gif_compressor import GifCompressorNode

        base = torch.linspace(0, 1, 96).view(1, 96, 1).repeat(64, 1, 3)
        gradient = torch.stack([base.roll(index * 7, dims=1) for index in range(6)])
        with tempfile.TemporaryDirectory() as directory:
            _preview, output_path, status = GifCompressorNode().compress_gif(
                gradient, "", 8, 1.0, 2, 100,
                resize_mode="指定宽度", target_width=48, target_height=512,
                dither_mode="无抖动", 保持总时长=True, 播放速度=1.0,
                local_save_path=directory, filename_prefix="timing",
            )
            self.assertTrue(pathlib.Path(output_path).is_file(), status)
            with Image.open(output_path) as gif:
                self.assertEqual((48, 32), gif.size)
                self.assertEqual(3, gif.n_frames)
                self.assertEqual(200, gif.info.get("duration"))
                gif.seek(0)
                colors = gif.convert("RGB").getcolors(maxcolors=256)
                self.assertIsNotNone(colors)
                self.assertLessEqual(len(colors), 8)

    def test_h3_uploaded_image_validation(self):
        from PIL import Image
        from eagle_suite_test_package.eagle_suite.h3_director_node import _validate_uploaded_image
        with tempfile.TemporaryDirectory() as directory:
            image_path = pathlib.Path(directory, "reference.png")
            Image.new("RGB", (16, 16), "white").save(image_path)
            _validate_uploaded_image(image_path)

    def test_audio_mixer_standard_shape_resample_and_crossfade(self):
        from eagle_suite_test_package.eagle_suite.audio_nodes import EagleAudioMixer
        mixer = EagleAudioMixer()
        a = {"waveform": torch.ones((1, 1, 8000)), "sample_rate": 8000}
        b = {"waveform": torch.zeros((1, 2, 16000)), "sample_rate": 16000}
        output, _ = mixer.mix_audio("交叉淡入淡出", 0, 0, a, b)
        waveform = output["waveform"]
        self.assertEqual((1, 2), tuple(waveform.shape[:2]))
        self.assertGreater(waveform.shape[-1], 16000)
        self.assertEqual(16000, output["sample_rate"])

    def test_mask_direction_matches_comfyui(self):
        from eagle_suite_test_package.eagle_suite.video_nodes import _prepare_alpha
        images = torch.zeros((1, 1, 2, 3))
        mask = torch.tensor([[[0.0, 1.0]]])
        alpha = _prepare_alpha(mask, images)
        np.testing.assert_allclose(alpha.cpu().numpy().reshape(-1), [1.0, 0.0])

    def test_unified_media_browser_extracts_positive_prompt_from_png_execution_graph(self):
        from PIL import Image
        from PIL.PngImagePlugin import PngInfo
        from eagle_suite_test_package.eagle_suite import unified_media_browser as media

        prompt = {
            "1": {"class_type": "CLIPTextEncode", "inputs": {"text": "1girl, solo, green hair"}},
            "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "low quality, blurry"}},
            "3": {"class_type": "KSampler", "inputs": {
                "positive": ["1", 0], "negative": ["2", 0], "seed": 42,
            }},
        }
        with tempfile.TemporaryDirectory() as directory:
            image_path = pathlib.Path(directory, "workflow.png")
            pnginfo = PngInfo()
            pnginfo.add_text("prompt", json.dumps(prompt, ensure_ascii=False))
            Image.new("RGB", (16, 12), "green").save(image_path, pnginfo=pnginfo)
            extracted = media._read_image_prompt_metadata(str(image_path))

        self.assertEqual("1girl, solo, green hair", extracted["positive"])
        self.assertEqual("low quality, blurry", extracted["negative"])
        self.assertEqual("positive_prompt", media.UnifiedMediaBrowser.RETURN_NAMES[-1])
        self.assertEqual("STRING", media.UnifiedMediaBrowser.RETURN_TYPES[-1])

    def test_unified_media_browser_image_batch_keeps_video_list_nonempty(self):
        from PIL import Image
        from eagle_suite_test_package.eagle_suite import unified_media_browser as media

        with tempfile.TemporaryDirectory() as directory:
            image_path = pathlib.Path(directory, "still.png")
            Image.new("RGB", (16, 12), "green").save(image_path)
            selection = json.dumps([{
                "path": str(image_path), "name": image_path.name, "type": "image",
            }])
            with mock.patch.object(
                media, "resolve_allowed_media_path",
                side_effect=lambda path, *_args: str(path) if path else "",
            ):
                result = media.UnifiedMediaBrowser().process(selection_data=selection)

        self.assertEqual([None], result[4])
        self.assertTrue(media.UnifiedMediaBrowser.OUTPUT_IS_LIST[4])

    def test_unified_media_browser_extracts_positive_prompt_from_workflow_only_png(self):
        from PIL import Image
        from PIL.PngImagePlugin import PngInfo
        from eagle_suite_test_package.eagle_suite import unified_media_browser as media

        workflow = {
            "nodes": [
                {"id": 1, "type": "CLIPTextEncode", "widgets_values": ["masterpiece, detailed eyes"], "inputs": []},
                {"id": 2, "type": "CLIPTextEncode", "widgets_values": ["bad anatomy"], "inputs": []},
                {"id": 3, "type": "KSampler", "widgets_values": [], "inputs": [
                    {"name": "positive", "link": 10}, {"name": "negative", "link": 11},
                ]},
            ],
            "links": [[10, 1, 0, 3, 1, "CONDITIONING"], [11, 2, 0, 3, 2, "CONDITIONING"]],
        }
        with tempfile.TemporaryDirectory() as directory:
            image_path = pathlib.Path(directory, "workflow-only.png")
            pnginfo = PngInfo()
            pnginfo.add_text("workflow", json.dumps(workflow, ensure_ascii=False))
            Image.new("RGB", (16, 12), "blue").save(image_path, pnginfo=pnginfo)
            extracted = media._read_image_prompt_metadata(str(image_path))

        self.assertEqual("masterpiece, detailed eyes", extracted["positive"])
        self.assertEqual("bad anatomy", extracted["negative"])

    @unittest.skipUnless(os.name == "nt", "Windows DPAPI test")
    def test_api_key_uses_os_vault_and_round_trips(self):
        from eagle_suite_test_package.eagle_suite.api_config_manager import encode_api_key, decode_api_key
        with tempfile.TemporaryDirectory() as directory:
            os.environ["EAGLE_CREDENTIAL_DIR"] = directory
            try:
                protected = encode_api_key("test-secret-not-real")
                self.assertTrue(protected.startswith(("KEYRING:", "DPAPI:", "FERNET:")))
                self.assertNotIn("test-secret", protected)
                self.assertEqual("test-secret-not-real", decode_api_key(protected))
                if protected.startswith("KEYRING:"):
                    import keyring
                    keyring.delete_password("ComfyUI Eagle Suite", protected.split(":", 1)[1])
            finally:
                os.environ.pop("EAGLE_CREDENTIAL_DIR", None)


if __name__ == "__main__":
    unittest.main()
