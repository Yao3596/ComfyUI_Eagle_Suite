import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { redactSecretWidgetFromWorkflow } from '../web/js/workflow_secret_redaction.js';

let extension;
const app = {registerExtension(value) { extension = value; }};
const source = fs.readFileSync(new URL('../web/js/api_unified.js', import.meta.url), 'utf8')
  .replace('import { app } from "../../../scripts/app.js";', '')
  .replace('import { redactSecretWidgetFromWorkflow } from "./workflow_secret_redaction.js";', '');
vm.runInNewContext(source, {app, redactSecretWidgetFromWorkflow, console: {log() {}}, document: {createElement() { return {style: {}}; }}});
class Node {
  constructor() { this.comfyClass = 'EagleAPIImageNode'; this.widgets = []; }
  addWidget() {}
  addDOMWidget(name, type, element, options) { this.dom = {name, element, options}; }
  setDirtyCanvas() {}
}
await extension.beforeRegisterNodeDef(Node, {name: 'EagleAPIImageNode'}, app);
const node = new Node();
extension._setupNode(node);
assert.equal(node.dom.options.serialize, false);
assert.equal(node.dom.options.hideInPanel, true);
assert.match(node.dom.element.textContent, /等待执行/);
node.onExecuted({text: ['目标 2880x3840 | API 返回 1087x1447 | 输出 2880x3840']});
assert.match(node.dom.element.textContent, /API 返回 1087x1447/);
assert.match(node.dom.element.textContent, /输出 2880x3840/);
assert.equal(node.widgets.length, 0);
node.widgets.push({name: 'output_resize_mode', value: null});
node.onConfigure();
assert.equal(node.widgets[0].value, '适应留边');
node.widgets[0].value = '保留API原图';
node.onConfigure();
assert.equal(node.widgets[0].value, '保留API原图');
console.log('API image status UI: PASS (mock DOM; no browser/API request)');
