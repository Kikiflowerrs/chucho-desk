// Service worker: offline shell only. Web Push handlers exist for plan A; this desk runs plan B (Telegram only).
const SHELL = ["./", "index.html", "app.css", "app.js", "chart.js", "manifest.json"];
self.addEventListener("install", e => e.waitUntil(caches.open("desk-v1").then(c => c.addAll(SHELL))));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.pathname.includes("/d/") || u.pathname.includes("/api/")) return;   // data never cached
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
self.addEventListener("push", e => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification("Grok Bot · now", {body: d.text || "", data: {url: d.url}, icon: "icons/icon-192.png"}));
});
self.addEventListener("notificationclick", e => { e.notification.close(); if (e.notification.data && e.notification.data.url) clients.openWindow(e.notification.data.url); });
