(function () {
  const $ = (id) => document.getElementById(id);

  const debugPanel = $("debugPanel");
  const debugLines = $("debugLines");
  const btnDiag = $("btnDiag");
  const status = $("status");
  const list = $("episodes");
  const tagline = $("tagline");

  // ---------- Debug helpers ----------
  const log = (label, value) => {
    if (!debugLines) return;
    const row = document.createElement("div");
    row.textContent = `${label}: ${value}`;
    debugLines.appendChild(row);
  };

  const setStatus = (text) => {
    if (status) status.textContent = text;
  };

  const safeText = (v) => (v == null ? "" : String(v));

  // ---------- YouTube URL helpers ----------
  const getVideoId = (url) => {
    try {
      const u = new URL(url);

      // youtu.be/<id>
      if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "");

      // youtube.com/watch?v=<id>
      const v = u.searchParams.get("v");
      if (v) return v;

      // youtube.com/embed/<id>
      if (u.pathname.includes("/embed/")) return u.pathname.split("/embed/")[1].split(/[?#]/)[0];

      return "";
    } catch {
      return "";
    }
  };

  // Build an embed URL that allows JS API control
  const makeYouTubeEmbed = (url) => {
    const id = getVideoId(url);
    if (!id) return "";
    // enablejsapi=1 is the key for autoplay/ended detection & next-track advance
    return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(
      location.origin
    )}`;
  };

  // ---------- Card polish helpers ----------
  const pickAccent = (ep) => {
    if (ep && ep.accent) return String(ep.accent);

    const a = (ep.artist || "").toLowerCase();
    if (a.includes("alice in chains")) return "#7CFFB2";
    if (a.includes("nirvana")) return "#8A5CFF";
    if (a.includes("pearl jam")) return "#FFB74A";
    if (a.includes("jay-z") || a.includes("jay z")) return "#FFD54A";
    return "#8A5CFF";
  };

  const introLabel = (ep) => (ep.intro === "candle" ? "CANDLES" : "LAVA LAMP");
  const introIcon = (ep) => (ep.intro === "candle" ? "🕯️" : "🟣");

  const modeLabel = (ep) => (ep.mode === "full" ? "TRACKS" : "FULL EP");
  const modeIcon = (ep) => (ep.mode === "full" ? "🎼" : "📼");

  const renderBadges = (ep) => {
    const wrap = document.createElement("div");
    wrap.className = "badges";

    const b1 = document.createElement("div");
    b1.className = "badge";
    b1.innerHTML = `<span class="badgeDot"></span><span class="badgeIcon">${introIcon(ep)}</span>${introLabel(ep)}`;

    const b2 = document.createElement("div");
    b2.className = "badge badgeMuted";
    b2.innerHTML = `${modeIcon(ep)} ${modeLabel(ep)}`;

    const count = document.createElement("div");
    count.className = "badge badgeMuted";
    const n = Array.isArray(ep.tracks) ? ep.tracks.length : 0;
    count.innerHTML = `▶ ${n} ${n === 1 ? "TRACK" : "TRACKS"}`;

    wrap.appendChild(b1);
    wrap.appendChild(b2);
    wrap.appendChild(count);
    return wrap;
  };

  // ---------- Theme ----------
  const applyArtistTheme = (ep) => {
    const c = pickAccent(ep);
    document.documentElement.style.setProperty("--accent", c);
  };

  // ---------- YouTube IFrame API wiring ----------
  let ytApiReady = false;
  let ytApiLoading = false;

  const ensureYouTubeAPI = (debugOn) => {
    if (ytApiReady || ytApiLoading) return;
    ytApiLoading = true;

    // If already present
    if (window.YT && window.YT.Player) {
      ytApiReady = true;
      ytApiLoading = false;
      if (debugOn) log("YT API", "already present ✅");
      return;
    }

    // Load it once
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    document.head.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => {
      ytApiReady = true;
      ytApiLoading = false;
      if (debugOn) log("YT API", "loaded ✅");
    };

    if (debugOn) log("YT API", "loading…");
  };

  // ---------- Episode Details Renderer ----------
  const renderEpisodeDetails = (ep, detailsEl, debugOn) => {
    detailsEl.innerHTML = "";

    const topLine = document.createElement("div");
    topLine.className = "epHint";
    topLine.textContent = "Tap a track to play";
    detailsEl.appendChild(topLine);

    const intro = document.createElement("div");
    intro.className = "epIntro";
    intro.textContent =
      ep.intro === "candle"
        ? "🕯️ Candle intro (AIC / Nirvana vibes)"
        : "🟣🟢 Lava lamp intro (warm + cozy)";
    detailsEl.appendChild(intro);

    // Player
    const player = document.createElement("div");
    player.className = "player";

    const playerTitle = document.createElement("div");
    playerTitle.className = "playerTitle";
    playerTitle.textContent = `${safeText(ep.artist)} — ${safeText(ep.tracks?.[0]?.title || "Select a track")}`;
    player.appendChild(playerTitle);

    const tv = document.createElement("div");
    tv.className = "tvFrame";

    const tvTop = document.createElement("div");
    tvTop.className = "tvTopBar";
    tvTop.innerHTML = `
      <div class="tvLED"></div>
      <div class="tvLabel">LIVE • UNPLUGGED</div>
      <div class="tvKnob"></div>
    `;
    tv.appendChild(tvTop);

    const frameWrap = document.createElement("div");
    frameWrap.className = "playerFrameWrap";

    // We use an inner container so the YT API can own the iframe safely.
    const ytMount = document.createElement("div");
    ytMount.id = "ytMount";
    ytMount.style.width = "100%";
    ytMount.style.height = "100%";
    frameWrap.appendChild(ytMount);

    tv.appendChild(frameWrap);

    const now = document.createElement("div");
    now.className = "nowPlaying";
    now.textContent = ep.tracks?.[0]?.title ? `Now playing: ${safeText(ep.tracks[0].title)}` : "Pick a track to start";
    tv.appendChild(now);

    player.appendChild(tv);
    detailsEl.appendChild(player);

    // Tracks
    const trackList = document.createElement("div");
    trackList.className = "trackList";

    // State for auto-advance
    let currentIndex = 0;
    let ytPlayer = null;
    let lastPlayToken = 0; // prevents double-advance

    const pulseLED = () => {
      const led = tv.querySelector(".tvLED");
      if (led) {
        led.classList.remove("pulse");
        void led.offsetWidth;
        led.classList.add("pulse");
      }
    };

    const setNowPlaying = (idx) => {
      const t = ep.tracks?.[idx];
      playerTitle.textContent = `${safeText(ep.artist)} — ${safeText(t?.title || "Select a track")}`;
      now.textContent = t?.title ? `Now playing: ${safeText(t.title)}` : "Pick a track to start";
    };

    const markActiveTrack = (idx) => {
      [...trackList.querySelectorAll(".track")].forEach((b, i) => {
        if (i === idx) b.classList.add("active");
        else b.classList.remove("active");
      });
    };

    const tryPlayIndex = (idx, reason) => {
      if (!Array.isArray(ep.tracks) || ep.tracks.length === 0) return;

      // wrap
      if (idx >= ep.tracks.length) idx = 0;
      if (idx < 0) idx = 0;

      const t = ep.tracks[idx];
      const id = t ? getVideoId(t.url) : "";
      if (!id) {
        if (debugOn) log("Skip", `No video ID at track ${idx + 1}`);
        return tryPlayIndex(idx + 1, "bad-id");
      }

      currentIndex = idx;
      setNowPlaying(idx);
      markActiveTrack(idx);
      pulseLED();

      if (!ytApiReady || !window.YT || !window.YT.Player) {
        // fallback: no API yet, just show a normal iframe
        // NOTE: auto-advance won't work in fallback mode.
        detailsEl.querySelector("#ytMount").innerHTML = "";
        const iframe = document.createElement("iframe");
        iframe.className = "playerFrame";
        iframe.allow =
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = "strict-origin-when-cross-origin";
        iframe.loading = "lazy";
        iframe.title = "YouTube player";
        iframe.src = makeYouTubeEmbed(t.url);
        detailsEl.querySelector("#ytMount").appendChild(iframe);

        if (debugOn) log("YT", `fallback iframe (no API) — ${reason || "manual"}`);
        return;
      }

      const playToken = ++lastPlayToken;

      // Create player once, then load by ID
      if (!ytPlayer) {
        ytPlayer = new window.YT.Player("ytMount", {
          videoId: id,
          playerVars: {
            autoplay: 1,
            rel: 0,
            playsinline: 1,
            modestbranding: 1
          },
          events: {
            onReady: () => {
              if (debugOn) log("YT", "player ready ✅");
              // extra nudge on autoplay
              try {
                ytPlayer.playVideo();
              } catch {}
            },
            onStateChange: (e) => {
              // 0 = ended
              if (e.data === 0) {
                // avoid double-fire
                if (playToken !== lastPlayToken) return;
                if (debugOn) log("YT", `ended -> next track`);
                tryPlayIndex(currentIndex + 1, "ended");
              }
            },
            onError: (e) => {
              // Typical blocked/unavailable error codes: 2, 5, 100, 101, 150
              if (debugOn) log("YT", `error ${e.data} -> skipping`);
              // skip to next track
              tryPlayIndex(currentIndex + 1, "error");
            }
          }
        });
      } else {
        // load next by ID
        try {
          ytPlayer.loadVideoById(id);
          if (debugOn) log("YT", `loadVideoById -> ${idx + 1} (${reason || "manual"})`);
        } catch {
          if (debugOn) log("YT", `load failed -> skipping`);
          return tryPlayIndex(idx + 1, "load-fail");
        }
      }
    };

    // Build track buttons
    (ep.tracks || []).forEach((t, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "track";
      btn.innerHTML = `
        <span class="trackNum">${idx + 1}.</span>
        <span class="trackTitle">${safeText(t.title)}</span>
        <span class="trackPlay">Play ▶</span>
      `;

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        tryPlayIndex(idx, "click");
      });

      trackList.appendChild(btn);
    });

    detailsEl.appendChild(trackList);

    // Load API and autoplay first track using API when ready
    ensureYouTubeAPI(debugOn);

    // Try immediately (fallback iframe) then re-try once API is ready
    tryPlayIndex(0, "boot");

    // Once API is ready, re-mount as a real player so auto-advance works
    const waitForAPI = () => {
      if (ytApiReady) {
        // If we already created a fallback iframe, replace with API player on the current track
        if (!ytPlayer) {
          // clear mount
          const mount = detailsEl.querySelector("#ytMount");
          if (mount) mount.innerHTML = "";
          tryPlayIndex(currentIndex, "api-ready");
        }
        return;
      }
      setTimeout(waitForAPI, 120);
    };
    waitForAPI();
  };

  const render = (episodes, debugOn) => {
    list.innerHTML = "";

    if (!Array.isArray(episodes) || episodes.length === 0) {
      setStatus("No episodes found.");
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "episodes.js loaded, but it didn’t give us a usable array.";
      list.appendChild(empty);
      return;
    }

    setStatus(`Loaded ${episodes.length} episode${episodes.length === 1 ? "" : "s"} ✅`);

    episodes.forEach((ep, i) => {
      const accent = pickAccent(ep);

      const card = document.createElement("div");
      card.className = "ep";
      card.tabIndex = 0;
      card.style.setProperty("--epAccent", accent);

      const head = document.createElement("div");
      head.className = "epHead";

      const left = document.createElement("div");

      const title = document.createElement("div");
      title.className = "epTitle";
      title.textContent = safeText(ep.title || ep.name || `${safeText(ep.artist) || `Episode ${i + 1}`}`);

      const meta = document.createElement("div");
      meta.className = "epMeta";
      meta.textContent =
        [ep.artist ? `Artist: ${ep.artist}` : null, ep.year ? `Year: ${ep.year}` : null].filter(Boolean).join(" • ") ||
        "—";

      const hint = document.createElement("div");
      hint.className = "epSmall";
      hint.textContent = "Tap to open setlist";

      left.appendChild(title);
      left.appendChild(meta);
      left.appendChild(renderBadges(ep));
      left.appendChild(hint);

      const chev = document.createElement("div");
      chev.className = "chev";
      chev.textContent = "▾";

      head.appendChild(left);
      head.appendChild(chev);
      card.appendChild(head);

      const details = document.createElement("div");
      details.className = "epDetails hidden";
      card.appendChild(details);

      const toggle = () => {
        const isOpen = !details.classList.contains("hidden");

        document.querySelectorAll(".epDetails").forEach((d) => {
          if (d !== details) d.classList.add("hidden");
        });
        document.querySelectorAll(".ep").forEach((e) => {
          if (e !== card) e.classList.remove("open");
        });

        if (isOpen) {
          details.classList.add("hidden");
          card.classList.remove("open");
          return;
        }

        applyArtistTheme(ep);
        renderEpisodeDetails(ep, details, debugOn);
        details.classList.remove("hidden");
        card.classList.add("open");
        card.scrollIntoView({ behavior: "smooth", block: "start" });
      };

      card.addEventListener("click", toggle);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      });

      list.appendChild(card);
    });
  };

  const boot = () => {
    const params = new URLSearchParams(location.search);
    const debugOn = params.get("debug") === "1";

    if (btnDiag) btnDiag.style.display = debugOn ? "inline-flex" : "none";

    if (debugOn) {
      document.body.classList.add("debug");
      if (tagline) tagline.textContent = "Debug mode: ON (remove ?debug=1 to hide)";
      btnDiag.addEventListener("click", () => debugPanel.classList.toggle("hidden"));
      log("DOM", "ready ✅");
      log("CSS", "loaded (if you see gradient)");
    }

    const episodes = window.EPISODES || window.episodes;

    if (debugOn) log("episodes.js", episodes ? "global found ✅" : "global NOT found ❌");

    if (!episodes) {
      setStatus("episodes.js loaded but did NOT expose data. Fix needed.");
      list.innerHTML = `
        <div class="muted">
          Your <b>data/episodes.js</b> must expose a global like:
          <div class="mono" style="margin-top:10px;">window.EPISODES = EPISODES;</div>
        </div>
      `;
      return;
    }

    render(episodes, debugOn);
  };

  document.addEventListener("DOMContentLoaded", boot);
})();
