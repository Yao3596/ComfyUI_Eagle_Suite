import { app } from "../../../scripts/app.js";

const MAX_VARIABLES = 20;

function normalizeVariableName(value) {
  return String(value == null ? "" : value).trim().replace(/^\{\{\s*|\s*\}\}$/g, "");
}

app.registerExtension({
  name: "EaglePromptVariablesNode",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EaglePromptVariablesNode") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      const result = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
      const node = this;
      const countWidget = this.widgets?.find((widget) => widget.name === "变量数量");
      if (!countWidget) return result;

      const originalCallback = countWidget.callback;

      function rememberWidget(widget) {
        if (!widget || widget._eagleVisibilityState) return;
        widget._eagleVisibilityState = {
          type: widget.type,
          computeSize: widget.computeSize
        };
      }

      function setWidgetVisible(widget, visible) {
        if (!widget) return;
        rememberWidget(widget);
        const original = widget._eagleVisibilityState;
        widget.hidden = !visible;
        widget.type = visible ? original.type : "hidden";
        widget.computeSize = visible ? original.computeSize : () => [0, -4];
      }

      function updateVariableVisibility(options = {}) {
        const count = Math.max(1, Math.min(MAX_VARIABLES, Number(countWidget.value) || 1));
        for (let index = 1; index <= MAX_VARIABLES; index++) {
          setWidgetVisible(node.widgets?.find((widget) => widget.name === `变量名_${index}`), index <= count);
          setWidgetVisible(node.widgets?.find((widget) => widget.name === `变量值_${index}`), index <= count);
        }

        if (!options.preserveSize) {
          const computed = node.computeSize();
          node.setSize([Math.max(260, node.size?.[0] || computed[0]), computed[1]]);
        }
        node.setDirtyCanvas(true, true);
      }

      countWidget.callback = function() {
        if (originalCallback) originalCallback.apply(this, arguments);
        updateVariableVisibility();
      };

      node._ppUpdateVariableVisibility = updateVariableVisibility;
      node._ppSetRequiredVariables = function(names) {
        const required = Array.from(new Set((Array.isArray(names) ? names : [])
          .map(normalizeVariableName)
          .filter(Boolean)))
          .slice(0, MAX_VARIABLES);
        if (!required.length) return;

        required.forEach((name, offset) => {
          const widget = node.widgets?.find((item) => item.name === `变量名_${offset + 1}`);
          if (!widget) return;
          const current = normalizeVariableName(widget.value);
          if (!current || widget._ppAutoAssigned) {
            widget.value = name;
            widget._ppAutoAssigned = true;
          }
        });

        if ((Number(countWidget.value) || 0) < required.length) countWidget.value = required.length;
        updateVariableVisibility({ preserveSize: true });
      };

      node._ppGetVariables = function() {
        const count = Math.max(0, Math.min(MAX_VARIABLES, Number(countWidget.value) || 0));
        const out = {};
        for (let i = 1; i <= count; i++) {
          const nameWidget = node.widgets?.find((w) => w.name === `变量名_${i}`);
          const valueWidget = node.widgets?.find((w) => w.name === `变量值_${i}`);
          const key = normalizeVariableName(nameWidget?.value);
          if (key) out[key] = valueWidget ? String(valueWidget.value == null ? "" : valueWidget.value) : "";
        }
        return out;
      };

      function notifyDownstreamNodes() {
        if (!node.outputs || !node.outputs[0] || !node.graph) return;
        const links = node.outputs[0].links;
        if (!Array.isArray(links)) return;
        for (const linkId of links) {
          const link = node.graph.links[linkId];
          if (!link) continue;
          const targetNode = node.graph.getNodeById(link.target_id);
          if (targetNode && typeof targetNode._ppSyncExternalVariables === "function") {
            try { targetNode._ppSyncExternalVariables(); } catch (e) {}
          }
        }
      }

      // 给每个变量名/值 widget 增加回调，值变化时通知下游提示词预设节点刷新
      for (let i = 1; i <= MAX_VARIABLES; i++) {
        ["变量名_", "变量值_"].forEach((prefix) => {
          const widget = node.widgets?.find((w) => w.name === `${prefix}${i}`);
          if (!widget) return;
          const original = widget.callback;
          widget.callback = function() {
            if (original) original.apply(this, arguments);
            notifyDownstreamNodes();
          };
        });
      }

      const updateButton = node.addWidget("button", "🔄 更新显示", null, () => {
        updateVariableVisibility();
      }, {});
      updateButton.serialize = false;

      // 注入样式：修复多行变量值输入框左侧白边/高亮线
      if (!document.getElementById("eagle-variables-node-style")) {
        const style = document.createElement("style");
        style.id = "eagle-variables-node-style";
        style.textContent = `
          .litegraph .node-widget textarea { outline: none !important; border-left: none !important; box-shadow: none !important; }
          .litegraph .node-widget textarea:focus { outline: none !important; border-color: #6c7a8c !important; }
        `;
        document.head.appendChild(style);
      }

      setTimeout(() => updateVariableVisibility({ preserveSize: true }), 100);
      return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function(info) {
      if (onConfigure) onConfigure.apply(this, arguments);
      setTimeout(() => {
        if (this._ppUpdateVariableVisibility) this._ppUpdateVariableVisibility({ preserveSize: true });
      }, 100);
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function() {
      delete this._ppUpdateVariableVisibility;
      delete this._ppSetRequiredVariables;
      if (onRemoved) onRemoved.apply(this, arguments);
    };
  }
});
