import xbmc
import xbmcgui
import xbmcplugin
import sys

handle = int(sys.argv[1])

EPISODES = [
    ("Nirvana – MTV Unplugged (1993)", "https://www.youtube.com/watch?v=hEMm7gxBYSc"),
    ("Alice In Chains – MTV Unplugged (1996)", "https://www.youtube.com/watch?v=9EKi2E9dVY8"),
    ("Pearl Jam – MTV Unplugged (1992)", "https://www.youtube.com/watch?v=VmeZ3kOgIOE"),
    ("Stone Temple Pilots – Unplugged", "https://www.youtube.com/watch?v=HVPzWkdhwrw"),
    ("Eric Clapton – Unplugged", "https://www.youtube.com/watch?v=pkEkjrJcXKQ"),
    ("Foo Fighters – Skin and Bones", "https://www.youtube.com/watch?v=4n7Zp8pTzKY"),
    ("Chris Cornell – Songbook", "https://www.youtube.com/watch?v=Eo-UKCxCglg"),
    ("Neil Young – Unplugged", "https://www.youtube.com/watch?v=V1GZ9p9z6D0"),
    ("Paul McCartney – Unplugged", "https://www.youtube.com/watch?v=Z9Y5nY4Y7oU"),
    ("A-ha – MTV Unplugged", "https://www.youtube.com/watch?v=-xKM3mGt2pE"),
    ("Oasis – Unplugged", "https://www.youtube.com/watch?v=2x4gqV2v4Hc"),
    ("LL Cool J – MTV Unplugged", "https://www.youtube.com/watch?v=9p8nF7t9x5Y"),
    ("Korn – MTV Unplugged", "https://www.youtube.com/watch?v=K8J9xKk8bQk"),
    ("Jay-Z – MTV Unplugged", "https://www.youtube.com/watch?v=ZyEukYbCjvY"),
    ("R.E.M. – Unplugged", "https://www.youtube.com/watch?v=J7o3V8Jc9Wk"),
    ("The Cure – Unplugged", "https://www.youtube.com/watch?v=Y7ZxqE5x9Zk"),
    ("Bush – Unplugged", "https://www.youtube.com/watch?v=9s2YkQ7E1bE"),
    ("Shawn Mendes – MTV Unplugged", "https://www.youtube.com/watch?v=5j6E9p0Jv8M"),
    ("Twenty One Pilots – Unplugged", "https://www.youtube.com/watch?v=JH6Jk8QzQk8"),
    ("Rod Stewart – Unplugged", "https://www.youtube.com/watch?v=8p8n8ZQp9Jk"),
    ("George Michael – Unplugged", "https://www.youtube.com/watch?v=8Z8E7QzJ9kQ"),
    ("Lauryn Hill – MTV Unplugged", "https://www.youtube.com/watch?v=Yz9QkE8Jk9Q"),
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
