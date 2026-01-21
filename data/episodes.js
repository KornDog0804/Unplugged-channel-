// data/episodes.js
// Classic script (no import/export). Works on Netlify static hosting.

const EPISODES = [
  {
    id: "aic-full",
    title: "ALICE IN CHAINS — Unplugged",
    artist: "Alice In Chains",
    year: 1996,
    intro: "candle",
    mode: "fullshow",
    // Your locked working stream:
    tracks: [
      { title: "Full Performance (Stream)", url: "https://www.youtube.com/watch?v=pOTkCgkxqyg" }
    ]
  },
  {
    id: "nirvana-full",
    title: "NIRVANA — Unplugged in New York",
    artist: "Nirvana",
    year: 1993,
    intro: "candle",
    mode: "fullshow",
    // Your locked working stream:
    tracks: [
      { title: "Full Performance (Stream)", url: "https://www.youtube.com/watch?v=Jprla2NvHY0" }
    ]
  }
];

// Expose globally for app.js
window.EPISODES = EPISODES;
