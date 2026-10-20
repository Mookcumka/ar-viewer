/* Create the AR scene only after validation and an explicit camera action. */
(function () {
  "use strict";
  const status = document.getElementById("status"), button = document.getElementById("start");
  // QR links may reuse an existing browser tab and change only its fragment.
  window.addEventListener("hashchange", () => location.reload());
  let data, walls, scene, suspended = false;
  try {
    data = ARCubeData.parse(location.hash);
    if (!window.AFRAME || !AFRAME.systems.arjs) throw new Error("AR-библиотеки не загружены. Проверьте установку просмотрщика.");
  } catch (error) {
    status.textContent = error.message;
    return;
  }
  if (data.kind === "walls") {
    status.textContent = "Разбор модели стен…";
    // Decode fully before offering the camera: a broken QR must not open AR.
    ARCubeData.decodeWalls(data.data).then(result => {
      walls = result;
      status.textContent = `Стены: ${walls.length} · 1:${data.scale}`;
      button.disabled = false;
    }, error => { status.textContent = error.message; });
  } else {
    status.textContent = `Куб ${data.w} × ${data.d} × ${data.h} мм · 1:${data.scale}`;
    button.disabled = false;
  }
  // Revit X/Y/Z (Z up) → three.js X/Y/-Z (Y up). Each wall is its elevation extruded across its thickness.
  function wallsGroup() {
    const THREE = AFRAME.THREE, group = new THREE.Group();
    for (const wall of walls) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(wall.length, 0);
      shape.lineTo(wall.length, wall.height);
      shape.lineTo(0, wall.height);
      shape.closePath();
      for (const o of wall.openings) {
        const hole = new THREE.Path();
        hole.moveTo(o.start, o.bottom);
        hole.lineTo(o.start, o.top);
        hole.lineTo(o.end, o.top);
        hole.lineTo(o.end, o.bottom);
        hole.closePath();
        shape.holes.push(hole);
      }
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: wall.width, bevelEnabled: false, steps: 1 });
      const color = new THREE.Color(wall.color[0] / 255, wall.color[1] / 255, wall.color[2] / 255);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
      const c = (wall.x2 - wall.x1) / wall.length, s = (wall.y2 - wall.y1) / wall.length;
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
        new THREE.Vector3(c, 0, -s), new THREE.Vector3(0, 1, 0), new THREE.Vector3(s, 0, c)));
      // Shift by half the thickness so the extrusion is centred on the wall axis.
      mesh.position.set(wall.x1 - s * wall.width / 2, wall.z0, -wall.y1 - c * wall.width / 2);
      group.add(mesh);
    }
    // Until sheet registration exists, stand the model on the marker centre.
    const bounds = new THREE.Box3().setFromObject(group), center = bounds.getCenter(new THREE.Vector3());
    group.position.set(-center.x, -bounds.min.y, -center.z);
    const holder = new THREE.Group();
    holder.add(group);
    holder.scale.setScalar(data.unit);
    return holder;
  }
  function stopCamera() {
    document.querySelectorAll("video").forEach(video => {
      if (video.srcObject && video.srcObject.getTracks) video.srcObject.getTracks().forEach(track => track.stop());
    });
  }
  button.onclick = function () {
    if (scene) return;
    button.disabled = true;
    scene = document.createElement("a-scene");
    scene.setAttribute("embedded", "");
    scene.setAttribute("vr-mode-ui", "enabled:false");
    scene.setAttribute("renderer", "logarithmicDepthBuffer:true;precision:medium");
    scene.setAttribute("arjs", "sourceType:webcam;debugUIEnabled:false;trackingMethod:best;patternRatio:0.5;cameraParametersUrl:./vendor/camera_para.dat;");
    scene.setAttribute("device-orientation-permission-ui", "enabled:false");
    const marker = document.createElement("a-marker");
    marker.setAttribute("type", "pattern");
    marker.setAttribute("url", "./vendor/patt.hiro");
    if (data.kind === "walls") {
      const entity = document.createElement("a-entity");
      entity.addEventListener("loaded", () => entity.object3D.add(wallsGroup()), { once: true });
      marker.appendChild(entity);
    } else {
      const cube = document.createElement("a-box");
      cube.setAttribute("width", data.x);
      cube.setAttribute("height", data.y);
      cube.setAttribute("depth", data.z);
      cube.setAttribute("position", `0 ${data.y / 2} 0`);
      cube.setAttribute("material", "color:#3b9ddd;opacity:.72;transparent:true;side:double");
      marker.appendChild(cube);
    }
    marker.addEventListener("markerFound", () => { status.textContent = "Маркер найден · 1:" + data.scale; });
    marker.addEventListener("markerLost", () => { status.textContent = "Маркер потерян — наведите камеру на Hiro"; });
    scene.appendChild(marker);
    scene.appendChild(document.createElement("a-entity")).setAttribute("camera", "");
    window.addEventListener("camera-error", () => {
      stopCamera();
      status.textContent = "Не удалось открыть камеру. Разрешите доступ в настройках Safari и перезагрузите страницу.";
    }, { once: true });
    status.textContent = "Разрешите камеру и наведите её на Hiro…";
    document.body.appendChild(scene);
  };
  window.addEventListener("pagehide", () => { suspended = true; stopCamera(); });
  // AR.js can finish getUserMedia after the user backgrounds the page.
  window.addEventListener("arjs-video-loaded", () => { if (document.hidden || suspended) stopCamera(); });
  // Reopen explicitly after backgrounding; do not keep the camera running invisibly.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && scene) {
      suspended = true;
      stopCamera();
      status.textContent = "Камера остановлена. Перезагрузите страницу, чтобы продолжить.";
    }
  });
})();
