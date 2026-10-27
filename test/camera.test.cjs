const {test}=require('node:test'),assert=require('node:assert/strict'),camera=require('../camera.js');
test('rear preference, no viewport crop, no unadvertised controls in getUserMedia',()=>{
 assert.deepEqual(camera.request({}),{audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}}});
 assert.deepEqual(camera.request({resizeMode:true}).video.resizeMode,{ideal:'none'});
});
test('advertised continuous autofocus and neutral zoom preserve stream constraints',async()=>{
 const calls=[],events=[],base={width:{ideal:1280},height:{ideal:960},facingMode:{ideal:'environment'}};
 const track={getConstraints:()=>base,getCapabilities:()=>({focusMode:['manual','continuous'],zoom:{min:1,max:10,step:.1}}),getSettings:()=>({zoom:1,focusMode:'continuous',deviceId:'secret',groupId:'secret'}),applyConstraints:async c=>calls.push(c)};
 await camera.configure(track,{focusMode:true,zoom:true},(t,d)=>events.push({t,d}));
 assert.deepEqual(calls,[{...base,advanced:[{focusMode:'continuous'}]},{...base,advanced:[{focusMode:'continuous'},{zoom:1}]}]);
 assert.equal(JSON.stringify(events).includes('secret'),false);
});
test('missing APIs and unsupported/fixed controls are left alone',async()=>{
 for(const caps of [{},{focusMode:['manual'],zoom:{min:1,max:4}},{focusMode:['continuous'],zoom:{min:0,max:10}}]){
  let n=0;await camera.configure({getCapabilities:()=>caps,applyConstraints:async()=>n++},{focusMode:false,zoom:false});assert.equal(n,0);
 }
 await camera.configure({getCapabilities(){throw Error('unavailable');},getSettings(){throw Error('unavailable');}},{focusMode:true,zoom:true});
 let n=0;await camera.configure({getCapabilities:()=>({focusMode:['manual']}),applyConstraints:async()=>n++},{focusMode:true});assert.equal(n,0);
});
test('zoom uses only valid advertised range/step; no assumed optical 1x',async()=>{
 for(const [range,want]of [[{min:2,max:8,step:.5},2],[{min:.5,max:8,step:.2},1.1],[{min:.2,max:.8,step:.1},.2]]){
  let actual;await camera.configure({getCapabilities:()=>({zoom:range}),applyConstraints:async c=>actual=c.advanced[0].zoom},{zoom:true});assert.ok(Math.abs(actual-want)<1e-9);
 }
});
test('rejected autofocus leaves zoom available, and stopped/cancelled track is never configured',async()=>{
 const events=[],calls=[];await camera.configure({getCapabilities:()=>({focusMode:['continuous'],zoom:{min:1,max:4}}),applyConstraints:async c=>{calls.push(c);if(c.advanced.some(x=>x.focusMode))throw Object.assign(Error(),{name:'OverconstrainedError'});}},{focusMode:true,zoom:true},(_,d)=>events.push(d));
 assert.equal(calls.length,2);assert.deepEqual(calls[1],{advanced:[{zoom:1}]});assert.equal(events[0].result,'rejected');
 for(const ended of [true,false]){let n=0;await camera.configure({readyState:ended?'ended':'live',getCapabilities:()=>({zoom:{min:1,max:2}}),applyConstraints:async()=>n++},{zoom:true},()=>{},()=>ended);assert.equal(n,0);}
});
test('full frame uses contain letterboxes rather than AR.js cover crop',()=>{
 const p=camera.preview({videoWidth:1280,videoHeight:960,getBoundingClientRect:()=>({width:393,height:852})});assert.equal(p.cropped,false);assert.equal(p.content.width,393);assert.equal(p.content.height,294.75);
});
