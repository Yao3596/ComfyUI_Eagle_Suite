import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertResolvedDecision,
  isValidRetryLength,
  normalizeReview,
  normalizeWorkspace,
  reviewPhase,
  serializeWorkspace,
  snapRetryLength,
  takeKey,
} from "../src/lib/contracts.js";

const migrated = normalizeWorkspace({
  selected_take_key: "2:3:C:\\renders\\private\\clip.mp4",
  retry: { prompt: "new action", seed: 23, length: 124 },
  options: { assemble_partial: false, autoplay: true },
});
assert.equal(migrated.version, 2);
assert.equal(migrated.selectedTakeKey, "2:3");
assert.equal(migrated.retrySeed, 23);
assert.equal(migrated.retryLength, 124);
assert.equal(migrated.assemblePartial, false);
assert.equal(migrated.autoplay, true);

const serialized = JSON.parse(serializeWorkspace(migrated));
assert.equal(serialized.version, 2);
assert.deepEqual(serialized.retry, { prompt: "new action", seed: 23, length: 124 });
assert.equal(serialized.options.autoplay, true);
assert.equal(JSON.stringify(serialized).includes("clip.mp4"), false);
assert.equal(JSON.stringify(serialized).includes("renders"), false);

const review = normalizeReview({
  current_index: 2,
  preview_clip: "clip.mp4",
  awaiting_review: true,
});
assert.equal(review.history.length, 1);
assert.equal(takeKey(review.history[0]), "2:1");
assert.equal(reviewPhase(review), "reviewing");

assert.equal(snapRetryLength(0), 0);
assert.equal(snapRetryLength(5), 5);
assert.equal(snapRetryLength(17), 22);
assert.equal(snapRetryLength(124), 124);
assert.equal(snapRetryLength(125), 124);
assert.equal(snapRetryLength(99999), 3592);
assert.equal(isValidRetryLength(0), true);
assert.equal(isValidRetryLength(5), true);
assert.equal(isValidRetryLength(3592), true);
assert.equal(isValidRetryLength(17), false);
assert.equal(isValidRetryLength(125), false);

assert.equal(assertResolvedDecision({ resolved: true }).resolved, true);
assert.equal(assertResolvedDecision({ resolved_success: true }).resolved_success, true);
assert.throws(() => assertResolvedDecision({ resolved: false }), /尚未成功解析/);
assert.throws(() => assertResolvedDecision({ status: "ok" }), /resolved=true/);

const adapterSource = await readFile(
  new URL("../../web/js/h3_review_workspace_svelte.js", import.meta.url),
  "utf8",
);
assert.match(adapterSource, /response\.json\(\)/);
assert.match(adapterSource, /assertResolvedDecision\(body\)/);
assert.match(adapterSource, /new AbortController\(\)/);
assert.match(adapterSource, /removeAttribute\("src"\)/);
assert.match(adapterSource, /_eagleH3ResolvedToken/);

const componentSource = await readFile(
  new URL("../src/nodes/H3ReviewWorkspace.svelte", import.meta.url),
  "utf8",
);
assert.equal(componentSource.includes(":global(*)"), false);
assert.match(componentSource, /仅对下一次进入审片等待生效/);
