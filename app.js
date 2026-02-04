/* Joey’s Acoustic Corner — app.js (SAFE + STABLE)
   - Queue stitching
   - Play All
   - Player drawer (show/hide)
   - Handles slow YouTube API load without crashing
*/

(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const AUTO_PLAYALL = params.get("autoplay") === "1";

  const EPISODES_RAW =
    Array.isArray(window.EPISODES) ? window.EPISODES :
    Array.isArray(window.episodes) ? window.episodes :
    [];

  const $ = (sel) => document.querySelector(sel);

  const listEl = $("#episodes");
  const statusEl = $("#status");
  const playerWrapEl = $("#playerWrap") || null;

  // ---------- helpers ----------
  const safeText = (v) => (v == null ? "" : String(v)).trim();

  function ytKeyFromUrl(url) {
    const u = safeText(url);
    if (!u) return "";

    try {
      const parsed = new URL(u);

      // playlist-only link => "LIST:<id>"
      const listId = parsed.searchParams.get("list");
      const vid = parsed.searchParams.get("v");

      if (listId && !vid) return `LIST:${listId}`;
      if (vid) return vid;

      // youtu.be/<id>
      if (parsed.hostname.includes("youtu.be")) {
        const id = parsed.pathname.replace("/", "").trim();
        return id || "";
      }
      return "";
    } catch {
      // fallback regex
      const m1 = u.match(/v=([a-zA-Z0-9_-]{6,})/);
      if (m1 && m1[1]) return m1[1];
      const m2 = u.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
      if (m2 && m2[1]) return m2[1];
      const m3 = u.match(/list=([a-zA-Z0-9_-]{6,})/);
      if (m3 && m3[1]) return `LIST:${m3[1]}`;
      return "";
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
        .map((t) => {
          const tTitle = safeText(t && t.title) || "Track";
          const tUrl = safeText(t && t.url);
          const key = ytKeyFromUrl(tUrl);
          return { title: tTitle, url: tUrl, key };
        })
        .filter((t) => !!t.key);

      if (!tracks.length) return;
      out.push({ title, artist, year, mode, tracks });
    });
    return out;
  }

  const SESSIONS = normalizeEpisodes(EPISODES_RAW);

  if (statusEl) {
    statusEl.textContent = SESSIONS.length ? `Loaded ${SESSIONS.length} sessions` : "No sessions found";
  }

  // ---------- Player Drawer UI (no crash if missing) ----------
  let drawerEls = {
    nowTitle: null,
    nowLine: null,
    toggleBtn: null
  };

  function setPlayerHidden(hidden) {
    document.body.classList.toggle("playerHidden", !!hidden);
    if (drawerEls.toggleBtn) drawerEls.toggleBtn.textContent = hidden ? "Show" : "Hide";
    try { localStorage.setItem("playerHidden", hidden ? "1" : "0"); } catch {}
  }

  function buildPlayerDrawer() {
    if (!playerWrapEl) return;

    playerWrapEl.innerHTML = `
      <div class="playerDrawer">
        <div class="playerCard">
          <div class="playerBar">
            <div class="playerTitle" id="nowTitle">Tap a session to play</div>
            <div class="playerBtns">
              <button class="playerBtn" id="togglePlayerBtn" type="button">Hide</button>
            </div>
          </div>

          <div class="playerFrameWrap">
            <div id="playerFrame"></div>
          </div>

          <div id="nowPlayingLine">Ready.</div>
        </div>
      </div>
    `;

    drawerEls.nowTitle = $("#nowTitle");
    drawerEls.nowLine = $("#nowPlayingLine");
    drawerEls.toggleBtn = $("#togglePlayerBtn");

    if (drawerEls.toggleBtn) {
      drawerEls.toggleBtn.addEventListener("click", () => {
        const hidden = document.body.classList.contains("playerHidden");
        setPlayerHidden(!hidden);
      });
    }

    // restore last state
    let remembered = false;
    try { remembered = localStorage.getItem("playerHidden") === "1"; } catch {}
    setPlayerHidden(remembered);
  }

  function setNowTitle(t) {
    if (drawerEls.nowTitle) drawerEls.nowTitle.textContent = t || "Tap a session to play";
  }
  function setNowLine(t) {
    if (drawerEls.nowLine) drawerEls.nowLine.textContent = t || "Ready.";
  }

  buildPlayerDrawer();

  // ---------- YouTube player (safe init) ----------
  let ytPlayer = null;
  let ytReady = false;
  let pendingPlay = null; // { sessionIndex, trackIndex }

  // current playback state
  let currentSessionIndex = -1;
  let currentTrackIndex = 0;

  // play-all state
  let playAllEnabled = false;
  let playAllFlat = [];
  let playAllPos = 0;

  function ensurePlayerVisible() {
    setPlayerHidden(false);
  }

  function buildPlayAllFlatList() {
    const flat = [];
    for (let si = 0; si < SESSIONS.length; si++) {
      const s = SESSIONS[si];
      for (let ti = 0; ti < s.tracks.length; ti++) {
        flat.push({ si, ti });
      }
    }
    return flat;
  }

  function playKey(key) {
    if (!ytPlayer || !ytReady) return false;
    if (!key) return false;

    // playlist support
    if (key.startsWith("LIST:")) {
      const listId = key.slice(5);
      try {
        ytPlayer.loadPlaylist({ listType: "playlist", list: listId });
        return true;
      } catch {
        // fallback: open playlist in YouTube
        window.location.href = `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`;
        return true;
      }
    }

    try {
      ytPlayer.loadVideoById(key);
      return true;
    } catch {
      return false;
    }
  }

  function startSession(sessionIndex, trackIndex = 0) {
    if (!SESSIONS[sessionIndex]) return;

    currentSessionIndex = sessionIndex;
    const session = SESSIONS[sessionIndex];

    const ti = Math.max(0, Math.min(trackIndex, session.tracks.length - 1));
    currentTrackIndex = ti;

    const meta = [session.artist, session.year].filter(Boolean).join(" • ");
    if (session.mode === "queue") {
      setNowTitle(`${session.title} — Track ${ti + 1}/${session.tracks.length}`);
    } else {
      setNowTitle(session.title);
    }
    setNowLine(meta ? `Playing now. • ${meta}` : "Playing now.");

    ensurePlayerVisible();

    const key = session.tracks[ti].key;

    // if yt not ready yet, queue it
    if (!ytReady) {
      pendingPlay = { sessionIndex, trackIndex: ti };
      return;
    }

    const ok = playKey(key);
    if (!ok) {
      setNowLine("Embed blocked or player not ready. Try opening in YouTube.");
    }
  }

  function nextInQueue() {
    const session = SESSIONS[currentSessionIndex];
    if (!session || session.mode !== "queue") return;

    if (session.tracks.length <= 1) return;

    currentTrackIndex = (currentTrackIndex + 1) % session.tracks.length;

    setNowTitle(`${session.title} — Track ${currentTrackIndex + 1}/${session.tracks.length}`);
    const key = session.tracks[currentTrackIndex].key;

    if (!ytReady) {
      pendingPlay = { sessionIndex: currentSessionIndex, trackIndex: currentTrackIndex };
      return;
    }

    playKey(key);
  }

  function startPlayAll() {
    playAllFlat = buildPlayAllFlatList();
    if (!playAllFlat.length) return;

    playAllEnabled = true;
    playAllPos = 0;

    const { si, ti } = playAllFlat[playAllPos];
    startSession(si, ti);
  }

  function nextInPlayAll() {
    if (!playAllEnabled || !playAllFlat.length) return;

    playAllPos = (playAllPos + 1) % playAllFlat.length;
    const { si, ti } = playAllFlat[playAllPos];
    startSession(si, ti);
  }

  // YouTube API calls this globally
  window.onYouTubeIframeAPIReady = function () {
    // if playerFrame missing, don’t crash
    const frameHost = $("#playerFrame");
    if (!frameHost) return;

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
          ytReady = true;
          setNowLine("Ready.");

          // if something was queued before API loaded
          if (pendingPlay) {
            const { sessionIndex, trackIndex } = pendingPlay;
            pendingPlay = null;
            startSession(sessionIndex, trackIndex);
          }

          // auto playall if requested
          if (AUTO_PLAYALL) startPlayAll();
        },
        onStateChange: function (e) {
          if (!e) return;
          if (e.data === YT.PlayerState.ENDED) {
            const session = SESSIONS[currentSessionIndex];
            if (session && session.mode === "queue") nextInQueue();
            else if (playAllEnabled) nextInPlayAll();
          }
        }
      }
    });
  };

  // ---------- Render list ----------
  if (!listEl) return;
  listEl.innerHTML = "";

  function renderCard(title, meta, small, onGo, featured = false) {
    const card = document.createElement("div");
    card.className = featured ? "ep epFeatured" : "ep";
    card.tabIndex = 0;

    card.innerHTML = `
      <div class="epHead">
        <div>
          <div class="epTitle">${title}</div>
          <div class="epMeta">${meta || ""}</div>
          <div class="epSmall">${small || ""}</div>
        </div>
        <div class="chev" aria-hidden="true">›</div>
      </div>
    `;

    card.addEventListener("click", onGo);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onGo();
      }
    });

    listEl.appendChild(card);
  }

  // Play All card
  if (SESSIONS.length) {
    const first = SESSIONS[0];
    const meta = [first.artist, first.year].filter(Boolean).join(" • ");
    renderCard(
      "Play All — Autoplay Everything",
      meta ? `Starts with: ${first.title} • ${meta}` : `Starts with: ${first.title}`,
      "Hands-free mode: keeps rolling.",
      () => startPlayAll(),
      true
    );
  }

  // Session cards
  SESSIONS.forEach((s, i) => {
    const meta = [s.artist, s.year].filter(Boolean).join(" • ");
    const small = s.mode === "queue" ? `${s.tracks.length} tracks (stitched)` : "Full session";
    renderCard(s.title, meta, small, () => startSession(i, 0), false);
  });
