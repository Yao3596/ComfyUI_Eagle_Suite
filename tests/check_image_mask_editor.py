"""Exercise the in-node editor and persisted edits in both ComfyUI canvases."""

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
from check_review_image_preview import DEFINITIONS as REVIEW_DEFINITIONS


ORIGIN = "http://127.0.0.1:8189"
NODE = "EagleImageMaskEditor"


def node_info(input_images=()):
    required = {
        "image": [["", *sorted(set(input_images))], {"default": ""}],
        "尺寸模式": [["限制长边", "原图", "按百万像素"], {"default": "限制长边"}],
        "最长边": ["INT", {"default": 2048, "min": 64, "max": 16384}],
        "百万像素": ["FLOAT", {"default": 1.0, "min": 0.01, "max": 64, "step": 0.01}],
        "对齐倍数": ["INT", {"default": 8, "min": 1, "max": 256}],
    }
    optional = {name: ["STRING", {"default": ""}] for name in ("edit_layers", "legacy_resize")}
    optional.update({
        "image_input": ["IMAGE", {}],
        "sam_model": ["SAM_MODEL,MODEL", {"lazy": True}],
        "clip": ["CLIP", {"lazy": True}],
        "sam_text": ["STRING", {"forceInput": True}],
        "sam_prompt": ["STRING", {"default": ""}],
        "sam_auto": ["BOOLEAN", {"default": False}],
        "editor_adjustments": ["STRING", {"default": ""}],
        "editor_request": ["STRING", {"default": ""}],
    })
    return {NODE: {
        "name": NODE, "display_name": "图像与遮罩编辑", "description": "",
        "python_module": "custom_nodes.ComfyUI_Eagle_Suite", "category": "Eagle Suite/媒体",
        "input": {"required": required, "optional": optional},
        "input_order": {"required": list(required), "optional": list(optional)},
        "output": ["IMAGE", "MASK", "INT", "INT"], "output_name": ["图像", "遮罩", "宽度", "高度"],
        "output_is_list": [False] * 4, "output_node": False,
    }, **{name: {
        "name": name, "display_name": name, "category": "test", "python_module": "nodes",
        "input": {"required": {}}, "input_order": {"required": []},
        "output": outputs, "output_is_list": [False] * len(outputs), "output_node": False,
    } for name, outputs in (("FixtureImageSource", ["IMAGE"]), ("FixtureSAM3Loader", ["MODEL", "CLIP"]),
                           ("FixtureTextSource", ["STRING"]))}, "FixtureImageSink": {
        "name": "FixtureImageSink", "display_name": "FixtureImageSink", "category": "test", "python_module": "nodes",
        "input": {"required": {"image": ["IMAGE", {}]}}, "input_order": {"required": ["image"]},
        "output": [], "output_is_list": [], "output_node": True,
    }}


def image_bytes():
    with io.BytesIO() as buffer:
        Image.new("RGB", (320, 240), "#415d78").save(buffer, "PNG")
        return buffer.getvalue()


def transparent_png():
    image = Image.new("RGBA", (320, 240), "#415d78")
    image.paste((28, 50, 65, 0), (0, 0, 120, 90))
    with io.BytesIO() as buffer:
        image.save(buffer, "PNG")
        return buffer.getvalue()


def mask_bytes(bounds=(30, 30, 100, 100), alpha=224):
    image = Image.new("RGBA", (320, 240))
    image.paste((255, 255, 255, alpha), bounds)
    with io.BytesIO() as buffer:
        image.save(buffer, "PNG")
        return buffer.getvalue()


def multipart(request):
    header = request.headers["content-type"]
    document = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {header}\r\n\r\n".encode() + request.post_data_buffer
    )
    parts = {part.get_param("name", header="content-disposition"): part for part in document.iter_parts()}
    return parts["image"].get_filename(), parts["subfolder"].get_content() if "subfolder" in parts else "", parts["image"].get_payload(decode=True)


def pixel_alpha(canvas, x=160, y=120):
    return canvas.evaluate("(canvas, [x, y]) => canvas.getContext('2d').getImageData(x,y,1,1).data[3]", [x, y])


def assert_green_overlay(picture, x, y):
    with Image.open(io.BytesIO(picture.screenshot())) as display:
        red, green, blue = display.convert("RGB").getpixel((int(x * display.width), int(y * display.height)))
        assert green > red + 40 and green > blue + 25, (red, green, blue)


def dispatch_image(page, method, name, selector="body"):
    page.eval_on_selector(selector, """(target, [method, name, data]) => {
        const payload = new DataTransfer();
        if (method === "gallery") {
            const url = new URL('/api/view', location.href);
            url.search = new URLSearchParams({filename:name, type:'output'});
            payload.setData('application/x-comfy-asset-info', JSON.stringify({
                filename:name, media_kind:'image', media_url:url.href, type:'output',
            }));
            payload.setData('text/uri-list', url.href);
        } else {
            payload.items.add(new File([new Uint8Array(data)], name, {type:'image/png'}));
        }
        const options = {bubbles: true, cancelable: true};
        if (method === 'paste') {
            return target.dispatchEvent(new ClipboardEvent('paste', {...options, clipboardData: payload}));
        }
        target.dispatchEvent(new DragEvent('dragover', {...options, dataTransfer: payload}));
        return target.dispatchEvent(new DragEvent('drop', {...options, dataTransfer: payload}));
    }""", [method, name, list(image_bytes())])


def editor_result(page, payload):
    page.evaluate("""payload => {
        const graph = window.comfyAPI.app.app.graph;
        graph._nodes.find(node => node.type === 'EagleImageMaskEditor').onExecuted({eagle_image_editor:[payload]});
    }""", payload)


def run(browser, frontend, web, modern):
    files = {
        ("", "comparison-result.png"): image_bytes(), ("", "legacy.png"): image_bytes(),
        ("", "gallery.png"): image_bytes(), ("eagle_image_editor", "sam-source.png"): image_bytes(),
        ("eagle_image_editor", "sam-mask.png"): mask_bytes(),
        ("eagle_image_editor", "automatic-mask.png"): mask_bytes((180, 130, 250, 200), 255),
        ("", "transparent.png"): transparent_png(),
    }
    prompts = []
    deferred_upload = []
    deferred_source = []
    deny_layers = False
    uploads = []
    with browser.new_context(viewport={"width": 1520, "height": 980}) as context:
        page = context.new_page()
        install_fixture(page, ORIGIN, modern, False, "legacy", frontend)

        def fixture(route):
            parsed = urlparse(route.request.url)
            endpoint = parsed.path.removeprefix("/api")
            if endpoint == "/extensions":
                return route.fulfill(json=[EAGLE_PREFIX + "js/image_mask_editor.js", EAGLE_PREFIX + "js/review_gate.js"])
            if endpoint == "/object_info":
                images = [name for folder, name in files if not folder]
                return route.fulfill(json={**node_info(images), "EagleReviewGate": REVIEW_DEFINITIONS["EagleReviewGate"]})
            if endpoint == "/models/upscale_models":
                return route.fulfill(json=["fixture-2x.safetensors"])
            if endpoint == "/upload/image":
                name, subfolder, data = multipart(route.request)
                files[(subfolder, name)] = data
                uploads.append((subfolder, name))
                response = {"name": name, "subfolder": subfolder, "type": "input"}
                if subfolder and deny_layers:
                    return route.fulfill(status=500)
                if name == "from-explorer.png":
                    deferred_source.append((route, response))
                    return
                if subfolder and not deferred_upload:
                    deferred_upload.append((route, response))
                    return
                return route.fulfill(json=response)
            if endpoint == "/view":
                params = parse_qs(parsed.query)
                data = files.get((params.get("subfolder", [""])[0], params["filename"][0]))
                return route.fulfill(content_type="image/png", body=data, headers={"Cache-Control": "no-store"}) if data else route.fulfill(status=404)
            if endpoint == "/prompt" and route.request.method == "POST":
                prompts.append(route.request.post_data_json)
                return route.fulfill(json={"prompt_id": "approved-preview", "number": 1, "node_errors": {}})
            if parsed.path.startswith(EAGLE_PREFIX):
                name = web / parsed.path.removeprefix(EAGLE_PREFIX)
                return route.fulfill(path=name) if name.is_file() else route.fulfill(status=404)
            return route.fallback()

        page.route("**/*", fixture)
        page.goto(ORIGIN, wait_until="domcontentloaded")
        page.wait_for_function(f"!!window.LiteGraph?.registered_node_types?.{NODE}", timeout=5000)
        page.evaluate("""type => {
            const app = window.comfyAPI.app.app;
            app.graph.clear();
            const node = window.LiteGraph.createNode(type);
            node.pos = [260, 150];
            app.graph.add(node);
            const sink = window.LiteGraph.createNode('FixtureImageSink');
            sink.pos = [835, 150];
            app.graph.add(sink);
            node.connect(0, sink, 0);
            node.setSize([540, 620]);
            app.canvas.ds.scale = 1;
            app.canvas.ds.offset = [0, 0];
            app.canvas.setDirty(true, true);
        }""", NODE)
        editor = page.locator(".eime-root")
        editor.wait_for(state="visible", timeout=3000)
        editor.locator(".eime-tools").get_by_role("button", name="画笔", exact=True).locator("svg").wait_for(state="visible", timeout=3500)
        editor.locator(".eime-properties").get_by_label("笔刷大小").wait_for(state="visible", timeout=3500)
        page.evaluate("""async () => {
            const app = window.comfyAPI.app.app;
            const workflow = app.graph.serialize();
            const node = workflow.nodes.find(node => node.type === 'EagleImageMaskEditor');
            delete node.widgets_values_named;
            node.widgets_values = ['legacy.png', '指定尺寸', 2800, 77, 758, 0, '居中扩展', 16, ''];
            await app.loadGraphData(workflow);
        }""")
        persisted = page.evaluate("""async () => {
            const app = window.comfyAPI.app.app;
            const node = app.graph._nodes.find(n => n.type === 'EagleImageMaskEditor');
            return (await app.graphToPrompt()).output[node.id].inputs;
        }""")
        assert persisted["image"] == "legacy.png" and persisted["最长边"] == 2800 and persisted["对齐倍数"] == 16
        assert json.loads(persisted["legacy_resize"]) == {
            "mode": "指定尺寸", "percent": 77, "width": 758, "height": 0, "alignment": "居中扩展",
        }
        page.evaluate("""() => {
            const app = window.comfyAPI.app.app;
            const node = app.graph._nodes.find(n => n.type === 'EagleImageMaskEditor');
            const values = {'尺寸模式':'按百万像素', '百万像素':1.25};
            for (const widget of node.widgets.filter(w => w.name in values)) {
                const previous = widget.value;
                widget.value = values[widget.name];
                node.onWidgetChanged(widget.name, widget.value, previous, widget);
            }
        }""")
        launcher = editor.get_by_role("button", name="模型放大", exact=True)
        launcher.click()
        upscale_dialog = page.get_by_role("dialog", name="模型放大", exact=True)
        upscale_dialog.wait_for(state="visible", timeout=4000)
        upscale_dialog.get_by_label("放大模型", exact=True).select_option("fixture-2x.safetensors", timeout=4000)
        upscale_dialog.get_by_label("启用模型放大").check()
        upscale_dialog.get_by_label("放大倍数").fill("1.5")
        upscale_dialog.get_by_label("舍入到倍数").fill("8")
        upscale_dialog.get_by_role("button", name="保存", exact=True).click()
        upscale_dialog.wait_for(state="hidden")
        assert editor.locator(".eime-dimensions").inner_text() == "画幅 320 × 240 · 输出 1944 × 1440"
        launcher.click()
        assert upscale_dialog.get_by_label("放大模型", exact=True).input_value() == "fixture-2x.safetensors"
        upscale_dialog.get_by_label("尺寸方式").select_option("width")
        upscale_dialog.get_by_label("目标宽度").fill("2048")
        upscale_dialog.get_by_role("button", name="取消", exact=True).click()
        assert editor.locator(".eime-dimensions").inner_text().endswith("1944 × 1440")
        launcher.click()
        upscale_dialog.get_by_label("启用模型放大").uncheck()
        upscale_dialog.get_by_role("button", name="保存", exact=True).click()
        editor.locator('input[type="file"]').set_input_files({
            "name": "transparent.png", "mimeType": "image/png", "buffer": transparent_png(),
        })
        editor.locator(".eime-base[src*='transparent.png']").wait_for(state="visible")
        white_picture = editor.locator(".eime-picture")
        with Image.open(io.BytesIO(white_picture.screenshot())) as transparent_display:
            assert transparent_display.convert("RGB").getpixel((25, 25)) == (255, 255, 255)
        editor.get_by_role("button", name="透层吸管", exact=True).click()
        bounds = white_picture.bounding_box()
        page.mouse.click(bounds["x"] + bounds["width"] * .15, bounds["y"] + bounds["height"] * .16)
        editor.get_by_text("已吸取 #FFFFFF", exact=True).wait_for()
        editor.get_by_role("button", name="画笔", exact=True).click()
        with page.expect_request(lambda request: urlparse(request.url).path.endswith("/upload/image")):
            dispatch_image(page, "drop", "from-explorer.png", ".eime-stage")
        page.evaluate("""() => {
            const app = window.comfyAPI.app.app;
            window.droppedImagePrompt = app.graphToPrompt().then(({output, workflow}) => {
                const node = workflow.nodes.find(node => node.type === 'EagleImageMaskEditor');
                return [output[node.id].inputs.image, node.widgets_values[0]];
            });
        }""")
        source_route, source_response = deferred_source[0]
        source_route.fulfill(json=source_response)
        assert page.evaluate("window.droppedImagePrompt") == ["from-explorer.png", "from-explorer.png"]
        editor.locator(".eime-base[src*='from-explorer.png']").wait_for(state="visible")
        page.evaluate("""() => {
            const app = window.comfyAPI.app.app;
            const node = app.graph._nodes.find(n => n.type === 'EagleImageMaskEditor');
            app.canvas.selectNode(node);
        }""")
        dispatch_image(page, "paste", "from-clipboard.png")
        editor.locator(".eime-base[src*='from-clipboard.png']").wait_for(state="visible")
        assert page.evaluate("window.comfyAPI.app.app.graph._nodes.length") == 2
        editor.locator('input[type="file"]').set_input_files({
            "name": "fixture.png", "mimeType": "image/png", "buffer": image_bytes(),
        })
        editor.locator(".eime-base[src*='fixture.png']").wait_for(state="visible")
        mask = editor.locator(".eime-mask-canvas")
        paint = editor.locator(".eime-paint-canvas")
        picture = editor.locator(".eime-stage").bounding_box()
        x = picture["x"] + picture["width"] / 2
        y = picture["y"] + picture["height"] / 2
        page.mouse.move(x - 35, y)
        page.mouse.down()
        page.mouse.move(x + 35, y, steps=8)
        page.mouse.up()
        mask.wait_for(state="visible", timeout=4000)
        assert pixel_alpha(mask) > 240 and pixel_alpha(mask, 0, 0) == 0
        editor.get_by_label("遮罩颜色").fill("#24dc56")
        assert editor.locator("feFlood").get_attribute("flood-color") == "#24dc56"
        assert pixel_alpha(mask) > 240 and pixel_alpha(mask, 0, 0) == 0
        with Image.open(io.BytesIO(editor.locator(".eime-stage").screenshot())) as display:
            red, green, blue = display.convert("RGB").getpixel((display.width // 2, display.height // 2))
            assert green > red + 40 and green > blue + 25, (red, green, blue)
        editor.get_by_label("叠加透明度").fill("100")
        editor.get_by_role("button", name="透层吸管", exact=True).click()
        assert mask.evaluate("(canvas) => Number(getComputedStyle(canvas).opacity)") <= .30
        editor.get_by_label("取色写入").select_option("mask")
        box = editor.locator(".eime-picture").bounding_box()
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        assert editor.get_by_label("遮罩颜色").input_value() == "#415d78", "Pixel sampler must ignore the green mask overlay"
        editor.get_by_role("button", name="画笔", exact=True).click()
        assert mask.evaluate("(canvas) => getComputedStyle(canvas).opacity") == "1"

        editor.get_by_label("自动扩展遮罩").check()
        editor.get_by_label("向外扩展（像素）").fill("32")
        assert pixel_alpha(mask, 160, 170) == 0
        effect = editor.locator(".eime-effect-mask")
        page.wait_for_function("""() => {
            const canvas = document.querySelector('.eime-effect-mask');
            return !canvas.hidden && canvas.getContext('2d').getImageData(160, 170, 1, 1).data[3] > 200;
        }""", timeout=3000)
        editor.get_by_label("羽化（像素）").fill("6")
        page.wait_for_function("""() => {
            const canvas = document.querySelector('.eime-effect-mask');
            const a = canvas.getContext('2d').getImageData(160, 177, 1, 1).data[3];
            return a > 50 && a < 220;
        }""", timeout=3000)
        assert pixel_alpha(mask, 160, 170) == 0, "Output settings must leave the editable mask raw"
        editor.get_by_label("羽化（像素）").fill("0")
        editor.get_by_label("自动扩展遮罩").uncheck()
        assert not effect.is_visible()

        page.evaluate("window.workingMask = document.querySelector('.eime-mask-canvas')")
        editor.get_by_role("button", name="打开大画布", exact=True).click()
        dialog = page.get_by_role("dialog", name="图像与遮罩编辑器")
        dialog.wait_for(state="visible", timeout=4000)
        dialog.get_by_role("button", name="模型放大", exact=True).click()
        upscale_dialog.wait_for(state="visible")
        page.keyboard.press("Escape")
        upscale_dialog.wait_for(state="hidden")
        assert dialog.is_visible()
        dialog.locator(".eime-stage").focus()
        assert dialog.locator(".eime-mask-canvas").evaluate("(element) => element === window.workingMask")
        page.keyboard.press("Control+z")
        assert pixel_alpha(dialog.locator(".eime-mask-canvas")) == 0
        page.keyboard.press("Control+Shift+z")
        assert pixel_alpha(dialog.locator(".eime-mask-canvas")) > 240
        dialog.get_by_role("button", name="裁切与填充", exact=True).click()
        dialog.get_by_label("构图方式").select_option("pad")
        dialog.get_by_label("画幅比例").select_option("1:1")
        clipped = dialog.locator(".eime-frame").bounding_box()
        assert abs(clipped["width"] - clipped["height"]) < 1
        assert dialog.locator(".eime-dimensions").inner_text() == "画幅 320 × 320 · 输出 1120 × 1120"
        dialog.get_by_label("构图方式").select_option("crop")
        dialog.get_by_role("button", name="完成构图", exact=True).click()
        assert dialog.get_by_role("button", name="画笔", exact=True).get_attribute("aria-pressed") == "true"
        assert dialog.locator(".eime-frame").is_visible()
        assert dialog.locator(".eime-dimensions").inner_text() == "画幅 240 × 240 · 输出 1120 × 1120"
        page.keyboard.press("Escape")
        dialog.wait_for(state="hidden", timeout=4000)
        assert editor.locator(".eime-mask-canvas").evaluate("(element) => element === window.workingMask")
        assert editor.locator(".eime-frame").is_visible()
        editor.get_by_role("button", name="裁切与填充", exact=True).click()
        editor.get_by_role("button", name="重置构图", exact=True).click()
        editor.get_by_role("button", name="画笔", exact=True).click()
        stage = editor.locator(".eime-stage")
        picture_node = editor.locator(".eime-picture")
        before = picture_node.bounding_box()
        anchor_x = before["x"] + before["width"] * 0.33
        anchor_y = before["y"] + before["height"] * 0.67
        page.mouse.move(anchor_x, anchor_y)
        page.mouse.wheel(0, -150)
        page.wait_for_function("""w => document.querySelector('.eime-picture').getBoundingClientRect().width > w + 3""", arg=before["width"], timeout=3500)
        after = picture_node.bounding_box()
        assert abs((anchor_x - after["x"]) / after["width"] - 0.33) < 0.01
        assert abs((anchor_y - after["y"]) / after["height"] - 0.67) < 0.01
        editor.get_by_role("button", name="适合窗口", exact=True).click()
        editor.get_by_role("button", name="撤销", exact=True).click()
        assert pixel_alpha(mask) == 0
        editor.get_by_role("button", name="重做", exact=True).click()
        assert pixel_alpha(mask) > 240
        editor.get_by_role("button", name="方头", exact=True).click()
        drawn = editor.locator(".eime-picture").bounding_box()
        page.mouse.click(drawn["x"] + drawn["width"] / 2, drawn["y"] + drawn["height"] / 4)
        assert pixel_alpha(mask, 181, 81) > 200
        editor.get_by_role("button", name="撤销", exact=True).click()
        assert pixel_alpha(mask, 181, 81) == 0
        editor.get_by_label("显示遮罩").uncheck()
        assert not mask.is_visible()
        editor.get_by_label("显示遮罩").check()
        assert mask.is_visible()

        editor.get_by_role("button", name="绘画层", exact=True).click()
        editor.get_by_role("button", name="填充", exact=True).click()
        assert pixel_alpha(paint) > 240 and pixel_alpha(paint, 0, 0) == 0
        editor.get_by_role("button", name="橡皮", exact=True).click()
        picture = editor.locator(".eime-picture").bounding_box()
        x = picture["x"] + picture["width"] / 2
        y = picture["y"] + picture["height"] / 2
        page.mouse.click(x, y)
        assert pixel_alpha(paint) == 0 and pixel_alpha(mask) > 240
        editor.get_by_role("button", name="撤销", exact=True).click()
        assert pixel_alpha(paint) > 240
        page.evaluate("""() => {
            const app = window.comfyAPI.app.app;
            const gate = window.LiteGraph.createNode('EagleReviewGate');
            gate.pos = [835, 300];
            app.graph.add(gate);
            gate.onExecuted({eagle_review:[{state:'bypass',images:[{filename:'comparison-result.png',type:'temp'}]}]});
        }""")
        with page.expect_request(lambda request: urlparse(request.url).path.endswith("/upload/image")):
            page.evaluate("""() => {
                const app = window.comfyAPI.app.app;
                const nodeId = app.graph._nodes[0].id;
                window.imageEditorPrompt = app.graphToPrompt().then(({output, workflow}) => ({
                    inputs: output[nodeId]?.inputs,
                    node: workflow.nodes.find(node => String(node.id) === String(nodeId)),
                }));
            }""")
        preview = page.locator(".eg-review")
        preview.get_by_role("button", name="发送到加载图像", exact=True).click(timeout=4000)
        preview.get_by_text("目标节点正在上传或有未保存的编辑").wait_for(timeout=4000)
        assert ("", "comparison-result.png") not in uploads
        held_route, response = deferred_upload[0]
        held_route.fulfill(json=response)
        prepared = page.evaluate("window.imageEditorPrompt")
        inputs = prepared["inputs"]
        assert inputs["image"] == "fixture.png"
        assert inputs["尺寸模式"] == "按百万像素" and inputs["百万像素"] == 1.25
        assert not inputs["legacy_resize"]
        assert not {"输出宽度", "输出高度", "缩放百分比", "倍数对齐"} & inputs.keys()
        assert inputs["edit_layers"], "Submitting directly must include the latest unsaved drawing"
        workflow_node = prepared["node"]
        if "widgets_values_named" in workflow_node:
            assert workflow_node["widgets_values_named"]["edit_layers"] == inputs["edit_layers"]
        assert inputs["edit_layers"] in workflow_node["widgets_values"]
        state = json.loads(inputs["edit_layers"])
        assert state["source"] == "fixture.png"
        for layer in ("mask", "paint"):
            folder, name = state[layer].split("/", 1)
            assert folder == "eagle_image_editor"
            with Image.open(io.BytesIO(files[(folder, name)])) as png:
                assert png.size == (320, 240) and png.getpixel((160, 120))[3] > 240
                assert png.getpixel((10, 10))[3] == 0
        assert not prompts, "Preparing inputs must not submit a second prompt"

        page.evaluate("""async () => {
            const app = window.comfyAPI.app.app;
            await app.loadGraphData(app.graph.serialize());
        }""")
        editor.get_by_role("button", name="适合窗口", exact=True).click(timeout=4000)
        mask.wait_for(state="visible", timeout=4000)
        assert pixel_alpha(mask) > 240 and pixel_alpha(paint) > 240
        editor.get_by_role("button", name="退出编辑", exact=True).click(timeout=4000)
        page.evaluate("""() => {
            const graph = window.comfyAPI.app.app.graph;
            const node = graph._nodes.find(item => item.type === 'EagleImageMaskEditor');
            const widget = node.widgets.find(w => w.name === 'edit_layers');
            const previous = widget.value;
            const record = JSON.parse(previous);
            record.paint = 'eagle_image_editor/missing-paint.png';
            widget.value = JSON.stringify(record);
            node.onWidgetChanged(widget.name, widget.value, previous, widget);
        }""")
        editor.get_by_role("button", name="移除失效图层", exact=True).click(timeout=4000)
        editor.get_by_role("button", name="适合窗口", exact=True).click(timeout=4000)
        mask.wait_for(state="visible", timeout=4000)
        assert pixel_alpha(mask) > 240 and pixel_alpha(paint) == 0

        # A future draft upstream must never be written by approving the
        # retained candidate, even if that draft's upload would fail.
        drawn = editor.locator(".eime-picture").bounding_box()
        page.mouse.click(drawn["x"] + drawn["width"] / 2, drawn["y"] + drawn["height"] / 4)
        assert editor.get_by_role("button", name="保存编辑", exact=True).is_enabled()
        page.evaluate("""() => {
            const graph = window.comfyAPI.app.app.graph;
            const editor = graph._nodes.find(node => node.type === 'EagleImageMaskEditor');
            const gate = graph._nodes.find(node => node.type === 'EagleReviewGate');
            const sink = graph._nodes.find(node => node.type === 'FixtureImageSink');
            editor.connect(0, gate, 0);
            gate.connect(0, sink, 0);
            gate.onExecuted({eagle_review:[{state:'pending',token:'fixture-token',
                images:[{filename:'comparison-result.png',type:'temp'}]}]});
        }""")
        deny_layers = True
        upload_count = len(uploads)
        with page.expect_request(lambda request: request.method == "POST" and urlparse(request.url).path.endswith("/prompt")):
            page.locator(".eg-review").get_by_role("button", name="继续下游", exact=True).click(timeout=4000)
        assert len(prompts) == 1 and len(uploads) == upload_count
        assert editor.get_by_role("button", name="保存编辑", exact=True).is_enabled()

        deny_layers = False
        dispatch_image(page, "gallery", "gallery.png", ".eime-stage")
        editor.locator(".eime-base[src*='gallery.png']").wait_for(state="visible", timeout=4000)
        assert uploads[-1] == ("", "gallery.png") and uploads[-2][0] == "eagle_image_editor"

        ids = page.evaluate("""() => {
            const graph = window.comfyAPI.app.app.graph;
            const editor = graph._nodes.find(node => node.type === 'EagleImageMaskEditor');
            const source = window.LiteGraph.createNode("FixtureImageSource");
            const sam = window.LiteGraph.createNode("FixtureSAM3Loader");
            source.pos = [10, 150];
            sam.pos = [10, 350];
            graph.add(source);
            graph.add(sam);
            source.connect(0, editor, editor.inputs.findIndex(input => input.name === 'image_input'));
            sam.connect(0, editor, editor.inputs.findIndex(input => input.name === 'sam_model'));
            sam.connect(1, editor, editor.inputs.findIndex(input => input.name === 'clip'));
            const queuePrompt = window.comfyAPI.app.app.queuePrompt;
            window.comfyAPI.app.app.queuePrompt = async function (...args) {
                await queuePrompt.apply(this, args);
            };
            return {editor: String(editor.id), source: String(source.id), model: String(sam.id)};
        }""")
        with page.expect_request(lambda req: req.method == "POST" and urlparse(req.url).path.endswith("/prompt")):
            editor.get_by_role("button", name="读取连线图像", exact=True).click(timeout=4000)
        preview_submission = prompts[-1]
        assert preview_submission["partial_execution_targets"] == [ids["editor"]]
        preview_inputs = preview_submission["prompt"][ids["editor"]]["inputs"]
        assert list(map(str, preview_inputs["image_input"])) == [ids["source"], "0"]
        assert list(map(str, preview_inputs["sam_model"])) == [ids["model"], "0"]
        request = json.loads(preview_inputs["editor_request"])
        assert request["action"] == "preview"
        linked_source = "linked:" + "a" * 64
        linked_preview = {"filename": "sam-source.png", "subfolder": "eagle_image_editor", "type": "temp"}
        editor_result(page, {"request_id": request["id"], "source": linked_source, "image": linked_preview})
        editor.locator(".eime-base[src*='sam-source.png']").wait_for(state="visible", timeout=4000)
        page.wait_for_function("!window.comfyAPI.app.app.processingQueue", timeout=3000)

        editor.get_by_role("button", name="SAM 分割", exact=True).click()
        box = editor.locator(".eime-stage").bounding_box()
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        editor.get_by_label("SAM 提示点").select_option("0")
        box = editor.locator(".eime-picture").bounding_box()
        page.mouse.click(box["x"] + box["width"] / 3, box["y"] + box["height"] / 3)
        points = editor.locator(".eime-point")
        assert points.count() == 2
        page.keyboard.press("Control+z")
        assert points.count() == 1 and points.first.inner_text() == "+"
        page.keyboard.press("Control+Shift+z")
        assert points.count() == 2

        editor.get_by_label("提示点大小").fill("38")
        assert points.evaluate_all("(items) => items.map(point => getComputedStyle(point).width)") == ["38px", "38px"]
        mark_width = points.nth(1).bounding_box()["width"]
        editor.get_by_role("button", name="缩小", exact=True).click()
        assert editor.locator(".eime-picture").bounding_box()["width"] < box["width"]
        assert abs(points.nth(1).bounding_box()["width"] - mark_width) < 0.1
        editor.get_by_role("button", name="适合窗口", exact=True).click()

        mark = points.first.bounding_box()
        page.mouse.dblclick(mark["x"] + mark["width"] / 2, mark["y"] + mark["height"] / 2)
        assert points.count() == 1 and points.first.inner_text() == "−"
        assert not editor.get_by_role("button", name="生成 SAM 遮罩", exact=True).is_enabled()
        editor.get_by_role("button", name="撤销", exact=True).click()
        assert points.count() == 2

        editor.get_by_role("button", name="打开大画布", exact=True).click()
        dialog.wait_for(state="visible", timeout=4000)
        modal_points = dialog.locator(".eime-point")
        assert dialog.get_by_label("提示点大小").input_value() == "38"
        mark = modal_points.nth(1).bounding_box()
        page.mouse.dblclick(mark["x"] + mark["width"] / 2, mark["y"] + mark["height"] / 2)
        assert modal_points.count() == 1 and modal_points.first.inner_text() == "+"
        page.keyboard.press("Control+z")
        assert modal_points.count() == 2
        dialog.get_by_role("button", name="清除提示点", exact=True).click()
        assert modal_points.count() == 0
        page.keyboard.press("Control+z")
        assert modal_points.count() == 2
        page.keyboard.press("Control+y")
        assert modal_points.count() == 0
        dialog.get_by_role("button", name="撤销", exact=True).click()
        assert modal_points.count() == 2
        page.keyboard.press("Escape")
        dialog.wait_for(state="hidden", timeout=4000)
        assert points.count() == 2
        assert not editor.get_by_role("button", name="保存编辑", exact=True).is_enabled()
        with page.expect_request(lambda req: req.method == "POST" and urlparse(req.url).path.endswith("/prompt")):
            editor.get_by_role("button", name="生成 SAM 遮罩", exact=True).click(timeout=4000)
        segment_submission = prompts[-1]
        request = json.loads(segment_submission["prompt"][ids["editor"]]["inputs"]["editor_request"])
        assert request["action"] == "segment" and request["source"] == linked_source
        assert [point[2] for point in request["points"]] == [1, 0]
        assert all(0 <= coord <= 1 for point in request["points"] for coord in point[:2])
        serialized = segment_submission["extra_data"]["extra_pnginfo"]["workflow"]
        workflow_node = next(node for node in serialized["nodes"] if str(node["id"]) == ids["editor"])
        assert "editor_request" not in workflow_node.get("widgets_values_named", {})
        assert not any(isinstance(value, str) and request["id"] in value for value in workflow_node["widgets_values"])
        candidate = {"filename": "sam-mask.png", "subfolder": "eagle_image_editor", "type": "temp"}
        editor_result(page, {"request_id": request["id"], "source": linked_source, "image": linked_preview, "mask": candidate})
        editor.get_by_text("SAM 遮罩已应用，可继续编辑或撤销").wait_for(timeout=4000)
        assert pixel_alpha(mask, 60, 60) == 224 and pixel_alpha(mask, 10, 10) == 0
        editor.get_by_role("button", name="撤销", exact=True).click()
        assert pixel_alpha(mask, 60, 60) == 0 and points.count() == 2
        editor.get_by_role("button", name="重做", exact=True).click()
        assert pixel_alpha(mask, 60, 60) == 224
        editor.get_by_label("自动扩展遮罩").check()
        editor.get_by_role("button", name="还原原图", exact=True).click()
        assert points.count() == 0 and pixel_alpha(mask, 60, 60) == 0
        assert not editor.get_by_label("自动扩展遮罩").is_checked()
        assert editor.get_by_label("提示点大小").input_value() == "22"
        reset_size = page.evaluate("""() => window.comfyAPI.app.app.graph._nodes
            .find(node => node.type === 'EagleImageMaskEditor').widgets.find(w => w.name === '尺寸模式').value""")
        assert reset_size == "原图"
        page.keyboard.press("Control+z")
        assert points.count() == 2 and pixel_alpha(mask, 60, 60) == 224
        assert editor.get_by_label("自动扩展遮罩").is_checked()
        assert editor.get_by_label("提示点大小").input_value() == "38"
        editor.get_by_label("自动扩展遮罩").uncheck()
        prepared = page.evaluate("""async id => (await window.comfyAPI.app.app.graphToPrompt()).output[id].inputs""", ids["editor"])
        assert json.loads(prepared["edit_layers"])["source"] == linked_source
        assert not prepared.get("editor_request")
        saved_points = json.loads(prepared["editor_adjustments"])["sam"]
        assert saved_points["mode"] == "points" and saved_points["source"] == linked_source
        assert [point[2] for point in saved_points["points"]] == [1, 0]
        assert editor.get_by_label("细化迭代次数").input_value() == "2"
        assert not editor.get_by_label("文本检测阈值").is_visible()
        page.wait_for_function("!window.comfyAPI.app.app.processingQueue", timeout=3000)
        editor.get_by_label("SAM 模式").select_option("text")
        editor.get_by_role("textbox", name="SAM 文本", exact=True).fill("backpack\nhelmet")
        editor.get_by_label("文本检测阈值").fill("0.7")
        editor.get_by_label("细化迭代次数").fill("4")
        page.evaluate("""() => {
            const graph = window.comfyAPI.app.app.graph;
            const editor = graph._nodes.find(node => node.type === 'EagleImageMaskEditor');
            const text = window.LiteGraph.createNode('FixtureTextSource');
            graph.add(text);
            text.connect(0, editor, editor.inputs.findIndex(input => input.name === 'sam_text'));
        }""")
        textbox = editor.get_by_role("textbox", name="SAM 文本", exact=True)
        assert textbox.get_attribute("readonly") is not None
        with page.expect_request(lambda req: req.method == "POST" and urlparse(req.url).path.endswith("/prompt")):
            editor.get_by_role("button", name="生成 SAM 遮罩", exact=True).click(timeout=4000)
        text_inputs = prompts[-1]["prompt"][ids["editor"]]["inputs"]
        request = json.loads(text_inputs["editor_request"])
        assert request["mode"] == "text" and "points" not in request
        assert not text_inputs["sam_auto"] and text_inputs["sam_prompt"] == "backpack\nhelmet"
        settings = json.loads(text_inputs["editor_adjustments"])
        assert settings["expand"] == 32
        assert settings["sam"] == {**saved_points, "mode": "text", "threshold": .7, "refine_iterations": 4}
        assert text_inputs["clip"][1] == 1 and text_inputs["sam_text"][1] == 0
        editor_result(page, {"request_id": request["id"], "source": linked_source, "image": linked_preview,
                             "mask": candidate, "sam_text": "linked target"})
        editor.get_by_text("SAM 遮罩已应用，可继续编辑或撤销").wait_for(timeout=4000)
        assert textbox.input_value() == "linked target"
        editor.get_by_label("遮罩颜色").fill("#24dc56")
        editor.get_by_label("叠加透明度").fill("100")
        automatic_candidate = {"filename": "automatic-mask.png", "subfolder": "eagle_image_editor", "type": "temp"}
        editor_result(page, {"source": linked_source, "image": linked_preview, "sam_mode": "text",
                             "automatic_mask": automatic_candidate})
        automatic = editor.locator(".eime-automatic-mask[src*='automatic-mask.png']")
        automatic.wait_for(state="visible", timeout=4000)
        assert not mask.is_visible() and pixel_alpha(mask, 60, 60) == 224 and pixel_alpha(mask, 200, 150) == 0
        picture = editor.locator(".eime-picture")
        source_x, source_y = 200.5 / 320, 150.5 / 240
        assert_green_overlay(picture, source_x, source_y)
        orientation = editor.get_by_role("group", name="图像方向")
        orientation.get_by_role("button", name="向右旋转 90°").click()
        assert editor.locator(".eime-dimensions").inner_text().startswith("画幅 240 × 320")
        assert_green_overlay(picture, 1 - source_y, source_x)
        orientation.get_by_role("button", name="水平镜像").click()
        orientation.get_by_role("button", name="垂直镜像").click()
        assert_green_overlay(picture, source_y, 1 - source_x)
        direction = page.evaluate("""async id => JSON.parse(
            (await window.comfyAPI.app.app.graphToPrompt()).output[id].inputs.editor_adjustments)""", ids["editor"])
        assert (direction["rotation"], direction["flip_x"], direction["flip_y"]) == (90, True, True)
        page.keyboard.press("Control+z")
        assert_green_overlay(picture, source_y, source_x)
        orientation.get_by_role("button", name="水平镜像").click()
        orientation.get_by_role("button", name="向左旋转 90°").click()
        assert_green_overlay(picture, source_x, source_y)
        editor.get_by_label("显示遮罩").uncheck()
        assert not automatic.is_visible()
        editor.get_by_label("显示遮罩").check()
        assert automatic.is_visible()
        editor.get_by_label("自动扩展遮罩").check()
        effect.wait_for(state="visible", timeout=3000)
        assert pixel_alpha(effect, 171, 150) == 255 and pixel_alpha(effect, 60, 60) == 0
        editor.get_by_label("自动扩展遮罩").uncheck()
        editor.get_by_label("SAM 模式").select_option("points")
        assert not automatic.is_visible() and mask.is_visible()
        assert pixel_alpha(mask, 60, 60) == 224
        editor_result(page, {"source": linked_source, "image": linked_preview, "sam_mode": "text",
                             "automatic_mask": automatic_candidate})
        assert not automatic.is_visible()
        assert points.count() == 2
        editor.get_by_label("SAM 模式").select_option("text")
        editor_result(page, {"source": linked_source, "image": linked_preview, "sam_mode": "text",
                             "automatic_mask": automatic_candidate})
        automatic.wait_for(state="visible")
        assert automatic.is_visible()
        assert not editor.get_by_role("button", name="保存编辑", exact=True).is_enabled()
        page.evaluate("""() => {
            const graph = window.comfyAPI.app.app.graph;
            const editor = graph._nodes.find(node => node.type === 'EagleImageMaskEditor');
            editor.disconnectInput(editor.inputs.findIndex(input => input.name === 'sam_text'));
        }""")
        assert textbox.input_value() == "backpack\nhelmet"
        page.wait_for_function("!window.comfyAPI.app.app.processingQueue", timeout=3000)
        with page.expect_request(lambda req: req.method == "POST" and urlparse(req.url).path.endswith("/prompt")):
            editor.get_by_role("button", name="读取连线图像", exact=True).click(timeout=4000)
        pending = json.loads(prompts[-1]["prompt"][ids["editor"]]["inputs"]["editor_request"])
        page.evaluate("""() => {
            const graph = window.comfyAPI.app.app.graph;
            const node = graph._nodes.find(n => n.type === 'EagleImageMaskEditor');
            const replacement = window.LiteGraph.createNode('FixtureImageSource');
            graph.add(replacement);
            replacement.connect(0, node, node.inputs.findIndex(input => input.name === 'image_input'));
        }""")
        editor.get_by_text("连线已变更，请重新读取或生成", exact=True).wait_for(timeout=3000)
        editor_result(page, {"request_id": pending["id"], "source": linked_source, "image": linked_preview})
        assert editor.locator(".eime-base").get_attribute("src") is None
        assert not automatic.is_visible()

        page.wait_for_function("!window.comfyAPI.app.app.processingQueue", timeout=3000)
        editor.get_by_role("button", name="打开大画布", exact=True).click()
        with page.expect_request(lambda req: req.method == "POST" and urlparse(req.url).path.endswith("/prompt")):
            page.keyboard.press("Control+Enter")
        assert not prompts[-1].get("partial_execution_targets")
        assert not prompts[-1]["prompt"][ids["editor"]]["inputs"].get("editor_request")
        page.keyboard.press("Escape")
        dialog.wait_for(state="hidden")

        page.evaluate("""async () => {
            const app = window.comfyAPI.app.app;
            await app.loadGraphData(app.graph.serialize());
        }""")
        editor_result(page, {"source": linked_source, "image": linked_preview})
        editor.locator(".eime-base[src*='sam-source.png']").wait_for(state="visible")
        editor.get_by_label("SAM 模式").select_option("points")
        editor.get_by_role("button", name="SAM 分割", exact=True).click()
        assert points.count() == 2
        print(f"Nodes {2 if modern else 1}.0: white PNG, model upscale popup, saved SAM points and active mode PASS")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend-dir", type=Path, required=True)
    parser.add_argument("--web-dir", type=Path, default=ROOT / "web")
    args = parser.parse_args()
    with sync_playwright() as playwright, playwright.chromium.launch(channel="chrome", headless=True) as browser:
        for modern in (False, True):
            run(browser, args.frontend_dir, args.web_dir, modern)


if __name__ == "__main__":
    main()
