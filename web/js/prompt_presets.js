import { app } from "../../../scripts/app.js";
import { createApp, h, ref, reactive, computed, onMounted, onUnmounted, watch } from "../lib/vue.esm-browser.js";

// ============ 样式加载 ============
// 提示词预设不依赖通用画廊主题：通用主题不会覆盖 pp-* 专用类，缺失时会退回
// 到浏览器原生白色 button。样式必须限定在本节点根元素内，避免影响其他 Vue 节点。
function loadStyles() {
  ["eagle-prompt-presets-style", "eagle-prompt-presets-style-v2"].forEach(function(id) {
    var staleStyle = document.getElementById(id);
    if (staleStyle) staleStyle.remove();
  });
  // Reuse the node but always refresh its contents. ComfyUI can hot-reload
  // extensions without rebuilding <head>; returning here would leave an old
  // layout active until the whole browser process was restarted.
  var styleId = "eagle-prompt-presets-style-v3";
  var style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = `
    .eagle-prompt-presets-root, .eagle-prompt-presets-root * { box-sizing: border-box; }
    .eagle-prompt-presets-root {
      width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden;
      position: relative; display: flex; flex-direction: column; isolation: isolate;
      color: var(--fg-color, #e8ebf2); background: var(--comfy-menu-bg, #17181e);
      font-family: inherit; font-size: 13px; line-height: 1.35;
      --ppui-primary: #4a7de0; --ppui-primary-hover: #5a8fe0;
      --ppui-danger: #a43a3a; --ppui-danger-hover: #bd4747;
      --ppui-bg: var(--comfy-menu-bg, #17181e); --ppui-surface: #1c1e26;
      --ppui-surface-alt: #242631; --ppui-border: #3a3e4c;
      --ppui-text: var(--fg-color, #e8ebf2); --ppui-muted: #9aa2b1; --ppui-radius: 7px;
    }
    .eagle-prompt-presets-root button,
    .eagle-prompt-presets-root input,
    .eagle-prompt-presets-root select,
    .eagle-prompt-presets-root textarea { font: inherit; color: inherit; }
    .eagle-prompt-presets-root button { appearance: none; cursor: pointer; }
    .eagle-prompt-presets-root .ppui-toolbar {
      flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
      padding: 10px 12px; background: #191a21; border-bottom: 1px solid #30323d;
    }
    .eagle-prompt-presets-root .ppui-btn,
    .eagle-prompt-presets-root .ppui-mode-toggle button,
    .eagle-prompt-presets-root .ppui-mode-toggle > span {
      min-height: 34px; padding: 6px 11px; border: 1px solid #3a3d4b; border-radius: 7px;
      display: inline-flex; align-items: center; justify-content: center;
      background: #242631; color: #e6e9f0; cursor: pointer; user-select: none;
    }
    .eagle-prompt-presets-root .ppui-btn:hover,
    .eagle-prompt-presets-root .ppui-mode-toggle button:hover,
    .eagle-prompt-presets-root .ppui-mode-toggle > span:hover { background: #303341; }
    .eagle-prompt-presets-root .ppui-mode-toggle { display: flex; gap: 5px; }
    .eagle-prompt-presets-root .ppui-mode-toggle .active { background: #2765b8; border-color: #4b8ee8; color: #fff; }
    .eagle-prompt-presets-root .ppui-search {
      flex: 1 1 210px; min-width: 160px; height: 34px; padding: 6px 10px;
      background: #111217; border: 1px solid #383b49; border-radius: 7px; outline: none;
    }
    .eagle-prompt-presets-root .ppui-search:focus,
    .eagle-prompt-presets-root input:focus,
    .eagle-prompt-presets-root textarea:focus,
    .eagle-prompt-presets-root select:focus { border-color: #4c8ce5; outline: none; }
    .eagle-prompt-presets-root .ppui-main {
      flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column;
    }
    .eagle-prompt-presets-root .ppui-sidebar.pp-master {
      min-width: 0 !important; min-height: 0 !important; overflow: auto !important; padding: 10px !important;
      display: block !important; grid-template-columns: none !important;
      background: #14151b !important; border-right: 1px solid #30323d !important;
    }
    .eagle-prompt-presets-root .pp-master-item {
      width: 100% !important; min-width: 0; min-height: 66px; margin: 0 0 8px; padding: 8px;
      display: grid !important; grid-template-columns: 46px minmax(0, 1fr) auto !important; gap: 9px; align-items: center;
      text-align: left; border: 1px solid #303442; border-radius: 9px;
      background: #20222b !important; color: #edf0f8 !important; transition: background .14s ease, border-color .14s ease;
    }
    .eagle-prompt-presets-root .pp-master-item:hover { background: #292c38; border-color: #4e78ae; }
    .eagle-prompt-presets-root .pp-master-item.active { background: #203b63; border-color: #4c8de7; box-shadow: inset 3px 0 #69a6ff; }
    .eagle-prompt-presets-root .pp-master-cover {
      width: 46px; height: 46px; object-fit: cover; border-radius: 7px; background: #34384a;
    }
    .eagle-prompt-presets-root .pp-cover-placeholder {
      display: grid; place-items: center; color: #b8c9e9; font-weight: 700; font-size: 18px;
      background: linear-gradient(145deg, #3d356c, #244564);
    }
    .eagle-prompt-presets-root .pp-master-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .eagle-prompt-presets-root .pp-master-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
    .eagle-prompt-presets-root .pp-master-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #a4abba; font-size: 11px; }
    .eagle-prompt-presets-root .pp-var-count { color: #8ec0ff; font-size: 11px; white-space: nowrap; }
    .eagle-prompt-presets-root .pp-master-group { margin: 0 0 10px; }
    .eagle-prompt-presets-root .pp-master-group-head {
      width: 100%; display: flex; align-items: center; gap: 7px; padding: 5px 4px 7px;
      border: 0; background: transparent; color: #aeb8ca; text-align: left;
    }
    .eagle-prompt-presets-root .pp-master-group-title { font-weight: 700; }
    .eagle-prompt-presets-root .pp-master-group-count { margin-left: auto; font-size: 11px; color: #72809a; }
    .eagle-prompt-presets-root .pp-master-group-items { display: flex; flex-direction: column; min-width: 0; }
    /* ── 详情面板（右侧） ────────────────────────────── */
    .eagle-prompt-presets-root .pp-detail {
      display: flex; flex-direction: column; min-width: 0; min-height: 0;
      overflow-y: auto; overflow-x: hidden;
      padding: 15px 17px; background: #191a20; height: 100%;
    }
    .eagle-prompt-presets-root .pp-detail-head { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 14px; flex-shrink: 0; }
    .eagle-prompt-presets-root .pp-detail-identity { min-width: 0; display: flex; align-items: center; gap: 10px; flex: 1; }
    .eagle-prompt-presets-root .pp-detail-cover { width: 58px; height: 58px; object-fit: cover; border-radius: 9px; background: #31354a; }
    .eagle-prompt-presets-root .pp-detail-title { margin: 0; font-size: 19px; color: #f4f6fb; }
    .eagle-prompt-presets-root .pp-detail-subtitle { margin-top: 3px; color: #a7adba; }
    .eagle-prompt-presets-root .pp-detail-tools { margin-left: auto; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; flex-shrink: 0; }
    .eagle-prompt-presets-root .pp-detail-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 15px; flex-shrink: 0; }
    .eagle-prompt-presets-root .pp-detail-scroll { min-width: 0; flex: 1; }
    .eagle-prompt-presets-root .pp-detail-section { margin: 11px 0; padding: 12px; border: 1px solid #30333f; border-radius: 9px; background: #202127; }
    .eagle-prompt-presets-root .pp-detail-section h4 { margin: 0 0 8px; color: #c8d2e5; }
    .eagle-prompt-presets-root .pp-section-label { color: #cbd6eb; font-weight: 700; }
    .eagle-prompt-presets-root .pp-example-line { margin-top: 8px; color: #aab2c1; font-style: italic; }
    .eagle-prompt-presets-root .pp-template-source,
    .eagle-prompt-presets-root .pp-output-preview,
    .eagle-prompt-presets-root .pp-markdown-preview {
      width: 100%; min-height: 92px; padding: 11px; overflow: auto; border: 1px solid #333743;
      border-radius: 7px; background: #111217; color: #d7f1dc; white-space: pre-wrap; font-family: Consolas, monospace;
    }
    .eagle-prompt-presets-root .pp-variable-row { display: flex; align-items: center; gap: 8px; margin: 7px 0; }
    .eagle-prompt-presets-root .pp-variable-row label { min-width: 92px; color: #bfc6d4; }
    .eagle-prompt-presets-root .pp-variable-row input,
    .eagle-prompt-presets-root textarea,
    .eagle-prompt-presets-root select { background: #111217; border: 1px solid #383b49; border-radius: 6px; padding: 7px 9px; }
    .eagle-prompt-presets-root .pp-variable-row input { flex: 1; min-width: 0; }
    .eagle-prompt-presets-root .pp-var-heading,
    .eagle-prompt-presets-root .pp-preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .eagle-prompt-presets-root .pp-section-hint { color: #8b94a5; font-size: 11px; }
    .eagle-prompt-presets-root .pp-external-hint { color: #75c4ff; }
    .eagle-prompt-presets-root .pp-var-switcher { display: flex; gap: 8px; margin: 10px 0; }
    .eagle-prompt-presets-root .pp-var-switcher .pp-var-select { flex: 0 0 150px; min-width: 0; }
    .eagle-prompt-presets-root .pp-var-switcher .pp-var-input { flex: 1; min-width: 0; }
    .eagle-prompt-presets-root .pp-var-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
    .eagle-prompt-presets-root .pp-var-tag { padding: 3px 8px; border: 1px solid #3c526f; border-radius: 5px; background: #1c314b; color: #b7d9ff; }
    .eagle-prompt-presets-root .pp-var-tag.active { background: #2368b5; border-color: #70adf5; color: #fff; }
    .eagle-prompt-presets-root .pp-var-tag.external { border-color: #5d8e86; color: #a7e8d8; }
    .eagle-prompt-presets-root .pp-var-source { margin-left: 4px; font-size: 10px; }
    .eagle-prompt-presets-root .pp-preview-mode { display: flex; gap: 5px; }
    .eagle-prompt-presets-root .pp-preview-markdown,
    .eagle-prompt-presets-root .pp-preview-textarea { width: 100%; min-height: 100px; margin-top: 9px; padding: 10px; border: 1px solid #333743; border-radius: 7px; background: #111217; color: #d7f1dc; overflow: auto; white-space: pre-wrap; }
    .eagle-prompt-presets-root .pp-preview-markdown { white-space: normal; overflow-wrap: anywhere; }
    .eagle-prompt-presets-root .pp-preview-markdown h1,
    .eagle-prompt-presets-root .pp-preview-markdown h2,
    .eagle-prompt-presets-root .pp-preview-markdown h3,
    .eagle-prompt-presets-root .pp-preview-markdown h4,
    .eagle-prompt-presets-root .pp-preview-markdown h5,
    .eagle-prompt-presets-root .pp-preview-markdown h6 { margin: .75em 0 .4em; line-height: 1.25; color: #edf2ff; }
    .eagle-prompt-presets-root .pp-preview-markdown p { margin: .55em 0; }
    .eagle-prompt-presets-root .pp-preview-markdown ul,
    .eagle-prompt-presets-root .pp-preview-markdown ol { margin: .5em 0; padding-left: 1.6em; }
    .eagle-prompt-presets-root .pp-preview-markdown a { color: #77b7ff; text-decoration: none; }
    .eagle-prompt-presets-root .pp-preview-markdown a:hover { text-decoration: underline; }
    .eagle-prompt-presets-root .pp-preview-markdown code { padding: 1px 4px; border-radius: 4px; background: #252835; color: #ffd8a8; }
    .eagle-prompt-presets-root .pp-preview-markdown pre code { padding: 0; background: transparent; color: inherit; }
    .eagle-prompt-presets-root .pp-preview-markdown hr { border: 0; border-top: 1px solid #393d49; margin: 12px 0; }
    .eagle-prompt-presets-root .ppui-btn.primary { background: #2765b8; border-color: #4b8ee8; color: #fff; }
    .eagle-prompt-presets-root .ppui-toolbar-sep { flex: 1 1 auto; min-width: 8px; }
    .eagle-prompt-presets-root .ppui-badge {
      display: inline-flex; align-items: center; min-height: 22px; padding: 2px 7px;
      border: 1px solid #46506a; border-radius: 999px; background: #282c3a;
      color: #c8d4e8; font-size: 11px; white-space: nowrap;
    }
    .eagle-prompt-presets-root .ppui-btn-sm { min-height: 28px; padding: 4px 8px; }
    .eagle-prompt-presets-root .ppui-danger {
      border-color: #c14b4b; background: var(--ppui-danger); color: #fff;
    }
    .eagle-prompt-presets-root .ppui-danger:hover { background: var(--ppui-danger-hover); }
    .eagle-prompt-presets-root .ppui-border { border: 1px solid var(--ppui-border); }
    .eagle-prompt-presets-root .ppui-loading,
    .eagle-prompt-presets-root .ppui-error {
      display: grid; place-items: center; min-height: 120px; padding: 16px;
      color: var(--ppui-muted); text-align: center;
    }
    .eagle-prompt-presets-root .ppui-error { color: #ff9b9b; }
    .eagle-prompt-presets-root .ppui-settings-row {
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0;
    }
    .eagle-prompt-presets-root .ppui-settings-hint {
      display: block; margin-top: 5px; color: var(--ppui-muted); font-size: 11px;
    }
    .eagle-prompt-presets-root .pp-empty,
    .eagle-prompt-presets-root .ppui-empty { display: grid; place-items: center; min-height: 180px; color: #7e8594; }
    .eagle-prompt-presets-root .pp-md-code { padding: 10px; border-radius: 6px; background: #111217; overflow: auto; }
    .eagle-prompt-presets-root .pp-md-quote { border-left: 3px solid #4b89df; margin: 8px 0; padding-left: 10px; color: #c3cad7; }
    .eagle-prompt-presets-root .pp-md-table { width: 100%; border-collapse: collapse; }
    .eagle-prompt-presets-root .pp-md-table td, .eagle-prompt-presets-root .pp-md-table th { padding: 5px; border: 1px solid #3b3d49; text-align: left; }
    .eagle-prompt-presets-root .ppui-settings-backdrop {
      position: absolute !important; inset: 0 !important; z-index: 50; display: flex !important;
      align-items: center; justify-content: center; padding: 16px; overflow: auto;
      background: rgba(7, 8, 12, .72);
    }
    .eagle-prompt-presets-root .ppui-settings-panel {
      width: min(600px, 100%) !important; max-height: calc(100% - 12px) !important;
      padding: 16px !important; overflow: auto !important; border: 1px solid #3a3e4c;
      border-radius: 10px; background: #1c1e26 !important; box-shadow: 0 18px 48px rgba(0,0,0,.5);
    }
    .eagle-prompt-presets-root .pp-cover-editor { display: flex; gap: 10px; padding: 10px; border: 1px dashed #4b5266; border-radius: 8px; background: #15161c; }
    .eagle-prompt-presets-root .pp-cover-fallback { width: 80px; height: 80px; display: grid; place-items: center; border-radius: 6px; background: #334461; color: #dbeaff; font-size: 24px; font-weight: 700; }
    /* ── 导演技能面板 ────────────────────────────── */
    .eagle-prompt-presets-root .pp-director-layout {
      display: grid; grid-template-columns: 220px 1fr; width: 100%; height: 100%;
      min-width: 0; min-height: 0; overflow: hidden; flex: 1;
    }
    .eagle-prompt-presets-root .pp-director-sidebar {
      display: flex; flex-direction: column; min-height: 0; overflow: hidden;
      background: #14151b; border-right: 1px solid #30323d;
    }
    .eagle-prompt-presets-root .pp-sidebar-head {
      flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px; border-bottom: 1px solid #30323d;
    }
    .eagle-prompt-presets-root .pp-sidebar-head h3 { margin: 0; font-size: 13px; color: #c8d4e8; }
    .eagle-prompt-presets-root .pp-skills-list {
      flex: 1; overflow-y: auto; overflow-x: hidden; padding: 8px;
      display: flex; flex-direction: column; gap: 6px;
    }
    .eagle-prompt-presets-root .pp-skill-item {
      width: 100%; padding: 8px 10px; text-align: left; border: 1px solid #2e3040;
      border-radius: 7px; background: #20222b; color: #e0e4ef; cursor: pointer;
    }
    .eagle-prompt-presets-root .pp-skill-item:hover { background: #292d3d; border-color: #4a6fa0; }
    .eagle-prompt-presets-root .pp-skill-item.active { background: #1d3557; border-color: #4c8de7; }
    .eagle-prompt-presets-root .pp-skill-name { font-weight: 600; font-size: 13px; }
    .eagle-prompt-presets-root .pp-skill-meta { color: #8a90a0; font-size: 11px; margin-top: 2px; }
    .eagle-prompt-presets-root .pp-director-main {
      display: flex; flex-direction: column; min-height: 0; overflow: hidden; background: #191a20;
    }
    .eagle-prompt-presets-root .pp-director-toolbar {
      flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; border-bottom: 1px solid #2c2e38; background: #1e1f27;
    }
    .eagle-prompt-presets-root .pp-director-tools { display: flex; gap: 7px; }
    .eagle-prompt-presets-root .pp-director-content {
      flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden;
      padding: 12px 14px; display: flex; flex-direction: column; gap: 12px;
    }
    .eagle-prompt-presets-root .pp-director-section { display: flex; flex-direction: column; gap: 6px; }
    .eagle-prompt-presets-root .pp-director-editor {
      width: 100%; min-height: 240px; resize: vertical; font-family: ui-monospace, Consolas, monospace;
      font-size: 12px; line-height: 1.5;
    }
    .eagle-prompt-presets-root .pp-director-preview {
      min-height: 80px; max-height: 240px; overflow: auto; padding: 10px;
      border: 1px solid #333743; border-radius: 7px; background: #111217;
      color: #d7f1dc; white-space: normal; overflow-wrap: anywhere;
    }
    .eagle-prompt-presets-root .pp-filmstrip-grid {
      display: flex; flex-wrap: wrap; gap: 8px; padding: 8px;
      border: 2px dashed #3a3e4c; border-radius: 8px; min-height: 80px;
      background: #15161c;
    }
    .eagle-prompt-presets-root .pp-filmstrip-item {
      position: relative; width: 80px; height: 60px; border-radius: 6px; overflow: hidden;
      border: 1px solid #3a3e4c;
    }
    .eagle-prompt-presets-root .pp-filmstrip-item img { width: 100%; height: 100%; object-fit: cover; }
    .eagle-prompt-presets-root .pp-filmstrip-remove {
      position: absolute; top: 2px; right: 2px; width: 18px; height: 18px;
      border: none; border-radius: 50%; background: rgba(160,40,40,.85); color: #fff;
      font-size: 12px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center;
    }
    .eagle-prompt-presets-root .pp-filmstrip-add {
      display: flex; align-items: center; justify-content: center;
      width: 80px; height: 60px; border-radius: 6px; border: 1px dashed #4a5268;
      background: #1e2130; color: #8a90a0; font-size: 12px; cursor: pointer;
    }
    .eagle-prompt-presets-root .pp-filmstrip-add:hover { background: #252840; border-color: #5a7db0; color: #b0c4e8; }
    @media (max-width: 700px) {
      .eagle-prompt-presets-root .ppui-main { grid-template-columns: minmax(180px, 42%) minmax(0, 1fr); }
      .eagle-prompt-presets-root .pp-master-item { grid-template-columns: 38px minmax(0, 1fr); }
      .eagle-prompt-presets-root .pp-master-cover { width: 38px; height: 38px; }
      .eagle-prompt-presets-root .pp-var-count { display: none; }
      .eagle-prompt-presets-root .pp-director-layout { grid-template-columns: 1fr; }
    }
  `;
}


// ============ 工具函数（保持不变）============
function generateId() {
  return 'tpl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function extractVariables(text) {
  const matches = String(text || "").match(/\{\{\s*(\w+)\s*\}\}/g) || [];
  return [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '').trim()))];
}

// ... 其他工具函数保持不变 ...

// ============ 子组件：模板编辑器（使用统一样式）============
var TemplateEditor = {
  name: "TemplateEditor",
  props: {
    visible: Boolean,
    template: Object,
    onClose: Function,
    onSave: Function
  },
  setup: function(props) {
    var coverInput = ref(null);
    var coverUploading = ref(false);
    var form = reactive({
      id: '',
      Label: '',
      Instruction: '',
      example: '',
      category: '图片编辑 (kontext)',
      tags: [],
      cover: ''
    });

    var variables = computed(function() {
      return extractVariables(form.Instruction);
    });

    watch(() => props.template, function(newVal) {
      if (newVal) {
        Object.assign(form, {
          id: '', Label: '', Instruction: '', example: '',
          category: '图片编辑 (kontext)', tags: [], cover: '', source: 'user'
        }, newVal);
      } else {
        Object.assign(form, {
          id: '', Label: '', Instruction: '', example: '',
          category: '图片编辑 (kontext)', tags: [], cover: ''
        });
      }
    }, { immediate: true });

    function handleSave() {
      if (!form.Label || !form.Instruction) {
        alert('请填写标签名称和指令模板');
        return;
      }
      props.onSave({ ...form });
    }

    async function uploadCover(file) {
      if (!file || !String(file.type || "").startsWith("image/")) {
        alert("请拖入或选择图片文件");
        return;
      }
      coverUploading.value = true;
      try {
        var body = new FormData();
        body.append("file", file, file.name || "cover.png");
        var response = await fetch("/eaglePromptPresets/upload_cover", { method: "POST", body: body });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || "封面上传失败");
        form.cover = data.path;
      } catch (error) {
        alert(error.message || String(error));
      } finally {
        coverUploading.value = false;
        if (coverInput.value) coverInput.value.value = "";
      }
    }

    return function() {
      if (!props.visible) return null;

      // ✅ 使用统一样式类名
      return h("div", { class: "ppui-settings-backdrop show", onClick: props.onClose }, [
        h("div", {
          class: "ppui-settings-panel",
          style: { width: "600px", maxHeight: "90vh", overflowY: "auto" },
          onClick: function(e) { e.stopPropagation(); }
        }, [
          // 标题栏
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" } }, [
            h("h3", { style: { margin: 0, fontSize: "16px" } }, props.template?.id ? "✏️ 编辑模板" : "➕ 新建模板"),
            h("button", {
              class: "ppui-btn",
              style: { padding: "2px 8px" },
              onClick: props.onClose
            }, "×")
          ]),

          // 表单内容
          h("div", { style: { display: "flex", flexDirection: "column", gap: "12px" } }, [
            // 标签名称
            h("div", {}, [
              h("label", { style: { display: "block", marginBottom: "4px", color: "#aaa", fontSize: "12px" } }, "标签名称"),
              h("input", {
                class: "ppui-search",
                type: "text",
                value: form.Label,
                placeholder: "例：移除物体",
                onInput: function(e) { form.Label = e.target.value; }
              })
            ]),

            // 分类
            h("div", {}, [
              h("label", { style: { display: "block", marginBottom: "4px", color: "#aaa", fontSize: "12px" } }, "分类"),
              h("input", {
                class: "ppui-search",
                type: "text",
                value: form.category,
                placeholder: "例：图片编辑",
                onInput: function(e) { form.category = e.target.value; }
              })
            ]),

            // 封面上传
            h("div", {}, [
              h("label", { style: { display: "block", marginBottom: "4px", color: "#aaa", fontSize: "12px" } }, [
                "小封面 ",
                h("span", { class: "ppui-settings-hint", style: { display: "inline" } }, "(可选：URL 或本地路径)")
              ]),
              h("div", {
                class: "pp-cover-editor",
                style: coverUploading.value ? { opacity: 0.6, pointerEvents: "none" } : {},
                onDragover: function(e) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; },
                onDrop: function(e) { e.preventDefault(); uploadCover(e.dataTransfer.files && e.dataTransfer.files[0]); }
              }, [
                form.cover
                  ? h("img", { src: templateCoverUrl(form.cover), style: { width: "80px", height: "80px", objectFit: "cover", borderRadius: "4px" } })
                  : h("span", { class: "pp-cover-fallback" }, (form.Label || "P").slice(0, 1)),
                h("div", { style: { flex: 1, display: "flex", flexDirection: "column", gap: "8px" } }, [
                  h("input", {
                    class: "ppui-search",
                    type: "text",
                    value: form.cover || "",
                    placeholder: "拖入图片，或填写 URL / 本地路径",
                    onInput: function(e) { form.cover = e.target.value; }
                  }),
                  h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, [
                    h("button", {
                      class: "ppui-btn",
                      disabled: coverUploading.value,
                      onClick: function() { coverInput.value && coverInput.value.click(); }
                    }, coverUploading.value ? "上传中…" : "选择封面"),
                    h("span", { class: "ppui-settings-hint" }, "支持 PNG/JPG/WebP/GIF，最大 8MB"),
                    h("input", {
                      ref: coverInput,
                      type: "file",
                      accept: "image/png,image/jpeg,image/webp,image/gif",
                      style: "display:none",
                      onChange: function(e) { uploadCover(e.target.files && e.target.files[0]); }
                    })
                  ])
                ])
              ])
            ]),

            // 指令模板
            h("div", {}, [
              h("label", { style: { display: "block", marginBottom: "4px", color: "#aaa", fontSize: "12px" } }, [
                "指令模板 ",
                h("span", { class: "ppui-settings-hint", style: { display: "inline" } }, "(使用 {{变量名}} 作为占位符)")
              ]),
              h("textarea", {
                class: "ppui-search",
                style: { width: "100%", minHeight: "80px", resize: "vertical", fontFamily: "monospace" },
                value: form.Instruction,
                placeholder: "例：remove the {{target}} from {{position}}",
                onInput: function(e) { form.Instruction = e.target.value; }
              }),
              variables.value.length > 0 && h("div", { class: "pp-variables", style: { marginTop: "8px" } }, [
                h("span", { style: { color: "#888", fontSize: "11px" } }, "检测到变量："),
                ...variables.value.map(function(v) {
                  return h("span", { class: "pp-var-tag" }, "{{" + v + "}}");
                })
              ])
            ]),

            // 示例
            h("div", {}, [
              h("label", { style: { display: "block", marginBottom: "4px", color: "#aaa", fontSize: "12px" } }, "示例"),
              h("textarea", {
                class: "ppui-search",
                style: { width: "100%", minHeight: "60px", resize: "vertical" },
                value: form.example,
                placeholder: "例：remove the grapes from the left side",
                onInput: function(e) { form.example = e.target.value; }
              })
            ])
          ]),

          // 底部按钮
          h("div", { class: "ppui-settings-row", style: { marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--ppui-border)" } }, [
            h("button", { class: "ppui-btn", onClick: props.onClose }, "取消"),
            h("button", { class: "ppui-btn primary", onClick: handleSave }, "保存")
          ])
        ])
      ]);
    };
  }
};

// ============ 子组件：导入对话框（使用统一样式）============
var ImportDialog = {
  name: "ImportDialog",
  props: {
    visible: Boolean,
    onClose: Function,
    onImported: Function
  },
  setup: function(props) {
    var fileInput = ref(null);
    var importing = ref(false);

    function handleImport() {
      if (!fileInput.value) return;
      fileInput.value.click();
    }

    function handleFileChange(e) {
      var file = e.target.files[0];
      if (!file) return;

      importing.value = true;
      var formData = new FormData();
      formData.append('file', file);

      fetch('/eaglePromptPresets/import_file', {
        method: 'POST',
        body: formData
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        importing.value = false;
        if (d.success) {
          alert('✅ 成功导入 ' + d.imported_count + ' 个模板');
          props.onImported();
          props.onClose();
        } else {
          alert('❌ 导入失败：' + d.error);
        }
      })
      .catch(function(e) {
        importing.value = false;
        alert('❌ 导入出错：' + e.message);
      });
    }

    return function() {
      if (!props.visible) return null;

      return h("div", { class: "ppui-settings-backdrop show", onClick: props.onClose }, [
        h("div", {
          class: "ppui-settings-panel",
          style: { width: "400px" },
          onClick: function(e) { e.stopPropagation(); }
        }, [
          h("h3", {}, "📁 导入模板文件"),
          
          h("input", {
            ref: fileInput,
            type: "file",
            accept: ".json,.txt",
            style: "display:none",
            onChange: handleFileChange
          }),

          h("div", { style: { textAlign: "center", padding: "20px 0" } }, [
            h("div", { style: { fontSize: "48px", marginBottom: "16px" } }, "📄"),
            h("p", { style: { color: "#aaa", marginBottom: "12px" } }, "支持的文件格式："),
            h("ul", { style: { listStyle: "none", padding: 0, color: "#888", fontSize: "12px" } }, [
              h("li", {}, "• JSON - 结构化模板数据"),
              h("li", {}, "• TXT - 纯文本提示词（每行一条）")
            ]),
            h("button", {
              class: "ppui-btn primary",
              style: { marginTop: "16px", width: "200px" },
              onClick: handleImport,
              disabled: importing.value
            }, importing.value ? "导入中..." : "选择文件")
          ])
        ])
      ]);
    };
  }
};

// ============ 子组件：设置对话框（使用统一样式）============
var SettingsDialog = {
  name: "SettingsDialog",
  props: {
    node: Object,
    visible: Boolean,
    onClose: Function,
    onSaved: Function
  },
  setup: function(props) {
    function nodeWidget(name) {
      var widgets = props.node && Array.isArray(props.node.widgets) ? props.node.widgets : [];
      return widgets.find(function(widget) { return widget.name === name; });
    }

    function parseObject(value, fallback) {
      try {
        var parsed = JSON.parse(String(value || ""));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
      } catch (error) {
        return fallback;
      }
    }

    var stateWidget = nodeWidget("ui_state");
    var localVariablesWidget = nodeWidget("local_variables");
    var directorSkillWidget = nodeWidget("selected_director_skill");
    var restoredState = parseObject(stateWidget && stateWidget.value, {});
    var restoredVariables = parseObject(localVariablesWidget && localVariablesWidget.value, {});
    var loading = ref(true);
    var saving = ref(false);
    var testing = ref(false);
    var testResult = ref(null);
    
    var config = reactive({
      obsidian: {
        enabled: false,
        api_url: "https://127.0.0.1:27124",
        api_key: "",
        vault_path: "",
        prompts_folder: "ComfyUI/Prompts"
      },
      local_paths: [],
      auto_sync: true,
      default_category: "自定义"
    });

    onMounted(async function() {
      if (!props.visible) return;
      loading.value = true;
      try {
        var response = await fetch("/eaglePromptPresets/config");
        var data = await response.json();
        if (data.success) Object.assign(config, data.data);
      } catch (e) {
        console.error("加载配置失败:", e);
      } finally {
        loading.value = false;
      }
    });

    watch(() => props.visible, async function(newVal) {
      if (!newVal) return;
      loading.value = true;
      try {
        var response = await fetch("/eaglePromptPresets/config");
        var data = await response.json();
        if (data.success) Object.assign(config, data.data);
      } catch (e) {
        console.error("加载配置失败:", e);
      } finally {
        loading.value = false;
      }
    });

    async function handleSave() {
      saving.value = true;
      try {
        var response = await fetch("/eaglePromptPresets/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: config })
        });
        var data = await response.json();
        if (data.success) {
          alert("✅ 配置已保存");
          props.onSaved && props.onSaved();
          props.onClose();
        } else {
          alert("❌ 保存失败：" + data.error);
        }
      } catch (e) {
        alert("❌ 保存出错：" + e.message);
      } finally {
        saving.value = false;
      }
    }

    async function handleTest() {
      testing.value = true;
      testResult.value = null;
      try {
        var response = await fetch("/eaglePromptPresets/test_obsidian", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config.obsidian)
        });
        var data = await response.json();
        testResult.value = data;
      } catch (e) {
        testResult.value = { success: false, error: e.message };
      } finally {
        testing.value = false;
      }
    }

    return function() {
      if (!props.visible) return null;

      return h("div", { class: "ppui-settings-backdrop show", onClick: props.onClose }, [
        h("div", {
          class: "ppui-settings-panel",
          style: { width: "600px", maxHeight: "90vh", overflowY: "auto" },
          onClick: function(e) { e.stopPropagation(); }
        }, [
          h("h3", {}, "⚙️ 设置"),

          loading.value ? h("div", { class: "ppui-loading" }, "加载中...") : [
            // Obsidian 集成
            h("div", { style: { marginBottom: "20px" } }, [
              h("h4", { style: { margin: "0 0 12px", fontSize: "14px", color: "#eee" } }, "Obsidian 集成"),
              
              h("label", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", cursor: "pointer" } }, [
                h("input", {
                  type: "checkbox",
                  checked: config.obsidian.enabled,
                  onChange: function(e) { config.obsidian.enabled = e.target.checked; }
                }),
                h("span", { style: { color: "#aaa", fontSize: "12px" } }, "启用 Obsidian Vault 同步")
              ]),

              config.obsidian.enabled && [
                h("div", { style: { marginBottom: "12px" } }, [
                  h("label", { class: "ppui-settings-hint" }, "Vault 本地路径（可选）"),
                  h("input", {
                    class: "ppui-search",
                    type: "text",
                    value: config.obsidian.vault_path,
                    placeholder: "例：C:/Users/你的用户名/Documents/ObsidianVault",
                    onInput: function(e) { config.obsidian.vault_path = e.target.value; }
                  })
                ]),

                h("div", { style: { marginBottom: "12px" } }, [
                  h("label", { class: "ppui-settings-hint" }, "提示词目录"),
                  h("input", {
                    class: "ppui-search",
                    type: "text",
                    value: config.obsidian.prompts_folder,
                    placeholder: "例：ComfyUI/Prompts",
                    onInput: function(e) { config.obsidian.prompts_folder = e.target.value; }
                  })
                ]),

                h("div", { style: { marginBottom: "12px" } }, [
                  h("label", { class: "ppui-settings-hint" }, "API 地址"),
                  h("input", {
                    class: "ppui-search",
                    type: "text",
                    value: config.obsidian.api_url,
                    placeholder: "https://127.0.0.1:27124",
                    onInput: function(e) { config.obsidian.api_url = e.target.value; }
                  })
                ]),

                h("div", { style: { marginBottom: "12px" } }, [
                  h("label", { class: "ppui-settings-hint" }, "API Key"),
                  h("input", {
                    class: "ppui-search",
                    type: "password",
                    value: config.obsidian.api_key,
                    placeholder: "从 Obsidian Local REST API 插件获取",
                    onInput: function(e) { config.obsidian.api_key = e.target.value; }
                  })
                ]),

                h("button", {
                  class: "ppui-btn",
                  disabled: testing.value,
                  onClick: handleTest
                }, testing.value ? "测试中..." : "🔍 测试连接"),

                testResult.value && h("div", {
                  style: {
                    marginTop: "12px",
                    padding: "8px 12px",
                    borderRadius: "4px",
                    background: testResult.value.success ? "rgba(76, 175, 80, 0.1)" : "rgba(244, 67, 54, 0.1)",
                    border: testResult.value.success ? "1px solid #4caf50" : "1px solid #f44336",
                    color: testResult.value.success ? "#81c784" : "#e57373"
                  }
                }, [
                  h("strong", {}, testResult.value.success ? "✅ 连接成功" : "❌ 连接失败"),
                  h("p", { style: { margin: "4px 0 0", fontSize: "11px" } }, testResult.value.message || testResult.value.error)
                ])
              ]
            ]),

            // 其他设置
            h("div", {}, [
              h("h4", { style: { margin: "0 0 12px", fontSize: "14px", color: "#eee" } }, "其他设置"),
              
              h("div", { style: { marginBottom: "12px" } }, [
                h("label", { class: "ppui-settings-hint" }, "默认分类"),
                h("input", {
                  class: "ppui-search",
                  type: "text",
                  value: config.default_category,
                  onInput: function(e) { config.default_category = e.target.value; }
                })
              ]),

              h("label", { style: { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" } }, [
                h("input", {
                  type: "checkbox",
                  checked: config.auto_sync,
                  onChange: function(e) { config.auto_sync = e.target.checked; }
                }),
                h("span", { style: { color: "#aaa", fontSize: "12px" } }, "自动同步模板")
              ])
            ])
          ],

          h("div", { class: "ppui-settings-row", style: { marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--ppui-border)" } }, [
            h("button", { class: "ppui-btn", onClick: props.onClose }, "取消"),
            h("button", {
              class: "ppui-btn primary",
              disabled: saving.value,
              onClick: handleSave
            }, saving.value ? "保存中..." : "保存")
          ])
        ])
      ]);
    };
  }
};

// ============ 主应用组件（工具栏和网格使用统一样式）============
var PromptPresetsApp = {
  name: "PromptPresetsApp",
  props: {
    node: Object,
    onApply: Function
  },
  setup: function(props) {
    function nodeWidget(name) {
      var widgets = props.node && Array.isArray(props.node.widgets) ? props.node.widgets : [];
      return widgets.find(function(widget) {
        return widget.name === name;
      });
    }

    function parseObject(value, fallback) {
      try {
        var parsed = typeof value === "string" ? JSON.parse(value || "{}") : value;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
      } catch (error) {
        return fallback;
      }
    }

    var stateWidget = nodeWidget("ui_state");
    var localVariablesWidget = nodeWidget("local_variables");
    var directorSkillWidget = nodeWidget("selected_director_skill");
    var restoredState = parseObject(stateWidget && stateWidget.value, {});
    var restoredVariables = parseObject(localVariablesWidget && localVariablesWidget.value, {});

    var loading = ref(true);
    var templates = ref([]);
    var categories = ref(["全部"]);
    var selectedCategory = ref("全部");
    var keyword = ref("");
    var selectedId = ref("");
    var activeVariable = ref("");
    var variableValues = reactive({});
    var externalVariableValues = reactive({});
    var previewMode = ref("markdown");
    var collapsedGroups = reactive({});
    var errorMessage = ref("");
    var showEditor = ref(false);
    var editingTemplate = ref(null);
    var showImport = ref(false);
    var showSettings = ref(false);
    var activeTab = ref("presets");
    var directorSkills = ref([]);
    var selectedSkillId = ref("");
    var skillContent = ref("");
    var skillFilmstrip = ref([]);
    var filmstripUploading = ref(false);
    var directorSkillsValue = ref("");
    var stateReady = false;

    if (typeof restoredState.selectedCategory === "string") selectedCategory.value = restoredState.selectedCategory;
    if (typeof restoredState.selectedId === "string") selectedId.value = restoredState.selectedId;
    if (typeof restoredState.activeVariable === "string") activeVariable.value = restoredState.activeVariable;
    if (restoredState.previewMode === "source" || restoredState.previewMode === "markdown") previewMode.value = restoredState.previewMode;
    if (restoredState.activeTab === "director" || restoredState.activeTab === "presets") activeTab.value = restoredState.activeTab;
    if (typeof restoredState.selectedSkillId === "string") selectedSkillId.value = restoredState.selectedSkillId;
    if (restoredState.collapsedGroups && typeof restoredState.collapsedGroups === "object") Object.assign(collapsedGroups, restoredState.collapsedGroups);
    if (restoredState.variableValues && typeof restoredState.variableValues === "object") Object.assign(variableValues, restoredState.variableValues);
    Object.assign(variableValues, restoredVariables);
    directorSkillsValue.value = String((directorSkillWidget && directorSkillWidget.value) || restoredState.directorSkillsValue || "");

    function persistUiState() {
      if (!stateReady) return;
      var nextState = {
        version: 1,
        selectedCategory: selectedCategory.value,
        selectedId: selectedId.value,
        activeVariable: activeVariable.value,
        previewMode: previewMode.value,
        activeTab: activeTab.value,
        selectedSkillId: selectedSkillId.value,
        directorSkillsValue: directorSkillsValue.value,
        collapsedGroups: Object.assign({}, collapsedGroups),
        variableValues: Object.assign({}, variableValues)
      };
      var currentStateWidget = nodeWidget("ui_state");
      var currentVariablesWidget = nodeWidget("local_variables");
      if (currentStateWidget) currentStateWidget.value = JSON.stringify(nextState);
      if (currentVariablesWidget) currentVariablesWidget.value = JSON.stringify(variableValues);
      props.node.setDirtyCanvas(true, true);
    }

    // ... 工具函数和计算属性保持不变 ...
    
    var filteredTemplates = computed(function() {
      var result = templates.value.slice();
      if (selectedCategory.value !== "全部") {
        result = result.filter(function(t) { return t.category === selectedCategory.value; });
      }
      if (keyword.value) {
        var kw = keyword.value.toLowerCase();
        result = result.filter(function(t) {
          return (t.Label || "").toLowerCase().includes(kw) ||
                 (t.Instruction || "").toLowerCase().includes(kw) ||
                 (t.example || "").toLowerCase().includes(kw) ||
                 (Array.isArray(t.tags) ? t.tags.join(" ").toLowerCase().includes(kw) : false);
        });
      }
      return result;
    });

    var selectedTemplate = computed(function() {
      return templates.value.find(function(t) { return templateKey(t) === selectedId.value; }) ||
        filteredTemplates.value[0] || null;
    });

    var selectedVariables = computed(function() {
      return selectedTemplate.value ? extractVariables(selectedTemplate.value.Instruction) : [];
    });

    var templateGroups = computed(function() {
      var groups = [];
      var byCategory = {};
      filteredTemplates.value.forEach(function(template) {
        var category = template.category || "未分类";
        if (!byCategory[category]) {
          byCategory[category] = { category: category, items: [] };
          groups.push(byCategory[category]);
        }
        byCategory[category].items.push(template);
      });
      return groups;
    });

    var renderedPrompt = computed(function() {
      if (!selectedTemplate.value) return "";
      var text = String(selectedTemplate.value.Instruction || "");
      selectedVariables.value.forEach(function(v) {
        var value = effectiveVariableValue(v);
        var replacement = value === undefined || value === "" ? "{{" + v + "}}" : String(value);
        text = text.replace(new RegExp("\\{\\{\\s*" + escapeRegExp(v) + "\\s*\\}\\}", "g"), function() { return replacement; });
      });
      return text;
    });

    function hasExternalVariable(name) {
      return Object.prototype.hasOwnProperty.call(externalVariableValues, name);
    }

    function effectiveVariableValue(name) {
      return hasExternalVariable(name) ? externalVariableValues[name] : variableValues[name];
    }

    function syncExternalVariables() {
      var next = readLinkedPromptVariables(props.node);
      var changed = false;
      Object.keys(externalVariableValues).forEach(function(name) {
        if (!Object.prototype.hasOwnProperty.call(next, name)) {
          delete externalVariableValues[name];
          changed = true;
        }
      });
      Object.keys(next).forEach(function(name) {
        if (externalVariableValues[name] !== next[name]) {
          externalVariableValues[name] = next[name];
          changed = true;
        }
      });
      return changed;
    }

    function escapeRegExp(value) {
      return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function templateKey(template) {
      if (!template) return "";
      return String(template.id || template.path || ((template.Label || "") + "::" + (template.Instruction || "")));
    }

    function sourceLabel(template) {
      if (!template) return "";
      if (template.source === "obsidian") return "Obsidian";
      if (template.source === "local") return "Local";
      if (template.source === "user") return "自定义";
      return "内置";
    }

    function isReadOnly(template) {
      return !template || template.source === "built-in" || template.source === "obsidian" || template.source === "local";
    }

    function ensureVariables(template) {
      var names = extractVariables((template && template.Instruction) || "");
      names.forEach(function(name) {
        if (variableValues[name] === undefined) variableValues[name] = "";
      });
      if (!names.includes(activeVariable.value)) activeVariable.value = names[0] || "";
      return names;
    }

    function selectTemplate(template) {
      if (!template) return;
      selectedId.value = templateKey(template);
      var names = ensureVariables(template);
      syncLinkedPromptVariableNames(props.node, names);
      applySelected();
    }

    async function loadTemplates() {
      loading.value = true;
      errorMessage.value = "";
      try {
        var response = await fetch("/eaglePromptPresets/search_template");
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || ("HTTP " + response.status));
        templates.value = (data.data && data.data.list_data) || [];
        categories.value = ["全部"].concat((data.data && data.data.categories) || []);
        var current = templates.value.find(function(t) { return templateKey(t) === selectedId.value; });
        selectTemplate(current || templates.value[0]);
      } catch (e) {
        console.error("加载模板失败:", e);
        errorMessage.value = "加载模板失败：" + e.message;
      } finally {
        loading.value = false;
      }
    }

    async function loadDirectorSkills() {
      try {
        var response = await fetch("/eaglePromptPresets/director_skills");
        var data = await response.json();
        if (data.success) {
          directorSkills.value = data.data || [];
          if (directorSkills.value[0] && !selectedSkillId.value) {
            selectSkill(directorSkills.value[0]);
          }
        }
      } catch (e) {
        console.error("加载导演技能失败:", e);
        directorSkills.value = [];
      }
    }

    function selectSkill(skill) {
      if (!skill) return;
      selectedSkillId.value = skill.id;
      skillContent.value = skill.content || "";
      skillFilmstrip.value = skill.filmstrip || [];
    }

    var selectedSkill = computed(function() {
      return directorSkills.value.find(function(s) { return s.id === selectedSkillId.value; }) || null;
    });

    async function saveCurrentSkill() {
      var skill = {
        id: selectedSkillId.value || undefined,
        name: prompt("请输入技能名称：", selectedSkill.value?.name || "新技能"),
        content: skillContent.value,
        filmstrip: skillFilmstrip.value
      };
      
      if (!skill.name) return;
      
      try {
        var response = await fetch("/eaglePromptPresets/director_skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skill: skill })
        });
        var data = await response.json();
        if (data.success) {
          selectedSkillId.value = data.data.id;
          await loadDirectorSkills();
          alert("✅ 已保存导演技能");
        } else {
          alert("❌ 保存失败：" + data.error);
        }
      } catch (e) {
        alert("❌ 保存出错：" + e.message);
      }
    }

    async function deleteCurrentSkill() {
      if (!selectedSkill.value) return;
      if (!confirm("确定要删除技能「" + selectedSkill.value.name + "」吗？")) return;
      
      try {
        var response = await fetch("/eaglePromptPresets/director_skills?id=" + encodeURIComponent(selectedSkill.value.id), {
          method: "DELETE"
        });
        var data = await response.json();
        if (data.success) {
          selectedSkillId.value = "";
          skillContent.value = "";
          skillFilmstrip.value = [];
          await loadDirectorSkills();
        } else {
          alert("❌ 删除失败：" + data.error);
        }
      } catch (e) {
        alert("❌ 删除出错：" + e.message);
      }
    }

    async function uploadFilmstripImage(file) {
      if (!file || !String(file.type || "").startsWith("image/")) {
        alert("请拖入或选择图片文件");
        return;
      }
      
      filmstripUploading.value = true;
      try {
        var body = new FormData();
        body.append("file", file, file.name || "filmstrip.png");
        var response = await fetch("/eaglePromptPresets/upload_filmstrip", { method: "POST", body: body });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || "上传失败");
        skillFilmstrip.value.push(data.path);
      } catch (error) {
        alert(error.message || String(error));
      } finally {
        filmstripUploading.value = false;
      }
    }

    function removeFilmstripImage(index) {
      skillFilmstrip.value.splice(index, 1);
    }

    function applySkillToNode() {
      var widget = props.node.widgets.find(function(w) { 
        return w.name === "selected_director_skill"; 
      });
      if (widget) {
        widget.value = skillContent.value;
        directorSkillsValue.value = skillContent.value;
        props.node.setDirtyCanvas(true, true);
        alert("✅ 已应用导演技能到节点");
      } else {
        console.error("未找到 selected_director_skill widget，当前 widgets:", props.node.widgets.map(function(w) { return w.name; }));
        alert("❌ 未找到导演技能输出端口");
      }
    }

    onMounted(function() {
      loadTemplates().finally(function() {
        stateReady = true;
        persistUiState();
      });
      loadDirectorSkills();

      // 延迟同步外部变量：左侧变量输入节点可能尚未完成 onConfigure / widgets 恢复，
      // 立即读取会得到空值。分阶段重试确保最终能拿到。
      function trySyncExternalVariables(attempt) {
        syncExternalVariables();
        if (attempt < 3) {
          setTimeout(function() { trySyncExternalVariables(attempt + 1); }, 250 * (attempt + 1));
        }
      }
      setTimeout(function() { trySyncExternalVariables(0); }, 100);

      props.node._ppSyncExternalVariables = function() {
        syncLinkedPromptVariableNames(props.node, selectedVariables.value);
        if (syncExternalVariables()) applySelected();
        persistUiState();
      };
    });

    onUnmounted(function() {
      if (props.node._ppSyncExternalVariables) delete props.node._ppSyncExternalVariables;
    });

    watch([selectedCategory, keyword], function() {
      var visible = filteredTemplates.value;
      if (!visible.some(function(t) { return templateKey(t) === selectedId.value; })) {
        if (visible[0]) selectTemplate(visible[0]);
        else selectedId.value = "";
      }
    });

    watch([selectedId, renderedPrompt], function() {
      if (selectedTemplate.value) applySelected();
    });

    watch(function() {
      return {
        selectedCategory: selectedCategory.value,
        selectedId: selectedId.value,
        activeVariable: activeVariable.value,
        previewMode: previewMode.value,
        activeTab: activeTab.value,
        selectedSkillId: selectedSkillId.value,
        directorSkillsValue: directorSkillsValue.value,
        collapsedGroups: Object.assign({}, collapsedGroups),
        variableValues: Object.assign({}, variableValues)
      };
    }, persistUiState, { deep: true });

    function applySelected() {
      var item = selectedTemplate.value;
      if (!item) return;
      props.onApply(
        renderedPrompt.value,
        String(item.Instruction || ""),
        JSON.stringify(variableValues),
        directorSkillsValue.value  // ✅ 导演技能输出
      );
    }

    function handleEdit(template) {
      if (!template) return;
      editingTemplate.value = isReadOnly(template)
        ? { ...template, id: "", Label: (template.Label || "未命名") + " 副本", source: "user" }
        : { ...template };
      showEditor.value = true;
    }

    function handleDuplicate(template) {
      if (!template) return;
      editingTemplate.value = { ...template, id: "", Label: (template.Label || "未命名") + " 副本", source: "user" };
      showEditor.value = true;
    }

    function handleCreate() {
      editingTemplate.value = null;
      showEditor.value = true;
    }

    async function handleSave(template) {
      try {
        var response = await fetch("/eaglePromptPresets/save_template", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template: template, format: "json" })
        });
        var data = await response.json();
        if (data.success) {
          if (data.data) selectedId.value = templateKey(data.data);
          showEditor.value = false;
          await loadTemplates();
        } else {
          alert("❌ 保存失败：" + data.error);
        }
      } catch (e) {
        alert("❌ 保存出错：" + e.message);
      }
    }

    async function handleDelete(template) {
      if (isReadOnly(template)) {
        alert("❌ 内置模板不能删除");
        return;
      }

      if (!confirm("确定要删除模板「" + template.Label + "」吗？")) return;

      try {
        var response = await fetch("/eaglePromptPresets/delete_template?id=" + encodeURIComponent(template.id), {
          method: "DELETE"
        });
        var data = await response.json();

        if (data.success) {
          selectedId.value = "";
          await loadTemplates();
        } else {
          alert("❌ 删除失败：" + data.error);
        }
      } catch (e) {
        alert("❌ 删除出错：" + e.message);
      }
    }

    async function copyPrompt() {
      var text = renderedPrompt.value;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        var area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
    }

    function renderMasterItem(template) {
      var active = templateKey(template) === templateKey(selectedTemplate.value);
      var cover = templateCoverUrl(template.cover);
      return h("button", {
        key: templateKey(template),
        type: "button",
        class: ["pp-master-item", active ? "active" : ""],
        onClick: function() { selectTemplate(template); },
        onDblclick: function() { selectTemplate(template); applySelected(); }
      }, [
        cover
          ? h("img", { class: "pp-master-cover", src: cover, alt: "", loading: "lazy" })
          : h("div", { class: "pp-master-cover pp-cover-placeholder" }, String(template.Label || "模").slice(0, 1)),
        h("div", { class: "pp-master-copy" }, [
          h("strong", { class: "pp-master-label", title: template.Label || "" }, template.Label || "未命名模板"),
          h("span", { class: "pp-master-meta" }, [
            h("span", {}, template.category || "未分类"),
            h("span", {}, sourceLabel(template))
          ])
        ]),
        h("span", { class: "pp-var-count" }, extractVariables(template.Instruction).length + " 变量")
      ]);
    }

    function renderMasterGroup(group) {
      var isCollapsed = !!collapsedGroups[group.category];
      return h("section", { class: ["pp-master-group", isCollapsed ? "collapsed" : ""] }, [
        h("button", {
          type: "button",
          class: "pp-master-group-head",
          title: isCollapsed ? "展开分类" : "折叠分类",
          onClick: function() { collapsedGroups[group.category] = !isCollapsed; }
        }, [
          h("span", { class: "pp-tree-caret" }, isCollapsed ? "▸" : "▾"),
          h("span", { class: "pp-master-group-title" }, group.category),
          h("span", { class: "pp-master-group-count" }, String(group.items.length))
        ]),
        isCollapsed ? null : h("div", { class: "pp-master-group-items" }, group.items.map(renderMasterItem))
      ]);
    }

    function renderDetail() {
      var template = selectedTemplate.value;
      if (!template) return h("div", { class: "ppui-empty" }, "请选择一个模板");
      
      var vars = selectedVariables.value;
      var cover = templateCoverUrl(template.cover);
      var readOnly = isReadOnly(template);
      var activeIsExternal = !!activeVariable.value && hasExternalVariable(activeVariable.value);

      return h("section", { class: "pp-detail" }, [
        // 标题区域
        h("div", { class: "pp-detail-head" }, [
          h("div", { class: "pp-detail-identity" }, [
            cover
              ? h("img", { class: "pp-detail-cover", src: cover, alt: "", loading: "lazy" })
              : h("div", { class: "pp-detail-cover pp-cover-placeholder" }, String(template.Label || "模").slice(0, 1)),
            h("div", {}, [
              h("h3", {}, template.Label || "未命名模板"),
              h("div", { class: "pp-detail-meta" }, (template.category || "未分类") + " · " + sourceLabel(template))
            ])
          ]),
          h("div", { class: "pp-detail-tools" }, [
            h("button", { class: "ppui-btn", onClick: function() { handleEdit(template); } }, readOnly ? "✎ 编辑副本" : "✎ 编辑"),
            h("button", { class: "ppui-btn", onClick: function() { handleDuplicate(template); } }, "另存副本"),
            !readOnly ? h("button", { class: "ppui-btn", style: { background: "var(--ppui-danger)" }, onClick: function() { handleDelete(template); } }, "删除") : null
          ])
        ]),

        // 导演技能
        h("div", { class: "pp-detail-section" }, [
          h("div", { class: "pp-section-label" }, "导演 Skills (Markdown)"),
          h("textarea", {
            class: "ppui-search",
            style: { width: "100%", minHeight: "120px", resize: "vertical", fontFamily: "monospace" },
            value: directorSkillsValue.value,
            placeholder: "输入导演技能提示词",
            onInput: function(e) { directorSkillsValue.value = e.target.value; }
          })
        ]),

        // 滚动区域
        h("div", { class: "pp-detail-scroll" }, [
          // 指令模板
          h("div", { class: "pp-detail-section" }, [
            h("div", { class: "pp-section-label" }, "指令模板"),
            h("pre", { class: "pp-template-source" }, String(template.Instruction || "")),
            template.example ? h("div", { class: "pp-example-line" }, [h("b", {}, "示例："), String(template.example)]) : null
          ]),

          // 变量编辑器
          h("div", { class: "pp-detail-section" }, [
            h("div", { class: "pp-var-heading" }, [
              h("button", {
                class: "ppui-btn",
                type: "button",
                title: "Sync linked variables",
                onClick: function() {
                  if (props.node && props.node._ppSyncExternalVariables) {
                    props.node._ppSyncExternalVariables();
                  }
                }
              }, "↻"),
              h("span", { class: "pp-section-label" }, "变量"),
              h("span", { class: ["pp-section-hint", activeIsExternal ? "pp-external-hint" : ""] },
                activeIsExternal ? "外部「变量输入」已接管当前值" : "外部「变量输入」在执行时优先覆盖这里的预览值")
            ]),
            vars.length ? h("div", { class: "pp-vars-editor" }, [
              h("div", { class: "pp-var-switcher" }, [
                h("select", {
                  class: "ppui-search pp-var-select",
                  value: activeVariable.value,
                  onChange: function(e) { activeVariable.value = e.target.value; }
                }, vars.map(function(name) { return h("option", { value: name }, "{{" + name + "}}"); })),
                h("input", {
                  class: "ppui-search pp-var-input",
                  value: effectiveVariableValue(activeVariable.value) || "",
                  disabled: activeIsExternal,
                  title: activeIsExternal ? "当前变量由外部「变量输入」节点控制" : "本地模板变量",
                  placeholder: activeVariable.value ? (activeIsExternal ? "由外部变量节点控制" : ("输入 " + activeVariable.value)) : "无变量",
                  onInput: function(e) {
                    if (activeVariable.value && !hasExternalVariable(activeVariable.value)) {
                      variableValues[activeVariable.value] = e.target.value;
                    }
                  }
                })
              ]),
              h("div", { class: "pp-var-tabs" }, vars.map(function(name) {
                return h("button", {
                  type: "button",
                  class: ["pp-var-tag", activeVariable.value === name ? "active" : "", hasExternalVariable(name) ? "external" : ""],
                  title: hasExternalVariable(name) ? "外部变量输入已接管" : "模板内变量",
                  onClick: function() { activeVariable.value = name; }
                }, [name, hasExternalVariable(name) ? h("span", { class: "pp-var-source" }, "外") : null]);
              }))
            ]) : h("div", { class: "pp-no-vars" }, "此模板没有变量，可直接应用。")
          ]),

          // 输出预览
          h("div", { class: "pp-detail-section pp-preview-section" }, [
            h("div", { class: "pp-preview-heading" }, [
              h("span", { class: "pp-section-label" }, "输出预览"),
              h("div", { class: "pp-preview-mode" }, [
                h("button", {
                  type: "button",
                  class: ["ppui-btn", previewMode.value === "markdown" ? "primary" : ""],
                  onClick: function() { previewMode.value = "markdown"; }
                }, "Markdown"),
                h("button", {
                  type: "button",
                  class: ["ppui-btn", previewMode.value === "source" ? "primary" : ""],
                  onClick: function() { previewMode.value = "source"; }
                }, "源码")
              ])
            ]),
            previewMode.value === "markdown"
              ? h("div", { class: "pp-preview-markdown", innerHTML: renderMarkdown(renderedPrompt.value) })
              : h("textarea", { class: "ppui-search pp-preview-textarea", readonly: true, value: renderedPrompt.value })
          ])
        ]),

        // 底部操作
        h("div", { class: "pp-detail-actions" }, [
          h("button", { class: "ppui-btn", onClick: copyPrompt }, "复制"),
          h("button", { class: "ppui-btn primary", onClick: applySelected }, "应用到节点输出")
        ])
      ]);
    }

    function renderDirectorTab() {
      return h("div", { class: "pp-director-layout" }, [
        // 左侧：技能列表
        h("aside", { class: "pp-director-sidebar" }, [
          h("div", { class: "pp-sidebar-head" }, [
            h("h3", {}, "🎬 导演技能库"),
            h("button", { 
              class: "ppui-btn ppui-btn-sm primary", 
              onClick: function() { 
                selectedSkillId.value = ""; 
                skillContent.value = ""; 
                skillFilmstrip.value = []; 
              } 
            }, "+ 新建")
          ]),
          h("div", { class: "pp-skills-list" }, 
            directorSkills.value.map(function(skill) {
              return h("button", {
                type: "button",
                class: ["pp-skill-item", selectedSkillId.value === skill.id ? "active" : ""],
                onClick: function() { selectSkill(skill); }
              }, [
                h("div", { class: "pp-skill-name" }, skill.name || "未命名技能"),
                h("div", { class: "pp-skill-meta" }, [
                  (skill.filmstrip?.length || 0) + " 个素材",
                  " · ",
                  skill.updated_at ? new Date(skill.updated_at).toLocaleDateString() : ""
                ])
              ]);
            })
          )
        ]),
        
        // 右侧：编辑区
        h("div", { class: "pp-director-main" }, [
          h("div", { class: "pp-director-toolbar" }, [
            h("span", { class: "pp-section-label" }, selectedSkill.value?.name || "新技能"),
            h("div", { class: "pp-director-tools" }, [
              h("button", { class: "ppui-btn", onClick: saveCurrentSkill }, "💾 保存"),
              selectedSkill.value && h("button", { 
                class: "ppui-btn", 
                style: { background: "var(--ppui-danger)" },
                onClick: deleteCurrentSkill 
              }, "删除"),
              h("button", { class: "ppui-btn primary", onClick: applySkillToNode }, "应用到节点")
            ])
          ]),
          
          h("div", { class: "pp-director-content" }, [
            // Markdown 编辑器
            h("div", { class: "pp-director-section" }, [
              h("label", { style: { display: "block", marginBottom: "6px", color: "#aaa", fontSize: "12px" } }, "📄 技能文档（Markdown）"),
              h("textarea", {
                class: "ppui-search pp-director-editor",
                style: { width: "100%", minHeight: "300px", resize: "vertical", fontFamily: "monospace" },
                value: skillContent.value,
                placeholder: "输入导演技能说明，支持 Markdown 格式...",
                onInput: function(e) { skillContent.value = e.target.value; }
              })
            ]),
            
            // 素材胶片
            h("div", { class: "pp-director-section" }, [
              h("label", { style: { display: "block", marginBottom: "6px", color: "#aaa", fontSize: "12px" } }, "🎞️ 素材胶片"),
              h("div", { 
                class: "pp-filmstrip-grid",
                onDragover: function(e) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; },
                onDrop: function(e) { 
                  e.preventDefault(); 
                  uploadFilmstripImage(e.dataTransfer.files && e.dataTransfer.files[0]); 
                }
              }, [
                ...skillFilmstrip.value.map(function(path, index) {
                  return h("div", { class: "pp-filmstrip-item" }, [
                    h("img", { src: templateCoverUrl(path), loading: "lazy" }),
                    h("button", { 
                      class: "pp-filmstrip-remove", 
                      onClick: function() { removeFilmstripImage(index); } 
                    }, "×")
                  ]);
                }),
                h("label", { class: "pp-filmstrip-add" }, [
                  filmstripUploading.value ? "上传中..." : "+ 添加素材",
                  h("input", { 
                    type: "file", 
                    accept: "image/*", 
                    style: "display:none",
                    onChange: function(e) { uploadFilmstripImage(e.target.files && e.target.files[0]); }
                  })
                ])
              ])
            ]),
            
            // 预览区
            h("div", { class: "pp-director-section" }, [
              h("label", { style: { display: "block", marginBottom: "6px", color: "#aaa", fontSize: "12px" } }, "👁️ Markdown 预览"),
              h("div", { 
                class: "pp-preview-markdown pp-director-preview", 
                innerHTML: renderMarkdown(skillContent.value) 
              })
            ])
          ])
        ])
      ]);
    }

    return function() {
      // ✅ 使用统一样式类名
      return h("div", { class: "ppui-root eagle-prompt-presets-root", style: "height:100%;display:flex;flex-direction:column;overflow:hidden;" }, [
        // 工具栏
        h("div", { class: "ppui-toolbar", style: "flex-shrink:0" }, [
          h("select", {
            class: "ppui-btn",
            value: selectedCategory.value,
            onChange: function(e) { selectedCategory.value = e.target.value; }
          }, categories.value.map(function(cat) { return h("option", { value: cat }, cat); })),
          
          // Tab 切换
          h("div", { class: "ppui-mode-toggle" }, [
            h("span", {
              class: activeTab.value === "presets" ? "active" : "",
              onClick: function() { activeTab.value = "presets"; }
            }, "📝 提示词预设"),
            h("span", {
              class: activeTab.value === "director" ? "active" : "",
              onClick: function() { activeTab.value = "director"; }
            }, "🎬 导演技能")
          ]),
          
          h("input", {
            class: "ppui-search",
            type: "text",
            placeholder: "搜索名称、指令、示例或标签...",
            value: keyword.value,
            onInput: function(e) { keyword.value = e.target.value; }
          }),
          h("span", { class: "ppui-badge" }, filteredTemplates.value.length + " / " + templates.value.length),
          h("div", { class: "ppui-toolbar-sep" }),
          h("button", { class: "ppui-btn", title: "刷新", onClick: loadTemplates }, "↻"),
          h("button", { class: "ppui-btn", onClick: function() { showImport.value = true; } }, "📁 导入"),
          h("button", { class: "ppui-btn primary", onClick: handleCreate }, "＋ 新建"),
          h("button", { class: "ppui-btn", title: "设置", onClick: function() { showSettings.value = true; } }, "⚙")
        ]),

        // 主体区域
        loading.value
          ? h("div", { class: "ppui-loading" }, "加载模板中...")
          : errorMessage.value
            ? h("div", { class: "ppui-error" }, [errorMessage.value, h("button", { class: "ppui-btn", onClick: loadTemplates }, "重试")])
            : h("div", { class: "ppui-main", style: { flex: "1 1 auto", overflow: "hidden", minHeight: "0", height: "100%" } }, [
                activeTab.value === "presets" 
                  ? h("div", { style: { display: "grid", gridTemplateColumns: "minmax(250px, 34%) minmax(0, 1fr)", width: "100%", height: "100%", minWidth: "0", minHeight: "0", overflow: "hidden" } }, [
                      h("aside", { class: "ppui-sidebar pp-master" }, filteredTemplates.value.length
                        ? templateGroups.value.map(renderMasterGroup)
                        : [h("div", { class: "ppui-empty" }, "没有匹配的模板")]),
                      renderDetail()
                    ])
                  : h("div", { style: { width: "100%", height: "100%", minWidth: "0", minHeight: "0", overflow: "hidden", display: "flex", flexDirection: "column" } }, [
                      renderDirectorTab()
                    ])
              ]),

        // 对话框
        h(TemplateEditor, {
          visible: showEditor.value,
          template: editingTemplate.value,
          onClose: function() { showEditor.value = false; },
          onSave: handleSave
        }),

        h(ImportDialog, {
          visible: showImport.value,
          onClose: function() { showImport.value = false; },
          onImported: loadTemplates
        }),

        h(SettingsDialog, {
          node: props.node,
          visible: showSettings.value,
          onClose: function() { showSettings.value = false; },
          onSaved: loadTemplates
        })
      ]);
    };
  }
};

// ============ 注册 ComfyUI 扩展 ============
app.registerExtension({
  name: "EagleSuite.PromptPresets",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EaglePromptPresets") return;

    var HIDDEN_WIDGETS = ["prompt", "template", "local_variables", "selected_director_skill", "ui_state"];

    var hideWidgets = function(node) {
      if (!node.widgets || !node.widgets.length) return false;
      var found = false;
      for (var i = 0; i < node.widgets.length; i++) {
        var widget = node.widgets[i];
        if (HIDDEN_WIDGETS.indexOf(widget.name) < 0) continue;
        widget.type = "hidden";
        widget.computeSize = function() { return [0, -4]; };
        widget.hidden = true;
        widget.draw = function() {};
        found = true;
      }
      if (found) node.setDirtyCanvas(true, true);
      return found;
    };

    var originalOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      if (originalOnNodeCreated) originalOnNodeCreated.apply(this, arguments);
      if (this._ppInit || this._ppMounting) return;
      this._ppMounting = true;

      var node = this;
      this.setSize([900, 700]);
      hideWidgets(this);

      setTimeout(function() {
        if (!hideWidgets(node)) setTimeout(function() { hideWidgets(node); }, 500);
      }, 300);

      // ✅ 加载统一样式
      var container = null;
      try {
        loadStyles();

      this.serialize_widgets = true;

          container = document.createElement("div");
          container.className = "eagle-prompt-presets-root";
          container.style.cssText = "width:100%;max-width:100%;min-width:0;overflow:hidden;";

          var domWidget = this.addDOMWidget("preview", "div", container, {
            serialize: false,
            hideOnZoom: false
          });
          this._ppWidget = domWidget;

      var vueApp = createApp({
        render: function() {
          return h(PromptPresetsApp, {
            node: node,
            onApply: function(prompt, template, localVariables, directorSkill) {
              var promptWidget = node.widgets.find(function(w) { return w.name === "prompt"; });
              var templateWidget = node.widgets.find(function(w) { return w.name === "template"; });
              var variablesWidget = node.widgets.find(function(w) { return w.name === "local_variables"; });
              var directorSkillWidget = node.widgets.find(function(w) { return w.name === "selected_director_skill"; });

              if (promptWidget) promptWidget.value = prompt;
              if (templateWidget) templateWidget.value = template;
              if (variablesWidget) variablesWidget.value = localVariables;
              if (directorSkillWidget) directorSkillWidget.value = directorSkill || "";

              node.setDirtyCanvas(true, true);
            }
          });
        }
      });

      vueApp.mount(container);
      this._ppVueApp = vueApp;
      this._ppContainer = container;
      this._ppInit = true;
      this._ppMounting = false;

          // LiteGraph 会在选中、拖动或恢复工作流时重新测量 DOMWidget。
          // 不能把节点像素宽度直接写到 Vue 根元素，否则下一次测量会把旧宽度
          // 当成可用宽度并持续收缩。根元素始终跟随宿主，computeSize 只返回本轮尺寸。
          var syncLayout = function(target, size) {
            if (!target || !target._ppContainer) return;
            var currentSize = size || target.size || [900, 700];
            var nodeHeight = Math.max(500, Number(currentSize[1]) || 700);
            var height = Math.max(410, nodeHeight - 104);
            var root = target._ppContainer;

            root.style.width = "100%";
            root.style.maxWidth = "100%";
            root.style.minWidth = "0";
            root.style.height = height + "px";
            root.style.overflow = "hidden";

            var host = root.parentElement;
            if (host) {
              host.style.width = "100%";
              host.style.maxWidth = "100%";
              host.style.minWidth = "0";
              host.style.boxSizing = "border-box";
              host.style.overflow = "hidden";
            }
            // 不设置 computeSize，避免高度反馈循环（参考 lora_gallery 写法）
          };
          this._ppSyncLayout = function(size) {
            syncLayout(this, size || this.size);
          };

          var previousOnResize = this.onResize;
          this.onResize = function(size) {
            if (previousOnResize) previousOnResize.apply(this, arguments);
            this._ppSyncLayout?.(size);
          };
          this.onResize(this.size);
          requestAnimationFrame(() => this._ppSyncLayout?.(this.size));

          var previousOnConfigure = this.onConfigure;
          this.onConfigure = function() {
            if (previousOnConfigure) previousOnConfigure.apply(this, arguments);
            hideWidgets(this);
            requestAnimationFrame(() => {
              hideWidgets(this);
              this._ppSyncLayout?.(this.size);
            });
          };

      var previousOnConnectionsChange = this.onConnectionsChange;
      this.onConnectionsChange = function() {
        if (previousOnConnectionsChange) previousOnConnectionsChange.apply(this, arguments);
        var node = this;
        setTimeout(function() {
          if (node._ppSyncExternalVariables) node._ppSyncExternalVariables();
        }, 0);
      };

      var previousOnRemoved = this.onRemoved;
      this.onRemoved = function() {
        if (this._ppVueApp) this._ppVueApp.unmount();
            this._ppVueApp = null;
            this._ppContainer = null;
            this._ppWidget = null;
            this._ppSyncLayout = null;
            this._ppInit = false;
            this._ppMounting = false;
            if (previousOnRemoved) previousOnRemoved.apply(this, arguments);
          };
      } catch (error) {
        this._ppInit = false;
        this._ppMounting = false;
        hideWidgets(this);
        console.error("[Eagle Suite] Prompt Presets Vue mount failed:", error);
        if (container) {
          container.className = "eagle-prompt-presets-root";
          container.style.cssText = "height:100%;padding:16px;overflow:auto;";
          container.textContent = "Prompt Presets UI failed to initialize. Check the browser console and refresh after fixing the extension error.";
        }
      }
    };
  }
});

// ============ 辅助函数 ============
function readLinkedPromptVariables(node) {
  var result = {};
  if (!node || !node.inputs) return result;
  var graph = node.graph || app.graph;
  if (!graph) return result;

  for (var i = 0; i < node.inputs.length; i++) {
    var input = node.inputs[i];
    if (input.name !== "variables" || input.link == null) continue;

    var link = graph.links && graph.links[input.link];
    if (!link) continue;

    var originNode = graph.getNodeById && graph.getNodeById(link.origin_id);
    if (!originNode) continue;

    // 优先使用 EaglePromptVariablesNode 暴露的统一 getter，避免直接遍历 widgets
    // 时因 hidden widget 或未初始化导致读取失败。
    if (typeof originNode._ppGetVariables === "function") {
      try {
        var fromNode = originNode._ppGetVariables();
        if (fromNode && typeof fromNode === "object") {
          Object.keys(fromNode).forEach(function(key) {
            if (key) result[key] = fromNode[key];
          });
        }
        continue;
      } catch (e) { console.warn("[EaglePromptPresets] _ppGetVariables 失败:", e); }
    }

    // Fallback：直接读取左侧节点的 widgets（兼容 EaglePromptVariablesNode 未挂载或旧版本）
    var widgets = originNode.widgets || [];
    var countWidget = widgets.find(function(w) { return w.name === "变量数量"; });
    var count = Math.max(0, Math.min(32, Number(countWidget && countWidget.value) || 0));
    for (var index = 1; index <= count; index++) {
      var nameWidget = widgets.find(function(w) { return w.name === "变量名_" + index; });
      var valueWidget = widgets.find(function(w) { return w.name === "变量值_" + index; });
      var key = String(nameWidget && nameWidget.value || "").trim()
        .replace(/^\{\{\s*|\s*\}\}$/g, "");
      if (key) result[key] = valueWidget ? String(valueWidget.value == null ? "" : valueWidget.value) : "";
    }

    // 兼容早期 JSON 变量节点，避免已有工作流失效。
    var variablesWidget = widgets.find(function(w) { return w.name === "variables_json"; });
    if (variablesWidget) try {
      var parsed = JSON.parse(variablesWidget.value || "{}");
      Object.keys(parsed).forEach(function(key) { result[key] = parsed[key]; });
    } catch (e) { console.warn("解析外部变量 JSON 失败:", e); }
  }

  return result;
}

function syncLinkedPromptVariableNames(node, names) {
  if (!node || !node.inputs) return;
  var graph = node.graph || app.graph;
  if (!graph) return;

  for (var i = 0; i < node.inputs.length; i++) {
    var input = node.inputs[i];
    if (input.name !== "variables" || input.link == null) continue;
    var link = graph.links && graph.links[input.link];
    if (!link) continue;
    var originNode = graph.getNodeById && graph.getNodeById(link.origin_id);
    if (originNode && originNode._ppSetRequiredVariables) {
      originNode._ppSetRequiredVariables(names || []);
    }
  }
}

function templateCoverUrl(cover) {
  if (!cover) return "";
  if (String(cover).startsWith("http://") || String(cover).startsWith("https://")) return cover;
  if (String(cover).startsWith("data:")) return cover;
  if (String(cover).startsWith("/")) return cover;
  return "/eaglePromptPresets/cover/" + encodeURIComponent(cover);
}

function renderMarkdownLegacy(text) {
  if (!text) return "";

  var html = String(text)
    // 转义 HTML 特殊字符
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // 代码块
    .replace(/```([\s\S]*?)```/g, function(_, code) {
      return '<pre class="pp-md-code">' + code.trim() + '</pre>';
    })
    // 行内代码
    .replace(/`([^`]+)`/g, '<code class="pp-md-icode">$1</code>')
    // 标题
    .replace(/^### (.+)$/gm, '<h4 class="pp-md-h">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="pp-md-h">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="pp-md-h">$1</h2>')
    // 粗体
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // 斜体
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // 引用块
    .replace(/^&gt; (.+)$/gm, '<blockquote class="pp-md-quote">$1</blockquote>')
    // 无序列表
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    // 有序列表
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // 链接
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // 换行
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');

  // 表格处理（简化版）
  var lines = html.split('<br>');
  var inTable = false;
  var tableHtml = [];
  var result = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    
    if (line.includes('|')) {
      if (!inTable) {
        inTable = true;
        tableHtml = ['<table class="pp-md-table">'];
      }
      
      var cells = line.split('|').filter(function(c) { return c.trim(); });
      
      // 检查是否为分隔行
      if (cells.every(function(c) { return /^[\s:-]+$/.test(c); })) {
        continue;
      }
      
      var isHeader = !tableHtml.some(function(h) { return h.includes('<tr>'); });
      var tag = isHeader ? 'th' : 'td';
      
      tableHtml.push('<tr>');
      cells.forEach(function(cell) {
        tableHtml.push('<' + tag + '>' + cell.trim() + '</' + tag + '>');
      });
      tableHtml.push('</tr>');
    } else {
      if (inTable) {
        tableHtml.push('</table>');
        result.push(tableHtml.join(''));
        tableHtml = [];
        inTable = false;
      }
      result.push(line);
    }
  }

  if (inTable) {
    tableHtml.push('</table>');
    result.push(tableHtml.join(''));
  }

  return result.join('<br>');
}

function escapeMarkdownHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeMarkdownHref(value) {
  var href = String(value || "").trim();
  if (!/^(https?:|mailto:|#|\/)/i.test(href)) return "";
  return escapeMarkdownHtml(href);
}

function renderMarkdownInline(value) {
  var tokens = [];
  var token = function(html) {
    var index = tokens.push(html) - 1;
    return "\u0000PP" + index + "\u0000";
  };

  var html = escapeMarkdownHtml(value);
  html = html.replace(/`([^`]+)`/g, function(_, code) {
    return token('<code class="pp-md-icode">' + code + '</code>');
  });
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+[\"'][^\"']*[\"'])?\)/g, function(_, label, href) {
    var safeHref = safeMarkdownHref(href.replace(/&amp;/g, "&"));
    if (!safeHref) return label;
    return token('<a href="' + safeHref + '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
  });
  html = html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  html = html.replace(/\u0000PP(\d+)\u0000/g, function(_, index) {
    return tokens[Number(index)] || "";
  });
  return html;
}

function splitMarkdownCells(line) {
  var value = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  var cells = [];
  var current = "";
  var escaped = false;
  for (var i = 0; i < value.length; i += 1) {
    var character = value.charAt(i);
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (escaped) current += "\\";
  cells.push(current.trim());
  return cells;
}

function renderMarkdown(text) {
  if (!text) return "";

  var lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  var output = [];
  var paragraph = [];
  var listType = "";
  var inCode = false;
  var codeLanguage = "";
  var codeLines = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    output.push('<p class="pp-md-p">' + paragraph.map(renderMarkdownInline).join("<br>") + "</p>");
    paragraph = [];
  }

  function closeList() {
    if (!listType) return;
    output.push("</" + listType + ">");
    listType = "";
  }

  function openList(type) {
    if (listType === type) return;
    closeList();
    listType = type;
    output.push("<" + type + ">");
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    if (inCode) {
      if (/^\s*```/.test(line)) {
        output.push('<pre class="pp-md-code"><code' + (codeLanguage ? ' data-language="' + escapeMarkdownHtml(codeLanguage) + '"' : "") + '>' + escapeMarkdownHtml(codeLines.join("\n")) + "</code></pre>");
        inCode = false;
        codeLanguage = "";
        codeLines = [];
      } else {
        codeLines.push(line);
      }
      continue;
    }

    var fence = line.match(/^\s*```\s*([^\s`]*)/);
    if (fence) {
      flushParagraph();
      closeList();
      inCode = true;
      codeLanguage = fence[1] || "";
      continue;
    }

    if (line.indexOf("|") >= 0 && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      flushParagraph();
      closeList();
      var headers = splitMarkdownCells(line);
      output.push('<table class="pp-md-table"><thead><tr>' + headers.map(function(cell) {
        return "<th>" + renderMarkdownInline(cell) + "</th>";
      }).join("") + "</tr></thead><tbody>");
      i += 2;
      while (i < lines.length && lines[i].indexOf("|") >= 0 && lines[i].trim()) {
        var cells = splitMarkdownCells(lines[i]);
        output.push("<tr>" + cells.map(function(cell) {
          return "<td>" + renderMarkdownInline(cell) + "</td>";
        }).join("") + "</tr>");
        i++;
      }
      output.push("</tbody></table>");
      i--;
      continue;
    }

    var heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      var level = Math.min(6, heading[1].length + 1);
      output.push('<h' + level + ' class="pp-md-h">' + renderMarkdownInline(heading[2]) + "</h" + level + ">");
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      closeList();
      output.push("<hr>");
      continue;
    }

    var quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      output.push('<blockquote class="pp-md-quote">' + renderMarkdownInline(quote[1]) + "</blockquote>");
      continue;
    }

    var unordered = line.match(/^\s*[-+*]\s+(?:\[([ xX])\]\s+)?(.*)$/);
    if (unordered) {
      flushParagraph();
      openList("ul");
      var checkbox = unordered[1] == null ? "" : '<input type="checkbox" disabled' + (/x/i.test(unordered[1]) ? " checked" : "") + "> ";
      output.push("<li>" + checkbox + renderMarkdownInline(unordered[2]) + "</li>");
      continue;
    }

    var ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      openList("ol");
      output.push("<li>" + renderMarkdownInline(ordered[1]) + "</li>");
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    closeList();
    paragraph.push(line);
  }

  if (inCode) {
    output.push('<pre class="pp-md-code"><code>' + escapeMarkdownHtml(codeLines.join("\n")) + "</code></pre>");
  }
  flushParagraph();
  closeList();
  return output.join("");
}