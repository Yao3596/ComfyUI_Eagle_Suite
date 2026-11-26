"""Exercise the preview gate and link release on both native ComfyUI canvases."""

import argparse
import io
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from PIL import Image
from playwright.sync_api import sync_playwright

from check_gallery_browser_layout import EAGLE_PREFIX, ROOT, install_fixture


ORIGIN = "http://127.0.0.1:8189"


def info(name, inputs, outputs, *, terminal=False):
    return {
        "name": name, "display_name": name, "description": "",
        "python_module": "custom_nodes.ComfyUI_Eagle_Suite" if name.startswith("Eagle") else "nodes",
        "input": inputs, "input_order": {key: list(value) for key, value in inputs.items()},
        "output": outputs, "output_name": outputs, "output_is_list": [False] * len(outputs),
        "category": "tests", "output_node": terminal,
    }


DEFINITIONS = {
    "EagleReviewGate": info("EagleReviewGate", {
        "required": {"value": ["*", {"lazy": True}], "需要确认": ["BOOLEAN", {"default": True}],
                     "确认令牌": ["STRING", {"default": ""}]},
        "optional": {"保存后重新开始": ["BOOLEAN", {"default": False}]},
    }, ["*"], terminal=True),
    "FixtureImage": info("FixtureImage", {"required": {}}, ["IMAGE"]),
    "FixtureText": info("FixtureText", {"required": {}}, ["STRING"]),
    "SaveImage": info("SaveImage", {"required": {
        "images": ["IMAGE"], "filename_prefix": ["STRING", {"default": "ComfyUI"}],
    }}, ["IMAGE"], terminal=True),
}


def draw_image(color):
    buffer = io.BytesIO()
    Image.new("RGB", (1030, 620), color).save(buffer, format="PNG")
    return buffer.getvalue()


def drag_from_gate(page, destination):
    origin = page.evaluate("""() => {
        const app = window.comfyAPI.app.app;
        const canvas = app.canvas;
        const node = app.graph._nodes.find(item => item.type === "EagleReviewGate");
        const area = canvas.canvas.getBoundingClientRect();
        const [x, y] = canvas.ds.convertCanvasToOffset(node.getConnectionPos(false, 0));
        return [area.left + x, area.top + y];
    }""")
    page.mouse.move(*origin)
    page.mouse.down()
    page.mouse.move(*destination, steps=7)
    page.mouse.up()


def run(browser, frontend, web, modern, pngs):
    with browser.new_context(viewport={"width": 1500, "height": 960}) as context:
        page = context.new_page()
        requested = []
        install_fixture(page, ORIGIN, modern, False, "legacy", frontend)

        def fixture(route):
            url = urlparse(route.request.url)
            endpoint = url.path.removeprefix("/api")
            if endpoint == "/extensions":
                return route.fulfill(json=[EAGLE_PREFIX + "js/review_gate.js"])
            if endpoint == "/object_info":
                return route.fulfill(json=DEFINITIONS)
            if endpoint == "/view":
                query = parse_qs(url.query)
                requested.append(query)
                return route.fulfill(content_type="image/png", body=pngs[query["filename"][0]])
            if url.path.startswith(EAGLE_PREFIX):
                return route.fulfill(path=web / url.path.removeprefix(EAGLE_PREFIX))
            return route.fallback()

        page.route("**/*", fixture)
        page.goto(ORIGIN, wait_until="domcontentloaded")
        page.wait_for_function("!!window.LiteGraph?.registered_node_types?.EagleReviewGate")
        page.evaluate("""() => {
            const app = window.comfyAPI.app.app;
            const graph = app.graph;
            graph.clear();
            const source = window.LiteGraph.createNode("FixtureImage");
            const gate = window.LiteGraph.createNode("EagleReviewGate");
            source.pos = [90, 170];
            gate.pos = [350, 170];
            graph.add(source);
            graph.add(gate);
            gate.setSize([500, 450]);
            source.connect(0, gate, 0);
            app.canvas.ds.scale = 1;
            app.canvas.ds.offset = [0, 0];
            app.canvas.setDirty(true, true);
        }""")
        panel = page.locator(".eg-review")
        panel.wait_for(state="visible")
        drag_from_gate(page, (1060, 280))
        try:
            page.wait_for_function("""() => window.comfyAPI.app.app.graph._nodes.some(n => n.type === "SaveImage")""",
                                   timeout=2000)
        except Exception:
            raise AssertionError(f"Nodes {2 if modern else 1}.0 did not add SaveImage when the image link was dropped")
        assert page.evaluate("""() => {
            const nodes = window.comfyAPI.app.app.graph._nodes;
            const gate = nodes.find(node => node.type === "EagleReviewGate");
            const savers = nodes.filter(node => node.type === "SaveImage");
            return savers.length === 1 && savers[0].getInputLink(0)?.origin_id === gate.id &&
                gate.outputs[0].type === "IMAGE";
        }""")

        page.evaluate("""files => {
            const gate = window.comfyAPI.app.app.graph._nodes.find(n => n.type === "EagleReviewGate");
            gate.onExecuted({eagle_review:[{
                state:"pending", token:"fixture", summary:"1030 × 620",
                images:files.map(filename => ({filename, subfolder:"", type:"temp"})),
            }]});
        }""", list(pngs))
        image = panel.locator("img")
        page.wait_for_function("document.querySelector('.eg-review img')?.naturalWidth === 1030")
        assert image.evaluate("element => element.naturalHeight") == 620
        assert len(requested) == 1
        assert requested[0] == {"filename": ["test_one.png"], "type": ["temp"]}
        panel.get_by_role("button", name="下一张").click()
        page.wait_for_function("""() => document.querySelector('.eg-review img').complete &&
            document.querySelector('.eg-review img').src.includes('test_two.png')""")
        assert requested[-1] == {"filename": ["test_two.png"], "type": ["temp"]}
        original = panel.get_by_role("link", name="查看原图")
        assert "test_two.png" in original.get_attribute("href")

        page.evaluate("""() => {
            const gate = window.comfyAPI.app.app.graph._nodes.find(n => n.type === "EagleReviewGate");
            gate.onExecuted({ eagle_review: [{ state: "approved" }] });
        }""")
        assert image.is_visible()
        assert "test_two.png" in image.get_attribute("src")
        page.evaluate("""() => {
            const app = window.comfyAPI.app.app;
            const gate = app.graph._nodes.find(n => n.type === "EagleReviewGate");
            const text = window.LiteGraph.createNode("FixtureText");
            text.pos = [60, 440];
            app.graph.add(text);
            gate.disconnectInput(0);
            text.connect(0, gate, 0);
            gate.onExecuted({ eagle_review: [{ state: "pending", token: "text", summary: "文本 · 预览", images: [] }] });
            app.canvas.setDirty(true, true);
        }""")
        assert not image.is_visible()
        drag_from_gate(page, (1100, 500))
        assert page.evaluate("""() => {
            const nodes = window.comfyAPI.app.app.graph._nodes;
            return nodes.filter(n => n.type === "SaveImage").length === 1 &&
                nodes.find(n => n.type === "EagleReviewGate").outputs[0].type === "*";
        }""")
        print(f"Nodes {2 if modern else 1}.0: original PNG batch, save-node drag, and text compatibility PASS")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend-dir", type=Path, required=True)
    parser.add_argument("--web-dir", type=Path, default=ROOT / "web")
    args = parser.parse_args()
    pngs = {"test_one.png": draw_image("#008899"), "test_two.png": draw_image("#ff7700")}
    with sync_playwright() as playwright:
        with playwright.chromium.launch(channel="chrome", headless=True) as browser:
            for modern in (False, True):
                run(browser, args.frontend_dir, args.web_dir, modern, pngs)


if __name__ == "__main__":
    main()
