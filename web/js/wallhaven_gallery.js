/**
 * Eagle Suite - Wallhaven Gallery 前端扩展
 * 1:1 参考 ComfyUI-Danbooru-Gallery/js/danbooru_gallery/danbooru_gallery.js 实现。
 *
 * 功能列表：
 *  - 图片网格（缩略图 lazy-load，后端代理）
 *  - 层级下拉菜单：分类(Categories) / 纯度(Purity) / 排序(Sorting) / 时间范围(Top Range)
 *  - 收藏夹视图（需要 API Key）
 *  - 排行榜视图（Toplist）
 *  - 独立设置入口（⚙ 按钮）：API Key 输入、验证、保存
 *  - 搜索框 + 刷新 + 分页（无限滚动）
 *  - 选中图片 → selection_data hidden widget → 节点输出
 *  - localStorage 持久化 UI 状态
 */

import { app } from "/scripts/app.js";
import { $el } from "/scripts/ui.js";

app.registerExtension({
    name: "EagleSuite.WallhavenGallery",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "WallhavenGalleryNode") return;

        // ── localStorage helpers ──────────────────────────────────────────
        const LS_PREFIX = "wallhaven_gallery_";
        const lsSave = (key, val) => {
            try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch (_) {}
        };
        const lsLoad = (key, def) => {
            try {
                const v = localStorage.getItem(LS_PREFIX + key);
                return v !== null ? JSON.parse(v) : def;
            } catch (_) { return def; }
        };

        // ── 节点创建 ──────────────────────────────────────────────────────
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            this.setSize([820, 960]);

            // hidden widget：存放选中数据
            const selWidget = this.addWidget("text", "selection_data", JSON.stringify({}), () => {}, { serialize: true });
            if (selWidget) {
                selWidget.computeSize = () => [0, -4];
                selWidget.draw = () => {};
                selWidget.type = "hidden";
            }

            // ── CSS 注入 ─────────────────────────────────────────────────
            if (!document.getElementById("wallhaven-gallery-style")) {
                document.head.appendChild($el("style#wallhaven-gallery-style", {
                    textContent: `
.wh-gallery { display:flex; flex-direction:column; width:100%; height:100%; font-size:13px; color:var(--input-text,#ddd); box-sizing:border-box; }
.wh-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:6px 8px; border-bottom:1px solid rgba(255,255,255,0.1); flex-shrink:0; }
.wh-search-input { flex:1; min-width:120px; padding:5px 8px; background:var(--comfy-input-bg,#333); color:var(--input-text,#ddd); border:1px solid rgba(255,255,255,0.2); border-radius:5px; font-size:13px; outline:none; }
.wh-search-input:focus { border-color:rgba(120,180,255,0.6); }
.wh-btn { padding:4px 10px; background:var(--comfy-input-bg,#444); color:var(--input-text,#ddd); border:1px solid rgba(255,255,255,0.2); border-radius:5px; cursor:pointer; font-size:12px; white-space:nowrap; display:flex; align-items:center; gap:4px; }
.wh-btn:hover { background:rgba(255,255,255,0.12); }
.wh-btn.active { background:rgba(100,160,255,0.25); border-color:rgba(100,160,255,0.5); }
.wh-dropdown { position:relative; }
.wh-dropdown-btn { padding:4px 10px; background:var(--comfy-input-bg,#444); color:var(--input-text,#ddd); border:1px solid rgba(255,255,255,0.2); border-radius:5px; cursor:pointer; font-size:12px; display:flex; align-items:center; gap:5px; white-space:nowrap; }
.wh-dropdown-btn:hover { background:rgba(255,255,255,0.12); }
.wh-dropdown-list { display:none; position:absolute; top:calc(100% + 4px); left:0; z-index:9999; background:var(--comfy-menu-bg,#2a2a2a); border:1px solid rgba(255,255,255,0.18); border-radius:6px; padding:5px 0; min-width:140px; box-shadow:0 4px 16px rgba(0,0,0,0.5); }
.wh-dropdown-list.show { display:block; }
.wh-dropdown-item { display:flex; align-items:center; gap:7px; padding:5px 14px; cursor:pointer; font-size:12px; color:var(--input-text,#ddd); white-space:nowrap; }
.wh-dropdown-item:hover { background:rgba(255,255,255,0.08); }
.wh-dropdown-item input[type=checkbox], .wh-dropdown-item input[type=radio] { accent-color:#6aa3f5; cursor:pointer; }
.wh-dropdown-sep { height:1px; background:rgba(255,255,255,0.1); margin:4px 0; }
.wh-grid-wrap { flex:1; overflow-y:auto; padding:8px; }
.wh-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:7px; }
.wh-card { position:relative; border-radius:6px; overflow:hidden; cursor:pointer; background:#1a1a1a; aspect-ratio:16/9; border:2px solid transparent; transition:border-color .15s; }
.wh-card:hover { border-color:rgba(100,160,255,0.5); }
.wh-card.selected { border-color:#6aa3f5; box-shadow:0 0 0 1px #6aa3f5; }
.wh-card img { width:100%; height:100%; object-fit:cover; display:block; }
.wh-card-overlay { position:absolute; inset:0; background:rgba(0,0,0,0); transition:background .15s; pointer-events:none; }
.wh-card:hover .wh-card-overlay { background:rgba(0,0,0,0.18); }
.wh-card-badge { position:absolute; top:4px; right:4px; padding:1px 5px; border-radius:3px; font-size:10px; font-weight:500; opacity:.85; }
.badge-sfw { background:#1a5e1a; color:#7ef07e; }
.badge-sketchy { background:#5e4a10; color:#f0c060; }
.badge-nsfw { background:#5e1a1a; color:#f08080; }
.wh-card-check { position:absolute; top:5px; left:5px; width:18px; height:18px; border-radius:3px; background:rgba(0,0,0,0.6); border:1.5px solid rgba(255,255,255,0.5); display:flex; align-items:center; justify-content:center; }
.wh-card.selected .wh-card-check { background:#6aa3f5; border-color:#6aa3f5; }
.wh-status-bar { padding:5px 10px; font-size:11px; color:var(--color-text-secondary,#999); flex-shrink:0; border-top:1px solid rgba(255,255,255,0.07); display:flex; align-items:center; justify-content:space-between; }
.wh-loading { text-align:center; padding:20px; color:#999; font-size:13px; }
.wh-toast { position:fixed; bottom:28px; right:28px; z-index:99999; padding:9px 16px; border-radius:7px; font-size:13px; font-weight:500; max-width:360px; pointer-events:none; }
.wh-toast.info { background:#2255aa; color:#e0eeff; }
.wh-toast.success { background:#1a5e1a; color:#c8f5c8; }
.wh-toast.error { background:#7a1515; color:#fdd; }
.wh-toast.warning { background:#6b4a00; color:#ffeaa0; }
.wh-select-bar { display:flex; align-items:center; gap:8px; padding:4px 8px; background:rgba(100,160,255,0.1); border-top:1px solid rgba(100,160,255,0.2); flex-shrink:0; font-size:12px; }

/* 设置对话框 */
.wh-settings-overlay { position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; }
.wh-settings-dialog { background:var(--comfy-menu-bg,#242424); border:1px solid rgba(255,255,255,0.15); border-radius:10px; padding:22px 26px; width:420px; max-width:92vw; max-height:80vh; overflow-y:auto; color:var(--input-text,#ddd); }
.wh-settings-title { font-size:15px; font-weight:500; margin-bottom:18px; display:flex; align-items:center; justify-content:space-between; }
.wh-field-label { font-size:12px; margin-bottom:4px; color:var(--color-text-secondary,#aaa); }
.wh-field-input { width:100%; padding:6px 9px; background:var(--comfy-input-bg,#333); color:var(--input-text,#ddd); border:1px solid rgba(255,255,255,0.2); border-radius:5px; font-size:13px; outline:none; box-sizing:border-box; }
.wh-field-input:focus { border-color:rgba(100,160,255,0.6); }
.wh-field-row { margin-bottom:14px; }
.wh-save-btn { width:100%; padding:8px; background:#3a6bc8; color:#fff; border:none; border-radius:6px; font-size:13px; cursor:pointer; margin-top:6px; }
.wh-save-btn:hover { background:#4a7de0; }
.wh-verify-btn { padding:5px 12px; background:rgba(255,255,255,0.1); color:#ddd; border:1px solid rgba(255,255,255,0.2); border-radius:5px; font-size:12px; cursor:pointer; margin-left:6px; white-space:nowrap; }
.wh-verify-btn:hover { background:rgba(255,255,255,0.18); }
.wh-close-btn { background:none; border:none; color:#aaa; font-size:18px; cursor:pointer; line-height:1; padding:0 2px; }
.wh-close-btn:hover { color:#fff; }
`
                }));
            }

            // ── 根容器 ────────────────────────────────────────────────────
            const container = $el("div.wh-gallery");

            // ── Toast ─────────────────────────────────────────────────────
            let toastTimer = null;
            const showToast = (msg, type = "info") => {
                let t = document.querySelector(".wh-toast");
                if (!t) {
                    t = document.createElement("div");
                    document.body.appendChild(t);
                }
                t.className = `wh-toast ${type}`;
                t.textContent = msg;
                if (toastTimer) clearTimeout(toastTimer);
                toastTimer = setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
            };

            // ── 状态 ─────────────────────────────────────────────────────
            let posts = [];
            let currentPage = 1;
            let isLoading = false;
            let endOfResults = false;
            let currentSeed = null;
            let selectedIds = new Set();
            let currentView = "search"; // "search" | "toplist" | "collections"
            let collectionsData = [];
            let currentCollectionUser = "";
            let currentCollectionId = "";

            // ── 设置对话框 ───────────────────────────────────────────────
            const showSettingsDialog = async () => {
                const overlay = $el("div.wh-settings-overlay");

                let settingsCache = {};
                try {
                    const r = await fetch("/wallhaven_gallery/settings");
                    const d = await r.json();
                    if (d.success) settingsCache = d.settings;
                } catch (_) {}

                const apiKeyInput = $el("input.wh-field-input", {
                    type: "text",
                    placeholder: "在 wallhaven.cc → Account Settings 中获取",
                    value: settingsCache.api_key ? "****（已配置）" : "",
                });
                const apiKeyRealInput = $el("input", { type: "hidden", value: "" });

                apiKeyInput.addEventListener("focus", () => {
                    if (apiKeyInput.value.startsWith("****")) apiKeyInput.value = "";
                });
                apiKeyInput.addEventListener("input", () => {
                    apiKeyRealInput.value = apiKeyInput.value;
                });

                const verifyBtn = $el("button.wh-verify-btn", { textContent: "验证" });
                verifyBtn.addEventListener("click", async () => {
                    const key = apiKeyRealInput.value.trim() || apiKeyInput.value.trim();
                    if (!key || key.startsWith("****")) {
                        showToast("请先输入 API Key", "warning");
                        return;
                    }
                    verifyBtn.textContent = "验证中...";
                    verifyBtn.disabled = true;
                    try {
                        const r = await fetch("/wallhaven_gallery/verify_auth", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ api_key: key }),
                        });
                        const d = await r.json();
                        if (d.valid) {
                            showToast("API Key 验证成功 ✓", "success");
                        } else {
                            showToast("API Key 无效：" + (d.error || "未知错误"), "error");
                        }
                    } catch (e) {
                        showToast("验证请求失败：" + e.message, "error");
                    } finally {
                        verifyBtn.textContent = "验证";
                        verifyBtn.disabled = false;
                    }
                });

                const saveBtn = $el("button.wh-save-btn", { textContent: "保存设置" });
                saveBtn.addEventListener("click", async () => {
                    const payload = {};
                    const key = apiKeyRealInput.value.trim() || apiKeyInput.value.trim();
                    if (key && !key.startsWith("****")) {
                        payload.api_key = key;
                    }

                    try {
                        const r = await fetch("/wallhaven_gallery/settings", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(payload),
                        });
                        const d = await r.json();
                        if (d.success) {
                            showToast("设置已保存", "success");
                            overlay.remove();
                        } else {
                            showToast("保存失败：" + (d.error || ""), "error");
                        }
                    } catch (e) {
                        showToast("保存请求失败：" + e.message, "error");
                    }
                });

                const dialog = $el("div.wh-settings-dialog", [
                    $el("div.wh-settings-title", [
                        $el("span", { textContent: "⚙ Wallhaven Gallery 设置" }),
                        $el("button.wh-close-btn", { textContent: "×", onclick: () => overlay.remove() }),
                    ]),
                    $el("div.wh-field-row", [
                        $el("div.wh-field-label", { textContent: "API Key（可选，访问 NSFW / 收藏夹需要）" }),
                        $el("div", { style: "display:flex;align-items:center;gap:6px;" }, [
                            apiKeyInput,
                            apiKeyRealInput,
                            verifyBtn,
                        ]),
                        $el("div", {
                            style: "font-size:11px;color:#888;margin-top:4px;",
                            textContent: "前往 wallhaven.cc → Settings → Account → API Key",
                        }),
                    ]),
                    saveBtn,
                ]);

                overlay.appendChild(dialog);
                document.body.appendChild(overlay);
                overlay.addEventListener("click", (e) => {
                    if (e.target === overlay) overlay.remove();
                });
            };

            // ── 工具栏构建 ────────────────────────────────────────────────
            const toolbar = $el("div.wh-toolbar");

            // 搜索框
            const searchInput = $el("input.wh-search-input", {
                type: "text",
                placeholder: "搜索壁纸（支持 +tag1 -tag2 @user）",
                value: lsLoad("searchQ", ""),
            });

            // ─ 分类下拉 ─
            const createCheckboxDrop = (label, items, storageKey, onChange) => {
                const stored = lsLoad(storageKey, null);
                const checkboxes = items.map(({ id, name, defaultChecked }) => {
                    const cb = $el("input", {
                        type: "checkbox",
                        checked: stored ? stored[id] !== false : defaultChecked,
                    });
                    cb.addEventListener("change", () => {
                        const state = {};
                        checkboxes.forEach((c, i) => { state[items[i].id] = c.checked; });
                        lsSave(storageKey, state);
                        btn.textContent = `${label} ▾`;
                        onChange(state);
                    });
                    const div = $el("div.wh-dropdown-item", [cb, $el("span", { textContent: name })]);
                    div.addEventListener("click", (e) => {
                        if (e.target !== cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); }
                    });
                    return { cb, div };
                });

                const list = $el("div.wh-dropdown-list", checkboxes.map(c => c.div));
                const btn = $el("button.wh-dropdown-btn", { textContent: `${label} ▾` });
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    list.classList.toggle("show");
                });

                const wrap = $el("div.wh-dropdown", [btn, list]);
                const getFlags = () => {
                    let s = "";
                    checkboxes.forEach(({ cb }, i) => { s += cb.checked ? "1" : "0"; });
                    return s;
                };
                return { wrap, getFlags };
            };

            const categoryItems = [
                { id: "general", name: "General", defaultChecked: true },
                { id: "anime", name: "Anime", defaultChecked: true },
                { id: "people", name: "People", defaultChecked: true },
            ];
            const purityItems = [
                { id: "sfw", name: "SFW", defaultChecked: true },
                { id: "sketchy", name: "Sketchy", defaultChecked: false },
                { id: "nsfw", name: "NSFW", defaultChecked: false },
            ];

            const { wrap: catWrap, getFlags: getCatFlags } = createCheckboxDrop(
                "分类", categoryItems, "categories",
                () => { currentPage = 1; posts = []; fetchAndRender(); }
            );
            const { wrap: purWrap, getFlags: getPurFlags } = createCheckboxDrop(
                "纯度", purityItems, "purity",
                () => { currentPage = 1; posts = []; fetchAndRender(); }
            );

            // ─ 排序下拉 ─
            const sortingOptions = [
                { id: "date_added", name: "最新上传" },
                { id: "relevance", name: "相关度" },
                { id: "random", name: "随机" },
                { id: "views", name: "浏览量" },
                { id: "favorites", name: "收藏量" },
                { id: "toplist", name: "排行榜" },
            ];
            let currentSorting = lsLoad("sorting", "date_added");

            const sortDropList = $el("div.wh-dropdown-list");
            sortingOptions.forEach(({ id, name }) => {
                const item = $el("div.wh-dropdown-item", [
                    $el("span", { textContent: name }),
                ]);
                item.addEventListener("click", () => {
                    currentSorting = id;
                    lsSave("sorting", id);
                    sortDropBtn.textContent = `${name} ▾`;
                    sortDropList.classList.remove("show");
                    // 排行榜时显示时间范围
                    topRangeWrap.style.display = id === "toplist" ? "" : "none";
                    currentPage = 1; posts = [];
                    if (id === "toplist") {
                        currentView = "toplist";
                    } else if (currentView === "toplist") {
                        currentView = "search";
                    }
                    fetchAndRender();
                });
                sortDropList.appendChild(item);
            });
            const sortLabel = sortingOptions.find(o => o.id === currentSorting)?.name || "最新上传";
            const sortDropBtn = $el("button.wh-dropdown-btn", { textContent: `${sortLabel} ▾` });
            sortDropBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                sortDropList.classList.toggle("show");
            });
            const sortWrap = $el("div.wh-dropdown", [sortDropBtn, sortDropList]);

            // ─ 时间范围（仅排行榜可见）─
            const topRangeOptions = [
                { id: "1d", name: "今天" },
                { id: "3d", name: "3天" },
                { id: "1w", name: "本周" },
                { id: "1M", name: "本月" },
                { id: "3M", name: "3个月" },
                { id: "6M", name: "半年" },
                { id: "1y", name: "今年" },
            ];
            let currentTopRange = lsLoad("topRange", "1M");

            const topRangeList = $el("div.wh-dropdown-list");
            topRangeOptions.forEach(({ id, name }) => {
                const item = $el("div.wh-dropdown-item", [$el("span", { textContent: name })]);
                item.addEventListener("click", () => {
                    currentTopRange = id;
                    lsSave("topRange", id);
                    topRangeBtn.textContent = `${name} ▾`;
                    topRangeList.classList.remove("show");
                    currentPage = 1; posts = [];
                    fetchAndRender();
                });
                topRangeList.appendChild(item);
            });
            const topRangeLabel = topRangeOptions.find(o => o.id === currentTopRange)?.name || "本月";
            const topRangeBtn = $el("button.wh-dropdown-btn", { textContent: `${topRangeLabel} ▾` });
            topRangeBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                topRangeList.classList.toggle("show");
            });
            const topRangeWrap = $el("div.wh-dropdown", [topRangeBtn, topRangeList]);
            topRangeWrap.style.display = currentSorting === "toplist" ? "" : "none";

            // ─ 功能按钮区 ─
            const refreshBtn = $el("button.wh-btn", { title: "刷新" });
            refreshBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
            refreshBtn.addEventListener("click", () => {
                currentPage = 1; posts = [];
                if (currentSorting === "random") currentSeed = null;
                fetchAndRender();
            });

            const favBtn = $el("button.wh-btn", { title: "我的收藏夹" });
            favBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> 收藏夹`;
            favBtn.addEventListener("click", async () => {
                try {
                    const r = await fetch("/wallhaven_gallery/collections");
                    const d = await r.json();
                    if (!d.success) {
                        showToast("获取收藏失败：" + (d.error || "需要 API Key"), "error");
                        return;
                    }
                    collectionsData = d.collections || [];
                    if (collectionsData.length === 0) {
                        showToast("暂无收藏夹", "info");
                        return;
                    }
                    showCollectionsPicker(collectionsData);
                } catch (e) {
                    showToast("请求失败：" + e.message, "error");
                }
            });

            const settingsBtn = $el("button.wh-btn", { title: "设置" });
            settingsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
            settingsBtn.addEventListener("click", showSettingsDialog);

            // 选中计数 / 确认按钮
            const selectBar = $el("div.wh-select-bar", { style: "display:none;" });
            const selectCount = $el("span", { textContent: "已选择 0 张" });
            const confirmBtn = $el("button.wh-btn", { textContent: "✓ 使用选中图片", style: "background:#2a5a28;" });
            const clearSelBtn = $el("button.wh-btn", { textContent: "清除选择" });
            selectBar.append(selectCount, confirmBtn, clearSelBtn);

            const updateSelectBar = () => {
                if (selectedIds.size === 0) {
                    selectBar.style.display = "none";
                } else {
                    selectBar.style.display = "";
                    selectCount.textContent = `已选择 ${selectedIds.size} 张`;
                }
            };

            confirmBtn.addEventListener("click", () => {
                const selections = posts
                    .filter(p => selectedIds.has(p.id))
                    .map(p => ({
                        image_url: p.path,
                        tags: (p.tags || []).map(t => t.name).join(", "),
                        wallpaper_id: p.id,
                        resolution: p.resolution,
                    }));
                selWidget.value = JSON.stringify({ selections });
                // 触发 ComfyUI 重新执行
                app.graph.change();
                showToast(`已确认 ${selections.length} 张壁纸`, "success");
            });

            clearSelBtn.addEventListener("click", () => {
                selectedIds.clear();
                document.querySelectorAll(".wh-card.selected").forEach(el => el.classList.remove("selected"));
                updateSelectBar();
            });

            // ── 收藏夹选择弹窗 ───────────────────────────────────────────
            const showCollectionsPicker = (collections) => {
                const overlay = $el("div.wh-settings-overlay");
                const items = collections.map(col => {
                    const item = $el("div.wh-dropdown-item", {
                        style: "padding:8px 14px; border-bottom:1px solid rgba(255,255,255,0.07); cursor:pointer;",
                    }, [
                        $el("div", {
                            textContent: col.label || `Collection #${col.id}`,
                            style: "font-weight:500; font-size:13px;",
                        }),
                        $el("div", {
                            textContent: `${col.count} 张 · ${col.public ? "公开" : "私密"}`,
                            style: "font-size:11px; color:#888; margin-top:2px;",
                        }),
                    ]);
                    item.addEventListener("click", () => {
                        overlay.remove();
                        currentView = "collections";
                        currentCollectionId = String(col.id);
                        currentCollectionUser = col.username || "me";
                        currentPage = 1; posts = [];
                        fetchAndRender();
                    });
                    return item;
                });

                const dialog = $el("div.wh-settings-dialog", { style: "width:340px;" }, [
                    $el("div.wh-settings-title", [
                        $el("span", { textContent: "选择收藏夹" }),
                        $el("button.wh-close-btn", { textContent: "×", onclick: () => overlay.remove() }),
                    ]),
                    ...items,
                ]);
                overlay.appendChild(dialog);
                document.body.appendChild(overlay);
                overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
            };

            // ── 图片网格 ─────────────────────────────────────────────────
            const gridWrap = $el("div.wh-grid-wrap");
            const grid = $el("div.wh-grid");
            gridWrap.appendChild(grid);

            // 无限滚动
            gridWrap.addEventListener("scroll", () => {
                const { scrollTop, scrollHeight, clientHeight } = gridWrap;
                if (!isLoading && !endOfResults && scrollTop + clientHeight >= scrollHeight - 200) {
                    currentPage++;
                    fetchAndRender(true);
                }
            });

            const statusBar = $el("div.wh-status-bar", [
                $el("span#wh-status-text", { textContent: "就绪" }),
                $el("span#wh-page-info", { textContent: "" }),
            ]);

            // ── 拼装工具栏 ───────────────────────────────────────────────
            toolbar.append(
                searchInput,
                catWrap, purWrap, sortWrap, topRangeWrap,
                refreshBtn, favBtn, settingsBtn,
            );

            container.append(toolbar, gridWrap, selectBar, statusBar);

            // ── 回到搜索模式按钮（当前收藏/排行榜模式时显示）──────────────
            const modeLabel = $el("span#wh-mode-label", { style: "font-size:11px;color:#6aa3f5;margin-left:4px;" });
            toolbar.insertBefore(modeLabel, toolbar.firstChild);

            // ── 搜索事件 ─────────────────────────────────────────────────
            let searchDebounce = null;
            searchInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    clearTimeout(searchDebounce);
                    lsSave("searchQ", searchInput.value);
                    currentPage = 1; posts = [];
                    currentView = "search";
                    fetchAndRender();
                }
            });
            searchInput.addEventListener("input", () => {
                clearTimeout(searchDebounce);
                searchDebounce = setTimeout(() => {
                    lsSave("searchQ", searchInput.value);
                }, 600);
            });

            // ── 全局点击关闭下拉 ─────────────────────────────────────────
            document.addEventListener("click", () => {
                document.querySelectorAll(".wh-dropdown-list.show").forEach(el => el.classList.remove("show"));
            });

            // ── 渲染一张卡片 ─────────────────────────────────────────────
            const renderCard = (post) => {
                const thumb = post.thumbs?.large || post.thumbs?.original || post.thumbs?.small || "";
                const proxied = thumb ? `/wallhaven_gallery/image_proxy?url=${encodeURIComponent(thumb)}` : "";
                const purity = post.purity || "sfw";
                const badgeClass = { sfw: "badge-sfw", sketchy: "badge-sketchy", nsfw: "badge-nsfw" }[purity] || "badge-sfw";

                const img = $el("img", {
                    loading: "lazy",
                    alt: post.id,
                });
                img.setAttribute("data-src", proxied);

                const checkMark = $el("div.wh-card-check", [
                    $el("svg", {
                        xmlns: "http://www.w3.org/2000/svg", width: "10", height: "10",
                        viewBox: "0 0 24 24", fill: "none",
                        stroke: "currentColor", strokeWidth: "3",
                        strokeLinecap: "round", strokeLinejoin: "round",
                    }),
                ]);
                checkMark.querySelector("svg").innerHTML = `<polyline points="20 6 9 17 4 12"/>`;

                const card = $el("div.wh-card", [
                    img,
                    $el("div.wh-card-overlay"),
                    $el("div.wh-card-badge." + badgeClass, { textContent: purity.toUpperCase() }),
                    checkMark,
                ]);

                if (selectedIds.has(post.id)) card.classList.add("selected");

                // 懒加载
                const io = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            img.src = img.getAttribute("data-src");
                            io.disconnect();
                        }
                    });
                }, { root: gridWrap, rootMargin: "200px" });
                io.observe(card);

                card.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (selectedIds.has(post.id)) {
                        selectedIds.delete(post.id);
                        card.classList.remove("selected");
                    } else {
                        selectedIds.add(post.id);
                        card.classList.add("selected");
                    }
                    updateSelectBar();
                });

                return card;
            };

            // ── 核心：获取并渲染 ─────────────────────────────────────────
            const fetchAndRender = async (append = false) => {
                if (isLoading) return;
                isLoading = true;

                if (!append) {
                    grid.innerHTML = "";
                    endOfResults = false;
                }

                const loadingEl = $el("div.wh-loading", { textContent: "加载中..." });
                grid.appendChild(loadingEl);

                try {
                    let data;

                    if (currentView === "collections" && currentCollectionId) {
                        const url = `/wallhaven_gallery/collections/${encodeURIComponent(currentCollectionUser)}/${currentCollectionId}?page=${currentPage}&purity=${getPurFlags()}`;
                        const r = await fetch(url);
                        data = await r.json();
                        modeLabel.textContent = "📁 收藏夹";
                    } else {
                        // 构造搜索参数
                        const params = new URLSearchParams();
                        const q = searchInput.value.trim();
                        if (q) params.set("q", q);
                        params.set("categories", getCatFlags());
                        params.set("purity", getPurFlags());
                        params.set("sorting", currentSorting);
                        params.set("order", lsLoad("order", "desc"));
                        if (currentSorting === "toplist") params.set("topRange", currentTopRange);
                        if (currentSorting === "random") {
                            if (!currentSeed) currentSeed = Math.random().toString(36).slice(2, 8);
                            params.set("seed", currentSeed);
                        }
                        params.set("page", currentPage);
                        const r = await fetch(`/wallhaven_gallery/search?${params}`);
                        data = await r.json();
                        modeLabel.textContent = currentSorting === "toplist" ? "🏆 排行榜" : "";
                    }

                    loadingEl.remove();

                    const list = data.data || [];
                    if (list.length === 0) {
                        endOfResults = true;
                        if (!append || posts.length === 0) {
                            grid.innerHTML = `<div class="wh-loading">暂无结果</div>`;
                        }
                    } else {
                        posts = append ? [...posts, ...list] : list;
                        list.forEach(post => {
                            grid.appendChild(renderCard(post));
                        });
                    }

                    // 更新状态栏
                    const meta = data.meta || {};
                    const statusEl = document.querySelector("#wh-status-text");
                    const pageEl = document.querySelector("#wh-page-info");
                    if (statusEl) statusEl.textContent = meta.total ? `共 ${meta.total} 张` : `${posts.length} 张`;
                    if (pageEl) pageEl.textContent = meta.last_page ? `第 ${currentPage}/${meta.last_page} 页` : `第 ${currentPage} 页`;

                    if (meta.last_page && currentPage >= meta.last_page) {
                        endOfResults = true;
                    }

                } catch (e) {
                    loadingEl.textContent = "加载失败：" + e.message;
                    showToast("加载失败：" + e.message, "error");
                } finally {
                    isLoading = false;
                }
            };

            // ── 挂载 DOM widget ───────────────────────────────────────────
            this.addDOMWidget("wallhaven_gallery_widget", "div", container, {
                onDraw: () => {},
            });

            setTimeout(() => {
                this.onResize?.(this.size);
                fetchAndRender();
            }, 20);
        };
    },
});
