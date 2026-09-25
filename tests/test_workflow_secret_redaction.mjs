import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { redactSecretWidgetFromWorkflow } from '../web/js/workflow_secret_redaction.js';

const keyWidget = { name: 'api_config_key', value: 'live-secret' };
const otherWidget = { name: 'prompt', value: 'hello' };
const node = { widgets: [otherWidget, keyWidget] };
const workflow = {
  widgets_values: ['hello', 'live-secret'],
  widgets_values_named: { prompt: 'hello', api_config_key: 'live-secret' },
};

const redacted = redactSecretWidgetFromWorkflow(workflow, node, keyWidget);
assert.notEqual(redacted, workflow);
assert.deepEqual(redacted.widgets_values, ['hello', '']);
assert.deepEqual(redacted.widgets_values_named, { prompt: 'hello' });
assert.deepEqual(workflow.widgets_values, ['hello', 'live-secret'], 'runtime data must not be mutated');
assert.equal(keyWidget.value, 'live-secret', 'execution must retain the runtime key');

const legacyWorkflow = { widgets_values: ['hello', 'ENC:bGl2ZS1zZWNyZXQ='] };
assert.deepEqual(redactSecretWidgetFromWorkflow(legacyWorkflow, node, keyWidget).widgets_values, ['hello', '']);

for (const file of ['api_key_input.js', 'api_unified.js']) {
  const source = fs.readFileSync(new URL(`../web/js/${file}`, import.meta.url), 'utf8');
  assert.match(source, /redactSecretWidgetFromWorkflow\(data,/, `${file} must redact both workflow formats`);
}

// Exercise the unified API node hook, not just the shared helper: the key
// remains available to prompt construction while both workflow fields vanish.
let extension;
const unifiedSource = fs.readFileSync(new URL('../web/js/api_unified.js', import.meta.url), 'utf8')
  .replace('import { app } from "../../../scripts/app.js";', '')
  .replace('import { redactSecretWidgetFromWorkflow } from "./workflow_secret_redaction.js";', '');
vm.runInNewContext(unifiedSource, {
  app: { registerExtension(value) { extension = value; } },
  redactSecretWidgetFromWorkflow,
  queueMicrotask,
  atob,
  decodeURIComponent,
  console: { log() {} },
});
const apiWidget = { name: 'api_config_key', value: 'runtime-key' };
const apiNode = {
  widgets: [apiWidget],
  serialize() {
    return {
      widgets_values: [apiWidget.value],
      widgets_values_named: { api_config_key: apiWidget.value },
    };
  },
};
extension._setupSecureSave(apiNode, apiWidget);
const exported = apiNode.serialize();
assert.equal(exported.widgets_values[0], '');
assert.equal(Object.hasOwn(exported.widgets_values_named, 'api_config_key'), false);
assert.equal(apiWidget.value, 'runtime-key');

apiNode.onConfigure({
  widgets_values: ['ENC:bGVnYWN5LWtleQ=='],
  widgets_values_named: { api_config_key: 'ENC:bGVnYWN5LWtleQ==' },
});
await new Promise(queueMicrotask);
assert.equal(apiWidget.value, 'legacy-key', 'older encoded workflows must still load');

let keyExtension;
const keySource = fs.readFileSync(new URL('../web/js/api_key_input.js', import.meta.url), 'utf8')
  .replace('import { app } from "../../../scripts/app.js";', '')
  .replace('import { redactSecretWidgetFromWorkflow } from "./workflow_secret_redaction.js";', '');
const fakeDocument = {
  body: { appendChild() {} },
  createElement() {
    return {
      style: {},
      appendChild() {},
      addEventListener() {},
      remove() {},
    };
  },
};
vm.runInNewContext(keySource, {
  app: { registerExtension(value) { keyExtension = value; } },
  redactSecretWidgetFromWorkflow,
  document: fakeDocument,
  queueMicrotask,
  console: { log() {} },
});
class KeyNode {
  constructor() {
    this.widgets = [{ name: 'api_key', value: 'key-node-runtime-secret' }];
  }
  serialize() {
    return {
      widgets_values: [this.widgets[0].value],
      widgets_values_named: { api_key: this.widgets[0].value },
    };
  }
  addDOMWidget() {}
}
await keyExtension.beforeRegisterNodeDef(KeyNode, { name: 'EagleAPIKeyNode' });
const keyNode = new KeyNode();
keyNode.onNodeCreated();
const keyExport = keyNode.serialize();
assert.equal(keyExport.widgets_values[0], '');
assert.equal(Object.hasOwn(keyExport.widgets_values_named, 'api_key'), false);
assert.equal(keyNode.widgets[0].value, 'key-node-runtime-secret');

console.log('Workflow secret redaction: PASS');
