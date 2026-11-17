(() => {
  function notify(payload) {
    window.postMessage(Object.assign({ source: "merito-slides" }, payload), "*");
  }

  if (window.__meritoSlidesRunning) {
    notify({ ok: false, error: "Download already in progress" });
    return;
  }
  window.__meritoSlidesRunning = true;

  function reportProgress(detail) {
    notify({ type: "progress", detail });
  }

  function localPath(cleanUrl, baseUrl, currentUrl) {
    if (cleanUrl === currentUrl) {
      const tail = cleanUrl.substring(cleanUrl.lastIndexOf("/") + 1);
      if (tail && tail.includes(".")) return tail;
      return "index.html";
    }
    if (!cleanUrl.startsWith(baseUrl)) return "";
    const parts = [];
    for (const part of cleanUrl.slice(baseUrl.length).split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") return "";
      parts.push(part);
    }
    return parts.join("/");
  }

  function downloadName(title) {
    const cleaned = String(title || "presentation")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    return (cleaned || "presentation") + ".zip";
  }

  function launcherBat(entryName) {
    const target = entryName.split("/").map((part) => encodeURIComponent(part)).join("/");
    return [
      "@echo off",
      "title Offline presentation",
      "cd /d \"%~dp0\"",
      "echo Starting the local player...",
      "start \"\" \"http://localhost:8765/" + target + "\"",
      "python -m http.server 8765",
      "pause",
      "",
    ].join("\r\n");
  }

  function maybePatch(path, bytes) {
    if (path !== "lms/Configuration.js") return bytes;
    const text = new TextDecoder().decode(bytes);
    const patched = text
      .replace('var strLMSStandard = "SCORM";', 'var strLMSStandard = "NONE";')
      .replace("var blnDebug = true;", "var blnDebug = false;");
    if (patched === text) return bytes;
    return new TextEncoder().encode(patched);
  }

  function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
    return table;
  }

  const crcTable = makeCrcTable();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
    return (crc ^ 0xffffffff) >>> 0;
  }

  function buildZip(files) {
    const encoder = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const data = file.data;
      const checksum = crc32(data);
      const local = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(local.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x0800, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, dosTime, true);
      view.setUint16(12, dosDate, true);
      view.setUint32(14, checksum, true);
      view.setUint32(18, data.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, nameBytes.length, true);
      view.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      const central = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, dosTime, true);
      centralView.setUint16(14, dosDate, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, offset, true);
      central.set(nameBytes, 46);

      locals.push(local);
      centrals.push(central);
      offset += local.length + data.length;
    }

    let centralSize = 0;
    for (const central of centrals) centralSize += central.length;
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    endView.setUint16(20, 0, true);

    const zip = new Uint8Array(offset + centralSize + end.length);
    let pos = 0;
    for (let i = 0; i < files.length; i += 1) {
      zip.set(locals[i], pos);
      pos += locals[i].length;
      zip.set(files[i].data, pos);
      pos += files[i].data.length;
    }
    for (const central of centrals) {
      zip.set(central, pos);
      pos += central.length;
    }
    zip.set(end, pos);
    return zip;
  }

  function collectPageUrls(urls, baseUrl) {
    if (performance.getEntriesByType) {
      for (const entry of performance.getEntriesByType("resource")) {
        const name = entry && entry.name ? entry.name.split("#")[0].split("?")[0] : "";
        if (name.startsWith(baseUrl)) urls.add(name);
      }
    }
    document.querySelectorAll("script[src], link[href], img[src], audio[src], source[src]").forEach((el) => {
      const src = el.src || el.href;
      if (src && src.startsWith(baseUrl)) urls.add(src.split("#")[0].split("?")[0]);
    });
  }

  async function addStorylineList(urls, seeded, baseUrl) {
    const dataUrl = new URL("html5/data/js/data.js", baseUrl).href.split("#")[0].split("?")[0];
    let response;
    try {
      response = await fetch(dataUrl, { credentials: "include" });
    } catch {
      return;
    }
    if (!response.ok) return;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    urls.add(dataUrl);
    seeded.set(dataUrl, bytes);
    const scripts = text.match(/[a-zA-Z0-9_-]+\.js/g) || [];
    for (const file of scripts) urls.add(new URL("html5/data/js/" + file, baseUrl).href.split("#")[0].split("?")[0]);
    const media = text.match(/[a-zA-Z0-9_\-\/]+\.(png|jpg|jpeg|svg|mp3|mp4|woff|woff2)/g) || [];
    for (const file of media) urls.add(new URL(file, baseUrl).href.split("#")[0].split("?")[0]);
  }

  function addKnownFiles(urls, baseUrl) {
    const files = [
      "html5/data/js/paths.js",
      "html5/data/js/frame.js",
      "html5/lib/scripts/app.min.js",
      "html5/lib/stylesheets/main.min.css",
      "html5/data/css/output.min.css",
      "story_content/user.js",
      "story_content/frame.xml",
      "lms/Configuration.js",
      "lms/APIConstants.js",
      "lms/API.js",
      "lms/SCORMFunctions.js",
      "lms/SCORM2004Functions.js",
      "lms/UtilityFunctions.js",
      "data/player.js",
      "data/browsersupport.js",
    ];
    for (let i = 1; i <= 35; i += 1) {
      files.push("data/slide" + i + ".js", "data/slide" + i + ".css", "data/sound" + i + ".mp3");
    }
    for (let i = 0; i <= 50; i += 1) files.push("data/img" + i + ".png");
    for (const file of files) urls.add(new URL(file, baseUrl).href.split("#")[0].split("?")[0]);
  }

  async function downloadAll(urls, seeded, baseUrl, currentUrl) {
    const list = Array.from(urls);
    const files = [];
    const used = new Set();
    let cursor = 0;
    let downloaded = 0;
    let entryName = "index.html";

    async function worker() {
      while (cursor < list.length) {
        const cleanUrl = list[cursor++].split("#")[0].split("?")[0];
        const relPath = localPath(cleanUrl, baseUrl, currentUrl);
        if (!relPath || used.has(relPath)) continue;
        used.add(relPath);
        try {
          let bytes = seeded.get(cleanUrl);
          if (!bytes) {
            const response = await fetch(cleanUrl, { credentials: "include", signal: AbortSignal.timeout(30000) });
            if (!response.ok) continue;
            bytes = new Uint8Array(await response.arrayBuffer());
          }
          if (cleanUrl === currentUrl) entryName = relPath;
          files.push({ name: relPath, data: maybePatch(relPath, bytes) });
          downloaded += 1;
          if (downloaded === 1 || downloaded % 10 === 0) reportProgress("Downloaded " + downloaded + " files");
        } catch {
        }
      }
    }

    await Promise.all(Array.from({ length: 8 }, () => worker()));
    return { files, downloaded, entryName };
  }

  function saveZip(bytes, filename) {
    const blob = new Blob([bytes], { type: "application/zip" });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(blobUrl);
    }, 30000);
  }

  async function exportSlides() {
    const currentUrl = window.location.href.split("#")[0].split("?")[0];
    const baseUrl = currentUrl.substring(0, currentUrl.lastIndexOf("/") + 1);
    const urls = new Set([currentUrl]);
    const seeded = new Map();

    reportProgress("Reading the presentation");
    collectPageUrls(urls, baseUrl);
    await addStorylineList(urls, seeded, baseUrl);
    addKnownFiles(urls, baseUrl);

    reportProgress("Downloading files");
    const pack = await downloadAll(urls, seeded, baseUrl, currentUrl);
    if (!pack.downloaded) throw new Error("No presentation files found");
    reportProgress("Downloaded " + pack.downloaded + " files");

    pack.files.push({
      name: "Open_Presentation.bat",
      data: new TextEncoder().encode(launcherBat(pack.entryName)),
    });

    reportProgress("Packing the archive");
    const filename = downloadName(window.__meritoSlidesTitle || document.title);
    delete window.__meritoSlidesTitle;
    saveZip(buildZip(pack.files), filename);
    return { detail: "Saved " + pack.files.length + " files" };
  }

  exportSlides()
    .then((result) => {
      notify({ ok: true, detail: result && result.detail ? result.detail : "Done" });
    })
    .catch((error) => {
      notify({ ok: false, error: error && error.message ? error.message : String(error) });
    })
    .finally(() => {
      window.__meritoSlidesRunning = false;
    });
})();
