import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { createApp, ref, computed, nextTick, onBeforeUnmount } from "../lib/vue.esm-browser.js";
import "./eagle_vue_theme.js";

const STYLE_ID = "eagle-media-timeline-editor-style";
const HIDDEN_WIDGETS = new Set([
  "timeline_json", "output_mode", "size_mode", "width", "height", "lock_aspect_ratio",
  "resize_anchor", "fit_mode", "output_fps", "include_video_audio", "audio_sample_rate",
  "video_crf", "frame_step", "max_frames", "render_revision",
]);

const CSS = `
.emte-root{box-sizing:border-box;width:100%;height:100%;min-height:620px;display:flex;flex-direction:column;gap:8px;padding:10px;
 background:var(--eagle-vue-bg,#101116);color:var(--eagle-vue-text,#e4e7ee);font:12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
.emte-root.fullscreen{position:fixed!important;inset:12px!important;z-index:100000;width:auto!important;height:auto!important;border:1px solid #48556d;border-radius:10px;box-shadow:0 20px 70px #000}
.emte-head,.emte-row,.emte-actions{display:flex;align-items:center;gap:7px}.emte-head{justify-content:space-between}.emte-title{font-weight:800;font-size:14px}
.emte-status{color:#91a1b9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:620px}.emte-btn{height:29px;padding:0 9px;border:1px solid #354055;border-radius:5px;background:#202634;color:#e5e9f2;cursor:pointer}
.emte-btn:hover{border-color:#3e98e8}.emte-btn.primary{background:#245a9b;border-color:#3d8ee1}.emte-btn.danger{color:#ffb4b4}.emte-btn:disabled{opacity:.45;cursor:not-allowed}
.emte-drop{display:flex;align-items:center;justify-content:center;gap:10px;min-height:42px;border:1px dashed #3c6c91;border-radius:7px;background:#111a26;color:#9ec8ea}
.emte-drop.hot{border-color:#42bff5;background:#14283b}.emte-main{display:grid;grid-template-columns:245px minmax(0,1fr);gap:8px;min-height:260px}
.emte-bin,.emte-panel,.emte-timeline,.emte-settings{border:1px solid #30394b;border-radius:7px;background:#151922;overflow:hidden}.emte-section-head{height:31px;display:flex;align-items:center;justify-content:space-between;padding:0 9px;border-bottom:1px solid #2c3545;font-weight:700}
.emte-assets{height:255px;padding:7px;overflow:auto;display:flex;flex-direction:column;gap:5px}.emte-asset{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:7px;align-items:center;padding:6px;border:1px solid #303a4d;border-radius:5px;background:#1b2130;cursor:grab}
.emte-asset.active{border-color:#3d91df}.emte-icon{width:28px;height:28px;display:grid;place-items:center;border-radius:4px;background:#29364b}.emte-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}.emte-meta{font-size:10px;color:#8f9bb0}
.emte-preview-head{height:34px;display:flex;align-items:center;gap:7px;padding:0 8px;border-bottom:1px solid #2c3545;background:#111827}.emte-preview-head .emte-name{flex:1}.emte-player{height:220px;position:relative;display:grid;place-items:center;background-color:#070a0f;background-image:linear-gradient(45deg,#0d121b 25%,transparent 25%),linear-gradient(-45deg,#0d121b 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#0d121b 75%),linear-gradient(-45deg,transparent 75%,#0d121b 75%);background-size:24px 24px;background-position:0 0,0 12px,12px -12px,-12px 0}.emte-player video{width:100%;height:100%;object-fit:contain;background:#000}.emte-player audio{width:90%}.emte-player-empty{color:#7e899b;text-align:center}.emte-inspector{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;padding:7px;border-top:1px solid #2c3545}.emte-field{display:flex;flex-direction:column;gap:3px;min-width:0}.emte-field label{font-size:10px;color:#8e99ab}.emte-field input,.emte-field select{box-sizing:border-box;width:100%;height:28px;padding:3px 6px;border:1px solid #354055;border-radius:4px;background:#0e121a;color:#e4e8f0}
.emte-timeline{flex:1;min-height:220px;display:flex;flex-direction:column}.emte-tl-head{height:35px;padding:0 8px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #2c3545;background:#111827}.emte-spacer{flex:1}.emte-scroll{overflow:auto;flex:1}.emte-canvas{position:relative;min-width:100%;min-height:180px}.emte-ruler,.emte-track{display:grid;grid-template-columns:64px minmax(0,1fr)}.emte-ruler{height:28px}.emte-track{height:50px;border-top:1px solid #293243}
.emte-label{position:sticky;left:0;z-index:12;display:grid;place-items:center;border-right:1px solid #30394b;background:#111827;font-weight:750}.emte-label.audio{color:#f4d45c}.emte-lane{position:relative;min-width:0;background:#0c111b}.emte-ruler-lane{position:relative;background:#111827}.emte-tick{position:absolute;bottom:0;height:8px;border-left:1px solid #68768d}.emte-tick span{position:absolute;bottom:11px;left:3px;font:9px monospace;color:#aab4c5;white-space:nowrap}
.emte-clip{position:absolute;top:5px;bottom:5px;min-width:18px;border:1px solid #438bcc;border-radius:5px;background:linear-gradient(180deg,#244b70,#193752);overflow:hidden;cursor:ew-resize}.emte-clip.audio{border-color:#169968;background:linear-gradient(180deg,#0b6548,#074732)}.emte-clip.selected{box-shadow:0 0 0 2px #62c4ff inset}.emte-frame-strip{position:absolute;inset:0;display:flex;opacity:.74}.emte-frame-strip img{min-width:0;width:1px;flex:1 1 0;object-fit:cover}.emte-clip-label{position:relative;z-index:2;display:block;height:100%;background:linear-gradient(90deg,rgba(4,10,18,.78),rgba(4,10,18,.08) 70%)}.emte-clip-title{display:block;padding:5px 6px 1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:700;text-shadow:0 1px 2px #000}.emte-clip-time{display:block;padding:0 6px;color:#d6e7f7;font-size:9px;text-shadow:0 1px 2px #000}.emte-drag-handle{position:absolute;right:3px;top:3px;z-index:4;padding:0 3px;border-radius:3px;background:#07101bcc;cursor:grab}.emte-playhead{position:absolute;top:0;bottom:0;width:2px;background:#ffd21f;z-index:9;pointer-events:none}.emte-playhead:before{content:"";position:absolute;top:0;left:-5px;border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid #ffd21f}
.emte-lane,.emte-ruler-lane{touch-action:none;cursor:ew-resize}.emte-settings{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px;padding:8px;flex-shrink:0}.emte-hint{color:#7f8ca1;font-size:10px}.emte-toggle{display:flex;align-items:center;gap:5px;padding-top:6px}.emte-file{display:none}
@media(max-width:850px){.emte-main{grid-template-columns:1fr}.emte-bin{display:none}.emte-settings{grid-template-columns:repeat(3,1fr)}.emte-inspector{grid-template-columns:repeat(3,1fr)}}
`;

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function getWidget(node, name) { return node.widgets?.find((item) => item.name === name); }
function widgetValue(node, name, fallback) {
  const value = getWidget(node, name)?.value;
  return value === undefined || value === null ? fallback : value;
}
function setWidget(node, name, value, mark = true) {
  const widget = getWidget(node, name);
  if (!widget) return;
  widget.value = value;
  widget.callback?.(value);
  if (mark) node.graph?.change?.();
  node.setDirtyCanvas?.(true, true);
}
function blankProject() {
  return { version: 1, assets: [], video_clips: [], audio_tracks: [
    { id: "A1", name: "A1", clips: [] }, { id: "A2", name: "A2", clips: [] },
  ] };
}
function parseProject(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value;
    if (!parsed || typeof parsed !== "object") return blankProject();
    parsed.assets = Array.isArray(parsed.assets) ? parsed.assets : [];
    parsed.video_clips = Array.isArray(parsed.video_clips) ? parsed.video_clips : [];
    parsed.audio_tracks = Array.isArray(parsed.audio_tracks) ? parsed.audio_tracks.slice(0, 2) : [];
    while (parsed.audio_tracks.length < 2) parsed.audio_tracks.push({ id: `A${parsed.audio_tracks.length + 1}`, name: `A${parsed.audio_tracks.length + 1}`, clips: [] });
    parsed.audio_tracks.forEach((track, index) => { track.id ||= `A${index + 1}`; track.name ||= track.id; track.clips = Array.isArray(track.clips) ? track.clips : []; });
    parsed.version = 1;
    return parsed;
  } catch (_) { return blankProject(); }
}
function id(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }
function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function mediaUrl(filename) {
  if (!filename) return "";
  const query = new URLSearchParams({ filename: String(filename), type: "input" });
  return api.apiURL(`/view?${query}`);
}
function previewFrameUrl(frame) {
  if (!frame?.filename) return "";
  const query = new URLSearchParams({
    filename: String(frame.filename),
    subfolder: String(frame.subfolder || ""),
    type: String(frame.type || "temp"),
  });
  return api.apiURL(`/view?${query}`);
}
function hideWidgets(node) {
  for (const widget of node.widgets || []) {
    if (!HIDDEN_WIDGETS.has(widget.name)) continue;
    widget.type = "hidden";
    widget.computeSize = () => [0, -4];
    widget.draw = () => {};
  }
}

const TimelineEditor = {
  props: { node: { type: Object, required: true } },
  setup(props) {
    const node = props.node;
    const project = ref(parseProject(widgetValue(node, "timeline_json", "")));
    const selected = ref(null);
    const draggedAsset = ref("");
    const draggedClip = ref(null);
    const fileInput = ref(null);
    const player = ref(null);
    const currentTime = ref(0);
    const frameStrips = ref({});
    const stripLoading = ref({});
    const seekDragging = ref(false);
    const seekTrack = ref("video");
    const pendingSourceTime = ref(null);
    const pendingPlay = ref(false);
    const advancingClip = ref(false);
    const renderedUrl = ref(String(node._emteRuntime?.videoUrl || ""));
    const status = ref(String(node._emteRuntime?.status || "拖入视频或音频开始剪辑"));
    const uploading = ref(false);
    const dropHot = ref(false);
    const fullscreen = ref(false);
    const zoom = ref(80);
    const outputMode = ref(String(widgetValue(node, "output_mode", "video_audio")));
    const sizeMode = ref(String(widgetValue(node, "size_mode", "follow_first")));
    const width = ref(finite(widgetValue(node, "width", 1280), 1280));
    const height = ref(finite(widgetValue(node, "height", 720), 720));
    const lockRatio = ref(Boolean(widgetValue(node, "lock_aspect_ratio", true)));
    const resizeAnchor = ref(String(widgetValue(node, "resize_anchor", "width")));
    const fitMode = ref(String(widgetValue(node, "fit_mode", "contain")));
    const outputFps = ref(finite(widgetValue(node, "output_fps", 0), 0));
    const includeVideoAudio = ref(Boolean(widgetValue(node, "include_video_audio", true)));
    const frameStep = ref(finite(widgetValue(node, "frame_step", 1), 1));
    const maxFrames = ref(finite(widgetValue(node, "max_frames", 0), 0));

    const assetsById = computed(() => Object.fromEntries(project.value.assets.map((asset) => [asset.id, asset])));
    const videoDuration = computed(() => project.value.video_clips.reduce((sum, clip) => sum + Math.max(0, finite(clip.out) - finite(clip.in)), 0));
    const timelineDuration = computed(() => {
      let result = videoDuration.value;
      for (const track of project.value.audio_tracks) for (const clip of track.clips) result = Math.max(result, finite(clip.start) + Math.max(0, finite(clip.out) - finite(clip.in)));
      return Math.max(.1, result);
    });
    const canvasWidth = computed(() => Math.max(900, timelineDuration.value * zoom.value));
    const playheadLeft = computed(() => `${Math.min(100, currentTime.value / timelineDuration.value * 100)}%`);
    const firstVideo = computed(() => assetsById.value[project.value.video_clips[0]?.asset_id] || project.value.assets.find((asset) => asset.type === "video") || {});
    const selectedClip = computed(() => {
      const key = selected.value;
      if (!key) return null;
      if (key.track === "video") return project.value.video_clips.find((clip) => clip.id === key.id) || null;
      return project.value.audio_tracks[key.track]?.clips.find((clip) => clip.id === key.id) || null;
    });
    const selectedAsset = computed(() => assetsById.value[selectedClip.value?.asset_id] || null);
    const previewAsset = computed(() => selectedAsset.value || firstVideo.value || project.value.assets[0] || null);
    const sourceUrl = computed(() => renderedUrl.value || mediaUrl(previewAsset.value?.filename));
    const previewFrames = computed(() => selectedClip.value ? clipFrames(selectedClip.value) : (frameStrips.value[previewAsset.value?.id] || []));
    const previewPoster = computed(() => renderedUrl.value ? "" : previewFrameUrl(previewFrames.value[0]));
    const previewLabel = computed(() => renderedUrl.value ? "渲染结果" : (selectedAsset.value?.name || previewAsset.value?.name || "暂无预览素材"));
    const ruler = computed(() => {
      const count = Math.max(5, Math.min(20, Math.ceil(timelineDuration.value / 2)));
      return Array.from({ length: count + 1 }, (_, index) => ({ pct: index / count * 100, time: timelineDuration.value * index / count }));
    });
    const videoLayout = computed(() => {
      let cursor = 0;
      return project.value.video_clips.map((clip) => {
        const duration = Math.max(.001, finite(clip.out) - finite(clip.in));
        const result = { clip, start: cursor, left: cursor / timelineDuration.value * 100, width: duration / timelineDuration.value * 100 };
        cursor += duration;
        return result;
      });
    });
    function audioLayout(index) {
      return project.value.audio_tracks[index].clips.map((clip) => ({
        clip, left: finite(clip.start) / timelineDuration.value * 100,
        width: Math.max(.001, finite(clip.out) - finite(clip.in)) / timelineDuration.value * 100,
      }));
    }
    function persist() {
      const value = JSON.stringify(project.value);
      setWidget(node, "timeline_json", value);
      node._emteRuntime = { status: status.value, videoUrl: renderedUrl.value };
    }
    function persistSetting(name, value) { setWidget(node, name, value); }
    function assetName(assetId) { return assetsById.value[assetId]?.name || "未知素材"; }
    function formatTime(value) {
      const seconds = Math.max(0, finite(value));
      const minutes = Math.floor(seconds / 60);
      return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, "0")}`;
    }
    function clipFrames(clip) {
      const frames = frameStrips.value[clip?.asset_id] || [];
      if (!clip) return frames;
      const filtered = frames.filter((frame) => finite(frame.time) >= finite(clip.in) - .001 && finite(frame.time) <= finite(clip.out) + .001);
      return filtered.length ? filtered : frames;
    }
    async function loadFrameStrip(asset, force = false) {
      if (!asset || asset.type !== "video" || !asset.filename) return;
      if (!force && (frameStrips.value[asset.id]?.length || stripLoading.value[asset.id])) return;
      stripLoading.value = { ...stripLoading.value, [asset.id]: true };
      try {
        const query = new URLSearchParams({ filename: String(asset.filename), count: "12", width: "192" });
        if (force) query.set("revision", String(Date.now()));
        const response = await api.fetchApi(`/eagle/media_timeline/preview_frames?${query}`);
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
        frameStrips.value = { ...frameStrips.value, [asset.id]: Array.isArray(data.frames) ? data.frames : [] };
      } catch (error) {
        status.value = `已载入视频，但预览帧提取失败：${error?.message || error}`;
      } finally {
        stripLoading.value = { ...stripLoading.value, [asset.id]: false };
      }
    }
    function loadAllFrameStrips(force = false) {
      for (const asset of project.value.assets) if (asset.type === "video") loadFrameStrip(asset, force);
    }
    function applyPendingPreview() {
      const media = player.value;
      if (!media) return;
      const target = pendingSourceTime.value;
      if (target !== null && Number.isFinite(media.duration)) {
        media.currentTime = Math.max(0, Math.min(Math.max(0, media.duration - .001), finite(target)));
        pendingSourceTime.value = null;
      }
      if (pendingPlay.value) {
        pendingPlay.value = false;
        const promise = media.play?.();
        promise?.catch?.(() => { status.value = "素材已就绪；浏览器阻止了自动播放，请点击播放按钮"; });
      }
    }
    function positionPlayer(sourceTime, shouldPlay = false) {
      pendingSourceTime.value = Math.max(0, finite(sourceTime));
      pendingPlay.value = Boolean(shouldPlay);
      nextTick(() => {
        const media = player.value;
        if (!media) return;
        if (media.readyState >= 1) applyPendingPreview();
        else media.load?.();
      });
    }
    function addVideo(asset, shouldPlay = true) {
      if (!asset || asset.type !== "video") return;
      project.value.video_clips.push({ id: id("vclip"), asset_id: asset.id, in: 0, out: Math.max(.01, finite(asset.duration)), volume: 1, mute: false, fade_in: 0, fade_out: 0, include_audio: true });
      const clip = project.value.video_clips.at(-1);
      selected.value = { track: "video", id: clip.id };
      renderedUrl.value = "";
      persist();
      loadFrameStrip(asset);
      currentTime.value = clipGlobalStart(clip.id);
      positionPlayer(clip.in, shouldPlay);
    }
    function addAudio(asset, trackIndex = 0) {
      if (!asset || asset.type !== "audio") return;
      const track = project.value.audio_tracks[trackIndex];
      const end = track.clips.reduce((max, clip) => Math.max(max, finite(clip.start) + finite(clip.out) - finite(clip.in)), 0);
      track.clips.push({ id: id("aclip"), asset_id: asset.id, in: 0, out: Math.max(.01, finite(asset.duration)), start: end, volume: 1, mute: false, fade_in: 0, fade_out: 0 });
      selected.value = { track: trackIndex, id: track.clips.at(-1).id };
      persist();
    }
    async function uploadFiles(files, preferredTrack = null) {
      const list = [...(files || [])];
      if (!list.length) return;
      uploading.value = true;
      const failures = [];
      let succeeded = 0;
      for (const file of list) {
        status.value = `正在上传 ${file.name}…`;
        try {
          const form = new FormData();
          form.append("file", file, file.name);
          const response = await api.fetchApi("/eagle/media_timeline/upload", { method: "POST", body: form });
          const data = await response.json();
          if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
          project.value.assets.push(data.asset);
          if (data.asset.type === "video") addVideo(data.asset);
          else addAudio(data.asset, typeof preferredTrack === "number" ? preferredTrack : 0);
          succeeded += 1;
        } catch (error) { failures.push(`${file.name}：${error?.message || error}`); }
      }
      uploading.value = false;
      status.value = failures.length
        ? `载入失败 ${failures.length} 项${succeeded ? `，成功 ${succeeded} 项` : ""}：${failures.join("；")}`
        : `已载入 ${succeeded} 项 · 素材箱 ${project.value.assets.length} 项 · 视频轨 ${project.value.video_clips.length} 段`;
      if (fileInput.value) fileInput.value.value = "";
      persist();
    }
    function openFilePicker() {
      if (!fileInput.value || uploading.value) return;
      fileInput.value.value = "";
      fileInput.value.click();
    }
    function onDropFiles(event) { dropHot.value = false; uploadFiles(event.dataTransfer?.files); }
    function startAssetDrag(asset) { draggedAsset.value = asset.id; }
    function dropOnTrack(track) {
      const asset = assetsById.value[draggedAsset.value];
      if (!asset) return;
      if (track === "video") addVideo(asset); else addAudio(asset, track);
      draggedAsset.value = "";
    }
    function dropTrack(event, track) {
      const files = event?.dataTransfer?.files;
      if (files?.length) uploadFiles(files, track);
      else dropOnTrack(track);
    }
    function selectClip(track, clip, shouldPlay = false, sourceTime = null) {
      selected.value = { track, id: clip.id };
      renderedUrl.value = "";
      currentTime.value = track === "video" ? clipGlobalStart(clip.id) : finite(clip.start);
      positionPlayer(sourceTime === null ? finite(clip.in) : sourceTime, shouldPlay);
    }
    function clipGlobalStart(clipId) {
      let cursor = 0;
      for (const clip of project.value.video_clips) {
        if (clip.id === clipId) return cursor;
        cursor += Math.max(0, finite(clip.out) - finite(clip.in));
      }
      return 0;
    }
    function videoClipAt(time) {
      let cursor = 0;
      for (let index = 0; index < project.value.video_clips.length; index += 1) {
        const clip = project.value.video_clips[index];
        const duration = Math.max(0, finite(clip.out) - finite(clip.in));
        if (time <= cursor + duration || index === project.value.video_clips.length - 1) {
          return { clip, index, start: cursor, sourceTime: finite(clip.in) + Math.max(0, Math.min(duration, time - cursor)) };
        }
        cursor += duration;
      }
      return null;
    }
    function audioClipAt(trackIndex, time) {
      const clips = project.value.audio_tracks[trackIndex]?.clips || [];
      const clip = clips.find((item) => time >= finite(item.start) && time <= finite(item.start) + Math.max(0, finite(item.out) - finite(item.in)));
      if (!clip) return null;
      return { clip, sourceTime: finite(clip.in) + Math.max(0, time - finite(clip.start)) };
    }
    function seekTimeline(time, track = "video", shouldPlay = false) {
      const target = Math.max(0, Math.min(timelineDuration.value, finite(time)));
      currentTime.value = target;
      if (renderedUrl.value && track === "ruler") {
        selected.value = null;
        positionPlayer(target, shouldPlay);
        return;
      }
      if (track === "video" || track === "ruler") {
        const hit = videoClipAt(target);
        if (!hit) return;
        renderedUrl.value = "";
        selected.value = { track: "video", id: hit.clip.id };
        loadFrameStrip(assetsById.value[hit.clip.asset_id]);
        positionPlayer(hit.sourceTime, shouldPlay);
        return;
      }
      const hit = audioClipAt(track, target);
      if (!hit) return;
      renderedUrl.value = "";
      selected.value = { track, id: hit.clip.id };
      positionPlayer(hit.sourceTime, shouldPlay);
    }
    function startClipDrag(track, clip, index) { draggedClip.value = { track, id: clip.id, index }; }
    function reorderVideo(targetIndex) {
      const drag = draggedClip.value;
      if (!drag || drag.track !== "video" || drag.index === targetIndex) return;
      const [clip] = project.value.video_clips.splice(drag.index, 1);
      project.value.video_clips.splice(targetIndex, 0, clip);
      draggedClip.value = null;
      persist();
    }
    function normalizeSelected() {
      const clip = selectedClip.value;
      const asset = selectedAsset.value;
      if (!clip || !asset) return;
      clip.in = Math.max(0, Math.min(finite(clip.in), Math.max(0, finite(asset.duration) - .01)));
      clip.out = Math.max(clip.in + .01, Math.min(finite(clip.out), finite(asset.duration)));
      clip.volume = Math.max(0, Math.min(4, finite(clip.volume, 1)));
      clip.fade_in = Math.max(0, Math.min(clip.out - clip.in, finite(clip.fade_in)));
      clip.fade_out = Math.max(0, Math.min(clip.out - clip.in, finite(clip.fade_out)));
      if (selected.value.track !== "video") clip.start = Math.max(0, finite(clip.start));
      renderedUrl.value = "";
      persist();
    }
    function deleteSelected() {
      const key = selected.value;
      if (!key) return;
      if (key.track === "video") project.value.video_clips = project.value.video_clips.filter((clip) => clip.id !== key.id);
      else project.value.audio_tracks[key.track].clips = project.value.audio_tracks[key.track].clips.filter((clip) => clip.id !== key.id);
      selected.value = null;
      renderedUrl.value = "";
      persist();
    }
    function duplicateSelected() {
      const clip = selectedClip.value;
      const key = selected.value;
      if (!clip || !key) return;
      const copy = { ...clip, id: id(key.track === "video" ? "vclip" : "aclip") };
      if (key.track === "video") {
        const index = project.value.video_clips.findIndex((item) => item.id === clip.id);
        project.value.video_clips.splice(index + 1, 0, copy);
      } else {
        copy.start = finite(clip.start) + finite(clip.out) - finite(clip.in);
        project.value.audio_tracks[key.track].clips.push(copy);
      }
      selected.value = { track: key.track, id: copy.id };
      persist();
    }
    function splitAtPlayhead() {
      let cursor = 0;
      for (let index = 0; index < project.value.video_clips.length; index += 1) {
        const clip = project.value.video_clips[index];
        const duration = finite(clip.out) - finite(clip.in);
        if (currentTime.value > cursor + .005 && currentTime.value < cursor + duration - .005) {
          const local = currentTime.value - cursor;
          const split = finite(clip.in) + local;
          const right = { ...clip, id: id("vclip"), in: split };
          clip.out = split;
          project.value.video_clips.splice(index + 1, 0, right);
          selected.value = { track: "video", id: right.id };
          renderedUrl.value = "";
          persist();
          return;
        }
        cursor += duration;
      }
      status.value = "播放头没有落在可切分的视频片段内部";
    }
    function removeAsset(asset) {
      project.value.assets = project.value.assets.filter((item) => item.id !== asset.id);
      project.value.video_clips = project.value.video_clips.filter((clip) => clip.asset_id !== asset.id);
      project.value.audio_tracks.forEach((track) => { track.clips = track.clips.filter((clip) => clip.asset_id !== asset.id); });
      if (selectedAsset.value?.id === asset.id) selected.value = null;
      renderedUrl.value = "";
      persist();
    }
    function seekFromPointer(event, track) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width) return;
      const value = (event.clientX - rect.left) / rect.width * timelineDuration.value;
      seekTimeline(value, track, false);
    }
    function beginSeek(event, track = "video") {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      seekDragging.value = true;
      seekTrack.value = track;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      seekFromPointer(event, track);
    }
    function dragSeek(event) {
      if (!seekDragging.value) return;
      event.preventDefault();
      seekFromPointer(event, seekTrack.value);
    }
    function endSeek(event) {
      if (!seekDragging.value) return;
      seekFromPointer(event, seekTrack.value);
      seekDragging.value = false;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    function onPlayerLoaded() { applyPendingPreview(); }
    function onPlayerTime() {
      const media = player.value;
      if (!media) return;
      if (renderedUrl.value) {
        currentTime.value = Math.min(timelineDuration.value, finite(media.currentTime));
        return;
      }
      const clip = selectedClip.value;
      const key = selected.value;
      if (!clip || !key) return;
      const local = Math.max(0, finite(media.currentTime) - finite(clip.in));
      if (key.track === "video") {
        const start = clipGlobalStart(clip.id);
        const duration = Math.max(0, finite(clip.out) - finite(clip.in));
        currentTime.value = Math.min(timelineDuration.value, start + Math.min(duration, local));
        if (!media.paused && finite(media.currentTime) >= finite(clip.out) - .025 && !advancingClip.value) {
          const index = project.value.video_clips.findIndex((item) => item.id === clip.id);
          const next = project.value.video_clips[index + 1];
          if (next) {
            advancingClip.value = true;
            seekTimeline(start + duration + .0001, "video", true);
            nextTick(() => { advancingClip.value = false; });
          } else {
            media.pause?.();
            currentTime.value = videoDuration.value;
          }
        }
      } else {
        currentTime.value = Math.min(timelineDuration.value, finite(clip.start) + local);
      }
    }
    function togglePlayback() {
      const media = player.value;
      if (!media) return;
      if (media.paused) {
        if (!renderedUrl.value && selectedClip.value && finite(media.currentTime) >= finite(selectedClip.value.out) - .025) {
          positionPlayer(finite(selectedClip.value.in), true);
        } else {
          media.play?.().catch?.(() => { status.value = "无法开始播放，请确认媒体编码受浏览器支持"; });
        }
      } else media.pause?.();
    }
    function returnToIn() {
      if (renderedUrl.value) seekTimeline(0, "ruler", false);
      else if (selectedClip.value) selectClip(selected.value.track, selectedClip.value, false);
    }
    function syncSize(anchor) {
      resizeAnchor.value = anchor;
      const sourceWidth = finite(firstVideo.value.width, width.value);
      const sourceHeight = finite(firstVideo.value.height, height.value);
      if (!lockRatio.value || !sourceWidth || !sourceHeight) return persistSettings();
      const ratio = sourceWidth / sourceHeight;
      if (anchor === "height") width.value = Math.max(2, Math.round(height.value * ratio / 2) * 2);
      else height.value = Math.max(2, Math.round(width.value / ratio / 2) * 2);
      persistSettings();
    }
    function persistSettings() {
      for (const [name, value] of Object.entries({ output_mode: outputMode.value, size_mode: sizeMode.value, width: width.value, height: height.value, lock_aspect_ratio: lockRatio.value, resize_anchor: resizeAnchor.value, fit_mode: fitMode.value, output_fps: outputFps.value, include_video_audio: includeVideoAudio.value, frame_step: frameStep.value, max_frames: maxFrames.value })) setWidget(node, name, value, false);
      node.graph?.change?.();
    }
    function renderTimeline() {
      persist();
      persistSettings();
      setWidget(node, "render_revision", (finite(widgetValue(node, "render_revision", 0)) + 1) % 2147483647);
      status.value = "已提交剪辑渲染…";
      app.queuePrompt?.(0, 1);
    }
    function toggleFullscreen() { fullscreen.value = !fullscreen.value; }
    function restore() {
      project.value = parseProject(widgetValue(node, "timeline_json", ""));
      outputMode.value = String(widgetValue(node, "output_mode", outputMode.value));
      sizeMode.value = String(widgetValue(node, "size_mode", sizeMode.value));
      width.value = finite(widgetValue(node, "width", width.value));
      height.value = finite(widgetValue(node, "height", height.value));
      lockRatio.value = Boolean(widgetValue(node, "lock_aspect_ratio", lockRatio.value));
      fitMode.value = String(widgetValue(node, "fit_mode", fitMode.value));
      includeVideoAudio.value = Boolean(widgetValue(node, "include_video_audio", includeVideoAudio.value));
      loadAllFrameStrips();
    }
    function executed(data) {
      const json = Array.isArray(data?.timeline_json) ? data.timeline_json[0] : data?.timeline_json;
      if (json) project.value = parseProject(json);
      const url = Array.isArray(data?.video_url) ? data.video_url[0] : data?.video_url;
      renderedUrl.value = url ? api.apiURL(url) : "";
      selected.value = null;
      currentTime.value = 0;
      status.value = Array.isArray(data?.status) ? String(data.status[0] || "完成") : String(data?.status || "完成");
      node._emteRuntime = { videoUrl: renderedUrl.value, status: status.value };
      positionPlayer(0, false);
    }
    node._emteRestore = restore;
    node._emteExecuted = executed;
    onBeforeUnmount(() => { delete node._emteRestore; delete node._emteExecuted; });
    Promise.resolve().then(() => loadAllFrameStrips());
    return {
      project, selected, fileInput, player, currentTime, renderedUrl, status, uploading, dropHot, fullscreen, zoom,
      outputMode, sizeMode, width, height, lockRatio, fitMode, outputFps, includeVideoAudio, frameStep, maxFrames,
      assetsById, videoDuration, timelineDuration, canvasWidth, playheadLeft, selectedClip, selectedAsset, previewAsset,
      sourceUrl, previewPoster, previewLabel, ruler, videoLayout, audioLayout, assetName, formatTime, mediaUrl, previewFrameUrl, clipFrames, uploadFiles, onDropFiles,
      openFilePicker, startAssetDrag, dropOnTrack, dropTrack, addVideo, addAudio, selectClip, startClipDrag, reorderVideo, normalizeSelected, deleteSelected,
      duplicateSelected, splitAtPlayhead, removeAsset, beginSeek, dragSeek, endSeek, onPlayerLoaded, onPlayerTime,
      togglePlayback, returnToIn, loadAllFrameStrips, syncSize, persistSettings,
      renderTimeline, toggleFullscreen,
    };
  },
  template: `
    <div class="emte-root eagle-vue-default-blue" :class="{fullscreen}">
      <div class="emte-head">
        <div style="min-width:0"><div class="emte-title">媒体剪辑台</div><div class="emte-status" :title="status">{{ status }}</div></div>
        <div class="emte-actions"><button class="emte-btn" @click="toggleFullscreen">{{ fullscreen?'退出全屏':'全屏剪辑' }}</button><button class="emte-btn primary" @click="renderTimeline">渲染输出</button></div>
      </div>
      <div class="emte-drop" :class="{hot:dropHot}" @dragenter.prevent="dropHot=true" @dragover.prevent @dragleave.prevent="dropHot=false" @drop.prevent="onDropFiles">
        <b>拖拽视频或音频到这里</b><span>或</span><button class="emte-btn" :disabled="uploading" @click="openFilePicker">{{ uploading?'上传中…':'选择文件' }}</button>
        <span class="emte-hint">上传后自动加入 V1 或 A1，可从素材箱重复拖入轨道</span>
        <input ref="fileInput" class="emte-file" type="file" multiple accept="video/*,audio/*,.mkv,.m4v,.flac,.ogg,.opus" @change="uploadFiles($event.target.files)">
      </div>
      <div class="emte-main">
        <div class="emte-bin">
          <div class="emte-section-head"><span>素材箱 {{ project.assets.length }}</span><span class="emte-hint">拖入轨道</span></div>
          <div class="emte-assets">
            <div v-if="!project.assets.length" class="emte-player-empty" style="padding:35px 5px">暂无素材</div>
            <div v-for="asset in project.assets" :key="asset.id" class="emte-asset" :class="{active:selectedAsset?.id===asset.id}" draggable="true" @dragstart="startAssetDrag(asset)" @dblclick="asset.type==='video'?addVideo(asset):addAudio(asset,0)">
              <span class="emte-icon">{{ asset.type==='video'?'🎞':'♪' }}</span><span style="min-width:0"><span class="emte-name">{{ asset.name }}</span><span class="emte-meta">{{ formatTime(asset.duration) }}<template v-if="asset.width"> · {{ asset.width }}×{{ asset.height }}</template></span></span>
              <button class="emte-btn danger" title="从项目移除，不删除磁盘文件" @click.stop="removeAsset(asset)">×</button>
            </div>
          </div>
        </div>
        <div class="emte-panel">
          <div class="emte-preview-head">
            <span class="emte-name" :title="previewLabel">{{ previewLabel }}</span>
            <span class="emte-hint">时间线 {{ formatTime(currentTime) }}</span>
            <button class="emte-btn" :disabled="!sourceUrl" @click="returnToIn">回到入点</button>
            <button class="emte-btn" :disabled="!sourceUrl" @click="togglePlayback">播放 / 暂停</button>
            <button class="emte-btn" :disabled="!previewAsset?.filename" @click="loadAllFrameStrips(true)">刷新帧预览</button>
          </div>
          <div class="emte-player">
            <video v-if="previewAsset?.type==='video' || renderedUrl" ref="player" :src="sourceUrl" :poster="previewPoster" controls playsinline preload="auto" @loadedmetadata="onPlayerLoaded" @canplay="onPlayerLoaded" @timeupdate="onPlayerTime"></video>
            <audio v-else-if="previewAsset?.type==='audio'" ref="player" :src="sourceUrl" controls preload="auto" @loadedmetadata="onPlayerLoaded" @canplay="onPlayerLoaded" @timeupdate="onPlayerTime"></audio>
            <div v-else class="emte-player-empty">选择素材或片段后在这里预览</div>
          </div>
          <div v-if="selectedClip" class="emte-inspector">
            <div class="emte-field"><label>入点（秒）</label><input type="number" min="0" step=".001" v-model.number="selectedClip.in" @change="normalizeSelected"></div>
            <div class="emte-field"><label>出点（秒）</label><input type="number" min=".01" step=".001" v-model.number="selectedClip.out" @change="normalizeSelected"></div>
            <div v-if="selected.track!=='video'" class="emte-field"><label>时间线起点</label><input type="number" min="0" step=".001" v-model.number="selectedClip.start" @change="normalizeSelected"></div>
            <div class="emte-field"><label>音量</label><input type="number" min="0" max="4" step=".05" v-model.number="selectedClip.volume" @change="normalizeSelected"></div>
            <div class="emte-field"><label>淡入 / 淡出</label><div class="emte-row"><input type="number" min="0" step=".05" v-model.number="selectedClip.fade_in" @change="normalizeSelected"><input type="number" min="0" step=".05" v-model.number="selectedClip.fade_out" @change="normalizeSelected"></div></div>
            <div class="emte-field"><label>片段声音</label><div class="emte-toggle"><input type="checkbox" v-model="selectedClip.mute" @change="normalizeSelected">静音 <label v-if="selected.track==='video'"><input type="checkbox" v-model="selectedClip.include_audio" @change="normalizeSelected">关联原声</label></div></div>
          </div>
          <div v-else class="emte-inspector"><span class="emte-hint" style="grid-column:1/-1">选择片段后编辑入点、出点、音量、淡入淡出；视频原声可独立关闭。</span></div>
        </div>
      </div>
      <div class="emte-timeline">
        <div class="emte-tl-head"><b>时间线</b><span>{{ formatTime(timelineDuration) }}</span><span>播放头 {{ formatTime(currentTime) }}</span><button class="emte-btn" @click="splitAtPlayhead">✂ 切分</button><button class="emte-btn" @click="duplicateSelected" :disabled="!selectedClip">复制</button><button class="emte-btn danger" @click="deleteSelected" :disabled="!selectedClip">删除</button><span class="emte-spacer"></span><label>缩放 <input type="range" min="20" max="300" step="10" v-model.number="zoom"></label></div>
        <div class="emte-scroll">
          <div class="emte-canvas" :style="{width:canvasWidth+'px'}">
            <div class="emte-ruler"><div class="emte-label"></div><div class="emte-ruler-lane" @pointerdown="beginSeek($event,'ruler')" @pointermove="dragSeek" @pointerup="endSeek" @pointercancel="endSeek"><i v-for="mark in ruler" :key="mark.pct" class="emte-tick" :style="{left:mark.pct+'%'}"><span>{{ formatTime(mark.time) }}</span></i></div></div>
            <div class="emte-track"><div class="emte-label">🎞 V1</div><div class="emte-lane" @pointerdown="beginSeek($event,'video')" @pointermove="dragSeek" @pointerup="endSeek" @pointercancel="endSeek" @dragover.prevent @drop.prevent="dropTrack($event,'video')"><div v-for="(item,index) in videoLayout" :key="item.clip.id" class="emte-clip" :class="{selected:selected?.id===item.clip.id}" :style="{left:item.left+'%',width:item.width+'%'}" @dragover.prevent @drop.stop.prevent="reorderVideo(index)"><span v-if="clipFrames(item.clip).length" class="emte-frame-strip"><img v-for="frame in clipFrames(item.clip)" :key="frame.filename" :src="previewFrameUrl(frame)" draggable="false"></span><span class="emte-clip-label"><span class="emte-clip-title">{{ assetName(item.clip.asset_id) }}</span><span class="emte-clip-time">{{ formatTime(item.clip.out-item.clip.in) }}</span></span><span class="emte-drag-handle" title="拖动调整片段顺序" draggable="true" @pointerdown.stop @dragstart.stop="startClipDrag('video',item.clip,index)">↔</span></div><div class="emte-playhead" :style="{left:playheadLeft}"></div></div></div>
            <div v-for="trackIndex in [0,1]" :key="trackIndex" class="emte-track"><div class="emte-label audio">♪ A{{trackIndex+1}}</div><div class="emte-lane" @pointerdown="beginSeek($event,trackIndex)" @pointermove="dragSeek" @pointerup="endSeek" @pointercancel="endSeek" @dragover.prevent @drop.prevent="dropTrack($event,trackIndex)"><div v-for="item in audioLayout(trackIndex)" :key="item.clip.id" class="emte-clip audio" :class="{selected:selected?.id===item.clip.id}" :style="{left:item.left+'%',width:item.width+'%'}"><span class="emte-clip-title">{{ assetName(item.clip.asset_id) }}</span><span class="emte-clip-time">{{ formatTime(item.clip.out-item.clip.in) }}</span></div><div class="emte-playhead" :style="{left:playheadLeft}"></div></div></div>
          </div>
        </div>
      </div>
      <div class="emte-settings">
        <div class="emte-field"><label>输出内容</label><select v-model="outputMode" @change="persistSettings"><option value="video_audio">视频 + 音频（图像口首帧）</option><option value="video_audio_frames">视频 + 音频 + 全部帧</option><option value="frames">仅图像帧</option><option value="audio">仅音频</option></select></div>
        <div class="emte-field"><label>画布尺寸</label><select v-model="sizeMode" @change="persistSettings"><option value="follow_first">跟随首段</option><option value="custom">自定义</option></select></div>
        <div v-if="sizeMode==='custom'" class="emte-field"><label>宽度</label><input type="number" min="64" step="8" v-model.number="width" @change="syncSize('width')"></div>
        <div v-if="sizeMode==='custom'" class="emte-field"><label>高度</label><input type="number" min="64" step="8" v-model.number="height" @change="syncSize('height')"></div>
        <div class="emte-field"><label>适配方式</label><select v-model="fitMode" @change="persistSettings"><option value="contain">完整适应</option><option value="cover">填充裁剪</option><option value="stretch">拉伸</option></select></div>
        <div class="emte-field"><label>输出 FPS（0 跟随）</label><input type="number" min="0" max="240" step=".001" v-model.number="outputFps" @change="persistSettings"></div>
        <div class="emte-field"><label>帧步长 / 最大帧</label><div class="emte-row"><input type="number" min="1" v-model.number="frameStep" @change="persistSettings"><input type="number" min="0" v-model.number="maxFrames" @change="persistSettings"></div></div>
        <div class="emte-field"><label>宽高比与原声</label><div class="emte-toggle"><label><input type="checkbox" v-model="lockRatio" @change="syncSize('width')">锁定</label><label><input type="checkbox" v-model="includeVideoAudio" @change="persistSettings">原声</label></div></div>
      </div>
    </div>
  `,
};

app.registerExtension({
  name: "EagleSuite.MediaTimelineEditor",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleMediaTimelineEditor") return;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      if (this._emteVue) return result;
      installStyle();
      this.setSize([1020, 900]);
      setTimeout(() => hideWidgets(this), 50);
      const element = document.createElement("div");
      element.style.cssText = "box-sizing:border-box;width:1000px;height:790px;overflow:hidden";
      const widget = this.addDOMWidget("media_timeline_editor", "div", element, { serialize: false, canvasOnly: true, hideOnZoom: false });
      widget.width = undefined;
      const applyFrame = (size) => {
        element.style.width = `${Math.max(760, finite(size?.[0], 1020) - 20)}px`;
        element.style.height = `${Math.max(620, finite(size?.[1], 900) - 110)}px`;
      };
      applyFrame(this.size);
      this._emteApplyFrame = applyFrame;
      this._emteVue = createApp(TimelineEditor, { node: this });
      this._emteVue.mount(element);
      const resize = this.onResize;
      this.onResize = function (size) { resize?.apply(this, arguments); applyFrame(size); };
      return result;
    };
    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = configured?.apply(this, arguments);
      setTimeout(() => { hideWidgets(this); this._emteApplyFrame?.(this.size); this._emteRestore?.(); }, 0);
      return result;
    };
    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (data) { executed?.apply(this, arguments); this._emteExecuted?.(data); };
    const removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () { this._emteVue?.unmount?.(); this._emteVue = null; return removed?.apply(this, arguments); };
  },
});
