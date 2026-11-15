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


function applyTheme() {
  const t = store.get("desk_theme") || "light";
  document.body.classList.toggle("dark", t === "dark");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === "dark" ? "#000000" : "#FFFFFF";
  return t;
}
function toggleTheme() {
  store.set("desk_theme", (store.get("desk_theme") || "light") === "dark" ? "light" : "dark");
  applyTheme();
  const cv = document.querySelector(".hero-chart canvas, #line");
  if (cv && cv.dataset) delete cv.dataset.drawn;
  render();
}
applyTheme();

function liveToast(msg) {
  const host = $("#toasts"); if (!host || !msg) return;
  const el = document.createElement("div"); el.className = "toast-pill"; el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
function maybeToast(live) {
  const feed = (live && live.feed) || [];
  if (!feed.length) return;
  const keyOf = it => (it.ts || "") + "|" + (it.kind || "") + "|" + (it.mint || "") + "|" + (it.text || "");
  if (S.seenFeed == null) { S.seenFeed = new Set(feed.slice(0, 12).map(keyOf)); return; }
  const fresh = [];
  for (const it of feed) {
    const k = keyOf(it);
    if (S.seenFeed.has(k)) break;
    fresh.push(it);
  }
  fresh.reverse().slice(0, 4).forEach(it => {
    const kind = (it.kind || "").toLowerCase();
    const name = it.symbol || it.name || "";
    if (kind === "fill" || kind === "bought" || kind === "enter") {
      const amt = (it.text || "").match(/\$[0-9.]+/);
      liveToast("✅ Compré " + (amt ? amt[0] : "") + (name ? " · " + name : ""));
    } else if (kind === "exit" || kind === "sold" || kind === "stop" || kind === "tp") {
      const amt = (it.text || "").match(/[+−$-][0-9$.]+/);
      liveToast("✅ Vendí " + (amt ? amt[0] : "") + (name ? " · " + name : ""));
    } else if (kind === "mirror") {
      liveToast("🚀 " + (it.text || "Movimiento del espejo"));
    } else if (kind === "skip" || kind === "rejected") {
      /* keep quiet on the flood of skips */
    } else if (kind === "dip") {
      liveToast("🚀 " + (it.text || "Dip"));
    }
  });
  feed.slice(0, 20).forEach(it => S.seenFeed.add(keyOf(it)));
}


async function get(kind, arg) {
  let url, opts = {cache: "no-store"};
  if (TOKEN) {
    const m = {state: "/api/state", chart: "/api/chart?range=" + (arg || "LIVE"), activity: "/api/activity", account: "/api/account",
               live: "/api/live", coin: "/api/coin/" + arg, audit: "/api/audit/" + arg, coins: null, review: "/api/review"}[kind];
    if (!m) return null; url = m; opts.headers = {Authorization: "Bearer " + TOKEN};
  } else if (DP) {
    url = `./d/${encodeURIComponent(DP)}/` + {state: "state.json", chart: "chart.json", activity: "activity.json", account: "account.json",
           live: "live.json", coin: `coin/${arg}.json`, audit: `audit/${arg}.json`, coins: "coins.json", review: "review.json"}[kind];
  } else throw new Error("not linked");
  if (!TOKEN) url += (url.includes("?") ? "&" : "?") + "r=" + Date.now();
  const r = await fetch(url, opts);
  if (r.status === 404 && (kind === "coin" || kind === "audit" || kind === "review" || kind === "live")) return null;
  if (!r.ok) throw new Error("HTTP " + r.status);
  let j = await r.json();
  if (kind === "chart" && !TOKEN) j = j[arg || "LIVE"];
  return j;
}

// ---- global state ----
const S = {state: null, chart: null, activity: null, account: null, live: null, review: null, range: "1D", lastOk: null, err: null, retryIn: 0, loaded: false, seenPushes: +store.get("seen") || 0, prevOdo: null, seenFeed: null, recapShown: store.get("recap_shown") || ""};
const POLL = 8;
let retryTimer = null;

async function refresh() {
  if (!TOKEN && !DP) { render(); return; }
  try {
    const [st, ch, ac, acc, lv] = await Promise.all([get("state"), get("chart", S.range), get("activity"), get("account"), get("live")]);
    S.state = st; S.chart = ch; S.activity = ac; S.account = acc; S.live = lv; S.loaded = true;
    maybeToast(lv || st);
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
const hm = ts => ts ? new Date(ts * 1000).toLocaleTimeString("es-MX", {hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ}) : "";
const hms = ts => ts ? new Date(ts * 1000).toLocaleTimeString("es-MX", {hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: TZ}) : "";
const age = ts => { if (!ts) return "—"; const m = (Date.now() / 1000 - ts) / 60; return m < 60 ? Math.floor(m) + " min" : (m / 60).toFixed(0) + " h"; };
const paperPill = () => S.state && S.state.mode === "PAPER" ? `<span class="pill paper">PAPER</span>` : "";
function fmtMult(m) {
  if (m == null || !Number.isFinite(Number(m))) return "—";
  const n = Number(m), two = n.toFixed(2);
  if (two === "1.00" && Math.abs(n - 1) >= 0.00005) return n.toFixed(3) + "x";
  return two + "x";
}
const TZ = "America/Hermosillo";
function todayPnl(st) {
  if (!st) return {pct: null, usd: null};
  const pct = st.todayPct;
  if (st.todayUsd != null && Number.isFinite(Number(st.todayUsd))) return {pct, usd: Number(st.todayUsd)};
  if (st.startBalance != null && st.balance != null) return {pct, usd: Number(st.balance) - Number(st.startBalance)};
  return {pct, usd: null};
}
function freshSecs(ts) { return ts == null ? null : Math.max(0, Math.round(Date.now() / 1000 - ts)); }
function freshText(ts) {
  const s = freshSecs(ts); if (s == null) return "";
  return s < 60 ? `actualizado hace ${s}s` : s < 3600 ? `actualizado hace ${Math.floor(s / 60)} min` : `actualizado hace ${(s / 3600).toFixed(0)} h`;
}
function updatedLine(st) {
  if (!st || !st.ts) return "";
  return `<div class="fresh" id="fresh">${freshText(st.ts)}</div>`;
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
  v.innerHTML = `<div class="connect" id="linkbox">
      <h1>Chucho Desk</h1>
      <p>Este teléfono todavía no está conectado. Pega el enlace privado que te mandó Chucho por Telegram (o solo el código) y dale Conectar.</p>
      <form id="linkform" autocomplete="off">
        <input id="linkcode" type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://…/chucho-desk/?d=…">
        <button class="btn" type="submit">Conectar</button>
        <div id="linkmsg" class="sub" style="margin-top:8px"></div>
      </form>
    </div>`;
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
function liveSrc() { return S.live || S.state || {}; }

function headBar(title, backHref) {
  const dark = (store.get("desk_theme") || "light") === "dark";
  return `<div class="live-head">
    <a class="back-arr" href="${backHref || "#/home"}" aria-label="Atrás">‹</a>
    <div class="live-title">${esc(title)} <span class="live-dot" aria-hidden="true"></span></div>
    <div class="live-tools">
      <span class="live-badge"><i></i> EN VIVO</span>
      <button class="theme-btn" id="themebtn" type="button" aria-label="Cambiar tema">${dark ? "☀️" : "🌙"}</button>
    </div>
  </div>`;
}

function tickerHtml(items) {
  const arr = items || [];
  if (!arr.length) return "";
  const badge = t => {
    const chg = t.chg;
    const cls = chg == null ? "" : (chg >= 0 ? "up" : "down");
    return `<span class="tbadge ${t.kind || ""}">${esc(t.symbol || "")}${chg == null ? "" : ` <span class="chg ${cls}">${pct(chg)}</span>`}</span>`;
  };
  const row = arr.map(badge).join("");
  return `<div class="ticker" aria-hidden="true"><div class="ticker-track">${row}${row}</div></div>`;
}

function tradesTable(rows) {
  const list = rows || [];
  if (!list.length) return `<div class="empty">Sin trades abiertos ni dips en espera</div>`;
  const line = r => {
    const up = r.pnlPct == null ? null : r.pnlPct >= 0;
    const dot = up == null ? "var(--t2)" : (up ? "var(--green)" : "var(--red)");
    const href = r.mint ? `#/coin/${r.mint}` : "#/home";
    const lane = r.chain || r.lane || "";
    return `<a class="tf-row" href="${href}">
      <div class="tf-main">
        <span class="tf-val ${up == null ? "" : (up ? "up" : "down")}">${r.value == null ? "—" : usd(r.value)}</span>
        <span class="tf-dot" style="background:${dot}"></span>
        <div class="tf-meta">
          <div class="tf-sym">${esc(r.symbol || "")}</div>
          <div class="tf-st">${esc(r.status || "")}${lane ? " · " + esc(lane) : ""}</div>
        </div>
      </div>
      <div class="tf-size">${r.size == null ? "—" : usd(r.size)}</div>
    </a>`;
  };
  return `<div class="tf-wrap"><div class="tf-head"><span>valor</span><span style="text-align:right">metido</span></div>${list.map(line).join("")}</div>`;
}

function agentsGrid(agents, running, ops) {
  const list = agents || [];
  const card = a => {
    const lines = (a.lines || []).map((ln, i) => i === 0 ? esc(ln) : `<span class="dim">${esc(ln)}</span>`).join("\n");
    return `<div class="agcard">
      <div class="ag-top">${statusDot(a)}<span class="skill ${esc(a.tone || "gray")}">${esc(a.skill || "")}</span><span class="ag-alias">${esc(a.alias || a.name || "")}</span></div>
      <div class="ag-lines">${esc(a.action || "En espera")}\n${lines}</div>
    </div>`;
  };
  return `<div class="agents-head"><h2>${list.length} agentes · en vivo</h2>
    <div class="agents-ops">🟢 ${running} corriendo · ${ops == null ? "—" : Number(ops).toFixed(1)} ops/min</div></div>
    <div class="agrid">${list.map(card).join("")}</div>`;
}

function termFeed(feed, sinceTs) {
  const list = (feed || []).slice(0, 40);
  if (!list.length) return `<div class="term"><div class="term-h">actividad</div><div class="sub">Sin eventos todavía</div></div>`;
  const rows = list.map(it => {
    const fresh = sinceTs && it.ts && it.ts > sinceTs;
    return `<div class="term-row ${esc(it.tone || it.kind || "")}${fresh ? " fresh-row" : ""}"><span class="term-ts">${hms(it.ts)}</span><span>${esc(it.text || "")}</span></div>`;
  }).join("");
  return `<div class="term"><div class="term-h"><span>actividad</span><span>en vivo</span></div>${rows}</div>`;
}

function posLive(p) {
  const chg = p.pnlPct != null ? p.pnlPct : ((p.last != null && p.entry) ? (p.last / p.entry - 1) * 100 : null);
  const href = p.mint ? `#/coin/${p.mint}` : "#/home";
  const trader = p.trader || p.copyFrom;
  return `<a class="pos-live" href="${href}">
    <div class="pos-top">
      <div class="pos-name">${esc(p.symbol || p.name || "")}${laneTag(p.lane)}${trader ? `<span class="tag copy">espejo · ${esc(trader)}</span>` : ""}</div>
      <canvas class="spark" data-spark="${esc(JSON.stringify(p.spark || []))}" data-up="${chg == null ? "" : (chg >= 0 ? "1" : "0")}"></canvas>
      <div class="pos-pnl ${chg == null ? "" : chg >= 0 ? "up" : "down"}">${chg == null ? "—" : pct(chg)}</div>
    </div>
    <div class="pos-size">${usd(p.value != null ? p.value : p.size)} · ${p.status ? esc(p.status) : ""}</div>
    <div class="pos-metrics">
      <div><span>Entrada</span><b>${px(p.entry)}</b></div>
      <div><span>Stop</span><b class="down">${px(p.stopPrice)}</b></div>
      <div><span>Objetivo</span><b class="up">${px(targetOf(p))}</b></div>
    </div>
  </a>`;
}

function dipsPanel(dips) {
  const list = dips || [];
  if (!list.length) return "";
  const rows = list.map(d => `<div class="dip-row"><div><b>${esc(d.symbol || d.name || "")}</b>
    <div class="sub">${esc(d.status || "esperando dip")}${d.trader ? " · " + esc(d.trader) : ""}${d.dropPct != null ? " · −" + d.dropPct + "% / " + d.needPct + "%" : ""}</div></div>
    <div>${d.last != null ? px(d.last) : "—"}</div></div>`).join("");
  return `<div class="section"><h2>Esperando dip</h2></div><div class="panel">${rows}</div>`;
}

function mirrorPanel(rows) {
  const list = rows || [];
  if (!list.length) return "";
  const line = t => {
    const last = t.last;
    if (!last) return `<div class="mir-row"><b>${esc(t.trader)}</b><span class="sub">sin movimiento detectado</span></div>`;
    const age = last.txAge != null ? ` · tx hace ${last.txAge}s` : (last.ts ? " · " + hm(last.ts) : "");
    return `<div class="mir-row"><div><b>${esc(t.trader)}</b><div class="sub">${esc(last.side || "")} ${esc(last.symbol || "")}${age}</div></div><span class="sub">${esc(last.reason || "")}</span></div>`;
  };
  return `<div class="section"><h2>Espejo · top 5</h2></div><div class="panel">${list.map(line).join("")}</div>`;
}

function recapHtml(r) {
  if (!r) return "";
  const profit = r.profit;
  const cls = profit == null ? "" : (profit >= 0 ? "up" : "down");
  const best = r.best ? `${esc(r.best.symbol || r.best.name)} · ${usd(r.best.pnlUsd)}` : "—";
  const worst = r.worst ? `${esc(r.worst.symbol || r.worst.name)} · ${usd(r.worst.pnlUsd)}` : "—";
  return `<div class="sheet-card" role="dialog" aria-labelledby="recap-title">
    <div class="sheet-handle"></div>
    <div class="section" style="margin-top:0"><h2 id="recap-title">${esc(r.label || "Resumen de la sesión")}</h2>
      <button type="button" id="sheet-close" class="sub">Cerrar</button></div>
    <div class="sub">Inicial ${usd(r.initial)}</div>
    <div class="sheet-x"><div class="balance num" style="height:auto;font-size:44px">${usd(r.result)}</div>
      <span class="mult-dark">${fmtMult(r.multiplier)}</span></div>
    <div class="amt ${cls}" style="font:700 22px var(--display)">${profit == null ? "—" : usd(profit)} <span>${pct(r.profitPct)}</span></div>
    <div class="sheet-grid">
      <div><span>Trades</span><b>${r.trades || 0}</b><div class="sub">${r.wins || 0}W · ${r.losses || 0}L</div></div>
      <div><span>Monedas</span><b>${r.coins || 0}</b></div>
      <div><span>Agentes</span><b>${r.agents || 0}</b></div>
    </div>
    <div class="panel" style="margin:0"><div class="dip-row"><span>Mejor</span><b class="up">${best}</b></div>
      <div class="dip-row"><span>Peor</span><b class="down">${worst}</b></div></div>
  </div>`;
}

function openRecap(r, auto) {
  const box = $("#sheet"); if (!box || !r) return;
  box.hidden = false; box.innerHTML = recapHtml(r);
  const close = () => { box.hidden = true; box.innerHTML = ""; };
  box.onclick = e => { if (e.target === box || e.target.id === "sheet-close") close(); };
  if (auto) { S.recapShown = String(r.nightStart || ""); store.set("recap_shown", S.recapShown); }
}

function paintSparks(root) {
  root.querySelectorAll("canvas.spark").forEach(cv => {
    let pts = [];
    try { pts = JSON.parse(cv.dataset.spark || "[]"); } catch (e) {}
    const up = cv.dataset.up === "" ? null : cv.dataset.up === "1";
    if (Charts.spark) Charts.spark(cv, pts, up);
  });
}

function Home(v) {
  const st = S.state || {}, live = S.live || {};
  const src = Object.keys(live).length ? live : st;
  const unread = Math.max(0, (st.unread || 0) - S.seenPushes);
  const balNum = src.balance != null ? src.balance : st.balance;
  const bal = balNum == null ? "—" : Number(balNum).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const pnl = todayPnl(src);
  const initial = src.initial != null ? src.initial : 80;
  const trades = src.trades != null ? src.trades : ((st.openPositions || []).length);
  const mult = src.initialMultiple != null ? src.initialMultiple : src.multiplier;
  const wl = `${src.wins || 0}W–${src.losses || 0}L`;
  const positions = src.openPositions || st.openPositions || [];
  const agents = src.agents && src.agents[0] && src.agents[0].skill ? src.agents : null;
  const running = src.running != null ? src.running : (st.agents || []).filter(a => a.status === "running").length;
  const pauseBanner = st.kill && (st.kill.entriesPaused || st.kill.dailyPause)
    ? `<div class="banner">${st.kill.entriesPaused ? "Entradas pausadas" : ""}${st.kill.entriesPaused && st.kill.dailyPause ? " · " : ""}${st.kill.dailyPause ? esc(st.kill.dailyPause) : ""}</div>`
    : "";
  const equity = (src.equity && src.equity.length >= 2) ? {points: src.equity, start: src.startBalance, marks: (S.chart && S.chart.marks) || []} : S.chart;
  const ts = src.ts || st.ts;
  v.innerHTML = `${headBar("Chucho Desk")}
    ${updatedLine({ts})}
    ${pauseBanner}
    ${tickerHtml(src.ticker || positions.map(p => ({symbol: p.symbol || p.name, mint: p.mint, kind: "open", chg: p.pnlPct})))}
    <div class="hero">
      <div class="balance-row"><div class="balance num" id="odo"></div>${paperPill()}</div>
      <div class="hero-sub">inicial ${usd(initial)} | ${trades} trades <span class="mult-dark">${fmtMult(mult)}</span></div>
      <div class="chartbox hero-chart"><canvas id="line"></canvas>${!equity || !(equity.points && equity.points.length >= 2) ? `<div class="chart-empty">Esperando el primer dato de equity</div>` : ""}</div>
      <div class="hero-pnl"><div class="amt ${pnl.usd == null && pnl.pct == null ? "" : ((pnl.usd != null ? pnl.usd : pnl.pct) >= 0 ? "up" : "down")}">${pnl.usd == null ? "—" : usd(pnl.usd)} <span>${pct(pnl.pct)}</span></div><div class="wl">${esc(wl)}${src.winRate != null ? " · " + src.winRate + "%" : ""}</div></div>
    </div>
    ${tradesTable(src.tradesTable || positions.map(p => ({...p, symbol: p.symbol || p.name, chain: p.lane})))}
    ${agents ? agentsGrid(agents, running, src.opsPerMin) : `<div class="section"><h2>Agentes · ${running} en marcha</h2></div><div class="carousel">${(st.agents || []).map(a => card(a, false)).join("")}</div>`}
    ${termFeed(src.feed, S.prevFeedTs)}
    <div class="section"><h2>Posiciones · ${positions.length}</h2></div>
    ${positions.length ? positions.map(posLive).join("") : `<div class="empty" style="padding:16px">Sin posiciones abiertas</div>`}
    ${dipsPanel(src.dips)}
    ${mirrorPanel(src.mirror)}
    <button type="button" class="recap-btn" id="recapbtn">${esc((src.recap && src.recap.label) || "Resumen de la sesión")}</button>`;
  const prev = S.prevOdo;
  S.prevOdo = "$" + bal;
  if (prev && prev !== S.prevOdo) { odometer($("#odo"), prev); requestAnimationFrame(() => odometer($("#odo"), S.prevOdo)); }
  else odometer($("#odo"), S.prevOdo);
  if (equity && equity.points) Charts.line($("#line"), equity);
  paintRings(v);
  paintSparks(v);
  const tb = $("#themebtn"); if (tb) tb.onclick = toggleTheme;
  const rb = $("#recapbtn"); if (rb) rb.onclick = () => openRecap(src.recap);
  if (src.recap && src.recap.autoOpen && S.recapShown !== String(src.recap.nightStart || "")) openRecap(src.recap, true);
  S.prevFeedTs = Date.now() / 1000;
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
setInterval(() => { const el = document.getElementById('fresh'); const ts = (S.live && S.live.ts) || (S.state && S.state.ts); if (el && ts) el.textContent = freshText(ts); }, 1000);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js", {updateViaCache: "none"}).then(r => r.update && r.update()).catch(() => {});
})();
