"""Exercise preview, comparison, clipboard and image transfer on both ComfyUI canvases."""

import argparse
import io
import json
from email import policy
from email.parser import BytesParser
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
        "optional": {"保存后重新开始": ["BOOLEAN", {"default": False}], "对比图像": ["IMAGE", {}]},
    }, ["*"], terminal=True),
    "FixtureImage": info("FixtureImage", {"required": {}}, ["IMAGE"]),
    "FixtureText": info("FixtureText", {"required": {}}, ["STRING"]),
    "LoadImage": info("LoadImage", {"required": {
        "image": [["first.png", "second.png"], {"image_upload": True}],
    }}, ["IMAGE", "MASK"]),
    "EagleImageMaskEditor": info("EagleImageMaskEditor", {"required": {
        "image": [["editor.png"], {"image_upload": True}],
    }}, ["IMAGE", "MASK"]),
    "SaveImage": info("SaveImage", {"required": {
        "images": ["IMAGE"], "filename_prefix": ["STRING", {"default": "ComfyUI"}],
    }}, ["IMAGE"], terminal=True),
}


def draw_image(color, size=(1030, 620)):
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
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


def check_hover_comparison(page, panel, image, reference):
    viewport = panel.locator(".eg-review__viewport")
    viewport.evaluate("element => element.style.flex = '0 0 140px'")
    box = viewport.bounding_box()
    mid_y = box["y"] + box["height"] / 2
    assert not reference.is_visible(), "The undisturbed preview shows the final result"
    page.mouse.move(box["x"] + box["width"] * 0.65, mid_y)
    reference.wait_for(state="visible", timeout=3000)
    reference.evaluate("element => element.decode()")
    assert panel.get_by_role("button", name="滑动对比").count() == 0
    assert "reference.png" in reference.get_attribute("src")
    assert image.bounding_box() == reference.bounding_box(), "Comparison images must share one display area"

    def content_width(picture):
        return picture.evaluate("""element => {
            const box = element.getBoundingClientRect();
            return Math.min(box.width, box.height * element.naturalWidth / element.naturalHeight);
        }""")

    visible_width = max(content_width(image), content_width(reference))
    inset = (box["width"] - visible_width) / 2
    assert inset > 20, "The fixture has horizontal letterbox padding"

    def center_color_after_hover(split):
        page.mouse.move(box["x"] + inset + visible_width * split, mid_y)
        with Image.open(io.BytesIO(viewport.screenshot())) as screenshot:
            return screenshot.getpixel((screenshot.width // 2, screenshot.height // 2))[:3]

    assert center_color_after_hover(0.25) == (255, 119, 0), "Final image must appear to the right of the pointer"
    assert center_color_after_hover(0.75) == (0, 51, 119), "Reference must follow pointer movement without a press"

    def split_value():
        return viewport.evaluate("element => element.style.getPropertyValue('--eg-review-split')")

    page.mouse.move(box["x"] + inset / 2, mid_y)
    assert not reference.is_visible()
    page.mouse.move(box["x"] + box["width"] - inset / 2, mid_y)
    assert split_value() == "100%" and reference.is_visible()
    panel.locator(".eg-review__toolbar").hover()
    assert not reference.is_visible(), "Leaving the preview restores the complete final result"

    slider = panel.get_by_role("slider", name="对比位置")
    slider.focus()
    slider.press("Home")
    assert not reference.is_visible()
    slider.press("End")
    assert split_value() == "100%" and reference.is_visible()
    panel.get_by_role("link", name="查看原图").focus()
    assert not reference.is_visible()

    cdp = page.context.new_cdp_session(page)
    try:
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True})
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{
            "x": round(box["x"] + inset + visible_width * 0.75), "y": round(mid_y),
        }]})
        reference.wait_for(state="visible", timeout=3000)
        assert float(split_value().rstrip("%")) > 50
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{
            "x": round(box["x"] + inset + visible_width * 0.25), "y": round(mid_y),
        }]})
        assert float(split_value().rstrip("%")) < 50
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        reference.wait_for(state="hidden", timeout=3000)
    finally:
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": False})
        cdp.detach()
    viewport.evaluate("element => element.style.removeProperty('flex')")


def check_send_to_input(page, panel, uploads, prompts, thumb_requests, pngs):
    ids = page.evaluate("""() => {
        const graph = window.comfyAPI.app.app.graph;
        return ["首帧参考", "尾帧参考"].map((title, index) => {
            const node = window.LiteGraph.createNode("LoadImage");
            node.pos = [70, 310 + index * 210];
            node.title = title;
            graph.add(node);
            node.widgets.find(w => w.name === "image").value = index ? "second.png" : "first.png";
            return node.id;
        });
    }""")

    def values(target_ids=ids):
        return page.evaluate("""ids => ids.map(id => {
            const node = window.comfyAPI.app.app.graph.getNodeById(id);
            return node?.serialize().widgets_values[0] ?? null;
        })""", target_ids)

    send = panel.get_by_role("button", name="发送到加载图像")
    picker = panel.locator(".eg-review__target-picker")
    trigger = picker.locator("summary")
    send.hover(timeout=2000)
    assert trigger.inner_text() == f"#{ids[0]}"
    assert not thumb_requests, "The closed picker must not request any thumbnails"
    with page.expect_request(lambda request: parse_qs(urlparse(request.url).query).get("filename") ==
                             ["test_two (1).png"], timeout=3000):
        send.click()
    panel.get_by_text("已发送到首帧参考", exact=False).wait_for(timeout=3000)
    assert values() == ["test_two (1).png", "second.png"], "Sending without opening the picker must use the first loader"
    assert uploads == [{"type": "input", "filename": "test_two.png", "bytes": pngs["test_two.png"]}]
    assert not prompts, "Sending an input must not queue the workflow"

    trigger.click()
    tail = picker.get_by_role("button", name=f"尾帧参考 (#{ids[1]})", exact=True)
    tail.locator("img").wait_for(state="visible", timeout=3000)
    assert "second.png" in tail.locator("img").get_attribute("src")
    assert picker.get_by_role("button").all_inner_texts() == [f"#{node_id}" for node_id in ids]
    page.wait_for_function("""() => {
        const thumbs = [...document.querySelectorAll('.eg-review__target-picker[open] img')];
        return thumbs.length === 2 && thumbs.every(img => img.complete && img.naturalWidth > 0);
    }""")
    assert set(thumb_requests) == {"test_two (1).png", "second.png"}
    tail.click()
    assert trigger.inner_text() == f"#{ids[1]}"
    send.click()
    panel.get_by_text("传输失败", exact=False).wait_for(timeout=3000)
    assert values() == ["test_two (1).png", "second.png"], "A failed upload must keep the target's old image selected"
    send.click()
    panel.get_by_text("已发送到尾帧参考", exact=False).wait_for(timeout=3000)
    assert values() == ["test_two (1).png", "test_two (2).png"] and len(uploads) == 3

    page.evaluate("""id => {
        const graph = window.comfyAPI.app.app.graph;
        graph.remove(graph.getNodeById(id));
    }""", ids[1])
    trigger.wait_for(state="hidden", timeout=3000)

    editor_id = page.evaluate("""() => {
        const graph = window.comfyAPI.app.app.graph;
        const editor = window.LiteGraph.createNode("EagleImageMaskEditor");
        editor.pos = [70, 530];
        graph.add(editor);
        return editor.id;
    }""")
    trigger.wait_for(state="visible", timeout=3000)
    assert trigger.inner_text() == f"#{ids[0]}", "Removing the selected loader restores the first available target"
    trigger.click()
    editor = picker.get_by_role("button", name=f"EagleImageMaskEditor (#{editor_id})", exact=True)
    editor.locator("img").wait_for(state="visible", timeout=3000)
    assert "editor.png" in editor.locator("img").get_attribute("src")
    assert editor.inner_text() == f"#{editor_id}"
    editor.click()
    assert trigger.inner_text() == f"#{editor_id}"
    send.click()
    panel.get_by_text("已发送到EagleImageMaskEditor", exact=False).wait_for(timeout=3000)
    assert values([ids[0], editor_id]) == ["test_two (1).png", "test_two (3).png"]
    assert uploads[-1] == {"type": "input", "filename": "test_two.png", "bytes": pngs["test_two.png"]}

    page.evaluate("""id => {
        const graph = window.comfyAPI.app.app.graph;
        graph.remove(graph.getNodeById(id));
    }""", editor_id)
    trigger.wait_for(state="hidden", timeout=3000)
    assert not prompts


def check_history(page, panel, image, old_workflow):
    current_workflow = {"version": 1, "nodes": [{"id": 1, "widgets_values": [9001]}],
                        "extra": {"fixture": "本轮工作流"}}
    approve = panel.get_by_role("button", name="继续下游")
    send = panel.get_by_role("button", name="发送到加载图像")
    copy = panel.get_by_role("button", name="复制图像")
    graph_before = page.evaluate("window.comfyAPI.app.app.graph.serialize()")

    def download_workflow(expected, filename):
        with page.expect_download(timeout=3000) as transfer:
            panel.get_by_role("button", name="下载工作流 JSON").click(timeout=2000)
        download = transfer.value
        assert download.suggested_filename == filename
        assert json.loads(download.path().read_text(encoding="utf-8")) == expected

    page.evaluate("""() => {
        const { app } = window.comfyAPI.app;
        const { api } = window.comfyAPI.api;
        const gate = app.graph._nodes.find(n => n.type === "EagleReviewGate");
        api.dispatchEvent(new CustomEvent("eagle_preview_waiting", {detail: {node_ids: [String(gate.id)]}}));
    }""")
    panel.get_by_text("上游执行中", exact=False).wait_for(timeout=3000)
    assert "test_two.png" in image.get_attribute("src")
    assert approve.is_disabled()
    assert not send.is_visible()
    assert "test_two.png" in panel.get_by_role("link", name="查看原图").get_attribute("href")
    copy.click()
    panel.get_by_text("已复制图像").wait_for(timeout=3000)
    download_workflow(old_workflow, "test_two.workflow.json")

    page.evaluate("""workflow => {
        const gate = window.comfyAPI.app.app.graph._nodes.find(n => n.type === "EagleReviewGate");
        gate.onExecuted({eagle_review: [{state: "pending", token: "new-candidate", summary: "本轮结果", workflow,
            images: [{filename: "test_three.png", type: "temp"}]}]});
    }""", current_workflow)
    assert approve.is_enabled() and send.is_visible()
    assert "test_three.png" in image.get_attribute("src")
    download_workflow(current_workflow, "test_three.workflow.json")

    panel.get_by_role("button", name="上一轮", exact=True).click()
    assert "test_two.png" in image.get_attribute("src")
    assert approve.is_disabled() and not send.is_visible()
    download_workflow(old_workflow, "test_two.workflow.json")
    panel.get_by_role("button", name="本轮", exact=True).click()
    assert "test_three.png" in image.get_attribute("src")
    assert approve.is_enabled()
    assert page.evaluate("window.comfyAPI.app.app.graph.serialize()") == graph_before


def run(browser, frontend, web, modern, pngs):
    with browser.new_context(viewport={"width": 1500, "height": 960}) as context:
        context.grant_permissions(["clipboard-read", "clipboard-write"], origin=ORIGIN)
        page = context.new_page()
        requested = []
        uploads = []
        prompts = []
        thumb_requests = []
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
                return route.fulfill(content_type="image/png", body=pngs.get(query["filename"][0], pngs["test_two.png"]))
            if endpoint == "/eagle_review/input_thumbnail":
                thumb_requests.append(parse_qs(url.query)["filename"][0])
                return route.fulfill(content_type="image/png", body=pngs["reference.png"])
            if endpoint == "/upload/image":
                header = route.request.headers["content-type"]
                body = BytesParser(policy=policy.default).parsebytes(
                    f"Content-Type: {header}\r\n\r\n".encode() + route.request.post_data_buffer
                )
                parts = {part.get_param("name", header="content-disposition"): part for part in body.iter_parts()}
                uploads.append({"type": parts["type"].get_content(), "filename": parts["image"].get_filename(),
                                "bytes": parts["image"].get_payload(decode=True)})
                if len(uploads) == 2:
                    return route.fulfill(status=500, json={})
                duplicate_number = 1 if len(uploads) == 1 else len(uploads) - 1
                name = f"test_two ({duplicate_number}).png"
                return route.fulfill(json={"name": name, "subfolder": "", "type": "input"})
            if endpoint == "/prompt" and route.request.method == "POST":
                prompts.append(route.request.post_data_json)
                return route.fulfill(status=400, json={})
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
            source.connect(0, gate, gate.findInputSlot("对比图像"));
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

        old_workflow = {"version": 0.4, "nodes": [{"id": 1, "widgets_values": [41]}],
                        "extra": {"fixture": "上轮工作流"}}
        page.evaluate("""({ files, workflow }) => {
            const gate = window.comfyAPI.app.app.graph._nodes.find(n => n.type === "EagleReviewGate");
            gate.onExecuted({eagle_review:[{
                state:"pending", token:"fixture", summary:"1030 × 620", workflow,
                images:files.map(filename => ({filename, subfolder:"", type:"temp"})),
                reference_images:[{filename:"reference.png", subfolder:"", type:"temp"}],
            }]});
        }""", {"files": ["test_one.png", "test_two.png"], "workflow": old_workflow})
        image = panel.locator('img[alt="最终图像"]')
        reference = panel.locator('img[alt="对比图像"]')
        page.wait_for_function("""document.querySelector('.eg-review img[alt="最终图像"]')?.naturalWidth === 1030""",
                               timeout=3000)
        assert image.evaluate("element => element.naturalHeight") == 620
        assert not reference.is_visible()
        assert {"filename": ["test_one.png"], "type": ["temp"]} in requested
        panel.get_by_role("button", name="下一张").click()
        page.wait_for_function("""() => {
            const image = document.querySelector('.eg-review img[alt="最终图像"]');
            return image.complete && image.src.includes('test_two.png');
        }""")
        assert {"filename": ["test_two.png"], "type": ["temp"]} in requested
        original = panel.get_by_role("link", name="查看原图")
        assert "test_two.png" in original.get_attribute("href")

        check_hover_comparison(page, panel, image, reference)
        panel.get_by_role("button", name="复制图像").click()
        panel.get_by_text("已复制图像").wait_for(timeout=3000)
        assert page.evaluate("""async () => {
            const [copied] = await navigator.clipboard.read();
            const bitmap = await createImageBitmap(await copied.getType('image/png'));
            const canvas = new OffscreenCanvas(1, 1);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0);
            return [bitmap.width, bitmap.height, ...ctx.getImageData(0, 0, 1, 1).data];
        }""") == [1030, 620, 255, 119, 0, 255], "Clipboard contains the final image at original resolution"

        page.evaluate("""() => {
            const gate = window.comfyAPI.app.app.graph._nodes.find(n => n.type === "EagleReviewGate");
            gate.onExecuted({ eagle_review: [{ state: "approved" }] });
        }""")
        assert image.is_visible()
        assert "test_two.png" in image.get_attribute("src")
        check_send_to_input(page, panel, uploads, prompts, thumb_requests, pngs)
        assert "test_two.png" in image.get_attribute("src"), "Transfer must leave the review preview intact"
        check_history(page, panel, image, old_workflow)
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
        assert not panel.get_by_role("button", name="发送到加载图像").is_visible()
        assert not panel.get_by_role("button", name="下载工作流 JSON").is_visible()
        drag_from_gate(page, (1100, 500))
        assert page.evaluate("""() => {
            const nodes = window.comfyAPI.app.app.graph._nodes;
            return nodes.filter(n => n.type === "SaveImage").length === 1 &&
                nodes.find(n => n.type === "EagleReviewGate").outputs[0].type === "*";
        }""")
        print(f"Nodes {2 if modern else 1}.0: preview, history, workflow download, image transfer and text PASS")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend-dir", type=Path, required=True)
    parser.add_argument("--web-dir", type=Path, default=ROOT / "web")
    args = parser.parse_args()
    pngs = {"test_one.png": draw_image("#008899"), "test_two.png": draw_image("#ff7700"),
            "test_three.png": draw_image("#8b22aa"),
            "reference.png": draw_image("#003377", (128, 72))}
    with sync_playwright() as playwright:
        with playwright.chromium.launch(channel="chrome", headless=True) as browser:
            for modern in (False, True):
                run(browser, args.frontend_dir, args.web_dir, modern, pngs)


if __name__ == "__main__":
    main()
