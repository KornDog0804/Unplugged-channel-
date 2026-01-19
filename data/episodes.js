// data/episodes.js
// Unplugged Channel — Final Top 5
// Classic script, exposed globally for app.js

const EPISODES = [

  // 1️⃣ Alice In Chains — MTV Unplugged (1996)
  {
    id: "aic-unplugged-1996",
    artist: "Alice In Chains",
    year: 1996,
    intro: "candle",
    mode: "tracks",
    tracks: [
      { title: "Nutshell", url: "https://www.youtube.com/watch?v=9EKi2E9dVY8" },
      { title: "Brother", url: "https://www.youtube.com/watch?v=1hnRTfzbT_s" },
      { title: "No Excuses", url: "https://www.youtube.com/watch?v=V-scGZMgxp8" },
      { title: "Sludge Factory", url: "https://www.youtube.com/watch?v=jB2dyxANqKg" },
      { title: "Down in a Hole", url: "https://www.youtube.com/watch?v=nWK0kqjPSVI" },
      { title: "Angry Chair", url: "https://www.youtube.com/watch?v=FSlcR2Fnk_o" },
      { title: "Rooster", url: "https://www.youtube.com/watch?v=jUahBnEkIw8" },
      { title: "Got Me Wrong", url: "https://www.youtube.com/watch?v=jmtRHsriJTQ" },
      { title: "Heaven Beside You", url: "https://www.youtube.com/watch?v=hmUH6MFolm4" },
      { title: "Would?", url: "https://www.youtube.com/watch?v=mOJEcEkR1a8" },
      { title: "Frogs", url: "https://www.youtube.com/watch?v=x7r6XgjVdMY" },
      { title: "Over Now", url: "https://www.youtube.com/watch?v=sV_-8KIXyPs" },
      { title: "The Killer Is Me", url: "https://www.youtube.com/watch?v=JztnWfB3sfY" }
    ]
  },

  // 2️⃣ Nirvana — MTV Unplugged in New York (1993)
  {
    id: "nirvana-unplugged-1993",
    artist: "Nirvana",
    year: 1993,
    intro: "candle",
    mode: "tracks",
    tracks: [
      { title: "About a Girl", url: "https://www.youtube.com/watch?v=_24pJQUj7zg" },
      { title: "Come As You Are", url: "https://www.youtube.com/watch?v=z9LiPuVRyU8" },
      { title: "Jesus Doesn't Want Me for a Sunbeam", url: "https://www.youtube.com/watch?v=rfXqT8rfs9Q" },
      { title: "The Man Who Sold the World", url: "https://www.youtube.com/watch?v=fregObNcHC8" },
      { title: "Pennyroyal Tea", url: "https://www.youtube.com/watch?v=4VxdufqB9zg" },
      { title: "Dumb", url: "https://www.youtube.com/watch?v=5YeyG9G3G1M" },
      { title: "All Apologies", url: "https://www.youtube.com/watch?v=ZJ6yqQyG2fY" },
      { title: "Where Did You Sleep Last Night", url: "https://www.youtube.com/watch?v=hEMm7gxBYSc" }
    ]
  },

  // 3️⃣ Pearl Jam — MTV Unplugged (1992)
  {
    id: "pearljam-unplugged-1992",
    artist: "Pearl Jam",
    year: 1992,
    intro: "lava",
    mode: "tracks",
    tracks: [
      { title: "Oceans", url: "https://www.youtube.com/watch?v=0csYYDUVnR8" },
      { title: "Alive", url: "https://www.youtube.com/watch?v=nL3RLO1-oQI" },
      { title: "Jeremy", url: "https://www.youtube.com/watch?v=3g1Tu2Ulrk0" },
      { title: "Porch", url: "https://www.youtube.com/watch?v=llOpE85bmW0" }
    ]
  },

  // 4️⃣ KISS — MTV Unplugged (1995) — FULL SHOW
  {
    id: "kiss-unplugged-1995",
    artist: "KISS",
    year: 1995,
    intro: "lava",
    mode: "full",
    tracks: [
      {
        title: "KISS — MTV Unplugged (Full Concert)",
        url: "https://www.youtube.com/watch?v=X4E_ULt7tLM"
      }
    ]
  },

  // 5️⃣ Jay-Z & The Roots — MTV Unplugged (2001) — FULL SHOW
  {
    id: "jayz-roots-unplugged-2001",
    artist: "Jay-Z & The Roots",
    year: 2001,
    intro: "lava",
    mode: "full",
    tracks: [
      {
        title: "Jay-Z & The Roots — MTV Unplugged (Full Show)",
        url: "https://www.youtube.com/watch?v=r2I_pGlvtAY"
      }
    ]
  }

];

// Expose globally for app.js
window.EPISODES = EPISODES;
