/**
 * useServerCache — 服务端缓存 composable
 * POST 选中数据 / GET 缓存数据
 */
import { ref } from "../../../lib/vue.esm-browser.js";

export function useServerCache(cachePath = "/eagle_gallery") {
  const cacheStatus = ref("idle"); // "idle" | "saving" | "saved" | "error"

  /** POST 选中数据到服务端缓存 */
  async function postSelection(data, nodeId) {
    cacheStatus.value = "saving";
    try {
      const res = await fetch(`${cachePath}/cache_selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: nodeId, selections: data }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cacheStatus.value = "saved";
    } catch (e) {
      console.warn("[useServerCache] POST failed:", e);
      cacheStatus.value = "error";
    }
  }

  /** GET 缓存数据 */
  async function getCachedSelection(nodeId) {
    try {
      const res = await fetch(`${cachePath}/cache_selection?node_id=${encodeURIComponent(nodeId)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.selections || null;
    } catch (e) {
      console.warn("[useServerCache] GET failed:", e);
      return null;
    }
  }

  return {
    cacheStatus,
    postSelection,
    getCachedSelection,
  };
}
