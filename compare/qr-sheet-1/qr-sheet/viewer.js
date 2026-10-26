/* Generic QRL1 camera lifecycle. No test models. Quick Look success is NOT inferred from a click. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id), codec = window.ExportoQr;
  const ui = Object.fromEntries(["state","detail","parts","camera","video","canvas","start","stop","reset","error","result","facts","ar","ar-help","save-model","excluded","offline","file","report"].map(id => [id,$(id)]));
  const collector = new codec.Collector(), context = ui.canvas.getContext("2d", { willReadFrequently: true });
  let epoch = 0, cameraEpoch = 0, stream = null, frame = null, lastScan = 0, busy = false, complete = false, modelUrl = null;
  let source = null, lastError = "", lastErrorAt = 0, importing = false;
  const report = { schema: "Exporto-Safari-QR-report-1", build: "safari-qr-20261026-v1", started: new Date().toISOString(),
    userAgent: navigator.userAgent, source: null, scene: null, events: [],
    capabilities: { secureContext: isSecureContext, sha256: !!crypto?.subtle, gzip: typeof DecompressionStream === "function",
      camera: !!navigator.mediaDevices?.getUserMedia, quickLook: ui.ar.relList?.supports?.("ar") === true },
    acceptance: { cameraQrRead: false, integrityVerified: false, usdzCreated: false, quickLookRequested: false,
      actualAR: "owner verification required", realRevitProvenance: "owner verification required" } };
  function event(type, data = {}) { report.events.push({ at: new Date().toISOString(), type, ...data }); if (report.events.length > 160) report.events.shift(); }
  function state(title, detail) { ui.state.textContent = title; ui.detail.textContent = detail; }
  function error(message) {
    ui.error.hidden = false; ui.error.textContent = message;
    if (message !== lastError || Date.now() - lastErrorAt > 3000) { event("error", { message }); lastError = message; lastErrorAt = Date.now(); }
  }
  function stopCamera() {
    cameraEpoch++;
    if (frame) cancelAnimationFrame(frame); frame = null;
    if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null; event("camera_stopped"); }
    ui.video.pause(); ui.video.srcObject = null; ui.camera.hidden = true; ui.stop.hidden = true;
    ui.start.hidden = complete; ui.start.disabled = busy || importing;
  }
  function clearModel() {
    if (modelUrl) URL.revokeObjectURL(modelUrl); modelUrl = null;
    ui.ar.removeAttribute("href"); ui.ar.hidden = true; ui["save-model"].removeAttribute("href"); ui.result.hidden = true;
  }
  function reset() {
    epoch++; busy = false; complete = false; importing = false; stopCamera(); clearModel(); collector.reset();
    source = null; report.source = null; report.scene = null;
    Object.assign(report.acceptance, { cameraQrRead: false, integrityVerified: false, usdzCreated: false, quickLookRequested: false });
    ui.error.hidden = true; ui.parts.replaceChildren(); ui.file.value = ""; ui.file.disabled = false;
    state("Новый лист", "Прежняя модель сброшена. Нажмите «Сканировать QR» и соберите части нового листа."); event("reset");
  }
  function progress(p) {
    ui.parts.replaceChildren(...Array.from({ length: p.count }, (_, i) => {
      const s = document.createElement("span"); s.textContent = i + 1;
      s.className = collector.parts.has(i) ? "done" : ""; s.setAttribute("aria-label", `Часть ${i + 1}: ${collector.parts.has(i) ? "считана" : "ожидается"}`); return s;
    }));
  }
  function showScene(scene, bytes) {
    const rows = [["Части QR", `${scene.qrCount}/${scene.qrCount} · SHA-256 OK`], ["Геометрия", `${scene.meshes.length} мешей · ${scene.triangles} треугольников`],
      ["Габариты экспорта", scene.extent.map(n => n.toLocaleString("ru-RU", { maximumFractionDigits: 3 })).join(" × ") + " м"],
      ["Размер сцены / USDZ", `${scene.compressedBytes} / ${bytes.length} байт`], ["Масштаб Exporto", String(scene.scale)]];
    ui.facts.replaceChildren(...rows.flatMap(([title,value]) => { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = title; dd.textContent = value; return [dt,dd]; }));
    ui.excluded.replaceChildren(...scene.excluded.map(text => { const li = document.createElement("li"); li.textContent = text; return li; }));
    modelUrl = URL.createObjectURL(new Blob([bytes], { type: "model/vnd.usdz+zip" }));
    ui.ar.href = modelUrl; ui["save-model"].href = modelUrl; ui.ar.hidden = !report.capabilities.quickLook; ui.result.hidden = false;
    ui["ar-help"].textContent = report.capabilities.quickLook ?
      "Нажмите «Открыть модель в AR». Если откроется просмотр объекта, выберите AR и наведите камеру на поверхность. Положение относительно чертежа задаётся вручную." :
      "Браузер не сообщил поддержку AR Quick Look. USDZ можно сохранить; скачивание и обычный 3D-просмотр не подтверждают AR. Для испытания откройте страницу в Safari на iPhone.";
    report.scene = { sha256: scene.sha256, qrCount: scene.qrCount, compressedBytes: scene.compressedBytes, rawBytes: scene.rawBytes,
      usdzBytes: bytes.length, meshes: scene.meshes.length, vertices: scene.vertices, triangles: scene.triangles,
      extentMeters: scene.extent, originMeters: scene.originMeters, exportScale: scene.scale, excluded: scene.excluded };
    Object.assign(report.acceptance, { integrityVerified: true, usdzCreated: true });
    state("Модель восстановлена", "Данные QR проверены. Готовность настоящего AR проверяется следующим действием на iPhone.");
    event("usdz_ready", { sha256: scene.sha256, bytes: bytes.length });
  }
  async function ingest(input, via) {
    if (busy || complete) return;
    const p = collector.add(input); progress(p); ui.error.hidden = true;
    if (!p.duplicate) {
      source = source && source !== via ? "mixed-input" : via; report.source = source;
      if (via === "camera") report.acceptance.cameraQrRead = true;
      event("qr_part", { source: via, index: codec.packet(input).index, count: p.count, bytes: p.bytes, hash: p.hash });
    }
    state(`Собрано ${p.received} из ${p.count}`, p.complete ? "Проверяю SHA-256 и восстанавливаю геометрию…" : "Считайте оставшиеся QR этого же листа. Порядок не важен.");
    if (!p.complete) return;
    const token = epoch; busy = true; ui.file.disabled = true; stopCamera();
    try {
      const scene = await codec.restore(collector.join()); if (token !== epoch) return;
      if (ARUsdz.genericMeshProfile !== 1) throw new Error("Загружен устаревший код USDZ из другого кэша. Дождитесь готовности офлайн-копии и обновите страницу");
      const bytes = ARUsdz.build(codec.usdzMeshes(scene)); if (bytes.length > 32 * 1024 * 1024) throw new Error("USDZ превышает 32 МиБ. Модель не обрезана");
      if (token !== epoch) return;
      showScene(scene, bytes); complete = true;
    } catch (e) {
      if (token !== epoch) return;
      clearModel(); state("Модель не создана", "Проверка не пройдена. Нажмите «Новый лист» и повторите сбор всех частей."); error(e.message);
    } finally { if (token === epoch) { busy = false; ui.start.hidden = true; ui.file.disabled = true; } }
  }
  function scan(time, token) {
    if (token !== cameraEpoch || !stream) return;
    if (time - lastScan > 160 && ui.video.readyState >= 2 && !busy) {
      lastScan = time;
      const scale = Math.min(1, 1280 / Math.max(ui.video.videoWidth, ui.video.videoHeight));
      ui.canvas.width = Math.round(ui.video.videoWidth * scale); ui.canvas.height = Math.round(ui.video.videoHeight * scale);
      context.drawImage(ui.video, 0, 0, ui.canvas.width, ui.canvas.height);
      const image = context.getImageData(0, 0, ui.canvas.width, ui.canvas.height);
      const qr = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
      if (qr) ingest(Uint8Array.from(qr.binaryData), "camera").catch(e => error(e.message));
    }
    if (token === cameraEpoch && stream) frame = requestAnimationFrame(t => scan(t, token));
  }
  async function startCamera() {
    if (stream || busy || complete || importing) return;
    if (!report.capabilities.secureContext || !report.capabilities.camera) { error("Камера требует HTTPS и разрешения браузера. Локальный HTML-файл не является камерным режимом"); return; }
    const token = ++cameraEpoch; ui.start.disabled = true; ui.error.hidden = true;
    state("Включаю камеру", "Разрешите Safari доступ к камере.");
    try {
      const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      if (token !== cameraEpoch || document.hidden) { camera.getTracks().forEach(t => t.stop()); return; }
      stream = camera; ui.video.srcObject = stream; await ui.video.play();
      if (token !== cameraEpoch) return;
      ui.camera.hidden = false; ui.start.hidden = true; ui.stop.hidden = false;
      state("Считываю QR", "Держите один QR целиком в кадре. Собранные части отмечаются кружками."); event("camera_started");
      frame = requestAnimationFrame(t => scan(t, token));
    } catch (e) { if (token === cameraEpoch) { stopCamera(); state("Камера недоступна", "Разрешите камеру в настройках Safari и повторите."); error(e.message); } }
    finally { if (token === cameraEpoch) ui.start.disabled = false; }
  }
  async function offline() {
    try {
      if (!isSecureContext || !navigator.serviceWorker) throw new Error("Нужен HTTPS и Service Worker");
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      // navigator.serviceWorker.ready may refer to a parent registration. Wait for THIS registration only.
      const worker = await new Promise((resolve, reject) => {
        const watched = new Set();
        const cleanup = () => { clearTimeout(timer); reg.removeEventListener("updatefound", watch); watched.forEach(w => w.removeEventListener("statechange", watch)); };
        const watch = () => {
          if (reg.active?.state === "activated") { const active = reg.active; cleanup(); resolve(active); return; }
          for (const w of [reg.installing, reg.waiting, reg.active]) if (w && !watched.has(w)) { watched.add(w); w.addEventListener("statechange", watch); }
        };
        const timer = setTimeout(() => { cleanup(); reject(new Error("Кэш этой версии ещё не готов")); }, 15000);
        reg.addEventListener("updatefound", watch); watch();
      });
      if (reg.scope !== new URL("./", location.href).href || worker.scriptURL !== new URL("./sw.js", location.href).href) throw new Error("Неверная область офлайн-кэша");
      const status = await new Promise((resolve, reject) => {
        const channel = new MessageChannel(), timer = setTimeout(() => reject(new Error("Нет ответа офлайн-кэша")), 5000);
        channel.port1.onmessage = e => { clearTimeout(timer); channel.port1.close(); resolve(e.data); }; worker.postMessage({ type: "CACHE_STATUS" }, [channel.port2]);
      });
      if (!status.ready || status.scope !== reg.scope || status.version !== 1) throw new Error("Не все файлы этой версии просмотрщика сохранены");
      ui.offline.textContent = "Код просмотрщика сохранён для офлайн-повтора. Проверьте запуск этой страницы в авиарежиме."; event("viewer_cache_ready");
    } catch (e) { ui.offline.textContent = `Офлайн-копия не подтверждена: ${e.message}`; event("viewer_cache_unavailable", { message: e.message }); }
  }
  ui.start.addEventListener("click", startCamera); ui.stop.addEventListener("click", () => { stopCamera(); state("Камера остановлена", "Собранные части сохранены в этом сеансе. Можно продолжить сканирование."); });
  ui.reset.addEventListener("click", reset);
  ui.file.addEventListener("change", async () => {
    const file = ui.file.files[0]; if (!file || busy || complete || importing) return;
    const token = epoch; importing = true; ui.file.disabled = true; stopCamera();
    try {
      if (file.size > codec.LIMITS.html) throw new Error("HTML превышает 8 МиБ");
      const packets = codec.htmlPackets(await file.text()); if (token !== epoch) return;
      // Validate the whole imported set before affecting the live collection.
      const check = new codec.Collector(); packets.forEach(p => check.add(p)); check.join();
      for (const p of packets) { if (token !== epoch) return; await ingest(p, "html-file"); }
    } catch (e) { if (token === epoch) error(e.message); }
    finally { if (token === epoch) { importing = false; ui.file.value = ""; ui.file.disabled = busy || complete; ui.start.disabled = busy; } }
  });
  ui.ar.addEventListener("click", () => { report.acceptance.quickLookRequested = true; event("quicklook_requested"); });
  ui.report.addEventListener("click", async () => {
    const file = new File([JSON.stringify(report, null, 2)], "Exporto-Safari-QR-report.json", { type: "application/json" });
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; } }
    catch (e) { if (e.name === "AbortError") return; }
    const url = URL.createObjectURL(file), a = document.createElement("a"); a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopCamera(); });
  window.addEventListener("pagehide", stopCamera);
  event("viewer_opened"); offline();
})();
