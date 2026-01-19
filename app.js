import { playLavaIntro } from "./introLava.js";
import { playCandleIntro } from "./introCandle.js";

const screenBrowse = document.getElementById("screenBrowse");
const screenPlayer = document.getElementById("screenPlayer");

const btnChannel = document.getElementById("btnChannel");
const btnBrowse = document.getElementById("btnBrowse");
const btnBack = document.getElementById("btnBack");
const btnNext = document.getElementById("btnNext");

const grid = document.getElementById("grid");
const introCanvas = document.getElementById("introCanvas");

const nowTitle = document.getElementById("nowTitle");
const nowMeta = document.getElementById("nowMeta");

const nowCard = document.getElementById("nowCard");
const badgeRow = document.getElementById("badgeRow");
const epArtist = document.getElementById("epArtist");
const epYear = document.getElementById("epYear");

let episodes = [];
let currentIndex = 0;
let channelMode = false;

init();

async function init() {
  episodes = await loadEpisodes();

  renderGrid();
  setScreen("browse");

  btnChannel.addEventListener("click", () => startChannel());
  btnBrowse.addEventListener("click", () => setScreen("browse"));
  btnBack.addEventListener("click", () => {
    if (channelMode) {
      // If you’re channeling, back goes to browse but keeps mode ready.
      setScreen("browse");
    } else {
      setScreen("browse");
    }
  });
  btnNext.addEventListener("click", () => nextEpisode(true));

  // Start in browse
}

function setScreen(which) {
  if (which === "browse") {
    screenBrowse.classList.remove("hidden");
    screenPlayer.classList.add("hidden");
  } else {
    screenBrowse.classList.add("hidden");
    screenPlayer.classList.remove("hidden");
  }
}

function renderGrid() {
  grid.innerHTML = "";
  for (const ep of episodes) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="artist">${escapeHtml(ep.artist)}</div>
      <div class="meta">${ep.year} • ${ep.intro === "candle" ? "Candle intro" : "Lava intro"}</div>
      <div class="badges">
        <span class="badge">${escapeHtml(ep.badge || "FREE MIX")}</span>
        <span class="badge">${ep.intro === "candle" ? "CANDLE" : "LAVA"}</span>
      </div>
    `;
    card.addEventListener("click", () => {
      channelMode = false;
      playEpisodeById(ep.id);
    });
    grid.appendChild(card);
  }
}

function startChannel() {
  channelMode = true;
  // random starting point
  currentIndex = Math.floor(Math.random() * episodes.length);
  playEpisode(episodes[currentIndex]);
}

function nextEpisode(fromButton = false) {
  // Shuffle behavior: pick a different random index
  if (episodes.length <= 1) return;

  let next = currentIndex;
  for (let i=0; i<10; i++) {
    next = Math.floor(Math.random() * episodes.length);
    if (next !== currentIndex) break;
  }
  currentIndex = next;
  playEpisode(episodes[currentIndex]);
}

function playEpisodeById(id) {
  const idx = episodes.findIndex(e => e.id === id);
  if (idx >= 0) currentIndex = idx;
  playEpisode(episodes[currentIndex]);
}

async function playEpisode(ep) {
  setScreen("player");
  nowCard.classList.add("hidden");

  nowTitle.textContent = "Now Playing";
  nowMeta.textContent = `${ep.artist} • ${ep.year} • ${channelMode ? "Channel Mode" : "Picked"}`;

  // Make canvas fill the stage area
  fitCanvasToStage();

  const label = `${ep.artist} — ${ep.year}`;

  // Intro
  if (ep.intro === "candle") {
    await playCandleIntro(introCanvas, label, 5);
  } else {
    await playLavaIntro(introCanvas, ep.palette, label, 3);
  }

  // “Now Playing” card (video wiring comes next)
  badgeRow.innerHTML = "";
  badgeRow.appendChild(makeBadge(ep.badge || "FREE MIX"));
  badgeRow.appendChild(makeBadge(ep.intro === "candle" ? "CANDLE INTRO" : "LAVA INTRO"));

  epArtist.textContent = ep.artist;
  epYear.textContent = String(ep.year);

  nowCard.classList.remove("hidden");
}

function fitCanvasToStage() {
  // Ensure canvas uses CSS size properly; the intro modules handle internal scaling.
  const stage = introCanvas.parentElement;
  if (!stage) return;
  // Force a reflow so getBoundingClientRect is correct on first show
  stage.getBoundingClientRect();
}

function makeBadge(text) {
  const s = document.createElement("span");
  s.className = "badge";
  s.textContent = text;
  return s;
}

async function loadEpisodes() {
  const res = await fetch("./data/unplugged.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load unplugged.json");
  return await res.json();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}
