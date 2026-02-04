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
    if (DEBUG) console.log("[STU]", line);
  }
  function safeText(s) {
    return (s == null ? "" : String(s)).trim();
  }

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
  function ua() {
    return navigator.userAgent || "";
  }
  function isOculus() {
    return /OculusBrowser/i.test(ua());
  }
  function isLikelyTV() {
    const U = ua();
    const tvUA =
      /SmartTV|SMART-TV|HbbTV|NetCast|Viera|AFT|CrKey|Roku|Tizen|Web0S|Android TV|GoogleTV|BRAVIA|SHIELD/i.test(U);
    const bigScreen = Math.max(window.innerWidth, window.innerHeight) >= 1100;
    return (tvUA || bigScreen) && !isOculus();
  }
  const IS_TV = isLikelyTV();

  // =========================
  // YouTube URLs
  // =========================
  function ytWatchUrl(id) {
    return "https://www.youtube.com/watch?v=" + encodeURIComponent(id);
  }

  // YouTube queue URL (this preserves your stitched queues!)
  function ytQueueUrlFromIds(ids) {
    const clean = (ids || []).map((x) => String(x || "").trim()).filter(Boolean);
    if (!clean.length) return "";
    // YouTube queue link:
    // https://www.youtube.com/watch_videos?video_ids=ID1,ID2,ID3
    return "https://www.youtube.com/watch_videos?video_ids=" + clean.map(encodeURIComponent).join(",");
  }

  // Android / Shield intent handoff (opens YouTube app)
  function ytIntentUrlFromHttps(httpsUrl) {
    // Convert https://www.youtube.com/... to intent://www.youtube.com/...#Intent...
    // Works well on Android TV / Shield
    const stripped = String(httpsUrl).replace(/^https?:\/\//i, "");
    return "intent://" + stripped + "#Intent;scheme=https;package=com.google.android.youtube;end";
  }

  function openExternalUrl(url) {
    if (!url) return;

    const useIntent = /Android/i.test(ua()) && !isOculus();

    if (useIntent) {
      try {
        window.location.href = ytIntentUrlFromHttps(url);
      } catch {}
      setTimeout(() => {
        try {
          window.location.href = url;
        } catch {}
      }, 600);
      return;
    }

    try {
      window.location.href = url;
    } catch {}
  }

  function openExternalVideo(id) {
    if (!id) return;
    openExternalUrl(ytWatchUrl(id));
  }

  // =========================
  // Fallback overlay in player (for devices that block embeds)
  // =========================
  function hideYTFallback() {
    const fb = document.getElementById("ytFallback");
    if (fb) fb.style.display = "none";
  }

  function showYTFallback(openUrl, reasonText) {
    if (!openUrl) return;

    let fb = document.getElementById("ytFallback");
    if (!fb) {
      fb = document.createElement("div");
      fb.id = "ytFallback";
      fb.className = "ytFallback";
      fb.style.cssText = `
        position:absolute; inset:0; display:none; place-items:center;
        background:rgba(0,0,0,.65); z-index:50;
      `;
      fb.innerHTML = `
        <div class="ytFallbackCard" style="
          width:min(520px,92%); border-radius:18px; padding:16px 16px 14px;
          background:rgba(18,18,22,.92);
          border:1px solid rgba(255,255,255,.10);
          box-shadow:0 18px 60px rgba(0,0,0,.55);
          text-align:left;
        ">
          <div class="ytFallbackTitle" style="font-weight:900; font-size:18px; color:rgba(255,255,255,.92);">
            Open in YouTube
          </div>
          <div class="ytFallbackText" id="ytFallbackReason" style="margin-top:6px; color:rgba(255,255,255,.75); line-height:1.35;"></div>
          <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">
            <a class="ytFallbackBtn" id="ytFallbackLink" target="_blank" rel="noopener"
              style="
                display:inline-flex; align-items:center; justify-content:center;
                padding:10px 14px; border-radius:999px;
                background:rgba(140,255,140,.18);
                border:1px solid rgba(140,255,140,.35);
                color:rgba(255,255,255,.92);
                font-weight:900; text-decoration:none;
              "
            >Open</a>
            <button id="ytFallbackOpenNow" type="button"
              style="
                display:inline-flex; align-items:center; justify-content:center;
                padding:10px 14px; border-radius:999px;
                background:rgba(255,255,255,.08);
                border:1px solid rgba(255,255,255,.14);
                color:rgba(255,255,255,.9);
                font-weight:900; cursor:pointer;
              "
            >Open now</button>
          </div>
        </div>
      `;

      const shell =
        document.querySelector(".playerFrameWrap") ||
        document.querySelector(".player-shell") ||
        document.getElementById("playerWrap");

      if (shell) {
        try {
          shell.style.position = shell.style.position || "relative";
        } catch {}
        shell.appendChild(fb);
      }
    }

    const reason = fb.querySelector("#ytFallbackReason");
    const link = fb.querySelector("#ytFallbackLink");
    const btnNow = fb.querySelector("#ytFallbackOpenNow");

    if (reason) reason.textContent = reasonText || "This device blocked embedded playback.";
    if (link) link.href = openUrl;
    if (btnNow) btnNow.onclick = () => openExternalUrl(openUrl);

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
      if (IS_TV) {
        openSessionsOverlay();
        return;
      }

      setFocusMode(false);
      stopPlayAll();

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

  const playerTitle = el("div", { id: "nowPlayingTitle", class: "now-playing-title" }, "Tap a session to play");

  // NEW: TV button row (shows on all devices, helpful on Shield)
  const actionsRow = el("div", { class: "playerActions", id: "playerActions" }, []);
  actionsRow.style.cssText = `
    display:flex; gap:10px; flex-wrap:wrap;
    padding: 0 14px 12px;
  `;

  const castBtn = el("button", { id: "castToTvBtn", type: "button" }, "📺 Watch on TV");
  castBtn.style.cssText = `
    border:1px solid rgba(255,255,255,.14);
    background: rgba(0,0,0,.20);
    color: rgba(255,255,255,.92);
    font-weight: 900;
    border-radius: 999px;
    padding: 10px 14px;
    cursor: pointer;
  `;
  castBtn.disabled = true;
  castBtn.title = "Opens the current session in the YouTube app (queues stay stitched).";

  const nowLine = el("div", { class: "nowPlaying", id: "nowPlayingLine" }, "Ready.");
  const playerMount = el("div", { id: "playerFrame", class: "player-frame" });

  const tv = el("div", { class: "tvFrame" }, [
    el("div", { class: "tvTopBar" }, [
      el("div", { class: "tvLED" }, ""),
      el("div", { class: "tvLabel" }, "STRIPPED & TURNED UP"),
      el("div", { class: "tvKnob" }, ""),
    ]),
    el("div", { class: "playerFrameWrap" }, el("div", { class: "player-shell" }, playerMount)),
    nowLine,
  ]);

  playerWrap.className = "player-wrap";
  playerWrap.appendChild(playerTitle);
  playerWrap.appendChild(actionsRow);
  actionsRow.appendChild(castBtn);
  playerWrap.appendChild(tv);

  ensureFocusButton();
  setFocusMode(false);

  function setTitleLine(t) {
    playerTitle.textContent = t || "Tap a session to play";
  }
  function setNow(t) {
    nowLine.textContent = t || "Ready.";
  }

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
    if (!playAllFlat.length) {
      stopPlayAll();
      return;
    }
    playAllPos += 1;
    if (playAllPos >= playAllFlat.length) playAllPos = 0;
    const { sIndex, tIndex } = playAllFlat[playAllPos];
    startSession(sessions[sIndex], tIndex, { fromPlayAll: true, noScroll: true });
  }

  // =========================
  // TV handoff (keeps stitched queues)
  // =========================
  function getCurrentSessionOpenUrl() {
    if (!currentSession) return "";

    // If queue session, build queue URL of ALL ids
    if (currentSession.mode === "queue") {
      const ids = currentSession.tracks.map((t) => t.id).filter(Boolean);
      return ytQueueUrlFromIds(ids);
    }

    // Fullshow: open current track id
    const id =
      currentSession &&
      currentSession.tracks &&
      currentSession.tracks[currentIndex] &&
      currentSession.tracks[currentIndex].id;

    return id ? ytWatchUrl(id) : "";
  }

  function updateCastBtnState() {
    const url = getCurrentSessionOpenUrl();
    castBtn.disabled = !url;
  }

  castBtn.addEventListener("click", () => {
    const url = getCurrentSessionOpenUrl();
    if (!url) return;

    // On TV, this is THE move (no fighting the iframe controls).
    setNow("Opening in YouTube…");
    showYTFallback(url, "Opening the session in the YouTube app. Queues will autoplay.");
    openExternalUrl(url);
  });

  // =========================
  // Playback
  // =========================
  function playById(id) {
    if (!id) return;

    // Prefer embed everywhere; fallback overlay if blocked.
    if (!ytPlayer) {
      showYTFallback(ytWatchUrl(id), "Player is still loading. If it doesn’t start, open in YouTube.");
      return;
    }

    try {
      hideYTFallback();
      ytPlayer.loadVideoById(id);
    } catch (e) {
      logLine("loadVideoById failed");
      showYTFallback(ytWatchUrl(id), "This device blocked embedded playback. Open in YouTube.");
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

    setFocusMode(true);
    closeSessionsOverlay();

    updateCastBtnState();

    const id = session.tracks[currentIndex].id;

    // If TV, you can still embed, but the user hates the controls.
    // We do NOT auto-jump to YouTube (because you want normal devices to keep working),
    // but the "📺 Watch on TV" button is always ready.
    playById(id);

    if (!opts.noScroll) {
      try {
        playerWrap.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {}
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
    updateCastBtnState();
    playById(currentSession.tracks[currentIndex].id);
  }

  // =========================
  // YouTube iframe API
  // =========================
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
            if (currentSession && currentSession.mode === "queue") {
              nextInQueue();
              return;
            }
            if (playAllEnabled) {
              nextInPlayAll();
              return;
            }
          }
        },
        onError: function (e) {
          logLine("YT error: " + (e && e.data));
          setNow("This device blocked embedded playback.");

          const url = getCurrentSessionOpenUrl() || "";

          showYTFallback(url, "Embed blocked on this browser/device. Open in YouTube.");
        },
      },
    });
  };

  if (window.YT && window.YT.Player) {
    window.onYouTubeIframeAPIReady();
  }

  // =========================
  // TV-safe Sessions Overlay (big clickable list on top)
  // =========================
  let overlayEl = null;
  let overlayBody = null;

  function ensureSessionsOverlay() {
    if (overlayEl) return;

    overlayEl = document.createElement("div");
    overlayEl.id = "sessionOverlay";
    overlayEl.style.cssText = `
      position:fixed; inset:0; z-index:9999; display:none; place-items:center;
      padding:24px; background:rgba(0,0,0,.82); backdrop-filter:blur(6px);
    `;

    overlayEl.innerHTML = `
      <div style="
        width:min(1100px,92vw); max-height:86vh; overflow:hidden;
        border-radius:24px; background:rgba(25,25,28,.92);
        border:1px solid rgba(255,255,255,.08);
        box-shadow:0 20px 70px rgba(0,0,0,.55);
      ">
        <div style="
          display:flex; align-items:center; justify-content:space-between; gap:12px;
          padding:16px 18px; border-bottom:1px solid rgba(255,255,255,.08);
        ">
          <div style="font-size:18px; font-weight:900; color:rgba(255,255,255,.92);">Choose a session</div>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button id="overlayStopPlayAll" type="button" style="
              border:1px solid rgba(255,255,255,.15); background:rgba(255,255,255,.06);
              color:rgba(255,255,255,.9); border-radius:999px; padding:10px 14px;
              font-weight:900; cursor:pointer;
            ">Stop Play All</button>
            <button id="closeSessionsOverlay" type="button" style="
              border:1px solid rgba(255,255,255,.15); background:rgba(255,255,255,.06);
              color:rgba(255,255,255,.9); border-radius:999px; padding:10px 14px;
              font-weight:900; cursor:pointer;
            ">Close</button>
          </div>
        </div>
        <div id="sessionsOverlayBody" style="padding:14px; max-height:calc(86vh - 62px); overflow:auto;"></div>
      </div>
    `;

    document.body.appendChild(overlayEl);
    overlayBody = document.getElementById("sessionsOverlayBody");

    document.getElementById("closeSessionsOverlay").addEventListener("click", closeSessionsOverlay);
    document.getElementById("overlayStopPlayAll").addEventListener("click", () => {
      stopPlayAll();
      setNow("Play All stopped.");
    });

    overlayEl.addEventListener("click", (e) => {
      if (e.target === overlayEl) closeSessionsOverlay();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSessionsOverlay();
    });
  }

  function openSessionsOverlay() {
    ensureSessionsOverlay();
    overlayBody.innerHTML = "";

    overlayBody.appendChild(buildOverlayCard_PlayAll());
    sessions.forEach((s) => overlayBody.appendChild(buildOverlayCard_Session(s)));

    overlayEl.style.display = "grid";

    const first = overlayBody.querySelector(".ep");
    if (first) first.focus();
  }

  function closeSessionsOverlay() {
    if (overlayEl) overlayEl.style.display = "none";
  }

  function buildOverlayCard_PlayAll() {
    if (!sessions.length) return document.createElement("div");

    const featured = sessions[0];
    const meta = [featured.artist, featured.year].filter(Boolean).join(" • ");

    const card = el("div", { class: "ep epFeatured", tabindex: "0" }, [
      el("div", { class: "epHead" }, [
        el("div", {}, [
          el("div", { class: "epTitle" }, "Play All — Autoplay Everything"),
          el(
            "div",
            { class: "epMeta" },
            meta ? `Starts with: ${featured.title} • ${meta}` : `Starts with: ${featured.title}`
          ),
          el("div", { class: "epSmall" }, "Hands-free mode: it keeps rolling."),
        ]),
        el("div", { class: "chev", "aria-hidden": "true" }, "›"),
      ]),
    ]);

    const playAll = () => {
      closeSessionsOverlay();
      startPlayAll(true);
    };

    card.addEventListener("click", playAll);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        playAll();
      }
    });

    return card;
  }

  function buildOverlayCard_Session(s) {
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

    const play = () => {
      closeSessionsOverlay();
      startSession(s, 0);
    };

    card.addEventListener("click", play);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        play();
      }
    });

    return card;
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
          el(
            "div",
            { class: "epMeta" },
            meta ? `Starts with: ${featured.title} • ${meta}` : `Starts with: ${featured.title}`
          ),
          el("div", { class: "epSmall" }, IS_TV ? "Tip: use 📺 Watch on TV for the smooth experience." : "Hands-free mode: it keeps rolling."),
        ]),
        el("div", { class: "chev", "aria-hidden": "true" }, "›"),
      ]),
    ]);

    const playAll = () => startPlayAll(true);

    card.addEventListener("click", playAll);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        playAll();
      }
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
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        play();
      }
    });

    list.appendChild(card);
  });

  // Start state
  updateCastBtnState();
  setNow(IS_TV ? "Tip: Use 📺 Watch on TV for Shield/TV." : "Ready.");
})();
