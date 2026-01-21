/* Stripped & Turned Up — Sessions data
   IMPORTANT:
   - Keep this file as pure JavaScript (no HTML, no CSS)
   - Every string MUST be in quotes
   - Every item MUST have commas in the right places
*/

window.EPISODES = [
  {
    title: "Nirvana — MTV Unplugged (Full Session)",
    artist: "Nirvana",
    year: 1993,
    mode: "fullshow",
    tracks: [
      {
        title: "Full Session Stream",
        // FULL SHOW (not the 6 min song)
        url: "https://youtu.be/pOTkCgkxqyg"
      }
    ]
  },

  {
  title: "Alice In Chains — MTV Unplugged (Full Session)",
  artist: "Alice In Chains",
  year: 1996,
  mode: "fullshow",
  tracks: [
    {
      title: "Full Session Stream",
      url: "https://youtu.be/Jprla2NvHY0"
    }
  ]
},

  {
    title: "JAY-Z — Unplugged / Live (Full Session)",
    artist: "JAY-Z",
    year: 2001,
    mode: "fullshow",
    tracks: [
      { title: "Full Session Stream", url: "https://youtu.be/r2I_pGlvtAY" }
    ]
  },

  {
    title: "Papa Roach — WRIF Acoustic Set (Full Session)",
    artist: "Papa Roach",
    year: 2025,
    mode: "fullshow",
    tracks: [
      { title: "Full Session Stream", url: "https://www.youtube.com/watch?v=f4BK60WVPac" }
    ]
  },

  {
    title: "Wage War — Acoustic Queue (6 Songs)",
    artist: "Wage War",
    year: 2024,
    mode: "queue",
    tracks: [
      { title: "Track 1", url: "https://youtu.be/zxvZO7MzYzU" },
      { title: "Track 2", url: "https://youtu.be/HasZm8N83cE" },
      { title: "Track 3", url: "https://youtu.be/2lcJUfE2LsQ" },
      { title: "Track 4", url: "https://youtu.be/fT9SJV8KCE8" },
      { title: "Track 5", url: "https://youtu.be/laiLOhKO9yU" },
      { title: "Track 6", url: "https://youtu.be/7WVGNUVsDFw" }
    ]
  },

  {
    title: "The Home Team — Acoustic Session",
    artist: "The Home Team",
    year: 2023,
    mode: "fullshow",
    tracks: [
      { title: "Full Session Stream", url: "https://youtu.be/EGB3xoa7Cus" }
    ]
  },

  {
    title: "Smile Empty Soul — Acoustic Queue (4 Songs)",
    artist: "Smile Empty Soul",
    year: 2020,
    mode: "queue",
    tracks: [
      { title: "With This Knife", url: "https://youtu.be/Hl_qZX32LiY" },
      { title: "Silhouettes", url: "https://youtu.be/mk78hkKzXMA" },
      { title: "Bottom Of A Bottle", url: "https://youtu.be/cxIoBp8xHwQ" },
      { title: "Wonderwall", url: "https://youtu.be/C08X2DbSPfs" }
    ]
  },

  {
    title: "Wind Walkers — Acoustic Queue (2 Songs)",
    artist: "Wind Walkers",
    year: 2020,
    mode: "queue",
    tracks: [
      { title: "Body Bag", url: "https://youtu.be/jkY3QORBHeE" },
      { title: "Hangfire", url: "https://youtu.be/pqWTvbLTV0Q" }
    ]
  }
];

// Compatibility alias (in case app.js checks window.episodes)
window.episodes = window.EPISODES;
