/**
 * ImageGrid — 图片网格组件
 *
 * CSS Grid 布局的图片缩略图网格，支持选中高亮、懒加载、状态提示
 */
import { defineComponent, ref } from "../../lib/vue.esm-browser.js";

export const ImageGrid = defineComponent({
    name: "ImageGrid",
    props: {
        items: { type: Array, default: () => [] },
        selectedIds: { type: Set, default: null },
        loading: { type: Boolean, default: false },
        errorMsg: { type: String, default: "" },
        emptyText: { type: String, default: "选择文件夹或输入关键词搜索" },
        thumbnailUrlFn: { type: Function, default: null },
        showIndex: { type: Boolean, default: false },
    },
    emits: ["select", "dblclick"],
    setup(props, { emit }) {
        const gridEl = ref(null);

        function isSelected(id) {
            return props.selectedIds?.has(id) || false;
        }

        function getThumbUrl(item) {
            if (props.thumbnailUrlFn) return props.thumbnailUrlFn(item);
            return "/eagle_gallery/thumbnail?id=" + encodeURIComponent(item.id);
        }

        function onClick(item, index) {
            emit("select", { item, index });
        }

        function onDblClick(item, index) {
            emit("dblclick", { item, index });
        }

        function onImgError(event, item) {
            const img = event.target;
            const fallback = item.thumbnail || item.thumb_url || item.thumbnailPath || "";
            if (fallback && img.src !== fallback) {
                img.src = fallback;
            } else {
                // 显示占位符而不是隐藏
                img.style.opacity = "0.3";
                img.style.background = "repeating-conic-gradient(#333 0% 25%, #25252a 0% 50%) 0 0 / 12px 12px";
            }
        }

        return { gridEl, isSelected, getThumbUrl, onClick, onDblClick, onImgError };
    },
    template: `
    <div class="gal-grid" ref="gridEl">
        <div v-if="loading" class="gal-loading">&#128260; 加载中...</div>
        <div v-else-if="errorMsg" class="gal-error">{{ errorMsg }}</div>
        <div v-else-if="items.length === 0" class="gal-empty">{{ emptyText }}</div>
        <template v-else>
            <div v-for="(item, i) in items" :key="item.id"
                 class="gal-thumb"
                 :class="{ selected: isSelected(item.id) }"
                 :data-id="item.id" :data-index="i"
                 @click="onClick(item, i)"
                 @dblclick="onDblClick(item, i)">
                <img :src="getThumbUrl(item)" loading="lazy" :alt="item.name || item.title || ''"
                     @error="onImgError($event, item)" />
                <!-- 默认信息栏：标签数 + 名称 -->
                <div class="gal-thumb-info">
                    <span>{{ item.tags && item.tags.length ? '&#127991; ' + item.tags.length : '' }}</span>
                    <span>{{ truncate(item.name || item.title || '', 12) }}</span>
                </div>
                <!-- 序号标记 -->
                <span v-if="showIndex" class="gal-thumb-index">#{{ i }}</span>
                <!-- 星标 -->
                <span v-if="item.star > 0" class="gal-thumb-star">{{ '&#9733;'.repeat(item.star) }}</span>
                <!-- 分辨率 -->
                <span v-if="item.width && item.height" class="gal-thumb-res">{{ item.width }}x{{ item.height }}</span>
                <!-- 纯度标记（Wallhaven 专用） -->
                <span v-if="item.purity" class="gal-thumb-badge"
                      :class="'gal-badge-' + item.purity">{{ item.purity.toUpperCase() }}</span>
                <!-- 标题（Pinterest 专用） -->
                <span v-if="item.title && !item.name" class="gal-thumb-title">{{ item.title }}</span>
                <!-- 自定义覆盖层 slot -->
                <slot name="thumb-overlay" :item="item" :index="i"></slot>
            </div>
        </template>
    </div>
    `,
    methods: {
        truncate(text, maxLen) {
            return text && text.length > maxLen ? text.slice(0, maxLen) + "..." : (text || "");
        },
    },
});
