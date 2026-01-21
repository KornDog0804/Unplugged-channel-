/* Stripped & Turned Up — app.js (stable)
   - No YouTube Iframe API (avoids mobile hangs/blank layout)
   - Single shared iframe player
   - Queue mode uses playlist=videoIds so it can continue
   - Debug UI hidden unless ?debug=1
*/

(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const DEBUG = params.get("debug") === "1";

  function hideDebugUI() {
    if (DEBUG) return;
    const btn = document.getElementById("btnDiag");
    const panel = document.getElementById("debugPanel");
    const footTip = document.querySelector(".footSmall");
    if (btn) btn.style.display = "none";
    if (panel) panel.style.display = "none";
    if (footTip) footTip.style.display = "none";
  }
  hideDebugUI();

  const EPISODES = Array.isArray(window.EPISODES)
    ? window.EPISODES
    : Array.isArray(window.episodes)
    ? window.episodes
    : [];

  const listWrap = document.getElementById("episodes");
  const statusPill = document.getElementById("status");

  function safeText(s) {
    return (s == null ? "" : String(s)).trim();
  }

  function getYouTubeId(url) {
    const u = safeText(url);
    if (!u) return "";

    // already embed
    if (u.includes("/embed/")) {
      const tail = (u.split("/embed/")[1] || "").split("?")[0];
      return safeText(tail);
    }

    try {
      const parsed = new URL(u);
      if (parsed.hostname.includes("youtu.be")) {
        return parsed.pathname.replace("/", "").trim();
      }
      if (parsed.hostname.includes("youtube.com")) {
        return parsed.searchParams.get("v") || "";
      }
    } catch (e) {}

    const m1 = u.match(/v=([a-zA-Z0-9_-]{6,})/);
    const m2 = u.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
    return (m1 && m1[1]) || (m2 && m2[1]) || "";
  }

  function normalizeEpisodes(arr) {
    const out = [];
    (arr || []).forEach((ep, idx) => {
      if (!ep || typeof ep !== "object") return;

      const title = safeText(ep.title) || `Session ${idx + 1}`;
      const artist = safeText(ep.artist) || "";
      const year = ep.year != null ? String(ep.year) : "";
      const mode = safeText(ep.mode) || (Array.isArray(ep.tracks) && ep.tracks.length > 1 ? "queue" : "fullshow");

      const tracksRaw = Array.isArray(ep.tracks) ? ep.tracks : [];
      const tracks = tracksRaw
        .map((t, i) => ({
          title: safeText(t && t.title) || `Track ${i + 1}`,
          url: safeText(t && t.url),
          id: getYouTubeId(t && t.url),
        }))
        .filter((t) => t.url && t.id);

      if (!tracks.length) return;

      out.push({
        id: `ep_${idx}_${title.replace(/\s+/g, "_").slice(0, 40)}`,
        title,
        artist,
        year,
        mode,
        tracks,
      });
    });
    return out;
  }

  let sessions = normalizeEpisodes(EPISODES);

  // hard block
  const BLOCK = new Set(["KISS", "Pearl Jam"]);
  sessions = sessions.filter((s) => !BLOCK.has(s.artist));

  if (statusPill) statusPill.textContent = `Loaded ${sessions.length} sessions`;

  // ---------- Player inject (single iframe) ----------
  let playerWrap = document.getElementById("playerWrap");
  if (!playerWrap) {
    playerWrap = document.createElement("div");
    playerWrap.id = "playerWrap";
    playerWrap.className = "playerWrap";
    playerWrap.innerHTML = `
      <div id="nowPlayingTitle" class="nowPlayingTitle">Tap a session to play</div>
      <div class="playerShell">
        <div class="playerAspect">
          <iframe
            id="playerFrame"
            class="playerMount"
            src="about:blank"
            title="Stripped & Turned Up Player"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          ></iframe>
        </div>
      </div>
    `;
    if (listWrap && listWrap.parentElement) {
      listWrap.parentElement.insertBefore(playerWrap, listWrap);
    }
  }

  const titleEl = document.getElementById("nowPlayingTitle");
  const frame = document.getElementById("playerFrame");

  function buildEmbedForSession(session) {
    const ids = session.tracks.map((t) => t.id).filter(Boolean);
    if (!ids.length) return "about:blank";

    const first = ids[0];

    // Queue: use playlist=ID2,ID3... so it can keep playing
    if (session.mode === "queue" && ids.length > 1) {
      const rest = ids.slice(1).join(",");
      return `https://www.youtube.com/embed/${first}?autoplay=1&playsinline=1&rel=0&modestbranding=1&playlist=${encodeURIComponent(rest)}`;
    }

    // Full show: single ID
    return `https://www.youtube.com/embed/${first}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;
  }

  function setNowPlaying(session) {
    if (!session) {
      if (titleEl) titleEl.textContent = "Tap a session to play";
      if (frame) frame.src = "about:blank";
      return;
    }

    if (titleEl) titleEl.textContent = session.title;
    if (frame) frame.src = buildEmbedForSession(session);
  }

  // ---------- Tiles ----------
  function render() {
    if (!listWrap) return;
    listWrap.innerHTML = "";

    sessions.forEach((s) => {
      const tile = document.createElement("div");
      tile.className = "epTile";
      tile.tabIndex = 0;

      const metaParts = [s.artist, s.year].filter(Boolean);
      if (s.mode === "queue") metaParts.push(`${s.tracks.length} tracks`);

      tile.innerHTML = `
        <div class="epTitle">${s.title}</div>
        <div class="epMeta">${metaParts.join(" • ")}</div>
      `;

      tile.addEventListener("click", () => setNowPlaying(s));
      tile.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          setNowPlaying(s);
        }
      });

      listWrap.appendChild(tile);
    });

    if (!sessions.length) {
      const msg = document.createElement("div");
      msg.className = "emptyMsg";
      msg.textContent = "No sessions found. Check episodes.js formatting.";
      listWrap.appendChild(msg);
    }
  }

  render();
})();
