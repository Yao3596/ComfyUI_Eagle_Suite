import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { redactSecretWidgetFromWorkflow } from '../web/js/workflow_secret_redaction.js';

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.style = {};
    this.children = [];
    this.listeners = {};
  }
  appendChild(child) { this.children.push(child); }
  addEventListener(event, callback) { this.listeners[event] = callback; }
}

let extension;
const app = { registerExtension(value) { extension = value; } };
const source = fs.readFileSync(new URL('../web/js/api_unified.js', import.meta.url), 'utf8')
  .replace('import { app } from "../../../scripts/app.js";', '')
  .replace('import { redactSecretWidgetFromWorkflow } from "./workflow_secret_redaction.js";', '');
vm.runInNewContext(source, {
  app,
  redactSecretWidgetFromWorkflow,
  document: { createElement: tag => new Element(tag) },
  console: { log() {} },
  queueMicrotask,
  atob,
});

let callbacks = 0;
const keyWidget = { name: 'api_config_key', value: '', options: {},
  callback() { callbacks += 1; } };
const node = {
  widgets: [keyWidget],
  addDOMWidget(name, type, container, options) {
    this.passwordWidget = { name, type, container, options };
  },
  onConfigure(config) { keyWidget.value = config.widgets_values_named?.api_config_key || ''; },
  serialize() {
    return { widgets_values: [keyWidget.value],
      widgets_values_named: { api_config_key: keyWidget.value } };
  },
};

extension._setupPasswordField(node, keyWidget);
extension._setupSecureSave(node, keyWidget);
const input = node._eagleApiKeyInput;
assert.equal(keyWidget.hidden, true);
assert.equal(keyWidget.options.hidden, true);
assert.equal(keyWidget.options.vueNode, 'never');
assert.equal(keyWidget.options.hideInPanel, true);
assert.equal(node.passwordWidget.options.hideInPanel, true);
assert.equal(node.passwordWidget.options.serialize, false);
assert.equal(input.type, 'password');
input.value = 'runtime-secret';
input.listeners.input();
assert.equal(keyWidget.value, 'runtime-secret');
assert.equal(callbacks, 1);
const exported = node.serialize();
assert.equal(Object.hasOwn(exported.widgets_values_named, 'api_config_key'), false);
assert.notEqual(exported.widgets_values[0], 'runtime-secret');
node.onConfigure({ widgets_values_named: { api_config_key: 'restored-secret' } });
assert.equal(input.value, 'restored-secret');
assert.equal(input.type, 'password');

console.log('Unified API key node-owned password field Nodes 2.0 contract OK');
