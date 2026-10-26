/* Readiness belongs to this application's registration, never to an ancestor worker. */
(function () {
  "use strict";
  const status = document.getElementById("offline"); if (!status) return;
  if (!navigator.serviceWorker) { status.textContent = "Офлайн-режим недоступен в этом браузере."; return; }
  (async () => {
    const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    const worker = await new Promise((resolve, reject) => {
      const watched = new Set();
      const cleanup = () => { clearTimeout(timer); registration.removeEventListener("updatefound", watch); watched.forEach(w => w.removeEventListener("statechange", watch)); };
      const watch = () => {
        if (registration.active?.state === "activated") { const active = registration.active; cleanup(); resolve(active); return; }
        for (const w of [registration.installing,registration.waiting,registration.active]) if (w && !watched.has(w)) { watched.add(w); w.addEventListener("statechange",watch); }
      };
      const timer=setTimeout(()=>{cleanup();reject(new Error("Офлайн-копия ещё не готова"));},15000);
      registration.addEventListener("updatefound",watch);watch();
    });
    const ownScope = new URL("./",location.href).href;
    if (registration.scope !== ownScope || worker.scriptURL !== new URL("./sw.js",location.href).href) throw new Error("Неверная область кэша");
    const result=await new Promise((resolve,reject)=>{
      const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(new Error("Нет ответа кэша"));},5000);
      channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};
      worker.postMessage({type:"CACHE_STATUS"},[channel.port2]);
    });
    status.textContent = result.ready && result.scope===ownScope && result.version===7
      ? "Ресурсы сохранены офлайн. Работа камеры без сети требует проверки на вашем устройстве."
      : "Не все ресурсы этой версии сохранены. Повторите с интернетом.";
  })().catch(error=>{status.textContent="Офлайн-готовность не подтверждена: "+error.message;});
})();
