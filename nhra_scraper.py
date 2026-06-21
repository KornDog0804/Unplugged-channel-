#!/usr/bin/env python3
"""
nhra_scraper.py — KornDog Acoustic Corner / Drag Racing auto-updater

Polls NHRA's official YouTube RSS feed (free, no API key required),
filters for full-broadcast-style uploads, and appends any new finds
into episodes.json's "Drag Racing" section. Designed to run via
GitHub Actions on a schedule (Fri/Sat/Sun, race weekends).

Why RSS instead of the YouTube Data API: the API needs a key (Google
Cloud project, quota limits, a GitHub secret to manage). The RSS feed
is free, unauthenticated, and returns the channel's 15 most recent
uploads — plenty, since NHRA doesn't post that often.

NOTE ON SCOPE: NHRA does not post full event broadcasts for free as a
matter of course — most of their channel is highlight reels. The few
free full broadcasts that do appear (selected Division-level races)
show up as regular uploads, not in any special "full broadcast"
playlist. This script just watches for them and grabs anything that
looks like the real thing the moment it's posted.
"""

import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

NHRA_CHANNEL_ID = "UCJcErqlzaBzFmAh2uIxeqxQ"
RSS_URL = f"https://www.youtube.com/feeds/videos.xml?channel_id={NHRA_CHANNEL_ID}"

EPISODES_JSON_PATH = "episodes.json"
DRAG_RACING_TITLE = "🚗 Drag Racing"

INCLUDE_KEYWORDS = [
    "full broadcast", "full race", "full event", "full session",
    "full qualifying", "final round", "complete", "replay",
    "race day", "full coverage",
]
EXCLUDE_KEYWORDS = [
    "highlight", "highlights", "shorts", "recap", "preview",
    "best of", "top 5", "top5", "moments",
]

# Atom feed namespaces YouTube uses
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "media": "http://search.yahoo.com/mrss/",
    "yt": "http://www.youtube.com/xml/schemas/2015",
}


def fetch_feed():
    req = urllib.request.Request(RSS_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read()


def parse_entries(xml_bytes):
    root = ET.fromstring(xml_bytes)
    entries = []
    for entry in root.findall("atom:entry", NS):
        title_el = entry.find("atom:title", NS)
        link_el = entry.find("atom:link", NS)
        video_id_el = entry.find("yt:videoId", NS)
        published_el = entry.find("atom:published", NS)

        if title_el is None or video_id_el is None:
            continue

        title = (title_el.text or "").strip()
        video_id = (video_id_el.text or "").strip()
        url = f"https://youtu.be/{video_id}" if video_id else (
            link_el.get("href") if link_el is not None else None
        )
        published = published_el.text if published_el is not None else ""

        if not title or not url:
            continue

        entries.append({"title": title, "url": url, "published": published})
    return entries


def looks_like_full_broadcast(title):
    lower = title.lower()
    if any(bad in lower for bad in EXCLUDE_KEYWORDS):
        return False
    return any(good in lower for good in INCLUDE_KEYWORDS)


def load_episodes():
    with open(EPISODES_JSON_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_episodes(data):
    with open(EPISODES_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def find_drag_racing_section(data):
    for section in data:
        if section.get("title") == DRAG_RACING_TITLE:
            return section
    return None


def ensure_queue_mode(section):
    """
    The Drag Racing section originally pointed at a single generic
    playlist URL (mode: "playlist"). To let the scraper append
    individually-selectable full broadcasts over time (with auto-
    advance support like the artist queues), this switches it to
    mode: "queue" the first time the scraper runs, seeding the track
    list with whatever was already there if it looks like a real
    video rather than a generic playlist link.
    """
    if section.get("mode") == "queue":
        return

    section["mode"] = "queue"
    if "thumb" not in section:
        section["thumb"] = "./images/nhra-4-logo-svg-vector.svg"

    existing_tracks = section.get("tracks", [])
    # Drop the old generic playlist link if present — it's not a
    # single full broadcast, just a catch-all playlist URL.
    section["tracks"] = [
        t for t in existing_tracks
        if "playlist?list=" not in t.get("url", "")
    ]


def main():
    try:
        xml_bytes = fetch_feed()
    except Exception as e:
        print(f"Failed to fetch NHRA RSS feed: {e}", file=sys.stderr)
        sys.exit(0)  # don't fail the whole workflow over a transient fetch error

    entries = parse_entries(xml_bytes)
    candidates = [e for e in entries if looks_like_full_broadcast(e["title"])]

    if not candidates:
        print("No full-broadcast-style videos found in the latest feed. Nothing to do.")
        return

    data = load_episodes()
    section = find_drag_racing_section(data)
    if section is None:
        print("Could not find the Drag Racing section in episodes.json — aborting.", file=sys.stderr)
        sys.exit(1)

    ensure_queue_mode(section)

    existing_urls = {t.get("url") for t in section.get("tracks", [])}
    added = []

    for c in candidates:
        if c["url"] in existing_urls:
            continue
        section["tracks"].insert(0, {"title": c["title"], "url": c["url"]})
        existing_urls.add(c["url"])
        added.append(c["title"])

    # Keep this from growing forever — cap at the 30 most recent finds.
    section["tracks"] = section["tracks"][:30]

    if added:
        save_episodes(data)
        print(f"Added {len(added)} new full broadcast(s):")
        for t in added:
            print(f"  - {t}")
    else:
        print("Found full-broadcast-style titles, but all were already in episodes.json.")


if __name__ == "__main__":
    main()
  
