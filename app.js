/* Joey’s Acoustic Corner — app.js
   Queue behavior: does NOT skip first song ✅
   Brad-only Encore: Track 3 ends -> HARD STOP -> blackout -> Ticket to Heaven -> lights up ✅

   Site loads:
     /episodes.json  (fallback to episodes.js if JSON fails)
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

  // --- YouTube IFrame API (used ONLY for Encore episodes) ---
  let ytReady = false;
  let ytPlayer = null;
  let ytApiLoading = false;

  // Encore state: { encoreVideoId, encoreAfterIndex, armed, usingApi }
  let encoreContext = null;

  // ✅ critical: reliable “current track” tracking (YT index can be flaky on ENDED)
  let lastKnownPlaylistIndex = -1;

  // ===== Helpers =====
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
    const origin = encodeURIComponent(window.location.origin);
    return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1&modestbranding=1&origin=${origin}`;
  }

  // ✅ No-skip-first-song queue embed
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

  function highlightActive(ep) {
    document.querySelectorAll(".ep").forEach(card => card.classList.remove("isActive"));
    const card = document.querySelector(`.ep[data-key="${CSS.escape(ep.__key)}"]`);
    if (card) card.classList.add("isActive");
  }

  // ===== Encore Blackout Overlay (auto-created) =====
  function ensureEncoreOverlay() {
    // Inject CSS once
    if (!document.getElementById("encoreBlackoutCss")) {
      const css = document.createElement("style");
      css.id = "encoreBlackoutCss";
      css.textContent = `
        .encoreBlackout{
          position: fixed; inset: 0;
          background: #000;
          opacity: 0;
          pointer-events: none;
          transition: opacity 700ms ease;
          display:flex; align-items:center; justify-content:center;
          z-index: 999999;
        }
        .encoreBlackout.on{ opacity: 1; pointer-events: all; }
        .encoreBlackout .encoreText{
          font-size: 22px;
          letter-spacing: 1px;
          text-align:center;
          padding: 14px 18px;
          border-radius: 14px;
          background: rgba(0,0,0,0.35);
        }`;
      document.head.appendChild(css);
    }

    // Create overlay div once
    let b = document.getElementById("encoreBlackout");
    if (!b) {
      b = document.createElement("div");
      b.id = "encoreBlackout";
      b.className = "encoreBlackout";
      b.setAttribute("aria-hidden", "true");
      b.innerHTML = `<div class="encoreText">🕯️ Encore for Brad</div>`;
      document.body.appendChild(b);
    }
    return b;
  }

  function showEncoreBlackout(on, text) {
    const b = ensureEncoreOverlay();
    if (!b) return;
    const t = b.querySelector(".encoreText");
    if (t && text) t.textContent = text;
    b.classList.toggle("on", !!on);
    b.setAttribute("aria-hidden", on ? "false" : "true");
  }

  // ===== MASTER LOAD (JSON first, fallback to episodes.js) =====
  async function loadEpisodesMaster() {
    try {
      const r = await fetch(MASTER_JSON, { cache: "no-store" });
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

  // ===== YouTube API Loader (ONLY when needed) =====
  window.onYouTubeIframeAPIReady = function () {
    ytReady = true;
    tryInitYTPlayer();
  };

  function loadYTApiIfNeeded() {
    if (ytReady || ytApiLoading) return;
    ytApiLoading = true;

    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => { ytApiLoading = false; };
    document.head.appendChild(s);
  }

  function tryInitYTPlayer() {
    if (!ytReady) return;
    if (!el.playerFrame) return;
    if (ytPlayer) return;

    try { el.playerFrame.src = "about:blank"; } catch (_) {}

    ytPlayer = new YT.Player("playerFrame", {
      events: { onStateChange: onYTStateChange }
    });
  }

  // ✅ TRUE ENCORE: Track 3 end -> stop autoplay -> blackout -> encore -> lights up
  function onYTStateChange(e) {
    if (!ytPlayer) return;

    // Keep a reliable “what track are we on” value
    if (
      e.data === YT.PlayerState.PLAYING ||
      e.data === YT.PlayerState.BUFFERING ||
      e.data === YT.PlayerState.PAUSED
    ) {
      try {
        const idx = ytPlayer.getPlaylistIndex();
        if (Number.isInteger(idx) && idx >= 0) lastKnownPlaylistIndex = idx;
      } catch (_) {}
    }

    if (!encoreContext || !encoreContext.armed || !encoreContext.usingApi) return;

    // Track ended
    if (e.data === YT.PlayerState.ENDED) {
      const idx = lastKnownPlaylistIndex;

      // When Track 3 ends (index 2) -> TRUE encore moment
      if (idx === encoreContext.encoreAfterIndex) {
        encoreContext.armed = false;

        // HARD STOP prevents the “auto-advance flash”
        try { ytPlayer.stopVideo(); } catch (_) {}

        showEncoreBlackout(true, "🕯️ Lights out…");
        if (el.nowLine) el.nowLine.textContent = "🕯️ Lights out…";

        // Concert pause…
        setTimeout(() => {
          try { ytPlayer.loadVideoById(encoreContext.encoreVideoId); } catch (_) {}

          // Hold blackout for a beat so it feels intentional
          setTimeout(() => {
            showEncoreBlackout(false);
            if (el.nowLine) el.nowLine.textContent = "Encore for Brad 🕯️ — Ticket to Heaven";
          }, 1400);

        }, 2200);
      }
    }
  }

  // ===== Core play =====
  function playEpisode(ep) {
    if (!ep || !ep.tracks || !ep.tracks.length) return;

    const mode = safeText(ep.mode).toLowerCase();
    const trackUrls = ep.tracks.map(t => t.url).filter(Boolean);

    // Reset encore context every time
    encoreContext = null;
    showEncoreBlackout(false);
    lastKnownPlaylistIndex = -1;

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
    highlightActive(ep);

    // ===== Brad-only Encore path (YT API) =====
    if (hasEncore) {
      loadYTApiIfNeeded();
      tryInitYTPlayer();

      const ids = trackUrls.map(getVideoId).filter(Boolean);
      const encoreId = getVideoId(ep.encore.url);

      if (ytPlayer && ids.length && encoreId) {
        encoreContext = {
          encoreVideoId: encoreId,
          encoreAfterIndex: ep.encoreAfterTrackIndex, // should be 2
          armed: true,
          usingApi: true
        };

        lastKnownPlaylistIndex = 0;

        try {
          ytPlayer.loadPlaylist(ids, 0, 0); // start at track 0 ✅
          setStatus(`Showing ${Math.min(shownCount, ALL.length)} of ${ALL.length}`);
          return;
        } catch (_) {}
      }
      // fall back to embed if API not ready
    }

    // ===== Normal behavior (embed) =====
    let src = "";
    if (mode === "queue") src = buildEmbedForQueue(trackUrls);
    else if (mode === "playlist") src = buildEmbedForPlaylist(trackUrls[0]);
    else src = buildEmbedForSingle(trackUrls[0]);

    if (!src) {
      setStatus("Bad link in this session");
      return;
    }

    if (el.playerFrame) el.playerFrame.src = src;
    setStatus(`Showing ${Math.min(shownCount, ALL.length)} of ${ALL.length}`);
  }

  // ===== Cards =====
  function buildCard(ep, idx) {
    const div = document.createElement("div");
    div.className = "ep";
    div.tabIndex = 0;

    ep.__key = `${idx}-${(ep.title || "").slice(0, 24)}`;
    div.dataset.key = ep.__key;

    const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`;
    const m = safeText(ep.mode).toLowerCase();

    const hasEncore =
      (m === "queue" && ep.encore && ep.encore.url && Number.isInteger(ep.encoreAfterTrackIndex));
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

  // ===== Play All =====
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
      const urls = flattenPlayAll(episodes).filter(Boolean);
      const src = buildEmbedForQueue(urls);

      if (!src) {
        setStatus("No playable items for Play All");
        return;
      }

      encoreContext = null;
      showEncoreBlackout(false);
      lastKnownPlaylistIndex = -1;

      if (el.nowTitle) el.nowTitle.textContent = "Play All";
      if (el.nowLine) el.nowLine.textContent = "Playing all sessions (queues stitched where possible).";

      const firstId = getVideoId(urls[0] || "");
      setWatchOnTv(firstId ? `https://www.youtube.com/watch?v=${encodeURIComponent(firstId)}` : "");

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
