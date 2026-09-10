import fs from 'node:fs';
import assert from 'node:assert/strict';

function read(name) {
  return fs.readFileSync(new URL(`../web/js/${name}`, import.meta.url), 'utf8');
}

// Full-surface DOM widgets must follow LiteGraph's node size in pixels. A plain
// width:100% is not sufficient because ComfyUI can retain the host width from
// the widget's creation pass after a workflow is restored or a node is resized.
const audited = [
  ['prompt_presets.js', /root\.style\.width = width \+ "px";/, /host\.style\.width = width \+ "px";/],
  ['director_skill_node.js', /root\.style\.width = width \+ "px";/, /host\.style\.width = width \+ "px";/],
  ['danbooru_search_vue.js', /container\.style\.width = width \+ "px";/, /host\.style\.width = width \+ "px";/],
  ['eagle_gallery.js', /el\.style\.width = w \+ "px";/, /host\.style\.width = w \+ "px";/],
  ['wallhaven_gallery.js', /container\.style\.width = width \+ "px";/, /host\.style\.width = width \+ "px";/],
  ['lora_gallery.js', /el\.style\.width = w \+ "px";/, /onResize/],
  ['unified_media_browser.js', /el\.style\.width = w \+ "px";/, /onResize/],
  ['audio_browser.js', /el\.style\.width = w \+ "px";/, /onResize/],
  ['h3_director.js', /el\.style\.width = w \+ 'px';/, /onResize/],
  ['h3_pipeline.js', /el\.style\.width = Math\.max\(260,/, /onResize/],
  ['video_frame_extractor_vue.js', /element\.style\.width = `\$\{width\}px`;/, /onResize/],
];

for (const [name, rootWidth, resizeOrHost] of audited) {
  const source = read(name);
  assert.match(source, rootWidth, `${name} must synchronize its root to the node's pixel width`);
  assert.match(source, resizeOrHost, `${name} must synchronize on resize or size its DOM host`);
  assert.match(source, /canvasOnly:\s*true/, `${name} must stay out of ComfyUI's parameter sidebar`);
  assert.match(source, /\.width\s*=\s*undefined/, `${name} must clear stale sidebar width state`);
}

for (const name of [
  'prompt_presets.js',
  'director_skill_node.js',
  'danbooru_search_vue.js',
  'eagle_gallery.js',
  'wallhaven_gallery.js',
]) {
  const source = read(name);
  assert.match(source, /setTimeout\([^\n]*250/, `${name} must resync after workflow restoration settles`);
}

const promptPresets = read('prompt_presets.js');
assert.match(
  promptPresets,
  /\/eaglePromptPresets\/cover\?path=" \+ encodeURIComponent\(cover\)/,
  'prompt preset local covers must use the backend query-string route',
);
assert.doesNotMatch(
  promptPresets,
  /\/eaglePromptPresets\/cover\/" \+ encodeURIComponent\(cover\)/,
  'prompt preset local covers must not use the nonexistent path-segment route',
);

const danbooru = read('danbooru_search_vue.js');
assert.doesNotMatch(
  danbooru,
  /widget\.computeSize\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?nodeHeight/,
  'Danbooru DOM widget must not feed node height back into computeSize',
);
assert.match(
  danbooru,
  /eagle_dbs_layout_version[\s\S]*?restoredHeight > 1200[\s\S]*?760/,
  'Danbooru must repair heights already persisted by the old feedback loop',
);
assert.match(
  danbooru,
  /\.dbs-preview-bar\s*\{[\s\S]*?overflow:\s*hidden;/,
  'Danbooru output tags must not overflow over the gallery',
);
assert.match(
  danbooru,
  /\.dbte-list\s*\{[^}]*max-height:\s*145px;[^}]*overflow-y:\s*auto;/,
  'Danbooru large tag sets must scroll inside the output panel',
);
assert.match(
  danbooru,
  /library_enrichment_enabled[\s\S]*?模型补全：已启用[\s\S]*?每次工作流执行/,
  'Danbooru model enrichment must be an explicit persistent switch',
);
assert.match(
  danbooru,
  /GALLERY_SORT_OPTIONS[\s\S]*?favcount[\s\S]*?min_favorites/,
  'Danbooru gallery must expose popularity and favorite filters',
);
assert.match(
  danbooru,
  /gacha_allocation_mode[\s\S]*?智能自适应（推荐）[\s\S]*?高级精确数量/,
  'Danbooru gacha must default to compact smart planning while retaining advanced exact quotas',
);
assert.match(
  danbooru,
  /GACHA_FACET_MODE_LABELS[\s\S]*?细分类偏好[\s\S]*?dbs-gacha-facet-grid/,
  'Danbooru fine taxonomy must use compact grouped preference chips instead of one row per facet',
);
assert.match(
  danbooru,
  /selectedGachaFacetGroups[\s\S]*?gacha_facet_group_preferences[\s\S]*?toggleGachaFacetGroup/,
  'Danbooru fine-taxonomy major groups must support persistent multi-selection',
);
assert.match(
  danbooru,
  /面部表情[\s\S]*?身体姿态[\s\S]*?动作交互[\s\S]*?成人内容/,
  'Danbooru gacha must separate expressions, body poses, interactions and adult actions',
);
assert.match(
  danbooru,
  /内容尺度[\s\S]*?仅生活道具[\s\S]*?仅武器[\s\S]*?硬排除标签/,
  'Danbooru per-node constraints must expose content and held-object policies',
);
assert.match(
  danbooru,
  /release_model_after_output[\s\S]*?立即卸载本地 LLM/,
  'Danbooru local LLM retention must persist in the workflow and be controllable outside settings',
);
assert.match(
  danbooru,
  /readJsonResponse[\s\S]*?前后端版本可能不一致/,
  'Danbooru must explain empty responses instead of leaking JSON parser errors',
);
assert.match(
  danbooru,
  /生成式模型参与规划[\s\S]*?语义向量模型仍只负责检索/,
  'Danbooru UI must distinguish generative planning from vector search',
);
assert.match(
  danbooru,
  /本地 SQLite 词库[\s\S]*?随附 CSV 只负责首次播种/,
  'Danbooru gacha must identify SQLite as runtime and CSV as seed/fallback only',
);
assert.match(
  danbooru,
  /SQLite 加入向量索引[\s\S]*?刷新 SQLite \+ CSV 向量数据源/,
  'Danbooru semantic search must expose the bounded SQLite plus CSV source',
);
assert.match(
  danbooru,
  /test_semantic_model[\s\S]*?bilingual_similarity[\s\S]*?检测中英向量模型/,
  'Danbooru must provide an explicit bilingual embedding model probe',
);
assert.match(
  danbooru,
  /\/danbooru_search\/api\/pools[\s\S]*?pool:\$\{pool\.id\}/,
  'Danbooru pools must be searched on demand and feed the gallery query',
);

const persistence = read('workflow_persistence.js');
assert.match(
  persistence,
  /widgets_values_named[\s\S]*?restoreNamedWidgetValues/,
  'Eagle nodes must restore state by widget name on modern ComfyUI frontends',
);
assert.match(
  persistence,
  /python_module === "custom_nodes\.ComfyUI_Eagle_Suite"/,
  'the persistence compatibility layer must stay scoped to Eagle Suite nodes',
);

const promptPresetsSource = read('prompt_presets.js');
assert.match(
  promptPresetsSource,
  /_eagleRestoreUiState[\s\S]*?applyWidgetState/,
  'Prompt Presets must rehydrate Vue state after widgets_values are restored',
);
assert.match(
  read('wallhaven_gallery.js'),
  /widgets_values_named[\s\S]*?selection_data[\s\S]*?_eagleRestoreUiState/,
  'Wallhaven must recover selection_data from the named widget map',
);

const frameSelector = read('video_frame_extractor_vue.js');
assert.match(frameSelector, /createApp\(FrameSelector/, 'video frame selector must mount as a Vue application');
assert.match(frameSelector, /selected_frames[\s\S]*?JSON\.stringify/, 'selected frame numbers must be serialized into the workflow');
assert.match(frameSelector, /frame_previews[\s\S]*?onExecuted/, 'backend preview descriptors must hydrate the visual frame grid');
assert.match(frameSelector, /app\.queuePrompt\(0\)/, 'the preview button must queue the output node');
assert.match(frameSelector, /选择 \/ 上传视频/, 'the frame selector must support direct video upload');
assert.match(frameSelector, /<video v-if="videoUrl"/, 'the frame selector must include an embedded video player');
assert.match(frameSelector, /max="120"/, 'preview density must not be limited to 24 thumbnails');
assert.match(frameSelector, /extract_audio/, 'the frame selector must expose trimmed audio output control');
assert.match(frameSelector, /▣ V1[\s\S]*?♪ A1/, 'the frame selector must render video and audio timeline tracks');
assert.match(frameSelector, /timeline_previews[\s\S]*?waveform_preview/, 'the editor timeline must consume full-source thumbnails and waveform data');
assert.match(frameSelector, /trimmed_video|output_mode/, 'the frame selector must expose conditional trimmed-video encoding');
assert.match(frameSelector, /lock_aspect_ratio[\s\S]*?锁定原视频比例/, 'custom output sizing must offer source-aspect locking');

for (const name of [
  'danbooru_search_vue.js',
  'prompt_presets.js',
  'director_skill_node.js',
  'eagle_gallery.js',
  'lora_gallery.js',
  'audio_browser.js',
  'unified_media_browser.js',
  'video_frame_extractor_vue.js',
]) {
  assert.match(
    read(name),
    /graph\?*\.?change\?*\.?\(/,
    `${name} must mark the workflow changed when hidden UI state changes`,
  );
}

console.log('Vue full-node frame sizing: PASS');
