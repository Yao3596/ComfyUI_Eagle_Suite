/**
 * H3 导演台主题样式（暗色），以 JS 字符串导出，由挂载逻辑注入一次。
 * 对齐现有 Eagle 节点的 .gal-* 暗色风格。
 */
export const H3D_CSS = `
.h3d-root{
  --h3d-bg:#121216; --h3d-bg2:#17181d; --h3d-bg3:#1d1f26;
  --h3d-bd:#2a2d36; --h3d-fg:#d8dae0; --h3d-muted:#8b90a0;
  --h3d-primary:#5ec8ff; --h3d-primary2:#7c5cff; --h3d-warn:#ffb454; --h3d-danger:#ff6b6b;
  --h3d-radius:8px;
  display:flex; flex-direction:column; height:100%; min-height:0;
  background:var(--h3d-bg); color:var(--h3d-fg);
  font:12px/1.5 system-ui,"Segoe UI",sans-serif; box-sizing:border-box; overflow:hidden;
}
.h3d-root *{box-sizing:border-box;}
.h3d-topbar{
  display:flex; align-items:center; gap:10px; padding:8px 12px; flex-wrap:wrap;
  background:linear-gradient(90deg,#15171c,#1b1d24); border-bottom:1px solid var(--h3d-bd);
}
.h3d-topbar h1{font-size:14px; margin:0; display:flex; align-items:center; gap:6px; color:#fff;}
.h3d-badge{font-size:10px; padding:1px 6px; border-radius:6px; background:var(--h3d-primary2); color:#fff; font-weight:600;}
.h3d-field{display:flex; align-items:center; gap:4px;}
.h3d-field label{color:var(--h3d-muted); font-size:11px;}
.h3d-field select,.h3d-field input{
  background:var(--h3d-bg3); color:var(--h3d-fg); border:1px solid var(--h3d-bd);
  border-radius:6px; padding:3px 6px; font-size:11px; outline:none;
}
.h3d-pill{font-size:10px; padding:3px 8px; border-radius:6px; background:var(--h3d-bg3); color:var(--h3d-muted); border:1px solid var(--h3d-bd);}
.h3d-spacer{flex:1;}
.h3d-btn{
  background:var(--h3d-bg3); color:var(--h3d-fg); border:1px solid var(--h3d-bd);
  border-radius:6px; padding:5px 10px; font-size:11px; cursor:pointer; transition:.15s;
}
.h3d-btn:hover{border-color:var(--h3d-primary); color:#fff;}
.h3d-btn.primary{background:var(--h3d-primary); color:#06222e; border-color:var(--h3d-primary); font-weight:600;}
.h3d-btn.sm{padding:2px 7px; font-size:10px;}
.h3d-btn.danger:hover{border-color:var(--h3d-danger); color:var(--h3d-danger);}
.h3d-sync{font-size:11px; padding:3px 8px; border-radius:6px; border:1px solid var(--h3d-bd);}
.h3d-sync.ok{color:#7ee0a0; border-color:#2e5e44;}
.h3d-sync.dirty{color:var(--h3d-warn); border-color:#5e4a2e;}

.h3d-body{display:flex; flex:1; min-height:0; overflow:hidden;}
.h3d-col{display:flex; flex-direction:column; min-height:0; border-right:1px solid var(--h3d-bd);}
.h3d-col:last-child{border-right:none;}
.h3d-col-hd{
  padding:7px 10px; font-size:12px; font-weight:600; color:#fff;
  background:var(--h3d-bg2); border-bottom:1px solid var(--h3d-bd); display:flex; align-items:center; justify-content:space-between;
}
.h3d-col-body{flex:1; min-height:0; padding:10px; display:flex; flex-direction:column; gap:10px;}

.h3d-scroll{overflow-y:auto;}
.h3d-scroll::-webkit-scrollbar{width:9px; height:9px;}
.h3d-scroll::-webkit-scrollbar-thumb{background:#33363f; border-radius:6px;}
.h3d-scroll::-webkit-scrollbar-track{background:transparent;}

.h3d-card{background:var(--h3d-bg2); border:1px solid var(--h3d-bd); border-radius:var(--h3d-radius); padding:10px;}
.h3d-card-title{font-size:12px; font-weight:600; color:#fff; margin-bottom:8px; display:flex; align-items:center; gap:6px;}
.h3d-row{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
.h3d-row.col{flex-direction:column; align-items:stretch; gap:4px;}
.h3d-label{font-size:11px; color:var(--h3d-muted);}
.h3d-hint{font-size:10px; color:var(--h3d-muted); line-height:1.4;}
.h3d-input,.h3d-textarea,.h3d-select{
  background:var(--h3d-bg3); color:var(--h3d-fg); border:1px solid var(--h3d-bd);
  border-radius:6px; padding:6px 8px; font-size:12px; outline:none; width:100%; resize:vertical;
}
.h3d-textarea{min-height:70px; font-family:ui-monospace,monospace; line-height:1.5;}
.h3d-input.sm{width:auto; padding:3px 6px; font-size:11px;}
.h3d-input.time{width:88px; font-family:ui-monospace,monospace;}

.h3d-grid2{display:grid; grid-template-columns:1fr 1fr; gap:8px;}
.h3d-grid3{display:grid; grid-template-columns:repeat(3,1fr); gap:6px;}

.h3d-collapse{display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none; color:var(--h3d-muted); font-size:11px;}
.h3d-collapse .arrow{transition:.15s;}
.h3d-collapse.open .arrow{transform:rotate(90deg);}

.h3d-scene{border:1px solid var(--h3d-bd); border-radius:6px; padding:8px; background:var(--h3d-bg2); cursor:pointer;}
.h3d-scene.active{border-color:var(--h3d-primary); background:#192230;}
.h3d-scene .ttl{font-weight:600; color:#fff; display:flex; align-items:center; justify-content:space-between;}
.h3d-bar{height:5px; background:#262a33; border-radius:3px; margin-top:6px; overflow:hidden;}
.h3d-bar > i{display:block; height:100%; background:var(--h3d-primary);}
.h3d-bar.over > i{background:var(--h3d-danger);}
.h3d-mini{font-size:10px; color:var(--h3d-muted);}

.h3d-tabs{display:flex; gap:4px; flex-wrap:wrap;}
.h3d-tab{background:var(--h3d-bg3); color:var(--h3d-muted); border:1px solid var(--h3d-bd); border-radius:6px; padding:4px 10px; font-size:11px; cursor:pointer;}
.h3d-tab.active{background:var(--h3d-primary); color:#06222e; border-color:var(--h3d-primary); font-weight:600;}

.h3d-shot{border:1px solid var(--h3d-bd); border-radius:6px; padding:8px; background:var(--h3d-bg2); cursor:pointer;}
.h3d-shot.active{border-color:var(--h3d-primary);}
.h3d-shot .hd{display:flex; align-items:center; justify-content:space-between; gap:6px; margin-bottom:6px;}
.h3d-shot .st{color:var(--h3d-primary); font-weight:700; font-size:11px;}
.h3d-shot .tm{color:var(--h3d-warn); font-family:ui-monospace,monospace; font-size:11px;}
.h3d-shot .ct{font-size:11px; color:var(--h3d-fg); white-space:pre-wrap; word-break:break-word;}
.h3d-shot .mt{font-size:10px; color:var(--h3d-muted); margin-top:4px;}

.h3d-tag{display:inline-block; background:#1d2733; color:var(--h3d-primary); border-radius:4px; padding:0 5px; font-family:ui-monospace,monospace; font-size:10px;}
.h3d-dlg{border:1px solid var(--h3d-bd); border-radius:6px; padding:6px 8px; background:var(--h3d-bg2);}
.h3d-refslot{border:1px solid var(--h3d-bd); border-radius:6px; padding:6px; background:var(--h3d-bg2); display:flex; flex-direction:column; gap:6px;}
.h3d-refslot.has-img{border-color:var(--h3d-primary);}
.h3d-refslot .thumb{width:100%; aspect-ratio:1.3; background:#0e0f13; border-radius:4px; display:flex; align-items:center; justify-content:center; overflow:hidden; cursor:pointer;}
.h3d-refslot .thumb img{width:100%; height:100%; object-fit:cover;}
.h3d-refslot .thumb .ph{color:var(--h3d-muted); font-size:20px;}

.h3d-stats{display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;}
.h3d-stat{font-size:10px; color:var(--h3d-muted);}
.h3d-stat b{color:var(--h3d-fg);}
.h3d-warn{margin-top:8px; background:#2a1f17; border:1px solid #5e4a2e; border-radius:6px; padding:6px 8px; font-size:10px; color:var(--h3d-warn);}
.h3d-warn ul{margin:4px 0 0; padding-left:16px;}
.h3d-preview{
  flex:1; min-height:120px; max-height:34vh; overflow:auto; white-space:pre-wrap; word-break:break-word;
  background:#0d0f14; border:1px solid var(--h3d-bd); border-radius:6px; padding:10px; font-size:11px; color:#d7f1dc; font-family:ui-monospace,monospace;
}
.h3d-statusbar{
  display:flex; align-items:center; gap:12px; padding:6px 10px; font-size:10px; color:var(--h3d-muted);
  background:var(--h3d-bg2); border-top:1px solid var(--h3d-bd);
}
.h3d-statusbar b{color:var(--h3d-fg);}
.h3d-empty{color:var(--h3d-muted); text-align:center; padding:20px; font-size:11px;}
`;
