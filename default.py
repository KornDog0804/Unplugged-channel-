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

# ====== Your live Netlify site ======
SITE = "https://mellifluous-tanuki-51d911.netlify.app"

# ✅ ONE SOURCE FOR BOTH SITE + KODI
# Put this at your site root:
#   /episodes.json
EP_URL = SITE + "/episodes.json"

UA = "Kodi/21 JoeysAcousticCorner"

FALLBACK_EPISODES = [
    ("Nirvana — MTV Unplugged (Full Session)", "https://youtu.be/pOTkCgkxqyg"),
    ("Alice In Chains — MTV Unplugged (Full Session)", "https://youtu.be/Jprla2NvHY0"),
    ("Pearl Jam — MTV Unplugged (Full Session)", "https://youtu.be/P9fPF204icg"),
    ("Stone Temple Pilots — Acoustic Full Show (4K)", "https://youtu.be/Apok0654Qnc"),
    ("JAY-Z — Unplugged / Live (Full Session)", "https://youtu.be/r2I_pGlvtAY"),
    ("Korn — MTV Unplugged (Full Session)", "https://youtu.be/El8-JgiqcUI"),
    ("Corey Taylor — Acoustic Session", "https://youtu.be/uetFO7y8WPA"),
    ("Papa Roach — WRIF Acoustic Set (Full Session)", "https://www.youtube.com/watch?v=f4BK60WVPac"),
]

def log(msg):
    xbmc.log(f"[JAC] {msg}", xbmc.LOGINFO)

def notify(msg):
    xbmcgui.Dialog().notification("Joey’s Acoustic Corner", msg, xbmcgui.NOTIFICATION_INFO, 4000)

def http_get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = resp.read().decode("utf-8")
        return json.loads(data)

def yt_id_from_url(url):
    if not url:
        return None
    m = re.search(r"youtu\.be/([A-Za-z0-9_\-]+)", url)
    if m:
        return m.group(1)
    m = re.search(r"[?&]v=([A-Za-z0-9_\-]+)", url)
    if m:
        return m.group(1)
    m = re.search(r"/embed/([A-Za-z0-9_\-]+)", url)
    if m:
        return m.group(1)
    return None

def playlist_id_from_url(url):
    if not url:
        return None
    m = re.search(r"[?&]list=([A-Za-z0-9_\-]+)", url)
    return m.group(1) if m else None

def youtube_play_video(video_id):
    return f"plugin://plugin.video.youtube/play/?video_id={video_id}"

def youtube_play_playlist(playlist_id):
    return f"plugin://plugin.video.youtube/play/?playlist_id={playlist_id}"

def add_playable(label, path):
    li = xbmcgui.ListItem(label=label)
    li.setProperty("IsPlayable", "true")
    xbmcplugin.addDirectoryItem(HANDLE, path, li, isFolder=False)

def add_folder(label, path):
    li = xbmcgui.ListItem(label=label)
    xbmcplugin.addDirectoryItem(HANDLE, path, li, isFolder=True)

def end_dir():
    xbmcplugin.endOfDirectory(HANDLE, cacheToDisc=False)

def load_episodes():
    try:
        data = http_get_json(EP_URL)
        if isinstance(data, list):
            return data
        return None
    except Exception as e:
        log(f"JSON fetch failed: {e}")
        return None

def safe_int(v, default=None):
    try:
        return int(v)
    except Exception:
        return default

def has_encore(ep):
    try:
        mode = str(ep.get("mode", "")).lower()
        encore = ep.get("encore") or {}
        encore_url = encore.get("url")
        after_idx = ep.get("encoreAfterTrackIndex")
        return (mode == "queue" and encore_url and isinstance(after_idx, int))
    except Exception:
        return False

def build_url(action, **kwargs):
    qs = urllib.parse.urlencode({"action": action, **kwargs})
    return sys.argv[0] + "?" + qs

# ---------- RENDER ROOT ----------
def render_root(eps):
    count = 0
    for i, ep in enumerate(eps):
        title = ep.get("title", "Untitled")
        mode = str(ep.get("mode", "")).lower()
        tracks = ep.get("tracks", []) or []

        if has_encore(ep):
            title = title + "  🕯️"

        if mode == "playlist":
            if not tracks:
                continue
            pid = playlist_id_from_url((tracks[0] or {}).get("url", ""))
            if not pid:
                continue
            add_playable(title, youtube_play_playlist(pid))
            count += 1
            continue

        if mode == "fullshow":
            if not tracks:
                continue
            vid = yt_id_from_url((tracks[0] or {}).get("url", ""))
            if not vid:
                continue
            add_playable(title, youtube_play_video(vid))
            count += 1
            continue

        # ✅ Queue becomes a folder (stable)
        if mode == "queue":
            add_folder(title + "  (Queue)", build_url("open_queue", idx=str(i)))
            count += 1
            continue

    return count

# ---------- QUEUE FOLDER ----------
def open_queue(eps, idx):
    if idx < 0 or idx >= len(eps):
        notify("Queue not found.")
        return

    ep = eps[idx]
    title = ep.get("title", "Queue")
    tracks = ep.get("tracks", []) or []

    xbmcplugin.setPluginCategory(HANDLE, title)

    # Track items
    n = 0
    for t in tracks:
        url = (t or {}).get("url", "")
        name = (t or {}).get("title", f"Track {n+1}")
        vid = yt_id_from_url(url)
        if not vid:
            continue
        add_playable(f"{n+1}. {name}", youtube_play_video(vid))
        n += 1

    # Encore item (separate, stable)
    if has_encore(ep):
        encore = ep.get("encore") or {}
        encore_vid = yt_id_from_url(encore.get("url"))
        if encore_vid:
            add_playable("Encore 🕯️ — " + (encore.get("title") or "Encore"), youtube_play_video(encore_vid))

    if n == 0:
        notify("No playable tracks found in this queue.")

    end_dir()

# ---------- FALLBACK ----------
def render_fallback():
    notify("Using fallback list (JSON not reachable).")
    for title, url in FALLBACK_EPISODES:
        vid = yt_id_from_url(url)
        if vid:
            add_playable(title, youtube_play_video(vid))
    end_dir()

# ---------- ROUTER ----------
def router():
    params = {}
    if len(sys.argv) > 2 and sys.argv[2]:
        params = dict(urllib.parse.parse_qsl(sys.argv[2][1:]))

    action = params.get("action")

    eps = load_episodes()
    if not eps:
        render_fallback()
        return

    if action == "open_queue":
        idx = safe_int(params.get("idx"), default=-1)
        open_queue(eps, idx)
        return

    # Default: root listing
    count = render_root(eps)
    if not count:
        notify("JSON loaded but no playable items found.")
    end_dir()

router()
