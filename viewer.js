/* One viewer: shared QR decoding and geometry, legacy Hiro, Apple Quick Look and WebXR surface AR. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const ui = { status: $("status"), title: $("title"), sheet: $("sheet"), dot: $("dot"), start: $("start"),
    stop: $("stop"), look: $("look"), reticle: $("reticle"), toast: $("toast"), body: document.body };
  const DEFAULT_CUBE = [59, 157, 221], DEFAULT_WALL = [185, 185, 185];
  // Marker units: the black square of Hiro (40 mm on paper) is one unit.
  const MARKER_MM = 40;
  const quickLook = !!(document.createElement("a").relList?.supports?.("ar"));
  let model = null, loading = null, scene = null, marker = null, follower = null, scanTimer = 0, suspended = false, usdzUrl = null;
  const qrGeometry = window.ExportoQr, collector = new qrGeometry.Collector();
  let generation = 0, collecting = false, verifying = false, importing = false, acceptedHash = null, blockedHash = null, blockedLegacy = null, inputTicket = null;
  let acceptedLegacyParts = new Set(), pendingLegacyParts = new Set(), blockedLegacyParts = new Set();
  let meshFailed = false;
  const diagnostic = new URLSearchParams(location.search).get("diagnostics") === "1";
  const legacyIntro = "Для прежних AR-листов наведите камеру на Hiro. Чёрный квадрат на бумаге — 40 × 40 мм.";
  $("diagnostics").hidden = !diagnostic;
  const appVersion = window.ARViewerVersion;
  let xrSupported = false, xrChecking = true;
  const report = { app: appVersion, schema: "ARViewer-unified-1", build: appVersion.build, userAgent: navigator.userAgent, events: [], scene: null, scan: { accepted: 0, duplicates: 0, frames: 0 },
    acceptance: { source: null, cameraQrRead: false, integrityVerified: false, usdzCreated: false,
      quickLookRequested: false, webxrRequested: false, webxrPlaced: false, actualAR: "owner verification required", realRevitProvenance: "owner verification required" } };
  function log(type, detail = {}) { report.events.push({ type, at: new Date().toISOString(), ...detail }); if (report.events.length > 160) report.events.shift(); }
  let scanBatch = 0, lastNewPart = 0, lastNotice = '', lastNoticeAt = 0, scanStartedAt = 0;
  let soundEnabled = false, audioContext = null;
  function clearFeedback(reset = false) {
    scanBatch++; $("scan-outline").replaceChildren();
    if (reset) { $("part-progress").replaceChildren(); $("part-progress").hidden = true; $("scan-event").hidden = true; lastNotice = ''; lastNewPart = 0; }
  }
  function showProgress(count, have, phase = 'collecting') {
    const progress = ARScanFeedback.progress(count, have), row = $("part-progress");
    row.replaceChildren(); row.hidden = false;
    for (let n = 1; n <= count; n++) {
      const item = document.createElement('span'), received = progress.have.includes(n);
      item.className = 'part'; item.dataset.received = String(received); item.setAttribute('role','listitem');
      item.textContent = received ? n + ' ✓' : String(n); item.setAttribute('aria-label', 'QR ' + n + (received ? ' принят' : ' ожидается')); row.append(item);
    }
    row.setAttribute('aria-label', 'Части модели: ' + progress.have.length + ' из ' + count);
    if (phase === 'collecting') ui.status.textContent = 'Приняты: ' + progress.have.join(', ') + '. Остались: ' + progress.missing.join(', ') + '.';
    $("scan-guide").hidden = phase !== 'collecting' || !ownedStream || suspended;
    return progress;
  }
  function cue(complete = false) {
    if (!soundEnabled || !audioContext) return;
    const now = audioContext.currentTime;
    for(let i=0;i<(complete ? 2 : 1);i++) { const o=audioContext.createOscillator(),g=audioContext.createGain();o.frequency.value=i ? 1046 : 784;g.gain.setValueAtTime(.045,now+i*.12);g.gain.exponentialRampToValueAtTime(.001,now+i*.12+.09);o.connect(g);g.connect(audioContext.destination);o.start(now+i*.12);o.stop(now+i*.12+.1); }
  }
  function notice(text, kind = 'new', tone = kind) {
    const now = performance.now();
    if (kind === 'duplicate' && (now - lastNewPart < 1400 || text === lastNotice && now - lastNoticeAt < 2200)) return;
    if (kind === 'new') lastNewPart = now;
    lastNotice = text; lastNoticeAt = now; $("scan-event").dataset.kind = tone; $("scan-event").textContent = text; $("scan-event").hidden = false;
  }
  function outline(hit, video, frame, kind = 'accepted') {
    if (hit.points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return;
    const svg = $("scan-outline"), rect = svg.getBoundingClientRect();
    const points = ARScanFeedback.map(hit.points, frame, video.getBoundingClientRect(), rect, getComputedStyle(video).objectFit);
    const polygon = document.createElementNS('http://www.w3.org/2000/svg','polygon');
    svg.setAttribute('viewBox','0 0 ' + rect.width + ' ' + rect.height); polygon.setAttribute('points',points.map(p=>p.x+','+p.y).join(' ')); polygon.dataset.kind=kind;
    // A short-lived acknowledgement of a decoded frame, never a tracked world pose.
    svg.append(polygon); setTimeout(()=>polygon.remove(),750);
  }
  $("sound").onclick = async () => {
    try { if (!audioContext) { const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) throw new Error('Звук недоступен'); audioContext = new Audio(); } await audioContext.resume(); soundEnabled = !soundEnabled; }
    catch (_) { soundEnabled = false; notice('Звук недоступен. Подтверждение остаётся на экране.','other'); }
    $("sound").setAttribute('aria-pressed',String(soundEnabled)); $("sound").textContent = soundEnabled ? 'Звук вкл.' : 'Звук выкл.';
    if (soundEnabled) cue();
  };
  $("open-file").onclick = () => $("scene-file").click();
  window.addEventListener('resize', () => clearFeedback());
  function resetAcceptance(source = null) { report.acceptance = { source, cameraQrRead: false, integrityVerified: false, usdzCreated: false,
    quickLookRequested: false, webxrRequested: false, webxrPlaced: false, actualAR: "owner verification required", realRevitProvenance: "owner verification required" }; }
  function dispose(group) { if (!group) return; group.traverse(o => { o.geometry?.dispose(); if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material?.dispose(); }); group.removeFromParent(); }
  function clearModel() {
    if (xrView.active) xrView.end().catch(error => log("webxr-end-error", {message:error.message}));
    $("webxr-open").hidden = true; $("ar-support").hidden = true;
    model?.holder?.removeFromParent(); dispose(model?.group); model = null;
    if (usdzUrl) URL.revokeObjectURL(usdzUrl); usdzUrl = null; ui.look.hidden = true; ui.look.removeAttribute("href");
    $("save-model").hidden = true; $("save-model").removeAttribute("href"); ui.dot.hidden = true;
  }
  function newSheet() {
    blockedHash = (collecting && !meshFailed ? collector.identity?.hash : null) || acceptedHash || blockedHash;
    blockedLegacy = model?.data.payload || blockedLegacy; inputTicket = null;
    blockedLegacyParts = new Set([...acceptedLegacyParts,...pendingLegacyParts,...parts.map(p=>p.payload)]);
    acceptedLegacyParts.clear(); pendingLegacyParts.clear();
    generation++; loading = null; collector.reset(); collecting = false; verifying = false; importing = false; acceptedHash = null; meshFailed = false; parts = [];
    clearModel(); clearFeedback(true); report.scene = null; resetAcceptance(); report.scan = { accepted: 0, duplicates: 0, frames: 0 };
    history.replaceState(null, "", location.pathname + location.search); $("scene-file").value = ""; $("scene-file").disabled = false;
    ui.start.disabled = false; $("new-sheet").hidden = true; ui.title.textContent = "AR Style"; ui.sheet.textContent = "Новый лист";
    ui.status.textContent = "Прежняя модель сброшена. Наведите камеру на QR нового листа."; log("new-sheet");
    $("intro").textContent = "Наведите камеру на QR нового листа. Уже принятый лист повторно не загружается.";
    if (ownedStream && !suspended) startScanning($("arjs-video"));
  }

  if (!window.AFRAME || !AFRAME.systems.arjs) {
    ui.status.textContent = "AR-библиотеки не загружены. Откройте приложение с интернетом.";
    return;
  }
  const THREE = AFRAME.THREE;
  const xrView = ARWebXR.create({ THREE, overlay: $("ui"), emit: (state, detail) => {
    log("webxr-" + state, detail);
    if (state === "ended") {
      ui.body.classList.remove("xr"); $("xr-controls").hidden = true;
      ui.start.disabled = false; $("open-file").disabled = false; $("new-sheet").disabled = false;
      refreshAr(); ui.status.textContent = model ? "AR закрыт. Модель сохранена; можно открыть её снова или выбрать новый лист." : "Откройте камеру и считайте новый лист.";
      return;
    }
    const text = { requesting:"Запуск AR…", searching:"Медленно направьте телефон на стол или пол. Найдите круг и коснитесь экрана.", surface:"Поверхность найдена. Коснитесь экрана, чтобы разместить модель.", placed:"Модель размещена. Можно обойти её. Для переноса нажмите «Разместить заново».", "reference-reset":"Система координат AR изменилась. Найдите поверхность и разместите модель заново.", "tracking-lost":"Отслеживание потеряно. Медленно верните камеру к знакомой области; модель временно скрыта." };
    if (text[state]) ui.status.textContent = text[state];
    if (state === "placed") report.acceptance.webxrPlaced = true;
    if (state === "error") ui.status.textContent = "Ошибка AR: " + detail.message;
  }});
  function refreshAr() {
    $("webxr-open").hidden = !model || quickLook || !xrSupported;
    $("ar-support").hidden = !model || quickLook;
    if (model && !quickLook) $("ar-support").textContent = xrChecking ? "Проверка поддержки AR…" : xrSupported
      ? "AR на поверхности · модель из QR · размер просмотра настраивается при размещении."
      : "AR недоступен в этом браузере. На Android используйте Chrome на устройстве с ARCore и включёнными Google Play Services for AR. Модель восстановлена; это ещё не AR-просмотр.";
  }
  ARWebXR.supported().then(value => { xrSupported = value; xrChecking = false; report.capabilities = { quickLook, immersiveAR: value }; refreshAr(); });
  $("webxr-open").onclick = async () => {
    if (!model || xrView.active) return;
    // Release the QR getUserMedia stream synchronously before requesting the system AR camera.
    pauseCamera(); ui.start.disabled = true; $("open-file").disabled = true; $("new-sheet").disabled = true;
    ui.body.classList.add("xr"); $("xr-controls").hidden = false;
    report.acceptance.webxrRequested = true;
    try { await xrView.start(model.group); }
    catch (error) {
      ui.body.classList.remove("xr"); $("xr-controls").hidden = true;
      ui.start.disabled = false; $("open-file").disabled = false; $("new-sheet").disabled = false;
      log("webxr-request-failed", {name:error.name,message:error.message});
      ui.status.textContent = "AR не запущен. Проверьте разрешение AR, поддержку ARCore и Google Play Services for AR. Можно повторить. " + error.message;
    }
  };
  $("xr-exit").onclick = () => xrView.end().catch(error => { ui.status.textContent = error.message; });
  $("xr-reset").onclick = () => xrView.reset();
  $("xr-size").oninput = event => { const cm = Number(event.target.value); xrView.setWidth(cm / 100); $("xr-size-label").textContent = cm + " см"; };
  // DOM controls must never also trigger WebXR's scene-placement select event.
  $("ui").addEventListener("beforexrselect", event => { if (event.target.closest("button,a,input,label,summary")) event.preventDefault(); });


  // ---------- model ----------

  function rgbCss(rgb) { return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`; }

  function material(rgb, opacity) {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(rgbCss(rgb)), side: THREE.DoubleSide, roughness: 0.75 });
    if (opacity < 1) { m.transparent = true; m.opacity = opacity; }
    return m;
  }

  /** Model in metres, Y up, standing on the origin. Each mesh keeps its sRGB colour for Quick Look. */
  function buildCube(data) {
    const rgb = data.color || DEFAULT_CUBE, group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(data.w / 1000, data.h / 1000, data.d / 1000), material(rgb, 0.85));
    mesh.position.y = data.h / 2000;
    mesh.userData.rgb = rgb;
    group.add(mesh);
    return group;
  }

  // Revit X/Y/Z (Z up) → three.js X/Y/-Z (Y up). Each wall is its elevation extruded across its thickness.
  function buildWalls(data, walls) {
    const inner = new THREE.Group();
    for (const wall of walls) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(wall.length, 0); shape.lineTo(wall.length, wall.height); shape.lineTo(0, wall.height); shape.closePath();
      for (const o of wall.openings) {
        const hole = new THREE.Path();
        hole.moveTo(o.start, o.bottom); hole.lineTo(o.start, o.top); hole.lineTo(o.end, o.top); hole.lineTo(o.end, o.bottom); hole.closePath();
        shape.holes.push(hole);
      }
      const rgb = data.color || wall.color || DEFAULT_WALL;
      const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: wall.width, bevelEnabled: false, steps: 1 }), material(rgb, 1));
      const c = (wall.x2 - wall.x1) / wall.length, s = (wall.y2 - wall.y1) / wall.length;
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
        new THREE.Vector3(c, 0, -s), new THREE.Vector3(0, 1, 0), new THREE.Vector3(s, 0, c)));
      // Shift by half the thickness so the extrusion is centred on the wall axis.
      mesh.position.set(wall.x1 - s * wall.width / 2, wall.z0, -wall.y1 - c * wall.width / 2);
      mesh.userData.rgb = rgb;
      inner.add(mesh);
    }
    // Anchored (m=1): coordinates already run from the marker centre, the model stands on its plan.
    // Otherwise stand the model on the marker centre.
    const bounds = new THREE.Box3().setFromObject(inner), center = bounds.getCenter(new THREE.Vector3());
    inner.position.set(data.anchored ? 0 : -center.x, -bounds.min.y, data.anchored ? 0 : -center.z);
    const group = new THREE.Group();
    group.add(inner);
    return group;
  }

  function buildMeshes(decoded) {
    // All positions come from the verified CBX1 scene; no album-specific or synthetic geometry.
    const triangles = qrGeometry.usdzMeshes(decoded), group = new THREE.Group();
    try {
      for (const m of triangles) {
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(m.positions, 3)); geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, material(m.color, m.opacity));
        mesh.userData.rgb = m.color; mesh.userData.linearColor = m.linearColor; mesh.userData.opacity = m.opacity; mesh.userData.precisePositions = true;
        group.add(mesh);
      }
      return group;
    } catch (error) { dispose(group); throw error; }
  }

  function usdzFor(group) {
    // Metres relative to the model itself: the marker pose and the 1:N holder do not go into Quick Look.
    group.updateMatrixWorld(true);
    const local = group.matrixWorld.clone().invert(), meshes = [];
    group.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(local.clone().multiply(o.matrixWorld));
      meshes.push({ positions: g.attributes.position.array, color: o.userData.rgb,
        linearColor: o.userData.linearColor, opacity: o.userData.opacity, precisePositions: o.userData.precisePositions });
      g.dispose();
    });
    return new Blob([ARUsdz.build(meshes)], { type: "model/vnd.usdz+zip" });
  }

  // AR5 parts of the model being collected, by id; a part of another model starts over.
  let parts = [];

  async function ingestMesh(bytes, source) {
    const packet = qrGeometry.packet(bytes);
    if (source === "html-file" && packet.hash === blockedHash) blockedHash = null; // Explicit file selection may retry the same model.
    if (packet.hash === blockedHash) { notice('QR прежнего листа. Наведите камеру на новый лист.','duplicate','other'); return { state: 'blocked' }; }
    if (packet.hash === acceptedHash) return { state: 'duplicate' };
    if (verifying || (importing && source === "camera")) return { state: 'busy' };
    const p = collector.add(bytes);
    if (!collecting) {
      generation++; loading = null; clearModel(); parts = []; collecting = true; blockedHash = null; meshFailed = false;
      acceptedLegacyParts.clear(); pendingLegacyParts.clear();
      history.replaceState(null, "", location.pathname + location.search);
      report.scene = null; resetAcceptance();
    }
    $("new-sheet").hidden = false;
    if (p.duplicate) { report.scan.duplicates++; notice('QR ' + (packet.index + 1) + ' уже считан','duplicate'); return { state: 'duplicate' }; }
    report.scan.accepted++;
    notice(source === 'camera' ? 'QR ' + (packet.index + 1) + ' принят' : 'HTML · часть ' + (packet.index + 1) + ' принята');
    if (source === 'camera') cue();
    showProgress(p.count, Array.from(collector.parts.keys(), i => i + 1), p.complete ? 'verifying' : 'collecting');
    report.acceptance.source = report.acceptance.source && report.acceptance.source !== source ? "mixed-input" : source;
    if (source === "camera") report.acceptance.cameraQrRead = true;
    ui.title.textContent = `Части ${p.received} из ${p.count}`; ui.sheet.textContent = "Геометрия Exporto";
    if (p.complete) ui.status.textContent = "Все части получены. Проверяю целостность и восстанавливаю модель…";
    log("qrl-part", { version: packet.version, hash: p.hash, index: packet.index, count: p.count, source, elapsedMs: Math.round(performance.now() - scanStartedAt) });
    if (!p.complete) return { state: "accepted" };
    const ticket = generation; verifying = true; let group = null, blob = null;
    try {
      const decoded = await qrGeometry.restore(collector.join()); if (ticket !== generation) return;
      if (ARUsdz.genericMeshProfile !== 1) throw new Error("Устаревший код USDZ в кэше. Обновите просмотрщик с интернетом");
      group = buildMeshes(decoded); blob = usdzFor(group);
      if (blob.size > 32 * 1024 * 1024) throw new Error("USDZ превышает 32 МиБ. Модель не обрезана");
      if (ticket !== generation) { dispose(group); return; }
      // CBX1 has no paper/Hiro placement contract: don't invent 1:N from exportScale.
      model = { data: { kind: "mesh", identity: decoded.sha256, exportScale: decoded.scale, codec: decoded.codec }, group, holder: null };
      group = null; acceptedHash = decoded.sha256; collecting = false;
      usdzUrl = URL.createObjectURL(blob); ui.look.href = usdzUrl; ui.look.hidden = !quickLook;
      $("save-model").href = usdzUrl; $("save-model").hidden = false;
      report.scene = { packetVersion: packet.version, codec: decoded.codec, decodeMilliseconds: decoded.decodeMilliseconds, sha256: decoded.sha256, parts: decoded.qrCount, compressedBytes: decoded.compressedBytes, rawBytes: decoded.rawBytes,
        usdzBytes: blob.size, meshes: decoded.meshes.length, vertices: decoded.vertices, triangles: decoded.triangles,
        extentMeters: decoded.extent, exportScale: decoded.scale, originMeters: decoded.originMeters, excluded: decoded.excluded };
      report.acceptance.integrityVerified = true; report.acceptance.usdzCreated = true;
      ui.title.textContent = "Модель Exporto"; ui.sheet.textContent = `${decoded.qrCount}/${decoded.qrCount} · SHA-256 OK`;
      ui.status.textContent = quickLook ? "Модель готова. Откройте Quick Look → AR и разместите на поверхности. Привязка к чертежу не задана." : "Модель восстановлена. Для размещения на поверхности нажмите «Открыть в AR», если устройство поддерживает AR.";
      $("intro").textContent = "Модель восстановлена из QR. AR использует поверхность; положение и масштаб относительно чертежа этим экспортом не заданы.";
      $("scene-info").textContent = `${decoded.meshes.length} мешей · ${decoded.triangles} треугольников · ${decoded.extent.map(x => x.toFixed(3)).join(" × ")} м. ${decoded.excluded.join("; ")}`;
      showProgress(decoded.qrCount, Array.from({length:decoded.qrCount},(_,i)=>i+1), 'ready');
      notice('Все QR проверены · модель готова'); if (source === 'camera') cue(true);
      clearInterval(scanTimer); scanTimer = 0; $("scan-guide").hidden = true;
      refreshAr();
      ui.reticle.hidden = true; log("mesh-ready", { hash: decoded.sha256, triangles: decoded.triangles });
    } catch (error) {
      dispose(group); if (ticket !== generation) return;
      meshFailed = true; clearModel(); ui.status.textContent = error.message + ". Нажмите «Новый лист» для повтора."; log("mesh-error", { message: error.message });
    } finally { if (ticket === generation) verifying = false; }
    return { state: meshFailed ? "error" : "accepted" };
  }

  async function load(payload, announce, source = "url") {
    let data = ARCubeData.parse(payload);
    if (data.payload === blockedLegacy || blockedLegacyParts.has(data.payload) || acceptedLegacyParts.has(data.payload) || pendingLegacyParts.has(data.payload) || importing) return;
    let receivedParts = [];
    const partInfo = data.kind === "part" ? { number: data.part, count: data.of } : null;
    if (data.kind !== "part") { parts = []; pendingLegacyParts.clear(); }
    // A valid legacy QR switches the SAME viewer back to its legacy model path.
    if (collecting || model?.data.kind === "mesh" || verifying) {
      generation++; loading = null; collector.reset(); collecting = false; verifying = false; acceptedHash = null; clearModel();
      report.scene = null; resetAcceptance();
      $("new-sheet").hidden = true;
    }
    if (data.kind === "part") {
      if (parts.length && parts[0].id !== data.id) parts = [];
      if (!parts.length) { generation++; loading = null; clearModel(); acceptedLegacyParts.clear(); pendingLegacyParts.clear(); report.scene = null; resetAcceptance(); }
      $("new-sheet").hidden = false;
      if (parts.some(p => p.part === data.part)) { notice('QR ' + data.part + ' уже считан','duplicate'); return; }
      parts.push(data);
      showProgress(data.of, parts.map(p=>p.part));
      notice('QR ' + data.part + ' принят');
      const joined = ARCubeData.join(parts);
      if (!joined) {
        const have = parts.map(p => p.part).sort((a, b) => a - b);
        ui.title.textContent = `Части ${have.length} из ${data.of}`;
        ui.sheet.textContent = "Наведите камеру на остальные QR: " +
          Array.from({ length: data.of }, (_, i) => i + 1).filter(n => !have.includes(n)).join(", ");
        toast(`Часть ${data.part} из ${data.of} · ${have.length}/${data.of}`);
        return;
      }
      receivedParts = parts.map(p=>p.payload); pendingLegacyParts = new Set(receivedParts); parts = [];
      data = joined;
    }
    if (data.payload === blockedLegacy) return;
    if (model && model.data.payload === data.payload) return;
    const ticket = loading = {};
    let group;
    try {
      if (data.kind === "walls") group = buildWalls(data, await ARCubeData.decodeWalls(data.data));
      else if (data.kind === "cube") group = buildCube(data);
      else throw new Error("Неподдерживаемый тип модели");
    } catch (error) { if (ticket !== loading) return; pendingLegacyParts.clear(); throw error; }
    if (ticket !== loading) { dispose(group); return; }
    clearModel();
    const holder = new THREE.Group();
    holder.add(group);
    holder.scale.setScalar(1000 / (MARKER_MM * data.scale));
    model = { data, holder, group };
    acceptedLegacyParts = new Set(receivedParts); pendingLegacyParts.clear(); blockedLegacyParts.clear();
    blockedLegacy = null; report.scene = null; resetAcceptance(source); report.acceptance.cameraQrRead = source === "camera";
    log("legacy-ready", { kind: data.kind, sheet: data.sheet || "" });
    if (follower) follower.object3D.add(holder);
    if (location.hash.replace(/^#/, "") !== encodeURIComponent(data.payload))
      history.replaceState(null, "", "#" + encodeURIComponent(data.payload));
    const rgb = data.color || (data.kind === "walls" ? DEFAULT_WALL : DEFAULT_CUBE);
    ui.dot.style.background = rgbCss(rgb);
    ui.dot.hidden = false;
    if (partInfo) showProgress(partInfo.count, Array.from({length:partInfo.count},(_,i)=>i+1), 'ready');
    else { $("part-progress").hidden = true; $("scan-event").hidden = true; }
    ui.title.textContent = ARCubeData.title(data);
    ui.sheet.textContent = data.sheet ? "Лист " + data.sheet : "Модель из QR";
    $("intro").textContent = legacyIntro;
    ui.status.textContent = scene && !suspended ? "Наведите камеру на маркер Hiro" : "Откройте камеру и наведите её на маркер Hiro. Другие QR можно считывать, не выходя.";
    if (quickLook) {
      if (usdzUrl) URL.revokeObjectURL(usdzUrl);
      usdzUrl = URL.createObjectURL(usdzFor(group));
      ui.look.href = usdzUrl;
      ui.look.hidden = false;
    }
    refreshAr();
    if (announce) toast((data.sheet ? "Лист " + data.sheet + " · " : "") + ARCubeData.title(data));
  }

  function toast(text) {
    if (toast.last === text && Date.now() - toast.lastAt < 2200) return;
    toast.last = text; toast.lastAt = Date.now();
    ui.toast.textContent = text;
    ui.toast.classList.add("on");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => ui.toast.classList.remove("on"), 2200);
  }

  // ---------- smoothing ----------

  // AR.js re-detects the marker every frame, so its pose jitters. The model lives outside the marker and
  // follows it: small changes are absorbed, larger ones are eased in, a short loss keeps the last pose.
  AFRAME.registerComponent("ar-follow", {
    init() {
      this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion(); this.scl = new THREE.Vector3();
      this.seen = -1e9; this.ready = false; this.el.object3D.visible = false;
    },
    tick(time, delta) {
      if (!model || collecting || parts.length || model.data.kind === "mesh") { this.el.object3D.visible = false; return; }
      const target = marker && marker.object3D, o = this.el.object3D;
      if (!target) return;
      if (target.visible) {
        target.updateMatrixWorld(true);
        target.matrixWorld.decompose(this.pos, this.quat, this.scl);
        const gap = time - this.seen, move = o.position.distanceTo(this.pos), turn = o.quaternion.angleTo(this.quat);
        if (!this.ready || gap > 700 || move > 3) {
          o.position.copy(this.pos); o.quaternion.copy(this.quat); o.scale.copy(this.scl);
          this.ready = true;
        } else if (move > 0.004 || turn > 0.006) {
          // Fast enough to follow a hand, slow enough to hide frame-to-frame noise.
          const k = 1 - Math.exp(-(delta || 16) / (move > 0.4 || turn > 0.25 ? 45 : 110));
          o.position.lerp(this.pos, k); o.quaternion.slerp(this.quat, k); o.scale.lerp(this.scl, k);
        }
        this.seen = time;
      }
      const shown = this.ready && time - this.seen < 500;
      if (o.visible !== shown) {
        o.visible = shown;
        ui.reticle.hidden = shown;
        ui.status.textContent = shown ? "Маркер найден" : "Наведите камеру на маркер Hiro или на QR другого листа";
      }
    }
  });

  // ---------- camera ----------

  let cameraEpoch = 0, ownedStream = null, opening = false, videoSourceURL = null;
  const wiredVideos = new WeakSet();
  function stopCamera() {
    cameraEpoch++; clearFeedback(); opening = false; clearInterval(scanTimer); scanTimer = 0;
    ownedStream?.getTracks().forEach(track => track.stop()); ownedStream = null;
    document.querySelectorAll("video").forEach(video => {
      if (video.srcObject && video.srcObject.getTracks) video.srcObject.getTracks().forEach(track => track.stop());
    });
    log("camera-stop");
  }

  // QR is read from the same video AR.js tracks: no second camera, no leaving the AR screen.
  function startScanning(video) {
    if (typeof jsQR !== "function" || !video) return;
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    let busy = false, region = 1; clearInterval(scanTimer);
    scanTimer = setInterval(async () => {
      if (busy || suspended || importing || verifying || model?.data.kind === 'mesh' || document.hidden || !video.videoWidth || !ctx) return;
      busy = true; const batch = scanBatch, epoch = cameraEpoch;
      try {
        const factor = Math.min(1, 1280 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * factor); canvas.height = Math.round(video.videoHeight * factor);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height); report.scan.frames++;
        const frameAt = performance.now();
        const views = [0, region, region === 11 ? 1 : region + 1]; region = ((region + 1) % 11) + 1;
        const hits = (function* () { for (const view of views) yield* ARScanFeedback.scan(image, jsQR, 1, view); })();
        while (batch === scanBatch && epoch === cameraEpoch && !suspended && !document.hidden) {
          const next = hits.next(); if (next.done) break;
          const hit = next.value;
          if (!hit.qr) { await new Promise(resolve => setTimeout(resolve,0)); continue; }
          const qr=hit.qr, raw=Uint8Array.from(qr.binaryData);
          report.scan.decoded = (report.scan.decoded || 0) + 1;
          const binary=raw.length>=4 && raw[0]===81 && raw[1]===82 && raw[2]===76 && (raw[3]===49 || raw[3]===50);
          try {
            if (binary) {
              const result = await ingestMesh(raw, 'camera');
              if (batch !== scanBatch || epoch !== cameraEpoch || suspended) break;
              if (performance.now() - frameAt < 900) outline(hit, video, image, result?.state === 'blocked' || result?.state === 'error' ? 'other' : 'accepted');
              if (model?.data.kind === 'mesh') break;
            } else if (qr.data === 'https://mookcumka.github.io/ar-viewer/') {
              if (!collecting && !model) notice('Это QR открытия просмотрщика. Наведите камеру на QR модели.','duplicate','other');
            } else {
              const data = ARCubeData.fromUrl(qr.data);
              const blocked = data.payload === blockedLegacy || blockedLegacyParts.has(data.payload);
              const duplicate = acceptedLegacyParts.has(data.payload) || pendingLegacyParts.has(data.payload) || model?.data.payload === data.payload || parts.some(p=>p.payload===data.payload);
              await load(data.payload, true, 'camera');
              if (batch !== scanBatch || epoch !== cameraEpoch || suspended) break;
              if (duplicate) notice(data.kind === 'part' ? 'QR ' + data.part + ' уже считан' : 'QR уже считан','duplicate');
              if (blocked) notice('QR прежнего листа. Наведите камеру на новый лист.','duplicate','other');
              if (performance.now() - frameAt < 900) outline(hit,video,image,blocked ? 'other' : 'accepted');
            }
          } catch (error) { report.scan.rejected = (report.scan.rejected || 0) + 1; notice(error.message,'duplicate','other'); }
          // Keep controls responsive; pausing/resetting cancels the remaining decoded-frame work.
          await new Promise(resolve => setTimeout(resolve,0));
        }
        if (batch === scanBatch && !model && !verifying && performance.now() - lastNoticeAt > 4500) {
          $("scan-guide").hidden = false;
          $("scan-guide").textContent = 'Если QR не читается: направьте рамку на один непринятый код целиком. Если он размыт вблизи — немного отодвиньте телефон.';
        }
      } catch (error) { log('scan-error',{message:error.message}); }
      finally { busy = false; }
    },280);
  }

  async function startCamera() {
    if (opening || ownedStream || importing || verifying) return;
    const ticket = ++cameraEpoch; opening = true; suspended = false;
    ui.start.hidden = true;
    ui.stop.hidden = false;
    ui.body.classList.add("live");
    ui.status.textContent = "Подключение камеры…";
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } } }); }
    catch (error) { if (ticket === cameraEpoch) { pauseCamera(); ui.status.textContent = "Не удалось открыть камеру. Разрешите доступ в настройках браузера и повторите."; } return; }
    if (ticket !== cameraEpoch || document.hidden) { stream.getTracks().forEach(t => t.stop()); return; }
    ownedStream = stream; opening = false; scanStartedAt = performance.now();
    const settings = stream.getVideoTracks()[0]?.getSettings() || {};
    log("camera-start",{width:settings.width,height:settings.height,frameRate:settings.frameRate,facingMode:settings.facingMode});
    $("scan-guide").hidden = false;
    if (!scene) {
    scene = document.createElement("a-scene");
    videoSourceURL = URL.createObjectURL(new Blob([], { type: "video/mp4" }));
    scene.setAttribute("embedded", "");
    scene.setAttribute("vr-mode-ui", "enabled:false");
    scene.setAttribute("renderer", "logarithmicDepthBuffer:true;precision:medium;antialias:true");
    // 1280 × 960 so that the dense AR4 QR is readable; AR.js still tracks on its own 640 × 480 canvas.
    // Reuse the already-tested owned-video bridge from camera-1. AR.js never opens a second camera.
    scene.setAttribute("arjs", "sourceType:video;sourceUrl:" + videoSourceURL + ";sourceWidth:1280;sourceHeight:960;debugUIEnabled:false;trackingMethod:best;patternRatio:0.5;cameraParametersUrl:./vendor/camera_para.dat;");
    scene.setAttribute("device-orientation-permission-ui", "enabled:false");
    marker = document.createElement("a-marker");
    marker.setAttribute("type", "pattern");
    marker.setAttribute("url", "./vendor/patt.hiro");
    // AR.js's own averaging; ar-follow smooths what is left.
    marker.setAttribute("smooth", "true");
    marker.setAttribute("smoothCount", "6");
    marker.setAttribute("smoothTolerance", "0.01");
    marker.setAttribute("smoothThreshold", "3");
    follower = document.createElement("a-entity");
    follower.setAttribute("ar-follow", "");
    follower.addEventListener("loaded", () => { if (model?.holder) follower.object3D.add(model.holder); }, { once: true });
    scene.appendChild(marker);
    scene.appendChild(follower);
    scene.appendChild(document.createElement("a-entity")).setAttribute("camera", "");
    window.addEventListener("camera-error", () => {
      pauseCamera();
      ui.status.textContent = "Не удалось открыть камеру. Разрешите доступ в настройках браузера и перезагрузите страницу.";
    }, { once: true });
    ui.reticle.hidden = false;
    ui.status.textContent = model ? "Наведите камеру на маркер Hiro" : "Наведите камеру на QR листа";
    document.body.appendChild(scene);
    }
    scene.style.display = ""; scene.play();
    const activeScene = scene;
    const attach = () => {
      if (ticket !== cameraEpoch || ownedStream !== stream || scene !== activeScene) return;
      const source = activeScene.systems.arjs?._arSession?.arSource;
      if (!source?.domElement) { requestAnimationFrame(attach); return; }
      const video = source.domElement; video.style.display = "";
      if (!wiredVideos.has(video)) {
        wiredVideos.add(video); const initialize = video.onloadeddata; let initialized = false;
        video.onloadeddata = () => {
          if (!ownedStream || video.srcObject !== ownedStream) return;
          if (!initialized) { initialized = true; initialize?.call(video); }
          else { source.ready = true; videoReady(video); } // Keep the same ARController/marker bindings on resume.
        };
      }
      video.srcObject = stream; video.setAttribute("playsinline", "");
      video.play().catch(error => { if (ownedStream === stream) { pauseCamera(); toast(error.message); } });
    };
    requestAnimationFrame(attach);
  }

  function videoReady(video) {
    if (document.hidden || suspended || !ownedStream || video?.srcObject !== ownedStream) return;
    ui.status.textContent = model?.data.kind === "mesh" ? "Модель готова. Нажмите «Открыть в AR», если устройство поддерживает AR." : collecting ? "Считайте оставшиеся QR этого листа" : model ? "Наведите камеру на маркер Hiro" : "Наведите камеру на QR листа";
    ui.reticle.hidden = model?.data.kind === "mesh";
    startScanning(video);
  }
  window.addEventListener("arjs-video-loaded", event => videoReady(event.detail?.component || $("arjs-video")));

  ui.start.onclick = startCamera;
  function pauseCamera() {
    if (verifying) { generation++; verifying = false; collecting = false; collector.reset(); clearFeedback(true); log("verification-cancelled"); }
    suspended = true; stopCamera();
    const source = scene?.systems.arjs?._arSession?.arSource;
    if (source?.domElement) { source.ready = false; source.domElement.pause(); source.domElement.srcObject = null; source.domElement.style.display = "none"; }
    scene?.pause(); if (scene) scene.style.display = "none";
    ui.body.classList.remove("live"); ui.start.hidden = false; ui.stop.hidden = true; ui.reticle.hidden = true; $("scan-guide").hidden = true;
    ui.status.textContent = "Камера остановлена. Можно продолжить без перезагрузки.";
  }
  ui.stop.onclick = pauseCamera;
  // A QR opened from the system camera may reuse this tab and change only the fragment.
  window.addEventListener("hashchange", () => {
    if (!location.hash) return;
    load(location.hash, true).catch(error => toast(error.message));
  });
  window.addEventListener("pagehide", () => { pauseCamera(); xrView.end().catch(() => {}); });
  // Reopen explicitly after backgrounding; do not keep the camera running invisibly.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && !xrView.active && (scene || opening)) pauseCamera();
  });

  $("new-sheet").onclick = newSheet;
  ui.look.addEventListener("click", () => { report.acceptance.quickLookRequested = true; log("quicklook-request"); });
  $("scene-file").addEventListener("change", async () => {
    const file = $("scene-file").files[0]; if (!file || importing || verifying) return;
    const token = inputTicket = {}; importing = true; $("scene-file").disabled = true; ui.start.disabled = true; pauseCamera();
    $("new-sheet").hidden = false;
    try {
      if (file.size > qrGeometry.LIMITS.html) throw new Error("HTML превышает 8 МиБ");
      const packets = qrGeometry.htmlPackets(await file.text()); if (inputTicket !== token) return;
      const check = new qrGeometry.Collector(); packets.forEach(p => check.add(p)); check.join();
      for (const p of packets) { if (inputTicket !== token) return; await ingestMesh(p, "html-file"); }
    } catch (error) { if (inputTicket === token) { ui.status.textContent = error.message; log("file-error", { message: error.message }); } }
    finally { if (inputTicket === token) { importing = false; inputTicket = null; $("scene-file").disabled = false; $("scene-file").value = ""; ui.start.disabled = false; } }
  });
  $("report").onclick = async () => {
    const file = new File([JSON.stringify({...report, offline: window.AROfflineState || null}, null, 2)], "ARViewer-report.json", { type: "application/json" });
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; } }
    catch (error) { if (error.name === "AbortError") return; }
    const url = URL.createObjectURL(file), a = document.createElement("a"); a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  ui.start.disabled = false;
  if (location.hash.length > 1) {
    ui.status.textContent = "Разбор QR…";
    const initial = generation;
    load(location.hash, false).catch(error => { if (initial === generation) ui.status.textContent = error.message + ". Откройте камеру и наведите её на QR листа."; });
  } else {
    ui.status.textContent = "Откройте камеру и наведите её на QR листа.";
  }
  if (!quickLook) ui.look.hidden = true;
  // For the browser test: the current model and its USDZ without Quick Look.
  window.ARViewer = { version: appVersion, model: () => model, usdz: () => model && usdzFor(model.group) };
})();

