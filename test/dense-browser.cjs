/* Original-pixel detail and moving corners in a real worker. Software camera, not physical phone acceptance. */
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),out=process.env.TEST_OUTPUT||'/tmp/ar-viewer-dense-test';fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{let f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.svg':'image/svg+xml'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const b=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});const errors=[],results={};
 try{const ctx=await b.newContext({viewport:{width:393,height:852}}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.waitForFunction(()=>window.AROfflineState?.readyForThisBuild);await ctx.setOffline(true);await p.reload();await p.waitForFunction(()=>window.AROfflineState?.readyForThisBuild);
 const rows=require('./qr-tracking-fixtures.json')[0].rows;
 await p.evaluate(async rows=>{
  const c=document.createElement('canvas');c.width=1280;c.height=960;const g=c.getContext('2d');window.paintDense=(x=330,y=200,blank=false)=>{g.fillStyle='white';g.fillRect(0,0,c.width,c.height);g.fillStyle='black';if(!blank)for(let j=0;j<250;j++)for(let i=0;i<250;i++)if(rows[Math.floor(j*rows.length/250)][Math.floor(i*rows.length/250)]==='1')g.fillRect(x+i,y+j,1,1);};paintDense();
  const v=document.querySelector('#camera-preview');v.hidden=false;v.srcObject=c.captureStream(15);v.muted=true;await v.play();document.body.classList.add('live');document.querySelector('#start').hidden=true;
  window.trackerStats=[];window.denseOverlay=ARQrOverlay.create({svg:document.querySelector('#scan-outline'),emit:s=>trackerStats.push(s)});denseOverlay.start(v);
 },rows);
 await p.waitForSelector('#scan-outline polygon[data-kind=candidate]',{timeout:15000});results.detail_predecode_offline=true;
 const tracked=await p.locator('#scan-outline polygon').first().getAttribute('data-track');
 await p.waitForTimeout(2500);assert.equal(await p.locator('#scan-outline polygon').first().getAttribute('data-track'),tracked);results.stationary_dense_target_keeps_identity=true;
 async function fit(x,y){await p.waitForFunction(({x,y})=>{const v=document.querySelector('#camera-preview'),r=v.getBoundingClientRect(),scale=Math.min(r.width/v.videoWidth,r.height/v.videoHeight),left=r.left+(r.width-v.videoWidth*scale)/2,top=r.top+(r.height-v.videoHeight*scale)/2,e=document.querySelector('#scan-outline polygon');if(!e)return false;const p=e.points[0];return Math.hypot(p.x-left-x*scale,p.y-top-y*scale)<5;},{x,y},{timeout:12000});}
 await fit(330,200);await p.evaluate(()=>paintDense(354,218));await fit(354,218);results.original_pixel_corner_mapping_and_motion=true;
 await p.screenshot({path:out+'/dense-portrait.png'});await p.evaluate(()=>paintDense(354,218,true));await p.waitForFunction(()=>!document.querySelector('#scan-outline polygon'),null,{timeout:3000});results.blank_loss_expires=true;
 await p.evaluate(()=>paintDense(720,520));await p.waitForSelector('#scan-outline polygon[data-kind=candidate]',{timeout:15000});await fit(720,520);results.global_search_reacquires_other_region=true;
 await p.setViewportSize({width:852,height:393});await p.evaluate(()=>denseOverlay.clear());await fit(720,520);results.landscape_contain_mapping=true;
 const stats=await p.evaluate(()=>trackerStats.at(-1));assert.equal(stats.sourceWidth,1280);assert.equal(stats.overviewWidth,640);assert.equal(stats.detailRegions,6);assert.equal(await p.locator('#reticle').evaluate(r=>r.hidden||r.classList.contains('locked')||r.classList.contains('idle')),true);assert.equal(await p.locator('.part').count(),0);assert.equal(await p.evaluate(()=>ARViewer.model()),null);assert.deepEqual(errors,[]);await p.evaluate(()=>{denseOverlay.stop();document.querySelector('#camera-preview').srcObject.getTracks().forEach(t=>t.stop());});
 fs.writeFileSync(out+'/dense-browser.json',JSON.stringify({results,stats,errors,physicalDevice:'NOT TESTED'},null,2));console.log(JSON.stringify(results,null,2));
 }finally{await b.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exit(1);});
