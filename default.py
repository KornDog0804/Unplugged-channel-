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

# ===== LIVE NETLIFY SITE =====
SITE = "https://mellifluous-tanuki-51d911.netlify.app"

# ✅ ONE SOURCE OF TRUTH
EP_URL = SITE + "/episodes.json"

UA = "Kodi/21 JoeysAcousticCorner"

# ===== FALLBACK (only used if JSON dies) =====
FALLBACK_EPISODES = [
    ("Nirvana — MTV Unplugged (Full Session)", "https://youtu.be/pOTkCgkxqyg"),
    ("Alice In Chains — MTV Unplugged (Full Session)", "https://youtu.be/Jprla2NvHY0"),
]

def log(msg):
    xbmc.log("[JAC] " + str(msg), xbmc.LOGINFO)

def notify(msg):
    xbmcgui.Dialog().notification(
        "Joey’s Acoustic Corner",
        str(msg),
        xbmcgui.NOTIFICATION_INFO,
        3500
    )

def http_get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))

def yt_id(url):
    if not url:
        return None
    m = re.search(r"youtu\.be/([A-Za-z0-9_-]+)", url)
    if m:
        return m.group(1)
    m = re.search(r"[?&]v=([A-Za-z0-9_-]+)", url)
    if m:
        return m.group(1)
    return None

def playlist_id(url):
    if not url:
        return None
    m = re.search(r"[?&]list=([A-Za-z0-9_-]+)", url)
    return m.group(1) if m else None

def yt_video(id):
    return f"plugin://plugin.video.youtube/play/?video_id={id}"

def yt_playlist(id):
    return f"plugin://plugin.video.youtube/play/?playlist_id={id}"

def add_item(label, path):
    li = xbmcgui.ListItem(label=label)
    li.setProperty("IsPlayable", "true")
    xbmcplugin.addDirectoryItem(HANDLE, path, li, False)

def end_dir():
    xbmcplugin.endOfDirectory(HANDLE, cacheToDisc=False)

def load_episodes():
    try:
        data = http_get_json(EP_URL)
        return data if isinstance(data, list) else None
    except Exception as e:
        log("JSON fetch failed: " + str(e))
        return None

def has_encore(ep):
    return (
        ep.get("mode") == "queue"
        and isinstance(ep.get("encoreAfterTrackIndex"), int)
        and ep.get("encore", {}).get("url")
    )

# ===== SAFE QUEUE LINK (INDEX ONLY — NO CRASHING) =====
def queue_url(idx):
    qs = urllib.parse.urlencode({"action": "queue", "idx": str(idx)})
    return sys.argv[0] + "?" + qs

def render(eps):
    for i, ep in enumerate(eps):
        title = ep.get("title", "Untitled")
        mode = ep.get("mode")
        tracks = ep.get("tracks", [])

        if has_encore(ep):
            title += " 🕯️"

        if mode == "fullshow" and tracks:
            vid = yt_id(tracks[0].get("url"))
            if vid:
                add_item(title, yt_video(vid))

        elif mode == "playlist" and tracks:
            pid = playlist_id(tracks[0].get("url"))
            if pid:
                add_item(title, yt_playlist(pid))

        elif mode == "queue":
            add_item(title + " (Queue)", queue_url(i))

def play_queue(ep):
    ids = [yt_id(t.get("url")) for t in ep.get("tracks", []) if yt_id(t.get("url"))]

    if has_encore(ep):
        idx = ep["encoreAfterTrackIndex"] + 1
        encore_id = yt_id(ep["encore"]["url"])
        if encore_id:
            ids.insert(min(idx, len(ids)), encore_id)
            notify("Encore queued 🕯️")

    pl = xbmc.PlayList(xbmc.PLAYLIST_VIDEO)
    pl.clear()
    for v in ids:
        pl.add(yt_video(v))
    xbmc.Player().play(pl)

def fallback():
    notify("Using fallback list")
    for title, url in FALLBACK_EPISODES:
        vid = yt_id(url)
        if vid:
            add_item(title, yt_video(vid))
    end_dir()

def router():
    params = dict(urllib.parse.parse_qsl(sys.argv[2][1:])) if len(sys.argv) > 2 else {}

    if params.get("action") == "queue":
        eps = load_episodes()
        try:
            play_queue(eps[int(params.get("idx"))])
        except Exception as e:
            log("Queue failed: " + str(e))
            notify("Queue failed")
        return

    eps = load_episodes()
    if not eps:
        fallback()
        return

    render(eps)
    end_dir()

router()
