#!/usr/bin/env node
/**
 * Concert Corner — Discogs Collection Sync
 * Pulls artists from korndog0804's public Discogs collection
 * and adds new ones to artist-watchlist.json tier_1_core.
 *
 * Run: node scripts/sync-discogs.js
 * No API key needed — uses public collection endpoint.
 */

"use strict";

const https = require("https");
const fs    = require("fs");
const path  = require("path");

const ROOT           = path.resolve(__dirname, "..");
const WATCHLIST_PATH = path.join(ROOT, "data", "artist-watchlist.json");
const DISCOGS_USER   = "korndog0804";

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "ConcertCornerBot/1.0 +https://github.com/KornDog0804/Unplugged-channel-",
        "Accept": "application/json",
      }
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch(e) { reject(e); }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Artists to skip — compilations, soundtracks, non-concert content
const SKIP_ARTISTS = new Set([
  "various artists", "various", "soundtrack", "original soundtrack",
  "ost", "cast recording", "now that's what i call music",
  "country classics", "now 90s r&b", "trolls", "disney",
]);

// Clean up artist name — remove "The " prefix for sorting, fix common issues
function normalizeArtist(name) {
  return (name || "")
    .replace(/^the\s+/i, "The ")
    .replace(/,\s*the$/i, "")
    .trim();
}

async function main() {
  console.log("🎸 Discogs Collection Sync");
  console.log("==========================");
  console.log(`User: ${DISCOGS_USER}\n`);

  // Load current watchlist
  const watchlist = JSON.parse(fs.readFileSync(WATCHLIST_PATH, "utf8"));
  const allKnown = new Set([
    ...(watchlist._tier_1_core_full || watchlist.tier_1_core || []).map(a => a.toLowerCase()),
    ...(watchlist._tier_2_adjacent_full || watchlist.tier_2_adjacent || []).map(a => a.toLowerCase()),
    ...(watchlist._tier_3_watchlist_full || watchlist.tier_3_watchlist || []).map(a => a.toLowerCase()),
  ]);

  console.log(`Known artists in watchlist: ${allKnown.size}`);

  // Fetch all pages of collection
  let page = 1;
  let totalPages = 1;
  const artistCounts = {}; // artist name → number of releases owned

  do {
    const url = `https://api.discogs.com/users/${DISCOGS_USER}/collection/folders/0/releases?per_page=100&page=${page}&sort=artist`;
    console.log(`Fetching page ${page}/${totalPages}…`);

    let data;
    try {
      data = await fetchJson(url);
    } catch(e) {
      console.error(`  Error fetching page ${page}: ${e.message}`);
      break;
    }

    totalPages = data.pagination?.pages || 1;

    for (const release of (data.releases || [])) {
      const artists = release.basic_information?.artists || [];
      for (const artist of artists) {
        const name = normalizeArtist(artist.name);
        if (!name || SKIP_ARTISTS.has(name.toLowerCase())) continue;
        if (name.toLowerCase().includes("various")) continue;
        artistCounts[name] = (artistCounts[name] || 0) + 1;
      }
    }

    page++;
    await sleep(1200); // Discogs rate limit: 60 req/min

  } while (page <= totalPages);

  console.log(`\nFound ${Object.keys(artistCounts).length} unique artists in collection`);

  // Sort by number of releases owned (most-collected first)
  const sorted = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1]);

  console.log("\nTop 30 artists by release count:");
  sorted.slice(0, 30).forEach(([name, count]) => {
    const known = allKnown.has(name.toLowerCase()) ? " ✓" : " NEW";
    console.log(`  ${count}x ${name}${known}`);
  });

  // Find artists NOT in watchlist
  const newArtists = sorted
    .filter(([name]) => !allKnown.has(name.toLowerCase()))
    .map(([name, count]) => ({ name, count }));

  console.log(`\nNew artists to consider adding (${newArtists.length}):`);
  newArtists.forEach(({ name, count }) => {
    console.log(`  ${count}x ${name}`);
  });

  if (!newArtists.length) {
    console.log("All collection artists already in watchlist!");
    return;
  }

  // Auto-add artists with 2+ releases to tier_1_core
  // Artists with 1 release go to tier_3_watchlist
  const autoAdd1  = newArtists.filter(a => a.count >= 2).map(a => a.name);
  const autoAdd3  = newArtists.filter(a => a.count === 1).map(a => a.name);

  console.log(`\nAuto-adding to Tier 1 (2+ releases): ${autoAdd1.join(", ") || "none"}`);
  console.log(`Auto-adding to Tier 3 (1 release):  ${autoAdd3.join(", ") || "none"}`);

  // Update watchlist
  const t1Full = watchlist._tier_1_core_full || watchlist.tier_1_core || [];
  const t3Full = watchlist._tier_3_watchlist_full || watchlist.tier_3_watchlist || [];

  let added = 0;
  for (const name of autoAdd1) {
    if (!t1Full.map(a => a.toLowerCase()).includes(name.toLowerCase())) {
      t1Full.push(name);
      added++;
    }
  }
  for (const name of autoAdd3) {
    if (!t3Full.map(a => a.toLowerCase()).includes(name.toLowerCase())) {
      t3Full.push(name);
      added++;
    }
  }

  watchlist._tier_1_core_full = t1Full.sort();
  watchlist._tier_3_watchlist_full = t3Full.sort();

  // Also update the active tier arrays
  // (rotation fix: no longer overwriting tier_1_core here, see sync-discogs.js history)
  // (rotation fix: no longer overwriting tier_3_watchlist here, see sync-discogs.js history)

  fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(watchlist, null, 2), "utf8");
  console.log(`\n✅ Added ${added} new artists to watchlist`);
  console.log("Run the discovery bot next to find concerts for your new artists.");
}

main().catch(e => {
  console.error("Sync crashed:", e);
  process.exit(1);
});
