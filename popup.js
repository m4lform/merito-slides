const GITHUB_ACCOUNT_ID = 114883316;
const MOODLE_HOST = "moodle2.e-wsb.pl";

const ACTION_LABEL = "Download presentation";
const MIN_FRAME_SCORE = 20;
const ENTRY_FILES = new Set([
  "index.html",
  "index.htm",
  "story.html",
  "story_html5.html",
  "index_lms.html",
  "index_lms_html5.html",
  "indexapi.html",
  "presentation.html",
  "launch.html",
]);

const download = document.getElementById("download");
const status = document.getElementById("status");
const github = document.getElementById("github");
const githubLabel = github.querySelector("span");

let currentTabId = 0;
let currentTitle = "";
let busy = false;

function applyGithubProfile(profile) {
  if (!profile || profile.id !== GITHUB_ACCOUNT_ID || !profile.login || !profile.html_url) return;
  github.href = profile.html_url;
  githubLabel.textContent = profile.login;
}

github.addEventListener("click", (event) => {
  if (github.getAttribute("href") === "#") event.preventDefault();
});

function setStatus(text, isError) {
  status.textContent = text;
  status.classList.toggle("error", Boolean(isError));
  status.title = text;
}

function isMoodle(url) {
  try {
    return new URL(url).hostname === MOODLE_HOST;
  } catch {
    return false;
  }
}

function scoreTab(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return -1000;
  }
  if (parsed.hostname !== MOODLE_HOST) return -1000;
  const path = parsed.pathname.toLowerCase();
  const file = path.split("/").filter(Boolean).pop() || "";
  let score = 0;
  if (path.includes("/mod/scorm/player.php") || path.includes("/mod/scorm/loadsco.php")) score += 100;
  if (path.includes("pluginfile.php") || path.includes("/mod_scorm/")) score += 40;
  if (ENTRY_FILES.has(file)) score += 40;
  if (path.includes("/course/view.php") || path.includes("/mod/scorm/view.php")) score -= 50;
  return score;
}

function scoreFrame(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { score: -1000, depth: 0 };
  }
  if (parsed.hostname !== MOODLE_HOST) return { score: -1000, depth: 0 };
  const path = parsed.pathname.toLowerCase();
  const parts = path.split("/").filter(Boolean);
  let score = 0;
  if (
    path.includes("/mod/scorm/player.php") ||
    path.includes("/mod/scorm/view.php") ||
    path.includes("/course/view.php")
  ) {
    score -= 80;
  }
  if (path.includes("pluginfile.php") || path.includes("/mod_scorm/")) score += 40;
  if (ENTRY_FILES.has(parts[parts.length - 1] || "")) score += 50;
  if (path.includes("/html5/") || path.includes("/story_content/") || path.includes("/lms/")) score -= 20;
  return { score, depth: parts.length };
}

function byPresentationRank(activeId) {
  return (a, b) => {
    const diff = scoreTab(b.url || "") - scoreTab(a.url || "");
    if (diff) return diff;
    if (a.id === activeId) return -1;
    if (b.id === activeId) return 1;
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  };
}

async function moodleTabs() {
  const tabs = await chrome.tabs.query({ url: "https://" + MOODLE_HOST + "/*" });
  return tabs || [];
}

async function findPresentationTab(active) {
  const activeId = active && active.id;
  const ranked = (await moodleTabs())
    .filter((tab) => scoreTab(tab.url || "") >= MIN_FRAME_SCORE)
    .sort(byPresentationRank(activeId));
  return ranked[0] || null;
}

function chooseFrame(frames) {
  let best = null;
  let topUrl = "";
  const consider = (frame, minimum) => {
    if (!frame || typeof frame.result !== "string") return;
    if (frame.frameId === 0) topUrl = frame.result;
    const ranked = scoreFrame(frame.result);
    if (ranked.score < minimum) return;
    if (!best || ranked.score > best.score || (ranked.score === best.score && ranked.depth < best.depth)) {
      best = { frameId: frame.frameId, score: ranked.score, depth: ranked.depth };
    }
  };
  for (const frame of frames) consider(frame, MIN_FRAME_SCORE);
  if (best || scoreTab(topUrl) < 50) return best;
  best = null;
  for (const frame of frames) {
    if (!frame || frame.frameId === 0) continue;
    consider(frame, 0);
  }
  return best;
}

async function locatePresentation(active) {
  const activeId = active && active.id;
  const tabs = (await moodleTabs()).sort(byPresentationRank(activeId));
  for (const tab of tabs) {
    if (scoreTab(tab.url || "") < MIN_FRAME_SCORE && tab.id !== activeId) continue;
    let frames = [];
    try {
      frames = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => location.href,
      });
    } catch {
      frames = [];
    }
    const chosen = chooseFrame(frames || []);
    if (chosen) return { tab, frameId: chosen.frameId };
  }
  throw new Error("No open presentation found. Leave the slide window open.");
}

function render(active, presentation) {
  const moodleHere = Boolean(active && isMoodle(active.url));
  const target = presentation || active;
  currentTabId = target && target.id ? target.id : 0;
  const rawTitle = presentation && presentation.title
    ? presentation.title
    : (moodleHere && active && active.title) || "";
  currentTitle = rawTitle.replace(/\s+\|\s+.*$/, "").trim();
  const canDownload = Boolean(presentation) || moodleHere;
  download.disabled = busy || !canDownload;
  if (busy) return;
  if (!canDownload) {
    setStatus("Open a presentation in Moodle");
    return;
  }
  if (presentation && (!active || presentation.id !== active.id)) {
    setStatus(currentTitle ? "Other window: " + currentTitle : "Presentation is in another window");
    return;
  }
  setStatus(currentTitle || "Presentation is open");
}

if (typeof chrome !== "undefined" && chrome.storage && chrome.tabs && chrome.runtime) {
  chrome.storage.local.get("githubProfile", ({ githubProfile }) => {
    applyGithubProfile(githubProfile);
  });

  fetch(`https://api.github.com/user/${GITHUB_ACCOUNT_ID}`, {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((user) => {
      if (!user || user.id !== GITHUB_ACCOUNT_ID || !user.login || !user.html_url) return;
      const profile = { id: user.id, login: user.login, html_url: user.html_url };
      applyGithubProfile(profile);
      chrome.storage.local.set({ githubProfile: profile });
    })
    .catch(() => {});

  function checkActiveDownload() {
    if (!currentTabId) return;
    chrome.runtime.sendMessage({ type: "ms-get-state", tabId: currentTabId }, (response) => {
      if (chrome.runtime.lastError || !response || !response.busy) return;
      busy = true;
      download.disabled = true;
      download.textContent = "Downloading...";
      if (response.detail) setStatus(response.detail);
    });
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const active = tabs && tabs[0];
    findPresentationTab(active)
      .then((presentation) => {
        if (!busy) render(active, presentation);
        checkActiveDownload();
      })
      .catch(() => {
        if (!busy) render(active, null);
        checkActiveDownload();
      });
  });

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message) return;
    const tabId = (sender && sender.tab && sender.tab.id) || message.tabId;
    if (tabId && currentTabId && tabId !== currentTabId) return;
    if (!currentTabId && tabId) currentTabId = tabId;

    if (message.type === "ms-progress") {
      busy = true;
      download.disabled = true;
      download.textContent = "Downloading...";
      if (message.detail) setStatus(message.detail);
      return;
    }
    if (message.type !== "ms-result") return;
    busy = false;
    download.disabled = false;
    download.textContent = ACTION_LABEL;
    if (message.ok) setStatus(message.detail || "Done");
    else setStatus(message.error || "Couldn't download the presentation", true);
  });

  download.addEventListener("click", async () => {
    if (download.disabled || !currentTabId) return;
    busy = true;
    download.disabled = true;
    download.textContent = "Downloading...";
    setStatus("Looking for the presentation");
    chrome.runtime.sendMessage({
      type: "ms-progress",
      tabId: currentTabId,
      detail: "Looking for the presentation",
    });
    try {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      const prevTabId = currentTabId;
      const located = await locatePresentation(active);
      currentTabId = located.tab.id;
      if (prevTabId && prevTabId !== currentTabId) {
        chrome.runtime.sendMessage({ type: "ms-clear", tabId: prevTabId });
      }
      currentTitle = (located.tab.title || currentTitle).replace(/\s+\|\s+.*$/, "").trim();
      const target = { tabId: located.tab.id, frameIds: [located.frameId] };
      await chrome.scripting.executeScript({
        target,
        files: ["content.js"],
      });
      await chrome.scripting.executeScript({
        target,
        world: "MAIN",
        func: (title) => {
          window.__meritoSlidesTitle = title;
        },
        args: [currentTitle],
      });
      await chrome.scripting.executeScript({
        target,
        world: "MAIN",
        files: ["exporter.js"],
      });
      if (!active || located.tab.id !== active.id) {
        chrome.runtime.sendMessage({
          type: "ms-focus",
          windowId: active && located.tab.windowId === active.windowId ? 0 : located.tab.windowId,
          tabId: located.tab.id,
        });
      }
    } catch (error) {
      busy = false;
      download.disabled = false;
      download.textContent = ACTION_LABEL;
      const text = error && error.message ? error.message : "Couldn't start the script";
      setStatus(text, true);
      chrome.runtime.sendMessage({
        type: "ms-result",
        tabId: currentTabId,
        ok: false,
        error: text,
      });
    }
  });
}
