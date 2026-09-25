/**
 * Eagle video frame extractor — visual Vue frame selector.
 *
 * The VIDEO input is a runtime object, so the browser cannot inspect it before
 * execution. The backend returns temp thumbnail descriptors in `ui`; this view
 * lets the user select frame numbers and serializes them into selected_frames.
 */
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { createApp, ref, computed, onBeforeUnmount } from "../lib/vue.esm-browser.js";
import "./eagle_vue_theme.js";

const STYLE_ID = "eagle-video-frame-selector-style";
const HIDDEN_WIDGETS = new Set([
  "video_file", "time_mode", "frame_index", "sample_count", "resize_width", "resize_height",
  "preview_strip", "custom_times", "preview_count", "selection_mode",
  "selected_frames", "preview_revision", "size_mode", "trim_start", "trim_end",
  "extract_audio", "lock_aspect_ratio", "resize_anchor", "timeline_zoom", "output_mode",
]);

const CSS = `
.evfe-root{box-sizing:border-box;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;
  gap:9px;padding:11px;background:var(--eagle-vue-bg,#101116);color:var(--eagle-vue-text,#e4e7ee);
  font:12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
.evfe-head,.evfe-row,.evfe-actions{display:flex;align-items:center;gap:8px}.evfe-head{justify-content:space-between}
.evfe-title{font-weight:750;font-size:14px}.evfe-status{color:var(--eagle-vue-muted,#9299aa);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.evfe-source{display:grid;grid-template-columns:minmax(220px,1fr) auto auto;gap:8px;align-items:center;padding:8px 9px;
  border:1px solid var(--eagle-vue-border,#303441);border-radius:8px;background:var(--eagle-vue-panel,#15171d)}
.evfe-source select{min-width:0;height:30px;padding:4px 7px;border:1px solid var(--eagle-vue-border,#303441);border-radius:5px;
  background:var(--eagle-vue-input,#0c0e13);color:var(--eagle-vue-text,#e4e7ee)}
.evfe-source-note{color:var(--eagle-vue-muted,#9299aa);font-size:10px;white-space:nowrap}
.evfe-controls{display:grid;grid-template-columns:1.2fr .8fr .8fr .8fr;gap:8px;padding:9px;border:1px solid var(--eagle-vue-border,#303441);
  border-radius:8px;background:var(--eagle-vue-panel,#15171d)}
.evfe-field{display:flex;flex-direction:column;gap:4px;min-width:0}.evfe-field label{font-size:10px;color:var(--eagle-vue-muted,#9299aa)}
.evfe-field input,.evfe-field select{box-sizing:border-box;width:100%;height:30px;padding:4px 7px;border:1px solid var(--eagle-vue-border,#303441);
  border-radius:5px;background:var(--eagle-vue-input,#0c0e13);color:var(--eagle-vue-text,#e4e7ee)}
.evfe-mode-options{display:flex;align-items:end;gap:6px}.evfe-btn{height:30px;padding:0 10px;border:1px solid var(--eagle-vue-border,#303441);
  border-radius:5px;background:var(--eagle-vue-surface-alt,#20232d);color:var(--eagle-vue-text,#e4e7ee);cursor:pointer}
.evfe-btn:hover{border-color:var(--eagle-vue-primary,#2f82db)}.evfe-btn.primary{background:var(--eagle-vue-primary-deep,#294f8f);border-color:var(--eagle-vue-primary,#2f82db)}
.evfe-btn.active{background:var(--eagle-vue-selected,#243451);border-color:var(--eagle-vue-primary,#2f82db);color:#fff}
.evfe-workspace{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}.evfe-upper{min-height:0;overflow:auto;display:flex;flex-direction:column;gap:8px}
.evfe-results{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:7px}
.evfe-player-shell{display:flex;min-width:0;min-height:180px;overflow:hidden}
.evfe-splitter-v{flex:0 0 8px;width:8px;cursor:col-resize;touch-action:none;user-select:none;border-left:1px solid #30394b;border-right:1px solid #30394b;background:#111722}
.evfe-splitter-h{flex:0 0 8px;height:8px;cursor:row-resize;touch-action:none;user-select:none;border-top:1px solid #30394b;border-bottom:1px solid #30394b;background:#111722}
.evfe-splitter-v:hover,.evfe-splitter-h:hover,.evfe-splitter-v:focus-visible,.evfe-splitter-h:focus-visible{background:var(--eagle-vue-primary,#2f82db);outline:none}
.evfe-player{position:relative;min-width:0;min-height:180px;display:grid;place-items:center;overflow:hidden;border:1px solid var(--eagle-vue-border,#303441);
  border-radius:8px;background:#07090d}.evfe-player video{width:100%;height:100%;max-height:280px;object-fit:contain;background:#050609}
.evfe-player-empty{color:var(--eagle-vue-muted,#9299aa);text-align:center;padding:18px}.evfe-trim{flex:1;min-width:220px;display:flex;flex-direction:column;gap:8px;padding:10px;
  border:1px solid var(--eagle-vue-border,#303441);border-radius:8px;background:var(--eagle-vue-panel,#15171d)}
.evfe-trim-line{display:grid;grid-template-columns:38px 1fr 72px;gap:7px;align-items:center}.evfe-trim-line input[type=range]{width:100%}
.evfe-trim-line input[type=number]{width:72px}.evfe-time{color:#80bff1;font:11px/1.3 ui-monospace,monospace}
.evfe-trim-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:auto}.evfe-trim-note{font-size:10px;color:var(--eagle-vue-muted,#9299aa)}
.evfe-timeline{border:1px solid var(--eagle-vue-border,#303441);border-radius:8px;background:#0c111b;overflow:hidden;flex-shrink:0}
.evfe-timeline-head{height:36px;display:flex;align-items:center;gap:12px;padding:0 10px;border-bottom:1px solid #273043;background:#111827}
.evfe-timeline-head b{font-size:13px}.evfe-timeline-head .spacer{flex:1}.evfe-zoom{display:flex;align-items:center;gap:7px;color:#aab4c7}.evfe-zoom input{width:120px}
.evfe-timeline-scroll{overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}.evfe-timeline-content{position:relative;min-width:100%}
.evfe-ruler-row,.evfe-track-row{display:grid;grid-template-columns:70px minmax(0,1fr)}.evfe-ruler-row{height:29px}.evfe-track-row{height:67px;border-top:1px solid #252d3b}
.evfe-track-label{position:sticky;left:0;z-index:12;display:flex;align-items:center;justify-content:center;gap:6px;padding:5px;border-right:1px solid #2b3444;background:#111827;color:#cbd5e1;font-weight:700}
.evfe-track-label.video{color:#dce8ff}.evfe-track-label.audio{color:#f8dd55}.evfe-ruler-lane,.evfe-track-lane{position:relative;min-width:0;overflow:hidden}
.evfe-ruler-lane{background:#101725}.evfe-ruler-tick{position:absolute;bottom:0;height:10px;border-left:1px solid #69758a;color:#cbd5e1;font:10px/1 ui-monospace,monospace}
.evfe-ruler-tick span{position:absolute;left:4px;bottom:14px;white-space:nowrap}.evfe-track-thumbs{position:absolute;inset:5px 0;display:flex;border:1px solid #6366f1;border-radius:6px;overflow:hidden;background:#171b25}
.evfe-track-thumb{flex:1;min-width:0;border-right:1px solid rgba(255,255,255,.18);overflow:hidden}.evfe-track-thumb:last-child{border-right:0}.evfe-track-thumb img{width:100%;height:100%;display:block;object-fit:cover}
.evfe-wave{position:absolute;inset:8px 0;border:1px solid #16875f;border-radius:7px;overflow:hidden;background:linear-gradient(180deg,#075a3d,#06452f)}.evfe-wave img{width:100%;height:100%;display:block;object-fit:fill;opacity:.95}.evfe-wave-empty{height:100%;display:grid;place-items:center;color:#7ca68f;font-size:10px}
.evfe-tl-shade{position:absolute;top:0;bottom:0;background:rgba(3,7,13,.68);z-index:3;pointer-events:none}.evfe-tl-shade.left{left:0}.evfe-tl-shade.right{right:0}
.evfe-tl-selection{position:absolute;top:2px;bottom:2px;border:2px solid #36c6e8;background:rgba(54,198,232,.08);z-index:4;pointer-events:none}.evfe-tl-selection:before,.evfe-tl-selection:after{content:"";position:absolute;top:50%;width:7px;height:31px;transform:translateY(-50%);border-radius:3px;background:#36c6e8}.evfe-tl-selection:before{left:-5px}.evfe-tl-selection:after{right:-5px}
.evfe-tl-playhead{position:absolute;top:0;bottom:0;width:2px;background:#ffd11a;z-index:8;pointer-events:none;box-shadow:0 0 5px rgba(255,209,26,.45)}.evfe-tl-playhead:before{content:"";position:absolute;top:0;left:-5px;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #ffd11a}
.evfe-tl-range{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;pointer-events:none;z-index:6}.evfe-tl-range::-webkit-slider-thumb{width:20px;height:67px;pointer-events:auto;cursor:ew-resize}.evfe-tl-range.end{z-index:7}
.evfe-size-lock{display:flex;align-items:center;gap:6px}.evfe-lock-btn{width:34px;padding:0;font-size:16px}.evfe-lock-btn.active{color:#7dd3fc;border-color:#38bdf8;background:#17344a}
.evfe-summary{min-height:18px;color:#8fc5f2;font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace}
.evfe-grid{min-height:120px;flex:1;overflow:auto;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-content:start;gap:7px;
  padding:8px;border:1px solid var(--eagle-vue-border,#303441);border-radius:8px;background:#0b0d12;scrollbar-width:thin}
.evfe-empty{grid-column:1/-1;min-height:210px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;
  color:var(--eagle-vue-muted,#9299aa);text-align:center}
.evfe-card{position:relative;min-width:0;aspect-ratio:16/9;overflow:hidden;border:2px solid transparent;border-radius:6px;background:#151922;cursor:pointer}
.evfe-card:hover{border-color:#526074}.evfe-card.selected{border-color:var(--eagle-vue-primary,#2f82db);box-shadow:0 0 0 1px rgba(47,130,219,.35)}
.evfe-card img{width:100%;height:100%;display:block;object-fit:cover}.evfe-badge{position:absolute;left:4px;bottom:4px;padding:2px 5px;border-radius:4px;
  background:rgba(6,8,12,.82);color:#e7edf7;font:10px/1.25 ui-monospace,monospace}.evfe-check{position:absolute;right:5px;top:5px;width:20px;height:20px;
  display:grid;place-items:center;border-radius:50%;background:var(--eagle-vue-primary,#2f82db);color:white;font-weight:800}
.evfe-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--eagle-vue-muted,#9299aa)}
.evfe-selected{color:#7cc4ff;font-weight:700}.evfe-hint{font-size:10px;text-align:right}
@media(max-width:700px){.evfe-player-shell{flex-direction:column}.evfe-splitter-v{display:none}.evfe-player,.evfe-trim{flex:1 1 auto!important;width:auto!important}.evfe-controls{grid-template-columns:1fr 1fr}.evfe-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
`;

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function getWidget(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function widgetValue(node, name, fallback) {
  const value = getWidget(node, name)?.value;
  return value === undefined || value === null ? fallback : value;
}

function setWidgetValue(node, name, value, mark = true) {
  const widget = getWidget(node, name);
  if (!widget) return;
  widget.value = value;
  widget.callback?.(value);
  if (mark) node.graph?.change?.();
  node.setDirtyCanvas?.(true, true);
}

function parseSelected(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "[]") : value;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((item) => Number(item?.frame ?? item)).filter(Number.isFinite).map(Math.trunc))];
  } catch (_) {
    return [];
  }
}

function firstText(value, fallback = "") {
  if (Array.isArray(value)) return value.length ? String(value[0] ?? fallback) : fallback;
  return value === undefined || value === null ? fallback : String(value);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function firstObject(value) {
  if (Array.isArray(value)) value = value[0];
  return value && typeof value === "object" ? value : {};
}

function normalizeFrameItems(value) {
  let items = Array.isArray(value) ? value : [];
  if (items.length === 1 && Array.isArray(items[0])) items = items[0];
  return items.filter((item) => item && typeof item === "object" && item.filename);
}

function frameUrl(item) {
  const query = new URLSearchParams({
    filename: String(item.filename || ""),
    subfolder: String(item.subfolder || ""),
    type: String(item.type || "temp"),
  });
  return api.apiURL(`/view?${query.toString()}`);
}

function inputVideoUrl(filename) {
  if (!filename) return "";
  const query = new URLSearchParams({ filename: String(filename), type: "input" });
  return api.apiURL(`/view?${query.toString()}`);
}

function comboValues(node, name) {
  const values = getWidget(node, name)?.options?.values;
  return Array.isArray(values) ? values.map(String) : [];
}

const FrameSelector = {
  props: { node: { type: Object, required: true } },
  setup(props) {
    const node = props.node;
    const videoFile = ref(String(widgetValue(node, "video_file", "")));
    const videoFileOptions = ref(comboValues(node, "video_file"));
    const uploadInput = ref(null);
    const mode = ref(String(widgetValue(node, "time_mode", "预览选择")));
    const frameIndex = ref(finiteNumber(widgetValue(node, "frame_index", 0), 0));
    const sampleCount = ref(finiteNumber(widgetValue(node, "sample_count", 4), 4));
    const resizeWidth = ref(finiteNumber(widgetValue(node, "resize_width", 0), 0));
    const resizeHeight = ref(finiteNumber(widgetValue(node, "resize_height", 0), 0));
    const previewEnabled = ref(Boolean(widgetValue(node, "preview_strip", true)));
    const previewCount = ref(finiteNumber(widgetValue(node, "preview_count", 12), 12));
    const customTimes = ref(String(widgetValue(node, "custom_times", "0, 5, 10, 15")));
    const selectionMode = ref(String(widgetValue(node, "selection_mode", "single")));
    const sizeMode = ref(String(widgetValue(node, "size_mode", "original")));
    const trimStart = ref(finiteNumber(widgetValue(node, "trim_start", 0), 0));
    const trimEnd = ref(finiteNumber(widgetValue(node, "trim_end", 0), 0));
    const extractAudio = ref(Boolean(widgetValue(node, "extract_audio", false)));
    const lockAspectRatio = ref(Boolean(widgetValue(node, "lock_aspect_ratio", true)));
    const resizeAnchor = ref(String(widgetValue(node, "resize_anchor", "width")));
    const timelineZoom = ref(Math.max(100, finiteNumber(widgetValue(node, "timeline_zoom", 100), 100)));
    const outputMode = ref(String(widgetValue(node, "output_mode", "frames")));
    const selected = ref(parseSelected(widgetValue(node, "selected_frames", "[]")));
    const runtime = node._evfeRuntime || {};
    const frames = ref(Array.isArray(runtime.frames) ? runtime.frames : []);
    const timelineFrames = ref(Array.isArray(runtime.timelineFrames) ? runtime.timelineFrames : []);
    const waveformUrl = ref(String(runtime.waveformUrl || ""));
    const summary = ref(String(runtime.summary || ""));
    const status = ref(String(runtime.status || "连接视频后执行一次，即可生成可选帧预览"));
    const videoUrl = ref(String(runtime.videoUrl || inputVideoUrl(videoFile.value)));
    const videoMeta = ref(runtime.videoMeta && typeof runtime.videoMeta === "object" ? runtime.videoMeta : {});
    const player = ref(null);
    const currentTime = ref(0);
    const running = ref(false);
    const playerRatio = ref(0.56);
    const upperRatio = ref(0.58);
    let activeSplitCleanup = null;

    function restoreSplitLayout() {
      const savedSplit = node.properties?.eagle_video_frame_split_layout || {};
      playerRatio.value = Math.max(0.30, Math.min(0.72, finiteNumber(savedSplit.player_ratio, 0.56)));
      upperRatio.value = Math.max(0.30, Math.min(0.76, finiteNumber(savedSplit.upper_ratio, 0.58)));
    }
    restoreSplitLayout();

    function persistSplitLayout(commit = false) {
      node.properties ||= {};
      node.properties.eagle_video_frame_split_layout = {
        version: 1,
        player_ratio: Number(playerRatio.value.toFixed(5)),
        upper_ratio: Number(upperRatio.value.toFixed(5)),
      };
      node.setDirtyCanvas?.(true, true);
      if (commit) node.graph?.change?.();
    }

    function stopSplitDrag() {
      activeSplitCleanup?.();
    }

    function beginSplit(event, axis, ratioRef, minRatio, maxRatio) {
      if (event.pointerType !== "touch" && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      stopSplitDrag();
      const target = event.currentTarget;
      const layout = target?.parentElement;
      const rect = layout?.getBoundingClientRect?.();
      const total = axis === "x" ? rect?.width : rect?.height;
      if (!target || !rect || !Number.isFinite(total) || total < 1) return;
      const pointerId = event.pointerId;
      const start = axis === "x" ? event.clientX : event.clientY;
      const startPixels = ratioRef.value * total;
      const oldCursor = document.body.style.cursor;
      const oldUserSelect = document.body.style.userSelect;
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      target.setPointerCapture?.(pointerId);

      const move = moveEvent => {
        if (moveEvent.pointerId !== pointerId) return;
        moveEvent.preventDefault();
        const liveRect = layout.getBoundingClientRect();
        const liveTotal = Math.max(1, axis === "x" ? liveRect.width : liveRect.height);
        const delta = (axis === "x" ? moveEvent.clientX : moveEvent.clientY) - start;
        ratioRef.value = Math.max(minRatio, Math.min(maxRatio, (startPixels + delta) / liveTotal));
        persistSplitLayout(false);
      };
      const finish = finishEvent => {
        if (finishEvent?.pointerId != null && finishEvent.pointerId !== pointerId) return;
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", finish);
        target.removeEventListener("pointercancel", finish);
        target.removeEventListener("lostpointercapture", finish);
        if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
        document.body.style.cursor = oldCursor;
        document.body.style.userSelect = oldUserSelect;
        if (activeSplitCleanup === finish) activeSplitCleanup = null;
        persistSplitLayout(true);
      };
      activeSplitCleanup = finish;
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", finish);
      target.addEventListener("pointercancel", finish);
      target.addEventListener("lostpointercapture", finish);
    }

    const beginPlayerResize = event => beginSplit(event, "x", playerRatio, 0.30, 0.72);
    const beginWorkspaceResize = event => beginSplit(event, "y", upperRatio, 0.30, 0.76);
    function nudgePlayerResize(event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      playerRatio.value = Math.max(0.30, Math.min(0.72, playerRatio.value + (event.key === "ArrowRight" ? 0.02 : -0.02)));
      persistSplitLayout(true);
    }
    function nudgeWorkspaceResize(event) {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      upperRatio.value = Math.max(0.30, Math.min(0.76, upperRatio.value + (event.key === "ArrowDown" ? 0.02 : -0.02)));
      persistSplitLayout(true);
    }
    node._evfeStopSplitDrag = stopSplitDrag;
    node._evfeRestoreSplitLayout = restoreSplitLayout;

    const duration = computed(() => Math.max(0, finiteNumber(videoMeta.value.duration, 0)));
    const fps = computed(() => Math.max(0, finiteNumber(videoMeta.value.fps, 0)));
    const effectiveTrimEnd = computed(() => trimEnd.value > 0 ? Math.min(trimEnd.value, duration.value || trimEnd.value) : duration.value);
    const trimLabel = computed(() => `${trimStart.value.toFixed(2)}s – ${effectiveTrimEnd.value.toFixed(2)}s`);
    const trimStartPct = computed(() => duration.value > 0 ? Math.max(0, Math.min(100, trimStart.value / duration.value * 100)) : 0);
    const trimEndPct = computed(() => duration.value > 0 ? Math.max(0, Math.min(100, effectiveTrimEnd.value / duration.value * 100)) : 100);
    const playheadPct = computed(() => duration.value > 0 ? Math.max(0, Math.min(100, currentTime.value / duration.value * 100)) : 0);
    const selectedDuration = computed(() => Math.max(0, effectiveTrimEnd.value - trimStart.value));
    const timelineStyle = computed(() => ({ width: `${Math.max(100, timelineZoom.value)}%` }));
    const rulerMarks = computed(() => {
      const marks = [];
      for (let index = 0; index <= 8; index += 1) {
        const seconds = duration.value * index / 8;
        marks.push({ pct: index / 8 * 100, label: formatTimelineTime(seconds) });
      }
      return marks;
    });
    const outputSizeLabel = computed(() => {
      if (sizeMode.value === "original") return `${videoMeta.value.width || "?"} × ${videoMeta.value.height || "?"}`;
      const width = finiteNumber(resizeWidth.value, 0) || finiteNumber(videoMeta.value.output_width, 0) || "?";
      const height = finiteNumber(resizeHeight.value, 0) || finiteNumber(videoMeta.value.output_height, 0) || "?";
      return `${width} × ${height}`;
    });

    const modeHint = computed(() => {
      if (mode.value === "预览选择") return selected.value.length ? `将输出 ${selected.value.length} 个已选帧` : "尚未选择时输出首帧";
      if (mode.value === "单帧提取") return `输出第 ${Math.max(0, frameIndex.value)} 帧`;
      if (mode.value === "均匀采样") return `均匀输出 ${Math.max(1, sampleCount.value)} 帧`;
      return "按秒读取英文逗号分隔的时间点";
    });

    function persist(name, value) {
      setWidgetValue(node, name, value);
    }

    function formatTimelineTime(seconds) {
      const value = Math.max(0, finiteNumber(seconds, 0));
      const minutes = Math.floor(value / 60);
      const rest = value - minutes * 60;
      return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
    }

    function persistMode() {
      persist("time_mode", mode.value);
    }

    function selectVideoFile() {
      persist("video_file", videoFile.value);
      videoUrl.value = inputVideoUrl(videoFile.value);
      videoMeta.value = {};
      frames.value = [];
      timelineFrames.value = [];
      waveformUrl.value = "";
      trimStart.value = 0;
      trimEnd.value = 0;
      currentTime.value = 0;
      selected.value = [];
      persist("trim_start", 0);
      persist("trim_end", 0);
      persistSelection();
      status.value = videoFile.value
        ? "已载入输入目录视频；点击生成预览（若连接 VIDEO 端口，外接视频优先）"
        : "请选择视频或连接 VIDEO 端口";
      saveRuntime();
    }

    async function uploadVideo(event) {
      const file = event?.target?.files?.[0];
      if (!file) return;
      const form = new FormData();
      form.append("image", file, file.name);
      form.append("type", "input");
      running.value = true;
      status.value = `正在上传 ${file.name}…`;
      try {
        const response = await api.fetchApi("/upload/image", { method: "POST", body: form });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const uploaded = await response.json();
        const stored = [uploaded.subfolder, uploaded.name].filter(Boolean).join("/");
        if (!stored) throw new Error("服务器未返回文件名");
        if (!videoFileOptions.value.includes(stored)) {
          videoFileOptions.value = [...videoFileOptions.value, stored].sort((a, b) => a.localeCompare(b));
          const widget = getWidget(node, "video_file");
          if (widget?.options) widget.options.values = videoFileOptions.value;
        }
        videoFile.value = stored;
        selectVideoFile();
        await refreshPreview();
      } catch (error) {
        running.value = false;
        status.value = `视频上传失败：${error?.message || error}`;
      } finally {
        if (event?.target) event.target.value = "";
      }
    }

    function saveRuntime() {
      node._evfeRuntime = {
        frames: frames.value, timelineFrames: timelineFrames.value, waveformUrl: waveformUrl.value,
        summary: summary.value, status: status.value, videoUrl: videoUrl.value, videoMeta: videoMeta.value,
      };
    }

    function persistSelection() {
      persist("selected_frames", JSON.stringify(selected.value));
      saveRuntime();
    }

    function chooseFrame(item) {
      const frame = Math.trunc(Number(item.frame));
      if (!Number.isFinite(frame)) return;
      if (mode.value !== "预览选择") {
        mode.value = "预览选择";
        persistMode();
      }
      if (selectionMode.value === "single") {
        selected.value = [frame];
      } else if (selected.value.includes(frame)) {
        selected.value = selected.value.filter((value) => value !== frame);
      } else {
        selected.value = [...selected.value, frame];
      }
      persistSelection();
      status.value = selected.value.length ? `已选择 ${selected.value.length} 帧，执行节点后从原视频精确提取` : "已清除选择";
      if (player.value && Number.isFinite(Number(item.time))) {
        player.value.currentTime = Number(item.time);
        currentTime.value = Number(item.time);
      }
    }

    function setSelectionMode(value) {
      selectionMode.value = value;
      if (value === "single" && selected.value.length > 1) selected.value = selected.value.slice(0, 1);
      persist("selection_mode", value);
      persistSelection();
    }

    function clearSelection() {
      selected.value = [];
      persistSelection();
      status.value = "已清除帧选择";
    }

    function clampTrim(changed) {
      const max = duration.value || Math.max(trimEnd.value, trimStart.value, 0);
      const step = fps.value > 0 ? 1 / fps.value : 0.01;
      const snap = (value) => fps.value > 0
        ? Math.round(finiteNumber(value, 0) * fps.value) / fps.value
        : Math.round(finiteNumber(value, 0) * 100) / 100;
      trimStart.value = snap(Math.max(0, Math.min(finiteNumber(trimStart.value, 0), max)));
      let end = finiteNumber(trimEnd.value, 0);
      if (end <= 0 && max > 0) end = max;
      end = snap(Math.max(0, Math.min(end, max)));
      if (max > 0 && end <= trimStart.value) {
        if (changed === "start") trimStart.value = Math.max(0, end - step);
        else end = Math.min(max, trimStart.value + step);
      }
      trimEnd.value = end;
      persist("trim_start", trimStart.value);
      persist("trim_end", trimEnd.value);
      if (fps.value > 0) {
        const first = Math.round(trimStart.value * fps.value);
        const last = Math.round(trimEnd.value * fps.value);
        const kept = selected.value.filter((frame) => frame >= first && frame <= last);
        if (kept.length !== selected.value.length) {
          selected.value = kept;
          persistSelection();
        }
      }
      if (changed === "start" && player.value) {
        player.value.currentTime = trimStart.value;
        currentTime.value = trimStart.value;
      }
      status.value = "区间已改变；点击刷新后预览帧将重新分布到该区间";
    }

    function onVideoLoaded(event) {
      const element = event?.target;
      const actualDuration = finiteNumber(element?.duration, 0);
      if (actualDuration > 0) {
        videoMeta.value = {
          ...videoMeta.value,
          duration: actualDuration,
          width: finiteNumber(element?.videoWidth, videoMeta.value.width),
          height: finiteNumber(element?.videoHeight, videoMeta.value.height),
        };
        if (trimEnd.value <= 0 || trimEnd.value > actualDuration) trimEnd.value = actualDuration;
        if (sizeMode.value === "custom" && lockAspectRatio.value && (resizeWidth.value || resizeHeight.value)) {
          syncResize(resizeAnchor.value, false);
        }
      }
      saveRuntime();
    }

    function onVideoTime() {
      currentTime.value = finiteNumber(player.value?.currentTime, 0);
      if (effectiveTrimEnd.value > 0 && currentTime.value >= effectiveTrimEnd.value && player.value) {
        player.value.pause();
      }
    }

    function setTrimFromCurrent(which) {
      const value = Math.max(0, Math.min(currentTime.value, duration.value || currentTime.value));
      if (which === "start") trimStart.value = value;
      else trimEnd.value = value;
      clampTrim(which);
    }

    function playSelection() {
      if (!player.value) return;
      player.value.currentTime = trimStart.value;
      currentTime.value = trimStart.value;
      player.value.play()?.catch?.(() => {});
    }

    function addCurrentFrame() {
      if (!fps.value) {
        status.value = "尚未取得 FPS，请先执行一次生成预览";
        return;
      }
      const frame = Math.max(0, Math.min(
        Math.round(currentTime.value * fps.value),
        Math.max(0, finiteNumber(videoMeta.value.total_frames, 1) - 1),
      ));
      chooseFrame({ frame, time: currentTime.value });
    }

    function seekTimeline(event) {
      if (!duration.value) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
      const value = fps.value > 0
        ? Math.round(duration.value * ratio * fps.value) / fps.value
        : duration.value * ratio;
      currentTime.value = value;
      if (player.value) player.value.currentTime = value;
    }

    function changeTimelineZoom() {
      timelineZoom.value = Math.max(100, Math.min(800, Math.round(finiteNumber(timelineZoom.value, 100) / 25) * 25));
      persist("timeline_zoom", timelineZoom.value);
    }

    function sourceRatio() {
      const width = finiteNumber(videoMeta.value.width, 0);
      const height = finiteNumber(videoMeta.value.height, 0);
      return width > 0 && height > 0 ? width / height : 0;
    }

    function alignedDimension(value) {
      return Math.max(8, Math.min(8192, Math.round(finiteNumber(value, 8) / 8) * 8));
    }

    function syncResize(anchor, mark = true) {
      resizeAnchor.value = anchor === "height" ? "height" : "width";
      if (lockAspectRatio.value) {
        const ratio = sourceRatio();
        if (ratio > 0) {
          if (resizeAnchor.value === "height" && resizeHeight.value > 0) {
            resizeWidth.value = alignedDimension(resizeHeight.value * ratio);
          } else if (resizeWidth.value > 0) {
            resizeHeight.value = alignedDimension(resizeWidth.value / ratio);
          }
        }
      }
      setWidgetValue(node, "resize_anchor", resizeAnchor.value, mark);
      setWidgetValue(node, "resize_width", Math.max(0, Math.trunc(finiteNumber(resizeWidth.value, 0))), mark);
      setWidgetValue(node, "resize_height", Math.max(0, Math.trunc(finiteNumber(resizeHeight.value, 0))), mark);
    }

    function setSizeMode() {
      persist("size_mode", sizeMode.value);
      if (sizeMode.value === "custom" && !resizeWidth.value && !resizeHeight.value) {
        resizeWidth.value = finiteNumber(videoMeta.value.width, 0);
        resizeHeight.value = finiteNumber(videoMeta.value.height, 0);
        syncResize("width");
      }
    }

    function toggleAspectLock() {
      lockAspectRatio.value = !lockAspectRatio.value;
      persist("lock_aspect_ratio", lockAspectRatio.value);
      if (lockAspectRatio.value) syncResize(resizeAnchor.value);
    }

    async function refreshPreview() {
      persist("size_mode", sizeMode.value);
      persist("extract_audio", extractAudio.value);
      persist("lock_aspect_ratio", lockAspectRatio.value);
      persist("resize_anchor", resizeAnchor.value);
      persist("timeline_zoom", timelineZoom.value);
      persist("output_mode", outputMode.value);
      if (sizeMode.value === "custom") syncResize(resizeAnchor.value);
      clampTrim();
      const revision = (Number(widgetValue(node, "preview_revision", 0)) || 0) + 1;
      setWidgetValue(node, "preview_revision", revision);
      running.value = true;
      status.value = "正在执行工作流并生成预览…";
      try {
        await app.queuePrompt(0);
      } catch (error) {
        running.value = false;
        status.value = `无法执行：${error?.message || error}`;
      }
    }

    function applyExecution(data = {}) {
      const items = normalizeFrameItems(data.frame_previews).map((item) => ({
        ...item,
        frame: Math.trunc(Number(item.frame) || 0),
        time: Number(item.time) || 0,
        url: frameUrl(item),
      }));
      if (items.length || data.frame_previews) frames.value = items;
      const timelineItems = normalizeFrameItems(data.timeline_previews).map((item) => ({
        ...item,
        frame: Math.trunc(Number(item.frame) || 0),
        time: Number(item.time) || 0,
        url: frameUrl(item),
      }));
      if (timelineItems.length || data.timeline_previews) timelineFrames.value = timelineItems;
      const waveform = firstObject(data.waveform_preview);
      if (waveform.filename) waveformUrl.value = frameUrl(waveform);
      else if (data.waveform_preview) waveformUrl.value = "";
      summary.value = firstText(data.video_summary, summary.value);
      status.value = firstText(data.status, items.length ? "预览已生成" : "执行完成");
      videoUrl.value = firstText(data.video_url, videoUrl.value);
      const receivedMeta = firstObject(data.video_meta);
      if (Object.keys(receivedMeta).length) {
        videoMeta.value = receivedMeta;
        if (trimEnd.value <= 0 || trimEnd.value > duration.value) trimEnd.value = duration.value;
      }
      running.value = false;
      saveRuntime();
      node.setDirtyCanvas?.(true, true);
    }

    function restoreFromWidgets() {
      videoFile.value = String(widgetValue(node, "video_file", videoFile.value));
      videoFileOptions.value = comboValues(node, "video_file");
      mode.value = String(widgetValue(node, "time_mode", mode.value));
      frameIndex.value = Number(widgetValue(node, "frame_index", frameIndex.value)) || 0;
      sampleCount.value = Number(widgetValue(node, "sample_count", sampleCount.value)) || 4;
      resizeWidth.value = finiteNumber(widgetValue(node, "resize_width", resizeWidth.value), 0);
      resizeHeight.value = finiteNumber(widgetValue(node, "resize_height", resizeHeight.value), 0);
      previewEnabled.value = Boolean(widgetValue(node, "preview_strip", previewEnabled.value));
      previewCount.value = finiteNumber(widgetValue(node, "preview_count", previewCount.value), 12);
      customTimes.value = String(widgetValue(node, "custom_times", customTimes.value));
      selectionMode.value = String(widgetValue(node, "selection_mode", selectionMode.value));
      sizeMode.value = String(widgetValue(node, "size_mode", sizeMode.value));
      trimStart.value = finiteNumber(widgetValue(node, "trim_start", trimStart.value), 0);
      trimEnd.value = finiteNumber(widgetValue(node, "trim_end", trimEnd.value), 0);
      extractAudio.value = Boolean(widgetValue(node, "extract_audio", extractAudio.value));
      lockAspectRatio.value = Boolean(widgetValue(node, "lock_aspect_ratio", lockAspectRatio.value));
      resizeAnchor.value = String(widgetValue(node, "resize_anchor", resizeAnchor.value));
      timelineZoom.value = Math.max(100, finiteNumber(widgetValue(node, "timeline_zoom", timelineZoom.value), 100));
      outputMode.value = String(widgetValue(node, "output_mode", outputMode.value));
      selected.value = parseSelected(widgetValue(node, "selected_frames", "[]"));
    }

    node._evfeApplyExecution = applyExecution;
    node._evfeRestoreState = restoreFromWidgets;
    onBeforeUnmount(() => {
      stopSplitDrag();
      if (node._evfeStopSplitDrag === stopSplitDrag) node._evfeStopSplitDrag = null;
      if (node._evfeRestoreSplitLayout === restoreSplitLayout) node._evfeRestoreSplitLayout = null;
      if (node._evfeApplyExecution === applyExecution) node._evfeApplyExecution = null;
      if (node._evfeRestoreState === restoreFromWidgets) node._evfeRestoreState = null;
    });

    return {
      videoFile, videoFileOptions, uploadInput, mode, frameIndex, sampleCount, resizeWidth, resizeHeight, previewEnabled,
      previewCount, customTimes, selectionMode, sizeMode, trimStart, trimEnd,
      extractAudio, lockAspectRatio, resizeAnchor, timelineZoom, outputMode, selected, frames,
      timelineFrames, waveformUrl, summary, status, videoUrl, videoMeta,
      player, currentTime, duration, fps, effectiveTrimEnd, trimLabel,
      trimStartPct, trimEndPct, playheadPct, selectedDuration, timelineStyle, rulerMarks, outputSizeLabel,
      running, modeHint, persist, persistMode, selectVideoFile, uploadVideo, chooseFrame, setSelectionMode,
      clearSelection, clampTrim, onVideoLoaded, onVideoTime, setTrimFromCurrent,
      playSelection, addCurrentFrame, seekTimeline, changeTimelineZoom,
      syncResize, setSizeMode, toggleAspectLock, formatTimelineTime, refreshPreview,
      playerRatio, upperRatio, beginPlayerResize, beginWorkspaceResize, nudgePlayerResize, nudgeWorkspaceResize,
    };
  },
  template: `
    <div class="evfe-root eagle-vue-default-blue">
      <div class="evfe-head">
        <div style="min-width:0"><div class="evfe-title">视频帧选择器</div><div class="evfe-status" :title="status">{{ status }}</div></div>
        <button class="evfe-btn primary" :disabled="running" @click="refreshPreview">{{ running ? '生成中…' : '生成 / 刷新预览' }}</button>
      </div>

      <div class="evfe-source">
        <select v-model="videoFile" @change="selectVideoFile">
          <option value="">选择 ComfyUI/input 视频…</option>
          <option v-if="videoFile && !videoFileOptions.includes(videoFile)" :value="videoFile">{{ videoFile }}</option>
          <option v-for="name in videoFileOptions.filter(Boolean)" :key="name" :value="name">{{ name }}</option>
        </select>
        <button class="evfe-btn primary" @click="uploadInput?.click()">选择 / 上传视频</button>
        <span class="evfe-source-note">外接 VIDEO 端口优先</span>
        <input ref="uploadInput" type="file" accept="video/*,.mkv,.m4v,.avi,.wmv,.gif" hidden @change="uploadVideo">
      </div>

      <div class="evfe-workspace">
      <div class="evfe-upper" :style="{flex:'0 0 '+(upperRatio*100).toFixed(3)+'%'}">
      <div class="evfe-player-shell">
        <div class="evfe-player" :style="{flex:'0 0 '+(playerRatio*100).toFixed(3)+'%'}">
          <video v-if="videoUrl" ref="player" :src="videoUrl" controls preload="metadata" @loadedmetadata="onVideoLoaded" @timeupdate="onVideoTime"></video>
          <div v-else class="evfe-player-empty"><b>视频播放器等待数据</b><br>连接 VIDEO 后先执行一次节点</div>
        </div>
        <div class="evfe-splitter-v" role="separator" tabindex="0" aria-orientation="vertical" title="拖拽调整播放器与精确参数比例" @pointerdown="beginPlayerResize" @keydown="nudgePlayerResize"></div>
        <div class="evfe-trim">
          <div class="evfe-row" style="justify-content:space-between"><b>选区精确值</b><span class="evfe-time">{{ trimLabel }}</span></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="evfe-field"><label>入点（秒）</label><input type="number" min="0" :max="effectiveTrimEnd" :step="fps ? 1/fps : .01" v-model.number="trimStart" @change="clampTrim('start')"></div>
            <div class="evfe-field"><label>出点（秒）</label><input type="number" :min="trimStart" :max="duration || trimEnd" :step="fps ? 1/fps : .01" v-model.number="trimEnd" @change="clampTrim('end')"></div>
          </div>
          <div class="evfe-trim-tools">
            <button class="evfe-btn" @click="playSelection">▶ 播放选区</button>
            <button class="evfe-btn" @click="setTrimFromCurrent('start')">[ 当前为入点</button>
            <button class="evfe-btn" @click="setTrimFromCurrent('end')">当前为出点 ]</button>
            <button class="evfe-btn primary" @click="addCurrentFrame">＋加入当前帧</button>
          </div>
          <div class="evfe-trim-note">播放头 {{ currentTime.toFixed(3) }}s<span v-if="fps"> · #{{ Math.round(currentTime*fps) }} · {{ fps.toFixed(3) }} FPS</span>。任意播放位置都能加入，不受缩略图数量限制。</div>
        </div>
      </div>

      <div class="evfe-timeline">
        <div class="evfe-timeline-head">
          <b>时间线</b><span>总时长 {{ formatTimelineTime(duration) }}</span>
          <span>播放头 {{ formatTimelineTime(currentTime) }}</span>
          <span class="evfe-selected">选区 {{ formatTimelineTime(selectedDuration) }}</span>
          <span class="spacer"></span>
          <label class="evfe-zoom">缩放 {{ timelineZoom }}% <input type="range" min="100" max="800" step="25" v-model.number="timelineZoom" @input="changeTimelineZoom"></label>
        </div>
        <div class="evfe-timeline-scroll">
          <div class="evfe-timeline-content" :style="timelineStyle">
            <div class="evfe-ruler-row">
              <div class="evfe-track-label"></div>
              <div class="evfe-ruler-lane" @click="seekTimeline">
                <i v-for="mark in rulerMarks" :key="mark.pct" class="evfe-ruler-tick" :style="{left:mark.pct+'%'}"><span>{{ mark.label }}</span></i>
                <div class="evfe-tl-playhead" :style="{left:playheadPct+'%'}"></div>
              </div>
            </div>
            <div class="evfe-track-row">
              <div class="evfe-track-label video">▣ V1</div>
              <div class="evfe-track-lane" @click="seekTimeline">
                <div class="evfe-track-thumbs">
                  <div v-if="!timelineFrames.length" class="evfe-wave-empty" style="width:100%">执行一次后生成整段视频轨缩略图</div>
                  <div v-for="item in timelineFrames" :key="item.frame" class="evfe-track-thumb"><img :src="item.url" alt=""></div>
                </div>
                <div class="evfe-tl-shade left" :style="{width:trimStartPct+'%'}"></div>
                <div class="evfe-tl-selection" :style="{left:trimStartPct+'%',width:Math.max(0,trimEndPct-trimStartPct)+'%'}"></div>
                <div class="evfe-tl-shade right" :style="{width:(100-trimEndPct)+'%'}"></div>
                <div class="evfe-tl-playhead" :style="{left:playheadPct+'%'}"></div>
                <input class="evfe-tl-range start" type="range" min="0" :max="duration || 0" :step="fps ? 1/fps : .01" v-model.number="trimStart" @click.stop @input.stop="clampTrim('start')">
                <input class="evfe-tl-range end" type="range" min="0" :max="duration || 0" :step="fps ? 1/fps : .01" v-model.number="trimEnd" @click.stop @input.stop="clampTrim('end')">
              </div>
            </div>
            <div class="evfe-track-row">
              <div class="evfe-track-label audio">♪ A1</div>
              <div class="evfe-track-lane" @click="seekTimeline">
                <div class="evfe-wave"><img v-if="waveformUrl" :src="waveformUrl" alt="音频波形"><div v-else class="evfe-wave-empty">无音轨，或尚未生成波形</div></div>
                <div class="evfe-tl-shade left" :style="{width:trimStartPct+'%'}"></div>
                <div class="evfe-tl-selection" :style="{left:trimStartPct+'%',width:Math.max(0,trimEndPct-trimStartPct)+'%'}"></div>
                <div class="evfe-tl-shade right" :style="{width:(100-trimEndPct)+'%'}"></div>
                <div class="evfe-tl-playhead" :style="{left:playheadPct+'%'}"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="evfe-controls">
        <div class="evfe-field"><label>提取方式</label><select v-model="mode" @change="persistMode">
          <option>预览选择</option><option>单帧提取</option><option>均匀采样</option><option>自定义时间点</option>
        </select></div>
        <div v-if="mode==='单帧提取'" class="evfe-field"><label>帧编号</label><input type="number" min="0" v-model.number="frameIndex" @change="persist('frame_index',frameIndex)"></div>
        <div v-else-if="mode==='均匀采样'" class="evfe-field"><label>输出帧数</label><input type="number" min="1" max="64" v-model.number="sampleCount" @change="persist('sample_count',sampleCount)"></div>
        <div v-else-if="mode==='自定义时间点'" class="evfe-field" style="grid-column:span 2"><label>时间点（秒，英文逗号分隔）</label><input v-model="customTimes" @change="persist('custom_times',customTimes)"></div>
        <div v-else class="evfe-field"><label>选择方式</label><div class="evfe-mode-options">
          <button class="evfe-btn" :class="{active:selectionMode==='single'}" @click="setSelectionMode('single')">单选</button>
          <button class="evfe-btn" :class="{active:selectionMode==='multiple'}" @click="setSelectionMode('multiple')">多选</button>
        </div></div>
        <div class="evfe-field"><label>区间预览密度：{{ previewCount }}</label><input type="range" min="4" max="120" step="1" v-model.number="previewCount" @change="persist('preview_count',previewCount)"></div>
        <div class="evfe-field"><label>预览开关</label><select v-model="previewEnabled" @change="persist('preview_strip',previewEnabled)"><option :value="true">启用</option><option :value="false">关闭</option></select></div>
        <div class="evfe-field"><label>帧输出尺寸</label><select v-model="sizeMode" @change="setSizeMode"><option value="original">跟随原视频</option><option value="custom">自定义尺寸</option></select></div>
        <div class="evfe-field"><label>结果输出</label><select v-model="outputMode" @change="persist('output_mode',outputMode)"><option value="frames">仅图像帧序列</option><option value="video">裁剪视频（仍保留帧端口）</option><option value="both">图像帧 + 裁剪视频</option></select></div>
        <div class="evfe-field"><label>音频区间输出</label><select v-model="extractAudio" @change="persist('extract_audio',extractAudio)"><option :value="false">关闭</option><option :value="true">启用</option></select></div>
        <div v-if="sizeMode==='custom'" class="evfe-field"><label>输出宽度</label><input type="number" min="0" max="8192" step="64" v-model.number="resizeWidth" @input="syncResize('width')"></div>
        <div v-if="sizeMode==='custom'" class="evfe-field"><label>输出高度</label><input type="number" min="0" max="8192" step="64" v-model.number="resizeHeight" @input="syncResize('height')"></div>
        <div v-if="sizeMode==='custom'" class="evfe-field"><label>宽高比例</label><div class="evfe-size-lock"><button class="evfe-btn evfe-lock-btn" :class="{active:lockAspectRatio}" @click="toggleAspectLock">{{ lockAspectRatio ? '🔒' : '🔓' }}</button><span class="evfe-time">{{ lockAspectRatio ? '锁定原视频比例' : '自由拉伸' }}</span></div></div>
        <div class="evfe-field"><label>实际输出</label><div class="evfe-time" style="padding-top:7px">{{ outputSizeLabel }}</div></div>
      </div>
      </div>

      <div class="evfe-splitter-h" role="separator" tabindex="0" aria-orientation="horizontal" title="拖拽调整编辑区与结果网格比例" @pointerdown="beginWorkspaceResize" @keydown="nudgeWorkspaceResize"></div>
      <div class="evfe-results">

      <div class="evfe-summary">{{ summary || modeHint }}</div>
      <div class="evfe-grid">
        <div v-if="!frames.length" class="evfe-empty">
          <b>暂无帧预览</b><span>连接 VIDEO 后点击“生成 / 刷新预览”，或正常执行一次工作流。</span>
        </div>
        <button v-for="item in frames" :key="item.frame" type="button" class="evfe-card" :class="{selected:selected.includes(item.frame)}" @click="chooseFrame(item)">
          <img :src="item.url" loading="lazy" alt="">
          <span class="evfe-badge">#{{ item.frame }} · {{ item.time.toFixed(2) }}s</span>
          <span v-if="selected.includes(item.frame)" class="evfe-check">✓</span>
        </button>
      </div>
      <div class="evfe-foot">
        <div><span class="evfe-selected">已选 {{ selected.length }} 帧</span> · {{ modeHint }}</div>
        <div class="evfe-actions"><button class="evfe-btn" @click="clearSelection">清除选择</button><span class="evfe-hint">选择会保存到工作流；再次执行后输出原始帧</span></div>
      </div>
      </div>
      </div>
    </div>
  `,
};

function hideNativeWidgets(node) {
  let found = false;
  const widgets = node.widgets || [];
  for (let index = 0; index < widgets.length; index++) {
    const widget = widgets[index];
    if (!HIDDEN_WIDGETS.has(widget.name)) continue;
    widget.type = "hidden";
    widget.options ||= {};
    Object.assign(widget.options, { hidden: true, vueNode: "never", hideInPanel: true });
    widget.computeSize = () => [0, -4];
    widget.hidden = true;
    widget.draw = () => {};
    widgets.splice(index, 1, widget);
    found = true;
  }
  if (found) node.setDirtyCanvas?.(true, true);
  return found;
}

app.registerExtension({
  name: "EagleSuite.VideoFrameExtractorVue",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleVideoFrameExtractor") return;

    const inputDefs = nodeData?.input || nodeData?.inputs;
    for (const groupName of ["required", "optional"]) {
      const group = inputDefs?.[groupName];
      for (const name of HIDDEN_WIDGETS) {
        const definition = group?.[name];
        if (!Array.isArray(definition)) continue;
        definition[1] = { ...(definition[1] || {}), hidden: true, vueNode: "never", hideInPanel: true };
      }
    }

    const previousCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = previousCreated?.apply(this, arguments);
      if (this._evfeVue) return result;
      installStyle();
      if (!this.size || Number(this.size[0]) < 480 || Number(this.size[1]) < 260) {
        this.setSize([960, 720]);
      }
      hideNativeWidgets(this);
      const hideNode = this;
      setTimeout(() => hideNativeWidgets(hideNode), 0);
      setTimeout(() => hideNativeWidgets(hideNode), 250);
      setTimeout(() => hideNativeWidgets(hideNode), 500);

      const element = document.createElement("div");
      element.style.cssText = "box-sizing:border-box;width:940px;height:100%;overflow:hidden;border-radius:0 0 8px 8px;";
      const FRAME_SELECTOR_MIN_VIEWPORT_HEIGHT = 320;
      const FRAME_SELECTOR_DEFAULT_VIEWPORT_HEIGHT = 600;
      let currentViewportHeight = FRAME_SELECTOR_DEFAULT_VIEWPORT_HEIGHT;
      const MAX_VIEWPORT_HEIGHT = 4096;
      const widget = this.addDOMWidget("video_frame_selector", "div", element, {
        serialize: false,
        hideInPanel: true,
        hideOnZoom: false,
        getMinHeight: () => FRAME_SELECTOR_MIN_VIEWPORT_HEIGHT,
        getMaxHeight: () => MAX_VIEWPORT_HEIGHT,
        getHeight: () => currentViewportHeight,
      });
      widget.width = undefined;
      widget._eagleViewportHeight = FRAME_SELECTOR_DEFAULT_VIEWPORT_HEIGHT;
      // Keep DOMWidgetImpl.computeLayoutSize inherited. An own computeSize
      // turns this editor into a fixed 320px slot and clips its live viewport.
      const applyFrame = (size) => {
        const width = Math.max(480, (Number(size?.[0]) || 960) - 20);
        currentViewportHeight = Math.min(MAX_VIEWPORT_HEIGHT, Math.max(FRAME_SELECTOR_MIN_VIEWPORT_HEIGHT, (Number(size?.[1]) || 720) - 120));
        widget._eagleViewportHeight = currentViewportHeight;
        element.style.width = `${width}px`;
        element.style.height = `${currentViewportHeight}px`;
        const host = element.parentElement;
        if (host) {
          host.style.width = `${width}px`;
          host.style.overflow = "hidden";
        }
      };
      applyFrame(this.size);
      this._evfeApplyFrame = applyFrame;
      this._evfeVue = createApp(FrameSelector, { node: this });
      this._evfeVue.mount(element);
      this._eagleRestoreUiState = () => this._evfeRestoreState?.();

      const previousResize = this.onResize;
      this.onResize = function (size) {
        previousResize?.apply(this, arguments);
        applyFrame(size);
        this.setDirtyCanvas?.(true, true);
      };
      return result;
    };

    const previousConfigured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = previousConfigured?.apply(this, arguments);
      hideNativeWidgets(this);
      this._evfeRestoreSplitLayout?.();
      setTimeout(() => {
        hideNativeWidgets(this);
        this._evfeApplyFrame?.(this.size);
        this._evfeRestoreState?.();
      }, 0);
      setTimeout(() => hideNativeWidgets(this), 250);
      return result;
    };

    const previousExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (data) {
      previousExecuted?.apply(this, arguments);
      this._evfeApplyExecution?.(data || {});
    };

    const previousRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._evfeStopSplitDrag?.();
      try { this._evfeVue?.unmount(); } catch (_) {}
      this._evfeVue = null;
      this._evfeRuntime = null;
      this._evfeApplyFrame = null;
      this._evfeApplyExecution = null;
      this._evfeRestoreState = null;
      this._eagleRestoreUiState = null;
      previousRemoved?.apply(this, arguments);
    };
  },
});
