import xbmc
import xbmcgui
import xbmcplugin
import sys

handle = int(sys.argv[1])

EPISODES = [
    ("Nirvana – Unplugged", "https://www.youtube.com/watch?v=hEMm7gxBYSc"),
    ("Alice In Chains – Unplugged", "https://www.youtube.com/watch?v=9EKi2E9dVY8"),
    ("Pearl Jam – Unplugged", "https://www.youtube.com/watch?v=VmeZ3kOgIOE"),
    # you can add all 22 here safely
]

for title, url in EPISODES:
    li = xbmcgui.ListItem(label=title)
    li.setProperty("IsPlayable", "true")
    xbmcplugin.addDirectoryItem(
        handle,
        url,
        li,
        isFolder=False
    )

xbmcplugin.endOfDirectory(handle)
