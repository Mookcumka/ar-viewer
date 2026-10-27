/* Browser camera layout/control/lifecycle regression; no physical autofocus or optical lens claim. */
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),out=process.env.TEST_OUTPUT||'/tmp/ar-viewer-camera-test';fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{let f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.svg':'image/svg+xml'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-video-capture='+(process.env.CAMERA_FIXTURES||'/tmp/ar-viewer-unified-test')+'/hiro.y4m','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const results={},errors=[];
 try{
 for(const policy of ['supported','missing','reject','probe-error','front']){
  const ctx=await browser.newContext({viewport:{width:393,height:852},permissions:['camera']}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(policy=>{
   window.cam={streams:[],requests:[],controls:[],policy};
   const md=navigator.mediaDevices,get=md.getUserMedia.bind(md);md.getSupportedConstraints=()=>{if(policy==='probe-error')throw Error('probe unavailable');return {facingMode:true,resizeMode:true,focusMode:policy!=='missing',zoom:policy!=='missing'};};
   md.getUserMedia=async req=>{
    cam.requests.push(req);const s=await get(req),t=s.getVideoTracks()[0],settings=t.getSettings.bind(t);cam.streams.push(s);
    let actual={zoom:4,focusMode:'single-shot'},last=t.getConstraints();cam.base=last;
    t.getSettings=()=>({...settings(),...actual,facingMode:policy==='front'?'user':'environment',deviceId:'private-device',groupId:'private-group'});
    t.getCapabilities=policy==='missing'?undefined:()=>({focusMode:['continuous','manual'],zoom:{min:1,max:8,step:.1},deviceId:'private-device'});
    t.getConstraints=()=>last;
    t.applyConstraints=async c=>{cam.controls.push(c);if(cam.defer)await new Promise(r=>cam.resolve=r);if(policy==='reject'&&c.advanced.some(x=>x.focusMode))throw new DOMException('runtime rejection','OverconstrainedError');last=c;for(const x of c.advanced)Object.assign(actual,x);};return s;
   };
  },policy);
  await p.goto(base+'/?diagnostics=1');await p.waitForFunction(()=>window.ARViewer);await p.locator('#start').click();await p.waitForFunction(()=>document.querySelector('#camera-preview').videoWidth>0);
  if(policy==='front')assert.match(await p.locator('#status').innerText(),/переднюю камеру/);
  assert.equal(await p.locator('a-scene').count(),0);assert.equal(await p.evaluate(()=>cam.requests.length),1);
  const request=await p.evaluate(()=>cam.requests[0]);assert.deepEqual(request.video.facingMode,{ideal:'environment'});if(policy==='probe-error')assert.equal(request.video.resizeMode,undefined);else assert.deepEqual(request.video.resizeMode,{ideal:'none'});assert.equal(request.video.aspectRatio,undefined);
  const controls=await p.evaluate(()=>cam.controls);assert.equal(controls.length,['missing','probe-error'].includes(policy)?0:2);if(controls.length){assert.equal(controls[0].advanced[0].focusMode,'continuous');assert.equal(controls[1].advanced.at(-1).zoom,1);assert.deepEqual(controls[1].width,await p.evaluate(()=>cam.base.width));}
  for(const size of [{width:393,height:852},{width:852,height:393},{width:412,height:915}]){
   await p.setViewportSize(size);await p.waitForTimeout(80);
   const view=await p.locator('#camera-preview').evaluate(v=>{const r=v.getBoundingClientRect(),frame={width:v.videoWidth,height:v.videoHeight},points=ARScanFeedback.map([{x:0,y:0},{x:frame.width,y:frame.height}],frame,r,{left:0,top:0,width:innerWidth,height:innerHeight},getComputedStyle(v).objectFit);return{rect:{x:r.x,y:r.y,width:r.width,height:r.height},fit:getComputedStyle(v).objectFit,transform:getComputedStyle(v).transform,frame,points};});
   assert.equal(view.fit,'contain');assert.equal(view.transform,'none');assert.equal(view.rect.x,0);assert.equal(view.rect.y,0);assert.equal(view.rect.width,size.width);assert.equal(view.rect.height,size.height);
   const [a,b]=view.points;assert.ok(a.x>=-.01&&a.y>=-.01&&b.x<=size.width+.01&&b.y<=size.height+.01);assert.ok(Math.abs((b.x-a.x)/(b.y-a.y)-view.frame.width/view.frame.height)<1e-6);
  }
  await p.locator('#diagnostics').evaluate(e=>e.open=true);const report=JSON.parse(await p.locator('#camera-info').textContent());assert.equal(JSON.stringify(report).includes('private'),false);assert.equal(report.preview.cropped,false);assert.equal(report.settings.zoom,['missing','probe-error'].includes(policy)?4:1);
  await p.locator('#diagnostics').evaluate(e=>e.open=false);await p.screenshot({path:out+'/camera-'+policy+'.png'});
  await p.locator('#new-sheet').click();assert.equal(await p.evaluate(()=>cam.requests.length),1);if(policy==='front')assert.match(await p.locator('#status').innerText(),/переднюю камеру/);
  await p.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));assert.equal(await p.evaluate(()=>cam.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),true);
  await p.locator('#start').click();await p.waitForFunction(()=>cam.requests.length===2&&document.querySelector('#camera-preview').srcObject?.active);
  if(policy==='supported'){
   // Existing tracker must actually detect a Hiro pattern, not just own a playing video.
   await p.evaluate(()=>location.hash=encodeURIComponent('AR1;cube;2000;2000;2000;scale=50'));
   await p.waitForFunction(()=>ARViewer.glb());await p.locator('#diagnostics').evaluate(e=>e.open=true);await p.locator('#marker-view').click();
   await p.waitForFunction(()=>document.querySelector('a-marker')?.object3D.visible&&document.querySelector('[ar-follow]')?.object3D.visible,null,{timeout:30000});
   assert.equal(await p.evaluate(()=>cam.streams.filter(s=>s.active).length),1);assert.equal(await p.evaluate(()=>document.querySelector('#arjs-video').srcObject===document.querySelector('#camera-preview').srcObject),true);
   await p.locator('#new-sheet').click();await p.waitForFunction(()=>!document.querySelector('#camera-preview').hidden&&document.querySelector('#camera-preview').videoWidth>0);
   assert.equal(await p.locator('a-scene').isVisible(),false);assert.equal(await p.locator('#arjs-video').isVisible(),false);
   await p.evaluate(()=>window.dispatchEvent(new Event('camera-error')));assert.equal(await p.evaluate(()=>document.querySelector('#camera-preview').srcObject?.active),true);
   await p.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await p.evaluate(()=>cam.defer=true);await p.locator('#start').click();await p.waitForFunction(()=>cam.resolve);
   await p.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await p.evaluate(()=>{cam.defer=false;cam.resolve();});await p.locator('#start').click();await p.waitForFunction(()=>document.querySelector('#camera-preview').srcObject?.active);
   assert.equal(await p.evaluate(()=>cam.streams.filter(s=>s.active).length),1);results.hiro_pattern_single_stream_and_late_error=true;results.cancel_configuration_race=true;
  }
  results['policy_'+policy+'_layout_orientation_reopen']=true;await ctx.close();
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/camera-results.json',JSON.stringify({results,errors,physicalFocusAndLens:'NOT TESTED'},null,2));console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exit(1)});
