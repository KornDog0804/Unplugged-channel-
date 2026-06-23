"use strict";

// ── Trusted channel signals ───────────────────────────────────────────────────
const TRUSTED_CHANNEL_KEYWORDS = [
  "calibertv","hate5six","arte concert","arte","kroq","kerrang",
  "nme","rock sound","3voor12","plus concert","world music festivals",
  "knotfest","loudwire","alt press","alternative press","red bull",
  "nbc","abc","bbc","npr","tiny desk","official","vevo",
  "spinefarm","nuclear blast","roadrunner","rise records",
  "hopeless","epitaph","sumerian","sharp tone","unfd"
];

const REJECT_REASONS = [
  "fan cam","wrong artist","bad quality",
  "playlist/compilation","duplicate","too short",
  "not a concert","other"
];

function isTrustedChannel(name) {
  const l = (name || "").toLowerCase();
  return TRUSTED_CHANNEL_KEYWORDS.some(k => l.includes(k));
}
function isRecent(discoveredAt) {
  if (!discoveredAt) return false;
  return Date.now() - new Date(discoveredAt).getTime() < 7 * 864e5;
}
function esc(str) {
  return String(str ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

// ── State ─────────────────────────────────────────────────────────────────────
let allCandidates    = [];
let approvedHistory  = [];
let rejectedHistory  = [];
// Map of videoId → { selected: bool, rejected: bool, reason: string }
const itemState = {};

function getState(id) {
  if (!itemState[id]) itemState[id] = { selected: false, rejected: false, reason: "other" };
  return itemState[id];
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $grid          = document.getElementById("grid");
const $stats         = document.getElementById("stats");
const $folderSelect  = document.getElementById("folderSelect");
const $selectAllBtn  = document.getElementById("selectAllBtn");
const $approveBtn    = document.getElementById("approveBtn");
const $rejectBtn     = document.getElementById("rejectBtn");
const $clearReviewed = document.getElementById("clearReviewedBtn");
const $clearPending  = document.getElementById("clearPendingBtn");
const $resetRejected = document.getElementById("resetRejectedBtn");
const $exportBtn     = document.getElementById("exportBtn");
const $copyBtn       = document.getElementById("copyBtn");
const $outputSection = document.getElementById("outputSection");
const $outputPre     = document.getElementById("outputPre");
const $toast         = document.getElementById("toast");

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, isError = false) {
  $toast.textContent = msg;
  $toast.style.background = isError ? "#ff4444" : "var(--lime)";
  $toast.style.color      = isError ? "#fff"    : "#0a1500";
  $toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove("show"), 3000);
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function renderStats() {
  const pending  = allCandidates.length;
  const selected = allCandidates.filter(c => getState(c.videoId).selected).length;
  const rejected = allCandidates.filter(c => getState(c.videoId).rejected).length;

  $stats.innerHTML =
    `<span>${pending}</span> pending &nbsp;|&nbsp; ` +
    `<span>${selected}</span> selected &nbsp;|&nbsp; ` +
    `<span style="color:#ff6666">${rejected}</span> marked rejected &nbsp;|&nbsp; ` +
    `<span style="color:#9a5cff">${approvedHistory.length}</span> approved all-time &nbsp;|&nbsp; ` +
    `<span style="color:#888">${rejectedHistory.length}</span> rejected all-time`;
}

// ── Render grid ───────────────────────────────────────────────────────────────
function renderGrid() {
  if (!allCandidates.length) {
    $grid.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        📭 Queue is empty.<br>
        <p>Run <strong>Discover New Shows</strong> in GitHub Actions to find new candidates.</p>
      </div>`;
    return;
  }

  $grid.innerHTML = allCandidates.map(c => {
    const st      = getState(c.videoId);
    const trusted = isTrustedChannel(c.channelName);
    const isNew   = isRecent(c.discoveredAt);
    const thumb   = c.thumbnail || c.thumb ||
      `https://img.youtube.com/vi/${c.videoId}/mqdefault.jpg`;

    const reasonOptions = REJECT_REASONS.map(r =>
      `<option value="${esc(r)}" ${st.reason === r ? "selected" : ""}>${esc(r)}</option>`
    ).join("");

    return `
    <div class="card ${st.selected ? "selected" : ""} ${st.rejected ? "rejected" : ""}"
         data-id="${esc(c.videoId)}">
      <div class="card-overlay">REJECTED</div>
      <div class="thumb-wrap">
        <img src="${esc(thumb)}" alt=""
             onerror="this.src='https://img.youtube.com/vi/${esc(c.videoId)}/mqdefault.jpg'">
        ${c.duration ? `<div class="thumb-badge">${esc(c.duration)}</div>` : ""}
        ${isNew ? `<div class="thumb-new">NEW</div>` : ""}
        ${trusted ? `<div class="thumb-trusted">✓ TRUSTED</div>` : ""}
      </div>
      <div class="card-body">
        <div class="card-title">${esc(c.title)}</div>
        <div class="card-meta">
          🎤 <span>${esc(c.artistMatched || c.suggestedArtist || "")}</span>
          ${c.viewCountText ? `&nbsp;·&nbsp; 👁 <span>${esc(c.viewCountText)}</span>` : ""}
        </div>
        <div class="card-channel ${trusted ? "trusted" : ""}">
          ${esc(c.channelName)}${c.publishedText ? ` · ${esc(c.publishedText)}` : ""}
        </div>
        <div class="card-search-term">found via "${esc(c.searchTerm || "")}"</div>
        <div class="card-actions">
          <input type="checkbox" class="card-cb" data-id="${esc(c.videoId)}"
                 ${st.selected ? "checked" : ""} ${st.rejected ? "disabled" : ""}>
          <a class="card-yt" href="${esc(c.url)}" target="_blank" rel="noopener">▶ Watch</a>
          <select class="reason-select" data-id="${esc(c.videoId)}" ${!st.rejected ? "disabled" : ""}>
            ${reasonOptions}
          </select>
          <button class="card-reject-btn" data-id="${esc(c.videoId)}">
            ${st.rejected ? "↩ Restore" : "✕ Reject"}
          </button>
        </div>
      </div>
    </div>`;
  }).join("");

  // Wire checkboxes
  $grid.querySelectorAll(".card-cb").forEach(cb => {
    cb.addEventListener("change", () => {
      const id = cb.getAttribute("data-id");
      getState(id).selected = cb.checked;
      syncCard(id);
      renderStats();
    });
  });

  // Wire reason selects
  $grid.querySelectorAll(".reason-select").forEach(sel => {
    sel.addEventListener("change", () => {
      getState(sel.getAttribute("data-id")).reason = sel.value;
    });
  });

  // Wire reject buttons
  $grid.querySelectorAll(".card-reject-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const st = getState(id);
      st.rejected = !st.rejected;
      if (st.rejected) st.selected = false;
      syncCard(id);
      renderStats();
    });
  });

  // Wire card body click to toggle checkbox
  $grid.querySelectorAll(".card").forEach(card => {
    card.addEventListener("click", e => {
      if (e.target.closest("a,button,input,select")) return;
      const id = card.getAttribute("data-id");
      const st = getState(id);
      if (st.rejected) return;
      st.selected = !st.selected;
      syncCard(id);
      renderStats();
    });
  });
}

function syncCard(id) {
  const card = $grid.querySelector(`.card[data-id="${id}"]`);
  if (!card) return;
  const st  = getState(id);
  card.classList.toggle("selected", st.selected);
  card.classList.toggle("rejected", st.rejected);
  const cb  = card.querySelector(".card-cb");
  const btn = card.querySelector(".card-reject-btn");
  const sel = card.querySelector(".reason-select");
  if (cb)  { cb.checked = st.selected; cb.disabled = st.rejected; }
  if (btn) btn.textContent = st.rejected ? "↩ Restore" : "✕ Reject";
  if (sel) sel.disabled = !st.rejected;
}

function render() { renderGrid(); renderStats(); }

// ── Generate output ───────────────────────────────────────────────────────────
function generateOutput() {
  const approved = allCandidates.filter(c => getState(c.videoId).selected);
  const rejected = allCandidates.filter(c => getState(c.videoId).rejected);
  const folder   = $folderSelect.value;

  if (!approved.length && !rejected.length) {
    showToast("Select or reject some cards first.", true);
    return null;
  }

  const approvedIds   = approved.map(c => c.videoId).join(",");
  const rejectedIds   = rejected.map(c => c.videoId).join(",");
  const rejectReasons = rejected.map(c => getState(c.videoId).reason).join(",");

  const lines = [
    `videoIds: ${approvedIds || "(none)"}`,
    `targetFolder: ${folder}`,
    `rejectIds: ${rejectedIds || "(none)"}`,
    `rejectReasons: ${rejectReasons || "(none)"}`,
  ];

  $outputPre.textContent = lines.join("\n");
  $outputSection.classList.add("visible");
  $outputSection.scrollIntoView({ behavior: "smooth", block: "start" });
  return lines.join("\n");
}

// ── Toolbar buttons ───────────────────────────────────────────────────────────
$selectAllBtn.addEventListener("click", () => {
  const visible = allCandidates.filter(c => !getState(c.videoId).rejected);
  const allSel  = visible.every(c => getState(c.videoId).selected);
  visible.forEach(c => { getState(c.videoId).selected = !allSel; });
  $selectAllBtn.textContent = allSel ? "☑ Select All" : "☐ Deselect All";
  render();
});

$approveBtn.addEventListener("click", () => {
  const out = generateOutput();
  if (out) showToast("✅ Output generated — copy it and run the Action.");
});

$rejectBtn.addEventListener("click", () => {
  const sel = allCandidates.filter(c => getState(c.videoId).selected);
  if (!sel.length) { showToast("Nothing selected.", true); return; }
  sel.forEach(c => {
    const st = getState(c.videoId);
    st.rejected = true;
    st.selected = false;
  });
  render();
  showToast(`${sel.length} marked as rejected.`);
});

// Clear Reviewed: removes items that are selected OR rejected from the visible list
// (they still get processed when you run the Action)
$clearReviewed && $clearReviewed.addEventListener("click", () => {
  const count = allCandidates.filter(c => {
    const st = getState(c.videoId);
    return st.selected || st.rejected;
  }).length;
  if (!count) { showToast("Nothing reviewed yet.", true); return; }
  if (!confirm(`Hide ${count} reviewed items from view? They'll still be processed when you run the Action.`)) return;
  allCandidates = allCandidates.filter(c => {
    const st = getState(c.videoId);
    return !st.selected && !st.rejected;
  });
  render();
  showToast(`${count} items hidden from view.`);
});

// Clear All Pending: wipes the entire queue (use with caution)
$clearPending && $clearPending.addEventListener("click", () => {
  if (!allCandidates.length) { showToast("Queue is already empty."); return; }
  if (!confirm(`Clear ALL ${allCandidates.length} pending candidates? This only affects the local view — run the Action to persist.`)) return;
  allCandidates = [];
  render();
  showToast("Queue cleared locally.");
});

// Reset Rejected History: shows a warning, does NOT auto-run — just generates output
$resetRejected && $resetRejected.addEventListener("click", () => {
  if (!confirm("This will generate a note to clear rejected-history.json. You'll need to manually empty that file in GitHub. Are you sure?")) return;
  $outputPre.textContent =
    "MANUAL ACTION REQUIRED:\n" +
    "Go to your repo → data/rejected-history.json → Edit → Replace all content with: []\n" +
    "Commit the change. The discovery bot will then resurface previously rejected videos.";
  $outputSection.classList.add("visible");
  $outputSection.scrollIntoView({ behavior: "smooth" });
  showToast("Instructions generated — see output below.");
});

// Export Backup
$exportBtn && $exportBtn.addEventListener("click", () => {
  const backup = {
    exportedAt: new Date().toISOString(),
    pendingCandidates: allCandidates,
    approvedHistory,
    rejectedHistory,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = `concert-corner-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  showToast("Backup downloaded.");
});

// Copy button
$copyBtn && $copyBtn.addEventListener("click", () => {
  const out = generateOutput();
  if (!out) return;
  navigator.clipboard.writeText($outputPre.textContent)
    .then(() => showToast("📋 Copied to clipboard!"))
    .catch(() => showToast("Select the text above and copy manually."));
});

// ── Load data ─────────────────────────────────────────────────────────────────
async function loadJson(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

async function init() {
  $grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Loading…</div>`;

  const [candidates, approved, rejected] = await Promise.all([
    loadJson("./data/discovery-candidates.json"),
    loadJson("./data/approved-history.json"),
    loadJson("./data/rejected-history.json"),
  ]);

  allCandidates   = Array.isArray(candidates) ? candidates : [];
  approvedHistory = Array.isArray(approved)   ? approved   : [];
  rejectedHistory = Array.isArray(rejected)   ? rejected   : [];

  if (!allCandidates.length) {
    $grid.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        📭 No pending candidates.<br>
        <p>Run <strong>Discover New Shows</strong> in GitHub Actions to find new shows.</p>
        <p style="margin-top:8px;font-size:12px;color:#666">
          Approved all-time: ${approvedHistory.length} &nbsp;|&nbsp;
          Rejected all-time: ${rejectedHistory.length}
        </p>
      </div>`;
    renderStats();
    return;
  }

  render();
}

init();
