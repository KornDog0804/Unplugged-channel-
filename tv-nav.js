/* ============================================
   KornDog TV Remote Navigation v4
   Spatial D-pad navigation for Google TV / Android TV
   Paste this whole file as tv-nav.js, then add:
   <script src="tv-nav.js"></script>
   right before your closing </body> tag in index.html
   and sessions.html

   v4: dropped the old manual "focus player + Enter = fullscreen"
   flow — app.js now auto-activates a CSS "theater mode" the moment
   a video starts on TV, so there's nothing left for this script to
   do there except handle the Back key to exit it (see below) and
   make sure focus never gets stranded on something that just got
   hidden (e.g. a session card, right as theater mode takes over).
   ============================================ */

(function () {
  // Only activate on TV — don't interfere with phone/desktop touch users
  function isLikelyTV() {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('google tv') || ua.includes('android tv') ||
           ua.includes('aft') || ua.includes('crkey') ||
           document.documentElement.classList.contains('device-tv');
  }

  if (!isLikelyTV()) return;

  // Matches the ACTUAL interactive elements in this app:
  // .epCard          = session/folder rows on sessions.html
  // .featuredCard    = featured cards on the home page
  // .btn / .landingBtn = all buttons (Play All, Hide player,
  //                       Back to Sessions / Exit Player, etc.)
  // a[href] / button / [tabindex] = catch-all fallback
  const FOCUSABLE_SELECTOR =
    '.epCard, .featuredCard, .btn, .landingBtn, a[href], button, ' +
    '[tabindex]:not([tabindex="-1"]), [role="button"]';

  let currentFocus = null;

  function injectFocusStyle() {
    const style = document.createElement('style');
    style.textContent = `
      .tv-focused {
        outline: 4px solid #7FD41A !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 18px rgba(127, 212, 26, 0.85) !important;
        transition: box-shadow 0.12s ease;
        z-index: 50;
        position: relative;
        scroll-margin-top: 100px;
        scroll-margin-bottom: 100px;
      }
    `;
    document.head.appendChild(style);
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 &&
           style.visibility !== 'hidden' && style.display !== 'none';
  }

  function getFocusable() {
    return Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter(isVisible);
  }

  function setFocus(el) {
    if (!el) return;
    if (currentFocus) currentFocus.classList.remove('tv-focused');
    currentFocus = el;
    el.classList.add('tv-focused');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  function rectCenter(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function findNext(direction) {
    if (!currentFocus) return getFocusable()[0];

    const fromRect = currentFocus.getBoundingClientRect();
    const from = rectCenter(fromRect);
    const candidates = getFocusable().filter(el => el !== currentFocus);

    let best = null;
    let bestScore = Infinity;

    candidates.forEach(el => {
      const rect = el.getBoundingClientRect();
      const to = rectCenter(rect);
      const dx = to.x - from.x;
      const dy = to.y - from.y;

      let primary, cross, directional;
      if (direction === 'left') { primary = -dx; cross = dy; directional = dx < -2; }
      if (direction === 'right') { primary = dx; cross = dy; directional = dx > 2; }
      if (direction === 'up') { primary = -dy; cross = dx; directional = dy < -2; }
      if (direction === 'down') { primary = dy; cross = dx; directional = dy > 2; }

      if (!directional) return;

      const score = primary + Math.abs(cross) * 1.5;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    });

    return best;
  }

  document.addEventListener('keydown', function (e) {
    // If whatever we last focused just got hidden (e.g. theater mode
    // kicked in and swallowed the whole session list), drop the stale
    // reference so the next interaction starts fresh instead of doing
    // nothing.
    if (currentFocus && !isVisible(currentFocus)) {
      currentFocus.classList.remove('tv-focused');
      currentFocus = null;
    }

    const dirMap = {
      ArrowLeft: 'left', ArrowRight: 'right',
      ArrowUp: 'up', ArrowDown: 'down'
    };

    if (dirMap[e.key]) {
      e.preventDefault();
      const next = findNext(dirMap[e.key]);
      if (next) setFocus(next);
      return;
    }

    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      if (currentFocus) currentFocus.click();
      return;
    }

    if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();

      // Theater mode takes priority: Back exits it and drops you back
      // wherever the session list was, rather than just clearing focus.
      if (document.body.classList.contains('tvTheater')) {
        if (typeof window.__kdExitTheater === 'function') {
          window.__kdExitTheater();
        } else {
          document.body.classList.remove('tvTheater');
        }
        setTimeout(() => {
          const first = getFocusable()[0];
          if (first) setFocus(first);
        }, 50);
        return;
      }

      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
        return;
      }

      if (currentFocus) currentFocus.classList.remove('tv-focused');
      currentFocus = null;
    }
  });

  function init() {
    injectFocusStyle();
    const first = getFocusable()[0];
    if (first) setFocus(first);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 300);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
  }

  const observer = new MutationObserver(() => {
    if (!currentFocus || !document.body.contains(currentFocus) || !isVisible(currentFocus)) {
      const first = getFocusable()[0];
      if (first && first !== currentFocus) setFocus(first);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
