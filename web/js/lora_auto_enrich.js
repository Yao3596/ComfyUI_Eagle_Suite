/** One low-priority catalog queue shared by every LoRA Gallery in the tab. */
export function createLoraAutoEnrichScheduler(options) {
  const readCatalog = options.readCatalog;
  const completeItem = options.completeItem;
  const documentRef = options.documentRef || (() => document);
  const now = options.now || (() => Date.now());
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const idleMs = options.idleMs ?? 3000;
  const gapMs = options.gapMs ?? 1800;
  const subscribers = new Set();
  let enabled = true;
  let queue = [];
  let total = 0;
  let done = 0;
  let started = false;
  let loading = false;
  let running = false;
  let timer = null;
  let generation = 0;
  let lastActivity = now();

  function progress() {
    for (const subscriber of subscribers) subscriber.onProgress?.({ done, total, running });
  }

  function activity() { lastActivity = now(); }
  function pointerActivity(event) { if (event.buttons) activity(); }

  function installActivityListeners() {
    const doc = documentRef();
    doc.addEventListener("pointerdown", activity, { passive: true });
    doc.addEventListener("pointermove", pointerActivity, { passive: true });
    doc.addEventListener("wheel", activity, { passive: true });
    doc.addEventListener("keydown", activity);
  }

  function removeActivityListeners() {
    const doc = documentRef();
    doc.removeEventListener("pointerdown", activity);
    doc.removeEventListener("pointermove", pointerActivity);
    doc.removeEventListener("wheel", activity);
    doc.removeEventListener("keydown", activity);
  }

  function cancelTimer() {
    if (timer != null) clearTimer(timer);
    timer = null;
  }

  function schedule(delay = gapMs) {
    cancelTimer();
    if (!enabled || !subscribers.size || !queue.length || running) return;
    timer = setTimer(runNext, delay);
  }

  async function loadCatalog() {
    if (loading || started || !enabled || !subscribers.size) return;
    loading = true;
    const currentGeneration = ++generation;
    try {
      const response = await readCatalog();
      if (currentGeneration !== generation) return;
      if (!response?.success || !Array.isArray(response.items)) throw new Error(response?.error || "catalog unavailable");
      queue = response.items.filter((item) => item && (!item.hasPreview || !item.hasModelInfo)).map((item) => item.id);
      total = queue.length;
      done = 0;
      started = true;
      progress();
      schedule(idleMs);
    } catch (error) {
      // A later mount or explicit refresh can retry; do not spin on errors.
      console.warn("[LoraGallery] auto enrichment catalog unavailable", error);
    } finally {
      if (currentGeneration === generation) loading = false;
    }
  }

  async function runNext() {
    timer = null;
    if (!enabled || !subscribers.size || running || !queue.length) return;
    const doc = documentRef();
    const wait = idleMs - (now() - lastActivity);
    if (doc.hidden || wait > 0) {
      schedule(doc.hidden ? 1000 : Math.max(250, wait));
      return;
    }
    const id = queue.shift();
    const provider = [...subscribers].find((entry) => entry.getApiKey?.());
    const key = provider ? provider.getApiKey() : "";
    running = true;
    progress();
    let result;
    try {
      result = await completeItem(id, key);
    } catch (error) {
      result = { success: false, error: error?.message || String(error) };
    } finally {
      running = false;
      done += 1;
      for (const subscriber of subscribers) subscriber.onResult?.(id, result);
      progress();
      schedule();
    }
  }

  return {
    register(subscriber) {
      if (!subscribers.size) installActivityListeners();
      subscribers.add(subscriber);
      subscriber.onProgress?.({ done, total, running });
      if (!started) void loadCatalog();
      else schedule(idleMs);
      return () => {
        subscribers.delete(subscriber);
        if (!subscribers.size) {
          cancelTimer();
          removeActivityListeners();
        }
      };
    },
    setEnabled(value) {
      enabled = !!value;
      if (!enabled) cancelTimer();
      else if (!started) void loadCatalog();
      else schedule(idleMs);
    },
    refresh() {
      generation += 1;
      loading = false;
      started = false;
      queue = [];
      done = total = 0;
      cancelTimer();
      if (enabled) void loadCatalog();
    },
  };
}
