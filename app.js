/* Joey’s Acoustic Corner — app.js
   Stable stitched player w/ TV handoff
*/

(function () {
  const $ = (s) => document.querySelector(s);

  const el = {
    episodes: $("#episodes"),
    status: $("#status"),
    frame: $("#playerFrame"),
    title: $("#nowPlayingTitle"),
    line: $("#nowPlayingLine"),
    toggle: $("#playerToggleBtn"),
    watchTV: $("#watchTvBtn")
  };

  function getVideoId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const p = u.pathname.split("/").filter(Boolean);
      const i = p.indexOf("embed");
      return i >= 0 ? p[i + 1] : "";
    } catch {
      return "";
    }
  }

  function getPlaylistId(url) {
    try {
      return new URL(url).searchParams.get("list") || "";
    } catch {
      return "";
    }
  }

  function embedQueue(urls) {
    const ids = urls.map(getVideoId).filter(Boolean);
    if (!ids.length) return "";
    const [first, ...rest] = ids;
    return `https://www.youtube.com/embed/${first}?autoplay=1&playsinline=1&rel=0&modestbranding=1${rest.length ? `&playlist=${rest.join(",")}` : ""}`;
  }

  function embedPlaylist(url) {
    const list = getPlaylistId(url);
    if (!list) return "";
    return `https://www.youtube.com/embed/videoseries?list=${list}&autoplay=1&playsinline=1&rel=0&modestbranding=1`;
  }

  function play(ep) {
    if (!ep || !ep.tracks?.length) return;

    const mode = ep.mode?.toLowerCase();
    let src = "";

    if (mode === "queue") src = embedQueue(ep.tracks.map(t => t.url));
    else if (mode === "playlist") src = embedPlaylist(ep.tracks[0].url);
    else src = embedQueue([ep.tracks[0].url]);

    if (!src) {
      el.status.textContent = "Bad stream link";
      return;
    }

    el.frame.src = src;
    el.title.textContent = ep.title || "Now Playing";
    el.line.textContent = `Playing now: ${ep.artist || ""}${ep.year ? " • " + ep.year : ""}`;

    document.body.classList.remove("playerCollapsed");
    el.toggle.textContent = "Hide player";
    el.toggle.setAttribute("aria-expanded", "true");

    document.querySelectorAll(".ep").forEach(e => e.classList.remove("isActive"));
    document.querySelector(`[data-key="${ep.__key}"]`)?.classList.add("isActive");

    if (el.watchTV) {
      el.watchTV.href = ep.tracks[0].url;
      el.watchTV.style.display = "inline-flex";
    }

    el.status.textContent = "Ready";
  }

  function card(ep, i) {
    const d = document.createElement("div");
    ep.__key = `${i}-${ep.title}`;
    d.className = "ep";
    d.dataset.key = ep.__key;
    d.innerHTML = `
      <div class="epHead">
        <div>
          <div class="epTitle">${ep.title}</div>
          <div class="epMeta">${ep.artist || ""}${ep.year ? " • " + ep.year : ""}</div>
          <div class="epSmall">
            ${ep.mode === "queue" ? `${ep.tracks.length} tracks • stitched queue` :
              ep.mode === "playlist" ? "playlist" : "full show"}
          </div>
        </div>
        <div class="chev">›</div>
      </div>
    `;
    d.onclick = () => play(ep);
    return d;
  }

  function initToggle() {
    if (!el.toggle) return;
    document.body.classList.add("playerCollapsed");
    el.toggle.textContent = "Show player";

    el.toggle.onclick = () => {
      const collapsed = document.body.classList.toggle("playerCollapsed");
      el.toggle.textContent = collapsed ? "Show player" : "Hide player";
      el.toggle.setAttribute("aria-expanded", String(!collapsed));
    };
  }

  function init() {
    const episodes = window.EPISODES;
    if (!Array.isArray(episodes)) {
      el.status.textContent = "episodes.js missing";
      return;
    }

    el.episodes.innerHTML = "";
    episodes.forEach((ep, i) => el.episodes.appendChild(card(ep, i)));
    el.status.textContent = `${episodes.length} sessions`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    initToggle();
    init();
  });
})();
