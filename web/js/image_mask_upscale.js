const STYLE_ID = "eagle-image-upscale-dialog-style";
const MAX_SIDE = 16384;
const MAX_PIXELS = 64_000_000;
const MODES = new Map([["scale", "按倍数"], ["width", "按宽度"]]);
const METHODS = new Map([
  ["lanczos", "Lanczos"], ["bicubic", "双三次"], ["bilinear", "双线性"],
  ["area", "面积"], ["nearest-exact", "最近邻"],
]);
const DEFAULTS = Object.freeze({
  enabled: false, model: "", mode: "scale", factor: 2, width: 1024, method: "lanczos", multiple: 1,
});
let nextDialogId = 0;

function validFactor(value) {
  return Number.isFinite(value) && value >= 1 && value <= 8;
}

function validWidth(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_SIDE;
}

function validMultiple(value) {
  return Number.isInteger(value) && value >= 1 && value <= 256;
}

function modelName(value) {
  return typeof value === "string" && value.trim() ? value : "";
}

export function readUpscaleSettings(value) {
  if (typeof value === "string") {
    try { value = JSON.parse(value); }
    catch { return { ...DEFAULTS }; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULTS };
  return {
    enabled: value.enabled === true,
    model: modelName(value.model),
    mode: MODES.has(value.mode) ? value.mode : DEFAULTS.mode,
    factor: validFactor(value.factor) ? value.factor : DEFAULTS.factor,
    width: validWidth(value.width) ? value.width : DEFAULTS.width,
    method: METHODS.has(value.method) ? value.method : DEFAULTS.method,
    multiple: validMultiple(value.multiple) ? value.multiple : DEFAULTS.multiple,
  };
}

function settingsProblem(settings) {
  if (settings.enabled && !modelName(settings.model)) {
    return ["model", "启用模型放大前请选择放大模型。"];
  }
  if (!MODES.has(settings.mode)) return ["mode", "尺寸方式无效。"];
  if (settings.mode === "scale" && !validFactor(settings.factor)) {
    return ["factor", "放大倍数需在 1 到 8 之间。"];
  }
  if (settings.mode === "width" && !validWidth(settings.width)) {
    return ["width", "目标宽度需为 1 到 16384 之间的整数。"];
  }
  if (!METHODS.has(settings.method)) return ["method", "重采样方法无效。"];
  if (!validMultiple(settings.multiple)) return ["multiple", "舍入到倍数需为 1 到 256 之间的整数。"];
  return null;
}

export function upscaleOutputSize(width, height, settings) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new RangeError("原图宽高需要为正整数。");
  }
  const value = typeof settings === "string" ? readUpscaleSettings(settings) : { ...DEFAULTS, ...settings };
  if (value.enabled !== true) return { width, height };
  const problem = settingsProblem(value);
  if (problem) throw new RangeError(problem[1]);

  const rawWidth = value.mode === "width" ? value.width : width * value.factor;
  const rawHeight = value.mode === "width" ? height * value.width / width : height * value.factor;
  const multiple = value.multiple;
  const resultWidth = Math.max(multiple, Math.round(rawWidth / multiple) * multiple);
  const resultHeight = Math.max(multiple, Math.round(rawHeight / multiple) * multiple);
  if (Math.max(resultWidth, resultHeight) > MAX_SIDE || resultWidth * resultHeight > MAX_PIXELS) {
    throw new RangeError("放大后的图像需在每边 16384 像素、总计 64 百万像素以内。");
  }
  return { width: resultWidth, height: resultHeight };
}

function installStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .eime-upscale {
      box-sizing:border-box;width:min(390px,calc(100vw - 32px));max-height:calc(100vh - 32px);
      max-height:calc(100dvh - 32px);margin:auto;padding:0;border:1px solid #46566f;
      border-radius:10px;background:#151c27;color:#dce6f5;color-scheme:dark;
      box-shadow:0 18px 56px #0008;font:13px/1.5 system-ui,sans-serif;
    }
    .eime-upscale::backdrop { background:#090c14ac; }
    .eime-upscale form { display:grid;gap:10px;padding:16px; }
    .eime-upscale h2 { margin:0;font-size:16px;font-weight:600; }
    .eime-upscale .eime-upscale__field { display:grid;grid-template-columns:106px minmax(0,1fr);align-items:center;gap:8px; }
    .eime-upscale .eime-upscale__switch { display:inline-flex;align-items:center;gap:7px; }
    .eime-upscale [hidden] { display:none!important; }
    .eime-upscale select,.eime-upscale input[type="number"] {
      box-sizing:border-box;width:100%;min-width:0;min-height:29px;padding:3px 6px;
      border:1px solid #43526a;border-radius:5px;background:#101722;color:inherit;font:inherit;
    }
    .eime-upscale input[type="checkbox"] { accent-color:#78aaf2; }
    .eime-upscale :is(input,select,button):focus-visible { outline:2px solid #8ab9ff;outline-offset:2px; }
    .eime-upscale p { margin:0;overflow-wrap:anywhere;color:#aab8cd; }
    .eime-upscale p:empty { display:none; }
    .eime-upscale [role="alert"] { color:#ffadad; }
    .eime-upscale__actions { display:flex;justify-content:flex-end;gap:8px;margin-top:3px; }
    .eime-upscale .eime-upscale__actions button {
      min-height:30px;padding:3px 12px;border:1px solid #43526a;border-radius:5px;background:#212c3e;
      color:inherit;font:inherit;cursor:pointer;
    }
    .eime-upscale .eime-upscale__actions button[type="submit"] { border-color:#4b8cdc;background:#285893;color:#fff; }
    .eime-upscale .eime-upscale__actions button:hover { border-color:#90b5e8; }
  `;
  doc.head.append(style);
}

function selectField(doc, choices) {
  const select = doc.createElement("select");
  fillOptions(select, choices);
  return select;
}

function fillOptions(select, choices) {
  select.replaceChildren(...Array.from(choices, ([value, label]) => {
    const item = select.ownerDocument.createElement("option");
    item.value = value;
    item.textContent = label;
    return item;
  }));
}

function numberField(doc, min, max, step) {
  const input = doc.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  return input;
}

function labelField(doc, label, control) {
  control.setAttribute("aria-label", label);
  const row = doc.createElement("label");
  row.className = "eime-upscale__field";
  const text = doc.createElement("span");
  text.textContent = label;
  row.append(text, control);
  return row;
}

export function createUpscaleDialog(panel, getSettings, applySettings, fetchModels) {
  const doc = panel.ownerDocument;
  const dialog = doc.createElement("dialog");
  dialog.className = "eime-upscale";
  dialog.setAttribute("aria-label", "模型放大");
  const form = doc.createElement("form");
  form.noValidate = true;
  const title = doc.createElement("h2");
  title.textContent = "模型放大";
  const enabled = doc.createElement("input");
  enabled.type = "checkbox";
  enabled.setAttribute("role", "switch");
  enabled.autofocus = true;
  const switchLabel = doc.createElement("label");
  switchLabel.className = "eime-upscale__switch";
  switchLabel.append(enabled, "启用模型放大");
  const model = selectField(doc, []);
  const mode = selectField(doc, MODES);
  const factor = numberField(doc, 1, 8, "any");
  const width = numberField(doc, 1, MAX_SIDE, 1);
  const method = selectField(doc, METHODS);
  const multiple = numberField(doc, 1, 256, 1);
  const controls = { enabled, model, mode, factor, width, method, multiple };
  const modelNotice = doc.createElement("p");
  modelNotice.id = `eime-upscale-model-${++nextDialogId}`;
  modelNotice.setAttribute("role", "status");
  model.setAttribute("aria-describedby", modelNotice.id);
  const error = doc.createElement("p");
  error.setAttribute("role", "alert");
  const factorRow = labelField(doc, "放大倍数", factor);
  const widthRow = labelField(doc, "目标宽度", width);
  const actions = doc.createElement("div");
  actions.className = "eime-upscale__actions";
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.textContent = "取消";
  const save = doc.createElement("button");
  save.type = "submit";
  save.textContent = "保存";
  actions.append(cancel, save);
  form.append(title, switchLabel, labelField(doc, "放大模型", model), modelNotice,
    labelField(doc, "尺寸方式", mode), factorRow, widthRow, labelField(doc, "重采样方法", method),
    labelField(doc, "舍入到倍数", multiple), error, actions);
  dialog.append(form);
  panel.append(dialog);

  let opener = null;
  let currentSession = null;
  let disposed = false;

  function updateMode() {
    const byWidth = mode.value === "width";
    factorRow.hidden = byWidth;
    widthRow.hidden = !byWidth;
  }

  function modelsForSession(names, saved, selected, suffix) {
    const choices = [["", "请选择模型"], ...names.map((name) => [name, name])];
    if (saved && !names.includes(saved)) choices.push([saved, `${saved}（${suffix}）`]);
    fillOptions(model, choices);
    model.value = selected;
  }

  async function loadModels(session) {
    try {
      const result = await fetchModels();
      if (currentSession !== session || !dialog.open) return;
      if (!Array.isArray(result)) throw new Error("服务器返回的模型列表格式无效。");
      const names = [...new Set(result.filter(modelName))];
      modelsForSession(names, session.model, model.value, "未列出");
      if (session.model && !names.includes(session.model)) {
        modelNotice.textContent = "已保存的模型未列出。可选择其他模型，或在运行前恢复该文件。";
      } else {
        modelNotice.textContent = names.length ? "" : "当前没有可用的放大模型。请将文件加入 ComfyUI 的 upscale_models 目录后重新打开。";
      }
    } catch (problem) {
      if (currentSession !== session || !dialog.open) return;
      modelNotice.textContent = `无法读取放大模型列表。${problem?.message || String(problem)}`;
    }
  }

  function finish(restoreFocus) {
    currentSession = null;
    const trigger = opener;
    opener = null;
    if (restoreFocus && !disposed && trigger?.isConnected) trigger.focus?.({ preventScroll: true });
  }

  function close() {
    if (dialog.open) dialog.close();
    finish(true);
  }

  mode.addEventListener("change", updateMode);
  form.addEventListener("input", () => { error.textContent = ""; });
  cancel.addEventListener("click", close);
  dialog.addEventListener("pointerdown", (event) => event.stopPropagation());
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("close", () => {
    if (!dialog.open) finish(true);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!currentSession || !dialog.open) return;
    const draft = {
      enabled: enabled.checked, model: model.value, mode: mode.value, factor: factor.valueAsNumber,
      width: width.valueAsNumber, method: method.value, multiple: multiple.valueAsNumber,
    };
    const problem = settingsProblem(draft);
    if (problem) {
      const [field, message] = problem;
      error.textContent = message;
      controls[field].focus();
      return;
    }
    try {
      applySettings(readUpscaleSettings(draft));
      close();
    } catch (problem) {
      error.textContent = problem?.message || String(problem);
    }
  });

  return {
    open(trigger) {
      if (disposed || dialog.open || !panel.isConnected) return false;
      installStyles(doc);
      const initial = readUpscaleSettings(getSettings());
      enabled.checked = initial.enabled;
      for (const name of ["mode", "factor", "width", "method", "multiple"]) controls[name].value = initial[name];
      updateMode();
      error.textContent = "";
      modelNotice.textContent = "正在读取放大模型…";
      modelsForSession([], initial.model, initial.model, "已保存");
      opener = trigger ?? doc.activeElement;
      currentSession = initial;
      try {
        dialog.showModal();
      } catch (problem) {
        finish(false);
        throw problem;
      }
      void loadModels(initial);
      return true;
    },
    close,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (dialog.open) dialog.close();
      finish(false);
      dialog.remove();
    },
    get active() { return dialog.open; },
  };
}
