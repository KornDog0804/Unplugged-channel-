/* Stripped & Turned Up — app.js
   Goals:
   - Debug UI hidden unless ?debug=1
   - Single shared player (only ONE YouTube iframe on the page)
   - One “open” tile at a time (no stuck windows)
   - Clean data intake from window.EPISODES / window.episodes
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

  function toYouTubeEmbed(url) {
    // supports:
    // - https://www.youtube.com/watch?v=ID
    // - https://youtu.be/ID
    // - already-embed links
    const u = safeText(url);
    if (!u) return "";

    // already embed
    if (u.includes("/embed/")) return u;

    let id = "";

    try {
      const parsed = new URL(u);
      if (parsed.hostname.includes("youtu.be")) {
        id = parsed.pathname.replace("/", "").trim();
      } else {
        // youtube.com
        id = parsed.searchParams.get("v") || "";
      }
    } catch (e) {
      // fallback regex
      const m1 = u.match(/v=([a-zA-Z0-9_-]{6,})/);
      const m2 = u.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
      id = (m1 && m1[1]) || (m2 && m2[1]) || "";
    }

    if (!id) return "";
    // modestbranding + playsinline helps mobile
    return `https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;
  }

  // ---------- DOM targets (create if missing) ----------
  // We try to find existing containers first.
  let root =
    document.querySelector("#app") ||
    document.querySelector("main") ||
    document.body;

  // Header debug bits removal: anything with .debug-btn/.debug-tip/.debug-panel gets hidden in normal mode
  function hideDebugUI() {
    if (DEBUG) return;
    document.querySelectorAll(".debug-btn,.debug-tip,.debug-panel").forEach((n) => {
      n.style.display = "none";
    });
  }

  hideDebugUI();

  // Player area (single shared iframe)
  let playerWrap = document.querySelector("#playerWrap");
  let playerTitle = document.querySelector("#nowPlayingTitle");
  let playerFrame = document.querySelector("#playerFrame");

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

    // Put it near the top
    root.prepend(playerWrap);
  }

  // List area
  let listWrap = document.querySelector("#sessionsList");
  if (!listWrap) {
    listWrap = el("section", { id: "sessionsList", class: "sessions-list" });
    root.appendChild(listWrap);
  }

  // Status pill
  let statusPill = document.querySelector("#loadedCount");
  if (!statusPill) {
    statusPill = el("div", { id: "loadedCount", class: "loaded-pill" }, "");
    // If you already have a “Sessions” header, this just sits at top of list
    listWrap.prepend(statusPill);
  }

  // ---------- Render ----------
  function normalizeEpisodes(arr) {
    // We only support ONE stream per artist session now:
    // We will use tracks[0].url as the stream.
    const out = [];

    (arr || []).forEach((ep, idx) => {
      if (!ep || typeof ep !== "object") return;

      const title = safeText(ep.title) || `Session ${idx + 1}`;
      const artist = safeText(ep.artist) || "";
      const year = ep.year != null ? String(ep.year) : "";
      const tracks = Array.isArray(ep.tracks) ? ep.tracks : [];
      const first = tracks[0] || {};
      const streamUrl = safeText(first.url);

      if (!streamUrl) return;

      out.push({
        id: `ep_${idx}_${title.replace(/\s+/g, "_").slice(0, 30)}`,
        title,
        artist,
        year,
        streamUrl,
      });
    });

    return out;
  }

  let sessions = normalizeEpisodes(EPISODES);

  // Filter out old KISS/Pearl Jam if they got reintroduced accidentally:
  // (You asked not to revert back — this prevents surprises.)
  const BLOCK_ARTISTS = new Set(["KISS", "Pearl Jam"]);
  sessions = sessions.filter((s) => !BLOCK_ARTISTS.has(s.artist));

  statusPill.textContent = `Loaded ${sessions.length} sessions`;

  // Track active tile
  let ACTIVE_ID = null;

  function setNowPlaying(session) {
    const name = session ? session.title : "Tap a session to play";
    playerTitle.textContent = name;

    if (!session) {
      playerFrame.src = "about:blank";
      return;
    }

    const embed = toYouTubeEmbed(session.streamUrl);
    if (!embed) {
      // hard stop if bad
      playerFrame.src = "about:blank";
      if (DEBUG) alert("Bad YouTube link: " + session.streamUrl);
      return;
    }

    // This is the magic: changing src stops the previous video automatically.
    playerFrame.src = embed;
  }

  function closeAllTiles() {
    listWrap.querySelectorAll(".session-tile.open").forEach((n) => n.classList.remove("open"));
    ACTIVE_ID = null;
  }

  function openTile(tile, session) {
    closeAllTiles();
    tile.classList.add("open");
    ACTIVE_ID = session.id;

    setNowPlaying(session);

    // Scroll a little so the player area stays visible-ish (optional)
    // window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleTile(tile, session) {
    const isOpen = tile.classList.contains("open");
    if (isOpen) {
      tile.classList.remove("open");
      ACTIVE_ID = null;
      // If closing the active one, STOP playback:
      setNowPlaying(null);
      return;
    }
    openTile(tile, session);
  }

  // Build tiles
  listWrap.querySelectorAll(".session-tile").forEach((n) => n.remove());

  const tiles = sessions.map((s) => {
    const meta = [s.artist, s.year].filter(Boolean).join(" • ");

    const tile = el("div", { class: "session-tile", "data-id": s.id }, [
      el("div", { class: "session-top" }, [
        el("div", { class: "session-title" }, s.title),
        el("div", { class: "session-meta" }, meta),
        el(
          "button",
          {
            class: "session-play",
            type: "button",
            onclick: (e) => {
              e.preventDefault();
              e.stopPropagation();
              openTile(tile, s);
            },
          },
          "Play"
        ),
      ]),
    ]);

    tile.addEventListener("click", () => toggleTile(tile, s));
    return tile;
  });

  // Insert tiles after status pill
  tiles.forEach((t) => listWrap.appendChild(t));

  // ---------- Optional: If zero sessions, show a clean message ----------
  if (!sessions.length) {
    listWrap.appendChild(
      el("div", { class: "empty-msg" }, "No sessions found. Check episodes.js formatting.")
    );
  }

  // ---------- Final debug sanity ----------
  log("Debug:", DEBUG);
  log("EPISODES raw:", EPISODES);
  log("Sessions:", sessions);

})();
