/**
 * useH3State — h3_state 隐藏 widget 的读取与防抖写回。
 * 数据结构：{ project: {...}, scenes: [...] }
 */

export function createScene(id) {
    return {
        id,
        title: "",
        defaultSeconds: 10,
        defaultSteps: 8,
        shots: [],
        dialogues: [],
        preamble: "",
    };
}

export function createShot(id) {
    return {
        id,
        title: "",
        time: "00:00.000",
        framing: "",
        content: "",
        camera: "",
        action: "",
        sound: "",
        estSeconds: 2.5,
    };
}

export function createDialogue(id) {
    return { id, role: "", text: "", time: "" };
}

export function createRef() {
    return { url: "", kind: "person", retention: "fully_preserved", file: null, filename: "" };
}

export function defaultProject() {
    return {
        mode: "t2v",
        globalDuration: 7,
        globalSteps: 8,
        aspect: "9:16",
        resolution: "720p",
        fps: 24,
        exportMode: "all",
        foundation: "",
        contextLength: 22, encodeMode: "video", anchorMode: "head", crop: "disabled",
        audioMode: "generated_audio", audioContextLength: 22, baseSeed: 0, segmentRef: 18,
        videoBlendFrames: 0, continuationMode: "guide",
        refs: Array.from({ length: 9 }, () => createRef()),
    };
}

let _saveTimer = null;

export function loadState(node) {
    const project = defaultProject();
    let scenes = [createScene(1)];
    try {
        const w = (node.widgets || []).find(x => x.name === "h3_state");
        if (w && w.value) {
            const data = JSON.parse(w.value);
            if (data.project) Object.assign(project, data.project);
            if (Array.isArray(data.scenes) && data.scenes.length) scenes = data.scenes;
        }
    } catch (e) {
        console.warn("[EagleH3Director] loadState 失败:", e);
    }
    return { project, scenes };
}

export function saveState(node, project, scenes) {
    const w = (node.widgets || []).find(x => x.name === "h3_state");
    if (!w) return;
    // 剥离不可序列化的 File 对象，保留 filename/url/kind/retention
    const clean = JSON.parse(JSON.stringify({ project, scenes }));
    (clean.project.refs || []).forEach(r => { if (r) delete r.file; });
    const payload = JSON.stringify(clean);
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        w.value = payload;
        if (typeof w.callback === "function") w.callback(w.value, w, node);
        if (node.graph) node.graph.change();
    }, 600);
}
