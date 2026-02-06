/* Episodes loader (single source of truth: /episodes.json)
   Keeps compatibility with existing app.js expecting window.EPISODES
*/

(async function () {
  async function loadJson() {
    const res = await fetch("./episodes.json", { cache: "no-store" });
    if (!res.ok) throw new Error("episodes.json not found");
    return await res.json();
  }

  try {
    const list = await loadJson();
    window.EPISODES = Array.isArray(list) ? list : [];
    window.episodes = window.EPISODES; // compatibility alias
    window.dispatchEvent(new CustomEvent("episodes:ready"));
  } catch (err) {
    console.error("Episodes load failed:", err);
    window.EPISODES = window.EPISODES || [];
    window.episodes = window.EPISODES;
    window.dispatchEvent(new CustomEvent("episodes:ready"));
  }
})();
