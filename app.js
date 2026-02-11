/* Joey’s Acoustic Corner — app.js (STABLE BUILD)
   ✅ Clicks + Load More work
   ✅ Queue: does NOT skip first song
   ✅ Playlist mode: tries to embed, and ALWAYS provides "Open Playlist" fallback
   ✅ Pulls from /episodes.json (cache-busted) fallback to episodes.js
*/

(function () {
  const PAGE_SIZE = 12;
  const MASTER_JSON = "/episodes.json";
  const $ = (sel) => document.querySelector(sel);

  const el = {
    status: $("#status"),
    episodes: $("#episodes"),
    playerFrame: $("#playerFrame"),
    nowTitle: $("#nowPlayingTitle"),
    nowLine: $("#nowPlayingLine"),
    toggleBtn: $("#playerToggleBtn"),
    watchOnTvBtn: $("#watchOnTvBtn"),
    loadMoreBtn: $("#loadMoreBtn")
  };

  let ALL = [];
  let shownCount = 0;

  // ===== Helpers =====
  function setStatus(msg) {
    if (el.status) el.status.textContent = msg || "";
  }

  function safeText(v) {
    return (v === undefined || v === null) ? "" : String(v);
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

  // ✅ Single video embed
  function buildEmbedForSingle(videoUrl) {
    const id = getVideoId(videoUrl);
    if (!id) return "";
    const origin = encodeURIComponent(window.location.origin);
    return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1&modestbranding=1&origin=${origin}`;
  }

  // ✅ No-skip-first-song queue embed (stitched playlist param)
  function buildEmbedForQueue(videoUrls) {
    const ids = videoUrls.map(getVideoId).filter(Boolean);
    if (!ids.length) return "";

    const first = ids[0];
    const origin = encodeURIComponent(window.location.origin);
    const playlistAll = encodeURIComponent(ids.join(","));

    return `https://www.youtube.com/embed/${first}?autoplay=1&rel=0&playsinline=1&modestbranding=1&origin=${origin}&playlist=${playlistAll}&index=0`;
  }

  // ✅ Playlist embed attempt (some playlists are blocked by YouTube in iframes)
  function buildEmbedForPlaylist(playlistUrl) {
    const list = getPlaylistId(playlistUrl);
    if (!list) return "";
    const origin = encodeURIComponent(window.location.origin);

    // Standard playlist embed:
    return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}&autoplay=1&rel=0&playsinline=1&modestbranding=1&origin=${origin}`;

    // If you ever want to try alternate style, we can swap to:
    // return `https://www.youtube.com/embed?listType=playlist&list=${encodeURIComponent(list)}&autoplay=1&rel=0&playsinline=1&modestbranding=1&origin=${origin}`;
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

  function highlightActive(ep) {
    document.querySelectorAll(".ep").forEach(card => card.classList.remove("isActive"));
    const card = document.querySelector(`.ep[data-key="${CSS.escape(ep.__key)}"]`);
    if (card) card.classList.add("isActive");
  }

  // ===== MASTER LOAD (JSON first, fallback to episodes.js) =====
  async function loadEpisodesMaster() {
    // cache-bust so Netlify/CDN doesn’t serve stale JSON
    const bust = `?v=${Date.now()}`;

    try {
      const r = await fetch(MASTER_JSON + bust, { cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data)) {
          setStatus(`Loaded master list ✅ (${data.length})`);
          return data;
        }
      }
    } catch (_) {}

    const fallback = window.EPISODES || window.episodes;
    if (Array.isArray(fallback)) {
      setStatus(`Loaded fallback list ⚠️ (${fallback.length})`);
      return fallback;
    }

    return null;
  }

  // ===== Core play =====
  function playEpisode(ep) {
    if (!ep || !ep.tracks || !ep.tracks.length) return;

    const mode = safeText(ep.mode).toLowerCase();
    const trackUrls = ep.tracks.map(t => t.url).filter(Boolean);

    // UI
    if (el.nowTitle) el.nowTitle.textContent = ep.title || "Now Playing";
    if (el.nowLine) {
      const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`.trim();
      el.nowLine.textContent = meta ? `Playing now: ${meta}` : "Playing now";
    }

    ensurePlayerVisible();
    highlightActive(ep);

    // Set the button:
    const watchUrl = buildWatchUrl(ep);
    setWatchOnTv(watchUrl, mode === "playlist" ? "Open Playlist" : "Watch on YouTube");

    // Make iframe more permissive for autoplay
    if (el.playerFrame) {
      el.playerFrame.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
      el.playerFrame.setAttribute("allowfullscreen", "true");
      el.playerFrame.style.opacity = "1";
      el.playerFrame.style.pointerEvents = "auto";
    }

    // Build player source
    let src = "";
    if (mode === "queue") src = buildEmbedForQueue(trackUrls);
    else if (mode === "playlist") src = buildEmbedForPlaylist(trackUrls[0]);
    else src = buildEmbedForSingle(trackUrls[0]);

    if (!src) {
      setStatus("Bad link in this session");
      return;
    }

    // Load
    if (el.playerFrame) el.playerFrame.src = src;

    // Playlist warning / help text
    if (mode === "playlist") {
      setStatus(
        `Playlist loaded 🎟️ If it won’t play in the app, tap "Open Playlist" (YouTube blocks some embeds).`
      );
    } else {
      setStatus(`Showing ${Math.min(shownCount, ALL.length)} of ${ALL.length}`);
    }
  }

  // ===== Cards =====
  function buildCard(ep, idx) {
    const div = document.createElement("div");
    div.className = "ep";
    div.tabIndex = 0;

    ep.__key = `${idx}-${(ep.title || "").slice(0, 24)}`;
    div.dataset.key = ep.__key;

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

    const activate = () => playEpisode(ep);
    div.addEventListener("click", activate);
    div.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });

    return div;
  }

  // ===== Play All =====
  function flattenPlayAll(list) {
    const urls = [];
    list.forEach(ep => {
      const mode = safeText(ep.mode).toLowerCase();
      if (mode === "playlist") return; // keep play-all stable
      (ep.tracks || []).forEach(t => { if (t && t.url) urls.push(t.url); });
    });
    return urls;
  }

  function wirePlayAllButton(episodes) {
    const btn = document.getElementById("playAllBtn");
    if (!btn) return;

    btn.addEventListener("click", () => {
      const urls = flattenPlayAll(episodes).filter(Boolean);
      const src = buildEmbedForQueue(urls);

      if (!src) {
        setStatus("No playable items for Play All");
        return;
      }

      if (el.nowTitle) el.nowTitle.textContent = "Play All";
      if (el.nowLine) el.nowLine.textContent = "Playing all sessions (queues stitched where possible).";

      const firstId = getVideoId(urls[0] || "");
      setWatchOnTv(firstId ? `https://www.youtube.com/watch?v=${encodeURIComponent(firstId)}` : "", "Watch on YouTube");

      ensurePlayerVisible();
      if (el.playerFrame) el.playerFrame.src = src;

      setStatus(`Showing ${Math.min(shownCount, ALL.length)} of ${ALL.length}`);
    });
  }

  // ===== Load More =====
  function updateLoadMoreUI() {
    if (!el.loadMoreBtn) return;
    const done = shownCount >= ALL.length;
    el.loadMoreBtn.style.display = (ALL.length > PAGE_SIZE) ? "block" : "none";
    el.loadMoreBtn.disabled = done;
    el.loadMoreBtn.textContent = done ? "All loaded" : "Load more";
  }

  function renderNextBatch() {
    if (!el.episodes) return;

    const next = ALL.slice(shownCount, shownCount + PAGE_SIZE);
    next.forEach((ep, i) => {
      const trueIndex = shownCount + i;
      el.episodes.appendChild(buildCard(ep, trueIndex));
    });

    shownCount += next.length;

    updateLoadMoreUI();
    setStatus(`Showing ${Math.min(shownCount, ALL.length)} of ${ALL.length}`);
  }

  async function init() {
    try {
      const episodes = await loadEpisodesMaster();

      if (!Array.isArray(episodes)) {
        setStatus("No episode list found (JSON + fallback failed)");
        return;
      }

      ALL = episodes;
      shownCount = 0;

      if (el.episodes) el.episodes.innerHTML = "";

      wirePlayAllButton(ALL);

      if (el.loadMoreBtn) {
        el.loadMoreBtn.addEventListener("click", renderNextBatch);
      }

      renderNextBatch();
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
