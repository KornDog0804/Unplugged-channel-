# -*- coding: utf-8 -*-
import sys, json, re, urllib.request, urllib.parse

import xbmc
import xbmcgui
import xbmcplugin

HANDLE = int(sys.argv[1])
BASE_URL = sys.argv[0]

SITE = "https://mellifluous-tanuki-51d911.netlify.app"
EP_URL = SITE.rstrip("/") + "/episodes.json"
USER_AGENT = "Mozilla/5.0 (Kodi; JoeysAcousticCorner)"

def build_url(query):
    return BASE_URL + "?" + urllib.parse.urlencode(query)

def notify(msg, ms=7000):
    xbmcgui.Dialog().notification("Joey’s Acoustic Corner", msg, xbmcgui.NOTIFICATION_ERROR, ms)

def http_get_json(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=15) as resp:
            status = getattr(resp, "status", 200)
            raw = resp.read().decode("utf-8", errors="replace").strip()

        if status != 200:
            raise RuntimeError("HTTP %s" % status)

        if raw[:1] != "[":
            # show first bit so we can tell if it's HTML
            snippet = raw[:60].replace("\n", " ")
            raise ValueError("Not JSON array. Starts: " + snippet)

        data = json.loads(raw)
        if not isinstance(data, list):
            raise ValueError("episodes.json must be a JSON ARRAY [ ... ]")
        return data

    except Exception as e:
        xbmc.log("[JoeysAcousticCorner] episodes.json error: %s | url=%s" % (str(e), url), xbmc.LOGERROR)
        notify(str(e))
        return []

def yt_id_from_url(url):
    m = re.search(r"youtu\.be/([A-Za-z0-9_\-]+)", url)
    if m: return m.group(1)
    m = re.search(r"[?&]v=([A-Za-z0-9_\-]+)", url)
    if m: return m.group(1)
    return None

def playlist_id_from_url(url):
    m = re.search(r"[?&]list=([A-Za-z0-9_\-]+)", url)
    return m.group(1) if m else None

def youtube_plugin_url(video_url):
    vid = yt_id_from_url(video_url)
    pid = playlist_id_from_url(video_url)
    if pid: return "plugin://plugin.video.youtube/play/?playlist_id=" + pid
    if vid: return "plugin://plugin.video.youtube/play/?video_id=" + vid
    return None

def play_youtube(video_url):
    if not xbmc.getCondVisibility("System.HasAddon(plugin.video.youtube)"):
        notify("YouTube add-on not installed/enabled")
        return
    purl = youtube_plugin_url(video_url)
    if not purl:
        notify("Bad YouTube URL (no id found)")
        return
    xbmc.executebuiltin('PlayMedia("%s")' % purl)

def list_root():
    items = [("Full Sessions","fullshow"), ("Queues","queue"), ("Playlists","playlist"), ("All Sessions","all")]
    for label, mode in items:
        url = build_url({"action":"list","mode":mode})
        li = xbmcgui.ListItem(label=label)
        li.setInfo("video", {"title": label})
        xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=True)
    xbmcplugin.endOfDirectory(HANDLE)

def list_mode(mode):
    eps = http_get_json(EP_URL)
    if mode != "all":
        eps = [e for e in eps if str(e.get("mode","")).lower() == mode]

    eps.sort(key=lambda e: (str(e.get("artist","")).lower(), str(e.get("year","")), str(e.get("title","")).lower()))

    for e in eps:
        title = e.get("title","Untitled")
        tracks = e.get("tracks", []) or []
        m = str(e.get("mode","")).lower()

        if m in ["queue","playlist"] and tracks:
            url = build_url({"action":"tracks","title": title})
            li = xbmcgui.ListItem(label=title)
            li.setInfo("video", {"title": title, "artist": e.get("artist","")})
            xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=True)
        else:
            if not tracks: 
                continue
            u = tracks[0].get("url","")
            url = build_url({"action":"play","u": u})
            li = xbmcgui.ListItem(label=title)
            li.setInfo("video", {"title": title, "artist": e.get("artist","")})
            li.setProperty("IsPlayable", "true")
            xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=False)

    xbmcplugin.endOfDirectory(HANDLE)

def list_tracks(title_match):
    eps = http_get_json(EP_URL)
    ep = next((e for e in eps if e.get("title") == title_match), None)
    if not ep:
        xbmcplugin.endOfDirectory(HANDLE)
        return

    for t in (ep.get("tracks", []) or []):
        name = t.get("title","Track")
        u = t.get("url","")
        li = xbmcgui.ListItem(label=name)
        li.setProperty("IsPlayable", "true")
        url = build_url({"action":"play","u": u})
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
        return list_mode(params.get("mode","all"))
    if action == "tracks":
        return list_tracks(params.get("title",""))
    if action == "play":
        return play_youtube(params.get("u",""))
    return list_root()

router()
