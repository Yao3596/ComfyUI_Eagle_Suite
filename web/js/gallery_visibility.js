/** Load gallery data when its DOM widget first approaches the viewport. */
export function loadGalleryWhenVisible(element, load) {
  if (!element || typeof IntersectionObserver !== "function") {
    load();
    return function () {};
  }

  var started = false;
  var stopped = false;
  var observer = new IntersectionObserver(function (entries) {
    if (started || stopped || !entries.some(function (entry) { return entry.isIntersecting; })) return;
    started = true;
    observer.disconnect();
    load();
  }, { rootMargin: "320px" });
  observer.observe(element);
  return function () { stopped = true; observer.disconnect(); };
}

// Coalesce identical in-flight reads from multiple nodes. Each caller parses
// its own JSON object so Vue state in one node cannot mutate another's data.
const pendingGalleryReads = new Map();
export function fetchGalleryReadJson(url, options) {
  const key = url + "|" + (options?.method || "GET") + "|" + (options?.body || "");
  let request = pendingGalleryReads.get(key);
  if (!request) {
    request = fetch(url, options).then((response) => response.text());
    pendingGalleryReads.set(key, request);
    const clear = () => {
      if (pendingGalleryReads.get(key) === request) pendingGalleryReads.delete(key);
    };
    request.then(clear, clear);
  }
  return request.then((body) => JSON.parse(body));
}
