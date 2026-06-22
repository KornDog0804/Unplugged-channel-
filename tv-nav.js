/* ============================================
   KornDog TV Remote Navigation v5
   Spatial D-pad navigation for Google TV / Android TV
   Paste this whole file as tv-nav.js, then add:
   <script src="tv-nav.js"></script>
   right before your closing </body> tag in index.html
   and sessions.html

   v5: Back now flows through the browser history (history.back())
   instead of calling exitTheaterMode() directly. On this TV the
   remote's Back arrives as a NATIVE history-back, not a JS key event,
   so the old direct-exit handler never ran and presses fell through to
   app.js's popstate — which used to walk back through folders under
   the still-active black theater overlay, leaving "Exit Player" stuck
   and needing 3-4 presses. Routing every Back (button, remote key,
   native) through history.back() means app.js's popstate is the single
   authority and one press cleanly exits the player back to the list.
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
    if (document.body.classList.contains('tvTheater')) return;
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

  // Single helper for "exit the player" — routes through the browser
  // history so app.js's popstate is the one and only place that decides
  // what Back does. This is the fix for the stuck "Exit Player" / multi-
  // press bug: one Back = one clean exit straight back to the list.
  function requestBack() {
    if (typeof window.__kdGoBack === 'function') {
      // __kdGoBack itself calls history.back() while in theater mode.
      window.__kdGoBack();
    } else {
      history.back();
    }
    if (currentFocus) {
      currentFocus.classList.remove('tv-focused');
      currentFocus = null;
    }
    // Re-grab focus on the freshly shown list once the exit has settled.
    setTimeout(() => {
      const first = getFocusable()[0];
      if (first) setFocus(first);
    }, 90);
  }

  document.addEventListener('keydown', function (e) {
    // During theater mode: Back exits the player, Enter/Select toggles
    // play/pause, Left/Right seek. Everything routes through the app.
    if (document.body.classList.contains('tvTheater')) {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        requestBack();
        return;
      }

      if (e.key === 'Enter' || e.keyCode === 13 || e.key === ' ' ||
          e.key === 'MediaPlayPause' || e.key === 'MediaPlay' || e.key === 'MediaPause') {
        e.preventDefault();
        if (typeof window.__kdTogglePlayPause === 'function') {
          window.__kdTogglePlayPause();
        }
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'MediaRewind') {
        e.preventDefault();
        if (typeof window.__kdSeek === 'function') {
          window.__kdSeek(-10);
        }
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'MediaFastForward') {
        e.preventDefault();
        if (typeof window.__kdSeek === 'function') {
          window.__kdSeek(10);
        }
        return;
      }

      return;
    }

    // If whatever we last focused just got hidden, drop the stale
    // reference so the next interaction starts fresh.
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

      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
        return;
      }

      requestBack();
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
    if (document.body.classList.contains('tvTheater')) {
      if (currentFocus) {
        currentFocus.classList.remove('tv-focused');
        currentFocus = null;
      }
      return;
    }
    if (!currentFocus || !document.body.contains(currentFocus) || !isVisible(currentFocus)) {
      const first = getFocusable()[0];
      if (first && first !== currentFocus) setFocus(first);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
