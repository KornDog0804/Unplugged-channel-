/* Joey’s Acoustic Corner — app.js
   Pulls from /episodes.json via Netlify (GitHub deploy)
   Queue: no skip first song
   Brad Tribute: TRUE Encore (manual queue)
   Playlist auto-detect (Monster Jam works)
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

  let ytReady = false;
  let ytPlayer = null;
  let ytApiLoading = false;
  let bradCtx = null;

  /* =============================
     Helpers
  ============================= */

  function setStatus(msg) {
    if (el.status) el.status.textContent = msg;
  }

  function safeText(v) {
    return (v === undefined || v === null) ? "" : String(v);
  }

  function getVideoId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtu.be"))
        return u.pathname.replace("/", "").trim();
      if (u.searchParams.get("v"))
        return u.searchParams.get("v");
      return "";
    } catch {
      return "";
    }
  }

  function getPlaylistId(url) {
    try {
      const u = new URL(url);
      return u.searchParams.get("list") || "";
    } catch {
      return "";
    }
  }

  function buildEmbedSingle(url) {
    const id = getVideoId(url);
    if (!id) return "";
    return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1&modestbranding=1`;
  }

  function buildEmbedQueue(urls) {
    const ids = urls.map(getVideoId).filter(Boolean);
    if (!ids.length) return "";
    const first = ids[0];
    return `https://www.youtube.com/embed/${first}?autoplay=1&playlist=${ids.join(",")}&index=0`;
  }

  function buildEmbedPlaylist(url) {
    const list = getPlaylistId(url);
    if (!list) return "";
    return `https://www.youtube.com/embed/videoseries?list=${list}&autoplay=1`;
  }

  function buildWatchUrl(ep) {
    const url = (ep.tracks[0] || {}).url || "";
    const list = getPlaylistId(url);
    if (list) return `https://www.youtube.com/playlist?list=${list}`;
    const id = getVideoId(url);
    return id ? `https://www.youtube.com/watch?v=${id}` : "";
  }

  function setWatchOnTv(url) {
    if (!el.watchOnTvBtn) return;
    el.watchOnTvBtn.href = url || "#";
    el.watchOnTvBtn.style.opacity = url ? "1" : "0.5";
  }

  function ensurePlayerVisible() {
    document.body.classList.remove("playerCollapsed");
    if (el.toggleBtn) el.toggleBtn.textContent = "Hide player";
  }

  /* =============================
     Brad Encore Overlay
  ============================= */

  function ensureBlackout() {
    if (!document.getElementById("encoreCss")) {
      const style = document.createElement("style");
      style.id = "encoreCss";
      style.innerHTML = `
        .encoreBlackout{
          position:fixed; inset:0;
          background:#000;
          opacity:0;
          transition:opacity .7s;
          display:flex; align-items:center; justify-content:center;
          z-index:999999;
        }
        .encoreBlackout.on{ opacity:1; }
        .encoreText{
          color:#fff; font-size:24px;
        }`;
      document.head.appendChild(style);
    }

    let div = document.getElementById("encoreBlackout");
    if (!div) {
      div = document.createElement("div");
      div.id = "encoreBlackout";
      div.className = "encoreBlackout";
      div.innerHTML = `<div class="encoreText">🕯️ Encore for Brad</div>`;
      document.body.appendChild(div);
    }
    return div;
  }

  function blackout(on, text) {
    const b = ensureBlackout();
    if (text) b.querySelector(".encoreText").textContent = text;
    b.classList.toggle("on", on);
    if (el.playerFrame)
      el.playerFrame.style.opacity = on ? "0" : "1";
  }

  /* =============================
     JSON Loader (Netlify)
  ============================= */

  async function loadEpisodes() {
    try {
      const r = await fetch(MASTER_JSON + "?v=" + Date.now());
      const data = await r.json();
      if (Array.isArray(data)) return data;
    } catch {}
    return window.EPISODES || window.episodes || [];
  }

  /* =============================
     Brad Encore Engine
  ============================= */

  window.onYouTubeIframeAPIReady = function () {
    ytReady = true;
    if (!ytPlayer)
      ytPlayer = new YT.Player("playerFrame", {
        events: { onStateChange: onYTStateChange }
      });
  };

  function loadYTApi() {
    if (ytApiLoading || ytReady) return;
    ytApiLoading = true;
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  }

  function onYTStateChange(e) {
    if (!bradCtx || e.data !== YT.PlayerState.ENDED) return;

    if (bradCtx.step < bradCtx.cutoff) {
      bradCtx.step++;
      ytPlayer.loadVideoById(bradCtx.ids[bradCtx.step]);
      return;
    }

    blackout(true, "🕯️ Lights out…");

    setTimeout(() => {
      ytPlayer.loadVideoById(bradCtx.encore);
      setTimeout(() => blackout(false), 1500);
    }, 3000);

    bradCtx = null;
  }

  /* =============================
     Play Episode
  ============================= */

  function playEpisode(ep) {

    const urls = ep.tracks.map(t => t.url);

    bradCtx = null;
    blackout(false);

    if (el.nowTitle) el.nowTitle.textContent = ep.title;
    if (el.nowLine)
      el.nowLine.textContent = ep.artist + (ep.year ? " • " + ep.year : "");

    setWatchOnTv(buildWatchUrl(ep));
    ensurePlayerVisible();

    const firstUrl = urls[0];
    const playlistId = getPlaylistId(firstUrl);

    if (ep.memorial && ep.encoreAfterTrackIndex !== undefined) {
      loadYTApi();
      const ids = urls.map(getVideoId);
      bradCtx = {
        ids: ids,
        step: 0,
        cutoff: ep.encoreAfterTrackIndex,
        encore: getVideoId(ep.tracks[ep.encoreAfterTrackIndex + 1].url)
      };
      return;
    }

    let src = "";

    if (playlistId) {
      src = buildEmbedPlaylist(firstUrl);
    } else if (ep.mode === "queue") {
      src = buildEmbedQueue(urls);
    } else {
      src = buildEmbedSingle(firstUrl);
    }

    if (el.playerFrame) el.playerFrame.src = src;
  }

  /* =============================
     UI Rendering
  ============================= */

  function buildCard(ep, i) {
    const div = document.createElement("div");
    div.className = "ep";
    div.innerHTML = `
      <div class="epTitle">${safeText(ep.title)}</div>
      <div class="epMeta">${safeText(ep.artist)} ${ep.year ? "• " + ep.year : ""}</div>
    `;
    div.addEventListener("click", () => playEpisode(ep));
    return div;
  }

  function renderNext() {
    const next = ALL.slice(shownCount, shownCount + PAGE_SIZE);
    next.forEach((ep, i) =>
      el.episodes.appendChild(buildCard(ep, shownCount + i))
    );
    shownCount += next.length;
  }

  /* =============================
     Init
  ============================= */

  async function init() {
    ALL = await loadEpisodes();
    shownCount = 0;
    if (el.episodes) el.episodes.innerHTML = "";
    renderNext();
    setStatus(`Loaded ${ALL.length} sessions`);
  }

  document.addEventListener("DOMContentLoaded", init);

})();
