"""Exercise mask growth, replacement, and undo with real Chromium canvases."""

import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright


CANVAS_MODULE = Path(__file__).resolve().parents[1] / "web" / "js" / "image_mask_canvas.js"


def prepare(page):
    page.evaluate("""async source => {
        const { ImageEditorSurface } = await import(`data:text/javascript,${encodeURIComponent(source)}`);

        function canvas(width, height) {
            const element = document.createElement('canvas');
            element.width = width;
            element.height = height;
            return element;
        }

        function fromPoints(width, height, points) {
            const element = canvas(width, height);
            const context = element.getContext('2d');
            const rgba = context.createImageData(width, height);
            for (const [x, y, alpha] of points) {
                rgba.data.set([22, 181, 45, alpha], (y * width + x) * 4);
            }
            context.putImageData(rgba, 0, 0);
            return element;
        }

        async function decode(element) {
            const image = new Image();
            image.src = element.toDataURL('image/png');
            await image.decode();
            return image;
        }

        function makeSurface(width, height, points) {
            const base = {naturalWidth: width, naturalHeight: height};
            const paint = canvas(width, height);
            const context = paint.getContext('2d');
            context.fillStyle = '#ff8800';
            context.fillRect(0, 0, width, height);
            return new ImageEditorSurface({mask: canvas(width, height), paint: canvas(width, height)},
                base, {mask: fromPoints(width, height, points), paint});
        }

        function alphaOf(surface) {
            const data = surface.contexts.mask.getImageData(0, 0, surface.width, surface.height).data;
            return [...data].filter((_, index) => index % 4 === 3);
        }

        window.testMaskSurface = {makeSurface, alphaOf, canvas, fromPoints, decode};
    }""", CANVAS_MODULE.read_text(encoding="utf-8"))


def check_grow(page):
    width, height = 8, 7
    points = [(1, 1, 101), (4, 1, 207), (7, 5, 53)]
    result = page.evaluate("""([width, height, points]) => {
        const { makeSurface, alphaOf } = window.testMaskSurface;
        const surface = makeSurface(width, height, points);
        const initial = alphaOf(surface);
        const nonpositive = surface.growMask(0);
        const invalid = surface.growMask(Infinity);
        const changed = surface.growMask(2);
        const grown = alphaOf(surface);
        surface.undo();
        const undone = alphaOf(surface);
        surface.redo();
        const redone = alphaOf(surface);
        const wide = surface.growMask(10_000);
        const filled = alphaOf(surface);
        const unchanged = surface.growMask(2);
        const paint = [...surface.contexts.paint.getImageData(0, 0, 1, 1).data];
        return {initial, nonpositive, invalid, changed, grown, undone, redone, wide, filled,
            unchanged, paint, dirty: [...surface.dirtyLayers]};
    }""", [width, height, points])
    expected = [max([alpha for sx, sy, alpha in points if abs(x - sx) <= 2 and abs(y - sy) <= 2] + [0])
                for y in range(height) for x in range(width)]
    assert result["changed"] and result["grown"] == expected
    assert result["initial"] == result["undone"] and result["redone"] == expected
    assert result["wide"] and result["filled"] == [207] * (width * height)
    assert not (result["nonpositive"] or result["invalid"] or result["unchanged"])
    assert result["paint"] == [255, 136, 0, 255] and result["dirty"] == ["mask"]


def check_replace(page):
    result = page.evaluate("""async () => {
        const { makeSurface, alphaOf, fromPoints, decode } = window.testMaskSurface;
        const surface = makeSurface(3, 2, [[1, 0, 149]]);
        const image = await decode(fromPoints(3, 2, [[0, 0, 255], [2, 1, 77]]));
        const changed = surface.replaceMask(image);
        const replaced = alphaOf(surface);
        let invalidSize;
        try {
            surface.replaceMask(await decode(fromPoints(4, 2, [[0, 0, 255]])));
        } catch (error) {
            invalidSize = error.name;
        }
        const unchanged = surface.replaceMask(image);
        surface.undo();
        const undone = alphaOf(surface);
        surface.redo();
        const redone = alphaOf(surface);
        const paint = [...surface.contexts.paint.getImageData(0, 0, 1, 1).data];
        return {changed, replaced, invalidSize, unchanged, undone, redone, paint,
            dirty: [...surface.dirtyLayers]};
    }""")
    assert result["changed"] and result["replaced"] == [255, 0, 0, 0, 0, 77]
    assert result["invalidSize"] == "RangeError" and not result["unchanged"]
    assert result["undone"] == [0, 149, 0, 0, 0, 0]
    assert result["redone"] == result["replaced"]
    assert result["paint"] == [255, 136, 0, 255] and result["dirty"] == ["mask"]


def check_reset(page):
    result = page.evaluate("""async () => {
        const { makeSurface, alphaOf, fromPoints, decode } = window.testMaskSurface;
        const surface = makeSurface(3, 2, [[1, 0, 149]]);
        const source = await decode(fromPoints(3, 2, [[0, 0, 255], [1, 0, 88], [2, 1, 255]]));
        let setting = "edited";
        const state = () => [alphaOf(surface), surface.contexts.paint.getImageData(0, 0, 1, 1).data[3], setting];
        const edited = state();
        const changed = surface.resetToSource(source, () => { setting = "edited"; }, () => { setting = "source"; });
        const reset = state();
        surface.undo();
        const undone = state();
        surface.redo();
        return { changed, edited, reset, undone, redone: state(), dirty: [...surface.dirtyLayers] };
    }""")
    assert result["changed"] and result["edited"] == result["undone"]
    assert result["reset"] == result["redone"] == [[0, 167, 255, 255, 255, 0], 0, "source"]
    assert set(result["dirty"]) == {"mask", "paint"}


def check_4k(page):
    result = page.evaluate("""() => {
        const { makeSurface } = window.testMaskSurface;
        const surface = makeSurface(3840, 2160, [[1920, 1080, 153]]);
        const start = performance.now();
        const changed = surface.growMask(64);
        const duration = performance.now() - start;
        const pixel = (x, y) => surface.contexts.mask.getImageData(x, y, 1, 1).data[3];
        const boundary = [pixel(1856, 1080), pixel(1855, 1080), pixel(1920, 1016), pixel(1920, 1015)];
        const undoBytes = surface.undoStack[0]?.bytes;
        surface.undo();
        return {changed, duration, boundary, undoBytes, afterUndo: [pixel(1920, 1080), pixel(1856, 1080)]};
    }""")
    assert result["changed"] and result["boundary"] == [153, 0, 153, 0]
    assert result["afterUndo"] == [153, 0]
    assert 0 < result["undoBytes"] < 3840 * 2160 * 4, "Sparse growth must retain only changed tiles"
    print(f"4K growth, radius 64: {result['duration']:.1f} ms, {result['undoBytes'] // 1024} KiB undo")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=("grow", "replace", "reset", "4k"))
    args = parser.parse_args()
    checks = {"grow": check_grow, "replace": check_replace, "reset": check_reset, "4k": check_4k}
    with sync_playwright() as playwright, playwright.chromium.launch(channel="chrome", headless=True) as browser:
        page = browser.new_page()
        prepare(page)
        for name, check in checks.items():
            if args.case in (None, name):
                check(page)
                print(f"Mask canvas {name}: PASS")


if __name__ == "__main__":
    main()
