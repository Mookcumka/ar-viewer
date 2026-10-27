/* Real worker/locator/jsfeat + fake optical video. Not physical phone focus, latency or AR acceptance. */
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),out=process.env.TEST_OUTPUT||'/tmp/ar-viewer-tracker-test';fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{let f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.svg':'image/svg+xml'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const b=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-video-capture='+(process.env.CAMERA_FIXTURES||'/tmp/ar-viewer-unified-test')+'/transport-100.y4m','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const results={},errors=[],network=[];
 try{
 const ctx=await b.newContext({permissions:['camera'],viewport:{width:393,height:852}}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));ctx.on('request',r=>network.push(r.url()));
 await p.addInitScript(()=>{window.cameraOpens=0;const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=o=>{cameraOpens++;return get(o);};});
 await p.goto(base+'/?diagnostics=1');await p.waitForFunction(()=>window.ARViewer&&window.AROfflineState?.readyForThisBuild);
 // Entire tracker (including worker importScripts) must boot with an already prepared offline cache.
 await ctx.setOffline(true);await p.reload();await p.waitForFunction(()=>window.ARViewer&&window.AROfflineState?.readyForThisBuild);
 await p.evaluate(()=>{window.actualQR=jsQR;jsQR=()=>null;});await p.locator('#start').click();
 await p.waitForSelector('#scan-outline polygon[data-kind=candidate]',{timeout:20000}).catch(async e=>{console.log(await p.evaluate(()=>({tracking:document.querySelector('#tracking-info').textContent,camera:document.querySelector('#camera-info').textContent,video:{paused:document.querySelector('video').paused,ready:document.querySelector('video').readyState}})));throw e;});assert.equal(await p.locator('.part').count(),0);assert.equal(await p.evaluate(()=>ARViewer.model()),null);assert.equal(await p.evaluate(()=>cameraOpens),1);
 const initial=await p.locator('#scan-outline polygon').first().getAttribute('data-track');await p.waitForTimeout(1100);assert.ok(await p.locator('#scan-outline polygon').count());assert.equal(await p.locator('#scan-outline polygon').first().getAttribute('data-track'),initial);results.predecode_real_worker_offline_no_payload=true;
 await p.screenshot({path:out+'/magnetic-candidate.png'});
 await p.evaluate(()=>document.querySelector('#camera-preview').pause());await p.waitForFunction(()=>!document.querySelector('#scan-outline polygon'),null,{timeout:2000});await p.evaluate(()=>document.querySelector('#camera-preview').play());await p.waitForSelector('#scan-outline polygon[data-kind=candidate]');results.loss_fades_and_reacquires=true;
 await p.setViewportSize({width:852,height:393});await p.waitForSelector('#scan-outline polygon[data-kind=candidate]');
 const visible=await p.locator('#scan-outline polygon').first().evaluate(e=>{const v=document.querySelector('#camera-preview'),r=v.getBoundingClientRect(),w=v.videoWidth,h=v.videoHeight,s=Math.min(r.width/w,r.height/h),left=(r.width-w*s)/2,top=(r.height-h*s)/2;return [...e.points].every(p=>p.x>=left-2&&p.y>=top-2&&p.x<=left+w*s+2&&p.y<=top+h*s+2);});assert.equal(visible,true);results.orientation_contain_corner_mapping=true;
 await p.evaluate(()=>{jsQR=(...args)=>{const q=actualQR(...args);if(q)window.lastDecoded=q;return q;};});
 await p.waitForSelector('#scan-outline polygon[data-kind=accepted]',{timeout:20000});await p.waitForFunction(()=>document.querySelectorAll('.part[data-received=true]').length>=1);assert.equal(await p.evaluate(()=>cameraOpens),1);results.validated_part_green=true;
 await p.evaluate(()=>{window.injected=false;jsQR=()=>{if(injected)return null;injected=true;return {...lastDecoded,binaryData:[81,82,76,49]};};});
 const parts=await p.locator('.part[data-received=true]').count();await p.waitForSelector('#scan-outline polygon[data-kind=rejected]',{timeout:5000});assert.equal(await p.locator('.part[data-received=true]').count(),parts);results.invalid_binary_never_green=true;
 await p.locator('#new-sheet').click();assert.equal(await p.locator('.part').count(),0);await p.evaluate(()=>jsQR=actualQR);await p.waitForFunction(()=>ARViewer.glb(),null,{timeout:35000});assert.equal(await p.locator('#scan-outline polygon').count(),0);assert.equal(await p.evaluate(()=>document.querySelector('#camera-preview').srcObject),null);results.six_parts_restore_and_stop_tracker=true;
 assert.deepEqual(errors,[]);assert.deepEqual(network.filter(u=>!u.startsWith(base)&&!u.startsWith('blob:')),[]);await ctx.close();
 // Blocked Worker API degrades only outline acquisition; original QR decoding remains usable.
 const c=await b.newContext({permissions:['camera']}),q=await c.newPage();await q.addInitScript(()=>{window.Worker=class{constructor(){throw Error('disabled');}};});await q.goto(base);await q.waitForFunction(()=>window.ARViewer);await q.locator('#start').click();await q.waitForFunction(()=>document.querySelectorAll('.part[data-received=true]').length>=1,null,{timeout:20000});await q.waitForSelector('#scan-outline polygon[data-kind=accepted]');results.worker_unavailable_decoder_feedback=true;await c.close();
 fs.writeFileSync(out+'/tracker-browser.json',JSON.stringify({results,errors,physicalDevice:'NOT TESTED'},null,2));console.log(JSON.stringify(results,null,2));
 }finally{await b.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exit(1)});
