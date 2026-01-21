/* Stripped & Turned Up — app.js (MATCHES index.html + styles.css)
   - Uses #episodes + .ep cards
   - Updates #status pill
   - Single shared player at top
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
  const list = $("#episodes");
  const status = $("#status");
  const debugPanel = $("#debugPanel");
  const btnDiag = $("#btnDiag");
  const debugLines = $("#debugLines");

  function logLine(line) {
    if (!DEBUG) return;
    if (debugLines) {
      const div = document.createElement("div");
      div.textContent = line;
      debugLines.appendChild(div);
    }
    console.log("[STU]", line);
  }

  // Debug UI handling
  if (btnDiag) btnDiag.style.display = DEBUG ? "" : "none";
  if (debugPanel) debugPanel.classList.toggle("hidden", !DEBUG);

  if (btnDiag && debugPanel) {
    btnDiag.addEventListener("click", () => {
      debugPanel.classList.toggle("hidden");
    });
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

  function toEmbed(url) {
    const id = ytIdFrom(url);
    if (!id) return "";
    // autoplay + playsinline = better mobile
    return `https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;
  }

  // Create shared player (uses CSS classes you have)
  let playerWrap = $("#playerWrap");
  let playerTitle = $("#nowPlayingTitle");
  let playerFrame = $("#playerFrame");

  if (!playerWrap) {
    playerTitle = el("div", { id: "nowPlayingTitle", class: "now-playing-title" }, "Tap a session to play");

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

    playerWrap = el("section", { id: "playerWrap", class: "player-wrap" }, [
      playerTitle,
      el("div", { class: "player-shell" }, playerFrame),
    ]);

    // Put player ABOVE the Sessions card
    main.insertBefore(playerWrap, main.firstChild);
  }

  function setNowPlaying(title, url) {
    if (playerTitle) playerTitle.textContent = title || "Tap a session to play";
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

      // SINGLE STREAM: use tracks[0].url
      const streamUrl = tracks[0] ? safeText(tracks[0].url) : "";

      if (!streamUrl) return;

      out.push({ title, artist, year, streamUrl, tracksCount: tracks.length });
    });
    return out;
  }

  const sessions = normalizeEpisodes(EPISODES);

  if (status) status.textContent = sessions.length ? `Loaded ${sessions.length} sessions` : "No sessions found";

  if (!list) {
    logLine("Missing #episodes container in HTML.");
    return;
  }

  list.innerHTML = "";

  sessions.forEach((s) => {
    const meta = [s.artist, s.year].filter(Boolean).join(" • ");
    const small = s.tracksCount ? `${s.tracksCount} tracks` : "";

    const card = el("div", { class: "ep", tabindex: "0" }, [
      el("div", { class: "epHead" }, [
        el("div", {}, [
          el("div", { class: "epTitle" }, s.title),
          el("div", { class: "epMeta" }, meta),
          small ? el("div", { class: "epSmall" }, small) : null,
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
})();
