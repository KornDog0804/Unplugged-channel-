/* Stripped & Turned Up — app.js (FOR index.html v21)
   - Works with: <section id="playerWrap"></section> + <section id="sessionsList"></section>
   - Creates ONE shared YouTube player
   - Renders session tiles (one stream per session: tracks[0].url)
   - One open tile at a time; click again closes + stops playback
   - Debug only when ?debug=1 (console only; no UI)
*/
(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const DEBUG = params.get("debug") === "1";
  const log = (...a) => DEBUG && console.log("[STU]", ...a);

  // ---- Pull data ----
  const RAW = Array.isArray(window.EPISODES)
    ? window.EPISODES
    : Array.isArray(window.episodes)
    ? window.episodes
    : [];

  const $ = (sel) => document.querySelector(sel);
  const playerHost = $("#playerWrap");
  const sessionsHost = $("#sessionsList");

  if (!playerHost || !sessionsHost) {
    console.error("Missing #playerWrap or #sessionsList in HTML.");
    return;
  }

  // ---- Helpers ----
  const safeText = (s) => (s == null ? "" : String(s)).trim();

  function el(tag, attrs = {}, kids = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    }
    (Array.isArray(kids) ? kids : [kids]).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function ytIdFrom(url) {
    const u = safeText(url);
    if (!u) return "";

    // embed link
    if (u.includes("/embed/")) {
      const m = u.match(/\/embed\/([a-zA-Z0-9_-]{6,})/);
      return m ? m[1] : "";
    }

    try {
      const parsed = new URL(u);
      if (parsed.hostname.includes("youtu.be")) {
        return parsed.pathname.replace("/", "").trim();
      }
      return parsed.searchParams.get("v") || "";
    } catch {
      const m1 = u.match(/v=([a-zA-Z0-9_-]{6,})/);
      const m2 = u.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
      return (m1 && m1[1]) || (m2 && m2[1]) || "";
    }
  }

  function toEmbed(url) {
    const id = ytIdFrom(url);
    if (!id) return "";
    return `https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;
  }

  function normalizeEpisodes(arr) {
    const out = [];
    (arr || []).forEach((ep, idx) => {
      if (!ep || typeof ep !== "object") return;

      const title = safeText(ep.title) || `Session ${idx + 1}`;
      const artist = safeText(ep.artist) || "";
      const year = ep.year != null ? String(ep.year) : "";
      const tracks = Array.isArray(ep.tracks) ? ep.tracks : [];

      // One stream per session: tracks[0].url
      const streamUrl = tracks[0] ? safeText(tracks[0].url) : "";
      if (!streamUrl) return;

      out.push({
        id: `stu_${idx}_${title.replace(/\s+/g, "_").slice(0, 25)}`,
        title,
        artist,
        year,
        streamUrl,
      });
    });
    return out;
  }

  const sessions = normalizeEpisodes(RAW);
  log("RAW episodes:", RAW.length, "normalized:", sessions.length);

  // ---- Build shared player ----
  playerHost.innerHTML = "";

  const nowTitle = el("div", {
    id: "nowPlayingTitle",
    class: "now-playing-title",
    text: "Tap a session to play",
  });

  const iframe = el("iframe", {
    id: "playerFrame",
    class: "player-frame",
    src: "about:blank",
    allow:
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
    allowfullscreen: "true",
    frameborder: "0",
    title: "Stripped & Turned Up Player",
    referrerpolicy: "strict-origin-when-cross-origin",
  });

  const shell = el("div", { class: "player-shell" }, iframe);

  playerHost.appendChild(nowTitle);
  playerHost.appendChild(shell);

  function setNowPlaying(session) {
    if (!session) {
      nowTitle.textContent = "Tap a session to play";
      iframe.src = "about:blank";
      return;
    }

    const embed = toEmbed(session.streamUrl);
    if (!embed) {
      nowTitle.textContent = "Bad link (can’t embed)";
      iframe.src = "about:blank";
      log("BAD LINK:", session.streamUrl);
      return;
    }

    nowTitle.textContent = session.title;
    iframe.src = embed;
  }

  // ---- Build sessions list UI ----
  sessionsHost.innerHTML = "";

  // Header + status pill
  const header = el("div", { class: "sectionHead" }, [
    el("div", {}, [
      el("div", { class: "h2", text: "Sessions" }),
      el("div", {
        class: "mutedTiny",
        text: "One stream per artist. If it plays clean, it stays.",
      }),
    ]),
    el("div", {
      id: "status",
      class: "pill",
      text: sessions.length ? `Loaded ${sessions.length} sessions` : "No sessions found",
    }),
  ]);

  sessionsHost.appendChild(el("div", { class: "card" }, [header, el("div", { id: "tiles" })]));

  const tilesWrap = $("#tiles");
  if (!tilesWrap) return;

  let ACTIVE_ID = null;

  function closeAll() {
    tilesWrap.querySelectorAll(".session-tile.open").forEach((n) => n.classList.remove("open"));
    ACTIVE_ID = null;
  }

  function openTile(tile, session) {
    closeAll();
    tile.classList.add("open");
    ACTIVE_ID = session.id;
    setNowPlaying(session);
    // keep the player visible-ish on phone
    playerHost.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleTile(tile, session) {
    const isOpen = tile.classList.contains("open");
    if (isOpen) {
      tile.classList.remove("open");
      ACTIVE_ID = null;
      setNowPlaying(null); // stop playback when closing
      return;
    }
    openTile(tile, session);
  }

  if (!sessions.length) {
    tilesWrap.appendChild(
      el("div", { class: "empty-msg" }, "No sessions found. Check data/episodes.js formatting.")
    );
    return;
  }

  sessions.forEach((s) => {
    const meta = [s.artist, s.year].filter(Boolean).join(" • ");

    const tile = el("div", { class: "session-tile", "data-id": s.id }, [
      el("div", { class: "session-top" }, [
        el("div", { class: "session-title", text: s.title }),
        el("div", { class: "session-meta", text: meta }),
        el(
          "button",
          { class: "session-play", type: "button" },
          "Play"
        ),
      ]),
    ]);

    // clicking tile toggles open/close
    tile.addEventListener("click", () => toggleTile(tile, s));

    // play button should only OPEN (not close)
    tile.querySelector(".session-play").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTile(tile, s);
    });

    tilesWrap.appendChild(tile);
  });
})();
