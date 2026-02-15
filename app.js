/* Joey’s Acoustic Corner — app.js (defensive + mobile-first)
   Expects: sessions.html has these IDs:
   #episodes, #playAllBtn, #loadMoreBtn, #status,
   #playerFrame, #playerToggleBtn,
   #watchOnTvBtn, #nowPlayingTitle, #nowPlayingLine
*/

(() => {
  "use strict";

  // ==== CONFIG ====
  const DATA_CANDIDATES = ["./episodes_mobile.json", "./episodes.json", "./episodes_mobile.json"];
  const PAGE_SIZE = 24; // how many items to render before "Load more"

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

  // Guard if someone loads this on the wrong page
  if (!$episodes) return;

  // ==== STATE ====
  let ROOT = null;              // full JSON
  let viewStack = [];           // stack of nodes for navigation
  let renderLimit = PAGE_SIZE;  // paging
  let currentQueue = [];        // array of {title,url}
  let currentQueueIndex = 0;
  let playerVisible = false;
  let currentWatchUrl = "";     // "Watch on TV" target

  // ==== UI HELPERS ====
  function setStatus(msg = "") {
    if ($status) $status.textContent = msg;
  }

  function setNowPlaying(title, line) {
    if ($nowPlayingTitle) $nowPlayingTitle.textContent = title || "Now Playing";
    if ($nowPlayingLine) $nowPlayingLine.textContent = line || "";
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
    // Returns: { kind: "video"|"playlist"|"unknown", id: "...", list: "...", watchUrl: "...", embedUrl: "..." }
    try {
      const u = new URL(url);

      // Playlist link (youtube.com/playlist?list=...)
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
        if (list && !id) {
          return {
            kind: "playlist",
            list,
            watchUrl: `https://www.youtube.com/playlist?list=${list}`,
            embedUrl: `https://www.youtube.com/embed/videoseries?list=${list}`
          };
        }
        return {
          kind: "video",
          id,
          watchUrl: `https://www.youtube.com/watch?v=${id}${list ? `&list=${list}` : ""}`,
          embedUrl: `https://www.youtube.com/embed/${id}`
        };
      }

      // youtube.com/live/<id> or /embed/<id> etc.
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
    // Your JSON is an array at the top-level. We wrap it in a synthetic folder node.
    if (Array.isArray(raw)) {
      return { title: "Sessions", mode: "folder", items: raw };
    }
    // If already an object with items, treat it as root.
    if (raw && typeof raw === "object") {
      if (Array.isArray(raw.items)) return raw;
      // Some people accidentally store {data:[...]}
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
    // If it has tracks with URLs, we can play it.
    if (Array.isArray(node.tracks) && node.tracks.some(t => t && t.url)) return true;
    return false;
  }

  function getNodeItems(folderNode) {
    if (!folderNode) return [];
    if (Array.isArray(folderNode.items)) return folderNode.items;
    // root fallback
    if (Array.isArray(folderNode)) return folderNode;
    return [];
  }

  function safeTitle(node) {
    return node?.title || node?.artist || "Untitled";
  }

  // ==== NAV / HISTORY ====
  function currentNode() {
    return viewStack[viewStack.length - 1] || ROOT;
  }

  function pushView(node) {
    viewStack.push(node);
    renderLimit = PAGE_SIZE;
    render();
    updateHash();
  }

  function popView() {
    if (viewStack.length > 1) {
      viewStack.pop();
      renderLimit = PAGE_SIZE;
      render();
      updateHash();
    }
  }

  function updateHash() {
    // Encode path by titles so we can deep-link-ish
    const pathTitles = viewStack.map(n => safeTitle(n)).slice(1); // skip synthetic root
    const hash = pathTitles.length ? `#${encodeURIComponent(pathTitles.join(" / "))}` : "";
    if (location.hash !== hash) history.replaceState(null, "", `${location.pathname}${hash}`);
  }

  // ==== QUEUE BUILDING ====
  function collectPlayableFromNode(node) {
    // Returns array of {title,url}
    if (!node) return [];

    // If folder: walk children, but only collect playable nodes at leaf
    if (isFolder(node)) {
      const out = [];
      for (const child of getNodeItems(node)) {
        out.push(...collectPlayableFromNode(child));
      }
      return out;
    }

    // If node has tracks:
    const tracks = Array.isArray(node.tracks) ? node.tracks : [];

    // playlist: usually has one track whose url is playlist url
    if (node.mode === "playlist") {
      const t = tracks.find(t => t?.url) || node.url ? { title: safeTitle(node), url: node.url } : null;
      if (t && t.url) return [{ title: t.title || safeTitle(node), url: t.url }];
      // fallback: search for playlist url in tracks
      const first = tracks.find(t => t?.url);
      return first ? [{ title: first.title || safeTitle(node), url: first.url }] : [];
    }

    // fullshow: one url
    if (node.mode === "fullshow") {
      const first = tracks.find(t => t?.url);
      return first ? [{ title: safeTitle(node), url: first.url }] : [];
    }

    // queue: multiple urls
    if (node.mode === "queue") {
      return tracks
        .filter(t => t && t.url)
        .map(t => ({ title: t.title || safeTitle(node), url: t.url }));
    }

    // generic: if tracks exist, treat as queue
    if (tracks.length) {
      return tracks
        .filter(t => t && t.url)
        .map(t => ({ title: t.title || safeTitle(node), url: t.url }));
    }

    return [];
  }

  function collectPlayableFromCurrentView() {
    const node = currentNode();
    const items = getNodeItems(node);
    const out = [];
    for (const it of items) {
      if (isFolder(it)) {
        // folder itself is not playable, but may contain playable items
        out.push(...collectPlayableFromNode(it));
      } else if (isPlayableNode(it)) {
        out.push(...collectPlayableFromNode(it));
      }
    }
    return out;
  }

  // ==== PLAYER CONTROL ====
  function showPlayer(show) {
    playerVisible = !!show;
    if ($playerToggleBtn) $playerToggleBtn.textContent = playerVisible ? "Hide player" : "Show player";
    document.body.classList.toggle("playerOpen", playerVisible);

    // If hiding, we can stop playback by clearing iframe src
    if (!playerVisible && $playerFrame) {
      $playerFrame.src = "";
    } else if (playerVisible && currentQueue.length) {
      // restore current
      playTrackAt(currentQueueIndex, false);
    }
  }

  function playTrackAt(index, autoplay = true) {
    if (!currentQueue.length) return;
    if (index < 0 || index >= currentQueue.length) return;

    currentQueueIndex = index;
    const track = currentQueue[currentQueueIndex];

    const info = parseYouTube(track.url);
    currentWatchUrl = info.watchUrl || track.url;

    if ($watchOnTvBtn) {
      $watchOnTvBtn.href = currentWatchUrl;
      $watchOnTvBtn.style.display = "inline-flex";
    }

    const embed = buildEmbed(track.url, autoplay);
    if (!embed) {
      setStatus("Couldn’t build YouTube embed for that link.");
      return;
    }

    if ($playerFrame) $playerFrame.src = embed;

    setNowPlaying("Now Playing", track.title || "Playing…");
    setStatus(`Playing ${currentQueueIndex + 1} of ${currentQueue.length}`);
    if (!playerVisible) showPlayer(true);
  }

  // Auto-advance for queue: YouTube iframe doesn’t easily tell us “ended” without API.
  // So we provide manual "Play All" + tap items. Simple + stable.

  // ==== RENDERING ====
  function render() {
    const node = currentNode();
    const items = getNodeItems(node);

    // header line
    setNowPlaying("Now Playing", "Pick a session below 👇");

    // build list
    const visible = items.slice(0, renderLimit);
    const html = visible.map(renderCard).join("");

    $episodes.innerHTML = html || `<div class="empty">Nothing here yet.</div>`;

    // show/hide Load more
    if ($loadMoreBtn) {
      const more = items.length > renderLimit;
      $loadMoreBtn.style.display = more ? "inline-flex" : "none";
    }

    // click wiring
    wireCardClicks();

    // status
    const path = viewStack.slice(1).map(safeTitle);
    setStatus(path.length ? `In: ${path.join(" / ")}` : `Showing ${Math.min(items.length, renderLimit)} of ${items.length}`);
  }

  function renderCard(node, idx) {
    const title = escapeHtml(safeTitle(node));
    const subtitleBits = [];

    if (node.artist) subtitleBits.push(escapeHtml(node.artist));
    if (node.year) subtitleBits.push(escapeHtml(node.year));

    const subtitle = subtitleBits.join(" • ");
    const small = node.mode === "playlist"
      ? "playlist • opens as series"
      : node.mode === "queue"
        ? "4 tracks • tap to choose"
        : node.mode === "fullshow"
          ? "full show"
          : node.mode === "folder"
            ? `${(node.items?.length ?? 0)} items`
            : (node.tracks?.length ? `${node.tracks.length} tracks` : "");

    const icon = escapeHtml(node.icon || "");
    const dataIdx = String(idx);

    return `
      <div class="epCard" data-idx="${dataIdx}">
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
      card.addEventListener("click", () => {
        const i = Number(card.getAttribute("data-idx"));
        const chosen = items[i];
        if (!chosen) return;

        // folder navigation
        if (isFolder(chosen)) {
          pushView(chosen);
          return;
        }

        // playable node
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
      }, { passive: true });
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

        // init stack: [root]
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
    // If nothing set yet, hide it to avoid dead link
    $watchOnTvBtn.style.display = "none";
  }

  // ==== SWIPE BACK/FORWARD (mobile) ====
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

    // Horizontal swipe only
    if (Math.abs(dx) < 60) return;
    if (Math.abs(dy) > 70) return;

    if (dx > 0) {
      // swipe right = back
      popView();
    } else {
      // swipe left = forward (only if there was a "forward" stack… we don’t keep one)
      // So we do nothing. Keeps it simple and avoids weirdness.
    }
  }, { passive: true });

  // ==== INIT ====
  (async function init() {
    try {
      setStatus("Loading sessions…");
      await loadData();
      showPlayer(false);

      // IMPORTANT: If you have a service worker, cached old JS will haunt you.
      // This prints an obvious note so you remember to hard refresh.
      setStatus((($status?.textContent || "") + " — If weird, hard refresh / clear cache.").trim());
    } catch (err) {
      console.error(err);
      setStatus(`App crashed: ${err.message || err}`);
    }
  })();
})();
