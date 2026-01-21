/* Stripped & Turned Up — app.js (LOCKED BASELINE)
   - Uses #playerWrap + #sessionsList (from index.html)
   - Creates the shared player EVEN IF #playerWrap already exists
   - Uses #episodes for cards (CSS .ep styles)
   - Updates #status pill
   - Debug only when ?debug=1
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

  // We support BOTH layouts:
  // - New HTML: #playerWrap + #sessionsList
  // - Older HTML: #status + #episodes inside a card
  const sessionsList = $("#sessionsList");
  const list = $("#episodes") || $("#sessionsList") || sessionsList;
  const status = $("#status") || $("#loadedCount");

  function logLine(line) {
    if (!DEBUG) return;
    console.log("[STU]", line);
  }

  function el(tag, attrs = {}, kids = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function")
        node.addEventListener(k.slice(2), v);
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

  function toEmbed(url) {
    const id = ytIdFrom(url);
    if (!id) return "";
    return `https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;
  }

  // ---------- Shared player (ALWAYS ensure it exists) ----------
  let playerWrap = $("#playerWrap");
  if (!playerWrap) {
    playerWrap = el("section", { id: "playerWrap" });
    main.insertBefore(playerWrap, main.firstChild);
  }

  let playerTitle = $("#nowPlayingTitle");
  let playerFrame = $("#playerFrame");

  // If wrapper exists but children don’t, BUILD THEM.
  if (!playerTitle || !playerFrame) {
    playerWrap.innerHTML = "";

    playerTitle = el(
      "div",
      { id: "nowPlayingTitle", class: "now-playing-title" },
      "Tap a session to play"
    );

    playerFrame = el("iframe", {
      id: "playerFrame",
      class: "player-frame",
      src: "about:blank",
      allow:
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
      allowfullscreen: "true",
      frameborder: "0",
      title: "Stripped & Turned Up Player",
    });

    const shell = el("div", { class: "player-shell" }, playerFrame);

    // (Optional) TV look wrapper if your CSS supports it — safe even if not
    const tv = el("div", { class: "tvFrame" }, [
      el("div", { class: "tvTopBar" }, [
        el("div", { class: "tvLED" }, ""),
        el("div", { class: "tvLabel" }, "STRIPPED & TURNED UP"),
        el("div", { class: "tvKnob" }, ""),
      ]),
      el("div", { class: "playerFrameWrap" }, shell),
      el("div", { class: "nowPlaying", id: "nowPlayingLine" }, "Ready."),
    ]);

    // If your tvFrame styles exist, use it. If not, it just becomes a normal div.
    playerWrap.className = "player-wrap";
    playerWrap.appendChild(tv);
    playerWrap.insertBefore(playerTitle, tv);

    logLine("Player built inside existing #playerWrap.");
  }

  const nowPlayingLine = $("#nowPlayingLine");

  function setNowPlaying(title, url) {
    if (playerTitle) playerTitle.textContent = title || "Tap a session to play";
    if (nowPlayingLine) nowPlayingLine.textContent = title ? "Playing now." : "Ready.";

    if (!playerFrame) return;

    if (!url) {
      playerFrame.src = "about:blank";
      return;
    }
    const embed = toEmbed(url);
    if (!embed) {
      playerFrame.src = "about:blank";
      logLine("BAD LINK: " + url);
      return;
    }
    playerFrame.src = embed;
  }

  function normalizeEpisodes(arr) {
    const out = [];
    (arr || []).forEach((ep, idx) => {
      if (!ep || typeof ep !== "object") return;

      const title = safeText(ep.title) || `Session ${idx + 1}`;
      const artist = safeText(ep.artist) || "";
      const year = ep.year != null ? String(ep.year) : "";
      const tracks = Array.isArray(ep.tracks) ? ep.tracks : [];
      const streamUrl = tracks[0] ? safeText(tracks[0].url) : "";
      if (!streamUrl) return;

      out.push({
        id: `ep_${idx}_${title.replace(/\s+/g, "_").slice(0, 30)}`,
        title,
        artist,
        year,
        streamUrl,
        tracksCount: tracks.length,
      });
    });
    return out;
  }

  const sessions = normalizeEpisodes(EPISODES);

  if (status) status.textContent = sessions.length ? `Loaded ${sessions.length} sessions` : "No sessions found";

  if (!list) {
    logLine("Missing list container (#episodes or #sessionsList).");
    return;
  }

  // Clear old tiles/cards
  list.innerHTML = "";

  // Render as .ep cards (matches your CSS)
  sessions.forEach((s) => {
    const meta = [s.artist, s.year].filter(Boolean).join(" • ");

    const card = el("div", { class: "ep", tabindex: "0", "data-id": s.id }, [
      el("div", { class: "epHead" }, [
        el("div", {}, [
          el("div", { class: "epTitle" }, s.title),
          el("div", { class: "epMeta" }, meta),
          el("div", { class: "epSmall" }, s.tracksCount > 1 ? `${s.tracksCount} tracks` : "Full session"),
        ]),
        el("div", { class: "chev", "aria-hidden": "true" }, "›"),
      ]),
    ]);

    const play = () => setNowPlaying(s.title, s.streamUrl);

    card.addEventListener("click", play);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        play();
      }
    });

    list.appendChild(card);
  });

  logLine("Debug = " + DEBUG);
  logLine("EPISODES length = " + EPISODES.length);
  logLine("Sessions rendered = " + sessions.length);

  // ============================================================
  // ADDED (1): Sticky player (no CSS file changes required)
  // ============================================================
  (function makePlayerSticky() {
    if (!playerWrap) return;

    // Stick under the header area; once header hides, it still stays pinned.
    playerWrap.style.position = "sticky";
    playerWrap.style.top = "10px";
    playerWrap.style.zIndex = "50";

    // Prevent the list from visually "tucking under" the player on some phones
    playerWrap.style.marginBottom = playerWrap.style.marginBottom || "12px";
  })();

  // ============================================================
  // ADDED (2): Hide header on scroll down, show on scroll up
  // Requires: <header id="topBar" ...>
  // ============================================================
  (function hideHeaderOnScroll() {
    const topBar = document.getElementById("topBar");
    if (!topBar) return;

    let lastY = window.scrollY || 0;
    let ticking = false;
    let hidden = false;

    topBar.style.willChange = "transform";
    topBar.style.transition =
      topBar.style.transition || "transform 220ms ease, opacity 220ms ease";
    topBar.style.transform = "translateY(0)";
    topBar.style.opacity = "1";

    const apply = () => {
      const y = window.scrollY || 0;
      const dy = y - lastY;

      // ignore tiny jitter
      if (Math.abs(dy) < 6) {
        lastY = y;
        ticking = false;
        return;
      }

      // scroll down -> hide (once you're past the top)
      if (dy > 0 && y > 40 && !hidden) {
        hidden = true;
        topBar.style.transform = "translateY(-110%)";
        topBar.style.opacity = "0";
      }

      // scroll up -> show
      if (dy < 0 && hidden) {
        hidden = false;
        topBar.style.transform = "translateY(0)";
        topBar.style.opacity = "1";
      }

      // always show at very top
      if (y <= 10 && hidden) {
        hidden = false;
        topBar.style.transform = "translateY(0)";
        topBar.style.opacity = "1";
      }

      lastY = y;
      ticking = false;
    };

    window.addEventListener(
      "scroll",
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(apply);
        }
      },
      { passive: true }
    );
  })();
})();
