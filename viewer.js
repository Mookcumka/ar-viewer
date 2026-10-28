/* One viewer: shared QR decoding and geometry, legacy Hiro, Apple Quick Look and WebXR surface AR. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const ui = { status: $("status"), title: $("title"), sheet: $("sheet"), dot: $("dot"), start: $("start"),
    look: $("look"), reticle: $("reticle"), body: document.body };
  const DEFAULT_CUBE = [59, 157, 221], DEFAULT_WALL = [185, 185, 185];
  // Marker units: the black square of Hiro (40 mm on paper) is one unit.
  const MARKER_MM = 40;
  const quickLook = !!(document.createElement("a").relList?.supports?.("ar"));
  let model = null, loading = null, scene = null, marker = null, follower = null, scanTimer = 0, suspended = false, usdzUrl = null;
  const qrGeometry = window.ExportoQr, collector = new qrGeometry.Collector();
  let generation = 0, collecting = false, verifying = false, acceptedHash = null, blockedHash = null, blockedLegacy = null;
  let acceptedLegacyParts = new Set(), pendingLegacyParts = new Set(), blockedLegacyParts = new Set();
  let meshFailed = false;
  const diagnostic = new URLSearchParams(location.search).get("diagnostics") === "1";
  $("diagnostics").hidden = !diagnostic;
  const appVersion = window.ARViewerVersion;
  let xrSupported = false, xrChecking = true;
  const report = { app: appVersion, schema: "ARViewer-unified-1", build: appVersion.build, userAgent: navigator.userAgent, events: [], scene: null, scan: { accepted: 0, duplicates: 0, frames: 0 },
    acceptance: { source: null, cameraQrRead: false, integrityVerified: false, usdzCreated: false,
      autoARAttempted: false, glbCreated: false, quickLookRequested: false, webxrRequested: false, webxrPlaced: false, actualAR: "owner verification required", realRevitProvenance: "owner verification required" } };
  function log(type, detail = {}) { report.events.push({ type, at: new Date().toISOString(), ...detail }); if (report.events.length > 160) report.events.shift(); }
  // Search hint (Google Lens / ML Kit pattern): soft corners wait in the centre and fly onto the
  // real tracked quadrilateral; it never asks the user to centre a code. Codes are found anywhere.
  let targetSince = 0, lastDecodeAt = 0, hintTimer = 0;
  const SEARCH_HINT = 'Наведите на QR листа';
  function hint(text, ms = 2200) {
    const box = $("hint"); clearTimeout(hintTimer);
    if (!text) { box.hidden = true; return; }
    box.firstElementChild.textContent = text; box.hidden = false; box.dataset.text = text;
    if (ms) hintTimer = setTimeout(() => { box.hidden = true; }, ms);
  }
  function searching() { return mode === 'scan' && !model && !verifying && ui.body.classList.contains('live'); }
  function trackTargets(count, rects = []) {
    const r = ui.reticle;
    if (!searching()) { if (mode === 'scan') r.hidden = true; return; }
    r.hidden = false;
    const now = performance.now();
    if (!count) {
      targetSince = 0;
      if (r.classList.contains('locked')) { r.classList.remove('locked'); r.classList.add('idle'); r.removeAttribute('style'); }
      if ($("hint").dataset.text === 'Ближе') hint('');
      return;
    }
    if (!targetSince) targetSince = now;
    if ($("hint").dataset.text === SEARCH_HINT) hint('');
    const t = rects.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a), rects[0]);
    if (t) { const pad = 6; r.classList.remove('idle'); r.classList.add('locked');
      Object.assign(r.style, { left: (t.x - pad) + 'px', top: (t.y - pad) + 'px', width: (t.w + pad * 2) + 'px', height: (t.h + pad * 2) + 'px' }); }
    // A dense geometry QR is found but cannot be read from this distance: one word, no instructions.
    const stuck = rects.length && rects.every(x => x.state === 'candidate') && now - Math.max(targetSince, lastDecodeAt) > 1500;
    if (stuck && $("hint").hidden) hint('Ближе', 1800);
  }
  const qrOverlay=ARQrOverlay.create({svg:$("scan-outline"),emit:detail=>{report.tracking=detail;$("tracking-info").textContent=JSON.stringify(detail);},onTargets:trackTargets});
  let scanBatch = 0, scanStartedAt = 0;
  let mode = "scan", files = null, modeTicket = 0, arOpened = false, readyInfo = "";
  function clearFeedback(reset = false) {
    scanBatch++; qrOverlay.clear();
    if (reset) { $("part-progress").replaceChildren(); $("part-progress").hidden = true; shownParts = new Set(); hint(''); }
  }
  let shownParts = new Set();
  function showProgress(count, have, phase = 'collecting') {
    const progress = ARScanFeedback.progress(count, have), row = $("part-progress");
    const fresh = phase === 'collecting' || phase === 'verifying' ? progress.have.filter(n => !shownParts.has(n)) : [];
    shownParts = new Set(progress.have);
    // Android only: a short tap of vibration for a newly accepted part. iPhone Safari has no vibration API.
    if (fresh.length) try { navigator.vibrate?.(30); } catch (_) {}
    row.replaceChildren(); row.hidden = false;
    for (let n = 1; n <= count; n++) {
      const item = document.createElement('span'), received = progress.have.includes(n);
      item.className = 'part'; item.dataset.received = String(received); item.setAttribute('role','listitem');
      item.textContent = String(n); item.setAttribute('aria-label', 'QR ' + n + (received ? ' принят' : ' ожидается')); row.append(item);
      if (fresh.includes(n)) { item.classList.add('pop'); setTimeout(() => item.classList.remove('pop'), 220); }
    }
    row.setAttribute('aria-label', 'Части модели: ' + progress.have.length + ' из ' + count);
    return progress;
  }
  function notice(text, kind = 'new', tone = kind) {
    if (kind === 'error') { ui.status.dataset.error = 'true'; ui.status.textContent = text; }
  }
  function outline(hit, video, frame, kind = 'accepted', key = '') {
    if(hit.points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))return;
    lastDecodeAt = performance.now();
    qrOverlay.hit(hit.points,frame,kind,key,hit.at);
  }
  window.addEventListener('resize', () => clearFeedback());
  function resetAcceptance(source = null) { report.acceptance = { source, cameraQrRead: false, integrityVerified: false, usdzCreated: false,
    autoARAttempted: false, glbCreated: false, quickLookRequested: false, webxrRequested: false, webxrPlaced: false, actualAR: "owner verification required", realRevitProvenance: "owner verification required" }; }
  function dispose(group) { if (!group) return; group.traverse(o => { o.geometry?.dispose(); if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material?.dispose(); }); group.removeFromParent(); }
  function clearModel() {
    modeTicket++; objectView.end(); const ended = xrView.active ? xrView.end().catch(error => log("webxr-end-error",{message:error.message})) : Promise.resolve();
    $("webxr-open").hidden = true; $("mode-switch").hidden = true; $("share-wrap").hidden = true;
    $("marker-view").hidden = true; $("share-menu").hidden = true; $("share").setAttribute("aria-expanded","false");
    model?.holder?.removeFromParent(); dispose(model?.group); model = null; files = null;
    if (usdzUrl) URL.revokeObjectURL(usdzUrl); usdzUrl = null; ui.look.hidden = true; ui.look.removeAttribute("href"); ui.dot.hidden = true;
    arOpened = false; readyInfo = ""; $("ready-thumb").hidden = true; $("ready-thumb").removeAttribute("src"); ui.body.classList.remove("ready");
    return ended;
  }
  async function newSheet() {
    const ticket = ++generation; loading = null; collector.reset(); collecting = false; verifying = false;
    acceptedHash = blockedHash = blockedLegacy = null; meshFailed = false; parts = [];
    acceptedLegacyParts.clear(); pendingLegacyParts.clear(); blockedLegacyParts.clear();
    const ended = clearModel(); clearFeedback(true); report.scene = null; resetAcceptance(); report.scan = {accepted:0,duplicates:0,frames:0};
    mode = "scan"; ui.body.classList.remove("xr","object"); $("xr-controls").hidden = true;
    ui.start.disabled = false; ui.title.textContent = "AR Viewer"; ui.sheet.textContent = "";
    ui.status.textContent = ""; delete ui.status.dataset.error;
    history.replaceState(null,"",location.pathname+location.search); log("new-sheet");
    await ended; if (ticket !== generation || document.hidden) return;
    if (ownedStream && !suspended) { showCameraMode(); startScanning(cameraVideo()); } else startCamera();
  }

  if (!window.AFRAME || !AFRAME.systems.arjs) {
    ui.status.textContent = "AR-библиотеки не загружены. Откройте приложение с интернетом.";
    return;
  }
  const THREE = AFRAME.THREE;
  const objectView = ARObjectView.create({THREE,container:document.body});
  const xrView = ARWebXR.create({THREE,overlay:$("ui"),emit:(state,detail)=>{
    log("webxr-"+state,detail);
    if(state === "ended") {
      ui.body.classList.remove("xr"); $("xr-controls").hidden=true;
      if(mode === "xr") {mode="ready"; refreshAr(); ui.status.textContent="";}
      return;
    }
    const text={requesting:"Запуск AR…",searching:"Найдите поверхность",surface:"Коснитесь, чтобы разместить",placed:"",'reference-reset':"Разместите модель заново",'tracking-lost':"Отслеживание потеряно"};
    if(text[state] !== undefined) ui.status.textContent=text[state];
    if(state === "placed") report.acceptance.webxrPlaced=true;
    if(state === "error") notice("Ошибка AR: "+detail.message,'error');
  }});
  const xrReady = ARWebXR.supported().then(value=>{xrSupported=value;xrChecking=false;report.capabilities={quickLook,immersiveAR:value};refreshAr();});
  function refreshAr(){
    const ready=!!model&&mode==='ready';
    ui.body.classList.toggle('ready',ready);
    ui.look.hidden=!model||!quickLook||!usdzUrl;
    $("webxr-open").hidden=!model||quickLook||!xrSupported||mode==='xr'||mode==='object';
    // Ready screen (P3/P7): one large action; the whole screen is the tap target. 3D only on Android.
    $("ready-3d").hidden=!ready||quickLook; $("ready-3d").classList.toggle('primary',ready&&!quickLook&&!xrChecking&&!xrSupported);
    $("ready-title").textContent=arOpened?'Открыть ещё раз':'Модель собрана';
    $("ready-sub").textContent=arOpened?'Без повторного сканирования: модель на телефоне, пока открыта эта страница.':readyInfo;
    $("ready-note").hidden=!ready||(!quickLook&&!xrSupported&&xrChecking);
    $("mode-switch").hidden=!model||quickLook||!(mode==='xr'||mode==='object');
    $("view-close").hidden=!model||!(mode==='xr'||mode==='object');
    $("mode-ar").disabled=!xrSupported; $("mode-ar").setAttribute('aria-pressed',String(mode==='xr'));
    $("mode-3d").setAttribute('aria-pressed',String(mode==='object'));
    $("share-wrap").hidden=!files; $("marker-view").hidden=!diagnostic||!model||model.data.kind==='mesh';
    ui.start.hidden=!!model||opening||ui.body.classList.contains('live');
    if(model&&!quickLook&&!xrChecking&&!xrSupported&&mode==='ready')ui.status.textContent='AR недоступен на этом устройстве. Доступен 3D.';
  }
  async function openAR(automatic=false){
    if(!model) return;
    const ticket=++modeTicket, current=model;
    report.acceptance.autoARAttempted ||= automatic; log('ar-attempt',{automatic});
    if(quickLook){
      // The real rel=ar anchor stays in the DOM with one IMG. No gesture bypass or synthetic AR success.
      if(automatic)ui.look.click(); return;
    }
    if(!xrSupported){await xrReady;if(ticket!==modeTicket||model!==current)return;}
    if(!xrSupported){refreshAr();return;}
    if(xrView.active)return;
    if(!automatic)arOpened=true;
    objectView.end();pauseCamera();mode='xr';ui.body.classList.remove('object');ui.body.classList.add('xr');$("xr-controls").hidden=false;refreshAr();
    report.acceptance.webxrRequested=true;
    try {await xrView.start(current.group);}
    catch(error){
      if(ticket!==modeTicket||model!==current)return;
      mode='ready';ui.body.classList.remove('xr');$("xr-controls").hidden=true;refreshAr();
      ui.status.textContent='';log('webxr-request-failed',{name:error.name,message:error.message,automatic});
      if(!automatic)notice('AR не запущен. Проверьте разрешение и ARCore.','error');
    }
  }
  async function open3D(){
    if(!model)return;const ticket=++modeTicket,current=model;pauseCamera();
    if(xrView.active)await xrView.end();
    if(ticket!==modeTicket||model!==current)return;
    objectView.start(current.group);mode='object';ui.body.classList.remove('xr');ui.body.classList.add('object');$("xr-controls").hidden=true;ui.status.textContent='';refreshAr();log('object-mode');
  }
  $("webxr-open").onclick=()=>openAR(false); $("mode-ar").onclick=()=>openAR(false); $("mode-3d").onclick=()=>open3D().catch(e=>notice(e.message,'error'));
  $("ready-3d").onclick=()=>open3D().catch(e=>notice(e.message,'error'));
  $("xr-reset").onclick=()=>xrView.reset();
  // Browsers start AR only from a real tap (WebKit rel="ar", WebXR requestSession). The ready screen
  // turns the whole screen into that tap; the anchor click below runs inside the user's own gesture.
  function primaryAction(){
    if(!model||mode!=='ready')return;
    if(quickLook){if(usdzUrl)ui.look.click();return;}
    if(xrSupported){openAR(false);return;}
    if(!xrChecking)open3D().catch(e=>notice(e.message,'error'));
  }
  $("panel").addEventListener('click',e=>{if(!ui.body.classList.contains('ready')||e.target.closest('button,a,input,label,details,#share-wrap'))return;primaryAction();});
  $("view-close").onclick=async()=>{
    const ticket=++modeTicket;
    if(xrView.active){await xrView.end().catch(error=>log('webxr-end-error',{message:error.message}));}
    if(ticket!==modeTicket)return;
    objectView.end();mode='ready';ui.body.classList.remove('xr','object');$("xr-controls").hidden=true;ui.status.textContent='';refreshAr();
  };
  $("xr-scale").addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    try{if(b.dataset.ratio)xrView.setRatio(Number(b.dataset.ratio));else xrView.setWidth(Number(b.dataset.width));}
    catch(error){notice(error.message,'error');return;}
    for(const x of $("xr-scale").querySelectorAll('button'))x.setAttribute('aria-pressed',String(x===b));log('xr-scale',{ratio:b.dataset.ratio||null,width:b.dataset.width||null});
  });
  $("ui").addEventListener('beforexrselect',e=>{if(e.target.closest('button,a,input,label,summary'))e.preventDefault();});
  function presentModel(preparedUSDZ=null){
    if(ownedStream||opening)pauseCamera();
    const meshes=ARModelFiles.triangles(model.group,THREE);
    const usdz=preparedUSDZ||new Blob([ARUsdz.build(meshes)],{type:'model/vnd.usdz+zip'});
    if(usdz.size>32*1024*1024)throw Error('USDZ превышает 32 МиБ; модель не обрезана');
    const glb=new Blob([ARModelFiles.glb(meshes)],{type:'model/gltf-binary'});
    files={usdz:new File([usdz],'Exporto-AR.usdz',{type:'model/vnd.usdz+zip'}),glb:new File([glb],'Exporto-AR.glb',{type:'model/gltf-binary'})};
    if(usdzUrl)URL.revokeObjectURL(usdzUrl);usdzUrl=URL.createObjectURL(usdz);ui.look.href=usdzUrl;
    mode='ready';ui.status.textContent='';delete ui.status.dataset.error;
    if(!readyInfo)readyInfo=model.data.kind==='mesh'?'Проверено · QR: '+(report.scene?.parts||''):ARCubeData.title(model.data);
    thumbnail(model.group);refreshAr();
    report.acceptance.usdzCreated=true;report.acceptance.glbCreated=true;
    if(report.scene)Object.assign(report.scene,{usdzBytes:usdz.size,glbBytes:glb.size});
    log('model-files-ready',{usdzBytes:usdz.size,glbBytes:glb.size});
    // AR-first: never initialize the ordinary 3D renderer here. Browser policy may require the visible CTA.
    openAR(true).catch(e=>{log('auto-ar-error',{message:e.message});refreshAr();});
  }
  // One still picture of the assembled model for the ready screen; the renderer is released at once.
  function thumbnail(group){
    const img=$("ready-thumb");img.hidden=true;
    let renderer=null;const holder=group.parent,scene=new THREE.Scene();
    try{
      renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(520,390,false);renderer.setClearColor(0x000000,0);
      const clone=group.clone(true);clone.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(clone),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
      const extent=Math.max(size.x,size.y,size.z);if(!Number.isFinite(extent)||extent<=0)return;
      clone.position.sub(center);scene.add(clone);scene.add(new THREE.HemisphereLight(0xffffff,0x777777,2));const light=new THREE.DirectionalLight(0xffffff,1);light.position.set(1,3,2);scene.add(light);
      const r=size.length()/2,camera=new THREE.OrthographicCamera(-r*4/3,r*4/3,r,-r,-10*r,10*r);camera.position.set(r,r*.85,r);camera.lookAt(0,0,0);
      renderer.render(scene,camera);img.src=renderer.domElement.toDataURL('image/png');img.hidden=false;clone.removeFromParent();
    }catch(error){log('thumbnail-error',{message:error.message});}
    finally{try{renderer?.dispose();renderer?.forceContextLoss();}catch(_){}if(holder&&group.parent!==holder)holder.add(group);}
  }
  $("share").onclick=()=>{const menu=$("share-menu");menu.hidden=!menu.hidden;$("share").setAttribute('aria-expanded',String(!menu.hidden));};
  async function saveModel(format){
    const file=files?.[format];if(!file)return;
    $("share-menu").hidden=true;$("share").setAttribute('aria-expanded','false');
    try{if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});log('model-shared',{format,bytes:file.size});return;}}
    catch(error){if(error.name==='AbortError')return;log('share-fallback',{format,name:error.name});}
    const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);log('model-download',{format,bytes:file.size});
  }
  $("share-usdz").onclick=()=>saveModel('usdz');$("share-glb").onclick=()=>saveModel('glb');
  if(quickLook)$("share-menu").prepend($("share-usdz"));else $("share-menu").prepend($("share-glb"));
  document.addEventListener('click',e=>{if(!e.target.closest('#share-wrap')){$("share-menu").hidden=true;$("share").setAttribute('aria-expanded','false');}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){$("share-menu").hidden=true;$("share").setAttribute('aria-expanded','false');$("share").focus();}});
  $("marker-view").onclick=async()=>{
    if(!model||model.data.kind==='mesh')return;
    const ticket=++modeTicket,current=model;objectView.end();if(xrView.active)await xrView.end();
    if(ticket!==modeTicket||model!==current)return;
    ui.body.classList.remove('xr','object');$("xr-controls").hidden=true;mode='marker';startCamera();
  };

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
    // All positions come from the verified CBX/GBX scene; no album-specific or synthetic geometry.
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
    return new Blob([ARUsdz.build(ARModelFiles.triangles(group,THREE))],{type:'model/vnd.usdz+zip'});
  }

  // AR5 parts of the model being collected, by id; a part of another model starts over.
  let parts = [];

  async function ingestMesh(bytes, source) {
    const packet = qrGeometry.packet(bytes);
    if (packet.hash === blockedHash) { hint('QR с другого листа · ⟳ справа сверху — новый лист'); return { state: 'blocked' }; }
    if (packet.hash === acceptedHash) return { state: 'duplicate' };
    if (verifying) return { state: 'busy' };
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
    showProgress(p.count, Array.from(collector.parts.keys(), i => i + 1), p.complete ? 'verifying' : 'collecting');
    report.acceptance.source = report.acceptance.source && report.acceptance.source !== source ? "mixed-input" : source;
    if (source === "camera") report.acceptance.cameraQrRead = true;
    ui.title.textContent = "AR Viewer"; ui.sheet.textContent = "";
    if (p.complete) ui.status.textContent = "Восстановление…";
    log("qrl-part", { version: packet.version, hash: p.hash, index: packet.index, count: p.count, source, elapsedMs: Math.round(performance.now() - scanStartedAt) });
    if (!p.complete) return { state: "accepted" };
    if(p.complete) pauseCamera();
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
      report.scene = { packetVersion: packet.version, codec: decoded.codec, decodeMilliseconds: decoded.decodeMilliseconds, sha256: decoded.sha256, parts: decoded.qrCount, compressedBytes: decoded.compressedBytes, rawBytes: decoded.rawBytes, objects: decoded.objects, primitives: decoded.primitives, families: decoded.families,
        usdzBytes: blob.size, meshes: decoded.meshes.length, vertices: decoded.vertices, triangles: decoded.triangles,
        extentMeters: decoded.extent, exportScale: decoded.scale, originMeters: decoded.originMeters, excluded: decoded.excluded };
      report.acceptance.integrityVerified = true; report.acceptance.usdzCreated = true;
      ui.title.textContent = "Модель Exporto"; ui.sheet.textContent = `${decoded.qrCount}/${decoded.qrCount} · SHA-256 OK`;
      readyInfo = `${decoded.qrCount} QR · проверено`;
      ui.status.textContent = "";
      $("scene-info").textContent = `${decoded.meshes.length} мешей · ${decoded.triangles} треугольников · ${decoded.extent.map(x => x.toFixed(3)).join(" × ")} м. ${decoded.excluded.join("; ")}`;
      showProgress(decoded.qrCount, Array.from({length:decoded.qrCount},(_,i)=>i+1), 'ready');

      clearInterval(scanTimer); scanTimer = 0;
      refreshAr();
      ui.reticle.hidden = true; log("mesh-ready", { hash: decoded.sha256, triangles: decoded.triangles });
      verifying=false;presentModel(blob);
    } catch (error) {
      dispose(group); if (ticket !== generation) return;
      meshFailed = true; clearModel(); notice(error.message,"error"); log("mesh-error", { message: error.message });
    } finally { if (ticket === generation) verifying = false; }
    return { state: meshFailed ? "error" : "accepted" };
  }

  async function load(payload, announce, source = "url") {
    let data = ARCubeData.parse(payload);
    if (data.payload === blockedLegacy || blockedLegacyParts.has(data.payload) || acceptedLegacyParts.has(data.payload) || pendingLegacyParts.has(data.payload)) return;
    let receivedParts = [];
    const partInfo = data.kind === "part" ? { number: data.part, count: data.of } : null;
    if (data.kind !== "part") { parts = []; pendingLegacyParts.clear(); }
    // A valid legacy QR switches the SAME viewer back to its legacy model path.
    if (collecting || model?.data.kind === "mesh" || verifying) {
      generation++; loading = null; collector.reset(); collecting = false; verifying = false; acceptedHash = null; clearModel();
      report.scene = null; resetAcceptance();
      $("new-sheet").hidden = false;
    }
    if (data.kind === "part") {
      if (parts.length && parts[0].id !== data.id) parts = [];
      if (!parts.length) { generation++; loading = null; clearModel(); acceptedLegacyParts.clear(); pendingLegacyParts.clear(); report.scene = null; resetAcceptance(); }
      $("new-sheet").hidden = false;
      if (parts.some(p => p.part === data.part)) { notice('QR ' + data.part + ' уже считан','duplicate'); return; }
      parts.push(data);
      showProgress(data.of, parts.map(p=>p.part));
      const joined = ARCubeData.join(parts);
      if (!joined) {
        return;
      }
      receivedParts = parts.map(p=>p.payload); pendingLegacyParts = new Set(receivedParts); parts = [];
      data = joined;
    }
    if (data.payload === blockedLegacy) return;
    if (model && model.data.payload === data.payload) return;
    pauseCamera();
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
    else { $("part-progress").hidden = true; }
    ui.title.textContent = ARCubeData.title(data);
    ui.sheet.textContent = data.sheet ? "Лист " + data.sheet : "Модель из QR";
    ui.status.textContent = scene && !suspended ? "Наведите камеру на маркер Hiro" : "Откройте камеру и наведите её на маркер Hiro. Другие QR можно считывать, не выходя.";
    refreshAr();
    pauseCamera();
    try{presentModel();}
    catch(error){clearModel();notice(error.message,'error');log('model-files-error',{message:error.message});}
  }
  function toast(text){notice(text,'error');}

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
        if(ui.status.dataset.error!=='true')ui.status.textContent = shown ? "Маркер найден" : "Наведите камеру на маркер Hiro или на QR другого листа";
      }
    }
  });

  // ---------- camera ----------

  let cameraEpoch = 0, ownedStream = null, opening = false, videoSourceURL = null;
  const wiredVideos = new WeakSet();
  const preview = $("camera-preview");
  function cameraVideo() { return mode === 'marker' ? $("arjs-video") : preview; }
  function cameraDiagnostics() {
    if (!ownedStream) return;
    const detail = {...ARCamera.snapshot(ownedStream.getVideoTracks()[0]), preview: ARCamera.preview(preview), display:mode==='marker'?'hiro-arjs':'qr-source'};
    report.camera = detail;
    $("camera-info").textContent = JSON.stringify(detail, null, 2);
    log('camera-display',detail);
  }
  function showCameraMode() {
    const hiro = mode === 'marker';
    ui.body.classList.toggle('hiro',hiro); preview.hidden = hiro;
    if(!hiro&&preview.srcObject&&preview.paused)preview.play().catch(()=>{});
    if (scene) { scene.style.display = hiro ? '' : 'none'; if (hiro) scene.play(); else scene.pause(); }
    const video = $("arjs-video"); if (video) video.style.display = hiro ? '' : 'none';
    cameraDiagnostics();
    if(ownedStream&&ARCamera.snapshot(ownedStream.getVideoTracks()[0]).settings.facingMode==='user')notice('Браузер выбрал переднюю камеру: задняя камера недоступна.','error');
  }
  preview.addEventListener('loadeddata',()=>videoReady(preview));
  preview.addEventListener('resize',cameraDiagnostics);
  window.addEventListener('resize',cameraDiagnostics);
  function stopCamera() {
    cameraEpoch++; qrOverlay.stop(); clearFeedback(); opening = false; clearInterval(scanTimer); scanTimer = 0;
    ownedStream?.getTracks().forEach(track => track.stop()); ownedStream = null;
    preview.pause(); preview.srcObject = null; preview.hidden = true;
    log("camera-stop");
  }

  // QR uses the uncropped preview. Hiro uses the same owned stream through the existing AR.js bridge.
  function startScanning(video) {
    if (typeof jsQR !== "function" || !video) return;
    qrOverlay.start(video);
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    let busy = false, region = 1; clearInterval(scanTimer);
    scanTimer = setInterval(async () => {
      if (busy || suspended || verifying || (model && mode!=='marker') || document.hidden || !video.videoWidth || !ctx) return;
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
          hit.at=frameAt;
          const qr=hit.qr, raw=Uint8Array.from(qr.binaryData);
          // Detection/tracking do not read bytes. Only this unchanged decoder supplies exact binaryData.
          const key=Array.from(raw).join(',');
          if(performance.now()-frameAt<400)outline(hit,video,image,'decoded',key);
          report.scan.decoded = (report.scan.decoded || 0) + 1;
          const binary=raw.length>=4 && raw[0]===81 && raw[1]===82 && raw[2]===76 && (raw[3]===49 || raw[3]===50 || raw[3]===51 || raw[3]===52);
          try {
            if (binary) {
              const result = await ingestMesh(raw, 'camera');
              if (batch !== scanBatch || epoch !== cameraEpoch || suspended) break;
              if (performance.now() - frameAt < 900) outline(hit, video, image, result?.state === 'blocked' ? 'other' : result?.state === 'error' ? 'rejected' : result?.state === 'busy' ? 'decoded' : 'accepted',key);
              if (model?.data.kind === 'mesh') break;
            } else if (qr.data === 'https://mookcumka.github.io/ar-viewer/') {
              outline(hit,video,image,'other',key);
              hint('Это QR запуска · наведите на QR модели');
            } else {
              const data = ARCubeData.fromUrl(qr.data);
              const blocked = data.payload === blockedLegacy || blockedLegacyParts.has(data.payload);
              const duplicate = acceptedLegacyParts.has(data.payload) || pendingLegacyParts.has(data.payload) || model?.data.payload === data.payload || parts.some(p=>p.payload===data.payload);
              await load(data.payload, true, 'camera');
              if (batch !== scanBatch || epoch !== cameraEpoch || suspended) break;
              if (duplicate) notice(data.kind === 'part' ? 'QR ' + data.part + ' уже считан' : 'QR уже считан','duplicate');
              if (blocked) notice('QR прежнего листа. Наведите камеру на новый лист.','duplicate','other');
              if (performance.now() - frameAt < 900) outline(hit,video,image,blocked ? 'other' : 'accepted',key);
            }
          } catch (error) { if(batch===scanBatch&&epoch===cameraEpoch)outline(hit,video,image,/другой модели/.test(error.message)?'other':'rejected',key); report.scan.rejected = (report.scan.rejected || 0) + 1;
            if (/другой модели/.test(error.message)) hint('QR с другого листа · ⟳ справа сверху — новый лист'); }
          // Keep controls responsive; pausing/resetting cancels the remaining decoded-frame work.
          await new Promise(resolve => setTimeout(resolve,0));
        }
      } catch (error) { log('scan-error',{message:error.message}); }
      finally { busy = false; }
    },280);
  }

  function cameraRefused(error) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
    ui.status.dataset.error = 'true';
    ui.status.textContent = denied ? (ios ? 'Нет доступа к камере. Настройки › Приложения › Safari › Камера › «Разрешить», затем «Повторить».'
      : 'Нет доступа к камере. Значок слева от адреса › Разрешения › Камера › «Разрешить», затем «Повторить».')
      : 'Камера не открылась. Закройте другие приложения с камерой и нажмите «Повторить».';
    ui.start.textContent = 'Повторить'; ui.start.hidden = false; log('camera-refused', { name: error?.name || 'Error' });
  }
  async function startCamera() {
    if (opening || ownedStream || verifying) return;
    delete ui.status.dataset.error;
    const ticket = ++cameraEpoch; opening = true; suspended = false;
    ui.start.hidden = true; hint('');

    ui.body.classList.add("live");
    ui.status.textContent = "Подключение камеры…";
    let stream;
    let supported = {};
    try { supported = navigator.mediaDevices?.getSupportedConstraints?.() || {}; } catch (_) { /* Preserve system defaults when capability probing is unavailable. */ }
    try { stream = await navigator.mediaDevices.getUserMedia(ARCamera.request(supported)); }
    catch (error) { if (ticket === cameraEpoch) { pauseCamera(); cameraRefused(error); } return; }
    if (ticket !== cameraEpoch || document.hidden) { stream.getTracks().forEach(t => t.stop()); return; }
    ownedStream = stream; scanStartedAt = performance.now();
    const track = stream.getVideoTracks()[0];
    log('camera-start',{...ARCamera.snapshot(track),supportedControls:{focusMode:!!supported.focusMode,zoom:!!supported.zoom,resizeMode:!!supported.resizeMode}});
    await ARCamera.configure(track,supported,log,()=>ticket===cameraEpoch&&ownedStream===stream);
    if(ticket!==cameraEpoch||ownedStream!==stream||document.hidden) { stream.getTracks().forEach(t=>t.stop()); return; }
    opening = false;
    if(track?.readyState==='ended'){pauseCamera();notice('Камера отключена. Откройте её снова.','error');return;}
    for (const event of ['mute','unmute']) track?.addEventListener(event,()=>{ if(ownedStream===stream){log('camera-'+event,ARCamera.snapshot(track));cameraDiagnostics();} });
    track?.addEventListener('ended',()=>{if(ownedStream===stream){pauseCamera();notice('Камера отключена. Откройте её снова.','error');}});
    if(ARCamera.snapshot(track).settings.facingMode==='user')notice('Браузер выбрал переднюю камеру: задняя камера недоступна.','error');
    preview.srcObject = stream; showCameraMode();
    preview.play().catch(error=>{if(ownedStream===stream){pauseCamera();toast(error.message);}});
    // AR.js retains its original calibration/crop only for Hiro. It never owns QR-preview layout.
    if(mode!=='marker')return;
    attachMarker(stream,ticket);
  }

  function attachMarker(stream,ticket) {

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

    ui.reticle.hidden = false;
    ui.status.textContent = model ? "Наведите камеру на маркер Hiro" : "Наведите камеру на QR листа";
    document.body.appendChild(scene);
    }
    showCameraMode();
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
    if(ui.status.dataset.error!=='true')ui.status.textContent = model?.data.kind === "mesh" ? "Модель готова. Нажмите «Открыть в AR», если устройство поддерживает AR." : collecting ? "Считайте оставшиеся QR этого листа" : model ? "Наведите камеру на маркер Hiro" : "Наведите камеру на QR листа";
    ui.reticle.hidden = model?.data.kind === "mesh" || (mode === "scan" && !!model);
    if (mode === "scan" && !model && !collecting && $("hint").hidden) hint(SEARCH_HINT, 0);
    showCameraMode();
    startScanning(cameraVideo());
  }
  window.addEventListener("arjs-video-loaded", event => videoReady(event.detail?.component || $("arjs-video")));

  ui.start.onclick = startCamera;
  function pauseCamera() {
    if (verifying) { generation++; verifying = false; collecting = false; collector.reset(); clearFeedback(true); log("verification-cancelled"); }
    suspended = true; stopCamera();
    const source = scene?.systems.arjs?._arSession?.arSource;
    if (source?.domElement) { source.ready = false; source.domElement.pause(); source.domElement.srcObject = null; source.domElement.style.display = "none"; }
    scene?.pause(); if (scene) scene.style.display = "none";
    ui.body.classList.remove("live","hiro"); ui.reticle.hidden = true; hint('');
    ui.start.hidden=!!model;ui.status.textContent = ""; delete ui.status.dataset.error;
  }
  // A QR opened from the system camera may reuse this tab and change only the fragment.
  window.addEventListener("hashchange", () => {
    if (!location.hash) return;
    load(location.hash, true).catch(error => toast(error.message));
  });
  window.addEventListener("pagehide", () => { pauseCamera(); objectView.end(); xrView.end().catch(() => {}); });
  window.addEventListener('pageshow',()=>{
    if(model&&mode==='object'&&!objectView.active){try{objectView.start(model.group);}catch(e){mode='ready';ui.body.classList.remove('object');notice(e.message,'error');}}
    refreshAr();
    if(!document.hidden&&autoCamera&&mode==='scan'&&!model&&!verifying&&!ownedStream&&!opening&&ui.status.dataset.error!=='true')startCamera();
  });
  // Reopen explicitly after backgrounding; do not keep the camera running invisibly.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && !xrView.active && (ownedStream || opening)) pauseCamera();
    else if (!document.hidden && autoCamera && mode === 'scan' && !model && !verifying && !ownedStream && !opening) startCamera();
  });

  $("new-sheet").onclick = newSheet;
  ui.look.addEventListener("click", e => { report.acceptance.quickLookRequested = true; log("quicklook-request");
    // Quick Look covers the page; on return the ready screen offers to open it again.
    if (e.isTrusted || navigator.userActivation?.isActive) { arOpened = true; setTimeout(refreshAr, 600); } });
  $("report").onclick = async () => {
    cameraDiagnostics();
    const file = new File([JSON.stringify({...report, offline: window.AROfflineState || null}, null, 2)], "ARViewer-report.json", { type: "application/json" });
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; } }
    catch (error) { if (error.name === "AbortError") return; }
    const url = URL.createObjectURL(file), a = document.createElement("a"); a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  ui.start.disabled = false;
  // P2: the camera opens itself; the button stays only as a retry after a refusal.
  let autoCamera = true;
  const autoStart = () => { if (autoCamera && !model && !document.hidden && mode === 'scan') startCamera(); };
  ui.start.hidden = true;
  if (location.hash.length > 1) {
    ui.status.textContent = "Разбор QR…";
    const initial = generation;
    load(location.hash, false).then(autoStart, error => { if (initial === generation) { ui.status.textContent = ""; notice(error.message, 'error'); autoStart(); } });
  } else {
    ui.status.textContent = "";
    autoStart();
  }
  if (!quickLook) ui.look.hidden = true;
  // For the browser test: the current model and its USDZ without Quick Look.
  window.ARViewer = {version:appVersion,model:()=>model,usdz:()=>files?.usdz,glb:()=>files?.glb};
})();

