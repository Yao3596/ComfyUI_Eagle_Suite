import { app } from "../../../scripts/app.js";

const NODE_NAME = "EagleLocalLLMNode";
const LOCAL_WIDGETS = new Set(["model_path", "device", "dtype"]);

function hasLink(node, inputName) {
  const input = (node.inputs || []).find((slot) => slot && slot.name === inputName);
  return Boolean(input && input.link != null);
}

function sourceState(node) {
  const eagle = hasLink(node, "model");
  const qwen = hasLink(node, "qwen_model");
  if (eagle) {
    return {
      external: true,
      text: qwen
        ? "外部模型：Eagle 加载器生效；qwen_model 因优先级较低被忽略"
        : "外部模型：Eagle 加载器生效",
    };
  }
  if (qwen) return { external: true, text: "外部模型：QWENLLAMA 加载器生效" };
  return { external: false, text: "模型来源：本节点 model_path" };
}

function setWidgetDisabled(widget, disabled) {
  if (!widget || !LOCAL_WIDGETS.has(widget.name)) return;
  widget.options = widget.options || {};
  if (disabled && !widget._eagleExternalModelDisabled) {
    widget._eagleFrozenValue = widget.value;
    widget._eagleOriginalCallback = widget.callback;
    widget.callback = function () {
      if (widget._eagleExternalModelDisabled) {
        widget.value = widget._eagleFrozenValue;
        return;
      }
      return widget._eagleOriginalCallback?.apply(this, arguments);
    };
  } else if (!disabled && widget._eagleExternalModelDisabled) {
    widget.callback = widget._eagleOriginalCallback;
    delete widget._eagleOriginalCallback;
    delete widget._eagleFrozenValue;
  }
  widget.disabled = disabled;
  widget.options.disabled = disabled;
  widget._eagleExternalModelDisabled = disabled;
  widget.label = disabled
    ? `${widget.name}（外部模型接管）`
    : widget.name;
}

function refreshModelSource(node) {
  const state = sourceState(node);
  (node.widgets || []).forEach((widget) => setWidgetDisabled(widget, state.external));
  node._eagleModelSource = state.text;
  node.graph?.setDirtyCanvas?.(true, true);
}

app.registerExtension({
  name: "Eagle.LocalLLMSourceState",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;

    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      setTimeout(() => refreshModelSource(this), 0);
      return result;
    };

    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = configured?.apply(this, arguments);
      setTimeout(() => refreshModelSource(this), 0);
      return result;
    };

    const connectionsChanged = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const result = connectionsChanged?.apply(this, arguments);
      setTimeout(() => refreshModelSource(this), 0);
      return result;
    };

  },
});
