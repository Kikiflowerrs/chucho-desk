// Service worker: offline shell only. Web Push handlers exist for plan A; this desk runs plan B (Telegram only).
const SHELL = ["./", "index.html", "app.css", "app.js", "chart.js", "manifest.json"];
const CACHE = "desk-v2";
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); });
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.pathname.includes("/d/") || u.pathname.includes("/api/")) return;   // data never cached
  // network first so new deploys show up; cached shell only when offline
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); if (r.ok) caches.open(CACHE).then(k => k.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request, {ignoreSearch: true})));
});
self.addEventListener("push", e => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification("Chucho Desk · now", {body: d.text || "", data: {url: d.url}, icon: "icons/icon-192.png"}));
});
self.addEventListener("notificationclick", e => { e.notification.close(); if (e.notification.data && e.notification.data.url) clients.openWindow(e.notification.data.url); });
