/**
 * Eagle H3 Director — 内联单文件前端（照搬 eagle_gallery.js 模式）
 * 所有组件、composables、CSS 全部内联，只依赖 vue.esm-browser.js。
 */
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import {
    createApp, defineComponent, reactive, computed, watch,
    ref, nextTick, provide, inject, onBeforeUnmount
} from "../lib/vue.esm-browser.js";
import "./eagle_vue_theme.js";
import { EAGLE_SETTING_IDS, getEagleSetting } from "./eagle_settings.js";

console.log("[EagleH3Director] h3_director.js loaded");

// ─────────────────────────────────────────────────────────────────
// CSS（注入一次）
// ─────────────────────────────────────────────────────────────────
var H3D_CSS = `
.h3d-root{
  --h3d-theme-bg:var(--comfy-menu-bg,var(--bg-color,#0b0c0f)); --h3d-fg:var(--fg-color,#e8ebf2);
  --h3d-bg:var(--h3d-theme-bg); --h3d-bg2:color-mix(in srgb,var(--h3d-theme-bg) 94%,var(--h3d-fg) 6%); --h3d-bg3:color-mix(in srgb,var(--h3d-theme-bg) 88%,var(--h3d-fg) 12%); --h3d-bg4:color-mix(in srgb,var(--h3d-theme-bg) 81%,var(--h3d-fg) 19%);
  --h3d-bd:var(--border-color,color-mix(in srgb,var(--h3d-theme-bg) 68%,var(--h3d-fg) 32%)); --h3d-bdh:color-mix(in srgb,var(--h3d-theme-bg) 55%,var(--h3d-fg) 45%);
  --h3d-muted:var(--descrip-text,color-mix(in srgb,var(--h3d-fg) 64%,var(--h3d-theme-bg) 36%));
  --h3d-primary:var(--p-primary-color,#4a7de0); --h3d-primaryh:var(--p-primary-hover-color,#5a8df0);
  --h3d-danger:#c14b4b; --h3d-success:#4a9a62; --h3d-warn:#d4a24a;
  --h3d-radius:8px;
  display:flex; flex-direction:column; width:100%; max-width:100%; height:100%; min-height:0; min-width:0;
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
.h3d-body{display:grid;flex:1;min-height:0;min-width:0;overflow:hidden;}
.h3d-col{display:flex;flex-direction:column;min-height:0;min-width:0;border-right:1px solid var(--h3d-bd);}
.h3d-splitter{position:relative;width:8px;min-width:8px;min-height:0;cursor:col-resize;touch-action:none;outline:none;background:color-mix(in srgb,var(--h3d-bg2) 84%,var(--h3d-bd) 16%);transition:background .12s;z-index:4;}
.h3d-splitter:after{content:"";position:absolute;left:3px;top:12px;bottom:12px;width:2px;border-radius:2px;background:var(--h3d-bd);transition:background .12s,box-shadow .12s;}
.h3d-splitter:hover,.h3d-splitter:focus-visible,.h3d-splitter.active{background:color-mix(in srgb,var(--h3d-primary) 22%,var(--h3d-bg2) 78%);}
.h3d-splitter:hover:after,.h3d-splitter:focus-visible:after,.h3d-splitter.active:after{background:var(--h3d-primary);box-shadow:0 0 0 1px color-mix(in srgb,var(--h3d-primary) 30%,transparent);}
.h3d-root.h3d-columns-resizing,.h3d-root.h3d-columns-resizing *{cursor:col-resize!important;user-select:none!important;}
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
.h3d-atomic-editor{position:absolute;inset:0;margin:0;padding:6px 8px;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow:auto;word-break:break-word;outline:none;border:0;color:var(--h3d-fg);caret-color:var(--h3d-fg);}
.h3d-atomic-editor:empty:before{content:attr(data-placeholder);color:var(--h3d-muted);pointer-events:none;}
.h3d-atomic-token{display:inline-flex;align-items:center;gap:4px;max-width:92%;min-height:20px;padding:1px 6px;border-radius:5px;border:1px solid #3a5f9e;background:#1a2f4a;color:#8fc4ff;vertical-align:baseline;user-select:none;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.h3d-atomic-token.media{border-color:#3d5364;background:#172630;color:#8fc8e8}.h3d-atomic-token.video{border-color:#59436f;background:#271e34;color:#c7a6e8}.h3d-atomic-token.audio{border-color:#515864;background:#24272d;color:#cbd2dc}
.h3d-atomic-token.ignored{filter:saturate(.2);opacity:.48;text-decoration:line-through;border-style:dashed}.h3d-atomic-token:hover{opacity:.8;box-shadow:0 0 0 1px rgba(103,159,244,.3)}
.h3d-atomic-token .token-thumb{width:16px;height:16px;flex:0 0 16px;background-size:cover;background-position:center;border-radius:3px}.h3d-atomic-token .token-state{font:9px/1 system-ui;color:inherit;opacity:.8}
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
.h3d-media-token .token-thumb{width:15px;height:15px;background-size:cover;background-position:center;border-radius:3px}.h3d-media-token i{width:15px;text-align:center;font-style:normal;font-size:10px}
.h3d-media-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.h3d-media-detail{border:1px solid var(--h3d-bd);border-radius:7px;background:var(--h3d-bg2);padding:7px;min-width:0}
.h3d-media-detail-preview{height:82px;border-radius:5px;overflow:hidden;background:#0b0d12;display:flex;align-items:center;justify-content:center;position:relative}.h3d-media-detail-preview img,.h3d-media-detail-preview video{width:100%;height:100%;object-fit:cover}.h3d-media-detail-preview .audio-icon{font-size:30px;color:#73b7ed}
.h3d-media-missing{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:5px;text-align:center;background:#12151c;color:#8f98a8;font-size:9px}
.h3d-media-dropzone{position:relative;min-height:118px;border:2px dashed #465064;border-radius:9px;background:linear-gradient(180deg,#111722,#0e1118);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:12px 112px 12px 18px;color:var(--h3d-muted);cursor:pointer;transition:.15s;flex-shrink:0;text-align:center}
.h3d-media-dropzone:hover{border-color:var(--h3d-primary);background:#131c2b;color:#fff}.h3d-media-dropzone .drop-icon{font-size:26px;color:#73a7ef;line-height:1}.h3d-media-dropzone .drop-title{font-size:12px;font-weight:600}.h3d-media-dropzone .drop-sub{font-size:10px;line-height:1.5;color:var(--h3d-muted);max-width:620px}.h3d-media-drop-actions{position:absolute;right:9px;top:9px;display:flex;flex-direction:column;gap:5px;z-index:2}
.h3d-trim-overlay{position:absolute;z-index:40;inset:0;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:24px}.h3d-trim-dialog{width:min(760px,94%);background:#171b23;border:1px solid #465064;border-radius:9px;padding:14px;box-shadow:0 14px 50px rgba(0,0,0,.55)}
.h3d-trim-preview{height:220px;background:#090b0f;border-radius:7px;display:flex;align-items:center;justify-content:center;overflow:hidden;margin:10px 0}.h3d-trim-preview video{max-width:100%;max-height:100%}.h3d-trim-preview audio{width:92%}
.h3d-trim-ranges{display:grid;grid-template-columns:72px 1fr 70px;gap:7px;align-items:center;margin:8px 0}.h3d-trim-ranges input[type=range]{width:100%}
.h3d-trim-timeline{margin-top:9px;border:1px solid var(--h3d-bd);border-radius:7px;background:#0d1016;overflow:hidden;user-select:none}
.h3d-trim-ruler{position:relative;height:24px;border-bottom:1px solid var(--h3d-bd);background:#171a22;color:var(--h3d-muted);font:9px/1 ui-monospace,monospace}
.h3d-trim-tick{position:absolute;bottom:0;height:8px;border-left:1px solid #555e6e}.h3d-trim-tick span{position:absolute;left:3px;bottom:10px;white-space:nowrap}
.h3d-trim-track{position:relative;height:82px;cursor:pointer;overflow:hidden;background:#090b0f}
.h3d-trim-thumbs{position:absolute;inset:0;display:flex}.h3d-trim-thumb{flex:1;min-width:0;border-right:1px solid rgba(255,255,255,.08);background:#151922;overflow:hidden}.h3d-trim-thumb img{width:100%;height:100%;object-fit:cover;display:block}.h3d-trim-thumb.empty{display:grid;place-items:center;color:var(--h3d-muted);font-size:10px}
.h3d-trim-shade{position:absolute;top:0;bottom:0;background:rgba(4,6,10,.72);pointer-events:none;z-index:2}.h3d-trim-shade.left{left:0}.h3d-trim-shade.right{right:0}
.h3d-trim-selection{position:absolute;top:0;bottom:0;border:2px solid var(--h3d-primary);background:rgba(74,125,224,.08);pointer-events:none;z-index:3}.h3d-trim-selection:before,.h3d-trim-selection:after{content:"";position:absolute;top:50%;width:7px;height:26px;transform:translateY(-50%);border-radius:3px;background:var(--h3d-primary);box-shadow:0 0 0 1px rgba(255,255,255,.45)}.h3d-trim-selection:before{left:-5px}.h3d-trim-selection:after{right:-5px}
.h3d-trim-playhead{position:absolute;top:0;bottom:0;width:1px;background:#ff4e54;box-shadow:0 0 0 1px rgba(255,78,84,.18);pointer-events:none;z-index:7}.h3d-trim-playhead:before{content:"";position:absolute;top:0;left:-4px;border-left:4px solid transparent;border-right:4px solid transparent;border-top:7px solid #ff4e54}
.h3d-trim-range{position:absolute;left:0;top:0;width:100%;height:100%;margin:0;opacity:0;pointer-events:none;z-index:5}.h3d-trim-range::-webkit-slider-thumb{width:18px;height:82px;pointer-events:auto;cursor:ew-resize}.h3d-trim-range.end{z-index:6}
.h3d-trim-values{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-top:8px}.h3d-trim-value{padding:7px;border:1px solid var(--h3d-bd);border-radius:6px;background:var(--h3d-bg3)}.h3d-trim-value label{display:block;color:var(--h3d-muted);font-size:10px;margin-bottom:4px}.h3d-trim-value .line{display:flex;align-items:center;gap:5px}.h3d-trim-value input{width:86px}.h3d-trim-value b{font:10px/1.3 ui-monospace,monospace;color:var(--h3d-muted)}
.h3d-trim-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px}.h3d-trim-tools .summary{margin-left:auto;color:var(--h3d-muted);font:10px/1.3 ui-monospace,monospace}
.h3d-input-overlay{position:absolute;z-index:45;inset:38px 8px 8px;background:rgba(5,7,11,.82);display:flex;align-items:center;justify-content:center;padding:10px}
.h3d-input-dialog{width:min(760px,98%);height:min(560px,98%);min-height:300px;background:#151820;border:1px solid #41495a;border-radius:9px;box-shadow:0 18px 54px rgba(0,0,0,.68);display:flex;flex-direction:column;overflow:hidden}
.h3d-input-head{display:flex;align-items:center;gap:7px;padding:8px;border-bottom:1px solid var(--h3d-bd);background:#191c24}.h3d-input-head .h3d-inp{flex:1}
.h3d-input-body{position:relative;display:grid;grid-template-columns:minmax(210px,42%) 1fr;flex:1;min-height:0}
.h3d-input-preview{padding:10px;border-right:1px solid var(--h3d-bd);background:#101218;min-width:0;overflow:hidden;display:flex;flex-direction:column;gap:7px}
.h3d-input-preview img{width:100%;flex:1;min-height:0;object-fit:contain;background:#090a0d;border-radius:6px}.h3d-input-preview .empty{margin:auto;color:var(--h3d-muted);font-size:11px;text-align:center}
.h3d-input-list{overflow-y:auto;padding:6px}.h3d-input-item{width:100%;border:0;border-radius:5px;background:transparent;color:#c7ccd6;display:flex;align-items:center;gap:7px;padding:6px 8px;text-align:left;cursor:pointer;font:11px/1.35 system-ui}.h3d-input-item:hover,.h3d-input-item.active{background:#283043;color:#fff}.h3d-input-item .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.h3d-input-item .folder{max-width:145px;color:#747e90;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

// ─────────────────────────────────────────────────────────────────
// 数据工厂
// ─────────────────────────────────────────────────────────────────
function createScene(id, defaultSeconds) {
    return { id: id, title: '', defaultSeconds: Number(defaultSeconds) || 7, defaultSteps: 8, shots: [], dialogues: [], preamble: '', disabledTokens: [] };
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
var LEGACY_MEDIA_ROLES = {
    person:'subject_person', prop:'subject_prop', style:'style_reference',
    environment:'scene_reference', composition:'composition_reference', reference:'motion_reference'
};
function defaultMediaRole(type, kind) {
    if (type === 'video') return 'motion_reference';
    if (type === 'audio') return 'voice_timbre';
    return LEGACY_MEDIA_ROLES[kind || 'person'] || 'subject_person';
}
function createMediaRef(data) {
    data = data || {};
    var type = ['image','video','audio'].indexOf(data.type) >= 0 ? data.type : 'image';
    var kind = data.kind || (type === 'image' ? 'person' : 'reference');
    var retention = data.retention || (type === 'audio' ? 'reference' : 'fully_preserved');
    if (retention === 'style_only') retention = 'attribute_transfer';
    if (type === 'audio' && ['fully_copy','partially_copy','reference','weak_reference'].indexOf(retention) < 0) retention = 'reference';
    if (type !== 'audio' && ['fully_preserved','partially_preserved','attribute_transfer','weak_reference'].indexOf(retention) < 0) retention = 'fully_preserved';
    var duration = Math.max(0, Number(data.duration) || 0);
    return {
        id: data.id || ('media-' + Date.now() + '-' + Math.random().toString(16).slice(2)),
        type: type,
        filename: data.filename || '',
        originalName: data.originalName || data.name || data.filename || '',
        name: data.name || '',
        kind: kind,
        role: data.role || defaultMediaRole(type, kind),
        purpose: data.purpose || '',
        retention: retention,
        useEmbeddedAudio: type === 'video' ? !!data.useEmbeddedAudio : false,
        speakerId: data.speakerId || '',
        duration: duration,
        trimStart: Math.max(0, Number(data.trimStart) || 0),
        trimEnd: Number.isFinite(Number(data.trimEnd)) && Number(data.trimEnd) > 0 ? Number(data.trimEnd) : duration,
        source: data.source || (String(data.filename || '').indexOf('/') >= 0 ? 'input' : 'legacy'),
        managed: data.managed != null ? !!data.managed : /^(?:media_|ref_)/.test(String(data.filename || '')),
        url: data.url || ''
    };
}

function _apiUrl(path) {
    try { return api && api.apiURL ? api.apiURL(path) : path; }
    catch (_) { return path; }
}
function mediaUrl(item) {
    if (!item) return '';
    var rawUrl = String(item.url || '');
    if (/^(?:https?:|data:|blob:)/i.test(rawUrl)) return rawUrl;
    var filename = String(item.filename || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!filename) return '';
    if (item.source === 'input' || filename.indexOf('/') >= 0) {
        var slash = filename.lastIndexOf('/');
        var base = slash >= 0 ? filename.slice(slash + 1) : filename;
        var subfolder = slash >= 0 ? filename.slice(0, slash) : '';
        return _apiUrl('/view?filename=' + encodeURIComponent(base) +
            '&subfolder=' + encodeURIComponent(subfolder) + '&type=input');
    }
    if (rawUrl && rawUrl.charAt(0) === '/') return _apiUrl(rawUrl);
    return _apiUrl('/h3_director/media?filename=' + encodeURIComponent(filename));
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
function defaultInteraction() {
    return {
        enabled: true,
        visualStyle: 'auto',
        productionLevel: 'SR',
        dynamicType: 'auto',
        outputMode: 'single_loop',
        loopMode: 'pose_cycle',
        aiMotionAutofill: true,
        automationEnabled: true,
        autoScene: true,
        autoEffects: true,
        autoCamera: true,
        autoQualityCheck: true,
        allowVideoReference: false,
        expressionPack: 'auto',
        sceneTheme: 'auto',
        effectStyle: 'auto',
        interactionIntent: '',
        adultEnabled: false,
        adultTier: 'off',
        adultSubjectsVerified: false,
        consentConfirmed: false
    };
}

var PV_TRANSITION_OPTIONS = [
    ['hard_cut','硬切'], ['cut_on_action','动作点切'], ['flash_cut','闪白切'], ['match_cut','匹配剪辑'],
    ['graphic_match','图形匹配'], ['whip_pan','甩镜平移'], ['whip_zoom','甩镜缩放'],
    ['foreground_wipe','前景遮挡切'], ['luma_wipe','亮度擦除'], ['mask_wipe','遮罩擦除'],
    ['split_screen_push','分屏推进'], ['parallax_push','视差推进'], ['speed_ramp','变速转场'],
    ['freeze_smash','定格冲切'], ['film_burn','胶片灼烧'], ['glitch_slice','故障切片'],
    ['zoom_blur','缩放模糊'], ['light_sweep','扫光转场'], ['dip_to_color','浸色过渡']
];
var PV_EFFECT_OPTIONS = [
    ['deep_glow','Deep Glow'], ['bokeh','Bokeh'], ['rgb_split','RGB 分离'], ['pixel_sort','Pixel Sort'],
    ['jpeg_glitch','JPEG Glitch'], ['frame_echo','帧回声'], ['light_leak','漏光'], ['thick_stroke','描边'],
    ['halftone','半调网点'], ['chromatic_trails','彩色拖影'], ['particle_burst','粒子爆发'],
    ['scanline','扫描线'], ['film_grain','胶片颗粒'], ['lens_distortion','镜头畸变'],
    ['bloom_pulse','辉光脉冲'], ['silhouette','剪影'], ['posterize','色阶海报化'],
    ['ink_spread','墨迹扩散'], ['hologram','全息层'], ['graphic_shapes','动态图形']
];

function defaultPv() {
    return {
        enabled: false,
        theme: 'auto',
        visualStyle: 'auto',
        editGrammar: 'auto',
        actionProfile: 'calm',
        textTreatment: 'safe_title',
        template: 'character_reveal',
        rhythm: 'beat_sync',
        cutDensity: 'medium',
        bpm: 120,
        beatOffsetMs: 0,
        title: '',
        subtitle: '',
        reserveTitleSafeArea: true,
        allowVideoReference: true,
        transitions: ['flash_cut', 'match_cut', 'whip_zoom'],
        effects: ['deep_glow', 'bokeh', 'rgb_split'],
        creativeBrief: '',
        actionDirection: '',
        titleConcept: '',
        selectedCardId: '',
        drawMode: 'character_match',
        modelMode: 'auto',
        drawCount: 3,
        drawing: false,
        cards: [],
        history: [],
        lastDrawSummary: '',
        notes: ''
    };
}

function projectAllowsVideoReferences(project) {
    project = project || {};
    var interaction = Object.assign(defaultInteraction(), project.interaction || {});
    var pv = Object.assign(defaultPv(), project.pv || {});
    if (project.workflowType === 'character_interaction') return !!interaction.allowVideoReference;
    if (project.workflowType === 'character_pv') return !!(pv.enabled && pv.allowVideoReference);
    return ['r2v','rv2v','v2v'].indexOf(String(project.mode || '').toLowerCase()) >= 0;
}

function defaultProject() {
    return {
        workflowType: 'character_interaction',
        mode: 't2v', globalDuration: 7, globalSteps: 8,
        // 必须与尺寸下拉框的真实 value 完全一致，否则首次打开时没有选中项。
        aspect: '16:9', resolution: 'mp0.5', fps: 24, exportMode: 'all',
        sizePreset: '16:9|mp0.5|960|544', width: 960, height: 544,
        sizeLocked: true, sizeRatio: 960 / 544,
        foundation: '',
        contextLength: 22, encodeMode: 'video', anchorMode: 'head', crop: 'disabled',
        audioMode: 'generated_audio', audioContextLength: 22, baseSeed: 0, segmentCrf: 18,
        refMaxMegapixels: 1.5,
        videoBlendFrames: 0, continuationMode: 'guide', referencePolicy: 'warn',
        refs: Array.from({ length: 9 }, function() { return createRef(); }),
        mediaRefs: [],
        // 导演台内选择的技能库快照。保存到工作流，确保下次打开仍能复现生成上下文。
        director_skill: '',
        // AI 生成后的动作/运镜/转场摘要；仅保存短期记录用于跨场景去重。
        generationHistory: [],
        // 动态角色交互策略。参考视频保留为高级功能，但新项目默认不启用。
        interaction: defaultInteraction(),
        // 角色 PV / 类 AE 动效只负责编排与后期元数据，不让生成模型直接绘制精确文字。
        pv: defaultPv(),
        skill: {
            tasks: [],            // ['script','shots','dialogue'] 多选
            promptLanguage: 'en', // 视觉/运镜模板语言；H3 默认推荐英文
            dialogueLanguage: 'Chinese', // <d> 台词文本语言
            modelPref: 'local',   // 'local' 本地优先 | 'api'
            mergeMode: 'overwrite', // 'overwrite' 覆盖 | 'append' 追加
            profile: 'balanced',
            skillPolicy: 'merge',
            librarySkillIds: ['pro-v1-h3-character-dynamic-director', 'pro-v2-h3-character-interaction-automation'],
            temperature: 0.7,
            hint: ''
        }
    };
}
function normalizeProjectEnums(project) {
    if (!project) return;
    var hadInteraction = !!(project.interaction && typeof project.interaction === 'object');
    var legacyHasVideo = !hadInteraction && Array.isArray(project.mediaRefs) && project.mediaRefs.some(function(item) {
        return item && item.filename && item.type === 'video';
    });
    if (project.encodeMode === 'image') project.encodeMode = 'frames';
    if (project.anchorMode === 'frame' || project.anchorMode === 'tail') project.anchorMode = 'before';
    if (project.continuationMode === 'strict' || project.continuationMode === 'free') project.continuationMode = 'guide';
    if (project.audioMode === 'off') project.audioMode = 'generated_audio';
    if (['off','warn','strict'].indexOf(project.referencePolicy) < 0) project.referencePolicy = 'warn';
    var sizeParts = String(project.sizePreset || '').split('|');
    if (project.sizePreset !== 'custom' && sizeParts.length >= 4) {
        project.width = parseInt(sizeParts[2], 10) || 960;
        project.height = parseInt(sizeParts[3], 10) || 544;
    }
    project.width = snapDimension(project.width || 960);
    project.height = snapDimension(project.height || 544);
    project.sizeLocked = project.sizeLocked !== false;
    if (!(Number(project.sizeRatio) > 0)) project.sizeRatio = project.width / project.height;
    if (['ai_drama','character_interaction','character_pv'].indexOf(project.workflowType) < 0) project.workflowType = 'ai_drama';
    project.skill = Object.assign(defaultProject().skill, project.skill || {});
    project.interaction = Object.assign(defaultInteraction(), project.interaction || {});
    project.pv = Object.assign(defaultPv(), project.pv || {});
    if (legacyHasVideo) project.interaction.allowVideoReference = true;
    if (['en', 'zh'].indexOf(project.skill.promptLanguage) < 0) project.skill.promptLanguage = 'en';
    if (!project.skill.dialogueLanguage) project.skill.dialogueLanguage = 'Chinese';
    if (['S','SR','SSR','UR'].indexOf(project.interaction.productionLevel) < 0) project.interaction.productionLevel = 'SR';
    if (['auto','live_action','anime'].indexOf(project.interaction.visualStyle) < 0) project.interaction.visualStyle = 'auto';
    if (['single_clip','single_loop','optional_chain','continuous_chain'].indexOf(project.interaction.outputMode) < 0) project.interaction.outputMode = 'single_loop';
    if (!project.interaction.adultEnabled) project.interaction.adultTier = 'off';
    if (['character_reveal','kinetic_typography','image_flash','mixed_pv','action_showcase','emotional_memory','fashion_editorial'].indexOf(project.pv.template) < 0) project.pv.template = 'character_reveal';
    if (['beat_sync','impact_accents','smooth_cinematic','glitch_cut','syncopated','crescendo'].indexOf(project.pv.rhythm) < 0) project.pv.rhythm = 'beat_sync';
    if (['sparse','medium','dense'].indexOf(project.pv.cutDensity) < 0) project.pv.cutDensity = 'medium';
    if (['auto','hero_origin','neon_idol','fantasy_relic','urban_chase','dream_archive','dark_rival','festival_stage','tech_interface','fashion_editorial','quiet_portrait'].indexOf(project.pv.theme) < 0) project.pv.theme = 'auto';
    if (['auto','anime_cel','live_action_cinematic','graphic_comic','y2k_digital','retro_film','luxury_editorial','minimal_monochrome','holographic','ink_paper'].indexOf(project.pv.visualStyle) < 0) project.pv.visualStyle = 'auto';
    if (['auto','detail_to_hero','match_on_action','shape_match','color_match','eyeline_bridge','beat_strobe','time_remap','split_screen','freeze_smash','foreground_wipe'].indexOf(project.pv.editGrammar) < 0) project.pv.editGrammar = 'auto';
    if (['calm','graceful','energetic','combat','idol','mysterious','comedic'].indexOf(project.pv.actionProfile) < 0) project.pv.actionProfile = 'calm';
    if (['safe_title','hero_nameplate','kinetic_words','subtitle_card','no_text'].indexOf(project.pv.textTreatment) < 0) project.pv.textTreatment = 'safe_title';
    if (['character_match','balanced','surprise'].indexOf(project.pv.drawMode) < 0) project.pv.drawMode = 'character_match';
    if (['auto','local_only','model_refine'].indexOf(project.pv.modelMode) < 0) project.pv.modelMode = 'auto';
    project.pv.bpm = Math.max(40, Math.min(240, Number(project.pv.bpm) || 120));
    project.pv.beatOffsetMs = Math.max(-2000, Math.min(2000, Number(project.pv.beatOffsetMs) || 0));
    project.pv.drawCount = Math.max(1, Math.min(8, Number(project.pv.drawCount) || 3));
    if (!Array.isArray(project.pv.transitions)) project.pv.transitions = defaultPv().transitions.slice();
    if (!Array.isArray(project.pv.effects)) project.pv.effects = defaultPv().effects.slice();
    if (!Array.isArray(project.pv.cards)) project.pv.cards = [];
    if (!Array.isArray(project.pv.history)) project.pv.history = [];
    project.pv.drawing = false;
    if (!Array.isArray(project.generationHistory)) project.generationHistory = [];
}

function snapDimension(value) {
    return Math.max(32, Math.min(4096, Math.round((Number(value) || 32) / 32) * 32));
}

function h3LegalLength(requestedFrames) {
    var requested = Math.max(5, Math.ceil(Number(requestedFrames) || 5));
    return requested + ((5 - requested % 17) % 17);
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
            if (data && data.project && !Object.prototype.hasOwnProperty.call(data.project, 'workflowType')) {
                // v1/v2 工作流均视为原有 AI 短剧，避免升级后自动注入角色循环合同。
                project.workflowType = 'ai_drama';
                project.interaction = Object.assign(defaultInteraction(), data.project.interaction || {}, { enabled:false });
            }
            if (data && Array.isArray(data.scenes) && data.scenes.length) scenes = data.scenes;
        }
    } catch(e) { console.warn('[EagleH3Director] loadState error:', e); }
    migrateMediaRefs(project);
    normalizeProjectEnums(project);
    scenes.forEach(function(scene) { normalizeSceneShotTimes(scene, project.fps, false); });
    return { project: project, scenes: scenes };
}
function extractDialoguesIfNeeded(scenes) {
    (scenes || []).forEach(function(sc) {
        if (!Array.isArray(sc.disabledTokens)) sc.disabledTokens = [];
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
    var legacyDrama = !Object.prototype.hasOwnProperty.call(savedProject, 'workflowType');
    // 兼容旧版 segmentRef → segmentCrf
    if ('segmentRef' in savedProject && !('segmentCrf' in savedProject)) {
        savedProject.segmentCrf = savedProject.segmentRef;
    }
    var defProject = defaultProject();
    Object.keys(defProject).forEach(function(k) {
        project[k] = (k in savedProject) ? savedProject[k] : defProject[k];
    });
    if (legacyDrama) {
        project.workflowType = 'ai_drama';
        project.interaction = Object.assign(defaultInteraction(), savedProject.interaction || {}, { enabled:false });
    }
    migrateMediaRefs(project);
    normalizeProjectEnums(project);
    // skill 配置确保字段完整（兼容旧工作流缺失字段）
    var defSkill = defProject.skill;
    if (!project.skill || typeof project.skill !== 'object') project.skill = {};
    Object.keys(defSkill).forEach(function(k) {
        if (!(k in project.skill)) project.skill[k] = defSkill[k];
    });
    scenes.splice(0, scenes.length);
    if (Array.isArray(data.scenes) && data.scenes.length) {
        data.scenes.forEach(function(s) {
            if (!Array.isArray(s.disabledTokens)) s.disabledTokens = [];
            scenes.push(s);
        });
    } else {
        scenes.push(createScene(1));
    }
    extractDialoguesIfNeeded(scenes);
    scenes.forEach(function(scene) { normalizeSceneShotTimes(scene, project.fps, false); });
    store.currentSceneId = (scenes[0] && scenes[0].id) || 1;
}
function saveState(node, project, scenes, immediate) {
    var w = (node.widgets || []).find(function(x) { return x.name === 'h3_state'; });
    if (!w) return;
    if (node._h3SaveTimer) { clearTimeout(node._h3SaveTimer); node._h3SaveTimer = null; }
    var doSave = function() {
        try {
            (scenes || []).forEach(function(scene) { normalizeSceneShotTimes(scene, project.fps, false); });
            var clean = JSON.parse(JSON.stringify({ version: 3, project: project, scenes: scenes }));
            (clean.project.mediaRefs || []).forEach(function(r) { if (r) delete r.file; });
            // Keep a legacy image-only mirror so older workflow consumers continue to work.
            clean.project.refs = (clean.project.mediaRefs || []).filter(function(r) { return r.type === 'image'; }).map(function(r) {
                return { id:r.id, url:r.url, filename:r.filename, name:r.name, kind:r.kind, retention:r.retention };
            });
            var json = JSON.stringify(clean);
            w.value = json;
            if (typeof w.callback === 'function') w.callback(w.value, w, node);
            if (typeof node._eagleSyncContextLoopBridges === 'function') {
                node._eagleSyncContextLoopBridges();
            }
            if (node.graph) node.graph.change();
        } catch(e) { console.warn('[EagleH3Director] saveState error:', e); }
    };
    if (immediate) doSave();
    else node._h3SaveTimer = setTimeout(doSave, 300);
}

// ─────────────────────────────────────────────────────────────────
// 编译（前端镜像）
// ─────────────────────────────────────────────────────────────────
function fmtTime(sec) {
    sec = Math.max(0, Number(sec) || 0);
    var totalMs = Math.max(0, Math.round(sec * 1000));
    var h = Math.floor(totalMs / 3600000); totalMs -= h * 3600000;
    var m = Math.floor(totalMs / 60000); totalMs -= m * 60000;
    var s = Math.floor(totalMs / 1000), ms = totalMs % 1000;
    var base = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') + '.' + String(ms).padStart(3,'0');
    return h ? String(h).padStart(2,'0') + ':' + base : base;
}
function parseTimecode(value) {
    var match = String(value || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (!match) return null;
    var hours = Number(match[1] || 0), minutes = Number(match[2]), seconds = Number(match[3]);
    if ((match[1] && minutes >= 60) || seconds >= 60) return null;
    var millis = Number(String(match[4] || '0').padEnd(3, '0').slice(0, 3));
    return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}
function buildShotTimings(scene, fps, equalDistribution) {
    var shots = (scene && Array.isArray(scene.shots)) ? scene.shots : [];
    if (!shots.length) return [];
    fps = Math.max(1, Math.round(Number(fps) || 24));
    var duration = Math.max(0.001, Number(scene.defaultSeconds) || 10);
    var totalFrames = Math.max(shots.length, Math.round(duration * fps));
    var starts = [];
    shots.forEach(function(shot, index) {
        var frame;
        if (equalDistribution) frame = Math.round(totalFrames * index / shots.length);
        else {
            var parsed = index === 0 ? 0 : parseTimecode(shot && shot.time);
            frame = parsed == null ? Math.round(totalFrames * index / shots.length) : Math.round(parsed * fps);
        }
        var minimum = index ? starts[index - 1] + 1 : 0;
        var maximum = totalFrames - (shots.length - index);
        starts.push(Math.max(minimum, Math.min(maximum, frame)));
    });
    return shots.map(function(shot, index) {
        var startFrame = starts[index];
        var endFrame = index + 1 < starts.length ? starts[index + 1] : totalFrames;
        var frameCount = Math.max(1, endFrame - startFrame);
        var startSeconds = startFrame / fps, endSeconds = endFrame / fps;
        var startTimecode = fmtTime(startSeconds), endTimecode = fmtTime(endSeconds);
        return {
            startFrame:startFrame, endFrameExclusive:endFrame, frameCount:frameCount,
            startSeconds:startSeconds, endSeconds:endSeconds, durationSeconds:frameCount / fps,
            startTimecode:startTimecode, endTimecode:endTimecode,
            label:startTimecode + ' → ' + endTimecode + ' · ' + frameCount + 'f'
        };
    });
}
function normalizeSceneShotTimes(scene, fps, equalDistribution) {
    var timings = buildShotTimings(scene, fps, !!equalDistribution);
    (scene && scene.shots || []).forEach(function(shot, index) {
        var timing = timings[index]; if (!timing) return;
        shot.time = timing.startTimecode;
        shot.endTime = timing.endTimecode;
        shot.estSeconds = Number(timing.durationSeconds.toFixed(6));
        shot.startFrame = timing.startFrame;
        shot.endFrameExclusive = timing.endFrameExclusive;
        shot.frameCount = timing.frameCount;
    });
    return timings;
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

function stripDisabledTokens(scene, value) {
    var text = String(value == null ? '' : value);
    var disabled = (scene && Array.isArray(scene.disabledTokens)) ? scene.disabledTokens : [];
    disabled.forEach(function(token) {
        if (token) text = text.split(token).join('');
    });
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

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
        if (item && item.type === 'image' && mediaUrl(item)) {
            thumb = '<span class="token-thumb" style="background-image:url(&quot;' + _escapeHtml(mediaUrl(item)) + '&quot;)"></span>';
        } else {
            thumb = '<i>' + icon + '</i>';
        }
        return '<span class="h3d-media-token ' + type.toLowerCase() + '">' + thumb + match + '</span>';
    });
    // 再识别旧版 @refN / @图片N / @音频N 等引用标签
    out = out.replace(/@(?:ref|图片|音频|视频|video|audio)\d+/g, '<span class="h3d-hl-ref">$&</span>');
    return out;
}

function buildInteractionDirective(project, scene) {
    var cfg = Object.assign(defaultInteraction(), (project && project.interaction) || {});
    if (!cfg.enabled) return '';
    var duration = Math.max(4, Math.min(15, Number(scene && scene.defaultSeconds) || Number(project && project.globalDuration) || 7));
    var production = {
        S: 'S / restrained: one readable interaction beat, stable camera, subtle secondary motion, zero or one lightweight effect layer.',
        SR: 'SR / standard: anticipation, main action and reaction, one motivated camera move, one or two effect layers.',
        SSR: 'SSR / advanced: two or three readable performance beats, layered foreground/background motion, motivated camera and effects.',
        UR: 'UR / showcase: a polished hero performance with at most three clear beats, coordinated camera, environment response and layered effects.'
    }[cfg.productionLevel] || '';
    var visualStyle = {
        auto: 'Infer live-action versus anime motion language from the authoritative character references and preserve that medium.',
        live_action: 'LIVE-ACTION PERFORMANCE: use physically weighted motion, realistic inertia and joint limits, subtle facial micro-expression, natural blinking and cinematic camera response; avoid anime smear frames, cel-shaded motion shorthand and exaggerated holds.',
        anime: 'ANIME PERFORMANCE: preserve 2D linework and cel shading, favor readable key poses, controlled anticipation/holds and selective stylized follow-through; avoid photoreal skin, live-action motion blur and 3D-render drift.'
    }[cfg.visualStyle] || '';
    var dynamics = {
        auto: 'Infer a character-appropriate interaction from visible design, scene intent and supplied text.',
        idle_loop: 'Subtle breathing, blink, gaze shift, small head motion, hair and garment follow-through.',
        expression_reaction: 'A clear facial reaction supported by restrained head, shoulder and hand motion.',
        gesture: 'One readable communicative gesture with anticipation, action, reaction and recovery.',
        dialogue_lipsync: 'Conversational acting with natural lip motion, blink, gaze and restrained gesture.',
        action: 'A readable action with stable anatomy, center-of-frame staging and controlled follow-through.',
        dance_performance: 'A short rhythmic performance with a limited move vocabulary and clear recovery pose.',
        transformation: 'A staged transformation with identity and costume continuity preserved across effects.',
        vfx_showcase: 'Character-led effects showcase; effects respond to action and never obscure the face.',
        environment_interaction: 'The character touches or reacts to a clearly defined environmental element.',
        meme_loop: 'A concise, exaggerated reaction suitable for a looping reaction clip.'
    }[cfg.dynamicType] || '';
    var outputs = {
        single_clip: 'Deliver one self-contained clip with a natural ending; no stitching handoff is required.',
        single_loop: 'Deliver one seamless loop. Match first and last pose, framing, motion velocity, hair/cloth direction, lighting and effect phase; do not freeze the seam.',
        optional_chain: 'Each clip must work independently and may additionally expose compatible handoff_in/handoff_out states for optional post-production stitching.',
        continuous_chain: 'Plan explicit continuity handoffs for later stitching: pose, gaze, screen position, camera velocity, lighting, effects and sound must match.'
    }[cfg.outputMode] || '';
    var lines = [
        'CHARACTER INTERACTION CONTRACT:',
        '- Duration budget: ' + duration + ' seconds.',
        '- Production strength: ' + production,
        '- Visual performance system: ' + visualStyle,
        '- Dynamic type: ' + dynamics,
        '- Output strategy: ' + outputs,
        '- Preserve identity, facial structure, hairstyle, costume construction, signature accessories, body proportions, palette and visual style.',
        '- Keep the primary action readable in the central 70% of frame. Use observable motions with timing, amplitude, direction, reaction and recovery instead of vague emotion words.'
    ];
    if (cfg.aiMotionAutofill) {
        lines.push('- AI motion completion is enabled: invent physically coherent micro-motion and secondary motion without requiring a reference video; keep the action vocabulary proportional to duration.');
    }
    if (!cfg.allowVideoReference) {
        lines.push('- Reference-video transfer is disabled. Build motion from character design, scene intent and still-image anchors only; do not request or assume a video reference.');
    }
    var autoParts = [];
    if (cfg.autoScene) autoParts.push('scene');
    if (cfg.autoEffects) autoParts.push('effects');
    if (cfg.autoCamera) autoParts.push('camera');
    if (cfg.autoQualityCheck) autoParts.push('continuity/loop quality checks');
    if (cfg.automationEnabled) lines.push('- Automation is enabled for: ' + (autoParts.join(', ') || 'shot planning') + '. Derive choices from the character and stated intent, and keep every choice editable.');
    if (cfg.expressionPack && cfg.expressionPack !== 'auto') lines.push('- Expression target: ' + cfg.expressionPack + '.');
    if (cfg.sceneTheme && cfg.sceneTheme !== 'auto') lines.push('- Scene theme: ' + cfg.sceneTheme + '.');
    if (cfg.effectStyle && cfg.effectStyle !== 'auto') lines.push('- Effect style: ' + cfg.effectStyle + '.');
    if (String(cfg.interactionIntent || '').trim()) lines.push('- User interaction intent: ' + String(cfg.interactionIntent).trim());
    var adultReady = cfg.adultEnabled && cfg.adultTier !== 'off' && cfg.adultSubjectsVerified && cfg.consentConfirmed;
    if (adultReady) {
        lines.push('- Adult-content profile: enabled at ' + cfg.adultTier + '. All depicted people are explicitly verified adults and all intimacy is consensual. Apply only the separately enabled adult-safety skill and remain within its limits.');
    } else {
        lines.push('- Adult-content profile: OFF. Keep the result general-audience; production strength S/SR/SSR/UR never changes sexual-content level.');
    }
    return lines.join('\n');
}

function buildPvDirective(project, scene) {
    var cfg = Object.assign(defaultPv(), (project && project.pv) || {});
    if (!cfg.enabled || (project && project.workflowType !== 'character_pv')) return '';
    var duration = Math.max(1, Number(scene && scene.defaultSeconds) || Number(project && project.globalDuration) || 7);
    var templates = {
        character_reveal: 'Build a hero character reveal: silhouette or detail inserts, identity reveal, signature action, then a clean hero hold.',
        kinetic_typography: 'Build motion-graphics plates around title rhythm, graphic masks and negative space; exact typography is added in post.',
        image_flash: 'Build a rhythmic image-flash montage with short readable poses, detail inserts and strong graphic contrast.',
        mixed_pv: 'Combine character reveal, action inserts, graphic title plates and a decisive end card without overcrowding any beat.',
        action_showcase: 'Use match-on-action staging: anticipation, peak pose, impact insert and a controlled recovery.',
        emotional_memory: 'Build lyrical memory fragments, expressive close-ups and visual echoes that resolve on an emotional hero frame.',
        fashion_editorial: 'Use fashion-editorial posing, material details, graphic negative space and precise visual punctuation.'
    };
    var rhythms = {
        beat_sync: 'Cut and accent on the declared music beat grid.',
        impact_accents: 'Hold longer between a few strong impact accents; reserve flash frames for real emphasis.',
        smooth_cinematic: 'Use longer cinematic phrases, motivated match cuts and restrained glow transitions.',
        glitch_cut: 'Use concise glitch interruptions and datamosh-like transitions while keeping the character readable.',
        syncopated: 'Alternate on-beat anchors with restrained off-beat inserts so the edit does not feel mechanical.',
        crescendo: 'Begin with spacious holds, increase cut frequency, then resolve on one clean hero frame.'
    };
    var themes = {
        auto:'Infer a coherent theme from the character, references and brief.', hero_origin:'Hero origin and identity reveal.',
        neon_idol:'Neon idol stage and fan-energy spectacle.', fantasy_relic:'Fantasy relic awakening and magical lore.',
        urban_chase:'Urban pursuit and kinetic street energy.', dream_archive:'Dream archive, memory fragments and emotional symbolism.',
        dark_rival:'Dark rival confrontation and controlled menace.', festival_stage:'Festival stage, celebratory color and rhythmic performance.',
        tech_interface:'Future interface, scanning graphics and holographic systems.', fashion_editorial:'Fashion editorial, material detail and confident posing.',
        quiet_portrait:'Quiet portrait, intimate expression and restrained atmosphere.'
    };
    var styles = {
        auto:'Preserve and infer the reference medium.', anime_cel:'Clean 2D anime linework, cel shading and readable key poses.',
        live_action_cinematic:'Physically weighted live-action movement and cinematic optics.', graphic_comic:'Graphic comic panels, bold shapes and controlled halftone accents.',
        y2k_digital:'Y2K digital graphics, chrome accents and playful interface motifs.', retro_film:'Analog film texture, optical light and restrained period color.',
        luxury_editorial:'Luxury editorial lighting, material detail and minimal typography.', minimal_monochrome:'High-contrast monochrome forms and deliberate negative space.',
        holographic:'Holographic color separation, scanning light and translucent layers.', ink_paper:'Ink-and-paper texture, brush transitions and graphic silhouettes.'
    };
    var grammars = {
        auto:'Choose cuts from action, gaze, shape, color and story continuity.', detail_to_hero:'Move from costume or prop details to a full identity reveal.',
        match_on_action:'Cut across views on the same readable character action.', shape_match:'Bridge shots through matched silhouettes and graphic shapes.',
        color_match:'Use one palette accent to motivate each cut.', eyeline_bridge:'Follow gaze and reaction to reveal the next visual beat.',
        beat_strobe:'Place very short beat inserts around longer readable anchor shots.', time_remap:'Use speed ramps only around clear action peaks and recovery poses.',
        split_screen:'Build parallel details or before/after states in graphic panels.', freeze_smash:'Freeze a peak pose for post graphics, then smash-cut into motion.',
        foreground_wipe:'Hide cuts behind a foreground object, cloth, hair or light sweep.'
    };
    var actions = {
        calm:'restrained breathing, gaze, hair/cloth follow-through and a confident hero hold',
        graceful:'an elegant turn, hand or costume gesture with smooth recovery', energetic:'clear anticipation, fast readable action accents and stable recovery poses',
        combat:'guard, wind-up, one decisive technique and a readable impact silhouette', idol:'performance gesture, audience-facing eyeline and rhythmic pose changes',
        mysterious:'partial reveal, controlled gaze, prop interaction and restrained movement', comedic:'concise reaction, readable exaggeration and a clean loopable reset'
    };
    var textTreatments = {
        safe_title:'single title in reserved negative space', hero_nameplate:'character nameplate after the identity reveal',
        kinetic_words:'short kinetic words animated in post on beat accents', subtitle_card:'title plus one restrained subtitle line', no_text:'no typography'
    };
    var density = {
        sparse: 'sparse / 1–2 major editorial events per 5 seconds',
        medium: 'medium / 3–5 editorial events per 5 seconds',
        dense: 'dense / 6–9 short editorial events per 5 seconds; every pose must still be readable'
    }[cfg.cutDensity] || 'medium';
    var transitions = (cfg.transitions || []).join(', ') || 'clean cut';
    var effects = (cfg.effects || []).join(', ') || 'none';
    var lines = [
        'CHARACTER PV / MOTION-GRAPHICS CONTRACT:',
        '- Duration budget: ' + duration.toFixed(3) + ' seconds.',
        '- Theme: ' + (themes[cfg.theme] || themes.auto),
        '- Visual style: ' + (styles[cfg.visualStyle] || styles.auto),
        '- Template: ' + (templates[cfg.template] || templates.character_reveal),
        '- Rhythm: ' + (rhythms[cfg.rhythm] || rhythms.beat_sync),
        '- Editing grammar: ' + (grammars[cfg.editGrammar] || grammars.auto),
        '- Character action profile: ' + (actions[cfg.actionProfile] || actions.calm) + '.',
        '- Beat grid: ' + Math.round(Number(cfg.bpm) || 120) + ' BPM with ' + Math.round(Number(cfg.beatOffsetMs) || 0) + ' ms offset.',
        '- Edit density: ' + density + '.',
        '- Planned transitions for post: ' + transitions + '.',
        '- Planned effect layers for post: ' + effects + '.',
        '- Generate clean, temporally stable character plates. Preserve identity, face, hairstyle, costume, proportions, signature props and palette across every cut.',
        '- Separate generation from compositing: flashes, RGB split, pixel sorting, JPEG glitches, film burns, exact masks and final typography are post-production cues, not requests to deform the character.',
        '- Do not draw readable titles, logos, UI or watermarks inside generated footage.',
        '- Typography treatment for post: ' + (textTreatments[cfg.textTreatment] || textTreatments.safe_title) + '.'
    ];
    if (cfg.reserveTitleSafeArea) lines.push('- Reserve uncluttered title-safe negative space and keep the face, hands and signature costume details outside it.');
    if (String(cfg.title || '').trim()) lines.push('- Exact post title (metadata only; do not render in generation): ' + String(cfg.title).trim());
    if (String(cfg.subtitle || '').trim()) lines.push('- Exact post subtitle (metadata only; do not render in generation): ' + String(cfg.subtitle).trim());
    if (String(cfg.creativeBrief || '').trim()) lines.push('- Creative brief: ' + String(cfg.creativeBrief).trim());
    if (String(cfg.notes || '').trim()) lines.push('- User PV direction: ' + String(cfg.notes).trim());
    return lines.join('\n');
}

function compilePrompt(project, scene) {
    if (!project) project = {};
    if (!scene) scene = {};
    var parts = [];
    var mode = (project.mode || 't2v').toUpperCase();
    var secs = scene.defaultSeconds || 10;

    var mediaRefs = (project.mediaRefs || []).filter(function(r) {
        return r && r.filename && (r.type !== 'video' || projectAllowsVideoReferences(project));
    });
    var isReferenceMode = ['R2V','RV2V','V2V'].indexOf(mode) >= 0;

    // Base 模式在最终 timeline 完成后统一编译三字段；Ref2VA 走六字段。
    var fd = (project.foundation || '').trim();

    // 多模态参考信息：编号在各媒体类型内独立计算。
    var roleText = {
        subject_person:'a person or character identity reference', subject_animal:'an animal or creature identity reference',
        subject_prop:'an object, costume, or prop identity reference', scene_reference:'a scene or environment reference',
        style_reference:'a visual style reference', action_reference:'an action or pose reference',
        expression_reference:'an expression reference', composition_reference:'a composition or storyboard reference',
        first_frame:'the required first-frame anchor', last_frame:'the required last-frame anchor',
        keyframe:'a keyframe anchor', storyboard:'a storyboard or composition anchor',
        subject_reference:'a subject appearance reference', motion_reference:'a motion reference',
        camera_reference:'a camera-movement reference', rhythm_reference:'an editing rhythm and timing reference',
        edit_source:'a source clip to edit', continuation_source:'a source clip to continue',
        voice_timbre:'a speaker voice-timbre reference', music_style:'a music style reference',
        dialogue_content:'dialogue content to reuse', sound_effect:'a sound-effect reference', full_track:'an audio track to reuse'
    };
    var subjectRoles = {subject_person:1,subject_animal:1,subject_prop:1,subject_reference:1};
    var subjectNumber = 0;
    var subj = mediaRefs.map(function(r) {
        var tag = mediaTagFor(r, mediaRefs);
        var name = (r.name || '').trim();
        var purpose = (r.purpose || '').trim();
        var role = r.role || defaultMediaRole(r.type, r.kind);
        var description = roleText[role] || 'a multimodal reference';
        var line;
        if (subjectRoles[role]) {
            subjectNumber++;
            line = '  <Subject ' + subjectNumber + '> is ' + (name || purpose || description) + ', defined by ' + tag + '; ' + description + '.';
        } else {
            line = '  ' + tag + ' is ' + description + (name ? ' named ' + name : '') + '.';
        }
        if (purpose && purpose !== name) line += ' Primary use: ' + purpose + '.';
        if (r.type === 'video' && r.useEmbeddedAudio) line += ' Its synchronized source audio is explicitly enabled.';
        if (r.type === 'audio' && r.speakerId) line += ' Bind voice identity to (' + r.speakerId + ').';
        return line;
    }).join('\n');
    if (isReferenceMode) parts.push('subject_definitions:\n' + (subj || '  N/A'));
    if (isReferenceMode) {
        var roles = mediaRefs.map(function(r) { return r.role || defaultMediaRole(r.type, r.kind); });
        var taskType = roles.indexOf('edit_source') >= 0 ? 'video editing' :
            (roles.indexOf('continuation_source') >= 0 ? 'video continuation' :
            (roles.some(function(r) { return ['first_frame','last_frame','keyframe','storyboard'].indexOf(r) >= 0; }) ? 'keyframe completion' :
            (mediaRefs.some(function(r) { return r.type === 'audio' && ['fully_copy','partially_copy'].indexOf(r.retention) >= 0; }) ? 'audio reuse' :
            (mediaRefs.some(function(r) { return r.type === 'audio'; }) ? 'audio reference' : 'reference generation'))));
        var summaryText = fd.replace(/^integrated_multimodal_description:\s*/i, '').trim() ||
            'Generate the requested scene while applying each reference only to its declared primary use.';
        parts.push('summary:\n  Task type: ' + taskType + '. ' + summaryText);
    }
    subjectNumber = 0;
    var ret = mediaRefs.map(function(r) {
        var tag = mediaTagFor(r, mediaRefs);
        var name = (r.name || '').trim();
        var nameTag = name ? ' (' + name + ')' : '';
        var role = r.role || defaultMediaRole(r.type, r.kind);
        var label = tag;
        if (subjectRoles[role]) { subjectNumber++; label = '<Subject ' + subjectNumber + '> [' + tag + ']'; }
        var line = '  ' + label + nameTag + ': ' + (r.retention || (r.type === 'audio' ? 'reference' : 'fully_preserved')) + '.';
        if (r.type === 'image' && (role === 'subject_person' || role === 'subject_animal' || role === 'subject_prop')) {
            line += ' Background: weak_reference; do not copy the reference-image background, keep only the declared subject design.';
        }
        return line;
    }).join('\n');
    if (isReferenceMode) parts.push('retention_analysis:\n' + (ret || '  N/A'));

    var activePreamble = stripDisabledTokens(scene, scene.preamble || '');
    var preamble = activePreamble.replace(/<d>[\s\S]*?<\/d>/g,'').replace(/\n{3,}/g,'\n\n').trim();
    var shots = scene.shots || [];
    if (shots.length) {
        // The script task may already contain [Shot N] blocks. Structured shot
        // rows are the editable authority after decomposition, so retain only
        // any setup text before the first block and avoid duplicate prompts.
        preamble = preamble.split(/^\s*\[Shot\s+\d+\]/im)[0].trim();
    }
    var shotTimings = buildShotTimings(scene, project.fps, false);
    var shotLines = shots.map(function(s, i) {
        var p = [];
        if (i > 0 && shotTimings[i]) p.push('At ' + shotTimings[i].startTimecode + ', the camera cuts to');
        if (s.framing) p.push(s.framing);
        if (s.title) p.push('a shot titled ' + s.title + '.');
        if (s.transitionIn) p.push('Transition in: ' + s.transitionIn + '.');
        p.push(s.content || '(no content)');
        if (s.intent) p.push('Narrative intent: ' + s.intent + '.');
        if (s.action) p.push('Action: ' + s.action + '.');
        if (s.camera) p.push('Camera: ' + s.camera + '.');
        if (s.lens) p.push('Lens/focus: ' + s.lens + '.');
        if (s.sound) p.push('Sound: ' + s.sound + '.');
        if (s.transitionOut) p.push('Transition out: ' + s.transitionOut + '.');
        return '[Shot ' + (i+1) + '] ' + p.join(' ');
    }).join('\n\n  ');
    var disabled = Array.isArray(scene.disabledTokens) ? scene.disabledTokens : [];
    var dialogueLanguage = (project.skill && project.skill.dialogueLanguage) || 'Chinese';
    var speakerIds = {};
    var dlgs = (scene.dialogues || []).filter(function(d) {
        return d && d.role && d.text && disabled.indexOf(buildDTag(d.role, d.text)) < 0;
    }).map(function(d) {
        if (!speakerIds[d.role]) speakerIds[d.role] = 'S' + (Object.keys(speakerIds).length + 1);
        var timePrefix = d.time ? ('At ' + d.time + ', ') : '';
        if (d.voiceover) {
            return timePrefix + d.role + ' (' + speakerIds[d.role] + ') says in an off-screen voiceover: <d>[' +
                dialogueLanguage + '] ' + d.text + "</d> while the on-screen character's lips remain completely closed.";
        }
        return timePrefix + d.role + ' (' + speakerIds[d.role] + ') says: <d>[' + dialogueLanguage + '] ' + d.text + '</d>';
    }).join('\n  ');
    var interactionDirective = buildInteractionDirective(project, scene);
    var pvDirective = buildPvDirective(project, scene);
    var timeline = [interactionDirective, pvDirective, preamble, shotLines, dlgs].filter(Boolean).join('\n\n') || 'N/A';
    if (isReferenceMode) {
        parts.push('detailed_description:\n  ' + timeline.replace(/\n/g, '\n  '));
    } else {
        var imageRefs = mediaRefs.filter(function(r) { return r.type === 'image'; });
        if (mode === 'I2V' && imageRefs.length) {
            var firstIndex = imageRefs.findIndex(function(r) { return r.role === 'first_frame'; });
            firstIndex = firstIndex < 0 ? 0 : firstIndex;
            parts.push('For the target video, at 0.00 seconds into the target video, <Picture ' +
                (firstIndex + 1) + '> (from [Shot 1]) is fully referenced.');
        } else if (mode === 'FL2V' && imageRefs.length >= 2) {
            var opening = imageRefs.findIndex(function(r) { return r.role === 'first_frame'; });
            var ending = imageRefs.findIndex(function(r) { return r.role === 'last_frame'; });
            opening = opening < 0 ? 0 : opening;
            ending = ending < 0 ? 1 : ending;
            parts.push('How the reference pictures align with the target video — Picture ' + (opening + 1) +
                ' (from Shot 1) aligns with the 0.00-second mark of the target video; Picture ' + (ending + 1) +
                ' (from Shot ' + Math.max(1, shots.length) + ') aligns with the ' + Number(secs).toFixed(2) +
                '-second mark of the target video.');
        } else if (mode === 'L2V' && imageRefs.length) {
            var lastOnly = imageRefs.findIndex(function(r) { return r.role === 'last_frame'; });
            lastOnly = lastOnly < 0 ? 0 : lastOnly;
            parts.push('How the reference pictures align with the target video — <Picture ' + (lastOnly + 1) +
                '> (from [Shot ' + Math.max(1, shots.length) + ']) aligns with the ' + Number(secs).toFixed(2) +
                '-second mark of the target video.');
        }
        var foundation = fd.replace(/^\s*integrated_multimodal_description\s*:\s*/i, '').trim();
        var integrated = [foundation, timeline].filter(Boolean).join('\n\n');
        parts.push('integrated_multimodal_description:\n  ' + integrated.replace(/\n/g, '\n  '));
    }
    var sounds = shots.map(function(s) { return s.sound; }).filter(Boolean).join(', ');
    parts.push('overall_soundscape:\n  ' + (sounds || project.globalSoundscape || 'N/A'));
    var music = project.globalMusic || scene.music || '';
    parts.push('non_diegetic_music:\n  ' + (music || 'N/A'));
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
            dirty: false,
            skillBatch: {
                active: false, stopRequested: false, batchId: '', requestId: '',
                sceneIds: [], cursor: 0, completed: 0, failed: 0,
                currentSceneId: null, status: '', lastError: '', finalQueueSubmitted: false
            },
            directorLibrary: {
                items: [], loading: false, error: '', source: 'eagle',
                path: '', fallbackReason: '', editorOpen: false, saving: false,
                inference: false,
                draft: { id:'', name:'', category:'video_to_image_editing', tasks:['script','shots'], tagsText:'', content:'', filmstrip:[] }
            }
        });

        // Three-column editor layout.  Ratios, rather than absolute pixels,
        // keep the user's arrangement useful when the H3 node itself is
        // resized or opened by the other ComfyUI renderer.
        var H3_COLUMN_LAYOUT_PROPERTY = 'eagle_h3_column_layout';
        var H3_COLUMN_LAYOUT_VERSION = 1;
        var H3_COLUMN_SPLITTER_WIDTH = 8;
        var H3_DEFAULT_COLUMN_RATIOS = [300 / 1280, 640 / 1280, 340 / 1280];
        var H3_MIN_COLUMN_RATIOS = [0.14, 0.30, 0.16];
        var bodyRef = ref(null);
        var columnResizeActive = ref('');
        var activeColumnDrag = null;

        function normalizeColumnRatios(value) {
            var source = Array.isArray(value) ? value : H3_DEFAULT_COLUMN_RATIOS;
            var ratios = source.slice(0, 3).map(function(item) {
                var number = Number(item);
                return Number.isFinite(number) && number > 0 ? number : 0;
            });
            if (ratios.length !== 3 || ratios.some(function(item) { return item <= 0; })) {
                ratios = H3_DEFAULT_COLUMN_RATIOS.slice();
            }
            var total = ratios.reduce(function(sum, item) { return sum + item; }, 0) || 1;
            ratios = ratios.map(function(item) { return item / total; });

            // Invalid or hand-edited properties must never collapse a column.
            // Project the remaining share above the three minimums; a plain
            // clamp followed by normalisation could push a minimum below its
            // bound again.
            var minimumTotal = H3_MIN_COLUMN_RATIOS.reduce(function(sum, item) { return sum + item; }, 0);
            var extraBudget = Math.max(0, 1 - minimumTotal);
            var weights = ratios.map(function(item, index) {
                return Math.max(0, item - H3_MIN_COLUMN_RATIOS[index]);
            });
            var weightTotal = weights.reduce(function(sum, item) { return sum + item; }, 0);
            if (!(weightTotal > 0)) {
                weights = H3_DEFAULT_COLUMN_RATIOS.map(function(item, index) {
                    return Math.max(0, item - H3_MIN_COLUMN_RATIOS[index]);
                });
                weightTotal = weights.reduce(function(sum, item) { return sum + item; }, 0) || 1;
            }
            return H3_MIN_COLUMN_RATIOS.map(function(minimum, index) {
                return minimum + extraBudget * weights[index] / weightTotal;
            });
        }

        function savedColumnRatios() {
            var saved = props.node.properties && props.node.properties[H3_COLUMN_LAYOUT_PROPERTY];
            return normalizeColumnRatios(saved && (saved.ratios || saved.column_ratios || saved));
        }

        var columnRatios = ref(savedColumnRatios());
        var columnGridStyle = computed(function() {
            var ratios = normalizeColumnRatios(columnRatios.value);
            return {
                gridTemplateColumns:
                    'minmax(180px,' + ratios[0].toFixed(6) + 'fr) ' +
                    H3_COLUMN_SPLITTER_WIDTH + 'px ' +
                    'minmax(260px,' + ratios[1].toFixed(6) + 'fr) ' +
                    H3_COLUMN_SPLITTER_WIDTH + 'px ' +
                    'minmax(200px,' + ratios[2].toFixed(6) + 'fr)'
            };
        });

        function persistColumnLayout(commit) {
            var ratios = normalizeColumnRatios(columnRatios.value);
            columnRatios.value = ratios;
            props.node.properties = props.node.properties || {};
            props.node.properties[H3_COLUMN_LAYOUT_PROPERTY] = {
                version: H3_COLUMN_LAYOUT_VERSION,
                ratios: ratios.map(function(item) { return Number(item.toFixed(6)); })
            };
            props.node.setDirtyCanvas?.(true, true);
            if (commit) props.node.graph?.change?.();
        }

        function reloadColumnLayout() {
            columnRatios.value = savedColumnRatios();
        }
        props.node._h3ReloadColumnLayout = reloadColumnLayout;

        function stopColumnResize(commit, restoreStart) {
            if (!activeColumnDrag) return;
            var drag = activeColumnDrag;
            activeColumnDrag = null;
            drag.target.removeEventListener('pointermove', drag.move);
            drag.target.removeEventListener('pointerup', drag.finish);
            drag.target.removeEventListener('pointercancel', drag.cancel);
            drag.target.removeEventListener('lostpointercapture', drag.cancel);
            if (drag.target.hasPointerCapture?.(drag.pointerId)) {
                drag.target.releasePointerCapture(drag.pointerId);
            }
            document.body.style.cursor = drag.oldCursor;
            document.body.style.userSelect = drag.oldUserSelect;
            columnResizeActive.value = '';
            if (restoreStart) columnRatios.value = drag.startRatios.slice();
            if (commit) persistColumnLayout(true);
            else if (restoreStart) persistColumnLayout(false);
        }

        function beginColumnResize(boundary, event) {
            if (event.pointerType !== 'touch' && event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            stopColumnResize(false, false);

            var target = event.currentTarget;
            var layout = bodyRef.value;
            if (!target || !layout || !layout.getBoundingClientRect) return;
            var plan = layout.querySelector('.h3d-column-plan');
            var editor = layout.querySelector('.h3d-column-editor');
            var right = layout.querySelector('.h3d-column-right');
            if (!plan || !editor || !right) return;
            var widths = [plan, editor, right].map(function(element) {
                return Math.max(1, element.getBoundingClientRect().width);
            });
            var total = widths.reduce(function(sum, width) { return sum + width; }, 0);
            if (!(total > 0)) return;

            var pointerId = event.pointerId;
            var startX = event.clientX;
            var startRatios = normalizeColumnRatios(columnRatios.value);
            var oldCursor = document.body.style.cursor;
            var oldUserSelect = document.body.style.userSelect;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            columnResizeActive.value = boundary;
            target.setPointerCapture?.(pointerId);

            function move(moveEvent) {
                if (moveEvent.pointerId !== pointerId) return;
                moveEvent.preventDefault();
                moveEvent.stopPropagation();
                var delta = moveEvent.clientX - startX;
                var next = widths.slice();
                if (boundary === 'left') {
                    var leftAndCenter = widths[0] + widths[1];
                    var minLeft = total * H3_MIN_COLUMN_RATIOS[0];
                    var minCenter = total * H3_MIN_COLUMN_RATIOS[1];
                    next[0] = Math.max(minLeft, Math.min(leftAndCenter - minCenter, widths[0] + delta));
                    next[1] = leftAndCenter - next[0];
                } else {
                    var centerAndRight = widths[1] + widths[2];
                    var minimumCenter = total * H3_MIN_COLUMN_RATIOS[1];
                    var minRight = total * H3_MIN_COLUMN_RATIOS[2];
                    next[1] = Math.max(minimumCenter, Math.min(centerAndRight - minRight, widths[1] + delta));
                    next[2] = centerAndRight - next[1];
                }
                columnRatios.value = normalizeColumnRatios(next.map(function(width) { return width / total; }));
                persistColumnLayout(false);
            }

            function finish(finishEvent) {
                if (finishEvent && finishEvent.pointerId != null && finishEvent.pointerId !== pointerId) return;
                stopColumnResize(true, false);
            }

            function cancel(cancelEvent) {
                if (cancelEvent && cancelEvent.pointerId != null && cancelEvent.pointerId !== pointerId) return;
                stopColumnResize(false, true);
            }

            activeColumnDrag = {
                boundary: boundary,
                pointerId: pointerId,
                target: target,
                move: move,
                finish: finish,
                cancel: cancel,
                startRatios: startRatios,
                oldCursor: oldCursor,
                oldUserSelect: oldUserSelect
            };
            target.addEventListener('pointermove', move);
            target.addEventListener('pointerup', finish);
            target.addEventListener('pointercancel', cancel);
            target.addEventListener('lostpointercapture', cancel);
        }

        function nudgeColumnResize(boundary, event) {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            event.stopPropagation();
            var direction = event.key === 'ArrowLeft' ? -0.02 : 0.02;
            var ratios = normalizeColumnRatios(columnRatios.value);
            if (boundary === 'left') {
                var nextLeft = Math.max(H3_MIN_COLUMN_RATIOS[0], ratios[0] + direction);
                var nextCenter = ratios[0] + ratios[1] - nextLeft;
                if (nextCenter < H3_MIN_COLUMN_RATIOS[1]) return;
                ratios[0] = nextLeft;
                ratios[1] = nextCenter;
            } else {
                var center = ratios[1] + direction;
                var nextRight = ratios[1] + ratios[2] - center;
                if (center < H3_MIN_COLUMN_RATIOS[1] || nextRight < H3_MIN_COLUMN_RATIOS[2]) return;
                ratios[1] = center;
                ratios[2] = nextRight;
            }
            columnRatios.value = normalizeColumnRatios(ratios);
            persistColumnLayout(true);
        }

        onBeforeUnmount(function() {
            stopColumnResize(false, false);
            if (props.node._h3ReloadColumnLayout === reloadColumnLayout) {
                delete props.node._h3ReloadColumnLayout;
            }
        });

        // 分辨率预设联动（提取宽高写回project）
        function onSizePreset() {
            var val = store.project.sizePreset || '';
            var parts = val.split('|');
            if (parts.length >= 4) {
                store.project.aspect = parts[0];
                store.project.resolution = parts[1];
                store.project.width = snapDimension(parts[2]);
                store.project.height = snapDimension(parts[3]);
                store.project.sizeRatio = store.project.width / store.project.height;
            }
            markDirty(true);
        }

        function onCustomDimension(axis) {
            var width = snapDimension(store.project.width || 960);
            var height = snapDimension(store.project.height || 544);
            var ratio = Number(store.project.sizeRatio) || (width / height);
            if (store.project.sizeLocked) {
                if (axis === 'width') height = snapDimension(width / ratio);
                else width = snapDimension(height * ratio);
            }
            store.project.width = width;
            store.project.height = height;
            if (!store.project.sizeLocked) store.project.sizeRatio = width / height;
            store.project.sizePreset = 'custom';
            store.project.aspect = 'custom';
            store.project.resolution = (width * height / 1000000).toFixed(2) + 'MP';
            markDirty(true);
        }

        function toggleSizeLock() {
            store.project.sizeLocked = !store.project.sizeLocked;
            if (store.project.sizeLocked) {
                store.project.sizeRatio = Math.max(1 / 128, Number(store.project.width) / Math.max(1, Number(store.project.height)));
            }
            markDirty(true);
        }

        function onWorkflowType() {
            var interactionMode = store.project.workflowType === 'character_interaction';
            var pvMode = store.project.workflowType === 'character_pv';
            store.project.interaction.enabled = interactionMode;
            store.project.pv.enabled = pvMode;
            if (!interactionMode) {
                store.project.interaction.adultEnabled = false;
                store.project.interaction.adultTier = 'off';
            }
            var ids = store.project.skill.librarySkillIds || (store.project.skill.librarySkillIds = []);
            var pvSkillId = 'pro-v3-h3-character-pv-motion-graphics';
            var pvSkillIndex = ids.indexOf(pvSkillId);
            if (pvMode && pvSkillIndex < 0) ids.push(pvSkillId);
            if (!pvMode && pvSkillIndex >= 0) ids.splice(pvSkillIndex, 1);
            compileDirectorLibrary();
            markDirty(true);
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

        // Context Loop 的编辑器直接读取其 Plan 节点的 plan_json 控件，而不是
        // H3_CHAIN_PLAN 连线中的 Python 对象。暴露一个前端镜像，让 Eagle 的
        // 兼容桥在无需先 Queue 的情况下也能立即显示导演台当前场景。
        props.node._h3ContextLoopPlanJson = function() {
            var sourceProject = store.project || {};
            var fps = Math.max(1, Number(sourceProject.fps) || 24);
            var defaultSeconds = Math.max(0.1, Number(sourceProject.globalDuration) || 7);
            var defaultSteps = Math.max(1, Number(sourceProject.globalSteps) || 8);
            var shots = (store.scenes || []).map(function(scene, index) {
                var seconds = Math.max(0.1, Number(scene.defaultSeconds) || defaultSeconds);
                var delivered = Math.max(1, Math.round(seconds * fps));
                var contextFrames = index > 0 && sourceProject.anchorMode === 'head'
                    ? Math.max(0, Number(scene.contextLength) || Number(sourceProject.contextLength) || 0)
                    : 0;
                var length = h3LegalLength(delivered + contextFrames);
                var explicitSeed = Number(scene.seed);
                var seed = Number.isFinite(explicitSeed)
                    ? explicitSeed
                    : (Math.max(0, Number(sourceProject.baseSeed) || 0) + index + 1);
                return {
                    id: String(scene.id || ('scene_' + (index + 1))),
                    prompt: compilePrompt(sourceProject, scene),
                    length: length,
                    delivered_frames: delivered,
                    timeline_frames: delivered,
                    generated_duration_seconds: length / fps,
                    seed: String(seed),
                    steps: Math.max(1, Number(scene.defaultSteps) || defaultSteps),
                };
            });
            return JSON.stringify({
                // compilePrompt 已包含世界观与全局风格；这里留空可避免预览重复 prepend。
                prompt_prefix: '',
                defaults: {duration_seconds: defaultSeconds, steps: defaultSteps},
                shots: shots,
            }, null, 2);
        };

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

        function markDirty(immediate) { store.dirty = true; saveState(props.node, project, scenes, immediate); }
        props.node._h3FlushState = function() { saveState(props.node, project, scenes, true); };

        function compileDirectorLibrary() {
            var ids = (store.project.skill && store.project.skill.librarySkillIds) || [];
            var interaction = store.project.interaction || defaultInteraction();
            var interactionMode = store.project.workflowType === 'character_interaction' && interaction.enabled;
            var pvMode = store.project.workflowType === 'character_pv' && store.project.pv && store.project.pv.enabled;
            var adultReady = interaction.adultEnabled && interaction.adultTier !== 'off' &&
                interaction.adultSubjectsVerified && interaction.consentConfirmed;
            var active = store.directorLibrary.items.filter(function(skill) {
                if (ids.indexOf(skill.id) < 0) return false;
                if (skill.category === 'adult_content_safety' && !adultReady) return false;
                if (skill.category === 'character_pv_motion_graphics' && !pvMode) return false;
                if ((skill.category === 'character_performance' || skill.category === 'character_interaction_automation') && !interactionMode) return false;
                return true;
            });
            store.project.director_skill = active.map(function(skill) {
                var meta = [];
                if (skill.category) meta.push('category: ' + skill.category);
                if (Array.isArray(skill.tasks) && skill.tasks.length) meta.push('tasks: ' + skill.tasks.join(', '));
                return [
                    '## ' + (skill.name || 'Director Skill'),
                    meta.length ? '> ' + meta.join(' | ') : '',
                    String(skill.content || '').trim()
                ].filter(Boolean).join('\n\n');
            }).join('\n\n---\n\n');
        }

        async function loadDirectorLibrary() {
            if (store.directorLibrary.loading) return;
            store.directorLibrary.loading = true;
            store.directorLibrary.error = '';
            try {
                var response = await api.fetchApi('/eaglePromptPresets/director_skills');
                var text = await response.text();
                if (!text.trim()) throw new Error('技能库接口返回空响应');
                var data = JSON.parse(text);
                if (!response.ok || !data.success) throw new Error(data.error || ('HTTP ' + response.status));
                store.directorLibrary.items = Array.isArray(data.data) ? data.data : [];
                store.directorLibrary.source = data.effective_source || data.source || 'eagle';
                store.directorLibrary.path = data.storage_path || '';
                store.directorLibrary.fallbackReason = data.fallback_reason || '';
                var valid = {};
                store.directorLibrary.items.forEach(function(skill) { valid[skill.id] = true; });
                var ids = Array.isArray(store.project.skill.librarySkillIds) ? store.project.skill.librarySkillIds : [];
                store.project.skill.librarySkillIds = ids.filter(function(id) { return valid[id]; });
                compileDirectorLibrary();
                markDirty(true);
            } catch (error) {
                store.directorLibrary.error = error && error.message ? error.message : String(error);
            } finally {
                store.directorLibrary.loading = false;
            }
        }

        function toggleDirectorLibrarySkill(skill) {
            if (!skill || !skill.id) return;
            if (skill.category === 'adult_content_safety' && !(store.project.interaction && store.project.interaction.adultEnabled)) {
                flash('请先在“动态角色交互”中开启成人向技能并完成必要确认');
                return;
            }
            var ids = store.project.skill.librarySkillIds || (store.project.skill.librarySkillIds = []);
            var index = ids.indexOf(skill.id);
            if (index >= 0) ids.splice(index, 1); else ids.push(skill.id);
            compileDirectorLibrary();
            markDirty(true);
        }

        function onAdultToggle() {
            var interaction = store.project.interaction || defaultInteraction();
            var ids = store.project.skill.librarySkillIds || (store.project.skill.librarySkillIds = []);
            var adultSkillId = 'pro-v1-h3-r18-scale';
            var index = ids.indexOf(adultSkillId);
            if (interaction.adultEnabled) {
                if (index < 0) ids.push(adultSkillId);
            } else {
                if (index >= 0) ids.splice(index, 1);
                interaction.adultTier = 'off';
                interaction.adultSubjectsVerified = false;
                interaction.consentConfirmed = false;
            }
            compileDirectorLibrary();
            markDirty(true);
        }

        function onAdultSettingsChange() {
            compileDirectorLibrary();
            markDirty(true);
        }

        function editDirectorLibrarySkill(skill) {
            skill = skill || {};
            Object.assign(store.directorLibrary.draft, {
                id: skill.id || '',
                name: skill.name || '',
                category: skill.category || 'video_to_image_editing',
                tasks: Array.isArray(skill.tasks) && skill.tasks.length ? skill.tasks.slice() : ['script','shots'],
                tagsText: Array.isArray(skill.tags) ? skill.tags.join(', ') : '',
                content: skill.content || '',
                filmstrip: Array.isArray(skill.filmstrip) ? skill.filmstrip.slice() : []
            });
            store.directorLibrary.editorOpen = true;
        }

        function newDirectorLibrarySkill() {
            editDirectorLibrarySkill({
                name: '视频参考编辑 Skill', category: 'video_to_image_editing',
                tasks: ['script','shots'], tags: ['video-reference','identity-lock'], content: ''
            });
        }

        async function saveDirectorLibrarySkill() {
            var lib = store.directorLibrary;
            var draft = lib.draft || {};
            if (!String(draft.name || '').trim()) { flash('请填写 Skill 名称'); return; }
            if (!String(draft.content || '').trim()) { flash('请填写 Skill 内容'); return; }
            lib.saving = true; lib.error = '';
            try {
                var skill = {
                    id: draft.id || undefined,
                    name: String(draft.name).trim(),
                    category: String(draft.category || 'video_to_image_editing').trim(),
                    tasks: Array.isArray(draft.tasks) && draft.tasks.length ? draft.tasks.slice() : ['script','shots'],
                    tags: String(draft.tagsText || '').split(/[,，]/).map(function(item) { return item.trim(); }).filter(Boolean),
                    content: String(draft.content || '').trim(),
                    filmstrip: Array.isArray(draft.filmstrip) ? draft.filmstrip.slice() : []
                };
                var response = await api.fetchApi('/eaglePromptPresets/director_skills', {
                    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({skill:skill})
                });
                var text = await response.text();
                if (!text.trim()) throw new Error('技能库接口返回空响应');
                var data = JSON.parse(text);
                if (!response.ok || !data.success) throw new Error(data.error || ('HTTP ' + response.status));
                await loadDirectorLibrary();
                var saved = data.data || skill;
                editDirectorLibrarySkill(saved);
                flash('Skill 已保存到共享技能库');
            } catch (error) {
                lib.error = error && error.message ? error.message : String(error);
                flash('Skill 保存失败');
            } finally { lib.saving = false; }
        }

        async function deleteDirectorLibrarySkill() {
            var lib = store.directorLibrary;
            var id = lib.draft && lib.draft.id;
            if (!id) { lib.editorOpen = false; return; }
            if (!window.confirm('确定删除这个导演 Skill？')) return;
            lib.saving = true; lib.error = '';
            try {
                var response = await api.fetchApi('/eaglePromptPresets/director_skills/delete', {
                    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:id})
                });
                var text = await response.text();
                if (!text.trim()) throw new Error('技能库接口返回空响应');
                var data = JSON.parse(text);
                if (!response.ok || !data.success) throw new Error(data.error || ('HTTP ' + response.status));
                store.project.skill.librarySkillIds = (store.project.skill.librarySkillIds || []).filter(function(value) { return value !== id; });
                lib.editorOpen = false;
                await loadDirectorLibrary();
                flash('Skill 已删除');
            } catch (error) {
                lib.error = error && error.message ? error.message : String(error);
            } finally { lib.saving = false; }
        }

        nextTick(function() { loadDirectorLibrary(); });

        // 场景操作
        function addScene() {
            var id = maxId(store.scenes) + 1;
            store.scenes.push(createScene(id, store.project.globalDuration));
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
            var sh = createShot(maxId(s.shots) + 1);
            s.shots.push(sh);
            normalizeSceneShotTimes(s, store.project.fps, true);
            markDirty();
        }
        function removeShot(id) {
            var s = currentScene.value; if (!s) return;
            s.shots = s.shots.filter(function(x) { return x.id !== id; });
            normalizeSceneShotTimes(s, store.project.fps, false); markDirty();
        }
        function autoAssignTimes() {
            var s = currentScene.value; if (!s || !s.shots.length) return;
            normalizeSceneShotTimes(s, store.project.fps, true);
            markDirty(); flash('已按 ' + (Number(store.project.fps) || 24) + ' fps 帧边界精确分配时间');
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
            if (['i2v','fl2v','l2v','r2v','rv2v'].indexOf(store.project.mode) !== -1) {
                var usedRefs = (store.project.mediaRefs || []).filter(function(r) { return r.type === 'image' && r.filename; }).length;
                if (!usedRefs) w.push('该模式通常需要参考图。');
                if (store.project.mode === 'fl2v' && usedRefs < 2) w.push('FL2VA 需要首帧和尾帧两张参考图。');
                if (store.project.mode === 'l2v' && usedRefs < 1) w.push('L2VA 需要一张尾帧参考图。');
            }
            var refs = (store.project.mediaRefs || []).filter(function(r) { return r && r.filename; });
            var limits = { image:9, video:3, audio:3 };
            var counts = { image:0, video:0, audio:0 };
            refs.forEach(function(r) {
                var kind = r.type || 'image';
                if (kind in counts) counts[kind]++;
                var duration = Number(r.duration) || 0;
                var start = Number(r.trimStart) || 0;
                var end = Number(r.trimEnd) || 0;
                if (start < 0 || end < 0 || (end > 0 && end <= start) || (duration > 0 && (start >= duration || end > duration + 0.01))) {
                    w.push('素材「' + (r.originalName || r.filename) + '」的裁剪区间无效。');
                }
                if (!r.role) w.push('素材「' + (r.originalName || r.filename) + '」尚未指定主要用途。');
                if (!String(r.purpose || '').trim()) w.push('素材「' + (r.originalName || r.filename) + '」建议补充用途说明。');
            });
            Object.keys(limits).forEach(function(kind) {
                if (counts[kind] > limits[kind]) w.push(kind + ' 素材超过端口上限 ' + limits[kind] + '。');
            });
            if (counts.image + counts.video + counts.audio > 12) w.push('混合参考素材超过 MiniMax H3 上限 12 个。');
            if (counts.audio && !counts.image && !counts.video) w.push('音频不能单独作为 H3 参考；请至少添加一张图片或一段视频。');
            if (['r2v','rv2v','v2v'].indexOf(store.project.mode) >= 0 && !refs.length) w.push('Ref2VA 模式至少需要一个参考素材。');
            if ((store.project.referencePolicy || 'warn') !== 'off') {
                var tagCounts = { picture:counts.image, video:counts.video, audio:counts.audio };
                var text = currentPreviewPage.value || '';
                var tagRe = /<(Picture|Video|Audio)\s+(-?\d+)>/gi, match;
                while ((match = tagRe.exec(text)) !== null) {
                    var available = tagCounts[match[1].toLowerCase()] || 0;
                    var index = Number(match[2]);
                    if (index < 1 || index > available) w.push(match[0] + ' 无对应素材（可用 ' + available + '）。');
                }
            }
            var duration = Number(sc && sc.defaultSeconds) || 0;
            if (duration < 4 || duration > 15) {
                w.push('[H3-E006] MiniMax H3 单段生成时长必须在 4–15 秒。');
            }
            var previousCut = 0;
            (sc && sc.shots || []).forEach(function(shot, shotIndex) {
                if ((Number(shot.estSeconds) || 0) > 15) {
                    w.push('[H3-E006] Shot ' + (shotIndex + 1) + ' 预估时长超过 15 秒。');
                }
                if (shotIndex === 0) return;
                var cut = parseTimecode(shot.time);
                if (cut == null || cut <= previousCut || cut >= duration) {
                    w.push('[H3-E005] Shot ' + (shotIndex + 1) + ' 切镜时间必须严格递增且小于场景时长。');
                } else {
                    var fps = Math.max(1, Math.round(Number(store.project.fps) || 24));
                    if (Math.abs(cut * fps - Math.round(cut * fps)) > 0.012) {
                        w.push('[H3-E005] Shot ' + (shotIndex + 1) + ' 切镜时间未对齐 ' + fps + ' fps 帧边界。');
                    }
                    previousCut = cut;
                }
            });
            return w;
        });

        function copyCompiled() {
            navigator.clipboard && navigator.clipboard.writeText(currentPreviewPage.value);
            flash('已复制当前场景编译提示词');
        }
        function copyParams() {
            var p = JSON.stringify({
                mode: store.project.mode,
                width: store.project.width,
                height: store.project.height,
                megapixels: Number((store.project.width * store.project.height / 1000000).toFixed(3)),
                fps: store.project.fps,
                scenes: store.scenes.length,
                editorial_seconds: totalDuration.value,
                delivered_frames: generationInfo.value.deliveredFrames,
                h3_generated_frames: generationInfo.value.rawFrames,
                h3_generated_seconds: generationInfo.value.generatedSeconds
            }, null, 2);
            navigator.clipboard && navigator.clipboard.writeText(p);
            flash('已复制参数');
        }

        var totalDuration = computed(function() {
            // defaultSeconds 是场景总时长；镜头只是对这段时长的内部划分。
            return store.scenes.reduce(function(a, s) {
                return a + (Number(s.defaultSeconds) || Number(store.project.globalDuration) || 7);
            }, 0);
        });
        var generationInfo = computed(function() {
            var fps = Math.max(1, Number(store.project.fps) || 24);
            var raw = 0;
            var delivered = 0;
            (store.scenes || []).forEach(function(scene, index) {
                var target = Math.max(1, Math.round((Number(scene.defaultSeconds) || Number(store.project.globalDuration) || 7) * fps));
                var context = index > 0 && store.project.anchorMode === 'head'
                    ? Math.max(0, Number(scene.contextLength) || Number(store.project.contextLength) || 0)
                    : 0;
                delivered += target;
                raw += h3LegalLength(target + context);
            });
            return { rawFrames: raw, deliveredFrames: delivered, generatedSeconds: raw / fps };
        });

        // ── 导演 Skill：手动「生成」按钮 ──
        function skillRequestWidget() {
            return (props.node.widgets || []).find(function(x) { return x.name === 'skill_request'; });
        }
        function applyPvCard(card) {
            if (!card || typeof card !== 'object') return;
            var pv = store.project.pv || (store.project.pv = defaultPv());
            ['theme','visualStyle','editGrammar','actionProfile','textTreatment','template','rhythm',
             'cutDensity','bpm','beatOffsetMs','reserveTitleSafeArea','allowVideoReference',
             'transitions','effects','creativeBrief','actionDirection','titleConcept'].forEach(function(key) {
                if (card[key] !== undefined) {
                    pv[key] = Array.isArray(card[key]) ? card[key].slice() : card[key];
                }
            });
            if (card.actionDirection) {
                var note = '抽卡动作方向：' + card.actionDirection;
                pv.notes = pv.notes && pv.notes.indexOf(note) < 0 ? (pv.notes + '\n' + note) : (pv.notes || note);
            }
            pv.selectedCardId = card.id || '';
            markDirty(true);
            flash('已应用 PV 创意卡：' + (card.name || card.theme || '未命名'));
        }
        function drawPvCards() {
            var pv = store.project.pv || (store.project.pv = defaultPv());
            if (pv.drawing || store.skillBatch.active) { flash('已有模型任务正在运行'); return; }
            var scene = currentScene.value;
            var widget = skillRequestWidget();
            if (!scene || !widget) { flash('当前场景或 skill_request 不可用'); return; }
            pv.drawing = true;
            pv.lastDrawSummary = '正在组合主题、动作、切镜、转场与特效…';
            var sk = store.project.skill || {};
            var request = {
                run:true, operation:'pv_draw', sceneId:scene.id,
                requestId:'h3pv-draw-' + Date.now(), tasks:[],
                temperature:(sk.temperature != null ? sk.temperature : 0.75),
                modelPref:sk.modelPref || 'local', modelMode:pv.modelMode || 'auto',
                drawMode:pv.drawMode || 'character_match', cardCount:Number(pv.drawCount) || 3,
                seed:(Number(store.project.baseSeed) || Date.now()) + (pv.history || []).length,
                creativeBrief:pv.creativeBrief || '', history:(pv.history || []).slice(),
                blockDownstream:true, releaseAfter:false
            };
            widget.value = JSON.stringify(request);
            if (typeof widget.callback === 'function') widget.callback(widget.value, widget, props.node);
            if (props.node.graph) props.node.graph.change();
            try {
                var queued = app.queuePrompt();
                if (queued && typeof queued.catch === 'function') queued.catch(function(error) {
                    pv.drawing = false;
                    pv.lastDrawSummary = '抽卡提交失败：' + (error && error.message ? error.message : String(error));
                    clearSkillRequest();
                });
            } catch (error) {
                pv.drawing = false;
                pv.lastDrawSummary = '抽卡提交失败：' + (error && error.message ? error.message : String(error));
                clearSkillRequest();
            }
        }
        function inferDirectorSkill() {
            var lib = store.directorLibrary;
            if (lib.inference || store.skillBatch.active) { flash('已有模型任务正在运行'); return; }
            var scene = currentScene.value;
            var widget = skillRequestWidget();
            if (!scene || !widget) { flash('当前场景或 skill_request 不可用'); return; }
            editDirectorLibrarySkill({
                name:'正在反推…', category:'video_to_image_editing', tasks:['script','shots'],
                tags:['video-reference','identity-lock'], content:'模型正在从当前场景提示词提炼可复用规则…'
            });
            lib.inference = true;
            lib.error = '';
            var skillConfig = store.project.skill || {};
            var request = {
                run:true, operation:'extract_skill', sceneId:scene.id,
                requestId:'h3skill-extract-' + Date.now(), tasks:[],
                temperature:0.25, modelPref:skillConfig.modelPref || 'local',
                sourcePrompt:currentPreviewPage.value || scene.preamble || '',
                hint:skillConfig.hint || '', blockDownstream:true, releaseAfter:false
            };
            widget.value = JSON.stringify(request);
            if (typeof widget.callback === 'function') widget.callback(widget.value, widget, props.node);
            if (props.node.graph) props.node.graph.change();
            try {
                var queued = app.queuePrompt();
                if (queued && typeof queued.catch === 'function') queued.catch(function(error) {
                    lib.inference = false;
                    lib.error = error && error.message ? error.message : String(error);
                    clearSkillRequest();
                });
            } catch (error) {
                lib.inference = false; lib.error = error && error.message ? error.message : String(error);
                clearSkillRequest();
            }
        }
        function finishSkillBatch(message, queueDownstream) {
            var batch = store.skillBatch;
            batch.active = false;
            batch.currentSceneId = null;
            batch.requestId = '';
            batch.status = message || ('已完成 ' + batch.completed + ' 个场景');
            flash(batch.status);
            // Skill 阶段的每次 Queue 都由 ExecutionBlocker 阻断下游。
            // 全部场景回填后必须再 Queue 一次空 skill_request，才能正式编译
            // Plan 并把数据交给 H3 条件/采样链。只允许一次，避免重复生成视频。
            if (queueDownstream && !batch.finalQueueSubmitted) {
                batch.finalQueueSubmitted = true;
                clearSkillRequest();
                markDirty(true);
                batch.status += ' · 正在提交完整 Plan';
                setTimeout(function() {
                    try {
                        var queued = app.queuePrompt();
                        if (queued && typeof queued.catch === 'function') {
                            queued.catch(function(error) {
                                batch.lastError = '完整 Plan 提交失败: ' +
                                    (error && error.message ? error.message : error);
                                flash(batch.lastError);
                            });
                        }
                    } catch (error) {
                        batch.lastError = '完整 Plan 提交失败: ' +
                            (error && error.message ? error.message : error);
                        flash(batch.lastError);
                    }
                }, 60);
            }
        }
        function submitSkillScene() {
            var batch = store.skillBatch;
            if (!batch.active) return;
            if (batch.stopRequested) {
                finishSkillBatch('已停止：完成 ' + batch.completed + '/' + batch.sceneIds.length + '，失败 ' + batch.failed);
                return;
            }
            if (batch.cursor >= batch.sceneIds.length) {
                finishSkillBatch('✓ 批量生成完成：' + batch.completed + '/' + batch.sceneIds.length + (batch.failed ? '，失败 ' + batch.failed : ''), true);
                return;
            }
            var sceneId = batch.sceneIds[batch.cursor];
            var scene = store.scenes.find(function(item) { return item.id === sceneId; });
            if (!scene) {
                batch.failed += 1; batch.cursor += 1;
                batch.lastError = '批量期间场景已被删除: ' + sceneId;
                submitSkillScene();
                return;
            }
            var sk = store.project.skill || {};
            var w = skillRequestWidget();
            if (!w) { batch.lastError = 'skill_request 端口缺失'; finishSkillBatch(batch.lastError); return; }
            markDirty(true);
            batch.currentSceneId = sceneId;
            batch.requestId = batch.batchId + ':' + batch.cursor + ':' + Date.now();
            batch.status = '正在生成场景 ' + (batch.cursor + 1) + '/' + batch.sceneIds.length + '：' + (scene.title || '未命名');
            var req = {
                run: true,
                sceneId: sceneId,
                requestId: batch.requestId,
                batchId: batch.batchId,
                batchIndex: batch.cursor,
                batchTotal: batch.sceneIds.length,
                mergeMode: sk.mergeMode || 'overwrite',
                tasks: (sk.tasks || []).slice(),
                temperature: (sk.temperature != null ? sk.temperature : 0.7),
                modelPref: sk.modelPref || 'local',
                profile: sk.profile || 'balanced',
                skillPolicy: sk.skillPolicy || 'merge',
                promptLanguage: sk.promptLanguage || 'en',
                dialogueLanguage: sk.dialogueLanguage || 'Chinese',
                hint: sk.hint || '',
                interaction: JSON.parse(JSON.stringify(store.project.interaction || defaultInteraction())),
                pv: JSON.parse(JSON.stringify(store.project.pv || defaultPv())),
                blockDownstream: !!getEagleSetting(EAGLE_SETTING_IDS.blockSkillDownstream, true),
                releaseAfter: !!getEagleSetting(EAGLE_SETTING_IDS.unloadAfterSkillBatch, true)
                    && batch.cursor === batch.sceneIds.length - 1
            };
            w.value = JSON.stringify(req);
            if (typeof w.callback === 'function') w.callback(w.value, w, props.node);
            if (props.node.graph) props.node.graph.change();
            flash(batch.status);
            try {
                var queued = app.queuePrompt();
                if (queued && typeof queued.catch === 'function') queued.catch(function(error) {
                    batch.lastError = '队列失败: ' + (error && error.message ? error.message : error);
                    batch.failed += 1; clearSkillRequest(); batch.cursor += 1;
                    setTimeout(submitSkillScene, 0);
                });
            } catch (err) {
                batch.lastError = '队列失败: ' + (err && err.message ? err.message : err);
                batch.failed += 1; clearSkillRequest(); batch.cursor += 1;
                setTimeout(submitSkillScene, 0);
            }
        }
        function generateSkill(scope) {
            var sk = store.project.skill || {};
            var tasks = sk.tasks || [];
            var automation = (store.project.interaction && store.project.interaction.automationEnabled) ||
                (store.project.pv && store.project.pv.enabled);
            if (!tasks.length && !automation) { flash('请先在「导演 Skill」选择要生成的任务（台本 / 分镜 / 台词）'); return; }
            if (store.skillBatch.active) { flash('已有生成任务进行中'); return; }
            var ids = scope === 'all'
                ? store.scenes.map(function(scene) { return scene.id; })
                : [store.currentSceneId];
            if (!ids.length) { flash('没有可生成的场景'); return; }
            Object.assign(store.skillBatch, {
                active:true, stopRequested:false,
                batchId:'h3skill-' + Date.now() + '-' + Math.random().toString(16).slice(2),
                requestId:'', sceneIds:ids, cursor:0, completed:0, failed:0,
                currentSceneId:null, status:'', lastError:'', finalQueueSubmitted:false
            });
            submitSkillScene();
        }
        function stopSkillGeneration() {
            if (!store.skillBatch.active) return;
            store.skillBatch.stopRequested = true;
            store.skillBatch.status = '正在停止，当前场景返回后不再继续…';
            flash(store.skillBatch.status);
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
            if (data.operation === 'pv_draw') {
                var pv = store.project.pv || (store.project.pv = defaultPv());
                pv.drawing = false;
                clearSkillRequest();
                if (data.error) {
                    pv.lastDrawSummary = data.error;
                    flash('PV 创意抽卡失败');
                    return;
                }
                pv.cards = Array.isArray(data.pvCards) ? data.pvCards : [];
                pv.history = Array.isArray(data.pvHistory) ? data.pvHistory.slice(-50) : (pv.history || []);
                pv.lastDrawSummary = data.pvSummary || '抽卡完成';
                if (data.selectedPv) applyPvCard(data.selectedPv);
                markDirty(true);
                return;
            }
            if (data.operation === 'extract_skill') {
                store.directorLibrary.inference = false;
                clearSkillRequest();
                if (data.error) {
                    store.directorLibrary.error = data.error;
                    flash('Skill 反推失败');
                    return;
                }
                var draft = data.skillDraft || {};
                editDirectorLibrarySkill(draft);
                flash('已生成 Skill 草稿，请检查后保存');
                return;
            }
            var batch = store.skillBatch;
            if (batch.active && data.batchId && data.batchId !== batch.batchId) return;
            if (batch.active && data.requestId && data.requestId !== batch.requestId) return;
            var scene = store.scenes.find(function(s) { return String(s.id) === String(data.sceneId); });
            if (!scene) {
                clearSkillRequest();
                batch.lastError = '拒绝回填：返回的 sceneId 不存在（' + data.sceneId + '）';
                if (batch.active) { batch.failed += 1; batch.cursor += 1; setTimeout(submitSkillScene, 0); }
                else flash(batch.lastError);
                return;
            }
            if (data.error) {
                clearSkillRequest();
                batch.lastError = '场景「' + (scene.title || data.sceneId) + '」生成出错: ' + data.error;
                if (batch.active) { batch.failed += 1; batch.cursor += 1; setTimeout(submitSkillScene, 0); }
                else flash(batch.lastError);
                return;
            }
            var mode = data.mergeMode || ((store.project.skill && store.project.skill.mergeMode) || 'overwrite');
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
                normalizeSceneShotTimes(scene, store.project.fps, false);
            }
            // 若只生成台本，从其 <d> 标签同步台词列表
            if (data.preamble != null && data.dialogues == null) {
                syncPreambleToDlg(scene);
            }
            if (data.memoryRecord && typeof data.memoryRecord === 'object') {
                var history = store.project.generationHistory || (store.project.generationHistory = []);
                history = history.filter(function(item) {
                    return item && String(item.sceneId) !== String(data.memoryRecord.sceneId);
                });
                history.push(data.memoryRecord);
                store.project.generationHistory = history.slice(-40);
            }
            markDirty(true);
            clearSkillRequest();
            if (batch.active) {
                batch.completed += 1; batch.cursor += 1;
                batch.status = '✓ 已完成 ' + batch.completed + '/' + batch.sceneIds.length + '：' + (scene.title || '未命名');
                setTimeout(submitSkillScene, 30);
            } else {
                flash('✓ 已回填（' + (data.transport === 'local' ? '本地模型' : 'API') + '）');
            }
        }
        props.node._h3ApplySkillResult = applySkillResult;

        // provide
        provide('h3store', store);
        provide('h3flash', flash);
        provide('h3preview', { pages: previewPages, sceneIndex: sceneIndex, currentPage: currentPreviewPage, wordCount: wordCount, warnings: warnings, copyCompiled: copyCompiled });
        provide('h3actions', {
            addScene: addScene, cloneScene: cloneScene, removeScene: removeScene, selectScene: selectScene, prevScene: prevScene, nextScene: nextScene,
            addShot: addShot, removeShot: removeShot, autoAssignTimes: autoAssignTimes,
            shotTiming: function(scene, index) { return buildShotTimings(scene, store.project.fps, false)[index] || {label:'—'}; },
            addDialogue: addDialogue, removeDialogue: removeDialogue,
            onDialogueInput: onDialogueInput, onPreambleInput: onPreambleInput,
            triggerUpload: triggerUpload, clearRef: clearRef, addRef: addRef,
            removeLastRef: removeLastRef, onRefDrop: onRefDrop,
            generateSkill: generateSkill, stopSkillGeneration: stopSkillGeneration,
            loadDirectorLibrary: loadDirectorLibrary,
            toggleDirectorLibrarySkill: toggleDirectorLibrarySkill,
            editDirectorLibrarySkill: editDirectorLibrarySkill,
            newDirectorLibrarySkill: newDirectorLibrarySkill,
            saveDirectorLibrarySkill: saveDirectorLibrarySkill,
            deleteDirectorLibrarySkill: deleteDirectorLibrarySkill,
            inferDirectorSkill: inferDirectorSkill,
            drawPvCards: drawPvCards,
            applyPvCard: applyPvCard,
            onAdultToggle: onAdultToggle,
            onAdultSettingsChange: onAdultSettingsChange,
            markDirty: markDirty, flash: flash, copyCompiled: copyCompiled, copyParams: copyParams
        });

        return {
            store: store, flashMsg: flashMsg, currentScene: currentScene,
            totalDuration: totalDuration, generationInfo: generationInfo,
            fileInput: fileInput, onFileChange: onFileChange,
            copyCompiled: copyCompiled, copyParams: copyParams,
            onSizePreset: onSizePreset, onCustomDimension: onCustomDimension,
            toggleSizeLock: toggleSizeLock, onWorkflowType: onWorkflowType,
            bodyRef: bodyRef, columnGridStyle: columnGridStyle,
            columnResizeActive: columnResizeActive,
            beginColumnResize: beginColumnResize,
            nudgeColumnResize: nudgeColumnResize
        };
    },
    template: `
<div class="h3d-root" :class="{'h3d-columns-resizing':!!columnResizeActive}">
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
    <div class="h3d-field"><label>项目类型</label>
      <select class="h3d-sel" v-model="store.project.workflowType" @change="onWorkflowType">
        <option value="ai_drama">AI 短剧</option><option value="character_interaction">动态角色交互</option>
        <option value="character_pv">角色 PV · 快闪特效</option>
      </select>
    </div>
    <div class="h3d-field"><label>任务</label>
      <select class="h3d-sel" v-model="store.project.mode">
        <option value="t2v">T2VA · 文生视频</option><option value="i2v">I2VA · 首帧图生视频</option>
        <option value="fl2v">FL2VA · 首帧+尾帧</option><option value="l2v">L2VA · 尾帧图生视频</option>
        <option value="r2v">Ref2VA · 全能参考</option>
        <option value="rv2v">Ref2VA · 主体+视频</option><option value="v2v">Ref2VA · 编辑/续写视频</option>
      </select>
    </div>
    <div class="h3d-field"><label>尺寸</label>
      <select class="h3d-sel" v-model="store.project.sizePreset" @change="onSizePreset">
        <optgroup label="9:16 竖屏">
          <option value="9:16|mp0.2|352|608">9:16 · 0.2MP (352×608)</option>
          <option value="9:16|mp0.3|416|736">9:16 · 0.3MP (416×736)</option>
          <option value="9:16|mp0.4|480|864">9:16 · 0.4MP (480×864)</option>
          <option value="9:16|mp0.5|544|960">9:16 · 0.5MP (544×960)</option>
          <option value="9:16|mp0.6|608|1056">9:16 · 0.6MP (608×1056)</option>
          <option value="9:16|mp0.7|640|1152">9:16 · 0.7MP (640×1152)</option>
          <option value="9:16|mp0.8|672|1216">9:16 · 0.8MP (672×1216)</option>
          <option value="9:16|mp0.9|736|1280">9:16 · 0.9MP (736×1280)</option>
          <option value="9:16|mp0.98|768|1344">9:16 · 0.98MP (768×1344)</option>
          <option value="9:16|mp1.0|768|1376">9:16 · 1.0MP (768×1376)</option>
          <option value="9:16|mp1.2|832|1504">9:16 · 1.2MP (832×1504)</option>
          <option value="9:16|mp1.5|928|1664">9:16 · 1.5MP (928×1664)</option>
          <option value="9:16|mp1.8|1024|1824">9:16 · 1.8MP (1024×1824)</option>
          <option value="9:16|mp2.0|1088|1920">9:16 · 2.0MP (1088×1920)</option>
        </optgroup>
        <optgroup label="16:9 横屏">
          <option value="16:9|mp0.2|608|352">16:9 · 0.2MP (608×352)</option>
          <option value="16:9|mp0.3|736|416">16:9 · 0.3MP (736×416)</option>
          <option value="16:9|mp0.4|864|480">16:9 · 0.4MP (864×480)</option>
          <option value="16:9|mp0.5|960|544">16:9 · 0.5MP (960×544)</option>
          <option value="16:9|mp0.6|1056|608">16:9 · 0.6MP (1056×608)</option>
          <option value="16:9|mp0.7|1152|640">16:9 · 0.7MP (1152×640)</option>
          <option value="16:9|mp0.8|1216|672">16:9 · 0.8MP (1216×672)</option>
          <option value="16:9|mp0.9|1280|736">16:9 · 0.9MP (1280×736)</option>
          <option value="16:9|mp0.98|1344|768">16:9 · 0.98MP (1344×768)</option>
          <option value="16:9|mp1.0|1376|768">16:9 · 1.0MP (1376×768)</option>
          <option value="16:9|mp1.2|1504|832">16:9 · 1.2MP (1504×832)</option>
          <option value="16:9|mp1.5|1664|928">16:9 · 1.5MP (1664×928)</option>
          <option value="16:9|mp1.8|1824|1024">16:9 · 1.8MP (1824×1024)</option>
          <option value="16:9|mp2.0|1920|1088">16:9 · 2.0MP (1920×1088)</option>
        </optgroup>
        <optgroup label="1:1 方形">
          <option value="1:1|mp0.5|704|704">1:1 · 0.5MP (704×704)</option>
          <option value="1:1|mp1.0|1024|1024">1:1 · 1.0MP (1024×1024)</option>
        </optgroup>
        <option value="custom">自定义宽高</option>
      </select>
    </div>
    <div v-if="store.project.sizePreset==='custom'" class="h3d-field" style="gap:4px">
      <label>宽×高</label>
      <input class="h3d-inp sm" type="number" min="32" max="4096" step="32" v-model.number="store.project.width" @change="onCustomDimension('width')" style="width:64px">
      <span style="color:var(--h3d-muted)">×</span>
      <input class="h3d-inp sm" type="number" min="32" max="4096" step="32" v-model.number="store.project.height" @change="onCustomDimension('height')" style="width:64px">
      <button class="h3d-btn sm" :title="store.project.sizeLocked?'锁定比例：改一边自动缩放另一边':'解锁：宽高独立'" @click="toggleSizeLock">{{ store.project.sizeLocked ? '🔗' : '🔓' }}</button>
    </div>
    <div class="h3d-field"><label>fps</label><input class="h3d-inp sm" type="number" min="8" max="60" v-model.number="store.project.fps" style="width:46px"></div>
    <span class="h3d-pill">剪辑 {{ totalDuration.toFixed(3) }}s/{{ generationInfo.deliveredFrames }}f · H3 {{ generationInfo.generatedSeconds.toFixed(3) }}s/{{ generationInfo.rawFrames }}f</span>
    <div class="h3d-spacer"></div>
    <span class="h3d-sync" :class="store.dirty?'dirty':''">{{ store.dirty ? '⚠ 待同步' : '✓ 已保存' }}</span>
    <button class="h3d-btn" @click="copyParams">📤 参数</button>
    <button class="h3d-btn primary" @click="copyCompiled">📋 复制提示词</button>
  </div>
  <div ref="bodyRef" class="h3d-body" :style="columnGridStyle">
    <plan-panel class="h3d-column-plan"></plan-panel>
    <div class="h3d-splitter" :class="{active:columnResizeActive==='left'}"
         role="separator" tabindex="0" aria-orientation="vertical" aria-label="调整规划栏与编辑栏宽度"
         title="拖拽调整规划栏与编辑栏比例"
         @pointerdown="beginColumnResize('left',$event)" @keydown="nudgeColumnResize('left',$event)"></div>
    <editor-panel class="h3d-column-editor"></editor-panel>
    <div class="h3d-splitter" :class="{active:columnResizeActive==='right'}"
         role="separator" tabindex="0" aria-orientation="vertical" aria-label="调整编辑栏与镜头栏宽度"
         title="拖拽调整编辑栏与镜头栏比例"
         @pointerdown="beginColumnResize('right',$event)" @keydown="nudgeColumnResize('right',$event)"></div>
    <right-panel class="h3d-column-right"></right-panel>
  </div>
  <div class="h3d-statusbar">
    <span v-if="flashMsg" style="color:var(--h3d-primary)">{{ flashMsg }}</span>
    <span>Scene {{ store.scenes.findIndex(s=>s.id===store.currentSceneId)+1 }}/{{ store.scenes.length }}</span>
    <span>{{ store.project.fps }}fps · 场景队列 {{ store.scenes.length }} 段</span>
  </div>
  <input type="file" ref="fileInput" style="display:none" accept="image/*" @change="onFileChange">
</div>`
});

// ─────────────────────────────────────────────────────────────────
// HighlightTextarea（原子标签富文本编辑框）
// ─────────────────────────────────────────────────────────────────
var HighlightTextarea = defineComponent({
    name: 'HighlightTextarea',
    props: {
        modelValue: { type: String, default: '' },
        placeholder: { type: String, default: '' },
        minHeight: { type: String, default: '' },
        flex: { type: Boolean, default: false },
        mediaItems: { type: Array, default: function() { return []; } },
        disabledTokens: { type: Array, default: function() { return []; } }
    },
    emits: ['update:modelValue', 'input', 'toggle-token'],
    setup: function(props, ctx) {
        var editor = ref(null);
        var internalValue = null;
        var TOKEN_RE = /<d>[\s\S]*?<\/d>|<(?:Picture|Video|Audio)\s+\d+>/gi;

        function canonicalMediaToken(value) {
            var match = /^<(Picture|Video|Audio)\s+(\d+)>$/i.exec(value || '');
            return match ? ('<' + match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase() + ' ' + match[2] + '>') : value;
        }
        function mediaForToken(value) {
            var wanted = canonicalMediaToken(value);
            for (var i = 0; i < props.mediaItems.length; i++) {
                if (mediaTagFor(props.mediaItems[i], props.mediaItems) === wanted) return props.mediaItems[i];
            }
            return null;
        }
        function isDisabled(value) { return (props.disabledTokens || []).indexOf(value) >= 0; }
        function createTokenElement(value) {
            var span = document.createElement('span');
            var isDialogue = /^<d>/i.test(value);
            var media = isDialogue ? null : mediaForToken(value);
            var type = media ? media.type : ((/^<Video/i.test(value)) ? 'video' : (/^<Audio/i.test(value) ? 'audio' : 'image'));
            span.className = 'h3d-atomic-token ' + (isDialogue ? 'dialogue' : ('media ' + type)) + (isDisabled(value) ? ' ignored' : '');
            span.contentEditable = 'false';
            span.dataset.h3Token = value;
            span.title = isDisabled(value) ? '已忽略，点击启用' : '已启用，点击忽略';
            if (media && media.type === 'image' && mediaUrl(media)) {
                var thumb = document.createElement('i');
                thumb.className = 'token-thumb';
                thumb.style.backgroundImage = 'url("' + String(mediaUrl(media)).replace(/"/g, '%22') + '")';
                span.appendChild(thumb);
            }
            var label = document.createElement('span');
            label.textContent = isDialogue ? ('💬 ' + value.replace(/^<d>|<\/d>$/gi, '')) : canonicalMediaToken(value);
            span.appendChild(label);
            var state = document.createElement('small');
            state.className = 'token-state';
            state.textContent = isDisabled(value) ? '忽略' : '启用';
            span.appendChild(state);
            return span;
        }
        function appendToken(root, value) {
            root.appendChild(createTokenElement(value));
        }
        function render(value) {
            var root = editor.value;
            if (!root) return;
            root.replaceChildren();
            var source = String(value == null ? '' : value);
            var offset = 0; var match;
            TOKEN_RE.lastIndex = 0;
            while ((match = TOKEN_RE.exec(source)) !== null) {
                if (match.index > offset) root.appendChild(document.createTextNode(source.slice(offset, match.index)));
                appendToken(root, match[0]);
                offset = match.index + match[0].length;
            }
            if (offset < source.length) root.appendChild(document.createTextNode(source.slice(offset)));
        }
        function serializeNode(node, isRoot) {
            if (!node) return '';
            if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
            if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
            if (node.nodeType === Node.ELEMENT_NODE && node.dataset && node.dataset.h3Token) return node.dataset.h3Token;
            if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') return '\n';
            var out = '';
            Array.prototype.forEach.call(node.childNodes || [], function(child) { out += serializeNode(child, false); });
            if (!isRoot && node.nodeType === Node.ELEMENT_NODE && /^(DIV|P)$/i.test(node.tagName) && !out.endsWith('\n')) out += '\n';
            return out;
        }
        function serialize() { return serializeNode(editor.value, true).replace(/\u00a0/g, ' '); }
        function commit() {
            var value = serialize();
            internalValue = value;
            ctx.emit('update:modelValue', value);
            ctx.emit('input', value);
            return value;
        }
        function rangeInsideEditor(range) {
            return !!(range && editor.value && editor.value.contains(range.commonAncestorContainer));
        }
        function insertPlain(value) {
            var root = editor.value;
            if (!root) return;
            root.focus();
            var selection = window.getSelection();
            var range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
            if (!rangeInsideEditor(range)) {
                range = document.createRange();
                range.selectNodeContents(root); range.collapse(false);
            }
            range.deleteContents();
            var node = document.createTextNode(String(value || ''));
            range.insertNode(node);
            range.setStartAfter(node); range.collapse(true);
            selection.removeAllRanges(); selection.addRange(range);
        }
        function insertText(value) {
            if (!editor.value) return;
            var selection = window.getSelection();
            var range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
            var serialized = serialize();
            var leftSpace = serialized && !/\s$/.test(serialized) ? ' ' : '';
            if (rangeInsideEditor(range)) {
                var before = range.cloneRange();
                before.selectNodeContents(editor.value); before.setEnd(range.startContainer, range.startOffset);
                var prior = serializeNode(before.cloneContents(), true);
                leftSpace = prior && !/\s$/.test(prior) ? ' ' : '';
            }
            editor.value.focus();
            if (!rangeInsideEditor(range)) {
                range = document.createRange();
                range.selectNodeContents(editor.value); range.collapse(false);
            }
            range.deleteContents();
            var fragment = document.createDocumentFragment();
            if (leftSpace) fragment.appendChild(document.createTextNode(leftSpace));
            fragment.appendChild(createTokenElement(value));
            var tail = document.createTextNode(' ');
            fragment.appendChild(tail);
            range.insertNode(fragment);
            range.setStartAfter(tail); range.collapse(true);
            selection.removeAllRanges(); selection.addRange(range);
            commit();
        }
        function onInput() { commit(); }
        function onBeforeInput(event) {
            if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
                event.preventDefault(); insertPlain('\n'); commit();
            }
        }
        function onPaste(event) {
            event.preventDefault();
            insertPlain((event.clipboardData && event.clipboardData.getData('text/plain')) || '');
            commit();
        }
        function onTokenClick(event) {
            var token = event.target && event.target.closest ? event.target.closest('[data-h3-token]') : null;
            if (!token || !editor.value.contains(token)) return;
            event.preventDefault(); event.stopPropagation();
            ctx.emit('toggle-token', token.dataset.h3Token || '');
        }
        function onBlur() { render(props.modelValue || serialize()); }

        nextTick(function() { render(props.modelValue || ''); });
        watch(function() { return props.modelValue; }, function(value) {
            if (internalValue === value) { internalValue = null; return; }
            nextTick(function() { render(value || ''); });
        });
        watch(function() { return [props.mediaItems, props.disabledTokens]; }, function() {
            nextTick(function() { render(props.modelValue || ''); });
        }, { deep:true });
        ctx.expose({ insertText: insertText, focus: function() { if (editor.value) editor.value.focus(); } });
        var wrapStyle = computed(function() {
            var s = {};
            if (props.minHeight) s.minHeight = props.minHeight;
            if (props.flex) s.flex = '1';
            return s;
        });
        return { editor:editor, onInput:onInput, onBeforeInput:onBeforeInput, onPaste:onPaste, onTokenClick:onTokenClick, onBlur:onBlur, wrapStyle:wrapStyle };
    },
    template: `
<div class="h3d-hl-wrap" :style="wrapStyle">
  <div class="h3d-atomic-editor" ref="editor" contenteditable="true" :data-placeholder="placeholder"
       @input="onInput" @beforeinput="onBeforeInput" @paste="onPaste" @click="onTokenClick"
       @blur="onBlur" @keydown.stop spellcheck="false"></div>
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
            return (s.defaultSeconds || 10);
        }
        function timeBarPct(s) {
            var d = sceneDuration(s);
            var cap = (store.project.globalDuration || 7);
            return Math.min(100, Math.round(d / cap * 100));
        }
        function estTokens(s) {
            var txt = (s.preamble || '') + (s.shots || []).map(function(x) { return x.content || ''; }).join(' ');
            return Math.round(txt.length / 3.2);
        }
        var totalDuration = computed(function() {
            return (store.scenes || []).reduce(function(a, s) { return a + sceneDuration(s); }, 0);
        });
        return {
            store: store, actions: actions, planOpen: planOpen,
            sceneDuration: sceneDuration, timeBarPct: timeBarPct, estTokens: estTokens,
            totalDuration: totalDuration, pvTransitionOptions: PV_TRANSITION_OPTIONS,
            pvEffectOptions: PV_EFFECT_OPTIONS
        };
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
    <div v-if="store.project.workflowType==='character_interaction'" class="h3d-card">
      <div class="h3d-card-title"><span>✨ 动态角色交互</span><span class="h3d-mini">素材驱动</span></div>
      <label class="h3d-row" style="gap:6px;cursor:pointer;margin-bottom:7px">
        <input type="checkbox" v-model="store.project.interaction.enabled" @change="actions.markDirty"> 启用角色交互编排
      </label>
      <div v-if="store.project.interaction.enabled" style="display:flex;flex-direction:column;gap:7px">
        <div class="h3d-grid2">
          <div class="h3d-row col"><label class="h3d-label">制作强度</label>
            <select class="h3d-sel" v-model="store.project.interaction.productionLevel" @change="actions.markDirty">
              <option value="S">S · 轻量微动</option><option value="SR">SR · 标准互动</option>
              <option value="SSR">SSR · 高级演出</option><option value="UR">UR · 展示级</option>
            </select>
          </div>
          <div class="h3d-row col"><label class="h3d-label">动态类型</label>
            <select class="h3d-sel" v-model="store.project.interaction.dynamicType" @change="actions.markDirty">
              <option value="auto">AI 自动匹配</option><option value="idle_loop">待机循环</option>
              <option value="expression_reaction">表情反应</option><option value="gesture">手势互动</option>
              <option value="dialogue_lipsync">对话口型</option><option value="action">角色动作</option>
              <option value="dance_performance">舞蹈表演</option><option value="transformation">变身</option>
              <option value="vfx_showcase">特效展示</option><option value="environment_interaction">环境互动</option>
              <option value="meme_loop">表情包循环</option>
            </select>
          </div>
        </div>
        <div class="h3d-row col"><label class="h3d-label">角色表现风格</label>
          <select class="h3d-sel" v-model="store.project.interaction.visualStyle" @change="actions.markDirty">
            <option value="auto">AI 自动匹配参考素材</option>
            <option value="live_action">真人 / 写实表演</option>
            <option value="anime">动漫 / 2D 表演</option>
          </select>
        </div>
        <div class="h3d-row col"><label class="h3d-label">输出方式</label>
          <select class="h3d-sel" v-model="store.project.interaction.outputMode" @change="actions.markDirty">
            <option value="single_clip">单段直出 · 不循环</option><option value="single_loop">单段无缝循环</option>
            <option value="optional_chain">可独立使用 + 可选拼接</option><option value="continuous_chain">连续拼接</option>
          </select>
        </div>
        <label class="h3d-row" style="gap:6px;cursor:pointer"><input type="checkbox" v-model="store.project.interaction.aiMotionAutofill" @change="actions.markDirty"> AI 自动补全动作、呼吸、眨眼与跟随运动</label>
        <label class="h3d-row" style="gap:6px;cursor:pointer"><input type="checkbox" v-model="store.project.interaction.allowVideoReference" @change="actions.markDirty"> 启用参考视频（高级功能，默认关闭）</label>
        <label class="h3d-row" style="gap:6px;cursor:pointer"><input type="checkbox" v-model="store.project.interaction.automationEnabled" @change="actions.markDirty"> 智能规划场景、特效、镜头与质检</label>
        <div v-if="store.project.interaction.automationEnabled" style="display:flex;flex-wrap:wrap;gap:5px 9px;padding-left:18px">
          <label class="h3d-mini"><input type="checkbox" v-model="store.project.interaction.autoScene" @change="actions.markDirty"> 场景</label>
          <label class="h3d-mini"><input type="checkbox" v-model="store.project.interaction.autoEffects" @change="actions.markDirty"> 特效</label>
          <label class="h3d-mini"><input type="checkbox" v-model="store.project.interaction.autoCamera" @change="actions.markDirty"> 镜头</label>
          <label class="h3d-mini"><input type="checkbox" v-model="store.project.interaction.autoQualityCheck" @change="actions.markDirty"> 连续性/循环质检</label>
        </div>
        <textarea class="h3d-textarea" style="min-height:48px" v-model="store.project.interaction.interactionIntent" @input="actions.markDirty" placeholder="互动意图：例如向观众挥手后害羞地移开视线，保持角色服装与配饰不变"></textarea>
        <div style="border-top:1px solid var(--h3d-bd);padding-top:7px">
          <label class="h3d-row" style="gap:6px;cursor:pointer"><input type="checkbox" v-model="store.project.interaction.adultEnabled" @change="actions.onAdultToggle"> 成人向技能（默认关闭）</label>
          <div v-if="store.project.interaction.adultEnabled" style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
            <select class="h3d-sel" v-model="store.project.interaction.adultTier" @change="actions.onAdultSettingsChange">
              <option value="off">请选择尺度</option><option value="S">S · 成年氛围</option>
              <option value="SR">SR · 成人时尚</option><option value="SSR">SSR · 含蓄写真</option><option value="UR">UR · 最高安全边界</option>
            </select>
            <label class="h3d-mini"><input type="checkbox" v-model="store.project.interaction.adultSubjectsVerified" @change="actions.onAdultSettingsChange"> 所有人物已明确核验为 18 岁以上</label>
            <label class="h3d-mini"><input type="checkbox" v-model="store.project.interaction.consentConfirmed" @change="actions.onAdultSettingsChange"> 所有亲密互动均自愿、清醒且可撤回</label>
          </div>
          <div class="h3d-hint" style="margin-top:5px">制作强度与成人尺度相互独立；关闭时强制全年龄输出。</div>
        </div>
      </div>
    </div>
    <div v-if="store.project.workflowType==='character_pv'" class="h3d-card">
      <div class="h3d-card-title"><span>⚡ 角色 PV · 类 AE 动效规划</span><span class="h3d-mini">生成底片 + 后期元数据</span></div>
      <label class="h3d-row" style="gap:6px;cursor:pointer;margin-bottom:7px">
        <input type="checkbox" v-model="store.project.pv.enabled" @change="actions.markDirty"> 启用角色 PV 编排
      </label>
      <div v-if="store.project.pv.enabled" style="display:flex;flex-direction:column;gap:8px">
        <div style="border:1px solid var(--h3d-bd);border-radius:8px;padding:8px;background:var(--h3d-bg2)">
          <div class="h3d-card-title" style="margin-bottom:6px"><span>🎴 AI 创意抽卡</span><span class="h3d-mini">主题 × 动作 × 切镜 × 后期</span></div>
          <textarea class="h3d-textarea" style="min-height:44px" v-model="store.project.pv.creativeBrief" @input="actions.markDirty" placeholder="创意简述：角色性格、主题、情绪、用途、必须出现或避开的动作"></textarea>
          <div class="h3d-grid2" style="margin-top:6px">
            <select class="h3d-sel" v-model="store.project.pv.drawMode" @change="actions.markDirty">
              <option value="character_match">角色动作匹配</option><option value="balanced">均衡探索</option><option value="surprise">惊喜随机</option>
            </select>
            <select class="h3d-sel" v-model="store.project.pv.modelMode" @change="actions.markDirty">
              <option value="auto">有模型则 AI 择优</option><option value="local_only">仅本地抽卡</option><option value="model_refine">模型精修（无模型回退）</option>
            </select>
          </div>
          <div class="h3d-row" style="gap:6px;margin-top:6px">
            <input class="h3d-inp sm" type="number" min="1" max="8" v-model.number="store.project.pv.drawCount" style="width:52px">
            <button class="h3d-btn primary" :disabled="store.project.pv.drawing" @click="actions.drawPvCards">{{ store.project.pv.drawing ? '组合中…' : '抽取创意方案' }}</button>
            <span class="h3d-mini">已记忆 {{ (store.project.pv.history||[]).length }} 次，自动避开近期重复</span>
          </div>
          <div v-if="store.project.pv.lastDrawSummary" class="h3d-hint" style="margin-top:6px">{{ store.project.pv.lastDrawSummary }}</div>
          <div v-if="(store.project.pv.cards||[]).length" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">
            <button v-for="card in store.project.pv.cards" :key="card.id" class="h3d-btn sm" :class="{primary:store.project.pv.selectedCardId===card.id}" @click="actions.applyPvCard(card)" :title="card.aiReason || card.actionDirection || ''">{{ card.name }}</button>
          </div>
        </div>
        <div class="h3d-grid2">
          <div class="h3d-row col"><label class="h3d-label">主题</label>
            <select class="h3d-sel" v-model="store.project.pv.theme" @change="actions.markDirty">
              <option value="auto">AI / 自动推断</option><option value="hero_origin">英雄起源</option><option value="neon_idol">霓虹偶像</option>
              <option value="fantasy_relic">奇幻遗物</option><option value="urban_chase">都市追逐</option><option value="dream_archive">梦境档案</option>
              <option value="dark_rival">暗黑宿敌</option><option value="festival_stage">庆典舞台</option><option value="tech_interface">科技界面</option>
              <option value="fashion_editorial">时尚编辑</option><option value="quiet_portrait">静谧肖像</option>
            </select>
          </div>
          <div class="h3d-row col"><label class="h3d-label">视觉风格</label>
            <select class="h3d-sel" v-model="store.project.pv.visualStyle" @change="actions.markDirty">
              <option value="auto">跟随参考素材</option><option value="anime_cel">动漫赛璐璐</option><option value="live_action_cinematic">真人电影感</option>
              <option value="graphic_comic">平面漫画</option><option value="y2k_digital">Y2K 数字</option><option value="retro_film">复古胶片</option>
              <option value="luxury_editorial">高级时尚</option><option value="minimal_monochrome">极简黑白</option><option value="holographic">全息科技</option><option value="ink_paper">水墨纸张</option>
            </select>
          </div>
        </div>
        <div class="h3d-grid2">
          <div class="h3d-row col"><label class="h3d-label">切镜语法</label>
            <select class="h3d-sel" v-model="store.project.pv.editGrammar" @change="actions.markDirty">
              <option value="auto">AI 自动匹配</option><option value="detail_to_hero">细节到英雄镜头</option><option value="match_on_action">动作匹配切</option>
              <option value="shape_match">形状匹配</option><option value="color_match">色彩匹配</option><option value="eyeline_bridge">视线桥接</option>
              <option value="beat_strobe">节拍插帧</option><option value="time_remap">时间重映射</option><option value="split_screen">分屏并置</option>
              <option value="freeze_smash">定格冲切</option><option value="foreground_wipe">前景遮挡切</option>
            </select>
          </div>
          <div class="h3d-row col"><label class="h3d-label">动作画像</label>
            <select class="h3d-sel" v-model="store.project.pv.actionProfile" @change="actions.markDirty">
              <option value="calm">沉静</option><option value="graceful">优雅</option><option value="energetic">活力</option>
              <option value="combat">战斗</option><option value="idol">偶像表演</option><option value="mysterious">神秘</option><option value="comedic">喜剧反应</option>
            </select>
          </div>
        </div>
        <div class="h3d-grid2">
          <div class="h3d-row col"><label class="h3d-label">PV 模板</label>
            <select class="h3d-sel" v-model="store.project.pv.template" @change="actions.markDirty">
              <option value="character_reveal">角色揭示 / Hero Reveal</option>
              <option value="kinetic_typography">动态排版 / Kinetic Type</option>
              <option value="image_flash">图像快闪 / Image Flash</option>
              <option value="mixed_pv">综合角色 PV</option>
              <option value="action_showcase">动作展示</option><option value="emotional_memory">情绪记忆</option><option value="fashion_editorial">时尚编辑</option>
            </select>
          </div>
          <div class="h3d-row col"><label class="h3d-label">节奏模式</label>
            <select class="h3d-sel" v-model="store.project.pv.rhythm" @change="actions.markDirty">
              <option value="beat_sync">卡点同步</option><option value="impact_accents">冲击重拍</option>
              <option value="smooth_cinematic">平滑电影感</option><option value="glitch_cut">故障快切</option>
              <option value="syncopated">切分节拍</option><option value="crescendo">渐强推进</option>
            </select>
          </div>
        </div>
        <div class="h3d-grid2">
          <div class="h3d-row col"><label class="h3d-label">剪辑密度</label>
            <select class="h3d-sel" v-model="store.project.pv.cutDensity" @change="actions.markDirty">
              <option value="sparse">稀疏 · 1–2 次 / 5s</option><option value="medium">均衡 · 3–5 次 / 5s</option>
              <option value="dense">密集 · 6–9 次 / 5s</option>
            </select>
          </div>
          <div class="h3d-row col"><label class="h3d-label">节拍</label>
            <div class="h3d-row"><input class="h3d-inp sm" type="number" min="40" max="240" v-model.number="store.project.pv.bpm" @input="actions.markDirty" style="width:74px"><span class="h3d-mini">BPM</span>
              <input class="h3d-inp sm" type="number" min="-2000" max="2000" v-model.number="store.project.pv.beatOffsetMs" @input="actions.markDirty" style="width:82px"><span class="h3d-mini">ms</span></div>
          </div>
        </div>
        <div class="h3d-row col"><label class="h3d-label">转场（可多选）</label>
          <div style="display:flex;flex-wrap:wrap;gap:5px 10px">
            <label v-for="item in pvTransitionOptions" :key="item[0]" class="h3d-mini"><input type="checkbox" :value="item[0]" v-model="store.project.pv.transitions" @change="actions.markDirty"> {{ item[1] }}</label>
          </div>
        </div>
        <div class="h3d-row col"><label class="h3d-label">特效层（可多选）</label>
          <div style="display:flex;flex-wrap:wrap;gap:5px 10px">
            <label v-for="item in pvEffectOptions" :key="item[0]" class="h3d-mini"><input type="checkbox" :value="item[0]" v-model="store.project.pv.effects" @change="actions.markDirty"> {{ item[1] }}</label>
          </div>
        </div>
        <div class="h3d-row col"><label class="h3d-label">文字后期方案</label>
          <select class="h3d-sel" v-model="store.project.pv.textTreatment" @change="actions.markDirty">
            <option value="safe_title">安全区单标题</option><option value="hero_nameplate">角色名牌</option>
            <option value="kinetic_words">节拍动效字</option><option value="subtitle_card">标题 + 副标题</option><option value="no_text">无文字</option>
          </select>
        </div>
        <div class="h3d-grid2">
          <input class="h3d-inp" v-model="store.project.pv.title" @input="actions.markDirty" placeholder="精确主标题（后期合成，不由 H3 绘制）">
          <input class="h3d-inp" v-model="store.project.pv.subtitle" @input="actions.markDirty" placeholder="副标题 / 角色名 / 标语">
        </div>
        <label class="h3d-row" style="gap:6px;cursor:pointer"><input type="checkbox" v-model="store.project.pv.reserveTitleSafeArea" @change="actions.markDirty"> 为文字预留安全区</label>
        <label class="h3d-row" style="gap:6px;cursor:pointer"><input type="checkbox" v-model="store.project.pv.allowVideoReference" @change="actions.markDirty"> 允许参考视频提供节奏、运镜与转场时序</label>
        <textarea class="h3d-textarea" style="min-height:48px" v-model="store.project.pv.notes" @input="actions.markDirty" placeholder="PV 方向：例如 5 秒角色立绘揭示，0.5 秒局部快闪，结尾定格角色名"></textarea>
        <div class="h3d-hint">H3 只生成干净且身份稳定的镜头底片；精确文字、闪白、故障、描边和转场写入 post_production 元数据，交给剪辑/特效节点执行。</div>
      </div>
    </div>
    <div class="h3d-card">
      <div class="h3d-collapse-hd" :class="{open:planOpen}" @click="planOpen=!planOpen">
        <span class="arr">▶</span> <span>全局参数</span>
      </div>
      <div v-show="planOpen" style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">context_length</span><input class="h3d-inp" v-model.number="store.project.contextLength" type="number" style="width:70px"></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">encode_mode</span><select class="h3d-sel" v-model="store.project.encodeMode"><option value="video">video</option><option value="frames">frames</option></select></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">anchor_mode</span><select class="h3d-sel" v-model="store.project.anchorMode"><option value="head">head</option><option value="before">before</option></select></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">crop</span><select class="h3d-sel" v-model="store.project.crop"><option value="disabled">disabled</option><option value="center">center</option></select></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">audio_mode</span><select class="h3d-sel" v-model="store.project.audioMode"><option value="generated_audio">generated_audio</option><option value="source_track">source_track</option><option value="source_plus_timeline">source_plus_timeline</option></select></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">music_context_length</span><input class="h3d-inp" v-model.number="store.project.audioContextLength" type="number" style="width:70px"></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">default_duration_seconds</span><input class="h3d-inp" v-model.number="store.project.globalDuration" type="number" step="0.5" style="width:70px"></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">default_steps</span><input class="h3d-inp" v-model.number="store.project.globalSteps" type="number" style="width:70px"></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">base_seed</span><input class="h3d-inp" v-model.number="store.project.baseSeed" type="number" style="width:70px"></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">segment_crf</span><input class="h3d-inp" v-model.number="store.project.segmentCrf" type="number" style="width:70px"></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">ref_max_megapixels</span><input class="h3d-inp" v-model.number="store.project.refMaxMegapixels" type="number" step="0.1" min="0.1" max="10" style="width:70px"></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">continuation</span><select class="h3d-sel" v-model="store.project.continuationMode"><option value="guide">guide</option><option value="masked_av">masked_av</option></select></div>
        <div class="h3d-row"><span class="h3d-label" style="min-width:130px">素材标签预检</span><select class="h3d-sel" v-model="store.project.referencePolicy"><option value="warn">警告</option><option value="strict">严格阻止</option><option value="off">关闭</option></select></div>
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
          <div class="h3d-row" style="margin-top:4px;gap:3px" @click.stop>
            <button v-for="seconds in [5,7,10,15]" :key="seconds" class="h3d-btn sm" :class="{primary:Number(s.defaultSeconds)===seconds}" @click="s.defaultSeconds=seconds;actions.markDirty()">{{ seconds }}s</button>
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
        var trimDraft = reactive({ id:'', type:'', filename:'', originalName:'', url:'', duration:0, start:0, end:0, current:0 });
        var trimFrames = ref([]);
        var trimFramesLoading = ref(false);
        var trimThumbRun = 0;
        var trimFps = computed(function() { return Math.max(1, Number(store.project.fps) || 24); });
        var trimFrameStep = computed(function() { return trimDraft.type === 'video' ? 1 / trimFps.value : 0.01; });
        var trimStartPct = computed(function() { return trimDraft.duration > 0 ? Math.max(0, Math.min(100, trimDraft.start / trimDraft.duration * 100)) : 0; });
        var trimEndPct = computed(function() { return trimDraft.duration > 0 ? Math.max(0, Math.min(100, trimDraft.end / trimDraft.duration * 100)) : 100; });
        var trimPlayheadPct = computed(function() { return trimDraft.duration > 0 ? Math.max(0, Math.min(100, trimDraft.current / trimDraft.duration * 100)) : 0; });
        var trimSelectedSeconds = computed(function() { return Math.max(0, trimDraft.end - trimDraft.start); });
        var trimStartFrame = computed(function() { return Math.round(trimDraft.start * trimFps.value); });
        var trimEndFrame = computed(function() { return Math.round(trimDraft.end * trimFps.value); });
        var trimSelectedFrames = computed(function() { return Math.max(0, trimEndFrame.value - trimStartFrame.value); });
        var trimRulerMarks = computed(function() {
            var marks = [];
            var count = 6;
            for (var i = 0; i <= count; i++) {
                var seconds = trimDraft.duration * i / count;
                marks.push({ pct:i / count * 100, label:formatTrimTime(seconds) });
            }
            return marks;
        });
        var mediaItems = computed(function() { return store.project.mediaRefs || []; });
        var mediaInputAccept = computed(function() {
            return projectAllowsVideoReferences(store.project)
                ? 'image/*,video/*,audio/*'
                : 'image/*,audio/*';
        });
        var mediaErrors = reactive({});
        var inputPickerOpen = ref(false);
        var inputImages = ref([]);
        var inputQuery = ref('');
        var inputLoading = ref(false);
        var inputError = ref('');
        var inputHover = ref(null);
        var filteredInputImages = computed(function() {
            var query = inputQuery.value.trim().toLowerCase();
            var values = query ? inputImages.value.filter(function(item) {
                return String(item.path || '').toLowerCase().indexOf(query) >= 0;
            }) : inputImages.value;
            return values.slice(0, 500);
        });

        function formatDuration(value) {
            value = Math.max(0, Number(value) || 0);
            var minutes = Math.floor(value / 60);
            var seconds = value - minutes * 60;
            return minutes ? (minutes + ':' + seconds.toFixed(1).padStart(4, '0')) : (seconds.toFixed(1) + 's');
        }
        function formatTrimTime(value) {
            value = Math.max(0, Number(value) || 0);
            var minutes = Math.floor(value / 60);
            var seconds = value - minutes * 60;
            return String(minutes).padStart(2, '0') + ':' + seconds.toFixed(2).padStart(5, '0');
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
        function toggleAtomicToken(token) {
            if (!scene.value || !token) return;
            var disabled = scene.value.disabledTokens || (scene.value.disabledTokens = []);
            var index = disabled.indexOf(token);
            if (index >= 0) {
                disabled.splice(index, 1);
                actions.flash('已启用标签 ' + token);
            } else {
                disabled.push(token);
                actions.flash('已忽略标签 ' + token);
            }
            actions.markDirty(true);
        }
        function openMediaPicker() { if (mediaFileInput.value) mediaFileInput.value.click(); }
        function loadInputImages(force) {
            if (inputLoading.value || (inputImages.value.length && !force)) return Promise.resolve();
            inputLoading.value = true; inputError.value = '';
            return api.fetchApi('/h3_director/input_images').then(function(response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            }).then(function(data) {
                if (!data.success) throw new Error(data.error || '读取 input 失败');
                inputImages.value = Array.isArray(data.items) ? data.items : [];
                inputHover.value = inputImages.value[0] || null;
            }).catch(function(error) {
                inputError.value = error.message || String(error);
            }).finally(function() { inputLoading.value = false; });
        }
        function openInputPicker() { inputPickerOpen.value = true; loadInputImages(false); }
        function closeInputPicker() { inputPickerOpen.value = false; inputHover.value = null; }
        function addInputImage(inputItem) {
            if (!inputItem || !inputItem.path) return;
            if (!withinLimit('image')) { actions.flash('图片最多 9 张'); return; }
            var duplicate = mediaItems.value.some(function(item) {
                return item.type === 'image' && item.source === 'input' && item.filename === inputItem.path;
            });
            if (duplicate) { actions.flash('该 input 图片已在素材栏中'); return; }
            store.project.mediaRefs.push(createMediaRef({
                type:'image', filename:inputItem.path, originalName:inputItem.name,
                name:'', kind:'person', retention:'fully_preserved',
                source:'input', managed:false, duration:0, trimStart:0, trimEnd:0
            }));
            actions.markDirty();
            actions.flash('已从 input 添加 ' + inputItem.name);
        }
        function inputPreviewUrl(inputItem) {
            return mediaUrl(inputItem ? { filename:inputItem.path, source:'input' } : null);
        }
        function formatBytes(value) {
            var size = Math.max(0, Number(value) || 0);
            if (size < 1024) return size + ' B';
            if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
            return (size / 1024 / 1024).toFixed(1) + ' MB';
        }
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
        function postMediaFile(url, file) {
            var fd = new FormData();
            fd.append('file', file, file.name);
            return api.fetchApi(url, { method:'POST', body:fd }).then(function(response) {
                return response.text().then(function(text) {
                    var data = null;
                    try { data = text ? JSON.parse(text) : {}; }
                    catch (parseError) {
                        var invalid = new Error('服务器返回了非 JSON 响应（HTTP ' + response.status + '）');
                        invalid.status = response.status;
                        throw invalid;
                    }
                    if (!response.ok || !data.success) {
                        var failed = new Error(data.error || ('HTTP ' + response.status));
                        failed.status = response.status;
                        throw failed;
                    }
                    return data;
                });
            });
        }
        function legacyImageItem(data, file) {
            return {
                id: 'media-' + Date.now() + '-' + Math.random().toString(16).slice(2),
                type: 'image', filename: data.filename, originalName: file.name,
                name: '', kind: 'person', retention: 'fully_preserved',
                duration: 0, trimStart: 0, trimEnd: 0,
                source: data.source || 'input', managed: data.managed !== false, url: ''
            };
        }
        function uploadOne(file) {
            var type = inferFileType(file);
            if (!type) { actions.flash('不支持的素材格式: ' + file.name); return Promise.resolve(false); }
            if (type === 'video' && !projectAllowsVideoReferences(store.project)) {
                actions.flash('参考视频当前已关闭；请在“动态角色交互”或“角色 PV”项目设置中启用');
                return Promise.resolve(false);
            }
            if (!withinLimit(type)) { actions.flash(type === 'image' ? '图片最多 9 张' : (type === 'video' ? '视频最多 3 个' : '音频最多 3 个')); return Promise.resolve(false); }
            return postMediaFile('/h3_director/upload_media', file)
                .catch(function(error) {
                    // 前端资源可在不重启 ComfyUI 的情况下刷新，而新 Python 路由必须重启后才生效。
                    // 图片在新路由尚未注册时回退到旧接口，避免新版界面与旧后端组合后完全无法上传。
                    if (type === 'image' && (error.status === 404 || error.status === 405)) {
                        return postMediaFile('/h3_director/upload_ref', file).then(function(data) {
                            return { success:true, item:legacyImageItem(data, file) };
                        });
                    }
                    throw error;
                })
                .then(function(data) {
                    if (!data.success || !data.item) throw new Error(data.error || '上传失败');
                    store.project.mediaRefs.push(createMediaRef(data.item));
                    actions.markDirty();
                    return true;
                }).catch(function(err) {
                    actions.flash('上传失败 [' + file.name + ']: ' + (err.message || err));
                    return false;
                });
        }
        function uploadFiles(files) {
            var selected = Array.from(files || []);
            if (!selected.length) return Promise.resolve();
            var queue = Promise.resolve();
            var successCount = 0;
            selected.forEach(function(file) {
                queue = queue.then(function() { return uploadOne(file); })
                    .then(function(success) { if (success) successCount += 1; });
            });
            return queue.then(function() {
                if (successCount === selected.length) actions.flash('已添加 ' + successCount + ' 个素材');
                else if (successCount > 0) actions.flash('已添加 ' + successCount + ' 个，失败 ' + (selected.length - successCount) + ' 个');
            });
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
            store.scenes.forEach(function(sc) {
                sc.preamble = rewriteMediaTags(sc.preamble, before, after, '');
                sc.disabledTokens = (sc.disabledTokens || []).map(function(token) {
                    return rewriteMediaTags(token, before, after, '');
                }).filter(Boolean);
            });
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
            store.scenes.forEach(function(sc) {
                sc.preamble = rewriteMediaTags(sc.preamble, before, after, item.id);
                sc.disabledTokens = (sc.disabledTokens || []).map(function(token) {
                    return rewriteMediaTags(token, before, after, item.id);
                }).filter(Boolean);
            });
            if (item.filename && item.managed) api.fetchApi('/h3_director/media?filename=' + encodeURIComponent(item.filename), { method:'DELETE' }).catch(function(){});
            actions.markDirty();
        }
        function mediaBroken(item) { return !!(item && mediaErrors[item.id]); }
        function onMediaError(e, item) {
            if (item) mediaErrors[item.id] = true;
            if (e && e.target) e.target.style.display = 'none';
        }
        function onMediaLoad(e, item) {
            if (item && mediaErrors[item.id]) delete mediaErrors[item.id];
            if (e && e.target) e.target.style.display = '';
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
                url:mediaUrl(item),
                duration:duration, start:Math.max(0, Number(item.trimStart) || 0),
                end:Number(item.trimEnd) > 0 ? Number(item.trimEnd) : duration,
                current:Math.max(0, Number(item.trimStart) || 0)
            });
            trimFrames.value = [];
            trimOpen.value = true;
            if (item.type === 'video' && duration > 0) {
                nextTick(function() { generateTrimFrames(trimDraft.url, duration); });
            }
        }
        function waitForVideoEvent(video, eventName, timeout) {
            return new Promise(function(resolve, reject) {
                var timer = setTimeout(function() { cleanup(); reject(new Error(eventName + ' timeout')); }, timeout || 5000);
                function cleanup() { clearTimeout(timer); video.removeEventListener(eventName, done); video.removeEventListener('error', failed); }
                function done() { cleanup(); resolve(); }
                function failed() { cleanup(); reject(new Error('video load failed')); }
                video.addEventListener(eventName, done, { once:true });
                video.addEventListener('error', failed, { once:true });
            });
        }
        async function generateTrimFrames(url, duration) {
            var run = ++trimThumbRun;
            trimFramesLoading.value = true;
            var video = document.createElement('video');
            video.muted = true; video.preload = 'auto'; video.playsInline = true;
            try {
                video.src = url;
                if (video.readyState < 1) await waitForVideoEvent(video, 'loadedmetadata', 8000);
                if (video.readyState < 2) await waitForVideoEvent(video, 'loadeddata', 8000);
                var actualDuration = Number(video.duration) || duration || 0;
                if (actualDuration <= 0) return;
                var count = Math.max(7, Math.min(12, Math.round(actualDuration * 1.5)));
                var canvas = document.createElement('canvas');
                canvas.width = 150; canvas.height = 84;
                var context = canvas.getContext('2d', { alpha:false });
                var frames = [];
                for (var i = 0; i < count && run === trimThumbRun; i++) {
                    var target = Math.min(Math.max(0, actualDuration - 0.02), actualDuration * (i + 0.5) / count);
                    if (Math.abs((Number(video.currentTime) || 0) - target) > 0.001) {
                        var seekPromise = waitForVideoEvent(video, 'seeked', 3000);
                        video.currentTime = target;
                        await seekPromise;
                    }
                    context.fillStyle = '#090b0f'; context.fillRect(0, 0, canvas.width, canvas.height);
                    var scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
                    var width = video.videoWidth * scale, height = video.videoHeight * scale;
                    context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
                    frames.push(canvas.toDataURL('image/jpeg', 0.58));
                }
                if (run === trimThumbRun) trimFrames.value = frames;
            } catch (error) {
                console.warn('[EagleH3Director] timeline thumbnails failed:', error);
                if (run === trimThumbRun) trimFrames.value = [];
            } finally {
                video.removeAttribute('src');
                try { video.load(); } catch (_) {}
                if (run === trimThumbRun) trimFramesLoading.value = false;
            }
        }
        function onTrimLoadedMetadata(event) {
            var duration = Number(event.target && event.target.duration) || trimDraft.duration || 0;
            if (duration > 0) {
                trimDraft.duration = duration;
                if (!trimDraft.end || trimDraft.end > duration) trimDraft.end = duration;
                clampTrim();
                if (trimDraft.type === 'video' && !trimFrames.value.length) generateTrimFrames(trimDraft.url, duration);
            }
        }
        function snapTrimTime(value) {
            value = Number(value) || 0;
            if (trimDraft.type !== 'video') return Math.round(value * 100) / 100;
            return Math.round(value * trimFps.value) / trimFps.value;
        }
        function clampTrim(which) {
            var minGap = Math.min(trimFrameStep.value, trimDraft.duration || trimFrameStep.value);
            trimDraft.start = snapTrimTime(Math.max(0, Math.min(Number(trimDraft.start) || 0, Math.max(0, trimDraft.end - minGap))));
            trimDraft.end = snapTrimTime(Math.min(trimDraft.duration, Math.max(Number(trimDraft.end) || 0, trimDraft.start + minGap)));
            if (trimDraft.end > trimDraft.duration) trimDraft.end = trimDraft.duration;
            if (which === 'start' && trimPlayer.value) {
                trimPlayer.value.currentTime = trimDraft.start;
                trimDraft.current = trimDraft.start;
            }
        }
        function resetTrim() { trimDraft.start = 0; trimDraft.end = trimDraft.duration; trimDraft.current = 0; if (trimPlayer.value) trimPlayer.value.currentTime = 0; }
        function previewTrim() {
            if (!trimPlayer.value) return;
            trimPlayer.value.currentTime = trimDraft.start;
            trimDraft.current = trimDraft.start;
            var promise = trimPlayer.value.play();
            if (promise && promise.catch) promise.catch(function() {});
        }
        function onTrimTime() {
            if (!trimPlayer.value) return;
            trimDraft.current = Number(trimPlayer.value.currentTime) || 0;
            if (trimPlayer.value.currentTime >= trimDraft.end) trimPlayer.value.pause();
        }
        function seekTrimTimeline(event) {
            if (!trimPlayer.value || !trimDraft.duration) return;
            var rect = event.currentTarget.getBoundingClientRect();
            var ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
            var value = snapTrimTime(trimDraft.duration * ratio);
            trimPlayer.value.currentTime = value;
            trimDraft.current = value;
        }
        function markTrim(which) {
            if (!trimPlayer.value) return;
            var value = snapTrimTime(trimPlayer.value.currentTime);
            if (which === 'start') trimDraft.start = Math.min(value, trimDraft.end - trimFrameStep.value);
            else trimDraft.end = Math.max(value, trimDraft.start + trimFrameStep.value);
            clampTrim(which);
        }
        function saveTrim() {
            var item = mediaItems.value.find(function(x) { return x.id === trimDraft.id; });
            if (item) { item.trimStart = trimDraft.start; item.trimEnd = trimDraft.end; actions.markDirty(); }
            trimOpen.value = false;
        }
        function closeTrim() { ++trimThumbRun; if (trimPlayer.value) trimPlayer.value.pause(); trimOpen.value = false; trimFrames.value = []; trimFramesLoading.value = false; }

        return {
            store:store, actions:actions, scene:scene, tabs:tabs, mediaItems:mediaItems,
            mediaInputAccept:mediaInputAccept,
            projectAllowsVideoReferences:projectAllowsVideoReferences,
            scriptEditor:scriptEditor, mediaFileInput:mediaFileInput, trimPlayer:trimPlayer,
            dragIndex:dragIndex, trimOpen:trimOpen, trimDraft:trimDraft,
            trimFrames:trimFrames, trimFramesLoading:trimFramesLoading, trimFps:trimFps,
            trimFrameStep:trimFrameStep, trimStartPct:trimStartPct, trimEndPct:trimEndPct,
            trimPlayheadPct:trimPlayheadPct, trimSelectedSeconds:trimSelectedSeconds,
            trimStartFrame:trimStartFrame, trimEndFrame:trimEndFrame,
            trimSelectedFrames:trimSelectedFrames, trimRulerMarks:trimRulerMarks,
            inputPickerOpen:inputPickerOpen, inputImages:inputImages, inputQuery:inputQuery,
            inputLoading:inputLoading, inputError:inputError, inputHover:inputHover,
            filteredInputImages:filteredInputImages,
            formatDuration:formatDuration, selectedDuration:selectedDuration, mediaTagFor:mediaTagFor,
            mediaUrl:mediaUrl, mediaBroken:mediaBroken, onMediaError:onMediaError, onMediaLoad:onMediaLoad,
            insertMedia:insertMedia, toggleAtomicToken:toggleAtomicToken,
            openMediaPicker:openMediaPicker, openInputPicker:openInputPicker,
            closeInputPicker:closeInputPicker, loadInputImages:loadInputImages,
            addInputImage:addInputImage, inputPreviewUrl:inputPreviewUrl, formatBytes:formatBytes,
            onMediaFiles:onMediaFiles,
            onMediaWheel:onMediaWheel, onExternalDrop:onExternalDrop, onDragStart:onDragStart,
            onDropAt:onDropAt, removeMedia:removeMedia, onLoadedMetadata:onLoadedMetadata,
            openTrim:openTrim, clampTrim:clampTrim, resetTrim:resetTrim, previewTrim:previewTrim,
            onTrimLoadedMetadata:onTrimLoadedMetadata, onTrimTime:onTrimTime,
            seekTrimTimeline:seekTrimTimeline, markTrim:markTrim, formatTrimTime:formatTrimTime,
            saveTrim:saveTrim, closeTrim:closeTrim
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
              <div v-if="item.type==='image' && mediaBroken(item)" class="h3d-media-missing">图片不可用</div>
              <img v-if="item.type==='image' && !mediaBroken(item)" :src="mediaUrl(item)" alt="" @load="onMediaLoad($event,item)" @error="onMediaError($event,item)">
              <video v-else-if="item.type==='video'" :src="mediaUrl(item)" muted preload="metadata" @loadedmetadata="onLoadedMetadata($event,item)" @error="onMediaError($event,item)"></video>
              <div v-else-if="item.type==='audio'" class="audio-icon">♪<audio :src="mediaUrl(item)" preload="metadata" style="display:none" @loadedmetadata="onLoadedMetadata($event,item)" @error="onMediaError($event,item)"></audio></div>
              <span class="media-tag">{{ mediaTagFor(item, mediaItems) }}</span>
              <span v-if="item.type!=='image'" class="media-time">{{ formatDuration(selectedDuration(item)) }}</span>
              <div class="media-actions">
                <button v-if="item.type!=='image'" class="media-action" title="裁剪" @click.stop="openTrim(item)">✂</button>
                <button class="media-action" title="移除" @click.stop="removeMedia(item)">×</button>
              </div>
            </div>
            <button class="h3d-media-add" @click="openMediaPicker" @drop.stop.prevent="onExternalDrop">＋ 添加素材</button>
            <button class="h3d-media-add" @click="openInputPicker">▾ input 图片</button>
          </div>
          <input ref="mediaFileInput" type="file" :accept="mediaInputAccept" multiple style="display:none" @change="onMediaFiles">
          <highlight-textarea ref="scriptEditor" v-model="scene.preamble" :media-items="mediaItems"
                              :disabled-tokens="scene.disabledTokens || []" :flex="true" min-height="120px"
                              @input="actions.onPreambleInput" @toggle-token="toggleAtomicToken"
                              placeholder="自由文本 + [Shot N] 描述..."></highlight-textarea>
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
          <div class="h3d-media-dropzone" @click="openMediaPicker" @dragover.prevent @drop.stop.prevent="onExternalDrop">
            <div class="h3d-media-drop-actions">
              <button class="h3d-btn sm" @click.stop="openInputPicker">▾ input 图片</button>
              <button class="h3d-btn sm primary" @click.stop="openMediaPicker">＋ 添加素材</button>
            </div>
            <div class="drop-icon">⇩</div>
            <div class="drop-title">将图片或音频拖入这里<span v-if="projectAllowsVideoReferences(store.project)">，也可添加参考视频</span></div>
            <div class="drop-sub">AI 默认依据角色立绘、互动意图和场景自动补全动作，不要求参考视频。<br>物理类型决定端口，主要用途决定控制内容，保留策略决定复制强度；图片最多9张，视频/音频各3个，混合最多12个；音频不能单独使用。</div>
          </div>
          <div v-if="mediaItems.length" class="h3d-media-grid" @dragover.prevent @drop.prevent="onExternalDrop">
            <div v-for="(item,i) in mediaItems" :key="item.id" class="h3d-media-detail" draggable="true"
                 :class="{dragging:dragIndex===i}" @dragstart="onDragStart($event,i)" @dragend="dragIndex=-1"
                 @dragover.prevent @drop.stop.prevent="onDropAt($event,i)">
              <div class="h3d-media-detail-preview">
                <div v-if="item.type==='image' && mediaBroken(item)" class="h3d-media-missing">找不到素材文件</div>
                <img v-if="item.type==='image' && !mediaBroken(item)" :src="mediaUrl(item)" alt="" @load="onMediaLoad($event,item)" @error="onMediaError($event,item)">
                <video v-else-if="item.type==='video'" :src="mediaUrl(item)" muted controls preload="metadata" @loadedmetadata="onLoadedMetadata($event,item)" @error="onMediaError($event,item)"></video>
                <div v-else-if="item.type==='audio'" class="audio-icon">♪<audio :src="mediaUrl(item)" preload="metadata" style="display:none" @loadedmetadata="onLoadedMetadata($event,item)" @error="onMediaError($event,item)"></audio></div>
                <span class="h3d-tag" style="position:absolute;left:4px;top:4px">{{ mediaTagFor(item, mediaItems) }}</span>
              </div>
              <input class="h3d-inp sm" v-model="item.name" :placeholder="item.originalName || '素材名称'" @input="actions.markDirty" style="width:100%;margin-top:6px">
              <select v-if="item.type==='image'" class="h3d-sel" v-model="item.role" @change="actions.markDirty" style="width:100%;margin-top:5px">
                <option value="subject_person">主体 · 人物/角色</option><option value="subject_animal">主体 · 动物/生物</option>
                <option value="subject_prop">主体 · 物体/服装/道具</option><option value="scene_reference">场景/环境</option>
                <option value="style_reference">视觉风格</option><option value="action_reference">动作/姿态</option>
                <option value="expression_reference">表情</option><option value="composition_reference">构图</option>
                <option value="first_frame">首帧锚点</option><option value="last_frame">尾帧锚点</option>
                <option value="keyframe">关键帧</option><option value="storyboard">故事板</option>
              </select>
              <select v-else-if="item.type==='video'" class="h3d-sel" v-model="item.role" @change="actions.markDirty" style="width:100%;margin-top:5px">
                <option value="subject_reference">主体外观</option><option value="motion_reference">动作</option>
                <option value="camera_reference">运镜</option><option value="rhythm_reference">剪辑/节奏/时序</option>
                <option value="edit_source">编辑源视频</option><option value="continuation_source">续写起点</option>
                <option value="style_reference">视觉风格</option><option value="scene_reference">场景/环境</option>
              </select>
              <select v-else class="h3d-sel" v-model="item.role" @change="actions.markDirty" style="width:100%;margin-top:5px">
                <option value="voice_timbre">说话人音色</option><option value="full_track">整段复用</option>
                <option value="dialogue_content">对白内容</option><option value="music_style">音乐风格</option>
                <option value="rhythm_reference">节奏</option><option value="sound_effect">音效</option>
              </select>
              <select class="h3d-sel" v-model="item.retention" @change="actions.markDirty" style="width:100%;margin-top:5px">
                <template v-if="item.type==='audio'">
                  <option value="fully_copy">完整复制</option><option value="partially_copy">部分复制</option>
                  <option value="reference">参考</option><option value="weak_reference">弱参考</option>
                </template>
                <template v-else>
                  <option value="fully_preserved">完全保留</option><option value="partially_preserved">部分保留</option>
                  <option value="attribute_transfer">属性迁移</option><option value="weak_reference">弱参考</option>
                </template>
              </select>
              <input class="h3d-inp sm" v-model="item.purpose" placeholder="用途说明：绑定谁/控制什么（建议填写）" @input="actions.markDirty" style="width:100%;margin-top:5px">
              <input v-if="item.type==='audio' && item.role==='voice_timbre'" class="h3d-inp sm" v-model="item.speakerId" placeholder="绑定说话人，如 S1" @input="actions.markDirty" style="width:100%;margin-top:5px">
              <label v-if="item.type==='video'" class="h3d-row" style="gap:5px;margin-top:6px;font-size:10px;cursor:pointer">
                <input type="checkbox" v-model="item.useEmbeddedAudio" @change="actions.markDirty"> 启用该视频原声为音频参考
              </label>
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
              <span class="tm">{{ actions.shotTiming(scene,i).label }}</span>
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
              <div class="h3d-row col"><label class="h3d-label">画面提示词模板</label>
                <select class="h3d-sel" v-model="store.project.skill.promptLanguage">
                  <option value="en">English（H3 推荐）</option>
                  <option value="zh">中文</option>
                </select>
              </div>
              <div class="h3d-row col"><label class="h3d-label">台词文本语言</label>
                <select class="h3d-sel" v-model="store.project.skill.dialogueLanguage">
                  <option>Chinese</option><option>Chinese,Yue</option><option>English</option>
                  <option>Japanese</option><option>Korean</option><option>Spanish</option>
                  <option>French</option><option>German</option><option>Portuguese</option>
                  <option>Italian</option><option>Russian</option><option>Arabic</option>
                  <option>Vietnamese</option><option>Thai</option><option>Indonesian</option>
                  <option>Turkish</option><option>Dutch</option><option>Ukrainian</option>
                  <option>Polish</option><option>Romanian</option><option>Greek</option>
                  <option>Czech</option><option>Finnish</option><option>Hindi</option>
                  <option>Bulgarian</option><option>Danish</option><option>Hebrew</option>
                  <option>Malay</option><option>Persian</option><option>Slovak</option>
                  <option>Swedish</option><option>Croatian</option><option>Filipino</option>
                  <option>Hungarian</option><option>Norwegian</option><option>Slovenian</option>
                  <option>Catalan</option><option>Nynorsk</option><option>Tamil</option>
                  <option>Afrikaans</option>
                </select>
              </div>
            </div>
            <div class="h3d-hint" style="margin:-2px 0 8px">推荐：英文画面模板 + 中文台词。台词语言只控制生成文本；本地 H3 检查点的实际发音覆盖度取决于模型版本。</div>
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
            <div style="border:1px solid var(--h3d-bd);border-radius:6px;padding:7px;margin-bottom:8px;background:var(--h3d-bg2)">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
                <b style="font-size:11px">导演技能库</b>
                <span class="h3d-mini">已启用 {{ store.project.skill.librarySkillIds.length }} 项</span>
                <button class="h3d-btn sm" style="margin-left:auto" @click="actions.newDirectorLibrarySkill">＋ 新建</button>
                <button class="h3d-btn sm" :disabled="store.directorLibrary.inference || store.skillBatch.active" @click="actions.inferDirectorSkill">
                  {{ store.directorLibrary.inference ? '反推中…' : '↺ 从当前提示词反推' }}
                </button>
                <button class="h3d-btn sm" :disabled="store.directorLibrary.loading" @click="actions.loadDirectorLibrary">
                  {{ store.directorLibrary.loading ? '读取中…' : '刷新' }}
                </button>
              </div>
              <div v-if="store.directorLibrary.error" class="h3d-mini" style="color:var(--h3d-danger);margin-bottom:5px">{{ store.directorLibrary.error }}</div>
              <div v-else-if="store.directorLibrary.fallbackReason" class="h3d-mini" style="color:#d5a84b;margin-bottom:5px">已回退到 {{ store.directorLibrary.source }}：{{ store.directorLibrary.fallbackReason }}</div>
              <div v-if="store.directorLibrary.items.length" style="display:flex;flex-wrap:wrap;gap:5px">
                <span v-for="skill in store.directorLibrary.items" :key="skill.id" style="display:inline-flex;gap:2px">
                  <button class="h3d-btn sm" :class="{primary:store.project.skill.librarySkillIds.includes(skill.id)}"
                          :title="(skill.category || 'custom') + (skill.tasks && skill.tasks.length ? ' · ' + skill.tasks.join('/') : '')"
                          @click="actions.toggleDirectorLibrarySkill(skill)">
                    {{ store.project.skill.librarySkillIds.includes(skill.id) ? '✓ ' : '' }}{{ skill.name }}
                  </button>
                  <button class="h3d-btn sm" title="编辑 Skill" @click="actions.editDirectorLibrarySkill(skill)">✎</button>
                </span>
              </div>
              <div v-else-if="!store.directorLibrary.loading && !store.directorLibrary.error" class="h3d-mini">技能库为空，可直接在这里新建或反推。</div>
              <div v-if="store.directorLibrary.path" class="h3d-mini" :title="store.directorLibrary.path" style="margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ store.directorLibrary.source }} · {{ store.directorLibrary.path }}</div>
              <div v-if="store.directorLibrary.editorOpen" style="border-top:1px solid var(--h3d-bd);margin-top:8px;padding-top:8px">
                <div class="h3d-grid2" style="margin-bottom:6px">
                  <div class="h3d-row col"><label class="h3d-label">Skill 名称</label><input class="h3d-inp" v-model="store.directorLibrary.draft.name"></div>
                  <div class="h3d-row col"><label class="h3d-label">分类</label><input class="h3d-inp" v-model="store.directorLibrary.draft.category"></div>
                </div>
                <label class="h3d-label">标签（逗号分隔）</label>
                <input class="h3d-inp" style="width:100%;margin-bottom:6px" v-model="store.directorLibrary.draft.tagsText" placeholder="video-reference, identity-lock">
                <label class="h3d-label">Skill Markdown</label>
                <textarea class="h3d-textarea" style="min-height:150px" v-model="store.directorLibrary.draft.content"></textarea>
                <div class="h3d-hint" style="margin-top:5px">反推会分析当前已编译提示词和素材角色元数据；当前文本模型链路不会读取视频像素。草稿需确认后才会保存。</div>
                <div class="h3d-row" style="justify-content:flex-end;margin-top:7px">
                  <button class="h3d-btn sm danger" v-if="store.directorLibrary.draft.id" :disabled="store.directorLibrary.saving" @click="actions.deleteDirectorLibrarySkill">删除</button>
                  <button class="h3d-btn sm" @click="store.directorLibrary.editorOpen=false">关闭</button>
                  <button class="h3d-btn sm primary" :disabled="store.directorLibrary.saving || store.directorLibrary.inference" @click="actions.saveDirectorLibrarySkill">{{ store.directorLibrary.saving ? '保存中…' : '保存 Skill' }}</button>
                </div>
              </div>
            </div>
            <textarea class="h3d-textarea" style="min-height:60px;margin-bottom:8px" v-model="store.project.skill.hint" placeholder="给模型的额外指令（如：风格偏赛博朋克、主角 Nali 是龙女仆）"></textarea>
            <div v-if="store.skillBatch.active || store.skillBatch.status" style="margin:0 0 7px">
              <div class="h3d-row" style="justify-content:space-between"><span class="h3d-mini">{{ store.skillBatch.status }}</span><span class="h3d-mini">{{ store.skillBatch.completed }}/{{ store.skillBatch.sceneIds.length }}</span></div>
              <div class="h3d-bar"><i :style="{width:((store.skillBatch.completed + store.skillBatch.failed) / Math.max(1,store.skillBatch.sceneIds.length) * 100)+'%'}"></i></div>
              <div v-if="store.skillBatch.lastError" class="h3d-mini" style="color:var(--h3d-danger);margin-top:3px">{{ store.skillBatch.lastError }}</div>
            </div>
            <div class="h3d-row" style="gap:6px">
              <button class="h3d-btn" :disabled="store.skillBatch.active" @click="actions.generateSkill('current')" style="flex:1">🎬 生成当前</button>
              <button v-if="!store.skillBatch.active" class="h3d-btn primary" @click="actions.generateSkill('all')" style="flex:1">🎬 生成全部 {{ store.scenes.length }} 场景</button>
              <button v-else class="h3d-btn danger" @click="actions.stopSkillGeneration" style="flex:1">■ 生成后停止</button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
  <div v-if="inputPickerOpen" class="h3d-input-overlay" @click.self="closeInputPicker">
    <div class="h3d-input-dialog">
      <div class="h3d-input-head">
        <b>ComfyUI/input 图片</b>
        <input class="h3d-inp" v-model="inputQuery" placeholder="搜索图片名称或文件夹...">
        <button class="h3d-btn sm" @click="loadInputImages(true)">刷新</button>
        <button class="h3d-btn sm" @click="closeInputPicker">×</button>
      </div>
      <div class="h3d-input-body">
        <div class="h3d-input-preview">
          <template v-if="inputHover">
            <img :src="inputPreviewUrl(inputHover)" alt="">
            <b style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" :title="inputHover.name">{{ inputHover.name }}</b>
            <span class="h3d-mini" :title="inputHover.path">{{ inputHover.subfolder || 'input 根目录' }} · {{ formatBytes(inputHover.size) }}</span>
          </template>
          <div v-else class="empty">将鼠标移到右侧图片名称上查看预览</div>
        </div>
        <div class="h3d-input-list">
          <div v-if="inputLoading" class="h3d-empty">正在读取 ComfyUI/input…</div>
          <div v-else-if="inputError" class="h3d-empty" style="color:var(--h3d-danger)">{{ inputError }}</div>
          <button v-for="item in filteredInputImages" :key="item.path" class="h3d-input-item"
                  :class="{active:inputHover && inputHover.path===item.path}"
                  @mouseenter="inputHover=item" @focus="inputHover=item" @click="addInputImage(item)">
            <span>▧</span><span class="name">{{ item.name }}</span><span class="folder">{{ item.subfolder || 'input' }}</span><span>＋</span>
          </button>
          <div v-if="!inputLoading && !inputError && !filteredInputImages.length" class="h3d-empty">没有匹配图片</div>
          <div v-if="filteredInputImages.length>=500" class="h3d-mini" style="padding:6px;text-align:center">仅显示前500项，请继续输入关键词</div>
        </div>
      </div>
    </div>
  </div>
  <div v-if="trimOpen" class="h3d-trim-overlay" @click.self="closeTrim">
    <div class="h3d-trim-dialog">
      <div class="h3d-row" style="justify-content:space-between"><b>{{ trimDraft.type==='video' ? '视频裁剪' : '音频裁剪' }}</b><button class="h3d-btn sm" @click="closeTrim">×</button></div>
      <div class="h3d-trim-preview">
        <video v-if="trimDraft.type==='video'" ref="trimPlayer" :src="trimDraft.url" controls @loadedmetadata="onTrimLoadedMetadata" @timeupdate="onTrimTime"></video>
        <audio v-else ref="trimPlayer" :src="trimDraft.url" controls @loadedmetadata="onTrimLoadedMetadata" @timeupdate="onTrimTime"></audio>
      </div>
      <template v-if="trimDraft.type==='video'">
        <div class="h3d-trim-timeline">
          <div class="h3d-trim-ruler">
            <i v-for="mark in trimRulerMarks" :key="mark.pct" class="h3d-trim-tick" :style="{left:mark.pct+'%'}"><span>{{ mark.label }}</span></i>
          </div>
          <div class="h3d-trim-track" @click="seekTrimTimeline">
            <div class="h3d-trim-thumbs">
              <div v-if="trimFramesLoading && !trimFrames.length" class="h3d-trim-thumb empty">正在抽取时间轴缩略帧…</div>
              <div v-else-if="!trimFrames.length" class="h3d-trim-thumb empty">视频预览可用，缩略帧暂不可用</div>
              <div v-for="(frame,index) in trimFrames" :key="index" class="h3d-trim-thumb"><img :src="frame" alt=""></div>
            </div>
            <div class="h3d-trim-shade left" :style="{width:trimStartPct+'%'}"></div>
            <div class="h3d-trim-selection" :style="{left:trimStartPct+'%',width:Math.max(0,trimEndPct-trimStartPct)+'%'}"></div>
            <div class="h3d-trim-shade right" :style="{width:(100-trimEndPct)+'%'}"></div>
            <div class="h3d-trim-playhead" :style="{left:trimPlayheadPct+'%'}"></div>
            <input class="h3d-trim-range start" type="range" min="0" :max="trimDraft.duration" :step="trimFrameStep" v-model.number="trimDraft.start" @input.stop="clampTrim('start')">
            <input class="h3d-trim-range end" type="range" min="0" :max="trimDraft.duration" :step="trimFrameStep" v-model.number="trimDraft.end" @input.stop="clampTrim('end')">
          </div>
        </div>
        <div class="h3d-trim-values">
          <div class="h3d-trim-value"><label>入点</label><div class="line"><input class="h3d-inp time" type="number" min="0" :max="trimDraft.end" :step="trimFrameStep" v-model.number="trimDraft.start" @change="clampTrim('start')"><b>{{ trimStartFrame }} 帧</b></div></div>
          <div class="h3d-trim-value"><label>出点</label><div class="line"><input class="h3d-inp time" type="number" :min="trimDraft.start" :max="trimDraft.duration" :step="trimFrameStep" v-model.number="trimDraft.end" @change="clampTrim('end')"><b>{{ trimEndFrame }} 帧</b></div></div>
          <div class="h3d-trim-value"><label>选区</label><div class="line"><strong>{{ trimSelectedSeconds.toFixed(2) }}s</strong><b>{{ trimSelectedFrames }} 帧</b></div></div>
        </div>
        <div class="h3d-trim-tools">
          <button class="h3d-btn sm" @click="markTrim('start')">[ 设当前为入点</button>
          <button class="h3d-btn sm" @click="markTrim('end')">设当前为出点 ]</button>
          <span class="summary">播放头 {{ formatTrimTime(trimDraft.current) }} · {{ trimFps }} FPS</span>
        </div>
      </template>
      <template v-else>
        <div class="h3d-trim-ranges"><span>开始</span><input type="range" min="0" :max="trimDraft.duration" step="0.01" v-model.number="trimDraft.start" @input="clampTrim('start')"><b>{{ trimDraft.start.toFixed(2) }}s</b></div>
        <div class="h3d-trim-ranges"><span>结束</span><input type="range" min="0" :max="trimDraft.duration" step="0.01" v-model.number="trimDraft.end" @input="clampTrim('end')"><b>{{ trimDraft.end.toFixed(2) }}s</b></div>
      </template>
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
            <span class="tm">{{ actions.shotTiming(scene,i).label }}</span>
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
    async beforePromptQueued() {
        // Flush the 300 ms UI debounce before ComfyUI serializes widget values.
        // Without this, pressing Queue immediately after changing resolution or
        // duration can execute the previous state while the UI shows the new one.
        var nodes = (app.graph && (app.graph.nodes || app.graph._nodes)) || [];
        nodes.forEach(function(node) {
            if (node && typeof node._h3FlushState === 'function') node._h3FlushState();
        });
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        console.log('[EagleH3Director] beforeRegisterNodeDef:', nodeData && nodeData.name);
        if (nodeData.name !== 'EagleH3DirectorNode') return;
        console.log('[EagleH3Director] matched EagleH3DirectorNode, mounting...');

        var hiddenStateNames = new Set(['h3_state', 'scene_index', 'LLM_HINT', 'skill_request']);
        // Preview-oriented Eagle nodes share a predictable 960x720 starting
        // frame.  The three columns scroll internally and their split ratios
        // remain user controlled after creation.
        var H3_DEFAULT_NODE_SIZE = [960, 720];
        var H3_MIN_NODE_SIZE = [760, 560];
        var H3_NODE_CHROME_HEIGHT = 150;
        var H3_MIN_VIEWPORT_HEIGHT = 220;
        var H3_LAYOUT_VERSION = 4;
        var MAX_VIEWPORT_HEIGHT = 4096;
        var inputDefs = (nodeData && (nodeData.input || nodeData.inputs)) || {};
        ['required', 'optional'].forEach(function(groupName) {
            var group = inputDefs[groupName] || {};
            hiddenStateNames.forEach(function(name) {
                var definition = group[name];
                if (!Array.isArray(definition)) return;
                definition[1] = {
                    ...(definition[1] || {}),
                    hidden: true,
                    vueNode: 'never',
                    hideInPanel: true
                };
            });
        });

        var hideWidgets = function(node) {
            if (!node.widgets || !node.widgets.length) return false;
            var found = false;
            for (var i = 0; i < node.widgets.length; i++) {
                var w = node.widgets[i];
                if (hiddenStateNames.has(w.name)) {
                    w.type = 'hidden';
                    w.options = w.options || {};
                    Object.assign(w.options, { hidden: true, vueNode: "never", hideInPanel: true });
                    w.computeSize = function() { return [0, -4]; };
                    w.hidden = true;
                    w.draw = function() {};
                    found = true;
                }
            }
            if (found) {
                // Nodes 2.0 stores widgets in a shallow-reactive array. Nested
                // option mutations alone do not invalidate its parameter rows;
                // replacing the entries in-place makes visibility recalculate.
                if (typeof node.widgets.splice === 'function') {
                    var sameWidgets = node.widgets.slice();
                    node.widgets.splice.apply(node.widgets, [0, node.widgets.length].concat(sameWidgets));
                }
                node.setDirtyCanvas(true, true);
            }
            return found;
        };

        var scheduleHideWidgets = function(node) {
            (node._h3HideWidgetTimers || []).forEach(function(timer) { clearTimeout(timer); });
            hideWidgets(node);
            node._h3HideWidgetTimers = [0, 250, 500].map(function(delay) {
                return setTimeout(function() {
                    if (node._h3Init !== false) hideWidgets(node);
                }, delay);
            });
        };

        var orig = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            if (orig) orig.apply(this, arguments);
            if (this._h3Init) return;
            this._h3Init = true;

            // 新节点默认落在左栏首个场景卡片下方；已有工作流尺寸由 onConfigure 恢复。
            if (!this.size || this.size[0] < H3_MIN_NODE_SIZE[0] || this.size[1] < H3_MIN_NODE_SIZE[1]) {
                this.setSize(H3_DEFAULT_NODE_SIZE.slice());
            }

            var node = this;
            // Hide the serialized transport widgets before Nodes 2.0 creates
            // parameter rows for them.  ComfyUI may append widgets in more than
            // one pass, so repeat after both microtask and restore-time delays.
            scheduleHideWidgets(node);

            if (!document.getElementById('h3d-global-style')) {
                var s = document.createElement('style');
                s.id = 'h3d-global-style';
                s.textContent = H3D_CSS;
                document.head.appendChild(s);
            }

            var el = document.createElement('div');
            el.style.cssText = 'display:block;min-width:0;max-width:100%;overflow:hidden;position:relative;box-sizing:border-box;';
            var currentViewportHeight = H3_MIN_VIEWPORT_HEIGHT;

            var widget = this.addDOMWidget('h3_director_ui', 'div', el, {
                serialize: false,
                hideInPanel: true,
                // Nodes 2.0 measures DOM widgets independently of LiteGraph's
                // computeSize. Bound the viewport without feeding node height
                // back into the layout pass.
                getMinHeight: function() { return H3_MIN_VIEWPORT_HEIGHT; },
                getMaxHeight: function() { return MAX_VIEWPORT_HEIGHT; },
                getHeight: function() { return currentViewportHeight; }
            });
            widget.width = undefined;

            var applySize = function(size) {
                size = size || node.size || H3_DEFAULT_NODE_SIZE;
                var w = Math.max(700, Number(size[0] || H3_DEFAULT_NODE_SIZE[0]) - 20);
                // 内容区域可以缩小并在三栏内部滚动，不再反向把 LiteGraph 节点撑高。
                var h = Math.min(MAX_VIEWPORT_HEIGHT, Math.max(
                    H3_MIN_VIEWPORT_HEIGHT,
                    Number(size[1] || H3_DEFAULT_NODE_SIZE[1]) - H3_NODE_CHROME_HEIGHT
                ));
                currentViewportHeight = h;
                el.style.width = w + 'px';
                el.style.maxWidth = w + 'px';
                // Classic LiteGraph does not consistently resize the DOM host
                // when only a percentage height is used.  Keep the actual DOM
                // surface in lock-step with the measured widget height.
                el.style.height = h + 'px';
                return [w, h];
            };
            // Do not install an instance computeSize here.  ComfyUI's
            // DOMWidgetImpl supplies computeLayoutSize from getMin/MaxHeight;
            // leaving that contract intact makes this the growable widget in
            // both Classic and Nodes 2.0.  A fixed computeSize turns it into a
            // fixed-height slot and clips the node after the user stretches it.
            applySize(this.size);

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
                applySize(size);
            };
            this._h3ApplyNodeSize = applySize;
        };

        var onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function(info) {
            if (onConfigure) onConfigure.apply(this, arguments);
            var node = this;
            scheduleHideWidgets(node);
            // onNodeCreated 中 Vue 已挂载并暴露 _h3ReloadState；
            // 但 configure 在此之后才会把 workflow 保存的 widgets_values 写回 widget，
            // 因此必须在这里重新加载一次，否则刷新后节点会显示默认空状态。
            function doReload(attempts) {
                attempts = attempts || 0;
                if (node._h3ReloadState) {
                    node._h3ReloadState();
                    node._h3ReloadColumnLayout?.();
                } else if (attempts < 20) {
                    setTimeout(function() { doReload(attempts + 1); }, 50);
                } else {
                    console.warn('[EagleH3Director] onConfigure: _h3ReloadState not ready');
                }
            }
            doReload();
            requestAnimationFrame(function() {
                if (node._h3ApplyNodeSize) node._h3ApplyNodeSize(node.size);
            });
        };

        // Mark freshly saved nodes as using the compact layout.  The shared
        // workflow migration sets the same marker while loading old nodes;
        // setting it at serialization time means a user can enlarge a newly
        // created H3 node before the first save without that deliberate size
        // being mistaken for an old oversized default on the next load.
        var onSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function(info) {
            if (onSerialize) onSerialize.apply(this, arguments);
            this.properties = this.properties || {};
            this.properties.eagle_layout_size_version = H3_LAYOUT_VERSION;
            if (info) {
                info.properties = info.properties || {};
                info.properties.eagle_layout_size_version = H3_LAYOUT_VERSION;
            }
        };

        var onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function() {
            if (this._h3SaveTimer) { clearTimeout(this._h3SaveTimer); this._h3SaveTimer = null; }
            (this._h3HideWidgetTimers || []).forEach(function(timer) { clearTimeout(timer); });
            this._h3HideWidgetTimers = [];
            this._h3Init = false;
            if (this._vueApp) { this._vueApp.unmount(); this._vueApp = null; }
            this._h3ReloadState = null;
            this._h3ReloadColumnLayout = null;
            this._h3ApplyNodeSize = null;
            this._h3ContextLoopPlanJson = null;
            this._h3FlushState = null;
            this._eagleSyncContextLoopBridges = null;
            if (onRemoved) onRemoved.apply(this, arguments);
        };
    }
});
