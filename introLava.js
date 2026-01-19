// Procedural lava lamp intro (no photos, no loops)
// Warm & cozy wall glow, black cap/base, artist-matched colors.

export function playLavaIntro(canvas, palette, labelText, seconds = 3) {
  const ctx = canvas.getContext("2d", { alpha: false });

  let w = 0, h = 0, dpr = 1;
  function resize() {
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    w = Math.max(320, Math.floor(rect.width));
    h = Math.max(360, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  // Lamp geometry
  const lampW = Math.min(280, w * 0.36);
  const lampH = Math.min(520, h * 0.78);
  const cx = w * 0.5;
  const cy = h * 0.52;

  const tubeTop = cy - lampH * 0.38;
  const tubeBot = cy + lampH * 0.34;
  const tubeR = lampW * 0.18;

  const capH = lampH * 0.09;
  const baseH = lampH * 0.12;

  // Metaballs
  const blobColor = palette?.blob || "#ffb86b";
  const liquidColor = palette?.liquid || "#1b0f08";
  const glowColor = palette?.glow || "#ffb86b";

  const rng = mulberry32(hashString(labelText + String(Date.now())));
  const blobCount = 8;

  const blobs = Array.from({ length: blobCount }, () => ({
    x: cx + (rng() - 0.5) * tubeR * 1.4,
    y: tubeBot - rng() * (tubeBot - tubeTop),
    r: (tubeR * 0.55) + rng() * (tubeR * 0.55),
    vy: 10 + rng() * 20,
    wob: rng() * Math.PI * 2,
    wobSpd: 0.5 + rng() * 1.2
  }));

  const start = performance.now();
  const end = start + seconds * 1000;

  // Precompute a low-res field for speed
  const fieldScale = 0.6; // smaller = faster, more chunky; bigger = smoother
  const fw = Math.floor(w * fieldScale);
  const fh = Math.floor(h * fieldScale);
  const img = ctx.createImageData(fw, fh);

  // Helpers
  function clamp01(x){ return Math.max(0, Math.min(1, x)); }

  function drawBackground(t) {
    // Warm cozy room gradient
    ctx.fillStyle = "#06060a";
    ctx.fillRect(0, 0, w, h);

    // Wall glow behind lamp
    const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * 0.75);
    g.addColorStop(0, "rgba(255, 190, 120, 0.14)");
    g.addColorStop(0.32, "rgba(255, 190, 120, 0.07)");
    g.addColorStop(0.65, "rgba(255, 190, 120, 0.03)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Subtle vignette
    const v = ctx.createRadialGradient(cx, cy, Math.min(w,h)*0.2, cx, cy, Math.max(w,h)*0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }

  function drawLampShell() {
    // Base + cap (black)
    ctx.fillStyle = "#050507";
    const baseW = lampW * 0.72;
    const capW = lampW * 0.52;

    roundRect(ctx, cx - baseW/2, tubeBot + 10, baseW, baseH, 18);
    ctx.fill();

    roundRect(ctx, cx - capW/2, tubeTop - capH - 8, capW, capH, 16);
    ctx.fill();

    // Tube glass
    const tubeW = lampW * 0.46;
    const tubeX = cx - tubeW/2;
    const tubeY = tubeTop - 4;
    const tubeH = (tubeBot - tubeTop) + 8;

    // Outer glass
    const gg = ctx.createLinearGradient(tubeX, 0, tubeX + tubeW, 0);
    gg.addColorStop(0, "rgba(255,255,255,0.10)");
    gg.addColorStop(0.18, "rgba(255,255,255,0.03)");
    gg.addColorStop(0.5, "rgba(255,255,255,0.015)");
    gg.addColorStop(0.82, "rgba(255,255,255,0.03)");
    gg.addColorStop(1, "rgba(255,255,255,0.10)");

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(ctx, tubeX, tubeY, tubeW, tubeH, 999);
    ctx.fill();

    ctx.fillStyle = gg;
    roundRect(ctx, tubeX, tubeY, tubeW, tubeH, 999);
    ctx.fill();

    // Liquid tint layer
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = liquidColor;
    roundRect(ctx, tubeX+2, tubeY+2, tubeW-4, tubeH-4, 999);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function updateBlobs(dt) {
    const span = (tubeBot - tubeTop);
    for (const b of blobs) {
      b.wob += b.wobSpd * dt;
      b.x = cx + Math.sin(b.wob) * tubeR * 0.65 + (Math.sin(b.wob*0.37) * tubeR * 0.18);

      // Rise, then recycle
      b.y -= b.vy * dt;
      if (b.y + b.r < tubeTop) {
        b.y = tubeBot + b.r + (rng() * 24);
        b.r = (tubeR * 0.55) + rng() * (tubeR * 0.60);
        b.vy = 10 + rng() * 22;
        b.wobSpd = 0.5 + rng() * 1.2;
      }
      // occasional slow sink drift (lava weirdness)
      b.y += Math.sin(b.wob * 0.22) * 2.0 * dt;
      // keep inside tube
      b.y = Math.max(tubeTop - 40, Math.min(tubeBot + 40, b.y));
    }
  }

  function drawMetaballs() {
    // Compute scalar field on low-res buffer
    // Field threshold chosen for thick blobs
    const threshold = 1.12;

    // Tube bounds in field coords
    const tubeW = lampW * 0.46;
    const tubeX = cx - tubeW/2;
    const tubeY = tubeTop - 4;
    const tubeH = (tubeBot - tubeTop) + 8;

    const minX = Math.floor((tubeX) * fieldScale);
    const maxX = Math.floor((tubeX + tubeW) * fieldScale);
    const minY = Math.floor((tubeY) * fieldScale);
    const maxY = Math.floor((tubeY + tubeH) * fieldScale);

    // clear buffer
    for (let i=0; i<img.data.length; i+=4) {
      img.data[i+0] = 0;
      img.data[i+1] = 0;
      img.data[i+2] = 0;
      img.data[i+3] = 0;
    }

    const bc = hexToRgb(blobColor);
    const gc = hexToRgb(glowColor);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x / fieldScale;
        const py = y / fieldScale;

        // inside tube only (soft check)
        const dx = (px - cx) / (tubeR * 2.05);
        const dy = (py - (tubeTop + tubeH/2)) / (tubeH * 0.55);
        if (dx*dx + dy*dy > 1.05) continue;

        let f = 0;
        for (const b of blobs) {
          const ddx = px - b.x;
          const ddy = py - b.y;
          const dist2 = ddx*ddx + ddy*ddy + 1e-4;
          f += (b.r*b.r) / dist2;
        }
        // normalize field a bit
        const val = f / 4800;

        if (val > threshold) {
          // core blob
          const a = clamp01((val - threshold) * 3.0); // alpha
          const idx = (y*fw + x) * 4;
          img.data[idx+0] = bc.r;
          img.data[idx+1] = bc.g;
          img.data[idx+2] = bc.b;
          img.data[idx+3] = Math.floor(255 * (0.85 * a));
        } else if (val > threshold * 0.82) {
          // glow fringe
          const a = clamp01((val - threshold*0.82) * 2.2);
          const idx = (y*fw + x) * 4;
          img.data[idx+0] = gc.r;
          img.data[idx+1] = gc.g;
          img.data[idx+2] = gc.b;
          img.data[idx+3] = Math.floor(255 * (0.35 * a));
        }
      }
    }

    // draw scaled up
    // PutImageData + scale: easiest is draw to offscreen then scale;
    // but we keep it simple: use an offscreen canvas.
    const off = getOffscreen(fw, fh);
    off.ctx.putImageData(img, 0, 0);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = "screen";
    // scale to full size
    ctx.drawImage(off.c, 0, 0, fw, fh, 0, 0, w, h);
    ctx.restore();

    // Glass highlight stripe
    const tubeWpx = lampW * 0.46;
    const tubeXpx = cx - tubeWpx/2;
    const hl = ctx.createLinearGradient(tubeXpx, 0, tubeXpx + tubeWpx, 0);
    hl.addColorStop(0.05, "rgba(255,255,255,0.08)");
    hl.addColorStop(0.15, "rgba(255,255,255,0.00)");
    hl.addColorStop(0.70, "rgba(255,255,255,0.00)");
    hl.addColorStop(0.85, "rgba(255,255,255,0.05)");
    ctx.fillStyle = hl;
    roundRect(ctx, tubeXpx, tubeTop - 4, tubeWpx, (tubeBot - tubeTop) + 8, 999);
    ctx.fill();
  }

  function drawLabel(t) {
    ctx.save();
    ctx.font = "700 14px ui-sans-serif, system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.textAlign = "center";
    ctx.globalAlpha = 0.0;

    const elapsed = (t - start) / (seconds * 1000);
    // fade in around 2 seconds
    const a = clamp01((elapsed - 0.55) / 0.20);
    ctx.globalAlpha = a;

    ctx.fillText(labelText, cx, h * 0.76);
    ctx.restore();
  }

  let last = performance.now();
  let raf = 0;

  return new Promise((resolve) => {
    function frame(now) {
      raf = requestAnimationFrame(frame);

      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;

      // stop
      if (now >= end) {
        cancelAnimationFrame(raf);
        resolve();
        return;
      }

      drawBackground(now);
      updateBlobs(dt);
      drawLampShell();
      drawMetaballs();
      drawLabel(now);
    }

    frame(performance.now());

    // also handle resizes
    const onResize = () => resize();
    window.addEventListener("resize", onResize, { passive: true });

    // cleanup hook
    const originalResolve = resolve;
    resolve = () => {
      window.removeEventListener("resize", onResize);
      originalResolve();
    };
  });
}

// -------- helpers --------

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}

function hexToRgb(hex) {
  const h = (hex || "#ffffff").replace("#","").trim();
  const full = h.length === 3 ? h.split("").map(c => c+c).join("") : h.padEnd(6,"0").slice(0,6);
  const n = parseInt(full, 16);
  return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
}

function hashString(s) {
  let h = 2166136261;
  for (let i=0; i<s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// simple cached offscreen
let _off = null;
function getOffscreen(w, h) {
  if (!_off || _off.w !== w || _off.h !== h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    _off = { c, ctx, w, h };
  }
  return _off;
    }
