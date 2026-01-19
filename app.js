(function () {
  const $ = (id) => document.getElementById(id);

  const debugPanel = $("debugPanel");
  const debugLines = $("debugLines");
  const btnDiag = $("btnDiag");
  const status = $("status");
  const list = $("episodes");

  const log = (label, value) => {
    const row = document.createElement("div");
    row.textContent = `${label}: ${value}`;
    debugLines.appendChild(row);
  };

  const setStatus = (text) => {
    status.textContent = text;
  };

  const safeText = (v) => (v == null ? "" : String(v));

  const ytIdFromUrl = (url) => {
    try {
      const u = new URL(url);
      // youtu.be/ID
      if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "");
      // youtube.com/watch?v=ID
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      // youtube.com/embed/ID
      const parts = u.pathname.split("/").filter(Boolean);
      const embedIndex = parts.indexOf("embed");
      if (embedIndex >= 0 && parts[embedIndex + 1]) return parts[embedIndex + 1];
    } catch (e) {}
    return "";
  };

  const renderEpisodeDetails = (ep, card) => {
    // Clear old details if any
    const existing = card.querySelector(".epDetails");
    if (existing) existing.remove();

    const details = document.createElement("div");
    details.className = "epDetails";

    const introLine = document.createElement("div");
    introLine.className = "muted";
    introLine.textContent =
      ep.intro === "candle"
        ? "🕯️ Candle intro (AIC / Nirvana vibes)"
        : "🫧 Lava lamp intro";
    details.appendChild(introLine);

    // Tracks list
    const tracks = Array.isArray(ep.tracks) ? ep.tracks : [];
    if (tracks.length === 0) {
      const none = document.createElement("div");
      none.className = "muted";
      none.textContent = "No tracks listed yet.";
      details.appendChild(none);
      card.appendChild(details);
      return;
    }

    const trackList = document.createElement("div");
    trackList.className = "trackList";

    // Simple player area
    const player = document.createElement("div");
    player.className = "player";
    player.innerHTML = `
      <div class="playerTitle">Select a track to play</div>
      <div class="playerFrameWrap">
        <iframe
          id="ytFrame"
          class="playerFrame"
          src=""
          title="YouTube player"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
        ></iframe>
      </div>
    `;
    details.appendChild(player);

    const frame = player.querySelector("#ytFrame");
    const playerTitle = player.querySelector(".playerTitle");

    tracks.forEach((t, idx) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "track";
      row.innerHTML = `
        <span class="trackNum">${idx + 1}.</span>
        <span class="trackName">${safeText(t.title || "Untitled")}</span>
        <span class="trackPlay">Play ▶</span>
      `;

      row.addEventListener("click", () => {
        const id = ytIdFromUrl(t.url || "");
        if (!id) {
          alert("This track link doesn't look like a valid YouTube URL.");
          return;
        }
        playerTitle.textContent = `${safeText(ep.artist)} — ${safeText(t.title)}`;
        // modest branding + safer embed
        frame.src = `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`;
        frame.scrollIntoView({ behavior: "smooth", block: "center" });
      });

      trackList.appendChild(row);
    });

    details.appendChild(trackList);
    card.appendChild(details);
  };

  const render = (episodes) => {
    list.innerHTML = "";

    if (!Array.isArray(episodes) || episodes.length === 0) {
      setStatus("No episodes found (episodes.js loaded but data is empty).");
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "episodes.js loaded, but it didn’t give us a usable array.";
      list.appendChild(empty);
      return;
    }

    setStatus(`Loaded ${episodes.length} episodes ✅`);

    episodes.forEach((ep, i) => {
      const card = document.createElement("div");
      card.className = "ep";
      card.tabIndex = 0; // makes it focusable

      const title = document.createElement("div");
      title.className = "epTitle";
      title.textContent = safeText(ep.title || ep.name || `Episode ${i + 1}`);

      const meta = document.createElement("div");
      meta.className = "epMeta";
      meta.textContent =
        [ep.artist ? `Artist: ${ep.artist}` : null, ep.year ? `Year: ${ep.year}` : null]
          .filter(Boolean)
          .join(" • ") || "—";

      const hint = document.createElement("div");
      hint.className = "muted";
      hint.textContent = "Tap to open tracklist";

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(hint);

      // Click to toggle details
      let open = false;
      const toggle = () => {
        open = !open;
        if (open) {
          renderEpisodeDetails(ep, card);
        } else {
          const d = card.querySelector(".epDetails");
          if (d) d.remove();
        }
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
    btnDiag.addEventListener("click", () => debugPanel.classList.toggle("hidden"));

    log("DOM", "ready ✅");
    log("CSS", "loaded (if you see gradient)");

    const episodes = window.EPISODES || window.episodes;
    log("episodes.js", episodes ? "global found ✅" : "global NOT found ❌");

    if (!episodes) {
      setStatus("episodes.js loaded but did NOT expose data. Fix needed.");
      list.innerHTML = `
        <div class="muted">
          Your <b>data/episodes.js</b> must end with:<br><br>
          <span class="mono">window.EPISODES = EPISODES;</span>
        </div>
      `;
      return;
    }

    render(episodes);
  };

  document.addEventListener("DOMContentLoaded", boot);
})();
