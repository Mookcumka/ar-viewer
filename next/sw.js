// The /next/ test address was retired on 28.10.2026: one address, always current viewer.
// This worker removes itself and its caches so phones that opened /next/ are sent to the main address.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.includes(encodeURIComponent(self.registration.scope))).map(key => caches.delete(key)));
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: "window" })) client.navigate("../");
  })());
});
