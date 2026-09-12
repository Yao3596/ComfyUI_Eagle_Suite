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
  for (const widget of node.widgets || []) {
    if (!HIDDEN_WIDGETS.has(widget.name)) continue;
    widget.type = "hidden";
    widget.hidden = true;
    widget.computeSize = () => [0, -4];
    widget.draw = () => {};
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

function payloadMatches(node, payload) {
  const rawId = String(payload?.node_id || "");
  return Boolean(rawId) && (rawId === String(node.id) || rawId.endsWith(`.${node.id}`));
}

function applyReviewPayload(node, mounted, payload) {
  const incomingToken = String(payload?.token || "");
  const lockedToken = String(node._eagleH3ResolvedToken || "");
  if (lockedToken && (payload?.awaiting_review === false || (incomingToken && incomingToken !== lockedToken))) {
    node._eagleH3ResolvedToken = "";
  }
  mounted.setLockedToken(node._eagleH3ResolvedToken || "");
  mounted.setReview(payload);
}

app.registerExtension({
  name: "EagleSuite.H3ReviewWorkspace.Svelte",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_TYPE) return;

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = originalCreated?.apply(this, arguments);
      const node = this;
      ensureStylesheet();
      hideControlWidgets(node);

      const target = document.createElement("div");
      target.className = "eagle-h3-review-workspace-svelte-host";
      target.style.width = "100%";
      target.style.height = "100%";
      const workspaceWidget = getWidget(node, "workspace_state");
      const workspace = normalizeWorkspace(workspaceWidget?.value || "");
      const mounted = mountH3ReviewWorkspace(target, {
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

      const widget = node.addDOMWidget("h3_review_workspace_svelte", "div", target, {
        serialize: false,
        canvasOnly: true,
        hideOnZoom: false,
      });
      widget.computeSize = (width) => [Math.max(480, width || 520), 650];
      node._eagleH3ReviewSvelte = mounted;
      node.setSize?.([Math.max(520, node.size?.[0] || 0), Math.max(760, node.size?.[1] || 0)]);

      const reviewListener = (event) => {
        const payload = event?.detail || {};
        if (!payloadMatches(node, payload)) return;
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

      const originalConfigure = node.onConfigure;
      node.onConfigure = function () {
        const configured = originalConfigure?.apply(this, arguments);
        queueMicrotask(() => {
          hideControlWidgets(node);
          mounted.setWorkspace(getWidget(node, "workspace_state")?.value || "");
        });
        return configured;
      };

      const originalRemoved = node.onRemoved;
      node.onRemoved = function () {
        api.removeEventListener?.("eagle_h3_review_pending", reviewListener);
        node._eagleH3ReviewAbortController?.abort?.();
        mounted.disposeMedia?.();
        for (const media of target.querySelectorAll("video,audio")) {
          try { media.pause(); } catch (_) {}
          media.removeAttribute("src");
          try { media.load(); } catch (_) {}
        }
        mounted.destroy();
        node._eagleH3ReviewSvelte = null;
        node._eagleH3ReviewAbortController = null;
        return originalRemoved?.apply(this, arguments);
      };
      return result;
    };
  },
});
