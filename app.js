/* Joey’s Acoustic Corner — app.js (FOLDER + FLAT COMPAT BUILD)
   ✅ Loads /episodes_mobile.json first, falls back to /episodes.json, then episodes.js
   ✅ Supports BOTH data shapes:
      A) Flat array of episodes: [{title, artist, mode, tracks:[{title,url}]}]
      B) Folder/tree:
         { sections:[{title, subtitle?, items:[episode|section]}] }
         OR array of sections: [{title, subtitle?, items:[...]}]
   ✅ Folder navigation (tap Artists / Tiny Desk / etc)
   ✅ Play All works within current view (skips playlists to stay stable)
*/

(function () {
  const PAGE_SIZE = 24;

  // If the JSON files live on the SAME Netlify site as the app, keep these relative.
  // (That’s the best setup.)
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
    playAllBtn: $("#playAllBtn"),

    // Back button IDs vary by builds, so we try several:
    backBtn:
      $("#backToHomeBtn") ||
      $("#backHomeBtn") ||
      $("#backBtn") ||
      document.querySelector('[data-action="back"]') ||
      null
  };

  // ===== STATE =====
  let ROOT_VIEW = [];     // array of top-level sections
  let VIEW_STACK = [];    // {title, list} stack for folder navigation
  let CURRENT_LIST = [];  // items (sections or episodes) for current view
  let CURRENT_TITLE = "Sessions";
  let SHOWN = 0;          // pagination count

  // ===== Helpers =====
  function setStatus(msg) {
    if (el.status) el.status.textContent = msg || "";
  }

  function safeText(v) {
    return (v === undefined || v === null) ? "" : String(v);
  }

  function isEpisode(obj) {
    return obj && Array.isArray(obj.tracks);
  }

  function isSection(obj) {
    return obj && Array.isArray(obj.items);
  }

  function normalizeToRootList(data) {
    // Case 1: { sections:[...] }
    if (data && Array.isArray(data.sections)) return data.sections;

    // Case 2: array
    if (Array.isArray(data)) {
      // If array looks like episodes -> wrap into one section (keeps compatibility)
      if (data.length === 0) return [{ title: "Sessions", subtitle: "all", items: [] }];
      if (isEpisode(data[0])) return [{ title: "Sessions", subtitle: "all", items: data }];
      if (isSection(data[0])) return data;
      // Unknown array -> still wrap
      return [{ title: "Sessions", subtitle: "all", items: [] }];
    }

    // Unknown -> empty
    return [{ title: "Sessions", subtitle: "all", items: [] }];
  }

  function bust(url) {
    const join = url.includes("?") ? "&" : "?";
    return url + join + "v=" + Date.now();
  }

  // ===== YouTube parsing =====
  function getVideoId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "").trim();
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const parts = u.pathname.split("/").filter(Boolean);
      const embedIndex = parts.indexOf("embed");
      if (embedIndex >= 0 && parts[embedIndex + 1]) return parts[embedIndex + 1];
      return "";
    } catch (_) {
      return "";
    }
  }

  function getPlaylistId(url) {
    try {
      const u = new URL(url);
      return u.searchParams.get("list") || "";
    } catch (_) {
      return "";
    }
  }

  function buildEmbedForSingle(videoUrl) {
    const id = getVideoId(videoUrl);
    if (!id) return "";
    const origin = encodeURIComponent(window.location.origin);
    return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1&modestbranding=1&origin=${origin}`;
  }

  function buildEmbedForQueue(videoUrls) {
    const ids = videoUrls.map(getVideoId).filter(Boolean);
    if (!ids.length) return "";
    const first = ids[0];
    const origin = encodeURIComponent(window.location.origin);
    const playlistAll = encodeURIComponent(ids.join(","));
    // index=0 prevents the "skip first song" nonsense
    return `https://www.youtube.com/embed/${first}?autoplay=1&rel=0&playsinline=1&modestbranding=1&origin=${origin}&playlist=${playlistAll}&index=0`;
  }

  function buildEmbedForPlaylist(playlistUrl) {
    const list = getPlaylistId(playlistUrl);
    if (!list) return "";
    const origin = encodeURIComponent(window.location.origin);
    return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}&autoplay=1&rel=0&playsinline=1&modestbranding=1&origin=${origin}`;
  }

  function buildWatchUrl(ep) {
    if (!ep || !ep.tracks || !ep.tracks.length) return "";
    const mode = safeText(ep.mode).toLowerCase();
    const trackUrls = ep.tracks.map(t => t.url).filter(Boolean);

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
    const card = document.querySelector(`.ep[data-key="${CSS.escape(key)}"]`);
    if (card) card.classList.add("isActive");
  }

  // ===== Play =====
  function playEpisode(ep, keyForHighlight) {
    if (!ep || !ep.tracks || !ep.tracks.length) return;

    const mode = safeText(ep.mode).toLowerCase();
    const trackUrls = ep.tracks.map(t => t.url).filter(Boolean);

    if (el.nowTitle) el.nowTitle.textContent = ep.title || "Now Playing";
    if (el.nowLine) {
      const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`.trim();
      el.nowLine.textContent = meta ? `Playing now: ${meta}` : "Playing now";
    }

    ensurePlayerVisible();
    if (keyForHighlight) highlightActive(keyForHighlight);

    const watchUrl = buildWatchUrl(ep);
    setWatchOnTv(watchUrl, mode === "playlist" ? "Open Playlist" : "Watch on YouTube");

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
      setStatus(`Playlist loaded 🎟️ If it won’t play in-app, tap “Open Playlist”.`);
    } else {
      setStatus(`${CURRENT_TITLE} • Showing ${Math.min(SHOWN, CURRENT_LIST.length)} of ${CURRENT_LIST.length}`);
    }
  }

  // ===== Cards =====
  function buildSectionCard(section, idx) {
    const div = document.createElement("div");
    div.className = "ep";
    div.tabIndex = 0;

    const key = `sec-${idx}-${(section.title || "").slice(0, 24)}`;
    div.dataset.key = key;

    const subtitle = safeText(section.subtitle);
    const count = Array.isArray(section.items) ? section.items.length : 0;

    div.innerHTML = `
      <div class="epHead">
        <div style="min-width:0">
          <div class="epTitle">${safeText(section.title)}</div>
          <div class="epMeta">${subtitle ? subtitle : ""}</div>
          <div class="epSmall">${count} items</div>
        </div>
        <div class="chev">›</div>
      </div>
    `;

    const open = () => pushView(section.title || "Folder", section.items || []);
    div.addEventListener("click", open);
    div.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });

    return div;
  }

  function buildEpisodeCard(ep, idx) {
    const div = document.createElement("div");
    div.className = "ep";
    div.tabIndex = 0;

    const key = `ep-${idx}-${(ep.title || "").slice(0, 24)}`;
    div.dataset.key = key;

    const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`.trim();
    const m = safeText(ep.mode).toLowerCase();

    const small =
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
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
    });

    return div;
  }

  // ===== View Rendering =====
  function updateBackButton() {
    if (!el.backBtn) return;
    const atRoot = VIEW_STACK.length === 0;
    el.backBtn.style.display = atRoot ? "none" : "inline-flex";
  }

  function updateLoadMoreUI() {
    if (!el.loadMoreBtn) return;
    const done = SHOWN >= CURRENT_LIST.length;
    el.loadMoreBtn.style.display = (CURRENT_LIST.length > PAGE_SIZE) ? "block" : "none";
    el.loadMoreBtn.disabled = done;
    el.loadMoreBtn.textContent = done ? "All loaded" : "Load more";
  }

  function renderNextBatch() {
    if (!el.episodes) return;

    const next = CURRENT_LIST.slice(SHOWN, SHOWN + PAGE_SIZE);

    next.forEach((item, i) => {
      const trueIndex = SHOWN + i;
      if (isSection(item)) el.episodes.appendChild(buildSectionCard(item, trueIndex));
      else if (isEpisode(item)) el.episodes.appendChild(buildEpisodeCard(item, trueIndex));
    });

    SHOWN += next.length;
    updateLoadMoreUI();
    setStatus(`${CURRENT_TITLE} • Showing ${Math.min(SHOWN, CURRENT_LIST.length)} of ${CURRENT_LIST.length}`);
  }

  function renderView(title, list) {
    CURRENT_TITLE = title || "Sessions";
    CURRENT_LIST = Array.isArray(list) ? list : [];
    SHOWN = 0;

    if (el.episodes) el.episodes.innerHTML = "";
    updateBackButton();

    renderNextBatch();
    setWatchOnTv("");
  }

  function pushView(title, list) {
    VIEW_STACK.push({ title: CURRENT_TITLE, list: CURRENT_LIST });
    renderView(title, list);
  }

  function popView() {
    const prev = VIEW_STACK.pop();
    if (!prev) {
      renderView("Sessions", ROOT_VIEW);
      return;
    }
    renderView(prev.title, prev.list);
  }

  // ===== Play All (current view only) =====
  function flattenPlayAll(list) {
    const urls = [];
    (list || []).forEach(item => {
      if (!isEpisode(item)) return;
      const mode = safeText(item.mode).toLowerCase();
      if (mode === "playlist") return; // keep stable
      (item.tracks || []).forEach(t => { if (t && t.url) urls.push(t.url); });
    });
    return urls;
  }

  function wireButtons() {
    if (el.loadMoreBtn) el.loadMoreBtn.addEventListener("click", renderNextBatch);

    if (el.backBtn) el.backBtn.addEventListener("click", popView);

    if (el.playAllBtn) {
      el.playAllBtn.addEventListener("click", () => {
        const urls = flattenPlayAll(CURRENT_LIST).filter(Boolean);
        const src = buildEmbedForQueue(urls);

        if (!src) {
          setStatus("Nothing playable in this view for Play All");
          return;
        }

        if (el.nowTitle) el.nowTitle.textContent = "Play All";
        if (el.nowLine) el.nowLine.textContent = `Playing all in: ${CURRENT_TITLE}`;

        const firstId = getVideoId(urls[0] || "");
        setWatchOnTv(firstId ? `https://www.youtube.com/watch?v=${encodeURIComponent(firstId)}` : "", "Watch on YouTube");

        ensurePlayerVisible();
        if (el.playerFrame) el.playerFrame.src = src;

        setStatus(`${CURRENT_TITLE} • Playing all`);
      });
    }
  }

  // ===== Player toggle =====
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

  // ===== Data Load =====
  async function fetchJson(url) {
    const r = await fetch(bust(url), { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  }

  async function loadData() {
    // Overrides:
    // ?data=mobile  or  ?data=kodi  or  ?data=url:https://site/file.json
    const params = new URLSearchParams(window.location.search);
    const pref = (params.get("data") || "").trim();

    try {
      if (pref.startsWith("url:")) {
        const custom = pref.replace(/^url:/, "");
        const j = await fetchJson(custom);
        if (j) return { data: j, source: custom };
      }

      if (pref === "kodi") {
        const j = await fetchJson(SOURCES.kodi);
        if (j) return { data: j, source: SOURCES.kodi };
      }

      // default: mobile first
      const mobile = await fetchJson(SOURCES.mobile);
      if (mobile) return { data: mobile, source: SOURCES.mobile };

      const kodi = await fetchJson(SOURCES.kodi);
      if (kodi) return { data: kodi, source: SOURCES.kodi };
    } catch (_) {}

    // Final fallback: episodes.js
    const fallback = window.EPISODES || window.episodes;
    if (Array.isArray(fallback) || (fallback && Array.isArray(fallback.sections))) {
      return { data: fallback, source: "episodes.js fallback" };
    }

    return null;
  }

  async function init() {
    setStatus("Loading…");

    const loaded = await loadData();
    if (!loaded) {
      setStatus("No data found (mobile + kodi + fallback failed)");
      return;
    }

    ROOT_VIEW = normalizeToRootList(loaded.data);
    VIEW_STACK = [];

    wireButtons();

    // Keep the top-level tiles (Artists / MTV / Tiny Desk / etc)
    renderView("Sessions", ROOT_VIEW);

    setStatus(`Loaded ✅ (${loaded.source})`);
  }

  // ===== Boot =====
  document.addEventListener("DOMContentLoaded", () => {
    initPlayerToggle();
    init();
  });
})();
