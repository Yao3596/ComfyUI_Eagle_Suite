import assert from "node:assert/strict";
import fs from "node:fs";

const jsDirectory = new URL("../web/js/", import.meta.url);
const sources = new Map(
  fs.readdirSync(jsDirectory)
    .filter((name) => name.endsWith(".js"))
    .map((name) => [name, fs.readFileSync(new URL(name, jsDirectory), "utf8")]),
);

// Every node-owned DOM surface must be inventoried. The two API widgets are
// intentionally short input/status fields, not large galleries or editors.
const small = ["api_key_input.js", "api_unified.js"];
const full = [
  "audio_browser.js",
  "danbooru_search_vue.js",
  "director_skill_node.js",
  "eagle_gallery.js",
  "h3_director.js",
  "h3_pipeline.js",
  "h3_review_workspace_svelte.js",
  "lora_gallery.js",
  "media_timeline_editor.js",
  "prompt_presets.js",
  "svelte_character_interaction.js",
  "text_studio.js",
  "unified_media_browser.js",
  "video_frame_extractor_vue.js",
  "wallhaven_gallery.js",
];
const actual = [...sources]
  .filter(([, source]) => /\baddDOMWidget\s*\(/.test(source))
  .map(([name]) => name)
  .sort();
assert.deepEqual(actual, [...small, ...full].sort(), "A new DOM widget needs an explicit Nodes 2.0 layout audit");

// A full-surface overlay may have its own card menu, but it must not replace
// ComfyUI's canvas-wide or document-wide right-click handler.
for (const [name, source] of sources) {
  assert.doesNotMatch(source, /LGraphCanvas\.prototype\.(?:getCanvasMenuOptions|processContextMenu|showContextMenu)\s*=/,
    `${name} must not patch the global canvas menu`);
  assert.doesNotMatch(source, /(?:document|window)\.addEventListener\s*\(\s*["']contextmenu["']/,
    `${name} must not intercept right-click across all nodes`);
}

for (const name of full) {
  const source = sources.get(name);
  assert.match(source, /hideInPanel:\s*true/, `${name} must mount in both canvas and Nodes 2.0 body`);
  assert.doesNotMatch(source, /canvasOnly:\s*true/, `${name} must not disappear in Nodes 2.0`);
  assert.match(source, /getMinHeight:\s*(?:function|\()/, `${name} needs a minimum DOM height`);
  assert.match(source, /getMaxHeight:\s*(?:function|\()/, `${name} needs a bounded DOM height`);
  assert.match(source, /onRemoved/, `${name} needs a node removal lifecycle`);
}

// The two compact status panels stay fixed; every large surface needs an
// independent resize state and a finite Nodes 2.0 expansion bound.  Main DOM
// applications deliberately do not override `computeSize`: doing so changes
// LiteGraph's classification from growable to fixed and clips the application
// while leaving unused grey node body below it.
for (const name of full.filter((item) => !["h3_pipeline.js", "text_studio.js"].includes(item))) {
  const source = sources.get(name);
  assert.match(source, /getHeight:[^\n]*currentViewportHeight/,
    `${name}: Nodes 2.0 preferred height must follow the bounded resize state`);
  assert.doesNotMatch(source, /getMaxHeight:[^\n]*return (?:GALLERY_VIEWPORT_HEIGHT|PRESETS_VIEWPORT_HEIGHT|DIRECTOR_SKILL_VIEWPORT_HEIGHT|viewportHeight|panelHeight)[; ]|getMaxHeight:[^\n]*=> (?:GALLERY_VIEWPORT_HEIGHT|FRAME_SELECTOR_VIEWPORT_HEIGHT|viewportHeight|panelHeight)[, ]/,
    `${name}: Nodes 2.0 maximum must not equal its minimum`);
}

// These are deliberately compact embedded views, not full-node applications.
// Text Studio keeps the native editor widgets visible and adds only a bounded
// output preview. H3 pipeline cards are task/status views whose height is
// selected by their node role (and, for Review, by the available content).
// Pin this distinction so a future blanket "make every DOM widget resizable"
// change cannot reintroduce workflow growth or large empty panels.
const textStudio = sources.get("text_studio.js");
assert.match(textStudio, /getMinHeight:\s*\(\)\s*=>\s*150/);
assert.match(textStudio, /getMaxHeight:\s*\(\)\s*=>\s*240/);
assert.match(textStudio, /getHeight:\s*\(\)\s*=>\s*150/);
assert.match(textStudio, /Math\.max\(520, Number\(node\.size\?\.\[1\]\) \|\| 520\)/,
  "Text Studio may preserve a taller saved node, but its preview remains compact");

const h3Pipeline = sources.get("h3_pipeline.js");
assert.match(h3Pipeline, /getMinHeight:\s*\(\)\s*=>\s*viewportHeight/);
assert.match(h3Pipeline, /getMaxHeight:\s*\(\)\s*=>\s*viewportHeight/);
assert.match(h3Pipeline, /getHeight:\s*\(\)\s*=>\s*viewportHeight/);
assert.match(h3Pipeline, /function resizeReviewPanel[\s\S]*?const panelHeight = hasPreview/,
  "H3 Review is content-sized rather than user-stretched");

// `hidden` and a zero computeSize are enough for classic LiteGraph, but Nodes
// 2.0's useProcessedWidgets currently checks options.hidden (not the legacy
// vueNode flag). A delayed mutation also needs a shallow-reactive array update
// or the already-mounted row remains visible. Keep vueNode for older frontend
// revisions, but test the effective 2.0 contract too.
for (const name of [
  "audio_browser.js", "danbooru_search_vue.js", "director_skill_node.js",
  "eagle_gallery.js", "h3_director.js", "h3_pipeline.js",
  "h3_review_workspace_svelte.js", "lora_gallery.js",
  "media_timeline_editor.js", "prompt_presets.js",
  "svelte_character_interaction.js", "unified_media_browser.js",
  "video_frame_extractor_vue.js", "wallhaven_gallery.js",
]) {
  const source = sources.get(name);
  assert.match(source, /vueNode:\s*["']never["']/,
    `${name}: hidden native widgets must not reserve Nodes 2.0 rows`);
  assert.match(source, /(?:Object\.assign\([^,]*\.options,\s*\{|options\s*=\s*\{)[\s\S]{0,180}?hidden:\s*true[\s\S]{0,180}?vueNode:/,
    `${name}: ComfyUI 2.0 visibility requires options.hidden=true`);
  assert.match(source, /widgets\.splice/,
    `${name}: late widget hiding must invalidate the shallow-reactive widget array`);
}

// Setting vueNode="never" in a delayed timer is insufficient. Nodes 2.0 may
// already have mounted and measured the native parameter row, leaving raw JSON
// or an empty block above the custom application. These surfaces previously
// relied solely on delayed hiding, so pin the synchronous + restore contract.
for (const [name, hideCall, configureCall] of [
  ["eagle_gallery.js", "hideWidgets(this);", "hideWidgets(node);"],
  ["wallhaven_gallery.js", "hideSel(this);", "hideSel(this);"],
  ["video_frame_extractor_vue.js", "hideNativeWidgets(this);", "hideNativeWidgets(this);"],
  ["svelte_character_interaction.js", "hideStateWidget(node, stateWidget);", "hideStateWidget(this, stateWidget);"],
]) {
  const source = sources.get(name);
  const domIndex = source.indexOf("addDOMWidget");
  assert.ok(domIndex > 0, `${name}: expected DOM widget registration`);
  assert.ok(source.lastIndexOf(hideCall, domIndex) >= 0,
    `${name}: native state rows must be hidden synchronously before addDOMWidget`);
  const configureIndex = source.indexOf("onConfigure", domIndex);
  assert.ok(configureIndex > domIndex && source.indexOf(configureCall, configureIndex) >= 0,
    `${name}: workflow restore must re-hide native state rows`);
}

// Exact definition-time inventory. Runtime hiding is only a compatibility
// fallback: Nodes 2.0 registers widget state during construction, so every
// transport-only input must already carry options.hidden in the V1 NodeDef.
const definitionHiddenInventory = new Map([
  ["audio_browser.js", ["directory", "active_directory", "recursive", "view_mode", "selection_data", "audio_path"]],
  ["danbooru_search_vue.js", ["selection_data"]],
  ["director_skill_node.js", ["director_skill", "ui_state"]],
  ["eagle_gallery.js", ["trigger", "selection_data"]],
  ["h3_director.js", ["h3_state", "scene_index", "LLM_HINT", "skill_request"]],
  ["h3_pipeline.js", ["review_decision", "retry_prompt", "retry_seed", "retry_length", "resume_scene", "assemble_partial_on_stop", "auto_continue_timeout_minutes", "unload_models_while_waiting"]],
  ["h3_review_workspace_svelte.js", ["workspace_state", "review_decision", "retry_prompt", "retry_seed", "retry_length", "resume_scene", "assemble_partial_on_stop", "auto_continue_timeout_minutes", "unload_models_while_waiting"]],
  ["lora_gallery.js", ["selection_data", "civitai_api_key", "manual_triggers"]],
  ["media_timeline_editor.js", ["timeline_json", "output_mode", "size_mode", "width", "height", "lock_aspect_ratio", "resize_anchor", "fit_mode", "output_fps", "include_video_audio", "audio_sample_rate", "video_crf", "frame_step", "max_frames", "render_revision"]],
  ["prompt_presets.js", ["prompt", "template", "local_variables", "ui_state"]],
  ["unified_media_browser.js", ["selection_data", "directory", "active_directory", "media_type", "recursive", "view_mode", "fallback_mode", "batch_count", "start_index", "random_seed", "aspect_ratio", "keyword", "sort_by", "sort_dir"]],
  ["video_frame_extractor_vue.js", ["video_file", "time_mode", "frame_index", "sample_count", "resize_width", "resize_height", "preview_strip", "custom_times", "preview_count", "selection_mode", "selected_frames", "preview_revision", "size_mode", "trim_start", "trim_end", "extract_audio", "lock_aspect_ratio", "resize_anchor", "timeline_zoom", "output_mode"]],
  ["wallhaven_gallery.js", ["selection_data"]],
]);
for (const [name, widgetNames] of definitionHiddenInventory) {
  const source = sources.get(name);
  const registerIndex = source.indexOf("beforeRegisterNodeDef");
  assert.ok(registerIndex >= 0, `${name}: missing beforeRegisterNodeDef`);
  const definitionPhase = source.slice(registerIndex);
  assert.match(source, /(?:definition\[1\]|definition\s*\[\s*1\s*\])\s*=/,
    `${name}: must have a definition mutation before widget construction`);
  assert.match(definitionPhase,
    /(?:definition\[1\]|suppress[A-Za-z]*Definition\(nodeData[^)]*\))/,
    `${name}: beforeRegisterNodeDef must apply the definition suppression`);
  assert.match(source, /hidden:\s*true[\s\S]{0,100}?vueNode:\s*["']never["'][\s\S]{0,100}?hideInPanel:\s*true/,
    `${name}: definition options must hide Nodes 2.0 rows and the parameter panel`);
  for (const widgetName of widgetNames) {
    assert.ok(source.includes(JSON.stringify(widgetName)) || source.includes(`'${widgetName}'`),
      `${name}: ${widgetName} is missing from the definition-hidden inventory`);
  }
}
assert.match(sources.get("svelte_character_interaction.js"),
  /suppressStateWidgetDefinition\(nodeData, definition\.stateWidget\)/,
  "Svelte transport JSON must be suppressed at definition time");

for (const name of small) {
  const source = sources.get(name);
  assert.match(source, /hideInPanel:\s*true/, `${name} must not leak its editor into the parameter panel`);
  assert.doesNotMatch(source, /canvasOnly:\s*true/, `${name} must remain available in Nodes 2.0`);
  assert.match(source, /(?:Object\.assign\([^,]*\.options,\s*\{|options\s*=\s*\{)[\s\S]{0,180}?hidden:\s*true[\s\S]{0,180}?vueNode:/,
    `${name}: replaced secret widgets must be hidden by ComfyUI 2.0`);
}

assert.match(sources.get("api_key_input.js"), /inputDefs[\s\S]*?api_key[\s\S]*?definition\[1\][\s\S]*?hidden:\s*true/,
  "API Key native input must be definition-hidden before Nodes 2.0 registers it");
assert.match(sources.get("api_unified.js"), /inputDefs[\s\S]*?api_config_key[\s\S]*?definition\[1\][\s\S]*?hidden:\s*true/,
  "Unified API key input must be definition-hidden before Nodes 2.0 registers it");

const directorSkill = sources.get("director_skill_node.js");
const directorLoadedGraphMount = directorSkill.slice(
  directorSkill.indexOf("function mountDirectorSkillNode"),
  directorSkill.indexOf("app.registerExtension", directorSkill.indexOf("function mountDirectorSkillNode")),
);
assert.doesNotMatch(directorLoadedGraphMount, /setSize\(/,
  "Director Skill loadedGraphNode fallback must not overwrite an already restored user size");
assert.match(directorSkill, /this\.setSize\(\[960, 720\]\)/,
  "Director Skill new-node hook must use the shared 960x720 preview default");
assert.match(directorSkill, /clearDirectorSkillTimers\(node\)/,
  "Director Skill fallback timers must be cancelled when the node is removed");

// api_unified owns two intentionally short DOM widgets: a diagnostic status
// card and a password editor. Neither is a gallery/editor viewport and neither
// should participate in the full-surface resize contract above.
const apiUnified = sources.get("api_unified.js");
assert.equal([...apiUnified.matchAll(/addDOMWidget\s*\(/g)].length, 2,
  "api_unified DOM-widget inventory changed; review its Nodes 2.0 sizing explicitly");
assert.match(apiUnified, /addDOMWidget\("eagle_image_size_status"/);
assert.match(apiUnified, /min-height:72px/);
assert.match(apiUnified, /addDOMWidget\("eagle_api_key_password"/);
assert.match(apiUnified, /min-height:30px/);

const registry = fs.readFileSync(new URL("../eagle_suite/nodes.py", import.meta.url), "utf8");
for (const nodeName of [
  "EagleAudioList", "DanbooruVueSearchNode", "EagleDirectorSkillNode",
  "EagleGalleryNode", "EagleH3DirectorNode", "EagleLoraGalleryNode",
  "EagleMediaTimelineEditor", "EaglePromptPresets", "EagleVideoFrameExtractor",
  "EagleSvelteCharacterInteractionNode", "EagleSvelteCharacterPVNode",
  "UnifiedMediaBrowser", "WallhavenGalleryNode",
]) {
  assert.match(registry, new RegExp(`"${nodeName}"\\s*:`), `${nodeName} must be registered in the backend`);
}

console.log(`Nodes 2.0 DOM widget inventory: ${full.length} full surfaces, ${small.length} small widgets PASS`);
