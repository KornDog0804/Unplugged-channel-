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

// ── Safe JSON helpers ────────────────────────────────────────────────────────
function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to read JSON: ${filePath}`);
    console.error(e.message);
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

// ── Load config ───────────────────────────────────────────────────────────────
const config = readJson(WATCHLIST_PATH, {});

const tier_1_core = Array.isArray(config.tier_1_core) ? config.tier_1_core : [];
const tier_2_adjacent = Array.isArray(config.tier_2_adjacent) ? config.tier_2_adjacent : [];
const tier_3_watchlist = Array.isArray(config.tier_3_watchlist) ? config.tier_3_watchlist : [];

const searchTerms = Array.isArray(config.searchTerms)
  ? config.searchTerms
  : [
      "full concert",
      "full show",
      "full set",
      "live pro shot",
      "acoustic session",
      "unplugged",
      "tiny desk",
      "official live",
      "festival live"
    ];

const blockedTerms = Array.isArray(config.blockedTerms)
  ? config.blockedTerms
  : [
      "reaction",
      "cover",
      "karaoke",
      "lyrics",
      "shorts",
      "#shorts",
      "interview only",
      "drum cover",
      "guitar cover",
      "vocal cover"
    ];

const blockedChannelKeywords = Array.isArray(config.blockedChannelKeywords)
  ? config.blockedChannelKeywords
  : [
      "reaction",
      "karaoke",
      "lyrics",
      "cover",
      "topic"
    ];

const minDurationMinutes = Number.isFinite(Number(config.minDurationMinutes))
  ? Number(config.minDurationMinutes)
  : 20;

const maxResultsPerSearch = Number.isFinite(Number(config.maxResultsPerSearch))
  ? Number(config.maxResultsPerSearch)
  : 5;

if (!tier_1_core.length && !tier_2_adjacent.length && !tier_3_watchlist.length) {
  console.error("No artists found in data/artist-watchlist.json.");
  console.error("Expected arrays: tier_1_core, tier_2_adjacent, tier_3_watchlist.");
  process.exit(1);
}

// Tier system:
// Tier 1 runs every time.
// Tier 2 runs every other day.
// Tier 3 runs on Mondays only.
// This keeps the most important artists getting the most coverage.
const now = new Date();
const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon

const artistsThisRun = [
  ...tier_1_core,
  ...(dayOfYear % 2 === 0 ? tier_2_adjacent : []),
  ...(dayOfWeek === 1 ? tier_3_watchlist : [])
];

console.log(`Tier 1: ${tier_1_core.length} artists (always)`);
console.log(
  `Tier 2: ${
    dayOfYear % 2 === 0
      ? `${tier_2_adjacent.length} artists (even day)`
      : "skipped (odd day)"
  }`
);
console.log(
  `Tier 3: ${
    dayOfWeek === 1
      ? `${tier_3_watchlist.length} artists (Monday)`
      : "skipped (not Monday)"
  }`
);
console.log(`Total this run: ${artistsThisRun.length} artists\n`);

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function fetchUrl(url, redirectsLeft = 5) {
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
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          const nextUrl = new URL(res.headers.location, url).toString();
          res.resume();
          fetchUrl(nextUrl, redirectsLeft - 1).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
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
 * Extract the ytInitialData JSON blob YouTube embeds in search pages.
 */
function extractInitialData(html) {
  const markers = [
    "var ytInitialData = ",
    "window[\"ytInitialData\"] = "
  ];

  let jsonStart = -1;

  for (const marker of markers) {
    const start = html.indexOf(marker);
    if (start !== -1) {
      jsonStart = start + marker.length;
      break;
    }
  }

  if (jsonStart === -1) return null;

  while (html[jsonStart] && html[jsonStart] !== "{") {
    jsonStart++;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, i + 1));
        } catch (e) {
          console.error("Failed parsing ytInitialData:", e.message);
          return null;
        }
      }
    }
  }

  return null;
}

/**
 * Walk nested ytInitialData and pull out video results.
 */
function parseSearchResults(data) {
  const results = [];

  const contents =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents || [];

  for (const section of contents) {
    const items = section?.itemSectionRenderer?.contents || [];

    for (const item of items) {
      const vr = item?.videoRenderer;
      if (!vr || !vr.videoId) continue;

      const title =
        vr.title?.runs?.map((r) => r.text).join("") ||
        vr.title?.simpleText ||
        "";

      const channelName =
        vr.ownerText?.runs?.map((r) => r.text).join("") ||
        vr.longBylineText?.runs?.map((r) => r.text).join("") ||
        "";

      const durationText =
        vr.lengthText?.simpleText ||
        vr.lengthText?.runs?.map((r) => r.text).join("") ||
        "";

      const publishedText = vr.publishedTimeText?.simpleText || "";
      const viewCountText = vr.viewCountText?.simpleText || "";

      const thumbnail =
        vr.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
        `https://img.youtube.com/vi/${vr.videoId}/hqdefault.jpg`;

      results.push({
        videoId: vr.videoId,
        title,
        channelName,
        durationText,
        publishedText,
        viewCountText,
        thumbnail
      });
    }
  }

  return results;
}

/**
 * Parse YouTube duration string like "1:42:18" or "45:32" to total minutes.
 */
function parseDurationMinutes(text) {
  if (!text || typeof text !== "string") return 0;

  const parts = text
    .split(":")
    .map((part) => Number(part))
    .filter((n) => Number.isFinite(n));

  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  if (parts.length === 1) return parts[0] / 60;

  return 0;
}

function titleHasBlockedTerm(titleLower) {
  return blockedTerms.find((term) => titleLower.includes(normalizeText(term)));
}

function channelHasBlockedKeyword(channelLower) {
  return blockedChannelKeywords.find((kw) =>
    channelLower.includes(normalizeText(kw))
  );
}

/**
 * Returns true if this result passes all quality filters.
 */
function passesFilters(result, artist) {
  const titleLower = normalizeText(result.title);
  const channelLower = normalizeText(result.channelName);
  const artistLower = normalizeText(artist);

  const artistWords = artistLower.split(/\s+/).filter(Boolean);
  const firstArtistWord = artistWords[0] || artistLower;

  const artistInTitle =
    titleLower.includes(artistLower) ||
    artistWords.every((word) => titleLower.includes(word));

  const artistInChannel =
    channelLower.includes(artistLower) ||
    channelLower.includes(firstArtistWord);

  if (!artistInTitle && !artistInChannel) return false;

  const blockedTerm = titleHasBlockedTerm(titleLower);
  if (blockedTerm) {
    console.log(`    ✗ blocked term "${blockedTerm}": ${result.title}`);
    return false;
  }

  const blockedChannel = channelHasBlockedKeyword(channelLower);
  if (blockedChannel) {
    console.log(
      `    ✗ blocked channel keyword "${blockedChannel}": ${result.channelName}`
    );
    return false;
  }

  if (channelLower.endsWith("- topic") || channelLower === "auto-generated") {
    console.log(`    ✗ Topic/auto channel: ${result.channelName}`);
    return false;
  }

  const mins = parseDurationMinutes(result.durationText);
  if (result.durationText && mins > 0 && mins < minDurationMinutes) {
    console.log(`    ✗ too short (${result.durationText}): ${result.title}`);
    return false;
  }

  const performanceKeywords = [
    "full concert",
    "full show",
    "full set",
    "live at",
    "live in",
    "live from",
    "unplugged",
    "acoustic",
    "tiny desk",
    "pro-shot",
    "pro shot",
    "official live",
    "festival",
    "full performance",
    "full session",
    "concert film",
    "live concert",
    "live performance",
    "session"
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
    console.error(
      "  Could not extract ytInitialData. YouTube may have changed or blocked the page."
    );
    return [];
  }

  const raw = parseSearchResults(data);
  console.log(`  Found ${raw.length} raw results`);

  const passed = [];

  for (const result of raw.slice(0, maxResultsPerSearch)) {
    if (passesFilters(result, artist)) {
      const minutes = parseDurationMinutes(result.durationText);

      passed.push({
        videoId: result.videoId,
        title: result.title,
        channelName: result.channelName,
        url: `https://www.youtube.com/watch?v=${result.videoId}`,
        duration: result.durationText,
        durationMinutes: minutes,
        publishedText: result.publishedText,
        viewCountText: result.viewCountText,
        thumbnail: result.thumbnail,
        artistMatched: artist,
        searchTerm,
        discoveredAt: new Date().toISOString(),

        suggestedMode: "fullshow",
        suggestedTitle: result.title,
        suggestedArtist: artist,
        suggestedEpisodesJson: {
          title: result.title,
          artist,
          mode: "fullshow",
          thumb: result.thumbnail,
          added: new Date().toISOString().slice(0, 10),
          tracks: [
            {
              title: result.title,
              url: `https://www.youtube.com/watch?v=${result.videoId}`
            }
          ]
        }
      });

      console.log(`    ✓ CANDIDATE: ${result.title} (${result.durationText || "unknown duration"})`);
    }
  }

  return passed;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🎸 Joey's Concert Corner — Discovery Bot");
  console.log("==========================================");
  console.log(
    `Artists this run: ${artistsThisRun.length} | Search terms: ${searchTerms.length}`
  );
  console.log("SAFE MODE: episodes.json will NOT be touched.\n");

  let existing = readJson(CANDIDATES_PATH, []);
  if (!Array.isArray(existing)) existing = [];

  console.log(`Loaded ${existing.length} existing candidates for de-dupe.\n`);

  const existingIds = new Set(
    existing
      .map((candidate) => candidate && candidate.videoId)
      .filter(Boolean)
  );

  const newCandidates = [];
  const shuffledArtists = [...artistsThisRun].sort(() => Math.random() - 0.5);

  for (const artist of shuffledArtists) {
    console.log(`\n🎤 ${artist}`);

    for (const term of searchTerms) {
      const query = `${artist} ${term}`;
      const results = await searchYouTube(query, artist, term);

      for (const result of results) {
        if (!existingIds.has(result.videoId)) {
          existingIds.add(result.videoId);
          newCandidates.push(result);
        } else {
          console.log(`    (already in candidates: ${result.videoId})`);
        }
      }

      await sleep(1800 + Math.random() * 1200);
    }

    await sleep(3000 + Math.random() * 2000);
  }

  const merged = [...newCandidates, ...existing];
  writeJson(CANDIDATES_PATH, merged);

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
