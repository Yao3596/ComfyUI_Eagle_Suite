/**
 * PreviewBar — 预览条组件
 *
 * 显示已选中图片的缩略图，支持横向滚轮滚动、删除和清除
 */
import { defineComponent } from "../../lib/vue.esm-browser.js";

export const PreviewBar = defineComponent({
    name: "PreviewBar",
    props: {
        selectedItems: { type: Array, default: () => [] },
        thumbnailUrlFn: { type: Function, default: null },
        modeText: { type: String, default: "" },
        showClear: { type: Boolean, default: true },
    },
    emits: ["remove", "clear"],
    setup(props, { emit }) {
        function onPreviewWheel(e) {
            if (e.deltaY !== 0) {
                e.preventDefault();
                e.currentTarget.scrollLeft += e.deltaY;
            }
        }

        function getThumbUrl(item) {
            if (props.thumbnailUrlFn) return props.thumbnailUrlFn(item);
            // 默认：Eagle 格式
            return "/eagle_gallery/thumbnail?id=" + encodeURIComponent(item.id);
        }

        function onRemove(item) {
            emit("remove", item);
        }

        function onClear() {
            emit("clear");
        }

        function onImgError(event, item) {
            const img = event.target;
            const fallback = item.thumbnail || item.thumb_url || item.thumbnailPath || "";
            if (fallback && img.src !== fallback) {
                img.src = fallback;
            } else {
                img.style.display = "none";
            }
        }

        return { onPreviewWheel, getThumbUrl, onRemove, onClear, onImgError };
    },
    template: `
    <div class="gal-preview" @wheel="onPreviewWheel">
        <div v-if="modeText" class="gal-preview-mode-text" v-html="modeText"></div>
        <template v-else-if="selectedItems.length === 0">
            <div class="gal-preview-empty">选中图片将显示在这里</div>
        </template>
        <template v-else>
            <template v-for="sel in selectedItems" :key="sel.id">
                <div class="gal-preview-thumb">
                    <img :src="getThumbUrl(sel)" :title="sel.name || sel.title || ''" @error="onImgError($event, sel)" />
                    <div class="gal-preview-del" @click.stop="onRemove(sel)">&times;</div>
                </div>
            </template>
            <button v-if="showClear && selectedItems.length > 0" class="gal-btn"
                    style="flex-shrink:0;height:60px;align-self:center;margin-left:4px"
                    @click.stop="onClear" title="清除全部">清除</button>
        </template>
    </div>
    `,
});
