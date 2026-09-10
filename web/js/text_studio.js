import { app } from "../../../scripts/app.js";

const STYLE_ID = "eagle-text-studio-style";
const SEPARATOR_DEFAULT_VERSION = 2;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .eagle-text-studio{box-sizing:border-box;width:100%;min-height:150px;padding:10px;
      border:1px solid #28466d;border-radius:8px;background:#091321;color:#dce9fb;
      font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;overflow:hidden}
    .eagle-text-studio__head{display:flex;align-items:center;justify-content:space-between;
      gap:8px;padding-bottom:7px;border-bottom:1px solid #1c3555}
    .eagle-text-studio__title{font-family:system-ui,sans-serif;font-weight:700;color:#78b7ff}
    .eagle-text-studio__stats{font-family:system-ui,sans-serif;color:#8fa9c7;white-space:nowrap}
    .eagle-text-studio__status{margin-top:7px;color:#72d6a0;font-family:system-ui,sans-serif}
    .eagle-text-studio__status.is-warning{color:#ffba6b}
    .eagle-text-studio__preview{box-sizing:border-box;margin:7px 0 0;max-height:170px;
      overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;color:#d8e5f5;scrollbar-width:thin}
    .eagle-text-studio__empty{color:#667e9b;font-style:italic}
  `;
  document.head.appendChild(style);
}

function firstValue(value, fallback = "") {
  if (Array.isArray(value)) return value.length ? value[0] : fallback;
  return value ?? fallback;
}

function migrateSeparatorDefault(node) {
  node.properties = {...(node.properties || {})};
  if (Number(node.properties.eagleTextStudioSeparatorDefaultVersion || 0) >= SEPARATOR_DEFAULT_VERSION) return;
  const widget = node.widgets?.find((item) => item.name === "separator");
  // “\\n”是旧版本唯一默认值；迁移一次后仍可由用户手动改回换行。
  if (widget && String(widget.value ?? "") === "\\n") {
    widget.value = ",";
    widget.callback?.(",");
  }
  node.properties.eagleTextStudioSeparatorDefaultVersion = SEPARATOR_DEFAULT_VERSION;
}

function createPreview(node) {
  installStyles();
  const root = document.createElement("div");
  root.className = "eagle-text-studio";

  const head = document.createElement("div");
  head.className = "eagle-text-studio__head";
  const title = document.createElement("span");
  title.className = "eagle-text-studio__title";
  title.textContent = "输出预览";
  const stats = document.createElement("span");
  stats.className = "eagle-text-studio__stats";
  stats.textContent = "等待执行";
  head.append(title, stats);

  const status = document.createElement("div");
  status.className = "eagle-text-studio__status";
  status.textContent = "连接下游或直接运行节点即可查看结果";
  const preview = document.createElement("pre");
  preview.className = "eagle-text-studio__preview eagle-text-studio__empty";
  preview.textContent = "暂无输出";
  root.append(head, status, preview);

  node.addDOMWidget("text_studio_preview", "div", root, {
    serialize: false,
    hideOnZoom: false,
  });
  node._eagleTextStudio = { root, stats, status, preview };
  const width = Math.max(440, Number(node.size?.[0]) || 440);
  const height = Math.max(520, Number(node.size?.[1]) || 520);
  node.setSize([width, height]);
}

app.registerExtension({
  name: "Eagle.TextStudio",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleTextStudio") return;

    const previousCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = previousCreated?.apply(this, arguments);
      if (!this._eagleTextStudio) createPreview(this);
      migrateSeparatorDefault(this);
      return result;
    };

    const previousConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = previousConfigure?.apply(this, arguments);
      migrateSeparatorDefault(this);
      return result;
    };

    const previousExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (data) {
      previousExecuted?.apply(this, arguments);
      const view = this._eagleTextStudio;
      if (!view || !data) return;
      const output = String(firstValue(data.text, ""));
      const status = String(firstValue(data.status, "处理完成"));
      view.preview.textContent = output || "暂无输出";
      view.preview.classList.toggle("eagle-text-studio__empty", !output);
      view.stats.textContent = String(firstValue(data.stats, ""));
      view.status.textContent = status;
      view.status.classList.toggle("is-warning", status !== "处理完成");
      this.setDirtyCanvas?.(true, true);
    };
  },
});
