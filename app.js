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

  const makeYouTubeEmbed = (url) => {
    const id = getVideoId(url);
    if (!id) return "";
    // modestbranding is deprecated-ish but harmless; controls stay.
    return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;
  };

  const introLabel = (ep) => {
    if (ep.intro === "candle") return "🕯️ Candle intro (AIC / Nirvana vibes)";
    return "🟣🟢 Lava lamp intro (warm + cozy)";
  };

  const applyArtistTheme = (ep) => {
    // Optional: if you add ep.themeColor in episodes.js, we use it
    const c = ep && ep.themeColor ? String(ep.themeColor) : "";
    if (c) document.documentElement.style.setProperty("--accent", c);
    else document.documentElement.style.removeProperty("--accent");
  };

  const renderEpisodeDetails = (ep, detailsEl) => {
    detailsEl.innerHTML = "";

    const topLine = document.createElement("div");
    topLine.className = "epHint";
    topLine.textContent = "Tap a track to play";
    detailsEl.appendChild(topLine);

    const intro = document.createElement("div");
    intro.className = "epIntro";
    intro.textContent = introLabel(ep);
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

    const iframe = document.createElement("iframe");
    iframe.className = "playerFrame";
    iframe.id = "ytFrame";
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.loading = "lazy";
    iframe.title = "YouTube player";

    // default to first track
    const firstUrl = ep.tracks && ep.tracks[0] ? ep.tracks[0].url : "";
    const embed = firstUrl ? makeYouTubeEmbed(firstUrl) : "";
    if (embed) iframe.src = embed;

    frameWrap.appendChild(iframe);
    tv.appendChild(frameWrap);

    // now playing
    const now = document.createElement("div");
    now.className = "nowPlaying";
    now.textContent = embed ? `Now playing: ${safeText(ep.tracks[0].title)}` : "Pick a track to start";
    tv.appendChild(now);

    player.appendChild(tv);

    detailsEl.appendChild(player);

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
        const src = makeYouTubeEmbed(t.url);
        if (src) iframe.src = src;
        playerTitle.textContent = `${safeText(ep.artist)} — ${safeText(t.title)}`;
        now.textContent = `Now playing: ${safeText(t.title)}`;

        // tiny pulse on the TV LED
        const led = tv.querySelector(".tvLED");
        if (led) {
          led.classList.remove("pulse");
          void led.offsetWidth; // restart animation
          led.classList.add("pulse");
        }
      });

      trackList.appendChild(btn);
    });

    detailsEl.appendChild(trackList);
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
      const card = document.createElement("div");
      card.className = "ep";
      card.tabIndex = 0;

      const head = document.createElement("div");
      head.className = "epHead";

      const left = document.createElement("div");

      const title = document.createElement("div");
      title.className = "epTitle";
      title.textContent = safeText(ep.title || ep.name || `Episode ${i + 1}`);

      const meta = document.createElement("div");
      meta.className = "epMeta";
      meta.textContent =
        [
          ep.artist ? `Artist: ${ep.artist}` : null,
          ep.year ? `Year: ${ep.year}` : null
        ].filter(Boolean).join(" • ") || "—";

      const hint = document.createElement("div");
      hint.className = "epSmall";
      hint.textContent = "Tap to open setlist";

      left.appendChild(title);
      left.appendChild(meta);
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

        // close other open episodes (keeps it clean on mobile)
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
        renderEpisodeDetails(ep, details);
        details.classList.remove("hidden");
        card.classList.add("open");
        // smooth scroll into view
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
    // Debug is OFF unless ?debug=1
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

    render(episodes);
  };

  document.addEventListener("DOMContentLoaded", boot);
})();
