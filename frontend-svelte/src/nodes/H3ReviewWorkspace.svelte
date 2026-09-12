<script>
  import { onDestroy } from "svelte";
  import {
    normalizeReview,
    normalizeWorkspace,
    reviewPhase,
    serializeWorkspace,
    snapRetryLength,
    takeKey,
  } from "../lib/contracts.js";

  /** @type {Record<string, any>} */
  export let initialReview = {};
  /** @type {Record<string, any>} */
  export let initialWorkspace = {};
  /** @type {(path: string) => string} */
  export let resolveVideoUrl = (path) => String(path || "");
  /** @type {(state: string) => void} */
  export let onWorkspaceChange = () => {};
  /** @type {(decision: string, payload: Record<string, any>) => Promise<Record<string, any> | void>} */
  export let onDecision = async () => {};

  let review = normalizeReview(initialReview);
  let workspace = normalizeWorkspace(initialWorkspace);
  let busy = false;
  /** @type {HTMLVideoElement | undefined} */
  let player;
  let currentTime = 0;
  let duration = 0;
  let localStatus = "";
  let lockedToken = "";

  /** @param {Array<Record<string, any>>} items @param {string} key */
  function findTake(items, key) {
    return items.find((item) => takeKey(item) === key) || items.at(-1) || null;
  }

  $: history = /** @type {Array<Record<string, any>>} */ (review.history || []);
  $: selectedTake = findTake(history, workspace.selectedTakeKey);
  $: selectedKey = takeKey(selectedTake);
  $: selectedScene = selectedTake ? Number(selectedTake.index || 0) + 1 : Number(review.current_index || 0) + 1;
  $: selectedRevision = Number(selectedTake?.revision || 1);
  $: clipPath = selectedTake?.clip_path || review.preview_clip || review.clip_path || "";
  $: previewUrl = resolveVideoUrl(clipPath);
  $: phase = reviewPhase(review);
  $: decisionLocked = Boolean(lockedToken && lockedToken === String(review.token || ""));
  $: reviewFps = Math.max(1, Number(review.fps || review.output_fps || 24));
  $: retrySeconds = workspace.retryLength > 0 ? workspace.retryLength / reviewFps : 0;
  $: phaseLabel = ({
    waiting: "等待片段",
    ready: "片段已就绪",
    reviewing: "等待审片",
    approved: "已批准",
    retrying: "正在重试",
    stopped: "已停止",
    error: "发生错误",
  })[phase] || phase;

  /** @param {unknown} value */
  export function setReview(value) {
    const nextReview = normalizeReview(value);
    const incomingToken = String(nextReview.token || "");
    if (lockedToken && (nextReview.awaiting_review === false || (incomingToken && incomingToken !== lockedToken))) {
      lockedToken = "";
      localStatus = "";
    }
    review = nextReview;
    if (review.awaiting_review) {
      const latest = /** @type {Array<Record<string, any>>} */ (review.history || []).at(-1);
      workspace = {
        ...workspace,
        selectedTakeKey: takeKey(latest),
        retryPrompt: String(review.prompt ?? latest?.prompt ?? workspace.retryPrompt ?? ""),
        retrySeed: Number(review.seed ?? latest?.seed ?? workspace.retrySeed ?? -1),
        retryLength: Number(review.length ?? latest?.length ?? workspace.retryLength ?? 0),
      };
      persist();
    }
    busy = false;
  }

  /** @param {unknown} value */
  export function setWorkspace(value) {
    workspace = normalizeWorkspace(value);
  }

  /** @param {unknown} value */
  export function setBusy(value) {
    busy = Boolean(value);
  }

  /** @param {unknown} value */
  export function setLockedToken(value) {
    lockedToken = String(value || "");
  }

  export function disposeMedia() {
    const media = player;
    if (!media) return;
    try { media.pause(); } catch (_) {}
    media.removeAttribute("src");
    try { media.load(); } catch (_) {}
    player = undefined;
  }

  onDestroy(disposeMedia);

  function persist() {
    onWorkspaceChange?.(serializeWorkspace(workspace));
  }

  /** @param {Record<string, any>} take */
  function selectTake(take) {
    workspace = { ...workspace, selectedTakeKey: takeKey(take) };
    currentTime = 0;
    duration = 0;
    persist();
  }

  /** @param {Record<string, any>} patch */
  function patchWorkspace(patch) {
    workspace = normalizeWorkspace({ ...workspace, ...patch });
    persist();
  }

  function onLoadedMetadata() {
    const media = player;
    duration = media && Number.isFinite(media.duration) ? media.duration : 0;
    currentTime = media && Number.isFinite(media.currentTime) ? media.currentTime : 0;
    if (workspace.autoplay) media?.play?.().catch(() => {});
  }

  function onTimeUpdate() {
    const media = player;
    currentTime = media && Number.isFinite(media.currentTime) ? media.currentTime : 0;
  }

  /** @param {Event} event */
  function seek(event) {
    const input = /** @type {HTMLInputElement} */ (event.currentTarget);
    const value = Number(input.value || 0);
    if (player && Number.isFinite(value)) player.currentTime = value;
    currentTime = value;
  }

  /** @param {unknown} value */
  function formatTime(value) {
    const total = Math.max(0, Number(value) || 0);
    const minutes = Math.floor(total / 60);
    const seconds = (total - minutes * 60).toFixed(2).padStart(5, "0");
    return `${String(minutes).padStart(2, "0")}:${seconds}`;
  }

  /** @param {string} decision */
  async function decide(decision) {
    if (busy || decisionLocked) return;
    busy = true;
    localStatus = "正在提交决策…";
    try {
      const result = await onDecision?.(decision, {
        retry_prompt: workspace.retryPrompt,
        retry_seed: Number(workspace.retrySeed ?? -1),
        retry_length: Number(workspace.retryLength || 0),
        resume_scene: decision === "resume" ? selectedScene : 0,
        assemble_partial_on_stop: Boolean(workspace.assemblePartial),
        auto_continue_timeout_minutes: Number(workspace.timeoutMinutes || 0),
        unload_models_while_waiting: Boolean(workspace.unloadModels),
        token: String(review.token || ""),
        run_name: String(review.run_name || ""),
      });
      const resolvedToken = String(result?.lockedToken || review.token || "");
      if (resolvedToken) lockedToken = resolvedToken;
      localStatus = decision === "approve" ? "已批准，等待下一片段…"
        : decision === "approve_stop" ? "已批准并请求停止"
          : "已提交重试，等待新版本…";
    } catch (error) {
      localStatus = `提交失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy = false;
    }
  }
</script>

<main class="review-workspace" data-phase={phase}>
  <header>
    <div>
      <h3>🦅 H3 审片工作台</h3>
      <p>场景 {selectedScene} · r{String(selectedRevision).padStart(4, "0")}</p>
    </div>
    <span class="phase">{phaseLabel}</span>
  </header>

  {#if history.length > 0}
    <nav class="takes" aria-label="候选片段">
      {#each history as take (takeKey(take))}
        <button class:active={takeKey(take) === selectedKey} on:click={() => selectTake(take)}>
          <strong>S{Number(take.index || 0) + 1}</strong>
          <span>r{String(Number(take.revision || 1)).padStart(4, "0")}</span>
        </button>
      {/each}
    </nav>
  {/if}

  <section class="player-card">
    {#if previewUrl}
      {#key previewUrl}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={player} src={previewUrl} controls playsinline preload="metadata"
          on:loadedmetadata={onLoadedMetadata} on:timeupdate={onTimeUpdate}></video>
      {/key}
      <div class="scrubber">
        <time>{formatTime(currentTime)}</time>
        <input aria-label="视频播放进度" type="range" min="0" max={Math.max(0.01, duration)} step="0.01"
          value={currentTime} on:input={seek} />
        <time>{formatTime(duration)}</time>
      </div>
    {:else}
      <div class="empty">等待循环生成候选片段…</div>
    {/if}
  </section>

  {#if review.summary}
    <p class="summary">{review.summary}</p>
  {/if}

  <section class="form-card">
    <label class="prompt">
      <span>重试提示词</span>
      <textarea value={workspace.retryPrompt}
        on:input={(event) => patchWorkspace({ retryPrompt: event.currentTarget.value })}
        placeholder="只在重试时覆盖当前镜头提示词"></textarea>
    </label>
    <div class="grid">
      <label><span>种子</span><input type="number" value={workspace.retrySeed}
        on:change={(event) => patchWorkspace({ retrySeed: Number(event.currentTarget.value) })} /></label>
      <label><span>H3 length（0 或 17k+5）</span><input type="number" min="0" max="3592" step="1" value={workspace.retryLength}
        on:change={(event) => patchWorkspace({ retryLength: snapRetryLength(event.currentTarget.value) })} />
        <small>{workspace.retryLength ? `约 ${retrySeconds.toFixed(2)} 秒 @ ${reviewFps}fps` : "0 = 不覆盖模型帧长"}</small></label>
      <label><span>下次等待自动通过（分）</span><input type="number" min="0" max="1440" step="0.5" value={workspace.timeoutMinutes}
        on:change={(event) => patchWorkspace({ timeoutMinutes: Number(event.currentTarget.value) })} />
        <small>仅对下一次进入审片等待生效</small></label>
    </div>
    <div class="toggles">
      <label><input type="checkbox" checked={workspace.assemblePartial}
        on:change={(event) => patchWorkspace({ assemblePartial: event.currentTarget.checked })} /> 停止时合成已批准片段</label>
      <label><input type="checkbox" checked={workspace.unloadModels}
        on:change={(event) => patchWorkspace({ unloadModels: event.currentTarget.checked })} /> 等待时卸载模型</label>
      <label><input type="checkbox" checked={workspace.autoplay}
        on:change={(event) => patchWorkspace({ autoplay: event.currentTarget.checked })} /> 切换候选时自动播放</label>
    </div>
  </section>

  <footer>
    <button class="approve" disabled={busy || decisionLocked || !review.awaiting_review} on:click={() => decide("approve")}>批准并继续</button>
    <button disabled={busy || decisionLocked || !review.awaiting_review} on:click={() => decide("retry")}>按修改重试</button>
    <button disabled={busy || decisionLocked || !review.awaiting_review} on:click={() => decide("reroll")}>换种子</button>
    <button disabled={busy || decisionLocked || !review.awaiting_review || !selectedTake} on:click={() => decide("resume")}>从所选场景重做</button>
    <button class="stop" disabled={busy || decisionLocked || !review.awaiting_review} on:click={() => decide("approve_stop")}>批准并停止</button>
  </footer>

  <div class="status" aria-live="polite">{localStatus || (decisionLocked ? "该版本已提交，等待新 token 或审片状态更新" : review.awaiting_review ? "检查视频后选择下一步" : "等待运行状态更新")}</div>
</main>

<style>
  .review-workspace{--bg:var(--comfy-menu-bg,var(--bg-color,#0d1016));--panel:color-mix(in srgb,var(--bg) 91%,white 9%);--panel2:color-mix(in srgb,var(--bg) 84%,white 16%);--fg:var(--fg-color,#e8ebf2);--muted:var(--descrip-text,#95a0b3);--border:var(--border-color,#354055);--primary:var(--p-primary-color,#397fd1);box-sizing:border-box;width:100%;height:100%;min-height:570px;padding:10px;display:flex;flex-direction:column;gap:9px;background:var(--bg);color:var(--fg);font:12px/1.4 system-ui,"Segoe UI",sans-serif;overflow:hidden}.review-workspace :is(header,nav,section,footer,div,label,button,input,textarea,video,time,p,h3,span,strong,small){box-sizing:border-box}
  header{display:flex;align-items:center;justify-content:space-between;gap:10px}h3{margin:0;font-size:15px}header p{margin:2px 0 0;color:var(--muted);font-size:10px}.phase{padding:4px 9px;border:1px solid var(--border);border-radius:999px;background:var(--panel);font-weight:700}.review-workspace[data-phase="reviewing"] .phase{color:#ffd267;border-color:#856c2c}.review-workspace[data-phase="approved"] .phase{color:#79dda0;border-color:#377d50}.review-workspace[data-phase="error"] .phase,.review-workspace[data-phase="stopped"] .phase{color:#ff9797;border-color:#814040}
  .takes{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}.takes button{flex:0 0 auto;display:flex;gap:5px;align-items:center;padding:5px 9px;border:1px solid var(--border);border-radius:6px;background:var(--panel);color:var(--fg);cursor:pointer}.takes button.active{background:var(--primary);border-color:var(--primary);color:white}.takes span{font-size:10px;opacity:.8}
  .player-card{min-height:250px;display:flex;flex-direction:column;justify-content:center;border:1px solid var(--border);border-radius:8px;background:#05070b;overflow:hidden}.player-card video{display:block;width:100%;height:260px;object-fit:contain;background:#000}.empty{display:grid;place-items:center;min-height:250px;color:var(--muted)}.scrubber{display:grid;grid-template-columns:58px 1fr 58px;align-items:center;gap:7px;padding:7px 10px;background:#0c111a}.scrubber time{font:10px ui-monospace,monospace;color:#c4cede}.scrubber time:last-child{text-align:right}.scrubber input{width:100%;accent-color:var(--primary)}
  .summary{margin:0;padding:7px 9px;border-left:3px solid var(--primary);background:var(--panel);color:var(--muted);white-space:pre-wrap;max-height:62px;overflow:auto}.form-card{display:flex;flex-direction:column;gap:8px;padding:9px;border:1px solid var(--border);border-radius:8px;background:var(--panel)}label span{display:block;margin-bottom:3px;color:var(--muted);font-size:10px}.prompt textarea,input{width:100%;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--fg);font:inherit}.prompt textarea{height:62px;padding:7px;resize:vertical}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.grid input{height:29px;padding:4px 7px}.grid small{display:block;margin-top:3px;color:var(--muted);font-size:9px}.toggles{display:flex;gap:12px;flex-wrap:wrap;color:var(--muted)}.toggles label{display:flex;align-items:center;gap:5px}.toggles input{width:auto;accent-color:var(--primary)}
  footer{display:flex;flex-wrap:wrap;gap:7px}footer button{flex:1 1 110px;min-height:31px;padding:5px 9px;border:1px solid var(--border);border-radius:6px;background:var(--panel2);color:var(--fg);font:inherit;font-weight:650;cursor:pointer}footer button:hover:not(:disabled){border-color:var(--primary)}footer button:disabled{opacity:.42;cursor:not-allowed}footer .approve{background:#225d3b;border-color:#358158;color:#e9fff0}footer .stop{background:#5a2831;border-color:#8e4552;color:#ffecef}.status{min-height:18px;color:var(--muted);font-size:10px}
  @media(max-width:520px){.grid{grid-template-columns:1fr}.player-card video{height:210px}.toggles{flex-direction:column;gap:5px}}
</style>
