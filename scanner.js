(function () {
  "use strict";
  const video = document.getElementById("camera"), status = document.getElementById("status"), button = document.getElementById("start");
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
  let active = false, stream = null, generation = 0, frame = 0, lastScan = 0;
  function stop() {
    generation++;
    active = false;
    cancelAnimationFrame(frame);
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    button.disabled = false;
  }
  button.onclick = async function () {
    if (button.disabled) return;
    if (typeof jsQR !== "function" || typeof ARCubeData === "undefined" || !ctx) {
      status.textContent = "Не загружены ресурсы сканера. Откройте приложение с интернетом.";
      return;
    }
    const attempt = ++generation;
    button.disabled = true;
    try {
      const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (attempt !== generation || document.hidden) { next.getTracks().forEach(track => track.stop()); return; }
      stream = next;
      video.srcObject = stream;
      await video.play();
      if (attempt !== generation) return;
      active = true;
      status.textContent = "Ищем QR…";
      frame = requestAnimationFrame(tick);
    } catch (error) {
      if (attempt !== generation) return;
      stop();
      status.textContent = "Не удалось открыть камеру: " + error.message;
    }
  };
  function tick(time) {
    if (!active) return;
    // Decode at most ten frames per second to reduce battery usage.
    if (time - lastScan >= 100 && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      lastScan = time;
      const factor = Math.min(1, 800 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * factor);
      canvas.height = Math.round(video.videoHeight * factor);
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
        if (qr) {
          try {
            const data = ARCubeData.fromUrl(qr.data);
            stop();
            location.href = "./index.html#" + encodeURIComponent(data.payload);
            return;
          } catch (error) { status.textContent = error.message; }
        }
      } catch (error) {
        stop();
        status.textContent = "Ошибка сканирования: " + error.message;
        return;
      }
    }
    frame = requestAnimationFrame(tick);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { stop(); status.textContent = "Камера остановлена. Нажмите «Сканировать», чтобы продолжить."; }
  });
  window.addEventListener("pagehide", stop);
})();
