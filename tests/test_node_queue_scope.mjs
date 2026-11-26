import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../web/js/review_gate_flow.js", import.meta.url), "utf8");
const helper = await import(`data:text/javascript,${encodeURIComponent(source)}`);
assert.equal(typeof helper.queueNodeTask, "function", "node-local tools need a shared partial-execution entry point");

const calls = [];
const app = {
  extensionManager: { queueSettings: { mode: "instant-running", batchCount: 10 } },
  ui: { autoQueueEnabled: true, graphHasChanged: true },
  async queuePrompt(...args) { calls.push(args); return true; },
};
await helper.queueNodeTask(app, { id: 12 });
assert.deepEqual(calls, [[0, 1, ["12"]]], "a tool action must run one node, not all output branches or the global batch count");
assert.equal(app.extensionManager.queueSettings.mode, "disabled");
assert.equal(app.ui.autoQueueEnabled, false);

const output = { id: 20, constructor: { nodeData: { output_node: true } }, outputs: [] };
const node = { id: 12, outputs: [{ links: [1] }], graph: {
  links: { 1: { target_id: 20 } }, getNodeById: () => output,
} };
await helper.queueNodeTask(app, node, { downstream: true });
assert.deepEqual(calls[1], [0, 1, ["20"]], "continuing a chain must stay in that chain's output branches");
app.processingQueue = true;
await assert.rejects(helper.queueNodeTask(app, node), /提交/);
assert.equal(calls.length, 2, "a busy queue serializer must not accept an ambiguous second task");

const read = (name) => fs.readFileSync(new URL(`../web/js/${name}`, import.meta.url), "utf8");
assert.match(read("video_frame_extractor_vue.js"), /await queueNodeTask\(app, node\)/);
assert.match(read("danbooru_search_vue.js"), /async function requestModelRelease\(\)[\s\S]*?await queueNodeTask\(app, props\.node\)/);
assert.doesNotMatch(read("video_frame_extractor_vue.js"), /app\.queuePrompt\(0\)/);
assert.doesNotMatch(read("danbooru_search_vue.js"), /app\.queuePrompt\(0\)/);
assert.doesNotMatch(read("h3_director.js"), /app\.queuePrompt\(\)/);
assert.doesNotMatch(read("h3_director.js"), /queueNodeTask\([^\n]+downstream:\s*true/,
  "director authoring must never queue its video chain after collecting results");
assert.match(read("h3_pipeline.js"), /queueNodeTask\(app, node, \{ downstream: true \}\)/);
assert.match(read("h3_review_workspace_svelte.js"), /queueNodeTask\(app, node, \{ downstream: true \}\)/);
console.log("Eagle local task scope and one-shot queueing: PASS");
