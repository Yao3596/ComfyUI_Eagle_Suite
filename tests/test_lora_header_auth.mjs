import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../web/js/lora_gallery.js', import.meta.url), 'utf8');
const helper = source.match(/function civitaiRequestOptions\(\) \{[\s\S]*?\n    \}/)?.[0];
assert.ok(helper, 'local Civitai request helper exists');

function optionsFor(value) {
  return vm.runInNewContext(`${helper}; civitaiRequestOptions()`, {
    apiKey: { value },
  });
}

const withKey = optionsFor(' synthetic-key-not-real ');
assert.equal(withKey.headers['X-Eagle-Civitai-Key'], 'synthetic-key-not-real');
assert.equal(withKey.cache, 'no-store');
assert.deepEqual({ ...optionsFor('').headers }, {});

assert.match(source, /fetchJson\("\/lora_gallery\/model_details\?id=" \+ encodeURIComponent\(item\.id\), civitaiRequestOptions\(\)\)/);
assert.match(source, /fetch\("\/lora_gallery\/civitai_info\?id=" \+ encodeURIComponent\(id\), civitaiRequestOptions\(\)\)/);
assert.doesNotMatch(source, /(?:model_details|civitai_info)\?id=[^\n]*&api_key=/);
console.log('LoRA Civitai metadata header transport: PASS');
