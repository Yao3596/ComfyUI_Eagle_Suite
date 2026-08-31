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
import "./eagle_vue_theme.js";

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
.h3d-media-dropzone{min-height:118px;border:2px dashed #465064;border-radius:9px;background:linear-gradient(180deg,#111722,#0e1118);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;color:var(--h3d-muted);cursor:pointer;transition:.15s;flex-shrink:0}
.h3d-media-dropzone:hover{border-color:var(--h3d-primary);background:#131c2b;color:#fff}.h3d-media-dropzone .drop-icon{font-size:26px;color:#73a7ef;line-height:1}.h3d-media-dropzone .drop-title{font-size:12px;font-weight:600}.h3d-media-dropzone .drop-sub{font-size:10px;color:var(--h3d-muted)}
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
function createScene(id) {
    return { id: id, title: '', defaultSeconds: 10, defaultSteps: 8, shots: [], dialogues: [], preamble: '', disabledTokens: [] };
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
function defaultProject() {
    return {
        mode: 't2v', globalDuration: 7, globalSteps: 8,
        // 必须与尺寸下拉框的真实 value 完全一致，否则首次打开时没有选中项。
        aspect: '16:9', resolution: 'mp0.5', fps: 24, exportMode: 'all',
        sizePreset: '16:9|mp0.5|960|544',
        foundation: '',
        contextLength: 22, encodeMode: 'video', anchorMode: 'head', crop: 'disabled',
        audioMode: 'generated_audio', audioContextLength: 22, baseSeed: 0, segmentCrf: 18,
        refMaxMegapixels: 1.5,
        videoBlendFrames: 0, continuationMode: 'guide', referencePolicy: 'warn',
        refs: Array.from({ length: 9 }, function() { return createRef(); }),
        mediaRefs: [],
        // 导演台内选择的技能库快照。保存到工作流，确保下次打开仍能复现生成上下文。
        director_skill: '',
        skill: {
            tasks: [],            // ['script','shots','dialogue'] 多选
            modelPref: 'local',   // 'local' 本地优先 | 'api'
            mergeMode: 'overwrite', // 'overwrite' 覆盖 | 'append' 追加
            profile: 'balanced',
            skillPolicy: 'merge',
            librarySkillIds: [],
            temperature: 0.7,
            hint: ''
        }
    };
}
function normalizeProjectEnums(project) {
    if (!project) return;
    if (project.encodeMode === 'image') project.encodeMode = 'frames';
    if (project.anchorMode === 'frame' || project.anchorMode === 'tail') project.anchorMode = 'before';
    if (project.continuationMode === 'strict' || project.continuationMode === 'free') project.continuationMode = 'guide';
    if (project.audioMode === 'off') project.audioMode = 'generated_audio';
    if (['off','warn','strict'].indexOf(project.referencePolicy) < 0) project.referencePolicy = 'warn';
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
    normalizeProjectEnums(project);
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
    // 兼容旧版 segmentRef → segmentCrf
    if ('segmentRef' in savedProject && !('segmentCrf' in savedProject)) {
        savedProject.segmentCrf = savedProject.segmentRef;
    }
    var defProject = defaultProject();
    Object.keys(defProject).forEach(function(k) {
        project[k] = (k in savedProject) ? savedProject[k] : defProject[k];
    });
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
    store.currentSceneId = (scenes[0] && scenes[0].id) || 1;
}
function saveState(node, project, scenes, immediate) {
    var w = (node.widgets || []).find(function(x) { return x.name === 'h3_state'; });
    if (!w) return;
    if (node._h3SaveTimer) { clearTimeout(node._h3SaveTimer); node._h3SaveTimer = null; }
    var doSave = function() {
        try {
            var clean = JSON.parse(JSON.stringify({ version: 2, project: project, scenes: scenes }));
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
    };
    if (immediate) doSave();
    else node._h3SaveTimer = setTimeout(doSave, 300);
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

    var activePreamble = stripDisabledTokens(scene, scene.preamble || '');
    var preamble = activePreamble.replace(/<d>[\s\S]*?<\/d>/g,'').replace(/\n{3,}/g,'\n\n').trim();
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
    var disabled = Array.isArray(scene.disabledTokens) ? scene.disabledTokens : [];
    var dlgs = (scene.dialogues || []).filter(function(d) {
        return d && d.role && d.text && disabled.indexOf(buildDTag(d.role, d.text)) < 0;
    }).map(function(d) { return '  ' + buildDTag(d.role, d.text); }).join('\n');
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
            dirty: false,
            skillBatch: {
                active: false, stopRequested: false, batchId: '', requestId: '',
                sceneIds: [], cursor: 0, completed: 0, failed: 0,
                currentSceneId: null, status: '', lastError: ''
            },
            directorLibrary: {
                items: [], loading: false, error: '', source: 'eagle',
                path: '', fallbackReason: ''
            }
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

        function markDirty(immediate) { store.dirty = true; saveState(props.node, project, scenes, immediate); }

        function compileDirectorLibrary() {
            var ids = (store.project.skill && store.project.skill.librarySkillIds) || [];
            var active = store.directorLibrary.items.filter(function(skill) { return ids.indexOf(skill.id) >= 0; });
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
            var ids = store.project.skill.librarySkillIds || (store.project.skill.librarySkillIds = []);
            var index = ids.indexOf(skill.id);
            if (index >= 0) ids.splice(index, 1); else ids.push(skill.id);
            compileDirectorLibrary();
            markDirty(true);
        }

        nextTick(function() { loadDirectorLibrary(); });

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
            });
            Object.keys(limits).forEach(function(kind) {
                if (counts[kind] > limits[kind]) w.push(kind + ' 素材超过端口上限 ' + limits[kind] + '。');
            });
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
            // defaultSeconds 是场景总时长；镜头只是对这段时长的内部划分。
            return store.scenes.reduce(function(a, s) { return a + (s.defaultSeconds || 10); }, 0);
        });

        // ── 导演 Skill：手动「生成」按钮 ──
        function skillRequestWidget() {
            return (props.node.widgets || []).find(function(x) { return x.name === 'skill_request'; });
        }
        function finishSkillBatch(message) {
            var batch = store.skillBatch;
            batch.active = false;
            batch.currentSceneId = null;
            batch.requestId = '';
            batch.status = message || ('已完成 ' + batch.completed + ' 个场景');
            flash(batch.status);
        }
        function submitSkillScene() {
            var batch = store.skillBatch;
            if (!batch.active) return;
            if (batch.stopRequested) {
                finishSkillBatch('已停止：完成 ' + batch.completed + '/' + batch.sceneIds.length + '，失败 ' + batch.failed);
                return;
            }
            if (batch.cursor >= batch.sceneIds.length) {
                finishSkillBatch('✓ 批量生成完成：' + batch.completed + '/' + batch.sceneIds.length + (batch.failed ? '，失败 ' + batch.failed : ''));
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
                hint: sk.hint || ''
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
            if (!tasks.length) { flash('请先在「导演 Skill」选择要生成的任务（台本 / 分镜 / 台词）'); return; }
            if (store.skillBatch.active) { flash('已有生成任务进行中'); return; }
            var ids = scope === 'all'
                ? store.scenes.map(function(scene) { return scene.id; })
                : [store.currentSceneId];
            if (!ids.length) { flash('没有可生成的场景'); return; }
            Object.assign(store.skillBatch, {
                active:true, stopRequested:false,
                batchId:'h3skill-' + Date.now() + '-' + Math.random().toString(16).slice(2),
                requestId:'', sceneIds:ids, cursor:0, completed:0, failed:0,
                currentSceneId:null, status:'', lastError:''
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
            }
            // 若只生成台本，从其 <d> 标签同步台词列表
            if (data.preamble != null && data.dialogues == null) {
                syncPreambleToDlg(scene);
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
            addDialogue: addDialogue, removeDialogue: removeDialogue,
            onDialogueInput: onDialogueInput, onPreambleInput: onPreambleInput,
            triggerUpload: triggerUpload, clearRef: clearRef, addRef: addRef,
            removeLastRef: removeLastRef, onRefDrop: onRefDrop,
            generateSkill: generateSkill, stopSkillGeneration: stopSkillGeneration,
            loadDirectorLibrary: loadDirectorLibrary,
            toggleDirectorLibrarySkill: toggleDirectorLibrarySkill,
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
          <input ref="mediaFileInput" type="file" accept="image/*,video/*,audio/*" multiple style="display:none" @change="onMediaFiles">
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
          <div class="h3d-row" style="justify-content:space-between">
            <div class="h3d-hint">与台本上方素材栏共用同一份数据；不自动排序，拖拽卡片可调整位置。图片最多9张，视频/音频各3个。</div>
            <span style="display:flex;gap:5px"><button class="h3d-btn sm" @click="openInputPicker">▾ input 图片</button><button class="h3d-btn sm primary" @click="openMediaPicker">＋ 添加素材</button></span>
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
                <div v-if="item.type==='image' && mediaBroken(item)" class="h3d-media-missing">找不到素材文件</div>
                <img v-if="item.type==='image' && !mediaBroken(item)" :src="mediaUrl(item)" alt="" @load="onMediaLoad($event,item)" @error="onMediaError($event,item)">
                <video v-else-if="item.type==='video'" :src="mediaUrl(item)" muted controls preload="metadata" @loadedmetadata="onLoadedMetadata($event,item)" @error="onMediaError($event,item)"></video>
                <div v-else-if="item.type==='audio'" class="audio-icon">♪<audio :src="mediaUrl(item)" preload="metadata" style="display:none" @loadedmetadata="onLoadedMetadata($event,item)" @error="onMediaError($event,item)"></audio></div>
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
            <div style="border:1px solid var(--h3d-bd);border-radius:6px;padding:7px;margin-bottom:8px;background:var(--h3d-bg2)">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
                <b style="font-size:11px">导演技能库</b>
                <span class="h3d-mini">已启用 {{ store.project.skill.librarySkillIds.length }} 项</span>
                <button class="h3d-btn sm" style="margin-left:auto" :disabled="store.directorLibrary.loading" @click="actions.loadDirectorLibrary">
                  {{ store.directorLibrary.loading ? '读取中…' : '刷新' }}
                </button>
              </div>
              <div v-if="store.directorLibrary.error" class="h3d-mini" style="color:var(--h3d-danger);margin-bottom:5px">{{ store.directorLibrary.error }}</div>
              <div v-else-if="store.directorLibrary.fallbackReason" class="h3d-mini" style="color:#d5a84b;margin-bottom:5px">已回退到 {{ store.directorLibrary.source }}：{{ store.directorLibrary.fallbackReason }}</div>
              <div v-if="store.directorLibrary.items.length" style="display:flex;flex-wrap:wrap;gap:5px">
                <button v-for="skill in store.directorLibrary.items" :key="skill.id" class="h3d-btn sm"
                        :class="{primary:store.project.skill.librarySkillIds.includes(skill.id)}"
                        :title="(skill.category || 'custom') + (skill.tasks && skill.tasks.length ? ' · ' + skill.tasks.join('/') : '')"
                        @click="actions.toggleDirectorLibrarySkill(skill)">
                  {{ store.project.skill.librarySkillIds.includes(skill.id) ? '✓ ' : '' }}{{ skill.name }}
                </button>
              </div>
              <div v-else-if="!store.directorLibrary.loading && !store.directorLibrary.error" class="h3d-mini">技能库为空，可在“导演技能库”节点中新建。</div>
              <div v-if="store.directorLibrary.path" class="h3d-mini" :title="store.directorLibrary.path" style="margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ store.directorLibrary.source }} · {{ store.directorLibrary.path }}</div>
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

            // 新节点默认落在左栏首个场景卡片下方；已有工作流尺寸由 onConfigure 恢复。
            if (!this.size || this.size[0] < 760 || this.size[1] < 560) {
                this.setSize([1300, 1080]);
            }

            var node = this;
            setTimeout(function() { if (!hideWidgets(node)) setTimeout(function() { hideWidgets(node); }, 500); }, 300);

            if (!document.getElementById('h3d-global-style')) {
                var s = document.createElement('style');
                s.id = 'h3d-global-style';
                s.textContent = H3D_CSS;
                document.head.appendChild(s);
            }

            var el = document.createElement('div');
            el.style.cssText = 'display:block;min-width:0;max-width:100%;overflow:hidden;position:relative;box-sizing:border-box;';

            var widget = this.addDOMWidget('h3_director_ui', 'div', el, { serialize: false });

            var applySize = function(size) {
                size = size || node.size || [1300, 1080];
                var w = Math.max(700, Number(size[0] || 1300) - 20);
                // 内容区域可以缩小并在三栏内部滚动，不再反向把 LiteGraph 节点撑高。
                var h = Math.max(220, Number(size[1] || 1080) - 150);
                el.style.width = w + 'px';
                el.style.maxWidth = w + 'px';
                el.style.height = h + 'px';
                widget.lastHeight = h;
                widget.computedHeight = h;
                return [w, h];
            };
            widget.computeSize = function(width) {
                var current = node.size || [width || 1300, 1080];
                // 这里只声明最小占位；实际高度始终由用户的节点尺寸与 onResize 决定。
                return [Math.max(700, Number(width || current[0]) - 20), 220];
            };
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
            requestAnimationFrame(function() {
                if (node._h3ApplyNodeSize) node._h3ApplyNodeSize(node.size);
            });
        };

        var onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function() {
            if (this._h3SaveTimer) { clearTimeout(this._h3SaveTimer); this._h3SaveTimer = null; }
            if (this._vueApp) { this._vueApp.unmount(); this._vueApp = null; }
            this._h3ReloadState = null;
            this._h3ApplyNodeSize = null;
            if (onRemoved) onRemoved.apply(this, arguments);
        };
    }
});
