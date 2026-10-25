/* One screen: camera stays open, every QR in view swaps the model in place, the model follows the
   Hiro marker through a smoothing filter. Quick Look shows the same model through ARKit, 1:1. */
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

  if (!window.AFRAME || !AFRAME.systems.arjs) {
    ui.status.textContent = "AR-библиотеки не загружены. Откройте приложение с интернетом.";
    return;
  }
  const THREE = AFRAME.THREE;

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

  function usdzFor(group) {
    // Metres relative to the model itself: the marker pose and the 1:N holder do not go into Quick Look.
    group.updateMatrixWorld(true);
    const local = group.matrixWorld.clone().invert(), meshes = [];
    group.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(local.clone().multiply(o.matrixWorld));
      meshes.push({ positions: g.attributes.position.array, color: o.userData.rgb });
      g.dispose();
    });
    return new Blob([ARUsdz.build(meshes)], { type: "model/vnd.usdz+zip" });
  }

  let storage;
  try { storage = window.localStorage; } catch (_) {}
  const journal = new ARSession.Journal(storage);
  window.addEventListener("error", e => journal.add("error", { message: String(e.message).slice(0, 180) }));
  window.addEventListener("unhandledrejection", e => journal.add("error", { message: String(e.reason?.message || "Promise rejected").slice(0, 180) }));
  journal.add("environment", { userAgent: navigator.userAgent, online: navigator.onLine });
  function dispose(group) {
    group?.traverse(o => { o.geometry?.dispose(); if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material?.dispose(); });
  }
  function resetPose() {
    const c = follower?.components?.["ar-follow"];
    if (c) { c.ready = false; c.seen = -1e9; c.sample = { time: null, frames: 0, move: 0, turn: 0 }; }
    if (follower) follower.object3D.visible = false;
  }
  const session = new ARSession.Session(ARCubeData, {
    clear() {
      resetPose();
      if (model) { model.holder.removeFromParent(); dispose(model.group); }
      model = null; loading = null;
      if (usdzUrl) URL.revokeObjectURL(usdzUrl);
      usdzUrl = null; ui.look.hidden = true; ui.dot.hidden = true;
      ui.title.textContent = "AR Studio"; ui.sheet.textContent = "Ожидание нового QR";
      history.replaceState(null, "", location.pathname + location.search);
    },
    async prepare(data) { return data.kind === "walls" ? buildWalls(data, await ARCubeData.decodeWalls(data.data)) : buildCube(data); },
    dispose,
    commit(group, data) {
      const holder = new THREE.Group(); holder.add(group);
      holder.scale.setScalar(1000 / (MARKER_MM * data.scale));
      model = { data, holder, group };
      if (follower) follower.object3D.add(holder);
      history.replaceState(null, "", "#" + encodeURIComponent(data.payload));
      ui.dot.style.background = rgbCss(data.color || (data.kind === "walls" ? DEFAULT_WALL : DEFAULT_CUBE));
      ui.dot.hidden = false; ui.title.textContent = ARCubeData.title(data);
      ui.sheet.textContent = data.sheet ? "Лист " + data.sheet : "Модель из QR";
      if (quickLook) { usdzUrl = URL.createObjectURL(usdzFor(group)); ui.look.href = usdzUrl; ui.look.hidden = false; }
    },
    state(state, detail) {
      const messages = { scanning: "Наведите камеру на QR нового листа", loading: "Загрузка нового листа…",
        aligning: "Лист загружен. Наведите на его Hiro", viewing: "Маркер виден · Safari следует за ним",
        "tracking-lost": "Маркер потерян · модель скрыта. Наведите на Hiro", error: "Не удалось загрузить лист. Повторите сканирование." };
      if (state === "collecting") {
        ui.title.textContent = `Части ${detail.have} из ${detail.of}`;
        ui.sheet.textContent = "Остались QR: " + detail.missing.join(", ");
        ui.status.textContent = "Сбор частей · предыдущая модель скрыта";
      } else ui.status.textContent = messages[state] || state;
    }
  }, journal);
  async function load(payload, announce) {
    if (await session.ingest(payload) && announce) toast("Загружен " + (model?.data.sheet || "новый лист"));
  }

  function toast(text) {
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
      this.sample = { time: null, frames: 0, move: 0, turn: 0 };
    },
    tick(time, delta) {
      const target = marker && marker.object3D, o = this.el.object3D;
      if (!target || !session.active || !scene?.systems.arjs?._arSession?.arSource?.ready) { o.visible = false; return; }
      if (target.visible) {
        target.updateMatrixWorld(true);
        target.matrixWorld.decompose(this.pos, this.quat, this.scl);
        const gap = time - this.seen, move = o.position.distanceTo(this.pos), turn = o.quaternion.angleTo(this.quat);
        if (this.ready && gap < 700) {
          this.sample.move = Math.max(this.sample.move, move); this.sample.turn = Math.max(this.sample.turn, turn);
        }
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
      if (this.sample.time === null) this.sample.time = time;
      this.sample.frames++;
      if (time - this.sample.time >= 5000) {
        journal.add("tracking-sample", { fps: Math.round(this.sample.frames * 1000 / Math.max(1, time - this.sample.time)),
          maxFollowErrorMarkerUnits: +this.sample.move.toFixed(4), maxFollowErrorRadians: +this.sample.turn.toFixed(4) });
        this.sample = { time, frames: 0, move: 0, turn: 0 };
      }
      const shown = !!session.active && target.visible && this.ready;
      if (o.visible !== shown) {
        o.visible = shown;
        ui.reticle.hidden = shown;
        session.tracking(shown);
      }
    }
  });

  // ---------- camera ----------
  const camera = new ARSession.CameraLease();
  let opening = false, videoSourceURL = null;
  const wiredVideos = new WeakSet();

  function stopCamera() {
    clearInterval(scanTimer); scanTimer = 0; camera.cancel();
    resetPose();
    journal.add("camera", { action: "stop" });
    document.querySelectorAll("video").forEach(video => {
      if (video.srcObject && video.srcObject.getTracks) video.srcObject.getTracks().forEach(track => track.stop());
    });
  }

  // QR is read from the same video AR.js tracks: no second camera, no leaving the AR screen.
  function startScanning(video) {
    if (typeof jsQR !== "function") return;
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    let busy = false;
    scanTimer = setInterval(() => {
      if (busy || suspended || document.hidden || !video.videoWidth || !ctx) return;
      const factor = Math.min(1, 1280 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * factor);
      canvas.height = Math.round(video.videoHeight * factor);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const qr = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
      if (!qr) return;
      let data;
      try { data = ARCubeData.fromUrl(qr.data); }
      catch (_) { return; }
      busy = true;
      load(data.payload, true).catch(error => toast(error.message)).finally(() => { busy = false; });
    }, 280);
  }

  async function startCamera() {
    if (opening || camera.stream) return;
    opening = true;
    suspended = false; journal.add("camera", { action: "start" });
    ui.start.hidden = true;
    ui.stop.hidden = false;
    ui.body.classList.add("live");
    ui.status.textContent = "Подключение камеры…";
    let stream;
    try { stream = await camera.open(() => navigator.mediaDevices.getUserMedia({ audio: false, video: {
      facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 }
    } })); }
    catch (error) {
      pauseCamera(); journal.add("camera-error", { name: error.name });
      ui.status.textContent = "Не удалось открыть камеру. Проверьте разрешение Safari и попробуйте снова."; return;
    }
    if (!stream) return; // A cancelled permission request must not restart a paused camera.
    opening = false;
    if (!scene) {
    scene = document.createElement("a-scene");
    videoSourceURL = URL.createObjectURL(new Blob([], { type: "video/mp4" }));
    scene.setAttribute("embedded", "");
    scene.setAttribute("vr-mode-ui", "enabled:false");
    scene.setAttribute("renderer", "logarithmicDepthBuffer:true;precision:medium;antialias:true");
    // 1280 × 960 so that the dense AR4 QR is readable; AR.js still tracks on its own 640 × 480 canvas.
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
    follower.addEventListener("loaded", () => { if (model) follower.object3D.add(model.holder); }, { once: true });
    scene.appendChild(marker);
    scene.appendChild(follower);
    scene.appendChild(document.createElement("a-entity")).setAttribute("camera", "");
    ui.reticle.hidden = false;
    ui.status.textContent = model ? "Наведите камеру на маркер Hiro" : "Наведите камеру на QR листа";
    document.body.appendChild(scene);
    }
    const ownedScene = scene;
    scene.style.display = ""; scene.play();
    // AR.js consumes our video; it never starts a second, unowned getUserMedia request.
    function attachVideo() {
      if (scene !== ownedScene || !camera.owns(stream)) return;
      const source = ownedScene.systems.arjs?._arSession?.arSource;
      if (!source?.domElement) { requestAnimationFrame(attachVideo); return; }
      const video = source.domElement; video.style.display = "";
      if (!wiredVideos.has(video)) {
        wiredVideos.add(video);
        const initializeAR = video.onloadeddata; let initialized = false;
        video.onloadeddata = () => {
          if (scene !== ownedScene || !camera.owns(video.srcObject)) return;
          if (!initialized) {
            initialized = true; initializeAR?.call(video);
          } else {
            // AR.js's global arjs-video-loaded listener initializes a new ARController.
            // MarkerControls remain bound to the first controller: never emit that event twice.
            source.ready = true; videoReady(video);
          }
        };
      }
      video.srcObject = stream; video.setAttribute("playsinline", "");
      ui.reticle.hidden = false;
      session.set(model ? "aligning" : "scanning");
      video.play().catch(error => { if (camera.owns(stream)) { journal.add("play-error", { name: error.name }); pauseCamera(); } });
    }
    requestAnimationFrame(attachVideo);
  }

  function videoReady(video) {
    if (!video || video !== scene?.systems.arjs?._arSession?.arSource?.domElement || !camera.owns(video.srcObject)) return;
    const settings = video.srcObject?.getVideoTracks()[0]?.getSettings() || {};
    journal.add("camera-settings", { width: settings.width, height: settings.height, frameRate: settings.frameRate, facingMode: settings.facingMode });
    clearInterval(scanTimer); startScanning(video);
  }
  window.addEventListener("arjs-video-loaded", event => videoReady(event.detail?.component));

  ui.start.onclick = startCamera;
  function pauseCamera() {
    suspended = true; stopCamera(); session.set("paused");
    opening = false;
    const source = scene?.systems.arjs?._arSession?.arSource;
    if (source?.domElement) {
      source.ready = false; source.domElement.pause(); source.domElement.srcObject = null; source.domElement.style.display = "none";
    }
    // Reuse one paused AR.js scene: its global resize callbacks retain the source object.
    // Disposing/recreating it leaves vendor callbacks pointing at null and duplicates listeners.
    scene?.pause(); if (scene) scene.style.display = "none";
    ui.body.classList.remove("live"); ui.start.hidden = false; ui.stop.hidden = true;
    ui.reticle.hidden = true;
    ui.status.textContent = "Камера остановлена. Можно продолжить без перезагрузки.";
  }
  ui.stop.onclick = pauseCamera;
  $("new-sheet").onclick = () => session.clear();
  $("reanchor").onclick = () => { resetPose(); journal.add("reanchor"); if (model) session.set("aligning"); };
  $("report").onclick = async () => {
    const blob = new Blob([JSON.stringify(journal.report({ userAgent: navigator.userAgent, online: navigator.onLine }), null, 2)], { type: "application/json" });
    const file = new File([blob], "AR-camera-" + journal.id + ".json", { type: "application/json" });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
      else { const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
    } catch (error) { if (error.name !== "AbortError") toast("Не удалось сохранить отчёт"); }
  };
  // A QR opened from the system camera may reuse this tab and change only the fragment.
  window.addEventListener("hashchange", () => {
    if (!location.hash) return;
    load(location.hash, true).catch(error => toast(error.message));
  });
  window.addEventListener("pagehide", pauseCamera);
  // Reopen explicitly after backgrounding; do not keep the camera running invisibly.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && (scene || opening)) pauseCamera();
  });

  ui.start.disabled = false;
  if (location.hash.length > 1) {
    ui.status.textContent = "Разбор QR…";
    load(location.hash, false).then(
      () => { ui.status.textContent = "Откройте камеру и наведите её на маркер Hiro. Другие QR можно считывать, не выходя."; },
      error => { ui.status.textContent = error.message + ". Откройте камеру и наведите её на QR листа."; });
  } else {
    ui.status.textContent = "Откройте камеру и наведите её на QR листа.";
  }
  if (!quickLook) ui.look.hidden = true;
  // For the browser test: the current model and its USDZ without Quick Look.
  window.ARViewer = { model: () => model, usdz: () => model && usdzFor(model.group), session, report: () => journal.report() };
})();
