import assert from "node:assert/strict";
import fs from "node:fs";

const read = (name) => fs.readFileSync(new URL(`../web/js/${name}`, import.meta.url), "utf8");

const cases = [
  {
    name: "Unified Media Browser",
    source: read("unified_media_browser.js"),
    property: "eagle_unified_media_split_layout",
    appField: "_umbApp",
  },
  {
    name: "Audio Browser",
    source: read("audio_browser.js"),
    property: "eagle_audio_browser_split_layout",
    appField: "_abApp",
  },
];

for (const { name, source, property, appField } of cases) {
  assert.match(
    source,
    /if \(!this\.size \|\| Number\(this\.size\[0\]\) < 480 \|\| Number\(this\.size\[1\]\) < 260\) \{\s*this\.setSize\(\[960, 720\]\);\s*\}/,
    `${name} should only apply 960x720 to new or unusably small nodes`,
  );

  assert.match(source, /const?\s*INITIAL_VIEWPORT_HEIGHT\s*=\s*\d+|var\s+INITIAL_VIEWPORT_HEIGHT\s*=\s*\d+/,
    `${name} needs a distinct initial viewport height`);
  assert.match(source, /(?:const|var)\s+MIN_VIEWPORT_HEIGHT\s*=\s*300/,
    `${name} must keep a bounded, smaller classic/Nodes 2.0 minimum`);
  assert.match(source, /getMinHeight:\s*(?:\(\) =>|function\(\))\s*(?:\{|)\s*(?:return\s+)?MIN_VIEWPORT_HEIGHT/,
    `${name} must expose the fixed minimum to Nodes 2.0`);
  assert.match(source, /getHeight:\s*(?:\(\) =>|function\(\))\s*(?:\{|)\s*(?:return\s+)?currentViewportHeight/,
    `${name} getHeight must follow deliberate user resizing`);
  assert.doesNotMatch(source, /widget\.computeSize\s*=/,
    `${name} main DOMWidget must remain growable through DOMWidgetImpl.computeLayoutSize`);
  assert.match(source, /this\.onResize\s*=\s*function\(size\)[\s\S]*?applyFrame\(size\)/,
    `${name} onResize must still update the live viewport`);

  assert.match(source, new RegExp(`${property}\\s*=\\s*\\{[\\s\\S]*?side_ratio:[\\s\\S]*?selected_ratio:`),
    `${name} must persist both column proportions`);
  assert.equal((source.match(/data-splitter="(?:side|selected)"/g) || []).length, 2,
    `${name} must render both three-column dividers`);
  assert.equal((source.match(/role="separator"/g) || []).length, 2,
    `${name} splitters must expose separator semantics`);
  assert.equal((source.match(/tabindex="0"/g) || []).length, 2,
    `${name} splitters must be keyboard focusable`);
  assert.equal((source.match(/aria-orientation="vertical"/g) || []).length, 2,
    `${name} splitters must expose their orientation`);
  assert.match(source, /event\.key === "ArrowLeft"[\s\S]*?event\.key === "ArrowRight"[\s\S]*?physicalDelta = 16/,
    `${name} splitters must support 16px arrow-key movement`);

  assert.match(source, /setPointerCapture\?\.\(pointerId\)/,
    `${name} must capture touch, pen, or mouse drags`);
  assert.match(source, /addEventListener\("pointercancel", finish\)/,
    `${name} must finish cancelled drags`);
  assert.match(source, /addEventListener\("lostpointercapture", finish\)/,
    `${name} must finish when pointer capture is lost`);
  assert.match(source, /removeEventListener\("lostpointercapture", finish\)/,
    `${name} must clean up pointer-capture listeners`);
  assert.match(source, /releasePointerCapture\(pointerId\)/,
    `${name} must release captured pointers`);
  assert.match(source, /_splitDragCleanup\?\.\(\)/,
    `${name} must clean an active drag before rerender/removal`);
  assert.match(source, /_layoutResizeObserver\?\.disconnect\(\)/,
    `${name} must disconnect its layout observer`);
  assert.match(source, /\.umb-root\{[^}]*min-width:0;[^}]*min-height:0;[^}]*overflow:hidden/,
    `${name} root must shrink on both axes without feeding overflow into node measurement`);

  assert.match(source, new RegExp(`(?:this|nodeRef)\\.${appField}\\?\\.applySplitLayout\\(\\)`),
    `${name} must reflow split columns when the node is resized`);
  assert.match(source, /_eagleRestoreSplitLayout\s*=\s*\(\) =>/,
    `${name} must expose split restoration for workflow switching`);

  const configureStart = source.indexOf("nodeType.prototype.onConfigure");
  const removedStart = source.indexOf("nodeType.prototype.onRemoved", configureStart);
  assert.ok(configureStart >= 0 && removedStart > configureStart, `${name} lifecycle hooks must exist`);
  assert.doesNotMatch(source.slice(configureStart, removedStart), /setSize\(/,
    `${name} must not overwrite a workflow-saved node size during onConfigure`);
}

assert.match(cases[1].source, /destroy\(\)\s*\{[\s\S]*?_eventController\?\.abort\(\)[\s\S]*?_timers\.clear\(\)/,
  "Audio Browser must dispose its static listeners and delayed work");
assert.match(cases[1].source, /this\._abApp\.destroy\(\)/,
  "Audio Browser node removal must destroy the browser controller");

console.log("Unified media/audio browser split and resize contracts: PASS");
