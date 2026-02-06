# -*- coding: utf-8 -*-
import sys
import json
import urllib.request
import urllib.parse

import xbmc
import xbmcgui
import xbmcplugin

HANDLE = int(sys.argv[1])
BASE_URL = sys.argv[0]

# ✅ YOUR LIVE SITE (Netlify)
SITE = "https://mellifluous-tanuki-51d911.netlify.app"
EP_URL = SITE + "/episodes.json"

def build_url(query):
    return BASE_URL + "?" + urllib.parse.urlencode(query)

def http_get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Kodi"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))

def yt_id_from_url(url):
    # supports youtu.be/ID and youtube.com/watch?v=ID
    import re
    m = re.search(r"youtu\.be/([A-Za-z0-9_\-]+)", url)
    if m: return m.group(1)
    m = re.search(r"v=([A-Za-z0-9_\-]+)", url)
    if m: return m.group(1)
    return None

def playlist_id_from_url(url):
    import re
    m = re.search(r"list=([A-Za-z0-9_\-]+)", url)
    return m.group(1) if m else None

def resolve_to_youtube(url):
    """
    Always try to hand off to the official YouTube addon.
    If it can't parse, fallback to the raw URL.
    """
    vid = yt_id_from_url(url)
    pid = playlist_id_from_url(url)

    if pid:
        plugin_url = "plugin://plugin.video.youtube/play/?playlist_id=" + pid
    elif vid:
        plugin_url = "plugin://plugin.video.youtube/play/?video_id=" + vid
    else:
        plugin_url = url

    li = xbmcgui.ListItem(path=plugin_url)
    xbmcplugin.setResolvedUrl(HANDLE, True, li)

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
    try:
        data = http_get_json(EP_URL + "?cb=1")
    except Exception as e:
        xbmc.log("JAC: Failed loading episodes.json: %s" % e, xbmc.LOGERROR)
        xbmcgui.Dialog().notification("Joey’s Acoustic Corner", "episodes.json failed to load", xbmcgui.NOTIFICATION_ERROR, 4000)
        xbmcplugin.endOfDirectory(HANDLE)
        return

    eps = data if isinstance(data, list) else []

    if mode != "all":
        eps = [e for e in eps if str(e.get("mode", "")).lower() == mode]

    def key(e):
        return (str(e.get("artist", "")).lower(),
                str(e.get("year", "")),
                str(e.get("title", "")).lower())
    eps.sort(key=key)

    for e in eps:
        title = e.get("title", "Untitled")
        artist = e.get("artist", "")
        year = e.get("year", "")
        m = str(e.get("mode", "")).lower()
        tracks = e.get("tracks", []) or []

        label = f"{title}"
        meta = {"title": title, "artist": artist, "year": year}

        # Queue/playlist => folder to pick tracks
        if m in ["queue", "playlist"] and len(tracks) > 0:
            url = build_url({"action": "tracks", "title": title})
            li = xbmcgui.ListItem(label=label)
            li.setInfo("video", meta)
            xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=True)
        else:
            # fullshow => play first track
            play_url = tracks[0].get("url") if len(tracks) else None
            if not play_url:
                continue
            url = build_url({"action": "play", "u": play_url})
            li = xbmcgui.ListItem(label=label)
            li.setInfo("video", meta)
            li.setProperty("IsPlayable", "true")
            xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=False)

    xbmcplugin.endOfDirectory(HANDLE)

def list_tracks(title_match):
    try:
        data = http_get_json(EP_URL + "?cb=1")
    except Exception as e:
        xbmc.log("JAC: Failed loading episodes.json: %s" % e, xbmc.LOGERROR)
        xbmcplugin.endOfDirectory(HANDLE)
        return

    eps = data if isinstance(data, list) else []
    ep = None
    for e in eps:
        if e.get("title") == title_match:
            ep = e
            break

    if not ep:
        xbmcplugin.endOfDirectory(HANDLE)
        return

    tracks = ep.get("tracks", []) or []
    for t in tracks:
        tname = t.get("title", "Track")
        u = t.get("url", "")
        li = xbmcgui.ListItem(label=tname)
        li.setProperty("IsPlayable", "true")
        url = build_url({"action": "play", "u": u})
        xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=False)

    xbmcplugin.endOfDirectory(HANDLE)

def router():
    params = {}
    if len(sys.argv) > 2 and sys.argv[2]:
        params = dict(urllib.parse.parse_qsl(sys.argv[2][1:]))

    action = params.get("action")
    if not action:
        return list_root()

    if action == "list":
        return list_mode(params.get("mode", "all"))
    if action == "tracks":
        return list_tracks(params.get("title", ""))
    if action == "play":
        return resolve_to_youtube(params.get("u", ""))

    return list_root()

router()
