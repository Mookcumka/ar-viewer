/* Platform adapter for the existing viewer. Geometry comes only from its decoded model.
   WebXR/ARCore owns world tracking; this adapter does not implement a tracker. */
(function (root) {
  "use strict";
  async function supported(nav = root.navigator, secure = root.isSecureContext) {
    if (!secure || !nav?.xr?.isSessionSupported) return false;
    try { return !!(await nav.xr.isSessionSupported("immersive-ar")); } catch (_) { return false; }
  }
  function create({ THREE, overlay, emit = () => {} }) {
    let current = null, width = .35;
    const alive = run => current === run && !run.disposed && !run.closing;
    function notify(run, next, detail = {}) {
      if (current !== run) return;
      if (run.state !== next || Object.keys(detail).length) { run.state = next; emit(next, detail); }
    }
    function listen(run, target, name, handler) {
      target.addEventListener(name, handler); run.listeners.push(() => target.removeEventListener(name, handler));
    }
    function cleanup(run) {
      if (run.disposed) return;
      run.disposed = true;
      const release = fn => { try { fn(); } catch (_) { /* Native end may already invalidate resources. */ } };
      release(() => run.hitSource?.cancel()); run.listeners.splice(0).forEach(remove => release(remove));
      release(() => run.renderer?.setAnimationLoop(null));
      // Model clones share the viewer's geometry/materials; never dispose those here.
      release(() => run.content?.removeFromParent()); release(() => run.reticle?.geometry.dispose()); release(() => run.reticle?.material.dispose());
      if (run.renderer) { release(() => run.renderer.domElement.remove()); release(() => run.renderer.dispose()); }
      if (current === run) { current = null; emit("ended"); }
    }
    function setWidth(metres) {
      if (!Number.isFinite(metres) || metres < .05 || metres > 1) throw new Error("Размер просмотра вне диапазона 5–100 см");
      width = metres; if (current?.content) current.content.scale.setScalar(width / current.extent);
    }
    function reset() {
      const run = current; if (!alive(run || {})) return;
      run.placed = false; run.pendingPose = null; if (run.placement) run.placement.visible = false;
      notify(run, "searching");
    }
    async function end() {
      const run = current; if (!run) return;
      run.closing = true; run.renderer?.setAnimationLoop(null);
      // All cleanup is owned by this run, even if another run starts before end() resolves.
      try { if (run.session) await run.session.end(); } finally { cleanup(run); }
    }
    // Called synchronously from a user gesture. No awaited capability query before requestSession.
    async function start(group) {
      if (current) return;
      if (!group || !root.navigator?.xr) throw new Error("WebXR недоступен");
      const run = { listeners: [], state: "idle", disposed: false, closing: false, placed: false };
      current = run; notify(run, "requesting");
      try {
        const acquired = await root.navigator.xr.requestSession("immersive-ar", {
          requiredFeatures: ["local", "hit-test"], optionalFeatures: ["dom-overlay"], domOverlay: { root: overlay }
        });
        if (!alive(run)) { await acquired.end(); return; }
        run.session = acquired; listen(run, acquired, "end", () => cleanup(run));
        // Without DOM overlay native exit/select still work; hidden HTML controls are not promised.
        run.world = new THREE.Scene(); run.camera = new THREE.PerspectiveCamera();
        const renderer = run.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2)); renderer.setSize(root.innerWidth, root.innerHeight);
        renderer.setClearColor(0x000000, 0); renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType("local");
        renderer.domElement.id = "webxr-canvas"; root.document.body.append(renderer.domElement);
        run.world.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2));
        const light = new THREE.DirectionalLight(0xffffff, 1); light.position.set(1, 3, 2); run.world.add(light);
        run.placement = new THREE.Group(); run.placement.matrixAutoUpdate = false; run.placement.visible = false; run.world.add(run.placement);
        const clone = group.clone(true); clone.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(clone), size = bounds.getSize(new THREE.Vector3());
        run.extent = Math.max(size.x, size.y, size.z);
        if (!Number.isFinite(run.extent) || run.extent <= 0) throw new Error("У модели нет конечных размеров");
        const center = bounds.getCenter(new THREE.Vector3());
        const offset = new THREE.Group(); offset.add(clone); offset.position.set(-center.x, -bounds.min.y, -center.z);
        run.content = new THREE.Group(); run.content.add(offset); run.placement.add(run.content); setWidth(width);
        run.reticle = new THREE.Mesh(new THREE.RingGeometry(.035, .045, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7fc4c8 }));
        run.reticle.matrixAutoUpdate = false; run.reticle.visible = false; run.world.add(run.reticle);
        const reference = await acquired.requestReferenceSpace("local"); if (!alive(run)) return; run.reference = reference;
        listen(run, reference, "reset", () => {
          if (!alive(run)) return;
          run.placed = false; run.pendingPose = null; run.placement.visible = false; run.reticle.visible = false;
          notify(run, "reference-reset");
        });
        const viewer = await acquired.requestReferenceSpace("viewer"); if (!alive(run)) return;
        const hitSource = await acquired.requestHitTestSource({ space: viewer });
        if (!alive(run)) { hitSource.cancel(); return; } run.hitSource = hitSource;
        listen(run, acquired, "select", () => {
          if (!alive(run) || !run.pendingPose || run.placed) return;
          run.placement.matrix.fromArray(run.pendingPose); run.placement.visible = true; run.placed = true; run.reticle.visible = false;
          notify(run, "placed", { displayExtentMetres: width });
        });
        await renderer.xr.setSession(acquired); if (!alive(run)) return;
        notify(run, "searching", { domOverlay: !!acquired.domOverlayState });
        renderer.setAnimationLoop((time, frame) => {
          if (!alive(run) || !frame) return;
          try {
            if (!frame.getViewerPose(reference)) {
              run.pendingPose = null; run.reticle.visible = false; run.placement.visible = false; notify(run, "tracking-lost");
            } else if (run.placed) { run.placement.visible = true; notify(run, "placed"); }
            else {
              run.pendingPose = null; run.reticle.visible = false;
              for (const hit of frame.getHitTestResults(hitSource)) {
                const matrix = hit.getPose(reference)?.transform.matrix;
                // Hit-test poses never move an already placed model.
                if (matrix && matrix[5] > .9) { run.pendingPose = Array.from(matrix); break; }
              }
              if (run.pendingPose) { run.reticle.matrix.fromArray(run.pendingPose); run.reticle.visible = true; }
              notify(run, run.pendingPose ? "surface" : "searching");
            }
            renderer.render(run.world, run.camera);
          } catch (error) { notify(run, "error", { message: error.message }); end().catch(() => {}); }
        });
      } catch (error) {
        const reportError = alive(run);
        if (run.session && !run.disposed) { try { await run.session.end(); } catch (_) {} }
        cleanup(run); if (reportError) throw error;
      }
    }
    return { start, end, reset, setWidth, get active() { return !!current; } };
  }
  const api = { supported, create }; root.ARWebXR = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
