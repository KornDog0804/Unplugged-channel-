/* Stripped & Turned Up — Sessions data
   IMPORTANT:
   - Keep this file as pure JavaScript (no HTML, no CSS)
   - Every string MUST be in quotes
   - Every item MUST have commas in the right places
*/

window.EPISODES = [
  // ✅ Nirvana (FULL SHOW, not the 6-min single)
  {
    title: "Nirvana — MTV Unplugged (Full Session)",
    artist: "Nirvana",
    year: 1993,
    mode: "fullshow",
    tracks: [
      { title: "Full Session Stream", url: "https://www.youtube.com/watch?v=hEMm7gxBYSc" }
    ]
  },

  // ✅ AIC (you said this is fine)
  {
    title: "Alice In Chains — MTV Unplugged (Full Session)",
    artist: "Alice In Chains",
    year: 1996,
    mode: "fullshow",
    tracks: [
      { title: "Full Session Stream", url: "https://www.youtube.com/watch?v=Jprla2NvHY0" }
    ]
  },

  // ✅ JAY-Z (fine)
  {
    title: "JAY-Z — Unplugged / Live (Full Session)",
    artist: "JAY-Z",
    year: 2001,
    mode: "fullshow",
    tracks: [
      { title: "Full Session Stream", url: "https://www.youtube.com/watch?v=r2I_pGlvtAY" }
    ]
  },

  // ✅ Papa Roach (fine)
  {
    title: "Papa Roach — WRIF Acoustic Set (Full Session)",
    artist: "Papa Roach",
    year: 2025,
    mode: "fullshow",
    tracks: [
      { title: "Full Session Stream", url: "https://www.youtube.com/watch?v=f4BK60WVPac" }
    ]
  },

  // ✅ Wage War (6 songs, you said all 6 work)
  {
    title: "Wage War — Acoustic Queue (6 Songs)",
    artist: "Wage War",
    year: 2024,
    mode: "queue",
    tracks: [
      { title: "Acoustic #1", url: "https://www.youtube.com/watch?v=zxvZO7MzYzU" },
      { title: "Acoustic #2", url: "https://www.youtube.com/watch?v=HasZm8N83cE" },
      { title: "Acoustic #3", url: "https://www.youtube.com/watch?v=2lcJUfE2LsQ" },
      { title: "Acoustic #4", url: "https://www.youtube.com/watch?v=quf9WlL4hIg" },
      { title: "Acoustic #5", url: "https://www.youtube.com/watch?v=fT9SJV8KCE8" },
      { title: "Acoustic #6", url: "https://www.youtube.com/watch?v=laiLOhKO9yU" }
    ]
  },

  // ✅ The Home Team (fine)
  {
    title: "The Home Team — Acoustic Session",
    artist: "The Home Team",
    year: 2023,
    mode: "queue",
    tracks: [
      { title: "Acoustic", url: "https://www.youtube.com/watch?v=EGB3xoa7Cus" }
    ]
  },

  // ✅ Smile Empty Soul (YOU WANT 4 SONGS — here's all 4)
  {
    title: "Smile Empty Soul — Acoustic Queue (4 Songs)",
    artist: "Smile Empty Soul",
    year: 2020,
    mode: "queue",
    tracks: [
      { title: "With This Knife", url: "https://www.youtube.com/watch?v=Hl_qZX32LiY" },
      { title: "Silhouettes", url: "https://www.youtube.com/watch?v=mk78hkKzXMA" },
      { title: "Bottom of a Bottle", url: "https://www.youtube.com/watch?v=cxIoBp8xHwQ" },
      { title: "Wonderwall", url: "https://www.youtube.com/watch?v=C08X2DbSPfs" }
    ]
  },

  // ✅ Wind Walkers (2 songs: Body Bag + Hangfire)
  {
    title: "Wind Walkers — Acoustic Queue (2 Songs)",
    artist: "Wind Walkers",
    year: 2020,
    mode: "queue",
    tracks: [
      { title: "Body Bag", url: "https://www.youtube.com/watch?v=jkY3QORBHeE" },
      { title: "Hangfire", url: "https://www.youtube.com/watch?v=pqWTvbLTV0Q" }
    ]
  }
];

// Compatibility alias (in case app.js checks window.episodes)
window.episodes = window.EPISODES;
