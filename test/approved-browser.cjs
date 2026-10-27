/* Issue9 browser regression. Camera/session doubles and unit vectors are NOT physical device/Revit acceptance. */
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),out=process.env.TEST_OUTPUT||'/tmp/ar-viewer-approved-test';fs.mkdirSync(out,{recursive:true});
const fixtures=JSON.parse(fs.readFileSync(root+'/qr-sheet/test/exporto-vectors.json')),meshopt=JSON.parse(fs.readFileSync(root+'/qr-sheet/test/meshopt-vectors.json'));
const zlib=require('zlib'),legacyData=require('../ar-data.js');
const cube='AR1;cube;2000;2000;2000;scale=50;c=2F6F73;s=AR-T.03';
const server=http.createServer((req,res)=>{let f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.svg':'image/svg+xml'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const results={},errors=[],net=[];
 try{
 const c=await browser.newContext({viewport:{width:393,height:852},permissions:['camera']}),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>net.push(r.url()));
 await p.addInitScript(()=>{
  window.fake={streams:[],sessions:[],renderers:[],mode:'deny',shares:[],queue:[],requestModes:[]};
  const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async opt=>{if(fake.sessions.some(s=>!s.ended))throw Error('Concurrent XR and QR cameras');const stream=await get(opt);fake.streams.push(stream);return stream;};
  Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});Object.defineProperty(navigator,'share',{value:async data=>{if(fake.shareCancel)throw new DOMException('cancel','AbortError');fake.shares.push({name:data.files[0].name,type:data.files[0].type,bytes:Array.from(new Uint8Array(await data.files[0].arrayBuffer())),gesture:navigator.userActivation.isActive});},configurable:true});
  const xr=new EventTarget();xr.isSessionSupported=async()=>true;xr.requestSession=(kind,options)=>{
   fake.requestModes.push(kind);fake.released=fake.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'));
   if(fake.mode==='deny')return Promise.reject(new DOMException('gesture required','NotAllowedError'));
   if(fake.mode==='defer')return new Promise((resolve,reject)=>fake.pending={resolve,reject});
   const scenario=fake.mode,s=new EventTarget();s.spaces={};s.domOverlayState={type:'screen'};s.ended=false;s.cancelled=0;
   s.requestReferenceSpace=async type=>{const r=new EventTarget();s.spaces[type]=r;if(scenario==='defer-local'&&type==='local')await new Promise(r=>s.resolveLocal=r);return r;};
   s.requestHitTestSource=async()=>{const hit={cancel(){s.cancelled++;if(s.cancelThrows)throw Error('inactive');}};if(scenario==='defer-hit')await new Promise(r=>s.resolveHit=r);return hit;};
   s.end=async()=>{s.ended=true;s.dispatchEvent(new Event('end'));if(s.lateEnd)await new Promise(r=>s.finishEnd=r);};fake.sessions.push(s);return Promise.resolve(s);
  };Object.defineProperty(navigator,'xr',{value:xr,configurable:true});
 });
 await p.goto(base+'/index.html?diagnostics=1');await p.waitForFunction(()=>window.ARViewer&&window.AROfflineState);
 await p.evaluate(()=>{
  const T=AFRAME.THREE,Renderer=T.WebGLRenderer;T.WebGLRenderer=function(...args){const r=new Renderer(...args);r.xr.setSession=async()=>{};r.setAnimationLoop=fn=>r.frame=fn;const draw=r.render.bind(r),dispose=r.dispose.bind(r);r.render=(world,camera)=>{r.world=world;r.camera=camera;draw(world,camera);};r.dispose=()=>{r.disposed=true;dispose();};fake.renderers.push(r);return r;};
  window.frame=(matrix,tracked=true)=>({getViewerPose:()=>tracked?{}:null,getHitTestResults:()=>matrix?[{getPose:()=>({transform:{matrix}})}]:[]});window.pose=x=>new T.Matrix4().makeTranslation(x,0,-1).toArray();
  window.originalQR=jsQR;window.jsQR=()=>{const q=fake.queue.shift();return q?{binaryData:q,data:'',location:{topLeftCorner:{x:30,y:30},topRightCorner:{x:250,y:30},bottomRightCorner:{x:250,y:250},bottomLeftCorner:{x:30,y:250}}}:null;};
 });
 assert.equal(await p.locator('#stop,#open-file,#scene-file,#sound').count(),0);assert.equal(await p.locator('input[type=file]').count(),0);
 assert.equal(await p.evaluate(()=>fake.streams.length),0);const resetBox=await p.locator('#new-sheet').boundingBox();assert.ok(resetBox.x>300&&resetBox.y<45&&resetBox.width>=44);
 assert.match(await p.locator('#app-version').innerText(),/^v0.3.0-rc.2/);results.compact_ui_no_removed_controls=true;
 await p.locator('#start').click();await p.waitForFunction(()=>fake.streams.length===1&&document.querySelector('#camera-preview')?.videoWidth>0);
 const v=fixtures.find(x=>x.packets.length===6);await p.evaluate(packet=>fake.queue.push(packet),v.packets[2]);await p.waitForFunction(()=>document.querySelectorAll('.part')[2]?.dataset.received==='true');
 assert.deepEqual(await p.locator('.part').allTextContents(),['1','2','3','4','5','6']);assert.ok(!(await p.locator('body').innerText()).includes('Приняты:'));assert.ok(!(await p.locator('body').innerText()).includes('✓'));
 await p.evaluate(packet=>fake.queue.push(packet),v.packets[2]);await p.waitForTimeout(600);assert.equal(await p.locator('.part[data-received=true]').count(),1);
 const before=await p.evaluate(()=>fake.streams.length);await p.locator('#new-sheet').click();assert.equal(await p.locator('.part').count(),0);assert.equal(await p.evaluate(()=>fake.streams.length),before);
 await p.evaluate(parts=>fake.queue.push(...parts),v.packets.slice().reverse());await p.waitForFunction(()=>ARViewer.glb()&&document.querySelector('#webxr-open').hidden===false);
 assert.equal(await p.locator('#object-canvas').count(),0);assert.equal(await p.evaluate(()=>fake.released),true);assert.equal(await p.evaluate(()=>fake.requestModes.length),1);assert.ok(await p.locator('#webxr-open').isVisible());results.numbers_reset_same_sheet_auto_ar_fallback_no_preview=true;
 // Real files, not URL wrappers; shared only by a gesture.
 for(const ext of ['usdz','glb']){await p.locator('#share').click();await p.locator('#share-'+ext).click();}
 await p.waitForFunction(()=>fake.shares.length===2);const shared=await p.evaluate(()=>fake.shares);assert.equal(shared.length,2);assert.equal(shared[0].gesture,true);assert.deepEqual(shared.map(x=>x.name),['Exporto-AR.usdz','Exporto-AR.glb']);
 assert.equal(Buffer.from(shared[0].bytes).readUInt32LE(0),0x04034b50);assert.equal(Buffer.from(shared[1].bytes).readUInt32LE(0),0x46546c67);
 fs.writeFileSync(out+'/restored.usdz',Buffer.from(shared[0].bytes));fs.writeFileSync(out+'/restored.glb',Buffer.from(shared[1].bytes));
 await p.evaluate(()=>fake.shareCancel=true);await p.locator('#share').click();await p.locator('#share-glb').click();assert.equal(await p.evaluate(()=>fake.shares.length),2);await p.evaluate(()=>fake.shareCancel=false);results.standalone_usdz_glb_system_share=true;
 // Existing Android mechanism plus AR↔3D mode switch.
 await p.evaluate(()=>fake.mode='ok');await p.locator('#webxr-open').click();await p.waitForFunction(()=>fake.renderers.at(-1)?.frame);
 await p.evaluate(()=>{fake.renderers.at(-1).frame(1,frame(pose(1)));fake.sessions.at(-1).dispatchEvent(new Event('select'));fake.renderers.at(-1).frame(2,frame(pose(7)));});
 assert.equal(await p.evaluate(()=>fake.renderers.at(-1).world.children.find(o=>o.isGroup).matrix.elements[12]),1);
 const events=await p.evaluate(()=>{const a=new Event('beforexrselect',{cancelable:true,bubbles:true}),b=new Event('beforexrselect',{cancelable:true,bubbles:true});document.querySelector('#ui').dispatchEvent(a);document.querySelector('#mode-3d').dispatchEvent(b);return[a.defaultPrevented,b.defaultPrevented]});assert.deepEqual(events,[false,true]);
 await p.evaluate(()=>{fake.renderers.at(-1).frame(3,frame(null,false));});assert.match(await p.locator('#status').innerText(),/потеряно/);
 await p.evaluate(()=>fake.sessions.at(-1).spaces.local.dispatchEvent(new Event('reset')));await p.evaluate(()=>fake.renderers.at(-1).frame(4,frame(null)));assert.equal(await p.evaluate(()=>fake.renderers.at(-1).world.children.find(o=>o.isGroup).visible),false);
 await p.locator('#mode-3d').click();await p.waitForFunction(()=>document.querySelector('#object-canvas'));assert.equal(await p.locator('#webxr-canvas').count(),0);assert.equal(await p.evaluate(()=>fake.sessions.every(s=>s.ended)),true);
 const fit=await p.evaluate(()=>{const r=fake.renderers.at(-1);r.frame();r.camera.updateMatrixWorld();const b=new AFRAME.THREE.Box3().setFromObject(r.world.children.find(o=>o.isGroup)),v=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const p=new AFRAME.THREE.Vector3(x,y,z).project(r.camera);v.push(Math.abs(p.x)<1&&Math.abs(p.y)<1)}return v.every(Boolean)});assert.equal(fit,true);
 await p.screenshot({path:out+'/object-portrait.png'});
 // BFCache return must not leave a blank canvas with 3D still selected.
 await p.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});assert.equal(await p.locator('#object-canvas').count(),1);
 await p.locator('#mode-ar').click();await p.waitForFunction(()=>document.querySelector('#webxr-canvas'));assert.equal(await p.locator('#object-canvas').count(),0);results.android_ar_3d_pose_reset_fit_bfcache=true;
 await p.locator('#new-sheet').click();await p.waitForFunction(()=>fake.streams.length===2);assert.equal(await p.locator('#webxr-canvas,#object-canvas').count(),0);assert.equal(await p.evaluate(()=>ARViewer.model()),null);assert.equal(await p.locator('.part').count(),0);results.new_sheet_exits_xr_and_reopens_one_camera=true;
 // New QR codec restores from cached resources, same printed payload, without HTML importer.
 await c.setOffline(true);await p.evaluate(parts=>fake.queue.push(...parts),meshopt.find(x=>x.name==='optimized-40-True').packets);await p.waitForFunction(()=>ARViewer.model()?.data.codec==='meshopt-0.23+gzip');
 assert.ok(await p.evaluate(()=>ARViewer.glb().size>0&&ARViewer.usdz().size>0));results.qrl2_wasm_offline_camera_restore=true;
 await c.setOffline(false);
 // A late restore may never commit after the one-tap scan reset.
 await p.evaluate(()=>{fake.mode='deny';window.originalRestore=ExportoQr.restore;ExportoQr.restore=async(...args)=>{const value=await originalRestore(...args);await new Promise(r=>window.finishRestore=r);return value;};});
 await p.locator('#new-sheet').click();await p.evaluate(parts=>fake.queue.push(...parts),fixtures[0].packets);await p.waitForFunction(()=>window.finishRestore);
 await p.locator('#new-sheet').click();await p.evaluate(()=>{finishRestore();ExportoQr.restore=originalRestore;});await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>ARViewer.model()),null);assert.equal(await p.locator('.part').count(),0);
 const broken=fixtures[0].packets.map(p=>p.slice());broken.at(-1)[48]^=1;await p.evaluate(parts=>fake.queue.push(...parts),broken);await p.waitForFunction(()=>document.querySelector('#status').dataset.error==='true');assert.equal(await p.evaluate(()=>ARViewer.model()),null);
 await p.locator('#new-sheet').click();await p.evaluate(parts=>fake.queue.push(...parts),fixtures[0].packets);await p.waitForFunction(()=>ARViewer.glb());assert.notEqual(await p.locator('#status').getAttribute('data-error'),'true');results.cancel_restore_corruption_and_retry=true;
 // Legacy shapes are still accepted, preserve opacity, and Hiro cannot overlap XR camera ownership.
 await p.locator('#new-sheet').click();await p.evaluate(payload=>location.hash=encodeURIComponent(payload),cube);await p.waitForFunction(()=>ARViewer.model()?.data.kind==='cube'&&ARViewer.glb());
 const alpha=await p.evaluate(async()=>{const bytes=new Uint8Array(await ARViewer.usdz().arrayBuffer());return new TextDecoder().decode(bytes).includes('inputs:opacity = 0.85')});assert.equal(alpha,true);
 await p.evaluate(()=>fake.mode='ok');if(!await p.locator('#webxr-canvas').count())await p.locator('#webxr-open').click();await p.waitForFunction(()=>document.querySelector('#webxr-canvas'));
 await p.locator('#diagnostics').evaluate(e=>e.open=true);await p.locator('#marker-view').click();await p.waitForFunction(()=>fake.sessions.every(s=>s.ended)&&document.querySelector('#arjs-video')?.srcObject?.active);assert.equal(await p.evaluate(()=>fake.sessions.every(s=>s.ended)),true);results.legacy_opacity_hiro_single_camera=true;
 // AR4 walls with an opening and AR5 multipart QR still reconstruct through the same legacy builders.
 await p.evaluate(()=>fake.mode='deny');
 const raw=Buffer.alloc(51);raw[0]=4;raw.writeUInt16LE(1,1);[0,0,3000,0,0,2700,200].forEach((x,i)=>raw.writeInt32LE(x,3+i*4));raw.set([185,185,185,1],31);[1100,1800,900,1900].forEach((x,i)=>raw.writeInt32LE(x,35+i*4));
 const payload='AR4;walls;scale=100;c=7A5C9E;s=AR-T.07;m=1;data='+zlib.gzipSync(raw).toString('base64url');
 await p.evaluate(q=>location.hash=encodeURIComponent(q),payload);await p.waitForFunction(()=>ARViewer.model()?.data.kind==='walls'&&ARViewer.glb());
 const crc=(legacyData.crc32(payload)&65535).toString(16).padStart(4,'0'),step=Math.ceil(payload.length/3),legacyParts=Array.from({length:3},(_,i)=>`AR5;id=${crc};part=${i+1};of=3;data=${payload.slice(i*step,(i+1)*step)}`);
 for(const i of [2,0,1]){await p.evaluate(q=>location.hash=encodeURIComponent(q),legacyParts[i]);await p.waitForTimeout(30);}
 await p.waitForFunction(()=>ARViewer.model()?.data.kind==='walls'&&ARViewer.model().data.anchored&&ARViewer.glb());assert.deepEqual(await p.locator('.part').allTextContents(),['1','2','3']);assert.equal(await p.locator('.part[data-received=true]').count(),3);await p.locator('#mode-3d').click();await p.waitForFunction(()=>document.querySelector('#object-canvas'));await p.evaluate(()=>fake.renderers.at(-1).frame());await p.locator('#diagnostics').evaluate(e=>e.open=false);await p.screenshot({path:out+'/legacy-walls-3d.png'});results.legacy_ar4_ar5_openings_and_parts=true;
 // Software cancellation races of the reused WebXR module remain covered.
 const races=await p.evaluate(async()=>{
  const g=ARViewer.model().group,answers=[];for(const scenario of ['defer','defer-local','defer-hit']){
   const adapter=ARWebXR.create({THREE:AFRAME.THREE,overlay:document.querySelector('#ui')});fake.mode=scenario;const a=adapter.start(g);await new Promise(r=>setTimeout(r,0));const old=fake.sessions.at(-1),release=scenario==='defer-local'?old.resolveLocal:old.resolveHit;
   await adapter.end();fake.mode='ok';await adapter.start(g);const fresh=fake.renderers.at(-1);
   if(scenario==='defer')fake.pending.reject(Error('late'));else release();await a;answers.push(adapter.active&&!fresh.disposed);await adapter.end();
  }return answers;
 });assert.deepEqual(races,[true,true,true]);results.xr_cancellation_races=true;
 await p.locator('#diagnostics').evaluate(e=>e.open=true);await p.locator('#report').click();await p.waitForFunction(()=>fake.shares.some(x=>x.name==='ARViewer-report.json'));const reportBytes=await p.evaluate(()=>fake.shares.find(x=>x.name==='ARViewer-report.json').bytes);fs.writeFileSync(out+'/report.json',Buffer.from(reportBytes));const report=JSON.parse(Buffer.from(reportBytes));assert.equal(report.acceptance.actualAR,'owner verification required');assert.equal(report.app.version,'0.3.0-rc.2');assert.equal(JSON.stringify(report).includes('html-file'),false);results.honest_diagnostics_no_file_import=true;
 // File-size refusal is atomic on legacy as well as generic scenes.
 await p.evaluate(()=>{window.originalUsdz=ARUsdz.build;ARUsdz.build=()=>new Uint8Array(32*1024*1024+1);location.hash=encodeURIComponent('AR1;cube;3000;2000;2000;scale=50');});
 await p.waitForFunction(()=>document.querySelector('#status').dataset.error==='true'&&document.querySelector('#status').textContent.includes('32 МиБ'));assert.equal(await p.evaluate(()=>ARViewer.model()),null);assert.equal(await p.locator('#share-wrap').isVisible(),false);await p.evaluate(()=>ARUsdz.build=originalUsdz);results.oversized_usdz_is_atomic=true;
 // Apple uses one real rel=ar link, auto-attempt then one fallback CTA; no custom 3D first.
 const apple=await browser.newContext({viewport:{width:393,height:852},permissions:['camera']}),a=await apple.newPage();a.on('pageerror',e=>errors.push(e.message));
 await a.addInitScript(()=>{window.arClicks=[];const supports=DOMTokenList.prototype.supports;DOMTokenList.prototype.supports=function(t){return t==='ar'||supports.call(this,t)};document.addEventListener('click',e=>{if(e.target.closest('#look')){arClicks.push({trusted:e.isTrusted});e.preventDefault()}});});
 await a.goto(base);await a.waitForFunction(()=>window.ARViewer);await a.evaluate(()=>{window.q=[];window.jsQR=()=>{const bytes=q.shift();return bytes?{binaryData:bytes,data:'',location:{topLeftCorner:{x:10,y:10},topRightCorner:{x:220,y:10},bottomRightCorner:{x:220,y:220},bottomLeftCorner:{x:10,y:220}}}:null}});
 await a.locator('#start').click();await a.evaluate(parts=>q.push(...parts),fixtures[0].packets);await a.waitForFunction(()=>ARViewer.usdz()&&arClicks.length===1);assert.equal(await a.locator('#object-canvas').count(),0);assert.equal(await a.locator('#look').isVisible(),true);assert.equal(await a.locator('#mode-switch').isVisible(),false);assert.deepEqual(await a.locator('#look').evaluate(e=>[e.children.length,e.firstElementChild.tagName]),[1,'IMG']);await a.locator('#look').click();assert.deepEqual(await a.evaluate(()=>arClicks.map(x=>x.trusted)),[false,true]);await a.screenshot({path:out+'/apple-ready.png'});results.apple_auto_attempt_one_cta_native_switch_contract=true;
 assert.deepEqual(errors,[]);assert.deepEqual(net.filter(u=>!u.startsWith(base)&&!u.startsWith('blob:')),[]);results.no_errors_or_model_network=true;
 fs.writeFileSync(out+'/results.json',JSON.stringify({results,physicalDevices:'NOT TESTED',realRevit:'NOT TESTED'},null,2));console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exit(1)});
