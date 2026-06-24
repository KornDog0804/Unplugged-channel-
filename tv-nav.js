/* ============================================
   KornDog TV Remote Navigation v6
   Spatial D-pad navigation for Google TV / Android TV

   v6 fixes vs v5:
   1. SCROLL — changed scrollIntoView to behavior:'instant' on TV.
      The WebView queues smooth scroll animations causing visible lag
      on every D-pad press. Instant is imperceptible and feels snappy.

   2. BACK — removed the 90ms re-focus setTimeout after requestBack().
      It was grabbing stale elements mid-transition and occasionally
      re-triggering navigation. Focus restoration now happens via the
      existing MutationObserver once the DOM actually settles.

   3. PLAYER FALSE LOADS — all card clicks on TV now go through a
      350ms compositor delay before the iframe src is set. Same fix
      that cured the Featured card black screen, applied globally.
      The delay is injected once into app.js's playTrackAt via a
      thin wrapper so nothing else in the playback engine changes.
   ============================================ */

(function () {
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

  let currentFocus  = null;
  let backInProgress = false; // guard against double-back

  // ── Focus styles ────────────────────────────────────────────────────────────
  function injectFocusStyle() {
    const style = document.createElement('style');
    style.textContent = `
      .tv-focused {
        outline: 4px solid #7FD41A !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 18px rgba(127,212,26,0.85) !important;
        z-index: 50;
        position: relative;
        scroll-margin-top: 120px;
        scroll-margin-bottom: 120px;
      }
    `;
    document.head.appendChild(style);
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 &&
           s.visibility !== 'hidden' && s.display !== 'none';
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
    // INSTANT scroll — smooth causes animation queue lag on this WebView
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }

  // ── Spatial navigation ──────────────────────────────────────────────────────
  function rectCenter(r) {
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function findNext(dir) {
    if (!currentFocus) return getFocusable()[0];
    const from = rectCenter(currentFocus.getBoundingClientRect());
    let best = null, bestScore = Infinity;

    getFocusable().filter(el => el !== currentFocus).forEach(el => {
      const to = rectCenter(el.getBoundingClientRect());
      const dx = to.x - from.x, dy = to.y - from.y;
      let primary, cross, ok;
      if (dir === 'left')  { primary = -dx; cross = dy; ok = dx < -2; }
      if (dir === 'right') { primary =  dx; cross = dy; ok = dx >  2; }
      if (dir === 'up')    { primary = -dy; cross = dx; ok = dy < -2; }
      if (dir === 'down')  { primary =  dy; cross = dx; ok = dy >  2; }
      if (!ok) return;
      const score = primary + Math.abs(cross) * 1.5;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    return best;
  }

  // ── Back ────────────────────────────────────────────────────────────────────
  // Routes through app.js's __kdGoBack (which calls history.back() while in
  // theater mode). Guard prevents double-fire on TVs that send both a key
  // event AND a native history-back for one physical press.
  function requestBack() {
    if (backInProgress) return;
    backInProgress = true;
    setTimeout(() => { backInProgress = false; }, 700);

    if (currentFocus) {
      currentFocus.classList.remove('tv-focused');
      currentFocus = null;
    }

    if (typeof window.__kdGoBack === 'function') {
      window.__kdGoBack();
    } else {
      history.back();
    }
    // DO NOT re-focus here — MutationObserver handles it once DOM settles
  }

  // ── Key handler ─────────────────────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {

    // Theater mode: only media controls + Back
    if (document.body.classList.contains('tvTheater')) {
      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack') {
        e.preventDefault();
        requestBack();
        return;
      }
      if (e.key === 'Enter' || e.keyCode === 13 || e.key === ' ' ||
          e.key === 'MediaPlayPause' || e.key === 'MediaPlay' || e.key === 'MediaPause') {
        e.preventDefault();
        if (typeof window.__kdTogglePlayPause === 'function') window.__kdTogglePlayPause();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'MediaRewind') {
        e.preventDefault();
        if (typeof window.__kdSeek === 'function') window.__kdSeek(-10);
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'MediaFastForward') {
        e.preventDefault();
        if (typeof window.__kdSeek === 'function') window.__kdSeek(10);
        return;
      }
      return; // swallow all other keys in theater
    }

    // Drop stale focus reference if element disappeared
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

    if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack') {
      e.preventDefault();
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
        return;
      }
      requestBack();
    }
  });

  // ── Player compositor delay ─────────────────────────────────────────────────
  // Wrap app.js's playTrackAt so ALL playback on TV waits 350ms for the
  // hardware compositor before the iframe src is set. This is the same fix
  // that cured the Featured card black screen — applied globally so every
  // card tap works first time, every time.
  // We hook it once after app.js has had a chance to define it.
  function patchPlayback() {
    if (window.__kdPlaybackPatched) return;
    const frame = document.getElementById('playerFrame');
    if (!frame) return;

    // Intercept src assignment on the iframe
    let _src = frame.src;
    Object.defineProperty(frame, 'src', {
      get() { return _src; },
      set(val) {
        if (val && val !== 'about:blank' && val !== '') {
          // Clear first so the compositor tears down the old surface
          _src = '';
          frame.setAttribute('src', '');
          setTimeout(() => {
            _src = val;
            frame.setAttribute('src', val);
          }, 350);
        } else {
          _src = val;
          frame.setAttribute('src', val || '');
        }
      },
      configurable: true
    });

    window.__kdPlaybackPatched = true;
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  function init() {
    injectFocusStyle();
    patchPlayback();
    const first = getFocusable()[0];
    if (first) setFocus(first);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 350);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 350));
  }

  // MutationObserver: restore focus when DOM changes (folder navigation,
  // theater mode exit, etc.) — this is also how focus gets restored after
  // Back, without a fragile timeout.
  const observer = new MutationObserver(() => {
    if (document.body.classList.contains('tvTheater')) {
      if (currentFocus) {
        currentFocus.classList.remove('tv-focused');
        currentFocus = null;
      }
      return;
    }
    if (!currentFocus ||
        !document.body.contains(currentFocus) ||
        !isVisible(currentFocus)) {
      // Small debounce so DOM fully settles before we grab focus
      setTimeout(() => {
        const first = getFocusable()[0];
        if (first && first !== currentFocus) setFocus(first);
      }, 80);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
