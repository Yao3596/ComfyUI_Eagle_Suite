import { app } from "../../../scripts/app.js";

// Newer ComfyUI frontends serialize both the historical positional
// `widgets_values` array and a name-addressed `widgets_values_named` object.
// DOM widgets can change the positional list between save and restore (for
// example Wallhaven's canvas widget used to consume the saved selection
// value).  For Eagle nodes the named object is the stable source of truth.
function restoreNamedWidgetValues(node, info) {
  const named = info && info.widgets_values_named;
  if (!node || !named || typeof named !== "object") return false;

  let restored = false;
  for (const widget of node.widgets || []) {
    if (!widget || !Object.prototype.hasOwnProperty.call(named, widget.name)) continue;
    // Full-canvas DOM widgets are presentation only.  Their empty value is not
    // workflow state and must not replace a live DOM widget instance.
    if (widget.serialize === false || widget.element) continue;
    widget.value = named[widget.name];
    restored = true;
  }
  return restored;
}

function isEagleNodeDefinition(nodeData) {
  if (!nodeData) return false;
  return nodeData.python_module === "custom_nodes.ComfyUI_Eagle_Suite" ||
    String(nodeData.category || "").includes("Eagle Suite");
}

function refreshNodeUiFromWidgets(node) {
  if (!node) return;
  try {
    node._eagleRestoreUiState?.();
    // H3 predates the shared hook and already has a tested state reloader.
    node._h3ReloadState?.();
  } catch (error) {
    console.warn("[Eagle Suite] workflow UI state restore failed:", error);
  }
}

app.registerExtension({
  name: "EagleSuite.WorkflowPersistence",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!isEagleNodeDefinition(nodeData)) return;

    const originalOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function(info) {
      // Restore before the node-specific hook so custom UIs can read the saved
      // values, then once more afterwards in case an older hook used the
      // positional array and replaced them.
      restoreNamedWidgetValues(this, info);
      const result = originalOnConfigure?.apply(this, arguments);
      restoreNamedWidgetValues(this, info);

      const node = this;
      queueMicrotask(() => refreshNodeUiFromWidgets(node));
      setTimeout(() => refreshNodeUiFromWidgets(node), 0);
      return result;
    };
  },
});

export { isEagleNodeDefinition, refreshNodeUiFromWidgets, restoreNamedWidgetValues };
