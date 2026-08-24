/**
 * H3 导演台共享组件库 — 统一导出 + 根组件 H3DirectorApp
 *
 * 目录：
 *   components/  PlanPanel / EditorPanel / ShotSequence / DialogueList / ReferencePanel / PromptPreview
 *   composables/ useComfyNode / useH3State / usePromptCompiler
 *   styles/      h3-director-theme.js
 */
import { defineComponent, reactive, computed, watch, ref, nextTick, provide } from "../../../lib/vue.esm-browser.js";
import { loadState, saveState, createScene, createShot, createDialogue } from "./composables/useH3State.js";

console.log("[EagleH3Director] H3DirectorApp module loaded");
import { compileScenePrompt, compileH3Params, parseDialoguesFromText, buildDialogueTag } from "./composables/usePromptCompiler.js";
import { PlanPanel } from "./components/PlanPanel.js";
import { EditorPanel } from "./components/EditorPanel.js";
import { ShotSequence } from "./components/ShotSequence.js";
import { PromptPreview } from "./components/PromptPreview.js";

const STORE_KEY = "h3store";
const ACTIONS_KEY = "h3actions";

function fmtTime(sec) {
    sec = Math.max(0, Number(sec) || 0);
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec - Math.floor(sec)) * 1000);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function dims(aspect, res) {
    const h = res === "1080p" ? 1080 : 720;
    if (aspect === "9:16") return [h, Math.round(h * 16 / 9)];
    if (aspect === "16:9") return [Math.round(h * 16 / 9), h];
    return [h, h];
}

export const H3DirectorApp = defineComponent({
    name: "H3DirectorApp",
    components: { PlanPanel, EditorPanel, ShotSequence, PromptPreview },
    props: {
        node: { type: Object, required: true },
    },
    setup(props) {
        const { project: p, scenes: sc } = loadState(props.node);
        const project = reactive(p);
        const scenes = reactive(sc);
        const store = reactive({
            project,
            scenes,
            currentSceneId: (sc[0] && sc[0].id) || 1,
            editorTab: "shot",
            dirty: false,
        });

        const flashMsg = ref("");
        let flashTimer = null;
        function flash(msg) {
            flashMsg.value = msg;
            if (flashTimer) clearTimeout(flashTimer);
            flashTimer = setTimeout(() => { flashMsg.value = ""; }, 1800);
        }

        // ---- 场景操作 ----
        const maxId = (arr) => arr.reduce((m, x) => Math.max(m, x.id || 0), 0);
        const currentScene = computed(() => store.scenes.find(s => s.id === store.currentSceneId) || store.scenes[0] || null);

        function addScene() {
            const id = maxId(store.scenes) + 1;
            store.scenes.push(createScene(id));
            store.currentSceneId = id;
            markDirty();
        }
        function cloneScene(id) {
            const src = store.scenes.find(s => s.id === id);
            if (!src) return;
            const nid = maxId(store.scenes) + 1;
            const copy = JSON.parse(JSON.stringify(src));
            copy.id = nid;
            store.scenes.splice(store.scenes.findIndex(s => s.id === id) + 1, 0, copy);
            store.currentSceneId = nid;
            markDirty();
        }
        function removeScene(id) {
            if (store.scenes.length <= 1) { flash("至少保留一个场景"); return; }
            store.scenes = store.scenes.filter(s => s.id !== id);
            if (store.currentSceneId === id) store.currentSceneId = store.scenes[0].id;
            markDirty();
        }
        function selectScene(id) { store.currentSceneId = id; }

        // ---- 镜头操作 ----
        function addShot() {
            const s = currentScene.value; if (!s) return;
            s.shots.push(createShot(maxId(s.shots) + 1));
            markDirty();
        }
        function removeShot(id) {
            const s = currentScene.value; if (!s) return;
            s.shots = s.shots.filter(x => x.id !== id);
            markDirty();
        }
        function autoAssignTimes() {
            const s = currentScene.value; if (!s) return;
            let t = 0;
            for (const sh of s.shots) {
                sh.time = fmtTime(t);
                t += Number(sh.estSeconds) || 2.5;
            }
            markDirty();
            flash("已按默认秒数自动分配时间");
        }

        // ---- 台词操作 ----
        function addDialogue() {
            const s = currentScene.value; if (!s) return;
            s.dialogues.push(createDialogue(maxId(s.dialogues) + 1));
            markDirty();
        }
        function removeDialogue(id) {
            const s = currentScene.value; if (!s) return;
            s.dialogues = s.dialogues.filter(x => x.id !== id);
            markDirty();
        }

        // ---- 双向同步（台词 ↔ 台本）----
        let syncPaused = false;
        let lastChangeSource = "dialogue";

        function syncDialoguesToPreamble(scene) {
            if (syncPaused && lastChangeSource !== "dialogue") return;
            let text = (scene.preamble || "");
            text = text.replace(/<d>[\s\S]*?<\/d>/g, "").replace(/\n{3,}/g, "\n\n").trim();
            const dlg = (scene.dialogues || [])
                .filter(d => d.role && d.text)
                .map(d => "  " + buildDialogueTag(d.role, d.text));
            scene.preamble = (text + (dlg.length ? "\n\nDialogue:\n" + dlg.join("\n") : "")).trim();
        }
        function syncPreambleToDialogues(scene) {
            if (syncPaused && lastChangeSource !== "full") return;
            const parsed = parseDialoguesFromText(scene.preamble || "");
            parsed.forEach((d, i) => {
                const ex = scene.dialogues[i];
                if (ex) { d.id = ex.id; d.time = ex.time; }
            });
            scene.dialogues.splice(0, scene.dialogues.length, ...parsed);
        }
        function onDialogueInput() {
            const s = currentScene.value; if (!s) return;
            lastChangeSource = "dialogue"; syncPaused = true;
            nextTick(() => { syncDialoguesToPreamble(s); syncPaused = false; markDirty(); });
        }
        function onPreambleInput() {
            const s = currentScene.value; if (!s) return;
            lastChangeSource = "full"; syncPaused = true;
            clearTimeout(onPreambleInput._t);
            onPreambleInput._t = setTimeout(() => { syncPreambleToDialogues(s); syncPaused = false; markDirty(); }, 600);
        }

        function markDirty() {
            store.dirty = true;
            saveState(props.node, project, scenes);
        }

        // ---- 输出 ----
        function copyCompiled() {
            const text = compileScenePrompt(store.project, currentScene.value || {});
            navigator.clipboard && navigator.clipboard.writeText(text);
            flash("已复制当前场景编译提示词");
        }
        function copyParams() {
            const json = JSON.stringify(compileH3Params(store.project, store.scenes), null, 2);
            navigator.clipboard && navigator.clipboard.writeText(json);
            flash("已复制 H3_PARAMS(JSON)");
        }

        // ---- 派生显示 ----
        const totalDuration = computed(() => store.scenes.reduce((a, s) => a + ((s.defaultSeconds || 10) * Math.max(1, (s.shots || []).length)), 0));
        const outDims = computed(() => dims(store.project.aspect, store.project.resolution));
        const outputSpec = computed(() => {
            const [w, h] = outDims.value;
            const mp = ((w * h) / 1e6).toFixed(2);
            return `${w}×${h} ${store.project.aspect} ${mp}MP ${totalDuration.value.toFixed(1)}s @${store.project.fps || 24}fps ${store.project.exportMode || "all"}`;
        });

        // 深度监听 → 防抖保存
        watch(store, () => { saveState(props.node, project, scenes); }, { deep: true });

        const actions = {
            addScene, cloneScene, removeScene, selectScene,
            addShot, removeShot, autoAssignTimes,
            addDialogue, removeDialogue,
            onDialogueInput, onPreambleInput, markDirty,
            copyCompiled, copyParams, flash,
        };

        // 注入依赖：所有子组件通过 inject(STORE_KEY/ACTIONS_KEY) 访问
        provide(STORE_KEY, store);
        provide(ACTIONS_KEY, actions);

        return {
            store, actions, flashMsg, currentScene,
            totalDuration, outputSpec, copyCompiled, copyParams,
        };
    },
    template: `
    <div class="h3d-root">
      <div class="h3d-topbar">
        <h1>🦅 <span>Eagle H3 Director</span> <span class="h3d-badge">v1</span></h1>
        <div class="h3d-field"><label>任务</label>
          <select class="h3d-select" v-model="store.project.mode">
            <option value="t2v">文生视频 t2v</option>
            <option value="i2v">图生视频 i2v</option>
            <option value="v2v">视频重绘 v2v</option>
            <option value="fl2v">首末帧 fl2v</option>
            <option value="r2v">角色一致 r2v</option>
            <option value="rv2v">角色+视频 rv2v</option>
          </select>
        </div>
        <div class="h3d-field"><label>比例</label>
          <select class="h3d-select" v-model="store.project.aspect"><option>9:16</option><option>16:9</option><option>1:1</option></select>
        </div>
        <div class="h3d-field"><label>分辨率</label>
          <select class="h3d-select" v-model="store.project.resolution"><option>720p</option><option>1080p</option></select>
        </div>
        <div class="h3d-field"><label>默认秒</label><input class="h3d-input sm" type="number" min="4" max="15" v-model.number="store.project.globalDuration"></div>
        <div class="h3d-field"><label>默认步</label><input class="h3d-input sm" type="number" min="1" max="50" v-model.number="store.project.globalSteps"></div>
        <div class="h3d-field"><label>fps</label><input class="h3d-input sm" type="number" min="8" max="60" v-model.number="store.project.fps"></div>
        <div class="h3d-field"><label>导出</label>
          <select class="h3d-select" v-model="store.project.exportMode"><option value="all">全部导出</option><option value="first">仅首段</option><option value="last">仅末段</option></select>
        </div>
        <span class="h3d-pill">{{ store.scenes.length }} scenes · {{ totalDuration.toFixed(1) }}s</span>
        <span class="h3d-pill">{{ outputSpec }}</span>
        <div class="h3d-spacer"></div>
        <span class="h3d-sync" :class="store.dirty ? 'dirty' : 'ok'">{{ store.dirty ? '⚠ 待同步' : '✓ 已保存' }}</span>
        <button class="h3d-btn" @click="copyParams">📤 参数</button>
        <button class="h3d-btn primary" @click="copyCompiled">📋 复制提示词</button>
      </div>

      <div class="h3d-body">
        <plan-panel></plan-panel>
        <editor-panel></editor-panel>
        <div class="h3d-col" style="flex:0 0 340px">
          <div class="h3d-col-hd">镜头序列 · 编译</div>
          <div class="h3d-col-body h3d-scroll">
            <shot-sequence></shot-sequence>
            <prompt-preview></prompt-preview>
          </div>
        </div>
      </div>

      <div class="h3d-statusbar">
        <span v-if="flashMsg" style="color:var(--h3d-primary)">{{ flashMsg }}</span>
        <span>Scene {{ store.scenes.findIndex(s=>s.id===store.currentSceneId)+1 }}/{{ store.scenes.length }}</span>
        <span>Synchronized with Plan</span>
        <span>{{ outputSpec }}</span>
      </div>
    </div>
    `,
});

export {
    H3DirectorApp,
    PlanPanel, EditorPanel, ShotSequence, PromptPreview,
    STORE_KEY, ACTIONS_KEY,
};
