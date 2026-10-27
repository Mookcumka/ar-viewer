const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const T=require('../qr-tracker.js'),feedback=require('../scan-feedback.js');
function setup(fail=false){
 let now=10,frames=[],timers=[],workers=[],events=[];
 const node=()=>({dataset:{},style:{},attrs:{},setAttribute(k,v){this.attrs[k]=v;},remove(){svg.children=svg.children.filter(n=>n!==this);}});
 const svg={children:[],replaceChildren(){this.children=[];},append(n){this.children.push(n);},getBoundingClientRect:()=>({left:0,top:0,width:640,height:480}),setAttribute(){}};
 const context={console,ARQrTracker:T,ARScanFeedback:feedback,performance:{now:()=>now},getComputedStyle:()=>({objectFit:'contain'}),setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){},
  document:{hidden:false,createElement:()=>({getContext:()=>({drawImage(){},getImageData:(_,__,w,h)=>({data:new Uint8ClampedArray(w*h*4)})})}),createElementNS:node},
  Worker:class{constructor(){if(fail)throw Error('blocked');this.messages=[];this.terminated=false;workers.push(this);}postMessage(m){this.messages.push(m);}terminate(){this.terminated=true;}}
 };
 vm.runInNewContext(fs.readFileSync(require.resolve('../qr-overlay.js'),'utf8'),context);
 const overlay=context.ARQrOverlay.create({svg,emit:e=>events.push(e)}),video={videoWidth:640,videoHeight:480,readyState:2,paused:false,getBoundingClientRect:()=>({left:0,top:0,width:640,height:480})};
 return{overlay,video,svg,workers,events,timers,tick(t){now=t;frames.splice(0).forEach(fn=>fn());},reply(worker){const m=worker.messages.filter(x=>x.type==='frame').at(-1);worker.onmessage({data:{...m,type:'tracks',targets:[{points:[{x:.1,y:.1},{x:.4,y:.1},{x:.4,y:.4},{x:.1,y:.4}],at:m.at,detectedAt:m.at}]}});}};
}
test('one pending worker frame; stale worker errors/responses cannot affect a restarted overlay',()=>{
 const s=setup();s.overlay.start(s.video);const a=s.workers[0],oldError=a.onerror;s.overlay.start(s.video);const b=s.workers[1];oldError({preventDefault(){}});assert.equal(b.terminated,false);
 s.timers.at(-1)();s.timers.at(-1)();assert.equal(b.messages.filter(m=>m.type==='frame').length,1);s.reply(a);s.tick(15);assert.equal(s.svg.children.length,0);s.reply(b);s.tick(20);assert.equal(s.svg.children[0].dataset.kind,'candidate');
 s.overlay.clear();s.reply(b);s.tick(30);assert.equal(s.svg.children.length,0);s.overlay.stop();assert.equal(b.terminated,true);
});
test('decoder-only fallback still separates read from validated colour, handles repeats and expires',()=>{
 const s=setup(true);s.overlay.start(s.video);assert.equal(s.events[0].mode,'decoded-only');const p=[{x:64,y:48},{x:256,y:48},{x:256,y:192},{x:64,y:192}],frame={width:640,height:480};
 s.overlay.hit(p,frame,'decoded','part',10);s.tick(20);assert.equal(s.svg.children[0].dataset.kind,'decoded');s.overlay.hit(p,frame,'accepted','part',20);s.tick(30);assert.equal(s.svg.children[0].dataset.kind,'accepted');s.overlay.hit(p,frame,'accepted','part',30);s.tick(40);assert.equal(s.svg.children.length,1);
 s.overlay.hit(p,frame,'rejected','bad',40);s.tick(50);assert.equal(s.svg.children[0].dataset.kind,'rejected');s.tick(800);assert.equal(s.svg.children.length,0);
});

test('native region advances only after worker search acknowledgement, not skipped flow frames',()=>{
 const s=setup();s.video.videoWidth=1280;s.video.videoHeight=960;s.overlay.start(s.video);const w=s.workers[0];
 const last=()=>w.messages.filter(m=>m.type==='frame').at(-1);
 const first=last();assert.equal(first.width,640);assert.equal(first.details.length,1);assert.equal(first.details[0].width,640);
 w.onmessage({data:{...first,type:'tracks',targets:[],detailSearched:false}});s.timers.at(-1)();assert.deepEqual(last().details[0].rect,first.details[0].rect);
 w.onmessage({data:{...last(),type:'tracks',targets:[],detailSearched:true}});s.timers.at(-1)();assert.ok(last().details[0].rect.x>first.details[0].rect.x);
 s.overlay.stop();assert.equal(w.terminated,true);
});

test('240ms worker cadence revisits a known dense QR without starving the acknowledged global search',()=>{
 const s=setup();s.video.videoWidth=1280;s.video.videoHeight=960;s.overlay.start(s.video);const w=s.workers[0];
 // Ground truth matches the dense native-video fixture: x330,y200,size250.
 // Its 640px overview cannot locate it; flow can retain the pose between native searches.
 const points=[{x:330/1280,y:200/960},{x:580/1280,y:200/960},{x:580/1280,y:450/960},{x:330/1280,y:450/960}];
 const last=()=>w.messages.filter(m=>m.type==='frame').at(-1);
 const sameRect=(a,b)=>['x','y','w','h'].every(k=>Math.abs(a[k]-b[k])<1e-10);
 let detectedAt=-Infinity,globalIndex=0,focused=0,globalSearches=0;
 for(let step=0;step<13;step++){
  if(step){s.tick(10+step*240);s.timers.at(-1)();}
  const m=last(),r=m.details[0].rect,globalRect=T.detailRegion(1280,960,globalIndex).rect;
  assert.equal(m.at,10+step*240);
  // A slow response still owns the single queue slot; intervening timer ticks cannot enqueue another frame.
  const queued=w.messages.filter(x=>x.type==='frame').length;s.timers.at(-1)();s.timers.at(-1)();assert.equal(w.messages.filter(x=>x.type==='frame').length,queued);
  if(sameRect(r,globalRect)){globalSearches++;globalIndex=(globalIndex+1)%6;}else focused++;
  const covered=points.every(p=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h);
  if(covered)detectedAt=m.at;
  assert.ok(m.at-detectedAt<900,'stationary dense QR must be searched again before its detection freshness expires');
  s.tick(m.at+120);w.onmessage({data:{...m,type:'tracks',detailSearched:true,targets:[{points,at:m.at,detectedAt}]}});
 }
 assert.ok(focused>=2,'known-target native searches must actually occur');
 assert.ok(globalSearches>=6,'known-target refreshes must leave room for the global ROI cycle');
 s.overlay.stop();
});

test('two known dense QR leave bounded search opportunities for a third QR at 240ms cadence',()=>{
 const s=setup();s.video.videoWidth=1280;s.video.videoHeight=960;s.overlay.start(s.video);const w=s.workers[0];
 const square=(x,y)=>[{x,y},{x:x+.14,y},{x:x+.14,y:y+.14},{x,y:y+.14}];
 const targets=[{points:square(.23,.23),detectedAt:10},{points:square(.65,.65),detectedAt:10}];
 const last=()=>w.messages.filter(m=>m.type==='frame').at(-1);
 const first=last();w.onmessage({data:{...first,type:'tracks',detailSearched:true,targets:targets.map(t=>({...t,at:first.at}))}});
 let globalIndex=1,globalSearches=1;
 for(let step=1;step<=12;step++){
  s.tick(10+step*240);s.timers.at(-1)();const m=last(),r=m.details[0].rect,expected=T.detailRegion(1280,960,globalIndex).rect;
  if(['x','y','w','h'].every(k=>Math.abs(r[k]-expected[k])<1e-10)){globalSearches++;globalIndex=(globalIndex+1)%6;}
  for(const t of targets){if(t.points.every(p=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h))t.detectedAt=m.at;assert.ok(m.at-t.detectedAt<900,'refreshing/searching must not expire another stationary tracked QR');}
  s.tick(m.at+120);w.onmessage({data:{...m,type:'tracks',detailSearched:true,targets:targets.map(t=>({...t,at:m.at}))}});
 }
 assert.ok(globalSearches>=4,'two known QR must not consume every future native search');
 s.overlay.stop();
});
