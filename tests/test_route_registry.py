"""Route registration before and after PromptServer construction."""

import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "eagle_suite" / "route_registry.py"


def load_registry():
    spec = importlib.util.spec_from_file_location("eagle_route_registry_test", MODULE_PATH)
    registry = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(registry)
    return registry


class FakeRoutes:
    def __init__(self):
        self.entries = []

    def get(self, path):
        return lambda handler: self.entries.append(("GET", path, handler))

    def post(self, path):
        return lambda handler: self.entries.append(("POST", path, handler))


class RouteRegistryTests(unittest.TestCase):
    def setUp(self):
        self.registry = load_registry()

    def test_late_server_construction_registers_once_per_server(self):
        registry = self.registry

        async def handler(_request):
            return None

        registry.route("GET", "/eagle/test")(handler)

        class PromptServer:
            instance = None

            def __init__(self):
                type(self).instance = self
                self.routes = FakeRoutes()

        ready = lambda server: registry.register_all_routes(server)
        self.assertFalse(registry.register_when_ready(PromptServer, ready))
        self.assertFalse(registry.register_when_ready(PromptServer, ready))

        first = PromptServer()
        self.assertEqual([("GET", "/eagle/test", handler)], first.routes.entries)
        self.assertTrue(registry.register_all_routes(first))
        self.assertEqual(1, len(first.routes.entries))

        second = PromptServer()
        self.assertEqual([("GET", "/eagle/test", handler)], second.routes.entries)

    def test_hot_reload_replaces_callback_without_stacking_wrappers(self):
        registry = self.registry
        calls = []

        class PromptServer:
            instance = None

            def __init__(self):
                type(self).instance = self
                self.routes = FakeRoutes()

        registry.register_when_ready(PromptServer, lambda _server: calls.append("old"))
        registry.register_when_ready(PromptServer, lambda _server: calls.append("new"))
        PromptServer()
        self.assertEqual(["new"], calls)

    def test_missing_route_table_waits_and_existing_server_is_immediate(self):
        registry = self.registry

        class PromptServer:
            instance = None

            def __init__(self):
                type(self).instance = self
                self.routes = FakeRoutes()

        self.assertFalse(registry.register_all_routes(None))
        self.assertFalse(registry.register_when_ready(PromptServer, lambda _server: None))
        server = PromptServer()
        calls = []
        self.assertTrue(registry.register_when_ready(
            PromptServer, lambda current: calls.append(current)
        ))
        self.assertEqual([server], calls)


if __name__ == "__main__":
    unittest.main()
