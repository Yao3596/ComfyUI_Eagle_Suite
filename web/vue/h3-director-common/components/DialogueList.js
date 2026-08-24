/**
 * DialogueList — 台词列表（与台本 <d> 标签双向同步由 root actions 处理）
 */
import { defineComponent, inject, computed } from "../../../lib/vue.esm-browser.js";

export const DialogueList = defineComponent({
    name: "DialogueList",
    setup() {
        const store = inject("h3store");
        const actions = inject("h3actions");
        const scene = computed(() => store.scenes.find(s => s.id === store.currentSceneId) || null);
        return { store, actions, scene };
    },
    template: `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="h3d-hint">台词以 <span class="h3d-tag">&lt;d&gt;[角色] 台词&lt;/d&gt;</span> 写入台本；编辑列表会自动重写台本，编辑台本会回写此列表。</div>
      <div v-if="!scene" class="h3d-empty">请先在左侧选择场景</div>
      <template v-else>
        <div v-for="(d,i) in scene.dialogues" :key="d.id" class="h3d-dlg">
          <div class="h3d-row" style="gap:6px">
            <input class="h3d-input sm" style="flex:0 0 90px" v-model="d.role" placeholder="角色" @input="actions.onDialogueInput()">
            <input class="h3d-input sm h3d-input time" v-model="d.time" placeholder="00:00.000" @input="actions.onDialogueInput()">
            <button class="h3d-btn sm danger" @click="actions.removeDialogue(d.id)">×</button>
          </div>
          <textarea class="h3d-textarea" style="min-height:38px;margin-top:5px" v-model="d.text" placeholder="台词内容" @input="actions.onDialogueInput()"></textarea>
        </div>
        <button class="h3d-btn sm" @click="actions.addDialogue()">+ 台词</button>
      </template>
    </div>
    `,
});
