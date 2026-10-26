/* Real vendored AR.js + fake-camera software regression. Never an iPhone/Revit/Quick Look acceptance. */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.TEST_OUTPUT||'/tmp/ar-viewer-unified-test');fs.mkdirSync(out,{recursive:true});
const vectors=JSON.parse(fs.readFileSync(path.join(root,'qr-sheet/test/exporto-vectors.json')));
const sheet=v=>'<script>window.UNTRUSTED_EXECUTED=true</script>'+v.packets.map(p=>`<article data-packet="${Buffer.from(p).toString('base64')}"></article>`).join('');
const cube='AR1;cube;2000;2000;2000;scale=50;c=2F6F73;s=AR-T.03';
function wall(){const b=Buffer.alloc(51);b[0]=4;b.writeUInt16LE(1,1);[0,0,3000,0,0,2700,200].forEach((x,i)=>b.writeInt32LE(x,3+i*4));b.set([185,185,185,1],31);[1100,1800,900,1900].forEach((x,i)=>b.writeInt32LE(x,35+i*4));return zlib.gzipSync(b).toString('base64url');}
const walls='AR4;walls;scale=50;c=7A5C9E;s=AR-T.05;data='+wall();
const anchored='AR4;walls;scale=100;c=B08A2E;s=AR-T.07;m=1;data='+wall();
const data=require('../ar-data.js');function split(payload){const id=(data.crc32(payload)&65535).toString(16).padStart(4,'0'),n=Math.ceil(payload.length/3);return Array.from({length:3},(_,i)=>`AR5;id=${id};part=${i+1};of=3;data=${payload.slice(i*n,(i+1)*n)}`);}
let legacyChild=false;
const oldChildWorker=`const P='exporto-qr-sheet-'+encodeURIComponent(self.registration.scope)+'-';const C=P+'v1';self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(C);await c.addAll(['./','./index.html']);await self.skipWaiting();})()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(caches.open(C).then(c=>c.match(new URL('./index.html',self.registration.scope).href)));});`;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(['/sheet-seven.png','/sheet-seven-tilted.png','/sheet-approach-tilted.png'].includes(url.pathname)){res.setHeader('Content-Type','image/png');res.end(fs.readFileSync(path.join(out,url.pathname.slice(1))));return;}
 if(url.pathname==='/__setup.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Migration harness</title>');return;}
 if(url.pathname.startsWith('/compare/qr-sheet-1/')){
  if(legacyChild){res.setHeader('Content-Type',url.pathname.endsWith('sw.js')?'application/javascript':'text/html');res.end(url.pathname.endsWith('sw.js')?oldChildWorker:'<!doctype html><title>Old isolated viewer</title><p>Old cached interface</p>');return;}
  const file=url.pathname.endsWith('sw.js')?path.join(root,'qr-sheet/sw.js'):path.join(root,'qr-sheet/index.html');
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(file));return;
 }
 let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(file.startsWith(root)&&fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end('missing');return;}
 res.setHeader('Content-Type',{'.js':'application/javascript','.html':'text/html','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
const results={},errors=[],requests=[];
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,entry=base+'/index.html?diagnostics=1';
 const launch=extra=>chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-angle=swiftshader','--enable-unsafe-swiftshader',...(extra||[])]});
 const browser=await launch();
 try{
  if (!process.env.UX_ONLY) {
  const ctx=await browser.newContext({viewport:{width:393,height:852},permissions:['camera']}),page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.addInitScript(()=>{window.calls=0;window.streams=[];const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{window.calls++;const s=await get(...args);window.streams.push(s);return s;};const supports=DOMTokenList.prototype.supports;DOMTokenList.prototype.supports=function(t){return t==='ar'||supports.call(this,t);};});
  await page.goto(entry);await page.waitForFunction(()=>document.querySelector('#offline').textContent.includes('Ресурсы сохранены'));
  await page.locator('#diagnostics > summary').click();
  assert.equal(await page.evaluate(()=>calls),0);assert.equal(await page.locator('#chip').count(),1);assert.equal(await page.locator('#camera').count(),0);results.original_ui_no_eager_camera=true;
  const setHash=async payload=>{await page.evaluate(p=>location.hash=encodeURIComponent(p),payload);};
  await setHash(cube);await page.waitForFunction(()=>ARViewer.model()?.data.sheet==='AR-T.03');
  assert.deepEqual(await page.evaluate(()=>{const m=ARViewer.model();return[m.group.children[0].geometry.parameters.width,m.holder.scale.x];}),[2,.5]);
  await setHash(walls);await page.waitForFunction(()=>ARViewer.model()?.data.sheet==='AR-T.05');
  const parts=split(anchored);
  for(let i=0;i<parts.length;i++){await setHash(parts[i]);if(i<2){await page.waitForFunction(n=>document.querySelector('#title').textContent===`Части ${n} из 3`,i+1);assert.equal(await page.evaluate(()=>ARViewer.model()),null);}}
  await page.waitForFunction(()=>ARViewer.model()?.data.sheet==='AR-T.07');assert.equal(await page.evaluate(()=>ARViewer.model().holder.scale.x),.25);
  // Accepted AR5 parts must never tear down the model on reread.
  await setHash(parts[0]);await setHash(parts[1]);await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>ARViewer.model()?.data.sheet),'AR-T.07');
  results.legacy_ar1_ar4_ar5_and_part_reread=true;
  await page.locator('#scene-file').setInputFiles({name:'scene.html',mimeType:'text/html',buffer:Buffer.from(sheet(vectors[0]))});
  await page.waitForFunction(()=>ARViewer.model()?.data.kind==='mesh');
  assert.equal(await page.evaluate(()=>window.UNTRUSTED_EXECUTED),undefined);assert.equal(await page.evaluate(()=>ARViewer.model().holder),null);
  assert.equal(await page.locator('#look').isVisible(),true);assert.deepEqual(await page.locator('#look').evaluate(a=>[a.children.length,a.firstElementChild.tagName]),[1,'IMG']);assert.match(await page.locator('#sheet').innerText(),/SHA-256 OK/);
  const blob=await page.locator('#look').getAttribute('href');
  assert.equal(await page.evaluate(async u=>new DataView(await(await fetch(u)).arrayBuffer()).getUint32(0,true),blob),0x04034b50);
  await setHash(cube);await page.waitForFunction(()=>ARViewer.model()?.data.kind==='cube');
  assert.equal(await page.evaluate(async u=>{try{await fetch(u);return false;}catch{return true;}},blob),true);
  results.legacy_mesh_legacy_single_model_and_blob_cleanup=true;
  await page.locator('#scene-file').setInputFiles({name:'scene-again.html',mimeType:'text/html',buffer:Buffer.from(sheet(vectors[0]))});await page.waitForFunction(()=>ARViewer.model()?.data.kind==='mesh');
  await page.locator('#new-sheet').click();assert.equal(await page.evaluate(()=>ARViewer.model()),null);
  // Explicit file selection may retry the previous scene; stale background reads cannot commit.
  await page.evaluate(()=>{window.oldRead=File.prototype.text;window.release=null;File.prototype.text=function(){const f=this;return new Promise(resolve=>{window.release=()=>oldRead.call(f).then(resolve);});};});
  await page.locator('#scene-file').setInputFiles({name:'slow.html',mimeType:'text/html',buffer:Buffer.from(sheet(vectors[1]))});await page.waitForFunction(()=>window.release!==null);
  assert.equal(await page.locator('#new-sheet').isVisible(),true);assert.equal(await page.locator('#start').isDisabled(),true);
  await page.locator('#new-sheet').click();await page.evaluate(()=>{release();File.prototype.text=oldRead;});await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>ARViewer.model()),null);
  results.cancel_file_read_without_second_ui=true;
  await ctx.setOffline(true);await page.reload();await page.waitForFunction(()=>document.querySelector('#offline').textContent.includes('Ресурсы сохранены'));
  await page.locator('#diagnostics > summary').click();
  await page.locator('#scene-file').setInputFiles({name:'offline-six.html',mimeType:'text/html',buffer:Buffer.from(sheet(vectors[2]))});await page.waitForFunction(()=>ARViewer.model()?.data.kind==='mesh');
  assert.match(await page.locator('#scene-info').innerText(),/1200 треугольников/);results.shared_offline_cache_six_part_restore=true;
  assert.ok(await page.evaluate(()=>document.querySelector('#ui').scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'unified-mobile.png')});
  await page.locator('#look').evaluate(a=>a.addEventListener('click',e=>e.preventDefault()));await page.locator('#look').click();
  const [dl]=await Promise.all([page.waitForEvent('download'),page.locator('#report').click()]);await dl.saveAs(path.join(out,'report.json'));
  const report=JSON.parse(fs.readFileSync(path.join(out,'report.json')));assert.equal(report.acceptance.source,'html-file');assert.equal(report.acceptance.cameraQrRead,false);assert.equal(report.acceptance.quickLookRequested,true);assert.equal(report.acceptance.actualAR,'owner verification required');results.diagnostics_never_claim_ar=true;
  await ctx.close();
  // A cancelled boot AR4 inflate must not overwrite a newer generic scene's UI.
  const delayed=await browser.newContext(),d=await delayed.newPage();d.on('pageerror',e=>errors.push(e.message));
  await d.addInitScript(()=>{let api;Object.defineProperty(window,'ARCubeData',{configurable:true,get:()=>api,set:v=>{api=v;const decode=v.decodeWalls;v.decodeWalls=(...args)=>new Promise(resolve=>{window.releaseLegacy=()=>decode(...args).then(resolve);});}});});
  await d.goto(entry+'#'+encodeURIComponent(walls));await d.waitForFunction(()=>typeof window.releaseLegacy==='function');
  await d.locator('#scene-file').setInputFiles({name:'cancel-legacy.html',mimeType:'text/html',buffer:Buffer.from(sheet(vectors[0]))});await d.waitForFunction(()=>ARViewer.model()?.data.kind==='mesh');
  await d.evaluate(()=>releaseLegacy());await d.waitForTimeout(200);assert.equal(await d.evaluate(()=>ARViewer.model()?.data.kind),'mesh');assert.ok(!(await d.locator('#status').innerText()).includes('Hiro'));results.cancelled_boot_cannot_overwrite_generic_ui=true;await delayed.close();
  // Migrate a real cache-first child registration; do not navigate or delete any other app's cache.
  legacyChild=true;const migration=await browser.newContext(),m=await migration.newPage();m.on('pageerror',e=>errors.push(e.message));
  await m.goto(base+'/__setup.html');await m.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;await(await caches.open('unrelated-cache')).put('/sentinel',new Response('keep'));const r=await navigator.serviceWorker.register('/compare/qr-sheet-1/qr-sheet/sw.js',{scope:'/compare/qr-sheet-1/qr-sheet/'});await new Promise(resolve=>{const t=setInterval(()=>{if(r.active?.state==='activated'){clearInterval(t);resolve();}},20);});});
  await m.goto(base+'/compare/qr-sheet-1/qr-sheet/index.html');await m.waitForFunction(()=>document.title==='Old isolated viewer');legacyChild=false;
  await m.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration('/compare/qr-sheet-1/qr-sheet/');await r.update();});
  await m.waitForURL('**/index.html?diagnostics=1');await m.waitForFunction(()=>window.ARViewer);
  assert.equal(await m.locator('#ui').count(),1);assert.equal(await m.evaluate(()=>ARViewer.model()),null);
  const keys=await m.evaluate(()=>caches.keys());assert.ok(keys.includes('unrelated-cache'));assert.ok(keys.some(k=>k.startsWith('ar-style-cube-')));assert.ok(!keys.some(k=>k.startsWith('exporto-qr-sheet-')));
  results.old_child_worker_migrates_to_root_and_preserves_other_caches=true;await migration.close();
  // One AR.js video and controller, both scanner formats; no private ingest hook.
  const cameraBrowser=await launch([`--use-file-for-fake-video-capture=${out}/transport-100.y4m`]);
  try{
   const c=await cameraBrowser.newContext({permissions:['camera']}),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
   await p.addInitScript(()=>{window.calls=0;window.streams=[];const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...a)=>{calls++;const s=await get(...a);streams.push(s);return s;};});
   await p.goto(entry);await p.locator('#diagnostics > summary').click();await p.locator('#start').click();
   try { await p.waitForFunction(()=>ARViewer.model()?.data.kind==='mesh',null,{timeout:35000}); } catch(error) {
    console.log('camera failure',await p.evaluate(()=>({title:document.querySelector('#title').textContent,status:document.querySelector('#status').textContent,event:document.querySelector('#scan-event').textContent})));
    const [d]=await Promise.all([p.waitForEvent('download'),p.locator('#report').click()]);await d.saveAs(path.join(out,'camera-failure-report.json'));console.log(fs.readFileSync(path.join(out,'camera-failure-report.json'),'utf8'));await p.screenshot({path:path.join(out,'camera-failure.png')});throw error;
   }
   assert.match(await p.locator('#sheet').innerText(),/6\/6 · SHA-256 OK/);assert.equal(await p.evaluate(()=>calls),1);assert.equal(await p.locator('a-scene').count(),1);assert.equal(await p.locator('video').count(),1);
   await p.waitForFunction(()=>document.querySelector('a-scene').systems.arjs._arSession.arContext.arController!=null);
   await p.evaluate(()=>{window.controller=document.querySelector('a-scene').systems.arjs._arSession.arContext.arController;window.sameDocument=true;});
   await p.locator('#stop').click();assert.equal(await p.evaluate(()=>streams.filter(s=>s.getTracks().some(t=>t.readyState==='live')).length),0);
   await p.locator('#start').click();await p.waitForFunction(()=>calls===2&&document.querySelector('a-scene').systems.arjs._arSession.arSource.ready);
   assert.equal(await p.evaluate(()=>controller===document.querySelector('a-scene').systems.arjs._arSession.arContext.arController),true);assert.equal(await p.evaluate(()=>sameDocument),true);
   assert.equal(await p.locator('a-scene').count(),1);assert.equal(await p.locator('video').count(),1);assert.equal(await p.evaluate(()=>streams.filter(s=>s.getTracks().some(t=>t.readyState==='live')).length),1);
   results.real_arjs_video_binary_six_qr_one_stream_and_resume=true;
   const [dl]=await Promise.all([p.waitForEvent('download'),p.locator('#report').click()]);await dl.saveAs(path.join(out,'camera-report.json'));
   const r=JSON.parse(fs.readFileSync(path.join(out,'camera-report.json')));assert.equal(r.acceptance.cameraQrRead,true);assert.equal(r.acceptance.integrityVerified,true);assert.equal(r.acceptance.usdzCreated,true);
   await p.locator('#stop').click();await p.locator('#scene-file').setInputFiles({name:'same-scene-after-camera.html',mimeType:'text/html',buffer:Buffer.from(sheet(vectors[0]))});
   // An explicit new file from another identity requires reset, rather than mixing parts.
   await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('другой модели'));
   await p.locator('#new-sheet').click();await p.locator('#scene-file').setInputFiles({name:'new-file.html',mimeType:'text/html',buffer:Buffer.from(sheet(vectors[0]))});await p.waitForFunction(()=>ARViewer.model()?.data.kind==='mesh');
   const [rd]=await Promise.all([p.waitForEvent('download'),p.locator('#report').click()]);await rd.saveAs(path.join(out,'file-after-camera-report.json'));
   assert.equal(JSON.parse(fs.readFileSync(path.join(out,'file-after-camera-report.json'))).acceptance.cameraQrRead,false);results.per_scene_source_flags_reset=true;
   await c.close();
  }finally{await cameraBrowser.close();}
  const mixedBrowser=await launch([`--use-file-for-fake-video-capture=${out}/mixed.y4m`]);
  try{
   const ctx=await mixedBrowser.newContext({permissions:['camera']}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
   await p.goto(entry);await p.locator('#start').click();await p.waitForFunction(()=>ARViewer.model()?.data.kind==='cube',null,{timeout:20000});
   await p.waitForFunction(()=>ARViewer.model()?.data.kind==='mesh',null,{timeout:20000});
   await p.locator('#new-sheet').click();
   await p.waitForFunction(()=>ARViewer.model()?.data.kind==='cube',null,{timeout:20000});
   assert.equal(await p.locator('a-scene').count(),1);assert.equal(await p.locator('video').count(),1);results.same_camera_legacy_binary_legacy_reread=true;await ctx.close();
  }finally{await mixedBrowser.close();}
  // A real Hiro image in the same AR.js camera must display a single legacy model after cancelled AR5.
  const hiroBrowser=await launch([`--use-file-for-fake-video-capture=${out}/hiro.y4m`]);
  try{
   const ctx=await hiroBrowser.newContext({permissions:['camera']}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
   await p.goto(entry);await p.evaluate(payload=>location.hash=encodeURIComponent(payload),split(anchored)[0]);
   await p.waitForFunction(()=>document.querySelector('#title').textContent==='Части 1 из 3');
   await p.evaluate(payload=>location.hash=encodeURIComponent(payload),cube);await p.waitForFunction(()=>ARViewer.model()?.data.kind==='cube');
   await p.locator('#start').click();await p.waitForFunction(()=>document.querySelector('[ar-follow]')?.object3D.visible===true,null,{timeout:25000});
   assert.equal(await p.evaluate(()=>ARViewer.model().holder.scale.x),.5);results.partial_ar5_to_single_legacy_visible_on_hiro=true;await ctx.close();
  }finally{await hiroBrowser.close();}
  const meshBrowser=await launch([`--use-file-for-fake-video-capture=${out}/meshopt.y4m`]);
  try{
   const ctx=await meshBrowser.newContext({permissions:['camera']}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
   await p.goto(entry);await p.locator('#start').click();await p.waitForFunction(()=>ARViewer.model()?.data.codec==='meshopt-0.23+gzip',null,{timeout:25000});
   assert.equal(await p.locator('a-scene').count(),1);assert.equal(await p.locator('video').count(),1);
   await p.locator('#stop').click();await ctx.setOffline(true);await p.reload();await p.waitForFunction(()=>document.querySelector('#offline').textContent.includes('Ресурсы сохранены'));
   const vectors=JSON.parse(fs.readFileSync(path.join(root,'qr-sheet/test/meshopt-vectors.json'))),fixture=vectors.find(v=>v.name==='optimized-40-True');
   await p.locator('#scene-file').setInputFiles({name:'new-codec-offline.html',mimeType:'text/html',buffer:Buffer.from(sheet(fixture))});
   await p.waitForFunction(()=>ARViewer.model()?.data.codec==='meshopt-0.23+gzip');
   results.qrl2_meshopt_same_camera_and_cached_decoder_html_restore=true;await ctx.close();
  }finally{await meshBrowser.close();}
  }
  // All seven QR on ONE stationary sheet, with a duplicate before the remaining parts.
  const sevenBrowser=await launch([`--use-file-for-fake-video-capture=${out}/sheet-seven.y4m`]);
  try{
   const ctx=await sevenBrowser.newContext({viewport:{width:393,height:852},permissions:['camera']}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
   await p.addInitScript(()=>{const supports=DOMTokenList.prototype.supports;DOMTokenList.prototype.supports=function(t){return t==='ar'||supports.call(this,t);};document.addEventListener('DOMContentLoaded',()=>{const original=ARScanFeedback.scan;let frozen=false;ARScanFeedback.scan=function*(...args){for(const hit of original(...args)){if(!frozen){try{const packet=ExportoQr.packet(Uint8Array.from(hit.qr.binaryData));window.firstReadIndex=packet.index+1;document.querySelector('video').pause();frozen=true;}catch(_){}}yield hit;}};});});
   await p.goto(base+'/index.html');assert.equal(await p.locator('#open-file').isVisible(),true);assert.equal(await p.locator('#diagnostics').isVisible(),false);
   await p.locator('#start').click();await p.waitForFunction(()=>window.firstReadIndex && document.querySelectorAll('.part')[firstReadIndex-1]?.dataset.received==='true',null,{timeout:20000});
   assert.equal(await p.locator('.part').count(),6);const missing=await p.locator('.part[data-received="false"]').allTextContents();assert.ok(missing.length>0);assert.ok((await p.locator('#status').innerText()).includes(missing.join(', ')));
   await p.evaluate(()=>document.querySelector('#arjs-video').pause());
   try { await p.waitForFunction(()=>document.querySelector('#scan-event').textContent.includes('уже считан'),null,{timeout:10000}); } catch(error){console.log(await p.evaluate(()=>({status:document.querySelector('#status').textContent,event:document.querySelector('#scan-event').textContent,video:document.querySelector('video')?.paused,model:ARViewer.model()?.data.kind})));const [d]=await Promise.all([p.waitForEvent('download'),p.evaluate(()=>document.querySelector('#report').click())]);await d.saveAs(path.join(out,'feedback-failure.json'));console.log(fs.readFileSync(path.join(out,'feedback-failure.json'),'utf8'));await p.screenshot({path:path.join(out,'feedback-failure.png')});throw error;}
   await p.waitForFunction(()=>document.querySelector('#scan-outline polygon')!==null);await p.screenshot({path:path.join(out,'scan-partial-portrait.png')});await p.evaluate(()=>document.querySelector('#arjs-video').play());
   try { await p.waitForFunction(()=>ARViewer.model()?.data.kind==='mesh',null,{timeout:40000}); } catch(error){console.log(await p.evaluate(()=>({status:document.querySelector('#status').textContent,event:document.querySelector('#scan-event').textContent,video:document.querySelector('video')?.paused})));await p.screenshot({path:path.join(out,'seven-failure.png')});const[d]=await Promise.all([p.waitForEvent('download'),p.evaluate(()=>document.querySelector('#report').click())]);await d.saveAs(path.join(out,'seven-failure.json'));console.log(fs.readFileSync(path.join(out,'seven-failure.json'),'utf8'));throw error;}
   assert.equal(await p.locator('.part[data-received="true"]').count(),6);assert.equal(await p.locator('video').count(),1);assert.equal(await p.locator('a-scene').count(),1);
   assert.ok((await p.locator('#scan-event').innerText()).includes('модель готова'));await p.screenshot({path:path.join(out,'scan-ready-portrait.png')});
   // Actual jsQR on a tilted sheet validates polygon masking without erasing neighbours.
   const optical=await p.evaluate(async()=>{const image=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src='/sheet-approach-tilted.png';});const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return Array.from(ARScanFeedback.scan(ctx.getImageData(0,0,c.width,c.height),jsQR)).filter(h=>h.qr).map(h=>{try{return ExportoQr.packet(Uint8Array.from(h.qr.binaryData)).index+1;}catch(_){return 'launch';}});});
   assert.ok(optical.includes(3),'the same fixed sheet remains readable when the camera approaches a tilted QR');
   await p.locator('#new-sheet').click();assert.equal(await p.locator('#part-progress').isVisible(),false);assert.equal(await p.locator('#scan-outline polygon').count(),0);
   await p.locator('#stop').click();await p.setViewportSize({width:852,height:393});await p.screenshot({path:path.join(out,'scan-landscape.png')});
   results.same_sheet_camera_approach_exact_progress_duplicates_and_tilt=true;await ctx.close();
  }finally{await sevenBrowser.close();}
  assert.deepEqual(errors,[]);assert.deepEqual(requests.filter(u=>!u.startsWith(base)&&!u.startsWith('blob:')),[]);results.no_page_errors_or_external_requests=true;
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().finally(()=>server.close()).catch(e=>{console.error(e);process.exitCode=1;});
