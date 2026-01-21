/* Stripped & Turned Up — app.js
   Works with your current HTML:
   - #status (pill)
   - #episodes (list)
   - Optional debug UI stays hidden unless ?debug=1
   - Adds ONE shared player at top (single iframe)
   - Preserves playlist/list params so queues autoplay
   - Prefers "Full Session" track when available (fixes Nirvana if present in tracks)
*/

(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const DEBUG = params.get("debug") === "1";

  function log(...args) {
    if (DEBUG) console.log("[STU]", ...args);
  }

  // ---------- Data intake ----------
  const EPISODES = Array.isArray(window.EPISODES)
    ? window.EPISODES
    : Array.isArray(window.episodes)
    ? window.episodes
    : [];

  function safeText(s) {
    return (s == null ? "" : String(s)).trim();
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function")
        node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  // ---------- YouTube embed builder (PRESERVE playlist/list) ----------
  function toYouTubeEmbed(url) {
    const u = safeText(url);
    if (!u) return "";

    // already embed -> keep, but ensure autoplay/playsinline exist
    if (u.includes("/embed/")) {
      // add autoplay if missing
      if (u.includes("autoplay=")) return u;
      return u + (u.includes("?") ? "&" : "?") + "autoplay=1&playsinline=1&rel=0&modestbranding=1";
    }

    let videoId = "";
    let listId = "";

    try {
      const parsed = new URL(u);

      // playlist param
      listId = parsed.searchParams.get("list") || "";

      if (parsed.hostname.includes("youtu.be")) {
        videoId = parsed.pathname.replace("/", "").trim();
      } else {
        videoId = parsed.searchParams.get("v") || "";
      }
    } catch (e) {
      // fallback regex
      const m1 = u.match(/v=([a-zA-Z0-9_-]{6,})/);
      const m2 = u.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
      const mL = u.match(/[?&]list=([a-zA-Z0-9_-]{6,})/);
      videoId = (m1 && m1[1]) || (m2 && m2[1]) || "";
      listId = (mL && mL[1]) || "";
    }

    // If it’s a playlist-only URL (no v=), embed the playlist directly
    if (!videoId && listId) {
      return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(
        listId
      )}&autoplay=1&playsinline=1&rel=0&modestbranding=1`;
    }

    if (!videoId) return "";

    // If list exists, KEEP IT so it continues through the queue
    const listPart = listId ? `&list=${encodeURIComponent(listId)}` : "";

    return `https://www.youtube.com/embed/${encodeURIComponent(
      videoId
    )}?autoplay=1&playsinline=1&rel=0&modestbranding=1${listPart}`;
  }

  // ---------- Find existing HTML targets ----------
  const statusEl = document.getElementById("status");
  const episodesEl = document.getElementById("episodes");

  if (!episodesEl) {
    console.error("Missing #episodes in HTML");
    return;
  }

  // ---------- Insert ONE shared player ABOVE sessions card ----------
  // We mount it inside <main class="wrap"> as the first element.
  const wrap = document.querySelector("main.wrap") || document.body;

  let playerWrap = document.getElementById("playerWrap");
  let playerTitle = document.getElementById("nowPlayingTitle");
  let playerFrame = document.getElementById("playerFrame");

  if (!playerWrap) {
    playerTitle = el("div", { id: "nowPlayingTitle", class: "now-playing-title" }, "Tap a session to play");

    playerFrame = el("iframe", {
      id: "playerFrame",
      class: "player-frame",
      src: "about:blank",
      allow:
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
      allowfullscreen: "true",
      frameborder: "0",
      title: "Stripped & Turned Up Player",
    });

    playerWrap = el("section", { id: "playerWrap", class: "player-wrap" }, [
      playerTitle,
      el("div", { class: "player-shell" }, playerFrame),
    ]);

    wrap.prepend(playerWrap);
  }

  function setNowPlaying(session) {
    if (!session) {
      playerTitle.textContent = "Tap a session to play";
      playerFrame.src = "about:blank";
      return;
    }

    playerTitle.textContent = session.title;
    const embed = toYouTubeEmbed(session.streamUrl);

    if (!embed) {
      playerFrame.src = "about:blank";
      if (DEBUG) alert("Bad YouTube link: " + session.streamUrl);
      return;
    }

    // Changing src stops previous and starts new
    playerFrame.src = embed;
  }

  // ---------- Normalize episodes ----------
  function pickStreamUrl(ep) {
    // Prefer direct streamUrl fields first (if you ever add them)
    const direct =
      safeText(ep.streamUrl) ||
      safeText(ep.fullUrl) ||
      safeText(ep.url);

    if (direct) return direct;

    const tracks = Array.isArray(ep.tracks) ? ep.tracks : [];
    if (!tracks.length) return "";

    // Prefer a track that screams "Full Session"
    const full = tracks.find((t) => {
      const tt = safeText(t && t.title).toLowerCase();
      const uu = safeText(t && t.url);
      return (
        uu &&
        (tt.includes("full") ||
          tt.includes("session") ||
          tt.includes("unplugged") && tt.includes("full") ||
          /full\s*session/i.test(safeText(t && t.title)))
      );
    });

    if (full && safeText(full.url)) return safeText(full.url);

    // Otherwise take first track
    const first = tracks[0] || {};
    return safeText(first.url);
  }

  function normalizeEpisodes(arr) {
    const out = [];

    (arr || []).forEach((ep, idx) => {
      if (!ep || typeof ep !== "object") return;

      const title = safeText(ep.title) || `Session ${idx + 1}`;
      const artist = safeText(ep.artist) || "";
      const year = ep.year != null ? String(ep.year) : "";
      const tracks = Array.isArray(ep.tracks) ? ep.tracks : [];

      const streamUrl = pickStreamUrl(ep);
      if (!streamUrl) return;

      out.push({
        id: `ep_${idx}_${title.replace(/\s+/g, "_").slice(0, 30)}`,
        title,
        artist,
        year,
        trackCount: tracks.length,
        streamUrl,
      });
    });

    return out;
  }

  let sessions = normalizeEpisodes(EPISODES);

  // Optional blocklist if you want it
  const BLOCK_ARTISTS = new Set(["KISS", "Pearl Jam"]);
  sessions = sessions.filter((s) => !BLOCK_ARTISTS.has(s.artist));

  if (statusEl) statusEl.textContent = `Loaded ${sessions.length} sessions`;
  log("Sessions:", sessions);

  // ---------- Render list into #episodes (your existing UI) ----------
  episodesEl.innerHTML = "";

  let ACTIVE_ID = null;

  function closeAll() {
    episodesEl.querySelectorAll(".ep.open").forEach((n) => n.classList.remove("open"));
    ACTIVE_ID = null;
  }

  function openEpisode(tile, session) {
    closeAll();
    tile.classList.add("open");
    ACTIVE_ID = session.id;
    setNowPlaying(session);
  }

  function toggleEpisode(tile, session) {
    const isOpen = tile.classList.contains("open");
    if (isOpen) {
      tile.classList.remove("open");
      ACTIVE_ID = null;
      setNowPlaying(null);
      return;
    }
    openEpisode(tile, session);
  }

  sessions.forEach((s) => {
    const meta = [s.artist, s.year].filter(Boolean).join(" • ");
    const tracksLine = s.trackCount ? `${s.trackCount} track${s.trackCount === 1 ? "" : "s"}` : "";

    const tile = el("div", { class: "ep", tabindex: "0" }, [
      el("div", { class: "epHead" }, [
        el("div", {}, [
          el("div", { class: "epTitle" }, s.title),
          el("div", { class: "epMeta" }, meta),
          tracksLine ? el("div", { class: "epSmall" }, tracksLine) : null,
        ]),
        el("div", { class: "chev" }, "⌄"),
      ]),
    ]);

    tile.addEventListener("click", () => toggleEpisode(tile, s));
    tile.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleEpisode(tile, s);
      }
    });

    episodesEl.appendChild(tile);
  });

  if (!sessions.length) {
    episodesEl.appendChild(
      el("div", { class: "ep" }, [
        el("div", { class: "epTitle" }, "No sessions found"),
        el("div", { class: "epMeta" }, "Check data/episodes.js formatting (EPISODES array)."),
      ])
    );
  }

})();
