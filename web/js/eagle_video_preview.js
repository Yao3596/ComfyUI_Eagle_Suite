import { api } from "../../../scripts/api.js";

const EagleVideoPreview = {
    previewContainers: new WeakMap(),

    injectStyles() {
        if (document.getElementById("eagle-video-preview-styles")) return;
        const style = document.createElement("style");
        style.id = "eagle-video-preview-styles";
        style.textContent = `
            .eagle-video-preview { margin-top:8px; border:1px solid var(--border-color,#3a3a3a); border-radius:6px; overflow:hidden; background:var(--comfy-menu-bg,#2a2a2a); }
            .eagle-video-preview.collapsed .eagle-video-player,
            .eagle-video-preview.collapsed .eagle-video-controls,
            .eagle-video-preview.collapsed .eagle-video-meta { display:none; }
            .eagle-video-header { display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background:var(--comfy-input-bg,#1a1a1a); cursor:pointer; user-select:none; }
            .eagle-video-title { font-size:12px; color:var(--fg-color,#ccc); font-weight:500; }
            .eagle-video-toggle { background:none; border:none; color:var(--fg-color,#ccc); cursor:pointer; font-size:14px; padding:0 4px; }
            .eagle-video-player { width:100%; max-height:280px; display:block; background:#000; }
            .eagle-video-controls { display:flex; align-items:center; padding:6px 10px; gap:8px; background:var(--comfy-input-bg,#1a1a1a); }
            .eagle-video-play-btn { background:none; border:none; color:var(--fg-color,#ccc); cursor:pointer; font-size:16px; width:24px; height:24px; display:flex; align-items:center; justify-content:center; }
            .eagle-video-progress { flex:1; height:4px; -webkit-appearance:none; background:var(--border-color,#3a3a3a); border-radius:2px; cursor:pointer; }
            .eagle-video-progress::-webkit-slider-thumb { -webkit-appearance:none; width:12px; height:12px; border-radius:50%; background:var(--comfy-button-primary-bg,#4a9eff); cursor:pointer; }
            .eagle-video-volume { width:60px; height:4px; -webkit-appearance:none; background:var(--border-color,#3a3a3a); border-radius:2px; cursor:pointer; }
            .eagle-video-volume::-webkit-slider-thumb { -webkit-appearance:none; width:10px; height:10px; border-radius:50%; background:var(--comfy-button-primary-bg,#4a9eff); cursor:pointer; }
            .eagle-video-time { font-size:11px; color:var(--fg-color,#aaa); min-width:40px; text-align:center; }
            .eagle-video-fullscreen { background:none; border:none; color:var(--fg-color,#ccc); cursor:pointer; font-size:14px; width:24px; height:24px; display:flex; align-items:center; justify-content:center; }
            .eagle-video-meta { display:flex; gap:12px; padding:6px 10px; font-size:11px; color:var(--fg-color,#aaa); background:var(--comfy-input-bg,#1a1a1a); border-top:1px solid var(--border-color,#3a3a3a); flex-wrap:wrap; }
            .eagle-video-error { padding:10px; color:var(--error-color,#ff4a4a); font-size:12px; text-align:center; display:none; }
            .eagle-video-info { padding:4px 10px; font-size:11px; color:var(--fg-color,#999); background:var(--comfy-input-bg,#1a1a1a); border-top:1px solid var(--border-color,#3a3a3a); white-space:pre-wrap; word-break:break-all; }
        `;
        document.head.appendChild(style);
    },

    createPreview(node) {
        if (this.previewContainers.has(node)) return this.previewContainers.get(node);
        const container = document.createElement("div");
        container.className = "eagle-video-preview";
        container.innerHTML = `
            <div class="eagle-video-header">
                <span class="eagle-video-title">视频预览</span>
                <button class="eagle-video-toggle">▼</button>
            </div>
            <video class="eagle-video-player" controlsList="nodownload"></video>
            <div class="eagle-video-controls">
                <button class="eagle-video-play-btn">▶</button>
                <input type="range" class="eagle-video-progress" min="0" max="100" value="0" step="0.1">
                <span class="eagle-video-time">0:00 / 0:00</span>
                <input type="range" class="eagle-video-volume" min="0" max="1" value="1" step="0.01">
                <button class="eagle-video-fullscreen">⛶</button>
            </div>
            <div class="eagle-video-meta"></div>
            <div class="eagle-video-info"></div>
            <div class="eagle-video-error"></div>
        `;
        node.addDOMWidget("eagle_video_preview", "custom", container, { serialize: false, hideOnZoom: false });
        this.previewContainers.set(node, container);
        this.bindEvents(node, container);
        return container;
    },

    bindEvents(node, container) {
        const video = container.querySelector(".eagle-video-player");
        const playBtn = container.querySelector(".eagle-video-play-btn");
        const progress = container.querySelector(".eagle-video-progress");
        const timeDisplay = container.querySelector(".eagle-video-time");
        const volume = container.querySelector(".eagle-video-volume");
        const fullscreenBtn = container.querySelector(".eagle-video-fullscreen");
        const toggleBtn = container.querySelector(".eagle-video-toggle");
        const header = container.querySelector(".eagle-video-header");

        header.addEventListener("click", (e) => {
            if (e.target === toggleBtn) return;
            container.classList.toggle("collapsed");
            toggleBtn.textContent = container.classList.contains("collapsed") ? "▶" : "▼";
        });
        toggleBtn.addEventListener("click", () => {
            container.classList.toggle("collapsed");
            toggleBtn.textContent = container.classList.contains("collapsed") ? "▶" : "▼";
        });

        playBtn.addEventListener("click", () => {
            video.paused ? (video.play(), playBtn.textContent = "⏸") : (video.pause(), playBtn.textContent = "▶");
        });

        video.addEventListener("play", () => playBtn.textContent = "⏸");
        video.addEventListener("pause", () => playBtn.textContent = "▶");
        video.addEventListener("ended", () => playBtn.textContent = "▶");

        video.addEventListener("timeupdate", () => {
            if (!video.duration) return;
            progress.value = (video.currentTime / video.duration) * 100;
            timeDisplay.textContent = `${this.formatTime(video.currentTime)} / ${this.formatTime(video.duration)}`;
        });

        progress.addEventListener("input", () => {
            if (!video.duration) return;
            video.currentTime = (progress.value / 100) * video.duration;
        });

        volume.addEventListener("input", () => video.volume = volume.value);

        fullscreenBtn.addEventListener("click", () => {
            video.requestFullscreen?.() || video.webkitRequestFullscreen?.();
        });

        video.addEventListener("error", () => {
            container.querySelector(".eagle-video-error").style.display = "block";
            container.querySelector(".eagle-video-error").textContent = "视频加载失败，请检查文件格式或路径";
        });

        video.addEventListener("loadedmetadata", () => {
            container.querySelector(".eagle-video-error").style.display = "none";
        });
    },

    formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, "0")}`;
    },

    /**
     * 从节点输出中提取视频文件路径
     */
    extractVideoPath(nodeName, output) {
        if (!output) return null;

        // output 是数组: [filepath, info, video_path] (STRING 三元组)
        if (Array.isArray(output)) {
            for (const item of output) {
                if (typeof item === "string" && item && this.isVideoFile(item)) {
                    return item;
                }
            }
            return null;
        }

        // output 是对象（named outputs）
        if (typeof output === "object") {
            for (const key of ["video_path", "filepath", "video", "path", "output"]) {
                const val = output[key];
                if (typeof val === "string" && val && this.isVideoFile(val)) {
                    return val;
                }
            }
        }

        // output 直接是路径字符串
        if (typeof output === "string" && this.isVideoFile(output)) {
            return output;
        }

        return null;
    },

    isVideoFile(path) {
        if (!path || typeof path !== "string") return false;
        const videoExts = [".mp4", ".webm", ".mkv", ".avi", ".mov", ".gif", ".apng", ".webp", ".m4v", ".flv"];
        const ext = path.toLowerCase().split("?").pop();
        return videoExts.some(e => ext.endsWith(e));
    },

    /**
     * 将本地路径转换为 ComfyUI /view URL
     */
    resolveVideoUrl(videoPath) {
        if (!videoPath) return null;

        if (videoPath.startsWith("http://") || videoPath.startsWith("https://")) {
            return videoPath;
        }

        const filename = videoPath.split(/[/\\]/).pop();
        return `${api.apiURL}/view?filename=${encodeURIComponent(filename)}&type=output`;
    },

    updatePreview(node, output) {
        const container = this.previewContainers.get(node);
        if (!container) return;

        const nodeName = node.comfyClass || "";
        const videoPath = this.extractVideoPath(nodeName, output);

        if (!videoPath) {
            container.style.display = "none";
            return;
        }

        container.style.display = "block";
        const video = container.querySelector(".eagle-video-player");
        const videoUrl = this.resolveVideoUrl(videoPath);

        if (video.src !== videoUrl && videoUrl) {
            video.src = videoUrl;
            video.load();
        }

        // 显示 info 信息
        const infoEl = container.querySelector(".eagle-video-info");
        if (Array.isArray(output) && output.length >= 2) {
            const info = output[1];
            if (typeof info === "string" && info) {
                infoEl.textContent = info;
                infoEl.style.display = "block";
            } else {
                infoEl.style.display = "none";
            }
        } else {
            infoEl.style.display = "none";
        }
    },

    destroyPreview(node) {
        const container = this.previewContainers.get(node);
        if (container) {
            const video = container.querySelector(".eagle-video-player");
            video?.pause();
            video.src = "";
            container.remove();
            this.previewContainers.delete(node);
        }
    }
};

// 支持视频路径输出的节点
const VIDEO_OUTPUT_NODES = [
    "EagleImagesToVideo",
    "EagleVideoConverter",
];

app.registerExtension({
    name: "ComfyUI.EagleSuite.VideoPreview",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (!VIDEO_OUTPUT_NODES.includes(nodeData.name)) return;

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (output) {
            onExecuted?.apply(this, arguments);
            EagleVideoPreview.updatePreview(this, output);
        };

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            EagleVideoPreview.createPreview(this);
        };
    },

    nodeRemoved(node) {
        EagleVideoPreview.destroyPreview(node);
    },

    setup() {
        EagleVideoPreview.injectStyles();
    }
});
