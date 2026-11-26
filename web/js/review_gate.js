import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { downstreamOutputIds, pauseReviewAutoQueue, queueNodeTask, createReviewLoopController } from "./review_gate_flow.js";

const STYLE_ID = "eagle-review-gate-style";
const reviewNodes = new Set();
const shortcutConnectors = new WeakSet();

function repeatEnabled(node) {
  return !!node._eagleReviewView &&
    !!(node.widgets || []).find((widget) => widget.name === "保存后重新开始")?.value &&
    downstreamOutputIds(node).length > 0;
}

function findReviewNode(detail) {
  const ids = [detail.node, detail.display_node_id].filter((id) => id != null).map(String);
  return [...reviewNodes].find((node) => ids.includes(String(node.id)));
}

const reviewLoop = createReviewLoopController({
  findNode: findReviewNode,
  isEnabled: repeatEnabled,
  async queueNext(node) {
    // Text saves can finish before the current prompt's browser submission
    // returns. Wait for that serializer, rather than submitting a duplicate.
    for (let attempt = 0; app.processingQueue && attempt < 200; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!repeatEnabled(node)) return;
    showReview(node, { state: "upstream" });
    await queueNodeTask(app, node, { downstream: true });
  },
  onComplete(node, repeating) {
    showReview(node, { state: repeating ? "upstream" : "completed" });
  },
  onError(node, error) {
    showReview(node, { state: "error", summary: error.message || String(error) });
  },
});

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .eg-review{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;width:100%;height:100%;min-width:0;min-height:0;padding:10px;border:1px solid #333d4e;border-radius:8px;background:#141923;color:#dce6f5;font:12px/1.5 system-ui,sans-serif;overflow:auto;contain:size layout paint style}
    .eg-review *{box-sizing:border-box}
    .eg-review__status{font-weight:600;color:#a9c7f3}
    .eg-review.waiting{border-color:#528ce6}
    .eg-review__summary{color:#aab5c6;white-space:pre-wrap;overflow-wrap:anywhere}
    .eg-review__viewport{flex:1 1 0;min-height:100px;overflow:hidden;border:1px solid #2c3442;border-radius:6px;background:#0d1118}
    .eg-review__image{display:block;width:100%;height:100%;object-fit:contain}
    .eg-review__toolbar,.eg-review__pages{display:flex;align-items:center;gap:8px}
    .eg-review__toolbar{justify-content:space-between;flex-shrink:0}
    .eg-review [hidden]{display:none}
    .eg-review__open{margin-left:auto;color:#aecbfa;text-decoration:none}
    .eg-review__open:hover{text-decoration:underline}
    .eg-review__buttons{display:flex;gap:8px;margin-top:auto;flex-shrink:0}
    .eg-review button{min-height:28px;border:1px solid #42516a;border-radius:6px;background:#202b3e;color:#dce6f5;cursor:pointer}
    .eg-review__buttons button{flex:1;min-height:32px}
    .eg-review__pages button{width:30px}
    .eg-review__buttons button.primary{background:#28569a;border-color:#4685d4;color:white}
    .eg-review button:disabled{opacity:.45;cursor:default}
  `;
  document.head.appendChild(style);
}

function syncImageOutput(node) {
  const output = node.outputs?.[0];
  if (!node.graph || !output) return false;
  const link = node.getInputLink?.(0);
  const source = link && node.graph.getNodeById?.(link.origin_id)?.outputs?.[link.origin_slot];
  const type = source?.type || link?.type;
  const isImage = type === "IMAGE" || !!(link && type === "*" && node._eagleReviewView?.images.length);
  const outputType = isImage ? "IMAGE" : "*";
  if (output.type !== outputType) {
    if (node.setOutputDataType) node.setOutputDataType(0, outputType);
    else output.type = outputType;
    node.setDirtyCanvas?.(true, true);
  }
  return isImage;
}

function installSaveShortcut() {
  const canvas = app.canvas;
  const connector = canvas?.linkConnector;
  if (!connector?.events || shortcutConnectors.has(connector)) return;
  shortcutConnectors.add(connector);
  // The two canvas modes share this event before the default link menu opens.
  connector.events.addEventListener("dropped-on-canvas", (event) => {
    const [drag] = connector.renderLinks;
    const pointer = event.detail;
    const node = drag?.node;
    if (connector.renderLinks.length !== 1 || drag?.toType !== "input" || drag.fromReroute ||
        node?.type !== "EagleReviewGate" || node.graph !== canvas.graph ||
        drag.fromSlotIndex !== 0 || pointer?.shiftKey ||
        !Number.isFinite(pointer?.canvasX) || !Number.isFinite(pointer?.canvasY) || !syncImageOutput(node)) return;

    const saver = globalThis.LiteGraph?.createNode("SaveImage");
    const input = saver?.findInputSlot("images");
    if (!saver || input == null || input < 0) return;
    saver.pos = [pointer.canvasX, pointer.canvasY];
    const graph = node.graph;
    graph.add(saver);
    if (!node.connect(0, saver, input)) {
      graph.remove(saver);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    canvas.setDirty(true, true);
  }, { capture: true });
}

function drawPreview(view) {
  const item = view.images[view.imageIndex];
  let url = view.legacyPreview;
  if (item) {
    const query = new URLSearchParams({ filename: item.filename, type: "temp" });
    if (item.subfolder) query.set("subfolder", item.subfolder);
    url = api.apiURL("/view?" + query);
  }
  if (view.image.getAttribute?.("src") !== url) {
    if (url) view.image.src = url;
    else view.image.removeAttribute?.("src");
  }
  view.viewport.hidden = !url;
  view.toolbar.hidden = !url;
  view.pages.hidden = view.images.length < 2;
  view.page.textContent = `${view.imageIndex + 1} / ${view.images.length}`;
  view.previous.disabled = view.imageIndex <= 0;
  view.next.disabled = view.imageIndex + 1 >= view.images.length;
  view.open.href = url;
  view.open.textContent = item ? "查看原图" : "打开预览";
}

function tokenWidget(node) {
  return (node.widgets || []).find((widget) => widget.name === "确认令牌");
}

function hideTokenWidget(node) {
  const widget = tokenWidget(node);
  if (!widget) return;
  widget.type = "hidden";
  widget.options = Object.assign({}, widget.options || {}, {
    hidden: true, vueNode: "never", hideInPanel: true,
  });
  widget.hidden = true;
  widget.computeSize = () => [0, -4];
  widget.draw = () => {};
}

function showReview(node, payload) {
  const view = node._eagleReviewView;
  if (!view) return;
  const state = payload && payload.state;
  view.state = state;
  if (["upstream", "pending", "approved", "bypass", "expired", "empty"].includes(state)) {
    pauseReviewAutoQueue(app);
  }
  node._eagleReviewToken = state === "pending" ? String(payload.token || "") : "";
  const labels = {
    pending: "等待确认：后续节点已暂停",
    approved: "已确认：正在继续后续节点",
    bypass: "无需确认：已直接放行",
    expired: "确认已过期，请重新运行",
    empty: "没有输入内容，请检查连线",
    upstream: "上游执行中，等待本轮输入到达…",
    completed: "本轮执行完成，已结束",
    error: "本轮已停止",
  };
  view.status.textContent = labels[state] || "运行工作流后在这里确认";
  if (payload?.summary != null || !payload) {
    view.summary.textContent = payload?.summary || "";
    view.summary.hidden = !view.summary.textContent;
  }
  if (!payload || ["pending", "bypass", "empty"].includes(state)) {
    view.images = Array.isArray(payload?.images) ? payload.images.filter((item) => item?.filename) : [];
    view.legacyPreview = typeof payload?.preview === "string" ? payload.preview : "";
    view.imageIndex = 0;
    drawPreview(view);
    syncImageOutput(node);
  }
  view.root.classList.toggle("waiting", state === "pending");
  view.approve.disabled = !node._eagleReviewToken || view.busy;
}

function createReview(node) {
  if (node._eagleReviewView || typeof node.addDOMWidget !== "function") return;
  installStyle();
  const root = document.createElement("div");
  root.className = "eg-review";
  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  const status = document.createElement("div");
  status.className = "eg-review__status";
  status.ariaLive = "polite";
  const summary = document.createElement("div");
  summary.className = "eg-review__summary";
  const viewport = document.createElement("div");
  viewport.className = "eg-review__viewport";
  const image = document.createElement("img");
  image.className = "eg-review__image";
  image.alt = "图像预览";
  image.decoding = "async";
  viewport.append(image);
  const toolbar = document.createElement("div");
  toolbar.className = "eg-review__toolbar";
  const pages = document.createElement("div");
  pages.className = "eg-review__pages";
  const previous = document.createElement("button");
  previous.textContent = "‹";
  previous.ariaLabel = "上一张";
  const page = document.createElement("span");
  const next = document.createElement("button");
  next.textContent = "›";
  next.ariaLabel = "下一张";
  const open = document.createElement("a");
  open.className = "eg-review__open";
  open.target = "_blank";
  open.rel = "noopener";
  pages.append(previous, page, next);
  toolbar.append(pages, open);
  const buttons = document.createElement("div");
  buttons.className = "eg-review__buttons";
  const approve = document.createElement("button");
  approve.className = "primary";
  approve.textContent = "继续下游";
  approve.disabled = true;
  const regenerate = document.createElement("button");
  regenerate.textContent = "重新运行";
  buttons.append(approve, regenerate);
  root.append(status, summary, viewport, toolbar, buttons);
  const view = {
    root, status, summary, viewport, image, toolbar, pages, page, previous, next, open, approve, regenerate,
    images: [], imageIndex: 0, legacyPreview: "", busy: false,
  };
  node._eagleReviewView = view;
  node.addDOMWidget("eagle_review_gate", "div", root, {
    serialize: false, hideInPanel: true,
    getMinHeight: () => 180,
    getMaxHeight: () => 4096,
  });
  showReview(node, null);

  function moveImage(offset) {
    const index = view.imageIndex + offset;
    if (index < 0 || index >= view.images.length) return;
    view.imageIndex = index;
    drawPreview(view);
  }
  previous.addEventListener("click", () => moveImage(-1));
  next.addEventListener("click", () => moveImage(1));

  approve.addEventListener("click", async (event) => {
    event.stopPropagation();
    const token = node._eagleReviewToken;
    const widget = tokenWidget(node);
    if (!token || !widget || view.busy) return;
    if (app.processingQueue) {
      view.status.textContent = "正在提交其他任务，请稍后继续";
      return;
    }
    const outputIds = downstreamOutputIds(node);
    if (!outputIds.length) {
      view.status.textContent = "未找到下游保存或其他输出节点，请检查连线";
      return;
    }
    view.busy = true;
    approve.disabled = true;
    pauseReviewAutoQueue(app);
    widget.value = token;
    try {
      const accepted = await app.queuePrompt(0, 1, outputIds);
      if (!accepted) throw new Error("ComfyUI 未接受局部执行");
      // Submission finishes before backend execution. Consume the local
      // action now so another click cannot submit this same result again.
      if (node._eagleReviewToken === token) node._eagleReviewToken = "";
      if (!["completed", "upstream"].includes(view.state)) {
        view.status.textContent = "已提交确认，后续节点执行中…";
      }
    } catch (error) {
      view.status.textContent = "继续失败：" + (error.message || String(error));
    } finally {
      widget.value = "";
      view.busy = false;
      approve.disabled = !node._eagleReviewToken;
    }
  });

  regenerate.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (view.busy) return;
    if (app.processingQueue) {
      view.status.textContent = "正在提交其他任务，请稍后重新运行";
      return;
    }
    view.busy = true;
    approve.disabled = true;
    pauseReviewAutoQueue(app);
    showReview(node, { state: "upstream" });
    try {
      const accepted = await app.queuePrompt(0);
      if (!accepted) throw new Error("ComfyUI 未接受运行请求");
      view.status.textContent = "已提交重新运行，等待新结果…";
    } catch (error) {
      view.status.textContent = "重新运行失败：" + (error.message || String(error));
    } finally {
      view.busy = false;
      approve.disabled = !node._eagleReviewToken;
    }
  });
}

app.registerExtension({
  name: "EagleSuite.ReviewGate",
  setup() {
    installSaveShortcut();
    // An all-inactive prompt is a no-op; continuous mode must not repeatedly
    // submit that empty work while there is no active output to execute.
    api.addEventListener("executed", (event) => {
      if (event.detail?.output?.eagle_inactive_execution?.[0]) pauseReviewAutoQueue(app);
      reviewLoop.onExecuted(event.detail || {});
    });
    api.addEventListener("execution_success", (event) => { void reviewLoop.onSuccess(event.detail || {}); });
    api.addEventListener("execution_error", (event) => reviewLoop.onFailed(event.detail || {}));
    api.addEventListener("execution_interrupted", (event) => reviewLoop.onFailed(event.detail || {}));
    api.addEventListener("eagle_preview_waiting", (event) => {
      for (const id of event.detail?.node_ids || []) {
        const node = findReviewNode({ node: id });
        if (node) showReview(node, { state: "upstream" });
      }
    });
  },
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleReviewGate") return;
    const tokenDefinition = nodeData.input?.required?.["确认令牌"];
    if (Array.isArray(tokenDefinition)) {
      tokenDefinition[1] = Object.assign({}, tokenDefinition[1] || {}, {
        hidden: true, vueNode: "never", hideInPanel: true,
      });
    }
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      created?.apply(this, arguments);
      reviewNodes.add(this);
      installSaveShortcut();
      if (this._eagleReviewView) return;
      if (!this.size || this.size[0] < 390 || this.size[1] < 280) this.setSize([500, 460]);
      createReview(this);
      hideTokenWidget(this);
      setTimeout(() => hideTokenWidget(this), 0);
    };
    const connected = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (kind, index) {
      const result = connected?.apply(this, arguments);
      if (kind === 1 && index === 0) {
      showReview(this, null);
      }
      return result;
    };
    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = configured?.apply(this, arguments);
      if (["🦅 保存前确认", "保存前确认"].includes(this.title)) this.title = "🦅 预览确认";
      reviewLoop.forgetNode(this);
      showReview(this, null);
      // Pending values live only in the current backend process. Never reuse
      // a serialized approval token after opening a workflow.
      const widget = tokenWidget(this);
      if (widget) widget.value = "";
      hideTokenWidget(this);
      setTimeout(() => {
        const restoredWidget = tokenWidget(this);
        if (restoredWidget) restoredWidget.value = "";
        hideTokenWidget(this);
        syncImageOutput(this);
      }, 0);
      return result;
    };
    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (data) {
      const result = executed?.apply(this, arguments);
      if (Array.isArray(data?.eagle_review)) showReview(this, data.eagle_review[0]);
      return result;
    };
    const removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      reviewNodes.delete(this);
      reviewLoop.forgetNode(this);
      this._eagleReviewView = null;
      this._eagleReviewToken = "";
      return removed?.apply(this, arguments);
    };
  },
});
