(function () {
  const $ = (id) => document.getElementById(id);

  const debugPanel = $("debugPanel");
  const debugLines = $("debugLines");
  const status = $("status");
  const list = $("episodes");
  const tagline = $("tagline");

  // Zombie kitty badge element exists in index.html as #zombieKitty
  const zk = $("zombieKitty");

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

  // ---------- YouTube helpers ----------
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
    // playsinline helps mobile
    return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;
  };

  // ---------- Intro label ----------
  const introLabel = (ep) => {
    if (ep.intro === "candle") return "🕯️ Candle intro (AIC / Nirvana vibes)";
    return "🟣🟢 Lava lamp intro (warm + cozy)";
  };

  // ---------- Artist theme hook ----------
  const applyArtistTheme = (ep) => {
    // Optional future support:
    // ep.themeColor = "#7CFFB2" or something
    const c = ep && ep.themeColor ? String(ep.themeColor) : "";
    if (c) document.documentElement.style.setProperty("--accent", c);
    else document.documentElement.style.removeProperty("--accent");

    // Optional tagline override:
    if (tagline && ep && ep.tagline) tagline.textContent = safeText(ep.tagline);
  };

  // ---------- Zombie Kitty badge logic ----------
  // You said: can't rename. Cool. We'll use ONE sprite sheet file and "background-position".
  // Your file is currently: /images/1000049177-removebg-preview.png
  // It is 2 rows of 3. We'll treat them as 1..6 in reading order.
  //
  // IMPORTANT: this assumes your CSS has #zombieKitty set up with background-image + size.
  // If not yet, add these to styles.css:
  // #zombieKitty { background-image:url("images/1000049177-removebg-preview.png"); }
  //
  const setKittySkin = (n) => {
    if (!zk) return;

    // clamp 1..6
    let skin = Number(n) || 1;
    if (skin < 1) skin = 1;
    if (skin > 6) skin = 6;

    // store state for CSS
    zk.setAttribute("data-skin", String(skin));

    // little pop animation if CSS supports it
    zk.classList.remove("zkPop");
    void zk.offsetWidth;
    zk.classList.add("zkPop");
  };

  // Map track index -> 1..6 (loops)
  const skinFromTrackIndex = (idx) => ((idx % 6) + 1);

  // ---------- Episode details renderer ----------
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

    // Player block
    const player = document.createElement("div");
    player.className = "player playerWrap";

    const playerTitle = document.createElement("div");
    playerTitle.className = "playerTitle";
    player.appendChild(playerTitle);

    const tv = document.createElement("div");
    tv.className = "tvFrame";

    const tvTop = document.createElement("div");
    tvTop.className = "tvTopBar";
    tvTop.innerHTML = `
      <div class="tvLeft">
        <div class="tvLED"></div>
        <div class="tvLabel">LIVE • UNPLUGGED</div>
      </div>
      <div class="tvRight">
        <div class="tvKnob" title="don’t touch my knobs"></div>
      </div>
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

    frameWrap.appendChild(iframe);
    tv.appendChild(frameWrap);

    const now = document.createElement("div");
    now.className = "nowPlaying";
    tv.appendChild(now);

    player.appendChild(tv);
    detailsEl.appendChild(player);

    // Track list
    const trackList = document.createElement("div");
    trackList.className = "trackList";

    // Default selection: first track
    const tracks = Array.isArray(ep.tracks) ? ep.tracks : [];
    const firstTrack = tracks[0] || null;

    const setNowPlaying = (t, idx) => {
      const title = t ? safeText(t.title) : "Select a track";
      playerTitle.textContent = `${safeText(ep.artist)} — ${title}`;
      now.textContent = t ? `Now playing: ${title}` : "Pick a track to start";

      // LED pulse
      const led = tv.querySelector(".tvLED");
      if (led) {
        led.classList.remove("pulse");
        void led.offsetWidth;
        led.classList.add("pulse");
      }

      // Kitty changes per track
      if (typeof idx === "number") setKittySkin(skinFromTrackIndex(idx));
    };

    const playTrack = (t, idx) => {
      const src = t && t.url ? makeYouTubeEmbed(t.url) : "";
      if (src) iframe.src = src;
      setNowPlaying(t, idx);

      // highlight active button
      trackList.querySelectorAll(".track").forEach((b) => b.classList.remove("active"));
      const activeBtn = trackList.querySelector(`.track[data-idx="${idx}"]`);
      if (activeBtn) activeBtn.classList.add("active");
    };

    // Build buttons
    tracks.forEach((t, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "track";
      btn.dataset.idx = String(idx);
      btn.innerHTML = `
        <span class="trackNum">${idx + 1}.</span>
        <span class="trackTitle">${safeText(t.title)}</span>
        <span class="trackPlay">Play ▶</span>
      `;

      btn.addEventListener("click", (e) => {
        e.stopPropagation(); // IMPORTANT: don't collapse the episode when tapping tracks
        playTrack(t, idx);
      });

      trackList.appendChild(btn);
    });

    detailsEl.appendChild(trackList);

    // Auto-play first track (or just preload)
    if (firstTrack) {
      // Set kitty to track 1
      setKittySkin(1);

      // Start playing first track (you can change to "no autoplay" if you want)
      playTrack(firstTrack, 0);
    } else {
      setNowPlaying(null, 0);
    }
  };

  // ---------- Episodes list renderer ----------
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

      const openThis = () => {
        // close others
        document.querySelectorAll(".epDetails").forEach((d) => {
          if (d !== details) d.classList.add("hidden");
        });
        document.querySelectorAll(".ep").forEach((e) => {
          if (e !== card) e.classList.remove("open");
        });

        applyArtistTheme(ep);
        renderEpisodeDetails(ep, details);
        details.classList.remove("hidden");
        card.classList.add("open");

        // keep it clean on mobile
        card.scrollIntoView({ behavior: "smooth", block: "start" });
      };

      const closeThis = () => {
        details.classList.add("hidden");
        card.classList.remove("open");
      };

      const toggle = () => {
        const isOpen = !details.classList.contains("hidden");
        if (isOpen) closeThis();
        else openThis();
      };

      // IMPORTANT: clicking inside details should NOT toggle close
      card.addEventListener("click", (e) => {
        const clickedInsideDetails = e.target && details.contains(e.target);
        if (clickedInsideDetails) return;
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

  // ---------- Boot ----------
  const boot = () => {
    const params = new URLSearchParams(location.search);
    const debugOn = params.get("debug") === "1";

    // If debug is on, inject a button into #debugMount (created in index.html)
    if (debugOn) {
      document.body.classList.add("debug");
      if (tagline) tagline.textContent = "Debug mode: ON (remove ?debug=1 to hide)";
      log("DOM", "ready ✅");
      log("CSS", "loaded (if you see gradient)");

      // create debug button if it exists in mount (index.html)
      const mount = $("debugMount");
      if (mount) {
        const btn = document.createElement("button");
        btn.id = "btnDiag";
        btn.className = "btn btnGhost";
        btn.type = "button";
        btn.textContent = "Debug";
        mount.appendChild(btn);

        btn.addEventListener("click", () => {
          if (debugPanel) debugPanel.classList.toggle("hidden");
        });
      }
    } else {
      // Ensure debug panel stays hidden in normal mode
      if (debugPanel) debugPanel.classList.add("hidden");
    }

    // Set default kitty skin (1) when page loads
    setKittySkin(1);

    const episodes = window.EPISODES || window.episodes;

    if (debugOn) log("episodes.js", episodes ? "global found ✅" : "global NOT found ❌");

    if (!episodes) {
      setStatus("episodes.js loaded but did NOT expose data. Fix needed.");
      if (list) {
        list.innerHTML = `
          <div class="muted">
            Your <b>data/episodes.js</b> must expose a global like:
            <div class="mono" style="margin-top:10px;">window.EPISODES = EPISODES;</div>
          </div>
        `;
      }
      return;
    }

    render(episodes);
  };

  document.addEventListener("DOMContentLoaded", boot);
})();
