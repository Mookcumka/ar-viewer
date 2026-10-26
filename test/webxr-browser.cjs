/* Software session doubles + real vendored Three.js. NOT physical Android/Revit AR acceptance. */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(process.env.VIEWER_ROOT||path.join(__dirname,'..')),out=process.env.TEST_OUTPUT||'/tmp/ar-viewer-android-test';fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{let f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.svg':'image/svg+xml'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const errors=[];const result={physicalAndroid:'NOT TESTED',realRevit:'NOT TESTED'};
 try{
 const context=await browser.newContext({viewport:{width:393,height:852},permissions:['camera']}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.fake={sessions:[],renderers:[],mode:'ok',streams:[],deferred:null};
  const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const s=await original(c);fake.streams.push(s);return s;};
  const xr=new EventTarget();xr.isSessionSupported=async()=>true;
  xr.requestSession=(mode,options)=>{
   fake.request={mode,options,released:fake.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))};
   if(fake.mode==='deny')return Promise.reject(new DOMException('User denied AR','NotAllowedError'));
   if(fake.mode==='defer'){return new Promise((resolve,reject)=>fake.deferred={resolve,reject});}
   const scenario=fake.mode,s=new EventTarget();s.domOverlayState={type:'screen'};s.cancelled=0;
   s.requestReferenceSpace=async type=>{const r=new EventTarget();r.type=type;(s.spaces??={})[type]=r;if(scenario==='defer-local'&&type==='local')await new Promise(resolve=>s.resolveLocal=resolve);return r;};s.requestHitTestSource=async()=>{const hit={cancel(){s.cancelled++;if(s.cancelThrows)throw Error('inactive hit source');}};if(scenario==='defer-hit')await new Promise(resolve=>s.resolveHit=resolve);return hit;};
   s.end=async()=>{s.dispatchEvent(new Event('end'));if(s.lateEnd)await new Promise(r=>s.finishEnd=r);};
   fake.sessions.push(s);return Promise.resolve(s);
  };Object.defineProperty(navigator,'xr',{value:xr,configurable:true});
 });
 const url='http://127.0.0.1:'+server.address().port+'/';await page.goto(url);await page.waitForFunction(()=>window.ARViewer);
 await page.evaluate(()=>{
  const T=AFRAME.THREE,Original=T.WebGLRenderer;
  T.WebGLRenderer=function(...args){const r=new Original(...args);r.xr.setSession=async()=>{};r.setAnimationLoop=fn=>{r.frame=fn;};const draw=r.render.bind(r),dispose=r.dispose.bind(r);r.render=(s,c)=>{r.world=s;draw(s,c);};r.dispose=()=>{r.disposed=true;dispose();};fake.renderers.push(r);return r;};
  window.frame=(matrix,tracked=true)=>({getViewerPose:()=>tracked?{}:null,getHitTestResults:()=>matrix?[{getPose:()=>({transform:{matrix}})}]:[]});
  window.pose=x=>new T.Matrix4().makeTranslation(x,0,-1).toArray();
 });
 const fixture=JSON.parse(fs.readFileSync(path.join(root,'qr-sheet/test/exporto-vectors.json')))[1];
 const html=fixture.packets.map(p=>'<article data-packet="'+Buffer.from(p).toString('base64')+'"></article>').join('');
 await page.locator('#scene-file').setInputFiles({name:'test-only-vectors.html',mimeType:'text/html',buffer:Buffer.from(html)});await page.waitForFunction(()=>ARViewer.model()?.data.kind==='mesh');
 assert.equal(await page.locator('#webxr-open').isVisible(),true);assert.equal(await page.locator('#look').isVisible(),false);
 assert.match(await page.locator('#app-version').innerText(),/^v0\.2\.0-rc\.1 · 20261026\.1$/);
 await page.locator('#start').click();await page.waitForFunction(()=>fake.streams.length>0);await page.locator('#webxr-open').click();await page.waitForFunction(()=>fake.renderers.some(r=>r.frame));
 assert.equal(await page.evaluate(()=>fake.request.released),true);assert.equal(await page.evaluate(()=>fake.request.mode),'immersive-ar');
 assert.deepEqual(await page.evaluate(()=>fake.request.options.requiredFeatures),['local','hit-test']);
 await page.evaluate(()=>{const r=fake.renderers.at(-1);r.frame(1,frame(pose(1)));});
 assert.match(await page.locator('#status').innerText(),/Поверхность найдена/);
 const gestures=await page.evaluate(()=>{
  const a=new Event('beforexrselect',{bubbles:true,cancelable:true}),b=new Event('beforexrselect',{bubbles:true,cancelable:true});
  document.querySelector('#ui').dispatchEvent(a);document.querySelector('#xr-size').dispatchEvent(b);return[a.defaultPrevented,b.defaultPrevented];
 });assert.deepEqual(gestures,[false,true]);
 const snap=await page.evaluate(()=>{
  fake.sessions.at(-1).dispatchEvent(new Event('select'));const r=fake.renderers.at(-1);r.frame(2,frame(pose(5)));
  const placement=r.world.children.find(c=>c.isGroup);window.savedPlacement=placement.matrix.toArray();
  const originals=[];ARViewer.model().group.traverse(o=>{if(o.isMesh)originals.push(o)});const copied=[];placement.traverse(o=>{if(o.isMesh)copied.push(o)});
  return {position:placement.matrix.elements[12],sameGeometry:originals.every((o,i)=>copied[i].geometry===o.geometry),sameMaterials:originals.every((o,i)=>copied[i].material===o.material),geometryCount:copied.length};
 });assert.equal(snap.position,1);assert.equal(snap.sameGeometry,true);assert.equal(snap.sameMaterials,true);assert.ok(snap.geometryCount>0);
 await page.evaluate(()=>{const r=fake.renderers.at(-1);r.frame(3,frame(null,false));});assert.match(await page.locator('#status').innerText(),/Отслеживание потеряно/);
 assert.equal(await page.evaluate(()=>fake.renderers.at(-1).world.children.find(c=>c.isGroup).visible),false);
 await page.evaluate(()=>{const r=fake.renderers.at(-1);r.frame(4,frame(pose(9)));});
 assert.deepEqual(await page.evaluate(()=>fake.renderers.at(-1).world.children.find(c=>c.isGroup).matrix.toArray()),await page.evaluate(()=>savedPlacement));
 await page.locator('#xr-size').fill('70');await page.locator('#xr-reset').click();await page.evaluate(()=>{const r=fake.renderers.at(-1);r.frame(5,frame(pose(3)));fake.sessions.at(-1).dispatchEvent(new Event('select'));r.frame(6,frame(pose(8)));});
 assert.equal(await page.evaluate(()=>fake.renderers.at(-1).world.children.find(c=>c.isGroup).matrix.elements[12]),3);
 await page.evaluate(()=>fake.sessions.at(-1).spaces.local.dispatchEvent(new Event('reset')));
 assert.match(await page.locator('#status').innerText(),/Система координат AR изменилась/);
 assert.equal(await page.evaluate(()=>fake.renderers.at(-1).world.children.find(c=>c.isGroup).visible),false);
 await page.evaluate(()=>{const r=fake.renderers.at(-1);r.frame(7,frame(null));});
 assert.equal(await page.evaluate(()=>fake.renderers.at(-1).world.children.find(c=>c.isGroup).visible),false);
 await page.evaluate(()=>{const r=fake.renderers.at(-1);r.frame(8,frame(pose(4)));fake.sessions.at(-1).dispatchEvent(new Event('select'));r.frame(9,frame(pose(7)));});
 assert.equal(await page.evaluate(()=>fake.renderers.at(-1).world.children.find(c=>c.isGroup).matrix.elements[12]),4);
 result.reference_reset_requires_replacement=true;
 await page.evaluate(()=>fake.sessions.at(-1).cancelThrows=true);await page.locator('#xr-exit').click();assert.equal(await page.locator('#webxr-canvas').count(),0);assert.equal(await page.evaluate(()=>fake.renderers.at(-1).disposed),true);assert.equal(await page.locator('#start').isDisabled(),false);
 result.qr_to_shared_mesh_surface_placement_lifecycle=true;
 // Denied permission is retryable; it never masquerades as placement.
 await page.evaluate(()=>fake.mode='deny');await page.locator('#webxr-open').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('AR не запущен'));assert.equal(await page.locator('#start').isDisabled(),false);
 await page.evaluate(()=>fake.mode='ok');await page.locator('#webxr-open').click();await page.waitForFunction(()=>fake.renderers.at(-1)?.frame);await page.locator('#xr-exit').click();result.denial_retry=true;
 // Run isolation: pending A is cancelled, B starts, then A fails; B must stay alive.
 const races=await page.evaluate(async()=>{
  const adapter=ARWebXR.create({THREE:AFRAME.THREE,overlay:document.querySelector('#ui')}),g=ARViewer.model().group;
  fake.mode='defer';const a=adapter.start(g);await adapter.end();fake.mode='ok';await adapter.start(g);const bRenderer=fake.renderers.at(-1);
  fake.deferred.reject(Error('late A failure'));await a;const keptB=adapter.active&&!bRenderer.disposed;
  const b=fake.sessions.at(-1);b.lateEnd=true;const ending=adapter.end();await Promise.resolve();await adapter.start(g);const cRenderer=fake.renderers.at(-1);b.finishEnd();await ending;
  const keptC=adapter.active&&!cRenderer.disposed;await adapter.end();return{keptB,keptC};
 });assert.deepEqual(races,{keptB:true,keptC:true});result.overlapping_session_cancellation=true;
 const pending=await page.evaluate(async()=>{
  const checks=[];
  for(const mode of ['defer-local','defer-hit']) {
   const adapter=ARWebXR.create({THREE:AFRAME.THREE,overlay:document.querySelector('#ui')});fake.mode=mode;
   const a=adapter.start(ARViewer.model().group);await new Promise(r=>setTimeout(r,0));const old=fake.sessions.at(-1);
   const release=mode==='defer-local'?old.resolveLocal:old.resolveHit;if(!release)throw Error('missing deferred hook');
   await adapter.end();fake.mode='ok';await adapter.start(ARViewer.model().group);const fresh=fake.renderers.at(-1);
   release();await a;checks.push(adapter.active&&!fresh.disposed&&(mode!=='defer-hit'||old.cancelled===1));await adapter.end();
  }
  return checks;
 });assert.deepEqual(pending,[true,true]);result.late_reference_and_hit_source_are_isolated=true;
 await page.screenshot({path:path.join(out,'android-ready.png')});
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>window.ARViewer);assert.equal(await page.evaluate(()=>ARViewer.version.version),'0.2.0-rc.1');assert.equal(await page.evaluate(()=>AROfflineState.readyForThisBuild),true);result.versioned_offline_reload=true;
 // Explicit unsupported capability result, even if UA says Android.
 const unsupported=await browser.newContext({userAgent:'Mozilla/5.0 (Linux; Android 14) Chrome/130.0.0.0 Mobile Safari/537.36'}),u=await unsupported.newPage();
 await u.addInitScript(()=>Object.defineProperty(navigator,'xr',{value:undefined,configurable:true}));await u.goto(url);await u.waitForFunction(()=>window.ARViewer);
 await u.locator('#scene-file').setInputFiles({name:'test-only-vectors.html',mimeType:'text/html',buffer:Buffer.from(html)});await u.waitForFunction(()=>ARViewer.model()?.data.kind==='mesh');assert.equal(await u.locator('#webxr-open').isVisible(),false);assert.match(await u.locator('#ar-support').innerText(),/AR недоступен/);result.unsupported_android_honest_status=true;
 assert.deepEqual(errors,[]);result.pageErrors=errors;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exit(1)});
