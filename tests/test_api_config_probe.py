"""API config discovery tests. No real network requests are made."""
import pathlib
import tempfile
import unittest
from unittest import mock

from test_regressions import PACKAGE  # Shared ComfyUI bootstrap.
from eagle_suite_test_package.eagle_suite import api_key_node as loader
from eagle_suite_test_package.eagle_suite import api_config_manager as manager


class APIConfigProbeTests(unittest.TestCase):
    def response(self, status=200, payload=None, url="https://api.example/v1/models"):
        value = mock.Mock(status_code=status, url=url)
        value.json.return_value = payload if payload is not None else {"data": []}
        return value

    def test_extracts_common_payloads_deduplicated(self):
        self.assertEqual(loader._extract_remote_models({"data": [
            {"id": "alpha"}, {"name": "beta"}, {"model": "alpha"}, "gamma", None,
        ]}), ["alpha", "beta", "gamma"])
        self.assertEqual(loader._extract_remote_models({"models": ["local-a", {"name": "local-b"}]}),
                         ["local-a", "local-b"])

    def test_probe_is_models_only_and_does_not_infer(self):
        get = mock.Mock(return_value=self.response(payload={"data": [{"id": "alpha"}]}))
        validate = mock.Mock()
        result = loader._request_remote_models("https://api.example/v1", "secret", validate, get)
        self.assertEqual(result["models"], ["alpha"])
        self.assertEqual(get.call_args.args[0], "https://api.example/v1/models")
        self.assertEqual(get.call_args.kwargs["headers"], {"Authorization": "Bearer secret"})
        self.assertFalse(get.call_args.kwargs["allow_redirects"])
        self.assertEqual(validate.call_count, 2)

    def test_probe_supports_keyless_local_compatible_service(self):
        get = mock.Mock(return_value=self.response(payload={"models": ["local"]}))
        loader._request_remote_models("http://127.0.0.1:11434/v1", "", mock.Mock(), get)
        self.assertEqual(get.call_args.kwargs["headers"], {})

    def test_redirect_auth_and_invalid_payload_fail_clearly(self):
        for response, message in [
            (self.response(302), "重定向"),
            (self.response(401), "API Key"),
            (self.response(404), "/models"),
            (self.response(200, {"data": []}), "API 连通"),
        ]:
            with self.subTest(message=message), self.assertRaisesRegex(RuntimeError, message):
                loader._request_remote_models("https://api.example/v1", "secret", mock.Mock(), mock.Mock(return_value=response))

    def test_blank_key_edit_preserves_saved_key_while_switching_model(self):
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(manager, "CONFIG_PATH", str(pathlib.Path(directory) / "api_config.json")), \
             mock.patch.object(manager, "encode_api_key", side_effect=lambda value: value):
            self.assertTrue(manager.add_profile("old-model", "ENC:saved", "https://api.example/v1", "old-model", "llm"))
            self.assertTrue(manager.update_profile("old-model", api_key="", model="new-model"))
            profile = manager.get_profile("new-model")
            self.assertEqual(profile["api_key"], "ENC:saved")
            self.assertEqual(manager.get_profile("old-model"), {})

    def test_frontend_profile_reports_unavailable_credential_without_exposing_it(self):
        profile = {"api_key": "KEYRING:missing", "base_url": "https://api.example/v1",
                   "model": "alpha", "model_type": "llm"}
        with mock.patch.object(manager, "get_profile", return_value=profile), \
             mock.patch.object(manager, "decode_api_key", return_value=""):
            result = manager.get_profile_for_frontend("alpha")
        self.assertTrue(result["api_key_set"])
        self.assertFalse(result["credential_available"])
        self.assertEqual(result["api_key"], "")


if __name__ == "__main__":
    unittest.main()
