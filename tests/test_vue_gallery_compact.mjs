import fs from 'node:fs';
import assert from 'node:assert/strict';

function read(name) {
  return fs.readFileSync(new URL(`../web/js/${name}`, import.meta.url), 'utf8');
}

const galleries = [
  ['lora_gallery.js', 720, 'INITIAL_VIEWPORT_HEIGHT', 'MIN_VIEWPORT_HEIGHT'],
  ['eagle_gallery.js', 720, 'INITIAL_VIEWPORT_HEIGHT', 'MIN_VIEWPORT_HEIGHT'],
  ['wallhaven_gallery.js', 720, 'INITIAL_VIEWPORT_HEIGHT', 'MIN_VIEWPORT_HEIGHT'],
  ['prompt_presets.js', 720, 'PRESETS_DEFAULT_VIEWPORT_HEIGHT', 'PRESETS_MIN_VIEWPORT_HEIGHT'],
  ['video_frame_extractor_vue.js', 720, 'FRAME_SELECTOR_DEFAULT_VIEWPORT_HEIGHT', 'FRAME_SELECTOR_MIN_VIEWPORT_HEIGHT'],
  ['danbooru_search_vue.js', 720, 'DEFAULT_VIEWPORT_HEIGHT', 'MIN_VIEWPORT_HEIGHT'],
  ['director_skill_node.js', 720, 'DIRECTOR_SKILL_DEFAULT_VIEWPORT_HEIGHT', 'DIRECTOR_SKILL_MIN_VIEWPORT_HEIGHT'],
];

for (const [file, defaultHeight, initialConstant, minConstant] of galleries) {
  const source = read(file);
  assert.match(source, new RegExp(`setSize\\(\\[\\d+, ${defaultHeight}\\]\\)`), `${file}: compact initial frame`);
  assert.match(source, new RegExp(`_eagleViewportHeight\\s*=\\s*${initialConstant}`), `${file}: classic viewport starts at the intended default`);
  const domWidgetMounts = [...source.matchAll(/addDOMWidget\s*\(/g)];
  assert.ok(domWidgetMounts.length > 0, `${file}: expected a full-surface DOM widget`);
  for (const mount of domWidgetMounts) {
    const mountContract = source.slice(mount.index, mount.index + 1400);
    assert.doesNotMatch(mountContract, /\.computeSize\s*=/,
      `${file}: full-surface DOM widgets must inherit computeLayoutSize so LiteGraph can grow their slot`);
  }
  assert.match(source, new RegExp(`getMinHeight:[^\\n]*${minConstant}`), `${file}: Nodes 2.0 minimum viewport bound`);
  assert.match(source, /getMaxHeight:[^\n]*(?:1050|1100|1200|MAX_VIEWPORT_HEIGHT)/, `${file}: Nodes 2.0 finite expansion bound`);
  assert.match(source, /getHeight:[^\n]*currentViewportHeight/, `${file}: Nodes 2.0 preferred height follows the bounded viewport state`);
  assert.match(source, /(?:node|this|size|currentSize)\.size\?\.\[1\]|size\?\.\[1\]|size\[1\]|currentSize\[1\]/, `${file}: classic viewport follows user height`);
}

const danbooru = read('danbooru_search_vue.js');
assert.match(danbooru, /function suppressDanbooruStateDefinition[\s\S]*?required\?\.selection_data[\s\S]*?hidden: true,[\s\S]*?vueNode: "never"/,
  'Danbooru must suppress its internal JSON state before Nodes 2.0 creates a parameter row');
assert.match(danbooru, /function hideDanbooruStateWidget[\s\S]*?Object\.assign\(widget\.options, \{[\s\S]*?hidden: true,[\s\S]*?node\.widgets\.splice\(index, 1, widget\)/,
  'Danbooru must notify the Nodes 2.0 shallow-reactive widget list after late hiding');
assert.match(danbooru, /function scheduleDanbooruStateWidgetHiding[\s\S]*?hideDanbooruStateWidget\(node\)[\s\S]*?\[0, 250, 500\]/,
  'Danbooru must hide synchronously and retry after asynchronous widget remounts');
assert.match(danbooru, /this\.setSize\(\[960, 720\]\);[\s\S]{0,180}?scheduleDanbooruStateWidgetHiding\(this\)/,
  'Danbooru must use the shared preview default and hide internal state before mounting the custom application');
assert.match(danbooru, /this\.onConfigure = function \(\)[\s\S]*?scheduleDanbooruStateWidgetHiding\(this\)/,
  'Danbooru must re-hide internal state after switching workflows');
assert.match(danbooru, /onRemoved[\s\S]*?_dbsHideWidgetTimers[\s\S]*?clearTimeout/,
  'Danbooru must release delayed lifecycle work when removed');
const visibilityStart = danbooru.indexOf('function suppressDanbooruStateDefinition(');
const visibilityEnd = danbooru.indexOf('\napp.registerExtension({', visibilityStart);
assert.ok(visibilityStart >= 0 && visibilityEnd > visibilityStart);
const visibilityHelpers = Function(`${danbooru.slice(visibilityStart, visibilityEnd)}\nreturn { suppressDanbooruStateDefinition, hideDanbooruStateWidget };`)();
const definition = { input: { required: { selection_data: ['STRING', { multiline: true }] } } };
assert.equal(visibilityHelpers.suppressDanbooruStateDefinition(definition), true);
assert.equal(definition.input.required.selection_data[1].hidden, true);
assert.equal(definition.input.required.selection_data[1].multiline, true,
  'definition suppression must preserve serialization-related input options');
const stateWidget = { name: 'selection_data', options: { multiline: true } };
let dirtyCalls = 0;
const stateNode = { widgets: [stateWidget], setDirtyCanvas: () => { dirtyCalls += 1; } };
assert.equal(visibilityHelpers.hideDanbooruStateWidget(stateNode), true);
assert.equal(stateWidget.options.hidden, true);
assert.equal(stateWidget.options.multiline, true);
assert.equal(stateNode.widgets[0], stateWidget, 'reactive refresh must preserve the serializable widget instance');
assert.equal(dirtyCalls, 1);
const start = danbooru.indexOf('function inferTagTaxonomy(');
const end = danbooru.indexOf('\nfunction buildTagTaxonomy(', start);
assert.ok(start >= 0 && end > start);
const inferTagTaxonomy = Function('TAG_SUBGROUP_LABELS', 'libraryFacetLabels', 'translationCache',
  `${danbooru.slice(start, end)}\nreturn inferTagTaxonomy;`)({}, {}, {});
assert.deepEqual(
  inferTagTaxonomy({ tag: 'rain', kind: 'lighting', facets: ['environment.weather'] }),
  { major: 'visual', sub: 'lighting' },
  'a manual purpose assignment must survive imported facets',
);
assert.deepEqual(
  inferTagTaxonomy({ tag: 'adult_female', kind: 'identity', facets: ['body.anatomy'], rating: 'unknown' }),
  { major: 'character', sub: 'identity' },
  'approved identity is distinct from safety rating and imported body facets',
);
assert.match(danbooru, /onKeydown: deleteSelectedTags/);
assert.match(danbooru, /event\.stopPropagation\(\); \/\/ ComfyUI must not delete the node itself/);
assert.doesNotMatch(danbooru, /class: "dbs-root", onContextmenu: e =>/);
assert.match(danbooru, /onContextmenu: e => \{ e\.preventDefault\(\); e\.stopPropagation\(\); openDetail\(post, e\)/);
assert.match(danbooru, /onContextmenu: e => \{ e\.preventDefault\(\); e\.stopPropagation\(\); editingIndex/);
assert.match(danbooru, /document\.addEventListener\("click", hideCtxMenu\)[\s\S]*?document\.removeEventListener\("click", hideCtxMenu\)/);
assert.match(danbooru, /selected_tags: selectedOutputTags\.value[\s\S]*?widget\.value = JSON\.stringify/);
assert.match(danbooru, /kind: raw\.kind \|\| defaults\.kind/);
assert.match(danbooru, /rating: raw\.rating \|\| defaults\.rating \|\| "unknown"/);
assert.match(danbooru, /nsfw: normalizeNsfwTriState\(Object\.prototype\.hasOwnProperty\.call\(raw, "nsfw"\)/);
const nsfwStart = danbooru.indexOf('function normalizeNsfwTriState(');
const nsfwEnd = danbooru.indexOf('\nfunction normalizeTagItem(', nsfwStart);
assert.ok(nsfwStart >= 0 && nsfwEnd > nsfwStart);
const normalizeNsfwTriState = Function(`${danbooru.slice(nsfwStart, nsfwEnd)}\nreturn normalizeNsfwTriState;`)();
assert.equal(normalizeNsfwTriState(null), null);
assert.equal(normalizeNsfwTriState(undefined), null);
assert.equal(normalizeNsfwTriState(0), 0);
assert.equal(normalizeNsfwTriState(1), 1);
assert.equal(normalizeNsfwTriState(false), 0);
assert.equal(normalizeNsfwTriState(true), 1);
assert.match(danbooru, /"identity", "appearance", "body", "face", "outfit"/);
assert.match(danbooru, /title: "选择标签后按 Delete 删除；用途分类保存到工作流"/);
assert.match(danbooru, /selected_tag_enrichment_request = request[\s\S]*?app\.queuePrompt\(0, 1, \[String\(props\.node\.id\)\]\)/,
  'tag enrichment must queue only the Danbooru node and its ancestors');
assert.match(danbooru, /async function togglePortFill\(\)[\s\S]*?saveEnrichmentState\(true\);[\s\S]*?app\.queuePrompt\(0, 1, \[String\(props\.node\.id\)\]\)/,
  'the first continuous dictionary batch must not queue unrelated sampler nodes');
assert.match(danbooru, /const accepted = await app\.queuePrompt\(0, 1, \[String\(props\.node\.id\)\]\);[\s\S]*?if \(!accepted\) throw[\s\S]*?delete current\.selected_tag_enrichment_request;[\s\S]*?widget\.value = JSON\.stringify\(current\)/,
  'accepted one-shot enrichment must not remain in a saved workflow after the queue snapshot');
assert.match(danbooru, /const tags = \[\.\.\.new Set\(\(items \|\| \[\]\)[\s\S]*?\.slice\(0, 50\)/);
assert.match(danbooru, /selected_tag_enrichment_request: controls\.selected_tag_enrichment_request/);
assert.match(danbooru, /approvedMetadataCache[\s\S]*?data\.metadata/);
assert.match(danbooru, /kind_manual: raw\.kind_manual === true/);
assert.match(danbooru, /translation_manual: raw\.translation_manual === true/);
assert.match(danbooru, /kind_manual: true/);
assert.match(danbooru, /translation_manual: true/);
assert.match(danbooru, /onRefreshApproved: refreshApprovedTags/);
assert.doesNotMatch(danbooru, /host\.style\.maxHeight = hgt \+ "px"/);
assert.match(danbooru, /eagle_dbs_layout_version = 4/);
assert.match(danbooru, /restoredHeight > 1800/);
assert.doesNotMatch(danbooru, /restoredHeight > 900/);

const lora = read('lora_gallery.js');
assert.match(lora, /Object\.assign\(w\.options, \{ hidden: true, vueNode: "never", hideInPanel: true \}\)/,
  'LoRA hidden state widgets must not reserve Nodes 2.0 parameter rows');
assert.match(lora, /hideWidgets\(this\);[\s\S]*?setTimeout\(function\(\) \{ hideWidgets\(hideNodeRef\); \}, 0\);[\s\S]*?250[\s\S]*?500/,
  'LoRA must re-hide widgets that ComfyUI creates asynchronously');
assert.match(lora, /nodeType\.prototype\.onConfigure[\s\S]*?hideWidgets\(nodeRef\);[\s\S]*?hideWidgets\(nodeRef\)/,
  'LoRA must re-hide native rows after switching workflows');
assert.match(lora, /document\.addEventListener\("click", documentClickHandler\)[\s\S]*?onBeforeUnmount[\s\S]*?document\.removeEventListener\("click", documentClickHandler\)/);
assert.match(lora, /activeDragCleanup\?\.\(\);[\s\S]*?setPointerCapture\?\.\(pointerId\)[\s\S]*?removeEventListener\("pointermove", onMove\)/);
assert.match(lora, /onContextmenu: function\(e\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); openDetails\(item\); \}/);
assert.doesNotMatch(lora, /class: "lg-root"[\s\S]{0,90}onContextmenu:/);

console.log('Vue gallery compact viewport and Danbooru tag actions: PASS');
