/* Stripped & Turned Up — app.js (LOCKED BASELINE v24)
   - Hides header handled by index.html body[data-screen]
   - Uses YouTube Iframe API for reliable play + queue auto-advance
   - Still renders your same sessions cards
   - Debug only when ?debug=1
*/
(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const DEBUG = params.get("debug") === "1";

  const EPISODES = Array.isArray(window.EPISODES)
    ? window.EPISODES
    : Array.isArray(window.episodes)
    ? window.episodes
    : [];

  const $ = (sel) => document.querySelector(sel);

  const main = $("main.wrap") || $("main") || document.body;

  const list = $("#episodes") || $("#sessionsList");
  const status = $("#status") || $("#loadedCount");

  function logLine(line) {
    if (!DEBUG) return;
    console.log("[STU]", line);
  }

  function el(tag, attrs = {}, kids = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function")
        node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    (Array.isArray(kids) ? kids : [kids]).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function safeText(s) {
    return (s == null ? "" : String(s)).trim();
  }

  function ytIdFrom(url) {
    const u = safeText(url);
    if (!u) return "";
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

  // ---------- Player shell (ensure it exists) ----------
  let playerWrap = $("#playerWrap");
  if (!playerWrap) {
    playerWrap = el("section", { id: "playerWrap" });
    main.insertBefore(playerWrap, main.firstChild);
  }

  playerWrap.innerHTML = "";

  const playerTitle = el(
    "div",
    { id: "nowPlayingTitle", class: "now-playing-title" },
    "Tap a session to play"
  );

  // This is the DIV the YT API will turn into an iframe player
  const playerMount = el("div", {
    id: "playerFrame",
    class: "player-frame",
  });

  const shell = el("div", { class: "player-shell" }, playerMount);

  const tv = el("div", { class: "tvFrame" }, [
    el("div", { class: "tvTopBar" }, [
      el("div", { class: "tvLED" }, ""),
      el("div", { class: "tvLabel" }, "STRIPPED & TURNED UP"),
      el("div", { class: "tvKnob" }, ""),
    ]),
    el("div", { class: "playerFrameWrap" }, shell),
    el("div", { class: "nowPlaying", id: "nowPlayingLine" }, "Ready."),
  ]);

  playerWrap.className = "player-wrap";
  playerWrap.appendChild(playerTitle);
  playerWrap.appendChild(tv);

  const nowPlayingLine = $("#nowPlayingLine");

  // ---------- Normalize sessions ----------
  function normalizeEpisodes(arr) {
    const out = [];
    (arr || []).forEach((ep, idx) => {
      if (!ep || typeof ep !== "object") return;

      const title = safeText(ep.title) || `Session ${idx + 1}`;
      const artist = safeText(ep.artist) || "";
      const year = ep.year != null ? String(ep.year) : "";
      const mode = safeText(ep.mode) || "fullshow";
      const tracks = Array.isArray(ep.tracks) ? ep.tracks : [];

      // build track list (must have at least 1 valid url)
      const trackList = tracks
        .map((t) => ({
          title: safeText(t && t.title),
          url: safeText(t && t.url),
          id: ytIdFrom(t && t.url),
        }))
        .filter((t) => t.id);

      if (!trackList.length) return;

      out.push({
        id: `ep_${idx}_${title.replace(/\s+/g, "_").slice(0, 30)}`,
        title,
        artist,
        year,
        mode,
        tracks: trackList,
      });
    });
    return out;
  }

  const sessions = normalizeEpisodes(EPISODES);

  if (status) status.textContent = sessions.length ? `Loaded ${sessions.length} sessions` : "No sessions found";

  if (!list) {
    logLine("Missing list container (#episodes).");
    return;
  }

  // ---------- YouTube Player API wiring ----------
  let ytPlayer = null;
  let ytReady = false;
  let pendingPlay = null;

  // Current queue state
  let currentSession = null;
  let currentIndex = 0;

  function setTitleLine(text) {
    if (playerTitle) playerTitle.textContent = text || "Tap a session to play";
  }

  function setNowPlayingLine(text) {
    if (nowPlayingLine) nowPlayingLine.textContent = text || "Ready.";
  }

  function playVideoById(id) {
    if (!id) return;
    if (!ytReady || !ytPlayer) {
      pendingPlay = { kind: "id", id };
      return;
    }
    try {
      // This is called from a user tap (gesture), so it should actually play.
      ytPlayer.loadVideoById(id);
    } catch (e) {
      logLine("loadVideoById failed: " + e);
    }
  }

  function startSession(session, trackIdx) {
    currentSession = session;
    currentIndex = Math.max(0, Math.min(trackIdx || 0, session.tracks.length - 1));

    const t = session.tracks[currentIndex];
    const label =
      session.mode === "queue"
        ? `${session.title} — Track ${currentIndex + 1} (${currentIndex + 1}/${session.tracks.length})`
        : session.title;

    setTitleLine(label);
    setNowPlayingLine("Playing now.");

    playVideoById(t.id);
  }

  function nextInQueue() {
    if (!currentSession || currentSession.mode !== "queue") return;
    if (currentSession.tracks.length <= 1) return;

    currentIndex += 1;
    if (currentIndex >= currentSession.tracks.length) currentIndex = 0;

    const t = currentSession.tracks[currentIndex];
    const label = `${currentSession.title} — Track ${currentIndex + 1} (${currentIndex + 1}/${currentSession.tracks.length})`;
    setTitleLine(label);
    setNowPlayingLine("Playing now.");
    playVideoById(t.id);
  }

  // YT API callback
  window.onYouTubeIframeAPIReady = function () {
    ytReady = true;

    ytPlayer = new YT.Player("playerFrame", {
      width: "100%",
      height: "100%",
      videoId: "", // start blank
      playerVars: {
        autoplay: 0,              // we start only after user taps a session
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        iv_load_policy: 3,
        origin: location.origin
      },
      events: {
        onReady: function () {
          logLine("YT Player ready");
          setNowPlayingLine("Ready.");

          // If something tried to play before ready, do it now (after ready)
          if (pendingPlay && pendingPlay.kind === "id") {
            const id = pendingPlay.id;
            pendingPlay = null;
            try { ytPlayer.loadVideoById(id); } catch (e) {}
          }
        },
        onStateChange: function (e) {
          // Auto-advance ONLY for queue mode when a video ends
          if (e && e.data === YT.PlayerState.ENDED) {
            nextInQueue();
          }
        },
        onError: function (e) {
          logLine("YT error: " + (e && e.data));
        }
      }
    });
  };

  // ---------- Render cards ----------
  list.innerHTML = "";

  sessions.forEach((s) => {
    const meta = [s.artist, s.year].filter(Boolean).join(" • ");
    const small =
      s.mode === "queue"
        ? `${s.tracks.length} tracks`
        : "Full session";

    const card = el("div", { class: "ep", tabindex: "0", "data-id": s.id }, [
      el("div", { class: "epHead" }, [
        el("div", {}, [
          el("div", { class: "epTitle" }, s.title),
          el("div", { class: "epMeta" }, meta),
          el("div", { class: "epSmall" }, small),
        ]),
        el("div", { class: "chev", "aria-hidden": "true" }, "›"),
      ]),
    ]);

    const play = () => {
      // Must be a user gesture. This is exactly why autoplay becomes reliable.
      startSession(s, 0);
    };

    card.addEventListener("click", play);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        play();
      }
    });

    list.appendChild(card);
  });

  logLine("Debug = " + DEBUG);
  logLine("EPISODES length = " + EPISODES.length);
  logLine("Sessions rendered = " + sessions.length);
})();
