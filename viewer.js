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
    // Until sheet registration exists, stand the model on the marker centre.
    const bounds = new THREE.Box3().setFromObject(inner), center = bounds.getCenter(new THREE.Vector3());
    inner.position.set(-center.x, -bounds.min.y, -center.z);
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

  async function load(payload, announce) {
    const data = ARCubeData.parse(payload);
    if (model && model.data.payload === data.payload) return;
    const ticket = loading = {};
    const group = data.kind === "walls" ? buildWalls(data, await ARCubeData.decodeWalls(data.data)) : buildCube(data);
    if (ticket !== loading) return;
    if (model && follower) follower.object3D.remove(model.holder);
    const holder = new THREE.Group();
    holder.add(group);
    holder.scale.setScalar(1000 / (MARKER_MM * data.scale));
    model = { data, holder, group };
    if (follower) follower.object3D.add(holder);
    if (location.hash.replace(/^#/, "") !== encodeURIComponent(data.payload))
      history.replaceState(null, "", "#" + encodeURIComponent(data.payload));
    const rgb = data.color || (data.kind === "walls" ? DEFAULT_WALL : DEFAULT_CUBE);
    ui.dot.style.background = rgbCss(rgb);
    ui.dot.hidden = false;
    ui.title.textContent = ARCubeData.title(data);
    ui.sheet.textContent = data.sheet ? "Лист " + data.sheet : "Модель из QR";
    if (quickLook) {
      if (usdzUrl) URL.revokeObjectURL(usdzUrl);
      usdzUrl = URL.createObjectURL(usdzFor(group));
      ui.look.href = usdzUrl;
      ui.look.hidden = false;
    }
    if (announce) toast((data.sheet ? "Лист " + data.sheet + " · " : "") + ARCubeData.title(data));
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
    },
    tick(time, delta) {
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

  function stopCamera() {
    clearInterval(scanTimer);
    document.querySelectorAll("video").forEach(video => {
      if (video.srcObject && video.srcObject.getTracks) video.srcObject.getTracks().forEach(track => track.stop());
    });
  }

  // QR is read from the same video AR.js tracks: no second camera, no leaving the AR screen.
  function startScanning(video) {
    if (typeof jsQR !== "function") return;
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    let last = "";
    scanTimer = setInterval(() => {
      if (document.hidden || !video.videoWidth || !ctx) return;
      const factor = Math.min(1, 1280 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * factor);
      canvas.height = Math.round(video.videoHeight * factor);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const qr = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
      if (!qr || qr.data === last) return;
      last = qr.data;
      let data;
      try { data = ARCubeData.fromUrl(qr.data); }
      catch (error) { toast(error.message); return; }
      load(data.payload, true).catch(error => toast(error.message));
    }, 280);
  }

  function startCamera() {
    if (scene) return;
    ui.start.hidden = true;
    ui.stop.hidden = false;
    ui.body.classList.add("live");
    scene = document.createElement("a-scene");
    scene.setAttribute("embedded", "");
    scene.setAttribute("vr-mode-ui", "enabled:false");
    scene.setAttribute("renderer", "logarithmicDepthBuffer:true;precision:medium;antialias:true");
    // 1280 × 960 so that the dense AR4 QR is readable; AR.js still tracks on its own 640 × 480 canvas.
    scene.setAttribute("arjs", "sourceType:webcam;sourceWidth:1280;sourceHeight:960;debugUIEnabled:false;trackingMethod:best;patternRatio:0.5;cameraParametersUrl:./vendor/camera_para.dat;");
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
    window.addEventListener("camera-error", () => {
      stopCamera();
      ui.status.textContent = "Не удалось открыть камеру. Разрешите доступ в настройках Safari и перезагрузите страницу.";
    }, { once: true });
    ui.reticle.hidden = false;
    ui.status.textContent = model ? "Наведите камеру на маркер Hiro" : "Наведите камеру на QR листа";
    document.body.appendChild(scene);
  }

  window.addEventListener("arjs-video-loaded", () => {
    if (document.hidden || suspended) { stopCamera(); return; }
    const video = $("arjs-video") || document.querySelector("video");
    if (video) startScanning(video);
  });

  ui.start.onclick = startCamera;
  ui.stop.onclick = () => { stopCamera(); location.reload(); };
  // A QR opened from the system camera may reuse this tab and change only the fragment.
  window.addEventListener("hashchange", () => {
    if (!location.hash) return;
    load(location.hash, true).catch(error => toast(error.message));
  });
  window.addEventListener("pagehide", () => { suspended = true; stopCamera(); });
  // Reopen explicitly after backgrounding; do not keep the camera running invisibly.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && scene) {
      suspended = true;
      stopCamera();
      ui.status.textContent = "Камера остановлена. Нажмите «Стоп» и откройте камеру снова.";
    }
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
  window.ARViewer = { model: () => model, usdz: () => model && usdzFor(model.group) };
})();
