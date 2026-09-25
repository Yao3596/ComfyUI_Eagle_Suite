import assert from "node:assert/strict";
import fs from "node:fs";

const read = (name) => fs.readFileSync(new URL(`../web/js/${name}`, import.meta.url), "utf8");

const lora = read("lora_gallery.js");
const eagle = read("eagle_gallery.js");
const wallhaven = read("wallhaven_gallery.js");

for (const [name, source] of [
  ["LoRA Gallery", lora],
  ["Eagle Gallery", eagle],
  ["Wallhaven Gallery", wallhaven],
]) {
  assert.match(source, /setSize\(\[960, 720\]\)/, `${name} must start new nodes at 960x720`);
  assert.match(
    source,
    /if \(!this\.size \|\| Number\(this\.size\[0\]\) < 480 \|\| Number\(this\.size\[1\]\) < 260\) \{\s*this\.setSize\(\[960, 720\]\);\s*\}/,
    `${name} must not overwrite a usable workflow-saved size`,
  );
  assert.match(source, /INITIAL_VIEWPORT_HEIGHT\s*=\s*\d+/, `${name} needs a distinct initial viewport`);
  assert.match(source, /MIN_VIEWPORT_HEIGHT\s*=\s*(?:2\d\d|300)/, `${name} must remain shrinkable below the default height`);
  assert.match(source, /getMinHeight:[^\n]*MIN_VIEWPORT_HEIGHT/, `${name} must expose the smaller Nodes 2.0 minimum`);
  assert.match(source, /Math\.max\(MIN_VIEWPORT_HEIGHT,/, `${name} classic resize must use the smaller minimum`);
  assert.match(source, /setPointerCapture\?\.\(pointerId\)/, `${name} splitters need pointer capture`);
  assert.match(source, /releasePointerCapture\(pointerId\)/, `${name} must release pointer capture`);
  assert.match(source, /pointercancel/, `${name} must clean up cancelled touch or pen drags`);
  assert.match(source, /addEventListener\("lostpointercapture", finish\)/,
    `${name} must finish a drag when pointer capture is lost`);
  assert.match(source, /removeEventListener\("lostpointercapture", finish\)/,
    `${name} must remove the pointer-capture loss listener`);
  assert.match(source, /touch-action:none/, `${name} splitters must not become browser pan gestures`);
  assert.match(source, /ResizeObserver/, `${name} split ratios must follow later node resizing`);
  assert.match(source, /layoutResizeObserver\?\.disconnect\(\)/, `${name} must release its resize observer`);
  assert.match(source, /activeDragCleanup\?\.\(\)/, `${name} must release active splitter listeners when removed`);
  assert.match(source, /_eagleRestoreSplitLayout/, `${name} must restore split ratios when switching workflows`);
  assert.doesNotMatch(source, /onMousedown:\s*make(?:Pointer)?DragHandler/, `${name} must not fall back to mouse-only dragging`);

  const configureStart = source.indexOf("nodeType.prototype.onConfigure");
  const removedStart = source.indexOf("nodeType.prototype.onRemoved", configureStart);
  assert.ok(configureStart >= 0 && removedStart > configureStart, `${name} lifecycle hooks must exist`);
  assert.doesNotMatch(
    source.slice(configureStart, removedStart),
    /setSize\(/,
    `${name} must preserve a workflow's saved node size during onConfigure`,
  );
}

assert.match(lora, /eagle_lora_split_layout\s*=\s*\{[\s\S]*?side_ratio:[\s\S]*?selected_ratio:/,
  "LoRA must serialize both column proportions into node properties");
assert.match(lora, /class: "lg-resizer"[\s\S]*?onPointerdown:/,
  "LoRA folder/main divider must use pointer events");
assert.match(lora, /class: "lg-resizer-right"[\s\S]*?onPointerdown:/,
  "LoRA main/selection divider must use pointer events");
assert.equal((lora.match(/role: "separator"/g) || []).length, 2,
  "LoRA must expose both column dividers as keyboard-focusable separators");
assert.equal((lora.match(/tabindex: 0/g) || []).length, 2,
  "LoRA column dividers must be keyboard focusable");
assert.match(lora, /"aria-orientation": "vertical"/,
  "LoRA column dividers must expose their orientation");
assert.match(lora, /e\.key === "ArrowLeft"[\s\S]*?e\.key === "ArrowRight"[\s\S]*?delta = 16/,
  "LoRA column dividers must support 16px keyboard adjustments");
assert.match(lora, /onKeydown: makeKeyboardResizeHandler/g,
  "LoRA column dividers must bind the keyboard resize handler");

assert.match(eagle, /eagle_gallery_split_layout\s*=\s*\{[\s\S]*?side_ratio:[\s\S]*?preview_ratio:/,
  "Eagle Gallery must persist both horizontal and vertical proportions");
assert.match(eagle, /class: "eg-resizer-col"[\s\S]*?onPointerdown:/,
  "Eagle Gallery folder column must be horizontally resizable");
assert.match(eagle, /class: "eg-resizer-row"[\s\S]*?onPointerdown:/,
  "Eagle Gallery preview strip must be vertically resizable");
assert.equal((eagle.match(/role: "separator"/g) || []).length, 2,
  "Eagle Gallery must expose both dividers as keyboard-focusable separators");
assert.equal((eagle.match(/tabindex: 0/g) || []).length, 2,
  "Eagle Gallery dividers must be keyboard focusable");
assert.match(eagle, /"aria-orientation": "horizontal"/,
  "Eagle Gallery preview divider must expose its orientation");
assert.match(eagle, /"aria-orientation": "vertical"/,
  "Eagle Gallery column divider must expose its orientation");
assert.match(eagle, /e\.key === "ArrowUp"[\s\S]*?e\.key === "ArrowDown"[\s\S]*?delta = 16/,
  "Eagle Gallery preview divider must support 16px keyboard adjustments");
assert.match(eagle, /\.eg-root\{[^}]*min-width:0;min-height:0;overflow:hidden;box-sizing:border-box/,
  "Eagle Gallery root must allow both axes to shrink without DOM overflow feedback");

assert.match(wallhaven, /eagle_wallhaven_split_layout\s*=\s*\{[\s\S]*?preview_ratio:/,
  "Wallhaven must persist its preview/grid split");
assert.match(wallhaven, /@pointerdown="beginPreviewResize"/,
  "Wallhaven preview strip must use pointer events");
assert.match(wallhaven, /class="whg-resizer-row" role="separator" tabindex="0" aria-orientation="horizontal"/,
  "Wallhaven preview divider must be an accessible, keyboard-focusable separator");
assert.match(wallhaven, /event\.key === "ArrowUp"[\s\S]*?event\.key === "ArrowDown"[\s\S]*?delta = 16/,
  "Wallhaven preview divider must support 16px keyboard adjustments");
assert.match(wallhaven, /@keydown="nudgePreviewHeight"/,
  "Wallhaven preview divider must bind its keyboard resize handler");

console.log("Gallery splitter persistence and cross-renderer resize contracts: PASS");
