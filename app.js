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

  function logLine(line) { if (DEBUG) console.log("[STU]", line); }
  function safeText(s) { return (s == null ? "" : String(s)).trim(); }

  function el(tag, attrs = {}, kids = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
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
    try {
      const parsed = new URL(u);
      if (parsed.hostname.includes("youtu.be")) return parsed.pathname.replace("/", "").trim();
      return parsed.searchParams.get("v") || "";
    } catch {
      const m1 = u.match(/v=([a-zA-Z0-9_-]{6,})/);
      const m2 = u.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
      return (m1 && m1[1]) || (m2 && m2[1]) || "";
    }
  }

  // =========================
  // Focus Mode (player prevails)
  // =========================
  function ensureFocusButton() {
    if (document.getElementById("focusToggleBtn")) return;

    const btn = document.createElement("button");
    btn.id = "focusToggleBtn";
    btn.className = "focusToggleBtn";
    btn.type = "button";
    btn.innerHTML = `<span class="dot"></span> Change session`;

    btn.addEventListener("click", () => {
      setFocusMode(false);
      const sessionsEl = document.getElementById("sessionsList") || document.getElementById("episodes") || list;
      if (sessionsEl) sessionsEl.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // Place button right above the playerWrap (so it feels like a screen control)
    const playerWrapEl = document.getElementById("playerWrap");
    if (playerWrapEl && playerWrapEl.parentNode) {
      playerWrapEl.parentNode.insertBefore(btn, playerWrapEl);
    } else {
      // fallback: shove it at top of main
      main.insertBefore(btn, main.firstChild);
    }
  }

  function setFocusMode(on) {
    ensureFocusButton();
    document.body.classList.toggle("focusMode", !!on);

    const btn = document.getElementById("focusToggleBtn");
    if (btn) btn.style.display = on ? "inline-flex" : "none";
  }

  // Build player UI shell
  let playerWrap = $("#playerWrap");
  if (!playerWrap) {
    playerWrap = el("section", { id: "playerWrap" });
    main.insertBefore(playerWrap, main.firstChild);
  }
  playerWrap.innerHTML = "";

  const playerTitle = el("div", { id: "nowPlayingTitle", class: "now-playing-title" }, "Tap a session to play");
  const playerMount = el("div", { id: "playerFrame", class: "player-frame" });

  const nowLine = el("div", { class: "nowPlaying", id: "nowPlayingLine" }, "Ready.");

  const tv = el("div", { class: "tvFrame" }, [
    el("div", { class: "tvTopBar" }, [
      el("div", { class: "tvLED" }, ""),
      el("div", { class: "tvLabel" }, "STRIPPED & TURNED UP"),
      el("div", { class: "tvKnob" }, ""),
    ]),
    el("div", { class: "playerFrameWrap" }, el("div", { class: "player-shell" }, playerMount)),
    nowLine
  ]);

  playerWrap.className = "player-wrap";
  playerWrap.appendChild(playerTitle);
  playerWrap.appendChild(tv);

  // Make sure focus button exists, but hidden until they pick a session
  ensureFocusButton();
  setFocusMode(false);

  function setTitleLine(t) { playerTitle.textContent = t || "Tap a session to play"; }
  function setNow(t) { nowLine.textContent = t || "Ready."; }

  function normalizeEpisodes(arr) {
    const out = [];
    (arr || []).forEach((ep, idx) => {
      if (!ep || typeof ep !== "object") return;

      const title = safeText(ep.title) || `Session ${idx + 1}`;
      const artist = safeText(ep.artist) || "";
      const year = ep.year != null ? String(ep.year) : "";
      const mode = safeText(ep.mode) || "fullshow";
      const tracks = Array.isArray(ep.tracks) ? ep.tracks : [];

      const trackList = tracks
        .map((t) => ({
          title: safeText(t && t.title),
          url: safeText(t && t.url),
          id: ytIdFrom(t && t.url),
        }))
        .filter((t) => t.id);

      if (!trackList.length) return;

      out.push({ title, artist, year, mode, tracks: trackList });
    });
    return out;
  }

  const sessions = normalizeEpisodes(EPISODES);
  if (status) status.textContent = sessions.length ? `Loaded ${sessions.length} sessions` : "No sessions found";

  if (!list) return;
  list.innerHTML = "";

  // --- YouTube API Player ---
  let ytPlayer = null;
  let currentSession = null;
  let currentIndex = 0;

  function playById(id) {
    if (!ytPlayer || !id) return;
    try { ytPlayer.loadVideoById(id); } catch (e) { logLine("loadVideoById failed"); }
  }

  function startSession(session, idx) {
    currentSession = session;
    currentIndex = Math.max(0, Math.min(idx || 0, session.tracks.length - 1));

    const label =
      session.mode === "queue"
        ? `${session.title} — Track ${currentIndex + 1} (${currentIndex + 1}/${session.tracks.length})`
        : session.title;

    setTitleLine(label);
    setNow("Playing now.");

    // 🔥 Focus Mode ON when they choose a session
    setFocusMode(true);

    playById(session.tracks[currentIndex].id);

    // Smooth scroll up to player after selection (feels like a page transition)
    try {
      playerWrap.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {}
  }

  function nextInQueue() {
    if (!currentSession || currentSession.mode !== "queue") return;
    if (currentSession.tracks.length <= 1) return;

    currentIndex += 1;
    if (currentIndex >= currentSession.tracks.length) currentIndex = 0;

    const label = `${currentSession.title} — Track ${currentIndex + 1} (${currentIndex + 1}/${currentSession.tracks.length})`;
    setTitleLine(label);
    setNow("Playing now.");
    playById(currentSession.tracks[currentIndex].id);
  }

  // ✅ Define callback IMMEDIATELY (this is the fix)
  window.onYouTubeIframeAPIReady = function () {
    logLine("YT API ready");

    ytPlayer = new YT.Player("playerFrame", {
      width: "100%",
      height: "100%",
      videoId: "",
      playerVars: {
        autoplay: 0,
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        iv_load_policy: 3
      },
      events: {
        onReady: function () {
          logLine("YT Player ready");
          setNow("Ready.");
        },
        onStateChange: function (e) {
          if (e && e.data === YT.PlayerState.ENDED) nextInQueue();
        },
        onError: function (e) {
          logLine("YT error: " + (e && e.data));
        }
      }
    });
  };

  // ✅ Race-condition safety: if YT already exists, initialize now
  if (window.YT && window.YT.Player) {
    window.onYouTubeIframeAPIReady();
  }

  // Render session cards
  sessions.forEach((s) => {
    const meta = [s.artist, s.year].filter(Boolean).join(" • ");
    const small = s.mode === "queue" ? `${s.tracks.length} tracks` : "Full session";

    const card = el("div", { class: "ep", tabindex: "0" }, [
      el("div", { class: "epHead" }, [
        el("div", {}, [
          el("div", { class: "epTitle" }, s.title),
          el("div", { class: "epMeta" }, meta),
          el("div", { class: "epSmall" }, small),
        ]),
        el("div", { class: "chev", "aria-hidden": "true" }, "›"),
      ]),
    ]);

    const play = () => startSession(s, 0);

    card.addEventListener("click", play);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        play();
      }
    });

    list.appendChild(card);
  });

})();
