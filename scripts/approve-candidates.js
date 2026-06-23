#!/usr/bin/env node
/**
 * Concert Corner — approve-candidates.js
 *
 * Called by approve-candidates.yml GitHub Action.
 *
 * Lifecycle:
 *   Approved → added to episodes.json + approved-history.json,
 *              removed from discovery-candidates.json
 *   Rejected → added to rejected-history.json (with reason),
 *              removed from discovery-candidates.json
 *
 * Never suggests the same video again after either action.
 * Never breaks episodes.json structure.
 *
 * Env vars:
 *   VIDEO_IDS      — comma-separated approved videoIds
 *   TARGET_FOLDER  — target folder title in episodes.json
 *   REJECT_IDS     — comma-separated rejected videoIds
 *   REJECT_REASONS — comma-separated reasons matching REJECT_IDS order
 *                    (fan cam | wrong artist | bad quality |
 *                     playlist/compilation | duplicate | too short |
 *                     not a concert | other)
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const ROOT              = path.resolve(__dirname, "..");
const EPISODES_PATH     = path.join(ROOT, "episodes.json");
const CANDIDATES_PATH   = path.join(ROOT, "data", "discovery-candidates.json");
const APPROVED_PATH     = path.join(ROOT, "data", "approved-history.json");
const REJECTED_PATH     = path.join(ROOT, "data", "rejected-history.json");

// ── Helpers ───────────────────────────────────────────────────────────────────
function loadJson(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return data ?? fallback;
  } catch (e) {
    console.warn(`  Warning: could not read ${path.basename(filePath)}: ${e.message}`);
    return fallback;
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// ── Read env vars ─────────────────────────────────────────────────────────────
const approvedIds = (process.env.VIDEO_IDS     || "").split(",").map(s => s.trim()).filter(Boolean);
const targetFolder = (process.env.TARGET_FOLDER || "").trim();
const rejectedIds  = (process.env.REJECT_IDS   || "").split(",").map(s => s.trim()).filter(Boolean);
const rejectReasons = (process.env.REJECT_REASONS || "").split(",").map(s => s.trim());

console.log("🎸 Concert Corner — Approve Candidates");
console.log("========================================");
console.log(`Approved  : ${approvedIds.length ? approvedIds.join(", ") : "(none)"}`);
console.log(`Folder    : ${targetFolder || "(none)"}`);
console.log(`Rejected  : ${rejectedIds.length ? rejectedIds.join(", ") : "(none)"}`);
console.log("");

if (!approvedIds.length && !rejectedIds.length) {
  console.log("Nothing to do.");
  process.exit(0);
}

// ── Load all files ────────────────────────────────────────────────────────────
const episodes        = loadJson(EPISODES_PATH, []);
const candidates      = loadJson(CANDIDATES_PATH, []);
const approvedHistory = loadJson(APPROVED_PATH, []);
const rejectedHistory = loadJson(REJECTED_PATH, []);

// ── Index existing episodes by videoId + URL ──────────────────────────────────
const existingVideoIds = new Set(approvedHistory.map(h => h.videoId));
const existingUrls     = new Set();

function indexEpisodes(node) {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach(indexEpisodes); return; }
  if (Array.isArray(node.items)) { node.items.forEach(indexEpisodes); return; }
  if (Array.isArray(node.tracks)) {
    node.tracks.forEach(t => {
      if (!t || !t.url) return;
      existingUrls.add(t.url);
      try {
        const u = new URL(t.url);
        const v = u.searchParams.get("v") ||
          (u.hostname.includes("youtu.be") ? u.pathname.replace("/","").trim() : null);
        if (v) existingVideoIds.add(v);
      } catch {}
    });
  }
}
indexEpisodes(episodes);

// ── Find or create folder in episodes.json ────────────────────────────────────
function findFolder(node, title) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFolder(item, title);
      if (found) return found;
    }
    return null;
  }
  if ((node.title || "") === title && Array.isArray(node.items)) return node;
  if (Array.isArray(node.items)) {
    for (const item of node.items) {
      const found = findFolder(item, title);
      if (found) return found;
    }
  }
  return null;
}

function cleanThumbUrl(thumb) {
  if (!thumb) return thumb;
  // Strip YouTube tracking params that expire
  if (thumb.includes("sqp=") || thumb.includes("rs=")) {
    try {
      const u = new URL(thumb);
      // Keep only the base URL for YouTube thumbnails
      if (u.hostname.includes("ytimg.com")) {
        u.search = "";
        return u.toString();
      }
    } catch {}
  }
  return thumb;
}

// ── Process approvals ─────────────────────────────────────────────────────────
let added = 0;
let skippedDupe = 0;
const nowIso = new Date().toISOString();
const todayDate = nowIso.slice(0, 10);

if (approvedIds.length) {
  if (!targetFolder) {
    console.error("ERROR: VIDEO_IDS provided but TARGET_FOLDER is empty.");
    process.exit(1);
  }

  let folder = findFolder(Array.isArray(episodes) ? episodes : [episodes], targetFolder);

  if (!folder) {
    console.log(`Folder "${targetFolder}" not found — creating it.`);
    const newFolder = { title: targetFolder, mode: "folder", items: [] };
    if (Array.isArray(episodes)) {
      // Insert before the last 2 items (Monster Jam / Drag Racing)
      const insertAt = Math.max(0, episodes.length - 2);
      episodes.splice(insertAt, 0, newFolder);
    }
    folder = newFolder;
  }

  for (const videoId of approvedIds) {
    const candidate = candidates.find(c => c.videoId === videoId);
    if (!candidate) {
      console.log(`  ⚠ ${videoId} — not in candidates, skipping`);
      skippedDupe++;
      continue;
    }

    if (existingVideoIds.has(videoId)) {
      console.log(`  ⚠ ${videoId} — already in episodes/history, skipping`);
      skippedDupe++;
      continue;
    }

    const trackUrl = candidate.url || `https://www.youtube.com/watch?v=${videoId}`;
    if (existingUrls.has(trackUrl)) {
      console.log(`  ⚠ ${videoId} — URL already exists, skipping`);
      skippedDupe++;
      continue;
    }

    // Build episode node
    let node = candidate.suggestedEpisodesJson
      ? JSON.parse(JSON.stringify(candidate.suggestedEpisodesJson))
      : {
          title: candidate.title || `Video ${videoId}`,
          artist: candidate.artistMatched || "",
          year: new Date().getFullYear(),
          mode: "fullshow",
          tracks: [{ title: candidate.title || "Full Show", url: trackUrl }]
        };

    node.added = todayDate;
    if (node.thumb) node.thumb = cleanThumbUrl(node.thumb);

    // Live Concerts: wrap in artist sub-folder
    if (targetFolder === "Live Concerts") {
      const artistName = node.artist || candidate.artistMatched || "Unknown";
      let artistFolder = folder.items.find(i => i.mode === "folder" && i.title === artistName);
      if (!artistFolder) {
        artistFolder = { title: artistName, mode: "folder", items: [] };
        folder.items.push(artistFolder);
      }
      const { artist, ...nodeClean } = node;
      artistFolder.items.push(nodeClean);
      console.log(`  ✅ ${videoId} → ${targetFolder} / ${artistName} / "${node.title}"`);
    } else {
      folder.items.push(node);
      console.log(`  ✅ ${videoId} → ${targetFolder} / "${node.title}"`);
    }

    existingVideoIds.add(videoId);
    existingUrls.add(trackUrl);

    // Add to approved history
    approvedHistory.unshift({
      videoId,
      title: candidate.title || node.title,
      artist: candidate.artistMatched || node.artist || "",
      targetFolder,
      approvedAt: nowIso,
      url: trackUrl,
    });

    added++;
  }
}

// ── Process rejections ────────────────────────────────────────────────────────
let rejected = 0;

for (let i = 0; i < rejectedIds.length; i++) {
  const videoId = rejectedIds[i];
  const reason  = rejectReasons[i] || "other";
  const candidate = candidates.find(c => c.videoId === videoId);

  // Add to rejected history even if not in candidates (safety net)
  const alreadyRejected = rejectedHistory.some(h => h.videoId === videoId);
  if (!alreadyRejected) {
    rejectedHistory.unshift({
      videoId,
      title: candidate?.title || "",
      artist: candidate?.artistMatched || "",
      channelName: candidate?.channelName || "",
      reason,
      rejectedAt: nowIso,
      url: candidate?.url || `https://www.youtube.com/watch?v=${videoId}`,
    });
    console.log(`  🗑 ${videoId} — rejected (${reason}): ${candidate?.title || ""}`);
    rejected++;
  } else {
    console.log(`  (already in rejected history: ${videoId})`);
  }
}

// ── Remove processed IDs from candidates ──────────────────────────────────────
const processedIds = new Set([...approvedIds, ...rejectedIds]);
const remainingCandidates = candidates.filter(c => !processedIds.has(c.videoId));

// ── Save all files ────────────────────────────────────────────────────────────
console.log("");
saveJson(EPISODES_PATH,   episodes);
saveJson(CANDIDATES_PATH, remainingCandidates);
saveJson(APPROVED_PATH,   approvedHistory);
saveJson(REJECTED_PATH,   rejectedHistory);

console.log(`✅ episodes.json          — ${fs.statSync(EPISODES_PATH).size.toLocaleString()} bytes`);
console.log(`✅ discovery-candidates   — ${remainingCandidates.length} remaining`);
console.log(`✅ approved-history       — ${approvedHistory.length} total`);
console.log(`✅ rejected-history       — ${rejectedHistory.length} total`);
console.log("");
console.log(`Added: ${added} | Rejected: ${rejected} | Skipped (dupe): ${skippedDupe}`);
