(function () {
  const $ = (id) => document.getElementById(id);

  const list = $("episodes");
  const status = $("status");

  const setStatus = (text) => {
    if (status) status.textContent = text;
  };

  const safeText = (v) => (v == null ? "" : String(v));

  const getVideoId = (url) => {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
      const v = u.searchParams.get("v");
      if (v) return v;
      if (u.pathname.includes("/embed/"))
        return u.pathname.split("/embed/")[1].split(/[?#]/)[0];
      return "";
    } catch {
      return "";
    }
  };

  const makeEmbed = (url) => {
    const id = getVideoId(url);
    if (!id) return "";
    return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;
  };

  const renderDetails = (ep, detailsEl) => {
    detailsEl.innerHTML = "";

    const player = document.createElement("div");
    player.className = "player";

    const title = document.createElement("div");
    title.className = "playerTitle";
    title.textContent = safeText(ep.title || ep.artist);
    player.appendChild(title);

    const frameWrap = document.createElement("div");
    frameWrap.className = "playerFrameWrap";

    const iframe = document.createElement("iframe");
    iframe.className = "playerFrame";
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.loading = "lazy";

    const first = ep.tracks?.[0]?.url;
    if (first) iframe.src = makeEmbed(first);

    frameWrap.appendChild(iframe);
    player.appendChild(frameWrap);
    detailsEl.appendChild(player);
  };

  const render = (episodes) => {
    list.innerHTML = "";

    if (!Array.isArray(episodes) || episodes.length === 0) {
      setStatus("No sessions available.");
      return;
    }

    setStatus(`Loaded ${episodes.length} sessions`);

    episodes.forEach((ep) => {
      const card = document.createElement("div");
      card.className = "ep";
      card.tabIndex = 0;

      const title = document.createElement("div");
      title.className = "epTitle";
      title.textContent = safeText(ep.title || ep.artist);

      const meta = document.createElement("div");
      meta.className = "epMeta";
      meta.textContent = [
        ep.artist,
        ep.year
      ].filter(Boolean).join(" • ");

      card.appendChild(title);
      card.appendChild(meta);

      const details = document.createElement("div");
      details.className = "epDetails hidden";
      card.appendChild(details);

      const toggle = () => {
        const open = !details.classList.contains("hidden");

        document.querySelectorAll(".epDetails").forEach(d => d.classList.add("hidden"));
        document.querySelectorAll(".ep").forEach(e => e.classList.remove("open"));

        if (!open) {
          renderDetails(ep, details);
          details.classList.remove("hidden");
          card.classList.add("open");
          card.scrollIntoView({ behavior: "smooth", block: "start" });
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

  document.addEventListener("DOMContentLoaded", () => {
    const episodes = window.EPISODES || window.episodes;
    if (!episodes) {
      setStatus("No data loaded.");
      return;
    }
    render(episodes);
  });
})();
