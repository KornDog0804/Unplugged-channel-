/* Stripped & Turned Up — app.js
   - Single shared YouTube Player (IFrame API)
   - Fullshow: plays one video
   - Queue: plays a playlist of video IDs, auto-advances, loops
   - Debug only when ?debug=1
*/
(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const DEBUG = params.get("debug") === "1";
  const log = (...a) => DEBUG && console.log("[STU]", ...a);

  const EPISODES = Array.isArray(window.EPISODES)
    ? window.EPISODES
    : Array.isArray(window.episodes)
    ? window.episodes
    : [];

  const $ = (sel) => document.querySelector(sel);

  const list = $("#episodes");
  const status = $("#status");
  const app = $("#app") || document.body;

  // ---------- helpers ----------
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

    // already embed
    if (u.includes("/embed/")) {
      const m = u.match(/\/embed\/([a-zA-Z0-9_-]{6,})/);
      return m ? m[1] : "";
    }

    try {
      const parsed = new URL(u);
      if (parsed.hostname.includes("youtu.be")) {
        // youtu.be/ID?si=...
        const id = parsed.pathname.replace("/", "").trim();
        return id || "";
      }
      // youtube.com/watch?v=ID
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
      const tracks = Array.isArray(ep.tracks) ? ep.tracks : [];

      // Collect IDs for all tracks (queue) or first track (fullshow)
      const ids = tracks
        .map((t) => ytIdFrom(t && t.url))
        .filter(Boolean);

      if (!ids.length) return;

      out.push({
        id: `ep_${idx}_${title.replace(/\s+/g, "_").slice(0, 30)}`,
        title,
        artist,
        year,
        mode,
        videoIds: ids,
        tracksCount: ids.length
      });
    });
    return out;
  }

  const sessions = normalizeEpisodes(EPISODES);

  if (status) status.textContent = sessions.length ? `Loaded ${sessions.length} sessions` : "No sessions found";

  if (!list) {
    log("Missing #episodes container.");
    return;
  }

  // ---------- shared player UI ----------
  let playerWrap = $("#playerWrap");
  if (!playerWrap) {
    playerWrap = el("section", { id: "playerWrap" });
    app.insertBefore(playerWrap, app.firstChild);
  }

  // Nice TV player shell using YOUR existing CSS class names
  playerWrap.innerHTML = "";
  const nowTitle = el("div", { id: "nowPlayingTitle", class: "playerTitle" }, "Tap a session to play");
  const tv = el("div", { class: "tvFrame" }, [
    el("div", { class: "tvTopBar" }, [
      el("div", { class: "tvLED", id: "tvLED", "aria-hidden": "true" }),
      el("div", { class: "tvLabel" }, "STRIPPED & TURNED UP"),
      el("div", { class: "tvKnob", "aria-hidden": "true" })
    ]),
    el("div", { class: "playerFrameWrap" }, [
      // IMPORTANT: Player API mounts into a DIV, not an iframe
      el("div", { id: "ytPlayer", class: "playerFrame" })
    ]),
    el("div", { id: "nowPlayingSub", class: "nowPlaying" }, "Ready.")
  ]);

  const playerCard = el("section", { class: "card player" }, [nowTitle, tv]);
  playerWrap.appendChild(playerCard);

  const nowSub = $("#nowPlayingSub");
  const led = $("#tvLED");

  // ---------- YouTube Player API wiring ----------
  let YT_PLAYER = null;

  // Keep current session info to handle queue looping
  let CURRENT = {
    mode: "fullshow",
    title: "",
    ids: []
  };

  function pulseLed() {
    if (!led) return;
    led.classList.add("pulse");
    setTimeout(() => led.classList.remove("pulse"), 280);
  }

  function setNowPlayingText(title, sub) {
    nowTitle.textContent = title || "Tap a session to play";
    if (nowSub) nowSub.textContent = sub || "";
  }

  function playSession(session) {
    if (!YT || !YT_PLAYER) {
      setNowPlayingText("Player not ready yet…", "Try again in 1 second.");
      return;
    }

    CURRENT = {
      mode: session.mode,
      title: session.title,
      ids: session.videoIds.slice()
    };

    pulseLed();

    if (session.mode === "queue") {
      setNowPlayingText(session.title, `Queue • ${session.tracksCount} tracks • Autoplay ON`);
      // Load as playlist and start immediately
      YT_PLAYER.loadPlaylist({
        playlist: session.videoIds,
        index: 0,
        startSeconds: 0
      });
      return;
    }

    // Fullshow: single video
    setNowPlayingText(session.title, "Full session stream");
    YT_PLAYER.loadVideoById(session.videoIds[0], 0);
  }

  // Global callback the YT API looks for
  window.onYouTubeIframeAPIReady = function () {
    log("YT API ready");

    YT_PLAYER = new YT.Player("ytPlayer", {
      width: "100%",
      height: "100%",
      videoId: "", // start empty
      playerVars: {
        autoplay: 1,
        playsinline: 1,
        rel: 0,
        modestbranding: 1
      },
      events: {
        onReady: () => {
          log("YT player ready");
          setNowPlayingText("Tap a session to play", "Autoplay is armed.");
        },
        onStateChange: (e) => {
          // 0 = ended
          if (e.data === 0 && CURRENT.mode === "queue") {
            // If it ended, YouTube often auto-advances.
            // But if it hits the end of the list, we loop back to start.
            try {
              const idx = YT_PLAYER.getPlaylistIndex();
              const len = (YT_PLAYER.getPlaylist() || []).length;

              // If it ended on last track, loop to first.
              if (len && idx === len - 1) {
                log("Queue ended, looping to start");
                YT_PLAYER.playVideoAt(0);
              }
            } catch (err) {
              log("Queue loop check error:", err);
            }
          }
        },
        onError: (e) => {
          setNowPlayingText(CURRENT.title || "Playback error", `YouTube error code: ${e.data}`);
          log("YT error:", e.data);
        }
      }
    });
  };

  // ---------- render session cards ----------
  list.innerHTML = "";

  sessions.forEach((s) => {
    const meta = [s.artist, s.year].filter(Boolean).join(" • ");
    const small = s.mode === "queue" ? `${s.tracksCount} tracks` : "Full session";

    const card = el("div", { class: "ep", tabindex: "0" }, [
      el("div", { class: "epHead" }, [
        el("div", {}, [
          el("div", { class: "epTitle" }, s.title),
          el("div", { class: "epMeta" }, meta),
          el("div", { class: "epSmall" }, small)
        ]),
        el("div", { class: "chev", "aria-hidden": "true" }, "›")
      ])
    ]);

    const go = () => playSession(s);

    card.addEventListener("click", go);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });

    list.appendChild(card);
  });

  log("Sessions rendered:", sessions.length);
})();
