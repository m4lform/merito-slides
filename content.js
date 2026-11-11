(() => {
  if (globalThis.__meritoSlidesBridge) return;
  globalThis.__meritoSlidesBridge = true;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "merito-slides") return;
    const pending = chrome.runtime.sendMessage({
      type: data.type === "progress" ? "ms-progress" : "ms-result",
      ok: data.ok === true,
      error: data.error || "",
      detail: data.detail || "",
      href: location.href,
    });
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  });
})();
