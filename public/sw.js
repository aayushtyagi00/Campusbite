const offlineCache = "campusbite-offline-v1";
const offlinePage = "/offline.html";

self.addEventListener("install", event => {
  event.waitUntil(caches.open(offlineCache).then(cache => cache.add(offlinePage)));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("campusbite-offline-") && key !== offlineCache).map(key => caches.delete(key)),
  )));
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET" || request.mode !== "navigate" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).catch(async () => {
    const cache = await caches.open(offlineCache);
    return await cache.match(offlinePage) ?? Response.error();
  }));
});
