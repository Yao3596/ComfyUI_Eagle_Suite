/** A review action must leave ComfyUI in manual mode after its queue empties. */
export function pauseReviewAutoQueue(app, documentRef = globalThis.document) {
  const settings = app?.extensionManager?.queueSettings;
  if (settings && "mode" in settings) settings.mode = "disabled";
  if (app?.ui) {
    app.ui.autoQueueEnabled = false;
    app.ui.graphHasChanged = false;
  }
  const checkbox = documentRef?.getElementById?.("autoQueueCheckbox");
  if (checkbox) checkbox.checked = false;
  // Do not restore auto-run after submitting: queuePrompt resolves before the
  // backend saves, so restoration would queue another run when saving ends.
}

/** Return only output nodes downstream of this gate for a partial ComfyUI run. */
export function downstreamOutputIds(gate) {
  const graph = gate && gate.graph;
  if (!graph) return [];
  const visited = new Set([String(gate.id)]);
  const queue = [gate];
  const outputs = [];
  while (queue.length) {
    const current = queue.shift();
    for (const port of current.outputs || []) {
      for (const linkId of port.links || []) {
        const link = graph.links && (graph.links[linkId] || graph.links.get?.(linkId));
        const targetId = Array.isArray(link) ? link[3] : link && link.target_id;
        if (targetId == null || visited.has(String(targetId))) continue;
        visited.add(String(targetId));
        const target = graph.getNodeById?.(targetId) || graph._nodes_by_id?.[targetId];
        if (!target) continue;
        if (target.constructor?.nodeData?.output_node || target.constructor?.nodeData?.outputNode) {
          outputs.push(String(target.id));
        }
        queue.push(target);
      }
    }
  }
  return outputs;
}

/** Run one explicit Eagle tool action without starting unrelated branches. */
export async function queueNodeTask(app, node, options = {}) {
  if (node?.id == null) throw new Error("找不到待执行节点");
  if (app.processingQueue) throw new Error("正在提交其他任务，请稍后再试");
  pauseReviewAutoQueue(app);
  const downstream = options.downstream ? downstreamOutputIds(node) : [];
  const targets = downstream.length ? downstream : [String(node.id)];
  const accepted = await app.queuePrompt(0, 1, targets);
  if (!accepted) throw new Error("ComfyUI 未接受本次提交");
  return true;
}

/** Repeat only after this gate's own approved downstream execution succeeds. */
export function createReviewLoopController(options) {
  const jobs = new Map();
  function forgetNode(node) {
    for (const [id, waiting] of jobs) if (waiting === node) jobs.delete(id);
  }
  return {
    forgetNode,
    onExecuted(detail) {
      const state = detail.output?.eagle_review?.[0]?.state;
      if (!state) return;
      const node = options.findNode(detail);
      if (!node) return;
      if (["pending", "expired", "empty"].includes(state)) forgetNode(node);
      if (["approved", "bypass"].includes(state) && detail.prompt_id && !jobs.has(detail.prompt_id)) {
        jobs.set(detail.prompt_id, node);
      }
    },
    async onSuccess(detail) {
      const node = jobs.get(detail.prompt_id);
      jobs.delete(detail.prompt_id);
      if (!node) return;
      const repeating = !!options.isEnabled(node);
      options.onComplete?.(node, repeating);
      if (!repeating) return;
      try {
        await options.queueNext(node);
      } catch (error) {
        options.onError?.(node, error);
      }
    },
    onFailed(detail) {
      const node = jobs.get(detail.prompt_id);
      jobs.delete(detail.prompt_id);
      if (node) options.onError?.(node, new Error("本轮执行失败或已中断，已停止循环"));
    },
  };
}
