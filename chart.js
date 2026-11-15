// Hand-drawn canvas charts (no library). devicePixelRatio aware.
const Charts = (() => {
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function css(name, fallback) {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return v || fallback;
  }
  function setup(cv) {
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return [ctx, r.width, r.height];
  }
  function colors() {
    return {
      green: css("--green", "#34C759"),
      red: css("--red", "#FF3B30"),
      blue: css("--blue", "#0A84FF"),
      text: css("--t2", "#8E8E93"),
      start: css("--sep", "rgba(0,0,0,.18)"),
      buy: css("--blue", "#0A84FF"),
      gain: css("--green", "#34C759"),
      loss: css("--red", "#FF3B30"),
      stop: css("--red", "#FF3B30"),
      ink: css("--t1", "#111")
    };
  }
  function hexAlpha(hex, a) {
    const h = hex.replace("#", "");
    const n = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
    if (n.length < 6) return hex;
    const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function line(cv, data) {
    if (cv._pulse) { cancelAnimationFrame(cv._pulse); cv._pulse = 0; }
    const [ctx, W, H] = setup(cv); const pts = data.points || [];
    const C = colors();
    const padT = data.marks && data.marks.length ? 56 : 16, padB = 12;
    const start = data.start != null ? data.start : (pts[0] ? pts[0][1] : 0);
    const vals = pts.map(p => p[1]).concat(start != null ? [start] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals); if (!isFinite(lo) || hi - lo < 1e-9) { hi = (hi || 0) + 1; lo = (lo || 0) - 1; }
    const span = hi - lo; lo -= span * 0.08; hi += span * 0.08;
    const t0 = pts.length ? pts[0][0] : 0, t1 = pts.length ? pts[pts.length - 1][0] : 1;
    const X = t => pts.length < 2 ? W / 2 : 8 + (t - t0) / (t1 - t0 || 1) * (W - 16);
    const Y = v => padT + (hi - v) / (hi - lo) * (H - padT - padB);
    const paintMarks = () => {
      if (!data.marks || !data.marks.length) return;
      ctx.font = "600 12px Inter, -apple-system, sans-serif"; const placed = [];
      data.marks.forEach(m => {
        if (m.ts < t0 || m.ts > t1 + 60) return;
        const x = Math.min(W - 8, Math.max(8, X(Math.min(m.ts, t1)))); const w = ctx.measureText(m.label).width + 14;
        let row = 0; const left = Math.max(4, Math.min(W - w - 4, x - w / 2));
        while (placed.some(p => p.row === row && !(left + w < p.l || left > p.l + p.w))) row++;
        placed.push({l: left, w, row}); const y = 6 + (row % 3) * 24;
        const c = {buy: C.buy, gain: C.gain, loss: C.loss, stop: C.stop}[m.kind] || C.ink;
        ctx.fillStyle = c; roundRect(ctx, left, y, w, 20, 10); ctx.fill();
        ctx.fillStyle = m.kind === "gain" ? "#000" : "#fff"; ctx.fillText(m.label, left + 7, y + 14);
      });
    };
    const draw = (frac, pulse) => {
      ctx.clearRect(0, 0, W, H);
      if (start != null) {
        ctx.setLineDash([4, 4]); ctx.strokeStyle = C.start; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, Y(start)); ctx.lineTo(W, Y(start)); ctx.stroke(); ctx.setLineDash([]);
      }
      if (pts.length < 2) return;
      const n = Math.max(2, Math.floor(pts.length * frac));
      const slice = pts.slice(0, n);
      ctx.beginPath(); slice.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
      const g = ctx.createLinearGradient(0, padT, 0, H);
      g.addColorStop(0, hexAlpha(C.green, 0.28)); g.addColorStop(1, hexAlpha(C.green, 0));
      ctx.save(); ctx.lineTo(X(slice[slice.length - 1][0]), H); ctx.lineTo(X(slice[0][0]), H); ctx.closePath(); ctx.fillStyle = g; ctx.fill(); ctx.restore();
      ctx.beginPath(); slice.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
      ctx.strokeStyle = C.green; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
      const last = slice[slice.length - 1];
      const lx = X(last[0]), ly = Y(last[1]);
      const pr = 4 + (pulse ? Math.sin(pulse) * 1.2 : 0);
      ctx.beginPath(); ctx.arc(lx, ly, pr + 6, 0, Math.PI * 2);
      ctx.fillStyle = hexAlpha(C.green, 0.18 + (pulse ? (Math.sin(pulse) + 1) * 0.08 : 0.1)); ctx.fill();
      ctx.beginPath(); ctx.arc(lx, ly, Math.max(3, pr), 0, Math.PI * 2);
      ctx.fillStyle = C.green; ctx.fill();
      paintMarks();
    };
    if (pts.length < 2) { ctx.clearRect(0, 0, W, H); return; }
    if (reduced() || cv.dataset.drawn === "1") {
      draw(1, 0);
      if (!reduced()) {
        let t0p = performance.now();
        const tick = now => {
          draw(1, (now - t0p) / 280);
          cv._pulse = requestAnimationFrame(tick);
        };
        cv._pulse = requestAnimationFrame(tick);
      }
    } else {
      const startAt = performance.now(), dur = 900;
      const tick = now => {
        const frac = Math.min(1, (now - startAt) / dur);
        const eased = 1 - Math.pow(1 - frac, 3);
        draw(eased, (now - startAt) / 280);
        if (frac < 1) cv._pulse = requestAnimationFrame(tick);
        else {
          cv.dataset.drawn = "1";
          const t1p = now;
          const pulse = n => { draw(1, (n - t1p) / 280); cv._pulse = requestAnimationFrame(pulse); };
          cv._pulse = requestAnimationFrame(pulse);
        }
      };
      cv._pulse = requestAnimationFrame(tick);
    }
  }
  function spark(cv, pts, up) {
    const [ctx, W, H] = setup(cv); ctx.clearRect(0, 0, W, H);
    if (!pts || pts.length < 2) return;
    const vals = pts.map(p => p[1]); let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-12) { hi += 1; lo -= 1; }
    const X = i => (i / (pts.length - 1)) * (W - 2) + 1;
    const Y = v => 2 + (hi - v) / (hi - lo) * (H - 4);
    const C = colors();
    const col = up == null ? C.green : (up ? C.green : C.red);
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(i), Y(p[1])) : ctx.moveTo(X(i), Y(p[1])));
    ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.lineJoin = "round"; ctx.stroke();
  }
  function candles(cv, cs, exitLine) {
    const [ctx, W, H] = setup(cv); ctx.clearRect(0, 0, W, H);
    const C = colors();
    if (!cs.length) { ctx.fillStyle = C.text; ctx.font = "15px Inter, -apple-system"; ctx.textAlign = "center"; ctx.fillText("Esperando precios", W / 2, H / 2); return; }
    const volH = H * 0.2, pH = H - volH - 8;
    let lo = Math.min(...cs.map(c => c.l)), hi = Math.max(...cs.map(c => c.h));
    if (exitLine) { lo = Math.min(lo, exitLine); hi = Math.max(hi, exitLine); }
    if (hi - lo < hi * 1e-6) { hi *= 1.01; lo *= 0.99; }
    const Y = v => 8 + (hi - v) / (hi - lo) * (pH - 16); const vmax = Math.max(1e-9, ...cs.map(c => c.v));
    const cw = W / Math.max(cs.length, 20);
    cs.forEach((c, i) => {
      const x = i * cw + cw / 2, up = c.c >= c.o; ctx.strokeStyle = ctx.fillStyle = up ? C.green : C.red;
      ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.lineWidth = 1; ctx.stroke();
      const y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c)); ctx.fillRect(x - cw * 0.35, y1, cw * 0.7, Math.max(1, y2 - y1));
      ctx.globalAlpha = 0.5; const vh = c.v / vmax * volH; ctx.fillRect(x - cw * 0.35, H - vh, cw * 0.7, vh); ctx.globalAlpha = 1;
    });
    if (exitLine) { ctx.setLineDash([5, 4]); ctx.strokeStyle = css("--orange", "#ff9f0a"); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, Y(exitLine)); ctx.lineTo(W, Y(exitLine)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = css("--orange", "#ff9f0a"); ctx.font = "600 11px Inter, -apple-system"; ctx.fillText("Stop trail de riesgo", 6, Y(exitLine) - 5); }
  }
  function ring(cv, score) {
    const [ctx, W, H] = setup(cv); const r = Math.min(W, H) / 2 - 8, cx = W / 2, cy = H / 2; ctx.clearRect(0, 0, W, H);
    const C = colors();
    ctx.lineWidth = 10; ctx.lineCap = "round"; ctx.strokeStyle = css("--c2", "#e5e5ea"); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    if (score == null) return;
    ctx.strokeStyle = score >= 70 ? C.green : css("--yellow", "#ffd60a"); ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * score / 100); ctx.stroke();
    ctx.fillStyle = C.ink; ctx.font = "700 34px Inter, -apple-system"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(score), cx, cy);
  }
  return {line, candles, ring, spark};
})();
