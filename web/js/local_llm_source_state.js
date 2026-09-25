import { app } from "../../../scripts/app.js";

const NODE_NAME = "EagleLocalLLMNode";
const LOCAL_WIDGETS = new Set(["model_path", "device", "dtype"]);
const SYSTEM_PROMPT_INPUT = "system_prompt";
const CUSTOM_SYSTEM_TEMPLATE = "custom";

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

function switchConnectedSystemPromptToCustom(node) {
  if (!hasLink(node, SYSTEM_PROMPT_INPUT)) return false;
  const widget = (node.widgets || []).find((item) => item && item.name === "system_template");
  if (!widget || widget.value === CUSTOM_SYSTEM_TEMPLATE) return false;

  widget.value = CUSTOM_SYSTEM_TEMPLATE;
  try {
    widget.callback?.(CUSTOM_SYSTEM_TEMPLATE, widget, node);
  } catch (error) {
    console.error("[Eagle Suite] system_template callback failed", error);
  }
  // Mark the automatic semantic change exactly once. Merely refreshing the
  // node or disconnecting system_prompt must not rewrite user state.
  node.graph?.change?.();
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
  return true;
}

function isSystemPromptConnectEvent(node, args) {
  const index = Number(args && args[1]);
  const connected = Boolean(args && args[2]);
  const linkInfo = args && args[3];
  if (!connected || !Number.isInteger(index)) return false;
  const input = (node.inputs || [])[index];
  if (!input || input.name !== SYSTEM_PROMPT_INPUT) return false;
  // LiteGraph reports the callback on both endpoints. If link metadata is
  // available, only treat the target endpoint as an input connection.
  if (linkInfo && linkInfo.target_id != null && node.id != null && String(linkInfo.target_id) !== String(node.id)) {
    return false;
  }
  return true;
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
      setTimeout(() => {
        // Existing workflows can already contain the input link while still
        // carrying the old image_expert default.
        switchConnectedSystemPromptToCustom(this);
        refreshModelSource(this);
      }, 0);
      return result;
    };

    const connectionsChanged = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const result = connectionsChanged?.apply(this, arguments);
      const connectionArgs = Array.from(arguments);
      setTimeout(() => {
        if (isSystemPromptConnectEvent(this, connectionArgs)) {
          switchConnectedSystemPromptToCustom(this);
        }
        refreshModelSource(this);
      }, 0);
      return result;
    };

  },
});
