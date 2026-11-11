const NOTE_ID = "merito-slides";

function showStatus(message, stick) {
  const options = {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Merito Slides",
    message: message || "Merito Slides",
    requireInteraction: Boolean(stick),
  };
  chrome.notifications.update(NOTE_ID, {
    message: options.message,
    requireInteraction: options.requireInteraction,
  }, (exists) => {
    if (chrome.runtime.lastError || !exists) {
      chrome.notifications.create(NOTE_ID, options, () => {
        chrome.runtime.lastError;
      });
    }
  });
}

function showBadge(text, color) {
  chrome.action.setBadgeText({ text: text || "" });
  chrome.action.setBadgeBackgroundColor({ color });
}

function fileCount(text) {
  const match = String(text || "").match(/(\d+)/);
  return match ? match[1].slice(0, 4) : "";
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "ms-progress") {
    if (!message.detail) return;
    showStatus(message.detail, false);
    showBadge(fileCount(message.detail) || "...", "#2a64d6");
    return;
  }

  if (message.type === "ms-result") {
    const text = message.ok
      ? (message.detail || "Done")
      : (message.error || "Couldn't download the presentation");
    showStatus(text, true);
    showBadge(message.ok ? (fileCount(text) || "OK") : "!", message.ok ? "#2a64d6" : "#9d2c3a");
    return;
  }

  if (message.type !== "ms-focus") return;
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
