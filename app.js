(function () {
  const $ = (id) => document.getElementById(id);

  const debugPanel = $("debugPanel");
  const debugLines = $("debugLines");
  const btnDiag = $("btnDiag");
  const status = $("status");
  const list = $("episodes");
  const tagline = $("tagline");

  // ---- YouTube Player state (for auto-next) ----
  let YT_API_READY = false;
  let ytPlayer = null;
  let currentEp = null;      // episode object currently open/playing
  let currentTrackIndex = 0; // index inside currentEp.tracks
  let currentCard = null;    // DOM element for open card
  let currentDetails = null; // DOM element for open details
  let currentNowEl = null;   // DOM element for "Now playing"
  let currentTitleEl = null; // DOM element for player title
  let currentIframe = null;  // fallback iframe if YT api fails

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

  const getVideoId = (url) => {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "");
      const v = u.searchParams.get("v");
      if (v) return v;
      if (u.pathname.includes("/embed/")) return u.pathname.split("/embed/")[1].split(/[?#]/)[0];
      return "";
    } catch {
      return "";
    }
  };

  const makeYouTubeEmbed = (url) => {
    const id = getVideoId(url);
    if (!id) return "";
    // enablejsapi=1 is required for YouTube IFrame API control
    return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1&enablejsapi=1`;
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

  const applyArtistTheme = (ep) => {
    const c = pickAccent(ep);
    document.documentElement.style.setProperty("--accent", c);
  };

  // ---------- Zombie Kitty hook ----------
  const fireKitty = (ep, track) => {
    // If Claude’s ZK is locked in, we won’t break it.
    // We just call a hook IF it exists.
    try {
      if (typeof window.ZK_ON_TRACK === "function") {
        window.ZK_ON_TRACK({
          artist: ep?.artist || "",
          title: track?.title || "",
          idx: currentTrackIndex,
        });
      }
    } catch {}
  };

  // ---------- YouTube IFrame API load ----------
  const loadYTApiOnce = () => {
    if (window.YT && window.YT.Player) {
      YT_API_READY = true;
      return;
    }
    if (document.getElementById("yt-iframe-api")) return;

    const tag = document.createElement("script");
    tag.id = "yt-iframe-api";
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => {
      YT_API_READY = true;
    };
  };

  const killYTPlayer = () => {
    try {
      if (ytPlayer && typeof ytPlayer.destroy === "function") ytPlayer.destroy();
    } catch {}
    ytPlayer = null;
  };

  // ---------- Play logic ----------
  const playTrack = (ep, idx) => {
    if (!ep || !Array.isArray(ep.tracks) || !ep.tracks[idx]) return;

    currentEp = ep;
    currentTrackIndex = idx;

    const t = ep.tracks[idx];
    const vid = getVideoId(t.url);

    // Update UI labels
    if (currentTitleEl) currentTitleEl.textContent = `${safeText(ep.artist)} — ${safeText(t.title)}`;
    if (currentNowEl) currentNowEl.textContent = `Now playing: ${safeText(t.title)}`;

    // LED pulse (if present)
    try {
      const led = currentDetails?.querySelector(".tvLED");
      if (led) {
        led.classList.remove("pulse");
        void led.offsetWidth;
        led.classList.add("pulse");
      }
    } catch {}

    // Fire Zombie Kitty (if hook exists)
    fireKitty(ep, t);

    // Prefer real YT player if API ready
    if (YT_API_READY && vid) {
      // Build player once per open card
      const mount = currentDetails?.querySelector("#ytApiMount");
      if (!mount) {
        // fallback to iframe
        if (currentIframe) currentIframe.src = makeYouTubeEmbed(t.url);
        return;
      }

      if (!ytPlayer) {
        // Create a fresh player in the mount
        killYTPlayer();
        mount.innerHTML = `<div id="ytApiPlayer"></div>`;

        ytPlayer = new window.YT.Player("ytApiPlayer", {
          videoId: vid,
          playerVars: {
            autoplay: 1,
            rel: 0,
            playsinline: 1,
          },
          events: {
            onStateChange: (e) => {
              // 0 = ended
              if (e && e.data === 0) {
                playNext();
              }
            },
          },
        });
      } else {
        try {
          ytPlayer.loadVideoById(vid);
        } catch {
          // If it ever fails, use iframe fallback
          if (currentIframe) currentIframe.src = makeYouTubeEmbed(t.url);
        }
      }

      return;
    }

    // Fallback: embed iframe only (no reliable ended event)
    if (currentIframe) {
      currentIframe.src = makeYouTubeEmbed(t.url);
    }
  };

  const playNext = () => {
    if (!currentEp || !Array.isArray(currentEp.tracks)) return;

    const next = currentTrackIndex + 1;
    if (next < currentEp.tracks.length) {
      playTrack(currentEp, next);
    } else {
      // end of episode — do nothing or loop (your call)
      // If you want loop, uncomment:
      // playTrack(currentEp, 0);
    }
  };

  // ---------- Episode details renderer ----------
  const renderEpisodeDetails = (ep, detailsEl) => {
    detailsEl.innerHTML = "";
    currentDetails = detailsEl;

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

    // We mount BOTH:
    // - a div for YT API player (best for auto-next)
    // - an iframe fallback (still works even if API blocked)
    const apiMount = document.createElement("div");
    apiMount.id = "ytApiMount";
    apiMount.style.width = "100%";
    apiMount.style.height = "100%";

    const iframe = document.createElement("iframe");
    iframe.className = "playerFrame";
    iframe.id = "ytFrame";
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.loading = "lazy";
    iframe.title = "YouTube player";
    iframe.style.display = "none"; // hidden unless we need fallback

    frameWrap.appendChild(apiMount);
    frameWrap.appendChild(iframe);

    tv.appendChild(frameWrap);

    const now = document.createElement("div");
    now.className = "nowPlaying";
    now.textContent = "Pick a track to start";
    tv.appendChild(now);

    player.appendChild(tv);
    detailsEl.appendChild(player);

    // Save refs for playTrack()
    currentTitleEl = playerTitle;
    currentNowEl = now;
    currentIframe = iframe;

    // Tracks
    const trackList = document.createElement("div");
    trackList.className = "trackList";

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
        // Ensure YT API requested; player will be used when ready
        loadYTApiOnce();

        // If API not ready yet, show iframe fallback instantly
        if (!YT_API_READY) {
          iframe.style.display = "block";
          apiMount.style.display = "none";
        } else {
          iframe.style.display = "none";
          apiMount.style.display = "block";
        }

        playTrack(ep, idx);
      });

      trackList.appendChild(btn);
    });

    detailsEl.appendChild(trackList);
  };

  const closeOpenCard = () => {
    // Collapse currently open
    if (currentDetails && currentCard) {
      currentDetails.classList.add("hidden");
      currentCard.classList.remove("open");
    }

    // Stop player (prevents ghost audio + fixes some “can’t pause” weirdness)
    try {
      if (ytPlayer && typeof ytPlayer.stopVideo === "function") ytPlayer.stopVideo();
    } catch {}
    killYTPlayer();

    // Reset pointers
    currentEp = null;
    currentTrackIndex = 0;
    currentCard = null;
    currentDetails = null;
    currentNowEl = null;
    currentTitleEl = null;
    currentIframe = null;
  };

  const openCard = (ep, card, details) => {
    // Close others
    document.querySelectorAll(".epDetails").forEach((d) => {
      if (d !== details) d.classList.add("hidden");
    });
    document.querySelectorAll(".ep").forEach((e) => {
      if (e !== card) e.classList.remove("open");
    });

    // Also stop any previous player
    closeOpenCard();

    // Open this one
    applyArtistTheme(ep);
    renderEpisodeDetails(ep, details);
    details.classList.remove("hidden");
    card.classList.add("open");

    currentCard = card;
    currentDetails = details;

    // Soft scroll to keep header visible
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const render = (episodes) => {
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
        [ep.artist ? `Artist: ${ep.artist}` : null, ep.year ? `Year: ${ep.year}` : null]
          .filter(Boolean)
          .join(" • ") || "—";

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

      // ---- FIXED TOGGLE (open/close properly) ----
      const toggle = () => {
        const isOpen = !details.classList.contains("hidden");

        if (isOpen) {
          // close THIS card
          closeOpenCard();

          // optional: scroll back a little so you can see other artists
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }

        openCard(ep, card, details);
      };

      card.addEventListener("click", (e) => {
        // Prevent track button clicks from toggling
        const target = e.target;
        if (target && (target.closest(".track") || target.closest("button"))) return;
        toggle();
      });

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
      btnDiag?.addEventListener("click", () => debugPanel?.classList.toggle("hidden"));
      log("DOM", "ready ✅");
      log("CSS", "loaded (if you see gradient)");
    }

    // Close open card if user taps OUTSIDE any card (clean navigation)
    document.addEventListener("click", (e) => {
      if (!currentCard) return;
      const inside = e.target && e.target.closest && e.target.closest(".ep");
      if (!inside) {
        closeOpenCard();
      }
    });

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

    // Request YT API early (helps auto-next be ready)
    loadYTApiOnce();

    render(episodes);
  };

  document.addEventListener("DOMContentLoaded", boot);
})();
