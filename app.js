/* Joey’s Acoustic Corner — app.js (mobile-first + track drill-down + playlist fix)
   Expects: sessions.html has these IDs:
   #episodes, #playAllBtn, #loadMoreBtn, #status,
   #playerFrame, #playerToggleBtn,
   #watchOnTvBtn, #nowPlayingTitle, #nowPlayingLine
*/

(() => {
  "use strict";

  // ==== CONFIG ====
  const DATA_CANDIDATES = ["./episodes_mobile.json", "./episodes.json", "./episodes_mobile.json"];
  const PAGE_SIZE = 24;

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

  if (!$episodes) return;

  // ==== STATE ====
  let ROOT = null;
  let viewStack = [];           // navigation nodes (folders)
  let renderLimit = PAGE_SIZE;

  // Track drill-down state
  let trackView = null;         // { parentNode, tracks:[{title,url}], title, subtitle }
  let trackRenderLimit = PAGE_SIZE;

  // Player
  let currentQueue = [];        // [{title,url}]
  let currentQueueIndex = 0;
  let playerVisible = false;
  let currentWatchUrl = "";

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

  // ==== YOUTUBE PARSING (defensive) ====
  function parseYouTube(url) {
    // Returns: { kind: "video"|"playlist"|"unknown", id, list, watchUrl, embedUrl }
    try {
      const u = new URL(url);

      // youtube.com/playlist?list=...
      if (u.pathname.includes("/playlist") && u.searchParams.get("list")) {
        const list = u.searchParams.get("list");
        return {
          kind: "playlist",
          list,
          watchUrl: `https://www.youtube.com/playlist?list=${list}`,
          embedUrl: `https://www.youtube.com/embed/videoseries?list=${list}`
        };
      }

      // youtube.com/watch?v=... (&list= optional)
      if (u.pathname.includes("/watch")) {
        const id = u.searchParams.get("v");
        const list = u.searchParams.get("list");

        // If someone pasted a watch URL that is really meant to be playlist-only
        if (!id && list) {
          return {
            kind: "playlist",
            list,
            watchUrl: `https://www.youtube.com/playlist?list=${list}`,
            embedUrl: `https://www.youtube.com/embed/videoseries?list=${list}`
          };
        }

        if (id) {
          return {
            kind: "video",
            id,
            watchUrl: `https://www.youtube.com/watch?v=${id}${list ? `&list=${list}` : ""}`,
            embedUrl: `https://www.youtube.com/embed/${id}`
          };
        }
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

      // Already-embed playlist (videoseries)
      if (u.pathname.includes("/embed/videoseries") && u.searchParams.get("list")) {
        const list = u.searchParams.get("list");
        return {
          kind: "playlist",
          list,
          watchUrl: `https://www.youtube.com/playlist?list=${list}`,
          embedUrl: `https://www.youtube.com/embed/videoseries?list=${list}`
        };
      }

      // /embed/<id>, /live/<id>, etc.
      const parts = u.pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && last.length >= 8) {
        return {
          kind: "video",
          id: last,
          watchUrl: `https://www.youtube.com/watch?v=${last}`,
          embedUrl: `https://www.youtube.com/embed/${last}`
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
    throw new Error("JSON root must be an array or object with .items array.");
  }

  function isFolder(node) {
    return node && (node.mode === "folder" || Array.isArray(node.items));
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

  function isPlayableNode(node) {
    if (!node || typeof node !== "object") return false;
    if (node.mode === "queue" || node.mode === "fullshow" || node.mode === "playlist") return true;
    if (Array.isArray(node.tracks) && node.tracks.some(t => t && t.url)) return true;
    if (node.url) return true;
    return false;
  }

  // ==== NAV / HISTORY ====
  function currentNode() {
    return viewStack[viewStack.length - 1] || ROOT;
  }

  function pushView(node) {
    trackView = null;                 // leaving track view
    trackRenderLimit = PAGE_SIZE;
    viewStack.push(node);
    renderLimit = PAGE_SIZE;
    render();
    updateHash();
  }

  function popView() {
    if (trackView) {
      // If we are in track drill-down, back goes to the folder list
      trackView = null;
      trackRenderLimit = PAGE_SIZE;
      render();
      return;
    }
    if (viewStack.length > 1) {
      viewStack.pop();
      renderLimit = PAGE_SIZE;
      render();
      updateHash();
    }
  }

  function updateHash() {
    const pathTitles = viewStack.map(n => safeTitle(n)).slice(1);
    const hash = pathTitles.length ? `#${encodeURIComponent(pathTitles.join(" / "))}` : "";
    if (location.hash !== hash) history.replaceState(null, "", `${location.pathname}${hash}`);
  }

  // ==== PLAYABLE COLLECTION ====
  function getPlaylistUrlFromNode(node) {
    // playlist URL can live in: node.url OR node.tracks[0].url
    if (!node) return "";
    if (node.url) return node.url;
    if (Array.isArray(node.tracks)) {
      const first = node.tracks.find(t => t?.url);
      if (first?.url) return first.url;
    }
    return "";
  }

  function collectPlayableFromNode(node) {
    if (!node) return [];

    if (isFolder(node)) {
      const out = [];
      for (const child of getNodeItems(node)) out.push(...collectPlayableFromNode(child));
      return out;
    }

    const tracks = Array.isArray(node.tracks) ? node.tracks : [];

    if (node.mode === "playlist") {
      const url = getPlaylistUrlFromNode(node);
      return url ? [{ title: safeTitle(node), url }] : [];
    }

    if (node.mode === "fullshow") {
      const first = tracks.find(t => t?.url);
      return first ? [{ title: safeTitle(node), url: first.url }] : [];
    }

    if (node.mode === "queue") {
      return tracks.filter(t => t?.url).map(t => ({ title: t.title || safeTitle(node), url: t.url }));
    }

    // generic
    if (tracks.length) {
      return tracks.filter(t => t?.url).map(t => ({ title: t.title || safeTitle(node), url: t.url }));
    }

    if (node.url) return [{ title: safeTitle(node), url: node.url }];

    return [];
  }

  function collectPlayableFromCurrentView() {
    const node = currentNode();
    const items = getNodeItems(node);
    const out = [];
    for (const it of items) out.push(...collectPlayableFromNode(it));
    return out;
  }

  // ==== TRACK DRILL-DOWN ====
  function openTrackView(node) {
    const tracks = collectPlayableFromNode(node);

    if (!tracks.length) {
      setStatus("No playable tracks found in that item.");
      return;
    }

    // If it’s a playlist or fullshow (single item), just play it immediately
    if (node.mode === "playlist" || node.mode === "fullshow" || tracks.length === 1) {
      currentQueue = tracks;
      playTrackAt(0, true);
      return;
    }

    // For queues (multi-track), show track list
    trackView = {
      parentNode: node,
      title: safeTitle(node),
      subtitle: node.artist ? node.artist : (node.year ? String(node.year) : ""),
      tracks
    };
    trackRenderLimit = PAGE_SIZE;
    render();
  }

  // ==== PLAYER CONTROL ====
  function showPlayer(show) {
    playerVisible = !!show;
    if ($playerToggleBtn) $playerToggleBtn.textContent = playerVisible ? "Hide player" : "Show player";
    document.body.classList.toggle("playerOpen", playerVisible);

    if (!playerVisible && $playerFrame) $playerFrame.src = "";
    if (playerVisible && currentQueue.length) playTrackAt(currentQueueIndex, false);
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

  // ==== RENDERING ====
  function render() {
    // TRACK VIEW (drill-down)
    if (trackView) {
      renderTrackList();
      return;
    }

    // FOLDER VIEW
    const node = currentNode();
    const items = getNodeItems(node);

    setNowPlaying("Now Playing", "Pick a session below 👇");

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

  function renderTrackList() {
    const tv = trackView;
    const tracks = tv.tracks || [];
    const visible = tracks.slice(0, trackRenderLimit);

    setNowPlaying("Now Playing", `Tracks: ${tv.title}`);

    const header = `
      <div class="trackHeader">
        <button class="trackBackBtn" type="button">← Back</button>
        <div class="trackHeaderText">
          <div class="trackHeaderTitle">${escapeHtml(tv.title)}</div>
          ${tv.subtitle ? `<div class="trackHeaderSub">${escapeHtml(tv.subtitle)}</div>` : ""}
          <div class="trackHeaderSmall">${tracks.length} tracks • tap one to play</div>
        </div>
      </div>
    `;

    const rows = visible.map((t, i) => `
      <div class="trackRow" data-track-idx="${i}">
        <div class="trackRowTitle">${escapeHtml(t.title || `Track ${i + 1}`)}</div>
        <div class="trackRowChevron">▶</div>
      </div>
    `).join("");

    const footer = `
      <div class="trackFooter">
        <button class="trackPlayAllBtn" type="button">Play All</button>
        ${tracks.length > trackRenderLimit ? `<button class="trackMoreBtn" type="button">Load more</button>` : ""}
      </div>
    `;

    $episodes.innerHTML = header + rows + footer;

    // Hide the main Load More button while in track view
    if ($loadMoreBtn) $loadMoreBtn.style.display = "none";

    // Wire actions
    const backBtn = document.querySelector(".trackBackBtn");
    backBtn?.addEventListener("click", () => popView());

    document.querySelectorAll(".trackRow").forEach(row => {
      row.addEventListener("click", () => {
        const idx = Number(row.getAttribute("data-track-idx"));
        const picked = tracks[idx];
        if (!picked) return;

        currentQueue = tracks;     // keep whole queue available
        playTrackAt(idx, true);    // start at selected track
      }, { passive: true });
    });

    const playAll = document.querySelector(".trackPlayAllBtn");
    playAll?.addEventListener("click", () => {
      if (!tracks.length) return;
      currentQueue = tracks;
      playTrackAt(0, true);
    });

    const more = document.querySelector(".trackMoreBtn");
    more?.addEventListener("click", () => {
      trackRenderLimit += PAGE_SIZE;
      render();
    });

    setStatus(`In tracks: ${tv.title}`);
  }

  function renderCard(node, idx) {
    const title = escapeHtml(safeTitle(node));
    const subtitleBits = [];
    if (node.artist) subtitleBits.push(escapeHtml(node.artist));
    if (node.year) subtitleBits.push(escapeHtml(node.year));
    const subtitle = subtitleBits.join(" • ");

    const small =
      node.mode === "playlist" ? "playlist • opens as series" :
      node.mode === "queue" ? `${(node.tracks?.length ?? 0)} tracks • tap to choose` :
      node.mode === "fullshow" ? "full show" :
      node.mode === "folder" ? `${(node.items?.length ?? 0)} items` :
      (node.tracks?.length ? `${node.tracks.length} tracks` : "");

    const icon = escapeHtml(node.icon || "");
    return `
      <div class="epCard" data-idx="${String(idx)}">
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

        if (isFolder(chosen)) {
          pushView(chosen);
          return;
        }

        if (isPlayableNode(chosen)) {
          // IMPORTANT: queue should open tracks view, not force autoplay
          openTrackView(chosen);
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
        ROOT = normalizeRoot(raw);
        viewStack = [ROOT];
        trackView = null;
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
    $playerToggleBtn.addEventListener("click", () => showPlayer(!playerVisible));
  }

  if ($watchOnTvBtn) $watchOnTvBtn.style.display = "none";

  // ==== SWIPE BACK (mobile) ====
  let touchStartX = 0, touchStartY = 0, touchActive = false;

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

    if (dx > 0) popView(); // swipe right = back
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
