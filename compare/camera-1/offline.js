(function () {
  "use strict";
  const status = document.getElementById("offline");
  if (!status) return;
  if (!("serviceWorker" in navigator)) { status.textContent = "Офлайн-режим недоступен в этом браузере."; return; }
  navigator.serviceWorker.register("./sw.js").then(registration => {
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (worker) worker.addEventListener("statechange", () => {
        if (worker.state === "redundant") status.textContent = "Не удалось сохранить все офлайн-ресурсы. Повторите с интернетом.";
      });
    });
    return navigator.serviceWorker.ready;
  }).then(registration => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { status.textContent = "Офлайн-готовность не подтверждена. Повторите с интернетом."; }, 5000);
    channel.port1.onmessage = event => {
      clearTimeout(timer);
      status.textContent = event.data.ready
        ? "Ресурсы сохранены офлайн. Работа камеры без сети требует проверки на вашем устройстве."
        : "Не все ресурсы сохранены. Откройте приложение с интернетом.";
      channel.port1.close();
    };
    registration.active.postMessage({ type: "CACHE_STATUS" }, [channel.port2]);
  }).catch(() => { status.textContent = "Офлайн-кэш недоступен. Проверьте HTTPS и соединение."; });
})();
