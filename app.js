/* Stripped & Turned Up — app.js
   Goals:
   - Debug UI hidden unless ?debug=1
   - Single shared player (only ONE YouTube iframe on the page) via YouTube IFrame API
   - One “open” tile at a time (no stuck windows)
   - Support queues (multiple tracks) and auto-advance after first user play
   - No ugly Play buttons
*/

(function () {
  "use strict";

  // ---------- Debug mode (ONLY when ?debug=1) ----------
  const params = new URLSearchParams(location.search);
  const DEBUG = params.get("debug") === "1";

  function log(...args) {
    if (DEBUG) console.log("[STU]", ...args);
  }

  // ---------- Grab episodes ----------
  const EPISODES = Array.isArray(window.EPISODES)
    ? window.EPISODES
    : Array.isArray(window.episodes)
    ? window.episodes
    : [];

  // ---------- Helpers ----------
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

  function safeText(s) {
    return (s == null ? "" : String(s)).trim();
  }

  function ytId(url) {
    const u = safeText(url);
    if (!u) return "";
    try {
      const parsed = new URL(u);
      if (parsed.hostname.includes("youtu.be")) {
        return parsed.pathname.replace("/", "").trim();
      }
      // youtube.com
      return (parsed.searchParams.get("v") || "").trim();
    } catch (e) {
      const m1 = u.match(/v=([a-zA-Z0-9_-]{6,})/);
      const m2 = u.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
      return ((m1 && m1[1]) || (m2 && m2[1]) || "").trim();
    }
  }

  // ---------- Hide debug UI unless ?debug=1 ----------
  function hideDebugUI() {
    if (DEBUG) return;
    document.querySelectorAll(".debug-btn,.debug-tip,.debug-panel,#debugBtn").forEach((n) => {
      n.style.display = "none";
    });
    // If that middle “Sessions card” exists in HTML, nuke it here by common selectors:
    document.querySelectorAll(".sessions-panel,.sessions-card,.sessions-info,#sessionsPanel").forEach((n) => {
      n.style.display = "none";
    });
  }
  hideDebugUI();

  // ---------- DOM targets (create if missing) ----------
  let root =
    document.querySelector("#app") ||
    document.querySelector("main") ||
    document.body;

  // Player area (single shared YouTube player)
  let playerWrap = document.querySelector("#playerWrap");
  let playerTitle = document.querySelector("#nowPlayingTitle");

  // We'll render the YT API player into a DIV (YT creates the iframe inside it)
  let playerHost = document.querySelector("#playerHost");

  if (!playerWrap) {
    playerTitle = el(
      "div",
      { id: "nowPlayingTitle", class: "now-playing-title" },
      "Tap a session to play"
    );

    playerHost = el("div", { id: "playerHost" });

    const shell = el("div", { class: "player-shell" }, playerHost);

    // Make it big and clean on mobile (inline style = no CSS guessing)
    shell.style.width = "100%";
    shell.style.maxWidth = "980px";
    shell.style.margin = "0 auto";
    shell.style.borderRadius = "18px";
    shell.style.overflow = "hidden";
    shell.style.aspectRatio = "16 / 9";

    playerWrap = el("section", { id: "playerWrap", class: "player-wrap" }, [
      playerTitle,
      shell,
    ]);

    root.prepend(playerWrap);
  } else {
    // exists already
    if (!playerTitle) playerTitle = document.querySelector("#nowPlayingTitle");
    if (!playerHost) playerHost = document.querySelector("#playerHost");
    if (!playerHost) {
      // if old iframe exists, replace it with a host div
      const oldFrame = document.querySelector("#playerFrame");
      playerHost = el("div", { id: "playerHost" });
      if (oldFrame && oldFrame.parentElement) {
        oldFrame.parentElement.innerHTML = "";
        oldFrame.parentElement.appendChild(playerHost);
      } else {
        root.prepend(playerHost);
      }
    }
  }

  // List area
  let listWrap = document.querySelector("#sessionsList");
  if (!listWrap) {
    listWrap = el("section", { id: "sessionsList", class: "sessions-list" });
    root.appendChild(listWrap);
  }

  // Kill any previously injected “Loaded X sessions” pill if it exists
  const oldPill = document.querySelector("#loadedCount");
  if (oldPill) oldPill.remove();

  // ---------- Normalize episodes (KEEP full tracks arrays) ----------
  function normalizeEpisodes(arr) {
    const out = [];
    (arr || []).forEach((ep, idx) => {
      if (!ep || typeof ep !== "object") return;

      const title = safeText(ep.title) || `Session ${idx + 1}`;
      const artist = safeText(ep.artist) || "";
      const year = ep.year != null ? String(ep.year) : "";

      const tracks = Array.isArray(ep.tracks) ? ep.tracks : [];
      const cleanTracks = tracks
        .map((t) => ({
          title: safeText(t && t.title) || "Track",
          url: safeText(t && t.url),
          id: ytId(t && t.url),
        }))
        .filter((t) => t.url && t.id);

      if (!cleanTracks.length) return;

      out.push({
        id: `ep_${idx}_${title.replace(/\s+/g, "_").slice(0, 30)}`,
        title,
        artist,
        year,
        tracks: cleanTracks, // <-- IMPORTANT: keep all tracks for queues
      });
    });

    return out;
  }

  let sessions = normalizeEpisodes(EPISODES);

  // Prevent accidental reverts
  const BLOCK_ARTISTS = new Set(["KISS", "Pearl Jam"]);
  sessions = sessions.filter((s) => !BLOCK_ARTISTS.has(s.artist));

  // ---------- YouTube IFrame API (single player + queue autoplay) ----------
  let YT_READY = false;
  let player = null;

  let currentSession = null;
  let currentIndex = 0;

  function loadYTApiOnce() {
    if (window.YT && window.YT.Player) return;
    if (document.querySelector('script[data-yt="1"]')) return;

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    tag.setAttribute("data-yt", "1");
    document.head.appendChild(tag);
  }

  function ensurePlayer(firstVideoId) {
    loadYTApiOnce();

    return new Promise((resolve) => {
      // If already built
      if (player && typeof player.loadVideoById === "function") {
        resolve(player);
        return;
      }

      // If API is already ready
      if (window.YT && window.YT.Player) {
        YT_READY = true;
      }

      // Hook ready callback (only once)
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prev === "function") prev();
        YT_READY = true;

        player = new YT.Player("playerHost", {
          videoId: firstVideoId,
          playerVars: {
            autoplay: 1,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
          },
          events: {
            onStateChange: (e) => {
              // ENDED => advance in queue
              if (e.data === YT.PlayerState.ENDED) {
                playNext();
              }
            },
          },
        });

        resolve(player);
      };

      // If ready was already true, force create immediately without waiting
      if (YT_READY) {
        player = new window.YT.Player("playerHost", {
          videoId: firstVideoId,
          playerVars: {
            autoplay: 1,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
          },
          events: {
            onStateChange: (e) => {
              if (e.data === YT.PlayerState.ENDED) {
                playNext();
              }
            },
          },
        });
        resolve(player);
      }
    });
  }

  function setNowPlayingTitle(session, idx) {
    if (!playerTitle) return;
    if (!session) {
      playerTitle.textContent = "Tap a session to play";
      return;
    }
    const t = session.tracks[idx];
    const suffix = session.tracks.length > 1 ? ` — ${idx + 1}/${session.tracks.length}` : "";
    const trackName = t && t.title ? ` (${t.title})` : "";
    playerTitle.textContent = session.title + suffix + trackName;
  }

  function stopPlayback() {
    try {
      if (player && typeof player.stopVideo === "function") player.stopVideo();
    } catch (e) {}
    currentSession = null;
    currentIndex = 0;
    setNowPlayingTitle(null, 0);
  }

  function playSession(session) {
    if (!session || !session.tracks || !session.tracks.length) return;

    currentSession = session;
    currentIndex = 0;

    const firstId = session.tracks[0].id;
    setNowPlayingTitle(session, 0);

    ensurePlayer(firstId).then((p) => {
      // Switching sessions should HARD stop the previous and load the new
      try {
        p.loadVideoById(firstId);
      } catch (e) {
        log("loadVideoById failed", e);
      }
    });
  }

  function playNext() {
    if (!currentSession) return;
    if (!currentSession.tracks || currentSession.tracks.length < 2) return;

    if (currentIndex >= currentSession.tracks.length - 1) {
      // end of queue
      return;
    }

    currentIndex++;
    const nextId = currentSession.tracks[currentIndex].id;
    setNowPlayingTitle(currentSession, currentIndex);

    try {
      player.loadVideoById(nextId);
    } catch (e) {
      log("Next load failed", e);
    }
  }

  // ---------- Tiles (one open at a time, NO play button) ----------
  let ACTIVE_ID = null;

  function closeAllTiles() {
    listWrap.querySelectorAll(".session-tile.open").forEach((n) => n.classList.remove("open"));
    ACTIVE_ID = null;
  }

  function openTile(tile, session) {
    closeAllTiles();
    tile.classList.add("open");
    ACTIVE_ID = session.id;
    playSession(session);
  }

  function toggleTile(tile, session) {
    const isOpen = tile.classList.contains("open");
    if (isOpen) {
      tile.classList.remove("open");
      ACTIVE_ID = null;
      stopPlayback();
      return;
    }
    openTile(tile, session);
  }

  // Clear previous tiles
  listWrap.querySelectorAll(".session-tile,.empty-msg").forEach((n) => n.remove());

  // Render
  if (!sessions.length) {
    listWrap.appendChild(
      el("div", { class: "empty-msg" }, "No sessions found. Check episodes.js formatting.")
    );
  } else {
    sessions.forEach((s) => {
      const meta = [s.artist, s.year].filter(Boolean).join(" • ");
      const count = s.tracks.length > 1 ? ` • ${s.tracks.length} tracks` : "";

      const tile = el("div", { class: "session-tile", "data-id": s.id }, [
        el("div", { class: "session-top" }, [
          el("div", { class: "session-title" }, s.title),
          el("div", { class: "session-meta" }, meta + count),
        ]),
      ]);

      tile.addEventListener("click", () => toggleTile(tile, s));
      listWrap.appendChild(tile);
    });
  }

  // ---------- Final debug sanity ----------
  log("Debug:", DEBUG);
  log("EPISODES raw:", EPISODES);
  log("Sessions normalized:", sessions);
})();
