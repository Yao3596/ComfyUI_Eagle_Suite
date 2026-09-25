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
    // Full-canvas presentation widgets opt out explicitly.  Do not skip every
    // widget with an `element`: in ComfyUI 2.0 native multiline STRING widgets
    // are DOM-backed too, and skipping them shifts old positional values such
    // as crf/custom_width into tags/annotation.
    if (widget.serialize === false) continue;
    widget.value = named[widget.name];
    restored = true;
  }
  return restored;
}

function isEagleNodeDefinition(nodeData) {
  if (!nodeData) return false;
  return String(nodeData.python_module || "").includes("ComfyUI_Eagle_Suite") ||
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

function serializedNodeSize(info) {
  const size = info?.size;
  if (!Array.isArray(size) || size.length < 2) return null;
  const width = Number(size[0]);
  const height = Number(size[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return [width, height];
}

function restoreSerializedNodeSize(node, size, nodeName = "") {
  if (!node || !size) return false;
  // Very old Danbooru workflows may contain a >1800px feedback-loop height and
  // have their own one-time migration.  The exception must stay node-scoped:
  // other Eagle editors intentionally support tall, user-resized 4096px frames.
  if (nodeName === "DanbooruVueSearchNode" && size[1] > 1800) return false;
  const current = node.size || [];
  if (Number(current[0]) === size[0] && Number(current[1]) === size[1]) return false;
  node.setSize?.(size.slice());
  return true;
}

const LEGACY_LAYOUT_REPAIRS = {
  // These surfaces shipped with either a height-feedback bug or a page-height
  // default: the DOM viewport/chrome was persisted as an oversized minimum in
  // Nodes 2.0. Only clearly inflated saved sizes are repaired once;
  // ordinary user resizing remains untouched afterwards.
  // The affected saved workflows are 1114–1216px tall. Keep 1000px and
  // below intact so a compact/manual legacy resize is not treated as damage.
  EagleH3DirectorNode: { version: 4, maxLegacyHeight: 1000, defaultHeight: 720 },
  // The gallery surfaces calculated their viewport from node height, then
  // ComfyUI added the node chrome again on every remount.
  // 1298px is a known persisted result of the old remount feedback loop.
  // Keep 1000px and below untouched so ordinary manual resizing is preserved.
  EagleLoraGalleryNode: { version: 3, maxLegacyHeight: 1000, defaultHeight: 720 },
  EagleVideoFrameExtractor: { version: 3, maxLegacyHeight: 1000, defaultHeight: 720 },
};

function repairLegacyLayoutSize(node, nodeName, savedSize, info = null) {
  const rule = LEGACY_LAYOUT_REPAIRS[nodeName];
  if (!node || !rule || !savedSize) return savedSize;
  node.properties ||= {};
  if (info && (!info.properties || typeof info.properties !== "object")) info.properties = {};
  const key = "eagle_layout_size_version";
  const configuredVersion = Number(info?.properties?.[key] || node.properties[key] || 0);
  if (configuredVersion >= rule.version) return savedSize;
  node.properties[key] = rule.version;
  if (info?.properties) info.properties[key] = rule.version;
  if (savedSize[1] <= rule.maxLegacyHeight) return savedSize;
  return [savedSize[0], rule.defaultHeight];
}

app.registerExtension({
  name: "EagleSuite.WorkflowPersistence",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!isEagleNodeDefinition(nodeData)) return;

    const originalOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function(info) {
      const serializedSize = serializedNodeSize(info);
      const savedSize = repairLegacyLayoutSize(this, nodeData.name, serializedSize, info);
      // Restore before the node-specific hook so custom UIs can read the saved
      // values, then once more afterwards in case an older hook used the
      // positional array and replaced them.
      restoreNamedWidgetValues(this, info);
      restoreSerializedNodeSize(this, savedSize, nodeData.name);
      const result = originalOnConfigure?.apply(this, arguments);
      restoreNamedWidgetValues(this, info);
      restoreSerializedNodeSize(this, savedSize, nodeData.name);

      const node = this;
      queueMicrotask(() => {
        restoreSerializedNodeSize(node, savedSize, nodeData.name);
        refreshNodeUiFromWidgets(node);
      });
      requestAnimationFrame(() => {
        restoreSerializedNodeSize(node, savedSize, nodeData.name);
        refreshNodeUiFromWidgets(node);
      });
      return result;
    };
  },
});

export {
  isEagleNodeDefinition,
  refreshNodeUiFromWidgets,
  restoreNamedWidgetValues,
  repairLegacyLayoutSize,
  restoreSerializedNodeSize,
  serializedNodeSize,
};
