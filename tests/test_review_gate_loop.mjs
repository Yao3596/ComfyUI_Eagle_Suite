import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../web/js/review_gate_flow.js", import.meta.url), "utf8");
const helpers = await import(`data:text/javascript,${encodeURIComponent(source)}`);
assert.equal(typeof helpers.createReviewLoopController, "function", "review completion needs an explicit per-node repeat switch");

function setup(enabled) {
  const node = { enabled };
  const queued = [], completed = [], errors = [];
  const controller = helpers.createReviewLoopController({
    findNode: (detail) => detail.node === "gate" ? node : null,
    isEnabled: (node) => node.enabled,
    queueNext: async (node) => queued.push(node),
    onComplete: (node, repeating) => completed.push(repeating),
    onError: (node, error) => errors.push(error),
  });
  const executed = (state, id = "run-1") => controller.onExecuted({
    node: "gate", prompt_id: id, output: { eagle_review: [{ state }] },
  });
  return { node, controller, queued, completed, errors, executed };
}

{
  const h = setup(false);
  h.executed("approved");
  await h.controller.onSuccess({ prompt_id: "run-1" });
  assert.equal(h.queued.length, 0, "default completion must end the run for every payload type");
  assert.deepEqual(h.completed, [false]);
}
{
  const h = setup(true);
  h.executed("pending");
  await h.controller.onSuccess({ prompt_id: "run-1" });
  assert.equal(h.queued.length, 0, "a pending confirmation must never trigger a rerun");
  h.executed("approved", "saved-run");
  await h.controller.onSuccess({ prompt_id: "unrelated-run" });
  assert.equal(h.queued.length, 0, "other workflows finishing must not trigger this gate");
  await h.controller.onSuccess({ prompt_id: "saved-run" });
  await h.controller.onSuccess({ prompt_id: "saved-run" });
  assert.equal(h.queued.length, 1, "one successful save cycle must start at most one new cycle");
  h.executed("pending", "next-run");
  await h.controller.onSuccess({ prompt_id: "next-run" });
  assert.equal(h.queued.length, 1, "the new cycle must wait for its own manual approval");
}
{
  const h = setup(true);
  h.executed("approved");
  h.node.enabled = false;
  await h.controller.onSuccess({ prompt_id: "run-1" });
  assert.equal(h.queued.length, 0, "turning the switch off before saving ends cancels repetition");
}
{
  const h = setup(true);
  h.executed("approved");
  h.controller.onFailed({ prompt_id: "run-1" });
  await h.controller.onSuccess({ prompt_id: "run-1" });
  assert.equal(h.queued.length, 0, "failed or interrupted tasks must not repeat");
}
{
  const h = setup(true);
  h.executed("bypass");
  await h.controller.onSuccess({ prompt_id: "run-1" });
  assert.equal(h.queued.length, 1, "repeat can also be used with confirmation switched off");
}
{
  const h = setup(true);
  h.executed("approved");
  h.controller.forgetNode(h.node);
  await h.controller.onSuccess({ prompt_id: "run-1" });
  assert.equal(h.queued.length, 0, "a removed node must never restart its former workflow");
}
console.log("Review completion switch, manual confirmation, and repeat lifecycle: PASS");
