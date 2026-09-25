import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import {
  assertResolvedDecision,
  isValidRetryLength,
  mountH3ReviewWorkspace,
  normalizeWorkspace,
} from "../svelte-dist/h3-review-workspace.js";

const NODE_TYPE = "EagleH3ReviewWorkspaceNode";
const HIDDEN_WIDGETS = new Set([
  "workspace_state",
  "review_decision",
  "retry_prompt",
  "retry_seed",
  "retry_length",
  "resume_scene",
  "assemble_partial_on_stop",
  "auto_continue_timeout_minutes",
  "unload_models_while_waiting",
]);

function ensureStylesheet() {
  if (document.getElementById("eagle-h3-review-workspace-svelte-css")) return;
  const link = document.createElement("link");
  link.id = "eagle-h3-review-workspace-svelte-css";
  link.rel = "stylesheet";
  link.href = new URL("../svelte-dist/h3-review-workspace.css", import.meta.url).href;
  document.head.appendChild(link);
}

function getWidget(node, name) {
  return (node.widgets || []).find((widget) => widget.name === name);
}

function setWidget(node, name, value, markGraph = false) {
  const widget = getWidget(node, name);
  if (!widget) return;
  widget.value = value;
  widget.callback?.(value);
  if (markGraph) node.graph?.change?.();
}

function hideControlWidgets(node) {
  const widgets = node.widgets || [];
  for (let index = 0; index < widgets.length; index++) {
    const widget = widgets[index];
    if (!HIDDEN_WIDGETS.has(widget.name)) continue;
    widget.type = "hidden";
    widget.hidden = true;
    widget.options ||= {};
    Object.assign(widget.options, { hidden: true, vueNode: "never", hideInPanel: true });
    widget.computeSize = () => [0, -4];
    widget.draw = () => {};
    widgets.splice(index, 1, widget);
  }
}

function viewUrl(filePath) {
  if (!filePath) return "";
  const normalized = String(filePath).replace(/\\/g, "/");
  const marker = "h3_eagle_chains/";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 0) return "";
  const relative = normalized.slice(markerIndex);
  const slash = relative.lastIndexOf("/");
  const params = new URLSearchParams({
    type: "output",
    filename: relative.slice(slash + 1),
    subfolder: relative.slice(0, slash),
  });
  return api.apiURL(`/view?${params}`);
}

function queuePrompt() {
  if (typeof app.queuePrompt === "function") return Promise.resolve(app.queuePrompt(0));
  throw new Error("当前 ComfyUI 前端不支持重新入队");
}

async function submitDecision(node, decision, payload) {
  const retryLength = Number(payload.retry_length || 0);
  if (!isValidRetryLength(retryLength)) {
    throw new Error("H3 length 只允许 0 或 17k+5（5、22、39…3592）");
  }
  const token = String(payload.token || "");
  if (token && (node._eagleH3ResolvedToken === token || node._eagleH3SubmittingToken === token)) {
    throw new Error("当前审片版本已提交，请等待新 token 或状态更新");
  }

  setWidget(node, "retry_prompt", payload.retry_prompt || "");
  setWidget(node, "retry_seed", Number(payload.retry_seed ?? -1));
  setWidget(node, "retry_length", retryLength);
  setWidget(node, "resume_scene", Number(payload.resume_scene || 0));
  setWidget(node, "assemble_partial_on_stop", Boolean(payload.assemble_partial_on_stop));
  setWidget(node, "auto_continue_timeout_minutes", Number(payload.auto_continue_timeout_minutes || 0));
  setWidget(node, "unload_models_while_waiting", Boolean(payload.unload_models_while_waiting));

  if (token && payload.run_name) {
    const controller = new AbortController();
    node._eagleH3SubmittingToken = token;
    node._eagleH3ReviewAbortController = controller;
    try {
      const response = await api.fetchApi(
        `/eagle_h3_pipeline/review?run=${encodeURIComponent(payload.run_name)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            decision,
            retry_prompt: payload.retry_prompt || "",
            retry_seed: Number(payload.retry_seed ?? -1),
            retry_length: retryLength,
            resume_scene: Number(payload.resume_scene || 0),
            assemble_partial_on_stop: Boolean(payload.assemble_partial_on_stop),
          }),
          signal: controller.signal,
        },
      );
      let body;
      try {
        body = await response.json();
      } catch (_) {
        throw new Error(`审片接口返回了无效 JSON（HTTP ${response.status}）`);
      }
      if (!response.ok) {
        throw new Error(String(body?.error || body?.message || `HTTP ${response.status}`));
      }
      assertResolvedDecision(body);
      node._eagleH3ResolvedToken = token;
      return { ...body, lockedToken: token };
    } finally {
      if (node._eagleH3ReviewAbortController === controller) {
        node._eagleH3ReviewAbortController = null;
      }
      if (node._eagleH3SubmittingToken === token) node._eagleH3SubmittingToken = "";
    }
  }

  setWidget(node, "review_decision", decision);
  await queuePrompt();
  return { queued: true };
}

/* ROUTING_CONTRACT_START */
export function terminalDisplayNodeId(uniqueId) {
  const rawId = String(uniqueId ?? "").trim();
  if (!rawId) return "";
  const segments = rawId.split(/[.:/]/).filter(Boolean);
  return segments.at(-1) || rawId;
}

export function payloadMatches(node, payload) {
  const rawId = String(payload?.node_id ?? "").trim();
  const displayId = String(node?.id ?? "").trim();
  return Boolean(rawId && displayId)
    && (rawId === displayId || terminalDisplayNodeId(rawId) === displayId);
}

export function reviewRecoveryUrl(runName, nodeId) {
  const params = new URLSearchParams({
    run: String(runName ?? "").trim(),
    node: String(nodeId ?? "").trim(),
  });
  return `/eagle_h3_pipeline/review/pending?${params}`;
}
/* ROUTING_CONTRACT_END */

function rememberReviewIdentity(node, payload) {
  const runName = String(payload?.run_name || "").trim();
  if (!runName) return;
  node.properties ||= {};
  if (node.properties.h3_review_run === runName) return;
  node.properties.h3_review_run = runName;
  node.graph?.change?.();
}

function applyReviewPayload(node, mounted, payload) {
  rememberReviewIdentity(node, payload);
  const incomingToken = String(payload?.token || "");
  const lockedToken = String(node._eagleH3ResolvedToken || "");
  if (lockedToken && (payload?.awaiting_review === false || (incomingToken && incomingToken !== lockedToken))) {
    node._eagleH3ResolvedToken = "";
  }
  mounted.setLockedToken(node._eagleH3ResolvedToken || "");
  mounted.setReview(payload);
}

async function recoverPendingReview(node, mounted) {
  const runName = String(node.properties?.h3_review_run || "").trim();
  const displayNodeId = String(node.id ?? "").trim();
  if (!runName || !displayNodeId) return false;

  node._eagleH3RecoveryAbortController?.abort?.();
  const controller = new AbortController();
  node._eagleH3RecoveryAbortController = controller;
  try {
    const response = await api.fetchApi(reviewRecoveryUrl(runName, displayNodeId), {
      method: "GET",
      signal: controller.signal,
    });
    let body;
    try {
      body = await response.json();
    } catch (_) {
      throw new Error(`待审恢复接口返回了无效 JSON（HTTP ${response.status}）`);
    }
    if (response.status === 404) return false;
    if (!response.ok) {
      throw new Error(String(body?.error || body?.message || `HTTP ${response.status}`));
    }

    const payload = body?.review;
    if (String(payload?.run_name || "").trim() !== runName || !payloadMatches(node, payload)) {
      throw new Error("服务器返回的待审任务与当前运行或节点不匹配");
    }
    if (controller.signal.aborted || String(node.properties?.h3_review_run || "").trim() !== runName) {
      return false;
    }
    node._eagleH3ReviewPayload = payload;
    applyReviewPayload(node, mounted, payload);
    return true;
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn("[Eagle H3 Review] 恢复待审状态失败:", error);
    }
    return false;
  } finally {
    if (node._eagleH3RecoveryAbortController === controller) {
      node._eagleH3RecoveryAbortController = null;
    }
  }
}

app.registerExtension({
  name: "EagleSuite.H3ReviewWorkspace.Svelte",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_TYPE) return;

    const inputDefs = nodeData?.input || nodeData?.inputs;
    for (const groupName of ["required", "optional"]) {
      const group = inputDefs?.[groupName];
      for (const name of HIDDEN_WIDGETS) {
        const definition = group?.[name];
        if (!Array.isArray(definition)) continue;
        definition[1] = { ...(definition[1] || {}), hidden: true, vueNode: "never", hideInPanel: true };
      }
    }

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = originalCreated?.apply(this, arguments);
      const node = this;
      ensureStylesheet();
      hideControlWidgets(node);

      const target = document.createElement("div");
      target.className = "eagle-h3-review-workspace-svelte-host";
      target.style.width = "100%";
      target.style.height = "650px";
      const workspaceWidget = getWidget(node, "workspace_state");
      const workspace = normalizeWorkspace(workspaceWidget?.value || "");
      let mounted;
      try {
        mounted = mountH3ReviewWorkspace(target, {
          workspace,
          review: node._eagleH3ReviewPayload || {},
          resolveVideoUrl: viewUrl,
          onWorkspaceChange(value) {
            setWidget(node, "workspace_state", value, true);
          },
          onDecision(decision, payload) {
            return submitDecision(node, decision, payload);
          },
        });
      } catch (error) {
        console.error("[Eagle H3 Review] Svelte mount failed", error);
        target.style.cssText += ";padding:14px;color:#ff9292;background:#231219;white-space:pre-wrap;";
        target.textContent = `Svelte 审片面板加载失败：${error?.message || error}`;
        mounted = {
          setReview() {}, setWorkspace() {}, setLockedToken() {},
          disposeMedia() {}, destroy() {},
        };
      }

      let currentViewportHeight = 650;
      const MAX_VIEWPORT_HEIGHT = 4096;
      const widget = node.addDOMWidget("h3_review_workspace_svelte", "div", target, {
        serialize: false,
        hideInPanel: true,
        hideOnZoom: false,
        getMinHeight: () => 650,
        getMaxHeight: () => MAX_VIEWPORT_HEIGHT,
        getHeight: () => currentViewportHeight,
      });
      widget._eagleViewportHeight = 650;
      // Keep DOMWidgetImpl.computeLayoutSize available.  A custom computeSize
      // makes the review surface a fixed-height widget in Classic and clips
      // everything below that slot when the node is stretched.
      node._eagleH3ReviewSvelte = mounted;
      const existingSize = node.size || [];
      if ((Number(existingSize[0]) || 0) < 520 || (Number(existingSize[1]) || 0) < 700) {
        node.setSize?.([960, 720]);
      }
      const applySize = (size) => {
        currentViewportHeight = Math.min(MAX_VIEWPORT_HEIGHT, Math.max(650, (Number(size?.[1]) || 720) - 50));
        widget._eagleViewportHeight = currentViewportHeight;
        target.style.height = currentViewportHeight + "px";
      };
      const originalResize = node.onResize;
      node.onResize = function (size) {
        originalResize?.apply(this, arguments);
        applySize(size);
      };
      applySize(node.size);

      const reviewListener = (event) => {
        const payload = event?.detail || {};
        if (!payloadMatches(node, payload)) return;
        node._eagleH3RecoveryAbortController?.abort?.();
        node._eagleH3ReviewPayload = payload;
        applyReviewPayload(node, mounted, payload);
      };
      api.addEventListener("eagle_h3_review_pending", reviewListener);

      const originalExecuted = node.onExecuted;
      node.onExecuted = function (message) {
        originalExecuted?.apply(this, arguments);
        const payload = message?.h3_review;
        if (!payload) return;
        const value = Array.isArray(payload) ? payload[0] : payload;
        node._eagleH3ReviewPayload = value;
        applyReviewPayload(node, mounted, value);
      };

      queueMicrotask(() => { void recoverPendingReview(node, mounted); });

      const originalConfigure = node.onConfigure;
      node.onConfigure = function () {
        const configured = originalConfigure?.apply(this, arguments);
        queueMicrotask(() => {
          hideControlWidgets(node);
          applySize(node.size);
          mounted.setWorkspace(getWidget(node, "workspace_state")?.value || "");
          void recoverPendingReview(node, mounted);
        });
        return configured;
      };

      const originalRemoved = node.onRemoved;
      node.onRemoved = function () {
        api.removeEventListener?.("eagle_h3_review_pending", reviewListener);
        node._eagleH3ReviewAbortController?.abort?.();
        node._eagleH3RecoveryAbortController?.abort?.();
        mounted.disposeMedia?.();
        for (const media of target.querySelectorAll("video,audio")) {
          try { media.pause(); } catch (_) {}
          media.removeAttribute("src");
          try { media.load(); } catch (_) {}
        }
        mounted.destroy();
        node._eagleH3ReviewSvelte = null;
        node._eagleH3ReviewAbortController = null;
        node._eagleH3RecoveryAbortController = null;
        return originalRemoved?.apply(this, arguments);
      };
      return result;
    };
  },
});
