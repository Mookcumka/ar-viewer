/* Only viewer code/assets. No scene packets, camera frames, remote model fetches or parent-cache deletion. */
const PREFIX = "exporto-qr-sheet-" + encodeURIComponent(self.registration.scope) + "-";
const CACHE = PREFIX + "v1";
const FILES = ["./", "./index.html", "./style.css", "./codec.js", "./viewer.js", "./ar-button.svg", "../usdz.js", "../vendor/jsQR.js"];
const URLS = FILES.map(p => new URL(p, self.registration.scope).href);
self.addEventListener("install", event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE); await cache.addAll(URLS); await self.skipWaiting();
})()));
self.addEventListener("activate", event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener("message", event => {
  if (event.data?.type !== "CACHE_STATUS" || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    event.ports[0].postMessage({ ready: (await Promise.all(URLS.map(url => cache.match(url)))).every(Boolean), scope: self.registration.scope, version: 1 });
  })());
});
self.addEventListener("fetch", event => {
  // Exact URLs only: never cache fragments/query payloads or imported sheets.
  if (event.request.method !== "GET" || !URLS.includes(event.request.url)) return;
  event.respondWith((async () => (await (await caches.open(CACHE)).match(event.request.url)) || fetch(event.request))());
});
