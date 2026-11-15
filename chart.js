// Hand-drawn canvas charts (no library). devicePixelRatio aware.
const Charts = (() => {
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function setup(cv) {
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return [ctx, r.width, r.height];
  }
  const COLORS = {buy: "#0a84ff", gain: "#00d35a", loss: "#ff453a", stop: "#ff453a"};
  // line: points [[ts,val]], start value, marks [{ts,kind,label}]
  function line(cv, data, prev) {
    const [ctx, W, H] = setup(cv); const pts = data.points || [];
    const padT = 56, padB = 12;
    const vals = pts.map(p => p[1]).concat([data.start]);
    let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const span = hi - lo; lo -= span * 0.08; hi += span * 0.08;
    const t0 = pts.length ? pts[0][0] : 0, t1 = pts.length ? pts[pts.length - 1][0] : 1;
    const X = t => pts.length < 2 ? W / 2 : 8 + (t - t0) / (t1 - t0 || 1) * (W - 16);
    const Y = v => padT + (hi - v) / (hi - lo) * (H - padT - padB);
    ctx.clearRect(0, 0, W, H);
    // dashed start line
    ctx.setLineDash([4, 4]); ctx.strokeStyle = "rgba(235,235,245,0.3)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, Y(data.start)); ctx.lineTo(W, Y(data.start)); ctx.stroke(); ctx.setLineDash([]);
    if (pts.length < 2) return;
    const draw = frac => {
      const n = Math.max(2, Math.floor(pts.length * frac));
      ctx.beginPath(); pts.slice(0, n).forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
      const g = ctx.createLinearGradient(0, padT, 0, H); g.addColorStop(0, "rgba(0,211,90,0.28)"); g.addColorStop(1, "rgba(0,211,90,0)");
      ctx.save(); ctx.lineTo(X(pts[n - 1][0]), H); ctx.lineTo(X(pts[0][0]), H); ctx.closePath(); ctx.fillStyle = g; ctx.fill(); ctx.restore();
      ctx.beginPath(); pts.slice(0, n).forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
      ctx.strokeStyle = "#00d35a"; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
    };
    draw(1);
    // marks above the line, never overlapping: a later mark moves up a row
    ctx.font = "600 12px -apple-system, sans-serif"; const placed = [];
    (data.marks || []).forEach(m => {
      if (m.ts < t0 || m.ts > t1 + 60) return;
      const x = Math.min(W - 8, Math.max(8, X(Math.min(m.ts, t1)))); const w = ctx.measureText(m.label).width + 14;
      let row = 0; const left = Math.max(4, Math.min(W - w - 4, x - w / 2));
      while (placed.some(p => p.row === row && !(left + w < p.l || left > p.l + p.w))) row++;
      placed.push({l: left, w, row}); const y = 6 + (row % 3) * 24 + Math.floor(row / 3) * 0;
      ctx.globalAlpha = reduced() ? 1 : 0; const c = COLORS[m.kind] || "#fff";
      const paint = () => { ctx.fillStyle = c; roundRect(ctx, left, y, w, 20, 10); ctx.fill(); ctx.fillStyle = m.kind === "gain" ? "#000" : "#fff"; ctx.fillText(m.label, left + 7, y + 14); };
      if (reduced()) { paint(); return; }
      let a = 0; const step = () => { a = Math.min(1, a + 16 / 200); ctx.save(); ctx.globalAlpha = a; paint(); ctx.restore(); if (a < 1) requestAnimationFrame(step); };
      ctx.globalAlpha = 1; requestAnimationFrame(step);
    });
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  // candles: [{t,o,h,l,c,v}], exit line price (orange dashed)
  function candles(cv, cs, exitLine) {
    const [ctx, W, H] = setup(cv); ctx.clearRect(0, 0, W, H);
    if (!cs.length) { ctx.fillStyle = "rgba(235,235,245,0.6)"; ctx.font = "15px -apple-system"; ctx.textAlign = "center"; ctx.fillText("Waiting for prices", W / 2, H / 2); return; }
    const volH = H * 0.2, pH = H - volH - 8;
    let lo = Math.min(...cs.map(c => c.l)), hi = Math.max(...cs.map(c => c.h));
    if (exitLine) { lo = Math.min(lo, exitLine); hi = Math.max(hi, exitLine); }
    if (hi - lo < hi * 1e-6) { hi *= 1.01; lo *= 0.99; }
    const Y = v => 8 + (hi - v) / (hi - lo) * (pH - 16); const vmax = Math.max(1e-9, ...cs.map(c => c.v));
    const cw = W / Math.max(cs.length, 20);
    cs.forEach((c, i) => {
      const x = i * cw + cw / 2, up = c.c >= c.o; ctx.strokeStyle = ctx.fillStyle = up ? "#00d35a" : "#ff453a";
      ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.lineWidth = 1; ctx.stroke();
      const y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c)); ctx.fillRect(x - cw * 0.35, y1, cw * 0.7, Math.max(1, y2 - y1));
      ctx.globalAlpha = 0.5; const vh = c.v / vmax * volH; ctx.fillRect(x - cw * 0.35, H - vh, cw * 0.7, vh); ctx.globalAlpha = 1;
    });
    if (exitLine) { ctx.setLineDash([5, 4]); ctx.strokeStyle = "#ff9f0a"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, Y(exitLine)); ctx.lineTo(W, Y(exitLine)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#ff9f0a"; ctx.font = "600 11px -apple-system"; ctx.fillText("Risk trailing stop", 6, Y(exitLine) - 5); }
  }
  function ring(cv, score) {
    const [ctx, W, H] = setup(cv); const r = Math.min(W, H) / 2 - 8, cx = W / 2, cy = H / 2; ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 10; ctx.lineCap = "round"; ctx.strokeStyle = "#2c2c2e"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    if (score == null) return;
    ctx.strokeStyle = score >= 70 ? "#00d35a" : "#ffd60a"; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * score / 100); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "700 34px -apple-system"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(score), cx, cy);
  }
  return {line, candles, ring};
})();
