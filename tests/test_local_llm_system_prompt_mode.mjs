import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "web", "js", "local_llm_source_state.js");
const source = fs.readFileSync(sourcePath, "utf8");
const executableSource = source.replace(/^import\s+\{\s*app\s*\}[^;]+;\s*$/m, "");
const extensions = [];
Function("app", executableSource)({
  registerExtension(extension) { extensions.push(extension); },
});

const extension = extensions.find((item) => item.name === "Eagle.LocalLLMSourceState");
assert.ok(extension, "local LLM source-state extension must register");

function LocalLLMNode() {}
await extension.beforeRegisterNodeDef(LocalLLMNode, { name: "EagleLocalLLMNode" });

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function makeNode({ linked = true, template = "image_expert", id = 304 } = {}) {
  const calls = { callback: [], graphChange: 0, graphDirty: 0, nodeDirty: 0 };
  const templateWidget = {
    name: "system_template",
    value: template,
    callback(...args) { calls.callback.push(args); },
  };
  const node = new LocalLLMNode();
  Object.assign(node, {
    id,
    inputs: [
      { name: "system_prompt", link: linked ? 42 : null },
      { name: "model", link: null },
      { name: "qwen_model", link: null },
    ],
    widgets: [templateWidget, { name: "model_path", value: "model.gguf" }],
    graph: {
      change() { calls.graphChange += 1; },
      setDirtyCanvas() { calls.graphDirty += 1; },
    },
    setDirtyCanvas() { calls.nodeDirty += 1; },
  });
  return { node, templateWidget, calls };
}

const connected = makeNode();
connected.node.onConnectionsChange(1, 0, true, { target_id: connected.node.id, target_slot: 0 });
await tick();
assert.equal(connected.templateWidget.value, "custom", "connecting system_prompt must activate the custom template");
assert.equal(connected.calls.callback.length, 1, "automatic selection must invoke the widget callback once");
assert.deepEqual(connected.calls.callback[0], ["custom", connected.templateWidget, connected.node]);
assert.equal(connected.calls.graphChange, 1, "automatic selection must persist as a graph change");
assert.ok(connected.calls.nodeDirty >= 1 && connected.calls.graphDirty >= 1, "automatic selection must redraw the node and graph");

// Replayed connection notifications and ordinary refreshes must not repeatedly
// invoke the callback or create workflow history entries.
connected.node.onConnectionsChange(1, 0, true, { target_id: connected.node.id, target_slot: 0 });
await tick();
assert.equal(connected.calls.callback.length, 1);
assert.equal(connected.calls.graphChange, 1);

connected.node.inputs[0].link = null;
connected.node.onConnectionsChange(1, 0, false, { target_id: connected.node.id, target_slot: 0 });
await tick();
assert.equal(connected.templateWidget.value, "custom", "disconnecting must not restore or overwrite the template");
assert.equal(connected.calls.callback.length, 1);
assert.equal(connected.calls.graphChange, 1);

connected.templateWidget.value = "image_expert";
connected.node.onConnectionsChange(1, 0, false, { target_id: connected.node.id, target_slot: 0 });
await tick();
assert.equal(connected.templateWidget.value, "image_expert", "a disconnected node must preserve a later user choice");

connected.node.inputs[0].link = 43;
connected.node.onConnectionsChange(1, 0, true, { target_id: connected.node.id, target_slot: 0 });
await tick();
assert.equal(connected.templateWidget.value, "custom");
assert.equal(connected.calls.callback.length, 2, "a genuine reconnect may activate custom again");
assert.equal(connected.calls.graphChange, 2);

const outputEndpoint = makeNode({ linked: true, template: "image_expert", id: 500 });
outputEndpoint.node.onConnectionsChange(2, 0, true, { source_id: outputEndpoint.node.id, target_id: 999 });
await tick();
assert.equal(outputEndpoint.templateWidget.value, "image_expert", "an output-end notification must not masquerade as system_prompt input");
assert.equal(outputEndpoint.calls.callback.length, 0);
assert.equal(outputEndpoint.calls.graphChange, 0);

const restored = makeNode({ linked: true, template: "image_expert", id: 600 });
restored.node.onConfigure({});
await tick();
assert.equal(restored.templateWidget.value, "custom", "loaded workflows with an existing system_prompt link must be repaired");
assert.equal(restored.calls.callback.length, 1);
assert.equal(restored.calls.graphChange, 1);

const deployScript = fs.readFileSync(path.join(root, "tools", "deploy_eagle_verified.ps1"), "utf8");
assert.match(deployScript, /'web\\js\\local_llm_source_state\.js'/, "verified deployment must include the connection-state extension");

console.log("local LLM connected system_prompt mode: PASS");
