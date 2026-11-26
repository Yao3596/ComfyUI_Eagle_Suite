import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../web/js/review_gate_flow.js", import.meta.url), "utf8");
const flow = await import(`data:text/javascript,${encodeURIComponent(source)}`);
const { downstreamOutputIds } = flow;

const nodes = new Map();
const links = {
  10: { origin_id: 1, target_id: 2 },
  11: { origin_id: 2, target_id: 3 },
  12: { origin_id: 1, target_id: 5 },
  13: { origin_id: 6, target_id: 4 },
};
const graph = { links, getNodeById: (id) => nodes.get(Number(id)) };
function node(id, linkIds, output = false) {
  const result = { id, graph, outputs: [{ links: linkIds }], constructor: { nodeData: { output_node: output } } };
  nodes.set(id, result);
  return result;
}
const gate = node(1, [10, 12]);
node(2, [11]);
node(3, [], true);
node(4, [], true);
node(5, [], false);
node(6, [13]);
assert.deepEqual(downstreamOutputIds(gate), ["3"]);

const ui = fs.readFileSync(new URL("../web/js/review_gate.js", import.meta.url), "utf8");
assert.match(ui, /app\.queuePrompt\(0,\s*1,\s*outputIds\)/);
assert.match(ui, /widget\.value\s*=\s*token/);
assert.match(ui, /widget\.value\s*=\s*""/);
assert.match(ui, /eagle_review/);

// Exercise real click handlers. Queue completion follows ComfyUI's auto-queue
// rule: an instant-running mode queues another workflow when the queue empties.
async function createGate(mode = "instant-running", legacyAuto = true) {
  let extension;
  const calls = [];
  const apiListeners = {};
  const checkbox = { checked: legacyAuto };
  const document = {
    getElementById: (id) => id === "autoQueueCheckbox" ? checkbox : null,
    head: { appendChild() {} },
    createElement() {
      return {
        style: {}, classList: { toggle() {} }, children: [], listeners: {},
        append(...items) { this.children.push(...items); },
        addEventListener(name, callback) { this.listeners[name] = callback; },
      };
    },
  };
  const app = {
    extensionManager: { queueSettings: { mode, batchCount: 8 } },
    ui: { autoQueueEnabled: legacyAuto, autoQueueMode: "instant", graphHasChanged: true },
    registerExtension(value) { extension = value; },
    async queuePrompt(...args) {
      calls.push({ args, token: gate.widgets[0].value });
      return true;
    },
  };
  vm.runInNewContext(source.replace(/^export /gm, "") + "\n" + ui.replace(/^import .*;\r?\n/gm, ""), {
    app, document, api: { addEventListener(name, listener) { apiListeners[name] = listener; } },
    setTimeout() {}, console,
  });
  await extension.setup?.();
  class ReviewNode {
    constructor() {
      this.id = 1;
      this.size = [430, 340];
      this.widgets = [{ name: "确认令牌", value: "" }, { name: "保存后重新开始", value: false }];
      this.graph = graph;
      this.outputs = [{ links: [10] }];
    }
    addDOMWidget() {}
    setSize(value) { this.size = value; }
  }
  await extension.beforeRegisterNodeDef(ReviewNode, { name: "EagleReviewGate" });
  const gate = new ReviewNode();
  gate.onNodeCreated();
  gate.onExecuted({ eagle_review: [{ state: "pending", token: "candidate-1" }] });
  const click = (button) => button.listeners.click({ stopPropagation() {} });
  const complete = async () => {
    gate.onExecuted({ eagle_review: [{ state: "approved" }] });
    const settings = app.extensionManager.queueSettings;
    if (settings.mode === "instant-running" ||
        (settings.mode === "change" && app.ui.graphHasChanged) ||
        (app.ui.autoQueueEnabled && app.ui.autoQueueMode === "instant")) {
      await app.queuePrompt(0, settings.batchCount);
    }
  };
  return { gate, app, calls, checkbox, click, complete, apiListeners };
}

{
  const harness = await createGate();
  await harness.click(harness.gate._eagleReviewView.approve);
  await harness.complete();
  assert.equal(harness.calls.length, 1, "approval must stop after saving, even with instant auto-queue enabled");
  assert.deepEqual(Array.from(harness.calls[0].args[2]), ["3"], "approval must target downstream outputs only");
  assert.equal(harness.calls[0].token, "candidate-1");
  assert.equal(harness.app.extensionManager.queueSettings.mode, "disabled");
  assert.equal(harness.app.ui.autoQueueEnabled, false);
  assert.equal(harness.checkbox.checked, false);
}

{
  const harness = await createGate("disabled", false);
  await harness.click(harness.gate._eagleReviewView.approve);
  await harness.click(harness.gate._eagleReviewView.approve);
  assert.equal(harness.calls.length, 1, "the same pending result must not be queued twice before backend execution");
}

{
  const harness = await createGate("disabled", false);
  // The user can change queue mode while a candidate is waiting. The continue
  // button must stop that mode before mutating its transient approval widget.
  harness.app.extensionManager.queueSettings.mode = "change";
  harness.app.ui.autoQueueEnabled = true;
  await harness.click(harness.gate._eagleReviewView.approve);
  await harness.complete();
  assert.equal(harness.calls.length, 1, "auto-queue on change must not restart after approval");
}

{
  const harness = await createGate("instant-running", true);
  await harness.click(harness.gate._eagleReviewView.regenerate);
  await harness.complete();
  assert.equal(harness.calls.length, 1, "regenerate is also one manual run, not a new auto-queue loop");
}

{
  const harness = await createGate("disabled", false);
  harness.app.extensionManager.queueSettings.mode = "instant-running";
  harness.apiListeners.executed?.({ detail: { output: { eagle_inactive_execution: [true] } } });
  assert.equal(harness.app.extensionManager.queueSettings.mode, "disabled",
    "a workflow containing only inactive Eagle nodes must not spin an automatic no-op loop");
}

{
  const h = await createGate("disabled", false);
  h.apiListeners.eagle_preview_waiting({ detail: { node_ids: ["1"] } });
  assert.equal(h.gate._eagleReviewView.approve.disabled, true, "old confirmation must be disabled while upstream runs");
  assert.match(h.gate._eagleReviewView.status.textContent, /等待本轮输入/);
  h.gate.onExecuted({ eagle_review: [{ state: "pending", token: "new-value" }] });
  assert.equal(h.gate._eagleReviewView.approve.disabled, false, "confirmation becomes available only after current input arrives");
  h.gate.title = "🦅 保存前确认";
  h.gate.onConfigure();
  assert.equal(h.gate.title, "🦅 预览确认");
}

{
  const h = await createGate("disabled", false);
  await h.click(h.gate._eagleReviewView.approve);
  h.apiListeners.executed({ detail: { node: "1", prompt_id: "save", output: { eagle_review: [{ state: "approved" }] } } });
  h.apiListeners.execution_success({ detail: { prompt_id: "save" } });
  assert.match(h.gate._eagleReviewView.status.textContent, /已结束/);
  assert.equal(h.calls.length, 1);
}

{
  const h = await createGate("disabled", false);
  h.gate.widgets[1].value = true;
  await h.click(h.gate._eagleReviewView.approve);
  h.apiListeners.executed({ detail: { node: "1", prompt_id: "save", output: { eagle_review: [{ state: "approved" }] } } });
  h.apiListeners.execution_success({ detail: { prompt_id: "save" } });
  await Promise.resolve();
  assert.equal(h.calls.length, 2, "the optional switch starts one new cycle after successful downstream completion");
  assert.deepEqual(Array.from(h.calls[1].args[2]), ["3"]);
  assert.equal(h.gate._eagleReviewView.approve.disabled, true);
  h.apiListeners.execution_success({ detail: { prompt_id: "save" } });
  assert.equal(h.calls.length, 2);
}

{
  const h = await createGate("disabled", false);
  h.gate.outputs[0].links = [];
  h.gate.widgets[1].value = true;
  h.apiListeners.executed({ detail: { node: "1", prompt_id: "preview-only", output: { eagle_review: [{ state: "bypass" }] } } });
  h.apiListeners.execution_success({ detail: { prompt_id: "preview-only" } });
  assert.equal(h.calls.length, 0, "a preview-only run must not start another round without a downstream output");
}

console.log("Review gate single execution and auto-queue interaction: PASS");
