/* STRIPPED & TURNED UP — app.js (LOCKED BASELINE v22)
   - Real YouTube Iframe API player (YT.Player)
   - Queue autoplay/auto-advance for mode:"queue"
   - Fullshow plays single video
   - One tap unlocks audio (required by browsers)
   - Highlights active session card
   - Updates #status
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

  const playerWrap = $("#playerWrap");
  const list = $("#episodes");
  const status = $("#status");

  const LS_LAST = "stu_last_session_v1";

  function logLine(line) {
    if (!DEBUG) return;
    console.log("[STU]", line);
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

  function normalizeEpisodes(arr) {
    const out = [];
    (arr || []).forEach((ep, idx) => {
      if (!ep || typeof ep !== "object") return;

      const title = safeText(ep.title) || `Session ${idx + 1}`;
      const artist = safeText(ep.artist) || "";
      const year = ep.year != null ? String(ep.year) : "";
      const mode = safeText(ep.mode) || "fullshow";
      const tracksRaw = Array.isArray(ep.tracks) ? ep.tracks : [];

      const tracks = tracksRaw
        .map((t, ti) => {
          const tTitle = safeText(t && t.title) || `Track ${ti + 1}`;
          const id = ytIdFrom(t && t.url);
          return id ? { title: tTitle, id } : null;
        })
        .filter(Boolean);

      if (!tracks.length) return;

      out.push({
        key: `s_${idx}_${title.replace(/\s+/g, "_").slice(0, 28)}`,
        title,
        artist,
        year,
        mode: mode === "queue" ? "queue" : "fullshow",
        tracks
      });
    });
    return out;
  }

  const sessions = normalizeEpisodes(EPISODES);

  if (status) status.textContent = sessions.length ? `Loaded ${sessions.length} sessions` : "No sessions found";

  if (!playerWrap) {
    logLine("Missing #playerWrap");
    return;
  }
  if (!list) {
    logLine("Missing #episodes container");
    return;
  }

  // ---------- Build player UI (clean + app-like) ----------
  playerWrap.className = "player-wrap";
  playerWrap.innerHTML = "";

  const nowTitle = el("div", { id: "nowPlayingTitle", class: "now-playing-title" }, "Tap a session to play");
  const shell = el("div", { class: "player-shell" }, [
    // this is where YT.Player mounts
    el("div", { id: "playerMount", style: "border-radius:18px; overflow:hidden; background:#000; width:100%; aspect-ratio:16/9;" })
  ]);

  // small helper button for when autoplay gets blocked mid-queue
  const resumeBtn = el("button", {
    id: "resumeBtn",
    style: `
      display:none;
      margin: 12px 14px 14px;
      padding: 10px 12px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.16);
      background: rgba(0,0,0,.25);
      color: rgba(255,255,255,.90);
      font-weight: 800;
      letter-spacing: .01em;
    `
  }, "Tap to resume audio");

  playerWrap.appendChild(nowTitle);
  playerWrap.appendChild(shell);
  playerWrap.appendChild(resumeBtn);

  // ---------- Render session cards ----------
  list.innerHTML = "";

  function setActiveCard(sessionKey) {
    const cards = list.querySelectorAll(".ep");
    cards.forEach((c) => c.classList.toggle("isActive", c.getAttribute("data-key") === sessionKey));
  }

  sessions.forEach((s) => {
    const meta = [s.artist, s.year].filter(Boolean).join(" • ");
    const small = s.mode === "queue" ? `${s.tracks.length} tracks` : "Full session";

    const card = el("div", { class: "ep", tabindex: "0", "data-key": s.key }, [
      el("div", { class: "epHead" }, [
        el("div", {}, [
          el("div", { class: "epTitle" }, s.title),
          el("div", { class: "epMeta" }, meta),
          el("div", { class: "epSmall" }, small),
        ]),
        el("div", { class: "chev", "aria-hidden": "true" }, "›"),
      ]),
    ]);

    card.addEventListener("click", () => startSession(s.key));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        startSession(s.key);
      }
    });

    list.appendChild(card);
  });

  // ---------- YouTube Player logic ----------
  let ytPlayer = null;
  let ytReady = false;

  let currentSession = null;
  let currentIndex = 0;
  let pendingSessionKey = null;

  function findSession(key) {
    return sessions.find((s) => s.key === key) || null;
  }

  function setNowPlayingText(text) {
    nowTitle.textContent = text || "Tap a session to play";
  }

  function showResume(show) {
    resumeBtn.style.display = show ? "" : "none";
  }

  function playTrackAt(index) {
    if (!currentSession) return;
    const track = currentSession.tracks[index];
    if (!track) return;

    currentIndex = index;

    const label =
      currentSession.mode === "queue"
        ? `${currentSession.title} — ${track.title} (${index + 1}/${currentSession.tracks.length})`
        : currentSession.title;

    setNowPlayingText(label);
    setActiveCard(currentSession.key);
    showResume(false);

    try {
      // loadVideoById triggers playback (subject to user-gesture rules)
      ytPlayer.loadVideoById({
        videoId: track.id,
        startSeconds: 0
      });
      // remember last session
      localStorage.setItem(LS_LAST, currentSession.key);
    } catch (e) {
      logLine("loadVideoById failed: " + (e && e.message ? e.message : e));
    }
  }

  function startSession(sessionKey) {
    const s = findSession(sessionKey);
    if (!s) return;

    currentSession = s;
    currentIndex = 0;

    if (!ytReady || !ytPlayer) {
      // if player isn't ready yet, queue it
      pendingSessionKey = sessionKey;
      setNowPlayingText("Player loading… tap again in a second.");
      setActiveCard(sessionKey);
      return;
    }

    playTrackAt(0);
  }

  // Resume button for when autoplay is blocked mid-queue
  resumeBtn.addEventListener("click", () => {
    if (!ytPlayer) return;
    showResume(false);
    // attempt to play current video again
    try {
      ytPlayer.playVideo();
    } catch {}
  });

  function onPlayerStateChange(e) {
    // 0 ended, 1 playing, 2 paused
    const state = e && typeof e.data === "number" ? e.data : null;

    // If ended and it's a queue, auto-advance
    if (state === 0 && currentSession && currentSession.mode === "queue") {
      const next = currentIndex + 1;
      if (next < currentSession.tracks.length) {
        playTrackAt(next);
      } else {
        setNowPlayingText("Queue finished. Tap another session.");
      }
      return;
    }

    // If paused unexpectedly during queue, offer resume
    if (state === 2 && currentSession && currentSession.mode === "queue") {
      showResume(true);
    }

    if (state === 1) {
      showResume(false);
    }
  }

  function initYTPlayer() {
    if (ytPlayer) return;

    if (!window.YT || !window.YT.Player) {
      logLine("YT API not ready yet… retrying");
      setTimeout(initYTPlayer, 150);
      return;
    }

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
        onReady: () => {
          ytReady = true;
          logLine("YT Player ready");

          // If we had a pending click before ready, play it now
          if (pendingSessionKey) {
            const key = pendingSessionKey;
            pendingSessionKey = null;
            startSession(key);
            return;
          }

          // Auto-restore last session (does NOT auto-play without user tap, but sets UI ready)
          const last = safeText(localStorage.getItem(LS_LAST));
          if (last && findSession(last)) {
            currentSession = findSession(last);
            setActiveCard(last);
            setNowPlayingText("Tap to resume last session");
          }
        },
        onStateChange: onPlayerStateChange
      }
    });
  }

  // If iframe_api calls this, hook in without fighting anything else
  const prevReady = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = function () {
    try {
      if (typeof prevReady === "function") prevReady();
    } catch {}
    initYTPlayer();
  };

  // In case the API loads before our override (rare), try init anyway
  initYTPlayer();

  logLine("Debug = " + DEBUG);
  logLine("EPISODES length = " + EPISODES.length);
  logLine("Sessions rendered = " + sessions.length);
})();
