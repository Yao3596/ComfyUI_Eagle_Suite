import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../web/js/h3_director.js", import.meta.url),
  "utf8",
);

assert.match(source, /H3_DEFAULT_NODE_SIZE = \[960, 720\]/,
  "column resizing must use the shared 960x720 preview-node default");
assert.doesNotMatch(source, /widget\.computeSize = function\(width\)/,
  "the visible director surface must retain DOMWidgetImpl's growable layout contract");
assert.match(source, /w\.computeSize = function\(\) \{ return \[0, -4\]; \}/,
  "only hidden H3 transport widgets stay collapsed");
assert.match(source, /onBeforeUnmount/,
  "active pointer capture must be released when Vue unmounts");
assert.match(source, /H3_COLUMN_LAYOUT_PROPERTY = 'eagle_h3_column_layout'/,
  "column ratios need a stable node.properties key");
assert.match(source, /version: H3_COLUMN_LAYOUT_VERSION,[\s\S]{0,120}?ratios:/,
  "the persisted column layout needs a versioned ratio payload");
assert.match(source, /columnGridStyle = computed[\s\S]{0,500}?gridTemplateColumns/,
  "all three columns must be driven by the persisted ratios");
assert.equal((source.match(/class="h3d-splitter"/g) || []).length, 2,
  "H3 Director needs a splitter at both column boundaries");
assert.match(source, /role="separator"[\s\S]{0,160}?aria-orientation="vertical"/,
  "splitters should expose their vertical separator semantics");
assert.match(source, /setPointerCapture\?\.\(pointerId\)/,
  "dragging must retain pointer events outside the narrow divider");
assert.match(source, /addEventListener\('pointermove', move\)/);
assert.match(source, /addEventListener\('pointerup', finish\)/);
assert.match(source, /addEventListener\('pointercancel', cancel\)/,
  "cancelled drags need a dedicated rollback path");
assert.match(source, /addEventListener\('lostpointercapture', cancel\)/,
  "losing pointer capture must clean up the active drag");
assert.match(source, /removeEventListener\('lostpointercapture', drag\.cancel\)/,
  "pointer-capture cleanup must not leak listeners across workflow switches");
assert.match(source, /releasePointerCapture\(drag\.pointerId\)/,
  "pointer capture must always be released during cleanup");
assert.match(source, /if \(commit\) props\.node\.graph\?\.change\?\.\(\)/,
  "a completed drag must make the workflow dirty exactly at commit");
assert.match(source, /onBeforeUnmount\(function\(\) \{[\s\S]{0,220}?stopColumnResize\(false, false\)/,
  "Vue teardown must remove drag listeners without creating a graph edit");
assert.match(source, /node\._h3ReloadColumnLayout\?\.\(\)/,
  "workflow configuration must reload ratios restored after Vue mounted");
assert.match(source, /\.h3d-splitter\{[^}]*touch-action:none/,
  "touch drags must not be intercepted as canvas panning");

console.log("H3 Director resizable three-column layout: PASS");
