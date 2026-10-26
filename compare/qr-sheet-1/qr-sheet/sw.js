/* Migration only for the already-installed experimental child cache. No second application/cache. */
const OLD_PREFIX="exporto-qr-sheet-"+encodeURIComponent(self.registration.scope)+"-";
const scope=new URL(self.registration.scope);
const target=new URL(scope.pathname.endsWith("/compare/qr-sheet-1/qr-sheet/") ? "../../../index.html?diagnostics=1" : "../index.html?diagnostics=1",scope);
self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith(OLD_PREFIX))await caches.delete(key);
  await self.clients.claim();
  const clients=await self.clients.matchAll({type:"window"});
  await Promise.all(clients.filter(c=>c.url.startsWith(scope.href)).map(c=>c.navigate(target.href).catch(()=>null)));
})()));
self.addEventListener("fetch",event=>{
  if(event.request.mode==="navigate" && event.request.method==="GET" && event.request.url.startsWith(scope.href))event.respondWith(Promise.resolve(Response.redirect(target.href,302)));
});
