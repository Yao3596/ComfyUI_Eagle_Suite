import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { ImageEditorSurface } from "./image_mask_canvas.js";
import { frameGeometry, orientedPoint, orientedSize, outputSize, renderMaskPreview, sampleImageColor, sourcePoint } from "./image_mask_preview.js";
import { createWorkspaceDialog } from "./image_mask_workspace.js";
import { createUpscaleDialog, readUpscaleSettings, upscaleOutputSize } from "./image_mask_upscale.js";
import { reviewApprovalUsesInput, withWorkflowInputScope } from "./review_gate_flow.js";
import "./node_scroll.js";

const NODE_TYPE = "EagleImageMaskEditor";
const LAYER_FOLDER = "eagle_image_editor";
const STYLE_ID = "eagle-image-mask-editor-style";
const SIZE_WIDGETS = ["尺寸模式", "最长边", "百万像素", "对齐倍数"];
const HIDDEN_WIDGETS = ["edit_layers", "legacy_resize", "editor_request", "sam_prompt", "sam_auto", "editor_adjustments"];
const ASSET_DROP = "application/x-comfy-asset-info";
const URI_TYPES = ["text/uri-list", "text/x-moz-url"];
const IMAGE_EXT = /\.(?:png|jpe?g|webp|bmp|gif|tiff?|avif|ico|apng)$/i;
const PNG_SOURCE = /\.a?png(?: \[(?:input|output|temp)\])?$/i;
const DEFAULT_MASK_COLOR = "#ef486f";
const DEFAULT_BRUSH_COLOR = "#57a7ff";
const DEFAULT_POINT_SIZE = 22;
const DEFAULT_ADJUSTMENTS = {
  grow: false, expand: 16, feather: 0, ratio: "original", framing: "crop",
  zoom: 1, x: 0.5, y: 0.5, fill: "#ffffff", mask_fill: true,
  rotation: 0, flip_x: false, flip_y: false,
};
const EDITOR_LINKS = ["image_input", "sam_model", "clip", "sam_text"];
const editorViews = new WeakMap();
let maskFilterId = 0;
let activeWorkspaceView = null;

const TOOL_PATHS = {
  mask: "M4 5h16v14H4z M12 8a4 4 0 1 0 0 8Z",
  paint: "M3 17l9 4 9-4M3 12l9 4 9-4M3 7l9-4 9 4-9 4Z",
  brush: "M12 14 21 5l-2-2-9 9m2 2c-5-3-6 0-7 3l-2 2c4 2 10 1 9-5Z",
  erase: "m4 14 10-10a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3l-9 9H8l-4-4a1.5 1.5 0 0 1 0-2Zm4-4 7 7m-3 3h9",
  pan: "M12 4v16M4 12h16M9 7l3-3 3 3m-6 10 3 3 3-3M7 9l-3 3 3 3m10-6 3 3-3 3",
  sam: "M9 4H4v5m11-5h5v5M9 20H4v-5m11 5h5v-5M12 7v10m-5-5h10",
  pick: "m13 6 5 5m-6-4-8 8v2l-1 3 3-1h2l8-8m-1-6 2-2a2 2 0 0 1 3 3l-2 2",
  frame: "M6 3v15h15M3 6h15v15M5 19l14-14",
  fill: "M5 10l6-6 8 8-6 6a2 2 0 0 1-3 0l-5-5a2 2 0 0 1 0-3ZM6 12h13m-9-8L8 2m12 14c-3 4-2 5 0 5s3-1 0-5Z",
  invert: "M5 5h14v14H5zM5 19 19 5M8 8h2m4 8h2",
  clear: "M4 6h16M9 6V3h6v3M6 6l1 14h10l1-14M10 10v6m4-6v6",
  undo: "m8 5-5 5 5 5m-5-5h12a4 4 0 1 1 0 8h-3",
  redo: "m16 5 5 5-5 5m5-5H9a4 4 0 1 0 0 8h3",
  out: "M15.5 15.5 21 21M6 10h8M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z",
  in: "M15.5 15.5 21 21M6 10h8m-4-4v8M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z",
  fit: "M9 4H4v5m11-5h5v5M9 20H4v-5m11 5h5v-5M8 8h8v8H8z",
  save: "M5 3h11l4 4v14H4V3Zm3 0v6h8V3m1 18v-7H7v7",
  close: "m6 6 12 12M18 6 6 18",
  flipX: "M12 3v18M9 6 3 12l6 6Zm6 0 6 6-6 6Z",
  flipY: "M3 12h18M6 9l6-6 6 6Zm0 6 6 6 6-6Z",
  rotateLeft: "M4 4v5h5M4 9a8 8 0 1 1 2.5 9m2.5-9h6v6H9z",
  rotateRight: "M20 4v5h-5m5 0a8 8 0 1 0-2.5 9M9 9h6v6H9z",
  upscale: "M13 3h8v8m0-8-8 8M10 5H5v14h14v-5M8 15l3-3 3 3m-3-3v6",
};

function migrateEditorWidgets(info) {
  const named = info?.widgets_values_named;
  const values = info?.widgets_values;
  const alignments = ["关闭", "居中裁剪", "居中扩展"];
  if (!Object.hasOwn(named ?? {}, "倍数对齐") && !alignments.includes(values?.[6])) return info;
  const old = (name, index, fallback) => named?.[name] ?? values?.[index] ?? fallback;
  const mode = old("尺寸模式", 1, "限制长边");
  const alignment = old("倍数对齐", 6, "关闭");
  const retiredMode = mode === "等比例缩放" || mode === "指定尺寸";
  const legacy = retiredMode || alignment !== "关闭" ? JSON.stringify({
    mode, alignment,
    percent: old("缩放百分比", 3, 100), width: old("输出宽度", 4, 0), height: old("输出高度", 5, 0),
  }) : "";
  const current = {
    image: old("image", 0, ""),
    "尺寸模式": retiredMode ? "原图" : mode,
    "最长边": old("最长边", 2, 2048),
    "百万像素": 1,
    "对齐倍数": old("对齐倍数", 7, 8),
    edit_layers: old("edit_layers", 8, ""),
    legacy_resize: legacy,
  };
  return { ...info, widgets_values: Object.values(current), widgets_values_named: current };
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .eime-root{box-sizing:border-box;display:flex;flex-direction:column;gap:7px;width:100%;height:100%;min-width:0;min-height:0;contain:size;container-type:inline-size;overflow:auto;overscroll-behavior:contain;padding:8px;border:1px solid #394457;border-radius:8px;background:#141923;color:#dce6f5;font:12px/1.5 system-ui,sans-serif}
    .eime-root *{box-sizing:border-box}
    .eime-root [hidden]{display:none!important}
    .eime-panel{display:flex;flex:1;flex-direction:column;gap:7px;min-width:0;min-height:0}
    .eime-bar{display:flex;flex-wrap:wrap;align-items:center;gap:5px 7px;flex-shrink:0}
    .eime-tools,.eime-tool-group{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;min-height:0}
    .eime-tools{overflow:auto;overscroll-behavior:contain;padding:4px 1px;scrollbar-width:thin;border:1px solid #303b4e;border-radius:6px;background:#191f2a}
    .eime-tool-group{padding:0 0 4px;flex-shrink:0}
    .eime-tool-group+.eime-tool-group{border-top:1px solid #303b4e;padding-top:5px}
    .eime-tools button.eime-icon{display:grid;place-items:center;width:29px;min-height:29px;padding:0;flex-shrink:0}
    .eime-icon svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
    .eime-workspace{display:grid;grid-template-columns:39px minmax(0,1fr) 137px;flex:1 0 220px;min-width:0;min-height:0;gap:7px}
    .eime-properties{display:flex;flex-direction:column;align-items:stretch;gap:7px;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;padding:7px;border:1px solid #303b4e;border-radius:6px;background:#191f2a}
    .eime-properties fieldset{display:grid;gap:5px;min-width:0;margin:0;padding:0;border:0}
    .eime-options{display:grid;gap:5px;min-width:0}
    .eime-properties legend{padding:0 0 5px;color:#a9c7f3;font-weight:600}
    .eime-properties label.eime-range{display:grid;grid-template-columns:minmax(0,1fr) auto;row-gap:0;color:#cedaed}
    .eime-range output{grid-column:2;grid-row:1;color:#aab9cf;font-variant-numeric:tabular-nums}
    .eime-root button{padding:4px 8px;min-height:27px;border:1px solid #44536b;border-radius:5px;background:#212b3c;color:inherit;cursor:pointer}
    .eime-root button:hover:enabled{border-color:#87addf}
    .eime-root button[aria-pressed="true"],.eime-root .eime-apply{border-color:#4b8cdc;background:#275591;color:#fff}
    .eime-root button:disabled{opacity:.42;cursor:default}
    .eime-root label{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
    .eime-root input[type="range"]{grid-column:1/-1;width:100%;min-width:0;accent-color:#7eb6f9;margin:0}
    .eime-root input[type="color"]{width:28px;height:26px;padding:1px;border:1px solid #44536b;border-radius:4px;background:#212b3c}
    .eime-root input[type="number"]{min-width:0;width:100%;padding:3px;border:1px solid #44536b;border-radius:4px;background:#10151d;color:inherit}
    .eime-properties select,.eime-properties textarea{width:100%;min-width:0;padding:4px;border:1px solid #44536b;border-radius:4px;background:#10151d;color:inherit;font:inherit}
    .eime-properties textarea{min-height:55px;resize:vertical}
    .eime-properties textarea:read-only{color:#aab9cf}
    .eime-dialog__host .eime-workspace{grid-template-columns:39px minmax(0,1fr) minmax(190px,17%);flex-basis:0}
    .eime-dialog__host .eime-properties{grid-column:auto}
    .eime-properties .eime-inline-label{justify-content:space-between}
    .eime-properties .eime-pick-target{padding:2px 4px;min-height:21px}
    .eime-sample{display:inline-flex;align-items:center;gap:5px;color:#dce6f5;font-variant-numeric:tabular-nums}
    .eime-swatch{width:16px;height:16px;border-radius:3px;border:1px solid #657587}
    .eime-help{color:#aab9cf;line-height:1.35}
    .eime-dimensions{margin-left:auto;color:#aab9cf}
    .eime-stage{min-width:0;min-height:120px;position:relative;overflow:hidden;isolation:isolate;border:1px solid #303b4e;border-radius:6px;background:#0d1118;outline-offset:-2px}
    .eime-stage.eime-drop-target{border-color:#7eb6f9;box-shadow:inset 0 0 0 1px #7eb6f9}
    .eime-stage:focus-visible{outline:1px solid #70a6e9}
    .eime-stage.eime-editing{touch-action:none;cursor:crosshair}
    .eime-stage.eime-pan{cursor:grab}
    .eime-stage.eime-pan:active{cursor:grabbing}
    .eime-stage.eime-segment{cursor:crosshair}
    .eime-stage.eime-framing{cursor:grab}
    .eime-stage.eime-framing:active{cursor:grabbing}
    .eime-frame{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);overflow:hidden;outline:1px solid #7c8da5;pointer-events:none}
    .eime-picture{position:absolute;left:50%;top:50%;width:100%;height:100%;transform:translate(-50%,-50%);pointer-events:none;user-select:none}
    .eime-planes{position:absolute;left:50%;top:50%;transform-origin:center}
    .eime-planes img,.eime-planes canvas{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:fill}
    .eime-picture .eime-still{object-fit:fill}
    .eime-mask-image,.eime-mask-canvas,.eime-effect-mask{opacity:var(--eime-mask-opacity,.48);filter:var(--eime-mask-filter,none)}
    .eime-picking :is(.eime-mask-image,.eime-mask-canvas,.eime-effect-mask){opacity:min(var(--eime-mask-opacity,.48),.30)}
    .eime-picking.eime-pick-original .eime-paint-image,.eime-picking.eime-pick-original .eime-paint-canvas{opacity:.24}
    .eime-defs{position:absolute;width:0;height:0;overflow:hidden;pointer-events:none}
    .eime-points{position:absolute;inset:0;pointer-events:none}
    .eime-point{position:absolute;display:grid;place-items:center;box-sizing:border-box;transform:translate(-50%,-50%);width:var(--eime-point-size);height:var(--eime-point-size);border:1px solid #fff;border-radius:50%;background:#157447;color:white;box-shadow:0 0 0 1px #15251b;font-size:calc(var(--eime-point-size)*.68);line-height:1;font-weight:700}
    .eime-point.negative{background:#a83443}
    .eime-cursor{position:absolute;z-index:1;transform:translate(-50%,-50%);border:1px solid white;border-radius:50%;box-shadow:0 0 0 1px #222b;pointer-events:none}
    .eime-cursor.eime-square{border-radius:0}
    .eime-empty{position:absolute;inset:0;display:grid;place-items:center;margin:0;padding:12px;color:#aab9cf;text-align:center;pointer-events:none}
    .eime-status{margin:0;color:#a9c7f3;overflow-wrap:anywhere}
    .eime-status:empty{display:none}
    @container (max-width:370px){
      .eime-workspace{grid-template-columns:39px minmax(0,1fr);grid-template-rows:minmax(150px,1fr) auto;flex-basis:365px}
      .eime-properties{grid-column:1 / -1}
      .eime-properties{display:grid;grid-template-columns:1fr 1fr}
    }
  `;
  document.head.append(style);
}

function previewUrl(value) {
  const annotation = / \[(input|temp|output)\]$/.exec(value);
  const path = (annotation ? value.slice(0, annotation.index) : value).replaceAll("\\", "/");
  const slash = path.lastIndexOf("/");
  const query = new URLSearchParams({ filename: path.slice(slash + 1), type: annotation?.[1] || "input" });
  if (slash > 0) query.set("subfolder", path.slice(0, slash));
  return api.apiURL("/view?" + query);
}

function resultImagePath(item) {
  if (typeof item?.filename !== "string" || !item.filename || item.type !== "temp") return "";
  const path = item.subfolder ? `${item.subfolder}/${item.filename}` : item.filename;
  return `${path} [temp]`;
}

function layerPaths(raw, source) {
  try {
    const record = JSON.parse(raw);
    if (record?.source !== source) return {};
    return Object.fromEntries(["mask", "paint"].filter((layer) =>
      typeof record[layer] === "string" && record[layer].startsWith(`${LAYER_FOLDER}/`)
    ).map((layer) => [layer, record[layer]]));
  } catch {
    return {};
  }
}

function setImage(element, path) {
  if (path) {
    const url = previewUrl(path);
    if (element.getAttribute("src") !== url) element.src = url;
  } else {
    element.removeAttribute("src");
  }
}

async function uploadImage(blob, filename, subfolder = "") {
  const form = new FormData();
  form.append("image", blob, filename);
  form.append("type", "input");
  if (subfolder) form.append("subfolder", subfolder);
  const response = await api.fetchApi("/upload/image", { method: "POST", body: form, timeoutMs: 120000 });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  if (!result.name || (subfolder && result.subfolder !== subfolder)) throw new Error("上传路径无效");
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法编码图层")), "image/png");
  });
}

function setWidget(node, widget, value) {
  const previous = widget.value;
  const graph = node.graph;
  graph?.beforeChange?.();
  try {
    const values = widget.options?.values;
    if (Array.isArray(values) && !values.includes(value)) values.push(value);
    widget.value = value;
    widget.callback?.(value);
    node.onWidgetChanged?.(widget.name, value, previous, widget);
  } finally {
    graph?.afterChange?.();
  }
  node.setDirtyCanvas?.(true, true);
}

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function button(label, action, title, icon) {
  const element = document.createElement("button");
  element.type = "button";
  if (icon) {
    element.className = "eime-icon";
    element.ariaLabel = label;
    const svg = svgElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
    svg.append(svgElement("path", { d: TOOL_PATHS[icon] }));
    element.append(svg);
    element.title = title ? `${label} · ${title}` : label;
  } else {
    element.textContent = label;
    if (title) element.title = title;
  }
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    action();
  });
  return element;
}

function element(tag, className) {
  const result = document.createElement(tag);
  result.className = className;
  return result;
}

function range(label, min, max, value) {
  const row = element("label", "eime-range");
  const input = document.createElement("input");
  const number = document.createElement("output");
  input.type = "range";
  input.min = min;
  input.max = max;
  input.value = value;
  input.ariaLabel = label;
  const update = () => { number.textContent = input.value; };
  input.addEventListener("input", update);
  update();
  row.append(label, input, number);
  return { row, input, set(value) { input.value = value; update(); } };
}

function pressed(buttonElement, state) {
  buttonElement.ariaPressed = String(state);
}

function connected(view, name) {
  return view.node.inputs?.some((input) => input.name === name && input.link != null);
}

function linkSignature(view) {
  return JSON.stringify(EDITOR_LINKS.map((name) => view.node.inputs?.find((port) => port.name === name)?.link ?? null));
}

function locked(view) {
  return view.busy || view.requestSubmitting || !!view.request;
}

function readSamOptions(value) {
  const { mode, threshold, refine_iterations: refine, source, points } = value ?? {};
  return {
    mode: mode === "points" || mode === "text" ? mode : null,
    threshold: Number.isFinite(threshold) && threshold >= 0 && threshold <= 1 ? threshold : 0.5,
    refine_iterations: Number.isInteger(refine) && refine >= 0 && refine <= 5 ? refine : 2,
    source: typeof source === "string" ? source : "",
    points: typeof source === "string" && source && Array.isArray(points) ? points.filter((point) =>
      Array.isArray(point) && point.length === 3 && point.slice(0, 2).every((value) =>
        Number.isFinite(value) && value >= 0 && value <= 1) && [0, 1].includes(point[2])).slice(0, 64) : [],
  };
}

function readAdjustments(value) {
  let saved;
  try { saved = JSON.parse(value || "{}"); } catch { saved = {}; }
  const values = Object.fromEntries(Object.entries(DEFAULT_ADJUSTMENTS)
    .map(([name, fallback]) => [name, typeof saved?.[name] === typeof fallback ? saved[name] : fallback]));
  if (![0, 90, 180, 270].includes(values.rotation)) values.rotation = 0;
  values.sam = readSamOptions(saved?.sam);
  values.upscale = readUpscaleSettings(saved?.upscale);
  return values;
}

function persistAdjustments(view) {
  if (view.adjustmentsWidget) view.adjustmentsWidget.value = JSON.stringify(view.adjustments);
}

function setAdjustments(view, changes) {
  Object.assign(view.adjustments, changes);
  persistAdjustments(view);
  view.refreshAdjustments();
  transformPicture(view);
  queueMaskPreview(view);
}

function syncSamText(view) {
  const link = view.node.inputs?.find((port) => port.name === "sam_text")?.link ?? null;
  if (link !== view.samTextLink) {
    view.samTextLink = link;
    view.linkedSamText = null;
  }
  const wired = link !== null;
  view.samText.readOnly = wired;
  view.samText.placeholder = wired ? "读取或执行后显示接线文本" : "例：jacket, headphones";
  const text = wired ? view.linkedSamText ?? "" : String(view.promptWidget?.value || "");
  if (view.samText.value !== text) view.samText.value = text;
}

function samInputsReady(view) {
  if (!connected(view, "sam_model")) return false;
  if (view.samMode.value === "text") {
    return connected(view, "clip") && (connected(view, "sam_text") || view.samText.value.trim());
  }
  return view.points.some((point) => point[2]);
}

function automaticMaskReady(view) {
  const image = view.automaticMask;
  return view.ready && !!view.automaticPath && samInputsReady(view) &&
    image.complete && image.naturalWidth === view.base.naturalWidth && image.naturalHeight === view.base.naturalHeight;
}

function setAutomaticMask(view, path = "") {
  if (view.automaticPath === path) return;
  view.automaticPath = path;
  view.effectVisible = false;
  setImage(view.automaticMask, path);
}

function showMaskLayers(view) {
  const visible = view.showMask.checked;
  const effect = visible && view.effectVisible && !view.pointer;
  const automatic = visible && automaticMaskReady(view);
  view.effectMask.hidden = !effect;
  view.automaticMask.hidden = !automatic || effect;
  view.canvases.mask.hidden = !visible || !view.surface || effect || automatic;
  view.saved.mask.hidden = !visible || !!view.surface || !view.paths.mask || effect || automatic;
}

function queueMaskPreview(view) {
  const { grow, expand, feather } = view.adjustments;
  if (!view.ready || !view.showMask.checked || !(grow && expand > 0 || feather > 0)) {
    if (view.effectsFrame) cancelAnimationFrame(view.effectsFrame);
    view.effectsFrame = 0;
    view.effectVisible = false;
    showMaskLayers(view);
    return;
  }
  if (view.effectsFrame || view.pointer) return;
  view.effectsFrame = requestAnimationFrame(() => {
    view.effectsFrame = 0;
    if (!view.ready || view.pointer) return;
    const saved = view.paths.mask && view.saved.mask.complete && view.saved.mask.naturalWidth ? view.saved.mask : null;
    const source = automaticMaskReady(view) ? view.automaticMask : view.surface ? view.canvases.mask : saved;
    view.effectVisible = renderMaskPreview(source, view.effectMask,
      view.base.naturalWidth, view.base.naturalHeight, view.adjustments);
    showMaskLayers(view);
  });
}

function selectEditorTool(view, tool) {
  view.tool = tool;
  transformPicture(view);
  updateControls(view);
}

function sampleColor(view, position) {
  const paint = view.pickSource.value === "paint"
    ? (view.surface ? view.canvases.paint : view.paths.paint && view.saved.paint.complete && view.saved.paint.naturalWidth ? view.saved.paint : null)
    : null;
  const color = sampleImageColor(view.base, paint, position.x, position.y, view.whiteBackground);
  view.sample.hidden = !color;
  if (color) {
    view.sampleSwatch.style.backgroundColor = color;
    view.sampleValue.textContent = color.toUpperCase();
  }
  return color;
}

function pickColor(view, position) {
  const color = sampleColor(view, position);
  if (!color) return;
  const target = ({ brush: view.color, mask: view.maskColor, fill: view.fillColor })[view.pickTarget.value];
  target.value = color;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  view.status.textContent = `已吸取 ${color.toUpperCase()}`;
}

function updateControls(view) {
  const editing = !!view.surface;
  const busy = locked(view);
  const linked = connected(view, "image_input");
  const segmenting = view.tool === "sam";
  const textMode = view.samMode.value === "text";
  const picking = view.tool === "pick";
  view.upload.disabled = busy;
  view.upscaleButton.disabled = busy;
  view.upscaleButton.classList.toggle("eime-apply", view.adjustments.upscale.enabled);
  view.reset.disabled = !view.ready || busy;
  view.fetchLinked.hidden = !linked;
  view.fetchLinked.disabled = busy || !view.requestWidget;
  view.openWorkspace.hidden = !!view.workspace?.active;
  view.runWorkspace.hidden = !view.workspace?.active;
  view.runWorkspace.disabled = busy || view.runningGraph;
  view.cancelWait.hidden = !view.request;
  view.cancelWait.disabled = view.requestSubmitting;
  view.tools.inert = busy;
  view.stage.classList.toggle("eime-editing", view.ready);
  const pan = view.space || view.tool === "pan";
  view.stage.classList.toggle("eime-pan", view.ready && pan);
  view.stage.classList.toggle("eime-segment", view.ready && segmenting && !pan);
  view.stage.classList.toggle("eime-framing", view.ready && view.tool === "frame");
  view.panel.classList.toggle("eime-picking", picking);
  view.panel.classList.toggle("eime-pick-original", picking && view.pickSource.value === "base");
  if (pan || segmenting || picking || view.tool === "frame" || !view.ready || busy) view.cursor.hidden = true;
  for (const control of view.imageActions) control.disabled = !view.ready || busy;
  for (const fieldset of view.properties.children) fieldset.disabled = !view.ready || busy;
  view.samSettings.hidden = !segmenting && !connected(view, "sam_model") && !connected(view, "sam_text");
  view.frameSettings.hidden = view.tool !== "frame";
  view.pickSettings.hidden = !picking;
  syncSamText(view);
  const hasModel = connected(view, "sam_model");
  const hasClip = connected(view, "clip");
  const wiredText = connected(view, "sam_text");
  view.samTextRows.hidden = !textMode;
  view.pointRows.hidden = textMode;
  view.fetchSamText.hidden = !wiredText;
  view.fetchSamText.disabled = busy || !view.requestWidget;
  const pointHint = "Alt + 点击添加排除点，双击提示点移除";
  view.samHint.textContent = textMode
    ? (hasClip ? "多个目标可用逗号或换行分隔" : "文本模式需要 SAM3 的 CLIP")
    : (hasModel ? pointHint : `连接 SAM 模型后可分割。${pointHint}`);
  view.samRun.disabled = !view.requestWidget || !view.ready || busy || !samInputsReady(view);
  view.clearPoints.disabled = !view.points.length;
  view.pointsOverlay.hidden = !segmenting || textMode || !view.ready;
  view.undo.disabled = !view.surface?.undoStack.length;
  view.redo.disabled = !view.surface?.redoStack.length;
  view.save.disabled = !view.surface?.dirtyLayers.size;
  view.exit.hidden = !editing;
  view.exit.ariaLabel = view.exit.title = view.surface?.dirtyLayers.size ? "放弃编辑" : "退出编辑";
  view.recover.hidden = !view.failedLayers.length;
  view.recover.disabled = view.busy;
  pressed(view.maskLayer, view.layer === "mask");
  pressed(view.paintLayer, view.layer === "paint");
  for (const [tool, control] of Object.entries(view.toolButtons)) pressed(control, view.tool === tool);
  for (const [shape, control] of Object.entries(view.shapeButtons)) pressed(control, view.shape === shape);
  view.cursor.classList.toggle("eime-square", view.shape === "square");
  view.colorLabel.hidden = view.layer === "mask";
  view.canvases.paint.hidden = !editing;
  view.base.hidden = editing;
  view.still.hidden = !editing;
  view.saved.paint.hidden = editing || !view.paths.paint;
  showMaskLayers(view);
  queueMaskPreview(view);
}

function showDimensions(view, width, height) {
  const widgetValue = (name) => view.node.widgets?.find((widget) => widget.name === name)?.value;
  try {
    const base = outputSize(width, height, {
      mode: widgetValue("尺寸模式"), longestEdge: widgetValue("最长边"), megapixels: widgetValue("百万像素"),
      multiple: widgetValue("对齐倍数"), legacyResize: widgetValue("legacy_resize"),
    });
    const result = upscaleOutputSize(base.width, base.height, view.adjustments.upscale);
    const actual = `输出 ${result.width} × ${result.height}`;
    view.dimensions.textContent = width === result.width && height === result.height
      ? actual : `画幅 ${width} × ${height} · ${actual}`;
  } catch (error) {
    view.dimensions.textContent = `画幅 ${width} × ${height}`;
    view.dimensions.title = error.message;
    return;
  }
  view.dimensions.title = view.adjustments.upscale.enabled
    ? "尺寸已计入缩放、像素对齐和模型放大" : "尺寸已计入缩放设置和像素对齐";
}

function transformPicture(view) {
  const composing = view.tool === "frame";
  const framed = view.adjustments.ratio !== "original" || view.adjustments.zoom !== 1;
  const [width, height] = orientedSize(view.base.naturalWidth, view.base.naturalHeight, view.adjustments.rotation);
  if (view.ready && (composing || framed)) {
    let geometry;
    try { geometry = frameGeometry(width, height, view.adjustments); }
    catch (error) { view.frameNote.textContent = error.message; }
    if (geometry) {
      const { width, height, drawWidth, drawHeight, left, top } = geometry;
      const fit = Math.min(view.stage.clientWidth / width, view.stage.clientHeight / height);
      const scale = fit * (composing ? 1 : view.zoom);
      if (view.picture.parentNode !== view.frame) view.frame.append(view.picture);
      view.frame.hidden = false;
      view.frame.style.width = `${width * scale}px`;
      view.frame.style.height = `${height * scale}px`;
      view.frame.style.backgroundColor = view.adjustments.fill;
      view.frame.style.transform = composing
        ? "translate(-50%,-50%)"
        : `translate(-50%,-50%) translate(${view.panX}px,${view.panY}px)`;
      sizePicture(view, drawWidth * scale, drawHeight * scale);
      view.picture.style.left = `${left * scale}px`;
      view.picture.style.top = `${top * scale}px`;
      view.picture.style.transform = "none";
      view.frameNote.textContent = `画幅 ${width} × ${height} · 拖动画面调整位置`;
      showDimensions(view, width, height);
      return;
    }
  }
  if (view.picture.parentNode !== view.stage) view.stage.insertBefore(view.picture, view.frame);
  view.frame.hidden = true;
  view.picture.style.removeProperty("left");
  view.picture.style.removeProperty("top");
  if (!view.ready) return;
  showDimensions(view, width, height);
  const scale = Math.min(view.stage.clientWidth / width, view.stage.clientHeight / height) * view.zoom;
  sizePicture(view, width * scale, height * scale);
  view.picture.style.transform = `translate(-50%,-50%) translate(${view.panX}px,${view.panY}px)`;
}

function sizePicture(view, width, height) {
  const { rotation, flip_x: flipX, flip_y: flipY } = view.adjustments;
  const [rawWidth, rawHeight] = orientedSize(width, height, rotation);
  view.picture.style.width = `${width}px`;
  view.picture.style.height = `${height}px`;
  view.planes.style.width = `${rawWidth}px`;
  view.planes.style.height = `${rawHeight}px`;
  view.planes.style.transform = `translate(-50%,-50%) scale(${flipX ? -1 : 1},${flipY ? -1 : 1}) rotate(${rotation}deg)`;
}

function fitPicture(view) {
  view.zoom = 1;
  view.panX = view.panY = 0;
  transformPicture(view);
}

function zoomPicture(view, ratio, anchor) {
  const zoom = Math.min(12, Math.max(0.25, view.zoom * ratio));
  if (anchor && zoom !== view.zoom) {
    const picture = (view.frame.hidden ? view.picture : view.frame).getBoundingClientRect();
    const scale = view.stage.getBoundingClientRect().width / view.stage.offsetWidth || 1;
    const shift = (1 - zoom / view.zoom) / scale;
    view.panX += (anchor.x - (picture.left + picture.width / 2)) * shift;
    view.panY += (anchor.y - (picture.top + picture.height / 2)) * shift;
  }
  view.zoom = zoom;
  transformPicture(view);
}

function zoomEditor(view, ratio, anchor) {
  if (view.tool !== "frame" || view.frame.hidden) {
    withSurface(view, (surface) => {
      if (surface) zoomPicture(view, ratio, anchor);
    });
    return;
  }
  const zoom = Math.round(Math.max(0.25, Math.min(4, view.adjustments.zoom * ratio)) * 100) / 100;
  if (zoom === view.adjustments.zoom) return;
  const rect = view.frame.getBoundingClientRect();
  const [width, height] = orientedSize(view.base.naturalWidth, view.base.naturalHeight, view.adjustments.rotation);
  const previous = frameGeometry(width, height, view.adjustments);
  let next;
  try { next = frameGeometry(width, height, { ...view.adjustments, zoom }); }
  catch (error) {
    view.frameNote.textContent = error.message;
    return;
  }
  const x = anchor && rect.width ? (anchor.x - rect.left) / rect.width * next.width : next.width / 2;
  const y = anchor && rect.height ? (anchor.y - rect.top) / rect.height * next.height : next.height / 2;
  const offset = (focus, edge, oldLength, newLength, free, current) =>
    free ? Math.max(0, Math.min(1, (focus - (focus - edge) * newLength / oldLength) / free)) : current;
  setAdjustments(view, {
    zoom,
    x: offset(x, previous.left, previous.drawWidth, next.drawWidth, next.width - next.drawWidth, view.adjustments.x),
    y: offset(y, previous.top, previous.drawHeight, next.drawHeight, next.height - next.drawHeight, view.adjustments.y),
  });
}

function closeEditing(view) {
  if (view.effectsFrame) cancelAnimationFrame(view.effectsFrame);
  view.effectsFrame = 0;
  view.effectVisible = false;
  if (view.surface) view.surface.dispose();
  else for (const canvas of Object.values(view.canvases)) canvas.width = canvas.height = 0;
  view.still.width = view.still.height = 0;
  view.surface = null;
  view.pointer = null;
  view.space = false;
  transformPicture(view);
  updateControls(view);
}

function showSourceImage(view) {
  if (!view.filename || !view.base.complete) return;
  const { naturalWidth: width, naturalHeight: height } = view.base;
  view.ready = width > 0;
  view.picture.hidden = !view.ready;
  view.empty.hidden = view.ready;
  view.empty.textContent = view.ready ? "" : "无法预览所选图像";
  if (!view.ready) view.dimensions.textContent = "";
  transformPicture(view);
  updateControls(view);
}

function markFailedLayer(view, name) {
  if (!view.failedLayers.includes(name)) view.failedLayers.push(name);
  view.status.textContent = "部分已保存的图层缺失或尺寸有误";
  updateControls(view);
}

function syncSource(view) {
  const link = view.node.inputs?.find((input) => input.name === "image_input")?.link ?? null;
  if (link !== view.imageLink) {
    view.imageLink = link;
    view.linked = null;
  }
  const linked = link != null;
  const filename = linked ? view.linked?.source || "" : String(view.sourceWidget.value || "");
  const path = linked ? view.linked?.path || "" : filename;
  const raw = String(view.layersWidget.value || "");
  if (filename === view.filename && path === view.sourcePath && raw === view.layerValue) {
    updateControls(view);
    return;
  }
  if (filename !== view.filename && (view.surface?.dirtyLayers.size || view.pointer || view.saving)) {
    if (!linked && !view.filename?.startsWith("linked:")) view.sourceWidget.value = view.filename;
    view.status.textContent = "请先保存或放弃当前编辑，再切换图像";
    view.node.setDirtyCanvas?.(true, true);
    updateControls(view);
    return;
  }
  view.version++;
  if (filename !== view.filename || path !== view.sourcePath) setAutomaticMask(view);
  if (filename !== view.filename) {
    view.status.textContent = "";
    restoreSamPoints(view, filename);
  }
  view.filename = filename;
  view.sourcePath = path;
  view.whiteBackground = !linked && PNG_SOURCE.test(filename) ? "#ffffff" : "";
  view.planes.style.backgroundColor = view.whiteBackground;
  view.layerValue = raw;
  view.paths = layerPaths(raw, filename);
  view.failedLayers = [];
  view.ready = false;
  closeEditing(view);
  view.empty.hidden = false;
  view.empty.textContent = path ? "正在加载图像…" :
    linked ? "点击上方按钮读取连线图像" : "拖入图像，或选中节点后按 Ctrl+V";
  view.dimensions.textContent = "";
  view.picture.hidden = true;
  setImage(view.base, path);
  for (const [name, image] of Object.entries(view.saved)) setImage(image, view.paths[name]);
  showSourceImage(view);
}

function loadFile(view, asset) {
  if (!asset) return;
  if (locked(view) || view.importing || view.pointer) {
    view.fileInput.value = "";
    view.status.textContent = "正在处理图像，请稍后再试";
    return;
  }
  view.importing = (async () => {
    if (view.surface?.dirtyLayers.size) await saveEdits(view);
    view.busy = true;
    view.status.textContent = "正在导入图像…";
    const version = view.version;
    updateControls(view);
    const file = asset instanceof File ? asset : await fetchDroppedImage(asset);
    const path = await uploadImage(file, file.name || "pasted-image.png");
    if (view.version === version) {
      setWidget(view.node, view.sourceWidget, path);
      syncSource(view);
      view.status.textContent = connected(view, "image_input") ? "图片已导入。断开图像输入即可切换到本地图。" : "";
    }
  })().catch((error) => {
    view.status.textContent = `导入失败：${error.message}`;
  }).finally(() => {
    view.importing = null;
    view.busy = false;
    view.fileInput.value = "";
    updateControls(view);
  });
}

async function startEditing(view) {
  if (!view.ready || view.busy || view.surface) return;
  const version = view.version;
  view.busy = true;
  view.status.textContent = "";
  view.failedLayers = [];
  updateControls(view);
  try {
    const savedLayers = {};
    for (const [name, image] of Object.entries(view.saved)) {
      if (!view.paths[name]) continue;
      try {
        if (!image.complete) await image.decode();
        if (image.naturalWidth !== view.base.naturalWidth || image.naturalHeight !== view.base.naturalHeight) {
          throw new Error("尺寸不一致");
        }
      } catch {
        if (view.version !== version) return;
        markFailedLayer(view, name);
        continue;
      }
      if (view.version !== version) return;
      savedLayers[name] = image;
    }
    if (view.failedLayers.length) return;
    // Canvas draws the default frame of an animated image. Use the same frame
    // for the visible editing background and the mask prepared by the surface.
    const { naturalWidth: width, naturalHeight: height } = view.base;
    const scale = Math.min(1, 4096 / Math.max(width, height));
    view.still.width = Math.max(1, Math.round(width * scale));
    view.still.height = Math.max(1, Math.round(height * scale));
    view.still.getContext("2d").drawImage(view.base, 0, 0, view.still.width, view.still.height);
    view.surface = new ImageEditorSurface(view.canvases, view.base, savedLayers);
    fitPicture(view);
  } catch (error) {
    view.status.textContent = `打开编辑失败：${error.message}`;
    closeEditing(view);
  } finally {
    view.busy = false;
    updateControls(view);
  }
}

function withSurface(view, action) {
  if (view.surface) {
    action(view.surface);
    return;
  }
  view.activation = startEditing(view).then(() => action(view.surface)).finally(() => {
    view.activation = null;
  });
}

function removeFailedLayers(view) {
  const paths = { ...view.paths };
  for (const name of view.failedLayers) delete paths[name];
  const value = Object.keys(paths).length ? JSON.stringify({ ...paths, source: view.filename }) : "";
  setWidget(view.node, view.layersWidget, value);
  syncSource(view);
  view.status.textContent = "已移除失效图层";
}

function saveEdits(view) {
  if (view.saving) return view.saving;
  if (view.activation) return view.activation.then(() => saveEdits(view));
  const { surface, version, filename } = view;
  if (view.pointer) {
    const { id } = view.pointer;
    view.pointer = null;
    surface?.endStroke();
    if (view.stage.hasPointerCapture(id)) view.stage.releasePointerCapture(id);
  }
  if (!surface?.dirtyLayers.size) return Promise.resolve(view.layersWidget.value);
  view.busy = true;
  view.status.textContent = "正在保存图层…";
  updateControls(view);
  view.saving = (async () => {
    try {
      const revision = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const saved = await Promise.all([...surface.dirtyLayers].map(async (name) => [
        name, await uploadImage(await canvasBlob(view.canvases[name]), `${name}-${revision}.png`, LAYER_FOLDER),
      ]));
      if (view.version !== version || view.filename !== filename) {
        throw new Error("源图已切换，请再次运行工作流");
      }
      view.paths = { ...view.paths, ...Object.fromEntries(saved) };
      const value = JSON.stringify({ ...view.paths, source: filename });
      view.layerValue = value;
      // Publishing the invisible file references must not submit another run.
      view.layersWidget.value = value;
      surface.dirtyLayers.clear();
      for (const [name, image] of Object.entries(view.saved)) setImage(image, view.paths[name]);
      view.status.textContent = "已保存编辑";
      return value;
    } catch (error) {
      view.status.textContent = `保存失败：${error.message}`;
      throw error;
    } finally {
      view.busy = false;
      view.saving = null;
      if ((view.linked && view.filename !== view.linked.source) ||
          (view.filename.startsWith("linked:") && !connected(view, "image_input"))) syncSource(view);
      updateControls(view);
    }
  })();
  return view.saving;
}

function renderPoints(view) {
  view.pointsOverlay.replaceChildren(...view.points.map(([x, y, label]) => {
    const [horizontal, vertical] = orientedPoint(x, y, view.adjustments);
    const marker = element("span", `eime-point${label ? "" : " negative"}`);
    marker.textContent = label ? "+" : "−";
    marker.style.left = `${horizontal * 100}%`;
    marker.style.top = `${vertical * 100}%`;
    return marker;
  }));
}

function restoreSamPoints(view, source) {
  const saved = view.adjustments.sam;
  view.points = saved.source === source ? saved.points : [];
  renderPoints(view);
}

function setSamOptions(view, changes) {
  Object.assign(view.adjustments.sam, changes);
  persistAdjustments(view);
  setAutomaticMask(view);
}

function changeOrientation(view, surface, control) {
  const { rotation, flip_x, flip_y } = view.adjustments;
  const previous = { rotation, flip_x, flip_y };
  // Turning the composed image also turns the existing mirror axes.
  const next = typeof control === "number"
    ? { rotation: (rotation + control + 360) % 360, flip_x: flip_y, flip_y: flip_x }
    : { [control]: !previous[control] };
  const apply = (changes) => {
    setAdjustments(view, changes);
    renderPoints(view);
  };
  surface.recordChange(() => apply(previous), () => apply(next));
  apply(next);
  view.stage.focus({ preventScroll: true });
}

function changePoints(view, next) {
  const previous = view.points;
  const apply = (points) => {
    view.points = points;
    setSamOptions(view, {
      mode: view.adjustments.sam.mode ?? "points",
      points, source: points.length ? view.filename : "",
    });
    renderPoints(view);
  };
  view.surface.recordChange(() => apply(previous), () => apply(next));
  apply(next);
  updateControls(view);
}

function pointIndexAt(view, event) {
  let closest = -1;
  let best = Infinity;
  for (const [index, marker] of Array.from(view.pointsOverlay.children).entries()) {
    const rect = marker.getBoundingClientRect();
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    const distance = Math.hypot(dx, dy);
    if (distance <= Math.max(8, rect.width / 2 + 3) && distance <= best) {
      closest = index;
      best = distance;
    }
  }
  return closest;
}

function resetEditor(view, surface) {
  const size = view.node.widgets?.filter((widget) => [...SIZE_WIDGETS, "legacy_resize"].includes(widget.name)) || [];
  const originalSizes = { "尺寸模式": "原图", "最长边": 2048, "百万像素": 1, "对齐倍数": 8, legacy_resize: "" };
  const changes = size.map((widget) => [widget, originalSizes[widget.name]]);
  for (const [widget, value] of [[view.adjustmentsWidget, ""], [view.promptWidget, ""], [view.autoWidget, false]]) {
    if (widget) changes.push([widget, value]);
  }
  const previousWidgets = changes.map(([widget]) => [widget, widget.value]);
  const previous = {
    points: view.points, tool: view.tool, layer: view.layer, shape: view.shape,
    zoom: view.zoom, panX: view.panX, panY: view.panY, showMask: view.showMask.checked,
    brushSize: view.size.input.value, hardness: view.hardness.input.value, flow: view.flow.input.value,
    brushColor: view.color.value, maskColor: view.node.properties?.eagleMaskColor,
    samMode: view.node.properties?.eagleSamMode, pointSize: view.node.properties?.eagleSamPointSize,
    displayedSamMode: view.samMode.value,
    opacity: view.maskOpacity.input.value, polarity: view.pointPolarity.value,
  };
  const original = {
    points: [], tool: "brush", layer: "mask", shape: "round", zoom: 1, panX: 0, panY: 0,
    showMask: true, brushSize: 52, hardness: 85, flow: 100, brushColor: DEFAULT_BRUSH_COLOR,
    maskColor: undefined, samMode: "points", pointSize: undefined, displayedSamMode: "points", opacity: 48, polarity: "1",
  };
  const apply = (values, state) => {
    for (const [widget, value] of values) widget.value = value;
    const properties = view.node.properties ||= {};
    for (const [name, value] of [
      ["eagleMaskColor", state.maskColor], ["eagleSamMode", state.samMode], ["eagleSamPointSize", state.pointSize],
    ]) {
      if (value === undefined) delete properties[name];
      else properties[name] = value;
    }
    view.restoreSettings();
    view.restoreMaskColor();
    const { points, tool, layer, shape, zoom, panX, panY } = state;
    Object.assign(view, { points, tool, layer, shape, zoom, panX, panY });
    renderPoints(view);
    view.samMode.value = state.displayedSamMode;
    view.pointPolarity.value = state.polarity;
    view.showMask.checked = state.showMask;
    view.size.set(state.brushSize);
    view.hardness.set(state.hardness);
    view.flow.set(state.flow);
    view.color.value = state.brushColor;
    view.maskOpacity.set(state.opacity);
    view.panel.style.setProperty("--eime-mask-opacity", Number(state.opacity) / 100);
    transformPicture(view);
    view.node.setDirtyCanvas?.(true, true);
  };
  const restored = surface.resetToSource(view.base, () => {
    apply(previousWidgets, previous);
    view.status.textContent = "";
  }, () => {
    apply(changes, original);
    view.status.textContent = "已还原原图，可撤销";
  });
  if (!restored) view.status.textContent = "当前图层超过还原操作的撤销容量";
  view.stage.focus({ preventScroll: true });
}

function finishEditorRequest(view, request) {
  if (!request || view.request !== request) return;
  clearTimeout(request.timeout);
  view.request = null;
  updateControls(view);
}

async function submitEditorRequest(view, action) {
  if (locked(view) || view.importing || view.pointer || !view.requestWidget) return;
  if (action === "segment" && view.samRun.disabled) return;
  const data = {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    action, mode: view.samMode.value, source: view.filename,
    ...(view.samMode.value === "points" ? { points: view.points.map((point) => [...point]) } : {}),
  };
  const request = { ...data, links: linkSignature(view) };
  view.request = request;
  view.requestSubmitting = true;
  view.status.textContent = action === "segment" ? "正在生成 SAM 遮罩…" : "正在读取连线输入…";
  updateControls(view);
  let queued = false;
  const acknowledge = () => { queued = true; };
  try {
    if (action === "preview") await saveEdits(view);
    if (!view.node.graph || view.request !== request) return;
    if (app.processingQueue) throw new Error("正在提交其他任务，请稍后重试");
    view.requestWidget.value = JSON.stringify(data);
    const targets = [String(view.node.id)];
    api.addEventListener("promptQueued", acknowledge);
    const accepted = await withWorkflowInputScope(view.node.graph, targets, () => app.queuePrompt(0, 1, targets));
    // Some installed extensions await the native call and discard its return.
    // The native acknowledgement fires only after a successful submission.
    if (!queued && accepted !== true) throw new Error("ComfyUI 未接受编辑器请求");
    if (view.request === request) {
      request.timeout = setTimeout(() => {
        view.status.textContent = "等待编辑器结果超时，可再次尝试";
        finishEditorRequest(view, request);
      }, 240000);
    }
  } catch (error) {
    if (view.request === request) view.status.textContent = error.message;
    finishEditorRequest(view, request);
  } finally {
    api.removeEventListener("promptQueued", acknowledge);
    view.requestWidget.value = "";
    view.requestSubmitting = false;
    updateControls(view);
  }
}

async function receiveEditorResult(view, payload) {
  const request = view.request;
  const matches = !!payload.request_id && payload.request_id === request?.id;
  if (payload.request_id && !matches) return;
  if (matches && request.links !== linkSignature(view)) {
    finishEditorRequest(view, request);
    view.status.textContent = "连线已变更，请重新读取或生成";
    return;
  }
  try {
    const path = resultImagePath(payload.image);
    if (path && typeof payload.source === "string" && connected(view, "image_input")) {
      syncSource(view);
      view.linked = { source: payload.source, path };
      syncSource(view);
    }
    syncSamText(view);
    if (connected(view, "sam_text") && typeof payload.sam_text === "string") {
      view.linkedSamText = payload.sam_text;
      syncSamText(view);
    }
    if (!payload.request_id && payload.source === view.filename &&
        (!payload.sam_mode || payload.sam_mode === view.samMode.value)) {
      setAutomaticMask(view, resultImagePath(payload.automatic_mask));
      updateControls(view);
    }
    if (payload.error) {
      view.status.textContent = payload.error;
      return;
    }
    if (matches && request.action === "preview") view.status.textContent = "";
    const mask = resultImagePath(payload.mask);
    if (!matches || !mask || view.filename !== request.source || payload.source !== request.source) return;
    const image = new Image();
    setImage(image, mask);
    await image.decode();
    if (view.request !== request || view.filename !== request.source) return;
    await startEditing(view);
    if (view.request !== request || view.filename !== request.source || !view.surface) return;
    setAutomaticMask(view);
    view.surface.replaceMask(image);
    view.layer = "mask";
    view.showMask.checked = true;
    view.status.textContent = "SAM 遮罩已应用，可继续编辑或撤销";
  } catch (error) {
    view.status.textContent = `应用遮罩失败：${error.message}`;
  } finally {
    if (matches) finishEditorRequest(view, request);
  }
}

function installPainting(view) {
  const { stage, picture, base, cursor } = view;
  const imageBounds = () => picture.getBoundingClientRect();
  function point(clientX, clientY, rect = imageBounds()) {
    const { naturalWidth: width, naturalHeight: height } = base;
    const [x, y] = sourcePoint((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height, view.adjustments);
    const bound = Number(view.size.input.value);
    return {
      x: Math.max(-bound, Math.min(width + bound, x * width)),
      y: Math.max(-bound, Math.min(height + bound, y * height)),
    };
  }
  function inside({ x, y }) {
    return x >= 0 && y >= 0 && x < base.naturalWidth && y < base.naturalHeight;
  }
  function inFrame(event) {
    if (view.frame.hidden) return true;
    const bounds = view.frame.getBoundingClientRect();
    return event.clientX >= bounds.left && event.clientX <= bounds.right &&
      event.clientY >= bounds.top && event.clientY <= bounds.bottom;
  }
  function showCursor(event) {
    if (locked(view) || !view.ready || view.space || ["pan", "sam", "pick", "frame"].includes(view.tool) || view.pointer?.pan ||
        event.pointerType === "touch") {
      cursor.hidden = true;
      return;
    }
    const bounds = imageBounds();
    if (!inFrame(event) || !inside(point(event.clientX, event.clientY, bounds))) {
      cursor.hidden = true;
      return;
    }
    const rect = stage.getBoundingClientRect();
    const scale = rect.width / stage.offsetWidth || 1;
    const [width] = orientedSize(base.naturalWidth, base.naturalHeight, view.adjustments.rotation);
    const size = Number(view.size.input.value) * bounds.width / (width * scale);
    cursor.style.left = `${(event.clientX - rect.left) / scale - stage.clientLeft}px`;
    cursor.style.top = `${(event.clientY - rect.top) / scale - stage.clientTop}px`;
    cursor.style.width = cursor.style.height = `${Math.max(3, size)}px`;
    cursor.hidden = false;
  }
  function finishStroke(pointer) {
    view.pointer = null;
    view.surface?.endStroke();
    if (stage.hasPointerCapture(pointer.id)) stage.releasePointerCapture(pointer.id);
    updateControls(view);
  }
  stage.addEventListener("pointerdown", (event) => {
    if (locked(view) || !view.ready || view.pointer || ![0, 1].includes(event.button)) return;
    const pan = view.space || view.tool === "pan" || event.button === 1;
    const location = point(event.clientX, event.clientY);
    const framing = view.tool === "frame" && !view.frame.hidden;
    if (!framing && !pan && (!inFrame(event) || !inside(location))) return;
    event.preventDefault();
    event.stopPropagation();
    stage.focus({ preventScroll: true });
    if (framing) {
      const [width, height] = orientedSize(base.naturalWidth, base.naturalHeight, view.adjustments.rotation);
      const geometry = frameGeometry(width, height, view.adjustments);
      stage.setPointerCapture(event.pointerId);
      view.pointer = { id: event.pointerId, frame: true, x: event.clientX, y: event.clientY,
        panX: view.adjustments.x, panY: view.adjustments.y,
        sizeX: (geometry.width - geometry.drawWidth) * view.frame.getBoundingClientRect().width / geometry.width,
        sizeY: (geometry.height - geometry.drawHeight) * view.frame.getBoundingClientRect().height / geometry.height,
      };
      return;
    }
    if (!pan && view.tool === "pick") {
      pickColor(view, location);
      return;
    }
    if (!pan && view.tool === "sam") {
      if (view.samMode.value !== "points") return;
      if (!event.altKey && pointIndexAt(view, event) >= 0) return;
      if (view.points.length >= 64) {
        view.status.textContent = "最多添加 64 个提示点";
        return;
      }
      const label = event.altKey ? 0 : Number(view.pointPolarity.value);
      withSurface(view, (surface) => {
        if (!surface) return;
        changePoints(view, [...view.points, [location.x / surface.width, location.y / surface.height, label]]);
      });
      return;
    }
    stage.setPointerCapture(event.pointerId);
    const settings = {
      size: Number(view.size.input.value), hardness: Number(view.hardness.input.value) / 100,
      flow: Number(view.flow.input.value) / 100, shape: view.shape, color: view.color.value, erase: view.tool === "erase",
    };
    const pointer = { id: event.pointerId, pan, x: event.clientX, y: event.clientY, points: [], starting: true };
    view.pointer = pointer;
    if (!pan && view.layer === "mask") setAutomaticMask(view);
    showMaskLayers(view);
    withSurface(view, (surface) => {
      if (view.pointer !== pointer) return;
      pointer.starting = false;
      if (!surface) {
        finishStroke(pointer);
        return;
      }
      if (pointer.pan) {
        for (const [x, y] of pointer.points) movePan(pointer, x, y);
      } else {
        const rect = imageBounds();
        surface.beginStroke(view.layer, settings, point(pointer.x, pointer.y, rect));
        for (const [x, y] of pointer.points) surface.moveStroke(point(x, y, rect));
      }
      pointer.points = null;
      if (pointer.ended) finishStroke(pointer);
      else showCursor(event);
    });
  });
  stage.addEventListener("dblclick", (event) => {
    if (event.button !== 0 || locked(view) || view.pointer || view.pointsOverlay.hidden || !inFrame(event)) return;
    const index = pointIndexAt(view, event);
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    withSurface(view, (surface) => {
      if (surface) changePoints(view, view.points.filter((_, position) => position !== index));
    });
    stage.focus({ preventScroll: true });
  });
  function movePan(pointer, x, y) {
    const scale = stage.getBoundingClientRect().width / stage.offsetWidth || 1;
    view.panX += (x - pointer.x) / scale;
    view.panY += (y - pointer.y) / scale;
    pointer.x = x;
    pointer.y = y;
    transformPicture(view);
  }
  stage.addEventListener("pointermove", (event) => {
    const pointer = view.pointer;
    showCursor(event);
    if (!pointer && view.tool === "pick" && view.ready && !locked(view)) {
      if (inFrame(event)) sampleColor(view, point(event.clientX, event.clientY));
      else view.sample.hidden = true;
    }
    if (pointer?.id !== event.pointerId || pointer.ended) return;
    const { clientX, clientY } = event;
    if (pointer.frame) {
      const position = (start, distance, length) => length ? Math.max(0, Math.min(1, start + distance / length)) : start;
      setAdjustments(view, {
        x: position(pointer.panX, clientX - pointer.x, pointer.sizeX),
        y: position(pointer.panY, clientY - pointer.y, pointer.sizeY),
      });
      return;
    }
    if (pointer.starting) {
      pointer.points[Math.min(pointer.points.length, 255)] = [clientX, clientY];
      return;
    }
    if (pointer.pan) {
      movePan(pointer, clientX, clientY);
    } else {
      view.surface.moveStroke(point(clientX, clientY));
    }
  });
  stage.addEventListener("pointerleave", () => { cursor.hidden = true; });
  const finish = (event) => {
    const pointer = view.pointer;
    if (pointer?.id !== event.pointerId || pointer.ended) return;
    if (pointer.starting && event.type === "pointerup") {
      pointer.ended = true;
      return;
    }
    finishStroke(pointer);
  };
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) stage.addEventListener(type, finish);
  view.onShortcut = (event) => {
    if (!view.ready || locked(view) || view.pointer) return;
    const key = event.key.toLowerCase();
    const modified = event.ctrlKey || event.metaKey;
    if (modified && (key === "z" || key === "y")) {
      if (key === "y" || event.shiftKey) view.surface?.redo();
      else view.surface?.undo();
    } else if (!modified && key === " ") view.space = true;
    else if (!modified && ["b", "e", "h", "i", "c"].includes(key)) {
      selectEditorTool(view, { b: "brush", e: "erase", h: "pan", i: "pick", c: "frame" }[key]);
    }
    else if (!modified && (key === "[" || key === "]")) {
      if (key === "[") view.size.input.stepDown(8);
      else view.size.input.stepUp(8);
      view.size.input.dispatchEvent(new Event("input"));
    } else if (!modified && (key === "+" || key === "=" || key === "-")) {
      zoomEditor(view, key === "-" ? 1 / 1.25 : 1.25);
    } else if (!modified && key === "0") withSurface(view, (surface) => { if (surface) fitPicture(view); });
    else return;
    event.preventDefault();
    event.stopPropagation();
    updateControls(view);
  };
  stage.addEventListener("keydown", view.onShortcut);
  const releaseSpace = () => {
    if (!view.space) return;
    view.space = false;
    updateControls(view);
  };
  view.onShortcutUp = (event) => {
    if (event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      releaseSpace();
    }
  };
  stage.addEventListener("keyup", view.onShortcutUp);
  stage.addEventListener("blur", releaseSpace);
}

function isImageFile(file) {
  return !!file && (file.type.startsWith("image/") || IMAGE_EXT.test(file.name));
}

function imageFile(transfer) {
  return Array.from(transfer?.files || []).find(isImageFile) ||
    Array.from(transfer?.items || []).filter((item) => item.kind === "file")
      .map((item) => item.getAsFile()).find(isImageFile);
}

function draggingImage(transfer) {
  return !!transfer && (transfer.types.includes("Files") || transfer.types.includes(ASSET_DROP) ||
    URI_TYPES.some((type) => transfer.types.includes(type)) || Array.from(transfer.items).some((item) => item.kind === "file"));
}

function droppedImage(transfer) {
  if (!transfer) return null;
  const file = imageFile(transfer);
  if (file) return file;
  let info;
  try { info = JSON.parse(transfer.getData(ASSET_DROP)); } catch { /* optional metadata */ }
  if (info?.media_kind && info.media_kind !== "image") return null;
  const uri = URI_TYPES.map((type) => transfer.getData(type)
    .split(/\r?\n/).find((line) => line.trim() && !line.startsWith("#"))?.trim())
    .find(Boolean);
  if (uri || info?.media_url) return { url: info?.media_url || uri, name: info?.filename };
  if (typeof info?.filename === "string" && ["input", "output", "temp"].includes(info.type)) {
    const query = new URLSearchParams({
      filename: info.filename, subfolder: info.subfolder || "", type: info.type,
    });
    return { url: api.apiURL("/view?" + query), name: info.filename };
  }
  return null;
}

async function fetchDroppedImage(asset) {
  const url = new URL(asset.url, location.href);
  if (url.protocol === "file:") throw new Error("浏览器只收到文件路径，请拖入实际文件或使用上传图像");
  if (!["http:", "https:", "blob:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("此图片地址无法读取");
  }
  const response = await fetch(url, {
    credentials: "same-origin", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`读取图像失败（HTTP ${response.status}）`);
  const data = await response.blob();
  if (!data.type.startsWith("image/")) throw new Error("拖入的内容不是可读取的图片");
  const sourceName = asset.name || url.searchParams.get("filename") || url.pathname.split("/").pop();
  let name;
  try { name = decodeURIComponent(sourceName || "").split(/[\\/]/).pop(); } catch { /* use generated filename */ }
  if (!name || !IMAGE_EXT.test(name)) {
    const extensions = { "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/bmp": "bmp", "image/avif": "avif" };
    name = `dropped-image.${extensions[data.type] || "png"}`;
  }
  return new File([data], name, { type: data.type });
}

function acceptImageDrop(view, event, capture = false) {
  if (!view) return false;
  view.stage.classList.remove("eime-drop-target");
  const asset = droppedImage(event.dataTransfer);
  if (!asset) return false;
  event.preventDefault();
  if (capture) event.stopImmediatePropagation();
  else event.stopPropagation();
  loadFile(view, asset);
  return true;
}

function viewFromEvent(event) {
  for (const target of event.composedPath()) {
    const view = editorViews.get(target);
    if (view) return view;
  }
  return null;
}

function captureEditorDrag(event) {
  const view = viewFromEvent(event);
  if (!view) return;
  if (event.type === "drop") {
    acceptImageDrop(view, event, true);
    return;
  }
  if (!draggingImage(event.dataTransfer)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const allowed = event.dataTransfer.effectAllowed?.toLowerCase() || "";
  event.dataTransfer.dropEffect = allowed.includes("link") && !allowed.includes("copy") ? "link" : "copy";
  view.stage.classList.add("eime-drop-target");
}

function captureEditorWheel(event) {
  const view = viewFromEvent(event);
  if (!view?.ready || locked(view) || view.pointer || !event.deltaY ||
      event.ctrlKey || event.metaKey || !view.stage.contains(event.target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const anchor = { x: event.clientX, y: event.clientY };
  zoomEditor(view, event.deltaY < 0 ? 1.18 : 1 / 1.18, anchor);
}

function captureWorkspaceKeys(event) {
  const view = activeWorkspaceView;
  if (!view?.workspace.active) {
    // The graph consumes Ctrl+Z before events reach the inline canvas.
    if (event.type !== "keydown" || !(event.ctrlKey || event.metaKey) || !["z", "y"].includes(event.key.toLowerCase())) return;
    const inline = viewFromEvent(event);
    if (event.target !== inline?.stage) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    inline.onShortcut(event);
    return;
  }
  event.stopImmediatePropagation();
  if (view.upscale.active) return;
  if (event.type === "keydown" && event.key === "Escape") {
    event.preventDefault();
    view.workspace.close();
    return;
  }
  if (event.type === "keydown" && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void runFromWorkspace(view);
    return;
  }
  if (event.target?.closest?.("input,textarea,select,[contenteditable],button")) return;
  if (event.type === "keydown") view.onShortcut(event);
  else view.onShortcutUp(event);
}

async function runFromWorkspace(view) {
  if (locked(view) || view.runningGraph || app.processingQueue) return;
  view.runningGraph = true;
  updateControls(view);
  try {
    await saveEdits(view);
    if (view.node.graph && !app.processingQueue) await app.queuePrompt(0, 1);
  } catch (error) {
    view.status.textContent = error.message;
  } finally {
    view.runningGraph = false;
    updateControls(view);
  }
}

function pasteImageIntoSelectedEditor(event) {
  if (event.defaultPrevented ||
      event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  const active = activeWorkspaceView;
  let view;
  if (active?.workspace.active) {
    if (active.workspace.contains(event.target)) view = active;
  } else {
    if (event.target?.closest?.('[role="dialog"], dialog')) return;
    const canvas = app.canvas;
    if (!canvas || canvas.read_only) return;
    const current = canvas.current_node;
    const selection = canvas.selectedItems;
    const node = current?.is_selected ? current : selection?.size === 1 ? selection.values().next().value : null;
    view = node?._eagleImageMaskEditor;
  }
  if (!view) return;
  const file = imageFile(event.clipboardData);
  if (!file) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void loadFile(view, file);
}

function editorSuppliesInput(node) {
  const graphModes = globalThis.LiteGraph;
  return node.outputs?.some((output) => output.links?.length) &&
    node.mode !== graphModes?.NEVER && node.mode !== graphModes?.BYPASS &&
    !node._eagleImageMaskEditor?.requestWidget?.value && reviewApprovalUsesInput(node);
}

function prepareEditorInputs(graph) {
  const pending = [];
  const graphs = [graph, ...(graph?.subgraphs?.values?.() || [])];
  for (const current of new Set(graphs)) {
    for (const node of current?.nodes || current?._nodes || []) {
      const view = node._eagleImageMaskEditor;
      if (!view || !editorSuppliesInput(node)) continue;
      if (view.importing) pending.push(view.importing);
      else if (view.saving || view.activation || view.pointer || view.surface?.dirtyLayers.size) {
        pending.push(saveEdits(view));
      }
    }
  }
  return pending;
}

function createEditor(node, sourceWidget, layersWidget, requestWidget, promptWidget, autoWidget, adjustmentsWidget) {
  installStyles();
  const root = element("div", "eime-root");
  const panel = element("div", "eime-panel");
  const stage = element("div", "eime-stage");
  stage.tabIndex = 0;
  stage.setAttribute("role", "group");
  stage.ariaLabel = "图像编辑画布";
  const picture = element("div", "eime-picture");
  const planes = element("div", "eime-planes");
  const base = element("img", "eime-base");
  base.alt = "加载的图像";
  base.draggable = false;
  const still = element("canvas", "eime-still");
  still.width = still.height = 0;
  const saved = { paint: element("img", "eime-paint-image"), mask: element("img", "eime-mask-image") };
  const automaticMask = element("img", "eime-mask-image eime-automatic-mask");
  for (const image of [...Object.values(saved), automaticMask]) {
    image.alt = "";
    image.draggable = false;
  }
  const canvases = { paint: element("canvas", "eime-paint-canvas"), mask: element("canvas", "eime-mask-canvas") };
  for (const canvas of Object.values(canvases)) canvas.width = canvas.height = 0;
  const effectMask = element("canvas", "eime-effect-mask");
  effectMask.width = effectMask.height = 0;
  const pointsOverlay = element("div", "eime-points");
  pointsOverlay.ariaHidden = "true";
  planes.append(base, still, saved.paint, saved.mask, canvases.paint, canvases.mask, automaticMask, effectMask);
  picture.append(planes, pointsOverlay);
  const empty = element("p", "eime-empty");
  const cursor = element("div", "eime-cursor");
  cursor.hidden = true;
  cursor.ariaHidden = "true";
  const frame = element("div", "eime-frame");
  frame.hidden = true;
  stage.append(picture, frame, empty, cursor);
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.hidden = true;
  const dimensions = element("span", "eime-dimensions");
  const status = element("p", "eime-status");
  status.ariaLive = "polite";
  const toolbar = element("div", "eime-bar");
  const tools = element("aside", "eime-tools");
  tools.ariaLabel = "编辑工具";
  const layers = element("div", "eime-tool-group");
  const commands = element("div", "eime-tool-group");
  const history = element("div", "eime-tool-group");
  const workspace = element("div", "eime-workspace");
  const properties = element("aside", "eime-properties");
  const brushSettings = document.createElement("fieldset");
  const maskSettings = document.createElement("fieldset");
  const samSettings = document.createElement("fieldset");
  const effectsSettings = document.createElement("fieldset");
  const frameSettings = document.createElement("fieldset");
  const pickSettings = document.createElement("fieldset");
  const brushLegend = document.createElement("legend");
  const maskLegend = document.createElement("legend");
  brushLegend.textContent = "笔刷属性";
  maskLegend.textContent = "遮罩显示";
  const colorLabel = document.createElement("label");
  const color = document.createElement("input");
  color.type = "color";
  color.value = DEFAULT_BRUSH_COLOR;
  color.ariaLabel = "画笔颜色";
  colorLabel.append("画笔颜色", color);
  const maskVisibility = document.createElement("label");
  const showMask = document.createElement("input");
  showMask.type = "checkbox";
  showMask.checked = true;
  maskVisibility.append(showMask, "显示遮罩");
  const maskColorLabel = document.createElement("label");
  const maskColor = document.createElement("input");
  maskColor.type = "color";
  maskColor.ariaLabel = "遮罩颜色";
  maskColorLabel.append("遮罩颜色", maskColor);
  const filterId = `eime-mask-color-${++maskFilterId}`;
  const defs = svgElement("svg", { class: "eime-defs", width: "0", height: "0", "aria-hidden": "true" });
  const filter = svgElement("filter", {
    id: filterId, x: "0", y: "0", width: "100%", height: "100%", "color-interpolation-filters": "sRGB",
  });
  const tint = svgElement("feFlood", { "flood-color": DEFAULT_MASK_COLOR });
  filter.append(tint, svgElement("feComposite", { in2: "SourceAlpha", operator: "in" }));
  defs.append(filter);
  panel.style.setProperty("--eime-mask-filter", `url("#${filterId}")`);
  const restoreMaskColor = () => {
    const color = node.properties?.eagleMaskColor;
    maskColor.value = /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_MASK_COLOR;
    tint.setAttribute("flood-color", maskColor.value);
  };
  restoreMaskColor();
  maskColor.addEventListener("input", () => {
    node.properties ||= {};
    node.properties.eagleMaskColor = maskColor.value;
    tint.setAttribute("flood-color", maskColor.value);
  });
  const growthLabel = document.createElement("label");
  const growth = document.createElement("input");
  growth.type = "number";
  growth.min = 0;
  growth.max = 4096;
  growth.step = 1;
  growth.value = 16;
  growth.ariaLabel = "向外扩展（像素）";
  const growthRow = element("div", "eime-growth");
  growthLabel.append("向外扩展（像素）");
  growthRow.append(growthLabel, growth);
  const feather = document.createElement("input");
  feather.type = "number";
  feather.min = 0;
  feather.max = 4096;
  feather.step = "0.5";
  feather.ariaLabel = "羽化（像素）";
  const featherRow = element("div", "eime-growth");
  featherRow.append(document.createTextNode("羽化（像素）"), feather);
  const growEnabled = document.createElement("input");
  growEnabled.type = "checkbox";
  const growLabel = document.createElement("label");
  growLabel.append(growEnabled, "自动扩展遮罩");
  const frameNote = element("small", "eime-help");
  const frameMode = document.createElement("select");
  frameMode.ariaLabel = "构图方式";
  frameMode.add(new Option("裁切", "crop"));
  frameMode.add(new Option("填充补边", "pad"));
  const frameRatio = document.createElement("select");
  frameRatio.ariaLabel = "画幅比例";
  for (const value of ["original", "1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"]) {
    frameRatio.add(new Option(value === "original" ? "原始比例" : value, value));
  }
  const frameZoom = range("图像缩放（%）", 25, 400, 100);
  const frameX = range("水平位置", 0, 100, 50);
  const frameY = range("垂直位置", 0, 100, 50);
  const fillColor = document.createElement("input");
  fillColor.type = "color";
  fillColor.ariaLabel = "填充颜色";
  const fillColorLabel = document.createElement("label");
  fillColorLabel.append("填充颜色", fillColor);
  const maskFill = document.createElement("input");
  maskFill.type = "checkbox";
  const maskFillLabel = document.createElement("label");
  maskFillLabel.append(maskFill, "填充区加入遮罩");
  const pointPolarity = document.createElement("select");
  pointPolarity.ariaLabel = "SAM 提示点";
  for (const [label, kind] of [["添加区域", "1"], ["排除区域", "0"]]) {
    pointPolarity.add(new Option(label, kind));
  }
  const samMode = document.createElement("select");
  samMode.ariaLabel = "SAM 模式";
  samMode.add(new Option("点选分割", "points"));
  samMode.add(new Option("文本分割", "text"));
  const samText = document.createElement("textarea");
  samText.ariaLabel = "SAM 文本";
  samText.spellcheck = false;
  samText.rows = 3;
  const samNumber = (label, min, max, step, hint) => {
    const field = document.createElement("input");
    field.type = "number";
    field.min = min;
    field.max = max;
    field.step = step;
    field.ariaLabel = label;
    field.title = hint;
    const row = element("div", "eime-growth");
    row.append(document.createTextNode(label), field);
    return { field, row };
  };
  const samThreshold = samNumber("文本检测阈值", 0, 1, 0.01, "数值越高，保留的文本检测结果越少。");
  const samRefine = samNumber("细化迭代次数", 0, 5, 1, "适用于原生 SAM3 和 SAM3.1。");
  const pointSize = range("提示点大小", 12, 52, DEFAULT_POINT_SIZE);
  const showPointSize = () => panel.style.setProperty("--eime-point-size", `${pointSize.input.value}px`);
  const samTextRows = element("div", "eime-options");
  const pointRows = element("div", "eime-options");
  const pickTarget = document.createElement("select");
  pickTarget.ariaLabel = "取色写入";
  for (const [label, target] of [["画笔颜色", "brush"], ["遮罩颜色", "mask"], ["填充颜色", "fill"]]) {
    pickTarget.add(new Option(label, target));
  }
  const pickSource = document.createElement("select");
  pickSource.ariaLabel = "取色来源";
  pickSource.add(new Option("原图", "base"));
  pickSource.add(new Option("原图与绘画层", "paint"));
  const sample = element("span", "eime-sample");
  sample.hidden = true;
  const sampleSwatch = element("span", "eime-swatch");
  const sampleValue = document.createElement("output");
  sample.append(sampleSwatch, sampleValue);
  const view = {
    node, sourceWidget, layersWidget, requestWidget, promptWidget, autoWidget, adjustmentsWidget,
    root, panel, stage, picture, planes, frame, frameNote, base, still, saved, canvases, automaticMask, effectMask, fileInput, cursor,
    empty, dimensions, status, tools, color, colorLabel, maskColor, fillColor, showMask, properties,
    samSettings, frameSettings, pickSettings, samMode, samText, samTextRows, pointRows, pickTarget, pickSource,
    sample, sampleSwatch, sampleValue,
    samTextLink: null, linkedSamText: null, automaticPath: "", effectVisible: false, effectsFrame: 0, runningGraph: false,
    adjustments: readAdjustments(adjustmentsWidget?.value),
    version: 0, paths: {}, failedLayers: [], ready: false, busy: false, saving: null, activation: null, importing: null,
    request: null, requestSubmitting: false, imageLink: null, linked: null, points: [],
    pointsOverlay, pointPolarity, restoreMaskColor,
    surface: null, pointer: null, space: false, layer: "mask", tool: "brush", shape: "round", zoom: 1, panX: 0, panY: 0,
    size: range("笔刷大小", 1, 512, 52), hardness: range("硬度", 0, 100, 85), flow: range("画笔流量", 1, 100, 100),
  };
  view.refreshAdjustments = () => {
    const state = view.adjustments;
    growEnabled.checked = state.grow;
    growth.value = state.expand;
    growth.disabled = !state.grow;
    feather.value = state.feather;
    frameMode.value = state.framing;
    frameRatio.value = state.ratio;
    frameZoom.set(Math.round(state.zoom * 100));
    frameX.set(Math.round(state.x * 100));
    frameY.set(Math.round(state.y * 100));
    fillColor.value = state.fill;
    maskFill.checked = state.mask_fill;
    samThreshold.field.value = state.sam.threshold;
    samRefine.field.value = state.sam.refine_iterations;
  };
  view.restoreSettings = (named) => {
    // The optional wired ports can change LiteGraph's positional restoration
    // slots. Prefer the stable setting names when a workflow has them.
    for (const [widget, fallback] of [[promptWidget, ""], [autoWidget, false], [adjustmentsWidget, ""]]) {
      if (!widget) continue;
      const restored = named?.[widget.name];
      if (typeof restored === typeof fallback) widget.value = restored;
      else if (typeof widget.value !== typeof fallback) widget.value = fallback;
    }
    view.adjustments = readAdjustments(view.adjustmentsWidget?.value);
    const legacyMode = node.properties?.eagleSamMode ?? (autoWidget?.value === true ? "text" : null);
    if (!view.adjustments.sam.mode && (legacyMode === "points" || legacyMode === "text")) {
      view.adjustments.sam.mode = legacyMode;
      persistAdjustments(view);
    }
    view.refreshAdjustments();
    samMode.value = view.adjustments.sam.mode ?? "points";
    const size = node.properties?.eagleSamPointSize;
    pointSize.set(Number.isInteger(size) ? size : DEFAULT_POINT_SIZE);
    showPointSize();
  };
  view.restoreSettings();
  growEnabled.addEventListener("change", () => setAdjustments(view, { grow: growEnabled.checked }));
  for (const [name, control] of [["expand", growth], ["feather", feather]]) {
    control.addEventListener("input", () => {
      if (control.validity.valid && Number.isFinite(control.valueAsNumber)) {
        // Keep typing and decimal edits natural, including a temporarily empty field.
        view.adjustments[name] = control.valueAsNumber;
        persistAdjustments(view);
        queueMaskPreview(view);
      }
    });
  }
  for (const [name, control] of [["ratio", frameRatio], ["framing", frameMode], ["fill", fillColor]]) {
    control.addEventListener("input", () => setAdjustments(view, { [name]: control.value }));
  }
  for (const [name, control] of [["zoom", frameZoom], ["x", frameX], ["y", frameY]]) {
    control.input.addEventListener("input", () => setAdjustments(view, { [name]: Number(control.input.value) / 100 }));
  }
  maskFill.addEventListener("change", () => setAdjustments(view, { mask_fill: maskFill.checked }));
  for (const [key, control] of [["threshold", samThreshold.field], ["refine_iterations", samRefine.field]]) {
    control.addEventListener("input", () => {
      if (!control.validity.valid || !Number.isFinite(control.valueAsNumber)) return;
      setSamOptions(view, { [key]: control.valueAsNumber });
      updateControls(view);
    });
  }
  pointSize.input.addEventListener("input", () => {
    (node.properties ||= {}).eagleSamPointSize = pointSize.input.valueAsNumber;
    showPointSize();
  });
  samText.addEventListener("input", () => {
    if (!samText.readOnly && promptWidget) promptWidget.value = samText.value;
    setSamOptions(view, { mode: "text" });
    updateControls(view);
  });
  samMode.addEventListener("change", () => {
    node.properties ||= {};
    node.properties.eagleSamMode = samMode.value;
    setSamOptions(view, { mode: samMode.value });
    updateControls(view);
  });
  pickSource.addEventListener("change", () => { sample.hidden = true; updateControls(view); });
  const update = () => updateControls(view);
  const editAction = (action) => () => {
    if (!view.ready || locked(view) || view.pointer) return;
    withSurface(view, (surface) => {
      if (surface) action(surface);
      update();
    });
  };
  view.upload = button("上传图像", () => fileInput.click());
  view.reset = button("还原原图", editAction((surface) => resetEditor(view, surface)), "清除编辑并恢复原图尺寸，支持撤销");
  view.openWorkspace = button("打开大画布", () => {
    try {
      if (view.workspace.open(view.openWorkspace)) {
        activeWorkspaceView = view;
        updateControls(view);
        view.stage.focus({ preventScroll: true });
      }
    } catch (error) {
      view.status.textContent = error.message;
    }
  });
  view.runWorkspace = button("运行工作流", () => { void runFromWorkspace(view); }, "Ctrl+Enter");
  view.fetchLinked = button("读取连线图像", () => { void submitEditorRequest(view, "preview"); });
  view.cancelWait = button("取消等待", () => {
    if (view.requestSubmitting) return;
    finishEditorRequest(view, view.request);
    view.status.textContent = "";
  });
  view.save = button("保存编辑", () => { void saveEdits(view).catch(() => {}); }, null, "save");
  view.save.classList.add("eime-apply");
  view.recover = button("移除失效图层", () => removeFailedLayers(view));
  view.maskLayer = button("遮罩层", () => { view.layer = "mask"; update(); }, null, "mask");
  view.paintLayer = button("绘画层", () => { view.layer = "paint"; update(); }, null, "paint");
  const historyAction = (method) => editAction((surface) => {
    surface[method]();
    stage.focus({ preventScroll: true });
  });
  view.undo = button("撤销", historyAction("undo"), "Ctrl+Z", "undo");
  view.redo = button("重做", historyAction("redo"), "Ctrl+Shift+Z / Ctrl+Y", "redo");
  const toolEntries = [
    ["brush", "画笔", "B"], ["erase", "橡皮", "E"], ["pan", "平移", "H / 空格"],
    ["sam", "SAM 分割", "点选或文本分割"], ["pick", "透层吸管", "I"], ["frame", "裁切与填充", "C"],
  ];
  view.toolButtons = Object.fromEntries(toolEntries
    .map(([name, label, hint]) => [name, button(label, () => {
      selectEditorTool(view, name);
      view.stage.focus({ preventScroll: true });
    }, hint, name)]));
  const shapes = element("div", "eime-bar");
  view.shapeButtons = Object.fromEntries([["round", "圆头"], ["square", "方头"]]
    .map(([name, label]) => [name, button(label, () => { view.shape = name; update(); })]));
  shapes.append(...Object.values(view.shapeButtons));
  const maskOpacity = view.maskOpacity = range("叠加透明度", 0, 100, 48);
  const samLegend = document.createElement("legend");
  samLegend.textContent = "SAM 分割";
  view.fetchSamText = button("读取接线文本", () => { void submitEditorRequest(view, "preview"); });
  view.samRun = button("生成 SAM 遮罩", () => { void submitEditorRequest(view, "segment"); }, "立即生成预览，工作流也会按当前模式自动分割");
  view.clearPoints = button("清除提示点", editAction(() => {
    changePoints(view, []);
    stage.focus({ preventScroll: true });
  }));
  view.samHint = element("small", "eime-help");
  pointRows.append(pointPolarity, pointSize.row, view.clearPoints);
  samTextRows.append(samText, view.fetchSamText, samThreshold.row);
  samSettings.append(samLegend, samMode, pointRows, samTextRows, samRefine.row, view.samRun, view.samHint);
  const effectsLegend = document.createElement("legend");
  effectsLegend.textContent = "遮罩处理";
  effectsSettings.append(effectsLegend, growLabel, growthRow, featherRow);
  const frameLegend = document.createElement("legend");
  frameLegend.textContent = "裁切与填充";
  frameSettings.append(frameLegend, frameMode, frameRatio, frameZoom.row, frameX.row, frameY.row,
    fillColorLabel, maskFillLabel, frameNote,
    button("完成构图", () => {
      selectEditorTool(view, "brush");
      stage.focus({ preventScroll: true });
    }),
    button("重置构图", () => setAdjustments(view, { ratio: "original", framing: "crop", zoom: 1, x: 0.5, y: 0.5 })));
  const pickLegend = document.createElement("legend");
  pickLegend.textContent = "透层吸管";
  pickSettings.append(pickLegend, pickSource, pickTarget, sample);
  for (const [target, label] of [["brush", colorLabel], ["mask", maskColorLabel], ["fill", fillColorLabel]]) {
    label.classList.add("eime-inline-label");
    const pick = button("取色", () => {
      view.pickTarget.value = target;
      selectEditorTool(view, "pick");
      view.stage.focus({ preventScroll: true });
    }, "从画布读取颜色");
    pick.className = "eime-pick-target";
    // Keep the color control's label click from opening the native screen picker.
    pick.addEventListener("click", (event) => event.preventDefault());
    label.append(pick);
  }
  brushSettings.append(brushLegend, shapes, view.size.row, view.hardness.row, view.flow.row, colorLabel);
  maskSettings.append(maskLegend, maskVisibility, maskColorLabel, maskOpacity.row);
  properties.append(brushSettings, maskSettings, pickSettings, effectsSettings, frameSettings, samSettings);
  workspace.append(tools, stage, properties);
  const orientation = element("div", "eime-bar");
  orientation.role = "group";
  orientation.ariaLabel = "图像方向";
  for (const [key, label, operation] of [
    ["flipX", "水平镜像", "flip_x"], ["flipY", "垂直镜像", "flip_y"],
    ["rotateLeft", "向左旋转 90°", -90], ["rotateRight", "向右旋转 90°", 90],
  ]) {
    orientation.append(button(label, editAction((surface) => changeOrientation(view, surface, operation)), null, key));
  }
  view.upscale = createUpscaleDialog(panel, () => view.adjustments.upscale, (settings) => {
    setAdjustments(view, { upscale: settings });
    updateControls(view);
  }, async () => {
    const response = await api.fetchApi("/models/upscale_models");
    if (!response.ok) throw new Error(`读取放大模型失败（HTTP ${response.status}）`);
    return response.json();
  });
  view.upscaleButton = button("模型放大", () => view.upscale.open(view.upscaleButton), "模型放大设置", "upscale");
  view.upscaleButton.setAttribute("aria-haspopup", "dialog");
  toolbar.append(view.upload, fileInput, view.fetchLinked, view.reset, view.openWorkspace, view.runWorkspace,
    orientation, view.upscaleButton, view.cancelWait, view.recover, dimensions);
  layers.append(view.maskLayer, view.paintLayer);
  commands.append(...Object.values(view.toolButtons),
    button("填充", editAction((surface) => {
      const filled = surface.fill(view.layer, view.color.value);
      if (filled && view.layer === "mask") setAutomaticMask(view);
      view.status.textContent = filled ? "" : "先涂抹遮罩以限定填充区域";
    }), "遮罩层填满画布，绘画层填充遮罩覆盖的区域", "fill"),
    button("清空", editAction((surface) => {
      if (view.layer === "mask") setAutomaticMask(view);
      surface.clear(view.layer);
    }), null, "clear"),
    button("反转遮罩", editAction((surface) => {
      setAutomaticMask(view);
      surface.invertMask();
    }), null, "invert"));
  history.append(view.undo, view.redo);
  const actions = element("div", "eime-tool-group");
  view.exit = button("退出编辑", () => {
    closeEditing(view);
    syncSource(view);
    view.status.textContent = "";
  }, null, "close");
  actions.append(button("放大", () => zoomEditor(view, 1.25), "+", "in"),
    button("缩小", () => zoomEditor(view, 1 / 1.25), "−", "out"),
    button("适合窗口", editAction(() => fitPicture(view)), "0", "fit"));
  const edits = element("div", "eime-tool-group");
  edits.append(view.save, view.exit);
  view.imageActions = [...layers.children, ...commands.children, ...actions.children, ...orientation.children];
  tools.append(layers, commands, history, actions, edits);
  panel.append(defs, toolbar, status, workspace);
  root.append(panel);
  view.workspace = createWorkspaceDialog(view, panel, () => {
    const closed = !view.workspace.active && activeWorkspaceView === view;
    if (closed) activeWorkspaceView = null;
    transformPicture(view);
    updateControls(view);
    if (closed) view.openWorkspace.focus({ preventScroll: true });
  });
  view.resize = new ResizeObserver(() => transformPicture(view));
  view.resize.observe(stage);
  base.addEventListener("load", () => showSourceImage(view));
  base.addEventListener("error", () => showSourceImage(view));
  automaticMask.addEventListener("load", () => {
    view.effectVisible = false;
    updateControls(view);
  });
  for (const [name, image] of Object.entries(saved)) {
    if (name === "mask") image.addEventListener("load", () => queueMaskPreview(view));
    image.addEventListener("error", () => {
      if (view.paths[name] && image.complete && !image.naturalWidth) markFailedLayer(view, name);
    });
  }
  panel.addEventListener("pointerdown", (event) => {
    if (!view.workspace.active && (event.target === stage || !event.target.closest("input,button,select,textarea,label"))) {
      if (!node.is_selected) app.canvas?.selectNode?.(node);
    }
    event.stopPropagation();
  });
  fileInput.addEventListener("change", () => { void loadFile(view, fileInput.files?.[0]); });
  showMask.addEventListener("change", update);
  maskOpacity.input.addEventListener("input", () => panel.style.setProperty("--eime-mask-opacity", Number(maskOpacity.input.value) / 100));
  panel.addEventListener("dragleave", (event) => {
    if (!panel.contains(event.relatedTarget)) stage.classList.remove("eime-drop-target");
  });
  installPainting(view);
  editorViews.set(root, view);
  editorViews.set(panel, view);
  editorViews.set(stage, view);
  node._eagleImageMaskEditor = view;
  node.addDOMWidget("eagle_image_mask_editor", "div", root, {
    serialize: false, hideInPanel: true,
    getMinHeight: () => 295,
    getMaxHeight: () => 1600,
  });
  const callback = sourceWidget.callback;
  sourceWidget.callback = function () {
    const result = callback?.apply(this, arguments);
    syncSource(view);
    return result;
  };
  const serializeLayers = layersWidget.serializeValue;
  layersWidget.serializeValue = async function () {
    if (editorSuppliesInput(node)) await saveEdits(view);
    return (await serializeLayers?.apply(this, arguments)) ?? layersWidget.value;
  };
  syncSource(view);
}

app.registerExtension({
  name: "EagleSuite.ImageMaskEditor",
  init() {
    // Workflow import extensions intercept files at window capture during setup.
    // Claim only this editor's DOM surface before those general handlers.
    for (const event of ["dragenter", "dragover", "drop"]) window.addEventListener(event, captureEditorDrag, true);
    window.addEventListener("wheel", captureEditorWheel, { capture: true, passive: false });
    for (const event of ["keydown", "keyup"]) window.addEventListener(event, captureWorkspaceKeys, true);
  },
  setup() {
    document.addEventListener("paste", pasteImageIntoSelectedEditor, true);
    const App = app.constructor;
    if ("maskeditor_is_opended" in App) {
      const previous = App.maskeditor_is_opended;
      App.maskeditor_is_opended = function () {
        // The graph change tracker checks this before scheduling its own undo.
        const active = document.activeElement;
        return active === editorViews.get(active)?.stage || !!previous?.call(this);
      };
    }
    const graphToPrompt = app.graphToPrompt;
    if (typeof graphToPrompt !== "function") return;
    app.graphToPrompt = function (...args) {
      // Core captures workflow JSON before it awaits widget serializeValue.
      const pending = prepareEditorInputs(args[0] ?? this.rootGraph ?? this.graph);
      return pending.length
        ? Promise.all(pending).then(() => graphToPrompt.apply(this, args))
        : graphToPrompt.apply(this, args);
    };
  },
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_TYPE) return;
    for (const name of HIDDEN_WIDGETS) {
      const definition = nodeData.input?.optional?.[name];
      if (definition) definition[1] = { ...definition[1], hidden: true, vueNode: "never", hideInPanel: true };
    }
    const configure = nodeType.prototype.configure;
    nodeType.prototype.configure = function (info, ...rest) {
      const saved = migrateEditorWidgets(info);
      const result = configure.call(this, saved, ...rest);
      const view = this._eagleImageMaskEditor;
      if (view) {
        if (view.requestWidget) view.requestWidget.value = "";
        view.restoreMaskColor();
        view.restoreSettings(saved?.widgets_values_named);
        syncSource(view);
        restoreSamPoints(view, view.filename);
        updateControls(view);
        transformPicture(view);
      }
      return result;
    };
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      const source = this.widgets?.find((widget) => widget.name === "image");
      const layers = this.widgets?.find((widget) => widget.name === "edit_layers");
      const request = this.widgets?.find((widget) => widget.name === "editor_request");
      const prompt = this.widgets?.find((widget) => widget.name === "sam_prompt");
      const automatic = this.widgets?.find((widget) => widget.name === "sam_auto");
      const adjustments = this.widgets?.find((widget) => widget.name === "editor_adjustments");
      if (this._eagleImageMaskEditor || !source || !layers || !this.addDOMWidget) return result;
      for (const widget of this.widgets.filter((item) => HIDDEN_WIDGETS.includes(item.name))) {
        widget.type = "hidden";
        widget.hidden = true;
        widget.computeSize = () => [0, -4];
        widget.draw = () => {};
      }
      // Comfy uses widget.serialize for workflow JSON and options.serialize
      // for API prompts. The request is valid only for the current submission.
      if (request) request.serialize = false;
      this.setSize([520, 580]);
      createEditor(this, source, layers, request, prompt, automatic, adjustments);
      return result;
    };
    const changed = nodeType.prototype.onWidgetChanged;
    nodeType.prototype.onWidgetChanged = function (name, value, previousValue) {
      const result = changed?.apply(this, arguments);
      const view = this._eagleImageMaskEditor;
      if (view && (name === "image" || name === "edit_layers")) syncSource(view);
      if (value !== previousValue && SIZE_WIDGETS.includes(name)) {
        const legacy = this.widgets?.find((widget) => widget.name === "legacy_resize");
        if (legacy) legacy.value = "";
        if (view?.ready) transformPicture(view);
      }
      return result;
    };
    const dragOver = nodeType.prototype.onDragOver;
    nodeType.prototype.onDragOver = function (event) {
      return draggingImage(event.dataTransfer) || dragOver?.apply(this, arguments);
    };
    const dragDrop = nodeType.prototype.onDragDrop;
    nodeType.prototype.onDragDrop = function (event) {
      return acceptImageDrop(this._eagleImageMaskEditor, event) || dragDrop?.apply(this, arguments);
    };
    const connectionsChanged = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (kind, index) {
      const result = connectionsChanged?.apply(this, arguments);
      const view = this._eagleImageMaskEditor;
      if (view && kind === 1 && EDITOR_LINKS.includes(this.inputs?.[index]?.name)) {
        queueMicrotask(() => {
          if (this._eagleImageMaskEditor !== view) return;
          const changed = view.request && view.request.links !== linkSignature(view);
          if (changed) finishEditorRequest(view, view.request);
          if (this.inputs[index]?.name !== "image_input") setAutomaticMask(view);
          if (connected(view, "sam_text") && !view.adjustments.sam.mode) {
            view.samMode.value = "text";
            setSamOptions(view, { mode: "text" });
          }
          syncSource(view);
          if (changed) view.status.textContent = "连线已变更，请重新读取或生成";
        });
      }
      return result;
    };
    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      const result = executed?.apply(this, arguments);
      const payload = output?.eagle_image_editor?.[0];
      const view = this._eagleImageMaskEditor;
      if (view && payload) void receiveEditorResult(view, payload);
      return result;
    };
    const removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      const view = this._eagleImageMaskEditor;
      if (view) {
        view.version++;
        if (view.request) finishEditorRequest(view, view.request);
        view.resize.disconnect();
        view.upscale.dispose();
        view.workspace.dispose();
        if (activeWorkspaceView === view) activeWorkspaceView = null;
        editorViews.delete(view.root);
        editorViews.delete(view.panel);
        closeEditing(view);
        if (view.effectsFrame) cancelAnimationFrame(view.effectsFrame);
        this._eagleImageMaskEditor = null;
      }
      return removed?.apply(this, arguments);
    };
  },
});
