/**
 * usePromptCompiler — H3 六段编译纯函数（前端预览用，后端为权威）。
 * 逻辑与 eagle_suite/h3_director_node.py 的 compile_scene_prompt 镜像。
 */

function buildSubjectDefinitions(project) {
    const refs = (project && project.refs) || [];
    const lines = [];
    const noun = { person: "a character", prop: "a prop", style: "an art style", environment: "an environment", composition: "a composition" };
    refs.forEach((r, i) => {
        if (r && r.filename) {
            const n = noun[r.kind] || "a reference";
            lines.push(`  <Picture ${i + 1}> is ${n} reference used as @ref${i + 1}.`);
        }
    });
    return lines.join("\n");
}

function buildRetention(project) {
    const refs = (project && project.refs) || [];
    const lines = [];
    refs.forEach((r, i) => {
        if (r && r.filename) {
            const ret = r.retention || "fully_preserved";
            let line = `  @ref${i + 1}: ${ret}.`;
            if (r.kind === "person") line += " Do not copy the background of the reference image; keep only the character design.";
            lines.push(line);
        }
    });
    return lines.join("\n");
}

function stripDialogueTags(text) {
    return text.replace(/<d>[\s\S]*?<\/d>/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function buildShotBlocks(shots) {
    if (!shots || !shots.length) return "";
    const lines = shots.map((s, i) => {
        const parts = [];
        if (s.time) parts.push(`At ${s.time},`);
        if (s.framing) parts.push(`[${s.framing}]`);
        parts.push(s.content || "(no content)");
        if (s.action) parts.push(`Action: ${s.action}.`);
        if (s.camera) parts.push(`Camera: ${s.camera}.`);
        if (s.sound) parts.push(`Sound: ${s.sound}.`);
        return `[Shot ${i + 1}: ${s.title || "untitled"}] ` + parts.join(" ");
    });
    return "detailed_description:\n  " + lines.join("\n\n  ");
}

function buildDialogueBlock(dialogues) {
    const items = (dialogues || [])
        .filter(d => d && d.role && d.text)
        .map(d => `  <d>[${d.role}] ${d.text}</d>`);
    return items.length ? "Dialogue:\n" + items.join("\n") : "";
}

function buildBody(project, scene) {
    const preamble = stripDialogueTags(scene.preamble || "");
    const detailed = buildShotBlocks(scene.shots);
    const dialogue = buildDialogueBlock(scene.dialogues);
    return [preamble, detailed, dialogue].filter(Boolean).join("\n\n");
}

function buildAlignment(project) {
    const mode = (project && project.mode) || "t2v";
    const refs = (project && project.refs) || [];
    const used = refs.map((r, i) => (r && r.filename ? i : -1)).filter(i => i >= 0);
    if (mode === "i2v" || mode === "fl2v") {
        if (!used.length) return "";
        const n = used[0] + 1;
        if (mode === "fl2v") {
            return "alignment:\n  For the target video, the first and last frames must match @ref" + n + " composition and subject.\n  How the reference pictures align with the described shots: keep subject identity and key framing.";
        }
        return "alignment:\n  The first frame must match @ref" + n + " as the starting image.\n  How the reference pictures align with the described shots: maintain subject and style continuity.";
    }
    if (mode === "r2v" || mode === "rv2v") {
        return "character_consistency:\n  Maintain strict identity, outfit, and silhouette across all shots using the provided character references.";
    }
    return "";
}

export function compileScenePrompt(project, scene) {
    project = project || {};
    scene = scene || {};
    const parts = [];
    const mode = (project.mode || "t2v").toUpperCase();
    const secs = scene.defaultSeconds || 10;
    const aspect = project.aspect || "9:16";
    const resolution = project.resolution || "720p";
    const fps = project.fps || 24;

    parts.push(`Task: ${mode}, ${secs}s, ${aspect}, ${resolution}, ${fps}fps.`);

    const subj = buildSubjectDefinitions(project);
    if (subj) parts.push("subject_definitions:\n" + subj);

    const foundation = (project.foundation || "").trim();
    if (foundation) parts.push("integrated_multimodal_description:\n  " + foundation.replace(/\n/g, "\n  "));

    const ret = buildRetention(project);
    if (ret) parts.push("retention_analysis:\n" + ret);

    const body = buildBody(project, scene);
    if (body) parts.push(body);

    const shots = scene.shots || [];
    const sounds = shots.map(s => s.sound).filter(Boolean);
    parts.push("overall_soundscape:\n  " + (sounds.length ? sounds.join(", ") : "ambient silence"));
    parts.push("non_diegetic_music:\n  A subtle underscore matching the mood.");

    const align = buildAlignment(project);
    if (align) parts.push(align);

    return parts.join("\n\n");
}

export function compileH3Params(project, scenes, llmHint) {
    project = project || {};
    scenes = scenes || [];
    const fps = project.fps || 24;
    let total = 0;
    const sceneMeta = scenes.map((s, i) => {
        const secs = (s && s.defaultSeconds) || 10;
        total += Number(secs) || 0;
        return { index: i + 1, title: (s && s.title) || "", seconds: secs, shots: (s.shots || []).length, dialogues: (s.dialogues || []).length };
    });
    const refsMeta = (project.refs || []).filter(r => r && r.filename)
        .map((r, i) => ({ index: i + 1, kind: r.kind || "person", retention: r.retention || "fully_preserved", filename: r.filename }));
    return {
        mode: project.mode || "t2v",
        aspect: project.aspect || "9:16",
        resolution: project.resolution || "720p",
        fps: fps,
        exportMode: project.exportMode || "all",
        default_duration_seconds: project.globalDuration || 7,
        default_steps: project.globalSteps || 8,
        total_scenes: sceneMeta.length,
        total_seconds: Math.round(total * 1000) / 1000,
        total_frames: Math.round(total * fps),
        refs: refsMeta,
        scenes: sceneMeta,
        llm_hint: llmHint || null,
    };
}

export const DIALOGUE_REGEX = /<d>\[([^\]]+)\]\s*([^<]+)<\/d>/g;

export function parseDialoguesFromText(text) {
    const out = [];
    let m;
    DIALOGUE_REGEX.lastIndex = 0;
    while ((m = DIALOGUE_REGEX.exec(text)) !== null) {
        out.push({ role: m[1].trim(), text: m[2].trim(), time: "" });
    }
    return out;
}

export function buildDialogueTag(role, text) {
    return `<d>[${role}] ${text}</d>`;
}
