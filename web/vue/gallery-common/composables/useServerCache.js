/**
 * useServerCache — 服务端缓存 composable
 *
 * 封装 POST/GET 缓存选中数据到服务端的逻辑
 */
import { ref } from "../../lib/vue.esm-browser.js";

export function useServerCache(cacheEndpoint = "/eagle_gallery/cache_selection") {
    const cacheStatus = ref("idle"); // "idle" | "saving" | "saved" | "error"

    /**
     * POST 选中数据到服务端缓存
     * @param {object} data - { selections, outputMode, folderId, ... }
     */
    async function postSelection(data) {
        cacheStatus.value = "saving";
        try {
            const resp = await fetch(cacheEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });
            if (!resp.ok) {
                console.warn("[GalleryCache] 服务端返回错误:", resp.status, resp.statusText);
                cacheStatus.value = "error";
                return null;
            }
            const respData = await resp.json().catch(() => ({}));
            cacheStatus.value = "saved";
            return respData;
        } catch (e) {
            console.warn("[GalleryCache] 缓存失败:", e);
            cacheStatus.value = "error";
            return null;
        }
    }

    /**
     * 从服务端获取缓存数据
     * @param {string|number} nodeId - 节点 ID
     */
    async function getCachedSelection(nodeId) {
        try {
            const resp = await fetch(cacheEndpoint + "?node_id=" + encodeURIComponent(nodeId));
            if (!resp.ok) return null;
            const data = await resp.json();
            return data.selection_data || null;
        } catch (e) {
            return null;
        }
    }

    return {
        cacheStatus,
        postSelection,
        getCachedSelection,
    };
}
