import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { redactSecretWidgetFromWorkflow } from '../web/js/workflow_secret_redaction.js';

// Exercise the LoRA node hook without a browser or network. The Vue component
// is not mounted; this test covers the workflow export boundary specifically.
let extension;
const source = fs.readFileSync(new URL('../web/js/lora_gallery.js', import.meta.url), 'utf8')
  .replace('import { app } from "../../../scripts/app.js";', '')
  .replace('import { createApp, h, ref, onMounted, onBeforeUnmount } from "../lib/vue.esm-browser.js";', '')
  .replace('import { redactSecretWidgetFromWorkflow } from "./workflow_secret_redaction.js";', '')
  .replace('import "./eagle_vue_theme.js";', '');

const element = () => ({ style: {}, appendChild() {}, replaceChildren() {} });
vm.runInNewContext(source, {
  app: { registerExtension(value) { extension = value; } },
  document: {
    getElementById() { return true; },
    createElement: element,
  },
  createApp() { return { mount() {}, unmount() {} }; },
  redactSecretWidgetFromWorkflow,
  setTimeout() {},
  console: { error() {} },
});

class LoraNode {
  constructor() {
    this.widgets = [
      { name: 'selection_data', value: '[{"id":"demo"}]' },
      { name: 'civitai_api_key', value: 'live-civitai-secret' },
      { name: 'manual_triggers', value: 'lighting' },
    ];
    this.size = [960, 720];
  }
  setSize(size) { this.size = size; }
  setDirtyCanvas() {}
  addDOMWidget() { return {}; }
  serialize() {
    return {
      widgets_values: this.widgets.map(widget => widget.value),
      widgets_values_named: Object.fromEntries(this.widgets.map(widget => [widget.name, widget.value])),
    };
  }
}

await extension.beforeRegisterNodeDef(LoraNode, { name: 'EagleLoraGalleryNode' });
const node = new LoraNode();
node.onNodeCreated();
const exported = node.serialize();
assert.deepEqual(exported.widgets_values, ['[{"id":"demo"}]', '', 'lighting']);
assert.deepEqual({ ...exported.widgets_values_named }, {
  selection_data: '[{"id":"demo"}]',
  manual_triggers: 'lighting',
});
assert.equal(node.widgets[1].value, 'live-civitai-secret', 'prompt execution retains the runtime key');
console.log('LoRA workflow key redaction: PASS');
