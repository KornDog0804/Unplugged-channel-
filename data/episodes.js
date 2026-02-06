/* Episodes loader (single source of truth: /episodes.json)
   Always loads from site root so it works on /sessions.html, PWA, etc.
*/
(async function () {
  const EP_URL = "/episodes.json?cb=" + Date.now(); // cache-buster

  async function loadJson() {
    const res = await fetch(EP_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("episodes.json not found: " + res.status);
    return await res.json();
  }

  try {
    const list = await loadJson();
    window.EPISODES = Array.isArray(list) ? list : [];
    window.episodes = window.EPISODES; // compatibility alias
    window.dispatchEvent(new CustomEvent("episodes:ready"));
    console.log("Episodes loaded:", window.EPISODES.length);
  } catch (err) {
    console.error("Episodes load failed:", err);
    window.EPISODES = [];
    window.episodes = window.EPISODES;
    window.dispatchEvent(new CustomEvent("episodes:ready"));
  }
})();
