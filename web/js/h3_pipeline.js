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
.h3c-video{width:100%; border-radius:6px; background:#000;}
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
      const pct = computed(() => {
        const c = info.value.current_index || 0;
        const t = info.value.total_shots || 1;
        return Math.min(100, Math.max(0, (c / t) * 100));
      });
      return { info, pct };
    },
    template: `
      <div class="h3c-root">
        <div class="h3c-card">
          <div class="h3c-title">🦅 H3 链 · 开始</div>
          <div class="h3c-row">
            <span class="h3c-muted">进度: {{ (info.current_index || 0) + 1 }} / {{ info.total_shots || 0 }}</span>
            <span class="h3c-muted">模式: {{ info.mode || 'auto' }}</span>
          </div>
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
      const previewUrl = computed(() => buildViewUrl(review.value.preview_clip));

      function decide(decision) {
        busy.value = true;
        setWidgetValue(node, "review_decision", decision);
        queuePrompt();
        setTimeout(() => { busy.value = false; }, 800);
      }

      return { review, busy, previewUrl, decide };
    },
    template: `
      <div class="h3c-root">
        <div class="h3c-card">
          <div class="h3c-title">🦅 H3 链 · 审查门</div>
          <div class="h3c-row">
            <span class="h3c-muted">Shot {{ (review.current_index || 0) + 1 }}</span>
            <span class="h3c-muted" v-if="review.mode">模式: {{ review.mode }}</span>
          </div>
          <div v-if="previewUrl" style="margin:6px 0;">
            <video class="h3c-video" :src="previewUrl" controls></video>
          </div>
          <div v-else class="h3c-muted">等待预览视频…</div>
          <div v-if="review.summary" class="h3c-muted">{{ review.summary }}</div>
          <div v-if="review.awaiting_review" class="h3c-row" style="margin-top:6px;">
            <button class="h3c-btn primary" @click="decide('approve')" :disabled="busy">批准 & 继续</button>
            <button class="h3c-btn" @click="decide('retry')" :disabled="busy">重试 (改提示/种子/时长)</button>
            <button class="h3c-btn" @click="decide('reroll')" :disabled="busy">重roll 种子</button>
            <button class="h3c-btn danger" @click="decide('stop')" :disabled="busy">停止</button>
          </div>
          <div v-else-if="review.decision" class="h3c-muted" style="margin-top:6px;">
            已决策: {{ review.decision }}
          </div>
        </div>
      </div>
    `,
  };
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
function mountVueWidget(node, componentFactory, key) {
  injectCSS();
  const el = document.createElement("div");
  el.className = "h3c-root";
  const vueApp = createApp(componentFactory(node));
  vueApp.mount(el);
  const widget = node.addDOMWidget(`h3c_${key}_ui`, "div", el, { serialize: false });
  widget.computeSize = function (width) {
    return [Math.max(280, width || (node.size && node.size[0]) || 320), 190];
  };
  const oldResize = node.onResize;
  node.onResize = function (size) {
    if (oldResize) oldResize.apply(this, arguments);
    el.style.width = Math.max(260, (size && size[0] ? size[0] : 300) - 20) + "px";
  };
  node.onResize(node.size || [320, 260]);
  const oldRemoved = node.onRemoved;
  node.onRemoved = function () {
    try { vueApp.unmount(); } catch (_) {}
    if (oldRemoved) oldRemoved.apply(this, arguments);
  };
  return vueApp;
}

function mountInfoWidget(node, key) {
  const app = mountVueWidget(node, createInfoPanel, key);
  return app;
}

const H3_CORE_NEXT = {
  EagleH3PlanNode: ["EagleH3NativeLoopStartNode", "循环开始"],
  EagleH3NativeLoopStartNode: ["EagleH3ShotContextNode", "镜头与上下文"],
  EagleH3ShotContextNode: ["EagleH3CheckpointReviewNode", "分段保存与审片"],
  EagleH3CheckpointReviewNode: ["EagleH3NativeLoopEndNode", "循环结束与合成"],
};

function slotIndex(node, side, name) {
  const slots = side === "output" ? (node.outputs || []) : (node.inputs || []);
  return slots.findIndex(slot => slot && slot.name === name);
}

function connectNamed(fromNode, outputName, toNode, inputName) {
  const output = slotIndex(fromNode, "output", outputName);
  const input = slotIndex(toNode, "input", inputName);
  if (output >= 0 && input >= 0) fromNode.connect(output, toNode, input);
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
  if (source.type === "EagleH3PlanNode") connectNamed(source, "run_state", next, "run_state");
  else if (source.type === "EagleH3NativeLoopStartNode") connectNamed(source, "run_state", next, "run_state");
  else if (source.type === "EagleH3ShotContextNode") connectNamed(source, "run_state", next, "run_state");
  else if (source.type === "EagleH3CheckpointReviewNode") {
    connectNamed(source, "run_state", next, "run_state");
    const starts = (graph._nodes || []).filter(node => node.type === "EagleH3NativeLoopStartNode");
    if (starts.length === 1) connectNamed(starts[0], "flow", next, "flow");
  }
  graph.setDirtyCanvas(true, true);
  return next;
}

function createCoreChain(planNode) {
  const graph = planNode && planNode.graph;
  if (!graph) return;
  const x = planNode.pos[0] + planNode.size[0] + 70;
  const y = planNode.pos[1];
  const start = createH3Node(graph, "EagleH3NativeLoopStartNode", [x, y]);
  const shot = createH3Node(graph, "EagleH3ShotContextNode", [x + 350, y]);
  const review = createH3Node(graph, "EagleH3CheckpointReviewNode", [x + 760, y]);
  const end = createH3Node(graph, "EagleH3NativeLoopEndNode", [x + 1160, y]);
  if (!(start && shot && review && end)) return;
  connectNamed(planNode, "run_state", start, "run_state");
  connectNamed(start, "run_state", shot, "run_state");
  connectNamed(shot, "run_state", review, "run_state");
  connectNamed(start, "flow", end, "flow");
  connectNamed(review, "run_state", end, "run_state");
  graph.setDirtyCanvas(true, true);
}

function installCoreQuickAdd(nodeType, nodeData) {
  const next = H3_CORE_NEXT[nodeData.name];
  if (!next && nodeData.name !== "EagleH3PlanNode") return;
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
    if (nodeData.name === "EagleH3PlanNode") {
      options.push({
        content: "🦅 创建 H3 核心主链",
        callback: () => createCoreChain(this),
      });
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 注册扩展
// ═══════════════════════════════════════════════════════════════════════════
app.registerExtension({
  name: "EagleH3Pipeline",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    const name = nodeData.name;
    installCoreQuickAdd(nodeType, nodeData);

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
          this._h3cVueApp._instance.data.info.value = data.h3_plan;
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
          this._h3cVueApp._instance.data.info.value = data.h3_start;
        }
      };
    }

    // ── Native End（ComfyUI 同次执行内递归，不由浏览器重新 Queue）──
    if (name === "EagleH3NativeLoopEndNode") {
      const _created = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const r = _created ? _created.apply(this, arguments) : undefined;
        const vueApp = mountVueWidget(this, createEndPanel, "native_end");
        this._h3cVueApp = vueApp;
        return r;
      };
      const _exec = nodeType.prototype.onExecuted;
      nodeType.prototype.onExecuted = function (data) {
        if (_exec) _exec.apply(this, arguments);
        if (this._h3cVueApp && data && data.h3_native_loop) {
          this._h3cVueApp._instance.data.loop.value = data.h3_native_loop;
        }
      };
    }

    // ── Review Gate ──
    if (name === "EagleH3CheckpointReviewNode") {
      const _created = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const r = _created ? _created.apply(this, arguments) : undefined;
        const vueApp = mountVueWidget(this, () => createReviewPanel(this), "review");
        this._h3cVueApp = vueApp;
        // 隐藏原始 review_decision 文本框
        const w = getWidget(this, "review_decision");
        if (w) {
          w.type = "hidden";
          w.computeSize = () => [0, -4];
        }
        return r;
      };
      const _exec = nodeType.prototype.onExecuted;
      nodeType.prototype.onExecuted = function (data) {
        if (_exec) _exec.apply(this, arguments);
        if (this._h3cVueApp && data && data.h3_review) {
          this._h3cVueApp._instance.data.review.value = data.h3_review;
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
          this._h3cVueApp._instance.data.data.value = data;
        }
      };
    }
  },
});
