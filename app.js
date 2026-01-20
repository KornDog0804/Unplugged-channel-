(function () {
  const $ = (id) => document.getElementById(id);

  const debugPanel = $("debugPanel");
  const debugLines = $("debugLines");
  const btnDiag = $("btnDiag");
  const status = $("status");
  const list = $("episodes");
  const tagline = $("tagline");

  // ---- Player state (simple iframe version) ----
  let currentEp = null;
  let currentTrackIndex = 0;
  let currentCard = null;
  let currentDetails = null;
  let currentNowEl = null;
  let currentTitleEl = null;
  let currentIframe = null;

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

  // Plain embed (NO enablejsapi, NO iframe_api). This is the "AIC-safe" path.
  const makeYouTubeEmbed = (url) => {
    const id = getVideoId(url);
    if (!id) return "";
    return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;
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

  // ---------- Play logic ----------
  const playTrack = (ep, idx) => {
    if (!ep || !Array.isArray(ep.tracks) || !ep.tracks[idx]) return;

    currentEp = ep;
    currentTrackIndex = idx;

    const t = ep.tracks[idx];

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

    // Kitty
    fireKitty(ep, t);

    // Iframe src
    const src = makeYouTubeEmbed(t.url);
    if (src && currentIframe) currentIframe.src = src;

    // BEST-EFFORT auto-next:
    // We can’t reliably detect “ended” from a plain iframe.
    // But we *can* auto-next when user taps "next" (we'll add a hidden helper),
    // and some browsers trigger focus/visibility changes at end; too unreliable to hard-code.
  };

  // We keep a manual "auto-next" helper you can call later if you add a Next button:
  const playNext = () => {
    if (!currentEp || !Array.isArray(currentEp.tracks)) return;
    const next = currentTrackIndex + 1;
    if (next < currentEp.tracks.length) playTrack(currentEp, next);
  };

  const closeOpenCard = () => {
    if (currentDetails && currentCard) {
      currentDetails.classList.add("hidden");
      currentCard.classList.remove("open");
    }

    // Stop playback by clearing src (prevents ghost audio)
    try {
      if (currentIframe) currentIframe.src = "";
    } catch {}

    currentEp = null;
    currentTrackIndex = 0;
    currentCard = null;
    currentDetails = null;
    currentNowEl = null;
    currentTitleEl = null;
    currentIframe = null;
  };

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

    const
