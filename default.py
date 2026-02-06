# -*- coding: utf-8 -*-
import sys
import json
import re
from urllib.parse import parse_qsl, urlencode

import xbmc
import xbmcgui
import xbmcplugin

try:
    import requests
except Exception:
    requests = None

ADDON_HANDLE = int(sys.argv[1])
BASE_URL = sys.argv[0]

# CHANGE THIS to your Netlify URL endpoint (episodes.json at root)
EPISODES_JSON_URL = "https://mellifluous-tanuki-51d911.netlify.app/episodes.json"

YOUTUBE_PLUGIN = "plugin://plugin.video.youtube/play/?video_id="


def log(msg):
    xbmc.log(f"[JoeysAcousticCorner] {msg}", xbmc.LOGINFO)


def get_params():
    return dict(parse_qsl(sys.argv[2][1:]))


def yt_id_from_url(url):
    # Supports:
    # https://youtu.be/VIDEOID
    # https://www.youtube.com/watch?v=VIDEOID
    # and extra ?si= stuff
    if not url:
        return None
    m = re.search(r"youtu\.be/([A-Za-z0-9_-]{6,})", url)
    if m:
        return m.group(1)
    m = re.search(r"v=([A-Za-z0-9_-]{6,})", url)
    if m:
        return m.group(1)
    return None


def fetch_episodes():
    if requests is None:
        raise Exception("Missing requests module in Kodi. Install 'requests' dependency.")
    r = requests.get(EPISODES_JSON_URL, timeout=15)
    r.raise_for_status()
    data = r.json()
    # Accept either { "episodes": [...] } or just [...]
    if isinstance(data, dict) and "episodes" in data:
        return data["episodes"]
    if isinstance(data, list):
        return data
    return []


def build_url(query):
    return BASE_URL + "?" + urlencode(query)


def list_sessions():
    xbmcplugin.setPluginCategory(ADDON_HANDLE, "Joey’s Acoustic Corner")
    xbmcplugin.setContent(ADDON_HANDLE, "videos")

    try:
        episodes = fetch_episodes()
    except Exception as e:
        xbmcgui.Dialog().ok("Joey’s Acoustic Corner", f"Couldn’t load episodes.json:\n\n{e}")
        xbmcplugin.endOfDirectory(ADDON_HANDLE, succeeded=False)
        return

    # Sort newest-ish first when year is numeric
    def year_key(ep):
        y = ep.get("year")
        return y if isinstance(y, int) else -1

    episodes_sorted = sorted(episodes, key=year_key, reverse=True)

    for idx, ep in enumerate(episodes_sorted):
        title = ep.get("title", "Untitled")
        artist = ep.get("artist", "")
        year = ep.get("year", "")
        mode = ep.get("mode", "fullshow")
        tracks = ep.get("tracks", [])

        label = f"{title}"
        subtitle = " • ".join([str(artist).strip(), str(year).strip(), str(mode).strip()]).strip(" •")

        li = xbmcgui.ListItem(label=label)
        li.setInfo("video", {
            "title": title,
            "artist": artist,
            "year": year if isinstance(year, int) else None,
            "plot": subtitle
        })

        # If it's a queue, go to track list. If fullshow, play first track.
        if mode == "queue" and len(tracks) > 0:
            url = build_url({"action": "tracks", "index": str(idx)})
            xbmcplugin.addDirectoryItem(ADDON_HANDLE, url, li, isFolder=True)
        else:
            # play first track
            if len(tracks) == 0:
                continue
            url = build_url({"action": "play", "u": tracks[0].get("url", "")})
            li.setProperty("IsPlayable", "true")
            xbmcplugin.addDirectoryItem(ADDON_HANDLE, url, li, isFolder=False)

    xbmcplugin.endOfDirectory(ADDON_HANDLE)


def list_tracks(index_str):
    try:
        episodes = fetch_episodes()
        idx = int(index_str)
        ep = episodes[idx]
    except Exception:
        xbmcplugin.endOfDirectory(ADDON_HANDLE, succeeded=False)
        return

    title = ep.get("title", "Queue")
    tracks = ep.get("tracks", [])

    xbmcplugin.setPluginCategory(ADDON_HANDLE, title)
    xbmcplugin.setContent(ADDON_HANDLE, "songs")

    for t in tracks:
        ttitle = t.get("title", "Track")
        url = t.get("url", "")

        li = xbmcgui.ListItem(label=ttitle)
        li.setInfo("music", {"title": ttitle})
        li.setProperty("IsPlayable", "true")

        play_url = build_url({"action": "play", "u": url})
        xbmcplugin.addDirectoryItem(ADDON_HANDLE, play_url, li, isFolder=False)

    xbmcplugin.endOfDirectory(ADDON_HANDLE)


def play_url(youtube_url):
    vid = yt_id_from_url(youtube_url)
    if not vid:
        xbmcgui.Dialog().ok("Joey’s Acoustic Corner", "Couldn’t parse YouTube video id.")
        return

    # Hand off to official YouTube add-on
    target = YOUTUBE_PLUGIN + vid
    li = xbmcgui.ListItem(path=target)
    xbmcplugin.setResolvedUrl(ADDON_HANDLE, True, li)


def router(params):
    action = params.get("action")
    if action is None:
        list_sessions()
    elif action == "tracks":
        list_tracks(params.get("index", "0"))
    elif action == "play":
        play_url(params.get("u", ""))
    else:
        list_sessions()


if __name__ == "__main__":
    router(get_params())
