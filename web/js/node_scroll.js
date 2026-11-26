/** Keep ordinary wheel scrolling inside registered Nodes 2.0 DOM widgets. */
import { app } from "../../../scripts/app.js";

const roots = new Map();
const installedNodeTypes = new WeakSet();

function captureWidgetScroll(event) {
  // Classic DOM widgets and Ctrl/Meta zoom keep ComfyUI's existing behavior.
  if (event.ctrlKey || event.metaKey) return;
  const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
  let root = target;
  while (root && !roots.has(root)) root = root.parentElement;
  if (!root?.closest?.('.lg-node[data-node-id]')) return;

  let element = target;
  while (element && root.contains(element)) {
    const vertical = event.deltaY && element.scrollHeight > element.clientHeight + 1;
    const horizontal = event.deltaX && element.scrollWidth > element.clientWidth + 1;
    if (vertical || horizontal) {
      const style = getComputedStyle(element);
      if ((vertical && /^(auto|scroll|overlay)$/.test(style.overflowY)) ||
          (horizontal && /^(auto|scroll|overlay)$/.test(style.overflowX))) {
        // Nodes 2.0 intercepts wheel in the TransformPane capture phase, before
        // widget listeners. Stop only these scrollable widgets earlier, while
        // leaving the browser's default scroll intact and without moving focus.
        event.stopPropagation();
        return;
      }
    }
    if (element === root) break;
    element = element.parentElement;
  }
}

export function bindNodeWidgetScroll(root) {
  if (!root) return () => {};
  const wasEmpty = !roots.size;
  roots.set(root, (roots.get(root) || 0) + 1);
  if (wasEmpty) {
    document.addEventListener('wheel', captureWidgetScroll, { capture: true, passive: true });
  }
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const count = roots.get(root) || 0;
    if (count > 1) roots.set(root, count - 1);
    else roots.delete(root);
    if (!roots.size) document.removeEventListener('wheel', captureWidgetScroll, true);
  };
}

function trackNodeWidget(node, widget) {
  if (!widget?.element) return widget;
  const release = bindNodeWidgetScroll(widget.element);
  const releases = node._eagleScrollReleases ||= new Set();
  releases.add(release);
  const onRemove = widget.onRemove;
  widget.onRemove = function() {
    release();
    releases.delete(release);
    return onRemove?.apply(this, arguments);
  };
  return widget;
}

app.registerExtension({
  name: "EagleSuite.NodeScroll",
  beforeRegisterNodeDef(nodeType, nodeData) {
    const eagle = String(nodeData?.python_module || "").includes("ComfyUI_Eagle_Suite") ||
      String(nodeData?.category || "").includes("Eagle Suite");
    if (!eagle || installedNodeTypes.has(nodeType)) return;
    const addDOMWidget = nodeType.prototype.addDOMWidget;
    if (typeof addDOMWidget !== "function") return;
    installedNodeTypes.add(nodeType);

    // Wrap only Eagle's concrete node classes. This catches synchronous Vue
    // mounts and later Svelte/DOM mounts without timers or document observers.
    nodeType.prototype.addDOMWidget = function() {
      return trackNodeWidget(this, addDOMWidget.apply(this, arguments));
    };
    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function() {
      for (const release of this._eagleScrollReleases || []) release();
      this._eagleScrollReleases?.clear();
      return onRemoved?.apply(this, arguments);
    };
  },
});
