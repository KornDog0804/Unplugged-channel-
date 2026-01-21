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
        url: "https://www.youtube.com/watch?v=EGcDLX-vtwU"
      }
    ]
  },

  {
    title: "Alice In Chains — MTV Unplugged (Full Session)",
    artist: "Alice In Chains",
    year: 1996,
    mode: "fullshow",
    tracks: [
      { title: "Full Session Stream", url: "https://www.youtube.com/watch?v=quf9WlL4hIg" }
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
      { title: "Track 1", url: "https://youtu.be/zxvZO7MzYzU?si=keOOKrw0ybhgae2T" },
      { title: "Track 2", url: "https://youtu.be/HasZm8N83cE?si=xPO0UVPuNPhf3fmy" },
      { title: "Track 3", url: "https://youtu.be/2lcJUfE2LsQ?si=mQZVRyYzITg7Nbic" },
      { title: "Track 4", url: "https://youtu.be/fT9SJV8KCE8?si=tgBbj0EWr9VKe5SW" },
      { title: "Track 5", url: "https://youtu.be/laiLOhKO9yU?si=BqOQY6o-E3m_r6BQ" },
      { title: "Track 6", url: "https://youtu.be/7WVGNUVsDFw?si=7OfgIf9zPXuBiPmT" }
    ]
  },

  {
    title: "The Home Team — Acoustic Session",
    artist: "The Home Team",
    year: 2023,
    mode: "fullshow",
    tracks: [
      { title: "Full Session Stream", url: "https://youtu.be/EGB3xoa7Cus?si=o41j-c7WmVmjiXAh" }
    ]
  },

  {
    title: "Smile Empty Soul — Acoustic Queue (4 Songs)",
    artist: "Smile Empty Soul",
    year: 2020,
    mode: "queue",
    tracks: [
      { title: "With This Knife", url: "https://youtu.be/Hl_qZX32LiY?si=8npuZ_WDr6E1afdn" },
      { title: "Silhouettes", url: "https://youtu.be/mk78hkKzXMA?si=vcQqvVXCKg-mcAFT" },
      { title: "Bottom Of A Bottle", url: "https://youtu.be/cxIoBp8xHwQ?si=9mQm3SWlilDnRiby" },
      { title: "Wonderwall", url: "https://youtu.be/C08X2DbSPfs?si=LIe7hhVYI7bBHIKX" }
    ]
  },

  {
    title: "Wind Walkers — Acoustic Queue (2 Songs)",
    artist: "Wind Walkers",
    year: 2020,
    mode: "queue",
    tracks: [
      { title: "Body Bag", url: "https://youtu.be/jkY3QORBHeE?si=mk2-smKWYfIKEquH" },
      { title: "Hangfire", url: "https://youtu.be/pqWTvbLTV0Q?si=GPByTp3t8Qmdp6iA" }
    ]
  }
];

// Compatibility alias (in case app.js checks window.episodes)
window.episodes = window.EPISODES;
