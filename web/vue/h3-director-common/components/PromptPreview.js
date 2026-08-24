/**
 * PromptPreview — 右栏下：实时编译预览（H3 六段格式）+ 分页 + 检查提醒
 */
import { defineComponent, inject, computed, ref } from "../../../lib/vue.esm-browser.js";
import { compileScenePrompt } from "../composables/usePromptCompiler.js";

export const PromptPreview = defineComponent({
    name: "PromptPreview",
    setup() {
        const store = inject("h3store");
        const actions = inject("h3actions");
        const scene = computed(() => store.scenes.find(s => s.id === store.currentSceneId) || null);

        const compiled = computed(() => compileScenePrompt(store.project, scene.value || {}));

        const MAX = 1600;
        const pages = computed(() => {
            const text = compiled.value;
            if (!text) return [""];
            const chunks = [];
            let i = 0;
            while (i < text.length) { chunks.push(text.slice(i, i + MAX)); i += MAX; }
            return chunks.length ? chunks : [""];
        });
        const pageIndex = ref(0);
        const currentPage = computed(() => pages.value[Math.min(pageIndex.value, pages.value.length - 1)] || "");

        const wordCount = computed(() => compiled.value.replace(/\s+/g, "").length);
        const warnings = computed(() => {
            const w = [];
            if (!store.project.foundation || !store.project.foundation.trim()) w.push("世界构建基础为空，建议补充世界观/视觉风格/角色。");
            if (!scene.value || !scene.value.shots || !scene.value.shots.length) w.push("当前场景没有镜头。");
            if (!scene.value || !(scene.value.dialogues || []).length) w.push("当前场景没有台词。");
            const usedRefs = (store.project.refs || []).filter(r => r.filename).length;
            if (!usedRefs && ["i2v", "fl2v", "r2v", "rv2v"].includes(store.project.mode)) w.push("该模式通常需要参考图。");
            return w;
        });

        function copyCompiled() {
            navigator.clipboard && navigator.clipboard.writeText(compiled.value);
            actions.flash("已复制编译提示词");
        }

        return { store, actions, scene, compiled, pages, pageIndex, currentPage, wordCount, warnings, copyCompiled };
    },
    template: `
    <div style="display:flex;flex-direction:column;gap:8px;flex:1;min-height:0">
      <div class="h3d-card-title" style="justify-content:space-between">
        <span>🔍 实时编译预览（H3 六段）</span>
        <button class="h3d-btn sm" @click="copyCompiled">📋 复制</button>
      </div>
      <pre class="h3d-preview">{{ currentPage }}</pre>
      <div class="h3d-stats">
        <div class="h3d-stat">词数 <b>{{ wordCount }}</b></div>
        <div class="h3d-stat">页 <b>{{ pageIndex+1 }}/{{ pages.length }}</b></div>
        <button v-if="pages.length>1" class="h3d-btn sm" @click="pageIndex=Math.max(0,pageIndex-1)">‹</button>
        <button v-if="pages.length>1" class="h3d-btn sm" @click="pageIndex=Math.min(pages.length-1,pageIndex+1)">›</button>
      </div>
      <div v-if="warnings.length" class="h3d-warn">
        ⚠️ 检查提醒
        <ul><li v-for="(w,i) in warnings" :key="i">{{ w }}</li></ul>
      </div>
    </div>
    `,
});
