import assert from "node:assert/strict";
import fs from "node:fs";

const helperSource = fs.readFileSync(new URL("../web/js/reorder_utils.js", import.meta.url), "utf8");
const { moveKey, moveVisibleKey } = await import(`data:text/javascript,${encodeURIComponent(helperSource)}`);

assert.deepEqual(moveKey(["a", "b", "c"], "a", "c", true), ["b", "c", "a"]);
assert.deepEqual(moveKey(["a", "b", "c"], "c", "a", false), ["c", "a", "b"]);
assert.deepEqual(moveKey(["a", "b"], "missing", "b", false), ["a", "b"]);
assert.deepEqual(moveKey(["a", "b"], "a", "a", true), ["a", "b"]);
assert.deepEqual(
  moveVisibleKey(["hidden-1", "a", "hidden-2", "b", "c"], ["a", "b", "c"], "c", "a", false),
  ["hidden-1", "c", "hidden-2", "a", "b"],
);

const lora = fs.readFileSync(new URL("../web/js/lora_gallery.js", import.meta.url), "utf8");
const presets = fs.readFileSync(new URL("../web/js/prompt_presets.js", import.meta.url), "utf8");
assert.match(lora, /moveKey\(selectedIds\.value/);
assert.match(lora, /syncSelection\(\)/);
assert.match(lora, /onDragstart/);
assert.match(lora, /onDrop/);
assert.match(presets, /moveVisibleKey\(/);
assert.match(presets, /templateOrder:/);
assert.match(presets, /onDragstart/);
assert.match(presets, /onDrop/);
