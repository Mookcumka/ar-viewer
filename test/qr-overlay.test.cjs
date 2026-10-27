const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const T=require('../qr-tracker.js'),feedback=require('../scan-feedback.js');
function setup(fail=false){
 let now=10,frames=[],timers=[],workers=[],events=[];
 const node=()=>({dataset:{},style:{},attrs:{},setAttribute(k,v){this.attrs[k]=v;},remove(){svg.children=svg.children.filter(n=>n!==this);}});
 const svg={children:[],replaceChildren(){this.children=[];},append(n){this.children.push(n);},getBoundingClientRect:()=>({left:0,top:0,width:640,height:480}),setAttribute(){}};
 const context={console,ARQrTracker:T,ARScanFeedback:feedback,performance:{now:()=>now},getComputedStyle:()=>({objectFit:'contain'}),setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){},
  document:{hidden:false,createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(640*480*4)})})}),createElementNS:node},
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
