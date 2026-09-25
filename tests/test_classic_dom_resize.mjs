import assert from "node:assert/strict";
import fs from "node:fs";

const read = (name) => fs.readFileSync(new URL(`../web/js/${name}`, import.meta.url), "utf8");

// These nodes own a full-height DOM application.  ComfyUI's current LiteGraph
// layout treats any widget with an instance-level `computeSize` as fixed.  A
// DOMWidget without that override keeps DOMWidgetImpl.computeLayoutSize and is
// therefore placed in growableWidgets, where it receives the node body's
// remaining height in both the classic canvas and Nodes 2.0.
const resizableSurfaces = [
  "audio_browser.js",
  "danbooru_search_vue.js",
  "director_skill_node.js",
  "eagle_gallery.js",
  "h3_director.js",
  "h3_review_workspace_svelte.js",
  "lora_gallery.js",
  "media_timeline_editor.js",
  "prompt_presets.js",
  "svelte_character_interaction.js",
  "unified_media_browser.js",
  "video_frame_extractor_vue.js",
  "wallhaven_gallery.js",
];

for (const name of resizableSurfaces) {
  const source = read(name);
  assert.match(source, /MAX_VIEWPORT_HEIGHT\s*=\s*4096/,
    `${name}: classic canvas resize must not stop at the old 930-1200px cap`);
  assert.match(source, /getMaxHeight:[^\n]*MAX_VIEWPORT_HEIGHT/,
    `${name}: Nodes 2.0 must share the expanded finite safety bound`);
  assert.match(source, /Math\.min\(MAX_VIEWPORT_HEIGHT,\s*Math\.max\(/,
    `${name}: onResize must calculate the live viewport using the shared bound`);
  assert.match(source, /getHeight:[^\n]*currentViewportHeight/,
    `${name}: Nodes 2.0 must read the live viewport height`);
  assert.match(source, /onResize/,
    `${name}: user resizing must propagate into the DOM surface`);
  assert.doesNotMatch(source, /Math\.min\((?:930|1050|1100|1200),\s*Math\.max\(/,
    `${name}: obsolete fixed-height cap must not return`);
}

const mainDomWidgets = new Map([
  ["audio_browser.js", ['addDOMWidget("audio_browser"']],
  ["danbooru_search_vue.js", ['addDOMWidget("danbooru_search_vue"']],
  ["director_skill_node.js", ['addDOMWidget("director_skill_ui"', 'addDOMWidget("preview"']],
  ["eagle_gallery.js", ['addDOMWidget("eagle_gallery"']],
  ["h3_director.js", ["addDOMWidget('h3_director_ui'"]],
  ["h3_review_workspace_svelte.js", ['addDOMWidget("h3_review_workspace_svelte"']],
  ["lora_gallery.js", ['addDOMWidget("lora_gallery"']],
  ["media_timeline_editor.js", ['addDOMWidget("media_timeline_editor"']],
  ["prompt_presets.js", ['addDOMWidget("preview"']],
  ["svelte_character_interaction.js", ["addDOMWidget(domWidget"]],
  ["unified_media_browser.js", ['addDOMWidget("unified_media_browser"']],
  ["video_frame_extractor_vue.js", ['addDOMWidget("video_frame_selector"']],
  ["wallhaven_gallery.js", ['addDOMWidget("wallhaven_gallery"']],
]);

for (const [name, markers] of mainDomWidgets) {
  const source = read(name);
  for (const marker of markers) {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `${name}: missing main DOM widget marker ${marker}`);
    const mountContract = source.slice(start, start + 2200);
    assert.match(mountContract, /getMinHeight:/,
      `${name}: the main DOM widget must expose its minimum through computeLayoutSize`);
    assert.match(mountContract, /getMaxHeight:/,
      `${name}: the main DOM widget must expose a finite growth bound`);
    assert.doesNotMatch(mountContract, /\.computeSize\s*=/,
      `${name}: overriding the main DOM widget computeSize makes ComfyUI allocate only a fixed-height slot`);
  }
}

const h3 = read("h3_director.js");
assert.match(h3, /H3_DEFAULT_NODE_SIZE = \[960, 720\]/,
  "H3 Director should use the shared 960x720 preview default when first added");
assert.match(h3, /H3_NODE_CHROME_HEIGHT = 150/,
  "H3 Director must use one explicit chrome offset for both renderers");
assert.match(h3, /el\.style\.height = h \+ 'px'/,
  "H3 Director must assign a pixel height; classic LiteGraph does not reliably resize a 100% child");
assert.doesNotMatch(h3, /widget\.computeSize = function\(width\)[\s\S]{0,900}?H3_MIN_VIEWPORT_HEIGHT/,
  "H3 Director must retain DOMWidgetImpl.computeLayoutSize so its slot grows with the node body");
assert.match(h3, /currentViewportHeight = h;[\s\S]{0,700}?el\.style\.height = h \+ 'px'/,
  "H3 Director must still apply explicit user resizing to the live DOM viewport");
assert.match(h3, /scheduleHideWidgets[\s\S]*?\[0, 250, 500\]\.map/,
  "H3 Director must hide transport widgets before and during Nodes 2.0 restoration");
assert.match(h3, /nodeType\.prototype\.onConfigure[\s\S]*?scheduleHideWidgets\(node\);/,
  "H3 Director must re-hide transport widgets after workflow configuration");
assert.match(h3, /definition\[1\][\s\S]{0,220}?hidden:\s*true/,
  "H3 Director must suppress raw state rows before Nodes 2.0 creates widgets");
assert.match(h3, /Object\.assign\(w\.options, \{[^\n]*hidden:\s*true/,
  "H3 Director runtime widgets must use the visibility flag read by Nodes 2.0");
assert.match(h3, /node\.widgets\.splice\.apply/,
  "H3 Director must invalidate the shallow-reactive Nodes 2.0 widget list");

console.log(`Classic DOM resize contracts: ${resizableSurfaces.length} resizable surfaces PASS`);
