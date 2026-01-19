// app.js
import { EPISODES } from "./data/episodes.js";
import { runCandleIntro } from "./introCandle.js";
import { runLavaIntro } from "./introLava.js";

// ---------- UI ----------
const $ = (sel) => document.querySelector(sel);

function render() {
  const app = $("#app");

  app.innerHTML = `
    <div class="header">
      <div>
        <div class="title">Unplugged Channel</div>
        <div class="sub">FREE-first • Shuffle channel + pick-anytime</div>
      </div>

      <div class="pillrow">
        <button class="btn" id="shuffleBtn">▶ Channel (Shuffle)</button>
        <button class="btn" id="browseBtn">Browse</button>
      </div>
    </div>

    <div class="sectionCard">
      <h1 class="sectionTitle">Browse Episodes</h1>
      <p class="sectionSub">Pick one, or hit Channel and let it ride.</p>

      <div class="list" id="episodeList"></div>
    </div>
  `;

  const list = $("#episodeList");
  list.innerHTML = EPISODES.map(ep => cardHTML(ep)).join("");

  $("#shuffleBtn").addEventListener("click", () => {
    const shuffled = [...EPISODES].sort(() => Math.random() - 0.5);
    playEpisode(shuffled[0].id);
  });

  $("#browseBtn").addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // card click handlers
  for (const ep of EPISODES) {
    const el = document.getElementById(`play-${ep.id}`);
    if (el) el.addEventListener("click", () => playEpisode(ep.id));
  }
}

function cardHTML(ep) {
  const tags = [];
  tags.push(ep.mode === "full" ? "FREE FULL / MIX" : "FREE MIX");
  tags.push(ep.intro === "candle" ? "CANDLE" : "LAVA");

  return `
    <div class="card">
      <div class="cardTop">
        <div>
          <div class="cardTitle">${ep.artist}</div>
          <div class="cardMeta">${ep.year} • ${ep.intro === "candle" ? "Candle intro" : "Lava intro"}</div>
        </div>
        <button class="btn" id="play-${ep.id}">Play</button>
      </div>

      <div class="tags">
        ${tags.map(t => `<span class="tag">${t}</span>`).join("")}
      </div>
    </div>
  `;
}

// ---------- Player Overlay (YouTube IFrame API) ----------
let ytPlayer = null;
let currentEpisode = null;
let currentIndex = 0;

const overlay = () => $("#playerOverlay");
const nowArtist = () => $("#nowArtist");
const nowTrack = () => $("#nowTrack");
const queue = () => $("#queue");

function openOverlay() {
  overlay().classList.remove("hidden");
  overlay().setAttribute("aria-hidden", "false");
}
function closeOverlay() {
  overlay().classList.add("hidden");
  overlay().setAttribute("aria-hidden", "true");
  // Stop playback
  try { ytPlayer?.stopVideo?.(); } catch {}
}

function setNowPlaying() {
  nowArtist().textContent = `${currentEpisode.artist} • ${currentEpisode.year}`;
  nowTrack().textContent = currentEpisode.tracks[currentIndex]?.title ?? "—";
}

function renderQueue() {
  queue().innerHTML = currentEpisode.tracks
    .map((t, i) => `
      <div class="queueItem ${i === currentIndex ? "active" : ""}" data-idx="${i}">
        <div class="queueTitle">${String(i+1).padStart(2,"0")}. ${t.title}</div>
        <div class="queueSmall">Tap to play</div>
      </div>
    `)
    .join("");

  queue().querySelectorAll(".queueItem").forEach(item => {
    item.addEventListener("click", () => {
      const idx = Number(item.getAttribute("data-idx"));
      playIndex(idx);
    });
  });
}

function youtubeIdFromUrl(url) {
  const u = new URL(url);
  if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "");
  return u.searchParams.get("v");
}

function playIndex(idx) {
  currentIndex = Math.max(0, Math.min(idx, currentEpisode.tracks.length - 1));
  setNowPlaying();
  renderQueue();

  const id = youtubeIdFromUrl(currentEpisode.tracks[currentIndex].url);
  if (!id) return;

  if (!ytPlayer) {
    ytPlayer = new YT.Player("ytPlayer", {
      videoId: id,
      playerVars: {
        autoplay: 1,
        rel: 0,
        modestbranding: 1
      },
      events: {
        onStateChange: (e) => {
          // 0 = ended
          if (e.data === 0) next();
        }
      }
    });
  } else {
    ytPlayer.loadVideoById(id);
  }
}

function prev() {
  playIndex(currentIndex - 1);
}
function next() {
  playIndex(currentIndex + 1);
}

// Wire overlay buttons once
function wireOverlayControls() {
  $("#closePlayer").addEventListener("click", closeOverlay);
  $("#prevTrack").addEventListener("click", prev);
  $("#nextTrack").addEventListener("click", next);

  // click background to close (but not the card)
  overlay().addEventListener("click", (e) => {
    if (e.target === overlay()) closeOverlay();
  });
}

// ---------- Episode Play Flow (Intro -> Player) ----------
async function playEpisode(id) {
  const ep = EPISODES.find(e => e.id === id);
  if (!ep) return;

  currentEpisode = ep;
  currentIndex = 0;

  // Run intro first (user gesture starts this chain, good for autoplay rules)
  if (ep.intro === "candle") {
    await runCandleIntro({ label: ep.artist });
  } else {
    await runLavaIntro({ label: ep.artist });
  }

  openOverlay();
  setNowPlaying();
  renderQueue();
  playIndex(0);
}

// YouTube API calls window.onYouTubeIframeAPIReady when it’s loaded.
// We don’t need to do anything there; we create the player on first play.
window.onYouTubeIframeAPIReady = () => {};

// boot
render();
wireOverlayControls();
