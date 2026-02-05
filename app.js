/* Joey’s Acoustic Corner — app.js
   Crash-proof renderer + stitched queue autoplay (no YT API)
   + Load More pagination (no endless-scroll doom list)
*/

(function () {
  const PAGE_SIZE = 12; // change to 15/20 if you want

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
  let lastWatchUrl = ""; // what Watch on TV should open

  function setStatus(msg) {
    if (el.status) el.status.textContent = msg;
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
    } catch (e) {
      return "";
    }
  }

  function getPlaylistId(url) {
    try {
      const u = new URL(url);
      return u.searchParams.get("list") || "";
    } catch (e) {
      return "";
    }
  }

  function buildEmbedForSingle(videoUrl) {
    const id = getVideoId(videoUrl);
    if (!id) return "";
    return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1&modestbranding=1`;
  }

  function buildEmbedForQueue(videoUrls) {
    const ids = videoUrls.map(getVideoId).filter(Boolean);
    if (!ids.length) return "";
    const first = ids[0];
    const rest = ids.slice(1);
    const playlistParam = rest.length ? `&playlist=${encodeURIComponent(rest.join(","))}` : "";
    return `https://www.youtube.com/embed/${first}?autoplay=1&rel=0&playsinline=1&modestbranding=1${playlistParam}`;
  }

  function buildEmbedForPlaylist(playlistUrl) {
    const list = getPlaylistId(playlistUrl);
    if (!list) return "";
    return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}&autoplay=1&rel=0&playsinline=1&modestbranding=1`;
  }

  // A clean "Watch on TV" URL (opens normal youtube watch page, not embed)
  function buildWatchUrl(ep) {
    if (!ep || !ep.tracks || !ep.tracks.length) return "";

    const mode = safeText(ep.mode).toLowerCase();
    const trackUrls = ep.tracks.map(t => t.url).filter(Boolean);

    if (mode === "playlist") {
      const list = getPlaylistId(trackUrls[0] || "");
      if (!list) return "";
      return `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`;
    }

    // fullshow or queue -> open first video as a normal watch page
    const firstId = getVideoId(trackUrls[0] || "");
    if (!firstId) return "";
    return `https://www.youtube.com/watch?v=${encodeURIComponent(firstId)}`;
  }

  function setWatchOnTv(url) {
    lastWatchUrl = url || "";
    if (!el.watchOnTvBtn) return;
    el.watchOnTvBtn.href = lastWatchUrl || "#";
    el.watchOnTvBtn.style.opacity = lastWatchUrl ? "1" : "0.6";
    el.watchOnTvBtn.style.pointerEvents = lastWatchUrl ? "auto" : "none";
    if (!lastWatchUrl) el.watchOnTvBtn.setAttribute("aria-disabled", "true");
    else el.watchOnTvBtn.removeAttribute("aria-disabled");
  }

  function ensurePlayerVisible() {
    document.body.classList.remove("playerCollapsed");
    if (el.toggleBtn) {
      el.toggleBtn.textContent = "Hide player";
      el.toggleBtn.setAttribute("aria-expanded", "true");
    }
  }

  function playEpisode(ep) {
    if (!ep || !ep.tracks || !ep.tracks.length) return;

    const mode = safeText(ep.mode).toLowerCase();
    const trackUrls = ep.tracks.map(t => t.url).filter(Boolean);

    let src = "";
    if (mode === "queue") {
      src = buildEmbedForQueue(trackUrls);
    } else if (mode === "playlist") {
      src = buildEmbedForPlaylist(trackUrls[0]);
    } else {
      src = buildEmbedForSingle(trackUrls[0]);
    }

    if (!src) {
      setStatus("Bad link in this session");
      return;
    }

    // Update UI
    if (el.nowTitle) el.nowTitle.textContent = ep.title || "Now Playing";
    if (el.nowLine) {
      const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`.trim();
      el.nowLine.textContent = `Playing now: ${meta}`.trim();
    }

    // Watch on TV
    setWatchOnTv(buildWatchUrl(ep));

    // Make sure player is visible when you pick a session
    ensurePlayerVisible();

    // Set player
    if (el.playerFrame) el.playerFrame.src = src;

    // Highlight active
    document.querySelectorAll(".ep").forEach(card => card.classList.remove("isActive"));
    const card = document.querySelector(`.ep[data-key="${CSS.escape(ep.__key)}"]`);
    if (card) card.classList.add("isActive");

    setStatus(`Showing ${Math.min(shownCount, ALL.length)} of ${ALL.length}`);
  }

  function buildCard(ep, idx) {
    const div = document.createElement("div");
    div.className = "ep";
    div.tabIndex = 0;

    ep.__key = `${idx}-${(ep.title || "").slice(0, 24)}`;
    div.dataset.key = ep.__key;

    const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`;
    const m = safeText(ep.mode).toLowerCase();
    const small =
      (m === "queue")
        ? `${(ep.tracks || []).length} tracks • stitched queue`
        : (m === "playlist")
          ? `playlist`
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

  function flattenPlayAll(list) {
    const urls = [];
    list.forEach(ep => {
      const mode = safeText(ep.mode).toLowerCase();
      if (mode === "playlist") return; // skip playlists for mega queue
      (ep.tracks || []).forEach(t => {
        if (t && t.url) urls.push(t.url);
      });
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

      // Watch on TV: open the first playable item as normal YouTube watch
      const firstId = getVideoId(urls[0] || "");
      setWatchOnTv(firstId ? `https://www.youtube.com/watch?v=${encodeURIComponent(firstId)}` : "");

      ensurePlayerVisible();
      if (el.playerFrame) el.playerFrame.src = src;

      setStatus(`Showing ${Math.min(shownCount, ALL.length)} of ${ALL.length}`);
    });
  }

  // NEW: Load More rendering
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

  function init() {
    try {
      const episodes = window.EPISODES || window.episodes;

      if (!Array.isArray(episodes)) {
        setStatus("episodes.js not loaded");
        if (el.episodes) {
          el.episodes.innerHTML = `
            <div class="ep" style="cursor:default;">
              <div class="epTitle">No sessions found</div>
              <div class="epMeta">episodes.js didn’t load or EPISODES wasn’t defined.</div>
              <div class="epSmall">Check that sessions.html includes <b>./data/episodes.js</b> before app.js</div>
            </div>
          `;
        }
        return;
      }

      ALL = episodes;
      shownCount = 0;

      if (el.episodes) el.episodes.innerHTML = "";

      // Wire buttons once
      wirePlayAllButton(ALL);

      if (el.loadMoreBtn) {
        el.loadMoreBtn.addEventListener("click", () => renderNextBatch());
      }

      // Start with first page
      renderNextBatch();

      // Default Watch on TV disabled until something plays
      setWatchOnTv("");
    } catch (err) {
      setStatus("App crashed");
      console.error(err);
    }
  }

  // Player collapse toggle (safe)
  function initPlayerToggle() {
    if (!el.toggleBtn) return;

    function setCollapsed(isCollapsed) {
      document.body.classList.toggle("playerCollapsed", isCollapsed);
      el.toggleBtn.textContent = isCollapsed ? "Show player" : "Hide player";
      el.toggleBtn.setAttribute("aria-expanded", String(!isCollapsed));
    }

    // Start collapsed so it doesn’t block the list
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
