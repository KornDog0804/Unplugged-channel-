# -*- coding: utf-8 -*-
import sys
import json
import re
import urllib.request
import urllib.parse

import xbmc
import xbmcgui
import xbmcplugin

HANDLE = int(sys.argv[1])
BASE_URL = sys.argv[0]

# Your live Netlify site
SITE = "https://mellifluous-tanuki-51d911.netlify.app"
EP_URL = SITE.rstrip("/") + "/episodes.json"

USER_AGENT = "Mozilla/5.0 (Kodi; JoeysAcousticCorner)"


def build_url(query):
    return BASE_URL + "?" + urllib.parse.urlencode(query)


def notify(title, message, ms=5000):
    xbmcgui.Dialog().notification(title, message, xbmcgui.NOTIFICATION_ERROR, ms)


def http_get_json(url):
    """
    Fetch JSON from URL. If it fails or returns HTML, we throw a clean error.
    """
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8", errors="replace").strip()

        # If Netlify returns an HTML page (404 or redirect), json.loads will explode.
        if raw.lower().startswith("<!doctype") or raw.lower().startswith("<html"):
            raise ValueError("episodes.json is returning HTML (wrong path or missing file).")

        data = json.loads(raw)
        if not isinstance(data, list):
            raise ValueError("episodes.json must be a JSON ARRAY (starts with [ ... ]).")
        return data

    except Exception as e:
        # Log full details
        xbmc.log("[JoeysAcousticCorner] Failed to load episodes.json: %s" % str(e), xbmc.LOGERROR)
        # Show user-friendly message
        notify("Joey’s Acoustic Corner", "episodes.json failed — check path / JSON format")
        return []


def yt_id_from_url(url):
    # supports youtu.be/ID and youtube.com/watch?v=ID
    m = re.search(r"youtu\.be/([A-Za-z0-9_\-]+)", url)
    if m:
        return m.group(1)
    m = re.search(r"[?&]v=([A-Za-z0-9_\-]+)", url)
    if m:
        return m.group(1)
    return None


def playlist_id_from_url(url):
    m = re.search(r"[?&]list=([A-Za-z0-9_\-]+)", url)
    return m.group(1) if m else None


def youtube_plugin_url(video_url):
    """
    Convert a normal YouTube URL into a Kodi YouTube add-on plugin URL.
    """
    vid = yt_id_from_url(video_url)
    pid = playlist_id_from_url(video_url)

    if pid:
        return "plugin://plugin.video.youtube/play/?playlist_id=" + pid
    if vid:
        return "plugin://plugin.video.youtube/play/?video_id=" + vid
    return None


def play_youtube(video_url):
    """
    Reliable playback through YouTube add-on.
    If YouTube isn't installed, show a message instead of crashing.
    """
    plugin_url = youtube_plugin_url(video_url)

    if not plugin_url:
        notify("Joey’s Acoustic Corner", "Bad YouTube URL (no video_id / playlist_id)")
        return

    # If YouTube addon isn't installed/enabled, Kodi will fail.
    if not xbmc.getCondVisibility("System.HasAddon(plugin.video.youtube)"):
        notify("Joey’s Acoustic Corner", "Install/Enable Kodi YouTube add-on first")
        return

    # Use Kodi builtin playback (very reliable for plugin:// sources)
    xbmc.executebuiltin('PlayMedia("%s")' % plugin_url)


def list_root():
    items = [
        ("Full Sessions", "fullshow"),
        ("Queues", "queue"),
        ("Playlists", "playlist"),
        ("All Sessions", "all"),
    ]

    for label, mode in items:
        url = build_url({"action": "list", "mode": mode})
        li = xbmcgui.ListItem(label=label)
        li.setInfo("video", {"title": label})
        xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=True)

    xbmcplugin.endOfDirectory(HANDLE)


def list_mode(mode):
    eps = http_get_json(EP_URL)

    if mode != "all":
        eps = [e for e in eps if str(e.get("mode", "")).lower() == mode]

    def key(e):
        return (
            str(e.get("artist", "")).lower(),
            str(e.get("year", "")),
            str(e.get("title", "")).lower(),
        )

    eps.sort(key=key)

    for e in eps:
        title = e.get("title", "Untitled")
        artist = e.get("artist", "")
        year = e.get("year", "")
        m = str(e.get("mode", "")).lower()
        tracks = e.get("tracks", []) or []

        meta = {"title": title, "artist": artist}
        if year:
            meta["year"] = year

        # queue/playlist => folder to pick tracks
        if m in ["queue", "playlist"] and len(tracks) > 0:
            url = build_url({"action": "tracks", "title": title})
            li = xbmcgui.ListItem(label=title)
            li.setInfo("video", meta)
            xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=True)
        else:
            # fullshow => play first track
            play_url = tracks[0].get("url") if len(tracks) else None
            if not play_url:
                continue
            url = build_url({"action": "play", "u": play_url})
            li = xbmcgui.ListItem(label=title)
            li.setInfo("video", meta)
            li.setProperty("IsPlayable", "true")
            xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=False)

    xbmcplugin.endOfDirectory(HANDLE)


def list_tracks(title_match):
    eps = http_get_json(EP_URL)
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
        return play_youtube(params.get("u", ""))

    return list_root()


router()
