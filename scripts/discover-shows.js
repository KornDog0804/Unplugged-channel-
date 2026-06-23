#!/usr/bin/env node
/**
 * Joey's Concert Corner — Discovery Bot
 * Searches YouTube for new concerts/sessions matching your artists.
 * NO API KEY REQUIRED — uses YouTube's search page directly.
 *
 * SAFE BY DESIGN:
 *   - Never reads or writes episodes.json
 *   - Only writes to data/discovery-candidates.json
 *   - Joey reviews candidates manually before anything gets added
 *
 * Run: node scripts/discover-shows.js
 */

"use strict";

const https = require("https");
const fs = require("fs");
const path = require("path");

// ── Paths ────────────────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, "..");
const WATCHLIST_PATH = path.join(ROOT, "data", "artist-watchlist.json");
const CANDIDATES_PATH = path.join(ROOT, "data", "discovery-candidates.json");

// ── Load config ───────────────────────────────────────────────────────────────
const config = JSON.parse(fs.readFileSync(WATCHLIST_PATH, "utf8"));

const {
  tier_1_core,
  tier_2_adjacent,
  tier_3_watchlist,
  searchTerms,
  blockedTerms,
  blockedChannelKeywords,
  minDurationMinutes,
  maxResultsPerSearch,
} = config;

// Tier system: Tier 1 runs every time.
// Tier 2 runs every other run (even day-of-year).
// Tier 3 runs on Mondays only (day 1 of week).
// This keeps the most important artists getting the most coverage.
const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon

const artistsThisRun = [
  ...tier_1_core,
  ...(dayOfYear % 2 === 0 ? tier_2_adjacent : []),
  ...(dayOfWeek === 1 ? tier_3_watchlist : []),
];

console.log(`Tier 1: ${tier_1_core.length} artists (always)`);
console.log(`Tier 2: ${dayOfYear % 2 === 0 ? tier_2_adjacent.length + " artists (even day)" : "skipped (odd day)"}`);
console.log(`Tier 3: ${dayOfWeek === 1 ? tier_3_watchlist.length + " artists (Monday)" : "skipped (not Monday)"}`);
console.log(`Total this run: ${artistsThisRun.length} artists\n`);

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchUrl(res.headers.location).then(resolve).catch(reject);
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

/**
 * Extract the ytInitialData JSON blob YouTube embeds in every search page.
 * This is the same data the page JS uses to render results — no API needed.
 */
function extractInitialData(html) {
  const marker = "var ytInitialData = ";
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const jsonStart = start + marker.length;
  // Find the end of the JSON object (balanced braces)
  let depth = 0;
  let i = jsonStart;
  while (i < html.length) {
    const ch = html[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }
  try {
    return JSON.parse(html.slice(jsonStart, i + 1));
  } catch {
    return null;
  }
}

/**
 * Walk the deeply nested ytInitialData structure and pull out video results.
 * Returns array of { videoId, title, channelName, durationText, publishedText }
 */
function parseSearchResults(data) {
  const results = [];
  try {
    const contents =
      data?.contents?.twoColumnSearchResultsRenderer
        ?.primaryContents?.sectionListRenderer?.contents ?? [];

    for (const section of contents) {
      const items =
        section?.itemSectionRenderer?.contents ?? [];
      for (const item of items) {
        const vr = item?.videoRenderer;
        if (!vr) continue;

        const videoId = vr.videoId;
        if (!videoId) continue;

        const title =
          vr.title?.runs?.map((r) => r.text).join("") ?? "";
        const channelName =
          vr.ownerText?.runs?.map((r) => r.text).join("") ??
          vr.longBylineText?.runs?.map((r) => r.text).join("") ?? "";
        const durationText =
          vr.lengthText?.simpleText ?? vr.lengthText?.runs?.map((r) => r.text).join("") ?? "";
        const publishedText =
          vr.publishedTimeText?.simpleText ?? "";
        const viewCountText =
          vr.viewCountText?.simpleText ?? "";

        results.push({ videoId, title, channelName, durationText, publishedText, viewCountText });
      }
    }
  } catch (e) {
    console.error("  parse error:", e.message);
  }
  return results;
}

/**
 * Parse YouTube duration string like "1:42:18" or "45:32" → total minutes.
 */
function parseDurationMinutes(text) {
  if (!text) return 0;
  const parts = text.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  return 0;
}

/**
 * Returns true if this result passes ALL quality filters.
 * This is the gatekeeper — if it fails here it never reaches the candidates file.
 */
function passesFilters(result, artist, searchTerm) {
  const titleLower = (result.title || "").toLowerCase();
  const channelLower = (result.channelName || "").toLowerCase();

  // 1. Must contain the artist name (case-insensitive) in title OR channel
  const artistLower = artist.toLowerCase();
  const artistInTitle = titleLower.includes(artistLower);
  const artistInChannel = channelLower.includes(artistLower.split(" ")[0].toLowerCase());
  if (!artistInTitle && !artistInChannel) return false;

  // 2. Blocked terms in title — instant reject
  for (const term of blockedTerms) {
    if (titleLower.includes(term.toLowerCase())) {
      console.log(`    ✗ blocked term "${term}": ${result.title}`);
      return false;
    }
  }

  // 3. Blocked channel keywords — reject audio-only / reaction channels
  for (const kw of blockedChannelKeywords) {
    if (channelLower.includes(kw.toLowerCase())) {
      console.log(`    ✗ blocked channel keyword "${kw}": ${result.channelName}`);
      return false;
    }
  }

  // 4. YouTube "Topic" auto-generated channels = audio only, never video
  if (channelLower.endsWith("- topic") || channelLower === "auto-generated") {
    console.log(`    ✗ Topic/auto channel: ${result.channelName}`);
    return false;
  }

  // 5. Duration check — must be at least minDurationMinutes
  const mins = parseDurationMinutes(result.durationText);
  if (result.durationText && mins < minDurationMinutes) {
    console.log(`    ✗ too short (${result.durationText}): ${result.title}`);
    return false;
  }

  // 6. Must have some signal of being a real performance
  const performanceKeywords = [
    "full concert", "full show", "full set", "live at", "live in",
    "live from", "unplugged", "acoustic", "tiny desk", "pro-shot",
    "pro shot", "official live", "festival", "full performance",
    "full session", "concert film", "live concert"
  ];
  const hasPerformanceSignal = performanceKeywords.some((kw) =>
    titleLower.includes(kw)
  );
  if (!hasPerformanceSignal) {
    console.log(`    ✗ no performance signal: ${result.title}`);
    return false;
  }

  return true;
}

/**
 * Search YouTube for one query string, return filtered candidates.
 */
async function searchYouTube(query, artist, searchTerm) {
  const encoded = encodeURIComponent(query);
  // sp=EgIQAQ%3D%3D filters to videos only (not playlists/channels)
  const url = `https://www.youtube.com/results?search_query=${encoded}&sp=EgIQAQ%3D%3D`;

  console.log(`  Searching: "${query}"`);

  let html;
  try {
    html = await fetchUrl(url);
  } catch (e) {
    console.error(`  Fetch error: ${e.message}`);
    return [];
  }

  const data = extractInitialData(html);
  if (!data) {
    console.error("  Could not extract ytInitialData — YouTube may have blocked this request");
    return [];
  }

  const raw = parseSearchResults(data);
  console.log(`  Found ${raw.length} raw results`);

  const passed = [];
  for (const r of raw.slice(0, maxResultsPerSearch)) {
    if (passesFilters(r, artist, searchTerm)) {
      passed.push({
        videoId: r.videoId,
        title: r.title,
        channelName: r.channelName,
        url: `https://www.youtube.com/watch?v=${r.videoId}`,
        duration: r.durationText,
        publishedText: r.publishedText,
        artistMatched: artist,
        searchTerm: searchTerm,
        discoveredAt: new Date().toISOString(),
        // Suggested episodes.json fields — Joey edits these before adding
        suggestedMode: r.durationText && parseDurationMinutes(r.durationText) >= 30
          ? "fullshow"
          : "fullshow",
        suggestedTitle: r.title,
        suggestedArtist: artist,
      });
      console.log(`    ✓ CANDIDATE: ${r.title} (${r.durationText})`);
    }
  }

  return passed;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🎸 Joey's Concert Corner — Discovery Bot");
  console.log("==========================================");
  console.log(`Artists: ${coreArtists.length} | Search terms: ${searchTerms.length}`);
  console.log("SAFE MODE: episodes.json will NOT be touched.\n");

  // ── Lifecycle de-dupe: check candidates + approved + rejected + episodes ──
  // A videoId that appears in ANY of these is permanently skipped.

  function loadJsonArray(filePath) {
    try {
      if (!fs.existsSync(filePath)) return [];
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }

  const existingCandidates = loadJsonArray(CANDIDATES_PATH);
  const approvedHistory    = loadJsonArray(path.join(ROOT, "data", "approved-history.json"));
  const rejectedHistory    = loadJsonArray(path.join(ROOT, "data", "rejected-history.json"));

  // Extract all videoIds already in episodes.json
  const episodesRaw = loadJsonArray(path.join(ROOT, "episodes.json"));
  const episodeVideoIds = new Set();
  function indexEpisodeIds(node) {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(indexEpisodeIds); return; }
    if (Array.isArray(node.items)) { node.items.forEach(indexEpisodeIds); return; }
    if (Array.isArray(node.tracks)) {
      node.tracks.forEach(t => {
        if (!t || !t.url) return;
        try {
          const u = new URL(t.url);
          const v = u.searchParams.get("v") ||
            (u.hostname.includes("youtu.be") ? u.pathname.replace("/","").trim() : null);
          if (v) episodeVideoIds.add(v);
        } catch {}
      });
    }
  }
  indexEpisodeIds(episodesRaw);

  const seenIds = new Set([
    ...existingCandidates.map(c => c.videoId),
    ...approvedHistory.map(h => h.videoId || h),
    ...rejectedHistory.map(h => h.videoId || h),
    ...episodeVideoIds,
  ]);

  console.log(`De-dupe pool: ${existingCandidates.length} pending | ${approvedHistory.length} approved | ${rejectedHistory.length} rejected | ${episodeVideoIds.size} in episodes`);
  console.log(`Total blocked IDs: ${seenIds.size}\n`);

  const newCandidates = [];

  // Run searches: each artist × each search term
  // We shuffle artists so each run covers a different spread
  const shuffledArtists = [...artistsThisRun].sort(() => Math.random() - 0.5);

  for (const artist of shuffledArtists) {
    console.log(`\n🎤 ${artist}`);

    for (const term of searchTerms) {
      const query = `${artist} ${term}`;
      const results = await searchYouTube(query, artist, term);

      for (const r of results) {
        if (!seenIds.has(r.videoId)) {
          seenIds.add(r.videoId);
          newCandidates.push(r);
        } else {
          console.log(`    (already seen: ${r.videoId})`);
        }
      }

      // Polite delay between requests — avoid hammering YouTube
      await sleep(1800 + Math.random() * 1200);
    }

    // Slightly longer pause between artists
    await sleep(3000 + Math.random() * 2000);
  }

  // Merge new with existing candidates, newest first
  const merged = [...newCandidates, ...existingCandidates];

  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(merged, null, 2), "utf8");

  console.log("\n==========================================");
  console.log(`✅ Done. ${newCandidates.length} new candidates found.`);
  console.log(`📄 Total in discovery-candidates.json: ${merged.length}`);
  console.log("\nNEXT STEP: Review data/discovery-candidates.json manually.");
  console.log("Copy anything you like into episodes.json yourself.");
  console.log("The bot will NEVER touch episodes.json.");
}

main().catch((e) => {
  console.error("Bot crashed:", e);
  process.exit(1);
});
