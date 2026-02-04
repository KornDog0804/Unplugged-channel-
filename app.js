/* Joey’s Acoustic Corner — app.js (FIXED v2)
   Crash-proof renderer + stitched queue autoplay (no YT API)
   ✅ Fix: Watch on TV opens correctly on Shield/Android TV
   ✅ Fix: Stitched queues no longer skip the first song (include first ID in playlist param)
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
    watchTvBtn: $("#watchOnTvBtn")
  };

  let currentExternalUrl = "";

  function setStatus(msg) {
    if (el.status) el.status.textContent = msg;
  }

  function safeText(v) {
    return (v === undefined || v === null) ? "" : String(v);
  }

  function ua() {
    return navigator.userAgent || "";
  }

  function isAndroid() {
    return /Android/i.test(ua());
  }

  function isOculus() {
    return /OculusBrowser/i.test(ua());
  }

  function getVideoId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtu.be")) {
        return u.pathname.replace("/", "").trim();
      }
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

  // ✅ FIX: include FIRST id inside playlist param too, or TV browsers sometimes start on #2
  function buildEmbedForQueue(videoUrls) {
    const ids = videoUrls.map(getVideoId).filter(Boolean);
    if (!ids.length) return "";

    const first = ids[0];

    // IMPORTANT: playlist contains ALL ids (including first)
    // This prevents "skip first item" on some Android/TV browsers.
    const fullList = ids.join(",");

    return `https://www.youtube.com/embed/${first}?autoplay=1&rel=0&playsinline=1&modestbranding=1&playlist=${encodeURIComponent(fullList)}`;
  }

  function buildEmbedForPlaylist(playlistUrl) {
    const list = getPlaylistId(playlistUrl);
    if (!list) return "";
    return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}&autoplay=1&rel=0&playsinline=1&modestbranding=1`;
  }

  // ===== Watch on TV builders =====
  function ytWatchUrl(id) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  }

  function ytPlaylistUrl(listId) {
    return `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`;
  }

  function ytQueueWatchUrl(ids) {
    if (!ids || !ids.length) return "";
    const first = ids[0];
    const rest = ids.slice(1);
    if (!rest.length) return ytWatchUrl(first);
    return `https://www.youtube.com/watch?v=${encodeURIComponent(first)}&playlist=${encodeURIComponent(rest.join(","))}`;
  }

  function ytIntentUrl(httpUrl) {
    const safe = String(httpUrl || "").replace(/^https?:\/\//i, "");
    return `intent://${safe}#Intent;scheme=https;package=com.google.android.youtube;end`;
  }

  function setWatchOnTv(url) {
    currentExternalUrl = url || "";

    if (!el.watchTvBtn) return;

    if (!currentExternalUrl) {
      el.watchTvBtn.href = "#";
      el.watchTvBtn.style.opacity = ".6";
      el.watchTvBtn.style.pointerEvents = "none";
      return;
    }

    el.watchTvBtn.style.opacity = "1";
    el.watchTvBtn.style.pointerEvents = "auto";
    el.watchTvBtn.href = currentExternalUrl;
  }

  function openWatchOnTv() {
    if (!currentExternalUrl) return;

    const httpUrl = currentExternalUrl;

    if (!isAndroid() || isOculus()) {
      window.open(httpUrl, "_blank", "noopener");
      return;
    }

    try { window.location.href = ytIntentUrl(httpUrl); } catch (e) {}

    setTimeout(() => {
      try { window.location.href = httpUrl; } catch (e) {}
    }, 550);
  }

  function playEpisode(ep) {
    if (!ep || !ep.tracks || !ep.tracks.length) return;

    const mode = safeText(ep.mode).toLowerCase();
    const trackUrls = ep.tracks.map(t => t.url).filter(Boolean);

    let src = "";
    let external = "";

    if (mode === "queue") {
      src = buildEmbedForQueue(trackUrls);
      const ids = trackUrls.map(getVideoId).filter(Boolean);
      external = ytQueueWatchUrl(ids);
    } else if (mode === "playlist") {
      src = buildEmbedForPlaylist(trackUrls[0]);
      const listId = getPlaylistId(trackUrls[0]);
      external = listId ? ytPlaylistUrl(listId) : "";
    } else {
      src = buildEmbedForSingle(trackUrls[0]);
      const id = getVideoId(trackUrls[0]);
      external = id ? ytWatchUrl(id) : "";
    }

    if (!src) {
      setStatus("Bad link in this session");
      setWatchOnTv("");
      return;
    }

    if (el.nowTitle) el.nowTitle.textContent = ep.title || "Now Playing";
    if (el.nowLine) {
      const meta = `${ep.artist || ""}${ep.year ? " • " + ep.year : ""}`.trim();
      el.nowLine.textContent = meta ? `Playing now: ${meta}` : "Playing now.";
    }

    setWatchOnTv(external);

    document.body.classList.remove("playerCollapsed");
    if (el.toggleBtn) {
      el.toggleBtn.textContent = "Hide player";
      el.toggleBtn.setAttribute("aria-expanded", "true");
    }

    if (el.playerFrame) {
      el.playerFrame.src = src;
    }

    document.querySelectorAll(".ep").forEach(card => card.classList.remove("isActive"));
    const card = document.querySelector(`.ep[data-key="${CSS.escape(ep.__key)}"]`);
    if (card) card.classList.add("isActive");

    setStatus("Ready");
  }

  function buildCard(ep, idx) {
    const div = document.createElement("div");
    div.className = "ep";
    div.tabIndex = 0;

    ep.__key = `${idx}-${(ep.title || "").slice(0, 24)}`;
    div.dataset.key = ep.__key;

    const meta = `${safeText(ep.artist)}${ep.year ? " • " + safeText(ep.year) : ""}`;
    const mode = safeText(ep.mode).toLowerCase();

    const small = (mode === "queue")
      ? `${ep.tracks.length} tracks • stitched queue`
      : (mode === "playlist")
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
        setWatchOnTv("");
        return;
      }

      if (el.nowTitle) el.nowTitle.textContent = "Play All";
      if (el.nowLine) el.nowLine.textContent = "Playing all sessions (queues stitched where possible).";

      const ids = urls.map(getVideoId).filter(Boolean);
      setWatchOnTv(ytQueueWatchUrl(ids));

      document.body.classList.remove("playerCollapsed");
      if (el.toggleBtn) {
        el.toggleBtn.textContent = "Hide player";
        el.toggleBtn.setAttribute("aria-expanded", "true");
      }

      if (el.playerFrame) el.playerFrame.src = src;
      setStatus("Ready");
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

  function initWatchOnTv() {
    if (!el.watchTvBtn) return;

    el.watchTvBtn.addEventListener("click", (e) => {
      if (!currentExternalUrl) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      openWatchOnTv();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initPlayerToggle();
    initWatchOnTv();
    init();
  });
})();
