/**
 * useSelection — 选中状态管理 composable
 * 统一处理 Eagle/Wallhaven/Pinterest 不同字段
 */
import { ref, computed } from "../../../lib/vue.esm-browser.js";

export function useSelection(options = {}) {
  const selectedItems = ref([]);
  const selectedIds = computed(() => new Set(selectedItems.value.map(i => i.id)));

  function isSelected(id) {
    return selectedIds.value.has(id);
  }

  function toggleSelect(item, opts = {}) {
    const { folderMode = false } = opts;
    if (folderMode) return; // 文件夹模式下禁止手动选择

    const id = item.id;
    const idx = selectedItems.value.findIndex(s => s.id === id);
    if (idx >= 0) {
      selectedItems.value.splice(idx, 1);
    } else {
      selectedItems.value.push(item);
    }
  }

  function removeFromSelection(id) {
    const idx = selectedItems.value.findIndex(s => s.id === id);
    if (idx >= 0) selectedItems.value.splice(idx, 1);
  }

  function clearSelection() {
    selectedItems.value = [];
  }

  function setSelection(items) {
    selectedItems.value = items.slice();
  }

  return {
    selectedItems,
    selectedIds,
    isSelected,
    toggleSelect,
    removeFromSelection,
    clearSelection,
    setSelection,
  };
}
