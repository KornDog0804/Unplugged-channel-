/* Joey's Acoustic Corner — app.js (defensive + mobile-first)
   Expects: sessions.html has these IDs:
   #episodes, #playAllBtn, #loadMoreBtn, #status,
   #playerFrame, #playerToggleBtn,
   #watchOnTvBtn, #nowPlayingTitle, #nowPlayingLine,
   #npArtWrap, #npArt, #backNavBtn

   Deep-link auto-play: if the URL has ?play=<videoId> or
   ?playTitle=<title> (set by the home page's Featured cards), the
   matching show starts playing automatically once data loads.

   PLAYBACK ENGINE: uses the real YouTube IFrame Player API (loaded
   dynamically below) instead of just swapping the iframe's src. This
   is what lets us detect when a video actually ENDS so queues
   ("Stitched Streams", 3 Doors Down tribute, etc.) auto-advance to
   the next track.

   TV THEATER MODE: on TV devices, starting a video adds a
   `tvTheater` class to <body> and styles the player shell fullscreen.
   Exiting is unified through the browser history: entering theater
   pushes one dedicated history entry, and ANY Back (the on-screen
   "Exit Player" button, the remote's Back key, or the TV's native
   history-back) flows through popstate, which exits the player in a
   single press and lands back on the session list. A short guard
   absorbs the case where a TV fires BOTH a key event and a native
   back for one physical press.

   TV SECTION FILTER: Monster Jam / Drag Racing are hidden on TV
   devices only (see HIDE_ON_TV_KEYWORDS + getVisibleItems). They still
   show on phone/web.
*/

(() => {
  "use strict";

  // ==== CONFIG ====
  const DATA_CANDIDATES = ["./episodes.json"];
  const PAGE_SIZE = 24;

  const PLAYLISTS_OPEN_EXTERNALLY = true;

  // Top-level sections to hide on TV devices ONLY (still shown on
  // phone/web). Matched case-insensitively as a substring of the
  // section title, so "Drag Racing", "NHRA Drag Racing", etc. all
  // match. Add/remove keywords here if a section name changes.
  const HIDE_ON_TV_KEYWORDS = ["monster jam", "drag racing", "nhra"];

  // ==== DOM ====
  const $episodes = document.getElementById("episodes");
  const $playAllBtn = document.getElementById("playAllBtn");
  const $loadMoreBtn = document.getElementById("loadMoreBtn");
  const $status = document.getElementById("status");

  const $playerFrame = document.getElementById("playerFrame");
  const $playerToggleBtn = document.getElementById("playerToggleBtn");
  const $watchOnTvBtn = document.getElementById("watchOnTvBtn");
  const $nowPlayingTitle = document.getElementById("nowPlayingTitle");
  const $nowPlayingLine = document.getElementById("nowPlayingLine");

  const $npArtWrap = document.getElementById("npArtWrap");
  const $npArt = document.getElementById("npArt");

  const $backNavBtn = document.getElementById("backNavBtn");

  if (!$episodes) return;

  // ==== STATE ====
  let ROOT = null;
  let viewStack = [];
  let renderLimit = PAGE_SIZE;
  let currentQueue = [];
  let currentQueueIndex = 0;
  let playerVisible = false;
  let currentWatchUrl = "";
  let externalMessageActive = false;

  // When a Back exits theater mode, a TV can deliver a second Back (a
  // native history-back) for the same physical press a beat later. This
  // timestamp tells popstate to swallow that trailing Back instead of
  // also popping a folder level.
  let theaterExitGuardUntil = 0;

  // When true, hitting the end of the queue auto-picks another random
  // concert instead of stopping. Set by playRandom(), cleared by any
  // manual card tap or Play All so normal queues still stop normally.
  let randomMode = false;

  // ---- KornDog Features v1 state (favorites / search / resume) ----
  let currentSearch = "";          // active search term ("" = off)
  let lastRenderedItems = null;    // items actually shown, in card order
  let currentVideoId = null;       // video id currently in the player
  let currentVideoTitle = "";      // its title (for Continue Watching)
  let pendingResumeSeconds = 0;    // seek-to-here once playback starts
  let lastPosSaveTs = 0;           // throttle for saving resume position

  const artCache = new WeakMap();

  function isTVDevice() {
    return document.documentElement.classList.contains("device-tv");
  }

  // ==== UI HELPERS ====
  function setStatus(msg = "") {
    if ($status) $status.textContent = msg;
  }

  function setNowPlaying(title, line) {
    if ($nowPlayingTitle) $nowPlayingTitle.textContent = title || "Now Playing";
    if ($nowPlayingLine) $nowPlayingLine.textContent = line || "";
  }

  function setNowPlayingArt({ src, videoId } = {}) {
    if (!$npArtWrap || !$npArt) return;

    const initial = src || (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null);

    if (!initial) {
      $npArtWrap.classList.add("npArtFallback");
      $npArt.style.display = "none";
      $npArt.removeAttribute("src");
      return;
    }

    $npArtWrap.classList.remove("npArtFallback");
    $npArt.style.display = "block";
    $npArt.alt = "";
    $npArt.onerror = function () {
      if (!src && videoId) {
        this.onerror = function () {
          this.onerror = null;
          this.closest(".npArtWrap")?.classList.add("npArtFallback");
          this.style.display = "none";
        };
        this.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
      } else {
        this.onerror = null;
        this.closest(".npArtWrap")?.classList.add("npArtFallback");
        this.style.display = "none";
      }
    };
    $npArt.src = initial;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Updates the bottom back button: "Back to Sessions" (pops one level)
  // while inside a folder, "Back to home" (leaves the app) at the root,
  // or "Exit Player" while TV theater mode is active.
  function updateBackNav() {
    if (!$backNavBtn) return;
    if (document.body.classList.contains("tvTheater")) {
      $backNavBtn.textContent = "← Exit Player";
      return;
    }
    $backNavBtn.textContent = viewStack.length > 1 ? "← Back to Sessions" : "← Back to home";
  }

  // ==== TV THEATER MODE ====
  // Elements toggled by theater mode. Selected lazily (not at top-level
  // const time) since some only exist after render() has run at least once.
  function theaterTargets() {
    return Array.from(document.querySelectorAll(
      ".top, .listHead, #playAllBtn, #episodes, #loadMoreBtn, .playerTop, " +
      ".statusLine, #playerToggleBtn, #watchOnTvBtn, #nowPlayingTitle, " +
      "#nowPlayingLine, #npArtWrap, #kdTools"
    ));
  }

  // Theater mode is driven entirely by inline styles set here at runtime,
  // not by a CSS class + stylesheet rules. TVs/WebViews are notorious for
  // aggressively caching CSS/JS files, so relying on a freshly-fetched
  // styles.css to hide everything was fragile — a stale cached copy would
  // silently no-op the whole feature. Inline styles set live by JS can't
  // go stale like that. styles.css also carries a matching hard override
  // as a second line of defense, but this is the one actually doing the
  // work moment-to-moment.
  function enterTheaterMode() {
    if (!isTVDevice()) return;
    const wasTheater = document.body.classList.contains("tvTheater");
    document.body.classList.add("tvTheater");

    theaterTargets().forEach(el => {
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("visibility", "hidden", "important");
    });

    // The fixed full-screen black backdrop — this part is safe, it's
    // just a container, not the actual video element.
    const shell = document.querySelector(".playerShell");
    if (shell) {
      shell.style.setProperty("position", "fixed", "important");
      shell.style.setProperty("top", "0", "important");
      shell.style.setProperty("left", "0", "important");
      shell.style.setProperty("right", "0", "important");
      shell.style.setProperty("bottom", "0", "important");
      shell.style.setProperty("width", "100vw", "important");
      shell.style.setProperty("height", "100vh", "important");
      shell.style.setProperty("max-width", "100vw", "important");
      shell.style.setProperty("margin", "0", "important");
      shell.style.setProperty("padding", "24px", "important");
      shell.style.setProperty("display", "flex", "important");
      shell.style.setProperty("align-items", "center", "important");
      shell.style.setProperty("justify-content", "center", "important");
      shell.style.setProperty("background", "#000", "important");
      shell.style.setProperty("z-index", "2147483647", "important");
    }

    // Deliberately NOT forcing literal 100vw/100vh on the iframe or its
    // wrapper — confirmed on this TV that doing so renders solid black
    // (almost certainly a hardware video-overlay/compositing limit in
    // this WebView). Instead, clear any leftover inline sizing so the
    // existing, already-proven-working CSS sizing (aspect-ratio 16/9,
    // max-height, width:100%) takes over — just centered inside the
    // fixed black full-screen shell above instead of in the normal page
    // flow.
    const frameWrap = document.querySelector(".playerFrameWrap");
    if (frameWrap) {
      ["position", "top", "left", "right", "bottom", "width", "height",
        "max-width", "max-height", "min-height", "aspect-ratio", "margin",
        "padding", "border", "overflow", "background", "z-index", "display"]
        .forEach(p => frameWrap.style.removeProperty(p));
      frameWrap.style.setProperty("width", "100%", "important");
      frameWrap.style.setProperty("max-width", "100%", "important");
      frameWrap.style.setProperty("border-radius", "0", "important");
      frameWrap.style.setProperty("border", "none", "important");
      frameWrap.style.setProperty("box-shadow", "none", "important");
    }
    if ($playerFrame) {
      ["position", "top", "left", "right", "bottom", "width", "height",
        "max-width", "max-height", "min-height", "aspect-ratio", "margin",
        "padding", "border", "border-radius", "overflow", "background",
        "z-index"]
        .forEach(p => $playerFrame.style.removeProperty(p));
      $playerFrame.style.setProperty("display", "block", "important");
    }

    if ($backNavBtn) {
      $backNavBtn.style.setProperty("display", "inline-flex", "important");
      $backNavBtn.style.setProperty("position", "fixed", "important");
      $backNavBtn.style.setProperty("top", "24px", "important");
      $backNavBtn.style.setProperty("left", "24px", "important");
      $backNavBtn.style.setProperty("z-index", "2147483647", "important");
    }

    // Give Back a dedicated history entry to consume so ONE press always
    // exits the player cleanly and lands back on the session list —
    // regardless of whether the remote's Back arrives as a JS key event
    // or as the TV's native history-back. Only push on the INITIAL entry,
    // not on queue auto-advance (which re-enters while already theater).
    if (!wasTheater) {
      history.pushState({ kdTheater: true, viewDepth: viewStack.length }, "", buildHashUrl());
    }

    updateBackNav();
  }

  function exitTheaterMode() {
    document.body.classList.remove("tvTheater");

    // Actually stop the video itself, not just resize its container.
    // Leaving it shrunk-but-still-playing was almost certainly the
    // cause of the black screen after Back — on this TV the hardware
    // video decode surface can keep compositing on top of the page
    // even once its container is hidden via CSS, until the underlying
    // iframe load is actually torn down.
    stopListeningHandshake();
    if ($playerFrame) {
      $playerFrame.src = "";
    }

    theaterTargets().forEach(el => {
      el.style.removeProperty("display");
      el.style.removeProperty("visibility");
    });

    const shell = document.querySelector(".playerShell");
    if (shell) {
      ["position", "top", "left", "right", "bottom", "width", "height",
        "max-width", "margin", "padding", "display", "align-items",
        "justify-content", "background", "z-index"]
        .forEach(p => shell.style.removeProperty(p));
    }

    const frameWrap = document.querySelector(".playerFrameWrap");
    if (frameWrap) {
      ["width", "max-width", "border-radius", "border", "box-shadow"]
        .forEach(p => frameWrap.style.removeProperty(p));
    }

    if ($playerFrame) {
      $playerFrame.style.removeProperty("display");
    }

    if ($backNavBtn) {
      ["display", "position", "top", "left", "z-index"]
        .forEach(p => $backNavBtn.style.removeProperty(p));
    }

    playerVisible = false;
    if ($playerToggleBtn) $playerToggleBtn.textContent = "Show player";
    document.body.classList.remove("playerOpen");

    updateBackNav();
  }

  // ==== YOUTUBE PARSING ====
  function parseYouTube(url) {
    try {
      const u = new URL(url);

      if (u.pathname.includes("/playlist") && u.searchParams.get("list")) {
        const list = u.searchParams.get("list");
        return {
          kind: "playlist",
          list,
          watchUrl: `https://www.youtube.com/playlist?list=${list}`,
          embedUrl: `https://www.youtube.com/embed/videoseries?list=${list}`
        };
      }

      if (u.hostname.includes("youtu.be")) {
        const id = u.pathname.replace("/", "").trim();
        if (id) {
          return {
            kind: "video",
            id,
            watchUrl: `https://www.youtube.com/watch?v=${id}`,
            embedUrl: `https://www.youtube.com/embed/${id}`
          };
        }
      }

      if (u.pathname.includes("/watch") && u.searchParams.get("v")) {
        const id = u.searchParams.get("v");
        const list = u.searchParams.get("list");
        return {
          kind: "video",
          id,
          watchUrl: `https://www.youtube.com/watch?v=${id}${list ? `&list=${list}` : ""}`,
          embedUrl: `https://www.youtube.com/embed/${id}`
        };
      }

      const parts = u.pathname.split("/").filter(Boolean);
      const possibleId = parts[parts.length - 1];
      if (possibleId && possibleId.length >= 8) {
        return {
          kind: "video",
          id: possibleId,
          watchUrl: `https://www.youtube.com/watch?v=${possibleId}`,
          embedUrl: `https://www.youtube.com/embed/${possibleId}`
        };
      }
    } catch (_) {}

    return { kind: "unknown", watchUrl: url, embedUrl: "" };
  }

  // ==== DATA NORMALIZATION ====
  function normalizeRoot(raw) {
    if (Array.isArray(raw)) return { title: "Sessions", mode: "folder", items: raw };
    if (raw && typeof raw === "object") {
      if (Array.isArray(raw.items)) return raw;
      if (Array.isArray(raw.data)) return { title: "Sessions", mode: "folder", items: raw.data };
    }
    throw new Error("JSON root must be an array or an object with an .items array.");
  }

  function isFolder(node) {
    return node && (node.mode === "folder" || Array.isArray(node.items));
  }

  function isPlayableNode(node) {
    if (!node || typeof node !== "object") return false;
    if (node.mode === "queue" || node.mode === "fullshow" || node.mode === "playlist") return true;
    if (Array.isArray(node.tracks) && node.tracks.some(t => t && t.url)) return true;
    return false;
  }

  function getNodeItems(folderNode) {
    if (!folderNode) return [];
    if (Array.isArray(folderNode.items)) return folderNode.items;
    if (Array.isArray(folderNode)) return folderNode;
    return [];
  }

  // Same as getNodeItems, but on TV devices it strips out the top-level
  // sections listed in HIDE_ON_TV_KEYWORDS (Monster Jam / Drag Racing).
  // Filtering happens ONLY at the root level so nothing deeper in the
  // tree is ever touched, and ONLY on TV — phone/web see everything.
  function getVisibleItems(node) {
    const items = getNodeItems(node);
    if (isTVDevice() && node === ROOT) {
      return items.filter(it => {
        const t = (safeTitle(it) || "").toLowerCase();
        return !HIDE_ON_TV_KEYWORDS.some(k => t.includes(k));
      });
    }
    return items;
  }

  function safeTitle(node) {
    return node?.title || node?.artist || "Untitled";
  }

  // ==== ALBUM ART ====
  function getNodeArt(node) {
    if (!node || typeof node !== "object") return null;
    if (artCache.has(node)) return artCache.get(node);

    let result = null;

    if (node.thumb) {
      result = node.thumb;
    } else if (isFolder(node)) {
      for (const child of getNodeItems(node)) {
        result = getNodeArt(child);
        if (result) break;
      }
    } else {
      const playable = collectPlayableFromNode(node);
      if (playable.length) {
        const info = parseYouTube(playable[0].url);
        if (info.kind === "video" && info.id) {
          result = `https://img.youtube.com/vi/${info.id}/mqdefault.jpg`;
        }
      }
    }

    artCache.set(node, result);
    return result;
  }

  // ==== NAV / HISTORY ====
  function currentNode() {
    return viewStack[viewStack.length - 1] || ROOT;
  }

  function buildHashUrl() {
    const pathTitles = viewStack.map(n => safeTitle(n)).slice(1);
    const hash = pathTitles.length ? `#${encodeURIComponent(pathTitles.join(" / "))}` : "";
    return `${location.pathname}${hash}`;
  }

  function resetPlayerShellOverride() {
    const shell = document.querySelector(".playerShell");
    if (shell) shell.style.removeProperty("display");
  }

  function pushView(node) {
    exitTheaterMode();
    resetPlayerShellOverride();
    externalMessageActive = false;
    viewStack.push(node);
    renderLimit = PAGE_SIZE;
    history.pushState({ viewDepth: viewStack.length }, "", buildHashUrl());
    render();
  }

  function popView() {
    if (viewStack.length > 1) {
      history.back();
    }
  }

  window.addEventListener("popstate", () => {
    const now = Date.now();

    // Case 1: a Back arrived while the player is in theater mode. Exit
    // the player in this single press. The history entry consumed here
    // is the dedicated one pushed by enterTheaterMode, so we land right
    // back on the session list we launched from — no folder is popped.
    if (document.body.classList.contains("tvTheater")) {
      exitTheaterMode();
      theaterExitGuardUntil = now + 600;
      return;
    }

    // Case 2: some TVs fire BOTH a JS key event and a native
    // history-back for one physical Back press. If theater just exited,
    // swallow this trailing Back (and restore the history entry it
    // consumed) so it doesn't also pop a folder level.
    if (now < theaterExitGuardUntil) {
      theaterExitGuardUntil = 0;
      history.pushState({ viewDepth: viewStack.length }, "", buildHashUrl());
      return;
    }

    // Normal folder back.
    resetPlayerShellOverride();
    externalMessageActive = false;
    if (viewStack.length > 1) {
      viewStack.pop();
      renderLimit = PAGE_SIZE;
      render();
    }
  });

  // ==== QUEUE BUILDING ====
  function collectPlayableFromNode(node) {
    if (!node) return [];

    if (isFolder(node)) {
      const out = [];
      for (const child of getNodeItems(node)) out.push(...collectPlayableFromNode(child));
      return out;
    }

    const tracks = Array.isArray(node.tracks) ? node.tracks : [];
    const nodeThumb = node.thumb || null;

    if (node.mode === "playlist") {
      const first = tracks.find(t => t?.url);
      if (first?.url) return [{ title: first.title || safeTitle(node), url: first.url, kind: "playlist", thumb: nodeThumb }];
      if (node.url) return [{ title: safeTitle(node), url: node.url, kind: "playlist", thumb: nodeThumb }];
      return [];
    }

    if (node.mode === "fullshow") {
      const first = tracks.find(t => t?.url);
      return first ? [{ title: safeTitle(node), url: first.url, kind: "video", thumb: nodeThumb }] : [];
    }

    if (node.mode === "queue") {
      return tracks
        .filter(t => t && t.url)
        .map(t => ({ title: t.title || safeTitle(node), url: t.url, kind: "video", thumb: nodeThumb }));
    }

    if (tracks.length) {
      return tracks
        .filter(t => t && t.url)
        .map(t => ({ title: t.title || safeTitle(node), url: t.url, kind: "video", thumb: nodeThumb }));
    }

    return [];
  }

  function collectPlayableFromCurrentView() {
    const node = currentNode();

    if (node.__trackPicker) {
      return (Array.isArray(node.tracks) ? node.tracks : [])
        .filter(t => t && t.url)
        .map(t => ({
          title: t.title || node.title,
          url: t.url,
          kind: "video",
          thumb: node.thumb || null
        }));
    }

    const items = getVisibleItems(node);
    const out = [];
    for (const it of items) {
      if (isFolder(it)) out.push(...collectPlayableFromNode(it));
      else if (isPlayableNode(it)) out.push(...collectPlayableFromNode(it));
    }
    return out;
  }

  // ==== YOUTUBE PLAYBACK ENGINE ====
  let handshakeInterval = null;

  function buildEmbed(url, autoplay = true) {
    const info = parseYouTube(url);
    if (!info.embedUrl) return "";
    const params = new URLSearchParams();
    if (autoplay) params.set("autoplay", "1");
    params.set("rel", "0");
    params.set("modestbranding", "1");
    params.set("playsinline", "1");
    params.set("enablejsapi", "1");
    try {
      params.set("origin", window.location.origin);
    } catch (_) {}
    return `${info.embedUrl}?${params.toString()}`;
  }

  let playerIsPaused = false;
  let playerCurrentTime = 0;

  function attachPostMessageListenerOnce() {
    if (window.__kdYtMsgAttached) return;
    window.__kdYtMsgAttached = true;

    window.addEventListener("message", (event) => {
      if (!event.origin || event.origin.indexOf("youtube.com") === -1) return;

      let data = event.data;
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch (_) { return; }
      }
      if (!data || typeof data !== "object") return;

      // playerState: 0 = ENDED, 1 = PLAYING, 2 = PAUSED.
      if (data.event === "infoDelivery" && data.info && typeof data.info.playerState === "number") {
        const state = data.info.playerState;
        if (state === 0) {
          // Finished — drop it from Continue Watching, then advance.
          clearContinue(currentVideoId);
          advanceQueue();
        }
        if (state === 1 && pendingResumeSeconds > 0) {
          // Playback started and we have a saved spot — jump to it once.
          const target = pendingResumeSeconds;
          pendingResumeSeconds = 0;
          try {
            if ($playerFrame && $playerFrame.contentWindow) {
              $playerFrame.contentWindow.postMessage(
                JSON.stringify({ event: "command", func: "seekTo", args: [target, true] }),
                "*"
              );
            }
          } catch (_) {}
        }
        playerIsPaused = state === 2;
      }
      // YouTube error event: codes 100/101/150 = removed, private, or embed-blocked.
      // Auto-skip so a dead video never hangs the queue (or random mode).
      if (data.event === "error") {
        const code = data.info;
        // 100 = removed/private, 101/150 = playback not allowed in embedded players
        if (code === 100 || code === 101 || code === 150) {
          const skippedTitle = currentQueue[currentQueueIndex]?.title || "video";
          setStatus(`Skipped: "${skippedTitle}" is unavailable — moving on…`);
          stopListeningHandshake();
          // Small delay so the status message is readable before the next load
          setTimeout(advanceQueue, 1200);
        }
        return;
      }

      if (data.event === "infoDelivery" && data.info && typeof data.info.currentTime === "number") {
        playerCurrentTime = data.info.currentTime;
        // Save resume position, throttled to ~once every 5s.
        const now = Date.now();
        if (currentVideoId && now - lastPosSaveTs > 5000) {
          lastPosSaveTs = now;
          saveContinuePosition(currentVideoId, playerCurrentTime, currentVideoTitle);
        }
      }
    });
  }

  function togglePlayPause() {
    if (!$playerFrame || !$playerFrame.contentWindow) return;
    const func = playerIsPaused ? "playVideo" : "pauseVideo";
    try {
      $playerFrame.contentWindow.postMessage(
        JSON.stringify({ event: "command", func, args: "" }),
        "*"
      );
    } catch (_) {}
  }

  window.__kdTogglePlayPause = togglePlayPause;

  function seekRelative(deltaSeconds) {
    if (!$playerFrame || !$playerFrame.contentWindow) return;
    const target = Math.max(0, playerCurrentTime + deltaSeconds);
    try {
      $playerFrame.contentWindow.postMessage(
        JSON.stringify({ event: "command", func: "seekTo", args: [target, true] }),
        "*"
      );
      playerCurrentTime = target;
    } catch (_) {}
  }

  window.__kdSeek = seekRelative;

  function startListeningHandshake() {
    attachPostMessageListenerOnce();
    if (handshakeInterval) clearInterval(handshakeInterval);

    let attempts = 0;
    handshakeInterval = setInterval(() => {
      attempts++;
      if ($playerFrame && $playerFrame.contentWindow) {
        try {
          $playerFrame.contentWindow.postMessage(
            JSON.stringify({ event: "listening", id: 1, channel: "widget" }),
            "*"
          );
        } catch (_) {}
      }
      if (attempts >= 10) {
        clearInterval(handshakeInterval);
        handshakeInterval = null;
      }
    }, 500);
  }

  function stopListeningHandshake() {
    if (handshakeInterval) {
      clearInterval(handshakeInterval);
      handshakeInterval = null;
    }
  }

  function advanceQueue() {
    if (currentQueueIndex + 1 < currentQueue.length) {
      playTrackAt(currentQueueIndex + 1, true);
    } else if (randomMode) {
      // Infinite shuffle — queue ran out, pick another random concert.
      playRandom();
    } else {
      setStatus("Queue finished.");
    }
  }

  // ==== PLAYER CONTROL ====
  function showPlayer(show) {
    playerVisible = !!show;
    if ($playerToggleBtn) $playerToggleBtn.textContent = playerVisible ? "Hide player" : "Show player";
    document.body.classList.toggle("playerOpen", playerVisible);

    if (!playerVisible) {
      stopListeningHandshake();
      if ($playerFrame) $playerFrame.src = "";
      exitTheaterMode();
    }
  }

  function showOpenExternallyMessage(title, watchUrl, videoId, thumb) {
    exitTheaterMode();
    externalMessageActive = true;
    stopListeningHandshake();
    if ($playerFrame) {
      $playerFrame.src = "about:blank";
    }
    setNowPlaying("Open in YouTube / SmartTube", title);
    setNowPlayingArt({ src: thumb || null, videoId });
    setStatus("This playlist opens externally (more reliable than embeds).");
    if ($watchOnTvBtn) {
      $watchOnTvBtn.href = watchUrl;
      $watchOnTvBtn.style.display = "inline-flex";
      $watchOnTvBtn.textContent = "Open Playlist";
    }

    if (isTVDevice()) {
      const shell = document.querySelector(".playerShell");
      if (shell) shell.style.setProperty("display", "grid", "important");
    }

    if (!playerVisible) showPlayer(true);
  }

  function playTrackAt(index, autoplay = true) {
    if (!currentQueue.length) return;
    if (index < 0 || index >= currentQueue.length) return;

    currentQueueIndex = index;
    const track = currentQueue[currentQueueIndex];

    const info = parseYouTube(track.url);
    currentWatchUrl = info.watchUrl || track.url;
    const videoId = info.kind === "video" ? info.id : null;
    const onTV = isTVDevice();

    if ((track.kind === "playlist" || info.kind === "playlist") && PLAYLISTS_OPEN_EXTERNALLY) {
      if ($watchOnTvBtn) {
        $watchOnTvBtn.href = currentWatchUrl;
        $watchOnTvBtn.style.display = "inline-flex";
        $watchOnTvBtn.textContent = "Watch on TV";
      }
      showOpenExternallyMessage(track.title || "Playlist", currentWatchUrl, videoId, track.thumb);
      return;
    }

    if (info.kind !== "video" || !videoId) {
      setStatus("Couldn't parse a YouTube video from that link.");
      return;
    }

    if ($watchOnTvBtn) {
      if (onTV) {
        $watchOnTvBtn.style.display = "none";
      } else {
        $watchOnTvBtn.href = currentWatchUrl;
        $watchOnTvBtn.style.display = "inline-flex";
        $watchOnTvBtn.textContent = "Watch on TV";
      }
    }

    setNowPlaying("Now Playing", track.title || "Playing…");
    setNowPlayingArt({ src: track.thumb || null, videoId });
    setStatus(`Playing ${currentQueueIndex + 1} of ${currentQueue.length}`);
    showPlayer(true);

    // Resume support: remember which video is playing and, if we saved a
    // position for it before, seek there once playback actually starts.
    currentVideoId = videoId;
    currentVideoTitle = track.title || safeTitle(currentNode());
    pendingResumeSeconds = resumePositionFor(videoId);

    const embed = buildEmbed(track.url, autoplay);
    if (!embed) {
      setStatus("Couldn't build YouTube embed for that link.");
      return;
    }
    if ($playerFrame) {
      $playerFrame.src = embed;
      startListeningHandshake();
    }

    // Movie-theater mode on TV: player takes over the whole screen,
    // everything else hides, Back/Exit Player brings the list back.
    if (onTV) enterTheaterMode();
  }

  // ==== KORNDOG FEATURES v1 (favorites / continue watching / search / random) ====
  // All wrapped defensively — if storage is unavailable (private mode,
  // locked-down WebView) these no-op rather than break the app.
  const LS_FAVS = "kdFavs";
  const LS_CONTINUE = "kdContinue";

  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
  }

  // A stable identity for a node: its first YouTube video id if it has
  // one, otherwise its title. Used to remember favorites + positions.
  function keyForNode(node) {
    if (!node) return "";
    const playable = collectPlayableFromNode(node);
    for (const t of playable) {
      const info = parseYouTube(t.url);
      if (info.kind === "video" && info.id) return "v:" + info.id;
    }
    return "t:" + safeTitle(node);
  }

  function loadFavs() { return lsGet(LS_FAVS, []); }
  function isFav(node) { return loadFavs().includes(keyForNode(node)); }
  function toggleFav(node) {
    const k = keyForNode(node);
    if (!k) return;
    const favs = loadFavs();
    const i = favs.indexOf(k);
    if (i >= 0) favs.splice(i, 1); else favs.push(k);
    lsSet(LS_FAVS, favs);
  }

  // Continue Watching store: array of {key, position, title, ts},
  // most-recent first, capped. Updated as a video plays.
  function loadContinue() { return lsGet(LS_CONTINUE, []); }
  function saveContinuePosition(videoId, seconds, title) {
    if (!videoId || !(seconds > 15)) return;
    const list = loadContinue().filter(e => e.key !== "v:" + videoId);
    list.unshift({ key: "v:" + videoId, position: Math.floor(seconds), title: title || "", ts: Date.now() });
    lsSet(LS_CONTINUE, list.slice(0, 15));
  }
  function clearContinue(videoId) {
    if (!videoId) return;
    lsSet(LS_CONTINUE, loadContinue().filter(e => e.key !== "v:" + videoId));
  }
  function resumePositionFor(videoId) {
    const e = loadContinue().find(x => x.key === "v:" + videoId);
    return e ? e.position : 0;
  }

  // Walk the whole tree and find the node(s) matching a set of keys, so
  // a favorite / continue entry can be turned back into a real,
  // playable node to display.
  function resolveKey(key) {
    let found = null;
    (function walk(node) {
      if (found) return;
      if (isFolder(node)) { getNodeItems(node).forEach(walk); return; }
      if (isPlayableNode(node) && keyForNode(node) === key) found = node;
    })(ROOT);
    return found;
  }

  function collectAllPlayableNodes(node, acc) {
    if (!node) return acc;
    if (isFolder(node)) { getNodeItems(node).forEach(c => collectAllPlayableNodes(c, acc)); return acc; }
    if (isPlayableNode(node)) acc.push(node);
    return acc;
  }

  // Build the virtual "⭐ Favorites" / "▶ Continue Watching" folders
  // that get shown at the very top of the home list.
  function buildVirtualFolders() {
    const out = [];
    try {
      const favItems = loadFavs().map(resolveKey).filter(Boolean);
      if (favItems.length) {
        out.push({ title: "Favorites", icon: "⭐", mode: "folder", items: favItems, __virtual: true });
      }
      const contItems = loadContinue().map(e => resolveKey(e.key)).filter(Boolean);
      if (contItems.length) {
        out.push({ title: "Continue Watching", icon: "▶", mode: "folder", items: contItems, __virtual: true });
      }
    } catch (_) {}
    return out;
  }

  function playRandom() {
    if (!ROOT) { setStatus("Still loading — try again in a second."); return; }

    // Collect every playable node in the whole tree, then filter:
    // - skip playlist-mode items (they open externally, not in the player)
    // - on TV, also skip the hidden sections (Monster Jam / Drag Racing)
    const tvHidden = isTVDevice() ? HIDE_ON_TV_KEYWORDS : [];

    const all = collectAllPlayableNodes(ROOT, []).filter(n => {
      if (n.mode === "playlist") return false;
      if (tvHidden.length) {
        const t = (safeTitle(n) || "").toLowerCase();
        if (tvHidden.some(k => t.includes(k))) return false;
      }
      return true;
    });

    if (!all.length) { setStatus("Nothing to shuffle yet."); return; }

    const pick = all[Math.floor(Math.random() * all.length)];
    const q = collectPlayableFromNode(pick);
    if (!q.length) { setStatus("Couldn't start that one — try again."); return; }

    randomMode = true;
    currentQueue = q;
    setStatus(`🎲 ${safeTitle(pick)}`);
    playTrackAt(0, true);
  }

  // Exposed globally so index.html's Random button can call it even before
  // the sessions page is fully initialized (e.g. from the home page).
  window.__kdPlayRandom = function () {
    // If ROOT isn't loaded yet (called from home page before data fetch),
    // bounce to sessions.html with a ?random=1 flag and let it handle it.
    if (!ROOT) {
      window.location.href = "./sessions.html?random=1";
      return;
    }
    playRandom();
  };

  function runSearch(term) {
    currentSearch = term || "";
    renderLimit = PAGE_SIZE;
    render();
  }

  // Inject the search box + Random button once, in a spot that survives
  // re-renders (render() only rewrites #episodes, never its siblings).
  function injectTools() {
    if (document.getElementById("kdTools")) return;
    try {
      const style = document.createElement("style");
      style.textContent = `
        #kdTools{display:flex;gap:8px;align-items:center;margin:10px 0;flex-wrap:wrap}
        #kdSearch{flex:1 1 160px;min-width:120px;background:#1a0a2e;color:#fff;
          border:1px solid #7FD41A;border-radius:10px;padding:10px 12px;font-size:15px;outline:none}
        #kdSearch::placeholder{color:#9a86b8}
        #kdRandom,#kdClearSearch{background:#7FD41A;color:#1a0a2e;border:none;border-radius:10px;
          padding:10px 14px;font-weight:700;font-size:15px;cursor:pointer;white-space:nowrap}
        #kdClearSearch{background:#2a1640;color:#fff;border:1px solid #7FD41A;display:none}
        .kdFav{position:absolute;top:8px;right:8px;font-size:20px;line-height:1;cursor:pointer;
          z-index:60;filter:drop-shadow(0 0 3px rgba(0,0,0,.8));user-select:none}
      `;
      document.head.appendChild(style);

      const tools = document.createElement("div");
      tools.id = "kdTools";
      tools.innerHTML =
        '<input id="kdSearch" type="search" placeholder="Search sessions…" autocomplete="off">' +
        '<button id="kdRandom" type="button">🎲 Random</button>' +
        '<button id="kdClearSearch" type="button">Clear</button>';
      $episodes.parentNode.insertBefore(tools, $episodes);

      const $search = tools.querySelector("#kdSearch");
      const $clear = tools.querySelector("#kdClearSearch");
      $search.addEventListener("input", () => {
        const t = $search.value.trim();
        $clear.style.display = t ? "inline-block" : "none";
        runSearch(t);
      });
      $clear.addEventListener("click", () => {
        $search.value = "";
        $clear.style.display = "none";
        runSearch("");
      });
      tools.querySelector("#kdRandom").addEventListener("click", playRandom);
    } catch (_) {}
  }

  // ==== RENDERING ====
  function render() {
    const node = currentNode();

    if (node.__trackPicker) {
      renderTrackPicker(node);
      return;
    }

    // Search mode: flat list of matches across the whole library.
    const term = (currentSearch || "").trim().toLowerCase();
    if (term) {
      const matches = collectAllPlayableNodes(ROOT, []).filter(n => {
        const hay = ((safeTitle(n) || "") + " " + (n.artist || "")).toLowerCase();
        return hay.includes(term);
      });
      lastRenderedItems = matches;

      setNowPlaying("Now Playing", `Search: "${currentSearch}"`);
      setNowPlayingArt({});
      updateBackNav();

      const visible = matches.slice(0, renderLimit);
      $episodes.innerHTML = visible.map(renderCard).join("") ||
        `<div class="empty">No matches for "${escapeHtml(currentSearch)}".</div>`;

      if ($loadMoreBtn) $loadMoreBtn.style.display = matches.length > renderLimit ? "inline-flex" : "none";
      if ($playAllBtn) $playAllBtn.style.display = matches.length ? "inline-flex" : "none";

      wireCardClicks();
      setStatus(`${matches.length} match${matches.length === 1 ? "" : "es"}`);
      return;
    }

    let items = getVisibleItems(node);

    // On the home screen, surface Favorites / Continue Watching on top.
    if (node === ROOT) {
      const virtual = buildVirtualFolders();
      if (virtual.length) items = virtual.concat(items);
    }
    lastRenderedItems = items;

    setNowPlaying("Now Playing", "Pick a session below 👇");
    setNowPlayingArt({});
    updateBackNav();

    const visible = items.slice(0, renderLimit);
    const html = visible.map(renderCard).join("");

    $episodes.innerHTML = html || `<div class="empty">Nothing here yet.</div>`;

    if ($loadMoreBtn) {
      const more = items.length > renderLimit;
      $loadMoreBtn.style.display = more ? "inline-flex" : "none";
    }

    if ($playAllBtn) $playAllBtn.style.display = "inline-flex";

    wireCardClicks();

    const path = viewStack.slice(1).map(safeTitle);
    setStatus(path.length ? `In: ${path.join(" / ")}` : `Showing ${Math.min(items.length, renderLimit)} of ${items.length}`);
  }

  function renderTrackPicker(node) {
    const tracks = Array.isArray(node.tracks) ? node.tracks : [];

    setNowPlaying("Now Playing", "Pick a track below 👇");
    setNowPlayingArt({ src: node.thumb || null });
    updateBackNav();

    const headerHtml = `
      <div class="trackHeader">
        <div class="trackHeaderText">
          <div class="trackHeaderTitle">${escapeHtml(node.title || "Tracks")}</div>
          ${node.artist ? `<div class="trackHeaderSub">${escapeHtml(node.artist)}</div>` : ""}
          <div class="trackHeaderSmall">${tracks.length} track${tracks.length === 1 ? "" : "s"} • tap one to jump in • Play All to stitch from the top</div>
        </div>
      </div>
    `;

    const rowsHtml = tracks.map((t, i) => `
      <button type="button" class="trackRow" data-track-idx="${i}">
        <div class="trackRowTitle">${escapeHtml(t.title || `Track ${i + 1}`)}</div>
        <div class="trackRowChevron">▶</div>
      </button>
    `).join("");

    $episodes.innerHTML = headerHtml + (rowsHtml || `<div class="empty">No tracks found.</div>`);

    if ($loadMoreBtn) $loadMoreBtn.style.display = "none";
    if ($playAllBtn) $playAllBtn.style.display = "inline-flex";

    wireTrackRowClicks(node);

    setStatus(`In: ${escapeHtml(node.title || "Tracks")}`);
  }

  function wireTrackRowClicks(node) {
    const tracks = (Array.isArray(node.tracks) ? node.tracks : []).filter(t => t && t.url);

    document.querySelectorAll(".trackRow").forEach(row => {
      const handler = () => {
        const i = Number(row.getAttribute("data-track-idx"));
        const raw = (Array.isArray(node.tracks) ? node.tracks : [])[i];
        if (!raw || !raw.url) return;

        currentQueue = tracks.map(t => ({
          title: t.title || node.title,
          url: t.url,
          kind: "video",
          thumb: node.thumb || null
        }));

        const targetIndex = currentQueue.findIndex(q => q.url === raw.url);
        playTrackAt(targetIndex >= 0 ? targetIndex : 0, true);
      };

      row.addEventListener("click", handler, { passive: true });
    });
  }

  function renderCard(node, idx) {
    const title = escapeHtml(safeTitle(node));
    const subtitleBits = [];

    if (node.artist) subtitleBits.push(escapeHtml(node.artist));
    if (node.year) subtitleBits.push(escapeHtml(node.year));

    const subtitle = subtitleBits.join(" • ");

    const small =
      node.mode === "playlist" ? "playlist • opens externally" :
      node.mode === "queue" ? `${(node.tracks?.length ?? 0)} tracks • tap to choose` :
      node.mode === "fullshow" ? "full show" :
      node.mode === "folder" ? `${(node.items?.length ?? 0)} items` :
      (node.tracks?.length ? `${node.tracks.length} tracks` : "");

    const icon = escapeHtml(node.icon || "");

    const artSrc = getNodeArt(node);
    const safeArtSrc = artSrc ? escapeHtml(artSrc) : "";
    const artHtml = safeArtSrc
      ? `<div class="epArtWrap">
           <img class="epArt" src="${safeArtSrc}" alt="" loading="lazy"
                onerror="this.closest('.epArtWrap').classList.add('epArtFallback'); this.remove();">
         </div>`
      : `<div class="epArtWrap epArtFallback"></div>`;

    // Favorite star — only on playable items (not folders/virtual rows).
    let favHtml = "";
    if (isPlayableNode(node) && !node.__virtual) {
      const on = isFav(node);
      favHtml = `<span class="kdFav" data-fav-idx="${String(idx)}" role="button" aria-label="Favorite">${on ? "⭐" : "☆"}</span>`;
    }

    return `
      <button type="button" class="epCard" data-idx="${String(idx)}">
        ${favHtml}
        ${artHtml}
        <div class="epMain">
          <div class="epTitle">${icon ? icon + " " : ""}${title}</div>
          ${subtitle ? `<div class="epMeta">${subtitle}</div>` : ""}
          ${small ? `<div class="epSmall">${escapeHtml(small)}</div>` : ""}
        </div>
        <div class="epChevron">›</div>
      </button>
    `;
  }

  function wireCardClicks() {
    const items = lastRenderedItems || getVisibleItems(currentNode());

    // Favorite stars (must run before/independent of the card click).
    document.querySelectorAll(".kdFav").forEach(star => {
      star.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const i = Number(star.getAttribute("data-fav-idx"));
        const target = items[i];
        if (!target) return;
        toggleFav(target);
        render();
      });
    });

    document.querySelectorAll(".epCard").forEach(card => {
      const handler = () => {
        const i = Number(card.getAttribute("data-idx"));
        const chosen = items[i];
        if (!chosen) return;

        if (isFolder(chosen)) {
          pushView(chosen);
          return;
        }

        if (isPlayableNode(chosen)) {
          if (chosen.mode === "queue" && Array.isArray(chosen.tracks) && chosen.tracks.length > 1) {
            pushView({
              __trackPicker: true,
              title: safeTitle(chosen),
              artist: chosen.artist,
              thumb: chosen.thumb || null,
              tracks: chosen.tracks
            });
            return;
          }

          const q = collectPlayableFromNode(chosen);
          if (!q.length) {
            setStatus("No playable tracks found in that item.");
            return;
          }
          randomMode = false;
          currentQueue = q;
          playTrackAt(0, true);
          return;
        }

        setStatus("That item isn't playable (missing mode/tracks).");
      };

      card.addEventListener("click", handler, { passive: true });
    });
  }

  // ==== DEEP-LINK AUTO-PLAY (from home page Featured cards) ====
  function findNodeByVideoId(node, targetId) {
    if (isFolder(node)) {
      for (const child of getNodeItems(node)) {
        const found = findNodeByVideoId(child, targetId);
        if (found) return found;
      }
      return null;
    }
    if (isPlayableNode(node)) {
      const playable = collectPlayableFromNode(node);
      const match = playable.some(t => {
        const info = parseYouTube(t.url);
        return info.kind === "video" && info.id === targetId;
      });
      if (match) return node;
    }
    return null;
  }

  function findNodeByTitle(node, targetTitle) {
    if (isFolder(node)) {
      for (const child of getNodeItems(node)) {
        const found = findNodeByTitle(child, targetTitle);
        if (found) return found;
      }
      return null;
    }
    if (isPlayableNode(node) && safeTitle(node) === targetTitle) return node;
    return null;
  }

  // ==== FIX: TV deep-link black-screen ====
  // On TV, firing autoplay the instant the page loads hits the WebView
  // before the player is ready — the hardware compositor paints black.
  // On phone this never happens so the phone path stays instant.
  // The delay gives the WebView one paint cycle to settle before we
  // drop the iframe src. 350ms is enough on this TV; we don't need more.
  function tryAutoPlayFromQuery() {
    const params = new URLSearchParams(location.search);
    const playId = params.get("play");
    const playTitle = params.get("playTitle");
    if (!playId && !playTitle) return;

    function doPlay() {
      let target = null;
      if (playId) target = findNodeByVideoId(ROOT, playId);
      if (!target && playTitle) target = findNodeByTitle(ROOT, playTitle);
      if (!target) return;

      const q = collectPlayableFromNode(target);
      if (!q.length) return;

      currentQueue = q;
      playTrackAt(0, true);
    }

    if (isTVDevice()) {
      // Give the TV WebView a beat to finish layout/paint before we
      // fire the iframe load. Phone gets instant playback as before.
      setTimeout(doPlay, 350);
    } else {
      doPlay();
    }
  }

  // ==== LOAD DATA ====
  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  }

  async function loadData() {
    let lastErr = null;

    for (const url of DATA_CANDIDATES) {
      try {
        const raw = await fetchJson(url);
        const norm = normalizeRoot(raw);
        ROOT = norm;
        viewStack = [ROOT];
        setStatus(`Loaded: ${url}`);
        render();
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Failed to load JSON.");
  }

  // ==== BUTTONS ====
  if ($playAllBtn) {
    $playAllBtn.addEventListener("click", () => {
      const q = collectPlayableFromCurrentView();
      if (!q.length) {
        setStatus("No playable items on this screen.");
        return;
      }
      randomMode = false;
      currentQueue = q;
      playTrackAt(0, true);
    });
  }

  if ($loadMoreBtn) {
    $loadMoreBtn.addEventListener("click", () => {
      renderLimit += PAGE_SIZE;
      render();
    });
  }

  if ($playerToggleBtn) {
    $playerToggleBtn.addEventListener("click", () => {
      const next = !playerVisible;
      showPlayer(next);
      if (next && currentQueue.length) {
        playTrackAt(currentQueueIndex, true);
      }
    });
  }

  if ($watchOnTvBtn) {
    $watchOnTvBtn.style.display = "none";
  }

  function handleBackAction() {
    if (externalMessageActive) {
      externalMessageActive = false;
      resetPlayerShellOverride();
      if ($watchOnTvBtn) $watchOnTvBtn.style.display = "none";
      render();
      return;
    }
    if (document.body.classList.contains("tvTheater")) {
      // Route through history so the dedicated theater entry is consumed
      // and popstate exits the player + lands on the session list in
      // exactly one step (same single path the remote/native back uses).
      history.back();
      return;
    }
    if (viewStack.length > 1) {
      popView();
    } else {
      window.location.href = "./index.html";
    }
  }

  if ($backNavBtn) {
    $backNavBtn.addEventListener("click", handleBackAction);
  }

  // Exposed so tv-nav.js's hardware/remote Back key always triggers the
  // exact same single, correct next step.
  window.__kdGoBack = handleBackAction;

  // ==== SWIPE BACK (mobile) ====
  let touchStartX = 0;
  let touchStartY = 0;
  let touchActive = false;

  window.addEventListener("touchstart", (e) => {
    if (!e.touches || !e.touches[0]) return;
    touchActive = true;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  window.addEventListener("touchend", (e) => {
    if (!touchActive) return;
    touchActive = false;

    const t = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
    if (!t) return;

    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;

    if (Math.abs(dx) < 60) return;
    if (Math.abs(dy) > 70) return;

    if (dx > 0) popView();
  }, { passive: true });

  // Exposed so tv-nav.js can still force a clean exit if it ever needs
  // to (e.g. focus stranded). The normal Back path now flows through
  // history()/popstate instead.
  window.__kdExitTheater = exitTheaterMode;

  // ==== INIT ====
  (async function init() {
    try {
      setStatus("Loading sessions…");
      await loadData();
      injectTools();
      showPlayer(false);
      // Handle deep-links: ?play= / ?playTitle= from Featured cards,
      // or ?random=1 from the home page Random button.
      const _rp = new URLSearchParams(location.search);
      if (_rp.get("random") === "1") {
        playRandom();
      } else {
        tryAutoPlayFromQuery();
      }
      setStatus((($status?.textContent || "") + " — If weird, hard refresh / clear cache.").trim());
    } catch (err) {
      console.error(err);
      setStatus(`App crashed: ${err.message || err}`);
    }
  })();
})();
