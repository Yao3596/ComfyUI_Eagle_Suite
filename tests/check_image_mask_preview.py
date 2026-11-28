"""Exercise image editor preview geometry, pixel picking, and alpha effects in Chromium."""

import ast
import json
import math
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

from check_image_mask_canvas import prepare as prepare_canvases
from test_image_editor_geometry import geometry, settings


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "web" / "js" / "image_mask_preview.js"


def check_geometry(page):
    cases = []
    for resolution in ((1, 1), (7, 5), (5, 3), (1001, 700), (700, 1001), (3840, 2160)):
        for ratio in ("original", "1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"):
            for framing in ("crop", "pad"):
                for zoom in (.25, .5, 1, 1.5, 4):
                    for x, y in ((0, 1), (.5, .5), (.25, .75)):
                        cases.append([*resolution, {"ratio": ratio, "framing": framing, "zoom": zoom, "x": x, "y": y}])
    results = page.evaluate("cases => cases.map(args => window.testMaskPreview.frameGeometry(...args))", cases)
    for (width, height, options), actual in zip(cases, results, strict=True):
        output, draw, left, top = geometry.frame_geometry((width, height), settings(**options))
        assert actual == dict(width=output[0], height=output[1], drawWidth=draw[0], drawHeight=draw[1], left=left, top=top)
    assert page.evaluate("""() => {
        const { frameGeometry } = window.testMaskPreview;
        try { frameGeometry(4096, 11000, {ratio:'16:9', framing:'pad'}); }
        catch (error) { return error.name === 'RangeError'; }
        return false;
    }""")
    print(f"Frame geometry matched Python in {len(cases)} cases.")


def backend_output_sizing():
    path = ROOT / "eagle_suite" / "image_mask_editor.py"
    syntax = ast.parse(path.read_text(encoding="utf-8"))
    functions = {"_legacy_resize_options", "_resized_dimensions", "_aligned_length"}
    constants = {"_LIMIT_EDGE", "_ORIGINAL", "_MEGAPIXELS", "_SCALE", "_EXACT_SIZE", "_NO_ALIGNMENT", "_CROP",
                 "_EXPAND", "_NEAREST", "_MAX_DIMENSION", "_MIN_MEGAPIXELS", "_MAX_MEGAPIXELS"}
    definitions = [node for node in syntax.body if (
        isinstance(node, ast.FunctionDef) and node.name in functions or
        isinstance(node, ast.Assign) and getattr(node.targets[0], "id", None) in constants
    )]
    # Run the Python editor's resize preparation and actual size helpers without loading ComfyUI.
    editor = next(node for node in syntax.body if isinstance(node, ast.ClassDef) and node.name == "EagleImageMaskEditor")
    load = next(node for node in editor.body if isinstance(node, ast.FunctionDef) and node.name == "load_image")
    body = next(node.body for node in load.body if isinstance(node, ast.Try))
    start = next(index for index, node in enumerate(body) if isinstance(node, ast.Assign)
                 and isinstance(node.targets[0], ast.Tuple) and node.targets[0].elts[0].id == "mode")
    end = next(index for index, node in enumerate(body) if isinstance(node, ast.Assign)
               and isinstance(node.value, ast.Call)
               and getattr(node.value.func, "id", None) in {"read_adjustment_values", "parse_adjustments"})
    namespace = {"json": json, "math": math}
    exec(compile(ast.Module(body=definitions, type_ignores=[]), str(path), "exec"), namespace)
    prepare = compile(ast.Module(body=body[start:end], type_ignores=[]), str(path), "exec")

    def output_size(width, height, options):
        values = {"尺寸模式": options.get("mode", "限制长边"), "最长边": options.get("longestEdge", 2048),
                  "百万像素": options.get("megapixels", 1), "对齐倍数": options.get("multiple", 8),
                  "legacy_resize": options.get("legacyResize", "")}
        exec(prepare, namespace, values)
        dims = namespace["_resized_dimensions"](
            (width, height), values["mode"], values["最长边"], values["百万像素"],
            values["percent"], values["width"], values["height"],
        )
        return {key: namespace["_aligned_length"](length, values["alignment"], values["对齐倍数"])
                for key, length in zip(("width", "height"), dims, strict=True)}

    return output_size


def check_output_size(page):
    current = [{}, {"mode": "原图", "multiple": 64}, {"mode": "限制长边", "longestEdge": 100, "multiple": 128}]
    current.extend({"mode": "按百万像素", "megapixels": mp, "multiple": alignment}
                   for mp in (.01, .99, 1.5, 64) for alignment in (1, 3, 8, 64, 256))
    legacy = [
        {"mode": "等比例缩放", "percent": 50}, {"mode": "等比例缩放", "percent": 125.5},
        {"mode": "等比例缩放", "percent": 200, "alignment": "居中裁剪"},
        {"mode": "指定尺寸"}, {"mode": "指定尺寸", "width": 18}, {"mode": "指定尺寸", "height": 10},
        {"mode": "指定尺寸", "width": 7, "height": 6}, {"mode": "指定尺寸", "width": 7, "alignment": "居中扩展"},
        {"mode": "原图", "alignment": "居中裁剪"}, {"mode": "原图", "alignment": "居中扩展"},
        {"mode": "限制长边", "alignment": "居中扩展"},
    ]
    current.extend({"mode": "按百万像素", "longestEdge": 100, "multiple": multiple, "legacyResize": json.dumps(value)}
                   for value in legacy for multiple in (1, 16, 128))
    resolutions = ((1, 10000), (7, 5), (9, 5), (13, 11), (80, 125), (150, 37), (320, 480), (2050, 20), (3840, 2160))
    cases = [[*resolution, options] for resolution in resolutions for options in current]
    actual = page.evaluate("cases => cases.map(args => window.testMaskPreview.outputSize(...args))", cases)
    expected_size = backend_output_sizing()
    for args, result in zip(cases, actual, strict=True):
        assert result == expected_size(*args), (args, result, expected_size(*args))
    assert page.evaluate("""() => {
        const { frameGeometry, outputSize } = window.testMaskPreview;
        const frame = frameGeometry(601, 401, {ratio:'16:9'});
        return [frame.width, frame.height, outputSize(frame.width, frame.height, {longestEdge:256})];
    }""") == [601, 338, {"width": 256, "height": 144}]

    invalid = [
        {"mode": "未知"}, {"mode": "按百万像素", "megapixels": .009}, {"mode": "按百万像素", "multiple": 257},
        {"legacyResize": "{"}, {"legacyResize": "null"}, {"legacyResize": '{"mode":"指定尺寸","width":16385}'},
        {"legacyResize": '{"mode":"按百万像素"}'}, {"legacyResize": '{"mode":"原图","alignment":"nearest"}'},
        {"legacyResize": '{"mode":"等比例缩放","percent":401}'},
    ]
    for controls in invalid:
        try:
            expected_size(150, 37, controls)
        except ValueError:
            continue
        raise AssertionError(f"Python accepted invalid resize controls {controls}")
    assert page.evaluate("""cases => cases.every(options => {
        try { window.testMaskPreview.outputSize(150, 37, options); }
        catch (error) { return error.name === 'RangeError'; }
        return false;
    })""", invalid)
    print(f"Final editor output matched Python in {len(cases)} current and legacy resize cases.")


def check_color(page):
    colors = page.evaluate("""async () => {
        const { canvas, decode } = window.testMaskSurface;
        const { sampleImageColor } = window.testMaskPreview;
        const source = canvas(4, 3);
        const original = source.getContext('2d');
        original.fillStyle = '#102040';
        original.fillRect(1, 0, 1, 1);
        const base = await decode(source);
        base.style.opacity = '0';
        const paint = canvas(4, 3);
        paint.style.opacity = '.05';
        const overlay = paint.getContext('2d');
        overlay.fillStyle = 'rgba(255,0,0,.5)';
        overlay.fillRect(1, 0, 1, 1);
        overlay.fillStyle = '#55aa77';
        overlay.fillRect(2, 1, 1, 1);
        return [sampleImageColor(base, null, 1.9, .7), sampleImageColor(base, canvas(0, 0), 1.9, .7),
                sampleImageColor(base, paint, 1.9, .7),
                sampleImageColor(base, paint, 2, 1), sampleImageColor(base, paint, 0, 0),
                sampleImageColor(base, null, -1, 0), sampleImageColor(base, paint, 4, 1)];
    }""")
    assert colors == ["#102040", "#102040", "#881020", "#55aa77", None, None, None], colors
    print("Original-pixel sampler and paint composition passed.")


def check_mask(page):
    width, height = 23, 19
    points = [(0, 0, 145), (3, 2, 201), (12, 10, 68), (20, 13, 233)]
    previews = page.evaluate("""([w, h, points]) => {
        const { canvas, fromPoints } = window.testMaskSurface;
        const { renderMaskPreview } = window.testMaskPreview;
        const source = fromPoints(w, h, points);
        const target = canvas(w, h);
        const read = (image) => Array.from(image.getContext('2d').getImageData(0, 0, w, h).data)
            .filter((_, index) => index % 4 === 3);
        const before = read(source);
        const result = [];
        for (const options of [{grow:true, expand:2}, {feather:2.25}, {grow:true,expand:2,feather:2.25}]) {
            if (!renderMaskPreview(source, target, w, h, options)) throw new Error('Preview unavailable');
            result.push(read(target));
        }
        const after = read(source);
        const faint = fromPoints(w, h, [[10, 9, 1]]);
        const invisible = renderMaskPreview(faint, target, w, h, {feather:8});
        return {result, unchanged: before.every((value, index) => value === after[index]),
            invisible, transparent: read(target).every(value => value === 0),
            clear: renderMaskPreview(null, target, w, h, {}), width: target.width, height: target.height};
    }""", [width, height, points])
    mask = Image.new("L", (width, height))
    for x, y, value in points:
        mask.putpixel((x, y), value)
    options = (settings(grow=True, expand=2), settings(feather=2.25), settings(grow=True, expand=2, feather=2.25))
    for index, (pixels, controls) in enumerate(zip(previews["result"], options, strict=True)):
        expected = geometry.apply_mask_adjustments(mask, controls).tobytes()
        max_delta = max(abs(p - e) for p, e in zip(pixels, expected, strict=True))
        assert max_delta <= (0 if index == 0 else 4), (controls, max_delta)
    assert previews["unchanged"] and not previews["clear"] and previews["width"] == previews["height"] == 0
    assert not previews["invisible"] and previews["transparent"]
    print("Soft-alpha expansion matched exactly, and the feather preview stayed within four alpha levels.")


def check_preview_bounds(page):
    result = page.evaluate("""() => {
        const { canvas } = window.testMaskSurface;
        const { renderMaskPreview } = window.testMaskPreview;
        const source = canvas(3840, 2160);
        const original = source.getContext('2d');
        original.fillStyle = 'rgba(255,255,255,.6)';
        original.fillRect(1300, 700, 1000, 650);
        const target = canvas(1, 1);
        const start = performance.now();
        const rendered = renderMaskPreview(source, target, source.width, source.height, {grow:true, expand:60, feather:15});
        const elapsed = performance.now() - start;
        const alpha = (x,y) => target.getContext('2d').getImageData(x,y,1,1).data[3];
        return {rendered, elapsed, size:[target.width,target.height], alpha:[alpha(400, 244),alpha(334,244),alpha(310,244)]};
    }""")
    assert result["rendered"] and result["size"] == [1024, 576]
    assert result["alpha"][0] == 153 and 0 < result["alpha"][1] < 153 and result["alpha"][2] == 0, result
    print(f"4K alpha preview capped to 1024×576 in {result['elapsed']:.1f} ms.")


def main():
    with sync_playwright() as playwright, playwright.chromium.launch(channel="chrome", headless=True) as browser:
        page = browser.new_page()
        prepare_canvases(page)
        page.evaluate("""async source => {
            window.testMaskPreview = await import(`data:text/javascript,${encodeURIComponent(source)}`);
        }""", MODULE.read_text(encoding="utf-8"))
        for check in (check_geometry, check_output_size, check_color, check_mask, check_preview_bounds):
            check(page)


if __name__ == "__main__":
    main()
