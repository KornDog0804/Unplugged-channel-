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

# ====== FALLBACK (only used if JSON can't load) ======
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
    # requires plugin.video.youtube installed
    return f"plugin://plugin.video.youtube/play/?video_id={video_id}"

def youtube_play_playlist(playlist_id):
    return f"plugin://plugin.video.youtube/play/?playlist_id={playlist_id}"

def add_playable(label, path):
    li = xbmcgui.ListItem(label=label)
    li.setProperty("IsPlayable", "true")
    xbmcplugin.addDirectoryItem(HANDLE, path, li, isFolder=False)

def end_dir():
    xbmcplugin.endOfDirectory(HANDLE, cacheToDisc=False)

def load_episodes():
    # Expected JSON format:
    # [
    #   { title, artist, year, mode, tracks:[{title,url}, ...],
    #     encore: { title?, url }, encoreAfterTrackIndex: 2
    #   },
    #   ...
    # ]
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

# ✅ NO MORE "ep={big json}" in the URL
# We only pass the index.
def build_queue_run_url(idx):
    qs = urllib.parse.urlencode({"action": "play_queue", "idx": str(idx)})
    return sys.argv[0] + "?" + qs

def render_from_json(eps):
    count = 0
    for i, ep in enumerate(eps):
        title = ep.get("title", "Untitled")
        mode = str(ep.get("mode", "")).lower()
        tracks = ep.get("tracks", []) or []

        # Brad-only marker if encore exists
        if has_encore(ep):
            title = title + "  🕯️"

        # Playlist
        if mode == "playlist":
            if not tracks:
                continue
            pid = playlist_id_from_url((tracks[0] or {}).get("url", ""))
            if not pid:
                continue
            add_playable(title, youtube_play_playlist(pid))
            count += 1
            continue

        # Fullshow: play first track
        if mode == "fullshow":
            if not tracks:
                continue
            vid = yt_id_from_url((tracks[0] or {}).get("url", ""))
            if not vid:
                continue
            add_playable(title, youtube_play_video(vid))
            count += 1
            continue

        # Queue: play via idx (safe)
        if mode == "queue":
            add_playable(title + "  (Queue)", build_queue_run_url(i))
            count += 1
            continue

    return count

def play_queue(ep):
    tracks = ep.get("tracks", []) or []

    ids = []
    for t in tracks:
        vid = yt_id_from_url((t or {}).get("url", ""))
        if vid:
            ids.append(vid)

    if not ids:
        notify("No playable tracks in this queue.")
        return

    # ✅ Encore injection if defined
    if has_encore(ep):
        after_idx = ep.get("encoreAfterTrackIndex")  # 0-based
        encore_url = (ep.get("encore") or {}).get("url")
        encore_id = yt_id_from_url(encore_url)

        if encore_id:
            insert_at = after_idx + 1
            if insert_at < 0:
                insert_at = len(ids)
            if insert_at > len(ids):
                insert_at = len(ids)
            ids.insert(insert_at, encore_id)
            notify("Encore queued for Brad 🕯️")

    pl = xbmc.PlayList(xbmc.PLAYLIST_VIDEO)
    pl.clear()

    for vid in ids:
        pl.add(youtube_play_video(vid))

    xbmc.Player().play(pl)

def render_fallback():
    notify("Using fallback list (JSON not reachable).")
    for title, url in FALLBACK_EPISODES:
        vid = yt_id_from_url(url)
        if not vid:
            continue
        add_playable(title, youtube_play_video(vid))
    end_dir()

def router():
    params = {}
    if len(sys.argv) > 2 and sys.argv[2]:
        params = dict(urllib.parse.parse_qsl(sys.argv[2][1:]))

    action = params.get("action")

    if action == "play_queue":
        idx = safe_int(params.get("idx"), default=None)
        eps = load_episodes()
        if not eps or idx is None or idx < 0 or idx >= len(eps):
            notify("Queue item not found.")
            return
        play_queue(eps[idx])
        return

    # Default: show listing
    eps = load_episodes()
    if not eps:
        render_fallback()
        return

    count = render_from_json(eps)
    if not count:
        notify("JSON loaded but no playable items found.")
    end_dir()

router()
