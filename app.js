/* Joey’s Acoustic Corner — app.js (defensive + mobile-first)
   Expects: sessions.html has these IDs:
   #episodes, #playAllBtn, #loadMoreBtn, #status,
   #playerFrame, #playerToggleBtn,
   #watchOnTvBtn, #nowPlayingTitle, #nowPlayingLine,
   #npArtWrap, #npArt, #backNavBtn

   Deep-link auto-play: if the URL has ?play=<videoId> or
   ?playTitle=<title> (set by the home page's Featured cards), the
   matching show starts playing automatically once data loads.

   PLAYBACK ENGINE: uses YouTube's lightweight postMessage protocol on a
   plain iframe embed so we can detect when a video ENDS (queues
   auto-advance) and drive play/pause + rewind/fast-forward from the
   remote.

   TV PLAYER: on TV devices the video now plays in the normal INLINE
   player (same as phone/web). The old fullscreen "theater" takeover was
   removed — forcing the iframe to fill the screen made this TV's WebView
   paint a solid black box, because the hardware video surface couldn't
   composite into that forced-fullscreen layout. Inline playback never
   had that problem.

   TV SECTION FILTER: Monster Jam / Drag Racing are hidden on TV devices
   only (see HIDE_ON_TV_KEYWORDS + getVisibleItems). They still show on
   phone/web. They were the only "opens externally" playlist sections and
   routing them through the TV player made the TV side worse.
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
  // while inside a folder, "Back to home" (leaves the app) at the root.
  function updateBackNav() {
    if (!$backNavBtn) return;
    $backNavBtn.textContent = viewStack.length > 1 ? "← Back to Sessions" : "← Back to home";
  }

  // ==== TV PLAYER (inline) ====
  // Elements that the old theater mode used to hide. Kept only so
  // exitTheaterMode can safely clear any leftover inline styles from
  // older cached sessions. Selected lazily since some only exist after
  // render() has run at least once.
  function theaterTargets() {
    return Array.from(document.querySelectorAll(
      ".top, .listHead, #playAllBtn, #episodes, #loadMoreBtn, .playerTop, " +
      ".statusLine, #playerToggleBtn, #watchOnTvBtn, #nowPlayingTitle, " +
      "#nowPlayingLine, #npArtWrap"
    ));
  }

  // The old fullscreen takeover (fixed black backdrop + forcing the
  // iframe to fill the screen) is what caused the black box on this TV's
  // WebView — the hardware video surface couldn't composite into that
  // forced-fullscreen layout and just painted black. So we no longer
  // take over the screen. We simply reveal the normal inline player
  // (styles.css hides .playerShell on TV by default) and scroll it into
  // view. This is the simple, proven player that worked before.
  function enterTheaterMode() {
    if (!isTVDevice()) return;
    const shell = document.querySelector(".playerShell");
    if (shell) {
      shell.style.setProperty("display", "grid", "important");
      try { shell.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) {}
    }
    updateBackNav();
  }

  // Tears the player down cleanly and clears any stale inline styles that
  // an older cached version of this file may have stamped onto these
  // elements (from when fullscreen theater mode existed). Safe to call
  // anytime — removeProperty on an unset property is a no-op.
  function exitTheaterMode() {
    document.body.classList.remove("tvTheater");

    // Actually stop the video itself, not just hide its container — on
    // this TV the hardware video decode surface can keep compositing on
    // top of the page even once its container is hidden, until the
    // underlying iframe load is actually torn down.
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
      ["position", "top", "left", "right", "bottom", "width", "height",
        "max-width", "max-height", "min-height", "aspect-ratio", "margin",
        "padding", "border", "border-radius", "overflow", "background",
        "z-index", "display", "box-shadow"]
        .forEach(p => frameWrap.style.removeProperty(p));
    }

    if ($playerFrame) {
      ["position", "top", "left", "right", "bottom", "width", "height",
        "max-width", "max-height", "min-height", "aspect-ratio", "margin",
        "padding", "border", "border-radius", "overflow", "background",
        "z-index", "display"]
        .forEach(p => $playerFrame.style.removeProperty(p));
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
  // render(), wireCardClicks(), and the Play All collector all go
  // through this so the displayed cards, their click indices, and the
  // Play All queue stay perfectly in sync.
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
  // Uses YouTube's lightweight postMessage protocol directly on a plain
  // iframe embed (enablejsapi=1 + a "listening" handshake), instead of
  // loading the full youtube.com/iframe_api script. The TWA/WebView shell
  // this app runs in on Google TV blocks loading that extra external
  // script, which silently broke playback entirely. This approach needs
  // nothing but the embed itself, so it works the same way plain embeds
  // already did — it just also listens for the "video ended" message so
  // queues can auto-advance.
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

      // playerState: 0 = ENDED, 1 = PLAYING, 2 = PAUSED, in YouTube's
      // embed protocol.
      if (data.event === "infoDelivery" && data.info && typeof data.info.playerState === "number") {
        if (data.info.playerState === 0) {
          advanceQueue();
        }
        playerIsPaused = data.info.playerState === 2;
      }
      // currentTime arrives on most infoDelivery pings (not guaranteed
      // on every single one), so just take it whenever it's present.
      if (data.event === "infoDelivery" && data.info && typeof data.info.currentTime === "number") {
        playerCurrentTime = data.info.currentTime;
      }
    });
  }

  // Toggling Play/Pause via postMessage commands instead of relying on
  // the iframe actually having keyboard focus — on this TV's WebView,
  // native keyboard delivery into a focused cross-origin iframe proved
  // unreliable (remote presses were landing nowhere). Commanding the
  // embed directly works regardless of where DOM focus actually is.
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

  // Same postMessage-command approach as play/pause, for rewind/fast
  // forward. deltaSeconds is negative to rewind, positive to skip
  // ahead. playerCurrentTime is kept up to date by the message
  // listener above, so this is always seeking relative to wherever
  // the player actually is, not a stale value.
  function seekRelative(deltaSeconds) {
    if (!$playerFrame || !$playerFrame.contentWindow) return;
    const target = Math.max(0, playerCurrentTime + deltaSeconds);
    try {
      $playerFrame.contentWindow.postMessage(
        JSON.stringify({ event: "command", func: "seekTo", args: [target, true] }),
        "*"
      );
      // Optimistically update our own tracked time so back-to-back
      // presses (e.g. skipping forward twice quickly) accumulate
      // correctly instead of both jumping from the same stale base,
      // since the next real infoDelivery ping won't arrive instantly.
      playerCurrentTime = target;
    } catch (_) {}
  }

  window.__kdSeek = seekRelative;

  // YouTube's embedded player only starts sending state updates once it
  // sees a "listening" handshake from the parent page, and there's no
  // single reliable moment to send it (the iframe's own load event fires
  // before the player inside has actually initialized), so this just
  // pings a few times over the first few seconds until one lands.
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

    // On TV, .playerShell is hidden by default (so the idle "Watch on
    // TV"/"Show player" box doesn't clutter the screen before anything
    // is selected — see styles.css). Reveal it so the "Open Playlist"
    // button is reachable.
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
      setStatus("Couldn’t parse a YouTube video from that link.");
      return;
    }

    // "Watch on TV" is redundant once we're actually on the TV — only
    // needed for the external-playlist case handled above.
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

    const embed = buildEmbed(track.url, autoplay);
    if (!embed) {
      setStatus("Couldn’t build YouTube embed for that link.");
      return;
    }
    if ($playerFrame) {
      $playerFrame.src = embed;
      startListeningHandshake();
    }

    // On TV, reveal the inline player and scroll to it. No fullscreen
    // takeover anymore — that was the black-box culprit.
    if (onTV) enterTheaterMode();
  }

  // ==== RENDERING ====
  function render() {
    const node = currentNode();

    if (node.__trackPicker) {
      renderTrackPicker(node);
      return;
    }

    const items = getVisibleItems(node);

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

  // Renders an individual track list for a queue (e.g. Wage War's 6
  // songs) so a specific song can actually be picked, instead of
  // always auto-playing from track 0. Reuses the existing .trackHeader
  // / .trackRow CSS that was already in styles.css but never wired up.
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
          <div class="trackHeaderSmall">${tracks.length} track${tracks.length === 1 ? "" : "s"} • tap one to start there</div>
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

    return `
      <button type="button" class="epCard" data-idx="${String(idx)}">
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
    const node = currentNode();
    const items = getVisibleItems(node);

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
          // Multi-track queues get a real track picker instead of just
          // auto-playing from track 0 — that "tap to choose" label was
          // a lie before; this is what actually makes it true.
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
          currentQueue = q;
          playTrackAt(0, true);
          return;
        }

        setStatus("That item isn’t playable (missing mode/tracks).");
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

  function tryAutoPlayFromQuery() {
    const params = new URLSearchParams(location.search);
    const playId = params.get("play");
    const playTitle = params.get("playTitle");
    if (!playId && !playTitle) return;

    let target = null;
    if (playId) target = findNodeByVideoId(ROOT, playId);
    if (!target && playTitle) target = findNodeByTitle(ROOT, playTitle);
    if (!target) return;

    const q = collectPlayableFromNode(target);
    if (!q.length) return;

    currentQueue = q;
    playTrackAt(0, true);
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
    // First Back press while the player is open just closes the player
    // (stops the video, hides it) and returns to the list — no more
    // "Exit Player" theater special-case, and nothing left compositing
    // a black box behind the page.
    if (playerVisible) {
      showPlayer(false);
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
  // exact same single, correct next step (close player, or pop one
  // folder level, or go home) instead of the keypress sometimes getting
  // swallowed with no visible effect.
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

  // Exposed so tv-nav.js's Back-key handler can trigger a full, correct
  // exit (clears any stale theater inline styles + tears down the iframe)
  // instead of leaving anything stuck in place.
  window.__kdExitTheater = exitTheaterMode;

  // ==== INIT ====
  (async function init() {
    try {
      setStatus("Loading sessions…");
      await loadData();
      showPlayer(false);
      tryAutoPlayFromQuery();
      setStatus((($status?.textContent || "") + " — If weird, hard refresh / clear cache.").trim());
    } catch (err) {
      console.error(err);
      setStatus(`App crashed: ${err.message || err}`);
    }
  })();
})();
