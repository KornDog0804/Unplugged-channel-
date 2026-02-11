/* Joey’s Acoustic Corner — app.js
   Queue behavior: does NOT skip first song ✅
   Brad-only TRUE Encore:
     Track 1 -> Track 2 -> Track 3 -> BLACKOUT -> Ticket to Heaven -> lights up ✅

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

  // --- YouTube IFrame API (used ONLY for Brad Encore episode) ---
  let ytReady = false;
  let ytPlayer = null;
  let ytApiLoading = false;

  // Brad manual-queue context:
  // { enabled, ids, step, encoreId, encoreAfterIndex, blackoutMs, lightsUpMs }
  let bradCtx = null;

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

  // ✅ No-skip-first-song queue embed (non-Brad)
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

  // ===== Brad TRUE Encore engine (manual queue) =====
  function startBradShow(trackIds, encoreId, encoreAfterIndex) {
    bradCtx = {
      enabled: true,
      ids: trackIds,
      step: 0, // 0..(encoreAfterIndex) then encore
      encoreId,
      encoreAfterIndex,
      blackoutMs: 2200,
      lightsUpMs: 1400
    };

    showEncoreBlackout(false);

    // start Track 1
    try {
      ytPlayer.loadVideoById(trackIds[0]);
      bradCtx.step = 0;
    } catch (_) {
      setStatus("Brad Encore player failed to start");
    }
  }

  function onYTStateChange(e) {
    if (!ytPlayer) return;

    // only intercept when Brad mode is active
    if (!bradCtx || !bradCtx.enabled) return;

    if (e.data === YT.PlayerState.ENDED) {
      // If we just ended Track 1 or 2, play next track immediately
      if (bradCtx.step < bradCtx.encoreAfterIndex) {
        bradCtx.step += 1;
        const nextId = bradCtx.ids[bradCtx.step];
        if (nextId) {
          try { ytPlayer.loadVideoById(nextId); } catch (_) {}
        }
        return;
      }

      // If we just ended Track 3 -> TRUE encore moment
      if (bradCtx.step === bradCtx.encoreAfterIndex) {
        bradCtx.step += 1; // move past main set so we don't re-trigger

        // HARD STOP so nothing auto-advances (this is the key fix)
        try { ytPlayer.stopVideo(); } catch (_) {}

        showEncoreBlackout(true, "🕯️ Lights out…");
        if (el.nowLine) el.nowLine.textContent = "🕯️ Lights out…";

        setTimeout(() => {
          try { ytPlayer.loadVideoById(bradCtx.encoreId); } catch (_) {}
          setTimeout(() => {
            showEncoreBlackout(false);
            if (el.nowLine) el.nowLine.textContent = "Encore for Brad 🕯️ — Ticket to Heaven";
          }, bradCtx.lightsUpMs);
        }, bradCtx.blackoutMs);

        return;
      }

      // Encore ended — done
      bradCtx.enabled = false;
    }
  }

  // ===== Core play =====
  function playEpisode(ep) {
    if (!ep || !ep.tracks || !ep.tracks.length) return;

    const mode = safeText(ep.mode).toLowerCase();
    const trackUrls = ep.tracks.map(t => t.url).filter(Boolean);

    // reset special modes
    bradCtx = null;
    showEncoreBlackout(false);

    // Update UI
    if (el.nowTitle) el.nowTitle.textContent = ep.title || "Now Playing";
    if (el.nowLine) {
      const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`.trim();
      el.nowLine.textContent = `Playing now: ${meta}`.trim();
    }

    setWatchOnTv(buildWatchUrl(ep));
    ensurePlayerVisible();
    highlightActive(ep);

    // ===== Brad TRUE Encore path (YT API manual queue) =====
    const hasEncore =
      mode === "queue" &&
      ep.encore &&
      ep.encore.url &&
      Number.isInteger(ep.encoreAfterTrackIndex);

    if (hasEncore) {
      loadYTApiIfNeeded();
      tryInitYTPlayer();

      const ids = trackUrls.map(getVideoId).filter(Boolean);
      const encoreId = getVideoId(ep.encore.url);

      if (ytPlayer && ids.length && encoreId) {
        // Only play main set up through track 3 as “the set”
        // (If you ever add more tracks to this episode later, it still won’t auto-run them.)
        const mainSet = ids.slice(0, ep.encoreAfterTrackIndex + 1);

        setStatus("Brad Tribute mode 🕯️ (true encore armed)");
        startBradShow(mainSet, encoreId, ep.encoreAfterTrackIndex);
        return;
      }
      // fallback if API not ready:
      setStatus("Encore needs YouTube API — falling back");
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

      bradCtx = null;
      showEncoreBlackout(false);

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
