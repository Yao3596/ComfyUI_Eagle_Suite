import assert from "node:assert/strict";
import fs from "node:fs";

const bundle = fs.readFileSync(new URL("../web/js/svelte_character_interaction.js", import.meta.url), "utf8");
const review = fs.readFileSync(new URL("../web/js/h3_review_workspace_svelte.js", import.meta.url), "utf8");

for (const name of ["EagleSvelteCharacterInteractionNode", "EagleSvelteCharacterPVNode"]) {
  assert.match(bundle, new RegExp(`nodeName: "${name}"`), `${name} must have a UI adapter`);
}
assert.match(bundle, /hideInPanel:\s*true/, "Svelte DOM widget must mount in the Nodes 2.0 body");
assert.doesNotMatch(bundle, /canvasOnly:\s*true/, "legacy canvasOnly hides the Svelte panel in Nodes 2.0");
assert.match(bundle, /vueNode:\s*"never"/, "raw JSON state input must not cover the panel");
assert.match(bundle, /panelHeight:\s*500/, "interaction panel must have bounded internal scroll");
assert.match(bundle, /panelHeight:\s*540/, "PV panel must have bounded internal scroll");
assert.equal((bundle.match(/defaultSize: \[960, 720\]/g) || []).length, 2,
  "both Svelte preview nodes must start at the shared 960x720 frame");
assert.doesNotMatch(bundle, /panelWidget\.computeSize\s*=/,
  "the visible Svelte panel must retain DOMWidgetImpl's growable computeLayoutSize contract");
assert.match(bundle, /widget\.computeSize = \(\) => \[0, -4\]/,
  "only the hidden serialized state row keeps a collapsed computeSize");
assert.doesNotMatch(bundle, /this\.size\?\.\[0\] ===[\s\S]{0,240}this\.setSize\(defaultSize\.slice\(\)\)/,
  "workflow restore must not rewrite a legitimate user-selected Svelte node size");
assert.match(review, /vueNode:\s*"never"/, "review control inputs must be hidden in Nodes 2.0");
assert.match(review, /Svelte 审片面板加载失败/, "review mount failures must be visible inside the node");
assert.match(review, /target\.style\.height = currentViewportHeight \+ "px"/, "review panel must follow the explicit height allocated by either renderer");
assert.match(review, /MAX_VIEWPORT_HEIGHT = 4096[\s\S]*getMaxHeight:\s*\(\) => MAX_VIEWPORT_HEIGHT/, "Nodes 2.0 review height must remain safely bounded without blocking normal resizing");
assert.match(review, /widget\._eagleViewportHeight = 650/, "review starts from a stable minimum viewport");
assert.doesNotMatch(review, /widget\.computeSize\s*=\s*\(width\)/,
  "the visible review panel must retain DOMWidgetImpl's growable computeLayoutSize contract");
assert.match(review, /widget\.computeSize = \(\) => \[0, -4\]/,
  "review transport controls remain collapsed without changing the visible panel contract");
assert.match(review, /node\.setSize\?\.\(\[960, 720\]\)/,
  "a genuinely new review node must use the shared 960x720 initial frame");
assert.match(review, /const applySize = \(size\) => \{[\s\S]*currentViewportHeight = Math\.min[\s\S]*widget\._eagleViewportHeight = currentViewportHeight[\s\S]*node\.onResize = function \(size\)[\s\S]*applySize\(size\)/,
  "both renderers must follow the same bounded user resize state");
assert.match(review, /node\.onConfigure = function[\s\S]*queueMicrotask\(\(\) => \{[\s\S]*applySize\(node\.size\)/,
  "workflow restoration must reapply the saved review-node size after configure");

console.log("Svelte Nodes 2.0 adapter contracts passed");
