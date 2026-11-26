"""Check full-height H3 workspaces inside native ComfyUI 1.0 and 2.0 frames."""

import argparse
import ast
from copy import deepcopy
from pathlib import Path
import subprocess
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

from check_gallery_browser_layout import EAGLE_PREFIX, ROOT, install_fixture


TYPE = "EagleH3ReviewWorkspaceNode"
ORIGIN = "http://127.0.0.1:8189"
WORKSPACES = {
    "EagleH3DirectorNode": (".h3d-root", (1396, 1216), (960, 720)),
    "EagleSvelteCharacterPVNode": (".epv-shell", (960, 860), (840, 700)),
    "EagleSvelteCharacterInteractionNode": (".eci-shell", (960, 860), (840, 700)),
}


def definitions():
    ns = {"H3_RUN_STATE": "H3_RUN_STATE", "H3_SEGMENT": "H3_SEGMENT",
          "H3_MANIFEST": "H3_MANIFEST", "H3_MEDIA_BUNDLE_TYPE": "H3_MEDIA_BUNDLE",
          "H3_PLAN_TYPE": "H3_CHAIN_PLAN", "deepcopy": deepcopy}
    for path, name in (
        ("eagle_suite/h3_pipeline/nodes.py", "EagleH3CheckpointReviewNode"),
        ("eagle_suite/h3_review_workspace.py", TYPE),
        ("eagle_suite/h3_director_node.py", "EagleH3DirectorNode"),
        ("eagle_suite/svelte_character_interaction.py", "EagleSvelteCharacterInteractionNode"),
        ("eagle_suite/svelte_character_pv.py", "EagleSvelteCharacterPVNode"),
    ):
        source = ast.parse((ROOT / path).read_text("utf-8-sig"))
        node = next(n for n in source.body if isinstance(n, ast.ClassDef) and n.name == name)
        if name == TYPE:
            default = next(n for n in source.body if isinstance(n, ast.Assign)
                           and n.targets[0].id == "WORKSPACE_STATE_DEFAULT")
            ns["WORKSPACE_STATE_DEFAULT"] = ast.literal_eval(default.value)
        node.body = [
            n for n in node.body
            if (isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
                and n.targets[0].id in {"RETURN_TYPES", "RETURN_NAMES", "CATEGORY", "OUTPUT_NODE"})
            or (isinstance(n, ast.FunctionDef) and n.name == "INPUT_TYPES")
        ]
        exec(compile(ast.Module(body=[node], type_ignores=[]), path, "exec"), ns)
    result = {}
    for name in (TYPE, *WORKSPACES):
        cls = ns[name]
        inputs = cls.INPUT_TYPES()
        result[name] = {
            "name": name, "display_name": name, "description": "",
            "python_module": "custom_nodes.ComfyUI_Eagle_Suite",
            "input": inputs, "input_order": {k: list(v) for k, v in inputs.items()},
            "output": cls.RETURN_TYPES, "output_name": cls.RETURN_NAMES,
            "output_is_list": [False] * len(cls.RETURN_TYPES),
            "category": cls.CATEGORY, "output_node": getattr(cls, "OUTPUT_NODE", False),
        }
    return result


def assert_fits(mode, name, panel, size, inner=False):
    layout = panel.evaluate("""(panel, inner) => {
        const host = inner ? panel.parentElement : panel;
        const app = window.comfyAPI.app.app;
        const node = app.graph._nodes[0];
        const { offset, scale } = app.canvas.ds;
        const nativeFrame = host.closest('.lg-node[data-node-id]');
        const nodeBottom = nativeFrame?.getBoundingClientRect().bottom ??
            app.canvas.canvas.getBoundingClientRect().top + (node.pos[1] + node.size[1] + offset[1]) * scale;
        return {
            nodeBottom, viewportBottom: host.getBoundingClientRect().bottom,
            viewportWidth: host.clientWidth, viewportHeight: host.clientHeight,
            scrollHeight: host.scrollHeight, nativeHeight: nativeFrame?.clientHeight,
            size: Array.from(node.size),
        };
    }""", inner)
    assert layout["size"] == list(size), (mode, name, layout)
    assert layout["nativeHeight"] is None or layout["nativeHeight"] <= size[1] + 36, (mode, name, layout)
    assert 0 < layout["nodeBottom"] - layout["viewportBottom"] < 45, (mode, name, layout)
    assert size[0] - 42 <= layout["viewportWidth"] <= size[0], (mode, name, layout)
    return layout


def run(browser, frontend, web, video, modern):
    mode = "Nodes 2.0" if modern else "Nodes 1.0"
    with browser.new_context(viewport={"width": 1600, "height": 1400}) as context:
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        install_fixture(page, ORIGIN, modern, False, "legacy", frontend)

        def route_fixture(route):
            path = urlparse(route.request.url).path
            endpoint = path.removeprefix("/api")
            if endpoint == "/extensions":
                return route.fulfill(json=[
                    EAGLE_PREFIX + "js/node_scroll.js",
                    EAGLE_PREFIX + "js/h3_review_workspace_svelte.js",
                    EAGLE_PREFIX + "js/h3_director.js",
                    EAGLE_PREFIX + "js/svelte_character_interaction.js",
                ])
            if endpoint == "/object_info":
                return route.fulfill(json=definitions())
            if endpoint == "/view":
                return route.fulfill(path=video, content_type="video/mp4")
            if endpoint == "/eaglePromptPresets/director_skills":
                return route.fulfill(json={"success": True, "items": [], "data": []})
            if path.startswith(EAGLE_PREFIX):
                return route.fulfill(path=web / path.removeprefix(EAGLE_PREFIX))
            return route.fallback()

        page.route("**/*", route_fixture)
        page.goto(ORIGIN, wait_until="domcontentloaded")
        page.wait_for_function("types => types.every(type => window.LiteGraph?.registered_node_types?.[type])",
                               arg=[TYPE, *WORKSPACES])
        page.evaluate("""type => {
            const app = window.comfyAPI.app.app;
            app.graph.clear();
            const node = window.LiteGraph.createNode(type);
            node.pos = [100, 110];
            app.graph.add(node);
            app.canvas.ds.scale = 0.8;
            app.canvas.ds.offset = [0, 0];
            node.onExecuted({ h3_review: [{
                awaiting_review: true, token: 'fixture',
                preview_clip: 'h3_eagle_chains/test/clip.mp4',
                summary: 'Review layout fixture with a portrait video and all controls',
            }] });
            app.canvas.setDirty(true, true);
        }""", TYPE)

        host = page.locator(".eagle-h3-review-workspace-svelte-host")
        player = host.locator("video")
        player.wait_for(state="attached")
        page.wait_for_function("document.querySelector('.review-workspace video')?.readyState >= 1")
        for height in (1462, 920, 700):
            page.evaluate("""height => {
                const app = window.comfyAPI.app.app;
                app.graph._nodes[0].setSize([520, height]);
                app.canvas.setDirty(true, true);
            }""", height)
            page.wait_for_function("""h => window.comfyAPI.app.app.graph._nodes[0].size[1] === h""", arg=height)
            page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            layout = assert_fits(mode, TYPE, host, (520, height))

        assert layout["scrollHeight"] > layout["viewportHeight"], (mode, layout)
        host.hover(position={"x": 45, "y": 80})
        before = page.evaluate("window.comfyAPI.app.app.canvas.ds.scale")
        page.mouse.wheel(0, 800)
        page.wait_for_function("document.querySelector('.eagle-h3-review-workspace-svelte-host').scrollTop > 0")
        assert page.evaluate("window.comfyAPI.app.app.canvas.ds.scale") == before
        assert host.locator("footer button.stop").is_enabled()
        assert host.locator("footer button.stop").evaluate("""button => {
            const clip = button.closest('.eagle-h3-review-workspace-svelte-host').getBoundingClientRect();
            const control = button.getBoundingClientRect();
            return control.top >= clip.top && control.bottom <= clip.bottom;
        }""")
        for name, (selector, large, compact) in WORKSPACES.items():
            page.evaluate("""([type, size]) => {
                const app = window.comfyAPI.app.app;
                app.graph.clear();
                const node = window.LiteGraph.createNode(type);
                node.pos = [100, 110];
                app.graph.add(node);
                node.setSize(size);
                app.canvas.setDirty(true, true);
            }""", [name, large])
            panel = page.locator(selector)
            panel.wait_for(state="visible")
            page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            assert_fits(mode, name, panel, large, inner=True)
            page.evaluate("""async size => {
                const app = window.comfyAPI.app.app;
                app.graph._nodes[0].setSize(size);
                await app.loadGraphData(app.graph.serialize());
            }""", compact)
            panel.wait_for(state="visible")
            page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            assert_fits(mode, name, panel, compact, inner=True)
        assert not errors, errors
        print(f"{mode}: review video, frame, scrolling, director and character workspace resize/restore PASS")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend-dir", type=Path, required=True)
    parser.add_argument("--web-dir", type=Path, default=ROOT / "web")
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=True)
    video = args.artifacts / "portrait-fixture.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi",
                    "-i", "color=c=navy:s=96x160:r=24:d=2", "-pix_fmt", "yuv420p",
                    "-c:v", "libx264", "-movflags", "+faststart", str(video)], check=True)
    with sync_playwright() as playwright:
        with playwright.chromium.launch(channel="chrome", headless=True) as browser:
            for modern in (False, True):
                run(browser, args.frontend_dir, args.web_dir, video, modern)


if __name__ == "__main__":
    main()
