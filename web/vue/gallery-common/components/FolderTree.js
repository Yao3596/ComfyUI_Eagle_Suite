/**
 * FolderTree — 递归文件夹树组件
 *
 * 从 eagle_gallery_vue.js 提取并通用化
 * 支持折叠/展开、选中高亮
 */
import { defineComponent, ref } from "../../lib/vue.esm-browser.js";

export const FolderTree = defineComponent({
    name: "FolderTree",
    props: {
        folders: { type: Array, default: () => [] },
        activeId: { type: String, default: "" },
        itemClass: { type: String, default: "gal-sidebar-item" },
        iconFolder: { type: String, default: "\uD83D\uDCC1" },
        iconParent: { type: String, default: "\uD83D\uDCC2" },
    },
    emits: ["select"],
    setup(props, { emit }) {
        // 使用对象映射来跟踪展开状态，确保 Vue 3 能够检测到属性变化
        const expandedIds = ref({});

        function toggleExpand(folder, e) {
            if (e) {
                e.stopPropagation();
                e.preventDefault();
            }
            const key = folder.id;
            // 必须通过替换整个对象来触发 Vue 3 的响应式更新
            const next = { ...expandedIds.value };
            next[key] = !next[key];
            expandedIds.value = next;
        }

        function isExpanded(folder) {
            return !!expandedIds.value[folder.id];
        }

        function onSelect(folderId) {
            emit("select", folderId);
        }

        return { expandedIds, toggleExpand, isExpanded, onSelect };
    },
    template: `
    <div class="gal-folder-tree">
        <div v-for="f in folders" :key="f.id" class="gal-folder-item">
            <div :class="[itemClass, { active: activeId === f.id }]" @click="onSelect(f.id)">
                <!-- 仅在有子文件夹时显示切换箭头 -->
                <span v-if="f.children && f.children.length"
                      class="gal-sidebar-toggle"
                      @click.stop="toggleExpand(f, $event)">
                    {{ isExpanded(f) ? '▼' : '▶' }}
                </span>
                <span v-else class="gal-sidebar-icon">{{ iconFolder }}</span>
                <span class="gal-folder-name" :title="f.name">{{ f.name || '未命名' }}</span>
            </div>
            <!-- 递归渲染子树，受 isExpanded 控制 -->
            <div v-if="f.children && f.children.length && isExpanded(f)" class="gal-sidebar-children">
                <FolderTree :folders="f.children" :active-id="activeId" :item-class="itemClass"
                             :icon-folder="iconFolder" :icon-parent="iconParent"
                             @select="onSelect($event)">
                </FolderTree>
            </div>
        </div>
    </div>
    `,
});
