/* Joey’s Acoustic Corner — app.js (defensive + mobile-first)
   Expects: sessions.html has these IDs:
   #episodes, #playAllBtn, #loadMoreBtn, #status,
   #playerFrame, #playerToggleBtn,
   #watchOnTvBtn, #nowPlayingTitle, #nowPlayingLine,
   #npArtWrap, #npArt
*/

(() => {
  "use strict";

  // ==== CONFIG ====
  const DATA_CANDIDATES = ["./episodes_mobile.json", "./episodes.json", "./episodes_mobile.json"];
  const PAGE_SIZE = 24;

  // Playlist embeds are flaky across mobile + iOS + some WebViews.
  // Force playlists to OPEN externally instead of embedding.
  const PLAYLISTS_OPEN_EXTERNALLY = true;

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

  // Album art
  const $npArtWrap = document.getElementById("npArtWrap");
  const $npArt = document.getElementById("npArt");

  if (!$episodes) return;

  // ==== STATE ====
  let ROOT = null;
  let viewStack = [];
  let renderLimit = PAGE_SIZE;
  let currentQueue = [];        // array of {title,url,kind}
  let currentQueueIndex = 0;
  let playerVisible = false;
  let currentWatchUrl = "";

  // Cache of node -> videoId so we don't re-walk folder trees on every render
  const videoIdCache = new WeakMap();

  // ==== UI HELPERS ====
  function setStatus(msg = "") {
    if ($status) $status.textContent = msg;
  }

  function setNowPlaying(title, line) {
    if ($nowPlayingTitle) $nowPlayingTitle.textContent = title || "Now Playing";
    if ($nowPlayingLine) $nowPlayingLine.textContent = line || "";
  }

  function setNowPlayingArt(videoId) {
    if (!$npArtWrap || !$npArt) return;

    if (videoId) {
      $npArtWrap.classList.remove("npArtFallback");
      $npArt.style.display = "block";
      $npArt.onerror = function () {
        this.onerror = null;
        this.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
      };
      $npArt.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      $npArt.alt = "";
    } else {
      $npArtWrap.classList.add("npArtFallback");
      $npArt.style.display = "none";
      $npArt.removeAttribute("src");
    }
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ==== YOUTUBE PARSING ====
  function parseYouTube(url) {
    try {
      const u = new URL(url);

      // Playlist
      if (u.pathname.includes("/playlist") && u.searchParams.get("list")) {
        const list = u.searchParams.get("list");
        return {
          kind: "playlist",
          list,
          watchUrl: `https://www.youtube.com/playlist?list=${list}`,
          embedUrl: `https://www.youtube.com/embed/videoseries?list=${list}`
        };
      }

      // youtu.be/<id>
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

      // youtube.com/watch?v=<id>
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

      // fallback: /live/<id> /embed/<id> etc.
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

  function buildEmbed(url, autoplay = true) {
    const info = parseYouTube(url);
    if (!info.embedUrl) return "";
    const params = new URLSearchParams();
    if (autoplay) params.set("autoplay", "1");
    params.set("rel", "0");
    params.set("modestbranding", "1");
    params.set("playsinline", "1");
    return `${info.embedUrl}?${params.toString()}`;
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

  function safeTitle(node) {
    return node?.title || node?.artist || "Untitled";
  }

  // ==== ALBUM ART HELPERS ====
  function findFirstVideoId(node) {
    if (!node || typeof node !== "object") return null;
    if (videoIdCache.has(node)) return videoIdCache.get(node);

    let result = null;

    if (isFolder(node)) {
      for (const child of getNodeItems(node)) {
        result = findFirstVideoId(child);
        if (result) break;
      }
    } else {
      const playable = collectPlayableFromNode(node);
      if (playable.length) {
        const info = parseYouTube(playable[0].url);
        if (info.kind === "video" && info.id) result = info.id;
      }
    }

    videoIdCache.set(node, result);
    return result;
  }

  // ==== NAV / HISTORY (FIXED: back button now steps through folders) ====
  function currentNode() {
    return viewStack[viewStack.length - 1] || ROOT;
  }

  function buildHashUrl() {
    const pathTitles = viewStack.map(n => safeTitle(n)).slice(1);
    const hash = pathTitles.length ? `#${encodeURIComponent(pathTitles.join(" / "))}` : "";
    return `${location.pathname}${hash}`;
  }

  // Entering a folder: push a REAL history entry so the back button
  // and swipe-back both step out one level at a time, instead of
  // jumping straight back to the home page.
  function pushView(node) {
    viewStack.push(node);
    renderLimit = PAGE_SIZE;
    history.pushState({ viewDepth: viewStack.length }, "", buildHashUrl());
    render();
  }

  // Called by swipe-back gesture and the "back" affordance.
  // Routes through history.back() so the phone's back button and the
  // in-app swipe gesture stay perfectly in sync.
  function popView() {
    if (viewStack.length > 1) {
      history.back();
    }
  }

  // Fires when the user presses the phone/browser back button (or swipe
  // triggers history.back() above). Pops exactly one folder level.
  // Once viewStack is back down to the root, the NEXT back press has
  // nothing left to pop in this document, so the browser naturally
  // navigates away to whatever was open before sessions.html (home) —
  // which is exactly the desired behavior.
  window.addEventListener("popstate", () => {
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

    // ✅ playlist: use FIRST track URL (your JSON stores it there)
    if (node.mode === "playlist") {
      const first = tracks.find(t => t?.url);
      if (first?.url) return [{ title: first.title || safeTitle(node), url: first.url, kind: "playlist" }];
      if (node.url) return [{ title: safeTitle(node), url: node.url, kind: "playlist" }];
      return [];
    }

    if (node.mode === "fullshow") {
      const first = tracks.find(t => t?.url);
      return first ? [{ title: safeTitle(node), url: first.url, kind: "video" }] : [];
    }

    if (node.mode === "queue") {
      return tracks
        .filter(t => t && t.url)
        .map(t => ({ title: t.title || safeTitle(node), url: t.url, kind: "video" }));
    }

    if (tracks.length) {
      return tracks
        .filter(t => t && t.url)
        .map(t => ({ title: t.title || safeTitle(node), url: t.url, kind: "video" }));
    }

    return [];
  }

  function collectPlayableFromCurrentView() {
    const node = currentNode();
    const items = getNodeItems(node);
    const out = [];
    for (const it of items) {
      if (isFolder(it)) out.push(...collectPlayableFromNode(it));
      else if (isPlayableNode(it)) out.push(...collectPlayableFromNode(it));
    }
    return out;
  }

  // ==== PLAYER CONTROL ====
  function showPlayer(show) {
    playerVisible = !!show;
    if ($playerToggleBtn) $playerToggleBtn.textContent = playerVisible ? "Hide player" : "Show player";
    document.body.classList.toggle("playerOpen", playerVisible);

    if (!playerVisible && $playerFrame) $playerFrame.src = "";
    else if (playerVisible && currentQueue.length) playTrackAt(currentQueueIndex, false);
  }

  function showOpenExternallyMessage(title, watchUrl, videoId) {
    if ($playerFrame) {
      $playerFrame.src = "about:blank";
    }
    setNowPlaying("Open in YouTube / SmartTube", title);
    setNowPlayingArt(videoId || null);
    setStatus("This playlist opens externally (more reliable than embeds).");
    if ($watchOnTvBtn) {
      $watchOnTvBtn.href = watchUrl;
      $watchOnTvBtn.style.display = "inline-flex";
      $watchOnTvBtn.textContent = "Open Playlist";
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

    if ($watchOnTvBtn) {
      $watchOnTvBtn.href = currentWatchUrl;
      $watchOnTvBtn.style.display = "inline-flex";
      $watchOnTvBtn.textContent = "Watch on TV";
    }

    if ((track.kind === "playlist" || info.kind === "playlist") && PLAYLISTS_OPEN_EXTERNALLY) {
      showOpenExternallyMessage(track.title || "Playlist", currentWatchUrl, videoId);
      return;
    }

    const embed = buildEmbed(track.url, autoplay);
    if (!embed) {
      setStatus("Couldn’t build YouTube embed for that link.");
      return;
    }

    if ($playerFrame) $playerFrame.src = embed;

    setNowPlaying("Now Playing", track.title || "Playing…");
    setNowPlayingArt(videoId);
    setStatus(`Playing ${currentQueueIndex + 1} of ${currentQueue.length}`);
    if (!playerVisible) showPlayer(true);
  }

  // ==== RENDERING ====
  function render() {
    const node = currentNode();
    const items = getNodeItems(node);

    setNowPlaying("Now Playing", "Pick a session below 👇");
    setNowPlayingArt(null);

    const visible = items.slice(0, renderLimit);
    const html = visible.map(renderCard).join("");

    $episodes.innerHTML = html || `<div class="empty">Nothing here yet.</div>`;

    if ($loadMoreBtn) {
      const more = items.length > renderLimit;
      $loadMoreBtn.style.display = more ? "inline-flex" : "none";
    }

    wireCardClicks();

    const path = viewStack.slice(1).map(safeTitle);
    setStatus(path.length ? `In: ${path.join(" / ")}` : `Showing ${Math.min(items.length, renderLimit)} of ${items.length}`);
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

    const videoId = findFirstVideoId(node);
    const safeId = videoId ? escapeHtml(videoId) : "";
    const artHtml = safeId
      ? `<div class="epArtWrap">
           <img class="epArt" src="https://img.youtube.com/vi/${safeId}/mqdefault.jpg" alt="" loading="lazy"
                onerror="this.closest('.epArtWrap').classList.add('epArtFallback'); this.remove();">
         </div>`
      : `<div class="epArtWrap epArtFallback"></div>`;

    return `
      <div class="epCard" data-idx="${String(idx)}" role="button" tabindex="0">
        ${artHtml}
        <div class="epMain">
          <div class="epTitle">${icon ? icon + " " : ""}${title}</div>
          ${subtitle ? `<div class="epMeta">${subtitle}</div>` : ""}
          ${small ? `<div class="epSmall">${escapeHtml(small)}</div>` : ""}
        </div>
        <div class="epChevron">›</div>
      </div>
    `;
  }

  function wireCardClicks() {
    const node = currentNode();
    const items = getNodeItems(node);

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
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") handler();
      });
    });
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
      showPlayer(!playerVisible);
    });
  }

  if ($watchOnTvBtn) {
    $watchOnTvBtn.style.display = "none";
  }

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

  // ==== INIT ====
  (async function init() {
    try {
      setStatus("Loading sessions…");
      await loadData();
      showPlayer(false);
      setStatus((($status?.textContent || "") + " — If weird, hard refresh / clear cache.").trim());
    } catch (err) {
      console.error(err);
      setStatus(`App crashed: ${err.message || err}`);
    }
  })();
})();
