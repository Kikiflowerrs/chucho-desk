// hosted static copies refresh every ~2 min + deploy lag, local refreshes every 15s
const STALE_S = location.hostname.endsWith('github.io') ? 420 : 90;
// Chucho Desk app. Plain JS. Plan A: #t=APP_TOKEN -> /api/*. Plan B: #d=DATA_PATH -> ./d/{DATA_PATH}/*.json (polled every 15s).
(() => {
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- credentials from the fragment (#d= / #t=) or the query (?d= / ?t=, for in-app browsers that drop fragments);
// kept in localStorage, then stripped from the address bar ----
(function boot() {
  const h = location.hash.slice(1), hp = new URLSearchParams(h.includes("=") ? h : ""), qp = new URLSearchParams(location.search);
  const t = hp.get("t") || qp.get("t"), d = hp.get("d") || qp.get("d");
  if (t) { localStorage.setItem("desk_t", t); localStorage.removeItem("desk_d"); }
  if (d) { localStorage.setItem("desk_d", d); localStorage.removeItem("desk_t"); }
  if (t || d) {
    qp.delete("t"); qp.delete("d"); const rest = qp.toString();
    history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "") + "#/home");
  }
})();
const TOKEN = localStorage.getItem("desk_t"), DP = localStorage.getItem("desk_d");
const PLAN = TOKEN ? "A" : "B";

async function get(kind, arg) {
  let url, opts = {cache: "no-store"};
  if (TOKEN) {
    const m = {state: "/api/state", chart: "/api/chart?range=" + (arg || "LIVE"), activity: "/api/activity", account: "/api/account",
               coin: "/api/coin/" + arg, audit: "/api/audit/" + arg, coins: null}[kind];
    if (!m) return null; url = m; opts.headers = {Authorization: "Bearer " + TOKEN};
  } else if (DP) {
    url = `./d/${encodeURIComponent(DP)}/` + {state: "state.json", chart: "chart.json", activity: "activity.json", account: "account.json",
           coin: `coin/${arg}.json`, audit: `audit/${arg}.json`, coins: "coins.json"}[kind];
  } else throw new Error("not linked");
  const r = await fetch(url, opts);
  if (r.status === 404 && (kind === "coin" || kind === "audit")) return null;
  if (!r.ok) throw new Error("HTTP " + r.status);
  let j = await r.json();
  if (kind === "chart" && !TOKEN) j = j[arg || "LIVE"];
  return j;
}

// ---- global state ----
const S = {state: null, chart: null, activity: null, account: null, range: "LIVE", lastOk: null, err: null, retryIn: 0, loaded: false, seenPushes: +localStorage.getItem("seen") || 0};
const POLL = 15;
let retryTimer = null;

async function refresh() {
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
    const last = S.lastOk ? new Date(S.lastOk).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}) : "never";
    const el = $("#err"); el.hidden = false; document.body.classList.add("has-err");
    el.textContent = `Desk offline · retrying in ${n}s · last update ${last}`;
    if (--n < 0) n = POLL;
  };
  paint(); retryTimer = setInterval(paint, 1000);
}
function hideErr() { clearInterval(retryTimer); $("#err").hidden = true; document.body.classList.remove("has-err"); }

// ---- formatting (never invent: null -> "—") ----
const usd = v => v == null ? "—" : "$" + Number(v).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const kfmt = v => v == null ? "n/a" : v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + Number(v).toFixed(0);
const pct = v => v == null ? "—" : (v >= 0 ? "+" : "") + Number(v).toFixed(2) + "%";
const SUB = "₀₁₂₃₄₅₆₇₈₉";
const px = v => {
  if (v == null) return "—"; v = Number(v);
  if (v >= 1) return "$" + v.toFixed(4);
  if (v >= 0.001) return "$" + v.toPrecision(4);
  const z = Math.ceil(-Math.log10(v)) - 1, digits = Math.round(v * Math.pow(10, z + 4)).toString().slice(0, 4);
  return "$0.0" + String(z).split("").map(d => SUB[+d]).join("") + digits;   // e.g. $0.0₈6323
};
const hm = ts => ts ? new Date(ts * 1000).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}) : "";
const age = ts => { if (!ts) return "—"; const m = (Date.now() / 1000 - ts) / 60; return m < 60 ? Math.floor(m) + "m old" : (m / 60).toFixed(0) + "h old"; };
const paperPill = () => S.state && S.state.mode === "PAPER" ? `<span class="pill paper">PAPER</span>` : "";

// ---- odometer ----
function odometer(el, text) {
  const old = el.dataset.v || ""; el.dataset.v = text;
  if (reduced() || old.length !== text.length || !el.children.length) {
    el.innerHTML = [...text].map(ch => /\d/.test(ch)
      ? `<span class="odo-d"><span class="odo-s" style="transform:translateY(-${+ch * 66}px)">${[...Array(10).keys()].map(d => `<span>${d}</span>`).join("")}</span></span>`
      : `<span>${esc(ch)}</span>`).join(""); return;
  }
  const kids = [...el.children]; let k = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] !== old[i] && /\d/.test(text[i])) {
      const s = kids[i].firstElementChild; if (!s) continue;
      s.style.transitionDelay = (k++ * 30) + "ms"; s.style.transform = `translateY(-${+text[i] * 66}px)`;
    }
  }
}

// ---- router ----
function route() { const h = location.hash.replace(/^#\/?/, ""); const [a, b] = h.split("/"); return {name: a || "home", arg: b}; }
window.addEventListener("hashchange", render);
document.querySelectorAll(".tabbar button").forEach(b => b.onclick = () => { location.hash = "#/" + b.dataset.tab; });

function render() {
  const r = route(), v = $("#view");
  document.querySelectorAll(".tabbar button").forEach(b => b.classList.toggle("on", b.dataset.tab === r.name));
  if (!TOKEN && !DP) { v.innerHTML = `<div class="title">Chucho Desk</div><div class="empty">Open the desk link once (it has ?d=… or #d=…) to connect this phone.</div>`; return; }
  if (!S.loaded) { v.innerHTML = skeleton(r.name); return; }
  ({home: Home, agents: Agents, activity: Activity, account: Account, coin: Coin, audit: Auditor}[r.name] || Home)(v, r.arg);
}
function skeleton(name) {
  if (name === "home") return `<div class="navbar"></div><div class="skel" style="height:72px;width:70%;margin:8px 0"></div><div class="skel" style="height:22px;width:40%;margin-bottom:12px"></div>
    <div class="skel" style="height:230px;margin:0 -16px;border-radius:0"></div><div class="skel" style="height:32px;margin:8px 0 22px"></div>
    <div class="skel acard" style="aspect-ratio:504/470"></div>`;
  return `<div class="header"></div><div class="skel" style="height:40px;width:50%;margin:6px 0 14px"></div>` +
    [1, 2, 3, 4].map(() => `<div class="skel" style="height:96px;margin-bottom:12px"></div>`).join("");
}

// ---- agent cards ----
const ACOL = {scanner: "var(--cyan)", auditor: "#fff", analyst: "var(--yellow)", executor: "var(--green)", risk: "var(--pink)"};
function statusDot(a) { return `<span class="sdot" style="background:${a.status === "running" ? "var(--green)" : a.status === "paused" ? "var(--orange)" : "var(--red)"}"></span>`; }
function card(a, full) {
  const n = a.name, title = n[0].toUpperCase() + n.slice(1); let body = "";
  if (n === "scanner") {
    const feed = (a.feed || []).map(f => f.verdict === "kill"
      ? `<div class="k">${esc(f.name)} <i>${esc(f.reason)}</i>${laneTag(f.lane === "established" ? "established" : "")}</div>`
      : f.verdict === "wait" ? `<div class="sub">${esc(f.name)} · ${esc(f.reason)}${laneTag("established")}</div>`
      : `<div>${esc(f.name)} · liq ${kfmt(f.liquidity_usd)} · → auditor${laneTag(f.lane)}</div>`).join("");
    body = `<div class="meta" style="color:${ACOL.scanner}">${a.pools} pools${a.estPools ? ` · ${a.estPools} established (${a.estPassed || 0} passed)` : ""}</div><div class="feed">${feed || `<div class="sub">Listening for graduations</div>`}</div>`;
  } else if (n === "auditor") {
    const L = a.last ? a.last.layers : [];
    const strips = [...Array(8).keys()].map(i => { const l = L[i]; return `<div class="strip ${l ? (l.pass === true ? "ok" : l.pass === false ? "no" : "") : ""}"></div>`; }).join("");
    const line = !a.last ? "No coin taken apart yet" : a.last.rejected ? esc(a.last.reason) : "8/8 → Executor";
    body = `<div class="meta">${a.takenApart} taken apart</div><div class="strips">${strips}</div><div style="margin-top:12px">${line}</div>
      <div class="big num">${a.rejected}<span class="sub" style="font-size:15px;font-weight:400"> rejected</span></div>`;
  } else if (n === "analyst") {
    body = `<div class="meta" style="color:${ACOL.analyst}">Scoring · ${esc(a.mode || "rules")}</div><canvas class="ring" data-score="${a.last ? a.last.score : ""}"></canvas>
      <div style="text-align:center;margin-top:6px" class="sub">${a.last ? esc(a.last.name) + " · " + (a.last.pass ? "pass" : esc(a.last.reason)) : "Waiting for a cleared coin"}</div>`;
  } else if (n === "executor") {
    const l = a.last; const filled = l && l.status === "bought";
    body = `<div class="meta" style="color:${ACOL.executor}">${a.trades} trades</div><div style="margin-top:12px">${usd(a.ticket)} · ${a.stackPct}% of stack</div>
      <div class="bar"><i style="width:${l ? (filled ? 100 : 50) : 0}%"></i></div><div class="sub" style="margin-top:6px">${l ? (filled ? "✓ Filled · " + esc(l.name) : "Executing... 50%") : "No signal yet"}</div>`;
  } else if (n === "risk") {
    const l = a.last;
    body = `<div class="meta" style="color:${ACOL.risk}">Guarding · ${a.open} open</div>
      <div style="margin-top:12px">${l ? (l.reason === "trail" ? "Trailed out" : l.reason === "stop" ? "Stopped" : "Closed · " + esc(l.reason)) + " · " + esc(l.name) : "Nothing to guard"}</div>
      <div style="display:flex;gap:8px;margin-top:12px"><span class="pill mono red">stop -${a.stopPct}%</span><span class="pill mono green">trail ${a.trailPct}%</span></div>`;
  }
  let extra = "";
  if (full) {
    const locked = n === "risk" && a.locked;
    extra = `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px">
        <span class="sub">${a.status}${PLAN === "B" ? " · pause/resume via Telegram: “pause " + title + "”" : ""}</span>
        <button class="switch ${a.status !== "paused" ? "on" : ""}" ${PLAN === "B" || locked ? "disabled" : ""} data-pause="${n}"><i></i></button></div>
      <div class="rows" style="margin-top:12px;background:var(--c2)">${(a.decisions || []).slice(0, 20).map(d =>
        `<a class="row" ${d.coin_url ? `href="${esc(d.coin_url)}" target="_blank" rel="noopener"` : ""}><div class="tx"><div class="tt">${esc(d.name || "")} · ${esc(d.verdict)}</div><div class="st">${hm(d.ts)} · ${esc(d.reason || "")}</div></div></a>`).join("") || `<div class="empty">No decisions yet</div>`}</div>
      <a class="sub" href="#/account" style="display:flex;min-height:44px;align-items:center">Settings ›</a>`;
  }
  return `<div class="acard"><h3>${statusDot(a)}${title}<span class="sub" style="margin-left:auto;font-size:15px;font-weight:400">${a.today} today</span></h3>${body}${extra}</div>`;
}
function paintRings(root) { root.querySelectorAll("canvas.ring").forEach(c => Charts.ring(c, c.dataset.score === "" ? null : +c.dataset.score)); }

// ---- lane label: 'new' (fresh pump.fun migrations) vs 'established' (>= 7d old coins from DexScreener) ----
function laneTag(l) {
  if (!l) return "";
  const est = l === "established";
  return `<span class="lane" style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px;margin-left:4px;vertical-align:2px;` +
    `background:${est ? "rgba(10,132,255,.18)" : "rgba(48,209,88,.16)"};color:${est ? "#0a84ff" : "#30d158"}">${est ? "ESTABLISHED" : "NEW"}</span>`;
}
// ---- activity rows ----
function rowHtml(r) {
  const col = {bought: "var(--blue)", sold: "var(--green)", stopped: "var(--red)", rejected: "var(--c2)", x_signal: "#ff9f0a"}[r.kind] || "var(--c2)";
  const href = r.kind === "rejected" ? `#/audit/${r.mint}` : `#/coin/${r.mint}`;
  const vcls = r.kind === "sold" && String(r.value).startsWith("+") ? "up" : (r.kind === "stopped" || String(r.value).startsWith("-")) ? "down" : "";
  return `<a class="row" href="${href}"><div class="ic" style="background:${col}">${esc((r.title || "?").split(" ")[1]?.[0] || "?")}</div>
    <div class="tx"><div class="tt">${esc(r.title)} ${laneTag(r.lane)}</div><div class="st">${esc(r.subtitle)}</div></div><div class="vv ${vcls}">${esc(r.value)}</div></a>`;
}

// ---- screens ----
function Home(v) {
  const st = S.state, unread = Math.max(0, (st.unread || 0) - S.seenPushes);
  const bal = st.balance == null ? "—" : Number(st.balance).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const running = st.agents.filter(a => a.status === "running").length;
  v.innerHTML = `<div class="navbar"><a class="avatar" href="#/account">K</a><a class="brand" href="#/agents">Chucho Desk <span class="chev">›</span></a>
      <button class="iconbtn" id="sbtn" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg></button>
      <button class="iconbtn" id="bell" aria-label="Notifications"><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>${unread ? `<i class="dot"></i>` : ""}</button></div>
    <div class="search" id="search"><input placeholder="Name, symbol or mint" id="q"><div id="qres"></div></div>
    <div class="balance-row"><div class="balance num" id="odo"></div>${paperPill()}</div>
    <div class="today"><span class="${st.todayPct >= 0 ? "up" : "down"}">${pct(st.todayPct)}</span><span class="sub">today</span><span class="pill mult">${Number(st.multiplier).toFixed(2)}×</span></div>
    <div class="chartbox"><canvas id="line"></canvas>${!S.chart || S.chart.points.length < 2 || !S.chart.marks.length ? `<div class="chart-empty">Waiting for the first trade</div>` : ""}</div>
    <div class="ranges">${["LIVE", "1H", "4H", "1D", "1W", "ALL"].map(r => `<button class="${r === S.range ? "on" : ""}" data-r="${r}">${r}</button>`).join("")}</div>
    <div class="section"><h2>Agents · ${running} running</h2></div>
    <div class="carousel">${st.agents.map(a => card(a, false)).join("")}</div>
    <div class="section"><h2>Activity</h2><a href="#/activity">See all</a></div>
    <div class="rows">${(S.activity.rows || []).slice(0, 5).map(rowHtml).join("") || `<div class="empty">Nothing yet tonight</div>`}</div>`;
  odometer($("#odo"), "$" + bal);
  if (S.chart) Charts.line($("#line"), S.chart);
  paintRings(v);
  v.querySelectorAll(".ranges button").forEach(b => b.onclick = async () => { S.range = b.dataset.r; try { S.chart = await get("chart", S.range); } catch (e) {} render(); });
  $("#sbtn").onclick = () => { $("#search").classList.toggle("on"); $("#q").focus(); };
  $("#bell").onclick = () => { S.seenPushes = st.unread || 0; localStorage.setItem("seen", S.seenPushes); location.hash = "#/activity"; };
  $("#q").oninput = async e => {
    const q = e.target.value.trim().toLowerCase(); if (!q) { $("#qres").innerHTML = ""; return; }
    let list = []; try { const c = TOKEN ? null : await get("coins"); list = c ? c.coins : []; } catch (_) {}
    (S.activity.rows || []).forEach(r => { if (r.mint && !list.find(x => x.mint === r.mint)) list.push({mint: r.mint, name: (r.title || "").split(" ").slice(1).join(" ")}); });
    const hits = list.filter(c => (c.name || "").toLowerCase().includes(q) || c.mint.toLowerCase() === q).slice(0, 8);
    $("#qres").innerHTML = `<div class="rows" style="margin-top:8px">${hits.map(h => `<a class="row" href="#/coin/${h.mint}"><div class="tx"><div class="tt">${esc(h.name)}</div><div class="st">${esc(h.mint)}</div></div></a>`).join("") || `<div class="empty">No match</div>`}</div>`;
  };
}
function Agents(v) {
  v.innerHTML = `<div class="title">Agents</div><div class="agents-list">${S.state.agents.map(a => card(a, true)).join("")}</div>`;
  paintRings(v);
  v.querySelectorAll("[data-pause]").forEach(b => b.onclick = async () => {
    if (b.disabled || !TOKEN) return; const a = S.state.agents.find(x => x.name === b.dataset.pause);
    await fetch(`/api/agents/${a.name}/${a.status === "paused" ? "resume" : "pause"}`, {method: "POST", headers: {Authorization: "Bearer " + TOKEN}}); refresh();
  });
}
function Activity(v) {
  v.innerHTML = `<div class="title">Activity</div><div class="rows">${(S.activity.rows || []).map(rowHtml).join("") || `<div class="empty">Nothing yet tonight</div>`}</div>`;
}
const GROUPS = ["scanner", "auditor", "analyst", "executor", "risk", "desk"];
function Account(v) {
  const a = S.account, ro = PLAN === "B";
  const sets = GROUPS.map(g => `<div class="set-group"><h4>${g[0].toUpperCase() + g.slice(1)}</h4><div class="rows">${Object.entries(a.settings).filter(([k]) => k.startsWith(g + ".")).map(([k, val]) =>
      `<div class="set"><label>${esc(k.split(".")[1].replace(/_/g, " "))}</label>${typeof val === "number" && !ro ? `<input type="range" value="${val}" data-k="${k}"><input type="number" value="${val}" data-k="${k}" style="width:80px">` : `<span class="ro">${esc(val)}</span>`}</div>`).join("")}</div></div>`).join("");
  v.innerHTML = `<div class="title">Account</div>
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><span>Mode</span>${paperPill()}</div>
      <div class="seg" style="margin-top:12px"><button class="${a.mode === "PAPER" ? "on" : ""}" ${ro ? "disabled" : ""}>PAPER</button><button class="${a.mode === "LIVE" ? "on" : ""}" ${ro ? "disabled" : ""} id="live">LIVE</button></div>
      ${ro ? `<div class="sub" style="margin-top:8px">Read-only here. Switch in Telegram: “paper” / “live”.</div>` : ""}
      <div style="display:flex;justify-content:space-between;margin-top:14px"><span>Stack</span><b class="num">${usd(a.stack)}</b></div></div>
    <div class="rows">
      <a class="row" href="${esc(a.profile_url)}" target="_blank" rel="noopener"><div class="tx"><div class="tt">Your FOMO profile</div><div class="st">@${esc(a.settings["desk.fomo_handle"])}</div></div><div class="vv sub">›</div></a>
      <button class="row" id="invite" style="width:100%;text-align:left"><div class="tx"><div class="tt">Invite a friend</div><div class="st">Share your FOMO invite</div></div><div class="vv sub">›</div></button>
      <div class="row"><div class="tx"><div class="tt">Telegram</div><div class="st">${a.telegram.connected ? "Connected" : "Not connected"} · ${ro ? "send “status” to test" : ""}</div></div>${ro ? "" : `<button class="pill green" id="testpush">Send test push</button>`}</div>
      <div class="row"><div class="tx"><div class="tt">Notifications</div><div class="st">${esc(a.webPush)}</div></div></div>
      <div class="row"><div class="tx"><div class="tt">Take apart before buying</div><div class="st">Auditor · ${ro ? "change via Telegram" : "turning off asks twice"}</div></div><span class="switch ${a.auditorEnabled ? "on" : ""}" ${ro ? "disabled" : ""}><i></i></span></div>
    </div>
    ${sets}
    ${ro ? `<div class="sub" style="margin:12px 0">Settings are read-only in plan B. Change them in Telegram, e.g. “set stop to -8%”.</div>` : ""}`;
  $("#invite").onclick = async () => {
    const url = a.signup_url;
    try { if (navigator.share) { await navigator.share({url}); return; } } catch (_) { return; }
    try { await navigator.clipboard.writeText(url); } catch (_) {}
    toast("Link copied");
  };
}
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; setTimeout(() => el.hidden = true, 1800); }

async function Coin(v, mint) {
  v.innerHTML = skeleton("coin");
  let c; try { c = await get("coin", mint); } catch (e) { showErr(); }
  if (!c) { v.innerHTML = `<div class="header"><a class="back" href="#/home">‹ Home</a></div><div class="empty">No data for this coin yet.</div>`; return; }
  const p = c.position, since = p && c.price ? (c.price / p.entry - 1) * 100 : null;
  const exitLine = p ? (p.trailActive ? p.trailPrice : p.stopPrice) : null;
  const left = p ? Math.max(0, p.timeoutAt - Date.now() / 1000) : 0;
  v.innerHTML = `<div class="header"><a class="back" href="javascript:history.back()">‹ Back</a><span style="margin-left:auto">${paperPill()}</span></div>
    <div style="display:flex;align-items:center;gap:8px"><div class="title" style="margin:0">${esc(c.name || mint.slice(0, 6))}</div>${c.shield ? `<a class="chip" href="#/audit/${mint}">🛡 ${esc(c.shield)}</a>` : ""}</div>
    <div class="sub">${esc(c.symbol || "")} · Solana · ${c.lane === "established" ? "established lane" : age(c.migratedAt)} ${laneTag(c.lane)}</div>
    <div class="price num" style="margin-top:10px">${px(c.price)}</div>
    ${since != null ? `<div class="${since >= 0 ? "up" : "down"}">${since >= 0 ? "▲" : "▼"} ${Math.abs(since).toFixed(2)}% since entry</div>` : ""}
    <div class="chartbox" style="height:220px;margin-top:10px"><canvas id="candles"></canvas></div>
    <div class="stats"><div><span>Market cap</span><b>${kfmt(c.stats.marketCap)}</b></div><div><span>Liquidity</span><b>${kfmt(c.stats.liquidity)}</b></div>
      <div><span>24h volume</span><b>${kfmt(c.stats.volume24h)}</b></div><div><span>Holders</span><b>${c.stats.holders == null ? "n/a" : c.stats.holders}</b></div></div>
    ${p ? `<div class="card"><div style="display:flex;justify-content:space-between"><b>Your position</b><span class="sub">${usd(p.size)} in · Executor</span></div>
      <div class="lrow" style="padding:10px 0"><span>Stop line</span><span class="v down">${px(p.stopPrice)} · -${p.stopPct}%</span></div>
      <div class="lrow" style="padding:10px 0"><span>Trail line</span><span class="v up">${p.trailActive ? px(p.trailPrice) : "from " + px(p.trailStartPrice)}</span></div>
      <div class="lrow" style="padding:10px 0"><span>Time left</span><span class="v">${Math.floor(left / 3600)}h ${Math.floor(left % 3600 / 60)}m</span></div></div>` : ""}
    <a class="btn ${p ? "red" : "green"}" href="${esc(c.coin_url)}" target="_blank" rel="noopener">${p ? "Sell on FOMO" : "Buy on FOMO"}</a>`;
  Charts.candles($("#candles"), c.candles || [], exitLine);
}

async function Auditor(v, mint) {
  v.innerHTML = skeleton("audit");
  let a = null; try { if (mint) a = await get("audit", mint); else { const l = S.state.agents.find(x => x.name === "auditor"); a = l && l.last; } } catch (e) { showErr(); }
  const head = `<div class="header"><a class="back" href="javascript:history.back()">‹ Back</a></div><div class="title">Auditor</div>`;
  if (!a || !a.layers || !a.layers.length) { v.innerHTML = head + `<div class="empty">No coin taken apart yet</div>`; return; }
  const name = esc(a.name);
  v.innerHTML = head + `<div class="sub" style="text-align:center">${name}</div>
    <div class="discs" id="discs">${a.layers.map(() => `<div class="disc"></div>`).join("")}<div class="beam" id="beam" style="top:-6px"></div></div>
    <div id="verdict" style="text-align:center;margin-bottom:12px;min-height:44px"></div>
    <div class="rows" id="lrows">${a.layers.map(l => `<div class="lrow"><span>${l.n} · ${esc(l.name)}</span><span class="v" data-n="${l.n}">…</span></div>`).join("")}</div>
    <div class="rows" style="margin-top:12px"><div class="row"><div class="tx"><div class="tt">Take apart before buying</div><div class="st">${PLAN === "B" ? "read-only · Telegram" : ""}</div></div><span class="switch ${S.account && S.account.auditorEnabled ? "on" : ""}" ${PLAN === "B" ? "disabled" : ""}><i></i></span></div></div>
    <a class="btn gray" href="${esc(a.coin_url)}" target="_blank" rel="noopener">Open on FOMO</a>`;
  const discs = [...v.querySelectorAll(".disc")], beam = $("#beam"), H = 22;
  const finish = () => {
    $("#verdict").innerHTML = a.rejected ? `<b class="down">Rejected · ${esc(a.reason)}</b><div class="sub">Chucho won't buy ${name}</div>`
      : a.passedCount === 8 ? `<b class="up">Cleared · 8/8 parts</b><div class="sub">${a.sentSize != null ? "Sent to Executor · " + usd(a.sentSize) : "Sent to Executor"}</div>` : "";
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
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
