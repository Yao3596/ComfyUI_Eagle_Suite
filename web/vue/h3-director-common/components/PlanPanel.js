/**
 * PlanPanel — 左栏：世界构建基础 + 全局参数（折叠）+ 场景列表
 */
import { defineComponent, inject, ref, computed } from "../../../lib/vue.esm-browser.js";

export const PlanPanel = defineComponent({
    name: "PlanPanel",
    setup() {
        const store = inject("h3store");
        const actions = inject("h3actions");
        const planOpen = ref(true);

        const globalFields = [
            { key: "contextLength", label: "context_length" },
            { key: "encodeMode", label: "encode_mode" },
            { key: "anchorMode", label: "anchor_mode" },
            { key: "crop", label: "crop" },
            { key: "audioMode", label: "audio_mode" },
            { key: "audioContextLength", label: "audio_context_length" },
            { key: "baseSeed", label: "base_seed" },
            { key: "segmentRef", label: "segment_ref" },
            { key: "videoBlendFrames", label: "video_blend_frames" },
            { key: "continuationMode", label: "continuation_mode" },
        ];

        const sceneDuration = (s) => (s.defaultSeconds || 10) * (s.shots || []).length || (s.defaultSeconds || 10);
        const estTokens = (s) => {
            const txt = (s.preamble || "") + (s.shots || []).map(x => x.content || "").join(" ");
            return Math.round((txt.length) / 3.2);
        };
        const timeBarPct = (s) => {
            const def = store.project.globalDuration || 7;
            return Math.min(100, Math.round((sceneDuration(s) / (def * Math.max(1, (s.shots || []).length || 1))) * 100));
        };

        const totalDuration = computed(() => (store.scenes || []).reduce((a, s) => a + sceneDuration(s), 0));

        return { store, actions, planOpen, globalFields, sceneDuration, estTokens, timeBarPct, totalDuration };
    },
    template: `
    <div class="h3d-col" style="flex:0 0 300px;">
      <div class="h3d-col-hd">🎬 Plan 节点 · 规划</div>
      <div class="h3d-col-body h3d-scroll">
        <!-- 世界构建基础 -->
        <div class="h3d-card">
          <div class="h3d-card-title">🌐 世界构建 & 风格基础</div>
          <div class="h3d-hint" style="margin-bottom:8px">世界观 / 视觉风格 / 角色基础塑造，自动 prepend 到每个场景的 integrated_multimodal_description。</div>
          <textarea class="h3d-textarea" style="min-height:84px" v-model="store.project.foundation" placeholder="Worldview: ...&#10;Visual style: ...&#10;Character base: ..."></textarea>
        </div>

        <!-- 全局参数（折叠） -->
        <div class="h3d-card">
          <div class="h3d-collapse" :class="{open:planOpen}" @click="planOpen=!planOpen">
            <span class="arrow">▶</span> 全局参数（Plan widgets）
          </div>
          <div v-show="planOpen" class="h3d-grid2" style="margin-top:8px">
            <div class="h3d-row col" v-for="f in globalFields" :key="f.key">
              <label class="h3d-label">{{ f.label }}</label>
              <input class="h3d-input" v-model="store.project[f.key]">
            </div>
          </div>
        </div>

        <!-- 场景列表 -->
        <div class="h3d-card">
          <div class="h3d-card-title" style="justify-content:space-between">
            <span>🎞️ 场景列表 ({{ store.scenes.length }})</span>
            <button class="h3d-btn sm primary" @click="actions.addScene">+ 场景</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
            <div v-for="(s,i) in store.scenes" :key="s.id" class="h3d-scene" :class="{active: store.currentSceneId===s.id}" @click="actions.selectScene(s.id)">
              <div class="ttl">
                <span>场景 {{ i+1 }} · {{ s.title || '未命名' }}</span>
                <span>
                  <button class="h3d-btn sm" @click.stop="actions.cloneScene(s.id)">⧉</button>
                  <button class="h3d-btn sm danger" @click.stop="actions.removeScene(s.id)">×</button>
                </span>
              </div>
              <div class="h3d-row" style="margin-top:4px">
                <span class="h3d-mini">默认 {{ s.defaultSeconds }}s · {{ s.defaultSteps }}步</span>
              </div>
              <div class="h3d-bar" :class="{over: sceneDuration(s) > (store.project.globalDuration||7)*(s.shots||[]).length}">
                <i :style="{width: timeBarPct(s)+'%'}"></i>
              </div>
              <div class="h3d-mini" style="margin-top:4px">{{ sceneDuration(s) }}s · {{ estTokens(s) }} tok</div>
            </div>
          </div>
        </div>
        <div class="h3d-pill" style="margin-top:4px">合计 {{ totalDuration.toFixed(1) }}s</div>
      </div>
    </div>
    `,
});
