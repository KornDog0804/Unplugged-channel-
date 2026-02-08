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

# ====== CHANGE THIS to your live Netlify site ======
SITE = "https://mellifluous-tanuki-51d911.netlify.app"

# Kodi should read JSON (NOT episodes.js)
# Put this file at your site root (recommended):
#   /episodes.json   OR   /episodes_MASTER_22.json
EP_URL = SITE + "/episodes_MASTER_22.json"

UA = "Kodi/21 JoeysAcousticCorner"

# ====== HARD-CODED FALLBACK (keeps you alive if JSON is down) ======
FALLBACK_EPISODES = [
    ("Nirvana — MTV Unplugged (Full Session)", "https://youtu.be/pOTkCgkxqyg"),
    ("Alice In Chains — MTV Unplugged (Full Session)", "https://youtu.be/Jprla2NvHY0"),
    ("Pearl Jam — MTV Unplugged (Full Session)", "https://youtu.be/P9fPF204icg"),
    ("Stone Temple Pilots — Acoustic Full Show (4K)", "https://youtu.be/Apok0654Qnc"),
    ("JAY-Z — Unplugged / Live (Full Session)", "https://youtu.be/r2I_pGlvtAY"),
    ("Korn — MTV Unplugged (Full Session)", "https://youtu.be/El8-JgiqcUI"),
    ("Corey Taylor — Acoustic Session", "https://youtu.be/uetFO7y8WPA"),
    ("Papa Roach — WRIF Acoustic Set (Full Session)", "https://www.youtube.com/watch?v=f4BK60WVPac"),
    # Add more if you want, but ideally JSON handles it.
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

    # youtu.be/ID
    m = re.search(r"youtu\.be/([A-Za-z0-9_\-]+)", url)
    if m:
        return m.group(1)

    # youtube.com/watch?v=ID
    m = re.search(r"[?&]v=([A-Za-z0-9_\-]+)", url)
    if m:
        return m.group(1)

    # youtube.com/embed/ID
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
    # requires plugin.video.youtube installed (you already have it)
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
    # JSON format expected:
    # [
    #   { title, artist, year, mode, tracks:[{title,url}, ...] },
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

def render_from_json(eps):
    count = 0

    for ep in eps:
        title = ep.get("title", "Untitled")
        mode = str(ep.get("mode", "")).lower()
        tracks = ep.get("tracks", []) or []

        # Playlists (one URL with list=)
        if mode == "playlist":
            if not tracks:
                continue
            pid = playlist_id_from_url(tracks[0].get("url", ""))
            if not pid:
                continue
            add_playable(title, youtube_play_playlist(pid))
            count += 1
            continue

        # Fullshow: play first track
        if mode == "fullshow":
            if not tracks:
                continue
            vid = yt_id_from_url(tracks[0].get("url", ""))
            if not vid:
                continue
            add_playable(title, youtube_play_video(vid))
            count += 1
            continue

        # Queue: play as a stitched Kodi playlist (no skipping)
        if mode == "queue":
            # We add it as a playable item that triggers queue playback
            # (Simpler menu; still matches your site)
            add_playable(title + "  (Queue)", build_queue_run_url(ep))
            count += 1
            continue

    return count

def build_queue_run_url(ep):
    # We pass the episode object via querystring (encoded JSON)
    payload = urllib.parse.quote(json.dumps(ep))
    return sys.argv[0] + "?" + urllib.parse.urlencode({"action": "play_queue", "ep": payload})

def play_queue(ep):
    tracks = ep.get("tracks", []) or []
    ids = []
    for t in tracks:
        vid = yt_id_from_url(t.get("url", ""))
        if vid:
            ids.append(vid)

    if not ids:
        notify("No playable tracks in this queue.")
        return

    pl = xbmc.PlayList(xbmc.PLAYLIST_VIDEO)
    pl.clear()

    # Add in order — starts at track 1 (index 0) ✅
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
        ep_raw = params.get("ep", "")
        try:
            ep_json = urllib.parse.unquote(ep_raw)
            ep = json.loads(ep_json)
            play_queue(ep)
        except Exception as e:
            log(f"Queue play failed: {e}")
            notify("Queue play failed.")
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
