"""Verify authoring saves and scene-generation submissions with a mock ComfyUI queue."""

import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

from check_gallery_browser_layout import EAGLE_PREFIX, ROOT, install_fixture
from check_h3_reference_drop import definitions


ORIGIN = "http://127.0.0.1:8189"


def run(browser, frontend, web, modern):
    with browser.new_context(viewport={"width": 2000, "height": 1300}) as context:
        page = context.new_page()
        jobs = []
        install_fixture(page, ORIGIN, modern, False, "legacy", frontend)

        def fixture(route):
            path = urlparse(route.request.url).path
            endpoint = path.removeprefix("/api")
            if endpoint == "/extensions":
                return route.fulfill(json=[EAGLE_PREFIX + "js/h3_director.js"])
            if endpoint == "/object_info":
                return route.fulfill(json=definitions())
            if endpoint == "/eaglePromptPresets/director_skills":
                return route.fulfill(json={"success": True, "data": []})
            if endpoint == "/prompt" and route.request.method == "POST":
                jobs.append(route.request.post_data_json)
                return route.fulfill(json={"prompt_id": f"fixture-{len(jobs)}", "number": len(jobs), "node_errors": {}})
            if path.startswith(EAGLE_PREFIX):
                return route.fulfill(path=web / path.removeprefix(EAGLE_PREFIX))
            return route.fallback()

        page.route("**/*", fixture)
        page.goto(ORIGIN, wait_until="domcontentloaded")
        page.wait_for_function("!!window.LiteGraph?.registered_node_types?.EagleH3DirectorNode")
        page.evaluate(r"""() => {
            const app = window.comfyAPI.app.app;
            app.graph.clear();
            const node = window.LiteGraph.createNode("EagleH3DirectorNode");
            node.pos = [50, 60];
            app.graph.add(node);
            node.setSize([1520, 1030]);
            app.canvas.ds.scale = 0.85;
            app.canvas.ds.offset = [0, 0];
            node._h3FlushState();
            const widget = node.widgets.find(w => w.name === "h3_state");
            const state = JSON.parse(widget.value);
            state.scenes[0].title = "Before title";
            state.scenes[0].preamble = "Scene with a chair\n<d>[Host] Before</d>";
            state.scenes[0].dialogues = [{ id: 1, role: "Host", text: "Before", time: "00:01.000" }];
            state.scenes.push({ ...state.scenes[0], id: 2, title: "Second scene" });
            state.project.skill.tasks = ["script"];
            widget.value = JSON.stringify(state);
            node._h3ReloadState();
            app.canvas.setDirty(true, true);
        }""")
        title = page.locator(".h3d-root input[placeholder='如：山道夜雨独行']")
        title.fill("After title")
        page.locator(".h3d-atomic-editor").fill("Scene with a chair\n<d>[Host] After</d>")
        saved, submitted = page.evaluate("""async () => {
            const app = window.comfyAPI.app.app;
            const node = app.graph._nodes[0];
            const workflow = app.graph.serialize().nodes[0];
            const index = node.widgets.findIndex(w => w.name === "h3_state");
            const { output } = await app.graphToPrompt();
            return [JSON.parse(workflow.widgets_values[index]), JSON.parse(output[node.id].inputs.h3_state)];
        }""")
        for state in (saved, submitted):
            assert state["scenes"][0]["title"] == "After title"
            assert state["scenes"][0]["dialogues"] == [
                {"id": 1, "role": "Host", "text": "After", "time": "00:01.000"}
            ]

        page.locator(".h3d-tabs .h3d-tab").filter(has_text="台词").click()
        page.locator(".h3d-dlg button.danger").first.click()
        scene = page.evaluate("""() => {
            const app = window.comfyAPI.app.app;
            const node = app.graph._nodes[0];
            const i = node.widgets.findIndex(w => w.name === "h3_state");
            return JSON.parse(app.graph.serialize().nodes[0].widgets_values[i]).scenes[0];
        }""")
        assert scene["dialogues"] == []
        assert "<d>" not in scene["preamble"]
        page.locator(".h3d-tabs .h3d-tab").filter(has_text="生成").click()
        page.get_by_role("button", name="生成全部 2 场景").click()
        for scene_id in (1, 2):
            expected = scene_id
            for _ in range(60):
                if len(jobs) >= expected:
                    break
                page.wait_for_timeout(50)
            assert len(jobs) == expected, (modern, "missing scene submission", scene_id, len(jobs))
            job = jobs[-1]
            [director_id] = job["partial_execution_targets"]
            request = json.loads(job["prompt"][director_id]["inputs"]["skill_request"])
            assert request["sceneId"] == scene_id
            serialized = next(n for n in job["extra_data"]["extra_pnginfo"]["workflow"]["nodes"]
                              if str(n["id"]) == director_id)
            assert not any("requestId" in value for value in serialized["widgets_values"]
                           if isinstance(value, str) and value.startswith('{"run":true'))
            page.evaluate("""([id, request]) => {
                const app = window.comfyAPI.app.app;
                app.graph.getNodeById(Number(id))._h3ApplySkillResult({
                    ...request, preamble: 'Generated scene ' + request.sceneId,
                });
            }""", [director_id, request])
        page.wait_for_timeout(250)
        assert len(jobs) == 2, (modern, "scene generation submitted a final downstream job")
        print(f"Nodes {2 if modern else 1}.0 director save, dialogue and two isolated scene submissions PASS")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend-dir", type=Path, required=True)
    parser.add_argument("--web-dir", type=Path, default=ROOT / "web")
    args = parser.parse_args()
    with sync_playwright() as playwright:
        with playwright.chromium.launch(channel="chrome", headless=True) as browser:
            for modern in (False, True):
                run(browser, args.frontend_dir, args.web_dir, modern)


if __name__ == "__main__":
    main()
