// app.js
(function () {
  const $ = (id) => document.getElementById(id);

  const debugPanel = $("debugPanel");
  const debugLines = $("debugLines");
  const btnDiag = $("btnDiag");
  const status = $("status");
  const list = $("episodes");

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

  // Extract a YouTube video id from common URL formats
  const ytIdFromUrl = (url) => {
    try {
      const u = new URL(url);
      // youtu.be/<id>
      if (u.hostname.includes("youtu.be")) {
        return (u.pathname || "").replace("/", "").trim();
      }
      // youtube.com/watch?v=<id>
      const v = u.searchParams.get("v");
      if (v) return v.trim();

      // youtube.com/embed/<id>
      const parts = (u.pathname || "").split("/").filter(Boolean);
      const embedIndex = parts.indexOf("embed");
      if (embedIndex >= 0 && parts[embedIndex + 1]) return parts[embedIndex + 1].trim();

      return "";
    } catch (e) {
      return "";
    }
  };

  const introLabel = (ep) => {
    const intro = (ep && ep.intro) ? String(ep.intro).toLowerCase() : "";
    if (intro === "candle") return "🕯️ Candle intro (AIC / Nirvana vibes)";
    if (intro === "lava") return "🫧 Lava lamp intro";
    return "";
  };

  const buildTrackRow = (n, track, onPlay) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "trackRow";

    const left = document.createElement("div");
    left.className = "trackLeft";
    left.textContent = `${n}. ${safeText(track.title || "Untitled")}`;

    const right = document.createElement("div");
    right.className = "trackRight";
    right.textContent = "Play ▶";

    row.appendChild(left);
    row.appendChild(right);

    row.addEventListener("click", onPlay);

    return row;
  };

  const renderEpisodeDetails = (container, ep, index) => {
    // Details wrapper
    const details = document.createElement("div");
    details.className = "epDetails";

    const hint = document.createElement("div");
    hint.className = "muted";
    hint.textContent = "Tap to open tracklist";

    const intro = introLabel(ep);
    const introLine = document.createElement("div");
    introLine.className = "muted";
    introLine.textContent = intro;

    const playerCard = document.createElement("div");
    playerCard.className = "playerCard";

    const playerTitle = document.createElement("div");
    playerTitle.className = "playerTitle";
    playerTitle.textContent = "Select a track to play";

    const playerWrap = document.createElement("div");
    playerWrap.className = "playerWrap";

    // IMPORTANT: the iframe id must be unique per episode
    const frameId = `ytFrame_${safeText(ep.id || index)}`;

    const iframe = document.createElement("iframe");
    iframe.id = frameId;
    iframe.className = "player";
    iframe.width = "100%";
    iframe.height = "220";
    iframe.style.border = "0";
    iframe.style.borderRadius = "14px";
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    iframe.src = ""; // start empty until user picks a track

    playerWrap.appendChild(iframe);

    playerCard.appendChild(playerTitle);
    playerCard.appendChild(playerWrap);

    const tracksWrap = document.createElement("div");
    tracksWrap.className = "tracksWrap";

    const tracks = Array.isArray(ep.tracks) ? ep.tracks : [];
    if (!tracks.length) {
      const none = document.createElement("div");
      none.className = "muted";
      none.textContent = "No tracks added for this episode yet.";
      tracksWrap.appendChild(none);
    } else {
      tracks.forEach((t, i) => {
        const row = buildTrackRow(i + 1, t, () => {
          const id = ytIdFromUrl(t.url || "");
          if (!id) {
            alert("This track link doesn't look like a valid YouTube URL.");
            return;
          }

          playerTitle.textContent = `${safeText(ep.artist)} — ${safeText(t.title)}`;

          // REPLACE iframe node (mobile-safe) so it refreshes without collapsing layout
          const oldFrame = document.getElementById(frameId);
          const newFrame = document.createElement("iframe");
          newFrame.id = frameId;
          newFrame.className = "player";
          newFrame.width = "100%";
          newFrame.height = "220";
          newFrame.style.border = "0";
          newFrame.style.borderRadius = "14px";
          newFrame.allow =
            "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
          newFrame.allowFullscreen = true;

          // playsinline helps on mobile; rel=0 reduces “related” noise
          newFrame.src = `https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&rel=0`;

          if (oldFrame) oldFrame.replaceWith(newFrame);

          // DO NOT scroll (this is what made it feel like tracks “disappeared”)
          // If you ever want a gentle nudge, uncomment:
          // playerTitle.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });

        tracksWrap.appendChild(row);
      });
    }

    details.appendChild(hint);
    if (intro) details.appendChild(introLine);
    details.appendChild(playerCard);
    details.appendChild(tracksWrap);

    container.appendChild(details);
  };

  const render = (episodes) => {
    if (!list) return;

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

      const title = document.createElement("div");
      title.className = "epTitle";
      title.textContent = safeText(ep.title || ep.name || `Episode ${i + 1}`);

      const meta = document.createElement("div");
      meta.className = "epMeta";
      meta.textContent = [
        ep.artist ? `Artist: ${ep.artist}` : null,
        ep.year ? `Year: ${ep.year}` : null
      ].filter(Boolean).join(" • ") || "—";

      // Tap header to expand/collapse
      const header = document.createElement("button");
      header.type = "button";
      header.className = "epHeader";
      header.appendChild(title);
      header.appendChild(meta);

      const body = document.createElement("div");
      body.className = "epBody hidden";

      renderEpisodeDetails(body, ep, i);

      header.addEventListener("click", () => {
        body.classList.toggle("hidden");
      });

      card.appendChild(header);
      card.appendChild(body);
      list.appendChild(card);
    });
  };

  const boot = () => {
    // Debug panel toggle
    if (btnDiag && debugPanel) {
      btnDiag.addEventListener("click", () => debugPanel.classList.toggle("hidden"));
    }

    log("DOM", "ready ✅");
    log("CSS", "loaded (if you see gradient)");

    // Expect data/episodes.js to set: window.EPISODES (recommended) or window.episodes
    const episodes = window.EPISODES || window.episodes;

    log("episodes.js", episodes ? "global found ✅" : "global NOT found ❌");

    if (!episodes) {
      setStatus("episodes.js loaded but did NOT expose data. Fix needed.");
      if (list) {
        list.innerHTML = `
          <div class="muted">
            Your <b>data/episodes.js</b> must expose the array globally.<br><br>
            Add this at the bottom:<br>
            <span class="mono">window.EPISODES = EPISODES;</span>
          </div>
        `;
      }
      return;
    }

    render(episodes);
  };

  document.addEventListener("DOMContentLoaded", boot);
})();
