const CACHE = "europe-trip-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./data.js",
  "./config.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  // Never cache API calls or Google Maps
  if (url.hostname.includes("workers.dev") || url.hostname.includes("googleapis.com") || url.hostname.includes("gstatic.com")) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
      const resClone = res.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, resClone));
      return res;
    }).catch(() => cached))
  );
});
