/* Stripped & Turned Up — app.js
   Goals:
   - Debug UI hidden unless ?debug=1
   - Single shared player (only ONE YouTube iframe on the page)
   - One “open” tile at a time (no stuck windows)
   - Clean data intake from window.EPISODES / window.episodes
   - Queue mode auto-advances tracks (Wage War / Smile Empty Soul / Wind Walkers)
*/

(function () {
  "use strict";

  // ---------- Debug mode (ONLY when ?debug=1) ----------
  const params = new URLSearchParams(location.search);
  const DEBUG = params.get("debug") === "1";

  function log(...args) {
    if (DEBUG) console.log("[STU]", ...args);
  }

  function hideDebugUI() {
    if (DEBUG) return;
    document.querySelectorAll("#btnDiag, #debugPanel, .footSmall").forEach((n) => {
      if (n) n.style.display = "none";
    });
  }

  hideDebugUI();

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
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
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

  function getYouTubeId(url) {
    const u = safeText(url);
    if (!u) return "";

    if (u.includes("/embed/")) {
      const parts = u.split("/embed/");
      const tail = parts[1] || "";
      return tail.split("?")[0].trim();
    }

    try {
      const parsed = new URL(u);
      if (parsed.hostname.includes("youtu.be")) {
        return parsed.pathname.replace("/", "").trim();
      }
      if (parsed.hostname.includes("youtube.com")) {
        return parsed.searchParams.get("v") || "";
      }
    } catch (e) {
      // fallback
      const m1 = u.match(/v=([a-zA-Z0-9_-]{6,})/);
      const m2 = u.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
      return (m1 && m1[1]) || (m2 && m2[1]) || "";
    }

    return "";
  }

  // ---------- Normalize sessions ----------
  function normalizeEpisodes(arr) {
    const out = [];

    (arr || []).forEach((ep, idx) => {
      if (!ep || typeof ep !== "object") return;

      const title = safeText(ep.title) || `Session ${idx + 1}`;
      const artist = safeText(ep.artist) || "";
      const year = ep.year != null ? String(ep.year) : "";
      const mode = safeText(ep.mode) || (Array.isArray(ep.tracks) && ep.tracks.length > 1 ? "queue" : "fullshow");

      const tracksRaw = Array.isArray(ep.tracks) ? ep.tracks : [];
      const tracks = tracksRaw
        .map((t, i) => ({
          title: safeText(t && t.title) || `Track ${i + 1}`,
          url: safeText(t && t.url),
          id: getYouTubeId(t && t.url),
        }))
        .filter((t) => t.url && t.id);

      if (!tracks.length) return;

      out.push({
        id: `ep_${idx}_${title.replace(/\s+/g, "_").slice(0, 40)}`,
        title,
        artist,
        year,
        mode,
        tracks,
      });
    });

    return out;
  }

  let sessions = normalizeEpisodes(EPISODES);

  // Hard block old stuff if it ever sneaks back in
  const BLOCK_ARTISTS = new Set(["KISS", "Pearl Jam"]);
  sessions = sessions.filter((s) => !BLOCK_ARTISTS.has(s.artist));

  // ---------- DOM ----------
  const listWrap = document.getElementById("episodes");
  const statusPill = document.getElementById("status");

  // Inject one shared player ABOVE the list (inside the Sessions card)
  // We'll insert it before the list container.
  let playerWrap = document.getElementById("playerWrap");
  if (!playerWrap) {
    playerWrap = el("div", { id: "playerWrap", class: "playerWrap" }, [
      el("div", { id: "nowPlayingTitle", class: "nowPlayingTitle" }, "Tap a session to play"),
      el("div", { class: "playerShell" }, [
        el("div", { class: "playerAspect" }, [
          el("div", { id: "playerMount", class: "playerMount" })
        ])
      ]),
    ]);

    if (listWrap && listWrap.parentElement) {
      listWrap.parentElement.insertBefore(playerWrap, listWrap);
    }
  }

  const titleEl = document.getElementById("nowPlayingTitle");
  const mount = document.getElementById("playerMount");

  if (statusPill) statusPill.textContent = `Loaded ${sessions.length} sessions`;

  // ---------- YouTube IFrame API (so queues can auto-advance) ----------
  let ytReady = false;
  let ytPlayer = null;

  function loadYouTubeAPI() {
    return new Promise((resolve) => {
      if (window.YT && window.YT.Player) return resolve();

      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);

      window.onYouTubeIframeAPIReady = function () {
        resolve();
      };
    });
  }

  async function ensurePlayer() {
    if (ytPlayer) return ytPlayer;

    await loadYouTubeAPI();
    ytReady = true;

    ytPlayer = new window.YT.Player("playerMount", {
      width: "100%",
      height: "100%",
      videoId: "",
      playerVars: {
        autoplay: 1,
        playsinline: 1,
        rel: 0,
        modestbranding: 1
      },
      events: {
        onStateChange: onPlayerStateChange
      }
    });

    return ytPlayer;
  }

  // ---------- Playback state ----------
  let ACTIVE_SESSION_ID = null;
  let ACTIVE_TRACK_INDEX = 0;

  function setTitle(session, idx) {
    if (!titleEl) return;

    if (!session) {
      titleEl.textContent = "Tap a session to play";
      return;
    }

    if (session.mode === "queue") {
      const t = session.tracks[idx] ? session.tracks[idx].title : "";
      titleEl.textContent = t ? `${session.title} — ${t}` : session.title;
    } else {
      titleEl.textContent = session.title;
    }
  }

  async function playSession(session, startIndex = 0) {
    const s = session;
    ACTIVE_SESSION_ID = s.id;
    ACTIVE_TRACK_INDEX = Math.max(0, Math.min(startIndex, s.tracks.length - 1));

    setTitle(s, ACTIVE_TRACK_INDEX);

    const player = await ensurePlayer();
    const vid = s.tracks[ACTIVE_TRACK_INDEX].id;

    try {
      player.loadVideoById(vid);
    } catch (e) {
      log("loadVideoById failed", e);
    }
  }

  async function stopPlayback() {
    setTitle(null, 0);
    ACTIVE_SESSION_ID = null;
    ACTIVE_TRACK_INDEX = 0;

    if (ytPlayer && ytReady) {
      try {
        ytPlayer.stopVideo();
      } catch (e) {}
    }
  }

  function getActiveSession() {
    return sessions.find((s) => s.id === ACTIVE_SESSION_ID) || null;
  }

  function onPlayerStateChange(e) {
    // 0 = ended
    if (!e || e.data !== 0) return;

    const s = getActiveSession();
    if (!s) return;

    if (s.mode !== "queue") return;

    const next = ACTIVE_TRACK_INDEX + 1;
    if (next >= s.tracks.length) {
      // End of queue — stop or loop (your call)
      // We'll stop cleanly.
      stopPlayback();
      closeAllTiles();
      return;
    }

    ACTIVE_TRACK_INDEX = next;
    setTitle(s, ACTIVE_TRACK_INDEX);

    try {
      ytPlayer.loadVideoById(s.tracks[ACTIVE_TRACK_INDEX].id);
    } catch (err) {
      log("Next track load failed", err);
    }
  }

  // ---------- Tiles ----------
  function closeAllTiles() {
    if (!listWrap) return;
    listWrap.querySelectorAll(".epTile.open").forEach((n) => n.classList.remove("open"));
  }

  function openTile(tile, session) {
    closeAllTiles();
    tile.classList.add("open");
    playSession(session, 0);
  }

  function toggleTile(tile, session) {
    const isOpen = tile.classList.contains("open");
    if (isOpen) {
      tile.classList.remove("open");
      stopPlayback();
      return;
    }
    openTile(tile, session);
  }

  function render() {
    if (!listWrap) return;

    listWrap.innerHTML = "";

    sessions.forEach((s) => {
      const metaParts = [s.artist, s.year].filter(Boolean);
      if (s.mode === "queue") metaParts.push(`${s.tracks.length} tracks`);
      const meta = metaParts.join(" • ");

      const tile = el("div", { class: "epTile", role: "button", tabindex: "0" }, [
        el("div", { class: "epTitle" }, s.title),
        el("div", { class: "epMeta" }, meta)
      ]);

      tile.addEventListener("click", () => toggleTile(tile, s));
      tile.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          toggleTile(tile, s);
        }
      });

      listWrap.appendChild(tile);
    });

    if (!sessions.length) {
      listWrap.appendChild(el("div", { class: "emptyMsg" }, "No sessions found. Check episodes.js formatting."));
    }
  }

  render();

  // ---------- Debug panel button behavior (only if debug=1) ----------
  const btnDiag = document.getElementById("btnDiag");
  const panel = document.getElementById("debugPanel");
  const lines = document.getElementById("debugLines");

  if (DEBUG && btnDiag && panel && lines) {
    btnDiag.style.display = "";
    btnDiag.addEventListener("click", () => {
      panel.classList.toggle("hidden");
      lines.textContent = [
        "DEBUG MODE ON",
        `Loaded sessions: ${sessions.length}`,
        "",
        "Artists:",
        ...sessions.map((s) => `- ${s.artist} (${s.mode}, ${s.tracks.length} track(s))`)
      ].join("\n");
    });
  }

  log("Debug:", DEBUG);
  log("Sessions:", sessions);
})();
