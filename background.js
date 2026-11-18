const NOTE_ID = "merito-slides";

const clearTimers = new Map();
const activeDownloads = new Map();

function cancelClearTimer(tabId) {
  if (clearTimers.has(tabId)) {
    clearTimeout(clearTimers.get(tabId));
    clearTimers.delete(tabId);
  }
}

function scheduleClearBadge(tabId, delayMs = 3500) {
  cancelClearTimer(tabId);
  const timer = setTimeout(() => {
    clearTimers.delete(tabId);
    clearBadge(tabId);
  }, delayMs);
  clearTimers.set(tabId, timer);
}

function showStatus(message, stick) {
  const options = {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Merito Slides",
    message: message || "Merito Slides",
    requireInteraction: Boolean(stick),
  };
  chrome.notifications.update(
    NOTE_ID,
    {
      message: options.message,
      requireInteraction: options.requireInteraction,
    },
    (exists) => {
      if (chrome.runtime.lastError || !exists) {
        chrome.notifications.create(NOTE_ID, options, () => {
          chrome.runtime.lastError;
        });
      }
    }
  );
}

function showBadge(text, color, tabId) {
  if (!tabId) return;
  cancelClearTimer(tabId);
  try {
    const p1 = chrome.action.setBadgeText({ text: text || "", tabId });
    if (p1 && typeof p1.catch === "function") p1.catch(() => {});

    if (color) {
      const p2 = chrome.action.setBadgeBackgroundColor({ color, tabId });
      if (p2 && typeof p2.catch === "function") p2.catch(() => {});
    }

    if (chrome.action.setBadgeTextColor) {
      const p3 = chrome.action.setBadgeTextColor({ color: "#ffffff", tabId });
      if (p3 && typeof p3.catch === "function") p3.catch(() => {});
    }
  } catch {
  }
}

function clearBadge(tabId) {
  cancelClearTimer(tabId);
  try {
    const details = { text: "" };
    if (tabId) details.tabId = tabId;
    const p = chrome.action.setBadgeText(details);
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {
  }
}

function fileCount(text) {
  const match = String(text || "").match(/(\d+)/);
  return match ? match[1].slice(0, 4) : "";
}

// Reset any leftover global badge from previous versions or sessions
clearBadge(0);

chrome.runtime.onInstalled.addListener(() => {
  clearBadge(0);
});

chrome.runtime.onStartup.addListener(() => {
  clearBadge(0);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" || changeInfo.url) {
    clearBadge(tabId);
    activeDownloads.delete(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  cancelClearTimer(tabId);
  activeDownloads.delete(tabId);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  clearBadge(0);
  for (const [tabId] of clearTimers.entries()) {
    if (tabId !== activeInfo.tabId) {
      clearBadge(tabId);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  const tabId = (sender && sender.tab && sender.tab.id) || message.tabId || 0;

  if (message.type === "ms-get-state") {
    const queryTabId = message.tabId || tabId;
    const state = activeDownloads.get(queryTabId) || { busy: false };
    clearBadge(0);
    if (queryTabId && !state.busy && !clearTimers.has(queryTabId)) {
      clearBadge(queryTabId);
    }
    sendResponse(state);
    return true;
  }

  if (message.type === "ms-clear") {
    if (tabId) {
      clearBadge(tabId);
      activeDownloads.delete(tabId);
    }
    return;
  }

  if (message.type === "ms-progress") {
    if (!message.detail) return;
    if (tabId) {
      activeDownloads.set(tabId, { busy: true, detail: message.detail });
    }
    showStatus(message.detail, false);
    const count = fileCount(message.detail);
    showBadge(count || "...", "#2a64d6", tabId);
    return;
  }

  if (message.type === "ms-result") {
    if (tabId) {
      activeDownloads.delete(tabId);
    }
    const text = message.ok
      ? (message.detail || "Done")
      : (message.error || "Couldn't download the presentation");
    showStatus(text, true);
    if (message.ok) {
      showBadge("OK", "#1e7e34", tabId);
      scheduleClearBadge(tabId, 3500);
    } else {
      showBadge("!", "#9d2c3a", tabId);
      scheduleClearBadge(tabId, 5000);
    }
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
