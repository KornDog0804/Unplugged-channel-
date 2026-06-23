"use strict";

// ── Config ────────────────────────────────────────────────────────────────────
const REPO  = "KornDog0804/Unplugged-channel-";
const BRANCH = "main";
const TOKEN_KEY = "cc_admin_gh_token";

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

// ── Folder name resolution ────────────────────────────────────────────────────
// actualFolders is populated after episodes.json loads — contains the real
// folder titles exactly as they appear in the file (with emojis).
let actualFolders = [];

function resolveFolder(keyword) {
  // Find a folder whose title contains the keyword (case-insensitive, ignores emoji)
  const kw = keyword.toLowerCase();
  return actualFolders.find(f =>
    f.toLowerCase().includes(kw) ||
    f.toLowerCase().replace(/[^a-z0-9 ]/g, "").includes(kw.replace(/[^a-z0-9 ]/g, ""))
  ) || actualFolders.find(f => f.toLowerCase().includes("live")) || actualFolders[0] || keyword;
}

function suggestFolder(candidate) {
  const title   = (candidate.title || "").toLowerCase();
  const term    = (candidate.searchTerm || "").toLowerCase();
  const channel = (candidate.channelName || "").toLowerCase();

  if (title.includes("tiny desk") || channel.includes("npr music") || channel.includes("npr"))
    return resolveFolder("tiny desk");
  if (title.includes("mtv unplugged") || title.includes("unplugged"))
    return resolveFolder("unplugged");
  if (title.includes("stitched") || title.includes("stripped") ||
      title.includes("full session") || title.includes("acoustic session") ||
      term === "acoustic session")
    return resolveFolder("stitched");
  return resolveFolder("live concert");
}

function isTrustedChannel(name) {
  const l = (name || "").toLowerCase();
  return TRUSTED_CHANNEL_KEYWORDS.some(k => l.includes(k));
}
function isRecent(d) {
  return d && Date.now() - new Date(d).getTime() < 7 * 864e5;
}
function esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

// ── State ─────────────────────────────────────────────────────────────────────
let allCandidates   = [];
let approvedHistory = [];
let rejectedHistory = [];
const itemState = {};
function getState(id) {
  if (!itemState[id]) itemState[id] = { selected:false, rejected:false, reason:"other" };
  return itemState[id];
}

// ── DOM ───────────────────────────────────────────────────────────────────────
const $grid           = document.getElementById("grid");
const $stats          = document.getElementById("stats");
const $folderSelect   = document.getElementById("folderSelect");
const $selectAllBtn   = document.getElementById("selectAllBtn");
const $approveBtn     = document.getElementById("approveBtn");
const $rejectBtn      = document.getElementById("rejectBtn");
const $clearReviewed  = document.getElementById("clearReviewedBtn");
const $clearPending   = document.getElementById("clearPendingBtn");
const $resetRejected  = document.getElementById("resetRejectedBtn");
const $exportBtn      = document.getElementById("exportBtn");
const $toast          = document.getElementById("toast");
const $tokenBar       = document.getElementById("tokenBar");
const $tokenStatus    = document.getElementById("tokenStatus");
const $tokenInput     = document.getElementById("tokenInput");
const $tokenSaveBtn   = document.getElementById("tokenSaveBtn");
const $progressOverlay= document.getElementById("progressOverlay");
const $progressTitle  = document.getElementById("progressTitle");
const $progressLog    = document.getElementById("progressLog");
const $progressClose  = document.getElementById("progressClose");

// ── Token management ──────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }

function updateTokenUI() {
  const t = getToken();
  if (t) {
    $tokenStatus.textContent = "✓ GitHub token saved — one-tap approve ready";
    $tokenStatus.className = "token-status ok";
    $tokenBar.className = "token-bar ok";
    $tokenInput.value = "";
    $tokenInput.placeholder = "Token saved (tap to replace)";
    $approveBtn.disabled = false;
  } else {
    $tokenStatus.textContent = "⚠ Paste your GitHub PAT token to enable one-tap approve";
    $tokenStatus.className = "token-status bad";
    $tokenBar.className = "token-bar";
    $approveBtn.disabled = true;
  }
}

$tokenSaveBtn.addEventListener("click", () => {
  const val = $tokenInput.value.trim();
  if (!val) { showToast("Paste your token first.", true); return; }
  setToken(val);
  updateTokenUI();
  showToast("✓ Token saved — approve is now one tap.");
});

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, isError=false) {
  $toast.textContent = msg;
  $toast.style.background = isError ? "#ff4444" : "var(--lime)";
  $toast.style.color = isError ? "#fff" : "#0a1500";
  $toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove("show"), 3200);
}

// ── Progress log ──────────────────────────────────────────────────────────────
function showProgress(title) {
  $progressTitle.textContent = title;
  $progressLog.textContent = "";
  $progressClose.style.display = "none";
  $progressOverlay.classList.add("show");
}
function logProgress(msg) {
  $progressLog.textContent += msg + "\n";
  $progressLog.scrollTop = $progressLog.scrollHeight;
}
function doneProgress(success) {
  $progressTitle.textContent = success ? "✅ Done!" : "❌ Error — check log";
  $progressClose.style.display = "inline-block";
}
$progressClose.addEventListener("click", () => {
  $progressOverlay.classList.remove("show");
});

// ── GitHub API helpers ────────────────────────────────────────────────────────
async function ghGet(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`, {
    headers: { Authorization: `token ${getToken()}`, Accept: "application/vnd.github.v3+json" }
  });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${res.statusText}`);
  return res.json();
}

async function ghPut(path, content, sha, message) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `token ${getToken()}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
      sha,
      branch: BRANCH
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`PUT ${path}: ${res.status} — ${err.message || res.statusText}`);
  }
  return res.json();
}

// ── One-tap approve: runs entirely in the browser via GitHub API ──────────────
async function runApproval() {
  const approved = allCandidates.filter(c => getState(c.videoId).selected);
  const rejected = allCandidates.filter(c => getState(c.videoId).rejected);
  const folder   = $folderSelect.value;

  if (!approved.length && !rejected.length) {
    showToast("Select or reject some cards first.", true); return;
  }
  if (!getToken()) {
    showToast("Save your GitHub token first.", true); return;
  }

  showProgress(`Approving ${approved.length} · Rejecting ${rejected.length}…`);
  const nowIso  = new Date().toISOString();
  const today   = nowIso.slice(0, 10);

  try {
    // ── 1. Fetch all four files from GitHub ──────────────────────────────────
    logProgress("📥 Fetching files from GitHub…");
    const [epFile, candFile, appFile, rejFile] = await Promise.all([
      ghGet("episodes.json"),
      ghGet("data/discovery-candidates.json"),
      ghGet("data/approved-history.json").catch(() => ({ content: btoa("[]"), sha: null })),
      ghGet("data/rejected-history.json").catch(() => ({ content: btoa("[]"), sha: null })),
    ]);

    const episodes        = JSON.parse(decodeURIComponent(escape(atob(epFile.content.replace(/\n/g,"")))));
    let   candidates      = JSON.parse(decodeURIComponent(escape(atob(candFile.content.replace(/\n/g,"")))));
    const approvedHist    = JSON.parse(decodeURIComponent(escape(atob(appFile.content.replace(/\n/g,"")))));
    const rejectedHist    = JSON.parse(decodeURIComponent(escape(atob(rejFile.content.replace(/\n/g,"")))));

    logProgress(`✓ Loaded: ${episodes.length || "?"} sections · ${candidates.length} candidates`);

    // Populate actualFolders so suggestFolder uses real names from THIS file
    const rootArr = Array.isArray(episodes) ? episodes : (episodes.items || []);
    actualFolders = rootArr
      .filter(item => item && Array.isArray(item.items))
      .map(item => item.title);
    logProgress(`📂 Known folders: ${actualFolders.join(" · ")}`);

    // ── 2. Index existing videoIds ───────────────────────────────────────────
    const existingIds = new Set(approvedHist.map(h => h.videoId));
    const existingUrls = new Set();
    function indexNode(node) {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach(indexNode); return; }
      if (Array.isArray(node.items)) { node.items.forEach(indexNode); return; }
      (node.tracks || []).forEach(t => {
        if (!t?.url) return;
        existingUrls.add(t.url);
        try {
          const u = new URL(t.url);
          const v = u.searchParams.get("v") ||
            (u.hostname.includes("youtu.be") ? u.pathname.replace("/","").trim() : null);
          if (v) existingIds.add(v);
        } catch {}
      });
    }
    indexNode(episodes);

    // ── 3. Group approved cards by their auto-suggested folder ─────────────
    // Each card knows where it belongs via suggestFolder().
    // Mixed selections (e.g. Live Concerts + Tiny Desk) each go to the
    // correct place in a single approval tap — no separate runs needed.
    const rootArray = Array.isArray(episodes) ? episodes : (episodes.items || []);

    function getOrCreateFolder(name) {
      // Exact match first
      let fn = rootArray.find(item => Array.isArray(item.items) && item.title === name);
      if (!fn) {
        logProgress(`  📁 Creating new folder: "${name}"`);
        fn = { title: name, mode: "folder", items: [] };
        rootArray.splice(Math.max(0, rootArray.length - 2), 0, fn);
      }
      return fn;
    }

    const groups = {};
    for (const c of approved) {
      const dest = suggestFolder(c);
      if (!groups[dest]) groups[dest] = [];
      groups[dest].push(c);
    }
    logProgress(`📂 Routing to ${Object.keys(groups).length} folder(s): ${Object.entries(groups).map(([f,v])=>`${f} (${v.length})`).join(" · ")}`);

    // ── 4. Add approved episodes into their correct folders ──────────────────
    let added = 0, skipped = 0;

    for (const [destFolder, cards] of Object.entries(groups)) {
      const folder_node = getOrCreateFolder(destFolder);
      logProgress(`\n📁 "${destFolder}" — ${cards.length} item(s)`);

      for (const c of cards) {
        if (existingIds.has(c.videoId)) {
          logProgress(`  ⚠ Skip (dupe): ${c.title?.slice(0,50)}`);
          skipped++; continue;
        }

        let node = c.suggestedEpisodesJson
          ? JSON.parse(JSON.stringify(c.suggestedEpisodesJson))
          : {
              title: c.title || `Video ${c.videoId}`,
              artist: c.artistMatched || c.suggestedArtist || "",
              year: new Date().getFullYear(),
              mode: "fullshow",
              tracks: [{ title: c.title || "Full Show", url: c.url || `https://www.youtube.com/watch?v=${c.videoId}` }]
            };

        node.added = today;
        if (node.thumb?.includes("sqp=")) {
          try { const u = new URL(node.thumb); u.search = ""; node.thumb = u.toString(); } catch {}
        }

        // Live Concerts gets artist sub-folders; all others go flat
        const liveFolder = resolveFolder("live concert");
        if (destFolder === liveFolder) {
          const artistName = node.artist || c.artistMatched || c.suggestedArtist || "Unknown";
          let artistFolder = folder_node.items.find(i => i.mode === "folder" && i.title === artistName);
          if (!artistFolder) {
            artistFolder = { title: artistName, mode: "folder", items: [] };
            folder_node.items.push(artistFolder);
          // Re-sort artist folders alphabetically after adding
          folder_node.items.sort((a, b) => (a.title||"").localeCompare(b.title||""));
          }
          const { artist, ...nodeClean } = node;
          artistFolder.items.push(nodeClean);
        } else {
          folder_node.items.push(node);
        }

        existingIds.add(c.videoId);
        approvedHist.unshift({
          videoId: c.videoId,
          title: c.title,
          artist: c.artistMatched || c.suggestedArtist || "",
          targetFolder: destFolder,
          approvedAt: nowIso,
          url: c.url || `https://www.youtube.com/watch?v=${c.videoId}`,
        });
        logProgress(`  ✅ [${destFolder}] ${c.title?.slice(0,48)}`);
        added++;
      }
    }

    // ── 5. Process rejections ────────────────────────────────────────────────
    for (const c of rejected) {
      const reason = getState(c.videoId).reason;
      if (!rejectedHist.some(h => h.videoId === c.videoId)) {
        rejectedHist.unshift({ videoId: c.videoId, title: c.title, artist: c.artistMatched || "",
          channelName: c.channelName || "", reason, rejectedAt: nowIso, url: c.url });
        logProgress(`  🗑 Rejected (${reason}): ${c.title?.slice(0,40)}`);
      }
    }

    // ── 6. Remove processed from candidates ─────────────────────────────────
    const processedIds = new Set([...approved, ...rejected].map(c => c.videoId));
    candidates = candidates.filter(c => !processedIds.has(c.videoId));
    logProgress(`\n📊 Added: ${added} · Skipped: ${skipped} · Rejected: ${rejected.length} · Remaining: ${candidates.length}`);

    // ── 7. Write all four files back to GitHub ───────────────────────────────
    logProgress("\n📤 Writing to GitHub…");

    await ghPut("episodes.json", episodes, epFile.sha,
      `✅ Admin: added ${added} to "${folder}" · ${today}`);
    logProgress("  ✓ episodes.json");

    await ghPut("data/discovery-candidates.json", candidates, candFile.sha,
      `🔄 Candidates: removed ${processedIds.size} processed · ${today}`);
    logProgress("  ✓ discovery-candidates.json");

    await ghPut("data/approved-history.json", approvedHist, appFile.sha || undefined,
      `📋 Approved history: +${added} · ${today}`);
    logProgress("  ✓ approved-history.json");

    await ghPut("data/rejected-history.json", rejectedHist, rejFile.sha || undefined,
      `🗑 Rejected history: +${rejected.length} · ${today}`);
    logProgress("  ✓ rejected-history.json");

    // ── 8. Update local state ────────────────────────────────────────────────
    allCandidates   = candidates;
    approvedHistory = approvedHist;
    rejectedHistory = rejectedHist;
    // Clear selections
    [...approved, ...rejected].forEach(c => {
      itemState[c.videoId] = { selected:false, rejected:false, reason:"other" };
    });

    logProgress(`\n🎸 All done! Netlify will deploy in ~30 seconds.`);
    doneProgress(true);
    render();

  } catch (e) {
    logProgress(`\n❌ ERROR: ${e.message}`);
    doneProgress(false);
    console.error(e);
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function renderStats() {
  const sel = allCandidates.filter(c => getState(c.videoId).selected).length;
  const rej = allCandidates.filter(c => getState(c.videoId).rejected).length;
  $stats.innerHTML =
    `<span>${allCandidates.length}</span> pending &nbsp;|&nbsp; ` +
    `<span>${sel}</span> selected &nbsp;|&nbsp; ` +
    `<span style="color:#ff6666">${rej}</span> marked rejected &nbsp;|&nbsp; ` +
    `<span style="color:#9a5cff">${approvedHistory.length}</span> approved all-time &nbsp;|&nbsp; ` +
    `<span style="color:#888">${rejectedHistory.length}</span> rejected all-time`;
}

// ── Grid ──────────────────────────────────────────────────────────────────────
function renderGrid() {
  if (!allCandidates.length) {
    $grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
      📭 Queue is empty.<br>
      <p>Run <strong>Discover New Shows</strong> in GitHub Actions to find new shows.</p>
      <p style="margin-top:8px;font-size:12px;color:#666">
        Approved all-time: ${approvedHistory.length} &nbsp;|&nbsp;
        Rejected all-time: ${rejectedHistory.length}
      </p></div>`;
    return;
  }

  $grid.innerHTML = allCandidates.map(c => {
    const st      = getState(c.videoId);
    const trusted = isTrustedChannel(c.channelName);
    const isNew   = isRecent(c.discoveredAt);
    const thumb   = c.thumbnail || c.thumb ||
      `https://img.youtube.com/vi/${c.videoId}/mqdefault.jpg`;
    const reasonOpts = REJECT_REASONS.map(r =>
      `<option value="${esc(r)}" ${st.reason===r?"selected":""}>${esc(r)}</option>`
    ).join("");

    const sugFolder = suggestFolder(c);
    // Strip leading emoji for the badge display
    const sugFolderLabel = sugFolder.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\s]+/u, "").trim();
    const folderBadge = `<div class="card-folder-badge">${esc(sugFolderLabel)}</div>`;

    return `<div class="card ${st.selected?"selected":""} ${st.rejected?"rejected":""}" data-id="${esc(c.videoId)}">
      <div class="card-overlay">REJECTED</div>
      <div class="thumb-wrap">
        <img src="${esc(thumb)}" alt="" onerror="this.src='https://img.youtube.com/vi/${esc(c.videoId)}/mqdefault.jpg'">
        ${c.duration?`<div class="thumb-badge">${esc(c.duration)}</div>`:""}
        ${isNew?`<div class="thumb-new">NEW</div>`:""}
        ${trusted?`<div class="thumb-trusted">✓ TRUSTED</div>`:""}
      </div>
      <div class="card-body">
        <div class="card-title">${esc(c.title)}</div>
        <div class="card-meta">🎤 <span>${esc(c.artistMatched||c.suggestedArtist||"")}</span>${c.viewCountText?` &nbsp;·&nbsp; 👁 <span>${esc(c.viewCountText)}</span>`:""}</div>
        <div class="card-channel ${trusted?"trusted":""}">${esc(c.channelName)}${c.publishedText?` · ${esc(c.publishedText)}`:""}</div>
        <div class="card-search-term">found via "${esc(c.searchTerm||"")}"</div>
        ${folderBadge}
        <div class="card-actions">
          <input type="checkbox" class="card-cb" data-id="${esc(c.videoId)}" ${st.selected?"checked":""} ${st.rejected?"disabled":""}>
          <a class="card-yt" href="${esc(c.url)}" target="_blank" rel="noopener">▶ Watch</a>
          <select class="reason-select" data-id="${esc(c.videoId)}" ${!st.rejected?"disabled":""}>${reasonOpts}</select>
          <button class="card-reject-btn" data-id="${esc(c.videoId)}">${st.rejected?"↩ Restore":"✕ Reject"}</button>
        </div>
      </div>
    </div>`;
  }).join("");

  $grid.querySelectorAll(".card-cb").forEach(cb => {
    cb.addEventListener("change", () => {
      getState(cb.getAttribute("data-id")).selected = cb.checked;
      syncCard(cb.getAttribute("data-id")); renderStats();
    });
  });
  $grid.querySelectorAll(".reason-select").forEach(sel => {
    sel.addEventListener("change", () => { getState(sel.getAttribute("data-id")).reason = sel.value; });
  });
  $grid.querySelectorAll(".card-reject-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id"), st = getState(id);
      st.rejected = !st.rejected;
      if (st.rejected) st.selected = false;
      syncCard(id); renderStats();
    });
  });
  $grid.querySelectorAll(".card").forEach(card => {
    card.addEventListener("click", e => {
      if (e.target.closest("a,button,input,select")) return;
      const id = card.getAttribute("data-id"), st = getState(id);
      if (st.rejected) return;
      st.selected = !st.selected;
      syncCard(id); renderStats();
    });
  });
}

function syncCard(id) {
  const card = $grid.querySelector(`.card[data-id="${id}"]`);
  if (!card) return;
  const st = getState(id);
  card.classList.toggle("selected", st.selected);
  card.classList.toggle("rejected", st.rejected);
  const cb  = card.querySelector(".card-cb");
  const btn = card.querySelector(".card-reject-btn");
  const sel = card.querySelector(".reason-select");
  if (cb)  { cb.checked = st.selected; cb.disabled = st.rejected; }
  if (btn) btn.textContent = st.rejected ? "↩ Restore" : "✕ Reject";
  if (sel) sel.disabled = !st.rejected;
  // Auto-update folder dropdown to match selected cards
  updateFolderSuggestion();
}

// Tally suggested folders across all selected cards and pick the winner
function updateFolderSuggestion() {
  const selected = allCandidates.filter(c => getState(c.videoId).selected);
  if (!selected.length) return;

  const tally = {};
  for (const c of selected) {
    const f = suggestFolder(c);
    tally[f] = (tally[f] || 0) + 1;
  }
  // Pick the folder with the most votes
  const winner = Object.entries(tally).sort((a,b) => b[1]-a[1])[0][0];

  // Only update if dropdown option exists
  const opt = [...$folderSelect.options].find(o => o.value === winner);
  if (opt) $folderSelect.value = winner;
}

function render() { renderGrid(); renderStats(); }

// ── Toolbar buttons ───────────────────────────────────────────────────────────
$selectAllBtn.addEventListener("click", () => {
  const visible = allCandidates.filter(c => !getState(c.videoId).rejected);
  const allSel  = visible.every(c => getState(c.videoId).selected);
  visible.forEach(c => { getState(c.videoId).selected = !allSel; });
  $selectAllBtn.textContent = allSel ? "☑ Select All" : "☐ Deselect All";
  render();
});

$approveBtn.addEventListener("click", runApproval);

$rejectBtn.addEventListener("click", () => {
  const sel = allCandidates.filter(c => getState(c.videoId).selected);
  if (!sel.length) { showToast("Nothing selected.", true); return; }
  sel.forEach(c => { getState(c.videoId).rejected = true; getState(c.videoId).selected = false; });
  render(); showToast(`${sel.length} marked as rejected — tap Approve to commit.`);
});

$clearReviewed && $clearReviewed.addEventListener("click", () => {
  const count = allCandidates.filter(c => { const s=getState(c.videoId); return s.selected||s.rejected; }).length;
  if (!count) { showToast("Nothing reviewed yet.", true); return; }
  if (!confirm(`Hide ${count} reviewed items from view?`)) return;
  allCandidates = allCandidates.filter(c => { const s=getState(c.videoId); return !s.selected&&!s.rejected; });
  render(); showToast(`${count} items hidden.`);
});

$clearPending && $clearPending.addEventListener("click", async () => {
  if (!allCandidates.length) { showToast("Queue already empty."); return; }
  if (!confirm(`Permanently clear ALL ${allCandidates.length} pending candidates from GitHub? This cannot be undone.`)) return;
  if (!getToken()) { showToast("Save your GitHub token first.", true); return; }
  showProgress("Clearing all pending candidates…");
  try {
    const f = await ghGet("data/discovery-candidates.json");
    await ghPut("data/discovery-candidates.json", [], f.sha,
      `Clear all ${allCandidates.length} pending candidates`);
    allCandidates = [];
    logProgress(`Cleared all candidates from GitHub.`);
    doneProgress(true);
    render();
    showToast("Queue cleared from GitHub!");
  } catch(e) {
    logProgress(`ERROR: ${e.message}`);
    doneProgress(false);
  }
});

$resetRejected && $resetRejected.addEventListener("click", () => {
  if (!confirm("Clear rejected history? Previously rejected videos will resurface in future discovery runs.")) return;
  showProgress("Clearing rejected history…");
  ghGet("data/rejected-history.json").then(f => {
    return ghPut("data/rejected-history.json", [], f.sha, "🔄 Reset rejected history");
  }).then(() => {
    rejectedHistory = [];
    logProgress("✓ rejected-history.json cleared.");
    doneProgress(true);
    renderStats();
  }).catch(e => {
    logProgress(`❌ ${e.message}`);
    doneProgress(false);
  });
});

$exportBtn && $exportBtn.addEventListener("click", () => {
  const backup = { exportedAt: new Date().toISOString(), pendingCandidates: allCandidates, approvedHistory, rejectedHistory };
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], {type:"application/json"})),
    download: `concert-corner-backup-${new Date().toISOString().slice(0,10)}.json`,
  });
  a.click(); showToast("Backup downloaded.");
});

// ── Load ──────────────────────────────────────────────────────────────────────
async function loadJson(url) {
  try { const r = await fetch(url,{cache:"no-store"}); return r.ok ? r.json() : []; }
  catch { return []; }
}

async function init() {
  updateTokenUI();
  $grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Loading…</div>`;

  const [cands, approved, rejected, eps] = await Promise.all([
    loadJson("./data/discovery-candidates.json"),
    loadJson("./data/approved-history.json"),
    loadJson("./data/rejected-history.json"),
    loadJson("./episodes.json"),
  ]);

  allCandidates   = Array.isArray(cands)    ? cands    : [];
  approvedHistory = Array.isArray(approved) ? approved : [];
  rejectedHistory = Array.isArray(rejected) ? rejected : [];

  // Populate folder dropdown from live episodes.json
  if (Array.isArray(eps)) {
    const folders = eps.filter(s => Array.isArray(s.items)).map(s => s.title);
    actualFolders = folders;
    if (folders.length && $folderSelect) {
      $folderSelect.innerHTML = folders.map(f =>
        `<option value="${f.replace(/"/g,"&quot;")}">${f}</option>`
      ).join("");
      // Default to Live Concerts
      const liveOpt = [...$folderSelect.options].find(o => o.value.toLowerCase().includes("live concert"));
      if (liveOpt) $folderSelect.value = liveOpt.value;
    }
  }

  render();
}

init();

// ── Merge duplicate folders ───────────────────────────────────────────────────
async function mergeDuplicateFolders() {
  if (!getToken()) { showToast("Save your GitHub token first.", true); return; }
  showProgress("Scanning for duplicate folders…");
  try {
    const epFile = await ghGet("episodes.json");
    const episodes = JSON.parse(decodeURIComponent(escape(atob(epFile.content.replace(/\n/g,"")))));
    const rootArray = Array.isArray(episodes) ? episodes : (episodes.items || []);

    function stripEmoji(str) {
      return (str || "").replace(/^[^\w]+/, "").trim().toLowerCase();
    }

    // Group top-level folders by stripped name
    const groups = {};
    for (const item of rootArray) {
      if (!Array.isArray(item.items)) continue;
      const key = stripEmoji(item.title);
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }

    const dupes = Object.entries(groups).filter(([, arr]) => arr.length > 1);

    if (!dupes.length) {
      logProgress("No duplicate folders found — everything is clean!");
      doneProgress(true);
      return;
    }

    let totalMerged = 0;

    for (const [key, folders] of dupes) {
      // Keep the folder with the longer title (has emoji prefix)
      folders.sort((a, b) => b.title.length - a.title.length);
      const keeper = folders[0];
      const dupeList = folders.slice(1);
      logProgress(`\nMerging "${key}" — keeping: "${keeper.title}"`);

      for (const dupe of dupeList) {
        logProgress(`  Absorbing "${dupe.title}" (${dupe.items.length} items)…`);
        for (const item of dupe.items) {
          if (item.mode === "folder" && Array.isArray(item.items)) {
            // Artist sub-folder
            const existing = keeper.items.find(k => k.title === item.title && k.mode === "folder");
            if (existing) {
              const existingUrls = new Set(existing.items.flatMap(s => (s.tracks||[]).map(t => t.url)));
              const newItems = item.items.filter(s => !(s.tracks||[]).some(t => existingUrls.has(t.url)));
              existing.items.push(...newItems);
              logProgress(`    Merged artist "${item.title}": +${newItems.length} shows`);
            } else {
              keeper.items.push(item);
              logProgress(`    Moved artist folder: "${item.title}"`);
            }
          } else {
            const existingUrls = new Set(keeper.items.flatMap(s => (s.tracks||[]).map(t => t.url)));
            const isDupe = (item.tracks||[]).some(t => existingUrls.has(t.url));
            if (!isDupe) { keeper.items.push(item); logProgress(`    Moved: "${item.title}"`); }
            else { logProgress(`    Skipped (dupe): "${item.title}"`); }
          }
          totalMerged++;
        }
        rootArray.splice(rootArray.indexOf(dupe), 1);
        logProgress(`  Removed duplicate "${dupe.title}"`);
      }
    }

    logProgress(`\nMerged ${totalMerged} items across ${dupes.length} group(s)`);
    logProgress("Writing to GitHub…");
    await ghPut("episodes.json", episodes, epFile.sha,
      `Merge duplicate folders: ${dupes.map(([k])=>k).join(", ")}`);
    logProgress("episodes.json updated");

    // Refresh dropdown
    actualFolders = rootArray.filter(i => Array.isArray(i.items)).map(i => i.title);
    if ($folderSelect) {
      $folderSelect.innerHTML = actualFolders.map(f =>
        `<option value="${f.replace(/"/g,"&quot;")}">${f}</option>`).join("");
      const liveOpt = [...$folderSelect.options].find(o => o.value.toLowerCase().includes("live concert"));
      if (liveOpt) $folderSelect.value = liveOpt.value;
    }

    logProgress("Done! Netlify deploys in ~30 seconds.");
    doneProgress(true);
    showToast("Duplicate folders merged!");
  } catch(e) {
    logProgress(`ERROR: ${e.message}`);
    doneProgress(false);
  }
}

// ── Sort Live Concerts artists alphabetically ─────────────────────────────────
async function sortAndFixFolders() {
  if (!getToken()) { showToast("Save your GitHub token first.", true); return; }
  showProgress("Sorting folders alphabetically…");
  try {
    const epFile = await ghGet("episodes.json");
    const episodes = JSON.parse(decodeURIComponent(escape(atob(epFile.content.replace(/\n/g,"")))));
    const rootArray = Array.isArray(episodes) ? episodes : (episodes.items || []);

    function stripEmoji(str) {
      return (str || "").replace(/^[^\w]+/, "").trim().toLowerCase();
    }

    let sortCount = 0;

    for (const section of rootArray) {
      if (!Array.isArray(section.items)) continue;

      // Sort artist sub-folders inside Live Concerts alphabetically
      const hasSubFolders = section.items.some(i => i.mode === "folder" && Array.isArray(i.items));
      if (hasSubFolders) {
        const folders = section.items.filter(i => i.mode === "folder");
        const others  = section.items.filter(i => i.mode !== "folder");
        folders.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
        section.items = [...folders, ...others];
        logProgress(`  Sorted "${section.title}": ${folders.length} artist folders`);
        sortCount++;
      } else {
        // Flat items — sort by title
        section.items.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
        logProgress(`  Sorted "${section.title}": ${section.items.length} items`);
        sortCount++;
      }
    }

    logProgress(`\nSorted ${sortCount} sections`);
    logProgress("Writing to GitHub…");

    await ghPut("episodes.json", episodes, epFile.sha,
      "Sort all folders alphabetically");
    logProgress("Done! Netlify deploys in ~30 seconds.");
    doneProgress(true);
    showToast("All folders sorted alphabetically!");
  } catch(e) {
    logProgress(`ERROR: ${e.message}`);
    doneProgress(false);
  }
}

// ── Remove Artists folder & migrate content to correct homes ──────────────────
async function removeArtistsFolder() {
  if (!getToken()) { showToast("Save your GitHub token first.", true); return; }
  showProgress("Migrating Artists folder content…");
  try {
    const epFile = await ghGet("episodes.json");
    const episodes = JSON.parse(decodeURIComponent(escape(atob(epFile.content.replace(/\n/g,"")))));
    const rootArray = Array.isArray(episodes) ? episodes : (episodes.items || []);

    // Find the folders we need
    const artistsFolder  = rootArray.find(s => s.title === "🎸 Artists" && Array.isArray(s.items));
    const stitchedFolder = rootArray.find(s => s.title && s.title.includes("Stitched") && Array.isArray(s.items));
    const liveFolder     = rootArray.find(s => s.title && s.title.includes("Live Concerts") && s.title.includes("🎤") && Array.isArray(s.items));

    if (!artistsFolder) {
      logProgress("🎸 Artists folder not found — nothing to migrate.");
      doneProgress(true);
      return;
    }

    logProgress(`Found 🎸 Artists with ${artistsFolder.items.length} artist sub-folders`);

    // Build URL sets for de-dupe
    function getUrls(folder) {
      const urls = new Set();
      (folder.items || []).forEach(item => {
        (item.tracks || []).forEach(t => { if (t.url) urls.add(t.url); });
        (item.items || []).forEach(sub => {
          (sub.tracks || []).forEach(t => { if (t.url) urls.add(t.url); });
        });
      });
      return urls;
    }

    const stitchedUrls = stitchedFolder ? getUrls(stitchedFolder) : new Set();
    const liveUrls     = liveFolder     ? getUrls(liveFolder)     : new Set();

    let migratedToStitched = 0;
    let migratedToLive     = 0;
    let skipped            = 0;

    for (const artistFolder of artistsFolder.items) {
      // Each artistFolder has items: fullshow/queue/playlist entries
      for (const show of (artistFolder.items || [])) {
        const showUrls = (show.tracks || []).map(t => t.url).filter(Boolean);
        const isDupeStitched = showUrls.some(u => stitchedUrls.has(u));
        const isDupeLive     = showUrls.some(u => liveUrls.has(u));

        if (isDupeStitched || isDupeLive) {
          logProgress(`  Skip (already exists): ${show.title}`);
          skipped++;
          continue;
        }

        // Acoustic/stripped/queue/fullshow → Stitched Streams
        if (show.mode === "queue" || show.mode === "fullshow") {
          if (stitchedFolder) {
            // Add artist name to show if missing
            if (!show.artist) show.artist = artistFolder.title;
            // Prefix title with artist if not already there
            if (!show.title.toLowerCase().includes(artistFolder.title.toLowerCase())) {
              show.title = `${artistFolder.title} — ${show.title}`;
            }
            stitchedFolder.items.push(show);
            showUrls.forEach(u => stitchedUrls.add(u));
            logProgress(`  → Stitched Streams: ${show.title}`);
            migratedToStitched++;
          }
        }
      }
    }

    // Sort Stitched Streams alphabetically after migration
    if (stitchedFolder) {
      stitchedFolder.items.sort((a, b) => (a.title||"").localeCompare(b.title||""));
    }

    // Remove the Artists folder from root
    rootArray.splice(rootArray.indexOf(artistsFolder), 1);
    logProgress(`\nRemoved 🎸 Artists folder`);
    logProgress(`Migrated: ${migratedToStitched} to Stitched Streams`);
    logProgress(`Skipped (already existed): ${skipped}`);

    logProgress("\nWriting to GitHub…");
    await ghPut("episodes.json", episodes, epFile.sha,
      "Remove Artists folder — migrate acoustic content to Stitched Streams");
    logProgress("Done! Netlify deploys in ~30 seconds.");

    // Refresh dropdown
    actualFolders = rootArray.filter(i => Array.isArray(i.items)).map(i => i.title);
    if ($folderSelect) {
      $folderSelect.innerHTML = actualFolders.map(f =>
        `<option value="${f.replace(/"/g,"&quot;")}">${f}</option>`).join("");
      const liveOpt = [...$folderSelect.options].find(o => o.value.toLowerCase().includes("live concert"));
      if (liveOpt) $folderSelect.value = liveOpt.value;
    }

    doneProgress(true);
    showToast("Artists folder removed — content migrated!");
  } catch(e) {
    logProgress(`ERROR: ${e.message}`);
    doneProgress(false);
  }
}

// ── Restore missing episodes from approved history ────────────────────────────
async function restoreFromHistory() {
  if (!getToken()) { showToast("Save your GitHub token first.", true); return; }
  showProgress("Checking approved history against live episodes.json…");
  try {
    const [epFile, appFile] = await Promise.all([
      ghGet("episodes.json"),
      ghGet("data/approved-history.json"),
    ]);

    const episodes = JSON.parse(decodeURIComponent(escape(atob(epFile.content.replace(/\n/g,"")))));
    const history  = JSON.parse(decodeURIComponent(escape(atob(appFile.content.replace(/\n/g,"")))));
    const rootArray = Array.isArray(episodes) ? episodes : (episodes.items || []);

    // Build set of all videoIds currently in episodes.json
    const existingIds  = new Set();
    const existingUrls = new Set();
    function indexNode(node) {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach(indexNode); return; }
      if (Array.isArray(node.items)) { node.items.forEach(indexNode); return; }
      (node.tracks || []).forEach(t => {
        if (!t?.url) return;
        existingUrls.add(t.url);
        try {
          const u = new URL(t.url);
          const v = u.searchParams.get("v") ||
            (u.hostname.includes("youtu.be") ? u.pathname.replace("/","").trim() : null);
          if (v) existingIds.add(v);
        } catch {}
      });
    }
    indexNode(episodes);
    logProgress(`Currently indexed: ${existingIds.size} videos in episodes.json`);

    // Find missing entries
    const missing = history.filter(h => !existingIds.has(h.videoId) && !existingUrls.has(h.url));
    logProgress(`Found ${missing.length} approved videos missing from episodes.json`);

    if (!missing.length) {
      logProgress("Nothing missing — everything looks good!");
      doneProgress(true);
      return;
    }

    // Re-populate actualFolders from live file
    actualFolders = rootArray.filter(i => Array.isArray(i.items)).map(i => i.title);

    function getOrCreateFolderLocal(name) {
      let fn = rootArray.find(item => Array.isArray(item.items) && item.title === name);
      if (!fn) {
        // Try fuzzy match ignoring emoji
        fn = rootArray.find(item =>
          Array.isArray(item.items) &&
          item.title.replace(/^[^\w]+/,"").trim().toLowerCase() ===
          name.replace(/^[^\w]+/,"").trim().toLowerCase()
        );
      }
      if (!fn) {
        fn = { title: name, mode: "folder", items: [] };
        rootArray.splice(Math.max(0, rootArray.length - 2), 0, fn);
        logProgress(`  Created folder: "${name}"`);
      }
      return fn;
    }

    const today = new Date().toISOString().slice(0,10);
    let restored = 0;

    for (const h of missing) {
      // Determine correct folder using suggestFolder logic
      const destFolder = resolveFolder(
        h.title.toLowerCase().includes("tiny desk") ? "tiny desk" :
        h.title.toLowerCase().includes("unplugged") ? "unplugged" :
        h.title.toLowerCase().includes("acoustic") ? "stitched" :
        "live concert"
      ) || h.targetFolder || resolveFolder("live concert");

      const folder_node = getOrCreateFolderLocal(destFolder);

      const node = {
        title: h.title,
        artist: h.artist || "",
        year: new Date(h.approvedAt).getFullYear(),
        mode: "fullshow",
        added: today,
        tracks: [{ title: h.title, url: h.url }]
      };

      // Live Concerts — wrap in artist sub-folder
      const liveFolder = resolveFolder("live concert");
      if (destFolder === liveFolder) {
        const artistName = h.artist || "Unknown";
        let artistFolder = folder_node.items.find(i => i.mode === "folder" && i.title === artistName);
        if (!artistFolder) {
          artistFolder = { title: artistName, mode: "folder", items: [] };
          folder_node.items.push(artistFolder);
        }
        const { artist, ...nodeClean } = node;
        artistFolder.items.push(nodeClean);
        // Re-sort
        folder_node.items.sort((a,b) => (a.title||"").localeCompare(b.title||""));
      } else {
        folder_node.items.push(node);
      }

      existingIds.add(h.videoId);
      existingUrls.add(h.url);
      logProgress(`  ✅ Restored [${destFolder}]: ${h.title?.slice(0,50)}`);
      restored++;
    }

    logProgress(`\nRestored ${restored} missing videos`);
    logProgress("Writing to GitHub…");

    await ghPut("episodes.json", episodes, epFile.sha,
      `Restore ${restored} missing approved videos from history`);
    logProgress("Done! Netlify deploys in ~30 seconds.");
    doneProgress(true);
    showToast(`Restored ${restored} missing videos!`);

  } catch(e) {
    logProgress(`ERROR: ${e.message}`);
    doneProgress(false);
  }
}
