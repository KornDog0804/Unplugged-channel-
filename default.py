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

# ✅ ONE SOURCE OF TRUTH (NOT master_22)
# Put your real JSON at site root as: /episodes.json
EP_URL = SITE + "/episodes.json"

UA = "Kodi/21 JoeysAcousticCorner"

# ====== HARD-CODED FALLBACK (only if JSON is unreachable) ======
FALLBACK_EPISODES = [
    ("Nirvana — MTV Unplugged (Full Session)", "https://youtu.be/pOTkCgkxqyg"),
    ("Alice In Chains — MTV Unplugged (Full Session)", "https://youtu.be/Jprla2NvHY0"),
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
    return f"plugin://plugin.video.youtube/play/?video_id={video_id}"

def youtube_play_playlist(playlist_id):
    return f"plugin://plugin.video.youtube/play/?playlist_id={playlist_id}"

def add_item(label, action=None, params=None, is_folder=False, playable=False):
    li = xbmcgui.ListItem(label=label)
    if playable:
        li.setProperty("IsPlayable", "true")

    url = sys.argv[0]
    if action:
        q = {"action": action}
        if params:
            q.update(params)
        url = url + "?" + urllib.parse.urlencode(q)

    xbmcplugin.addDirectoryItem(HANDLE, url, li, isFolder=is_folder)

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

def has_encore(ep):
    try:
        mode = str(ep.get("mode", "")).lower()
        encore = ep.get("encore") or {}
        encore_url = encore.get("url")
        after_idx = ep.get("encoreAfterTrackIndex")
        return (mode == "queue" and encore_url and isinstance(after_idx, int))
    except Exception:
        return False

def get_track_video_ids(ep):
    tracks = ep.get("tracks", []) or []
    ids = []
    for t in tracks:
        url = (t or {}).get("url", "")
        vid = yt_id_from_url(url)
        if vid:
            ids.append(vid)

    # ✅ Brad-only encore injected as an extra track (Kodi-safe)
    if has_encore(ep):
        after_idx = ep.get("encoreAfterTrackIndex")
        encore_url = (ep.get("encore") or {}).get("url")
        encore_id = yt_id_from_url(encore_url)
        if encore_id:
            insert_at = max(0, min(len(ids), after_idx + 1))
            ids.insert(insert_at, encore_id)
    return ids

def root_menu(eps):
    # Shows list
    for idx, ep in enumerate(eps):
        title = ep.get("title", "Untitled")
        mode = str(ep.get("mode", "")).lower()

        # Candle marker if encore exists
        if has_encore(ep):
            title = title + "  🕯️"

        if mode == "playlist":
            # play playlist directly
            tracks = ep.get("tracks", []) or []
            if not tracks:
                continue
            pid = playlist_id_from_url((tracks[0] or {}).get("url", ""))
            if not pid:
                continue
            # playable item (not a folder)
            add_item(title, action="play_playlist", params={"idx": str(idx)}, playable=True, is_folder=False)

        elif mode == "fullshow":
            add_item(title, action="play_fullshow", params={"idx": str(idx)}, playable=True, is_folder=False)

        elif mode == "queue":
            # ✅ queue becomes a folder of tracks (NO crash)
            add_item(title, action="browse_queue", params={"idx": str(idx)}, playable=False, is_folder=True)

        else:
            # unknown mode -> treat as fullshow if possible
            add_item(title, action="play_fullshow", params={"idx": str(idx)}, playable=True, is_folder=False)

    end_dir()

def browse_queue(eps, idx):
    try:
        idx = int(idx)
        ep = eps[idx]
    except Exception:
        notify("Bad queue index.")
        end_dir()
        return

    title = ep.get("title", "Queue")
    add_item("▶ Play All (Queue)", action="play_queue_all", params={"idx": str(idx)}, playable=True, is_folder=False)

    # list each track
    tracks = ep.get("tracks", []) or []
    ids = get_track_video_ids(ep)

    # If we injected encore, the ids list may be longer than tracks list.
    # We'll label injected encore nicely.
    injected_encore = has_encore(ep)
    encore_inserted = injected_encore and len(ids) > len(tracks)

    # Build track labels
    for i, vid in enumerate(ids):
        label = f"{i+1}. Track"
        if i < len(tracks):
            label = f"{i+1}. {(tracks[i] or {}).get('title', 'Track')}"
        else:
            # this is the injected encore
            encore_title = ((ep.get("encore") or {}).get("title")) or "Encore"
            label = f"{i+1}. {encore_title} 🕯️"

        add_item(label, action="play_video", params={"video_id": vid}, playable=True, is_folder=False)

    end_dir()

def play_video(video_id):
    if not video_id:
        notify("Missing video id.")
        return
    xbmc.Player().play(youtube_play_video(video_id))

def play_fullshow(eps, idx):
    try:
        idx = int(idx)
        ep = eps[idx]
    except Exception:
        notify("Bad item.")
        return

    tracks = ep.get("tracks", []) or []
    if not tracks:
        notify("No tracks.")
        return
    vid = yt_id_from_url((tracks[0] or {}).get("url", ""))
    if not vid:
        notify("Bad YouTube link.")
        return
    xbmc.Player().play(youtube_play_video(vid))

def play_playlist(eps, idx):
    try:
        idx = int(idx)
        ep = eps[idx]
    except Exception:
        notify("Bad item.")
        return

    tracks = ep.get("tracks", []) or []
    if not tracks:
        notify("No playlist link.")
        return
    pid = playlist_id_from_url((tracks[0] or {}).get("url", ""))
    if not pid:
        notify("Bad playlist link.")
        return
    xbmc.Player().play(youtube_play_playlist(pid))

def play_queue_all(eps, idx):
    try:
        idx = int(idx)
        ep = eps[idx]
    except Exception:
        notify("Bad queue.")
        return

    ids = get_track_video_ids(ep)
    if not ids:
        notify("No playable tracks in this queue.")
        return

    pl = xbmc.PlayList(xbmc.PLAYLIST_VIDEO)
    pl.clear()

    for vid in ids:
        pl.add(youtube_play_video(vid))

    xbmc.Player().play(pl)

def render_fallback():
    notify("Using fallback list (JSON not reachable).")
    for title, url in FALLBACK_EPISODES:
        vid = yt_id_from_url(url)
        if vid:
            li = xbmcgui.ListItem(label=title)
            li.setProperty("IsPlayable", "true")
            xbmcplugin.addDirectoryItem(HANDLE, youtube_play_video(vid), li, isFolder=False)
    end_dir()

def router():
    params = {}
    if len(sys.argv) > 2 and sys.argv[2]:
        params = dict(urllib.parse.parse_qsl(sys.argv[2][1:]))

    action = params.get("action")

    eps = load_episodes()
    if not eps:
        render_fallback()
        return

    if action == "browse_queue":
        browse_queue(eps, params.get("idx"))
        return

    if action == "play_video":
        play_video(params.get("video_id"))
        return

    if action == "play_fullshow":
        play_fullshow(eps, params.get("idx"))
        return

    if action == "play_playlist":
        play_playlist(eps, params.get("idx"))
        return

    if action == "play_queue_all":
        play_queue_all(eps, params.get("idx"))
        return

    # default
    root_menu(eps)

router()
