/**
 * Eagle H3 Pipeline — H3 制片流水线前端
 * 单文件内联，依赖 vue.esm-browser.js。
 */
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { createApp, ref, computed } from "../lib/vue.esm-browser.js";
import "./eagle_vue_theme.js";

console.log("[EagleH3Pipeline] h3_pipeline.js loaded");

// ═══════════════════════════════════════════════════════════════════════════
// CSS
// ═══════════════════════════════════════════════════════════════════════════
const H3C_CSS = `
.h3c-root{
  --h3c-theme-bg:var(--comfy-menu-bg,var(--bg-color,#0b0c0f));
  --h3c-fg:var(--fg-color,#e8ebf2);
  --h3c-bg:var(--h3c-theme-bg);
  --h3c-bg2:color-mix(in srgb,var(--h3c-theme-bg) 93%,var(--h3c-fg) 7%);
  --h3c-bg3:color-mix(in srgb,var(--h3c-theme-bg) 87%,var(--h3c-fg) 13%);
  --h3c-bg4:color-mix(in srgb,var(--h3c-theme-bg) 80%,var(--h3c-fg) 20%);
  --h3c-bd:var(--border-color,color-mix(in srgb,var(--h3c-theme-bg) 68%,var(--h3c-fg) 32%));
  --h3c-bdh:color-mix(in srgb,var(--h3c-theme-bg) 55%,var(--h3c-fg) 45%);
  --h3c-muted:var(--descrip-text,color-mix(in srgb,var(--h3c-fg) 64%,var(--h3c-theme-bg) 36%));
  --h3c-primary:var(--p-primary-color,#4a7de0); --h3c-primaryh:var(--p-primary-hover-color,#5a8df0);
  --h3c-danger:#c14b4b; --h3c-success:#4a9a62; --h3c-warn:#d4a24a;
  --h3c-radius:8px;
  display:flex; flex-direction:column; height:100%; min-height:0; min-width:260px;
  background:var(--h3c-bg); color:var(--h3c-fg);
  font:12px/1.4 system-ui,"Segoe UI",sans-serif; box-sizing:border-box; overflow:hidden; padding:8px;
}
.h3c-root *{box-sizing:border-box;}
.h3c-card{background:var(--h3c-bg2); border:1px solid var(--h3c-bd); border-radius:var(--h3c-radius); padding:8px; display:flex; flex-direction:column; gap:6px; min-height:0;}
.h3c-title{font-size:12px; font-weight:600; color:var(--h3c-fg); margin-bottom:2px;}
.h3c-muted{font-size:11px; color:var(--h3c-muted);}
.h3c-row{display:flex; align-items:center; gap:6px; flex-wrap:wrap;}
.h3c-btn{background:var(--h3c-bg4); color:var(--h3c-fg); border:1px solid var(--h3c-bd); border-radius:6px; padding:5px 10px; font:inherit; font-size:11px; cursor:pointer; transition:.15s;}
.h3c-btn:hover{border-color:var(--h3c-primary); color:#fff;}
.h3c-btn.primary{background:var(--h3c-primary); color:#fff; border-color:var(--h3c-primary);}
.h3c-btn.danger:hover{border-color:var(--h3c-danger); color:var(--h3c-danger);}
.h3c-btn:disabled{opacity:.5; cursor:not-allowed;}
.h3c-input,.h3c-textarea{background:var(--h3c-bg);color:var(--h3c-fg);border:1px solid var(--h3c-bd);border-radius:6px;padding:6px;font:inherit;min-width:0;}
.h3c-input{width:120px;}.h3c-textarea{width:100%;min-height:66px;resize:vertical;}
.h3c-video{width:100%; border-radius:6px; background:#000;}
.h3c-root.compact{padding:5px;}
.h3c-root.compact .h3c-card{padding:7px;gap:4px;}
.h3c-root.review .h3c-video{display:block;max-height:220px;object-fit:contain;}
.h3c-root.review{overflow-y:auto;}
.h3c-root.review>.h3c-root{flex-shrink:0;height:auto;overflow:visible;}
.h3c-review-history{display:flex;gap:5px;overflow-x:auto;padding:2px 0 4px;scrollbar-width:thin;}
.h3c-review-take{flex:0 0 auto;min-width:64px;padding:4px 8px;}
.h3c-review-take.active{background:var(--h3c-primary);border-color:var(--h3c-primary);color:#fff;}
.h3c-input,.h3c-textarea{background:var(--h3c-bg);color:var(--h3c-fg);border:1px solid var(--h3c-bd);border-radius:6px;padding:5px 7px;font:inherit;}
.h3c-input{width:110px;}
.h3c-textarea{width:100%;min-height:68px;resize:vertical;}
.h3c-bar{height:6px; background:#262a33; border-radius:3px; overflow:hidden; margin-top:4px;}
.h3c-bar>i{display:block; height:100%; background:var(--h3c-primary); transition:width .3s;}
.h3c-preview-img{max-width:100%; max-height:180px; border-radius:6px; border:1px solid var(--h3c-bd);}
.h3c-pre{white-space:pre-wrap; word-break:break-word; font:10px/1.35 ui-monospace,monospace; color:var(--h3c-muted); background:var(--h3c-bg); border:1px solid var(--h3c-bd); border-radius:6px; padding:6px; max-height:120px; overflow:auto;}
`;

function injectCSS() {
  if (document.getElementById("h3c-global-style")) return;
  const style = document.createElement("style");
  style.id = "h3c-global-style";
  style.textContent = H3C_CSS;
  document.head.appendChild(style);
}

function getWidget(node, name) {
  return (node.widgets || []).find(w => w.name === name);
}

function setWidgetValue(node, name, value) {
  const w = getWidget(node, name);
  if (w) w.value = value;
}

const REVIEW_HIDDEN_WIDGETS = [
  "review_decision", "retry_prompt", "retry_seed", "retry_length",
  "resume_scene", "assemble_partial_on_stop", "auto_continue_timeout_minutes",
  "unload_models_while_waiting",
];

function hideReviewDecisionWidget(node) {
  let found = false;
  for (const name of REVIEW_HIDDEN_WIDGETS) {
    const widget = getWidget(node, name);
    if (!widget) continue;
    widget.type = "hidden";
    widget.hidden = true;
    widget.options ||= {};
    Object.assign(widget.options, { hidden: true, vueNode: "never", hideInPanel: true });
    widget.computeSize = () => [0, -4];
    const widgetIndex = node.widgets?.indexOf(widget) ?? -1;
    if (widgetIndex >= 0) node.widgets.splice(widgetIndex, 1, widget);
    found = true;
  }
  return found;
}

function resizeReviewPanel(node, vueApp, review = {}) {
  const widget = vueApp && vueApp._h3cWidget;
  if (!widget) return;
  const hasPreview = Boolean(
    buildViewUrl(review.preview_clip)
    || (review.history || []).some(item => buildViewUrl(item && item.clip_path))
  );
  const hasHistory = (review.history || []).length > 1;
  const hasActions = Boolean(review.awaiting_review);
  const panelHeight = hasPreview
    ? (hasActions ? (hasHistory ? 730 : 690) : (hasHistory ? 440 : 400))
    : (hasActions ? 470 : 185);
  const nodeHeight = panelHeight + 225;
  widget._h3cHeight = panelHeight;

  const width = Math.max(430, (node.size && node.size[0]) || 430);
  const currentHeight = (node.size && node.size[1]) || nodeHeight;
  const previousAutoHeight = node._h3cReviewAutoHeight;
  const followsAutoLayout = previousAutoHeight == null
    || Math.abs(currentHeight - previousAutoHeight) < 90
    || (!hasPreview && currentHeight > nodeHeight + 120);
  node._h3cReviewAutoHeight = nodeHeight;
  if (followsAutoLayout && Math.abs(currentHeight - nodeHeight) > 8) {
    node.setSize([width, nodeHeight]);
  }
  node.graph?.setDirtyCanvas(true, true);
}

function repairNativeEndWidgets(node) {
  const filename = getWidget(node, "filename");
  if (filename) {
    filename.label = "文件名前缀";
    filename.options ||= {};
    filename.options.tooltip = "自动保存为 前缀_0001、前缀_0002…，不会覆盖已有视频";
  }
  const format = getWidget(node, "format");
  const fps = getWidget(node, "fps_override");
  const formats = ["mp4", "mov", "mkv"];
  if (format && !formats.includes(String(format.value || "").toLowerCase())) {
    const shifted = filename && formats.includes(String(filename.value || "").toLowerCase())
      ? String(filename.value).toLowerCase()
      : "mp4";
    format.value = shifted;
    if (filename && formats.includes(String(filename.value || "").toLowerCase())) filename.value = "";
  }
  if (fps && !Number.isFinite(Number(fps.value))) fps.value = 0;
  const localPath = getWidget(node, "local_save_path");
  const eagleFolder = getWidget(node, "eagle_folder");
  if (localPath && localPath.value == null) localPath.value = "";
  if (eagleFolder && eagleFolder.value == null) eagleFolder.value = "";
}

function repairReferenceConditionWidgets(node, serialized) {
  const values = serialized && Array.isArray(serialized.widgets_values)
    ? serialized.widgets_values
    : [];
  // V1 把 prompt/width/height/length 保存为四个本地控件；V2 将它们改为
  // 强制数据端口。按旧数组尾部恢复真正的配置控件，防止值整体左移。
  if (values.length >= 8) {
    setWidgetValue(node, "reference_scope", values[4]);
    setWidgetValue(node, "ref_image_size", values[5]);
    setWidgetValue(node, "use_context_guide", values[6]);
    setWidgetValue(node, "has_context", values[7]);
  }
}

function buildViewUrl(filePath) {
  if (!filePath) return "";
  const relSep = "h3_eagle_chains";
  let idx = filePath.indexOf(relSep);
  if (idx < 0) {
    // try with backslash
    idx = filePath.indexOf("h3_eagle_chains");
    if (idx < 0) return "";
  }
  const rel = filePath.substring(idx).replace(/\\/g, "/");
  const lastSlash = rel.lastIndexOf("/");
  const filename = rel.substring(lastSlash + 1);
  const subfolder = rel.substring(0, lastSlash);
  return `${api.apiURL("/view?type=output")}&filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}`;
}

function queuePrompt() {
  if (app && app.queuePrompt) {
    try {
      return Promise.resolve(app.queuePrompt(0));
    } catch (e) {
      console.warn("[H3Pipeline] queuePrompt failed:", e);
    }
  }
  return Promise.resolve();
}

// ═══════════════════════════════════════════════════════════════════════════
// Vue 组件：通用信息面板
// ═══════════════════════════════════════════════════════════════════════════
function createInfoPanel() {
  return {
    setup() {
      const data = ref({});
      return { data };
    },
    template: `
      <div class="h3c-root">
        <div class="h3c-card" v-if="Object.keys(data).length">
          <div class="h3c-title">H3 链状态</div>
          <pre class="h3c-pre">{{ JSON.stringify(data, null, 2) }}</pre>
        </div>
        <div class="h3c-muted" v-else>等待执行…</div>
      </div>
    `,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Vue 组件：计划节点面板
// ═══════════════════════════════════════════════════════════════════════════
function createPlanPanel() {
  return {
    setup() {
      const info = ref({});
      const runs = ref([]);
      const loading = ref(false);
      async function loadRuns() {
        loading.value = true;
        try {
          const res = await api.fetchApi("/eagle_h3_pipeline/runs");
          const json = await res.json();
          runs.value = json.runs || [];
        } catch (e) {
          console.warn("[H3Chain] load runs failed:", e);
        }
        loading.value = false;
      }
      return { info, runs, loading, loadRuns };
    },
    template: `
      <div class="h3c-root">
        <div class="h3c-card">
          <div class="h3c-title">🦅 H3 链 · 计划</div>
          <div v-if="info.summary" class="h3c-muted">{{ info.summary }}</div>
          <div class="h3c-row">
            <span class="h3c-muted">模式: {{ info.mode || 'auto' }}</span>
            <span class="h3c-muted">镜头: {{ info.total_shots || 0 }}</span>
            <span class="h3c-muted" v-if="info.preflight_ok === true">预检: 通过</span>
            <span class="h3c-muted" v-else-if="info.preflight_ok === false" style="color:var(--h3c-danger)">预检: 失败</span>
          </div>
          <pre v-if="info.preflight && ((info.preflight.errors || []).length || (info.preflight.warnings || []).length)" class="h3c-pre">{{ JSON.stringify(info.preflight, null, 2) }}</pre>
          <div class="h3c-row">
            <button class="h3c-btn" @click="loadRuns" :disabled="loading">{{ loading ? '加载中…' : '刷新历史运行' }}</button>
          </div>
          <div v-if="runs.length" class="h3c-card" style="max-height:120px;overflow:auto;padding:6px;">
            <div v-for="r in runs" :key="r.run_name" class="h3c-muted" style="margin-bottom:4px;">
              {{ r.run_name }} — {{ r.current_index + 1 }}/{{ r.total_shots }} ({{ r.mode }})
            </div>
          </div>
        </div>
      </div>
    `,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Vue 组件：开始节点面板
// ═══════════════════════════════════════════════════════════════════════════
function createStartPanel() {
  return {
    setup() {
      const info = ref({});
      const hasPlan = computed(() => Number(info.value.total_shots || 0) > 0);
      const pct = computed(() => {
        const c = info.value.completed_shots ?? info.value.current_index ?? 0;
        const t = info.value.total_shots || 1;
        return Math.min(100, Math.max(0, (c / t) * 100));
      });
      return { info, pct, hasPlan };
    },
    template: `
      <div class="h3c-root">
        <div class="h3c-card">
          <div class="h3c-title">🦅 H3 链 · 开始</div>
          <div class="h3c-row" v-if="hasPlan">
            <span class="h3c-muted">当前: {{ Math.min((info.current_index || 0) + 1, info.total_shots) }} / {{ info.total_shots }}</span>
            <span class="h3c-muted">模式: {{ info.mode || 'auto' }}</span>
            <span class="h3c-muted">单次队列 · 动态 {{ info.total_shots }} 场景</span>
          </div>
          <div class="h3c-muted" v-else>等待导演台计划同步…</div>
          <div class="h3c-bar"><i :style="{ width: pct + '%' }"></i></div>
          <div v-if="info.summary" class="h3c-muted" style="margin-top:4px;">{{ info.summary }}</div>
        </div>
      </div>
    `,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Vue 组件：审阅门面板
// ═══════════════════════════════════════════════════════════════════════════
function createReviewPanel(node) {
  return {
    setup() {
      const review = ref({});
      const busy = ref(false);
      const decisionError = ref("");
      const loadingHistory = ref(false);
      const historyError = ref("");
      const availableRuns = ref([]);
      const selectedRun = ref(node.properties?.h3_review_run || "");
      const selectedIndex = ref(-1);
      const retryPrompt = ref("");
      const retrySeed = ref(-1);
      const retryLength = ref(0);
      const assemblePartial = ref(Boolean(getWidget(node, "assemble_partial_on_stop")?.value ?? true));
      const timeoutMinutes = ref(Number(getWidget(node, "auto_continue_timeout_minutes")?.value || 0));
      const unloadModels = ref(Boolean(getWidget(node, "unload_models_while_waiting")?.value || false));
      const history = computed(() => Array.isArray(review.value.history) ? review.value.history : []);
      const selectedTake = computed(() => {
        const items = history.value;
        if (!items.length) return null;
        const index = selectedIndex.value >= 0 && selectedIndex.value < items.length
          ? selectedIndex.value
          : items.length - 1;
        return items[index];
      });
      const previewUrl = computed(() => buildViewUrl(
        (selectedTake.value && selectedTake.value.clip_path) || review.value.preview_clip
      ));
      const selectedLabel = computed(() => {
        const take = selectedTake.value;
        if (!take) return `场景 ${(review.value.current_index || 0) + 1}`;
        return `场景 ${Number(take.index || 0) + 1} · r${String(Number(take.revision || 1)).padStart(4, "0")}`;
      });

      async function loadHistory() {
        if (review.value.awaiting_review || loadingHistory.value) return;
        loadingHistory.value = true;
        historyError.value = "";
        node._h3cHistoryAbort?.abort();
        const controller = new AbortController();
        node._h3cHistoryAbort = controller;
        const before = review.value;
        try {
          const response = await api.fetchApi('/eagle_h3_pipeline/runs', { signal: controller.signal });
          if (!response.ok) throw new Error(`历史运行读取失败 (${response.status})`);
          availableRuns.value = (await response.json()).runs || [];
          if (!selectedRun.value) {
            const director = findUpstreamNode(node, 'EagleH3DirectorNode');
            const start = findUpstreamNode(node, 'EagleH3NativeLoopStartNode');
            try {
              selectedRun.value = getWidget(start || {}, 'run_name_override')?.value
                || JSON.parse(director?._h3ContextLoopPlanJson?.() || '{}').run_name
                || (director ? 'eagle_h3_director' : '');
            } catch { /* The editor may be mounting. */ }
          }
          if (!selectedRun.value || !availableRuns.value.some(r => r.run_name === selectedRun.value)) return;
          const result = await api.fetchApi(`/eagle_h3_pipeline/manifest?run=${encodeURIComponent(selectedRun.value)}`, { signal: controller.signal });
          if (!result.ok) throw new Error(`检查点读取失败 (${result.status})`);
          const manifest = await result.json();
          // A live execution event wins over an older asynchronous disk read.
          if (review.value !== before) return;
          const rows = (manifest.shots || []).flatMap(item => (item.revisions?.length ? item.revisions : [item]).map(take => ({
            ...take, index: Number(item.index || 0), clip_path: take.clip || item.clip || '',
            revision: Number(take.revision || item.active_revision || 1),
          }))).filter(take => take.clip_path).sort((a, b) => a.index - b.index || a.revision - b.revision);
          applyReviewPayload(node, { run_name: manifest.run_name, current_index: manifest.current_index,
            restored_history: true,
            clip_count: manifest.total_shots, mode: manifest.mode, history: rows,
            preview_clip: rows.at(-1)?.clip_path || '', awaiting_review: false,
            summary: `已保存 ${new Set(rows.map(take => take.index)).size} / ${manifest.total_shots || 0} 场景 · ${rows.length} 个版本（磁盘历史）`,
          });
        } catch (error) {
          if (error.name !== 'AbortError') historyError.value = error.message;
        } finally { loadingHistory.value = false; }
      }

      async function decide(decision) {
        if (busy.value) return;
        decisionError.value = "";
        const length = Number(retryLength.value || 0);
        if (!Number.isInteger(length) || length < 0 || length > 3592 || (length !== 0 && (length < 5 || (length - 5) % 17 !== 0))) {
          decisionError.value = 'H3 帧长需要为 0 或 17k+5（5、22、39…3592）';
          return;
        }
        busy.value = true;
        setWidgetValue(node, "retry_prompt", retryPrompt.value || "");
        setWidgetValue(node, "retry_seed", Number(retrySeed.value ?? -1));
        setWidgetValue(node, "retry_length", Number(retryLength.value || 0));
        setWidgetValue(node, "assemble_partial_on_stop", Boolean(assemblePartial.value));
        setWidgetValue(node, "auto_continue_timeout_minutes", Number(timeoutMinutes.value || 0));
        setWidgetValue(node, "unload_models_while_waiting", Boolean(unloadModels.value));
        let selectedScene = 0;
        if (decision === "resume") {
          const take = selectedTake.value;
          selectedScene = take ? Number(take.index || 0) + 1 : 0;
          setWidgetValue(node, "resume_scene", selectedScene);
        }
        const token = review.value.token || "";
        if (token && review.value.run_name) {
          try {
            const response = await api.fetchApi(
              `/eagle_h3_pipeline/review?run=${encodeURIComponent(review.value.run_name)}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  token,
                  decision,
                  retry_prompt: retryPrompt.value || "",
                  retry_seed: Number(retrySeed.value ?? -1),
                  retry_length: Number(retryLength.value || 0),
                  resume_scene: selectedScene,
                  assemble_partial_on_stop: Boolean(assemblePartial.value),
                }),
              },
            );
            if (!response.ok) throw new Error(await response.text());
            if ((await response.json()).resolved !== true) throw new Error('审片等待已结束，请等待最新执行状态');
            return;
          } catch (error) {
            decisionError.value = error.message;
            busy.value = false;
            return;
          }
        }
        setWidgetValue(node, "review_decision", decision);
        queuePrompt();
        setTimeout(() => { busy.value = false; }, 800);
      }

      return {
        review, busy, decisionError, history, selectedIndex, selectedTake, selectedLabel, previewUrl,
        availableRuns, selectedRun, loadingHistory, historyError, loadHistory,
        retryPrompt, retrySeed, retryLength, assemblePartial, timeoutMinutes, unloadModels, decide,
      };
    },
    template: `
      <div class="h3c-root">
        <div class="h3c-card">
          <div class="h3c-title">🦅 H3 链 · 审查门</div>
          <div class="h3c-row">
            <select class="h3c-input" v-model="selectedRun" @change="loadHistory" :disabled="review.awaiting_review">
              <option value="">选择历史运行</option>
              <option v-for="run in availableRuns" :key="run.run_name" :value="run.run_name">{{ run.run_name }}</option>
            </select>
            <button class="h3c-btn" @click="loadHistory" :disabled="loadingHistory || review.awaiting_review">{{ loadingHistory ? '读取中…' : '刷新历史片段' }}</button>
          </div>
          <div v-if="historyError" class="h3c-muted" role="alert">{{ historyError }}</div>
          <div v-if="decisionError" class="h3c-muted" role="alert">{{ decisionError }}</div>
          <div class="h3c-row">
            <span class="h3c-muted">{{ selectedLabel }}</span>
            <span class="h3c-muted" v-if="review.clip_count">累计预览: {{ history.length }} / {{ review.clip_count }}</span>
            <span class="h3c-muted" v-if="review.mode">模式: {{ review.mode }}</span>
          </div>
          <div class="h3c-review-history" v-if="history.length > 1">
            <button v-for="(take, index) in history" :key="take.index + ':' + take.clip_path"
                    class="h3c-btn h3c-review-take"
                    :class="{ active: (selectedIndex < 0 ? history.length - 1 : selectedIndex) === index }"
                    @click="selectedIndex = index">
              S{{ Number(take.index || 0) + 1 }} · r{{ String(Number(take.revision || 1)).padStart(4, '0') }}
            </button>
          </div>
          <div v-if="previewUrl" style="margin:6px 0;">
            <video class="h3c-video" :src="previewUrl" controls playsinline preload="metadata"></video>
          </div>
          <div v-else class="h3c-muted">等待预览视频…</div>
          <div v-if="review.summary" class="h3c-muted">{{ review.summary }}</div>
          <template v-if="review.awaiting_review">
            <div class="h3c-muted">重试可修改当前镜头提示词、种子和 H3 原始帧数（必须满足 17k+5）。</div>
            <textarea class="h3c-textarea" v-model="retryPrompt" placeholder="当前镜头提示词"></textarea>
            <div class="h3c-row">
              <label class="h3c-muted">种子 <input class="h3c-input" type="number" v-model.number="retrySeed"></label>
              <label class="h3c-muted">length <input class="h3c-input" type="number" min="0" max="3592" step="1" v-model.number="retryLength"></label>
              <label class="h3c-muted"><input type="checkbox" v-model="assemblePartial"> 停止时合成已批准片段</label>
              <label class="h3c-muted">自动通过(分) <input class="h3c-input" type="number" min="0" step="0.5" v-model.number="timeoutMinutes"></label>
              <label class="h3c-muted"><input type="checkbox" v-model="unloadModels"> 等待时卸载模型</label>
            </div>
          </template>
          <div v-if="review.awaiting_review" class="h3c-row" style="margin-top:6px;">
            <button class="h3c-btn primary" @click="decide('approve')" :disabled="busy">批准 & 继续</button>
            <button class="h3c-btn" @click="decide('retry')" :disabled="busy">按修改重试</button>
            <button class="h3c-btn" @click="decide('reroll')" :disabled="busy">换种子重抽</button>
            <button class="h3c-btn" v-if="selectedTake" @click="decide('resume')" :disabled="busy">从所选场景重做</button>
            <button class="h3c-btn danger" @click="decide('approve_stop')" :disabled="busy">批准并停止</button>
          </div>
          <div v-else-if="review.decision" class="h3c-muted" style="margin-top:6px;">
            已决策: {{ review.decision }}
          </div>
        </div>
      </div>
    `,
  };
}

function unwrapUiPayload(value) {
  if (Array.isArray(value)) return value.findLast(item => item && typeof item === 'object' && !Array.isArray(item)) || null;
  return value && typeof value === 'object' ? value : null;
}

function applyReviewPayload(node, payload) {
  payload = unwrapUiPayload(payload);
  const view = node?._h3cVueApp?._h3cView;
  if (!view || !payload) return;
  view.busy = false;
  view.review = payload;
  if (!payload.restored_history) {
    const start = findUpstreamNode(node, 'EagleH3NativeLoopStartNode');
    const startView = start?._h3cVueApp?._h3cView;
    if (startView) startView.info = { ...startView.info,
      run_name: payload.run_name, mode: payload.mode,
      total_shots: payload.clip_count,
      current_index: payload.current_index,
      completed_shots: new Set((payload.history || []).filter(take => take.decision === 'approved').map(take => take.index)).size,
      summary: payload.awaiting_review ? '当前场景已生成，等待审片决策' : payload.summary,
    };
  }
  if (payload.run_name) {
    node.properties ||= {};
    node.properties.h3_review_run = payload.run_name;
    view.selectedRun = payload.run_name;
  }
  if (payload.awaiting_review) {
    view.retryPrompt = payload.prompt || "";
    view.retrySeed = Number(payload.seed ?? -1);
    view.retryLength = Number(payload.length || 0);
  }
  if (payload.reset_decision) {
    setWidgetValue(node, "review_decision", "");
    setWidgetValue(node, "resume_scene", 0);
  }
  setTimeout(() => resizeReviewPanel(node, node._h3cVueApp, payload), 0);
}

let reviewEventInstalled = false;
function installLiveReviewEvent() {
  if (reviewEventInstalled) return;
  reviewEventInstalled = true;
  api.addEventListener("eagle_h3_review_pending", event => {
    const payload = event?.detail || {};
    const rawId = String(payload.node_id || "");
    const displayId = rawId.split(/[.:/]/).filter(Boolean).at(-1);
    let node = displayId && app.graph?.getNodeById?.(Number(displayId));
    if (!rawId) {
      const candidates = (app.graph?._nodes || []).filter(
        item => item.type === "EagleH3CheckpointReviewNode"
      );
      node = candidates.length === 1 ? candidates[0] : null;
    }
    if (node?.type === "EagleH3CheckpointReviewNode") applyReviewPayload(node, payload);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Vue 组件：结束节点面板
// ═══════════════════════════════════════════════════════════════════════════
function createEndPanel() {
  return {
    setup() {
      const loop = ref({});
      return { loop };
    },
    template: `
      <div class="h3c-root">
        <div class="h3c-card">
          <div class="h3c-title">🦅 H3 链 · 结束</div>
          <div class="h3c-row">
            <span class="h3c-muted" v-if="loop.done">✅ 全部完成</span>
            <span class="h3c-muted" v-else-if="loop.loop_again">🔄 继续下一轮</span>
            <span class="h3c-muted" v-else>等待决策</span>
          </div>
          <div v-if="loop.summary" class="h3c-muted">{{ loop.summary }}</div>
        </div>
      </div>
    `,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Vue 组件：接缝探测面板
// ═══════════════════════════════════════════════════════════════════════════
function createSeamPanel() {
  return {
    setup() {
      const data = ref({});
      const report = computed(() => data.value.report || "");
      const previewUrl = computed(() => buildViewUrl(data.value.preview_clip));
      return { data, report, previewUrl };
    },
    template: `
      <div class="h3c-root">
        <div class="h3c-card">
          <div class="h3c-title">🦅 H3 链 · 接缝探测</div>
          <img v-if="previewUrl" class="h3c-preview-img" :src="previewUrl" alt="seam preview" />
          <pre class="h3c-pre">{{ report }}</pre>
        </div>
      </div>
    `,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 通用挂载：DOM Widget + Vue
// ═══════════════════════════════════════════════════════════════════════════
function mountVueWidget(node, componentFactory, key, options = {}) {
  injectCSS();
  const el = document.createElement("div");
  el.dataset.h3NodeId = String(node.id);
  el.className = "h3c-root" + (options.className ? " " + options.className : "");
  const vueApp = createApp(componentFactory(node));
  // mount() returns the supported public proxy; setup refs are unwrapped here.
  // Production Vue does not expose app._instance and setup() is not data().
  vueApp._h3cView = vueApp.mount(el);
  const viewportHeight = options.height || 190;
  const widget = node.addDOMWidget(`h3c_${key}_ui`, "div", el, {
    serialize: false,
    hideInPanel: true,
    getMinHeight: () => viewportHeight,
    getMaxHeight: () => viewportHeight,
    getHeight: () => viewportHeight,
  });
  widget.width = undefined;
  widget._h3cHeight = viewportHeight;
  widget.computeSize = function (width) {
    return [Math.max(280, width || (node.size && node.size[0]) || 320), widget._h3cHeight];
  };
  const oldResize = node.onResize;
  node.onResize = function (size) {
    if (oldResize) oldResize.apply(this, arguments);
    el.style.width = Math.max(260, (size && size[0] ? size[0] : 300) - 20) + "px";
  };
  node.onResize(node.size || [320, 260]);
  if (options.fitHeight) {
    setTimeout(() => {
      const width = Math.max(options.minWidth || 360, (node.size && node.size[0]) || 360);
      const current = (node.size && node.size[1]) || options.fitHeight;
      if (current > options.fitHeight + 80 || current < options.fitHeight - 40) {
        node.setSize([width, options.fitHeight]);
        node.graph?.setDirtyCanvas(true, true);
      }
    }, 0);
  }
  const oldRemoved = node.onRemoved;
  node.onRemoved = function () {
    node._h3cHistoryAbort?.abort();
    for (const video of el.querySelectorAll('video')) {
      video.pause(); video.removeAttribute('src'); video.load();
    }
    try { vueApp.unmount(); } catch (_) {}
    if (oldRemoved) oldRemoved.apply(this, arguments);
  };
  vueApp._h3cWidget = widget;
  return vueApp;
}

function mountInfoWidget(node, key) {
  const app = mountVueWidget(node, createInfoPanel, key);
  return app;
}

const H3_CORE_NEXT = {
  EagleH3DirectorNode: ["EagleH3NativeLoopStartNode", "循环开始"],
  EagleH3NativeLoopStartNode: ["EagleH3ShotContextNode", "镜头与上下文"],
  EagleH3ShotContextNode: ["EagleH3ReferenceConditionNode", "参考条件与运动上下文"],
  EagleH3ReferenceConditionNode: ["EagleH3FrameTrimNode", "重叠帧与音频裁剪"],
  EagleH3FrameTrimNode: ["EagleH3CheckpointReviewNode", "分段保存与审片"],
  EagleH3CheckpointReviewNode: ["EagleH3NativeLoopEndNode", "循环结束与合成"],
};

function slotIndex(node, side, name) {
  const slots = side === "output" ? (node.outputs || []) : (node.inputs || []);
  return slots.findIndex(slot => slot && slot.name === name);
}

function connectNamed(fromNode, outputName, toNode, inputName, options = {}) {
  const output = slotIndex(fromNode, "output", outputName);
  const input = slotIndex(toNode, "input", inputName);
  if (output < 0 || input < 0) return false;
  const target = toNode.inputs && toNode.inputs[input];
  const existing = target && target.link != null
    ? graphLink(toNode.graph, target.link)
    : null;
  if (existing && existing.origin_id === fromNode.id && existing.origin_slot === output) {
    return false;
  }
  if (options.onlyIfEmpty && target && target.link != null) return false;
  fromNode.connect(output, toNode, input);
  return true;
}

function uniqueNode(graph, type) {
  const matches = (graph?._nodes || []).filter(node => node && node.type === type);
  return matches.length === 1 ? matches[0] : null;
}

function inputLinkSource(graph, node, inputName) {
  const inputIndex = slotIndex(node, "input", inputName);
  const input = inputIndex >= 0 && node.inputs ? node.inputs[inputIndex] : null;
  const link = input ? graphLink(graph, input.link) : null;
  const source = link && graph?.getNodeById ? graph.getNodeById(link.origin_id) : null;
  return { inputIndex, input, link, source };
}

function primaryH3Sampler(graph, reference) {
  if (!(graph && reference)) return null;
  const candidates = (graph._nodes || []).filter(node => {
    if (!node || node.type !== "SamplerCustomAdvanced") return false;
    return inputLinkSource(graph, node, "latent_image").source?.id === reference.id;
  });
  return candidates.find(node => (
    inputLinkSource(graph, node, "sigmas").source?.type === "BasicScheduler"
  )) || candidates[0] || null;
}

function samplerLatentOutputName(sampler) {
  const preferred = (sampler?.outputs || []).find(output => output?.name === "output");
  const latent = preferred || (sampler?.outputs || []).find(output => output?.type === "LATENT");
  return latent?.name || "";
}

function repairMediaBridgePorts(node) {
  if (!node || node.type !== "EagleH3MediaBridgeNode" || !node.outputs?.[1]) return false;
  const aliases = {
    reference_images: "ref_images",
    video_frames_1: "ref_video_0",
    video_frames_2: "ref_video_1",
    video_frames_3: "ref_video_2",
    video_audio_1: "ref_video_audio_0",
    video_audio_2: "ref_video_audio_1",
    video_audio_3: "ref_video_audio_2",
    reference_audio_1: "ref_audio_0",
    reference_audio_2: "ref_audio_1",
    reference_audio_3: "ref_audio_2",
  };
  let changed = false;
  (node.inputs || []).forEach(input => {
    if (aliases[input?.name]) {
      input.name = aliases[input.name];
      changed = true;
    }
  });
  (node.outputs || []).forEach(output => {
    if (aliases[output?.name]) {
      output.name = aliases[output.name];
      changed = true;
    }
  });
  const output = node.outputs[1];
  changed = output.name !== "first_reference_image" || output.shape != null || changed;
  output.name = "first_reference_image";
  output.localized_name = "首张参考图";
  // V1 将该槽声明为 Comfy 列表（GRID shape），但下游 seed_image
  // 需要普通 IMAGE。清除序列化遗留的列表形状，后端同步返回单张图。
  if (output.shape != null) delete output.shape;
  return changed;
}

function repairShotContextPorts(node) {
  if (!node || node.type !== "EagleH3ShotContextNode") return false;
  const output = (node.outputs || []).find(slot => slot?.name === "raw_frames");
  if (!output) return false;
  output.name = "length";
  output.localized_name = "H3 生成帧长";
  return true;
}

function repairMediaBridgeSeedLink(graph) {
  const bridge = uniqueNode(graph, "EagleH3MediaBridgeNode");
  const shot = uniqueNode(graph, "EagleH3ShotContextNode");
  if (!(bridge && shot)) return 0;
  repairMediaBridgePorts(bridge);
  const linked = inputLinkSource(graph, shot, "seed_image");
  if (!(linked.source && linked.source.id === bridge.id && linked.link)) return 0;
  if (linked.link.origin_slot === 1) return 0;
  // V1 全工作流误把槽 2（video_frames_1/ref_video_0）接到 seed_image。
  if (linked.link.origin_slot !== 2) return 0;
  return connectNamed(
    bridge, "first_reference_image", shot, "seed_image", { onlyIfEmpty: false }
  ) ? 1 : 0;
}

function disconnectDirectorPlanOverride(graph, director, plan) {
  const linked = inputLinkSource(graph, plan, "plan_json_input");
  if (!(linked.source && linked.source.id === director.id && linked.link)) return false;
  const output = linked.source.outputs?.[linked.link.origin_slot];
  if (!output || output.name !== "context_loop_plan_json") return false;
  if (typeof plan.disconnectInput === "function") plan.disconnectInput(linked.inputIndex);
  else if (typeof graph.removeLink === "function") {
    graph.removeLink(linked.link.id ?? linked.input?.link);
  }
  return true;
}

function syncContextLoopPlanWidget(director) {
  const graph = director?.graph;
  const plan = uniqueNode(graph, "MiniMaxH3ChainPlan");
  const exporter = director?._h3ContextLoopPlanJson;
  const widget = plan?.widgets?.find(item => item && item.name === "plan_json");
  if (!(plan && widget && typeof exporter === "function")) return false;
  let value = "";
  try {
    value = String(exporter() || "");
    JSON.parse(value);
  } catch (error) {
    console.warn("[H3Pipeline] 导演台计划镜像不是有效 JSON", error);
    return false;
  }
  if (!value || String(widget.value || "") === value) return false;
  widget.value = value;
  if (typeof widget.callback === "function") widget.callback(value, widget, plan);
  plan.setDirtyCanvas?.(true, true);
  return true;
}

function syncNativeLoopStartInfo(director) {
  const graph = director?.graph;
  const start = uniqueNode(graph, "EagleH3NativeLoopStartNode");
  const exporter = director?._h3ContextLoopPlanJson;
  const view = start?._h3cVueApp?._h3cView;
  if (!(start && view && typeof exporter === "function")) return false;
  let mirror;
  try {
    mirror = JSON.parse(String(exporter() || "{}"));
  } catch (error) {
    console.warn("[H3Pipeline] 无法同步原生循环场景数", error);
    return false;
  }
  const total = Array.isArray(mirror.shots) ? mirror.shots.length : 0;
  const old = view.info || {};
  const running = old.run_name || old.base_dir;
  view.info = {
    ...old,
    current_index: running ? Number(old.current_index || 0) : 0,
    completed_shots: running ? Number(old.completed_shots || 0) : 0,
    total_shots: total,
    clip_count: total,
    mode: old.mode || "auto",
    queue_contract: "single_queue_dynamic_scenes",
  };
  start.setDirtyCanvas?.(true, true);
  return true;
}

function installContextLoopPlanSync(director) {
  if (!director) return;
  director._eagleSyncContextLoopBridges = () => {
    const thirdParty = syncContextLoopPlanWidget(director);
    const nativeLoop = syncNativeLoopStartInfo(director);
    return thirdParty || nativeLoop;
  };
  // Director Vue 在 onNodeCreated 中挂载；旧图 configure 后可能晚一个 tick
  // 才暴露 exporter，小延时重试能避免首次刷新仍显示空计划。
  [0, 50, 250].forEach(delay => setTimeout(() => {
    director._eagleSyncContextLoopBridges?.();
  }, delay));
}

function repairNativeCoreLinks(graph, options = {}) {
  if (!graph) return 0;
  const director = uniqueNode(graph, "EagleH3DirectorNode");
  const start = uniqueNode(graph, "EagleH3NativeLoopStartNode");
  const shot = uniqueNode(graph, "EagleH3ShotContextNode");
  const reference = uniqueNode(graph, "EagleH3ReferenceConditionNode");
  const trim = uniqueNode(graph, "EagleH3FrameTrimNode");
  const review = uniqueNode(graph, "EagleH3CheckpointReviewNode");
  const end = uniqueNode(graph, "EagleH3NativeLoopEndNode");
  if (!(director && start && shot && reference && trim && review && end)) return 0;
  const sampler = primaryH3Sampler(graph, reference);
  const samplerOutput = samplerLatentOutputName(sampler);

  const links = [
    [director, "plan", start, "plan"],
    [director, "media_bundle", reference, "media_bundle"],
    [start, "state", shot, "state"],
    [start, "width", reference, "width"],
    [start, "height", reference, "height"],
    [start, "fps", trim, "fps"],
    [shot, "state", reference, "state"],
    [shot, "prompt", reference, "prompt"],
    // length 是逐镜数据，不允许静默退回固定 124 帧。
    [shot, "length", reference, "length"],
    [shot, "context_image", reference, "context_image"],
    [shot, "has_context", reference, "has_context"],
    [reference, "trim_frames", trim, "trim_frames"],
    [shot, "delivered_frames", trim, "target_frames"],
    [shot, "state", review, "state"],
    [trim, "images", review, "images"],
    [trim, "audio", review, "audio"],
    [trim, "images_with_overlap", review, "images_with_overlap"],
    [start, "flow", end, "flow"],
    [review, "state", end, "state"],
    [trim, "images", end, "images"],
  ];
  if (sampler && samplerOutput) {
    links.push(
      [sampler, samplerOutput, review, "sampled_latent"],
      [sampler, samplerOutput, end, "sampled_latent"],
    );
  }
  let repaired = 0;
  links.forEach(args => {
    if (connectNamed(...args, { onlyIfEmpty: options.onlyIfEmpty !== false })) repaired += 1;
  });
  if (repaired) graph.setDirtyCanvas(true, true);
  return repaired;
}

function repairContextLoopAuthoringLinks(graph, options = {}) {
  if (!graph) return 0;
  const director = uniqueNode(graph, "EagleH3DirectorNode");
  const editors = (graph._nodes || []).filter(node => node && [
    "MiniMaxH3ChainScenePromptEditor",
    "MiniMaxH3ChainRichScenePromptEditor",
    "MiniMaxH3ChainPlanStudio",
  ].includes(node.type));
  if (!director) return 0;

  let plan = uniqueNode(graph, "MiniMaxH3ChainPlan");
  let repaired = 0;
  // 旧图常用 Eagle State Interop 伪装 Plan 桥。第三方编辑器必须能回溯
  // 到真实 MiniMaxH3ChainPlan；只在单导演台+单编辑器时自动补建，避免猜链。
  if (!plan && options.createMissing && editors.length === 1) {
    const editor = editors[0];
    plan = createH3Node(graph, "MiniMaxH3ChainPlan", [
      Math.round(editor.pos[0] - 620),
      Math.round(editor.pos[1]),
    ]);
    if (plan) repaired += 1;
  }
  if (!plan) return 0;

  // plan_json_input 是后端强制覆盖。若一直连着导演台，第三方编辑器写回
  // plan_json 的修改会被忽略。改用前端镜像初始值，才能同时正常预览和编辑。
  if (disconnectDirectorPlanOverride(graph, director, plan)) repaired += 1;
  installContextLoopPlanSync(director);
  if (syncContextLoopPlanWidget(director)) repaired += 1;

  editors.forEach(editor => {
    const linked = inputLinkSource(graph, editor, "plan");
    const { input, link, source } = linked;
    const directFromEagle = source && source.type === "EagleH3DirectorNode";
    const interopInput = source && source.type === "EagleH3StateInteropNode"
      ? slotIndex(source, "input", "source")
      : -1;
    const interopLink = interopInput >= 0 && source.inputs
      ? graphLink(graph, source.inputs[interopInput]?.link)
      : null;
    const interopSource = interopLink && graph.getNodeById
      ? graph.getNodeById(interopLink.origin_id)
      : null;
    const badInteropBridge = Boolean(interopSource && interopSource.type === "EagleH3DirectorNode");
    if (!input || input.link == null || directFromEagle || badInteropBridge) {
      if (connectNamed(plan, "plan", editor, "plan", { onlyIfEmpty: false })) repaired += 1;
    }
  });

  // 编辑结果必须进入 Loop Start，否则 UI 看似可编辑、执行仍用导演台旧计划。
  const loopStart = uniqueNode(graph, "MiniMaxH3ChainLoopStart");
  const editor = editors.length === 1 ? editors[0] : null;
  if (loopStart && editor && connectNamed(
    editor, "plan", loopStart, "plan", { onlyIfEmpty: false }
  )) repaired += 1;

  if (repaired) graph.setDirtyCanvas(true, true);
  return repaired;
}

function outputTargetsType(graph, node, outputName, targetType) {
  const outputIndex = slotIndex(node, "output", outputName);
  const output = outputIndex >= 0 && node.outputs ? node.outputs[outputIndex] : null;
  return Boolean(output && (output.links || []).some(linkId => {
    const link = graphLink(graph, linkId);
    const target = link && graph.getNodeById ? graph.getNodeById(link.target_id) : null;
    return target && target.type === targetType;
  }));
}

function repairContextLoopReferenceLinks(graph, options = {}) {
  if (!graph) return 0;
  const current = uniqueNode(graph, "MiniMaxH3ChainCurrent");
  const reference = uniqueNode(graph, "EagleH3ReferenceConditionNode");
  if (!(current && reference)) return 0;
  // 只在明确接入第三方 Context 的混合参考链中自动改线；右键手动修复可强制。
  const activeThirdPartyChain = outputTargetsType(
    graph, reference, "positive", "MiniMaxH3ChainContext"
  );
  if (!options.force && !activeThirdPartyChain) return 0;

  let repaired = 0;
  for (const [outputName, inputName] of [
    ["state", "state"],
    ["prompt", "prompt"],
    ["length", "length"],
    ["width", "width"],
    ["height", "height"],
  ]) {
    if (connectNamed(current, outputName, reference, inputName, { onlyIfEmpty: false })) {
      repaired += 1;
    }
  }
  const director = uniqueNode(graph, "EagleH3DirectorNode");
  if (director && connectNamed(
    director, "media_bundle", reference, "media_bundle", { onlyIfEmpty: true }
  )) repaired += 1;
  if (repaired) graph.setDirtyCanvas(true, true);
  return repaired;
}

function createH3Node(graph, type, pos) {
  const liteGraph = globalThis.LiteGraph;
  if (!graph || !liteGraph || typeof liteGraph.createNode !== "function") return null;
  const node = liteGraph.createNode(type);
  if (!node) return null;
  node.pos = [Math.round(pos[0]), Math.round(pos[1])];
  graph.add(node);
  return node;
}

function addNextCoreNode(source, type) {
  const graph = source && source.graph;
  if (!graph) return null;
  const next = createH3Node(graph, type, [source.pos[0] + source.size[0] + 70, source.pos[1]]);
  if (!next) return null;
  if (source.type === "EagleH3DirectorNode") connectNamed(source, "plan", next, "plan");
  else if (source.type === "EagleH3NativeLoopStartNode") connectNamed(source, "state", next, "state");
  else if (source.type === "EagleH3ShotContextNode") {
    connectNamed(source, "state", next, "state");
    connectNamed(source, "prompt", next, "prompt");
    connectNamed(source, "length", next, "length");
    connectNamed(source, "context_image", next, "context_image");
    connectNamed(source, "has_context", next, "has_context");
    const starts = (graph._nodes || []).filter(node => node.type === "EagleH3NativeLoopStartNode");
    if (starts.length === 1) {
      connectNamed(starts[0], "width", next, "width");
      connectNamed(starts[0], "height", next, "height");
    }
    const directors = (graph._nodes || []).filter(node => node.type === "EagleH3DirectorNode");
    if (directors.length === 1) connectNamed(directors[0], "media_bundle", next, "media_bundle");
  }
  else if (source.type === "EagleH3ReferenceConditionNode") {
    connectNamed(source, "trim_frames", next, "trim_frames");
    const starts = (graph._nodes || []).filter(node => node.type === "EagleH3NativeLoopStartNode");
    if (starts.length === 1) connectNamed(starts[0], "fps", next, "fps");
    const shots = (graph._nodes || []).filter(node => node.type === "EagleH3ShotContextNode");
    if (shots.length === 1) connectNamed(shots[0], "delivered_frames", next, "target_frames");
  }
  else if (source.type === "EagleH3FrameTrimNode") {
    connectNamed(source, "images", next, "images");
    connectNamed(source, "audio", next, "audio");
    connectNamed(source, "images_with_overlap", next, "images_with_overlap");
    const shots = (graph._nodes || []).filter(node => node.type === "EagleH3ShotContextNode");
    if (shots.length === 1) connectNamed(shots[0], "state", next, "state");
  }
  else if (source.type === "EagleH3CheckpointReviewNode") {
    connectNamed(source, "state", next, "state");
    const starts = (graph._nodes || []).filter(node => node.type === "EagleH3NativeLoopStartNode");
    if (starts.length === 1) connectNamed(starts[0], "flow", next, "flow");
    const trims = (graph._nodes || []).filter(node => node.type === "EagleH3FrameTrimNode");
    if (trims.length === 1) connectNamed(trims[0], "images", next, "images");
    const references = (graph._nodes || []).filter(node => node.type === "EagleH3ReferenceConditionNode");
    const sampler = references.length === 1 ? primaryH3Sampler(graph, references[0]) : null;
    const output = samplerLatentOutputName(sampler);
    if (sampler && output) {
      connectNamed(sampler, output, source, "sampled_latent");
      connectNamed(sampler, output, next, "sampled_latent");
    }
  }
  graph.setDirtyCanvas(true, true);
  return next;
}

function addDirectorBoundaryNode(directorNode, type, outputName) {
  const graph = directorNode && directorNode.graph;
  if (!graph) return null;
  const offsetY = type === "EagleH3MediaBridgeNode" ? 210 : 70;
  const node = createH3Node(
    graph,
    type,
    [directorNode.pos[0] + directorNode.size[0] + 70, directorNode.pos[1] + offsetY]
  );
  if (!node) return null;
  connectNamed(directorNode, outputName, node, type === "EagleH3PlanInteropNode" ? "source" : "media_bundle");
  graph.setDirtyCanvas(true, true);
  return node;
}

function addStateBoundaryNode(sourceNode) {
  const graph = sourceNode && sourceNode.graph;
  if (!graph) return null;
  const node = createH3Node(
    graph,
    "EagleH3StateInteropNode",
    [sourceNode.pos[0] + sourceNode.size[0] + 70, sourceNode.pos[1] + 90]
  );
  if (!node) return null;
  const outputName = slotIndex(sourceNode, "output", "state") >= 0 ? "state" : "run_state";
  connectNamed(sourceNode, outputName, node, "source");
  graph.setDirtyCanvas(true, true);
  return node;
}

function createCoreChain(directorNode) {
  const graph = directorNode && directorNode.graph;
  if (!graph) return;
  const x = directorNode.pos[0] + directorNode.size[0] + 70;
  const y = directorNode.pos[1];
  const start = createH3Node(graph, "EagleH3NativeLoopStartNode", [x, y]);
  const shot = createH3Node(graph, "EagleH3ShotContextNode", [x + 350, y]);
  const reference = createH3Node(graph, "EagleH3ReferenceConditionNode", [x + 830, y]);
  const trim = createH3Node(graph, "EagleH3FrameTrimNode", [x + 1520, y]);
  const review = createH3Node(graph, "EagleH3CheckpointReviewNode", [x + 1900, y]);
  const end = createH3Node(graph, "EagleH3NativeLoopEndNode", [x + 2380, y]);
  if (!(start && shot && reference && trim && review && end)) return;
  connectNamed(directorNode, "plan", start, "plan");
  connectNamed(directorNode, "media_bundle", reference, "media_bundle");
  connectNamed(start, "state", shot, "state");
  connectNamed(start, "width", reference, "width");
  connectNamed(start, "height", reference, "height");
  connectNamed(start, "fps", trim, "fps");
  connectNamed(shot, "state", reference, "state");
  connectNamed(shot, "prompt", reference, "prompt");
  connectNamed(shot, "length", reference, "length");
  connectNamed(shot, "context_image", reference, "context_image");
  connectNamed(shot, "has_context", reference, "has_context");
  connectNamed(reference, "trim_frames", trim, "trim_frames");
  connectNamed(shot, "delivered_frames", trim, "target_frames");
  connectNamed(shot, "state", review, "state");
  connectNamed(trim, "images", review, "images");
  connectNamed(trim, "audio", review, "audio");
  connectNamed(trim, "images_with_overlap", review, "images_with_overlap");
  connectNamed(start, "flow", end, "flow");
  connectNamed(review, "state", end, "state");
  graph.setDirtyCanvas(true, true);
}

function createContextLoopAuthoringBridge(directorNode) {
  const graph = directorNode && directorNode.graph;
  if (!graph) return;
  const x = directorNode.pos[0] + directorNode.size[0] + 70;
  const y = directorNode.pos[1] + Math.max(420, directorNode.size[1] + 70);
  const plan = createH3Node(graph, "MiniMaxH3ChainPlan", [x, y]);
  if (!plan) {
    console.warn("[H3Pipeline] 未安装 MiniMaxH3-Context-Loop，无法创建兼容编辑链");
    return;
  }
  const editor = createH3Node(
    graph,
    "MiniMaxH3ChainScenePromptEditor",
    [x + Math.max(520, plan.size?.[0] || 0) + 70, y]
  );
  if (editor) connectNamed(plan, "plan", editor, "plan");
  const loopStart = uniqueNode(graph, "MiniMaxH3ChainLoopStart");
  if (editor && loopStart) connectNamed(editor, "plan", loopStart, "plan");
  installContextLoopPlanSync(directorNode);
  graph.setDirtyCanvas(true, true);
}

function installCoreQuickAdd(nodeType, nodeData) {
  const next = H3_CORE_NEXT[nodeData.name];
  const hasStateOutput = new Set([
    "EagleH3NativeLoopStartNode",
    "EagleH3ShotContextNode",
    "EagleH3CheckpointReviewNode",
    "EagleH3NativeLoopEndNode",
  ]).has(nodeData.name);
  if (!next && nodeData.name !== "EagleH3DirectorNode" && !hasStateOutput) return;
  const previous = nodeType.prototype.getExtraMenuOptions;
  nodeType.prototype.getExtraMenuOptions = function(_, options) {
    if (previous) previous.apply(this, arguments);
    options.push(null);
    if (next) {
      options.push({
        content: "🦅 添加后续节点：" + next[1],
        callback: () => addNextCoreNode(this, next[0]),
      });
    }
    options.push({
      content: "🦅 修复 H3 原生主链连接",
      callback: () => repairNativeCoreLinks(this.graph, { onlyIfEmpty: true }),
    });
    if (nodeData.name === "EagleH3ReferenceConditionNode") {
      options.push({
        content: "🦅 接入 Context Loop Current Shot 数据",
        callback: () => repairContextLoopReferenceLinks(this.graph, { force: true }),
      });
    }
    if (hasStateOutput) {
      options.push({
        content: "🦅 添加状态 / 上一片段互操作桥",
        callback: () => addStateBoundaryNode(this),
      });
    }
    if (nodeData.name === "EagleH3DirectorNode") {
      options.push({
        content: "🦅 创建 H3 核心主链",
        callback: () => createCoreChain(this),
      });
      options.push({
        content: "🦅 创建 Context Loop 兼容编辑链",
        callback: () => createContextLoopAuthoringBridge(this),
      });
      options.push({
        content: "🦅 修复 Context Loop 编辑预览链",
        callback: () => repairContextLoopAuthoringLinks(this.graph, { onlyIfEmpty: true }),
      });
      options.push({
        content: "🦅 添加计划 JSON 互操作桥",
        callback: () => addDirectorBoundaryNode(this, "EagleH3PlanInteropNode", "plan"),
      });
      options.push({
        content: "🦅 添加标准媒体桥",
        callback: () => addDirectorBoundaryNode(this, "EagleH3MediaBridgeNode", "media_bundle"),
      });
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 注册扩展
// ═══════════════════════════════════════════════════════════════════════════
const LEGACY_MEDIA_PORT_NAMES = {
  REF_IMAGES: "REF_IMAGES",
  "ref_videos.ref_video_0": "ref_video_0",
  "ref_videos.ref_video_1": "ref_video_1",
  "ref_videos.ref_video_2": "ref_video_2",
  "ref_video_audios.ref_video_audio_0": "video_audio_0",
  "ref_video_audios.ref_video_audio_1": "video_audio_1",
  "ref_video_audios.ref_video_audio_2": "video_audio_2",
  "ref_audios.ref_audio_0": "ref_audio_0",
  "ref_audios.ref_audio_1": "ref_audio_1",
  "ref_audios.ref_audio_2": "ref_audio_2",
  media_mapping: "media_mapping",
};

function graphLink(graph, linkId) {
  if (linkId == null) return null;
  return (graph.links && graph.links[linkId]) ||
    (graph._links && graph._links[linkId]) || null;
}

function findUpstreamNode(node, type, visited = new Set()) {
  if (!node || visited.has(String(node.id))) return null;
  visited.add(String(node.id));
  if (node.type === type) return node;
  for (const input of node.inputs || []) {
    const link = graphLink(node.graph, input.link);
    const found = link && findUpstreamNode(node.graph.getNodeById(link.origin_id), type, visited);
    if (found) return found;
  }
  return null;
}

/**
 * 旧节点端口按开发顺序交错排列。加载旧工作流时按名称语义重连到 V2，
 * 不依赖旧索引，也不要求用户手工重接已有链路。
 */
function migrateLegacyMediaPorts() {
  const graph = app.graph;
  if (!graph) return;
  const legacyNodes = (graph._nodes || []).filter(
    node => node && node.type === "EagleH3MediaPortsNode"
  );
  if (!legacyNodes.length) return;

  legacyNodes.forEach(oldNode => {
    const incomingId = oldNode.inputs && oldNode.inputs[0] && oldNode.inputs[0].link;
    const incoming = graphLink(graph, incomingId);
    const outgoing = [];
    (oldNode.outputs || []).forEach(output => {
      const newName = output && LEGACY_MEDIA_PORT_NAMES[output.name];
      if (!newName) return;
      (output.links || []).forEach(linkId => {
        const link = graphLink(graph, linkId);
        if (link) outgoing.push({ newName, targetId: link.target_id, targetSlot: link.target_slot });
      });
    });

    const replacement = createH3Node(
      graph,
      "EagleH3MediaPortsV2Node",
      [oldNode.pos[0], oldNode.pos[1]]
    );
    if (!replacement) return;
    if (oldNode.size && replacement.setSize) {
      replacement.setSize([Math.max(300, oldNode.size[0] || 300), oldNode.size[1] || 240]);
    }
    if (incoming) {
      const origin = graph.getNodeById && graph.getNodeById(incoming.origin_id);
      if (origin) origin.connect(incoming.origin_slot, replacement, 0);
    }
    outgoing.forEach(item => {
      const target = graph.getNodeById && graph.getNodeById(item.targetId);
      const outputSlot = slotIndex(replacement, "output", item.newName);
      if (target && outputSlot >= 0) replacement.connect(outputSlot, target, item.targetSlot);
    });
    graph.remove(oldNode);
  });
  graph.setDirtyCanvas(true, true);
}

app.registerExtension({
  name: "EagleH3Pipeline",
  async setup() {
    installLiveReviewEvent();
  },
  async afterGraphConfigured() {
    // 先让 LiteGraph 恢复所有 link，再做语义化迁移。
    setTimeout(() => {
      migrateLegacyMediaPorts();
      repairMediaBridgeSeedLink(app.graph);
      repairNativeCoreLinks(app.graph, { onlyIfEmpty: true });
      installContextLoopPlanSync(uniqueNode(app.graph, "EagleH3DirectorNode"));
      repairContextLoopAuthoringLinks(app.graph, { onlyIfEmpty: true, createMissing: true });
      repairContextLoopReferenceLinks(app.graph);
      for (const node of app.graph?._nodes || []) {
        if (node.type === 'EagleH3CheckpointReviewNode') node._h3cVueApp?._h3cView?.loadHistory();
      }
    }, 0);
  },
  async beforeRegisterNodeDef(nodeType, nodeData) {
    const name = nodeData.name;
    installCoreQuickAdd(nodeType, nodeData);

    if (name === "EagleH3CheckpointReviewNode") {
      const inputDefs = nodeData?.input || nodeData?.inputs;
      for (const groupName of ["required", "optional"]) {
        const group = inputDefs?.[groupName];
        for (const widgetName of REVIEW_HIDDEN_WIDGETS) {
          const definition = group?.[widgetName];
          if (!Array.isArray(definition)) continue;
          definition[1] = { ...(definition[1] || {}), hidden: true, vueNode: "never", hideInPanel: true };
        }
      }
    }

    if (name === "EagleH3ReferenceConditionNode") {
      const _configured = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function (serialized) {
        const r = _configured ? _configured.apply(this, arguments) : undefined;
        repairReferenceConditionWidgets(this, serialized);
        return r;
      };
    }

    if (name === "EagleH3MediaBridgeNode") {
      const _configured = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function (serialized) {
        const r = _configured ? _configured.apply(this, arguments) : undefined;
        repairMediaBridgePorts(this);
        return r;
      };
    }

    if (name === "EagleH3ShotContextNode") {
      const _configured = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function (serialized) {
        const r = _configured ? _configured.apply(this, arguments) : undefined;
        repairShotContextPorts(this);
        return r;
      };
    }

    // ── Plan ──
    if (name === "EagleH3PlanNode") {
      const _created = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const r = _created ? _created.apply(this, arguments) : undefined;
        const vueApp = mountVueWidget(this, createPlanPanel, "plan");
        this._h3cVueApp = vueApp;
        return r;
      };
      const _exec = nodeType.prototype.onExecuted;
      nodeType.prototype.onExecuted = function (data) {
        if (_exec) _exec.apply(this, arguments);
        if (this._h3cVueApp && data && data.h3_plan) {
          this._h3cVueApp._h3cView.info = unwrapUiPayload(data.h3_plan) || this._h3cVueApp._h3cView.info;
        }
      };
    }

    // ── Start ──
    if (name === "EagleH3NativeLoopStartNode") {
      const _created = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const r = _created ? _created.apply(this, arguments) : undefined;
        const vueApp = mountVueWidget(this, createStartPanel, "start");
        this._h3cVueApp = vueApp;
        return r;
      };
      const _exec = nodeType.prototype.onExecuted;
      nodeType.prototype.onExecuted = function (data) {
        if (_exec) _exec.apply(this, arguments);
        if (this._h3cVueApp && data && data.h3_start) {
          this._h3cVueApp._h3cView.info = unwrapUiPayload(data.h3_start) || this._h3cVueApp._h3cView.info;
        }
      };
    }

    // ── Native End（ComfyUI 同次执行内递归，不由浏览器重新 Queue）──
    if (name === "EagleH3NativeLoopEndNode") {
      const _created = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const r = _created ? _created.apply(this, arguments) : undefined;
        repairNativeEndWidgets(this);
        const vueApp = mountVueWidget(this, createEndPanel, "native_end", {
          height: 82, fitHeight: 330, minWidth: 390, className: "compact",
        });
        this._h3cVueApp = vueApp;
        return r;
      };
      const _configured = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function () {
        const r = _configured ? _configured.apply(this, arguments) : undefined;
        setTimeout(() => {
          repairNativeEndWidgets(this);
        }, 0);
        return r;
      };
      const _exec = nodeType.prototype.onExecuted;
      nodeType.prototype.onExecuted = function (data) {
        if (_exec) _exec.apply(this, arguments);
        if (this._h3cVueApp && data && data.h3_native_loop) {
          this._h3cVueApp._h3cView.loop = unwrapUiPayload(data.h3_native_loop) || this._h3cVueApp._h3cView.loop;
        }
      };
    }

    // ── Review Gate ──
    if (name === "EagleH3CheckpointReviewNode") {
      const _created = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const r = _created ? _created.apply(this, arguments) : undefined;
        const vueApp = mountVueWidget(this, () => createReviewPanel(this), "review", {
          height: 105, fitHeight: 330, minWidth: 430, className: "review",
        });
        this._h3cVueApp = vueApp;
        // 决策由 Vue 按钮写入，不再让原生文本框占位或露出边框。
        if (!hideReviewDecisionWidget(this)) {
          setTimeout(() => hideReviewDecisionWidget(this), 300);
        }
        setTimeout(() => resizeReviewPanel(this, vueApp, {}), 0);
        return r;
      };
      const _configured = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function () {
        const r = _configured ? _configured.apply(this, arguments) : undefined;
        setTimeout(() => {
          hideReviewDecisionWidget(this);
          const review = this._h3cVueApp?._h3cView?.review || {};
          resizeReviewPanel(this, this._h3cVueApp, review);
        }, 0);
        return r;
      };
      const _exec = nodeType.prototype.onExecuted;
      nodeType.prototype.onExecuted = function (data) {
        if (_exec) _exec.apply(this, arguments);
        if (this._h3cVueApp && data && data.h3_review) {
          applyReviewPayload(this, data.h3_review);
        }
      };
    }

    // ── 合并后的镜头上下文与三个可选工具 ──
    // 用通用信息面板兜底
    if (["EagleH3ShotContextNode", "EagleH3SeamProbeNode",
         "EagleH3ExportPNGSequenceNode", "EagleH3SmartSplitNode"].includes(name)) {
      const _created = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const r = _created ? _created.apply(this, arguments) : undefined;
        const vueApp = mountInfoWidget(this, name);
        this._h3cVueApp = vueApp;
        return r;
      };
      const _exec = nodeType.prototype.onExecuted;
      nodeType.prototype.onExecuted = function (data) {
        if (_exec) _exec.apply(this, arguments);
        if (this._h3cVueApp && data) {
          this._h3cVueApp._h3cView.data = data;
        }
      };
    }
  },
});
