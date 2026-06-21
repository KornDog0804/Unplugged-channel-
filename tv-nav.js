/* ============================================
   KornDog TV Remote Navigation v2
   Spatial D-pad navigation for Google TV / Android TV
   Paste this whole file as tv-nav.js, then add:
   <script src="tv-nav.js"></script>
   right before your closing </body> tag in index.html
   and sessions.html
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
  // .epCard      = session/folder rows on sessions.html
  // .featuredCard = featured cards on the home page
  // .btn / .landingBtn = all buttons (Play All, Watch on TV, Hide player,
  //                       Back to Sessions, Enter Sessions, etc.)
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
        /* Keeps focused items clear of the sticky header and TV overscan
           when the browser scrolls them into view. */
        scroll-margin-top: 100px;
        scroll-margin-bottom: 100px;
      }
    `;
    document.head.appendChild(style);
  }

  function getFocusable() {
    return Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter(el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 &&
               style.visibility !== 'hidden' && style.display !== 'none';
      });
  }

  function setFocus(el) {
    if (!el) return;
    if (currentFocus) currentFocus.classList.remove('tv-focused');
    currentFocus = el;
    el.classList.add('tv-focused');
    el.focus({ preventScroll: true });
    // 'nearest' only scrolls the minimum needed to bring the element
    // fully into view — prevents big elements (like the player) from
    // getting shoved partly off-screen when a nearby small button
    // gets focused.
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  function rectCenter(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  // Finds the best candidate in a given direction using angle + distance scoring
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

      // Favor elements directly in line, penalize sideways drift
      const score = primary + Math.abs(cross) * 1.5;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    });

    return best;
  }

  document.addEventListener('keydown', function (e) {
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
      if (currentFocus) {
        e.preventDefault();
        currentFocus.click();
      }
      return;
    }

    // Back button / Escape — let browser/Chrome handle native back nav,
    // but clear visual focus state so it doesn't look stuck
    if (e.key === 'Escape' || e.key === 'Backspace') {
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

  // Re-focus first item whenever content changes (e.g. navigating folders,
  // or a fresh render() call rebuilding #episodes)
  const observer = new MutationObserver(() => {
    if (!currentFocus || !document.body.contains(currentFocus)) {
      const first = getFocusable()[0];
      if (first) setFocus(first);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
