// Service worker : met les fichiers de l'appli en cache pour qu'elle s'ouvre
// instantanément et fonctionne hors ligne. Change CACHE à chaque mise à jour
// pour forcer les téléphones à récupérer la nouvelle version.
const CACHE = "iwi2me-v14";
const FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./astro.js",
  "./config.js",
  "./img/scene.svg",
  "./img/scene-noel.svg",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((u) => new Request(u, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  // Supprime les anciens caches
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stratégie : réseau d'abord (pour avoir la dernière version), cache si hors ligne.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request, { cache: "no-store" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Notifications push (rappels d'événements envoyés par le serveur)
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: "iwi2me", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "iwi2me", {
    body: d.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: d.tag, data: { url: d.url || "./" }
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow(e.notification.data?.url || "./");
  }));
});
