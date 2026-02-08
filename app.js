/* Joey’s Acoustic Corner — app.js
   Keeps your current queue behavior (no skipping first song)
   + Brad-only Encore after track 3 ends (ONLY if episode has encore fields)
*/

(function () {
  const PAGE_SIZE = 12;
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

  // --- YouTube IFrame API (only used for Encore episodes) ---
  let ytReady = false;
  let ytPlayer = null;

  // Tracks the one episode currently playing w/ encore
  let encoreContext = null; // { encoreVideoId, encoreAfterIndex, armed: true/false }

  window.onYouTubeIframeAPIReady = function () {
    ytReady = true;
    tryInitYTPlayer();
  };

  function tryInitYTPlayer() {
    if (!ytReady) return;
    if (!el.playerFrame) return;
    if (ytPlayer) return;

    // Turn existing iframe into a YT API player when needed
    // (It won’t do anything until we call loadPlaylist/loadVideoById)
    ytPlayer = new YT.Player("playerFrame", {
      events: {
        onStateChange: onYTStateChange
      }
    });
  }

  function onYTStateChange(e) {
    // Only care when we’re in a Brad-only encore flow
    if (!encoreContext || !encoreContext.armed) return;

    // 0 = ended
    if (e.data === YT.PlayerState.ENDED) {
      try {
        const idx = ytPlayer.getPlaylistIndex(); // current index in playlist
        if (idx === encoreContext.encoreAfterIndex) {
          // ✅ Play Brad’s encore exactly after track 3 ends
          encoreContext.armed = false;
          ytPlayer.loadVideoById(encoreContext.encoreVideoId);

          if (el.nowLine) {
            el.nowLine.textContent = "Encore for Brad 🕯️ — Ticket to Heaven";
          }
        }
      } catch (_) {}
    }
  }

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

  // --- Embed fallbacks (your current working method) ---
  function buildEmbedForSingle(videoUrl) {
    const id = getVideoId(videoUrl);
    if (!id) return "";
    const origin = encodeURIComponent(window.location.origin);
    return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1&modestbranding=1&origin=${origin}`;
  }

  // ✅ Your “no-skip-first-song” embed fix remains
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

  function setWatchOnTv(url) {
    if (!el.watchOnTvBtn) return;
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

  function playEpisode(ep) {
    if (!ep || !ep.tracks || !ep.tracks.length) return;

    const mode = safeText(ep.mode).toLowerCase();
    const trackUrls = ep.tracks.map(t => t.url).filter(Boolean);

    // Reset encore context every time
    encoreContext = null;

    // ✅ Brad-only Encore mode: ONLY if these fields exist
    const hasEncore =
      mode === "queue" &&
      ep.encore &&
      ep.encore.url &&
      Number.isInteger(ep.encoreAfterTrackIndex);

    // Update UI
    if (el.nowTitle) el.nowTitle.textContent = ep.title || "Now Playing";
    if (el.nowLine) {
      const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`.trim();
      el.nowLine.textContent = `Playing now: ${meta}`.trim();
    }

    setWatchOnTv(buildWatchUrl(ep));
    ensurePlayerVisible();

    // --- If Brad encore episode, use YT API so it triggers exactly after track 3 ends ---
    if (hasEncore) {
      tryInitYTPlayer();

      const ids = trackUrls.map(getVideoId).filter(Boolean);
      const encoreId = getVideoId(ep.encore.url);

      if (ytPlayer && ids.length && encoreId) {
        encoreContext = {
          encoreVideoId: encoreId,
          encoreAfterIndex: ep.encoreAfterTrackIndex,
          armed: true
        };

        // ✅ Start at first track, no skipping
        ytPlayer.loadPlaylist({ playlist: ids, index: 0 });

        // Highlight active
        document.querySelectorAll(".ep").forEach(card => card.classList.remove("isActive"));
        const card = document.querySelector(`.ep[data-key="${CSS.escape(ep.__key)}"]`);
        if (card) card.classList.add("isActive");

        setStatus(`Showing ${Math.min(shownCount, ALL.length)} of ${ALL.length}`);
        return;
      }
      // If API not available for any reason, fall through to embed
    }

    // --- Normal behavior (everyone else stays exactly how it works today) ---
    let src = "";
    if (mode === "queue") src = buildEmbedForQueue(trackUrls);
    else if (mode === "playlist") src = buildEmbedForPlaylist(trackUrls[0]);
    else src = buildEmbedForSingle(trackUrls[0]);

    if (!src) {
      setStatus("Bad link in this session");
      return;
    }

    if (el.playerFrame) el.playerFrame.src = src;

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

    const hasEncore = (m === "queue" && ep.encore && ep.encore.url && Number.isInteger(ep.encoreAfterTrackIndex));
    const encoreTag = hasEncore ? " • encore 🕯️" : "";

    const small =
      (m === "queue")
        ? `${(ep.tracks || []).length} tracks • stitched queue${encoreTag}`
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
      if (mode === "playlist") return;
      (ep.tracks || []).forEach(t => { if (t && t.url) urls.push(t.url); });
    });
    return urls;
  }

  function wirePlayAllButton(episodes) {
    const btn = document.getElementById("playAllBtn");
    if (!btn) return;

    btn.addEventListener("click", () => {
      // Play All stays your existing embed method (no encore mixing)
      const urls = flattenPlayAll(episodes).filter(Boolean);
      const src = buildEmbedForQueue(urls);

      if (!src) {
        setStatus("No playable items for Play All");
        return;
      }

      encoreContext = null;

      if (el.nowTitle) el.nowTitle.textContent = "Play All";
      if (el.nowLine) el.nowLine.textContent = "Playing all sessions (queues stitched where possible).";

      const firstId = getVideoId(urls[0] || "");
      setWatchOnTv(firstId ? `https://www.youtube.com/watch?v=${encodeURIComponent(firstId)}` : "");

      ensurePlayerVisible();
      if (el.playerFrame) el.playerFrame.src = src;

      setStatus(`Showing ${Math.min(shownCount, ALL.length)} of ${ALL.length}`);
    });
  }

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
        return;
      }

      ALL = episodes;
      shownCount = 0;

      if (el.episodes) el.episodes.innerHTML = "";

      wirePlayAllButton(ALL);

      if (el.loadMoreBtn) {
        el.loadMoreBtn.addEventListener("click", () => renderNextBatch());
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
