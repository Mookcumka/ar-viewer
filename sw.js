// Scope-specific names avoid deleting caches belonging to other apps on the origin.
const PREFIX = "ar-style-cube-" + encodeURIComponent(self.registration.scope) + "-";
const CACHE = PREFIX + "v6";
const CORE = ["./", "./index.html", "./scan.html", "./manifest.webmanifest", "./icon.svg", "./ar-data.js", "./viewer.js", "./usdz.js", "./quicklook.svg", "./offline.js"];
const VENDOR = ["./vendor/aframe.min.js", "./vendor/aframe-ar.js", "./vendor/jsQR.js", "./vendor/patt.hiro", "./vendor/camera_para.dat"];
const RESOURCES = [...CORE, ...VENDOR];
const URLS = new Set(RESOURCES.map(path => new URL(path, self.registration.scope).href));
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(RESOURCES);
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("message", event => {
  if (event.data?.type !== "CACHE_STATUS" || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const entries = await Promise.all(RESOURCES.map(path => cache.match(new URL(path, self.registration.scope).href)));
    event.ports[0].postMessage({ ready: entries.every(Boolean) });
  })());
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  url.search = "";
  url.hash = "";
  // Do not intercept or persist arbitrary data, external URLs or another app's pages.
  if (!URLS.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url.href);
    return hit || fetch(event.request);
  })());
});
