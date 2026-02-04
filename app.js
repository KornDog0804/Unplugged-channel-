/* Joey’s Acoustic Corner — app.js
   Crash-proof renderer + stitched queue autoplay (no YT API)
   + Watch on TV opens YouTube app (Cast lives there)
*/

(function () {
  const $ = (sel) => document.querySelector(sel);

  const el = {
    status: $("#status"),
    episodes: $("#episodes"),
    playerFrame: $("#playerFrame"),
    nowTitle: $("#nowPlayingTitle"),
    nowLine: $("#nowPlayingLine"),
    toggleBtn: $("#playerToggleBtn"),
    watchOnTvBtn: $("#watchOnTvBtn")
  };

  function setStatus(msg) {
    if (el.status) el.status.textContent = msg;
  }

  function safeText(v) {
    return (v === undefined || v === null) ? "" : String(v);
  }

  function getVideoId(url) {
    try {
      const u = new URL(url);

      // youtu.be/<id>
      if (u.hostname.includes("youtu.be")) {
        return u.pathname.replace("/", "").trim();
      }

      // youtube.com/watch?v=<id>
      if (u.searchParams.get("v")) return u.searchParams.get("v");

      // youtube.com/embed/<id>
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

  // --- EMBEDS ---

  function buildEmbedForSingle(videoUrl) {
    const id = getVideoId(videoUrl);
    if (!id) return "";
    return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1&modestbranding=1`;
  }

  // IMPORTANT:
  // Some devices act like the first video is "preload" and skip it when playlist= excludes it.
  // So we include ALL ids in playlist= (including the first) for reliable “first song starts”.
  function buildEmbedForQueue(videoUrls) {
    const ids = videoUrls.map(getVideoId).filter(Boolean);
    if (!ids.length) return "";

    const first = ids[0];
    const playlistAll = ids.join(",");

    return `https://www.youtube.com/embed/${first}?autoplay=1&rel=0&playsinline=1&modestbranding=1&playlist=${encodeURIComponent(playlistAll)}`;
  }

  function buildEmbedForPlaylist(playlistUrl) {
    const list = getPlaylistId(playlistUrl);
    if (!list) return "";
    return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}&autoplay=1&rel=0&playsinline=1&modestbranding=1`;
  }

  // --- WATCH ON TV (CAST) ---
  // Cast icon is unreliable inside iframe. This opens YouTube app where casting works.
  function setWatchOnTvFromFirstUrl(url) {
    if (!el.watchOnTvBtn) return;

    const id = getVideoId(url || "");
    if (!id) {
      el.watchOnTvBtn.style.display = "none";
      el.watchOnTvBtn.href = "#";
      el.watchOnTvBtn.dataset.fallback = "";
      return;
    }

    // Android YouTube app deep-link
    const appIntent = `intent://www.youtube.com/watch?v=${id}#Intent;scheme=https;package=com.google.android.youtube;end`;
    const webUrl = `https://www.youtube.com/watch?v=${id}`;

    el.watchOnTvBtn.style.display = "inline-flex";
    el.watchOnTvBtn.href = appIntent;
    el.watchOnTvBtn.dataset.fallback = webUrl;
  }

  function highlightActive(ep) {
    document.querySelectorAll(".ep").forEach(card => card.classList.remove("isActive"));
    const card = document.querySelector(`.ep[data-key="${CSS.escape(ep.__key)}"]`);
    if (card) card.classList.add("isActive");
  }

  function ensurePlayerShown() {
    document.body.classList.remove("playerCollapsed");
    if (el.toggleBtn) {
      el.toggleBtn.textContent = "Hide player";
      el.toggleBtn.setAttribute("aria-expanded", "true");
    }
  }

  function playEpisode(ep) {
    if (!ep || !ep.tracks || !ep.tracks.length) return;

    const mode = safeText(ep.mode).toLowerCase();
    const trackUrls = ep.tracks.map(t => (t && t.url) ? t.url : "").filter(Boolean);

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

    const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`.trim();
    if (el.nowLine) el.nowLine.textContent = meta ? `Playing now: ${meta}` : "Playing now.";

    // Watch on TV: first playable URL
    setWatchOnTvFromFirstUrl(trackUrls[0]);

    ensurePlayerShown();

    // Set player
    if (el.playerFrame) el.playerFrame.src = src;

    highlightActive(ep);

    setStatus("Ready");
  }

  function buildCard(ep, idx) {
    const div = document.createElement("div");
    div.className = "ep";
    div.tabIndex = 0;

    ep.__key = `${idx}-${(ep.title || "").slice(0, 24)}`;
    div.dataset.key = ep.__key;

    const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`;
    const m = safeText(ep.mode).toLowerCase();

    const small = (m === "queue")
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
      if (mode === "playlist") return; // can't safely merge playlists
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

      setWatchOnTvFromFirstUrl(urls[0]);

      ensurePlayerShown();

      if (el.playerFrame) el.playerFrame.src = src;
      setStatus("Ready");
    });
  }

  function initPlayerToggle() {
    if (!el.toggleBtn) return;

    function setCollapsed(isCollapsed) {
      document.body.classList.toggle("playerCollapsed", isCollapsed);
      el.toggleBtn.textContent = isCollapsed ? "Show player" : "Hide player";
      el.toggleBtn.setAttribute("aria-expanded", String(!isCollapsed));
    }

    // Start collapsed so it never blocks the list
    setCollapsed(true);

    el.toggleBtn.addEventListener("click", () => {
      setCollapsed(!document.body.classList.contains("playerCollapsed"));
    });
  }

  function initWatchOnTvFallback() {
    if (!el.watchOnTvBtn) return;

    // If intent:// is blocked, fall back to web watch URL
    el.watchOnTvBtn.addEventListener("click", () => {
      const fb = el.watchOnTvBtn.dataset.fallback || "";
      if (!fb) return;

      setTimeout(() => {
        // If the app didn't open, user stays here and this will fire.
        window.location.href = fb;
      }, 450);
    });
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

      if (!el.episodes) return;

      el.episodes.innerHTML = "";
      episodes.forEach((ep, idx) => el.episodes.appendChild(buildCard(ep, idx)));

      wirePlayAllButton(episodes);

      setStatus(`${episodes.length} sessions`);
    } catch (err) {
      setStatus("App crashed");
      console.error(err);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initPlayerToggle();
    initWatchOnTvFallback();
    init();
  });
})();
