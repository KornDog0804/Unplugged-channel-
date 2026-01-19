// Candle silence intro (reserved for AIC + Nirvana)
// 5 seconds, no audio, moody candle flicker.

export function playCandleIntro(canvas, labelText, seconds = 5) {
  const ctx = canvas.getContext("2d", { alpha: false });

  let w=0,h=0,dpr=1;
  function resize(){
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    w = Math.max(320, Math.floor(rect.width));
    h = Math.max(360, Math.floor(rect.height));
    canvas.width = Math.floor(w*dpr);
    canvas.height = Math.floor(h*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  resize();

  const start = performance.now();
  const end = start + seconds*1000;

  function draw(now){
    const t = (now-start)/1000;

    // dark room
    ctx.fillStyle = "#050507";
    ctx.fillRect(0,0,w,h);

    // stage floor glow
    const floor = ctx.createLinearGradient(0,h*0.6,0,h);
    floor.addColorStop(0, "rgba(0,0,0,0)");
    floor.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = floor;
    ctx.fillRect(0,h*0.55,w,h*0.45);

    // candles
    const cx = w*0.5;
    const cy = h*0.52;
    const count = 10;
    for (let i=0;i<count;i++){
      const x = cx + (i - (count-1)/2) * (w*0.045) + Math.sin(t*0.6+i)*6;
      const y = cy + (Math.sin(t*0.35+i*0.9)*6) + (i%3)*4;
      const flick = 0.55 + 0.45*Math.sin(t*3.6 + i*1.3) * Math.sin(t*1.4 + i*0.7);

      // flame glow
      const g = ctx.createRadialGradient(x, y-18, 2, x, y-18, 55);
      g.addColorStop(0, `rgba(255,200,120,${0.30 + 0.25*flick})`);
      g.addColorStop(0.35, `rgba(255,160,80,${0.10 + 0.12*flick})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x-60,y-80,120,120);

      // candle body
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      roundRect(ctx, x-6, y-6, 12, 26, 6);
      ctx.fill();

      // flame
      ctx.fillStyle = `rgba(255,205,130,${0.65 + 0.25*flick})`;
      ctx.beginPath();
      ctx.ellipse(x, y-18, 4, 8, 0, 0, Math.PI*2);
      ctx.fill();
    }

    // title fade in at ~3s
    const elapsed = (now-start)/(seconds*1000);
    const a = clamp01((elapsed - 0.55)/0.20);

    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.font = "800 16px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.fillText(labelText, w/2, h*0.78);
    ctx.restore();

    // subtle vignette
    const v = ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*0.2,w/2,h/2,Math.max(w,h)*0.75);
    v.addColorStop(0,"rgba(0,0,0,0)");
    v.addColorStop(1,"rgba(0,0,0,0.65)");
    ctx.fillStyle = v;
    ctx.fillRect(0,0,w,h);
  }

  let raf=0;
  return new Promise((resolve)=>{
    function frame(now){
      raf = requestAnimationFrame(frame);
      if(now>=end){
        cancelAnimationFrame(raf);
        resolve();
        return;
      }
      draw(now);
    }
    frame(performance.now());

    const onResize = () => resize();
    window.addEventListener("resize", onResize, { passive:true });

    const originalResolve = resolve;
    resolve = () => {
      window.removeEventListener("resize", onResize);
      originalResolve();
    };
  });
}

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
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
