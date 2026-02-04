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
  // Device detection
  // =========================
  function ua() { return navigator.userAgent || ""; }
  function isOculus() { return /OculusBrowser/i.test(ua()); }
  function isLikelyTV() {
    const U = ua();
    const tvUA =
      /SmartTV|SMART-TV|HbbTV|NetCast|Viera|AFT|CrKey|Roku|Tizen|Web0S|Android TV|GoogleTV|BRAVIA/i.test(U);
    const bigScreen = Math.max(window.innerWidth, window.innerHeight) >= 1100;
    return (tvUA || bigScreen) && !isOculus();
  }
  const IS_TV = isLikelyTV();

  function ytWatchUrl(id) {
    return "https://www.youtube.com/watch?v=" + encodeURIComponent(id);
  }

  // =========================
  // Collapsible Player (NEW)
  // =========================
  const PLAYER_STATE_KEY = "stu_player_collapsed_v1";

  function isCollapsed() {
    try { return sessionStorage.getItem(PLAYER_STATE_KEY) === "1"; } catch { return false; }
  }
  function setCollapsed(v) {
    try { sessionStorage.setItem(PLAYER_STATE_KEY, v ? "1" : "0"); } catch {}
    document.body.classList.toggle("playerCollapsed", !!v);
    syncPlayerToggleBtn();
  }
  function openPlayer() { setCollapsed(false); }
  function collapsePlayer() { setCollapsed(true); }
  function togglePlayer() { setCollapsed(!document.body.classList.contains("playerCollapsed")); }

  function syncPlayerToggleBtn() {
    const btn = document.getElementById("playerToggleBtn");
    if (!btn) return;
    const collapsed = document.body.classList.contains("playerCollapsed");
    btn.textContent = collapsed ? "Show Player" : "Hide Player";
    btn.setAttribute("aria-pressed", collapsed ? "true" : "false");
  }

  // =========================
  // Fallback overlay in player
  // =========================
  function hideYTFallback() {
    const fb = document.getElementById("ytFallback");
    if (fb) fb.style.display = "none";
  }

  function showYTFallback(id, reasonText) {
    if (!id) return;

    let fb = document.getElementById("ytFallback");
    if (!fb) {
      fb = document.createElement("div");
      fb.id = "ytFallback";
      fb.className = "ytFallback";
      fb.innerHTML = `
        <div class="ytFallbackCard">
          <div class="ytFallbackTitle">Open in YouTube</div>
          <div class="ytFallbackText" id="ytFallbackReason"></div>
          <div class="ytFallbackBtns">
            <a class="ytFallbackBtn" id="ytFallbackLink" target="_blank" rel="noopener">Open</a>
          </div>
        </div>
      `;
      const shell =
        document.querySelector(".playerFrameWrap") ||
        document.querySelector(".player-shell") ||
        document.getElementById("playerWrap");
      if (shell) shell.appendChild(fb);
    }

    const reason = fb.querySelector("#ytFallbackReason");
    const link = fb.querySelector("#ytFallbackLink");
    if (reason) reason.textContent = reasonText || "This device blocked embedded playback.";
    if (link) link.href = ytWatchUrl(id);

    fb.style.display = "grid";
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
      stopPlayAll();
      // When leaving focus mode, collapse player so it never blocks the list
      collapsePlayer();

      const sessionsEl =
        document.getElementById("sessionsList") ||
        document.getElementById("episodes") ||
        list;
      if (sessionsEl) sessionsEl.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    const playerWrapEl = document.getElementById("playerWrap");
    if (playerWrapEl && playerWrapEl.parentNode) {
      playerWrapEl.parentNode.insertBefore(btn, playerWrapEl);
    } else {
      main.insertBefore(btn, main.firstChild);
    }
  }

  function setFocusMode(on) {
    ensureFocusButton();
    document.body.classList.toggle("focusMode", !!on);
    const btn = document.getElementById("focusToggleBtn");
    if (btn) btn.style.display = on ? "inline-flex" : "none";
  }

  // =========================
  // Build player UI shell
  // =========================
  let playerWrap = $("#playerWrap");
  if (!playerWrap) {
    playerWrap = el("section", { id: "playerWrap" });
    main.insertBefore(playerWrap, main.firstChild);
  }
  playerWrap.innerHTML = "";

  // Title row with NEW toggle button
  const playerTitleRow = el("div", { class: "now-playing-row" }, [
    el("div", { id: "nowPlayingTitle", class: "now-playing-title" }, "Tap a session to play"),
    el("button", { id: "playerToggleBtn", class: "playerToggleBtn", type: "button" }, "Hide Player"),
  ]);

  const playerMount = el("div", { id: "playerFrame", class: "player-frame" });
  const nowLine = el("div", { class: "nowPlaying", id: "nowPlayingLine" }, "Ready.");

  const tv = el("div", { class: "tvFrame" }, [
    el("div", { class: "tvTopBar" }, [
      el("div", { class: "tvLED" }, ""),
      el("div", { class: "tvLabel" }, "JOEY’S ACOUSTIC CORNER"),
      el("div", { class: "tvKnob" }, ""),
    ]),
    el("div", { class: "playerFrameWrap" }, el("div", { class: "player-shell" }, playerMount)),
    nowLine,
  ]);

  playerWrap.className = "player-wrap";
  playerWrap.appendChild(playerTitleRow);
  playerWrap.appendChild(tv);

  ensureFocusButton();
  setFocusMode(false);

  // Apply remembered collapsed state on load
  setCollapsed(isCollapsed());

  $("#playerToggleBtn")?.addEventListener("click", () => {
    togglePlayer();
    // If user collapses player, don't stop playback (keeps audio going)
    // It simply stops blocking the page.
  });

  function setTitleLine(t) {
    const titleEl = document.getElementById("nowPlayingTitle");
    if (titleEl) titleEl.textContent = t || "Tap a session to play";
  }
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

  // =========================
  // PLAY ALL (Autoplay everything)
  // =========================
  let playAllEnabled = false;
  let playAllFlat = [];
  let playAllPos = 0;

  function buildPlayAllFlat() {
    const flat = [];
    for (let si = 0; si < sessions.length; si++) {
      const s = sessions[si];
      for (let ti = 0; ti < s.tracks.length; ti++) {
        flat.push({ sIndex: si, tIndex: ti });
      }
    }
    return flat;
  }

  function stopPlayAll() {
    playAllEnabled = false;
    playAllPos = 0;
    playAllFlat = [];
  }

  function startPlayAll(fromStart = true) {
    playAllFlat = buildPlayAllFlat();
    if (!playAllFlat.length) return;
    playAllEnabled = true;
    playAllPos = fromStart ? 0 : Math.max(0, Math.min(playAllPos, playAllFlat.length - 1));
    const { sIndex, tIndex } = playAllFlat[playAllPos];
    startSession(sessions[sIndex], tIndex, { fromPlayAll: true });
  }

  function nextInPlayAll() {
    if (!playAllEnabled) return;
    if (!playAllFlat.length) { stopPlayAll(); return; }
    playAllPos += 1;
    if (playAllPos >= playAllFlat.length) playAllPos = 0;
    const { sIndex, tIndex } = playAllFlat[playAllPos];
    startSession(sessions[sIndex], tIndex, { fromPlayAll: true, noScroll: true });
  }

  function playById(id) {
    if (!id) return;

    // If player isn't ready yet, show fallback
    if (!ytPlayer) {
      showYTFallback(id, "Player is still loading. If it doesn’t start, open in YouTube.");
      return;
    }

    try {
      hideYTFallback();
      ytPlayer.loadVideoById(id);
    } catch (e) {
      logLine("loadVideoById failed");
      showYTFallback(id, "This device blocked embedded playback. Open in YouTube.");
    }
  }

  function startSession(session, idx, opts) {
    opts = opts || {};
    if (!opts.fromPlayAll) stopPlayAll();

    currentSession = session;
    currentIndex = Math.max(0, Math.min(idx || 0, session.tracks.length - 1));

    const label =
      session.mode === "queue"
        ? `${session.title} — Track ${currentIndex + 1} (${currentIndex + 1}/${session.tracks.length})`
        : session.title;

    if (opts.fromPlayAll) {
      const meta = [session.artist, session.year].filter(Boolean).join(" • ");
      const trackLine = session.tracks.length > 1 ? ` — Track ${currentIndex + 1}/${session.tracks.length}` : "";
      setTitleLine(`${session.title}${trackLine}`);
      setNow(meta ? `Playing now. • ${meta}` : "Playing now.");
    } else {
      setTitleLine(label);
      setNow("Playing now.");
    }

    // ✅ NEW: auto-open player when starting anything
    openPlayer();

    // Keep focus mode on for the clean "now playing" view
    setFocusMode(true);

    const id = session.tracks[currentIndex].id;
    playById(id);

    if (!opts.noScroll) {
      try { playerWrap.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
    }
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
        iv_load_policy: 3,
      },
      events: {
        onReady: function () {
          logLine("YT Player ready");
          setNow("Ready.");
        },
        onStateChange: function (e) {
          if (!e) return;

          if (e.data === YT.PlayerState.PLAYING) hideYTFallback();

          if (e.data === YT.PlayerState.ENDED) {
            if (currentSession && currentSession.mode === "queue") { nextInQueue(); return; }
            if (playAllEnabled) { nextInPlayAll(); return; }
          }
        },
        onError: function (e) {
          logLine("YT error: " + (e && e.data));
          setNow("This device blocked embedded playback.");

          const id =
            currentSession &&
            currentSession.tracks &&
            currentSession.tracks[currentIndex] &&
            currentSession.tracks[currentIndex].id;

          showYTFallback(id, "Embed blocked on this browser/device. Open in YouTube.");
        },
      },
    });
  };

  if (window.YT && window.YT.Player) {
    window.onYouTubeIframeAPIReady();
  }

  // =========================
  // Render: Main list
  // =========================
  function renderPlayAllCard() {
    if (!sessions.length) return;
    const featured = sessions[0];
    const meta = [featured.artist, featured.year].filter(Boolean).join(" • ");

    const card = el("div", { class: "ep epFeatured", tabindex: "0" }, [
      el("div", { class: "epHead" }, [
        el("div", {}, [
          el("div", { class: "epTitle" }, "Play All — Autoplay Everything"),
          el("div", { class: "epMeta" }, meta ? `Starts with: ${featured.title} • ${meta}` : `Starts with: ${featured.title}`),
          el("div", { class: "epSmall" }, "Hands-free mode: it keeps rolling."),
        ]),
        el("div", { class: "chev", "aria-hidden": "true" }, "›"),
      ]),
    ]);

    const playAll = () => startPlayAll(true);

    card.addEventListener("click", playAll);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); playAll(); }
    });

    list.appendChild(card);
  }

  renderPlayAllCard();

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
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(); }
    });

    list.appendChild(card);
  });

})();
