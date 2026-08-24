/**
 * ReferencePanel — 参考图 @ref1~9 管理（上传 / 类型 / 保留级别）
 */
import { defineComponent, inject, computed } from "../../../lib/vue.esm-browser.js";

export const ReferencePanel = defineComponent({
    name: "ReferencePanel",
    setup() {
        const store = inject("h3store");
        const actions = inject("h3actions");

        const proxyUrl = (fn) => fn ? ("/h3_director/ref_proxy?filename=" + encodeURIComponent(fn)) : "";

        function onFile(e, i) {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const fd = new FormData();
            fd.append("file", file);
            fetch("/h3_director/upload_ref", { method: "POST", body: fd })
                .then(r => r.json())
                .then(data => {
                    if (data.success && data.filename) {
                        store.project.refs[i].filename = data.filename;
                        store.project.refs[i].url = proxyUrl(data.filename);
                        actions.markDirty();
                    } else {
                        alert("上传失败：" + (data.error || "未知"));
                    }
                })
                .catch(err => alert("上传失败：" + err));
            e.target.value = "";
        }

        function clearRef(i) {
            store.project.refs[i].filename = "";
            store.project.refs[i].url = "";
            store.project.refs[i].file = null;
            actions.markDirty();
        }

        return { store, actions, proxyUrl, onFile, clearRef };
    },
    template: `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="h3d-hint">参考图经后端保存，随 h3_state 持久化；输出端口 REF_IMAGES 直接连 R2V 节点。人物类自动附带"不要复制背景"提醒。</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        <div v-for="(r,i) in store.project.refs" :key="i" class="h3d-refslot" :class="{ 'has-img': r.filename }">
          <span class="h3d-tag">@ref{{ i+1 }}</span>
          <label class="h3d-refslot thumb">
            <img v-if="r.url" :src="r.url" alt="">
            <span v-else class="ph">+</span>
            <input type="file" accept="image/*" style="display:none" @change="onFile($event,i)">
          </label>
          <select class="h3d-select" v-model="r.kind" @change="actions.markDirty()">
            <option value="person">人物</option>
            <option value="prop">道具</option>
            <option value="style">风格</option>
            <option value="environment">环境</option>
            <option value="composition">构图</option>
          </select>
          <select class="h3d-select" v-model="r.retention" @change="actions.markDirty()">
            <option value="fully_preserved">完全保留</option>
            <option value="partially_preserved">部分保留</option>
            <option value="style_only">仅风格</option>
          </select>
          <button v-if="r.filename" class="h3d-btn sm danger" @click="clearRef(i)">移除</button>
        </div>
      </div>
    </div>
    `,
});
