import assert from "node:assert/strict";
import fs from "node:fs";

const read = name => fs.readFileSync(new URL(`../web/js/${name}`, import.meta.url), "utf8");

const surfaces = [
  {
    name: "Director Skill",
    file: "director_skill_node.js",
    property: "eagle_director_skill_split_layout",
    min: "DIRECTOR_SKILL_MIN_VIEWPORT_HEIGHT",
    initial: "DIRECTOR_SKILL_DEFAULT_VIEWPORT_HEIGHT",
    cleanup: "_dsStopSplitDrag",
    restore: "_dsRestoreSplitLayout",
    splitters: ["pp-director-splitter"],
  },
  {
    name: "Prompt Presets",
    file: "prompt_presets.js",
    property: "eagle_prompt_presets_split_layout",
    min: "PRESETS_MIN_VIEWPORT_HEIGHT",
    initial: "PRESETS_DEFAULT_VIEWPORT_HEIGHT",
    cleanup: "_ppStopSplitDrag",
    restore: "_ppRestoreSplitLayout",
    splitters: ["pp-splitter"],
  },
  {
    name: "Danbooru",
    file: "danbooru_search_vue.js",
    property: "eagle_danbooru_split_layout",
    min: "MIN_VIEWPORT_HEIGHT",
    initial: "DEFAULT_VIEWPORT_HEIGHT",
    cleanup: "_dbsStopSplitDrag",
    restore: "_dbsRestoreSplitLayout",
    splitters: ["dbs-column-splitter"],
  },
  {
    name: "Video Frame Extractor",
    file: "video_frame_extractor_vue.js",
    property: "eagle_video_frame_split_layout",
    min: "FRAME_SELECTOR_MIN_VIEWPORT_HEIGHT",
    initial: "FRAME_SELECTOR_DEFAULT_VIEWPORT_HEIGHT",
    cleanup: "_evfeStopSplitDrag",
    restore: "_evfeRestoreSplitLayout",
    splitters: ["evfe-splitter-v", "evfe-splitter-h"],
  },
  {
    name: "Media Timeline Editor",
    file: "media_timeline_editor.js",
    property: "eagle_media_timeline_split_layout",
    min: "TIMELINE_MIN_VIEWPORT_HEIGHT",
    initial: "TIMELINE_DEFAULT_VIEWPORT_HEIGHT",
    cleanup: "_emteStopSplitDrag",
    restore: "_emteRestoreSplitLayout",
    splitters: ["emte-splitter-v", "emte-splitter-h"],
  },
];

for (const surface of surfaces) {
  const source = read(surface.file);
  const defaultSizeCalls = [...source.matchAll(/setSize\(\[960, 720\]\)/g)];
  assert.equal(defaultSizeCalls.length, 1,
    `${surface.name}: the shared default must be applied by one creation path only`);
  const defaultSizeIndex = defaultSizeCalls[0].index;
  const createdIndex = source.lastIndexOf("prototype.onNodeCreated", defaultSizeIndex);
  const guardIndex = source.lastIndexOf("if (", defaultSizeIndex);
  assert.ok(createdIndex >= 0 && guardIndex > createdIndex && defaultSizeIndex - guardIndex < 320,
    `${surface.name}: 960x720 must be a guarded onNodeCreated default, not a restore-time resize`);
  const sizeGuard = source.slice(guardIndex, defaultSizeIndex);
  assert.match(sizeGuard, /(?:this\.size|initialSize)/,
    `${surface.name}: default sizing must first inspect the existing node size`);
  assert.match(sizeGuard, /<\s*\d+/,
    `${surface.name}: a valid existing user size must bypass the default`);
  assert.match(source, /setSize\(\[960, 720\]\)/,
    `${surface.name}: newly created nodes must default to 960x720`);
  assert.match(source, new RegExp(`${surface.min}\\s*=\\s*(?:2\\d\\d|3[0-2]0)`),
    `${surface.name}: the resize minimum must stay below the initial 720px frame`);
  assert.match(source, new RegExp(`${surface.initial}\\s*=\\s*[5-6]\\d\\d`),
    `${surface.name}: the initial viewport must remain distinct from its shrink limit`);
  assert.match(source, new RegExp(`getMinHeight:[^\\n]*${surface.min}`),
    `${surface.name}: Nodes 2.0 must use the smaller viewport minimum`);
  assert.match(source, new RegExp(`Math\\.max\\(${surface.min},`),
    `${surface.name}: classic resizing must use the smaller viewport minimum`);
  const domWidgetMounts = [...source.matchAll(/addDOMWidget\s*\(/g)];
  assert.ok(domWidgetMounts.length > 0, `${surface.name}: expected a full-surface DOM widget`);
  for (const mount of domWidgetMounts) {
    const mountContract = source.slice(mount.index, mount.index + 1400);
    assert.doesNotMatch(mountContract, /\.computeSize\s*=/,
      `${surface.name}: the main DOM widget must stay growable instead of reserving only its minimum height`);
  }
  assert.ok(source.includes(surface.property), `${surface.name}: split ratios must persist in node properties`);
  assert.match(source, /setPointerCapture\?\.\(pointerId\)/,
    `${surface.name}: drag handles must use pointer capture`);
  assert.match(source, /releasePointerCapture\(pointerId\)/,
    `${surface.name}: pointer capture must be released`);
  assert.match(source, /pointercancel/,
    `${surface.name}: pen and touch cancellation must be handled`);
  assert.match(source, /addEventListener\("lostpointercapture", finish\)/,
    `${surface.name}: a lost capture must release global drag state`);
  assert.match(source, /removeEventListener\("lostpointercapture", finish\)/,
    `${surface.name}: lost-capture listeners need lifecycle cleanup`);
  assert.match(source, /graph\?\.change\?\.\(\)/,
    `${surface.name}: committed ratios must mark the workflow changed`);
  assert.ok(source.includes(surface.cleanup), `${surface.name}: active drag listeners need lifecycle cleanup`);
  assert.ok(source.includes(surface.restore), `${surface.name}: saved split ratios need a post-configure restore hook`);
  assert.match(source, new RegExp(`this\\.${surface.restore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?\\.\\(\\)`),
    `${surface.name}: workflow configuration must re-apply its saved split ratios`);
  assert.match(source, /role:\s*["']separator["']|role="separator"/,
    `${surface.name}: split handles must remain keyboard-focusable separators`);
  assert.match(source, /tabindex:\s*["']?0["']?|tabindex="0"/,
    `${surface.name}: split handles need a stable keyboard focus target`);
  assert.match(source, /Arrow(?:Left|Right)/,
    `${surface.name}: column proportions need keyboard adjustment as well as pointer dragging`);
  assert.match(source, /touch-action:\s*none/,
    `${surface.name}: touch and pen resizing must not turn into browser panning`);
  for (const splitter of surface.splitters) {
    assert.ok(source.includes(splitter), `${surface.name}: missing ${splitter}`);
  }
}

const director = read("director_skill_node.js");
const loadedGraphMount = director.slice(
  director.indexOf("function mountDirectorSkillNode"),
  director.indexOf("app.registerExtension", director.indexOf("function mountDirectorSkillNode")),
);
assert.doesNotMatch(loadedGraphMount, /setSize\(/,
  "Director Skill loadedGraphNode must never replace a saved user size");

const danbooru = read("danbooru_search_vue.js");
assert.match(danbooru, /MAX_SIDE_RATIO_SUM\s*=\s*0\.68/,
  "Danbooru side panes must reserve useful width for the center gallery");
assert.match(danbooru, /MAX_SIDE_RATIO_SUM - selectedRatio\.value/);
assert.match(danbooru, /MAX_SIDE_RATIO_SUM - leftRatio\.value/);
assert.doesNotMatch(danbooru, /\.dbs-selected-side\s*\{[^}]*max-width:/,
  "Danbooru selected pane must not override its saved ratio with a fixed max width");

for (const file of ["video_frame_extractor_vue.js", "media_timeline_editor.js"]) {
  const source = read(file);
  assert.match(source, /aria-orientation="vertical"/,
    `${file}: left/right panes need a vertical separator`);
  assert.match(source, /aria-orientation="horizontal"/,
    `${file}: upper/lower panes need a horizontal separator`);
  assert.match(source, /aria-orientation="vertical"[^>]*@pointerdown="[^"]+"[^>]*@keydown="[^"]+"/,
    `${file}: the vertical separator must support keyboard adjustment`);
  assert.match(source, /aria-orientation="horizontal"[^>]*@pointerdown="[^"]+"[^>]*@keydown="[^"]+"/,
    `${file}: the horizontal separator must support keyboard adjustment`);
  const template = source.match(/template:\s*`([\s\S]*?)`,\s*\n};/);
  assert.ok(template, `${file}: Vue template could not be located`);
}

assert.match(director, /onBeforeUnmount[\s\S]{0,240}?clearTimeout\(toastTimer\)/,
  "Director Skill must clear its toast timer when removed");
const promptPresets = read("prompt_presets.js");
assert.match(promptPresets, /retryTimers = new Set\(\)/);
assert.match(promptPresets, /retryTimers\.forEach[\s\S]{0,120}?clearTimeout/,
  "Prompt Presets must clear pending variable retries when removed");
assert.match(promptPresets, /clearTimeout\(noticeTimer\)/,
  "Prompt Presets must clear its notice timer");
assert.match(danbooru, /onBeforeUnmount\(\(\) => \{[\s\S]{0,120}?clearTimeout\(_relatedTimer\)/,
  "Danbooru tag search must cancel delayed related-tag requests");
assert.match(danbooru, /clearTimeout\(restoreSelectionTimer\)/,
  "Danbooru root must cancel delayed selection restoration");

console.log("Vue preview defaults, shrink limits, and split persistence: PASS");
