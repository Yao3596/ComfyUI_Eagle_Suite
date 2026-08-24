/**
 * ShotSequence — 右栏上：当前场景镜头序列卡片（点击跳回分镜编辑）
 */
import { defineComponent, inject, computed } from "../../../lib/vue.esm-browser.js";

export const ShotSequence = defineComponent({
    name: "ShotSequence",
    setup() {
        const store = inject("h3store");
        const actions = inject("h3actions");
        const scene = computed(() => store.scenes.find(s => s.id === store.currentSceneId) || null);
        const dialogues = computed(() => (scene.value ? scene.value.dialogues : []) || []);

        function jump() {
            store.editorTab = "shot";
        }

        return { store, actions, scene, dialogues, jump };
    },
    template: `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="h3d-row" style="justify-content:space-between">
        <span class="h3d-card-title" style="margin:0">🎞️ 镜头序列</span>
        <span class="h3d-mini">{{ (scene?scene.shots.length:0) }} 镜 · {{ dialogues.length }} 句</span>
      </div>
      <div v-if="!scene" class="h3d-empty">请先选择场景</div>
      <div v-else-if="!scene.shots.length" class="h3d-empty">该场景暂无镜头，去「分镜」添加</div>
      <div v-for="(s,i) in scene.shots" :key="s.id" class="h3d-shot" @click="jump">
        <div class="hd">
          <span class="st">镜头 {{ i+1 }}</span>
          <span class="tm">{{ s.time }}</span>
        </div>
        <div class="ct">{{ s.content || '(无内容)' }}</div>
        <div class="mt" v-if="s.framing || s.camera">[{{ s.framing }}] · {{ s.camera }}</div>
        <div class="mt" v-if="s.action || s.sound">动作:{{ s.action }} 音效:{{ s.sound }}</div>
      </div>
    </div>
    `,
});
