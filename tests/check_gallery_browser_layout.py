"""Regression check against a running ComfyUI frontend, without submitting jobs.

Run with the environment's Playwright-enabled Python. Only the frontend and node
definitions are read from ComfyUI; gallery data, settings and writes are isolated.
"""

import argparse
import ast
import json
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
EAGLE_PREFIX = "/extensions/ComfyUI_Eagle_Suite/"
TYPES = ("EaglePromptPresets", "EagleLoraGalleryNode", "DanbooruVueSearchNode")


def node_definitions():
    definitions = {}
    for name, path in ((TYPES[0], ROOT / 'nodes/prompt_presets.py'),
                       (TYPES[1], ROOT / 'eagle_suite/lora_gallery.py'),
                       (TYPES[2], ROOT / 'eagle_suite/danbooru_search.py')):
        cls = next(n for n in ast.parse(path.read_text('utf-8-sig')).body
                   if isinstance(n, ast.ClassDef) and n.name == name)
        method = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == 'INPUT_TYPES')
        inputs = ast.literal_eval(next(n.value for n in method.body if isinstance(n, ast.Return)))
        fields = {n.targets[0].id: ast.literal_eval(n.value) for n in cls.body
                  if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
                  and n.targets[0].id in ('RETURN_TYPES','RETURN_NAMES','CATEGORY','OUTPUT_NODE')}
        definitions[name] = {
            'name': name, 'display_name': name, 'description': '',
            'python_module': 'custom_nodes.ComfyUI_Eagle_Suite',
            'input': inputs, 'input_order': {k: list(v) for k,v in inputs.items()},
            'output': fields['RETURN_TYPES'], 'output_name': fields['RETURN_NAMES'],
            'output_is_list': [False] * len(fields['RETURN_TYPES']),
            'category': fields['CATEGORY'], 'output_node': fields.get('OUTPUT_NODE', False),
        }
    for name, module in (('EagleScrollAuditProbe', 'custom_nodes.ComfyUI_Eagle_Suite'),
                         ('EagleScrollForeignProbe', 'custom_nodes.AnotherPlugin')):
        definitions[name] = {
            'name':name, 'display_name':name, 'description':'', 'python_module':module,
            'input':{'required':{}}, 'input_order':{'required':[]},
            'output':['STRING'], 'output_name':['text'], 'output_is_list':[False],
            'category':'Audit', 'output_node':False,
        }
    return definitions


def install_fixture(page, base_url, modern, installed, navigation, frontend):
    origin = urlparse(base_url).netloc

    def route_request(route):
        request = route.request
        parsed = urlparse(request.url)
        path = parsed.path
        if parsed.netloc != origin:
            return route.abort()
        if path in ("/extensions", "/api/extensions"):
            return route.fulfill(json=[
                EAGLE_PREFIX + "js/lora_gallery.js",
                EAGLE_PREFIX + "js/prompt_presets.js",
                EAGLE_PREFIX + "js/danbooru_search_vue.js",
            ])
        if path in ('/settings', '/api/settings') and request.method == "GET":
            return route.fulfill(json={
                "Comfy.VueNodes.Enabled": modern,
                "Comfy.TutorialCompleted": True,
                "Comfy.Canvas.NavigationMode": navigation,
            })
        if path.startswith('/danbooru_search/'):
            return route.fulfill(json={'success':True,'settings':{},'data':{},'profiles':[],
                                       'models':[],'facets':{},'bootstrap':{},'selected_tags':[]})
        if path.startswith(EAGLE_PREFIX) and not installed:
            local = ROOT / "web" / path.removeprefix(EAGLE_PREFIX)
            if local.is_file():
                return route.fulfill(path=str(local))
        if path.startswith("/lora_gallery/"):
            if path.endswith("/list"):
                payload = request.post_data_json or {}
                items = [
                    {"id": str(i), "name": f"Test LoRA {i}",
                     "triggerWords": ["test"], "hasPreview": False}
                    for i in range(40)
                ] if payload.get("page", 1) == 1 else []
                return route.fulfill(json={
                    "success": True, "items": items, "total": 40,
                    "page": payload.get("page", 1),
                })
            if path.endswith("/folders"):
                return route.fulfill(json={"success": True, "folders": [
                    {"id": str(i), "name": f"Test folder {i}", "children": []}
                    for i in range(40)
                ]})
            if path.endswith("/cache_selection") and request.method == "GET":
                return route.fulfill(json={"success": True, "selections": [
                    {"id": str(i), "name": f"Test LoRA {i}", "weight": 1, "enabled": True}
                    for i in range(12)
                ]})
            return route.fulfill(json={"success": True, "items": [], "data": []})
        if path.endswith("/eaglePromptPresets/search_template"):
            return route.fulfill(json={"success": True, "data": {
                "categories": [], "list_data": [
                    {"id": str(i), "Label": f"Test preset {i}",
                     "Instruction": "# Preview\n\n" + "Full Markdown paragraph.\n\n" * 80,
                     "category": "Test", "Source": "custom"}
                    for i in range(50)
                ],
            }})
        if frontend:
            static_path = frontend / (path.lstrip('/') or 'index.html')
            if static_path.is_file():
                return route.fulfill(path=str(static_path))
            endpoint = path.removeprefix('/api')
            if endpoint == '/object_info':
                return route.fulfill(json=node_definitions())
            if endpoint == '/users':
                return route.fulfill(json={'storage': 'server', 'migrated': True})
            if endpoint == '/system_stats':
                return route.fulfill(json={'system': {'os':'nt','comfyui_version':'0.3.0','python_version':'3.12'},'devices':[]})
            if endpoint == '/queue':
                return route.fulfill(json={'queue_running': [], 'queue_pending': []})
            if endpoint.startswith(('/userdata/', '/models/')):
                return route.fulfill(status=404, json={})
            if endpoint in ('/userdata', '/models', '/embeddings', '/subgraphs'):
                return route.fulfill(json=[])
            return route.fulfill(json={})
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            # No settings, workflows, templates, downloads or jobs can be written.
            return route.fulfill(json={})
        return route.continue_()

    page.route("**/*", route_request)
    if frontend:
        page.route_web_socket('**/ws*', lambda ws: ws.send(json.dumps({
            'type':'status', 'data':{'status':{'exec_info':{'queue_remaining':0}},'sid':'layout-test'}
        })))


def measure(page):
    return page.evaluate("""() => window.comfyAPI.app.app.graph._nodes.map(node => {
      const widget = node.widgets.find(w => ['preview', 'lora_gallery'].includes(w.name));
      const root = widget.element;
      const panes = [...root.querySelectorAll('.pp-master,.pp-detail,.lg-grid,.lg-side,.lg-sel-list')];
      const native = root.closest('[data-node-id]');
      return {type: node.type, size: Array.from(node.size),
        nodeHeight: native?.clientHeight, rootHeight: root.clientHeight,
        panes: panes.map(el => ({name: el.className, height: el.clientHeight, scroll: el.scrollHeight}))};
    })""")


def assert_bounded(page, modern, phase):
    state = measure(page)
    for node in state:
        limit = node["size"][1]
        assert 270 <= node["rootHeight"] <= limit, (phase, node)
        if modern:
            assert node["nodeHeight"] <= limit + 32, (phase, node)
        for pane in node["panes"]:
            assert 0 < pane["height"] <= node["rootHeight"], (phase, node)
            assert pane["scroll"] > pane["height"], (phase, "content must scroll", node)
    return state


def assert_wheel_scrolling(page):
    page.locator('input.ppui-search').focus()
    page.evaluate("window.scrollFocus = document.activeElement")
    for selector in (".pp-master", ".pp-detail", ".lg-side", ".lg-grid", ".lg-sel-list"):
        pane = page.locator(selector)
        pane.evaluate("el => { el.scrollTop = 0; }")
        camera = page.evaluate("() => { const ds = window.comfyAPI.app.app.canvas.ds; return [ds.scale,...ds.offset]; }")
        box = pane.bounding_box()
        assert box and box["height"] > 0, selector
        # Aim inside the pane's padding, away from nested textareas/number inputs.
        x = box["x"] + (min(60, box["width"] / 2) if selector == '.pp-master'
                          else 12 if selector == '.lg-sel-list' else 4)
        page.mouse.move(x, box["y"] + min(45, box["height"] / 2))
        page.mouse.wheel(0, 280)
        page.wait_for_timeout(250)
        after = pane.evaluate("el => el.scrollTop")
        current = page.evaluate("() => { const ds = window.comfyAPI.app.app.canvas.ds; return [ds.scale,...ds.offset]; }")
        assert after > 0, ("real wheel must scroll", selector, after, camera, current)
        assert current == camera, ("wheel over list must not move/zoom canvas", selector, camera, current)
        assert page.evaluate('document.activeElement === window.scrollFocus'), "scroll must not steal input focus"
        bottom = pane.evaluate('el => { el.scrollTop = el.scrollHeight; return el.scrollTop; }')
        page.mouse.wheel(0, 280)
        page.wait_for_timeout(120)
        edge_camera = page.evaluate("() => { const ds = window.comfyAPI.app.app.canvas.ds; return [ds.scale,...ds.offset]; }")
        assert edge_camera == camera, ("scroll at bottom must not zoom canvas", selector, camera, edge_camera)
        page.mouse.wheel(0, -280)
        page.wait_for_timeout(200)
        assert pane.evaluate('el => el.scrollTop') < bottom, ("wheel back up", selector)


def assert_canvas_zoom(page):
    box = page.locator('.pp-master').bounding_box()
    page.mouse.move(box['x'] + min(60, box['width']/2), box['y'] + 45)
    original = page.evaluate('window.comfyAPI.app.app.canvas.ds.scale')
    page.keyboard.down('Control')
    try:
        page.mouse.wheel(0, -100)
        page.wait_for_timeout(150)
        assert page.evaluate('window.comfyAPI.app.app.canvas.ds.scale') != original, "Ctrl+wheel must still zoom the canvas"
    finally:
        page.keyboard.up('Control')
        page.evaluate("""() => {
          const canvas=window.comfyAPI.app.app.canvas;
          canvas.ds.scale=0.8; canvas.ds.offset=[20,30]; canvas.setDirty(true,true);
        }""")


def run_case(browser, base_url, artifacts, modern, installed, navigation, frontend):
    mode = ("nodes2" if modern else "classic") + "-" + navigation
    context = browser.new_context(viewport={"width": 1800, "height": 1100})
    page = context.new_page()
    install_fixture(page, base_url, modern, installed, navigation, frontend)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        page.goto(base_url, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_function("Boolean(window.comfyAPI?.app?.app?.graph && window.LiteGraph?.registered_node_types?.EaglePromptPresets)", timeout=45000)
        page.evaluate("""() => {
          const app = window.comfyAPI.app.app;
          app.graph.clear();
          for (const [type, pos] of [['EaglePromptPresets',[10,80]],['EagleLoraGalleryNode',[990,80]]]) {
            const node = window.LiteGraph.createNode(type);
            node.pos = pos;
            app.graph.add(node);
            if (type === 'EagleLoraGalleryNode') {
              node.widgets.find(w=>w.name==='selection_data').value=JSON.stringify({
                selections:Array.from({length:12},(_,i)=>({id:String(i),name:`Test LoRA ${i}`,weight:1,enabled:true}))
              });
              node._eagleRestoreUiState?.();
            }
            node.setSize([960,720]);
          }
          app.canvas.ds.scale = 0.8;
          app.canvas.ds.offset = [20,30];
          app.canvas.setDirty(true,true);
        }""")
        page.wait_for_selector(".pp-master-item", timeout=15000)
        page.wait_for_selector(".lg-card", timeout=15000)
        page.wait_for_selector(".lg-sel-item", timeout=15000)
        page.wait_for_timeout(500)
        page.screenshot(path=str(artifacts / f"{mode}-initial.png"))
        initial = assert_bounded(page, modern, "initial 960x720")
        assert_wheel_scrolling(page)
        if modern:
            assert_canvas_zoom(page)

        # The native 2.0 resizer measures intrinsic minimum content with its
        # --node-height temporarily zero. A fix that just pins today's height
        # would stop it shrinking at all, so exercise that measurement too.
        if modern:
            minima = page.evaluate("""() => [...document.querySelectorAll('.lg-node[data-node-id]')].map(el=>{
              const old = el.style.getPropertyValue('--node-height');
              el.style.setProperty('--node-height','0px');
              const height = el.clientHeight;
              el.style.setProperty('--node-height',old);
              return height;
            })""")
            assert len(minima) == 2 and all(250 < h < 620 for h in minima), minima
            for index in range(2):
                handle = page.locator('.lg-node[data-node-id] [data-corner="SE"]').nth(index)
                box = handle.bounding_box()
                assert box, "native resize handle must exist"
                x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
                page.mouse.move(x, y)
                page.mouse.down()
                page.mouse.move(x, y - 96, steps=6)
                page.mouse.up()
                page.wait_for_timeout(100)
                resized = assert_bounded(page, modern, "native drag smaller")[index]
                assert resized["size"][1] < 690, resized

        sizes = []
        for height in (500, 1000, 720):
            page.evaluate("""height => {
              const app = window.comfyAPI.app.app;
              for (const node of app.graph._nodes) node.setSize([960,height]);
              app.canvas.setDirty(true,true);
            }""", height)
            page.wait_for_timeout(200)
            sizes.append(assert_bounded(page, modern, f"resize {height}"))
        for index in range(2):
            assert sizes[0][index]["rootHeight"] < sizes[1][index]["rootHeight"], sizes

        # Classic LoRA widgets intentionally hide at low-quality zoom (< 0.5).
        for scale in ((0.45, 1.0, 0.8) if modern else (0.6, 1.0, 0.8)):
            page.evaluate("""scale => {
              const canvas = window.comfyAPI.app.app.canvas;
              canvas.ds.scale=scale; canvas.setDirty(true,true);
            }""", scale)
            page.wait_for_timeout(100)
            assert_bounded(page, modern, f"zoom {scale}")

        # Full preview remains available via pane scrolling rather than clipping.
        scrolled = page.evaluate("""() => [...document.querySelectorAll('.pp-master,.pp-detail,.lg-grid,.lg-side,.lg-sel-list')].map(el=>{
          el.scrollTop = el.scrollHeight;
          return {top:el.scrollTop, end:el.scrollHeight-el.clientHeight};
        })""")
        assert len(scrolled) == 5 and all(s["top"] > 0 and abs(s["top"]-s["end"]) < 2 for s in scrolled), scrolled

        # Workflow save/load uses the same serialized dimensions and content.
        page.evaluate("""async () => {
          const app = window.comfyAPI.app.app;
          await app.loadGraphData(app.graph.serialize());
          app.canvas.ds.scale=0.8; app.canvas.ds.offset=[20,30];
          app.canvas.setDirty(true,true);
        }""")
        page.wait_for_selector(".lg-card", timeout=15000)
        page.wait_for_selector(".lg-sel-item", timeout=15000)
        page.wait_for_timeout(500)
        restored = assert_bounded(page, modern, "workflow restored")
        assert_wheel_scrolling(page)
        assert [n["size"] for n in restored] == [[960, 720], [960, 720]], restored
        assert not errors, errors
        page.screenshot(path=str(artifacts / f"{mode}-restored.png"))
        print(json.dumps({"mode":mode, "initial":initial, "restored":restored, "status":"PASS"}))
    except Exception as error:
        print(f"{mode}: {ascii(error)}", flush=True)
        try:
            page.screenshot(path=str(artifacts / f"{mode}-failure.png"), timeout=5000)
        except Exception:
            pass
        raise
    finally:
        context.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8189")
    parser.add_argument("--artifacts", type=Path, default=ROOT / ".browser-layout-artifacts")
    parser.add_argument("--installed", action="store_true", help="Read deployed Eagle JavaScript instead of the checkout")
    parser.add_argument("--frontend-dir", type=Path, help="Run the installed native frontend offline with isolated API fixtures")
    args = parser.parse_args()
    args.artifacts.mkdir(exist_ok=True, parents=True)
    with sync_playwright() as playwright:
        with playwright.chromium.launch(channel="chrome", headless=True) as browser:
            for modern, navigation in ((True, "legacy"), (True, "standard"), (False, "legacy")):
                run_case(browser, args.base_url, args.artifacts, modern, args.installed, navigation, args.frontend_dir)
