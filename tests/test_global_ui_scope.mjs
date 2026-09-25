import assert from 'node:assert/strict';
import fs from 'node:fs';

const jsDir = new URL('../web/js/', import.meta.url);
const sources = fs.readdirSync(jsDir)
  .filter((name) => name.endsWith('.js'))
  .map((name) => [name, fs.readFileSync(new URL(name, jsDir), 'utf8')]);

for (const [name, source] of sources) {
  assert.doesNotMatch(source, /(?:LGraphCanvas|LGraphNode|LiteGraph)\.prototype\.(?:onContextMenu|processContextMenu|showNodeMenu|onMouseDown)\s*=/,
    `${name} must not replace ComfyUI's global menu handlers`);
  assert.doesNotMatch(source, /document\.addEventListener\(['"]contextmenu['"]\s*,/,
    `${name} must not intercept right-clicks across the page`);
}

const theme = sources.find(([name]) => name === 'eagle_vue_theme.js')?.[1];
assert.match(theme, /mutationAddsEagleRoot\(records\)/,
  'the body-wide palette observer must ignore ordinary node-content mutations');

const timeline = sources.find(([name]) => name === 'media_timeline_editor.js')?.[1];
assert.match(timeline, /if \(!HIDDEN_WIDGETS\.has\(widget\.name\)\) continue;[\s\S]*?widget\.hidden = true;/,
  'timeline native controls must also be hidden from Nodes 2.0');

for (const name of [
  'h3_director.js', 'h3_pipeline.js', 'h3_review_workspace_svelte.js',
  'media_timeline_editor.js', 'svelte_character_interaction.js', 'text_studio.js',
]) {
  const source = sources.find(([candidate]) => candidate === name)?.[1];
  assert.match(source, /getMinHeight:\s*(?:\(\)\s*=>|function\(\)\s*\{)/, `${name} needs a Nodes 2.0 lower layout bound`);
  assert.match(source, /getMaxHeight:\s*(?:\(\)\s*=>|function\(\)\s*\{)/, `${name} needs a Nodes 2.0 upper layout bound`);
}
