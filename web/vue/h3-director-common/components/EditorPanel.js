/**
 * EditorPanel — 中栏：分镜 / 台词 / 参考 / 台本 四标签
 */
import { defineComponent, inject, computed, ref } from "../../../lib/vue.esm-browser.js";
import { DialogueList } from "./DialogueList.js";
import { ReferencePanel } from "./ReferencePanel.js";

export const EditorPanel = defineComponent({
    name: "EditorPanel",
    components: { DialogueList, ReferencePanel },
    setup() {
        const store = inject("h3store");
        const actions = inject("h3actions");
        const scene = computed(() => store.scenes.find(s => s.id === store.currentSceneId) || null);

        const tabs = [
            { key: "shot", label: "🎬 分镜" },
            { key: "dialogue", label: "💬 台词" },
            { key: "ref", label: "🖼️ 参考" },
            { key: "script", label: "📝 台本" },
        ];

        return { store, actions, scene, tabs };
    },
    template: `
    <div class="h3d-col" style="flex:1;min-width:0">
      <div class="h3d-col-hd">
        <span>✎ Editor 节点 · 场景编辑</span>
        <span class="h3d-mini" v-if="scene">场景 {{ store.scenes.findIndex(s=>s.id===store.currentSceneId)+1 }} / {{ store.scenes.length }}</span>
      </div>
      <div class="h3d-col-body h3d-scroll" style="gap:8px">
        <div v-if="!scene" class="h3d-empty">请先选择或创建场景</div>
        <template v-else>
          <div class="h3d-tabs">
            <button v-for="t in tabs" :key="t.key" class="h3d-tab" :class="{active: store.editorTab===t.key}" @click="store.editorTab=t.key">{{ t.label }}</button>
          </div>

          <!-- 分镜 -->
          <div v-show="store.editorTab==='shot'" style="display:flex;flex-direction:column;gap:8px">
            <div class="h3d-row" style="justify-content:space-between">
              <button class="h3d-btn sm primary" @click="actions.addShot()">+ 镜头</button>
              <button class="h3d-btn sm" @click="actions.autoAssignTimes()">⏱ 自动分配时间</button>
            </div>
            <div v-for="(s,i) in scene.shots" :key="s.id" class="h3d-shot">
              <div class="hd">
                <span class="st">镜头 {{ i+1 }}</span>
                <button class="h3d-btn sm danger" @click="actions.removeShot(s.id)">×</button>
              </div>
              <div class="h3d-grid2" style="margin-top:4px">
                <div class="h3d-row col"><label class="h3d-label">时间码</label><input class="h3d-input time" v-model="s.time" placeholder="00:00.000"></div>
                <div class="h3d-row col"><label class="h3d-label">景别</label><input class="h3d-input" v-model="s.framing" placeholder="medium-wide"></div>
              </div>
              <div class="h3d-row col" style="margin-top:6px"><label class="h3d-label">内容</label><textarea class="h3d-textarea" style="min-height:44px" v-model="s.content" placeholder="镜头描述..."></textarea></div>
              <div class="h3d-grid2" style="margin-top:6px">
                <div class="h3d-row col"><label class="h3d-label">运镜</label><input class="h3d-input" v-model="s.camera" placeholder="push-in"></div>
                <div class="h3d-row col"><label class="h3d-label">动作</label><input class="h3d-input" v-model="s.action" placeholder="动作"></div>
              </div>
              <div class="h3d-grid2" style="margin-top:6px">
                <div class="h3d-row col"><label class="h3d-label">音效</label><input class="h3d-input" v-model="s.sound" placeholder="sound"></div>
                <div class="h3d-row col"><label class="h3d-label">预估秒</label><input class="h3d-input sm" type="number" step="0.5" v-model.number="s.estSeconds"></div>
              </div>
            </div>
          </div>

          <!-- 台词 -->
          <div v-show="store.editorTab==='dialogue'"><dialogue-list></dialogue-list></div>

          <!-- 参考 -->
          <div v-show="store.editorTab==='ref'"><reference-panel></reference-panel></div>

          <!-- 台本 -->
          <div v-show="store.editorTab==='script'" style="display:flex;flex-direction:column;gap:6px">
            <div class="h3d-hint">完整台本（可含 <span class="h3d-tag">&lt;d&gt;[角色] 台词&lt;/d&gt;</span>）。后端编译时按结构字段重建，此处自由文本作为 preamble 前置。</div>
            <textarea class="h3d-textarea" style="min-height:180px" v-model="scene.preamble" @input="actions.onPreambleInput()" placeholder="自由文本开场 + [Shot N] 描述由分镜自动生成"></textarea>
          </div>
        </template>
      </div>
    </div>
    `,
});
