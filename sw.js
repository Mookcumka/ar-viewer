importScripts("./version.js");
// Scope-specific names avoid deleting caches belonging to other apps on the origin.
const PREFIX = "ar-style-cube-" + encodeURIComponent(self.registration.scope) + "-";
const CACHE = PREFIX + ARViewerVersion.version + "+" + ARViewerVersion.build + "-v" + ARViewerVersion.cacheVersion;
const CORE = ["./", "./index.html", "./scan.html", "./manifest.webmanifest", "./icon.svg", "./ar-data.js", "./qr-geometry.js", "./viewer.js", "./camera.js", "./qr-tracker.js", "./qr-overlay.js", "./qr-track-worker.js", "./version.js", "./webxr.js", "./object-view.js", "./model-files.js", "./scan-feedback.js", "./usdz.js", "./quicklook.svg", "./offline.js"];
const VENDOR = ["./vendor/jsfeat-min.js", "./vendor/qr-locator.js", "./vendor/aframe.min.js", "./vendor/aframe-ar.js", "./vendor/jsQR.js", "./vendor/meshopt_decoder.js", "./vendor/patt.hiro", "./vendor/camera_para.dat"];
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
    event.ports[0].postMessage({ ready: entries.every(Boolean), scope: self.registration.scope, version: ARViewerVersion.cacheVersion, appVersion: ARViewerVersion.version, build: ARViewerVersion.build });
  })());
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  url.search = "";
  url.hash = "";
  const aliases = ["./qr-sheet/", "./qr-sheet/index.html", "./compare/qr-sheet-1/", "./compare/qr-sheet-1/qr-sheet/", "./compare/qr-sheet-1/qr-sheet/index.html"];
  if (aliases.some(path => new URL(path, self.registration.scope).href === url.href)) {
    event.respondWith(Promise.resolve(Response.redirect(new URL("./index.html?diagnostics=1", self.registration.scope).href, 302)));
    return;
  }
  // Do not intercept or persist arbitrary data, external URLs or another app's pages.
  if (!URLS.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url.href);
    return hit || fetch(event.request);
  })());
});

