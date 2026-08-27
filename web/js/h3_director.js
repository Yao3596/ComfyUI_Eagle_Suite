/**
 * Eagle H3 Director — 内联单文件前端（照搬 eagle_gallery.js 模式）
 * 所有组件、composables、CSS 全部内联，只依赖 vue.esm-browser.js。
 */
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import {
    createApp, defineComponent, reactive, computed, watch,
    ref, nextTick, provide, inject
} from "../lib/vue.esm-browser.js";

console.log("[EagleH3Director] h3_director.js loaded");

// ─────────────────────────────────────────────────────────────────
// CSS（注入一次）
// ─────────────────────────────────────────────────────────────────
var H3D_CSS = `
.h3d-root{
  --h3d-bg:#0b0c0f; --h3d-bg2:#14151b; --h3d-bg3:#1c1e26; --h3d-bg4:#242731;
  --h3d-bd:#30333f; --h3d-bdh:#3f4352;
  --h3d-fg:#e8ebf2; --h3d-muted:#9aa2b1;
  --h3d-primary:#4a7de0; --h3d-primaryh:#5a8df0;
  --h3d-danger:#c14b4b; --h3d-success:#4a9a62; --h3d-warn:#d4a24a;
  --h3d-radius:8px;
  display:flex; flex-direction:column; height:100%; min-height:0;
  background:var(--h3d-bg); color:var(--h3d-fg);
  font:13px/1.45 system-ui,"Segoe UI",sans-serif; box-sizing:border-box; overflow:hidden;
}
.h3d-root *{box-sizing:border-box;}
.h3d-topbar{
  display:flex; align-items:center; gap:8px; padding:8px 12px; flex-wrap:wrap;
  background:var(--h3d-bg2); border-bottom:1px solid var(--h3d-bd); flex-shrink:0;
}
.h3d-topbar h1{margin:0;font-size:14px;display:flex;align-items:center;gap:6px;color:#fff;}
.h3d-badge{font-size:10px;padding:1px 6px;border-radius:6px;background:#2a2d36;color:var(--h3d-muted);border:1px solid var(--h3d-bd);}
.h3d-field{display:flex;align-items:center;gap:4px;}
.h3d-field label{color:var(--h3d-muted);font-size:11px;white-space:nowrap;}
.h3d-sel,.h3d-inp{background:var(--h3d-bg4);color:var(--h3d-fg);border:1px solid var(--h3d-bd);border-radius:5px;padding:4px 7px;font:inherit;font-size:12px;outline:none;}
.h3d-sel:focus,.h3d-inp:focus{border-color:var(--h3d-primary);}
.h3d-inp.sm{width:auto;padding:3px 6px;font-size:11px;}
.h3d-inp.time{width:88px;font-family:ui-monospace,monospace;}
.h3d-spacer{flex:1;}
.h3d-pill{font-size:10px;padding:3px 8px;border-radius:6px;background:var(--h3d-bg4);color:var(--h3d-muted);border:1px solid var(--h3d-bd);}
.h3d-sync{font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid var(--h3d-bd);color:var(--h3d-success);border-color:#2e5e44;}
.h3d-sync.dirty{color:var(--h3d-warn);border-color:#5e4a2e;}
.h3d-btn{background:var(--h3d-bg4);color:var(--h3d-fg);border:1px solid var(--h3d-bd);border-radius:6px;padding:5px 10px;font:inherit;font-size:12px;cursor:pointer;transition:.15s;display:inline-flex;align-items:center;gap:4px;}
.h3d-btn:hover{border-color:var(--h3d-primary);color:#fff;}
.h3d-btn.primary{background:var(--h3d-primary);color:#fff;border-color:var(--h3d-primary);}
.h3d-btn.primary:hover{background:var(--h3d-primaryh);}
.h3d-btn.danger:hover{border-color:var(--h3d-danger);color:var(--h3d-danger);}
.h3d-btn.sm{padding:2px 7px;font-size:11px;}
.h3d-body{display:flex;flex:1;min-height:0;overflow:hidden;}
.h3d-col{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--h3d-bd);}
.h3d-col:last-child{border-right:none;}
.h3d-col-hd{padding:7px 10px;font-size:12px;font-weight:600;color:#fff;background:var(--h3d-bg2);border-bottom:1px solid var(--h3d-bd);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.h3d-col-body{flex:1;min-height:0;padding:10px;display:flex;flex-direction:column;gap:10px;overflow-y:auto;overflow-x:hidden;}
.h3d-col-body::-webkit-scrollbar{width:9px;}
.h3d-col-body::-webkit-scrollbar-thumb{background:#33363f;border-radius:6px;}
.h3d-col-body::-webkit-scrollbar-track{background:transparent;}
.h3d-scroll-box{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;overflow-y:auto;overflow-x:hidden;}
.h3d-scroll-box::-webkit-scrollbar{width:8px;}
.h3d-scroll-box::-webkit-scrollbar-thumb{background:#2f323b;border-radius:5px;}
.h3d-card{background:var(--h3d-bg2);border:1px solid var(--h3d-bd);border-radius:var(--h3d-radius);padding:10px;}
.h3d-card-title{font-size:12px;font-weight:600;color:#fff;margin-bottom:8px;display:flex;align-items:center;gap:6px;justify-content:space-between;}
.h3d-label{font-size:11px;color:var(--h3d-muted);display:block;margin-bottom:3px;}
.h3d-hint{font-size:10px;color:var(--h3d-muted);line-height:1.4;}
.h3d-row{display:flex;align-items:center;gap:8px;}
.h3d-row.col{flex-direction:column;align-items:stretch;gap:4px;}
.h3d-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.h3d-textarea{background:var(--h3d-bg4);color:var(--h3d-fg);border:1px solid var(--h3d-bd);border-radius:6px;padding:6px 8px;font:12px/1.5 ui-monospace,monospace;resize:vertical;width:100%;outline:none;min-height:60px;}
.h3d-textarea:focus{border-color:var(--h3d-primary);}
/* 高亮编辑区 */
.h3d-hl-wrap{position:relative;flex:1;min-height:60px;display:flex;flex-direction:column;background:var(--h3d-bg4);border:1px solid var(--h3d-bd);border-radius:6px;overflow:hidden;}
.h3d-hl-wrap:focus-within{border-color:var(--h3d-primary);}
.h3d-hl-layer,.h3d-hl-textarea{position:absolute;top:0;left:0;right:0;bottom:0;margin:0;padding:6px 8px;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;word-wrap:break-word;box-sizing:border-box;background:transparent;}
.h3d-hl-layer{color:var(--h3d-fg);pointer-events:none;z-index:1;overflow:hidden;}
.h3d-hl-textarea{color:transparent;caret-color:var(--h3d-fg);resize:none;outline:none;border:none;z-index:2;overflow:auto;}
.h3d-hl-textarea::placeholder{color:transparent;}
.h3d-hl-placeholder{color:var(--h3d-muted);pointer-events:none;}
.h3d-hl-ref{display:inline-block;background:#3a3018;color:#f3c96a;border:1px solid #7a5c1a;border-radius:4px;padding:0 4px;font-size:11px;}
.h3d-hl-d{display:inline-block;background:#1a2f4a;color:#7ab8ff;border:1px solid #3a5f9e;border-radius:4px;padding:0 4px;font-size:11px;}
.h3d-collapse-hd{display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;color:var(--h3d-muted);font-size:11px;padding:4px 0;}
.h3d-collapse-hd .arr{transition:.15s;}
.h3d-collapse-hd.open .arr{transform:rotate(90deg);}
.h3d-scene{border:1px solid var(--h3d-bd);border-radius:6px;padding:8px;background:var(--h3d-bg2);cursor:pointer;transition:.12s;}
.h3d-scene.active{border-color:var(--h3d-primary);background:#192230;}
.h3d-scene .ttl{font-weight:600;color:#fff;display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}
.h3d-bar{height:5px;background:#262a33;border-radius:3px;margin-top:4px;overflow:hidden;}
.h3d-bar>i{display:block;height:100%;background:var(--h3d-primary);transition:width .3s;}
.h3d-bar.over>i{background:var(--h3d-danger);}
.h3d-mini{font-size:10px;color:var(--h3d-muted);}
.h3d-tabs{display:flex;gap:3px;border-bottom:1px solid var(--h3d-bd);margin-bottom:10px;flex-shrink:0;}
.h3d-tab{background:transparent;border:none;border-bottom:2px solid transparent;color:var(--h3d-muted);font:inherit;font-size:12px;padding:6px 10px;cursor:pointer;transition:.12s;}
.h3d-tab:hover{color:var(--h3d-fg);}
.h3d-tab.active{color:var(--h3d-primary);border-bottom-color:var(--h3d-primary);font-weight:600;}
.h3d-shot{border:1px solid var(--h3d-bd);border-radius:6px;padding:8px;background:var(--h3d-bg2);margin-bottom:8px;}
.h3d-shot .hd{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;}
.h3d-shot .st{color:var(--h3d-primary);font-weight:700;font-size:11px;}
.h3d-shot .tm{color:var(--h3d-warn);font-family:ui-monospace,monospace;font-size:11px;}
.h3d-shot-card{border:1px solid var(--h3d-bd);border-radius:6px;padding:10px;background:var(--h3d-bg2);cursor:pointer;transition:.12s;margin-bottom:8px;}
.h3d-shot-card:hover{border-color:var(--h3d-primary);}
.h3d-shot-card .hd{display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:6px;}
.h3d-shot-card .st{color:var(--h3d-primary);font-weight:700;}
.h3d-shot-card .tm{color:var(--h3d-warn);font-family:ui-monospace,monospace;}
.h3d-shot-card .ct{color:var(--h3d-muted);font-size:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
.h3d-shot-card .mt{font-size:10px;color:var(--h3d-muted);margin-top:4px;}
.h3d-dlg{border:1px solid var(--h3d-bd);border-radius:6px;padding:8px;background:var(--h3d-bg2);margin-bottom:8px;}
.h3d-tag{display:inline-block;background:#1d2733;color:var(--h3d-primary);border-radius:4px;padding:0 5px;font-family:ui-monospace,monospace;font-size:10px;}
.h3d-ref-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}
.h3d-refslot{border:1px solid var(--h3d-bd);border-radius:6px;padding:6px;background:var(--h3d-bg2);display:flex;flex-direction:column;gap:6px;}
.h3d-refslot.has-img{border-color:var(--h3d-primary);}
.h3d-refslot .thumb{width:100%;aspect-ratio:1.3;background:#0e0f13;border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;position:relative;}
.h3d-refslot .thumb img{width:100%;height:100%;object-fit:cover;}
.h3d-refslot .thumb .ph{color:var(--h3d-muted);font-size:20px;}
.h3d-refslot .badge{position:absolute;top:4px;left:4px;background:rgba(0,0,0,.7);color:#fff;font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;}
.h3d-preview{flex:1;min-height:100px;max-height:34vh;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#0d0f14;border:1px solid var(--h3d-bd);border-radius:6px;padding:10px;font-size:11px;color:#d7f1dc;font-family:ui-monospace,monospace;}
.h3d-stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;}
.h3d-stat{font-size:10px;color:var(--h3d-muted);}
.h3d-stat b{color:var(--h3d-fg);}
.h3d-warn-box{margin-top:6px;background:#2a1f17;border:1px solid #5e4a2e;border-radius:6px;padding:6px 8px;font-size:10px;color:var(--h3d-warn);}
.h3d-warn-box ul{margin:4px 0 0;padding-left:16px;}
.h3d-statusbar{display:flex;align-items:center;gap:12px;padding:5px 10px;font-size:10px;color:var(--h3d-muted);background:var(--h3d-bg2);border-top:1px solid var(--h3d-bd);flex-shrink:0;}
.h3d-empty{color:var(--h3d-muted);text-align:center;padding:20px;font-size:11px;}
.h3d-media-strip{display:flex;align-items:stretch;gap:7px;min-height:76px;padding:7px;background:#101218;border:1px solid var(--h3d-bd);border-radius:7px;overflow-x:auto;overflow-y:hidden;flex-shrink:0;}
.h3d-media-strip::-webkit-scrollbar{height:8px}.h3d-media-strip::-webkit-scrollbar-thumb{background:#343845;border-radius:5px}
.h3d-media-card{position:relative;flex:0 0 82px;height:62px;border:1px solid var(--h3d-bd);border-radius:6px;background:#191c24;overflow:hidden;cursor:pointer;user-select:none;}
.h3d-media-card:hover,.h3d-media-card.drag-over{border-color:var(--h3d-primary);box-shadow:0 0 0 1px rgba(74,125,224,.25)}
.h3d-media-card.dragging{opacity:.45}.h3d-media-card img,.h3d-media-card video{width:100%;height:100%;object-fit:cover;display:block;background:#090a0d}
.h3d-media-card .audio-icon{height:100%;display:flex;align-items:center;justify-content:center;font-size:26px;color:#73b7ed;background:linear-gradient(135deg,#15293a,#1a1d28)}
.h3d-media-card .media-tag{position:absolute;left:3px;top:3px;background:rgba(0,0,0,.78);padding:1px 4px;border-radius:3px;color:#fff;font-size:9px;max-width:74px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h3d-media-card .media-time{position:absolute;right:3px;bottom:3px;background:rgba(0,0,0,.76);padding:1px 4px;border-radius:3px;color:#ddd;font-size:9px}
.h3d-media-card .media-actions{position:absolute;right:2px;top:2px;display:flex;gap:2px;opacity:0}.h3d-media-card:hover .media-actions{opacity:1}
.h3d-media-card .media-action{width:18px;height:18px;border:0;border-radius:3px;background:rgba(10,10,10,.82);color:#fff;padding:0;cursor:pointer;font-size:10px}
.h3d-media-add{flex:0 0 82px;height:62px;border:1px dashed #465064;border-radius:6px;background:#141720;color:var(--h3d-muted);cursor:pointer;font-size:11px}.h3d-media-add:hover{color:#fff;border-color:var(--h3d-primary)}
.h3d-media-token{display:inline-flex;align-items:center;gap:3px;height:18px;padding:0 4px 0 2px;border-radius:4px;border:1px solid #3d5364;background:#172630;color:#8fc8e8;font-size:10px;vertical-align:baseline;}
.h3d-media-token.video{background:#271e34;border-color:#59436f;color:#c7a6e8}.h3d-media-token.audio{background:#24272d;border-color:#515864;color:#cbd2dc}
.h3d-media-token img{width:15px;height:15px;object-fit:cover;border-radius:3px}.h3d-media-token i{width:15px;text-align:center;font-style:normal;font-size:10px}
.h3d-media-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.h3d-media-detail{border:1px solid var(--h3d-bd);border-radius:7px;background:var(--h3d-bg2);padding:7px;min-width:0}
.h3d-media-detail-preview{height:82px;border-radius:5px;overflow:hidden;background:#0b0d12;display:flex;align-items:center;justify-content:center;position:relative}.h3d-media-detail-preview img,.h3d-media-detail-preview video{width:100%;height:100%;object-fit:cover}.h3d-media-detail-preview .audio-icon{font-size:30px;color:#73b7ed}
.h3d-media-dropzone{min-height:118px;border:2px dashed #465064;border-radius:9px;background:linear-gradient(180deg,#111722,#0e1118);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;color:var(--h3d-muted);cursor:pointer;transition:.15s;flex-shrink:0}
.h3d-media-dropzone:hover{border-color:var(--h3d-primary);background:#131c2b;color:#fff}.h3d-media-dropzone .drop-icon{font-size:26px;color:#73a7ef;line-height:1}.h3d-media-dropzone .drop-title{font-size:12px;font-weight:600}.h3d-media-dropzone .drop-sub{font-size:10px;color:var(--h3d-muted)}
.h3d-trim-overlay{position:absolute;z-index:40;inset:0;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:24px}.h3d-trim-dialog{width:min(620px,92%);background:#171b23;border:1px solid #465064;border-radius:9px;padding:14px;box-shadow:0 14px 50px rgba(0,0,0,.55)}
.h3d-trim-preview{height:220px;background:#090b0f;border-radius:7px;display:flex;align-items:center;justify-content:center;overflow:hidden;margin:10px 0}.h3d-trim-preview video{max-width:100%;max-height:100%}.h3d-trim-preview audio{width:92%}
.h3d-trim-ranges{display:grid;grid-template-columns:72px 1fr 70px;gap:7px;align-items:center;margin:8px 0}.h3d-trim-ranges input[type=range]{width:100%}
`;

// ─────────────────────────────────────────────────────────────────
// 数据工厂
// ─────────────────────────────────────────────────────────────────
function createScene(id) {
    return { id: id, title: '', defaultSeconds: 10, defaultSteps: 8, shots: [], dialogues: [], preamble: '' };
}
function createShot(id) {
    return {
        id: id, title: '', time: '00:00.000', framing: '', content: '',
        camera: '', lens: '', intent: '', action: '', sound: '',
        transitionIn: '', transitionOut: '', estSeconds: 2.5
    };
}
function createDialogue(id) { return { id: id, role: '', text: '', time: '' }; }
function createRef() { return { url: '', filename: '', name: '', kind: 'person', retention: 'fully_preserved' }; }
function createMediaRef(data) {
    data = data || {};
    var duration = Math.max(0, Number(data.duration) || 0);
    return {
        id: data.id || ('media-' + Date.now() + '-' + Math.random().toString(16).slice(2)),
        type: ['image','video','audio'].indexOf(data.type) >= 0 ? data.type : 'image',
        filename: data.filename || '',
        originalName: data.originalName || data.name || data.filename || '',
        name: data.name || '',
        kind: data.kind || (data.type === 'image' ? 'person' : 'reference'),
        retention: data.retention || 'fully_preserved',
        duration: duration,
        trimStart: Math.max(0, Number(data.trimStart) || 0),
        trimEnd: Number.isFinite(Number(data.trimEnd)) && Number(data.trimEnd) > 0 ? Number(data.trimEnd) : duration,
        url: data.url || (data.filename ? '/h3_director/media?filename=' + encodeURIComponent(data.filename) : '')
    };
}
function migrateMediaRefs(project) {
    if (!project) return;
    if (!Array.isArray(project.mediaRefs)) project.mediaRefs = [];
    project.mediaRefs = project.mediaRefs.filter(function(x) { return x && x.filename; }).map(createMediaRef);
    if (!project.mediaRefs.length && Array.isArray(project.refs)) {
        project.refs.forEach(function(r, i) {
            if (!r || !r.filename) return;
            project.mediaRefs.push(createMediaRef({
                id: r.id || ('legacy-image-' + (i + 1)), type: 'image', filename: r.filename,
                originalName: r.name || r.filename, name: r.name || '', kind: r.kind || 'person',
                retention: r.retention || 'fully_preserved', url: r.url || ''
            }));
        });
    }
}
function defaultProject() {
    return {
        mode: 't2v', globalDuration: 7, globalSteps: 8,
        aspect: '9:16', resolution: '720p', fps: 24, exportMode: 'all',
        sizePreset: '9:16|720p|1080|1920',
        foundation: '',
        contextLength: 22, encodeMode: 'video', anchorMode: 'head', crop: 'disabled',
        audioMode: 'generated_audio', audioContextLength: 22, baseSeed: 0, segmentCrf: 18,
        refMaxMegapixels: 1.5,
        videoBlendFrames: 0, continuationMode: 'guide',
        refs: Array.from({ length: 9 }, function() { return createRef(); }),
        mediaRefs: [],
        skill: {
            tasks: [],            // ['script','shots','dialogue'] 多选
            modelPref: 'local',   // 'local' 本地优先 | 'api'
            mergeMode: 'overwrite', // 'overwrite' 覆盖 | 'append' 追加
            profile: 'balanced',
            skillPolicy: 'merge',
            temperature: 0.7,
            hint: ''
        }
    };
}

// ─────────────────────────────────────────────────────────────────
// h3_state 状态读写
// ─────────────────────────────────────────────────────────────────
function loadState(node) {
    var project = defaultProject();
    var scenes = [createScene(1)];
    try {
        var w = (node.widgets || []).find(function(x) { return x.name === 'h3_state'; });
        if (w && w.value && w.value !== '{}') {
            var data = JSON.parse(w.value);
            if (data && data.project) Object.assign(project, data.project);
            if (data && Array.isArray(data.scenes) && data.scenes.length) scenes = data.scenes;
        }
    } catch(e) { console.warn('[EagleH3Director] loadState error:', e); }
    migrateMediaRefs(project);
    return { project: project, scenes: scenes };
}
function extractDialoguesIfNeeded(scenes) {
    (scenes || []).forEach(function(sc) {
        if (!sc.dialogues || !sc.dialogues.length) {
            var parsed = extractAllDialogues(sc);
            if (parsed.length) {
                parsed.forEach(function(d, i) { d.id = i + 1; });
                sc.dialogues = parsed;
            }
        }
    });
}
function applyStateToReactive(project, scenes, store, data) {
    var savedProject = data.project || {};
    // 兼容旧版 segmentRef → segmentCrf
    if ('segmentRef' in savedProject && !('segmentCrf' in savedProject)) {
        savedProject.segmentCrf = savedProject.segmentRef;
    }
    var defProject = defaultProject();
    Object.keys(defProject).forEach(function(k) {
        project[k] = (k in savedProject) ? savedProject[k] : defProject[k];
    });
    migrateMediaRefs(project);
    // skill 配置确保字段完整（兼容旧工作流缺失字段）
    var defSkill = defProject.skill;
    if (!project.skill || typeof project.skill !== 'object') project.skill = {};
    Object.keys(defSkill).forEach(function(k) {
        if (!(k in project.skill)) project.skill[k] = defSkill[k];
    });
    scenes.splice(0, scenes.length);
    if (Array.isArray(data.scenes) && data.scenes.length) {
        data.scenes.forEach(function(s) { scenes.push(s); });
    } else {
        scenes.push(createScene(1));
    }
    extractDialoguesIfNeeded(scenes);
    store.currentSceneId = (scenes[0] && scenes[0].id) || 1;
}
function saveState(node, project, scenes) {
    var w = (node.widgets || []).find(function(x) { return x.name === 'h3_state'; });
    if (!w) return;
    if (node._h3SaveTimer) clearTimeout(node._h3SaveTimer);
    node._h3SaveTimer = setTimeout(function() {
        try {
            var clean = JSON.parse(JSON.stringify({ project: project, scenes: scenes }));
            (clean.project.mediaRefs || []).forEach(function(r) { if (r) delete r.file; });
            // Keep a legacy image-only mirror so older workflow consumers continue to work.
            clean.project.refs = (clean.project.mediaRefs || []).filter(function(r) { return r.type === 'image'; }).map(function(r) {
                return { id:r.id, url:r.url, filename:r.filename, name:r.name, kind:r.kind, retention:r.retention };
            });
            var json = JSON.stringify(clean);
            w.value = json;
            if (typeof w.callback === 'function') w.callback(w.value, w, node);
            if (node.graph) node.graph.change();
        } catch(e) { console.warn('[EagleH3Director] saveState error:', e); }
    }, 300);
}

// ─────────────────────────────────────────────────────────────────
// 编译（前端镜像）
// ─────────────────────────────────────────────────────────────────
function fmtTime(sec) {
    sec = Math.max(0, Number(sec) || 0);
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60), ms = Math.round((sec - Math.floor(sec)) * 1000);
    return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') + '.' + String(ms).padStart(3,'0');
}
var DIALOGUE_RE = /<d>\[([^\]]+)\]\s*([^<]+)<\/d>/gi;
function parseDialogues(text) {
    var out = []; var m; DIALOGUE_RE.lastIndex = 0;
    while ((m = DIALOGUE_RE.exec(text)) !== null)
        out.push({ role: m[1].trim(), text: m[2].trim(), time: '' });
    return out;
}
function extractAllDialogues(scene) {
    // 从 preamble + 每个 shot.content 合并提取所有 <d> 标签
    var texts = [scene.preamble || ''];
    (scene.shots || []).forEach(function(sh) { if (sh.content) texts.push(sh.content); });
    return parseDialogues(texts.join('\n'));
}
function buildDTag(role, text) { return '<d>[' + role + '] ' + text + '</d>'; }

// 高亮标签：@refN 与 <d>...</d>
function _escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function mediaTagFor(item, items) {
    items = items || [];
    var names = { image:'Picture', video:'Video', audio:'Audio' };
    var number = 0;
    for (var i = 0; i < items.length; i++) {
        if (items[i].type === item.type) number++;
        if (items[i].id === item.id) return '<' + (names[item.type] || 'Picture') + ' ' + number + '>';
    }
    return '';
}
function mediaNumberMap(items) {
    var map = {};
    (items || []).forEach(function(item) { map[item.id] = mediaTagFor(item, items); });
    return map;
}
function rewriteMediaTags(text, before, after, removedId) {
    text = text || '';
    var placeholders = {};
    Object.keys(before || {}).forEach(function(id, index) {
        var tag = before[id];
        if (!tag) return;
        var marker = '__H3_MEDIA_' + index + '_' + Date.now() + '__';
        placeholders[id] = marker;
        text = text.split(tag).join(marker);
    });
    Object.keys(placeholders).forEach(function(id) {
        var replacement = id === removedId ? '' : ((after && after[id]) || before[id] || '');
        text = text.split(placeholders[id]).join(replacement);
    });
    return text.replace(/[ \t]{2,}/g, ' ');
}
function highlightText(s, mediaItems) {
    if (!s) return '';
    var out = _escapeHtml(s);
    // 先识别 <d>...</d>（可能跨行）
    out = out.replace(/&lt;d&gt;[\s\S]*?&lt;\/d&gt;/g, function(m) {
        return '<span class="h3d-hl-d">' + m + '</span>';
    });
    var lookup = {};
    (mediaItems || []).forEach(function(item) { lookup[mediaTagFor(item, mediaItems)] = item; });
    out = out.replace(/&lt;(Picture|Video|Audio)\s+(\d+)&gt;/gi, function(match, type, number) {
        var canonical = '<' + type.charAt(0).toUpperCase() + type.slice(1).toLowerCase() + ' ' + number + '>';
        var item = lookup[canonical];
        var icon = type.toLowerCase() === 'video' ? '▶' : (type.toLowerCase() === 'audio' ? '♪' : '▧');
        var thumb = '';
        if (item && item.type === 'image' && item.url) {
            thumb = '<img src="' + _escapeHtml(item.url) + '" alt="">';
        } else {
            thumb = '<i>' + icon + '</i>';
        }
        return '<span class="h3d-media-token ' + type.toLowerCase() + '">' + thumb + match + '</span>';
    });
    // 再识别旧版 @refN / @图片N / @音频N 等引用标签
    out = out.replace(/@(?:ref|图片|音频|视频|video|audio)\d+/g, '<span class="h3d-hl-ref">$&</span>');
    return out;
}

function compilePrompt(project, scene) {
    if (!project) project = {};
    if (!scene) scene = {};
    var parts = [];
    var mode = (project.mode || 't2v').toUpperCase();
    var secs = scene.defaultSeconds || 10;
    parts.push('Task: ' + mode + ', ' + secs + 's, ' + (project.aspect||'9:16') + ', ' + (project.resolution||'720p') + ', ' + (project.fps||24) + 'fps.');

    // Shared prompt：自动 prepend 到每个场景开头
    var fd = (project.foundation || '').trim();
    if (fd) {
        if (fd.trimStart().startsWith('integrated_multimodal_description:')) {
            parts.push(fd);
        } else {
            parts.push('integrated_multimodal_description:\n  ' + fd.replace(/\n/g, '\n  '));
        }
    } else {
        parts.push('integrated_multimodal_description:\n  (Shared prompt placeholder — fill in 世界构建 & 风格基础 to prepend to every scene.)');
    }

    // 多模态参考信息：编号在各媒体类型内独立计算。
    var mediaRefs = (project.mediaRefs || []).filter(function(r) { return r && r.filename; });
    var refs = mediaRefs.filter(function(r) { return r.type === 'image'; });
    var noun = { person:'a character', prop:'a prop', style:'an art style', environment:'an environment', composition:'a composition' };
    var subj = mediaRefs.map(function(r) {
        var tag = mediaTagFor(r, mediaRefs);
        var name = (r.name || '').trim();
        var ofName = name ? ' of ' + name : '';
        var description = r.type === 'image' ? (noun[r.kind] || 'an image') : (r.type === 'video' ? 'a video' : 'an audio');
        return '  ' + tag + ' is ' + description + ofName + ' reference.';
    }).join('\n');
    if (subj) parts.push('subject_definitions:\n' + subj);
    var ret = refs.map(function(r) {
        var tag = mediaTagFor(r, mediaRefs);
        var name = (r.name || '').trim();
        var nameTag = name ? ' (' + name + ')' : '';
        var line = '  ' + tag + nameTag + ': ' + (r.retention||'fully_preserved') + '.';
        if (r.kind === 'person') line += ' Do not copy the background of the reference image; keep only the character design.';
        return line;
    }).join('\n');
    if (ret) parts.push('retention_analysis:\n' + ret);

    var preamble = (scene.preamble || '').replace(/<d>[\s\S]*?<\/d>/g,'').replace(/\n{3,}/g,'\n\n').trim();
    var shots = scene.shots || [];
    var shotLines = shots.map(function(s, i) {
        var p = [];
        if (s.time) p.push('At ' + s.time + ',');
        if (s.framing) p.push('[' + s.framing + ']');
        if (s.transitionIn) p.push('Transition in: ' + s.transitionIn + '.');
        p.push(s.content || '(no content)');
        if (s.intent) p.push('Narrative intent: ' + s.intent + '.');
        if (s.action) p.push('Action: ' + s.action + '.');
        if (s.camera) p.push('Camera: ' + s.camera + '.');
        if (s.lens) p.push('Lens/focus: ' + s.lens + '.');
        if (s.sound) p.push('Sound: ' + s.sound + '.');
        if (s.transitionOut) p.push('Transition out: ' + s.transitionOut + '.');
        return '[Shot ' + (i+1) + ': ' + (s.title||'untitled') + '] ' + p.join(' ');
    }).join('\n\n  ');
    var detailed = shots.length ? 'detailed_description:\n  ' + shotLines : '';
    var dlgs = (scene.dialogues || []).filter(function(d) { return d && d.role && d.text; })
        .map(function(d) { return '  ' + buildDTag(d.role, d.text); }).join('\n');
    var dialogue = dlgs ? 'Dialogue:\n' + dlgs : '';
    var body = [preamble, detailed, dialogue].filter(Boolean).join('\n\n');
    if (body) parts.push(body);
    var sounds = shots.map(function(s) { return s.sound; }).filter(Boolean).join(', ');
    if (sounds) parts.push('overall_soundscape:\n  ' + sounds);
    var music = project.globalMusic || scene.music || '';
    if (music) parts.push('non_diegetic_music:\n  ' + music);
    return parts.join('\n\n');
}

// ─────────────────────────────────────────────────────────────────
// 根组件 H3DirectorApp
// ─────────────────────────────────────────────────────────────────
var H3DirectorApp = defineComponent({
    name: 'H3DirectorApp',
    props: { node: { type: Object, required: true } },
    setup: function(props) {
        var state = loadState(props.node);
        var project = reactive(state.project);
        var scenes = reactive(state.scenes);

        var store = reactive({
            project: project,
            scenes: scenes,
            currentSceneId: (scenes[0] && scenes[0].id) || 1,
            editorTab: 'script',
            rightTab: 'shots',
            planOpen: true,
            dirty: false
        });

        // 分辨率预设联动（提取宽高写回project）
        function onSizePreset() {
            var val = store.project.sizePreset || '';
            var parts = val.split('|');
            if (parts.length >= 4) {
                store.project.aspect = parts[0];
                store.project.resolution = parts[1];
                store.project.width = parseInt(parts[2]) || 1080;
                store.project.height = parseInt(parts[3]) || 1920;
            }
            markDirty();
        }

        // 初始化时从 preamble + shot.content 同步台词（加载已有工作流时）
        var _initDone = false;
        nextTick(function() {
            if (_initDone) return; _initDone = true;
            extractDialoguesIfNeeded(store.scenes);
        });

        // 供 onConfigure 在 ComfyUI 恢复 widgets_values 后重新加载状态
        function reloadFromWidget() {
            try {
                var w = (props.node.widgets || []).find(function(x) { return x.name === 'h3_state'; });
                if (w && w.value && w.value !== '{}') {
                    var data = JSON.parse(w.value);
                    applyStateToReactive(project, scenes, store, data);
                }
            } catch(e) { console.warn('[EagleH3Director] reloadFromWidget error:', e); }
        }
        props.node._h3ReloadState = reloadFromWidget;

        var flashMsg = ref('');
        var flashTimer = null;
        function flash(msg) {
            flashMsg.value = msg;
            if (flashTimer) clearTimeout(flashTimer);
            flashTimer = setTimeout(function() { flashMsg.value = ''; }, 2000);
        }

        var currentScene = computed(function() {
            return store.scenes.find(function(s) { return s.id === store.currentSceneId; }) || store.scenes[0] || null;
        });
        var maxId = function(arr) { return arr.reduce(function(m, x) { return Math.max(m, x.id || 0); }, 0); };

        function markDirty() { store.dirty = true; saveState(props.node, project, scenes); }

        // 场景操作
        function addScene() {
            var id = maxId(store.scenes) + 1;
            store.scenes.push(createScene(id));
            store.currentSceneId = id; markDirty();
        }
        function cloneScene(id) {
            var src = store.scenes.find(function(s) { return s.id === id; }); if (!src) return;
            var nid = maxId(store.scenes) + 1;
            var copy = JSON.parse(JSON.stringify(src)); copy.id = nid;
            store.scenes.splice(store.scenes.findIndex(function(s) { return s.id === id; }) + 1, 0, copy);
            store.currentSceneId = nid; markDirty();
        }
        function removeScene(id) {
            if (store.scenes.length <= 1) { flash('至少保留一个场景'); return; }
            var idx = store.scenes.findIndex(function(s) { return s.id === id; });
            store.scenes.splice(idx, 1);
            if (store.currentSceneId === id) store.currentSceneId = store.scenes[0].id;
            markDirty();
        }
        function selectScene(id) { store.currentSceneId = id; }
        function prevScene() {
            var idx = store.scenes.findIndex(function(s) { return s.id === store.currentSceneId; });
            if (idx > 0) store.currentSceneId = store.scenes[idx - 1].id;
        }
        function nextScene() {
            var idx = store.scenes.findIndex(function(s) { return s.id === store.currentSceneId; });
            if (idx >= 0 && idx < store.scenes.length - 1) store.currentSceneId = store.scenes[idx + 1].id;
        }

        // 镜头操作
        function addShot() {
            var s = currentScene.value; if (!s) return;
            var prev = s.shots[s.shots.length - 1];
            var sh = createShot(maxId(s.shots) + 1);
            if (prev) sh.time = fmtTime(parseFloat(prev.time.replace(':','.').replace('.','m').replace('.','s')) + (prev.estSeconds || 2.5));
            s.shots.push(sh); markDirty();
        }
        function removeShot(id) {
            var s = currentScene.value; if (!s) return;
            s.shots = s.shots.filter(function(x) { return x.id !== id; }); markDirty();
        }
        function autoAssignTimes() {
            var s = currentScene.value; if (!s || !s.shots.length) return;
            var per = (s.defaultSeconds || 10) / s.shots.length;
            var t = 0;
            s.shots.forEach(function(sh) { sh.time = fmtTime(t); sh.estSeconds = +per.toFixed(2); t += per; });
            markDirty(); flash('已自动分配时间');
        }

        // 台词操作
        function addDialogue() {
            var s = currentScene.value; if (!s) return;
            s.dialogues.push(createDialogue(maxId(s.dialogues) + 1)); markDirty();
        }
        function removeDialogue(id) {
            var s = currentScene.value; if (!s) return;
            s.dialogues = s.dialogues.filter(function(x) { return x.id !== id; }); markDirty();
        }

        // 双向同步守卫
        var syncPaused = false; var lastSrc = 'dialogue';
        function syncDlgToPreamble(sc) {
            if (syncPaused && lastSrc !== 'dialogue') return;
            var text = (sc.preamble || '').replace(/<d>[\s\S]*?<\/d>/g,'').replace(/\n{3,}/g,'\n\n').trim();
            var dlg = (sc.dialogues || []).filter(function(d) { return d.role && d.text; })
                .map(function(d) { return '  ' + buildDTag(d.role, d.text); });
            sc.preamble = (text + (dlg.length ? '\n\nDialogue:\n' + dlg.join('\n') : '')).trim();
        }
        function syncPreambleToDlg(sc) {
            if (syncPaused && lastSrc !== 'full') return;
            var parsed = parseDialogues(sc.preamble || '');
            parsed.forEach(function(d, i) {
                var ex = sc.dialogues[i];
                if (ex) { d.id = ex.id; d.time = ex.time; } else { d.id = maxId(sc.dialogues) + i + 1; }
            });
            sc.dialogues.splice(0, sc.dialogues.length);
            parsed.forEach(function(d) { sc.dialogues.push(d); });
        }
        function onDialogueInput() {
            var s = currentScene.value; if (!s) return;
            lastSrc = 'dialogue'; syncPaused = true;
            nextTick(function() { syncDlgToPreamble(s); syncPaused = false; markDirty(); });
        }
        var preambleTimer = null;
        function onPreambleInput() {
            var s = currentScene.value; if (!s) return;
            lastSrc = 'full'; syncPaused = true; markDirty();
            clearTimeout(preambleTimer);
            preambleTimer = setTimeout(function() { syncPreambleToDlg(s); syncPaused = false; }, 600);
        }

        // 参考图上传
        var fileInput = ref(null);
        var pendingRefIdx = ref(-1);
        function triggerUpload(i) { pendingRefIdx.value = i; if (fileInput.value) fileInput.value.click(); }
        function onFileChange(e) {
            var file = e.target && e.target.files && e.target.files[0];
            if (!file || pendingRefIdx.value < 0) return;
            var fd = new FormData(); fd.append('file', file);
            var i = pendingRefIdx.value;
            fetch('/h3_director/upload_ref', { method: 'POST', body: fd })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success && data.filename) {
                        store.project.refs[i].filename = data.filename;
                        store.project.refs[i].url = '/h3_director/ref_proxy?filename=' + encodeURIComponent(data.filename);
                        markDirty();
                    } else { flash('上传失败: ' + (data.error || '未知')); }
                }).catch(function(err) { flash('上传失败: ' + err); });
            e.target.value = ''; pendingRefIdx.value = -1;
        }
        function clearRef(i) {
            var oldName = store.project.refs[i].filename;
            store.project.refs[i].filename = ''; store.project.refs[i].url = '';
            if (oldName) fetch('/h3_director/media?filename=' + encodeURIComponent(oldName), { method:'DELETE' }).catch(function(){});
            markDirty();
        }
        function addRef() {
            store.project.refs.push(createRef());
            markDirty(); flash('已增加参考槽，现有 ' + store.project.refs.length + ' 个');
        }
        function removeLastRef() {
            if (store.project.refs.length <= 9) return;
            var last = store.project.refs[store.project.refs.length - 1];
            if (last && last.filename) { flash('末槽有图，请先移除图片再缩减'); return; }
            store.project.refs.pop(); markDirty();
        }
        function onRefDrop(e, i) {
            var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (!file || !file.type.startsWith('image/')) return;
            var fd = new FormData(); fd.append('file', file);
            fetch('/h3_director/upload_ref', { method: 'POST', body: fd })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success && data.filename) {
                        // 如果目标槽有图，插入而不是覆盖
                        if (store.project.refs[i] && store.project.refs[i].filename) {
                            store.project.refs.splice(i, 0, createRef());
                        }
                        store.project.refs[i].filename = data.filename;
                        store.project.refs[i].url = '/h3_director/ref_proxy?filename=' + encodeURIComponent(data.filename);
                        markDirty();
                    } else { flash('上传失败: ' + (data.error || '未知')); }
                }).catch(function(err) { flash('上传失败: ' + err); });
        }

        // 编译预览（按 scene 分页：每个场景一页）
        var previewPages = computed(function() {
            if (!store.scenes.length) return [''];
            return store.scenes.map(function(s) { return compilePrompt(store.project, s); });
        });
        var sceneIndex = computed(function() {
            var idx = store.scenes.findIndex(function(s) { return s.id === store.currentSceneId; });
            return idx < 0 ? 0 : idx;
        });
        var currentPreviewPage = computed(function() {
            return previewPages.value[sceneIndex.value] || '';
        });
        var wordCount = computed(function() { return currentPreviewPage.value.replace(/\s+/g,'').length; });
        var warnings = computed(function() {
            var w = [];
            if (!(store.project.foundation || '').trim()) w.push('世界构建基础为空，建议补充世界观/视觉风格/角色。');
            var sc = currentScene.value;
            if (!sc || !sc.shots || !sc.shots.length) w.push('当前场景没有镜头。');
            if (!sc || !(sc.dialogues || []).length) w.push('当前场景没有台词。');
            if (['i2v','fl2v','r2v','rv2v'].indexOf(store.project.mode) !== -1) {
                var usedRefs = (store.project.mediaRefs || []).filter(function(r) { return r.type === 'image' && r.filename; }).length;
                if (!usedRefs) w.push('该模式通常需要参考图。');
            }
            return w;
        });

        function copyCompiled() {
            navigator.clipboard && navigator.clipboard.writeText(currentPreviewPage.value);
            flash('已复制当前场景编译提示词');
        }
        function copyParams() {
            var p = JSON.stringify({ mode: store.project.mode, aspect: store.project.aspect, resolution: store.project.resolution, fps: store.project.fps, scenes: store.scenes.length }, null, 2);
            navigator.clipboard && navigator.clipboard.writeText(p);
            flash('已复制参数');
        }

        var totalDuration = computed(function() {
            return store.scenes.reduce(function(a, s) { return a + (s.defaultSeconds || 10) * Math.max(1, (s.shots || []).length); }, 0);
        });

        // ── 导演 Skill：手动「生成」按钮 ──
        function generateSkill() {
            var sk = store.project.skill || {};
            var tasks = sk.tasks || [];
            if (!tasks.length) { flash('请先在「导演 Skill」选择要生成的任务（台本 / 分镜 / 台词）'); return; }
            var w = (props.node.widgets || []).find(function(x) { return x.name === 'skill_request'; });
            if (!w) { flash('skill_request 端口缺失，请重启 ComfyUI 后重试'); return; }
            var req = {
                run: true,
                sceneId: store.currentSceneId,
                mergeMode: sk.mergeMode || 'overwrite',
                tasks: tasks,
                temperature: (sk.temperature != null ? sk.temperature : 0.7),
                modelPref: sk.modelPref || 'local',
                profile: sk.profile || 'balanced',
                skillPolicy: sk.skillPolicy || 'merge',
                hint: sk.hint || ''
            };
            w.value = JSON.stringify(req);
            if (typeof w.callback === 'function') w.callback(w.value, w, props.node);
            if (props.node.graph) props.node.graph.change();
            flash('已提交生成请求，等待模型返回…（手动触发生成）');
            try { app.queuePrompt(); }
            catch (err) { flash('队列失败: ' + (err && err.message ? err.message : err)); }
        }

        // 后端生成结果回填（由 app.api 事件触发）
        function clearSkillRequest() {
            var w = (props.node.widgets || []).find(function(x) { return x.name === 'skill_request'; });
            if (w && w.value) {
                w.value = '';
                if (typeof w.callback === 'function') w.callback(w.value, w, props.node);
                if (props.node.graph) props.node.graph.change();
            }
        }
        function applySkillResult(data) {
            if (!data) return;
            if (data.error) { flash('生成出错: ' + data.error); clearSkillRequest(); return; }
            var scene = store.scenes.find(function(s) { return s.id === data.sceneId; }) || currentScene.value;
            if (!scene) { flash('未找到目标场景'); clearSkillRequest(); return; }
            var mode = (store.project.skill && store.project.skill.mergeMode) || 'overwrite';
            if (data.preamble != null) {
                scene.preamble = (mode === 'append' && scene.preamble)
                    ? (scene.preamble + '\n\n' + data.preamble).trim()
                    : data.preamble;
            }
            if (data.dialogues != null) {
                var baseD = (mode === 'append') ? (scene.dialogues || []).slice() : [];
                var mid = baseD.reduce(function(m, d) { return Math.max(m, d.id || 0); }, 0);
                data.dialogues.forEach(function(d, i) {
                    if (d && d.role && d.text) {
                        baseD.push({ id: mid + i + 1, role: d.role, text: d.text, time: d.time || '' });
                    }
                });
                scene.dialogues = baseD;
            }
            if (data.shots != null) {
                var baseS = (mode === 'append') ? (scene.shots || []).slice() : [];
                var sid = baseS.reduce(function(m, s) { return Math.max(m, s.id || 0); }, 0);
                data.shots.forEach(function(s, i) {
                    if (!s || !s.content) return;
                    baseS.push({
                        id: sid + i + 1,
                        title: s.title || '',
                        time: s.time || '00:00.000',
                        framing: s.framing || '',
                        content: s.content || '',
                        camera: s.camera || '',
                        lens: s.lens || '',
                        intent: s.intent || '',
                        action: s.action || '',
                        sound: s.sound || '',
                        transitionIn: s.transitionIn || '',
                        transitionOut: s.transitionOut || '',
                        estSeconds: (s.estSeconds != null ? Number(s.estSeconds) : 2.5)
                    });
                });
                scene.shots = baseS;
            }
            // 若只生成台本，从其 <d> 标签同步台词列表
            if (data.preamble != null && data.dialogues == null) {
                syncPreambleToDlg(scene);
            }
            markDirty();
            clearSkillRequest();
            flash('✓ 已回填（' + (data.transport === 'local' ? '本地模型' : 'API') + '）');
        }
        props.node._h3ApplySkillResult = applySkillResult;

        // provide
        provide('h3store', store);
        provide('h3flash', flash);
        provide('h3preview', { pages: previewPages, sceneIndex: sceneIndex, currentPage: currentPreviewPage, wordCount: wordCount, warnings: warnings, copyCompiled: copyCompiled });
        provide('h3actions', {
            addScene: addScene, cloneScene: cloneScene, removeScene: removeScene, selectScene: selectScene, prevScene: prevScene, nextScene: nextScene,
            addShot: addShot, removeShot: removeShot, autoAssignTimes: autoAssignTimes,
            addDialogue: addDialogue, removeDialogue: removeDialogue,
            onDialogueInput: onDialogueInput, onPreambleInput: onPreambleInput,
            triggerUpload: triggerUpload, clearRef: clearRef, addRef: addRef,
            removeLastRef: removeLastRef, onRefDrop: onRefDrop,
            generateSkill: generateSkill,
            markDirty: markDirty, flash: flash, copyCompiled: copyCompiled, copyParams: copyParams
        });

        return { store: store, flashMsg: flashMsg, currentScene: currentScene, totalDuration: totalDuration, fileInput: fileInput, onFileChange: onFileChange, copyCompiled: copyCompiled, copyParams: copyParams, onSizePreset: onSizePreset };
    },
    template: `
<div class="h3d-root">
  <div style="display:flex;gap:8px;align-items:center;padding:5px 12px;background:var(--h3d-bg2);border-bottom:1px solid var(--h3d-bd);font-size:11px">
    <span style="color:var(--h3d-muted)">导演风格</span>
    <select class="h3d-sel" v-model="store.project.skill.profile" style="width:auto">
      <option value="balanced">均衡覆盖</option>
      <option value="cinematic">电影化调度</option>
      <option value="dynamic">动态动作</option>
      <option value="intimate">亲密表演</option>
      <option value="commercial">商业 / 产品</option>
    </select>
    <span style="color:var(--h3d-muted);margin-left:auto">外接技能</span>
    <select class="h3d-sel" v-model="store.project.skill.skillPolicy" style="width:auto">
      <option value="merge">与内置合并</option>
      <option value="external_only">仅外接技能</option>
      <option value="internal_only">仅内置风格</option>
    </select>
  </div>
  <div class="h3d-topbar">
    <h1>🦅 H3 Director <span class="h3d-badge">v1</span></h1>
    <div class="h3d-field"><label>任务</label>
      <select class="h3d-sel" v-model="store.project.mode">
        <option value="t2v">t2v 文生视频</option><option value="i2v">i2v 图生视频</option>
        <option value="fl2v">fl2v 首末帧</option><option value="r2v">r2v 角色一致</option>
        <option value="rv2v">rv2v 角色+视频</option><option value="v2v">v2v 视频重绘</option>
      </select>
    </div>
    <div class="h3d-field"><label>尺寸</label>
      <select class="h3d-sel" v-model="store.project.sizePreset" @change="onSizePreset">
        <optgroup label="9:16 竖屏">
          <option value="9:16|mp0.2|608|1080">9:16 · 0.2MP (608×1080)</option>
          <option value="9:16|mp0.3|736|1312">9:16 · 0.3MP (736×1312)</option>
          <option value="9:16|mp0.5|960|1704">9:16 · 0.5MP (960×1704)</option>
          <option value="9:16|mp0.7|1152|2048">9:16 · 0.7MP (1152×2048)</option>
          <option value="9:16|mp1.0|1080|1920">9:16 · 1.0MP (1080×1920)</option>
          <option value="9:16|mp1.5|1184|2112">9:16 · 1.5MP (1184×2112)</option>
        </optgroup>
        <optgroup label="16:9 横屏">
          <option value="16:9|mp0.2|608|352">16:9 · 0.2MP (608×352)</option>
          <option value="16:9|mp0.5|960|544">16:9 · 0.5MP (960×544)</option>
          <option value="16:9|mp0.8|1216|672">16:9 · 0.8MP (1216×672)</option>
          <option value="16:9|mp1.0|1376|768">16:9 · 1.0MP (1376×768)</option>
          <option value="16:9|mp2.0|1920|1088">16:9 · 2.0MP (1920×1088)</option>
        </optgroup>
        <optgroup label="1:1 方形">
          <option value="1:1|mp0.5|720|720">1:1 · 0.5MP (720×720)</option>
          <option value="1:1|mp1.0|1024|1024">1:1 · 1.0MP (1024×1024)</option>
        </optgroup>
      </select>
    </div>
    <div class="h3d-field"><label>fps</label><input class="h3d-inp sm" type="number" min="8" max="60" v-model.number="store.project.fps" style="width:46px"></div>
    <span class="h3d-pill">{{ store.scenes.length }} scenes · {{ totalDuration.toFixed(1) }}s</span>
    <div class="h3d-spacer"></div>
    <span class="h3d-sync" :class="store.dirty?'dirty':''">{{ store.dirty ? '⚠ 待同步' : '✓ 已保存' }}</span>
    <button class="h3d-btn" @click="copyParams">📤 参数</button>
    <button class="h3d-btn primary" @click="copyCompiled">📋 复制提示词</button>
  </div>
  <div class="h3d-body">
    <plan-panel style="flex:0 0 300px"></plan-panel>
    <editor-panel style="flex:1;min-width:0"></editor-panel>
    <right-panel style="flex:0 0 340px"></right-panel>
  </div>
  <div class="h3d-statusbar">
    <span v-if="flashMsg" style="color:var(--h3d-primary)">{{ flashMsg }}</span>
    <span>Scene {{ store.scenes.findIndex(s=>s.id===store.currentSceneId)+1 }}/{{ store.scenes.length }}</span>
    <span>{{ store.project.aspect }} {{ store.project.resolution }}</span>
  </div>
  <input type="file" ref="fileInput" style="display:none" accept="image/*" @change="onFileChange">
</div>`
});

// ─────────────────────────────────────────────────────────────────
// HighlightTextarea（标签高亮编辑框）
// ─────────────────────────────────────────────────────────────────
var HighlightTextarea = defineComponent({
    name: 'HighlightTextarea',
    props: {
        modelValue: { type: String, default: '' },
        placeholder: { type: String, default: '' },
        minHeight: { type: String, default: '' },
        flex: { type: Boolean, default: false },
        mediaItems: { type: Array, default: function() { return []; } }
    },
    emits: ['update:modelValue', 'input'],
    setup: function(props, ctx) {
        var ta = ref(null);
        var layer = ref(null);
        var text = computed({
            get: function() { return props.modelValue || ''; },
            set: function(v) { ctx.emit('update:modelValue', v); ctx.emit('input', v); }
        });
        function syncScroll() {
            if (!ta.value || !layer.value) return;
            layer.value.style.top = (-ta.value.scrollTop) + 'px';
            layer.value.style.left = (-ta.value.scrollLeft) + 'px';
        }
        function onInput() { nextTick(syncScroll); }
        function insertText(value) {
            if (!ta.value) return;
            var start = ta.value.selectionStart == null ? text.value.length : ta.value.selectionStart;
            var end = ta.value.selectionEnd == null ? start : ta.value.selectionEnd;
            var before = text.value.slice(0, start);
            var after = text.value.slice(end);
            var leftSpace = before && !/\s$/.test(before) ? ' ' : '';
            var rightSpace = after && !/^\s/.test(after) ? ' ' : '';
            text.value = before + leftSpace + value + rightSpace + after;
            var caret = start + leftSpace.length + value.length + rightSpace.length;
            nextTick(function() {
                ta.value.focus();
                ta.value.setSelectionRange(caret, caret);
                syncScroll();
            });
        }
        ctx.expose({ insertText: insertText, focus: function() { if (ta.value) ta.value.focus(); } });
        var html = computed(function() { return highlightText(text.value, props.mediaItems); });
        var wrapStyle = computed(function() {
            var s = {};
            if (props.minHeight) s.minHeight = props.minHeight;
            if (props.flex) s.flex = '1';
            return s;
        });
        return { text: text, html: html, ta: ta, layer: layer, syncScroll: syncScroll, onInput: onInput, wrapStyle: wrapStyle };
    },
    template: `
<div class="h3d-hl-wrap" :style="wrapStyle">
  <div class="h3d-hl-layer" ref="layer">
    <div v-if="!text" class="h3d-hl-placeholder">{{ placeholder }}</div>
    <div v-html="html"></div>
  </div>
  <textarea class="h3d-hl-textarea" ref="ta" v-model="text" :placeholder="placeholder" @scroll="syncScroll" @input="onInput" @keydown.stop @paste.stop spellcheck="false"></textarea>
</div>`
});

// ─────────────────────────────────────────────────────────────────
// PlanPanel（左栏）
// ─────────────────────────────────────────────────────────────────
var PlanPanel = defineComponent({
    name: 'PlanPanel',
    setup: function() {
        var store = inject('h3store');
        var actions = inject('h3actions');
        var planOpen = ref(true);

        function sceneDuration(s) {
            return (s.defaultSeconds || 10) * Math.max(1, (s.shots || []).length);
        }
        function timeBarPct(s) {
            var d = sceneDuration(s);
            var cap = (store.project.globalDuration || 7) * Math.max(1, (s.shots || []).length);
            return Math.min(100, Math.round(d / cap * 100));
        }
        function estTokens(s) {
            var txt = (s.preamble || '') + (s.shots || []).map(function(x) { return x.content || ''; }).join(' ');
            return Math.round(txt.length / 3.2);
        }
        var totalDuration = computed(function() {
            return (store.scenes || []).reduce(function(a, s) { return a + sceneDuration(s); }, 0);
        });
        return { store: store, actions: actions, planOpen: planOpen, sceneDuration: sceneDuration, timeBarPct: timeBarPct, estTokens: estTokens, totalDuration: totalDuration };
    },
    template: `
<div class="h3d-col" style="display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--h3d-bd)">
  <div class="h3d-col-hd">🎬 Plan · 规划</div>
  <div class="h3d-col-body">
    <div class="h3d-card">
      <div class="h3d-card-title" style="margin-bottom:6px">🌐 Shared prompt · 世界构建 & 风格基础</div>
      <div class="h3d-hint" style="margin-bottom:6px">自动 prepend 到每个场景的 integrated_multimodal_description，作为全局共享提示。</div>
      <textarea class="h3d-textarea" style="min-height:80px" v-model="store.project.foundation" placeholder="integrated_multimodal_description:\nHigh quality original 2D anime...\nWorldview: ...&#10;Visual style: ...&#10;Character base: ..."></textarea>
    </div>
    <div class="h3d-card">
      <div class="h3d-collapse-hd" :class="{open:planOpen}" @click="planOpen=!planOpen">
        <span class="arr">▶</span> <span>全局参数</span>
      </div>
      <div v-show="planOpen" style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">context_length</span><input class="h3d-inp" v-model.number="store.project.contextLength" type="number" style="width:70px"></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">encode_mode</span><select class="h3d-sel" v-model="store.project.encodeMode"><option>video</option><option>image</option></select></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">anchor_mode</span><select class="h3d-sel" v-model="store.project.anchorMode"><option>head</option><option>frame</option><option>tail</option></select></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">crop</span><select class="h3d-sel" v-model="store.project.crop"><option value="disabled">disabled</option><option value="center">center</option></select></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">audio_mode</span><select class="h3d-sel" v-model="store.project.audioMode"><option value="generated_audio">generated_audio</option><option value="off">off</option></select></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">music_context_length</span><input class="h3d-inp" v-model.number="store.project.audioContextLength" type="number" style="width:70px"></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">default_duration_seconds</span><input class="h3d-inp" v-model.number="store.project.globalDuration" type="number" step="0.5" style="width:70px"></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">default_steps</span><input class="h3d-inp" v-model.number="store.project.globalSteps" type="number" style="width:70px"></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">base_seed</span><input class="h3d-inp" v-model.number="store.project.baseSeed" type="number" style="width:70px"></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">segment_crf</span><input class="h3d-inp" v-model.number="store.project.segmentCrf" type="number" style="width:70px"></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">ref_max_megapixels</span><input class="h3d-inp" v-model.number="store.project.refMaxMegapixels" type="number" step="0.1" min="0.1" max="10" style="width:70px"></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">continuation</span><select class="h3d-sel" v-model="store.project.continuationMode"><option value="guide">guide</option><option value="strict">strict</option><option value="free">free</option></select></div>
      </div>
    </div>
    <div class="h3d-card">
      <div class="h3d-card-title">
        <span>🎞️ 场景 ({{ store.scenes.length }})</span>
        <button class="h3d-btn sm primary" @click="actions.addScene">+ 场景</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div v-for="(s,i) in store.scenes" :key="s.id" class="h3d-scene" :class="{active:store.currentSceneId===s.id}" @click="actions.selectScene(s.id)">
          <div class="ttl">
            <span>S{{ i+1 }} · {{ s.title || '未命名' }}</span>
            <span>
              <button class="h3d-btn sm" @click.stop="actions.cloneScene(s.id)" title="复制">⧉</button>
              <button class="h3d-btn sm danger" @click.stop="actions.removeScene(s.id)" title="删除">×</button>
            </span>
          </div>
          <div class="h3d-row" style="margin-top:4px;gap:6px">
            <span class="h3d-mini">默认</span><input class="h3d-inp sm" type="number" v-model.number="s.defaultSeconds" min="1" max="30" style="width:44px" @click.stop>
            <span class="h3d-mini">s</span>
          </div>
          <div class="h3d-bar" :class="{over: sceneDuration(s) > (store.project.globalDuration||7)*(s.shots||[]).length}">
            <i :style="{width:timeBarPct(s)+'%'}"></i>
          </div>
          <div class="h3d-mini" style="margin-top:3px">{{ sceneDuration(s) }}s · {{ estTokens(s) }} tok · {{ (s.shots||[]).length }}镜 · {{ (s.dialogues||[]).length }}句</div>
        </div>
      </div>
      <div class="h3d-pill" style="margin-top:8px;display:block;text-align:center">合计 {{ totalDuration.toFixed(1) }}s</div>
    </div>
  </div>
</div>`
});

// ─────────────────────────────────────────────────────────────────
// EditorPanel（中栏）
// ─────────────────────────────────────────────────────────────────
var EditorPanel = defineComponent({
    name: 'EditorPanel',
    components: { HighlightTextarea: HighlightTextarea },
    setup: function() {
        var store = inject('h3store');
        var actions = inject('h3actions');
        var scene = computed(function() {
            return store.scenes.find(function(s) { return s.id === store.currentSceneId; }) || null;
        });
        var tabs = [
            { key: 'script', label: '📝 台本' },
            { key: 'dialogue', label: '💬 台词' },
            { key: 'ref', label: '🖼️ 参考' },
            { key: 'shot', label: '🎬 分镜' },
            { key: 'generate', label: '🎬 生成' }
        ];
        var scriptEditor = ref(null);
        var mediaFileInput = ref(null);
        var trimPlayer = ref(null);
        var dragIndex = ref(-1);
        var trimOpen = ref(false);
        var trimDraft = reactive({ id:'', type:'', filename:'', originalName:'', url:'', duration:0, start:0, end:0 });
        var mediaItems = computed(function() { return store.project.mediaRefs || []; });

        function formatDuration(value) {
            value = Math.max(0, Number(value) || 0);
            var minutes = Math.floor(value / 60);
            var seconds = value - minutes * 60;
            return minutes ? (minutes + ':' + seconds.toFixed(1).padStart(4, '0')) : (seconds.toFixed(1) + 's');
        }
        function selectedDuration(item) {
            if (!item || item.type === 'image') return 0;
            var end = Number(item.trimEnd) || Number(item.duration) || 0;
            return Math.max(0, end - (Number(item.trimStart) || 0));
        }
        function insertMedia(item) {
            var tag = mediaTagFor(item, mediaItems.value);
            if (!tag || !scriptEditor.value || !scriptEditor.value.insertText) return;
            scriptEditor.value.insertText(tag);
            actions.flash('已插入 ' + tag);
        }
        function openMediaPicker() { if (mediaFileInput.value) mediaFileInput.value.click(); }
        function inferFileType(file) {
            var mime = (file.type || '').toLowerCase();
            if (mime.indexOf('image/') === 0) return 'image';
            if (mime.indexOf('video/') === 0) return 'video';
            if (mime.indexOf('audio/') === 0) return 'audio';
            var ext = (file.name || '').split('.').pop().toLowerCase();
            if (['png','jpg','jpeg','webp','bmp','gif'].indexOf(ext) >= 0) return 'image';
            if (['mp4','webm','mov','mkv','avi','m4v'].indexOf(ext) >= 0) return 'video';
            if (['wav','mp3','flac','ogg','m4a','aac','opus'].indexOf(ext) >= 0) return 'audio';
            return '';
        }
        function withinLimit(type) {
            var max = type === 'image' ? 9 : 3;
            return mediaItems.value.filter(function(item) { return item.type === type; }).length < max;
        }
        function uploadOne(file) {
            var type = inferFileType(file);
            if (!type) { actions.flash('不支持的素材格式: ' + file.name); return Promise.resolve(); }
            if (!withinLimit(type)) { actions.flash(type === 'image' ? '图片最多 9 张' : (type === 'video' ? '视频最多 3 个' : '音频最多 3 个')); return Promise.resolve(); }
            var fd = new FormData(); fd.append('file', file);
            return fetch('/h3_director/upload_media', { method:'POST', body:fd })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!data.success || !data.item) throw new Error(data.error || '上传失败');
                    store.project.mediaRefs.push(createMediaRef(data.item));
                    actions.markDirty();
                }).catch(function(err) { actions.flash('上传失败: ' + (err.message || err)); });
        }
        function uploadFiles(files) {
            var queue = Promise.resolve();
            Array.from(files || []).forEach(function(file) { queue = queue.then(function() { return uploadOne(file); }); });
            return queue.then(function() { if ((files || []).length) actions.flash('素材已添加'); });
        }
        function onMediaFiles(e) {
            uploadFiles(e.target && e.target.files);
            if (e.target) e.target.value = '';
        }
        function onMediaWheel(e) {
            if (e.deltaY) { e.preventDefault(); e.currentTarget.scrollLeft += e.deltaY; }
        }
        function onExternalDrop(e) {
            var files = e.dataTransfer && e.dataTransfer.files;
            if (files && files.length) uploadFiles(files);
        }
        function onDragStart(e, index) {
            dragIndex.value = index;
            if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(index)); }
        }
        function moveMedia(from, to) {
            if (from < 0 || to < 0 || from === to || from >= mediaItems.value.length || to >= mediaItems.value.length) return;
            var before = mediaNumberMap(mediaItems.value);
            var moved = store.project.mediaRefs.splice(from, 1)[0];
            store.project.mediaRefs.splice(to, 0, moved);
            var after = mediaNumberMap(mediaItems.value);
            store.scenes.forEach(function(sc) { sc.preamble = rewriteMediaTags(sc.preamble, before, after, ''); });
            dragIndex.value = -1;
            actions.markDirty();
        }
        function onDropAt(e, index) {
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { onExternalDrop(e); return; }
            var from = dragIndex.value;
            if (from < 0 && e.dataTransfer) from = parseInt(e.dataTransfer.getData('text/plain'), 10);
            moveMedia(from, index);
        }
        function removeMedia(item) {
            var index = mediaItems.value.findIndex(function(x) { return x.id === item.id; });
            if (index < 0) return;
            var before = mediaNumberMap(mediaItems.value);
            store.project.mediaRefs.splice(index, 1);
            var after = mediaNumberMap(mediaItems.value);
            store.scenes.forEach(function(sc) { sc.preamble = rewriteMediaTags(sc.preamble, before, after, item.id); });
            if (item.filename) fetch('/h3_director/media?filename=' + encodeURIComponent(item.filename), { method:'DELETE' }).catch(function(){});
            actions.markDirty();
        }
        function onLoadedMetadata(e, item) {
            var duration = Number(e.target && e.target.duration) || 0;
            if (duration > 0 && (!item.duration || !item.trimEnd)) {
                item.duration = duration; item.trimEnd = duration; actions.markDirty();
            }
        }
        function openTrim(item) {
            if (!item || item.type === 'image') return;
            var duration = Math.max(0, Number(item.duration) || 0);
            Object.assign(trimDraft, {
                id:item.id, type:item.type, filename:item.filename, originalName:item.originalName,
                url:item.url || ('/h3_director/media?filename=' + encodeURIComponent(item.filename)),
                duration:duration, start:Math.max(0, Number(item.trimStart) || 0),
                end:Number(item.trimEnd) > 0 ? Number(item.trimEnd) : duration
            });
            trimOpen.value = true;
        }
        function clampTrim(which) {
            var minGap = Math.min(0.05, trimDraft.duration || 0.05);
            trimDraft.start = Math.max(0, Math.min(Number(trimDraft.start) || 0, Math.max(0, trimDraft.end - minGap)));
            trimDraft.end = Math.min(trimDraft.duration, Math.max(Number(trimDraft.end) || 0, trimDraft.start + minGap));
            if (which === 'start' && trimPlayer.value) trimPlayer.value.currentTime = trimDraft.start;
        }
        function resetTrim() { trimDraft.start = 0; trimDraft.end = trimDraft.duration; }
        function previewTrim() {
            if (!trimPlayer.value) return;
            trimPlayer.value.currentTime = trimDraft.start;
            var promise = trimPlayer.value.play();
            if (promise && promise.catch) promise.catch(function() {});
        }
        function onTrimTime() {
            if (trimPlayer.value && trimPlayer.value.currentTime >= trimDraft.end) trimPlayer.value.pause();
        }
        function saveTrim() {
            var item = mediaItems.value.find(function(x) { return x.id === trimDraft.id; });
            if (item) { item.trimStart = trimDraft.start; item.trimEnd = trimDraft.end; actions.markDirty(); }
            trimOpen.value = false;
        }
        function closeTrim() { if (trimPlayer.value) trimPlayer.value.pause(); trimOpen.value = false; }

        return {
            store:store, actions:actions, scene:scene, tabs:tabs, mediaItems:mediaItems,
            scriptEditor:scriptEditor, mediaFileInput:mediaFileInput, trimPlayer:trimPlayer,
            dragIndex:dragIndex, trimOpen:trimOpen, trimDraft:trimDraft,
            formatDuration:formatDuration, selectedDuration:selectedDuration, mediaTagFor:mediaTagFor,
            insertMedia:insertMedia, openMediaPicker:openMediaPicker, onMediaFiles:onMediaFiles,
            onMediaWheel:onMediaWheel, onExternalDrop:onExternalDrop, onDragStart:onDragStart,
            onDropAt:onDropAt, removeMedia:removeMedia, onLoadedMetadata:onLoadedMetadata,
            openTrim:openTrim, clampTrim:clampTrim, resetTrim:resetTrim, previewTrim:previewTrim,
            onTrimTime:onTrimTime, saveTrim:saveTrim, closeTrim:closeTrim
        };
    },
    template: `
<div class="h3d-col" style="display:flex;flex-direction:column;min-height:0;flex:1;position:relative">
  <div class="h3d-col-hd">
    <span>✎ Editor · 场景编辑</span>
    <span class="h3d-mini" v-if="scene">{{ store.scenes.findIndex(s=>s.id===store.currentSceneId)+1 }}/{{ store.scenes.length }}</span>
  </div>
  <div class="h3d-col-body">
    <div v-if="!scene" class="h3d-empty">请先在左侧选择或创建场景</div>
    <template v-else>
      <div class="h3d-row" style="margin-bottom:4px;flex-shrink:0">
        <label class="h3d-label" style="margin:0;min-width:48px">场景名</label>
        <input class="h3d-inp" v-model="scene.title" placeholder="如：山道夜雨独行">
      </div>
      <div class="h3d-tabs" style="flex-shrink:0">
        <button v-for="t in tabs" :key="t.key" class="h3d-tab" :class="{active:store.editorTab===t.key}" @click="store.editorTab=t.key">{{ t.label }}</button>
      </div>

      <div class="h3d-scroll-box">
        <!-- 台本 -->
        <div v-show="store.editorTab==='script'" style="display:flex;flex-direction:column;gap:6px;flex:1;min-height:0">
          <div class="h3d-hint">点击素材插入 &lt;Picture N&gt;、&lt;Video N&gt; 或 &lt;Audio N&gt;；拖拽卡片可手动调整位置。</div>
          <div class="h3d-media-strip" @wheel="onMediaWheel" @dragover.prevent @drop.prevent="onExternalDrop">
            <div v-for="(item,i) in mediaItems" :key="item.id" class="h3d-media-card"
                 :class="{dragging:dragIndex===i}" draggable="true"
                 @dragstart="onDragStart($event,i)" @dragend="dragIndex=-1"
                 @dragover.prevent @drop.stop.prevent="onDropAt($event,i)" @click="insertMedia(item)"
                 :title="'点击插入 ' + mediaTagFor(item, mediaItems)">
              <img v-if="item.type==='image'" :src="item.url" alt="">
              <video v-else-if="item.type==='video'" :src="item.url" muted preload="metadata" @loadedmetadata="onLoadedMetadata($event,item)"></video>
              <div v-else class="audio-icon">♪<audio :src="item.url" preload="metadata" style="display:none" @loadedmetadata="onLoadedMetadata($event,item)"></audio></div>
              <span class="media-tag">{{ mediaTagFor(item, mediaItems) }}</span>
              <span v-if="item.type!=='image'" class="media-time">{{ formatDuration(selectedDuration(item)) }}</span>
              <div class="media-actions">
                <button v-if="item.type!=='image'" class="media-action" title="裁剪" @click.stop="openTrim(item)">✂</button>
                <button class="media-action" title="移除" @click.stop="removeMedia(item)">×</button>
              </div>
            </div>
            <button class="h3d-media-add" @click="openMediaPicker" @drop.stop.prevent="onExternalDrop">＋ 添加素材</button>
          </div>
          <input ref="mediaFileInput" type="file" accept="image/*,video/*,audio/*" multiple style="display:none" @change="onMediaFiles">
          <highlight-textarea ref="scriptEditor" v-model="scene.preamble" :media-items="mediaItems" :flex="true" min-height="120px"
                              @input="actions.onPreambleInput" placeholder="自由文本 + [Shot N] 描述..."></highlight-textarea>
        </div>

        <!-- 台词 -->
        <div v-show="store.editorTab==='dialogue'" style="display:flex;flex-direction:column;gap:0">
          <div class="h3d-hint" style="margin-bottom:8px">台词以 <span class="h3d-tag">&lt;d&gt;[角色] 台词&lt;/d&gt;</span> 写入台本，双向同步。</div>
          <div v-for="(d,i) in scene.dialogues" :key="d.id" class="h3d-dlg">
            <div class="h3d-row" style="gap:6px;margin-bottom:5px">
              <input class="h3d-inp sm" style="flex:0 0 80px" v-model="d.role" placeholder="角色" @input="actions.onDialogueInput">
              <input class="h3d-inp sm time" v-model="d.time" placeholder="00:00.000" @input="actions.onDialogueInput">
              <button class="h3d-btn sm danger" @click="actions.removeDialogue(d.id)">×</button>
            </div>
            <textarea class="h3d-textarea" style="min-height:38px" v-model="d.text" placeholder="台词内容（≤30字）" @input="actions.onDialogueInput"></textarea>
            <div class="h3d-mini" style="margin-top:3px" :style="{color:d.text.length>30?'var(--h3d-danger)':''}">{{ d.text.length }} 字{{ d.text.length>30?' ⚠超':''}}</div>
          </div>
          <button class="h3d-btn sm" @click="actions.addDialogue" style="margin-top:4px">+ 台词</button>
        </div>

        <!-- 参考 -->
        <div v-show="store.editorTab==='ref'" style="display:flex;flex-direction:column;gap:8px">
          <div class="h3d-row" style="justify-content:space-between">
            <div class="h3d-hint">与台本上方素材栏共用同一份数据；不自动排序，拖拽卡片可调整位置。图片最多9张，视频/音频各3个。</div>
            <button class="h3d-btn sm primary" @click="openMediaPicker">＋ 添加素材</button>
          </div>
          <div class="h3d-media-dropzone" @click="openMediaPicker" @dragover.prevent @drop.stop.prevent="onExternalDrop">
            <div class="drop-icon">⇩</div>
            <div class="drop-title">将图片、视频或音频拖入这里</div>
            <div class="drop-sub">也可以点击此区域选择文件 · 支持多选</div>
          </div>
          <div v-if="mediaItems.length" class="h3d-media-grid" @dragover.prevent @drop.prevent="onExternalDrop">
            <div v-for="(item,i) in mediaItems" :key="item.id" class="h3d-media-detail" draggable="true"
                 :class="{dragging:dragIndex===i}" @dragstart="onDragStart($event,i)" @dragend="dragIndex=-1"
                 @dragover.prevent @drop.stop.prevent="onDropAt($event,i)">
              <div class="h3d-media-detail-preview">
                <img v-if="item.type==='image'" :src="item.url" alt="">
                <video v-else-if="item.type==='video'" :src="item.url" muted controls preload="metadata" @loadedmetadata="onLoadedMetadata($event,item)"></video>
                <div v-else class="audio-icon">♪<audio :src="item.url" preload="metadata" style="display:none" @loadedmetadata="onLoadedMetadata($event,item)"></audio></div>
                <span class="h3d-tag" style="position:absolute;left:4px;top:4px">{{ mediaTagFor(item, mediaItems) }}</span>
              </div>
              <input class="h3d-inp sm" v-model="item.name" :placeholder="item.originalName || '素材名称'" @input="actions.markDirty" style="width:100%;margin-top:6px">
              <template v-if="item.type==='image'">
                <select class="h3d-sel" v-model="item.kind" @change="actions.markDirty" style="width:100%;margin-top:5px">
                  <option value="person">人物</option><option value="prop">道具</option><option value="style">风格</option>
                  <option value="environment">环境</option><option value="composition">构图</option>
                </select>
                <select class="h3d-sel" v-model="item.retention" @change="actions.markDirty" style="width:100%;margin-top:5px">
                  <option value="fully_preserved">完全保留</option><option value="partially_preserved">部分保留</option><option value="style_only">仅风格</option>
                </select>
              </template>
              <div class="h3d-row" style="margin-top:6px;justify-content:space-between">
                <span class="h3d-mini" v-if="item.type!=='image'">选区 {{ formatDuration(selectedDuration(item)) }}</span><span v-else></span>
                <span style="display:flex;gap:4px">
                  <button v-if="item.type!=='image'" class="h3d-btn sm" @click="openTrim(item)">✂ 裁剪</button>
                  <button class="h3d-btn sm danger" @click="removeMedia(item)">移除</button>
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- 分镜 -->
        <div v-show="store.editorTab==='shot'" style="display:flex;flex-direction:column;gap:0">
          <div class="h3d-row" style="margin-bottom:8px;justify-content:space-between">
            <button class="h3d-btn sm primary" @click="actions.addShot">+ 镜头</button>
            <button class="h3d-btn sm" @click="actions.autoAssignTimes">⏱ 自动分配时间</button>
          </div>
          <div v-for="(sh,i) in scene.shots" :key="sh.id" class="h3d-shot">
            <div class="hd">
              <span class="st">Shot {{ i+1 }}</span>
              <input class="h3d-inp sm" v-model="sh.title" placeholder="标题" style="flex:1;margin:0 6px">
              <span class="tm">@ {{ sh.time }}</span>
              <button class="h3d-btn sm danger" @click="actions.removeShot(sh.id)">×</button>
            </div>
            <div class="h3d-grid2" style="margin-bottom:6px">
              <div class="h3d-row col"><label class="h3d-label">时间码</label><input class="h3d-inp time" v-model="sh.time" placeholder="00:00.000"></div>
              <div class="h3d-row col"><label class="h3d-label">景别</label>
                <select class="h3d-sel" v-model="sh.framing">
                  <option value="">未指定</option>
                  <option>extreme_close_up</option><option>close_up</option>
                  <option>medium_shot</option><option>cowboy_shot</option>
                  <option>full_body</option><option>wide_shot</option>
                </select>
              </div>
            </div>
            <div class="h3d-row col" style="margin-bottom:6px"><label class="h3d-label">画面内容</label><textarea class="h3d-textarea" style="min-height:44px" v-model="sh.content" placeholder="主体/场景/氛围..."></textarea></div>
            <div class="h3d-grid2" style="margin-bottom:6px">
              <div class="h3d-row col"><label class="h3d-label">运镜</label><input class="h3d-inp" v-model="sh.camera" placeholder="slow push in"></div>
              <div class="h3d-row col"><label class="h3d-label">动作</label><input class="h3d-inp" v-model="sh.action" placeholder="turning head"></div>
            </div>
            <div class="h3d-grid2">
              <div class="h3d-row col"><label class="h3d-label">音效</label><input class="h3d-inp" v-model="sh.sound" placeholder="rain, thunder"></div>
              <div class="h3d-row col"><label class="h3d-label">预估秒</label><input class="h3d-inp sm" type="number" step="0.5" v-model.number="sh.estSeconds"></div>
            </div>
          </div>
          <div v-if="!scene.shots.length" class="h3d-empty">暂无镜头，点击添加</div>
        </div>

        <!-- 生成 -->
        <div v-show="store.editorTab==='generate'" style="display:flex;flex-direction:column;gap:8px">
          <div class="h3d-hint">选择任务后点击生成，AI 将按当前场景内容自动产出并回填。</div>
          <div class="h3d-card">
            <div class="h3d-card-title"><span>🎬 导演 Skill · AI 生成</span></div>
            <div style="display:flex;flex-wrap:wrap;gap:8px 12px;margin-bottom:8px;align-items:center">
              <label class="h3d-row" style="gap:4px;cursor:pointer;font-size:11px"><input type="checkbox" value="script" v-model="store.project.skill.tasks"> 台本</label>
              <label class="h3d-row" style="gap:4px;cursor:pointer;font-size:11px"><input type="checkbox" value="shots" v-model="store.project.skill.tasks"> 分镜</label>
              <label class="h3d-row" style="gap:4px;cursor:pointer;font-size:11px"><input type="checkbox" value="dialogue" v-model="store.project.skill.tasks"> 台词</label>
              <div class="h3d-row" style="gap:4px;margin-left:auto"><span class="h3d-label" style="margin:0">temp</span><input class="h3d-inp sm" v-model.number="store.project.skill.temperature" type="number" step="0.1" min="0" max="2" style="width:52px"></div>
            </div>
            <div class="h3d-grid2" style="margin-bottom:8px">
              <div class="h3d-row col"><label class="h3d-label">模型优先级</label>
                <select class="h3d-sel" v-model="store.project.skill.modelPref">
                  <option value="local">本地优先</option><option value="api">API</option>
                </select>
              </div>
              <div class="h3d-row col"><label class="h3d-label">冲突处理</label>
                <select class="h3d-sel" v-model="store.project.skill.mergeMode">
                  <option value="overwrite">覆盖</option><option value="append">追加</option>
                </select>
              </div>
            </div>
            <textarea class="h3d-textarea" style="min-height:60px;margin-bottom:8px" v-model="store.project.skill.hint" placeholder="给模型的额外指令（如：风格偏赛博朋克、主角 Nali 是龙女仆）"></textarea>
            <button class="h3d-btn primary" @click="actions.generateSkill" style="width:100%">🎬 生成（手动）</button>
          </div>
        </div>
      </div>
    </template>
  </div>
  <div v-if="trimOpen" class="h3d-trim-overlay" @click.self="closeTrim">
    <div class="h3d-trim-dialog">
      <div class="h3d-row" style="justify-content:space-between"><b>{{ trimDraft.type==='video' ? '视频裁剪' : '音频裁剪' }}</b><button class="h3d-btn sm" @click="closeTrim">×</button></div>
      <div class="h3d-trim-preview">
        <video v-if="trimDraft.type==='video'" ref="trimPlayer" :src="trimDraft.url" controls @timeupdate="onTrimTime"></video>
        <audio v-else ref="trimPlayer" :src="trimDraft.url" controls @timeupdate="onTrimTime"></audio>
      </div>
      <div class="h3d-trim-ranges"><span>开始</span><input type="range" min="0" :max="trimDraft.duration" step="0.01" v-model.number="trimDraft.start" @input="clampTrim('start')"><b>{{ trimDraft.start.toFixed(2) }}s</b></div>
      <div class="h3d-trim-ranges"><span>结束</span><input type="range" min="0" :max="trimDraft.duration" step="0.01" v-model.number="trimDraft.end" @input="clampTrim('end')"><b>{{ trimDraft.end.toFixed(2) }}s</b></div>
      <div class="h3d-row" style="justify-content:space-between;margin-top:12px">
        <span><button class="h3d-btn" @click="previewTrim">▶ 播放选区</button> <button class="h3d-btn" @click="resetTrim">恢复全部</button></span>
        <span><button class="h3d-btn" @click="closeTrim">取消</button> <button class="h3d-btn primary" @click="saveTrim">保存</button></span>
      </div>
    </div>
  </div>
</div>`
});

// ─────────────────────────────────────────────────────────────────
// RightPanel（右栏：镜头序列 + 编译预览）
// ─────────────────────────────────────────────────────────────────
var RightPanel = defineComponent({
    name: 'RightPanel',
    setup: function() {
        var store = inject('h3store');
        var actions = inject('h3actions');
        var preview = inject('h3preview');
        var scene = computed(function() {
            return store.scenes.find(function(s) { return s.id === store.currentSceneId; }) || null;
        });
        function jumpToShot() { store.editorTab = 'shot'; }
        var highlightedPreview = computed(function() { return highlightText(preview.currentPage.value || ''); });
        return { store: store, actions: actions, preview: preview, scene: scene, jumpToShot: jumpToShot, highlightedPreview: highlightedPreview };
    },
    template: `
<div class="h3d-col" style="display:flex;flex-direction:column;min-height:0;border-right:none">
  <div class="h3d-col-hd">
    <span>镜头序列 · 编译</span>
    <div style="display:flex;gap:4px">
      <button class="h3d-btn sm" :class="{primary:store.rightTab==='shots'}" @click="store.rightTab='shots'">序列</button>
      <button class="h3d-btn sm" :class="{primary:store.rightTab==='output'}" @click="store.rightTab='output'">输出</button>
    </div>
  </div>
  <div class="h3d-col-body">
    <!-- 镜头序列 -->
    <div v-if="store.rightTab==='shots'">
      <div v-if="!scene" class="h3d-empty">请先选择场景</div>
      <div v-else-if="!scene.shots.length" class="h3d-empty">该场景暂无镜头，去「分镜」添加</div>
      <div v-else>
        <div v-for="(sh,i) in scene.shots" :key="sh.id" class="h3d-shot-card" @click="jumpToShot">
          <div class="hd">
            <span class="st">Shot {{ i+1 }}</span>
            <span class="tm">{{ sh.time }}</span>
            <span v-if="sh.framing" style="font-size:10px;color:var(--h3d-muted);background:var(--h3d-bg4);padding:1px 5px;border-radius:4px">{{ sh.framing }}</span>
          </div>
          <div class="ct">{{ sh.content || '（无内容）' }}</div>
          <div class="mt" v-if="sh.camera || sh.action">🎥 {{ sh.camera }} · 🎭 {{ sh.action }}</div>
          <div class="mt" v-if="sh.sound">🔊 {{ sh.sound }}</div>
        </div>
      </div>
    </div>

    <!-- 编译输出 -->
    <div v-if="store.rightTab==='output'" style="display:flex;flex-direction:column;gap:8px;flex:1">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span class="h3d-hint" style="margin:0">H3 七段编译（实时预览）</span>
        <button class="h3d-btn sm" @click="actions.copyCompiled">📋 复制</button>
      </div>
      <pre class="h3d-preview" v-html="highlightedPreview"></pre>
      <div class="h3d-stats">
        <div class="h3d-stat">字数 <b>{{ preview.wordCount.value }}</b></div>
        <div class="h3d-stat">场景 <b>{{ preview.sceneIndex.value+1 }}/{{ store.scenes.length }}</b> <span v-if="scene" style="font-weight:normal;color:var(--h3d-muted)">{{ scene.title }}</span></div>
        <button v-if="store.scenes.length>1" class="h3d-btn sm" @click="actions.prevScene">‹</button>
        <button v-if="store.scenes.length>1" class="h3d-btn sm" @click="actions.nextScene">›</button>
      </div>
      <div v-if="preview.warnings.value.length" class="h3d-warn-box">
        ⚠️ 检查提醒
        <ul><li v-for="(w,i) in preview.warnings.value" :key="i">{{ w }}</li></ul>
      </div>
    </div>
  </div>
</div>`
});

// ─────────────────────────────────────────────────────────────────
// 注册 ComfyUI 扩展
// ─────────────────────────────────────────────────────────────────
H3DirectorApp.components = { PlanPanel: PlanPanel, EditorPanel: EditorPanel, RightPanel: RightPanel, HighlightTextarea: HighlightTextarea };

app.registerExtension({
    name: 'EagleSuite.H3Director',
    async beforeRegisterNodeDef(nodeType, nodeData) {
        console.log('[EagleH3Director] beforeRegisterNodeDef:', nodeData && nodeData.name);
        if (nodeData.name !== 'EagleH3DirectorNode') return;
        console.log('[EagleH3Director] matched EagleH3DirectorNode, mounting...');

        var hideWidgets = function(node) {
            if (!node.widgets || !node.widgets.length) return false;
            var found = false;
            for (var i = 0; i < node.widgets.length; i++) {
                var w = node.widgets[i];
                if (w.name === 'h3_state' || w.name === 'scene_index' || w.name === 'LLM_HINT' || w.name === 'skill_request') {
                    w.type = 'hidden';
                    w.computeSize = function() { return [0, -4]; };
                    w.hidden = true;
                    w.draw = function() {};
                    found = true;
                }
            }
            if (found) node.setDirtyCanvas(true, true);
            return found;
        };

        var orig = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            if (orig) orig.apply(this, arguments);
            if (this._h3Init) return;
            this._h3Init = true;

            this.setSize([1300, 860]);

            var node = this;
            setTimeout(function() { if (!hideWidgets(node)) setTimeout(function() { hideWidgets(node); }, 500); }, 300);

            if (!document.getElementById('h3d-global-style')) {
                var s = document.createElement('style');
                s.id = 'h3d-global-style';
                s.textContent = H3D_CSS;
                document.head.appendChild(s);
            }

            var el = document.createElement('div');
            el.style.cssText = 'width:100%;overflow:hidden;position:relative;';

            var widget = this.addDOMWidget('h3_director_ui', 'div', el, { serialize: false });

            var applyHeight = function(nodeHeight) {
                var h = Math.max(420, (nodeHeight || 860) - 150);
                el.style.height = h + 'px';
                return h;
            };
            applyHeight(this.size ? this.size[1] : 800);

            // 不设置 computeSize，避免高度反馈循环（参考 lora_gallery）
            // ComfyUI 的 DOM widget 高度由 onResize 回调主动同步

            console.log('[EagleH3Director] mounting Vue on node', this.id);
            try {
                var appInstance = createApp(H3DirectorApp, { node: node });
                appInstance.mount(el);
                this._vueApp = appInstance;
                console.log('[EagleH3Director] Vue mounted OK');
            } catch(e) {
                el.replaceChildren();
                var errorBox = document.createElement('div');
                errorBox.style.cssText = 'padding:30px;min-height:120px;color:#ff6b6b;background:#1a0b0b;border:1px solid #ff6b6b;border-radius:8px;font-family:monospace;white-space:pre-wrap';
                errorBox.textContent = 'H3 Director 加载失败: ' + (e && e.message ? e.message : 'unknown error') + '\n\n' + (e && e.stack ? e.stack : '');
                el.appendChild(errorBox);
                console.error('[EagleH3Director] mount failed:', e);
            }

            // 注册后端→前端「生成结果」事件监听（仅一次）
            if (!window._h3SkillListener) {
                window._h3SkillListener = true;
                try {
                    var _h3Api = (typeof api !== 'undefined' && api) ? api : (app && app.api);
                    if (_h3Api && _h3Api.addEventListener) {
                        _h3Api.addEventListener('h3_director_skill_result', function(e) {
                            var data = (e && e.detail) ? e.detail : e;
                            if (!data) return;
                            var nodes = (app.graph && app.graph.nodes) || [];
                            var target = null;
                            for (var ni = 0; ni < nodes.length; ni++) {
                                if (String(nodes[ni].id) === String(data.node_id)) { target = nodes[ni]; break; }
                            }
                            if (target && target._h3ApplySkillResult) target._h3ApplySkillResult(data);
                        });
                    }
                } catch (err) {
                    console.warn('[EagleH3Director] skill 事件监听注册失败:', err);
                }
            }

            var onResize = this.onResize;
            this.onResize = function(size) {
                if (onResize) onResize.apply(this, arguments);
                applyHeight(size[1]);
            };
        };

        var onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function(info) {
            if (onConfigure) onConfigure.apply(this, arguments);
            var node = this;
            // onNodeCreated 中 Vue 已挂载并暴露 _h3ReloadState；
            // 但 configure 在此之后才会把 workflow 保存的 widgets_values 写回 widget，
            // 因此必须在这里重新加载一次，否则刷新后节点会显示默认空状态。
            function doReload(attempts) {
                attempts = attempts || 0;
                if (node._h3ReloadState) {
                    node._h3ReloadState();
                } else if (attempts < 20) {
                    setTimeout(function() { doReload(attempts + 1); }, 50);
                } else {
                    console.warn('[EagleH3Director] onConfigure: _h3ReloadState not ready');
                }
            }
            doReload();
        };

        var onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function() {
            if (this._h3SaveTimer) { clearTimeout(this._h3SaveTimer); this._h3SaveTimer = null; }
            if (this._vueApp) { this._vueApp.unmount(); this._vueApp = null; }
            this._h3ReloadState = null;
            if (onRemoved) onRemoved.apply(this, arguments);
        };
    }
});
