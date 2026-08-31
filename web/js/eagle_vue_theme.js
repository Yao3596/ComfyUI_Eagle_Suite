/**
 * Shared Eagle Vue theme bridge.
 *
 * The stock ComfyUI dark palette intentionally receives Eagle's original
 * navy-blue surfaces.  Third-party/custom palettes keep their own CSS tokens.
 */
import { app } from "../../../scripts/app.js";

const ROOT_SELECTOR = [
  ".h3d-root",
  ".h3c-root",
  ".eagle-director-skill-root",
  ".eagle-prompt-presets-root",
  ".lg-root",
  ".eg-root",
  ".dbs-root",
  ".whg-root"
].join(",");

const DEFAULT_THEME_IDS = new Set([
  "dark", "default", "comfy", "comfyui", "comfyui-dark", "comfy dark"
]);

function settingValue() {
  const readers = [
    () => app?.ui?.settings?.getSettingValue?.("Comfy.ColorPalette"),
    () => app?.extensionManager?.setting?.get?.("Comfy.ColorPalette"),
    () => app?.extensionManager?.settings?.get?.("Comfy.ColorPalette")
  ];
  for (const read of readers) {
    try {
      const value = read();
      if (value && typeof value.then === "function") continue;
      if (value !== undefined && value !== null && value !== "") return value;
    } catch (_) {}
  }
  try {
    for (const key of ["Comfy.ColorPalette", "Comfy.Settings.Comfy.ColorPalette"]) {
      const value = localStorage.getItem(key);
      if (value) return value;
    }
  } catch (_) {}
  return "";
}

function normalizedThemeId(value) {
  if (value && typeof value === "object") value = value.id || value.value || value.name || "";
  let text = String(value || "").trim().toLowerCase();
  if (text.startsWith('"') && text.endsWith('"')) {
    try { text = String(JSON.parse(text) || "").trim().toLowerCase(); } catch (_) {}
  }
  return text;
}

function cssThemeHint() {
  const root = document.documentElement;
  const body = document.body;
  return String(
    root?.dataset?.theme || body?.dataset?.theme ||
    root?.getAttribute?.("data-color-palette") || body?.getAttribute?.("data-color-palette") || ""
  ).trim().toLowerCase();
}

export function isComfyDefaultTheme() {
  const id = normalizedThemeId(settingValue());
  if (id) return DEFAULT_THEME_IDS.has(id);
  const hint = cssThemeHint();
  if (hint) return DEFAULT_THEME_IDS.has(hint);
  // Legacy ComfyUI does not expose a palette id until the user changes it.
  return true;
}

const THEME_CSS = `
.eagle-vue-default-blue{
  --eagle-vue-bg:#0d1420;--eagle-vue-panel:#121b2a;--eagle-vue-surface:#182337;
  --eagle-vue-surface-alt:#202d45;--eagle-vue-input:#0e1624;--eagle-vue-border:#2b3b57;
  --eagle-vue-text:#dce8fa;--eagle-vue-muted:#8fa1bc;--eagle-vue-primary:#4a7de0;
  --eagle-vue-primary-hover:#6394ef;color-scheme:dark;background:var(--eagle-vue-bg)!important;
  color:var(--eagle-vue-text)!important;
}

/* H3 director and consolidated H3 pipeline. */
.h3d-root.eagle-vue-default-blue{
  --h3d-theme-bg:var(--eagle-vue-bg);--h3d-fg:var(--eagle-vue-text);
  --h3d-bg:var(--eagle-vue-bg);--h3d-bg2:var(--eagle-vue-panel);--h3d-bg3:var(--eagle-vue-surface);
  --h3d-bg4:var(--eagle-vue-surface-alt);--h3d-bd:var(--eagle-vue-border);--h3d-bdh:#41577d;
  --h3d-muted:var(--eagle-vue-muted);--h3d-primary:var(--eagle-vue-primary);--h3d-primaryh:var(--eagle-vue-primary-hover);
}
.h3c-root.eagle-vue-default-blue{
  --h3c-theme-bg:var(--eagle-vue-bg);--h3c-fg:var(--eagle-vue-text);
  --h3c-bg:var(--eagle-vue-bg);--h3c-bg2:var(--eagle-vue-panel);--h3c-bg3:var(--eagle-vue-surface);
  --h3c-bg4:var(--eagle-vue-surface-alt);--h3c-bd:var(--eagle-vue-border);--h3c-bdh:#41577d;
  --h3c-muted:var(--eagle-vue-muted);--h3c-primary:var(--eagle-vue-primary);--h3c-primaryh:var(--eagle-vue-primary-hover);
}

/* Prompt presets and director skill library share ppui tokens. */
.eagle-director-skill-root.eagle-vue-default-blue,
.eagle-prompt-presets-root.eagle-vue-default-blue{
  --ppui-theme-bg:var(--eagle-vue-bg);--ppui-bg:var(--eagle-vue-bg);
  --ppui-panel:var(--eagle-vue-panel);--ppui-surface:var(--eagle-vue-surface);
  --ppui-surface-alt:var(--eagle-vue-surface-alt);--ppui-hover:#263754;
  --ppui-input:var(--eagle-vue-input);--ppui-border:var(--eagle-vue-border);
  --ppui-text:var(--eagle-vue-text);--ppui-muted:var(--eagle-vue-muted);
  --ppui-primary:var(--eagle-vue-primary);--ppui-primary-hover:var(--eagle-vue-primary-hover);
}

/* LoRA gallery.  Keep media pixels and semantic status colours intact. */
.lg-root.eagle-vue-default-blue :is(.lg-bar,.lg-quick-head,.lg-quick-breadcrumb,.lg-quick-column-title,.lg-sel-hd,.lg-modal-hd,.lg-modal-ft){background:var(--eagle-vue-panel)!important;border-color:var(--eagle-vue-border)!important}
.lg-root.eagle-vue-default-blue :is(.lg-side,.lg-selected,.lg-sel-manual,.lg-quick-popup,.lg-quick-column,.lg-quick-preview,.lg-modal-box,.lg-detail-section,.lg-card-info){background:var(--eagle-vue-surface)!important;border-color:var(--eagle-vue-border)!important}
.lg-root.eagle-vue-default-blue :is(.lg-main,.lg-quick-columns){background:var(--eagle-vue-bg)!important}
.lg-root.eagle-vue-default-blue :is(.lg-card,.lg-sel-item,.lg-btn,.lg-quick-crumb.current){background:var(--eagle-vue-surface-alt)!important;border-color:var(--eagle-vue-border)!important}
.lg-root.eagle-vue-default-blue :is(.lg-srch,.lg-sel,.lg-folder-srch,.lg-quick-search,.lg-sel-manual-input,.lg-sel-weight,.lg-modal-input,.lg-detail-words){background:var(--eagle-vue-input)!important;border-color:var(--eagle-vue-border)!important;color:var(--eagle-vue-text)!important}
.lg-root.eagle-vue-default-blue :is(.lg-card.sel,.lg-sel-item.enabled){background:#203556!important;border-color:var(--eagle-vue-primary)!important}

/* Eagle image gallery. */
.eg-root.eagle-vue-default-blue :is(.eg-bar,.eg-foot){background:var(--eagle-vue-panel)!important;border-color:var(--eagle-vue-border)!important}
.eg-root.eagle-vue-default-blue :is(.eg-side,.sd-box,.cl-pop){background:var(--eagle-vue-surface)!important;border-color:var(--eagle-vue-border)!important}
.eg-root.eagle-vue-default-blue :is(.eg-body,.eg-main){background:var(--eagle-vue-bg)!important}
.eg-root.eagle-vue-default-blue :is(.g-card,.eg-btn,.tg-it){background:var(--eagle-vue-surface-alt)!important;border-color:var(--eagle-vue-border)!important}
.eg-root.eagle-vue-default-blue :is(.eg-srch,.eg-sel,.eg-idi,.eg-folder-srch,.sd-inp,.cl-trig){background:var(--eagle-vue-input)!important;border-color:var(--eagle-vue-border)!important;color:var(--eagle-vue-text)!important}
.eg-root.eagle-vue-default-blue .g-card.sel{background:#203556!important;border-color:var(--eagle-vue-primary)!important}

/* Danbooru semantic search and gallery. */
.dbs-root.eagle-vue-default-blue :is(.dbs-preview-bar,.dbs-selected-side,.dbs-search-box,.dbs-selected-header,.dbs-related-header,.dbs-settings-head,.dbs-settings-footer,.dbs-detail-footer){background:var(--eagle-vue-panel)!important;border-color:var(--eagle-vue-border)!important}
.dbs-root.eagle-vue-default-blue :is(.dbs-left,.dbs-right,.dbs-collapsed-panel,.dbs-modal,.dbs-settings-nav,.dbs-setting-section,.dbs-setting-desc,.dbs-profile-list,.dbte-inspector){background:var(--eagle-vue-surface)!important;border-color:var(--eagle-vue-border)!important}
.dbs-root.eagle-vue-default-blue :is(.dbs-layout,.dbs-collapsed-tools,.dbs-settings-content){background:var(--eagle-vue-bg)!important}
.dbs-root.eagle-vue-default-blue :is(.dbs-btn,.dbg-btn,.dbs-detail-btn,.dbs-select,.dbte-toggle,.dbte-remove,.dbcm-tag,.dbcm-tabs button){background:var(--eagle-vue-surface-alt)!important;border-color:var(--eagle-vue-border)!important;color:var(--eagle-vue-text)!important}
.dbs-root.eagle-vue-default-blue :is(.dbs-input,.dbs-input-line,.dbte-kind-select,.dbte-translation input,.dbte-weight){background:var(--eagle-vue-input)!important;border-color:var(--eagle-vue-border)!important;color:var(--eagle-vue-text)!important}
.dbs-root.eagle-vue-default-blue :is(.dbs-row.selected,.dbs-btn.primary,.dbg-btn.primary,.dbs-detail-btn.primary,.dbs-settings-nav button.active){background:#294b79!important;border-color:var(--eagle-vue-primary)!important}

/* Wallhaven gallery. */
.whg-root.eagle-vue-default-blue :is(.whg-preview,.whg-header,.whg-footer){background:var(--eagle-vue-panel)!important;border-color:var(--eagle-vue-border)!important}
.whg-root.eagle-vue-default-blue :is(.whg-settings-panel,.whg-dropdown-menu,.whg-preview-thumb,.whg-btn){background:var(--eagle-vue-surface)!important;border-color:var(--eagle-vue-border)!important}
.whg-root.eagle-vue-default-blue :is(.whg-search,.whg-settings-panel input,.whg-settings-github){background:var(--eagle-vue-input)!important;border-color:var(--eagle-vue-border)!important;color:var(--eagle-vue-text)!important}
.whg-root.eagle-vue-default-blue :is(.whg-btn.primary,.whg-btn.active){background:var(--eagle-vue-primary)!important;border-color:var(--eagle-vue-primary)!important;color:#fff!important}
`;

function injectThemeStyle() {
  let style = document.getElementById("eagle-vue-default-theme-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "eagle-vue-default-theme-style";
    document.head.appendChild(style);
  }
  if (style.textContent !== THEME_CSS) style.textContent = THEME_CSS;
}

let scheduled = false;
let lastDefault = null;
export function refreshEagleVueTheme() {
  scheduled = false;
  injectThemeStyle();
  const useBlue = isComfyDefaultTheme();
  document.querySelectorAll(ROOT_SELECTOR).forEach((root) => {
    root.classList.toggle("eagle-vue-default-blue", useBlue);
  });
  lastDefault = useBlue;
}

function scheduleRefresh() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(refreshEagleVueTheme);
}

function startThemeBridge() {
  injectThemeStyle();
  scheduleRefresh();
  const paletteObserver = new MutationObserver(scheduleRefresh);
  paletteObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-color-palette"] });
  if (document.body) paletteObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-color-palette"] });
  const mountObserver = new MutationObserver(scheduleRefresh);
  if (document.body) mountObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("storage", scheduleRefresh);
  // The legacy settings API does not emit a public palette-change event.
  setInterval(() => {
    const next = isComfyDefaultTheme();
    if (next !== lastDefault) scheduleRefresh();
  }, 1200);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startThemeBridge, { once: true });
else startThemeBridge();
