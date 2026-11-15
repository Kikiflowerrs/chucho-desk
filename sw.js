// Service worker v7: offline shell only, never touches the data path, never rewrites the page URL (the ?d= query passes
// through untouched), and never hands Safari a redirected response ("Response served by service worker has redirections").
// Web Push handlers exist for plan A; this desk runs plan B (Telegram only).
const CACHE = "desk-v7";
const SHELL = ["index.html", "app.css?v=7", "app.js?v=7", "chart.js?v=7", "manifest.json?v=7",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"];
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, {cache: "reload"})).catch(() => {})))));
});
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// a redirected Response can't be used for a navigation in Safari: rebuild it as a plain one
async function clean(r) {
  if (!r || !r.redirected) return r;
  const body = await r.blob();
  return new Response(body, {status: r.status, statusText: r.statusText, headers: r.headers});
}
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;
  // never intercept or cache data, the API, or the SSE stream (also skip by Accept)
  if (u.pathname.includes("/d/") || u.pathname.includes("/api/") || u.pathname.includes("/api/stream")) return;
  if ((req.headers.get("Accept") || "").includes("text/event-stream")) return;
  if (u.hostname.includes("trycloudflare.com") || u.pathname.endsWith("/stream")) return;
  if (req.mode === "navigate") {
    // network first, same URL (query kept); offline -> cached index.html
    e.respondWith(fetch(req).then(clean).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put("index.html", c)); }
      return r;
    }).catch(() => caches.match("index.html").then(clean)));
    return;
  }
  e.respondWith(fetch(req).then(clean).then(r => {
    if (r.ok && r.type === "basic") { const c = r.clone(); caches.open(CACHE).then(k => k.put(req, c)); }
    return r;
  }).catch(() => caches.match(req).then(m => m || caches.match(req, {ignoreSearch: true})).then(clean)));
});
self.addEventListener("push", e => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification("Chucho Desk · ahora", {body: d.text || "", data: {url: d.url}, icon: "icons/icon-192.png"}));
});
self.addEventListener("notificationclick", e => { e.notification.close(); if (e.notification.data && e.notification.data.url) clients.openWindow(e.notification.data.url); });
