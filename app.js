(function () {
  const $ = (id) => document.getElementById(id);

  const debugPanel = $("debugPanel");
  const debugLines = $("debugLines");
  const btnDiag = $("btnDiag");
  const status = $("status");
  const list = $("episodes");
  const tagline = $("tagline");

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

  const makeYouTubeEmbed = (url, autoplay) => {
    const id = getVideoId(url);
    if (!id) return "";
    // Keep it simple so Shield/TV controls behave.
    // autoplay=1 helps "channel" feel; if you ever hate it, change to 0.
    const ap = autoplay ? 1 : 0;
    return `https://www.youtube.com/embed/${id}?autoplay=${ap}&rel=0&playsinline=1`;
  };

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
  const modeLabel = (ep) => (ep.mode === "fullshow" ? "FULL STREAM" : "TRACKS");
  const modeIcon = (ep) => (ep.mode === "fullshow" ? "📼" : "🎼");

  const renderBadges = (ep) => {
    const wrap = document.createElement("div");
    wrap.className = "badges";

    const b1 = document.createElement("div");
    b1.className = "badge";
    b1.innerHTML = `<span class="badgeDot"></span><span class="badgeIcon">${introIcon(ep)}</span>${introLabel(ep)}`;

    const b2 = document.createElement("div");
    b2.className = "badge badgeMuted";
    b2.innerHTML = `${modeIcon(ep)} ${modeLabel(ep)}`;

    wrap.appendChild(b1);
    wrap.appendChild(b2);
    return wrap;
  };

  const applyArtistTheme = (ep) => {
    const c = pickAccent(ep);
    document.documentElement.style.setProperty("--accent", c);
  };

  const renderEpisodeDetails = (ep, detailsEl) => {
    detailsEl.innerHTML = "";

    const isFullShow = ep.mode === "fullshow";
    const hasTracks = Array.isArray(ep.tracks) && ep.tracks.length > 0;

    const hint = document.createElement("div");
    hint.className = "epHint";
    hint.textContent = isFullShow ? "Full stream" : "Tap a track to play";
    detailsEl.appendChild(hint);

    const intro = document.createElement("div");
    intro.className = "epIntro";
    intro.textContent =
      ep.intro === "candle"
        ? "🕯️ Candle intro — stripped, haunted, perfect."
        : "🟣🟢 Lava lamp intro — warm, cozy, hypnotic.";
    detailsEl.appendChild(intro);

    const player = document.createElement("div");
    player.className = "player";

    const playerTitle = document.createElement("div");
    playerTitle.className = "playerTitle";
    playerTitle.textContent = safeText(ep.title || ep.artist || "Session");
    player.appendChild(playerTitle);

    const tv = document.createElement("div");
    tv.className = "tvFrame";

    const tvTop = document.createElement("div");
    tvTop.className = "tvTopBar";
    tvTop.innerHTML = `
      <div class="tvLED"></div>
      <div class="tvLabel">LIVE • STRIPPED & TURNED UP</div>
      <div class="tvKnob"></div>
    `;
    tv.appendChild(tvTop);

    const frameWrap = document.createElement("div");
    frameWrap.className = "playerFrameWrap";

    const iframe = document.createElement("iframe");
    iframe.className = "playerFrame";
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.loading = "lazy";
    iframe.title = "YouTube player";

    const firstUrl = hasTracks ? ep.tracks[0].url : "";
    const embed = firstUrl ? makeYouTubeEmbed(firstUrl, true) : "";
    if (embed) iframe.src = embed;

    frameWrap.appendChild(iframe);
    tv.appendChild(frameWrap);

    const now = document.createElement("div");
    now.className = "nowPlaying";
    now.textContent = embed ? `Now playing: ${safeText(ep.tracks[0].title || ep.title || ep.artist)}` : "Pick something playable";
    tv.appendChild(now);

    player.appendChild(tv);
    detailsEl.appendChild(player);

    // FULLSHOW MODE: no track list
    if (isFullShow) return;

    // TRACK MODE (kept for future if you ever want it)
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
        const src = makeYouTubeEmbed(t.url, true);
        if (src) iframe.src = src;
        playerTitle.textContent = safeText(ep.title || ep.artist || "Session");
        now.textContent = `Now playing: ${safeText(t.title)}`;

        const led = tv.querySelector(".tvLED");
        if (led) {
          led.classList.remove("pulse");
          void led.offsetWidth;
          led.classList.add("pulse");
        }
      });

      trackList.appendChild(btn);
    });

    detailsEl.appendChild(trackList);
  };

  const closeAll = () => {
    document.querySelectorAll(".epDetails").forEach((d) => d.classList.add("hidden"));
    document.querySelectorAll(".ep").forEach((e) => e.classList.remove("open"));
  };

  const render = (episodes) => {
    list.innerHTML = "";

    if (!Array.isArray(episodes) || episodes.length === 0) {
      setStatus("No sessions found.");
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "episodes.js loaded, but it didn’t give us a usable array.";
      list.appendChild(empty);
      return;
    }

    setStatus(`Loaded ${episodes.length} session${episodes.length === 1 ? "" : "s"} ✅`);

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
      title.textContent = safeText(ep.title || ep.name || ep.artist || `Session ${i + 1}`);

      const meta = document.createElement("div");
      meta.className = "epMeta";
      meta.textContent =
        [
          ep.artist ? `Artist: ${ep.artist}` : null,
          ep.year ? `Year: ${ep.year}` : null
        ].filter(Boolean).join(" • ") || "—";

      const hint = document.createElement("div");
      hint.className = "epSmall";
      hint.textContent = "Tap to open";

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

        // If it's already open, CLOSE it (this fixes your “can’t get back to list” issue)
        if (isOpen) {
          details.classList.add("hidden");
          card.classList.remove("open");
          return;
        }

        // Otherwise close others and open this one
        closeAll();

        applyArtistTheme(ep);
        renderEpisodeDetails(ep, details);
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
        if (e.key === "Escape") {
          e.preventDefault();
          details.classList.add("hidden");
          card.classList.remove("open");
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
      log("CSS", "loaded ✅");
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

    render(episodes);
  };

  document.addEventListener("DOMContentLoaded", boot);
})();
