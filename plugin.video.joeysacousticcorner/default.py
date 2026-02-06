# -*- coding: utf-8 -*-
import sys
import json
import re
import urllib.request
import urllib.parse
import ssl

import xbmc
import xbmcgui
import xbmcplugin

HANDLE = int(sys.argv[1])
BASE_URL = sys.argv[0]

# 🔗 CHANGE THIS ONLY IF YOUR NETLIFY URL CHANGES
SITE = "https://mellifluous-tanuki-51d911.netlify.app"
EP_URL = SITE + "/episodes.json"


# -----------------------------
# Helpers
# -----------------------------
def build_url(query):
    return BASE_URL + "?" + urllib.parse.urlencode(query)


def http_get_json(url):
    # 🔐 Kodi SSL fix
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    req = urllib.request.Request(url, headers={"User-Agent": "Kodi"})
    with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def yt_id_from_url(url):
    m = re.search(r"youtu\.be/([A-Za-z0-9_\-]+)", url)
    if m:
        return m.group(1)
    m = re.search(r"v=([A-Za-z0-9_\-]+)", url)
    if m:
        return m.group(1)
    return None


def playlist_id_from_url(url):
    m = re.search(r"list=([A-Za-z0-9_\-]+)", url)
    return m.group(1) if m else None


# -----------------------------
# Playback
# -----------------------------
def play_youtube(url):
    vid = yt_id_from_url(url)
    pid = playlist_id_from_url(url)

    if pid:
        plugin_url = "plugin://plugin.video.youtube/play/?playlist_id=" + pid
    elif vid:
        plugin_url = "plugin://plugin.video.youtube/play/?video_id=" + vid
    else:
        plugin_url = url  # fallback

    li = xbmcgui.ListItem(path=plugin_url)
    xbmcplugin.setResolvedUrl(HANDLE, True, li)


# -----------------------------
# UI
# -----------------------------
def list_root():
    items = [
        ("Full Sessions", "fullshow"),
        ("Queues", "queue"),
        ("Playlists", "playlist"),
        ("All Sessions", "all")
    ]

    for label, mode in items:
        url = build_url({"action": "list", "mode": mode})
        li = xbmcgui.ListItem(label=label)
        li.setInfo("video", {"title": label})
        xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=True)

    xbmcplugin.endOfDirectory(HANDLE)


def list_mode(mode):
    data = http_get_json(EP_URL)
    eps = data if isinstance(data, list) else []

    if mode != "all":
        eps = [e for e in eps if str(e.get("mode", "")).lower() == mode]

    eps.sort(key=lambda e: (
        str(e.get("artist", "")).lower(),
        str(e.get("year", "")),
        str(e.get("title", "")).lower()
    ))

    for e in eps:
        title = e.get("title", "Untitled")
        artist = e.get("artist", "")
        m = str(e.get("mode", "")).lower()
        tracks = e.get("tracks", []) or []

        meta = {"title": title, "artist": artist}

        if m in ["queue", "playlist"] and tracks:
            url = build_url({"action": "tracks", "title": title})
            li = xbmcgui.ListItem(label=title)
            li.setInfo("video", meta)
            xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=True)
        else:
            if not tracks:
                continue
            play_url = tracks[0].get("url")
            if not play_url:
                continue

            url = build_url({"action": "play", "u": play_url})
            li = xbmcgui.ListItem(label=title)
            li.setInfo("video", meta)
            li.setProperty("IsPlayable", "true")
            xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=False)

    xbmcplugin.endOfDirectory(HANDLE)


def list_tracks(title_match):
    data = http_get_json(EP_URL)
    eps = data if isinstance(data, list) else []

    ep = next((e for e in eps if e.get("title") == title_match), None)
    if not ep:
        xbmcplugin.endOfDirectory(HANDLE)
        return

    for t in ep.get("tracks", []):
        name = t.get("title", "Track")
        u = t.get("url", "")

        li = xbmcgui.ListItem(label=name)
        li.setProperty("IsPlayable", "true")
        url = build_url({"action": "play", "u": u})
        xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=False)

    xbmcplugin.endOfDirectory(HANDLE)


# -----------------------------
# Router
# -----------------------------
def router():
    params = {}
    if len(sys.argv) > 2 and sys.argv[2]:
        params = dict(urllib.parse.parse_qsl(sys.argv[2][1:]))

    action = params.get("action")

    if not action:
        list_root()
    elif action == "list":
        list_mode(params.get("mode", "all"))
    elif action == "tracks":
        list_tracks(params.get("title", ""))
    elif action == "play":
        play_youtube(params.get("u", ""))
    else:
        list_root()


router()
