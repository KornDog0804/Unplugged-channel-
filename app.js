// Joey’s Acoustic Corner – STABLE BUILD

const DATA_URL = "/episodes_mobile.json";
const PAGE_SIZE = 20;

let stack = [];
let currentList = [];
let currentTracks = [];
let currentIndex = 0;

const el = {
  list: document.getElementById("sessionsList"),
  nowPlaying: document.getElementById("nowPlaying"),
  playerWrap: document.getElementById("playerWrap"),
  iframe: document.getElementById("ytFrame"),
  watchBtn: document.getElementById("watchBtn"),
  status: document.getElementById("status")
};

function safeArray(x) {
  return Array.isArray(x) ? x : [];
}

function youtubeEmbed(url) {
  if (!url) return "";
  const idMatch = url.match(/(?:v=|youtu\.be\/)([^&]+)/);
  if (!idMatch) return "";
  return `https://www.youtube.com/embed/${idMatch[1]}?autoplay=1`;
}

function renderList(list) {
  el.list.innerHTML = "";
  currentList = safeArray(list);

  currentList.forEach((item, i) => {
    const div = document.createElement("div");
    div.className = "ep";

    div.innerHTML = `
      <div>
        <div class="epTitle">${item.title || "Untitled"}</div>
        <div class="epSub">${item.mode || ""}</div>
      </div>
      <div class="chev">›</div>
    `;

    div.onclick = () => openItem(item);
    el.list.appendChild(div);
  });
}

function openItem(item) {
  if (!item) return;

  stack.push(currentList);

  if (item.mode === "folder") {
    renderList(safeArray(item.items));
  }

  else if (item.mode === "playlist") {
    playTracks(safeArray(item.tracks));
  }

  else if (item.mode === "fullshow") {
    playTracks(safeArray(item.tracks));
  }

  else if (item.mode === "queue") {
    renderTracks(safeArray(item.tracks));
  }
}

function renderTracks(tracks) {
  el.list.innerHTML = "";
  currentTracks = safeArray(tracks);

  currentTracks.forEach((t, i) => {
    const div = document.createElement("div");
    div.className = "ep";
    div.innerHTML = `
      <div>
        <div class="epTitle">${i + 1}. ${t.title}</div>
        <div class="epSub">single track</div>
      </div>
      <div class="chev">›</div>
    `;
    div.onclick = () => playSingle(i);
    el.list.appendChild(div);
  });

  const playAll = document.createElement("button");
  playAll.className = "playAllBtn";
  playAll.textContent = "Play All";
  playAll.onclick = () => playTracks(currentTracks);
  el.list.prepend(playAll);
}

function playSingle(i) {
  const t = currentTracks[i];
  if (!t) return;
  loadVideo(t.url);
}

function playTracks(tracks) {
  currentTracks = safeArray(tracks);
  if (!currentTracks.length) return;
  currentIndex = 0;
  loadVideo(currentTracks[0].url);
}

function loadVideo(url) {
  const embed = youtubeEmbed(url);
  if (!embed) return;

  el.iframe.src = embed;
  el.playerWrap.style.display = "block";
  el.watchBtn.href = url;
}

function goBack() {
  if (!stack.length) return;
  const prev = stack.pop();
  renderList(prev);
}

// Swipe support
let touchStartX = 0;

document.addEventListener("touchstart", e => {
  touchStartX = e.changedTouches[0].screenX;
});

document.addEventListener("touchend", e => {
  const diff = e.changedTouches[0].screenX - touchStartX;
  if (diff > 80) goBack();
});

// Load JSON
fetch(DATA_URL)
  .then(r => r.json())
  .then(data => {
    renderList(safeArray(data));
  })
  .catch(err => {
    if (el.status) el.status.textContent = "App crashed";
    console.error(err);
  });
