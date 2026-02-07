import xbmc
import xbmcgui
import xbmcplugin
import sys
import json
import urllib.request

BASE_URL = sys.argv[0]
HANDLE = int(sys.argv[1])
EPISODES_URL = "https://mellifluous-tanuki-51d911.netlify.app/episodes.json"

def fetch_episodes():
    with urllib.request.urlopen(EPISODES_URL) as r:
        return json.loads(r.read().decode("utf-8"))

def add_folder(label, mode):
    url = f"{BASE_URL}?mode={mode}"
    li = xbmcgui.ListItem(label)
    li.setArt({"icon": "DefaultFolder.png"})
    xbmcplugin.addDirectoryItem(HANDLE, url, li, True)

def add_video(title, url):
    li = xbmcgui.ListItem(title)
    li.setProperty("IsPlayable", "true")
    xbmcplugin.addDirectoryItem(HANDLE, url, li, False)

def list_categories():
    add_folder("Full Sessions", "full")
    add_folder("Queues", "queue")
    add_folder("Playlists", "playlist")
    xbmcplugin.endOfDirectory(HANDLE)

def list_items(mode):
    episodes = fetch_episodes()
    found = False
    for ep in episodes:
        ep_mode = ep.get("mode", "").lower()
        if ep_mode in ("fullshow", "full") and mode == "full":
            found = True
        elif ep_mode == mode:
            found = True
        else:
            continue

        for t in ep["tracks"]:
            add_video(f"{ep['artist']} — {ep['title']}", t["url"])

    if not found:
        xbmcgui.Dialog().notification(
            "Joey’s Acoustic Corner",
            "No items found for this category",
            xbmcgui.NOTIFICATION_INFO,
            4000
        )

    xbmcplugin.endOfDirectory(HANDLE)

params = dict(p.split("=") for p in sys.argv[2][1:].split("&") if "=" in p)
mode = params.get("mode")

if mode:
    list_items(mode)
else:
    list_categories()
