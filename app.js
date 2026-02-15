/* Joey’s Acoustic Corner — app.js (MOBILE FOLDERS + SLIDE NAV BUILD)
   ✅ Supports BOTH:
      A) Flat array episodes: [{title, artist, mode, tracks:[{title,url}]}]
      B) Folder/tree JSON:   [{title, mode:"folder", items:[episode|folder]}]
   ✅ Defaults to /episodes_mobile.json (phone folders)
   ✅ Falls back to /episodes.json (kodi master list)
   ✅ Falls back to episodes.js (window.EPISODES / window.episodes)
   ✅ URL overrides:
      ?data=mobile
      ?data=kodi
      ?data=url:https://site/file.json
   ✅ Remembers choice in localStorage ("jac_data_pref")
   ✅ Folder nav:
      - back goes to previous page (NOT home)
      - slide animation forward/back
   ✅ Queue view:
      - Play All
      - pick individual track
   ✅ Playlist:
      - attempts embed
      - ALWAYS provides Open Playlist fallback
*/

(function () {
  const PAGE_SIZE = 12;
  const PREF_KEY = "jac_data_pref";

  // Default sources (same origin)
  const SOURCES = {
    mobile: "/episodes_mobile.json",
    kodi: "/episodes.json"
  };

  const $ = (sel) => document.querySelector(sel);

  // ---- DOM hooks (safe) ----
  const el = {
    status: $("#status"),
    playerFrame: $("#playerFrame"),
    nowTitle: $("#nowPlayingTitle"),
    nowLine: $("#nowPlayingLine"),
    toggleBtn: $("#playerToggleBtn"),
    watchOnTvBtn: $("#watchOnTvBtn"),
    playAllBtn: $("#playAllBtn"),
    viewWrap: $("#viewWrap"),
    view: $("#view")
  };

  // ---- State ----
  let DATA = null;               // raw loaded JSON
  let NAV_STACK = [];            // stack of {title, node, kind}
  let CURRENT_LIST = [];         // currently shown list of items (episodes or folders)
  let shownCount = 0;

  // ==========================
  // Helpers
  // ==========================
  function setStatus(msg) {
    if (el.status) el.status.textContent = msg || "";
  }

  function safeText(v) {
    return (v === undefined || v === null) ? "" : String(v);
  }

  function isFolder(node) {
    return node && String(node.mode || "").toLowerCase() === "folder" && Array.isArray(node.items);
  }

  function isEpisode(node) {
    return node && !isFolder(node) && Array.isArray(node.tracks);
  }

  function bust(url) {
    const sep = url.includes("?") ? "&" : "?";
    return url + sep + "v=" + Date.now();
  }

  function getVideoId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "").trim();
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const parts = u.pathname.split("/").filter(Boolean);
      const embedIndex = parts.indexOf("embed");
      if (embedIndex >= 0 && parts[embedIndex + 1]) return parts[embedIndex + 1];
      return "";
    } catch (_) { return ""; }
  }

  function getPlaylistId(url) {
    try {
      const u = new URL(url);
      return u.searchParams.get("list") || "";
    } catch (_) { return ""; }
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
    const urls = ep.tracks.map(t => t.url).filter(Boolean);

    if (mode === "playlist") {
      const list = getPlaylistId(urls[0] || "");
      if (!list) return "";
      return `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`;
    }

    const firstId = getVideoId(urls[0] || "");
    if (!firstId) return "";
    return `https://www.youtube.com/watch?v=${encodeURIComponent(firstId)}`;
  }

  function setWatchButton(url, label) {
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

  function resetPlayer() {
    if (el.playerFrame) el.playerFrame.src = "";
    if (el.nowTitle) el.nowTitle.textContent = "Now Playing";
    if (el.nowLine) el.nowLine.textContent = "";
    setWatchButton("");
  }

  // ==========================
  // Slide navigation
  // ==========================
  function slideTo(renderFn, dir /* "forward" | "back" */) {
    const wrap = el.viewWrap;
    const current = el.view;

    if (!wrap || !current) {
      renderFn(current);
      return;
    }

    const incoming = document.createElement("div");
    incoming.className = "slidePage";
    wrap.appendChild(incoming);

    renderFn(incoming);

    if (dir === "back") {
      current.classList.add("slide-out-right");
      incoming.classList.add("slide-in-right");
      incoming.style.transform = "translateX(-25%)";
    } else {
      current.classList.add("slide-out-left");
      incoming.classList.add("slide-in-left");
    }

    setTimeout(() => {
      current.innerHTML = incoming.innerHTML;
      current.classList.remove("slide-out-left", "slide-out-right");
      wrap.removeChild(incoming);

      // after swap, rebind events inside the current view
      bindViewEvents();
    }, 240);
  }

  // ==========================
  // Data source selection
  // ==========================
  function parseDataOverride() {
    const qs = new URLSearchParams(window.location.search);
    const data = qs.get("data");
    if (!data) return null;

    if (data === "mobile") return { kind: "mobile", url: SOURCES.mobile };
    if (data === "kodi") return { kind: "kodi", url: SOURCES.kodi };

    if (data.startsWith("url:")) {
      return { kind: "custom", url: data.replace(/^url:/, "") };
    }

    return null;
  }

  function getPreferredSource() {
    const override = parseDataOverride();
    if (override) {
      localStorage.setItem(PREF_KEY, JSON.stringify(override));
      return override;
    }

    try {
      const saved = localStorage.getItem(PREF_KEY);
      if (saved) return JSON.parse(saved);
    } catch (_) {}

    // default mobile
    return { kind: "mobile", url: SOURCES.mobile };
  }

  async function fetchJson(url) {
    const r = await fetch(bust(url), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  }

  async function loadData() {
    const pref = getPreferredSource();

    // 1) try preferred
    try {
      const data = await fetchJson(pref.url);
      setStatus(`Loaded ✅ (${pref.kind})`);
      return data;
    } catch (e) {
      // continue
    }

    // 2) fallback chain
    try {
      const data = await fetchJson(SOURCES.mobile);
      setStatus("Loaded ✅ (mobile fallback)");
      return data;
    } catch (_) {}

    try {
      const data = await fetchJson(SOURCES.kodi);
      setStatus("Loaded ✅ (kodi fallback)");
      return data;
    } catch (_) {}

    // 3) final fallback to episodes.js globals
    const fallback = window.EPISODES || window.episodes;
    if (Array.isArray(fallback)) {
      setStatus("Loaded ⚠️ (episodes.js fallback)");
      return fallback;
    }

    setStatus("No data found ❌");
    return null;
  }

  // ==========================
  // Normalization: flat -> folder tree
  // ==========================
  function toFolderTree(data) {
    // If it already looks like folders, keep it
    if (Array.isArray(data) && data.some(isFolder)) return data;

    // If it’s a flat episodes list, wrap it in a single folder
    if (Array.isArray(data)) {
      return [{
        title: "Sessions",
        mode: "folder",
        items: data
      }];
    }

    // unknown
    return [{
      title: "Sessions",
      mode: "folder",
      items: []
    }];
  }

  // ==========================
  // Rendering
  // ==========================
  function cardHtml(title, meta, small, isFolderCard) {
    return `
      <div class="epHead">
        <div style="min-width:0">
          <div class="epTitle">${safeText(title)}</div>
          ${meta ? `<div class="epMeta">${safeText(meta)}</div>` : ``}
          ${small ? `<div class="epSmall">${safeText(small)}</div>` : ``}
        </div>
        <div class="chev">${isFolderCard ? "›" : "›"}</div>
      </div>
    `;
  }

  function buildFolderCard(folderNode) {
    const div = document.createElement("div");
    div.className = "ep";
    div.tabIndex = 0;
    div.dataset.kind = "folder";
    div.dataset.title = safeText(folderNode.title);

    const count = Array.isArray(folderNode.items) ? folderNode.items.length : 0;
    div.innerHTML = cardHtml(
      folderNode.title || "Folder",
      "",
      `${count} items`,
      true
    );

    div.addEventListener("click", () => openFolder(folderNode));
    div.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openFolder(folderNode);
      }
    });

    return div;
  }

  function buildEpisodeCard(ep) {
    const div = document.createElement("div");
    div.className = "ep";
    div.tabIndex = 0;
    div.dataset.kind = "episode";

    const mode = safeText(ep.mode).toLowerCase();
    const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`.trim();

    const small =
      mode === "queue"
        ? `${(ep.tracks || []).length} tracks • tap to choose`
        : mode === "playlist"
          ? `playlist • opens as series`
          : `full show`;

    div.innerHTML = cardHtml(ep.title || "Untitled", meta, small, false);

    div.addEventListener("click", () => {
      if (mode === "queue") openQueue(ep);
      else playEpisode(ep);
    });

    div.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (mode === "queue") openQueue(ep);
        else playEpisode(ep);
      }
    });

    return div;
  }

  function renderListInto(targetNode, title, subtitle, items) {
    targetNode.innerHTML = "";

    // Header row (Back button + title)
    const header = document.createElement("div");
    header.className = "pageHeader";
    header.innerHTML = `
      <button id="backBtn" class="backBtn" ${NAV_STACK.length <= 1 ? "style='display:none;'" : ""}>← Back</button>
      <div class="pageTitleWrap">
        <div class="pageTitle">${safeText(title || "Sessions")}</div>
        ${subtitle ? `<div class="pageSub">${safeText(subtitle)}</div>` : ``}
      </div>
    `;
    targetNode.appendChild(header);

    // Play All (only for episode lists)
    const onlyEpisodes = (items || []).filter(isEpisode);
    if (onlyEpisodes.length) {
      const playAllWrap = document.createElement("div");
      playAllWrap.className = "playAllWrap";
      playAllWrap.innerHTML = `<button id="pagePlayAllBtn" class="playAllBig">Play All</button>`;
      targetNode.appendChild(playAllWrap);
    }

    // Cards container
    const list = document.createElement("div");
    list.id = "list";
    targetNode.appendChild(list);

    // Pagination reset
    CURRENT_LIST = items || [];
    shownCount = 0;

    // Render first page
    renderNextPage(targetNode);

    // Footer load more
    if (CURRENT_LIST.length > PAGE_SIZE) {
      const more = document.createElement("button");
      more.id = "pageLoadMoreBtn";
      more.className = "loadMoreBtn";
      more.textContent = "Load more";
      targetNode.appendChild(more);
    }
  }

  function renderNextPage(rootNode) {
    const list = rootNode.querySelector("#list");
    if (!list) return;

    const next = CURRENT_LIST.slice(shownCount, shownCount + PAGE_SIZE);
    next.forEach((node) => {
      if (isFolder(node)) list.appendChild(buildFolderCard(node));
      else if (isEpisode(node)) list.appendChild(buildEpisodeCard(node));
    });

    shownCount += next.length;

    // Update load more
    const btn = rootNode.querySelector("#pageLoadMoreBtn");
    if (btn) {
      const done = shownCount >= CURRENT_LIST.length;
      btn.disabled = done;
      btn.textContent = done ? "All loaded" : "Load more";
    }

    setStatus(`Showing ${Math.min(shownCount, CURRENT_LIST.length)} of ${CURRENT_LIST.length}`);
  }

  // ==========================
  // Navigation (folder stack)
  // ==========================
  function renderRootInto(targetNode) {
    const rootTitle = "Joey’s Acoustic Corner";
    const rootSubtitle = "Stripped & unplugged sessions — handpicked only.";

    const rootItems = toFolderTree(DATA);
    renderListInto(targetNode, rootTitle, rootSubtitle, rootItems);
  }

  function openFolder(folderNode) {
    NAV_STACK.push({ kind: "folder", node: folderNode, title: folderNode.title || "Folder" });

    slideTo((node) => {
      renderListInto(node, folderNode.title || "Folder", "", folderNode.items || []);
    }, "forward");
  }

  function goBack() {
    if (NAV_STACK.length <= 1) return;
    NAV_STACK.pop();
    const prev = NAV_STACK[NAV_STACK.length - 1];

    slideTo((node) => {
      if (!prev) return renderRootInto(node);
      if (prev.kind === "root") return renderRootInto(node);
      if (prev.kind === "folder") return renderListInto(node, prev.title, "", (prev.node.items || []));
      if (prev.kind === "queue") return renderQueueInto(node, prev.ep);
      renderRootInto(node);
    }, "back");
  }

  // ==========================
  // Queue view (track picker)
  // ==========================
  function openQueue(ep) {
    NAV_STACK.push({ kind: "queue", ep, title: ep.title || "Queue" });

    slideTo((node) => {
      renderQueueInto(node, ep);
    }, "forward");
  }

  function renderQueueInto(targetNode, ep) {
    const tracks = (ep.tracks || []).filter(t => t && t.url);
    targetNode.innerHTML = "";

    const header = document.createElement("div");
    header.className = "pageHeader";
    header.innerHTML = `
      <button id="backBtn" class="backBtn">← Back</button>
      <div class="pageTitleWrap">
        <div class="pageTitle">${safeText(ep.title || "Queue")}</div>
        <div class="pageSub">${tracks.length} tracks • pick one or hit Play All</div>
      </div>
    `;
    targetNode.appendChild(header);

    const playAllWrap = document.createElement("div");
    playAllWrap.className = "playAllWrap";
    playAllWrap.innerHTML = `<button id="queuePlayAllBtn" class="playAllBig">Play All</button>`;
    targetNode.appendChild(playAllWrap);

    const list = document.createElement("div");
    list.id = "list";
    targetNode.appendChild(list);

    tracks.forEach((t, i) => {
      const div = document.createElement("div");
      div.className = "ep";
      div.tabIndex = 0;

      div.innerHTML = cardHtml(
        `${i + 1}. ${safeText(t.title || "Track")}`,
        "single track",
        "tap to play",
        false
      );

      div.addEventListener("click", () => playSingleTrack(ep, t.url, t.title));
      div.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          playSingleTrack(ep, t.url, t.title);
        }
      });

      list.appendChild(div);
    });
  }

  // ==========================
  // Playback
  // ==========================
  function playEpisode(ep) {
    if (!ep || !ep.tracks || !ep.tracks.length) return;

    const mode = safeText(ep.mode).toLowerCase();
    const urls = ep.tracks.map(t => t.url).filter(Boolean);

    if (el.nowTitle) el.nowTitle.textContent = ep.title || "Now Playing";
    if (el.nowLine) {
      const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`.trim();
      el.nowLine.textContent = meta ? `Playing now: ${meta}` : "Playing now";
    }

    ensurePlayerVisible();

    const watchUrl = buildWatchUrl(ep);
    setWatchButton(watchUrl, mode === "playlist" ? "Open Playlist" : "Watch on YouTube");

    if (el.playerFrame) {
      el.playerFrame.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
      el.playerFrame.setAttribute("allowfullscreen", "true");
      el.playerFrame.style.opacity = "1";
      el.playerFrame.style.pointerEvents = "auto";
    }

    let src = "";
    if (mode === "queue") src = buildEmbedForQueue(urls);
    else if (mode === "playlist") src = buildEmbedForPlaylist(urls[0]);
    else src = buildEmbedForSingle(urls[0]);

    if (!src) {
      setStatus("Bad link in this session");
      return;
    }

    if (el.playerFrame) el.playerFrame.src = src;

    if (mode === "playlist") {
      setStatus(`Playlist loaded 🎟️ If it won’t play here, tap "Open Playlist" (YouTube blocks some embeds).`);
    }
  }

  function playQueueAll(ep) {
    const urls = (ep.tracks || []).map(t => t.url).filter(Boolean);
    const src = buildEmbedForQueue(urls);
    if (!src) {
      setStatus("No playable tracks in this queue");
      return;
    }

    if (el.nowTitle) el.nowTitle.textContent = ep.title || "Play All";
    if (el.nowLine) el.nowLine.textContent = "Playing full queue (stitched).";

    setWatchButton(buildWatchUrl(ep), "Watch on YouTube");
    ensurePlayerVisible();
    if (el.playerFrame) el.playerFrame.src = src;
  }

  function playSingleTrack(ep, url, trackTitle) {
    const src = buildEmbedForSingle(url);
    if (!src) {
      setStatus("Bad track link");
      return;
    }

    if (el.nowTitle) el.nowTitle.textContent = trackTitle || ep.title || "Now Playing";
    if (el.nowLine) el.nowLine.textContent = safeText(ep.artist) ? `Playing now: ${safeText(ep.artist)}` : "Playing now";

    setWatchButton(`https://www.youtube.com/watch?v=${encodeURIComponent(getVideoId(url))}`, "Watch on YouTube");
    ensurePlayerVisible();
    if (el.playerFrame) el.playerFrame.src = src;
  }

  // ==========================
  // Binding (because slide swaps innerHTML)
  // ==========================
  function bindViewEvents() {
    const backBtn = el.view.querySelector("#backBtn");
    if (backBtn) backBtn.addEventListener("click", goBack);

    const loadMore = el.view.querySelector("#pageLoadMoreBtn");
    if (loadMore) loadMore.addEventListener("click", () => renderNextPage(el.view));

    const pagePlayAll = el.view.querySelector("#pagePlayAllBtn");
    if (pagePlayAll) {
      pagePlayAll.addEventListener("click", () => {
        // Play all episodes shown in CURRENT_LIST (skip playlists for stability)
        const episodes = CURRENT_LIST.filter(isEpisode);
        const urls = [];
        episodes.forEach(ep => {
          const mode = safeText(ep.mode).toLowerCase();
          if (mode === "playlist") return;
          (ep.tracks || []).forEach(t => { if (t && t.url) urls.push(t.url); });
        });

        const src = buildEmbedForQueue(urls);
        if (!src) {
          setStatus("No playable items for Play All");
          return;
        }

        if (el.nowTitle) el.nowTitle.textContent = "Play All";
        if (el.nowLine) el.nowLine.textContent = "Playing all sessions (queues stitched where possible).";

        const firstId = getVideoId(urls[0] || "");
        setWatchButton(firstId ? `https://www.youtube.com/watch?v=${encodeURIComponent(firstId)}` : "", "Watch on YouTube");

        ensurePlayerVisible();
        if (el.playerFrame) el.playerFrame.src = src;
      });
    }

    const queuePlayAll = el.view.querySelector("#queuePlayAllBtn");
    if (queuePlayAll) {
      const top = NAV_STACK[NAV_STACK.length - 1];
      if (top && top.kind === "queue") {
        queuePlayAll.addEventListener("click", () => playQueueAll(top.ep));
      }
    }
  }

  // ==========================
  // Player toggle
  // ==========================
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

  // ==========================
  // Init
  // ==========================
  async function init() {
    try {
      DATA = await loadData();
      if (!DATA) return;

      NAV_STACK = [{ kind: "root", title: "Home" }];

      slideTo((node) => {
        renderRootInto(node);
      }, "forward");

      resetPlayer();
      setWatchButton("");
    } catch (err) {
      console.error(err);
      setStatus("App crashed");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initPlayerToggle();
    init();
  });
})();
