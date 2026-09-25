import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function exerciseBrowser(
  file,
  nodeName,
  persistentNames,
  expectedHeight,
  expectedMinViewportHeight,
  expectedInitialViewportHeight,
  expectedMaxHeight,
  splitProperty,
) {
  const source = fs.readFileSync(new URL(`../web/js/${file}`, import.meta.url), 'utf8')
    .replace('import { app } from "../../../scripts/app.js";', '');
  let extension;
  const timers = [];
  const element = () => ({ style: {}, appendChild() {}, replaceChildren() {} });
  vm.runInNewContext(source, {
    app: { registerExtension(value) { extension = value; } },
    document: { getElementById() { return true; }, createElement: element },
    setTimeout(callback, delay = 0) { timers.push({ callback, delay }); },
    console: { log() {}, warn() {}, error() {} },
  });

  class BrowserNode {
    constructor() {
      // Some frontends install persistent widgets after onNodeCreated.
      this.widgets = [];
      this.size = [400, 300];
      this.outputs = [];
    }
    setSize(size) { this.size = size; }
    setDirtyCanvas() {}
    addDOMWidget(_name, _type, _element, options) {
      this.domWidgetOptions = options;
      this.domWidget = {};
      return this.domWidget;
    }
  }

  extension.beforeRegisterNodeDef(BrowserNode, { name: nodeName });
  const node = new BrowserNode();
  node.onNodeCreated();
  assert.deepEqual(Array.from(node.size), [960, expectedHeight]);
  assert.equal(node.domWidgetOptions.hideInPanel, true);
  assert.equal(node.domWidgetOptions.getMinHeight(), expectedMinViewportHeight);
  assert.equal(node.domWidgetOptions.getHeight(), expectedInitialViewportHeight);
  assert.equal(node.domWidgetOptions.getMaxHeight(), expectedMaxHeight);
  assert.equal(node.domWidget.computeSize, undefined,
    `${file}: the main DOMWidget must retain its growable computeLayoutSize contract`);
  node.size = [960, 5000];
  node.onResize?.(node.size);
  assert.equal(node.domWidgetOptions.getHeight(), expectedMaxHeight,
    'Nodes 2.0 preferred height must follow the bounded viewport state');
  assert.equal(node.domWidgetOptions.getMaxHeight(), expectedMaxHeight,
    'Nodes 2.0 maximum must not feed node.size back into itself');
  assert.equal(node.domWidget.computeSize, undefined,
    `${file}: resizing must not turn the browser back into a fixed-height widget`);

  const userSizedNode = new BrowserNode();
  userSizedNode.size = [777, 555];
  userSizedNode.onNodeCreated();
  assert.deepEqual(Array.from(userSizedNode.size), [777, 555],
    `${file}: 960x720 is a new-node fallback; a valid user size must remain authoritative`);

  assert.equal([...source.matchAll(/setSize\(\[960, 720\]\)/g)].length, 1,
    `${file}: only the guarded creation path may apply the shared default`);
  assert.ok(source.includes(splitProperty), `${file}: split ratios must persist in node properties`);
  assert.equal([...source.matchAll(/role="separator"/g)].length, 2,
    `${file}: directory/main and main/selection boundaries must both be resizable`);
  assert.equal([...source.matchAll(/tabindex="0"/g)].length, 2,
    `${file}: both splitters must be keyboard focusable`);
  assert.match(source, /setPointerCapture\?\.\(pointerId\)/,
    `${file}: pointer capture keeps pen/touch drags reliable outside the handle`);
  assert.match(source, /addEventListener\("lostpointercapture", finish\)/);
  assert.match(source, /removeEventListener\("lostpointercapture", finish\)/);
  assert.match(source, /ResizeObserver/,
    `${file}: saved ratios must be reapplied when the outer node is resized`);
  assert.match(source, /graph\?\.change\?\.\(\)/,
    `${file}: a committed split must mark the workflow changed`);
  assert.match(source, /_eagleRestoreSplitLayout = \(\) =>/);
  assert.match(source, /_eagleRestoreSplitLayout\?\.\(\)/,
    `${file}: workflow switching must restore both split ratios`);
  node.widgets = persistentNames.map(name => ({ name, value: `${name}-kept` }));
  node.widgets.push({ name: 'unrelated_widget', value: 'must stay visible' });
  for (const timer of timers.filter(item => item.delay === 250)) timer.callback();
  for (const widget of node.widgets.slice(0, -1)) {
    assert.equal(widget.hidden, true, `${file}: ${widget.name} must not appear above the DOM browser in Vue Nodes 2.0`);
    assert.equal(widget.type, 'hidden');
    assert.equal(widget.options?.hidden, true,
      `${file}: ${widget.name} must use the visibility flag read by ComfyUI 2.0`);
    assert.equal(widget.options?.vueNode, 'never');
    assert.equal(widget.value, `${widget.name}-kept`, 'hidden state must not erase prompt serialization value');
  }
  assert.equal(node.widgets.at(-1).hidden, undefined, 'unrelated controls stay visible');
  node.widgets[0].hidden = false;
  node.onConfigure();
  assert.equal(node.widgets[0].hidden, true, 'workflow reconfiguration must re-hide persistent controls');
  assert.match(source, /\.umb-body\{[^}]*min-height:0/, 'long file trees must scroll inside the fixed node height');
  assert.match(source, /\.umb-grid\{[^}]*min-height:0/, 'media grid must not grow the Vue node body');
  if (file === 'unified_media_browser.js') {
    assert.match(source, /nodeHeight - 140/, 'six output slots need a fixed header/socket margin');
    assert.match(source, /destroy\(\)[\s\S]*?_eventController\?\.abort\(\)[\s\S]*?_fetchController\?\.abort\(\)[\s\S]*?_timers\.clear\(\)/,
      'browser disposal must stop listeners, requests, and lifecycle timers');
    assert.match(source, /_restoreRetries >= 20/,
      'widget restoration retries must be bounded when the node is removed or incomplete');
    assert.match(source, /this\._eventController\?\.abort\(\)[\s\S]*?new AbortController\(\)[\s\S]*?addEventListener\(type, handler, \{ signal:/,
      're-attaching the browser must replace, not duplicate, static listeners');
    assert.match(source, /this\._umbApp\.destroy\(\)/,
      'node removal must dispose the browser controller');
  }
}

exerciseBrowser('unified_media_browser.js', 'UnifiedMediaBrowser', [
  'selection_data', 'directory', 'active_directory', 'media_type', 'recursive', 'view_mode',
  'fallback_mode', 'batch_count', 'start_index', 'random_seed', 'aspect_ratio',
  'keyword', 'sort_by', 'sort_dir',
], 720, 300, 580, 4096, 'eagle_unified_media_split_layout');
exerciseBrowser('audio_browser.js', 'EagleAudioList', [
  'directory', 'active_directory', 'recursive', 'view_mode', 'selection_data', 'audio_path',
], 720, 300, 640, 4096, 'eagle_audio_browser_split_layout');
console.log('Unified/Audio Nodes 2.0 visibility: PASS');
