// app.js — diagnostic-safe wrapper (copy/paste)

const DIAG = (() => {
  const el = document.getElementById("__diag_status");
  const log = (html) => { if (el) el.innerHTML = html; };
  const add = (html) => { if (el) el.innerHTML += `<br>${html}`; };
  return { log, add };
})();

function mustGetAppRoot() {
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("Missing #app element. index.html must contain <main id='app'>...</main>");
  }
  return root;
}

async function checkFile(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: "fetch_failed" };
  }
}

(async function boot() {
  try {
    DIAG.log(`<b>JS Loaded</b> ✅`);

    // Check the important files exist with correct paths
    const css = await checkFile("./styles.css");
    DIAG.add(`styles.css: ${css.ok ? "<span class='ok'>OK</span>" : "<span class='bad'>MISSING</span>"} (${css.status})`);

    const data = await checkFile("./data/episodes.js");
    DIAG.add(`data/episodes.js: ${data.ok ? "<span class='ok'>OK</span>" : "<span class='bad'>MISSING</span>"} (${data.status})`);

    // Force something visible even if your other code fails
    const root = mustGetAppRoot();
    const fallback = document.getElementById("fallback");
    if (fallback) fallback.textContent = "JS is running ✅ (diagnostic mode)";

    // --- YOUR REAL APP CODE GOES HERE ---
    // For now we just prove rendering works:
    root.insertAdjacentHTML(
      "beforeend",
      `
      <div style="margin-top:16px;padding:14px;border:1px solid rgba(255,255,255,.15);border-radius:12px;">
        <div style="font-weight:700;margin-bottom:6px;">Render Test</div>
        <div style="opacity:.9">If you see this box, the problem was your old JS wiping the page or crashing.</div>
      </div>
      `
    );

    DIAG.add(`<b>Render</b>: <span class="ok">OK</span> ✅`);
  } catch (err) {
    const msg = (err && (err.stack || err.message)) ? (err.stack || err.message) : String(err);
    DIAG.log(`<span class="bad"><b>BOOT FAILED:</b></span><br><pre style="white-space:pre-wrap;margin:6px 0 0;">${msg}</pre>`);
    // Also keep fallback visible
    const root = document.getElementById("app");
    if (root) {
      root.insertAdjacentHTML(
        "beforeend",
        `<p style="margin-top:16px;color:#ffb3b3">Boot failed — see diagnostic box at top.</p>`
      );
    }
  }
})();
