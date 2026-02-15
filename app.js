/* Joey’s Acoustic Corner — app.js (MOBILE + KODI COMPAT, FUTURE-PROOF)
   ✅ Supports BOTH:
      A) Flat array episodes: [{title, artist, mode, tracks:[{title,url}]}]
      B) Folder/tree JSON:
         - { sections:[{title, items:[episode|section]}] }
         - OR [{title, items:[...]}]
   ✅ Defaults to /episodes_mobile.json (phone folders)
   ✅ Falls back to /episodes.json (kodi)
   ✅ Falls back to episodes.js (window.EPISODES / window.episodes)
   ✅ Lets you browse folders → shows → tracks (queue picker)
*/

(function () {
  const PAGE_SIZE = 30; // bigger for folders
  const SOURCES = {
    mobile: "/episodes_mobile.json",
    kodi: "/episodes.json",
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
  };

  // Navigation stack for folder browsing
  const NAV = []; // each = { title, items, mode:'folder'|'list' }

  let ROOT_ITEMS = [];
  let FLAT_CACHE = []; // flattened episodes (for Play All)
  let shownCount = 0;

  // ===== Helpers =====
  function setStatus(msg) {
    if (el.status) el.status.textContent = msg || "";
  }

  function safeText(v) {
    return (v === undefined || v === null) ? "" : String(v);
  }

  function fetchJson(url) {
    const bust = `?v=${Date.now()}`;
    return fetch(url + bust, { cache: "no-store" }).then(r => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
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
    return `https://www.youtube.com/embed/${first}?autoplay=1&rel=0&playsinline=1&modestbranding=1&origin=${origin}&playlist=${playlistAll}&index=0`;
  }

  function buildEmbedForPlaylist(playlistUrl) {
    const list = getPlaylistId(playlistUrl);
    if (!list) return "";
    const origin = encodeURIComponent(window.location.origin);
    return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}&autoplay=1&rel=0&playsinline=1&modestbranding=1&origin=${origin}`;
  }

  function buildWatchUrlFromEpisode(ep) {
    if (!ep || !ep.tracks || !ep.tracks.length) return "";
    const mode = safeText(ep.mode).toLowerCase();
    const firstUrl = (ep.tracks[0] || {}).url || "";

    if (mode === "playlist") {
      const list = getPlaylistId(firstUrl);
      return list ? `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}` : "";
    }

    const firstId = getVideoId(firstUrl);
    return firstId ? `https://www.youtube.com/watch?v=${encodeURIComponent(firstId)}` : "";
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

  function isFolder(node) {
    return node && typeof node === "object" && Array.isArray(node.items);
  }

  function isEpisode(node) {
    return node && typeof node === "object" && Array.isArray(node.tracks);
  }

  // ===== JSON NORMALIZATION =====
  function normalizeToRootItems(data) {
    // Accept:
    // 1) {sections:[...]}
    // 2) [...]
    // 3) flat episodes array
    if (!data) return [];

    if (Array.isArray(data)) return data;

    if (data.sections && Array.isArray(data.sections)) return data.sections;

    // if someone wraps in {items:[...]}
    if (Array.isArray(data.items)) return data.items;

    return [];
  }

  function flattenEpisodes(items, out = []) {
    (items || []).forEach(n => {
      if (isEpisode(n)) out.push(n);
      else if (isFolder(n)) flattenEpisodes(n.items, out);
      else if (n && Array.isArray(n.sections)) flattenEpisodes(n.sections, out);
    });
    return out;
  }

  // ===== LOAD =====
  async function loadData() {
    // Try mobile first
    try {
      const mobile = await fetchJson(SOURCES.mobile);
      const root = normalizeToRootItems(mobile);
      if (root.length) {
        setStatus(`Loaded MOBILE ✅ (${root.length} root sections)`);
        return { rootItems: root, source: "mobile" };
      }
    } catch (_) {}

    // Fall back to kodi
    try {
      const kodi = await fetchJson(SOURCES.kodi);
      const root = normalizeToRootItems(kodi);
      if (root.length) {
        setStatus(`Loaded KODI ✅ (${root.length} items)`);
        return { rootItems: root, source: "kodi" };
      }
    } catch (_) {}

    // Fall back to embedded episodes.js
    const fallback = window.EPISODES || window.episodes;
    if (Array.isArray(fallback) && fallback.length) {
      setStatus(`Loaded fallback ⚠️ (${fallback.length} items)`);
      return { rootItems: fallback, source: "fallback" };
    }

    return { rootItems: [], source: "none" };
  }

  // ===== PLAY =====
  function playEpisode(ep) {
    if (!isEpisode(ep) || !ep.tracks.length) return;

    const mode = safeText(ep.mode).toLowerCase();
    const trackUrls = ep.tracks.map(t => t.url).filter(Boolean);

    if (el.nowTitle) el.nowTitle.textContent = ep.title || "Now Playing";
    if (el.nowLine) {
      const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`.trim();
      el.nowLine.textContent = meta ? `Playing now: ${meta}` : "Playing now";
    }

    ensurePlayerVisible();

    const watchUrl = buildWatchUrlFromEpisode(ep);
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
      setStatus(`Playlist loaded 🎟️ If it won’t play, tap "Open Playlist".`);
    }
  }

  function playSingleTrack(track) {
    if (!track || !track.url) return;
    const src = buildEmbedForSingle(track.url);
    if (!src) return;

    ensurePlayerVisible();
    if (el.playerFrame) el.playerFrame.src = src;

    const vid = getVideoId(track.url);
    setWatchOnTv(vid ? `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}` : "", "Watch on YouTube");

    if (el.nowTitle) el.nowTitle.textContent = track.title || "Track";
    if (el.nowLine) el.nowLine.textContent = "Playing single track";
  }

  // ===== UI BUILDERS =====
  function clearList() {
    if (el.episodes) el.episodes.innerHTML = "";
    shownCount = 0;
  }

  function updateLoadMoreUI(itemsLength) {
    if (!el.loadMoreBtn) return;
    const done = shownCount >= itemsLength;
    el.loadMoreBtn.style.display = (itemsLength > PAGE_SIZE) ? "block" : "none";
    el.loadMoreBtn.disabled = done;
    el.loadMoreBtn.textContent = done ? "All loaded" : "Load more";
  }

  function countEpisodesIn(node) {
    if (isEpisode(node)) return 1;
    if (isFolder(node)) return flattenEpisodes(node.items, []).length;
    return 0;
  }

  function buildFolderCard(folder) {
    const div = document.createElement("div");
    div.className = "ep";
    div.tabIndex = 0;

    const title = safeText(folder.title) || "Folder";
    const count = countEpisodesIn(folder);
    const subtitle = folder.subtitle ? safeText(folder.subtitle) : `${count} items`;

    div.innerHTML = `
      <div class="epHead">
        <div style="min-width:0">
          <div class="epTitle">${title}</div>
          <div class="epMeta">${subtitle}</div>
          <div class="epSmall">folder</div>
        </div>
        <div class="chev">›</div>
      </div>
    `;

    const open = () => openFolder(title, folder.items || []);
    div.addEventListener("click", open);
    div.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });

    return div;
  }

  function buildEpisodeCard(ep) {
    const div = document.createElement("div");
    div.className = "ep";
    div.tabIndex = 0;

    const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`.trim();
    const m = safeText(ep.mode).toLowerCase();

    const small =
      (m === "queue")
        ? `${(ep.tracks || []).length} tracks • tap to choose`
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

    const open = () => {
      // ✅ If queue, open track picker instead of auto-playing
      if (safeText(ep.mode).toLowerCase() === "queue") {
        openQueueTracks(ep);
      } else {
        playEpisode(ep);
      }
    };

    div.addEventListener("click", open);
    div.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });

    return div;
  }

  function buildTrackCard(track, idx) {
    const div = document.createElement("div");
    div.className = "ep";
    div.tabIndex = 0;

    div.innerHTML = `
      <div class="epHead">
        <div style="min-width:0">
          <div class="epTitle">${idx + 1}. ${safeText(track.title) || "Track"}</div>
          <div class="epMeta">single track</div>
          <div class="epSmall">tap to play</div>
        </div>
        <div class="chev">›</div>
      </div>
    `;

    const play = () => playSingleTrack(track);
    div.addEventListener("click", play);
    div.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(); }
    });

    return div;
  }

  // ===== NAVIGATION =====
  function openFolder(title, items) {
    NAV.push({ title, items, type: "folder" });
    renderCurrent();
  }

  function goBack() {
    NAV.pop();
    renderCurrent();
  }

  function openQueueTracks(ep) {
    const title = safeText(ep.title) || "Queue";
    NAV.push({ title, items: ep.tracks || [], type: "tracks", episode: ep });
    renderCurrent();
  }

  // ===== RENDER =====
  function renderHeaderContext() {
    // If your HTML already has a "Back to home" button, this will wire it.
    const backBtn = document.getElementById("backBtn");
    if (backBtn) {
      backBtn.style.display = NAV.length ? "inline-flex" : "none";
      backBtn.onclick = NAV.length ? goBack : null;
    }
  }

  function renderBatch(items) {
    if (!el.episodes) return;

    const next = items.slice(shownCount, shownCount + PAGE_SIZE);
    next.forEach(n => {
      if (isFolder(n)) el.episodes.appendChild(buildFolderCard(n));
      else if (isEpisode(n)) el.episodes.appendChild(buildEpisodeCard(n));
      // tracks view is handled separately
    });

    shownCount += next.length;
    updateLoadMoreUI(items.length);
    setStatus(`Showing ${Math.min(shownCount, items.length)} of ${items.length}`);
  }

  function renderTracks(tracks, epTitle) {
    clearList();

    // top action row: Play All (stitched)
    if (el.playAllBtn) {
      el.playAllBtn.textContent = "Play All";
      el.playAllBtn.onclick = () => {
        const urls = (tracks || []).map(t => t.url).filter(Boolean);
        const src = buildEmbedForQueue(urls);
        if (!src) return;

        if (el.nowTitle) el.nowTitle.textContent = epTitle || "Queue";
        if (el.nowLine) el.nowLine.textContent = "Playing full queue (stitched).";

        ensurePlayerVisible();
        if (el.playerFrame) el.playerFrame.src = src;

        const firstId = getVideoId(urls[0] || "");
        setWatchOnTv(firstId ? `https://www.youtube.com/watch?v=${encodeURIComponent(firstId)}` : "", "Watch on YouTube");
      };
    }

    // list tracks
    (tracks || []).forEach((t, i) => {
      el.episodes.appendChild(buildTrackCard(t, i));
    });

    if (el.loadMoreBtn) el.loadMoreBtn.style.display = "none";
    setStatus(`${tracks.length} tracks • pick one or hit Play All`);
  }

  function currentItems() {
    if (!NAV.length) return { type: "root", title: "Home", items: ROOT_ITEMS };
    return NAV[NAV.length - 1];
  }

  function renderCurrent() {
    renderHeaderContext();
    clearList();

    const cur = currentItems();

    // Back button label updates (optional)
    const homeLabel = document.getElementById("homeLabel");
    if (homeLabel) homeLabel.textContent = cur.title || "Joey’s Acoustic Corner";

    // Tracks view
    if (cur.type === "tracks") {
      renderTracks(cur.items || [], cur.title);
      return;
    }

    // Folder/root view
    const items = cur.items || [];
    if (el.playAllBtn) {
      // Play All from flattened episodes in THIS folder/root
      el.playAllBtn.textContent = "Play All";
      el.playAllBtn.onclick = () => {
        const eps = flattenEpisodes(items, []);
        const urls = [];
        eps.forEach(ep => {
          const m = safeText(ep.mode).toLowerCase();
          if (m === "playlist") return;
          (ep.tracks || []).forEach(t => { if (t && t.url) urls.push(t.url); });
        });

        const src = buildEmbedForQueue(urls);
        if (!src) { setStatus("Nothing playable for Play All"); return; }

        if (el.nowTitle) el.nowTitle.textContent = "Play All";
        if (el.nowLine) el.nowLine.textContent = `Playing all in: ${cur.title || "Home"}`;

        ensurePlayerVisible();
        if (el.playerFrame) el.playerFrame.src = src;

        const firstId = getVideoId(urls[0] || "");
        setWatchOnTv(firstId ? `https://www.youtube.com/watch?v=${encodeURIComponent(firstId)}` : "", "Watch on YouTube");
      };
    }

    renderBatch(items);
  }

  // ===== INIT =====
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

  async function init() {
    setStatus("Loading…");

    const { rootItems, source } = await loadData();

    if (!rootItems.length) {
      setStatus("No data found (mobile + kodi + fallback all failed)");
      return;
    }

    ROOT_ITEMS = rootItems;
    FLAT_CACHE = flattenEpisodes(rootItems, []);

    // Load more button
    if (el.loadMoreBtn) {
      el.loadMoreBtn.onclick = () => renderBatch(currentItems().items || []);
    }

    // If your HTML has a "Back to home" button, wire it.
    const backBtn = document.getElementById("backBtn");
    if (backBtn) backBtn.onclick = goBack;

    // Start at root
    NAV.length = 0;
    renderCurrent();

    // FYI debug
    console.log("[JAC] Source:", source);
    console.log("[JAC] Root items:", ROOT_ITEMS.length);
    console.log("[JAC] Flattened episodes:", FLAT_CACHE.length);
  }

  document.addEventListener("DOMContentLoaded", () => {
    initPlayerToggle();
    init();
  });
})();
