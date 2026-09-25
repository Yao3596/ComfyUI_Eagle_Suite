import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../web/js/api_key_input.js', import.meta.url), 'utf8');

assert.match(source, /node\.addDOMWidget\('eagle_api_key_input', 'div', container,/);
assert.match(source, /hideInPanel:\s*true/);
assert.match(source, /Object\.assign\(originalWidget\.options, \{[^\n]*hidden:\s*true[^\n]*vueNode:/,
  'the replaced native key row must be hidden by ComfyUI 2.0');
assert.match(source, /node\.widgets\.splice\(widgetIndex, 1, originalWidget\)/,
  'late key-row hiding must invalidate the shallow-reactive widget list');
assert.doesNotMatch(source, /document\.body\.appendChild\(container\)/);
assert.doesNotMatch(source, /node\.addCustomWidget\(posWidget\)/);
assert.match(source, /originalWidget\.value\s*=\s*val/);
assert.match(source, /redactSecretWidgetFromWorkflow\(data, node, originalWidget\)/);

console.log('API key DOM widget Nodes 2.0 contract OK');
