# -*- coding: utf-8 -*-
import sys
import json
import re
import time
import urllib.request
import urllib.parse

import xbmc
import xbmcgui
import xbmcplugin

HANDLE = int(sys.argv[1])

# ====== CHANGE THIS to your live Netlify site ======
SITE = "https://mellifluous-tanuki-51d911.netlify.app"

# ✅ ONE SOURCE OF TRUTH (cache-busted every run)
EP_URL = SITE + "/episodes.json?nocache=" + str(int(time.time()))

UA = "Kodi/21 JoeysAcousticCorner"

# ====== FALLBACK (only if JSON is unreachable) ======
FALLBACK_EPISODES = [
    ("Nirvana — MTV Unplugged (Full Session)", "https://youtu.be/pOTkCgkxqyg"),
    ("Alice In Chains — MTV Unplugged (Full Session)", "https://youtu.be/Jprla2NvHY0"),
]

# ✅ SmartTube package name (stable)
SMARTTUBE_PKG = "org.smarttube.stable"

def log(msg):
    xbmc.log(f"[JAC] {msg}", xbmc.LOGINFO)

def notify(msg):
    xbmcgui.Dialog().notification("Joey’s Acoustic Corner", msg, xbmcgui.NOTIFICATION_INFO, 4000)

def http_get_json(url):
    headers = {
        "User-Agent": UA,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    req = urllib.request.Request(url, headers=headers)
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

def to_youtube_watch_url(url):
    """
    Ensure we pass SmartTube a normal YouTube URL it can handle.
    - video: https://www.youtube.com/watch?v=VIDEO_ID
    - playlist: https://www.youtube.com/playlist?list=PLAYLIST_ID
    """
    if not url:
        return None

    pid = playlist_id_from_url(url)
    if pid and "playlist" in url:
        return f"https://www.youtube.com/playlist?list={pid}"

    vid = yt_id_from_url(url)
    if vid:
        return f"https://www.youtube.com/watch?v={vid}"

    # If it's already some valid YouTube link, just pass it through.
    if "youtube.com" in url or "youtu.be" in url:
        return url

    return None

def open_in_smarttube(youtube_url):
    if not youtube_url:
        notify("Bad/empty YouTube URL.")
        return

    # Kodi builtin: StartAndroidActivity(package, intent, dataType, dataURI)
    cmd = f'StartAndroidActivity({SMARTTUBE_PKG},android.intent.action.VIEW,,{youtube_url})'
    log("Launching SmartTube: " + youtube_url)
    xbmc.executebuiltin(cmd)

def add_item(label, action=None, params=None, is_folder=False, info=None):
    li = xbmcgui.ListItem(label=label)

    # Add metadata so skins can show Artist properly
    if info:
        try:
            li.setInfo("video", info)
        except Exception:
            pass

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
        log("EP_URL USED: " + EP_URL)
        data = http_get_json(EP_URL)
        if isinstance(data, list):
            log(f"Loaded JSON OK ({len(data)} items)")
            return data
        log("JSON was not a list (bad format).")
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

def get_track_urls(ep):
    tracks = ep.get("tracks", []) or []
    urls = []

    for t in tracks:
        u = (t or {}).get("url", "")
        nice = to_youtube_watch_url(u)
        if nice:
            urls.append(nice)

    # Encore insertion (if used later)
    if has_encore(ep):
        after_idx = ep.get("encoreAfterTrackIndex")
        encore_url = (ep.get("encore") or {}).get("url")
        nice_encore = to_youtube_watch_url(encore_url)
        if nice_encore:
            insert_at = max(0, min(len(urls), after_idx + 1))
            urls.insert(insert_at, nice_encore)

    return urls

def is_playlist_episode(ep):
    tracks = ep.get("tracks", []) or []
    if not tracks:
        return False
    url = (tracks[0] or {}).get("url", "")
    return bool(playlist_id_from_url(url))

def root_menu(eps):
    for idx, ep in enumerate(eps):
        title = ep.get("title", "Untitled")
        artist = ep.get("artist", "") or ""
        mode = str(ep.get("mode", "")).lower()

        if has_encore(ep):
            title = title + "  🕯️"

        # If title doesn't already include artist, prefix it
        display_title = title
        if artist and (artist.lower() not in title.lower()):
            display_title = f"{artist} — {title}"

        info = {
            "title": title,
            "artist": artist,
        }

        # ✅ Playlists: offer Play + Browse
        if is_playlist_episode(ep):
            add_item(f"{display_title} (▶ Play Playlist)", action="open_playlist", params={"idx": str(idx)}, is_folder=False, info=info)
            add_item(f"{display_title} (📂 Browse Videos)", action="browse_playlist", params={"idx": str(idx)}, is_folder=True, info=info)
            continue

        # ✅ Fullshow: open SmartTube (no Kodi playback)
        if mode == "fullshow":
            add_item(f"{display_title} (▶ Play)", action="open_fullshow", params={"idx": str(idx)}, is_folder=False, info=info)

        # ✅ Queue: browse tracks
        elif mode == "queue":
            add_item(display_title, action="browse_queue", params={"idx": str(idx)}, is_folder=True, info=info)

        else:
            add_item(f"{display_title} (▶ Play)", action="open_fullshow", params={"idx": str(idx)}, is_folder=False, info=info)

    end_dir()

def browse_queue(eps, idx):
    try:
        idx = int(idx)
        ep = eps[idx]
    except Exception:
        notify("Bad queue index.")
        end_dir()
        return

    title = ep.get("title", "Untitled")
    artist = ep.get("artist", "") or ""

    # NOTE: SmartTube can't accept a whole Kodi playlist cleanly.
    # We'll still provide a "Play First Track" shortcut.
    add_item("▶ Play First Track (SmartTube)", action="open_queue_first", params={"idx": str(idx)}, is_folder=False)

    tracks = ep.get("tracks", []) or []
    urls = get_track_urls(ep)

    for i, u in enumerate(urls):
        tname = "Track"
        if i < len(tracks):
            tname = (tracks[i] or {}).get("title", "Track")
        else:
            encore_title = ((ep.get("encore") or {}).get("title")) or "Encore"
            tname = encore_title + " 🕯️"

        # ✅ Add artist prefix so you SEE the artist in the list too
        label = f"{i+1}. {tname}"
        if artist:
            label = f"{i+1}. {artist} — {tname}"

        info = {"title": tname, "artist": artist}
        add_item(label, action="open_url", params={"url": u}, is_folder=False, info=info)

    end_dir()

def browse_playlist(eps, idx):
    try:
        idx = int(idx)
        ep = eps[idx]
    except Exception:
        notify("Bad item.")
        end_dir()
        return

    tracks = ep.get("tracks", []) or []
    if not tracks:
        notify("No playlist link.")
        end_dir()
        return

    raw = (tracks[0] or {}).get("url", "")
    pid = playlist_id_from_url(raw)
    if not pid:
        notify("Bad playlist link.")
        end_dir()
        return

    # We can't list playlist items without API (and you said NO API drama ✅),
    # so browse just becomes "open playlist in SmartTube".
    playlist_url = f"https://www.youtube.com/playlist?list={pid}"
    add_item("▶ Open Playlist in SmartTube", action="open_url", params={"url": playlist_url}, is_folder=False)
    end_dir()

def open_fullshow(eps, idx):
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

    raw = (tracks[0] or {}).get("url", "")
    nice = to_youtube_watch_url(raw)
    if not nice:
        notify("Bad YouTube link.")
        return

    open_in_smarttube(nice)

def open_playlist(eps, idx):
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

    raw = (tracks[0] or {}).get("url", "")
    pid = playlist_id_from_url(raw)
    if not pid:
        notify("Bad playlist link.")
        return

    playlist_url = f"https://www.youtube.com/playlist?list={pid}"
    open_in_smarttube(playlist_url)

def open_queue_first(eps, idx):
    try:
        idx = int(idx)
        ep = eps[idx]
    except Exception:
        notify("Bad queue.")
        return

    urls = get_track_urls(ep)
    if not urls:
        notify("No playable tracks in this queue.")
        return

    open_in_smarttube(urls[0])
    notify("Tip: pick any track from the list to play it in SmartTube.")

def open_url(url):
    open_in_smarttube(url)

def render_fallback():
    notify("Using fallback list (JSON not reachable).")
    for title, url in FALLBACK_EPISODES:
        nice = to_youtube_watch_url(url)
        if nice:
            add_item(title + " (▶ Play)", action="open_url", params={"url": nice}, is_folder=False)
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

    if action == "open_url":
        open_url(params.get("url"))
        return

    if action == "open_fullshow":
        open_fullshow(eps, params.get("idx"))
        return

    if action == "open_playlist":
        open_playlist(eps, params.get("idx"))
        return

    if action == "browse_playlist":
        browse_playlist(eps, params.get("idx"))
        return

    if action == "open_queue_first":
        open_queue_first(eps, params.get("idx"))
        return

    root_menu(eps)

router()
