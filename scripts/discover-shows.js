#!/usr/bin/env node
/**
 * Joey's Concert Corner — Discovery Bot v2 (Smart Edition)
 *
 * WHAT'S NEW vs v1:
 * 1. Similarity graph — searches similar artists based on genre relationships
 * 2. Co-occurrence detection — finds new artists mentioned alongside known ones
 * 3. Channel tracking — identifies trusted concert upload channels over time
 * 4. New artist suggestions — flagged separately in candidates with type:"new_artist_suggestion"
 *
 * SAFE BY DESIGN: Never touches episodes.json. Only writes candidates file.
 */

"use strict";

const https = require("https");
const fs    = require("fs");
const path  = require("path");

// ── Paths ─────────────────────────────────────────────────────────────────────
const ROOT            = path.resolve(__dirname, "..");
const WATCHLIST_PATH  = path.join(ROOT, "data", "artist-watchlist.json");
const CANDIDATES_PATH = path.join(ROOT, "data", "discovery-candidates.json");
const CHANNELS_PATH   = path.join(ROOT, "data", "trusted-channels.json");

// ── Config ────────────────────────────────────────────────────────────────────
const config = JSON.parse(fs.readFileSync(WATCHLIST_PATH, "utf8"));
const {
  tier_1_core,
  tier_2_adjacent,
  tier_3_watchlist,
  searchTerms,
  blockedTerms,
  blockedChannelKeywords,
  trustedChannelKeywords,
  minDurationMinutes,
  maxResultsPerSearch,
} = config;

const artistsThisRun = [
  ...(tier_1_core     || []),
  ...(tier_2_adjacent || []),
  ...(tier_3_watchlist|| []),
];

console.log(`Tier 1: ${(tier_1_core||[]).length} artists (always)`);
console.log(`Tier 2: ${(tier_2_adjacent||[]).length > 0 ? (tier_2_adjacent||[]).length + " artists" : "skipped"}`);
console.log(`Tier 3: ${(tier_3_watchlist||[]).length > 0 ? (tier_3_watchlist||[]).length + " artists" : "skipped (not Monday)"}`);
console.log(`Total this run: ${artistsThisRun.length} artists\n`);

// ── Artist similarity map ─────────────────────────────────────────────────────
const SIMILARITY_MAP = {
  "Sleep Token":         ["Spiritbox","Bad Omens","Architects","Northlane","Holding Absence"],
  "Dance Gavin Dance":   ["Eidola","Hail the Sun","Sianvar","Crown the Empire","Strawberry Girls"],
  "Bad Omens":           ["Sleep Token","Spiritbox","Dayseeker","Thornhill","Holding Absence"],
  "Spiritbox":           ["Sleep Token","Jinjer","Bad Omens","Veil of Maya","Fit For an Autopsy"],
  "Architects":          ["Spiritbox","Polaris","While She Sleeps","Northlane","Parkway Drive"],
  "Dayseeker":           ["Holding Absence","Thornhill","Bad Omens","Movements","Senses Fail"],
  "Polaris":             ["Architects","Northlane","Parkway Drive","Alpha Wolf","Thy Art Is Murder"],
  "Wage War":            ["Currents","Knocked Loose","Boundaries","Spite","Gideon"],
  "Jinjer":              ["Spiritbox","Arch Enemy","Lacuna Coil","Butcher Babies","Infected Rain"],
  "Korn":                ["Deftones","Slipknot","Limp Bizkit","System Of A Down","Mudvayne"],
  "Deftones":            ["Korn","Tool","A Perfect Circle","Incubus","Chevelle"],
  "Slipknot":            ["Korn","Disturbed","Five Finger Death Punch","Lamb Of God","Hatebreed"],
  "Disturbed":           ["Breaking Benjamin","Three Days Grace","Shinedown","Godsmack","Sevendust"],
  "Linkin Park":         ["Breaking Benjamin","Three Days Grace","Staind","Papa Roach","Skillet"],
  "Papa Roach":          ["Linkin Park","Breaking Benjamin","Shinedown","Three Days Grace","Sevendust"],
  "Breaking Benjamin":   ["Linkin Park","Papa Roach","Three Days Grace","Shinedown","Hinder"],
  "Sevendust":           ["Godsmack","Disturbed","Shinedown","Alter Bridge","Staind"],
  "Godsmack":            ["Sevendust","Disturbed","Shinedown","Five Finger Death Punch","Staind"],
  "Metallica":           ["Pantera","Slayer","Megadeth","Anthrax","Black Sabbath"],
  "Pantera":             ["Metallica","Lamb Of God","Machine Head","Sepultura","Down"],
  "Tool":                ["A Perfect Circle","Deftones","Porcupine Tree","Primus","Mastodon"],
  "Incubus":             ["Deftones","311","Sublime","Audioslave","Chevelle"],
  "System Of A Down":    ["Rage Against The Machine","Deftones","Korn","Slipknot","Serj Tankian"],
  "Rage Against The Machine": ["System Of A Down","Audioslave","Prophets of Rage","Cypress Hill","Public Enemy"],
  "Sum 41":              ["Simple Plan","Good Charlotte","New Found Glory","Yellowcard","Blink-182"],
  "Nothing More":        ["Spiritbox","Bad Omens","Starset","I Prevail","Wage War"],
  "Starset":             ["Nothing More","Skillet","Fireflight","Bring Me The Horizon","I Prevail"],
  "I Prevail":           ["Bad Omens","Wage War","Nothing More","Memphis May Fire","Asking Alexandria"],
  "Memphis May Fire":    ["I Prevail","Asking Alexandria","Of Mice And Men","We Came As Romans","Crown The Empire"],
  "Pierce The Veil":     ["Sleeping With Sirens","Motionless In White","Black Veil Brides","Crown The Empire","Asking Alexandria"],
  "Motionless In White": ["Black Veil Brides","Pierce The Veil","Ice Nine Kills","Palaye Royale","Get Scared"],
  "Bullet For My Valentine": ["Killswitch Engage","Avenged Sevenfold","Trivium","As I Lay Dying","All That Remains"],
  "Killswitch Engage":   ["Bullet For My Valentine","As I Lay Dying","All That Remains","Shadows Fall","Unearth"],
  "Trivium":             ["Bullet For My Valentine","Killswitch Engage","Machine Head","As I Lay Dying","Lamb Of God"],
  "Bring Me The Horizon":["Architects","Spiritbox","Bad Omens","While She Sleeps","Sleep Token"],
  "Asking Alexandria":   ["Memphis May Fire","Of Mice And Men","We Came As Romans","Crown The Empire","I Prevail"],
  "Falling In Reverse":  ["Escape The Fate","Motionless In White","Attila","Ice Nine Kills","Bad Omens"],
  "Rain City Drive":     ["Bad Omens","Dayseeker","Holding Absence","Sleep Token","Thornhill"],
  "Usher":               ["Tyrese","Joe","R. Kelly","Ne-Yo","Chris Brown"],
  "Incubus":             ["Deftones","311","Linkin Park","Sublime","Audioslave"],
  "Ozzy Osbourne":       ["Black Sabbath","Dio","Rob Halford","Alice Cooper","Judas Priest"],
};

// ── Co-occurrence: extract artist names from result titles ────────────────────
function extractCoArtists(title, primaryArtist) {
  const separators = [" ft. "," feat. "," featuring "," & "," vs "," + "," x "];
  const found = [];
  const tl = title.toLowerCase();
  const pl = primaryArtist.toLowerCase();
  for (const sep of separators) {
    const idx = tl.indexOf(sep);
    if (idx === -1) continue;
    const after = title.slice(idx + sep.length).split(/[\s,\-\(]/)[0].trim();
    if (after.length > 2 && !after.toLowerCase().includes(pl) && /^[A-Z]/.test(after)) {
      found.push(after);
    }
  }
  return found;
}

// ── Channel occurrence tracker ────────────────────────────────────────────────
const channelOccurrences = {};
function trackChannel(name) {
  if (!name || name.length < 3) return;
  const k = name.toLowerCase().trim();
  channelOccurrences[k] = (channelOccurrences[k] || 0) + 1;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function extractInitialData(html) {
  const marker = "var ytInitialData = ";
  const start  = html.indexOf(marker);
  if (start === -1) return null;
  const jsonStart = start + marker.length;
  let depth = 0, i = jsonStart;
  while (i < html.length) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") { depth--; if (depth === 0) break; }
    i++;
  }
  try { return JSON.parse(html.slice(jsonStart, i + 1)); } catch { return null; }
}

function parseSearchResults(data) {
  const results = [];
  try {
    const contents = data?.contents?.twoColumnSearchResultsRenderer
      ?.primaryContents?.sectionListRenderer?.contents ?? [];
    for (const section of contents) {
      for (const item of (section?.itemSectionRenderer?.contents ?? [])) {
        const vr = item?.videoRenderer;
        if (!vr?.videoId) continue;
        results.push({
          videoId:       vr.videoId,
          title:         vr.title?.runs?.map(r => r.text).join("") ?? "",
          channelName:   vr.ownerText?.runs?.map(r => r.text).join("") ?? vr.longBylineText?.runs?.map(r => r.text).join("") ?? "",
          durationText:  vr.lengthText?.simpleText ?? vr.lengthText?.runs?.map(r => r.text).join("") ?? "",
          publishedText: vr.publishedTimeText?.simpleText ?? "",
          viewCountText: vr.viewCountText?.simpleText ?? "",
          thumbnail:     `https://img.youtube.com/vi/${vr.videoId}/hqdefault.jpg`,
        });
      }
    }
  } catch (e) { console.error("  parse error:", e.message); }
  return results;
}

function parseDurationMinutes(text) {
  if (!text) return 0;
  const parts = text.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  return 0;
}

function passesFilters(result, artist) {
  const titleLower   = (result.title       || "").toLowerCase();
  const channelLower = (result.channelName || "").toLowerCase();
  const artistLower  = artist.toLowerCase();

  const artistInTitle   = titleLower.includes(artistLower);
  const artistInChannel = channelLower.includes(artistLower.split(" ")[0].toLowerCase());
  if (!artistInTitle && !artistInChannel) return false;

  for (const term of (blockedTerms || [])) {
    if (titleLower.includes(term.toLowerCase())) {
      console.log(`    x blocked term "${term}": ${result.title}`);
      return false;
    }
  }
  for (const kw of (blockedChannelKeywords || [])) {
    if (channelLower.includes(kw.toLowerCase())) {
      console.log(`    x blocked channel "${kw}": ${result.channelName}`);
      return false;
    }
  }
  if (channelLower.endsWith("- topic") || channelLower === "auto-generated") {
    console.log(`    x Topic/auto channel: ${result.channelName}`);
    return false;
  }

  const mins = parseDurationMinutes(result.durationText);
  if (result.durationText && mins < (minDurationMinutes || 20)) {
    console.log(`    x too short (${result.durationText}): ${result.title}`);
    return false;
  }

  const performanceKeywords = [
    "full concert","full show","full set","live at","live in","live from",
    "unplugged","acoustic","tiny desk","pro-shot","pro shot","official live",
    "festival","full performance","full session","concert film","live concert",
  ];
  if (!performanceKeywords.some(kw => titleLower.includes(kw))) {
    console.log(`    x no performance signal: ${result.title}`);
    return false;
  }
  return true;
}

async function searchYouTube(query, artist, searchTerm) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%3D%3D`;
  console.log(`  Searching: "${query}"`);
  let html;
  try { html = await fetchUrl(url); } catch (e) {
    console.error(`  Fetch error: ${e.message}`); return [];
  }
  const data = extractInitialData(html);
  if (!data) { console.error("  Could not extract ytInitialData"); return []; }

  const raw    = parseSearchResults(data);
  const passed = [];
  for (const r of raw.slice(0, maxResultsPerSearch || 8)) {
    trackChannel(r.channelName);
    if (passesFilters(r, artist)) {
      passed.push({
        videoId:       r.videoId,
        title:         r.title,
        channelName:   r.channelName,
        url:           `https://www.youtube.com/watch?v=${r.videoId}`,
        duration:      r.durationText,
        durationMinutes: parseDurationMinutes(r.durationText),
        publishedText: r.publishedText,
        viewCountText: r.viewCountText,
        thumbnail:     r.thumbnail,
        artistMatched: artist,
        searchTerm,
        discoveredAt:  new Date().toISOString(),
        suggestedMode: "fullshow",
        suggestedTitle:  r.title,
        suggestedArtist: artist,
        suggestedEpisodesJson: {
          title:  r.title,
          artist: artist,
          mode:   "fullshow",
          thumb:  r.thumbnail,
          added:  new Date().toISOString().slice(0, 10),
          tracks: [{ title: r.title, url: `https://www.youtube.com/watch?v=${r.videoId}` }],
        },
      });
      console.log(`    + CANDIDATE: ${r.title} (${r.durationText})`);
    }
  }
  return passed;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🎸 Joey's Concert Corner — Discovery Bot v2 (Smart Edition)");
  console.log("=============================================================");

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
  const episodesRaw        = loadJsonArray(path.join(ROOT, "episodes.json"));

  // Index all existing videoIds
  const episodeVideoIds = new Set();
  function indexEpisodeIds(node) {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(indexEpisodeIds); return; }
    if (Array.isArray(node.items)) { node.items.forEach(indexEpisodeIds); return; }
    (node.tracks || []).forEach(t => {
      if (!t?.url) return;
      try {
        const u = new URL(t.url);
        const v = u.searchParams.get("v") ||
          (u.hostname.includes("youtu.be") ? u.pathname.replace("/","").trim() : null);
        if (v) episodeVideoIds.add(v);
      } catch {}
    });
  }
  indexEpisodeIds(episodesRaw);

  const approvedUrls = new Set([
    ...approvedHistory.map(h => h.url).filter(Boolean),
    ...existingCandidates.map(c => c.url).filter(Boolean),
  ]);
  function urlToId(url) {
    try {
      const u = new URL(url);
      return u.searchParams.get("v") ||
        (u.hostname.includes("youtu.be") ? u.pathname.replace("/","").trim() : null);
    } catch { return null; }
  }

  const seenIds = new Set([
    ...existingCandidates.map(c => c.videoId),
    ...approvedHistory.map(h => h.videoId || h),
    ...rejectedHistory.map(h => h.videoId || h),
    ...episodeVideoIds,
  ]);
  approvedUrls.forEach(url => { const id = urlToId(url); if (id) seenIds.add(id); });

  // Build known artists set for new-artist detection
  const knownArtists = new Set([
    ...artistsThisRun.map(a => a.toLowerCase()),
    ...(config._tier_1_core_full || []).map(a => a.toLowerCase()),
    ...(config._tier_2_adjacent_full || []).map(a => a.toLowerCase()),
    ...(config._tier_3_watchlist_full || []).map(a => a.toLowerCase()),
    ...approvedHistory.map(h => (h.artist || "").toLowerCase()).filter(Boolean),
  ]);

  // Track new artist suggestions from co-occurrence and similarity
  const suggestedNewArtists = new Map(); // lowercase → { name, via, confidence }

  // Seed similarity suggestions from the map
  for (const artist of artistsThisRun) {
    const similar = SIMILARITY_MAP[artist] || [];
    for (const sim of similar) {
      const sl = sim.toLowerCase();
      if (!knownArtists.has(sl) && !suggestedNewArtists.has(sl)) {
        suggestedNewArtists.set(sl, {
          name:        sim,
          discoveredVia: artist,
          confidence:  "similarity-map",
        });
      }
    }
  }

  console.log(`De-dupe: ${existingCandidates.length} pending | ${approvedHistory.length} approved | ${rejectedHistory.length} rejected | ${episodeVideoIds.size} in episodes`);
  console.log(`Total blocked IDs: ${seenIds.size}`);
  console.log(`Similarity suggestions seeded: ${suggestedNewArtists.size} potential new artists\n`);

  const newCandidates = [];
  const shuffledArtists = [...artistsThisRun].sort(() => Math.random() - 0.5);

  for (const artist of shuffledArtists) {
    console.log(`\n🎤 ${artist}`);

    for (const term of (searchTerms || [])) {
      const results = await searchYouTube(`${artist} ${term}`, artist, term);

      for (const r of results) {
        // Co-occurrence: find artists mentioned alongside this one
        const coArtists = extractCoArtists(r.title, artist);
        for (const ca of coArtists) {
          const cal = ca.toLowerCase();
          if (!knownArtists.has(cal) && !suggestedNewArtists.has(cal)) {
            suggestedNewArtists.set(cal, {
              name:        ca,
              discoveredVia: artist,
              fromTitle:   r.title,
              confidence:  "co-occurrence",
            });
            console.log(`    >> New artist spotted: "${ca}" (co-occurrence with ${artist})`);
          }
        }

        if (!seenIds.has(r.videoId)) {
          seenIds.add(r.videoId);
          newCandidates.push(r);
        } else {
          console.log(`    (already seen: ${r.videoId})`);
        }
      }

      await sleep(1800 + Math.random() * 1200);
    }

    await sleep(3000 + Math.random() * 2000);
  }

  // ── Build new artist suggestion candidates ───────────────────────────────
  // Pick top suggestions (similarity-map first, then co-occurrence),
  // cap at 15 per run so the admin queue doesn't get flooded.
  const newArtistCandidates = [];
  const simMapSuggestions = [...suggestedNewArtists.values()]
    .filter(s => s.confidence === "similarity-map").slice(0, 10);
  const coOccurrenceSuggestions = [...suggestedNewArtists.values()]
    .filter(s => s.confidence === "co-occurrence").slice(0, 5);

  for (const suggestion of [...simMapSuggestions, ...coOccurrenceSuggestions]) {
    newArtistCandidates.push({
      type:          "new_artist_suggestion",
      videoId:       `artist_${suggestion.name.replace(/\s+/g,"_").toLowerCase()}`,
      title:         `🎤 New Artist: ${suggestion.name}`,
      artistName:    suggestion.name,
      channelName:   "",
      url:           `https://www.youtube.com/results?search_query=${encodeURIComponent(suggestion.name + " full concert")}`,
      discoveredVia: suggestion.discoveredVia,
      fromTitle:     suggestion.fromTitle || "",
      confidence:    suggestion.confidence,
      discoveredAt:  new Date().toISOString(),
    });
  }

  // ── Save trusted channels that appeared 3+ times ─────────────────────────
  const trustedThisRun = Object.entries(channelOccurrences)
    .filter(([, count]) => count >= 3)
    .map(([name]) => name);
  if (trustedThisRun.length) {
    let existingChannels = [];
    try { existingChannels = JSON.parse(fs.readFileSync(CHANNELS_PATH, "utf8")); } catch {}
    const merged = [...new Set([...existingChannels, ...trustedThisRun])].sort();
    fs.writeFileSync(CHANNELS_PATH, JSON.stringify(merged, null, 2), "utf8");
    console.log(`\n📡 Trusted channels updated: ${trustedThisRun.join(", ")}`);
  }

  // ── Merge everything ──────────────────────────────────────────────────────
  // Filter out old new_artist_suggestion entries for artists now in watchlist
  const filteredExisting = existingCandidates.filter(c => {
    if (c.type !== "new_artist_suggestion") return true;
    return !knownArtists.has((c.artistName || "").toLowerCase());
  });

  // De-dupe new artist suggestions against existing
  const existingArtistSuggestions = new Set(
    filteredExisting
      .filter(c => c.type === "new_artist_suggestion")
      .map(c => (c.artistName || "").toLowerCase())
  );
  const dedupedNewArtists = newArtistCandidates.filter(c =>
    !existingArtistSuggestions.has((c.artistName || "").toLowerCase())
  );

  const merged = [
    ...newCandidates,
    ...dedupedNewArtists,
    ...filteredExisting,
  ];

  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(merged, null, 2), "utf8");

  console.log("\n=============================================================");
  console.log(`Concert candidates: ${newCandidates.length} new found`);
  console.log(`New artist suggestions: ${dedupedNewArtists.length} added`);
  console.log(`Total in queue: ${merged.length}`);
  console.log("\nSAFE MODE: episodes.json was NOT touched.");
  console.log("Review data/discovery-candidates.json in the admin page.");
}

main().catch(e => { console.error("Bot crashed:", e); process.exit(1); });
