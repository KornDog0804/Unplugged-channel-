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

      const title = document.createElement("div");
      title.className = "epTitle";
      title.textContent = safeText(ep.title || ep.name || `Episode ${i + 1}`);

      const meta = document.createElement("div");
      meta.className = "epMeta";
      meta.textContent = [
        ep.artist ? `Artist: ${ep.artist}` : null,
        ep.year ? `Year: ${ep.year}` : null
      ].filter(Boolean).join(" • ") || "—";

      card.appendChild(title);
      card.appendChild(meta);
      list.appendChild(card);
    });
  };

  const boot = () => {
    // Toggle debug panel
    btnDiag.addEventListener("click", () => debugPanel.classList.toggle("hidden"));

    // Confirm we actually have DOM
    log("DOM", "ready ✅");

    // Confirm we can see CSS background (not a true check, but proves UI is not blocked)
    log("CSS", "loaded (if you see gradient)");

    // THE IMPORTANT PART:
    // Your data/episodes.js must set ONE of these globals:
    // window.EPISODES or window.episodes
    const episodes = window.EPISODES || window.episodes;

    log("episodes.js", episodes ? "global found ✅" : "global NOT found ❌");

    // If it isn't there, show the exact fix needed.
    if (!episodes) {
      setStatus("episodes.js loaded but did NOT expose data. Fix needed.");
      list.innerHTML = `
        <div class="muted">
          Your <b>data/episodes.js</b> must end with ONE of these lines:<br><br>
          <span class="mono">window.EPISODES = EPISODES;</span><br>
          or<br>
          <span class="mono">window.EPISODES = episodes;</span><br><br>
          (Depending on what your array variable is named.)
        </div>
      `;
      return;
    }

    // Render safely (no nuking the page)
    render(episodes);
  };

  document.addEventListener("DOMContentLoaded", boot);
})();
