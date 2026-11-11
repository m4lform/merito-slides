chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "ms-focus") return;
  const reply = (payload) => {
    try {
      sendResponse(payload);
    } catch {
    }
  };
  const focus = async () => {
    if (message.windowId) await chrome.windows.update(message.windowId, { focused: true });
    if (message.tabId) await chrome.tabs.update(message.tabId, { active: true });
  };
  focus()
    .then(() => reply({ ok: true }))
    .catch((error) => {
      reply({ ok: false, error: error && error.message ? error.message : String(error) });
    });
  return true;
});
