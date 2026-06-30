/**
 * useSelection — 选择管理 composable
 *
 * 管理 Gallery 节点的图片选中状态
 */
import { ref, computed } from "../../lib/vue.esm-browser.js";

export function useSelection() {
    const selectedItems = ref([]);

    const selectedIds = computed(() => new Set(selectedItems.value.map(s => s.id)));

    function isSelected(id) {
        return selectedIds.value.has(id);
    }

    function toggleSelect(item, opts = {}) {
        const { mode = "selection", folderMode = false } = opts;
        // 文件夹模式下不允手动选择
        if (folderMode) return;

        const itemId = item.id;
        if (isSelected(itemId)) {
            selectedItems.value = selectedItems.value.filter(s => s.id !== itemId);
        } else {
            selectedItems.value = [...selectedItems.value, {
                id: itemId,
                name: item.name || "",
                filePath: item.filePath || "",
                tags: item.tags || [],
                width: item.width || 0,
                height: item.height || 0,
                star: item.star || 0,
                ext: item.ext || "",
                // Wallhaven 专用字段
                image_url: item.image_url || item.path || "",
                thumb_url: item.thumb_url || (item.thumbs && (item.thumbs.small || item.thumbs.original)) || "",
                wallpaper_id: item.wallpaper_id || item.id || "",
                resolution: item.resolution || "",
                // Pinterest 专用字段
                title: item.title || "",
                description: item.description || "",
                pin_id: item.pin_id || item.id || "",
            }];
        }
    }

    function removeFromSelection(selItem) {
        selectedItems.value = selectedItems.value.filter(s => s.id !== selItem.id);
    }

    function clearSelection() {
        selectedItems.value = [];
    }

    return {
        selectedItems,
        selectedIds,
        isSelected,
        toggleSelect,
        removeFromSelection,
        clearSelection,
    };
}
