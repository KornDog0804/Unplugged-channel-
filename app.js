/* Joey’s Acoustic Corner — app.js (FUTURE-PROOF BUILD)
   ✅ Supports BOTH:
      A) Flat array episodes: [{title, artist, mode, tracks:[{title,url}]}]
      B) Folder/tree JSON: { sections:[{title, subtitle?, items:[episode|section]}] }  OR  [{title, items:[...]}]
   ✅ Defaults to /episodes_mobile.json (for phone folders)
   ✅ Fallback to /episodes.json (kodi master list)
   ✅ Fallback to episodes.js (window.EPISODES / window.episodes)
   ✅ URL overrides:
      ?data=mobile  (force mobile json)
      ?data=kodi    (force kodi json)
      ?data=url:https://your.site/file.json  (force custom)
   ✅ Remembers choice in localStorage ("jac_data_pref")
*/

(function () {
  const PAGE_SIZE = 12;
  const PREF_KEY = "jac_data_pref";

  const SOURCES = {
    mobile: "/episodes_mobile.json",
    kodi: "/episodes.json"
  };

  const $ = (sel) => document.querySelector(sel);

  const el = {
    status: $("#status"),
    episodes: $("#episodes"),
    playerFrame: $("#playerFrame"),
    nowTitle: $("#nowPlayingTitle"),
    nowLine: $("#nowPlayingLine"),
    toggleBtn: $("#playerToggleBtn"),
    watchOnTvBtn: $("#watchOnTvBtn"),
    loadMoreBtn: $("#loadMoreBtn"),
    playAllBtn: $("#playAllBtn")
  };

  // ===== State =====
  let ALL = [];            // for flat mode
  let shownCount = 0;      // for flat mode paging
  let TREE = null;         // for tree mode
  let NAV_STACK = [];      // tree navigation stack

  // ===== Helpers =====
  function setStatus(msg) {
    if (el.status) el.status.textContent = msg || "";
  }

  function safeText(v) {
    return (v === undefined || v === null) ? "" : String(v);
  }

  function getParam(name) {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get(name);
    } catch (_) {
      return null;
    }
  }

  function setPref(val) {
    try { localStorage.setItem(PREF_KEY, val); } catch (_) {}
  }

  function getPref() {
    try { return localStorage.getItem(PREF_KEY); } catch (_) { return null; }
  }

  function cacheBust(url) {
    const join = url.includes("?") ? "&" : "?";
    return url + join + "v=" + Date.now();
  }

  function normalizeYouTubeUrl(url) {
    return safeText(url).trim();
  }

  function getVideoId(url) {
    url = normalizeYouTubeUrl(url);
    if (!url) return "";
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtu.be")) {
        const id = u.pathname.replace("/", "").trim();
        return id || "";
      }
      const v = u.searchParams.get("v");
      if (v) return v;

      const parts = u.pathname.split("/").filter(Boolean);
      const embedIndex = parts.indexOf("embed");
      if (embedIndex >= 0 && parts[embedIndex + 1]) return parts[embedIndex + 1];
      return "";
    } catch (_) {
      return "";
    }
  }

  function getPlaylistId(url) {
    url = normalizeYouTubeUrl(url);
    if (!url) return "";
    try {
      const u = new URL(url);
      return u.searchParams.get("list") || "";
    } catch (_) {
      return "";
    }
  }

  // ✅ Single video embed
  function buildEmbedForSingle(videoUrl) {
    const id = getVideoId(videoUrl);
    if (!id) return "";
    const origin = encodeURIComponent(window.location.origin);
    return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1&modestbranding=1&origin=${origin}`;
  }

  // ✅ No-skip-first-song queue embed
  function buildEmbedForQueue(videoUrls) {
    const ids = (videoUrls || []).map(getVideoId).filter(Boolean);
    if (!ids.length) return "";

    const first = ids[0];
    const origin = encodeURIComponent(window.location.origin);
    const playlistAll = encodeURIComponent(ids.join(","));

    return `https://www.youtube.com/embed/${first}?autoplay=1&rel=0&playsinline=1&modestbranding=1&origin=${origin}&playlist=${playlistAll}&index=0`;
  }

  // ✅ Playlist embed attempt
  function buildEmbedForPlaylist(playlistUrl) {
    const list = getPlaylistId(playlistUrl);
    if (!list) return "";
    const origin = encodeURIComponent(window.location.origin);
    return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}&autoplay=1&rel=0&playsinline=1&modestbranding=1&origin=${origin}`;
  }

  function buildWatchUrl(ep) {
    if (!ep || !ep.tracks || !ep.tracks.length) return "";

    const mode = safeText(ep.mode).toLowerCase();
    const trackUrls = ep.tracks.map(t => t && t.url).filter(Boolean);

    if (mode === "playlist") {
      const list = getPlaylistId(trackUrls[0] || "");
      if (!list) return "";
      return `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`;
    }

    const firstId = getVideoId(trackUrls[0] || "");
    if (!firstId) return "";
    return `https://www.youtube.com/watch?v=${encodeURIComponent(firstId)}`;
  }

  function setWatchOnTv(url, label) {
    if (!el.watchOnTvBtn) return;

    el.watchOnTvBtn.textContent = label || "Watch on YouTube";
    el.watchOnTvBtn.href = url || "#";
    el.watchOnTvBtn.style.opacity = url ? "1" : "0.6";
    el.watchOnTvBtn.style.pointerEvents = url ? "auto" : "none";

    if (!url) el.watchOnTvBtn.setAttribute("aria-disabled", "true");
    else el.watchOnTvBtn.removeAttribute("aria-disabled");
  }

  function ensurePlayerVisible() {
    document.body.classList.remove("playerCollapsed");
    if (el.toggleBtn) {
      el.toggleBtn.textContent = "Hide player";
      el.toggleBtn.setAttribute("aria-expanded", "true");
    }
  }

  function highlightActive(key) {
    document.querySelectorAll(".ep").forEach(card => card.classList.remove("isActive"));
    if (!key) return;
    const card = document.querySelector(`.ep[data-key="${CSS.escape(key)}"]`);
    if (card) card.classList.add("isActive");
  }

  function isEpisode(obj) {
    // Loose check: episode has tracks OR mode OR artist/title combo
    if (!obj || typeof obj !== "object") return false;
    if (Array.isArray(obj.tracks)) return true;
    if (obj.mode) return true;
    return false;
  }

  function isSection(obj) {
    if (!obj || typeof obj !== "object") return false;
    return Array.isArray(obj.items) || Array.isArray(obj.sections);
  }

  function normalizeTree(data) {
    // Accept:
    // 1) { sections:[...] }
    // 2) [{title, items:[...]}]  (array of sections)
    // 3) { title, items:[...] } (single section)
    if (!data) return null;

    if (Array.isArray(data)) {
      // Could be flat episodes OR list of sections
      const looksLikeEpisodes = data.every(isEpisode);
      if (looksLikeEpisodes) return null; // not a tree
      // treat as sections array
      return { title: "Sessions", sections: data.map(sec => ({
        title: safeText(sec.title || "Folder"),
        subtitle: safeText(sec.subtitle || ""),
        items: sec.items || sec.sections || []
      })) };
    }

    if (Array.isArray(data.sections)) {
      return {
        title: safeText(data.title || "Sessions"),
        sections: data.sections.map(sec => ({
          title: safeText(sec.title || "Folder"),
          subtitle: safeText(sec.subtitle || ""),
          items: sec.items || sec.sections || []
        }))
      };
    }

    if (Array.isArray(data.items)) {
      return {
        title: safeText(data.title || "Sessions"),
        sections: [{
          title: safeText(data.title || "Folder"),
          subtitle: safeText(data.subtitle || ""),
          items: data.items
        }]
      };
    }

    return null;
  }

  // ===== MASTER LOAD =====
  async function loadJson(url) {
    const r = await fetch(cacheBust(url), { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  }

  async function loadEpisodesMaster() {
    // 1) Forced custom URL?
    const forced = getParam("data");
    let choice = null;

    if (forced && forced.startsWith("url:")) {
      const raw = forced.slice(4).trim();
      if (raw) {
        setPref("url:" + raw);
        try {
          const data = await loadJson(raw);
          return { data, source: raw };
        } catch (_) {}
      }
    }

    // 2) Forced mobile/kodi via querystring?
    if (forced === "mobile" || forced === "kodi") {
      setPref(forced);
      choice = forced;
    } else {
      // 3) Stored preference?
      const p = getPref();
      if (p) choice = p;
    }

    // Default to mobile
    if (!choice) choice = "mobile";

    // If stored pref is custom url
    if (choice && choice.startsWith("url:")) {
      const raw = choice.slice(4);
      try {
        const data = await loadJson(raw);
        return { data, source: raw };
      } catch (_) {
        // fall through to normal
      }
    }

    // Try preferred first, then the other
    const order = (choice === "kodi")
      ? ["kodi", "mobile"]
      : ["mobile", "kodi"];

    for (const key of order) {
      const url = SOURCES[key];
      try {
        const data = await loadJson(url);
        if (data) return { data, source: url, key };
      } catch (_) {}
    }

    // Last resort: episodes.js
    const fallback = window.EPISODES || window.episodes;
    if (Array.isArray(fallback) || (fallback && typeof fallback === "object")) {
      return { data: fallback, source: "episodes.js fallback" };
    }

    return null;
  }

  // ===== Core play =====
  function playEpisode(ep, key) {
    if (!ep || !ep.tracks || !ep.tracks.length) return;

    const mode = safeText(ep.mode).toLowerCase();
    const trackUrls = ep.tracks.map(t => t && t.url).filter(Boolean);

    // UI
    if (el.nowTitle) el.nowTitle.textContent = ep.title || "Now Playing";
    if (el.nowLine) {
      const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`.trim();
      el.nowLine.textContent = meta ? `Playing now: ${meta}` : "Playing now";
    }

    ensurePlayerVisible();
    highlightActive(key || "");

    // Set watch button
    const watchUrl = buildWatchUrl(ep);
    setWatchOnTv(watchUrl, mode === "playlist" ? "Open Playlist" : "Watch on YouTube");

    // iframe permissions
    if (el.playerFrame) {
      el.playerFrame.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
      el.playerFrame.setAttribute("allowfullscreen", "true");
      el.playerFrame.style.opacity = "1";
      el.playerFrame.style.pointerEvents = "auto";
    }

    let src = "";
    if (mode === "queue") src = buildEmbedForQueue(trackUrls);
    else if (mode === "playlist") src = buildEmbedForPlaylist(trackUrls[0]);
    else src = buildEmbedForSingle(trackUrls[0]);

    if (!src) {
      setStatus("Bad link in this session");
      return;
    }

    if (el.playerFrame) el.playerFrame.src = src;

    if (mode === "playlist") {
      setStatus(`Playlist loaded 🎟️ If it won’t play here, tap "Open Playlist" (YouTube blocks some embeds).`);
    }
  }

  // ===== Cards =====
  function buildEpisodeCard(ep, key, smallOverride) {
    const div = document.createElement("div");
    div.className = "ep";
    div.tabIndex = 0;
    div.dataset.key = key;

    const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`.trim();
    const m = safeText(ep.mode).toLowerCase();

    const small =
      smallOverride ||
      (m === "queue")
        ? `${(ep.tracks || []).length} tracks • stitched queue`
        : (m === "playlist")
          ? `playlist • opens as series`
          : `full show`;

    div.innerHTML = `
      <div class="epHead">
        <div style="min-width:0">
          <div class="epTitle">${safeText(ep.title)}</div>
          <div class="epMeta">${meta}</div>
          <div class="epSmall">${small}</div>
        </div>
        <div class="chev">›</div>
      </div>
    `;

    const activate = () => playEpisode(ep, key);
    div.addEventListener("click", activate);
    div.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });

    return div;
  }

  function buildFolderCard(section, key, subtitle) {
    const div = document.createElement("div");
    div.className = "ep";
    div.tabIndex = 0;
    div.dataset.key = key;

    div.innerHTML = `
      <div class="epHead">
        <div style="min-width:0">
          <div class="epTitle">${safeText(section.title || "Folder")}</div>
          <div class="epMeta">${safeText(subtitle || section.subtitle || "")}</div>
          <div class="epSmall">tap to open</div>
        </div>
        <div class="chev">›</div>
      </div>
    `;

    const activate = () => openSection(section);
    div.addEventListener("click", activate);
    div.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });

    return div;
  }

  // ===== Play All (flat only) =====
  function flattenPlayAll(list) {
    const urls = [];
    list.forEach(ep => {
      const mode = safeText(ep.mode).toLowerCase();
      if (mode === "playlist") return;
      (ep.tracks || []).forEach(t => { if (t && t.url) urls.push(t.url); });
    });
    return urls;
  }

  function wirePlayAllButtonFlat(episodes) {
    if (!el.playAllBtn) return;

    el.playAllBtn.onclick = () => {
      const urls = flattenPlayAll(episodes).filter(Boolean);
      const src = buildEmbedForQueue(urls);
      if (!src) {
        setStatus("No playable items for Play All");
        return;
      }

      if (el.nowTitle) el.nowTitle.textContent = "Play All";
      if (el.nowLine) el.nowLine.textContent = "Playing all sessions (playlists skipped).";

      const firstId = getVideoId(urls[0] || "");
      setWatchOnTv(firstId ? `https://www.youtube.com/watch?v=${encodeURIComponent(firstId)}` : "", "Watch on YouTube");

      ensurePlayerVisible();
      if (el.playerFrame) el.playerFrame.src = src;
    };
  }

  // ===== Load More (flat only) =====
  function updateLoadMoreUI() {
    if (!el.loadMoreBtn) return;
    const done = shownCount >= ALL.length;
    el.loadMoreBtn.style.display = (ALL.length > PAGE_SIZE) ? "block" : "none";
    el.loadMoreBtn.disabled = done;
    el.loadMoreBtn.textContent = done ? "All loaded" : "Load more";
  }

  function renderNextBatchFlat() {
    if (!el.episodes) return;

    const next = ALL.slice(shownCount, shownCount + PAGE_SIZE);
    next.forEach((ep, i) => {
      const trueIndex = shownCount + i;
      const key = `ep-${trueIndex}-${(ep.title || "").slice(0, 24)}`;
      el.episodes.appendChild(buildEpisodeCard(ep, key));
    });

    shownCount += next.length;
    updateLoadMoreUI();
    setStatus(`Showing ${Math.min(shownCount, ALL.length)} of ${ALL.length}`);
  }

  // ===== Tree Navigation =====
  function currentNode() {
    if (!NAV_STACK.length) return TREE;
    return NAV_STACK[NAV_STACK.length - 1];
  }

  function renderTreeNode(node) {
    if (!el.episodes) return;
    el.episodes.innerHTML = "";

    // Hide load more in tree mode
    if (el.loadMoreBtn) el.loadMoreBtn.style.display = "none";

    // Play All in tree mode (optional): keep stable by hiding
    if (el.playAllBtn) el.playAllBtn.style.display = "none";

    const title = node && node.title ? node.title : "Sessions";
    setStatus(title);

    // Back item if deeper than root
    if (NAV_STACK.length > 0) {
      const back = document.createElement("div");
      back.className = "ep";
      back.tabIndex = 0;
      back.innerHTML = `
        <div class="epHead">
          <div style="min-width:0">
            <div class="epTitle">⬅ Back</div>
            <div class="epMeta">${safeText(TREE.title || "Sessions")}</div>
            <div class="epSmall">go up one level</div>
          </div>
          <div class="chev">›</div>
        </div>
      `;
      const goBack = () => { NAV_STACK.pop(); renderTreeNode(currentNode()); };
      back.addEventListener("click", goBack);
      back.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goBack(); }
      });
      el.episodes.appendChild(back);
    }

    // Node may have sections OR items
    const sections = Array.isArray(node.sections) ? node.sections : null;
    const items = Array.isArray(node.items) ? node.items : null;

    if (sections) {
      sections.forEach((sec, i) => {
        const key = `sec-${NAV_STACK.length}-${i}-${(sec.title || "").slice(0, 18)}`;
        el.episodes.appendChild(buildFolderCard(sec, key, sec.subtitle || ""));
      });
      return;
    }

    const list = items || [];
    list.forEach((it, i) => {
      const key = `node-${NAV_STACK.length}-${i}-${safeText(it.title || "item").slice(0, 18)}`;

      if (isSection(it)) {
        const sec = {
          title: safeText(it.title || "Folder"),
          subtitle: safeText(it.subtitle || ""),
          items: it.items || it.sections || []
        };
        el.episodes.appendChild(buildFolderCard(sec, key, sec.subtitle));
        return;
      }

      if (isEpisode(it)) {
        el.episodes.appendChild(buildEpisodeCard(it, key));
        return;
      }
    });
  }

  function openSection(section) {
    NAV_STACK.push(section);
    renderTreeNode(section);
  }

  // ===== Init =====
  async function init() {
    try {
      const loaded = await loadEpisodesMaster();
      if (!loaded || !loaded.data) {
        setStatus("No episode list found (JSON + fallback failed)");
        return;
      }

      // Try tree first
      const tree = normalizeTree(loaded.data);
      if (tree) {
        TREE = tree;
        NAV_STACK = [];
        setStatus(`Loaded ✅ (tree) from ${loaded.source}`);
        if (el.playAllBtn) el.playAllBtn.style.display = "none";
        renderTreeNode(TREE);
        setWatchOnTv("");
        return;
      }

      // Flat mode
      if (!Array.isArray(loaded.data)) {
        setStatus("Loaded data but format is unknown.");
        return;
      }

      ALL = loaded.data;
      shownCount = 0;

      if (el.episodes) el.episodes.innerHTML = "";

      if (el.playAllBtn) el.playAllBtn.style.display = "block";
      wirePlayAllButtonFlat(ALL);

      if (el.loadMoreBtn) {
        el.loadMoreBtn.onclick = renderNextBatchFlat;
      }

      setStatus(`Loaded ✅ (flat) from ${loaded.source} • ${ALL.length} items`);
      renderNextBatchFlat();
      setWatchOnTv("");
    } catch (err) {
      setStatus("App crashed");
      console.error(err);
    }
  }

  function initPlayerToggle() {
    if (!el.toggleBtn) return;

    function setCollapsed(isCollapsed) {
      document.body.classList.toggle("playerCollapsed", isCollapsed);
      el.toggleBtn.textContent = isCollapsed ? "Show player" : "Hide player";
      el.toggleBtn.setAttribute("aria-expanded", String(!isCollapsed));
    }

    setCollapsed(true);

    el.toggleBtn.addEventListener("click", () => {
      setCollapsed(!document.body.classList.contains("playerCollapsed"));
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initPlayerToggle();
    init();
  });
})();
