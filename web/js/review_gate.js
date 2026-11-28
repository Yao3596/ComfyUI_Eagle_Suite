import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { downstreamOutputIds, pauseReviewAutoQueue, queueNodeTask, createReviewLoopController, withReviewApprovalScope } from "./review_gate_flow.js";
import "./node_scroll.js";

const STYLE_ID = "eagle-review-gate-style";
const IMAGE_TARGET_TYPES = new Set(["LoadImage", "EagleImageMaskEditor"]);
const reviewNodes = new Set();
const shortcutConnectors = new WeakSet();
const watchedImageGraphs = new WeakSet();

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
    .eg-review__heading,.eg-review__transfer{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
    .eg-review__heading{position:relative;flex-shrink:0}
    .eg-review__transfer{margin-left:auto;min-width:0}
    .eg-review__transfer button{padding:0 8px}
    .eg-review__target-picker{min-width:0;max-width:180px}
    .eg-review__target-picker summary{min-height:28px;padding:3px 8px;border:1px solid #42516a;border-radius:6px;background:#202b3e;cursor:pointer;list-style:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .eg-review__target-picker summary::-webkit-details-marker{display:none}
    .eg-review__target-picker summary::after{content:" ▾"}
    .eg-review__target-options{position:absolute;z-index:2;right:0;top:calc(100% + 4px);width:min(162px,100%);max-height:215px;overflow:auto;overscroll-behavior:contain;display:grid;gap:4px;padding:4px;border:1px solid #42516a;border-radius:6px;background:#141923}
    .eg-review .eg-review__target-option{display:flex;align-items:center;gap:8px;width:100%;padding:4px;text-align:left;border-color:transparent}
    .eg-review__target-option:hover,.eg-review__target-option[aria-pressed="true"]{border-color:#528ce6}
    .eg-review__target-thumb{display:block;flex:0 0 44px;width:44px;height:36px;background:#0d1118;border-radius:4px;overflow:hidden}
    .eg-review__target-thumb img{width:100%;height:100%;object-fit:contain}
    .eg-review__target-id{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .eg-review__transfer-feedback{color:#aab5c6;overflow-wrap:anywhere}
    .eg-review__transfer-feedback:empty{display:none}
    .eg-review__status{font-weight:600;color:#a9c7f3}
    .eg-review__history-label{color:#aab5c6}
    .eg-review.waiting{border-color:#528ce6}
    .eg-review__summary{color:#aab5c6;white-space:pre-wrap;overflow-wrap:anywhere}
    .eg-review__viewport{position:relative;flex:1 1 0;min-height:100px;overflow:hidden;border:1px solid #2c3442;border-radius:6px;background:#0d1118;--eg-review-split:0%}
    .eg-review__viewport.comparing{cursor:ew-resize;touch-action:pan-y}
    .eg-review__viewport:focus-within{outline:1px solid #528ce6}
    .eg-review__viewport.wiping::after{content:"";position:absolute;top:0;bottom:0;left:var(--eg-review-split);width:2px;transform:translateX(-50%);background:#fff;box-shadow:0 0 3px #000a;pointer-events:none}
    .eg-review__image{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:contain}
    .eg-review__reference{clip-path:inset(0 calc(100% - var(--eg-review-split)) 0 0);background:#0d1118}
    .eg-review__split{position:absolute;inset:0;margin:0;opacity:0;pointer-events:none}
    .eg-review__toolbar,.eg-review__pages{display:flex;align-items:center;gap:8px}
    .eg-review__toolbar{justify-content:space-between;flex-shrink:0;flex-wrap:wrap}
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
  const view = node._eagleReviewView;
  const lastResult = view?.candidate ?? view?.previousCandidate;
  const isImage = type === "IMAGE" || !!(link && type === "*" && lastResult?.images.length);
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

function previewImagePath(item) {
  const query = new URLSearchParams({ filename: item.filename, type: "temp" });
  if (item.subfolder) query.set("subfolder", item.subfolder);
  return "/view?" + query;
}

async function fetchOriginalImage(item) {
  const response = await api.fetchApi(previewImagePath(item), { timeoutMs: 120000 });
  if (response.status === 404) throw new Error("原图已过期，请重新运行预览");
  if (!response.ok) throw new Error(`读取原图失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (!blob.size) throw new Error("原图文件为空");
  return blob;
}

async function copyPreviewImage(view) {
  const candidate = shownCandidate(view);
  const item = candidate?.images[candidate.imageIndex];
  if (!item || view.copy.disabled) return;
  if (!navigator.clipboard?.write || typeof ClipboardItem !== "function") {
    view.transferFeedback.textContent = "浏览器未开放图像剪贴板，可在「查看原图」中复制。";
    return;
  }
  view.copy.disabled = true;
  view.transferFeedback.textContent = "正在复制原图…";
  try {
    const png = fetchOriginalImage(item).then((blob) => blob.slice(0, blob.size, "image/png"));
    // Start the clipboard write within the click, even if fetching PNG takes longer.
    await Promise.all([png, navigator.clipboard.write([new ClipboardItem({ "image/png": png })])]);
    view.transferFeedback.textContent = "已复制图像";
  } catch (error) {
    view.transferFeedback.textContent = error.name === "NotAllowedError"
      ? "剪贴板访问被拒绝，可在「查看原图」中复制。"
      : `复制失败：${error.message || String(error)}`;
  } finally {
    view.copy.disabled = false;
  }
}

function imageInputWidget(node) {
  if (!IMAGE_TARGET_TYPES.has(node.type) || node.inputs?.some((input) =>
    (input.widget?.name === "image" || ["image", "image_input"].includes(input.name)) && input.link != null)) return;
  return node.widgets?.find((widget) => widget.name === "image");
}

function imageTargetBusy(node) {
  const editor = node._eagleImageMaskEditor;
  return node.isUploading || editor?.busy || editor?.request || editor?.requestSubmitting ||
    editor?.surface?.stroke || editor?.surface?.dirtyLayers.size;
}

function imageTargetLabel(target) {
  return `${target.title || "加载图像"} (#${target.id})`;
}

function refreshImageTargets(node, view) {
  const targets = (node.graph?._nodes || []).filter(imageInputWidget);
  const chosen = targets.find(({ id }) => String(id) === view.targetId);
  if (!chosen) view.targetId = null;
  const selected = chosen || targets[0];
  const label = selected ? imageTargetLabel(selected) : "";
  const idText = selected ? `#${selected.id}` : "";
  view.targetPicker.hidden = targets.length < 2;
  if (view.targetPicker.hidden) view.targetPicker.open = false;
  // A focus refresh during pointerdown must preserve the summary's click target.
  if (view.targetSummary.textContent !== idText) view.targetSummary.textContent = idText;
  view.targetSummary.ariaLabel = label ? `选择发送目标，当前为${label}` : "选择发送目标";
  view.send.title = label ? `发送到${label}` : "当前画布没有可用的加载图像节点";
  return { targets, selected };
}

function renderImageTargets(node, view) {
  const { targets, selected } = refreshImageTargets(node, view);
  if (!view.targetPicker.open) return;
  view.targetOptions.replaceChildren(...targets.map((target) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "eg-review__target-option";
    option.ariaLabel = imageTargetLabel(target);
    option.ariaPressed = String(target === selected);

    const thumb = document.createElement("span");
    thumb.className = "eg-review__target-thumb";
    const filename = imageInputWidget(target)?.value;
    const hasFile = typeof filename === "string" && filename.length > 0;
    if (hasFile) {
      const query = new URLSearchParams({ filename });
      let path = "/eagle_review/input_thumbnail?";
      if (filename.startsWith("blake3:")) {
        path = "/view?";
        query.set("type", "input");
        query.set("preview", "webp;65");
      }
      const preview = document.createElement("img");
      preview.alt = "";
      preview.loading = "lazy";
      preview.decoding = "async";
      preview.addEventListener("error", () => { preview.hidden = true; });
      preview.src = api.apiURL(path + query);
      thumb.append(preview);
    }

    const id = document.createElement("span");
    id.className = "eg-review__target-id";
    id.textContent = `#${target.id}`;
    option.append(thumb, id);
    option.addEventListener("click", () => {
      view.targetId = String(target.id);
      view.targetPicker.open = false;
      refreshImageTargets(node, view);
      view.targetSummary.focus();
    });
    return option;
  }));
}

function watchImageTargets(graph) {
  if (!graph?.events?.addEventListener || watchedImageGraphs.has(graph)) return;
  watchedImageGraphs.add(graph);
  const update = (event) => {
    if (!IMAGE_TARGET_TYPES.has(event.detail?.node?.type)) return;
    for (const node of reviewNodes) {
      const view = node._eagleReviewView;
      if (node.graph !== graph || !view?.candidate?.images.length || viewingPrevious(view)) continue;
      if (view.targetPicker.open) renderImageTargets(node, view);
      else refreshImageTargets(node, view);
    }
  };
  graph.events.addEventListener("node:added", update);
  graph.events.addEventListener("node:removed", update);
}

function setImageSource(element, url) {
  if (element.getAttribute?.("src") !== url) {
    if (url) element.src = url;
    else element.removeAttribute?.("src");
  }
}

async function sendPreviewImage(node, view) {
  const candidate = view.candidate;
  const item = candidate?.images[candidate.imageIndex];
  if (!item || view.send.disabled || viewingPrevious(view)) return;
  const graph = node.graph;
  const { selected: target } = refreshImageTargets(node, view);
  if (!target) {
    view.transferFeedback.textContent = "当前画布没有可用的加载图像节点";
    return;
  }
  if (imageTargetBusy(target)) {
    view.transferFeedback.textContent = "目标节点正在上传或有未保存的编辑";
    return;
  }

  const widget = imageInputWidget(target);
  const previousValue = widget.value;
  view.send.disabled = true;
  view.transferFeedback.textContent = "正在传输原图…";
  try {
    const form = new FormData();
    form.append("image", await fetchOriginalImage(item), item.filename);
    form.append("type", "input");
    const uploaded = await api.fetchApi("/upload/image", { method: "POST", body: form, timeoutMs: 120000 });
    if (!uploaded.ok) throw new Error(`保存到输入目录失败（HTTP ${uploaded.status}）`);
    const { name, subfolder } = await uploaded.json();
    if (typeof name !== "string" || !name) throw new Error("ComfyUI 未返回文件名");

    if (node.graph !== graph || node._eagleReviewView !== view || graph.getNodeById(target.id) !== target ||
        imageInputWidget(target) !== widget || widget.value !== previousValue || imageTargetBusy(target)) {
      throw new Error("目标节点或图片已更改，请重新选择");
    }
    const path = subfolder ? `${subfolder}/${name}` : name;
    const values = widget.options?.values;
    graph.beforeChange?.();
    try {
      if (Array.isArray(values) && !values.includes(path)) values.push(path);
      widget.value = path;
      widget.callback?.(path);
      target.onWidgetChanged?.(widget.name, path, previousValue, widget);
    } finally {
      graph.afterChange?.();
    }
    target.setDirtyCanvas?.(true, true);
    view.transferFeedback.textContent = `已发送到${imageTargetLabel(target)}`;
  } catch (error) {
    view.transferFeedback.textContent = `传输失败：${error.message || String(error)}`;
  } finally {
    view.send.disabled = false;
  }
}

function viewingPrevious(view) {
  return !!view.previousCandidate && (view.showPrevious || !view.candidate);
}

function shownCandidate(view) {
  return viewingPrevious(view) ? view.previousCandidate : view.candidate;
}

function rememberCandidate(view) {
  if (view.candidate?.images.length || view.candidate?.legacyPreview) {
    view.previousCandidate = view.candidate;
  }
}

function updateApproveButton(node, view) {
  view.approve.disabled = !node._eagleReviewToken || view.busy || viewingPrevious(view);
}

function downloadWorkflow(candidate) {
  const item = candidate?.images[candidate.imageIndex];
  if (!item || !candidate.workflow) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(candidate.workflow, null, 2)], {
    type: "application/json",
  }));
  const download = document.createElement("a");
  download.download = `${item.filename.replace(/\.[^.]+$/, "")}.workflow.json`;
  download.href = url;
  document.body.append(download);
  download.click();
  download.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function comparisonArea(view) {
  const box = view.image.getBoundingClientRect();
  const imageWidth = (image) => image.naturalHeight
    ? Math.min(box.width, box.height * image.naturalWidth / image.naturalHeight)
    : 0;
  const width = Math.max(imageWidth(view.image), imageWidth(view.referenceImage)) || box.width;
  return { box, width, inset: (box.width - width) / 2 };
}

function setComparisonPosition(view, percent, area) {
  const betweenImages = percent > 0 && percent < 100;
  let clip = percent;
  if (betweenImages) {
    const { box, width, inset } = area ?? comparisonArea(view);
    if (box.width) clip = (inset + width * percent / 100) / box.width * 100;
  }
  if (percent) view.viewport.style.setProperty("--eg-review-split", `${clip}%`);
  view.viewport.classList.toggle("wiping", betweenImages);
  view.referenceImage.hidden = percent === 0;
}

function drawPreview(node, view) {
  const candidate = shownCandidate(view);
  const historical = viewingPrevious(view);
  const index = candidate?.imageIndex ?? 0;
  const count = candidate?.images.length ?? 0;
  const references = candidate?.referenceImages ?? [];
  const item = candidate?.images[index];
  const url = item ? api.apiURL(previewImagePath(item)) : candidate?.legacyPreview || "";
  const reference = references.length === 1 ? references[0] : references[index];
  const canCompare = !!(item && reference);
  setImageSource(view.image, url);
  setImageSource(view.referenceImage, canCompare ? api.apiURL(previewImagePath(reference)) : "");
  view.splitInput.hidden = !canCompare;
  view.splitInput.value = "50";
  view.viewport.classList.toggle("comparing", canCompare);
  setComparisonPosition(view, 0);
  view.historyLabel.hidden = !historical;
  view.historyToggle.hidden = !view.previousCandidate || !view.candidate;
  view.historyToggle.textContent = historical ? "本轮" : "上一轮";
  view.viewport.hidden = !url;
  view.toolbar.hidden = !url && view.historyToggle.hidden;
  view.pages.hidden = count < 2;
  view.page.textContent = `${index + 1} / ${count}`;
  view.previous.disabled = index <= 0;
  view.next.disabled = index + 1 >= count;
  view.open.hidden = !url;
  view.open.href = url;
  view.open.textContent = item ? "查看原图" : "打开预览";
  view.workflowDownload.hidden = !item || !candidate?.workflow;
  view.summary.textContent = view.errorSummary || candidate?.summary || "";
  view.summary.hidden = !view.summary.textContent;
  view.transfer.hidden = !item;
  view.send.hidden = historical;
  view.transferFeedback.textContent = "";
  if (item && !historical) {
    watchImageTargets(node.graph);
    refreshImageTargets(node, view);
  } else {
    view.targetPicker.open = false;
    view.targetPicker.hidden = true;
  }
  updateApproveButton(node, view);
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
  view.errorSummary = state === "error" ? payload.summary || "" : "";
  if (!payload) {
    view.candidate = view.previousCandidate = null;
    view.showPrevious = false;
  } else if (state === "upstream") {
    rememberCandidate(view);
    view.candidate = null;
    view.showPrevious = false;
  } else if (["pending", "bypass", "empty"].includes(state)) {
    rememberCandidate(view);
    view.candidate = {
      images: Array.isArray(payload.images) ? payload.images.filter((item) => item?.filename) : [],
      referenceImages: Array.isArray(payload.reference_images)
        ? payload.reference_images.filter((item) => item?.filename) : [],
      imageIndex: 0,
      legacyPreview: typeof payload.preview === "string" ? payload.preview : "",
      summary: payload.summary || "",
      workflow: payload.workflow && typeof payload.workflow === "object" && !Array.isArray(payload.workflow)
        ? payload.workflow : null,
    };
  }
  drawPreview(node, view);
  if (!payload || ["pending", "bypass", "empty"].includes(state)) syncImageOutput(node);
  view.root.classList.toggle("waiting", state === "pending");
}

function createPreviewImage(imageAlt) {
  const image = document.createElement("img");
  image.className = "eg-review__image";
  image.alt = imageAlt;
  image.decoding = "async";
  return image;
}

function createReview(node) {
  if (node._eagleReviewView || typeof node.addDOMWidget !== "function") return;
  installStyle();
  const root = document.createElement("div");
  root.className = "eg-review";
  const status = document.createElement("div");
  status.className = "eg-review__status";
  status.ariaLive = "polite";
  const historyLabel = document.createElement("span");
  historyLabel.className = "eg-review__history-label";
  historyLabel.textContent = "上轮预览";
  const heading = document.createElement("div");
  heading.className = "eg-review__heading";
  const transfer = document.createElement("div");
  transfer.className = "eg-review__transfer";
  const targetPicker = document.createElement("details");
  targetPicker.className = "eg-review__target-picker";
  const targetSummary = document.createElement("summary");
  targetSummary.title = "选择发送目标图像节点";
  const targetOptions = document.createElement("div");
  targetOptions.className = "eg-review__target-options";
  targetPicker.append(targetSummary, targetOptions);
  const send = document.createElement("button");
  send.type = "button";
  send.textContent = "发送到加载图像";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "复制图像";
  transfer.append(targetPicker, send, copy);
  heading.append(status, historyLabel, transfer);
  const transferFeedback = document.createElement("div");
  transferFeedback.className = "eg-review__transfer-feedback";
  transferFeedback.ariaLive = "polite";
  const summary = document.createElement("div");
  summary.className = "eg-review__summary";
  const viewport = document.createElement("div");
  viewport.className = "eg-review__viewport";
  const image = createPreviewImage("最终图像");
  const referenceImage = createPreviewImage("对比图像");
  referenceImage.className += " eg-review__reference";
  const splitInput = document.createElement("input");
  splitInput.className = "eg-review__split";
  splitInput.type = "range";
  splitInput.value = "50";
  splitInput.ariaLabel = "对比位置";
  viewport.append(image, referenceImage, splitInput);
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
  const historyToggle = document.createElement("button");
  historyToggle.type = "button";
  const workflowDownload = document.createElement("button");
  workflowDownload.type = "button";
  workflowDownload.textContent = "下载工作流 JSON";
  const open = document.createElement("a");
  open.className = "eg-review__open";
  open.target = "_blank";
  open.rel = "noopener";
  pages.append(previous, page, next);
  toolbar.append(pages, historyToggle, workflowDownload, open);
  const buttons = document.createElement("div");
  buttons.className = "eg-review__buttons";
  const approve = document.createElement("button");
  approve.className = "primary";
  approve.textContent = "继续下游";
  approve.disabled = true;
  const regenerate = document.createElement("button");
  regenerate.textContent = "重新运行";
  buttons.append(approve, regenerate);
  root.append(heading, transferFeedback, summary, viewport, toolbar, buttons);
  const view = {
    root, status, summary, viewport, image, toolbar, pages, page, previous, next, open, approve, regenerate,
    transfer, targetPicker, targetSummary, targetOptions, send, copy, transferFeedback,
    referenceImage, splitInput, historyLabel, historyToggle, workflowDownload,
    candidate: null, previousCandidate: null, showPrevious: false, targetId: null,
    errorSummary: "", busy: false,
  };
  node._eagleReviewView = view;
  node.addDOMWidget("eagle_review_gate", "div", root, {
    serialize: false, hideInPanel: true,
    getMinHeight: () => 180,
    getMaxHeight: () => 4096,
  });
  showReview(node, null);

  function moveImage(offset) {
    const candidate = shownCandidate(view);
    if (!candidate) return;
    const index = candidate.imageIndex + offset;
    if (index < 0 || index >= candidate.images.length) return;
    candidate.imageIndex = index;
    drawPreview(node, view);
  }
  previous.addEventListener("click", () => moveImage(-1));
  next.addEventListener("click", () => moveImage(1));
  historyToggle.addEventListener("click", () => {
    view.showPrevious = !view.showPrevious;
    drawPreview(node, view);
  });
  workflowDownload.addEventListener("click", () => downloadWorkflow(shownCandidate(view)));
  function moveSplit(event) {
    if (splitInput.hidden) return;
    const area = comparisonArea(view);
    if (!area.width) return;
    const fraction = (event.clientX - area.box.left - area.inset) / area.width;
    const percent = Math.max(0, Math.min(100, fraction * 100));
    splitInput.value = String(percent);
    setComparisonPosition(view, percent, area);
  }
  function resetPointerSplit() {
    if (!splitInput.matches(":focus-visible")) setComparisonPosition(view, 0);
  }
  for (const event of ["pointerenter", "pointermove", "pointerdown"]) viewport.addEventListener(event, moveSplit);
  viewport.addEventListener("pointerleave", resetPointerSplit);
  viewport.addEventListener("pointercancel", resetPointerSplit);
  viewport.addEventListener("pointerup", (event) => {
    if (event.pointerType === "touch") resetPointerSplit();
  });
  const keyboardSplit = () => setComparisonPosition(view, Number(splitInput.value));
  splitInput.addEventListener("focus", keyboardSplit);
  splitInput.addEventListener("input", keyboardSplit);
  splitInput.addEventListener("blur", () => setComparisonPosition(view, 0));
  const updateTargets = () => {
    if (!viewingPrevious(view)) refreshImageTargets(node, view);
  };
  send.addEventListener("pointerenter", updateTargets);
  transfer.addEventListener("focusin", updateTargets);
  root.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (!targetPicker.contains(event.target)) targetPicker.open = false;
  });
  targetPicker.addEventListener("toggle", () => {
    if (targetPicker.open) renderImageTargets(node, view);
    else targetOptions.replaceChildren();
  });
  targetPicker.addEventListener("focusout", (event) => {
    if (!targetPicker.contains(event.relatedTarget)) targetPicker.open = false;
  });
  targetPicker.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !targetPicker.open) return;
    event.stopPropagation();
    targetPicker.open = false;
    targetSummary.focus();
  });
  send.addEventListener("click", (event) => {
    event.stopPropagation();
    void sendPreviewImage(node, view);
  });
  copy.addEventListener("click", (event) => {
    event.stopPropagation();
    void copyPreviewImage(view);
  });

  approve.addEventListener("click", async (event) => {
    event.stopPropagation();
    const token = node._eagleReviewToken;
    const widget = tokenWidget(node);
    if (!token || !widget || view.busy || viewingPrevious(view)) return;
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
      const accepted = await withReviewApprovalScope(node, outputIds, () => app.queuePrompt(0, 1, outputIds));
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
      updateApproveButton(node, view);
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
      updateApproveButton(node, view);
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
      } else if (kind === 1 && this.inputs?.[index]?.name === "对比图像") {
        const view = this._eagleReviewView;
        if (view?.candidate) {
          view.candidate.referenceImages = [];
          drawPreview(this, view);
        }
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
