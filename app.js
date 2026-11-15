// hosted static copies refresh every ~2 min + deploy lag, local refreshes every 10s
const STALE_S = location.hostname.endsWith('github.io') ? 420 : 90;
// Chucho Desk app. Plain JS. Plan A: #t=APP_TOKEN -> /api/*. Plan B: #d=DATA_PATH -> ./d/{DATA_PATH}/*.json (polled every 10s).
(() => {
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- credentials: read ?d= / #d= (or ?t= / #t=) FIRST, store them (localStorage + cookie fallback), then normalise the URL.
// The ?d= stays in the address bar on purpose: iOS "Add to Home Screen" and Telegram's in-app browser each get their OWN
// storage, so the installed app only knows the code if its start URL carries it (manifest has no start_url -> page URL is used).
const store = {
  get(k) { try { const v = localStorage.getItem(k); if (v) return v; } catch (e) {}
    const m = document.cookie.match(new RegExp("(?:^|; )" + k + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : null; },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {}
    try { document.cookie = k + "=" + encodeURIComponent(v) + "; path=" + location.pathname.replace(/[^/]*$/, "") + "; max-age=31536000; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : ""); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {}
    try { document.cookie = k + "=; path=" + location.pathname.replace(/[^/]*$/, "") + "; max-age=0"; } catch (e) {} }
};
function parseCode(raw) {   // accepts the full link, "?d=..", "#d=..", "d=.." or the bare code
  raw = String(raw || "").trim(); if (!raw) return null;
  const m = raw.match(/[?#&]?([dt])=([A-Za-z0-9_\-]{8,})/); if (m) return {k: m[1], v: m[2]};
  if (/^[A-Za-z0-9_\-]{8,}$/.test(raw)) return {k: "d", v: raw};
  return null;
}
function link(k, v) {
  if (k === "t") { store.set("desk_t", v); store.del("desk_d"); } else { store.set("desk_d", v); store.del("desk_t"); }
}
(function boot() {
  let h = location.hash.slice(1); if (h.charAt(0) === "/") h = "";
  const hp = new URLSearchParams(h.includes("=") ? h : ""), qp = new URLSearchParams(location.search);
  const t = hp.get("t") || qp.get("t"), d = hp.get("d") || qp.get("d");
  if (t) link("t", t); else if (d) link("d", d);
  const D = store.get("desk_d");
  // keep (or restore) ?d= in the address bar so Add to Home Screen / reloads keep working; the hash is only the route
  if (D && !store.get("desk_t") && qp.get("d") !== D) { qp.set("d", D); }
  if (t) qp.delete("t");
  const rest = qp.toString(), route0 = /^#\//.test(location.hash) ? location.hash : "#/home";
  const want = location.pathname + (rest ? "?" + rest : "") + route0;
  if (want !== location.pathname + location.search + location.hash) { try { history.replaceState(null, "", want); } catch (e) {} }
})();
const TOKEN = store.get("desk_t"), DP = store.get("desk_d");
const PLAN = TOKEN ? "A" : "B";

async function get(kind, arg) {
  let url, opts = {cache: "no-store"};
  if (TOKEN) {
    const m = {state: "/api/state", chart: "/api/chart?range=" + (arg || "LIVE"), activity: "/api/activity", account: "/api/account",
               coin: "/api/coin/" + arg, audit: "/api/audit/" + arg, coins: null, review: "/api/review"}[kind];
    if (!m) return null; url = m; opts.headers = {Authorization: "Bearer " + TOKEN};
  } else if (DP) {
    url = `./d/${encodeURIComponent(DP)}/` + {state: "state.json", chart: "chart.json", activity: "activity.json", account: "account.json",
           coin: `coin/${arg}.json`, audit: `audit/${arg}.json`, coins: "coins.json", review: "review.json"}[kind];
  } else throw new Error("not linked");
  const r = await fetch(url, opts);
  if (r.status === 404 && (kind === "coin" || kind === "audit" || kind === "review")) return null;
  if (!r.ok) throw new Error("HTTP " + r.status);
  let j = await r.json();
  if (kind === "chart" && !TOKEN) j = j[arg || "LIVE"];
  return j;
}

// ---- global state ----
const S = {state: null, chart: null, activity: null, account: null, review: null, range: "LIVE", lastOk: null, err: null, retryIn: 0, loaded: false, seenPushes: +store.get("seen") || 0};
const POLL = 10;
let retryTimer = null;

async function refresh() {
  if (!TOKEN && !DP) { render(); return; }
  try {
    const [st, ch, ac, acc] = await Promise.all([get("state"), get("chart", S.range), get("activity"), get("account")]);
    S.state = st; S.chart = ch; S.activity = ac; S.account = acc; S.loaded = true;
    const stale = st && st.ts && (Date.now() / 1000 - st.ts) > STALE_S;
    if (stale) throw Object.assign(new Error("stale"), {lastTs: st.ts});
    S.lastOk = Date.now(); S.err = null; hideErr();
  } catch (e) {
    S.err = e; if (e.lastTs) S.lastOk = e.lastTs * 1000; showErr();
  }
  render();
}
function showErr() {
  let n = POLL; clearInterval(retryTimer);
  const paint = () => {
    const last = S.lastOk ? new Date(S.lastOk).toLocaleTimeString("es-MX", {hour: "2-digit", minute: "2-digit"}) : "nunca";
    const el = $("#err"); el.hidden = false; document.body.classList.add("has-err");
    el.textContent = `Desk fuera de línea · reintento en ${n}s · última actualización ${last}`;
    if (--n < 0) n = POLL;
  };
  paint(); retryTimer = setInterval(paint, 1000);
}
function hideErr() { clearInterval(retryTimer); $("#err").hidden = true; document.body.classList.remove("has-err"); }

// ---- formatting (never invent: null -> "—") ----
const usd = v => v == null ? "—" : "$" + Number(v).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const kfmt = v => v == null ? "n/d" : v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + Number(v).toFixed(0);
const pct = v => v == null ? "—" : (v >= 0 ? "+" : "") + Number(v).toFixed(2) + "%";
const SUB = "₀₁₂₃₄₅₆₇₈₉";
const px = v => {
  if (v == null) return "—"; v = Number(v);
  if (v >= 1) return "$" + v.toFixed(4);
  if (v >= 0.001) return "$" + v.toPrecision(4);
  const z = Math.ceil(-Math.log10(v)) - 1, digits = Math.round(v * Math.pow(10, z + 4)).toString().slice(0, 4);
  return "$0.0" + String(z).split("").map(d => SUB[+d]).join("") + digits;   // e.g. $0.0₈6323
};
const hm = ts => ts ? new Date(ts * 1000).toLocaleTimeString("es-MX", {hour: "2-digit", minute: "2-digit"}) : "";
const age = ts => { if (!ts) return "—"; const m = (Date.now() / 1000 - ts) / 60; return m < 60 ? Math.floor(m) + " min" : (m / 60).toFixed(0) + " h"; };
const paperPill = () => S.state && S.state.mode === "PAPER" ? `<span class="pill paper">PAPER</span>` : "";
function todayPnl(st) {
  if (!st || st.balance == null || !st.multiplier) return {pct: st && st.todayPct, usd: null};
  const start = st.balance / st.multiplier;
  return {pct: st.todayPct, usd: st.balance - start};
}
function updatedLine(st) {
  if (!st || !st.ts) return "";
  const s = Math.max(0, Math.round(Date.now() / 1000 - st.ts));
  const txt = s < 60 ? `hace ${s}s` : s < 3600 ? `hace ${Math.floor(s / 60)} min` : `hace ${(s / 3600).toFixed(0)} h`;
  return `<div class="updated">Actualizado ${txt}</div>`;
}

function sourceOf(o) {
  if (!o || typeof o !== "object") return "";
  for (const k of ["copySource", "copy_source", "copiedFrom", "copied_from", "copyFrom", "copy_from", "fomoTrader", "copyTrade", "copy_trade", "leader", "trader"]) {
    const v = o[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}
function sourceTag(o) {
  const s = sourceOf(o);
  return s ? `<span class="tag copy">Copia · ${esc(s)}</span>` : "";
}

function askConfirm(title, body, yesLabel) {
  return new Promise(resolve => {
    const box = $("#confirm");
    $("#confirm-title").textContent = title;
    $("#confirm-body").textContent = body || "";
    const yes = $("#confirm-yes"), no = $("#confirm-no");
    yes.textContent = yesLabel || "Confirmar";
    const close = (ok) => { box.hidden = true; yes.onclick = no.onclick = null; resolve(ok); };
    yes.onclick = () => close(true);
    no.onclick = () => close(false);
    box.hidden = false;
    yes.focus();
  });
}

// ---- odometer ----
function odometer(el, text) {
  const old = el.dataset.v || ""; el.dataset.v = text;
  const h = parseFloat(getComputedStyle(el).fontSize) || 66;
  if (reduced() || old.length !== text.length || !el.children.length) {
    el.innerHTML = [...text].map(ch => /\d/.test(ch)
      ? `<span class="odo-d" style="height:${h}px"><span class="odo-s" style="transform:translateY(-${+ch * h}px)">${[...Array(10).keys()].map(d => `<span style="height:${h}px;line-height:${h}px">${d}</span>`).join("")}</span></span>`
      : `<span>${esc(ch)}</span>`).join(""); return;
  }
  const kids = [...el.children]; let k = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] !== old[i] && /\d/.test(text[i])) {
      const s = kids[i].firstElementChild; if (!s) continue;
      s.style.transitionDelay = (k++ * 30) + "ms"; s.style.transform = `translateY(-${+text[i] * h}px)`;
    }
  }
}

// ---- router ----
function route() { const h = location.hash.replace(/^#\/?/, ""); const [a, b] = h.split("/"); return {name: a || "home", arg: b}; }
window.addEventListener("hashchange", render);
document.querySelectorAll(".tabbar button").forEach(b => b.onclick = () => { location.hash = "#/" + b.dataset.tab; });

function render() {
  const r = route(), v = $("#view");
  document.querySelectorAll(".tabbar button").forEach(b => b.classList.toggle("on", b.dataset.tab === r.name || (["coin", "audit"].includes(r.name) && b.dataset.tab === "home" && r.name === "coin") || (r.name === "audit" && b.dataset.tab === "agents")));
  if (!TOKEN && !DP) { hideErr(); linkScreen(v); return; }
  if (!S.loaded) { v.innerHTML = skeleton(r.name); return; }
  ({home: Home, agents: Agents, activity: Activity, account: Account, coin: Coin, audit: Auditor}[r.name] || Home)(v, r.arg);
}
function linkScreen(v) {
  if ($("#linkcode")) return;   // don't wipe what he is typing on the next poll
  v.innerHTML = `<div class="title">Chucho Desk</div>
    <div class="empty">Este teléfono todavía no está conectado. Pega aquí el enlace privado que te mandó Chucho por Telegram (o solo el código) y dale Conectar.</div>
    <form id="linkform" class="rows" style="padding:14px;margin-top:12px" autocomplete="off">
      <input id="linkcode" type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://…/chucho-desk/?d=…"
        style="width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid #333;background:#111;color:#fff;font-size:16px">
      <button class="btn" type="submit" style="margin-top:10px;width:100%">Conectar</button>
      <div id="linkmsg" class="sub" style="margin-top:8px"></div>
    </form>`;
  $("#linkform").onsubmit = e => {
    e.preventDefault();
    const c = parseCode($("#linkcode").value);
    if (!c) { $("#linkmsg").textContent = "No reconozco ese código. Pega el enlace completo."; return; }
    link(c.k, c.v);
    location.replace(location.pathname + (c.k === "d" ? "?d=" + encodeURIComponent(c.v) : "") + "#/home");
  };
}
function skeleton(name) {
  if (name === "home") return `<div class="navbar"></div><div class="skel" style="height:72px;width:70%;margin:8px 0"></div><div class="skel" style="height:22px;width:40%;margin-bottom:12px"></div>
    <div class="skel" style="height:120px;border-radius:16px;margin-bottom:12px"></div>
    <div class="skel" style="height:180px;margin:0 -16px;border-radius:0"></div><div class="skel" style="height:32px;margin:8px 0 22px"></div>`;
  return `<div class="header"></div><div class="skel" style="height:40px;width:50%;margin:6px 0 14px"></div>` +
    [1, 2, 3, 4].map(() => `<div class="skel" style="height:96px;margin-bottom:12px"></div>`).join("");
}

// ---- agent cards ----
const ACOL = {scanner: "var(--cyan)", auditor: "#fff", analyst: "var(--yellow)", executor: "var(--green)", risk: "var(--pink)"};
const ANAME = {scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk"};
const ASTATUS = {running: "en marcha", paused: "pausado", down: "caído"};
function statusDot(a) { return `<span class="sdot" style="background:${a.status === "running" ? "var(--green)" : a.status === "paused" ? "var(--orange)" : "var(--red)"}"></span>`; }
function card(a, full) {
  const n = a.name, title = ANAME[n] || (n[0].toUpperCase() + n.slice(1)); let body = "";
  if (n === "scanner") {
    const feed = (a.feed || []).map(f => f.verdict === "kill"
      ? `<div class="k">${esc(f.name)} <i>${esc(f.reason)}</i>${laneTag(f.lane === "established" ? "established" : "")}</div>`
      : f.verdict === "wait" ? `<div class="sub">${esc(f.name)} · ${esc(f.reason)}${laneTag("established")}</div>`
      : `<div>${esc(f.name)} · liq ${kfmt(f.liquidity_usd)} · → auditor${laneTag(f.lane)}</div>`).join("");
    body = `<div class="meta" style="color:${ACOL.scanner}">${a.pools} pools${a.estPools ? ` · ${a.estPools} establecidas (${a.estPassed || 0} pasaron)` : ""}</div><div class="feed">${feed || `<div class="sub">Escuchando graduaciones</div>`}</div>`;
  } else if (n === "auditor") {
    const L = a.last ? a.last.layers : [];
    const strips = [...Array(8).keys()].map(i => { const l = L[i]; return `<div class="strip ${l ? (l.pass === true ? "ok" : l.pass === false ? "no" : "") : ""}"></div>`; }).join("");
    const line = !a.last ? "Todavía no desmontó ninguna moneda" : a.last.rejected ? esc(a.last.reason) : "8/8 → Executor";
    body = `<div class="meta">${a.takenApart} desmontadas</div><div class="strips">${strips}</div><div style="margin-top:12px">${line}</div>
      <div class="big num">${a.rejected}<span class="sub" style="font-size:15px;font-weight:400"> rechazadas</span></div>`;
  } else if (n === "analyst") {
    body = `<div class="meta" style="color:${ACOL.analyst}">Puntaje · ${esc(a.mode || "rules")}</div><canvas class="ring" data-score="${a.last ? a.last.score : ""}"></canvas>
      <div style="text-align:center;margin-top:6px" class="sub">${a.last ? esc(a.last.name) + " · " + (a.last.pass ? "pasa" : esc(a.last.reason)) : "Esperando una moneda aprobada"}</div>`;
  } else if (n === "executor") {
    const l = a.last; const filled = l && l.status === "bought";
    body = `<div class="meta" style="color:${ACOL.executor}">${a.trades} trades</div><div style="margin-top:12px">${usd(a.ticket)} · ${a.stackPct}% del stack</div>
      <div class="bar"><i style="width:${l ? (filled ? 100 : 50) : 0}%"></i></div><div class="sub" style="margin-top:6px">${l ? (filled ? "✓ Completado · " + esc(l.name) : "Ejecutando... 50%") : "Sin señal todavía"}</div>`;
  } else if (n === "risk") {
    const l = a.last;
    const lastTxt = !l ? "Nada que cuidar" : (l.reason === "trail" ? "Salió por trail" : l.reason === "stop" ? "Salió por stop" : "Cerrada · " + esc(l.reason)) + " · " + esc(l.name);
    body = `<div class="meta" style="color:${ACOL.risk}">Cuidando · ${a.open} abiertas</div>
      <div style="margin-top:12px">${lastTxt}</div>
      <div style="display:flex;gap:8px;margin-top:12px"><span class="pill mono red">stop -${a.stopPct}%</span><span class="pill mono green">trail ${a.trailPct}%</span></div>`;
  }
  let extra = "";
  if (full) {
    const locked = n === "risk" && a.locked;
    extra = `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px">
        <span class="sub">${ASTATUS[a.status] || a.status}${PLAN === "B" ? " · pausa/reanuda en Telegram: “pause " + title + "”" : ""}</span>
        <button class="switch ${a.status !== "paused" ? "on" : ""}" ${PLAN === "B" || locked ? "disabled" : ""} data-pause="${n}"><i></i></button></div>
      <div class="rows" style="margin-top:12px;background:var(--c2)">${(a.decisions || []).slice(0, 20).map(d =>
        `<a class="row" ${d.coin_url ? `href="${esc(d.coin_url)}" target="_blank" rel="noopener"` : ""}><div class="tx"><div class="tt">${esc(d.name || "")} · ${esc(d.verdict)}</div><div class="st">${hm(d.ts)} · ${esc(d.reason || "")}</div></div></a>`).join("") || `<div class="empty">Sin decisiones todavía</div>`}</div>
      <a class="sub" href="#/account" style="display:flex;min-height:44px;align-items:center">Ajustes ›</a>`;
  }
  return `<div class="acard"><h3>${statusDot(a)}${title}<span class="sub" style="margin-left:auto;font-size:15px;font-weight:400">${a.today} hoy</span></h3>${body}${extra}</div>`;
}
function paintRings(root) { root.querySelectorAll("canvas.ring").forEach(c => Charts.ring(c, c.dataset.score === "" ? null : +c.dataset.score)); }

// ---- lane label ----
function laneTag(l) {
  if (!l || l === "-") return "";
  const map = {
    established: {t: "Establecida", bg: "rgba(10,132,255,.18)", c: "#0a84ff"},
    robinhood: {t: "Robinhood", bg: "rgba(191,90,242,.18)", c: "#bf5af2"},
    new: {t: "Nueva", bg: "rgba(48,209,88,.16)", c: "#30d158"}
  };
  const m = map[l] || {t: l, bg: "rgba(235,235,245,.12)", c: "rgba(235,235,245,.6)"};
  return `<span class="lane" style="background:${m.bg};color:${m.c}">${esc(m.t)}</span>`;
}
// ---- activity rows ----
function rowHtml(r) {
  const col = {bought: "var(--blue)", sold: "var(--green)", stopped: "var(--red)", rejected: "var(--c2)", skipped: "var(--c2)", x_signal: "#ff9f0a"}[r.kind] || "var(--c2)";
  const href = (r.kind === "rejected" || r.kind === "skipped") ? `#/audit/${r.mint}` : `#/coin/${r.mint}`;
  const vcls = r.kind === "sold" && String(r.value).startsWith("+") ? "up" : (r.kind === "stopped" || String(r.value).startsWith("-")) ? "down" : "";
  return `<a class="row" href="${href}"><div class="ic" style="background:${col}">${esc((r.title || "?").split(" ")[1]?.[0] || (r.title || "?").slice(0, 1))}</div>
    <div class="tx"><div class="tt">${esc(r.title)} ${laneTag(r.lane)}${sourceTag(r)}</div><div class="st">${esc(r.subtitle)}</div></div><div class="vv ${vcls}">${esc(r.value)}</div></a>`;
}

function targetOf(p) {
  if (!p) return null;
  return p.targetPrice ?? p.target_price ?? p.target ?? p.tp2Price ?? p.tp2_price ?? null;
}
function posCard(p) {
  const chg = (p.last != null && p.entry) ? (p.last / p.entry - 1) * 100 : null;
  const tgt = targetOf(p);
  const href = p.mint ? `#/coin/${p.mint}` : "#/home";
  const sizeLine = p.origSize && p.origSize !== p.size
    ? `${usd(p.size)} de ${usd(p.origSize)}`
    : usd(p.size);
  return `<a class="pos-card" href="${href}">
    <div class="pos-top"><div class="pos-name">${esc(p.name || (p.mint || "").slice(0, 6))}${laneTag(p.lane)}${sourceTag(p)}</div>
      <div class="pos-pnl ${chg == null ? "" : chg >= 0 ? "up" : "down"}">${chg == null ? "—" : pct(chg)}</div></div>
    <div class="pos-size">${sizeLine} · ${p.last != null ? px(p.last) : "sin precio"}</div>
    <div class="pos-metrics">
      <div><span>Entrada</span><b>${px(p.entry)}</b></div>
      <div><span>Stop</span><b class="down">${px(p.stopPrice)}</b></div>
      <div><span>Objetivo</span><b class="up">${px(tgt)}</b></div>
    </div>
  </a>`;
}

function signalItems() {
  const raw = (S.state && (S.state.signals || S.state.skips || S.state.recentSignals)) || (S.activity && S.activity.signals) || null;
  const toItem = (r, fallback) => {
    const kind = (r.action || r.verdict || r.status || r.kind || fallback || "").toString().toUpperCase();
    const enter = /^(ENTER|BOUGHT|BUY|PASS|FILLED)$/.test(kind) || String(r.value || "").toLowerCase() === "enter";
    const skip = /^(SKIP|SKIPPED|REJECT|REJECTED)$/.test(kind) || /skip/i.test(String(r.value || ""));
    if (!enter && !skip && !fallback) return null;
    const action = enter ? "ENTER" : "SKIP";
    const name = r.name || (r.title ? r.title.replace(/^(Rejected|Bought|Sold|Stopped|Skip(ped)?)\s+/i, "") : (r.mint || "").slice(0, 6));
    return {mint: r.mint, name, action, reason: r.reason || r.subtitle || r.value || "", ts: r.ts, raw: r};
  };
  if (Array.isArray(raw) && raw.length) return raw.map(r => toItem(r)).filter(Boolean).slice(0, 8);
  return ((S.activity && S.activity.rows) || [])
    .filter(r => r.kind === "bought" || r.kind === "rejected" || r.kind === "skipped" || /^(enter|skip|skipped)$/i.test(String(r.value || "")))
    .slice(0, 8)
    .map(r => toItem(r, r.kind === "bought" ? "ENTER" : "SKIP"))
    .filter(Boolean);
}
function sigRow(s) {
  const href = s.action === "SKIP" && s.mint ? `#/audit/${s.mint}` : (s.mint ? `#/coin/${s.mint}` : "#/activity");
  return `<a class="sig-row" href="${href}"><span class="badge ${s.action === "ENTER" ? "enter" : "skip"}">${s.action}</span>
    <div class="tx"><div class="tt">${esc(s.name)}${sourceTag(s.raw || s)}</div><div class="st">${esc(s.reason)}${s.ts ? " · " + hm(s.ts) : ""}</div></div></a>`;
}

// ---- screens ----
function Home(v) {
  const st = S.state, unread = Math.max(0, (st.unread || 0) - S.seenPushes);
  const bal = st.balance == null ? "—" : Number(st.balance).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const running = st.agents.filter(a => a.status === "running").length;
  const pnl = todayPnl(st);
  const positions = st.openPositions || [];
  const sigs = signalItems();
  const pauseBanner = st.kill && (st.kill.entriesPaused || st.kill.dailyPause)
    ? `<div class="banner">${st.kill.entriesPaused ? "Entradas pausadas" : ""}${st.kill.entriesPaused && st.kill.dailyPause ? " · " : ""}${st.kill.dailyPause ? esc(st.kill.dailyPause) : ""}</div>`
    : "";
  v.innerHTML = `<div class="navbar"><a class="avatar" href="#/account">C</a><a class="brand" href="#/agents">Chucho Desk <span class="chev">›</span></a>
      <button class="iconbtn" id="sbtn" aria-label="Buscar"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg></button>
      <button class="iconbtn" id="bell" aria-label="Notificaciones"><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>${unread ? `<i class="dot"></i>` : ""}</button></div>
    <div class="search" id="search"><input placeholder="Nombre, símbolo o mint" id="q" autocomplete="off"><div id="qres"></div></div>
    <div class="balance-row"><div class="balance num" id="odo"></div>${paperPill()}</div>
    <div class="today"><span class="today-amt ${pnl.pct >= 0 ? "up" : "down"}">${pnl.usd == null ? pct(pnl.pct) : usd(pnl.usd)}</span>
      <span class="${pnl.pct >= 0 ? "up" : "down"}">${pct(pnl.pct)}</span><span class="sub">hoy</span>
      <span class="pill mult">${Number(st.multiplier).toFixed(2)}×</span></div>
    ${updatedLine(st)}
    ${pauseBanner}
    <div class="section"><h2>Posiciones · ${positions.length}</h2></div>
    ${positions.length ? positions.map(posCard).join("") : `<div class="empty" style="padding:16px">Sin posiciones abiertas</div>`}
    <div class="chartbox"><canvas id="line"></canvas>${!S.chart || S.chart.points.length < 2 || !S.chart.marks.length ? `<div class="chart-empty">Esperando el primer trade</div>` : ""}</div>
    <div class="ranges">${["LIVE", "1H", "4H", "1D", "1W", "ALL"].map(r => `<button class="${r === S.range ? "on" : ""}" data-r="${r}">${r}</button>`).join("")}</div>
    <div class="section"><h2>Señales</h2></div>
    <div class="rows">${sigs.length ? sigs.map(sigRow).join("") : `<div class="empty">Sin señales recientes</div>`}</div>
    <div class="section"><h2>Agentes · ${running} en marcha</h2></div>
    <div class="carousel">${st.agents.map(a => card(a, false)).join("")}</div>
    <div class="section"><h2>Actividad</h2><a href="#/activity">Ver todo</a></div>
    <div class="rows">${(S.activity.rows || []).slice(0, 5).map(rowHtml).join("") || `<div class="empty">Nada todavía esta noche</div>`}</div>`;
  odometer($("#odo"), "$" + bal);
  if (S.chart) Charts.line($("#line"), S.chart);
  paintRings(v);
  v.querySelectorAll(".ranges button").forEach(b => b.onclick = async () => { S.range = b.dataset.r; try { S.chart = await get("chart", S.range); } catch (e) {} render(); });
  $("#sbtn").onclick = () => { $("#search").classList.toggle("on"); $("#q").focus(); };
  $("#bell").onclick = () => { S.seenPushes = st.unread || 0; store.set("seen", String(S.seenPushes)); location.hash = "#/activity"; };
  $("#q").oninput = async e => {
    const q = e.target.value.trim().toLowerCase(); if (!q) { $("#qres").innerHTML = ""; return; }
    let list = []; try { const c = TOKEN ? null : await get("coins"); list = c ? c.coins : []; } catch (_) {}
    (S.activity.rows || []).forEach(r => { if (r.mint && !list.find(x => x.mint === r.mint)) list.push({mint: r.mint, name: (r.title || "").split(" ").slice(1).join(" ")}); });
    const hits = list.filter(c => (c.name || "").toLowerCase().includes(q) || c.mint.toLowerCase() === q).slice(0, 8);
    $("#qres").innerHTML = `<div class="rows" style="margin-top:8px">${hits.map(h => `<a class="row" href="#/coin/${h.mint}"><div class="tx"><div class="tt">${esc(h.name)}</div><div class="st">${esc(h.mint)}</div></div></a>`).join("") || `<div class="empty">Sin coincidencias</div>`}</div>`;
  };
}
function Agents(v) {
  v.innerHTML = `<div class="title">Agentes</div><div class="agents-list">${S.state.agents.map(a => card(a, true)).join("")}</div>`;
  paintRings(v);
  v.querySelectorAll("[data-pause]").forEach(b => b.onclick = async () => {
    if (b.disabled || !TOKEN) return; const a = S.state.agents.find(x => x.name === b.dataset.pause);
    await fetch(`/api/agents/${a.name}/${a.status === "paused" ? "resume" : "pause"}`, {method: "POST", headers: {Authorization: "Bearer " + TOKEN}}); refresh();
  });
}
function Activity(v) {
  v.innerHTML = `<div class="title">Actividad</div><div class="rows">${(S.activity.rows || []).map(rowHtml).join("") || `<div class="empty">Nada todavía esta noche</div>`}</div>`;
}
const GROUPS = ["scanner", "auditor", "analyst", "executor", "risk", "data", "desk"];
const GNAME = {scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk", data: "Datos", desk: "Desk"};

async function postKill(action) {
  if (!TOKEN) { toast("Usa Telegram: " + action.replace(/_/g, " ")); return; }
  const r = await fetch("/api/kill/" + action, {method: "POST", headers: {Authorization: "Bearer " + TOKEN}});
  let j = {}; try { j = await r.json(); } catch (_) {}
  toast(j.result || j.error || (r.ok ? "Listo" : "Falló"));
  await refresh();
}
function killCard(a, ro) {
  const k = (a && a.kill) || (S.state && S.state.kill) || {};
  const paused = !!k.entriesPaused;
  const status = paused ? "Las entradas están pausadas" : "Las entradas están activas";
  const sub = k.dailyPause ? status + " · " + k.dailyPause : status + " · " + (k.pending || 0) + " pendientes · " + (k.openPaper || 0) + " PAPER abiertas";
  const btns = ro
    ? `<div class="sub" style="margin-top:8px">Cámbialo en Telegram: “pause entries” · “cancel pending” · “request exit”.</div>`
    : `<div class="kill-grid">
        <button class="btn ${paused ? "green" : "orange"}" data-kill="${paused ? "resume_entries" : "pause_entries"}">${paused ? "Reanudar entradas" : "Pausar entradas"}</button>
        <button class="btn gray" data-kill="cancel_pending">Cancelar pendientes</button>
        <button class="btn red" data-kill="request_exit" style="grid-column:1/-1">Pedir salida · cerrar PAPER</button>
      </div>`;
  return `<div class="kill-zone" id="killcard"><div class="kz-head"><div class="kz-title">Interruptor de pánico</div><span class="pill mono ${paused ? "red" : "green"}">${paused ? "pausado" : "activo"}</span></div>
    <div class="sub" style="margin-top:6px">${esc(sub)}</div>${btns}</div>`;
}
function reviewCard(rev) {
  if (!rev) return "";
  const skipped = rev.skippedThenRan || rev.skipped_then_ran || rev.skipped || [];
  const stopped = rev.enteredThenStopped || rev.entered_then_stopped || rev.stopped || [];
  const list = (arr, empty) => arr.length
    ? arr.map(x => `<div class="row"><div class="tx"><div class="tt">${esc(x.name || x.mint || "")}</div><div class="st">${esc(x.reason || x.note || "")}</div></div></div>`).join("")
    : `<div class="empty" style="padding:16px">${empty}</div>`;
  return `<div class="section"><h2>Revisión semanal</h2></div>
    <div class="card review-card"><b>Saltó y luego subió</b></div>
    <div class="rows" style="margin-bottom:12px">${list(skipped, "Ninguna esta semana")}</div>
    <div class="card review-card"><b>Entró y salió por stop</b></div>
    <div class="rows">${list(stopped, "Ninguna esta semana")}</div>`;
}
async function Account(v) {
  const a = S.account, ro = PLAN === "B";
  if (S.review == null) {
    try { S.review = await get("review"); } catch (_) { S.review = false; }
    if (S.review == null) S.review = false;
  }
  const sets = GROUPS.map(g => `<div class="set-group"><h4>${GNAME[g] || (g[0].toUpperCase() + g.slice(1))}</h4><div class="rows">${Object.entries(a.settings).filter(([k]) => k.startsWith(g + ".")).map(([k, val]) =>
      `<div class="set"><label>${esc(k.split(".")[1].replace(/_/g, " "))}</label>${typeof val === "number" && !ro ? `<input type="range" value="${val}" data-k="${k}"><input type="number" value="${val}" data-k="${k}" style="width:80px">` : `<span class="ro">${esc(val)}</span>`}</div>`).join("")}</div></div>`).join("");
  v.innerHTML = `<div class="title">Cuenta</div>
    <div class="install">Para instalar la app: en iPhone abre este enlace en Safari → Compartir → Agregar a pantalla de inicio. En Android, Chrome → Instalar app. Ábrelo una vez con el enlace privado antes de instalarlo.</div>
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><span>Modo</span>${paperPill()}</div>
      <div class="seg" style="margin-top:12px"><button class="${a.mode === "PAPER" ? "on" : ""}" data-mode="PAPER" ${ro ? "disabled" : ""}>PAPER</button><button class="${a.mode === "LIVE" ? "on" : ""}" ${ro ? "disabled" : ""} id="live" data-mode="LIVE">LIVE</button></div>
      ${ro ? `<div class="sub" style="margin-top:8px">Solo lectura aquí. Cambia el modo en Telegram: “paper” / “live”.</div>` : ""}
      <div style="display:flex;justify-content:space-between;margin-top:14px"><span>Stack</span><b class="num">${usd(a.stack)}</b></div></div>
    ${killCard(a, ro)}
    <div class="rows">
      <a class="row" href="${esc(a.profile_url)}" target="_blank" rel="noopener"><div class="tx"><div class="tt">Tu perfil de FOMO</div><div class="st">@${esc(a.settings["desk.fomo_handle"])}</div></div><div class="vv sub">›</div></a>
      <button class="row" id="invite" style="width:100%;text-align:left"><div class="tx"><div class="tt">Invitar a un amigo</div><div class="st">Comparte tu invitación de FOMO</div></div><div class="vv sub">›</div></button>
      <div class="row"><div class="tx"><div class="tt">Telegram</div><div class="st">${a.telegram.connected ? "Conectado" : "No conectado"} · ${ro ? "manda “status” para probar" : ""}</div></div>${ro ? "" : `<button class="pill green" id="testpush">Enviar prueba</button>`}</div>
      <div class="row"><div class="tx"><div class="tt">Notificaciones</div><div class="st">${esc(a.webPush)}</div></div></div>
      <div class="row"><div class="tx"><div class="tt">Desmontar antes de comprar</div><div class="st">Auditor · ${ro ? "cámbialo en Telegram" : "apagarlo pide confirmación dos veces"}</div></div><span class="switch ${a.auditorEnabled ? "on" : ""}" id="aud-sw" ${ro ? "disabled" : ""}><i></i></span></div>
    </div>
    ${reviewCard(S.review)}
    ${sets}
    ${ro ? `<div class="sub" style="margin:12px 0">Los ajustes son de solo lectura en plan B. Cámbialos en Telegram, por ejemplo “set stop to -8%”.</div>` : ""}`;
  $("#invite").onclick = async () => {
    const url = a.signup_url;
    try { if (navigator.share) { await navigator.share({url}); return; } } catch (_) { return; }
    try { await navigator.clipboard.writeText(url); } catch (_) {}
    toast("Enlace copiado");
  };
  document.querySelectorAll("[data-kill]").forEach(b => b.onclick = async () => {
    const act = b.dataset.kill;
    const asks = {
      request_exit: ["¿Cerrar todas las posiciones PAPER ahora?", "Esto pide la salida de todo lo abierto en PAPER. No se puede deshacer.", "Cerrar todo"],
      cancel_pending: ["¿Cancelar las órdenes pendientes?", "Se cancelan las entradas que todavía no se ejecutaron.", "Cancelar pendientes"],
      pause_entries: ["¿Pausar las entradas?", "El desk no abrirá posiciones nuevas hasta que las reanudes.", "Pausar"],
      resume_entries: ["¿Reanudar las entradas?", "El desk volverá a poder abrir posiciones.", "Reanudar"]
    };
    if (asks[act]) { const ok = await askConfirm(asks[act][0], asks[act][1], asks[act][2]); if (!ok) return; }
    await postKill(act);
  });
  if (!ro) {
    v.querySelectorAll("[data-mode]").forEach(b => b.onclick = async () => {
      if (b.disabled) return;
      const m = b.dataset.mode;
      if (m === "LIVE") {
        const ok = await askConfirm("¿Pasar a LIVE?", "Escribe LIVE en el siguiente paso mental: esto no es PAPER. Confirma solo si quieres dinero real.", "Pasar a LIVE");
        if (!ok) return;
        const typed = prompt("Escribe LIVE para confirmar");
        if (typed !== "LIVE") { toast("Cancelado"); return; }
        const r = await fetch("/api/mode", {method: "POST", headers: {Authorization: "Bearer " + TOKEN, "Content-Type": "application/json"}, body: JSON.stringify({mode: "LIVE", confirm: "LIVE"})});
        toast(r.ok ? "Modo LIVE" : "No se pudo cambiar");
      } else {
        const r = await fetch("/api/mode", {method: "POST", headers: {Authorization: "Bearer " + TOKEN, "Content-Type": "application/json"}, body: JSON.stringify({mode: "PAPER"})});
        toast(r.ok ? "Modo PAPER" : "No se pudo cambiar");
      }
      await refresh();
    });
    v.querySelectorAll("[data-k]").forEach(inp => {
      inp.onchange = async () => {
        const k = inp.dataset.k, val = inp.type === "number" || inp.type === "range" ? Number(inp.value) : inp.value;
        v.querySelectorAll(`[data-k="${k}"]`).forEach(x => { x.value = inp.value; });
        const r = await fetch("/api/settings", {method: "POST", headers: {Authorization: "Bearer " + TOKEN, "Content-Type": "application/json"}, body: JSON.stringify({[k]: val})});
        if (!r.ok) toast("No se pudo guardar");
      };
    });
    const sw = $("#aud-sw");
    if (sw && !sw.hasAttribute("disabled")) sw.onclick = async () => {
      const turningOff = a.auditorEnabled;
      if (turningOff) {
        const ok1 = await askConfirm("¿Apagar el Auditor?", "Sin el Auditor, el desk no desmonta la moneda antes de comprar.", "Seguir");
        if (!ok1) return;
        const ok2 = await askConfirm("Confirma otra vez", "¿Seguro que quieres comprar sin desmontar?", "Apagar Auditor");
        if (!ok2) return;
      }
      const r = await fetch("/api/settings", {method: "POST", headers: {Authorization: "Bearer " + TOKEN, "Content-Type": "application/json"}, body: JSON.stringify({"auditor.enabled": !a.auditorEnabled})});
      toast(r.ok ? (turningOff ? "Auditor apagado" : "Auditor encendido") : "No se pudo guardar");
      await refresh();
    };
  }
}
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; setTimeout(() => el.hidden = true, 1800); }

async function Coin(v, mint) {
  v.innerHTML = skeleton("coin");
  let c; try { c = await get("coin", mint); } catch (e) { showErr(); }
  if (!c) { v.innerHTML = `<div class="header"><a class="back" href="#/home">‹ Inicio</a></div><div class="empty">Todavía no hay datos de esta moneda.</div>`; return; }
  const p = c.position, since = p && c.price ? (c.price / p.entry - 1) * 100 : null;
  const exitLine = p ? (p.trailActive ? p.trailPrice : p.stopPrice) : null;
  const left = p ? Math.max(0, p.timeoutAt - Date.now() / 1000) : 0;
  const tgt = p ? targetOf(p) : null;
  const laneTxt = c.lane === "established" ? "carril establecida" : c.lane === "robinhood" ? "carril Robinhood" : age(c.migratedAt);
  v.innerHTML = `<div class="header"><a class="back" href="javascript:history.back()">‹ Atrás</a><span style="margin-left:auto">${paperPill()}</span></div>
    <div style="display:flex;align-items:center;gap:8px"><div class="title" style="margin:0">${esc(c.name || mint.slice(0, 6))}</div>${c.shield ? `<a class="chip" href="#/audit/${mint}">🛡 ${esc(c.shield)}</a>` : ""}</div>
    <div class="sub">${esc(c.symbol || "")} · Solana · ${laneTxt} ${laneTag(c.lane)}${sourceTag(c)}${p ? sourceTag(p) : ""}</div>
    <div class="price num" style="margin-top:10px">${px(c.price)}</div>
    ${since != null ? `<div class="${since >= 0 ? "up" : "down"}">${since >= 0 ? "▲" : "▼"} ${Math.abs(since).toFixed(2)}% desde la entrada</div>` : ""}
    <div class="chartbox" style="height:220px;margin-top:10px"><canvas id="candles"></canvas></div>
    <div class="stats"><div><span>Market cap</span><b>${kfmt(c.stats.marketCap)}</b></div><div><span>Liquidez</span><b>${kfmt(c.stats.liquidity)}</b></div>
      <div><span>Volumen 24h</span><b>${kfmt(c.stats.volume24h)}</b></div><div><span>Holders</span><b>${c.stats.holders == null ? "n/d" : c.stats.holders}</b></div></div>
    ${p ? `<div class="card"><div style="display:flex;justify-content:space-between"><b>Tu posición</b><span class="sub">${usd(p.size)} en · Executor</span></div>
      <div class="lrow" style="padding:10px 0"><span>Entrada</span><span class="v">${px(p.entry)}</span></div>
      <div class="lrow" style="padding:10px 0"><span>Stop</span><span class="v down">${px(p.stopPrice)} · -${p.stopPct}%</span></div>
      <div class="lrow" style="padding:10px 0"><span>Objetivo</span><span class="v up">${px(tgt)}</span></div>
      <div class="lrow" style="padding:10px 0"><span>Trail</span><span class="v up">${p.trailActive ? px(p.trailPrice) : "desde " + px(p.trailStartPrice)}</span></div>
      <div class="lrow" style="padding:10px 0"><span>Tiempo restante</span><span class="v">${Math.floor(left / 3600)}h ${Math.floor(left % 3600 / 60)}m</span></div></div>` : ""}
    <a class="btn ${p ? "red" : "green"}" href="${esc(c.coin_url)}" target="_blank" rel="noopener">${p ? "Vender en FOMO" : "Comprar en FOMO"}</a>`;
  Charts.candles($("#candles"), c.candles || [], exitLine);
}

async function Auditor(v, mint) {
  v.innerHTML = skeleton("audit");
  let a = null; try { if (mint) a = await get("audit", mint); else { const l = S.state.agents.find(x => x.name === "auditor"); a = l && l.last; } } catch (e) { showErr(); }
  const head = `<div class="header"><a class="back" href="javascript:history.back()">‹ Atrás</a></div><div class="title">Auditor</div>`;
  if (!a || !a.layers || !a.layers.length) { v.innerHTML = head + `<div class="empty">Todavía no desmontó ninguna moneda</div>`; return; }
  const name = esc(a.name);
  v.innerHTML = head + `<div class="sub" style="text-align:center">${name}</div>
    <div class="discs" id="discs">${a.layers.map(() => `<div class="disc"></div>`).join("")}<div class="beam" id="beam" style="top:-6px"></div></div>
    <div id="verdict" style="text-align:center;margin-bottom:12px;min-height:44px"></div>
    <div class="rows" id="lrows">${a.layers.map(l => `<div class="lrow"><span>${l.n} · ${esc(l.name)}</span><span class="v" data-n="${l.n}">…</span></div>`).join("")}</div>
    <div class="rows" style="margin-top:12px"><div class="row"><div class="tx"><div class="tt">Desmontar antes de comprar</div><div class="st">${PLAN === "B" ? "solo lectura · Telegram" : ""}</div></div><span class="switch ${S.account && S.account.auditorEnabled ? "on" : ""}" ${PLAN === "B" ? "disabled" : ""}><i></i></span></div></div>
    <a class="btn gray" href="${esc(a.coin_url)}" target="_blank" rel="noopener">Abrir en FOMO</a>`;
  const discs = [...v.querySelectorAll(".disc")], beam = $("#beam"), H = 22;
  const finish = () => {
    $("#verdict").innerHTML = a.rejected ? `<b class="down">Rechazada · ${esc(a.reason)}</b><div class="sub">Chucho no compra ${name}</div>`
      : a.passedCount === 8 ? `<b class="up">Aprobada · 8/8 partes</b><div class="sub">${a.sentSize != null ? "Enviada a Executor · " + usd(a.sentSize) : "Enviada a Executor"}</div>` : "";
    beam.style.display = "none";
  };
  const paint = (i) => {
    const l = a.layers[i], cell = v.querySelector(`[data-n="${l.n}"]`);
    discs[i].classList.add(l.pass === true ? "ok" : l.pass === false ? "no" : "na");
    cell.className = "v " + (l.pass === true ? "ok" : l.pass === false ? "no" : "na");
    cell.textContent = (l.pass === true ? "✓ " : l.pass === false ? "✕ " : "") + (l.value || "");
  };
  if (reduced()) { a.layers.forEach((_, i) => paint(i)); finish(); return; }
  let i = 0;
  const step = () => {
    if (i >= a.layers.length) { finish(); return; }
    beam.style.top = (i * H) + "px";
    setTimeout(() => { setTimeout(() => { paint(i); i++; step(); }, 150); }, 350);
  };
  step();
}

refresh(); setInterval(refresh, POLL * 1000);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js", {updateViaCache: "none"}).then(r => r.update && r.update()).catch(() => {});
})();
