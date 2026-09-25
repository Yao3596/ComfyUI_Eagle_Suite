import assert from "node:assert/strict";
import fs from "node:fs";

const read = (name) => fs.readFileSync(new URL(`../web/js/${name}`, import.meta.url), "utf8");

const video = read("video_saver.js");
assert.doesNotMatch(video, /SECTION_DEFS|insertSeparator|#ff9500|Eagle元数据/,
  "video nodes must not inject orange pseudo-widgets into workflow serialization");
assert.match(video, /resolution\?\.value[\s\S]*=== "custom"/,
  "custom width/height are shown only when custom resolution is selected");
assert.match(video, /setWidgetVisible\(node, findWidget\(node, "custom_width"\), showCustom\)/);
assert.match(video, /setWidgetVisible\(node, findWidget\(node, "custom_height"\), showCustom\)/);
assert.match(video, /options:\s*\{ \.\.\.\(widget\.options \|\| \{\}\) \}/,
  "dynamic visibility must preserve the native widget options");
assert.match(video, /widget\.options = \{ \.\.\.\(widget\.options \|\| \{\}\), hidden: true, vueNode: "never", hideInPanel: true \}/,
  "custom dimensions must use the ComfyUI 2.0 visibility contract");
assert.match(video, /node\.widgets\.splice\(index, 1, widget\)/,
  "dynamic visibility changes must invalidate Nodes 2.0 shallow reactivity");
assert.match(video, /normalizeLegacyVideoWorkflowInfo\(info, nodeData\.name\)/,
  "video nodes must remove the four legacy separator positions before native restore");
assert.match(video, /EagleImagesToVideo: new Set\(\[0, 5, 10, 19\]\)/);
assert.match(video, /EagleVideoConverter: new Set\(\[0, 5, 9, 19\]\)/);

const labels = read("eagle_saver_labels.js");
for (const nodeName of ["EagleSaver", "EagleImagesToVideo", "EagleVideoConverter"]) {
  assert.match(labels, new RegExp(`"${nodeName}"`));
}
assert.match(labels, /"5 ★★★★★"/);
assert.doesNotMatch(labels, /widgets\.splice\(/,
  "metadata display order must come from INPUT_TYPES so classic positional values stay stable");
assert.match(labels, /!isRating\(starWidget\.value\) && isRating\(tagsWidget\.value\)/,
  "legacy tags/star positional workflows need a one-way migration");

const lora = read("lora_gallery.js");
const danbooru = read("danbooru_search_vue.js");
assert.match(lora, /setSize\(\[960, 720\]\)/);
assert.match(lora, /INITIAL_VIEWPORT_HEIGHT = 550/);
assert.match(lora, /MIN_VIEWPORT_HEIGHT = 280/);
assert.doesNotMatch(lora, /this\.size\?\.\[1\]\) === 720\) this\.setSize/,
  "LoRA workflow height 720 is a valid user size, not a migration sentinel");
assert.match(danbooru, /setSize\(\[960, 720\]\)/);
assert.match(danbooru, /DEFAULT_VIEWPORT_HEIGHT = 570/);
assert.match(danbooru, /MIN_VIEWPORT_HEIGHT = 280/);

for (const file of [
  "eagle_gallery.js", "prompt_presets.js", "wallhaven_gallery.js",
  "video_frame_extractor_vue.js", "svelte_character_interaction.js",
]) {
  assert.doesNotMatch(read(file), /this\.size\?\.\[[01]\] ===[^\n]+this\.setSize/,
    `${file}: onConfigure must preserve workflow node size`);
}

for (const file of [
  "lora_gallery.js", "eagle_gallery.js", "director_skill_node.js",
  "prompt_presets.js", "danbooru_search_vue.js", "wallhaven_gallery.js",
  "video_frame_extractor_vue.js", "media_timeline_editor.js",
  "audio_browser.js", "unified_media_browser.js",
  "h3_director.js", "h3_review_workspace_svelte.js", "svelte_character_interaction.js",
]) {
  assert.doesNotMatch(
    read(file),
    /computeSize\s*=\s*[^;\n]*size\?\.\[1\]/,
    `${file}: DOM widget computeSize height must not feed node.size back into layout`,
  );
}

const h3Director = read("h3_director.js");
assert.match(h3Director, /H3_DEFAULT_NODE_SIZE = \[960, 720\]/,
  "H3 Director should open at the shared 960x720 preview size");
assert.match(h3Director, /this\.setSize\(H3_DEFAULT_NODE_SIZE\.slice\(\)\)/,
  "new H3 Director nodes should use the compact default without sharing the array");
assert.match(h3Director, /getHeight: function\(\) \{ return currentViewportHeight; \}/,
  "Nodes 2.0 must still render the explicitly resized H3 viewport height");
assert.doesNotMatch(h3Director, /widget\.computeSize = function\(width\)[\s\S]{0,900}?H3_MIN_VIEWPORT_HEIGHT/,
  "the main DOM widget must stay growable instead of being classified as a fixed-height widget");
assert.doesNotMatch(h3Director, /Number\(current\[1\]/,
  "H3 Director must not grow on every workflow remount");
assert.doesNotMatch(h3Director, /\[1300, 1080\]/,
  "the obsolete page-height H3 default must not return");
assert.match(h3Director, /onSerialize[\s\S]{0,600}?eagle_layout_size_version = H3_LAYOUT_VERSION/,
  "a newly saved H3 node must opt into the compact layout version before reload");

const persistence = read("workflow_persistence.js");
assert.match(persistence, /serializedNodeSize\(info\)/);
assert.match(persistence, /restoreSerializedNodeSize\(this, savedSize, nodeData\.name\)/);
assert.match(persistence, /EagleVideoFrameExtractor: \{ version: 3, maxLegacyHeight: 1000, defaultHeight: 720 \}/);
assert.match(persistence, /EagleLoraGalleryNode: \{ version: 3, maxLegacyHeight: 1000, defaultHeight: 720 \}/);
assert.match(persistence, /EagleH3DirectorNode: \{ version: 4, maxLegacyHeight: 1000, defaultHeight: 720 \}/,
  "old page-height H3 nodes need a one-time migration to the shared preview height");
assert.doesNotMatch(persistence, /widget\.serialize === false \|\| widget\.element/,
  "native ComfyUI 2.0 multiline widgets are DOM-backed and must restore by name");

const persistenceStart = persistence.indexOf("function serializedNodeSize(");
const persistenceEnd = persistence.indexOf("\napp.registerExtension({", persistenceStart);
assert.ok(persistenceStart >= 0 && persistenceEnd > persistenceStart);
const persistenceHelpers = Function(
  `${persistence.slice(persistenceStart, persistenceEnd)}\nreturn { repairLegacyLayoutSize, restoreSerializedNodeSize };`,
)();
const tallNode = { size: [900, 700], setSize(size) { this.size = size; } };
assert.equal(
  persistenceHelpers.restoreSerializedNodeSize(tallNode, [900, 4096], "EagleH3DirectorNode"),
  true,
  "valid tall Eagle editors must restore their user-selected height",
);
assert.deepEqual(tallNode.size, [900, 4096]);
const compactUserNode = { size: [960, 720], setSize(size) { this.size = size; } };
assert.equal(
  persistenceHelpers.restoreSerializedNodeSize(compactUserNode, [438, 276], "EaglePromptPresets"),
  true,
  "a deliberately compact user resize must win over the 960x720 creation default",
);
assert.deepEqual(compactUserNode.size, [438, 276]);
const legacyDanbooruFrame = { size: [1200, 720], setSize(size) { this.size = size; } };
assert.equal(
  persistenceHelpers.restoreSerializedNodeSize(legacyDanbooruFrame, [1200, 2400], "DanbooruVueSearchNode"),
  false,
  "only Danbooru leaves its legacy >1800px feedback height to its own migration",
);
assert.deepEqual(legacyDanbooruFrame.size, [1200, 720]);
const legacyH3 = { properties: {} };
const legacyH3Info = { properties: {} };
assert.deepEqual(
  persistenceHelpers.repairLegacyLayoutSize(
    legacyH3,
    "EagleH3DirectorNode",
    [1396, 1216],
    legacyH3Info,
  ),
  [1396, 720],
  "the known page-height H3 layout must migrate once",
);
assert.equal(legacyH3.properties.eagle_layout_size_version, 4);
assert.deepEqual(
  persistenceHelpers.repairLegacyLayoutSize(
    legacyH3,
    "EagleH3DirectorNode",
    [1396, 1216],
    legacyH3Info,
  ),
  [1396, 1216],
  "after migration, a deliberate tall H3 resize must be preserved",
);
assert.deepEqual(
  persistenceHelpers.repairLegacyLayoutSize(
    { properties: {} },
    "EagleH3DirectorNode",
    [1300, 1000],
    { properties: {} },
  ),
  [1300, 1000],
  "legacy H3 heights at the migration threshold must remain untouched",
);
const legacyLora = { properties: {} };
const legacyInfo = { properties: {} };
assert.deepEqual(
  persistenceHelpers.repairLegacyLayoutSize(
    legacyLora,
    "EagleLoraGalleryNode",
    [960, 1298],
    legacyInfo,
  ),
  [960, 720],
  "the known 1298px LoRA feedback-loop height must migrate once",
);
assert.equal(legacyLora.properties.eagle_layout_size_version, 3);
assert.equal(legacyInfo.properties.eagle_layout_size_version, 3);
assert.deepEqual(
  persistenceHelpers.repairLegacyLayoutSize(
    legacyLora,
    "EagleLoraGalleryNode",
    [960, 1298],
    legacyInfo,
  ),
  [960, 1298],
  "after migration, a deliberate tall resize must be preserved",
);
assert.deepEqual(
  persistenceHelpers.repairLegacyLayoutSize(
    { properties: {} },
    "EagleLoraGalleryNode",
    [960, 1000],
    { properties: {} },
  ),
  [960, 1000],
  "normal LoRA heights at the migration threshold must remain untouched",
);

const legacyVideoFrame = { properties: {} };
const legacyVideoFrameInfo = { properties: {} };
assert.deepEqual(
  persistenceHelpers.repairLegacyLayoutSize(
    legacyVideoFrame,
    "EagleVideoFrameExtractor",
    [960, 1298],
    legacyVideoFrameInfo,
  ),
  [960, 720],
  "the old Video Frame height-feedback result must migrate to the shared 720px default",
);
assert.equal(legacyVideoFrame.properties.eagle_layout_size_version, 3);
assert.deepEqual(
  persistenceHelpers.repairLegacyLayoutSize(
    legacyVideoFrame,
    "EagleVideoFrameExtractor",
    [960, 1298],
    legacyVideoFrameInfo,
  ),
  [960, 1298],
  "after one migration, a deliberate tall Video Frame resize must be preserved",
);

const loraGallery = read("lora_gallery.js");
assert.match(loraGallery, /LORA_LAYOUT_VERSION = 3/);
assert.match(
  loraGallery,
  /this\.properties\.eagle_layout_size_version = LORA_LAYOUT_VERSION[\s\S]{0,500}?data\.properties\.eagle_layout_size_version = LORA_LAYOUT_VERSION/,
  "new LoRA nodes must serialize the layout version before a later manual resize",
);

assert.match(read("prompt_variables_node.js"), /_ppUpdateVariableVisibility\(\{ preserveSize: true \}\)/);
assert.match(read("latent_switch_node.js"), /syncInputs\(this, \{ preserveSize: true \}\)/);
assert.match(read("text_switch_node_vue.js"), /syncInputs\(node, \{ preserveSize: true \}\)/);

console.log("Layout persistence and video metadata contracts: PASS");
