const {test}=require('node:test'),assert=require('node:assert/strict');
const T=require('../qr-tracker.js'),cv=require('../vendor/jsfeat-min.js'),locator=require('../vendor/qr-locator.js'),decode=require('../vendor/jsQR.js'),fixtures=require('./qr-tracking-fixtures.json');
const square=(x,y,s=.2)=>[{x,y},{x:x+s,y},{x:x+s,y:y+s},{x,y:y+s}];
function image(){const data=new Uint8ClampedArray(640*480*4);data.fill(255);return {width:640,height:480,data};}
function paint(im,rows,x=40,y=100,transform=(x,y)=>({x,y}),damaged=false,scale=2){
 for(let j=0;j<rows.length;j++)for(let i=0;i<rows.length;i++)if(rows[j][i]==='1'&&!(damaged&&i>12&&i<95&&j>12&&j<95)){
  for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const p=transform(x+i*scale+dx,y+j*scale+dy),xx=Math.round(p.x),yy=Math.round(p.y);if(xx>=0&&xx<640&&yy>=0&&yy<480){const k=(yy*640+xx)*4;im.data[k]=im.data[k+1]=im.data[k+2]=0;}}
 }return im;
}
function shear(im){const out=image(),b=.12,d=.05,det=1-b*d;
 for(let y=0;y<480;y++)for(let x=0;x<640;x++){const X=x+b*120,Y=y+d*190,xx=Math.floor((X-b*Y)/det),yy=Math.floor((Y-d*X)/det);if(xx>=0&&yy>=0&&xx<640&&yy<480){const a=(y*640+x)*4,k=(yy*640+xx)*4;out.data[a]=im.data[k];out.data[a+1]=im.data[k+1];out.data[a+2]=im.data[k+2];}}return out;
}
module.exports={image,paint,fixtures,shear};
test('candidate, decoded and accepted/rejected are separate; duplicate key never creates another target',()=>{
 const b=T.bank(),p=square(.1,.1);b.observe(p,0);assert.equal(b.sample(20)[0].state,'candidate');b.mark(p,30,'decoded','one');assert.equal(b.sample(40)[0].state,'decoded');
 b.mark(p,50,'accepted','one');b.mark(p,60,'accepted','one');assert.equal(b.sample(70).length,1);assert.equal(b.sample(70)[0].state,'accepted');
 b.mark(p,80,'rejected','different');assert.equal(b.sample(90)[0].state,'rejected');b.reset();assert.equal(b.sample(100).length,0);
});
test('four corners smooth independently, cyclic ordering matches, multiple QR never merge',()=>{
 const b=T.bank(),p=square(.1,.1),q=square(.6,.5);b.observe(p,0);b.observe(q,0);
 const moved=p.map(v=>({x:v.x+.02,y:v.y+.01}));b.observe([moved[2],moved[3],moved[0],moved[1]],50);const list=b.sample(66);assert.equal(list.length,2);assert.ok(list[0].points[0].x>.1&&list[0].points[0].x<.12);assert.equal(list[1].points[0].x,.6);
});
test('brief loss holds then fades and expires; geometry never validates itself',()=>{
 const b=T.bank();b.observe(square(.1,.1),0);assert.equal(b.sample(100)[0].opacity,1);assert.ok(b.sample(500)[0].opacity<1);assert.equal(b.sample(651).length,0);
 b.observe(square(.1,.1),700);assert.equal(b.sample(701)[0].state,'candidate');
});
test('late decoder observation cannot rewind a newer flow pose; colour uses validation time',()=>{
 const b=T.bank(),p=square(.1,.1);b.observe(p,100);b.observe(square(.12,.1),200);b.mark(p,100,'accepted','packet',250);const t=b.sample(260)[0];assert.ok(t.points[0].x>.1);assert.equal(t.state,'accepted');
});
test('invalid/nonconvex/out-of-frame points rejected and storage bounded',()=>{
 const b=T.bank();for(const bad of [[],square(NaN,0),square(-.1,.1),[square(.1,.1)[0],square(.1,.1)[2],square(.1,.1)[1],square(.1,.1)[3]]])assert.equal(b.observe(bad,0),null);
 for(let y=0;y<4;y++)for(let x=0;x<4;x++)b.observe(square(.02+x*.24,.02+y*.24,.1),10);assert.ok(b.sample(20).length<=8);
});
test('real jsQR locator finds a damaged undecodable QR BEFORE bytes exist',()=>{
 const im=paint(image(),fixtures[0].rows,180,120,undefined,true);assert.equal(decode(im.data,im.width,im.height,{inversionAttempts:'dontInvert'}),null);
 const found=locator.detect(im);assert.ok(found.length>0);assert.ok(T.valid(found[0],640,480));
});
test('real locator + LK + homography follow translation without decoding, then expire on blank frames',()=>{
 const e=T.engine(cv,locator),rows=fixtures[0].rows;let tracks=e.process(paint(image(),rows,160,110),0);assert.ok(tracks.length>=1);const first=tracks[0];
 tracks=e.process(paint(image(),rows,166,114),80);const same=tracks.find(t=>t.id===first.id);assert.ok(same);assert.ok(Math.abs((same.points[0].x-first.points[0].x)*640-6)<2);assert.ok(Math.abs((same.points[0].y-first.points[0].y)*480-4)<2);assert.equal(same.detectedAt,0);
 for(let t=160;t<=1200;t+=80)tracks=e.process(image(),t);assert.equal(tracks.length,0);
});
test('multiple real QR in one frame, tilted/sheared scene, unchanged bytes',()=>{
 const e=T.engine(cv,locator),im=paint(paint(image(),fixtures[0].rows,30,110),fixtures[1].rows,360,110);let found=[];for(let t=0;t<1000;t+=80)found=e.process(im,t);for(const [x,y]of [[30,110],[360,110]])assert.ok(found.some(t=>{const p=t.points;return T.align(square(x,y,226),p.map(v=>({x:v.x*640,y:v.y*480}))).score<5;}),JSON.stringify(found));
 const tilted=shear(paint(image(),fixtures[0].rows,100,50,undefined,false,3));const tracks=T.engine(cv,locator).process(tilted,0);assert.ok(tracks.length>0);
 const original=paint(image(),fixtures[0].rows,180,120);const qr=decode(original.data,640,480,{inversionAttempts:'dontInvert'});const v=require('../qr-sheet/test/exporto-vectors.json').find(v=>v.packets.length===6);assert.deepEqual(qr.binaryData,v.packets[0]);
});

test('LK never reuses a pose from before a missed optical frame',()=>{
 const original=cv.optical_flow_lk.track;let calls=0;cv.optical_flow_lk.track=(...args)=>{calls++;args[7]?.fill(0);};
 try{const e=T.engine(cv,locator);e.process(paint(image(),fixtures[0].rows,160,110),0);e.process(image(),80);const after=calls;e.process(image(),120);assert.equal(calls,after);}finally{cv.optical_flow_lk.track=original;}
});

// Same existing synthetic decoder vectors, no owner geometry committed as fixtures.
function denseImage(w,h,x,y,size){
 const rows=fixtures[0].rows,data=new Uint8ClampedArray(w*h*4);data.fill(255);
 for(let j=0;j<size;j++)for(let i=0;i<size;i++)if(rows[Math.floor(j*rows.length/size)][Math.floor(i*rows.length/size)]==='1'){
  const a=((y+j)*w+x+i)*4;data[a]=data[a+1]=data[a+2]=0;
 }return{width:w,height:h,data};
}
test('native video detail acquires dense QR lost by the 640px overview, with correct coordinates',()=>{
 const overview=denseImage(640,480,165,100,125),detail=denseImage(640,624,330,200,250);
 assert.equal(locator.detect(overview).length,0);assert.ok(locator.detect(detail).length);
 const e=T.engine(cv,locator),found=e.process(overview,0,[{image:detail,rect:{x:0,y:0,w:.5,h:.65}}]);
 assert.equal(e.detailSearched,true);assert.ok(found.length);const expected=square(330/1280,200/960,250/1280);
 const p=found[0].points;assert.ok(Math.abs(p[0].x-330/1280)<.01);assert.ok(Math.abs(p[0].y-200/960)<.01);assert.ok(Math.abs(p[2].x-580/1280)<.01);assert.ok(Math.abs(p[2].y-450/960)<.01);
 e.process(overview,80,[{image:detail,rect:{x:0,y:0,w:.5,h:.65}}]);assert.equal(e.detailSearched,false);
 e.process(overview,160,[{image:detail,rect:{x:0,y:0,w:.5,h:.65}}]);assert.equal(e.detailSearched,true);
});
test('detail regions cover all six original-video areas, never upscale, never alter preview zoom',()=>{
 assert.equal(T.detailRegion(640,480,0),null);
 for(const [w,h]of [[1280,960],[1920,1080],[1080,1920]])for(let i=0;i<6;i++){
  const r=T.detailRegion(w,h,i);assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=w&&r.y+r.h<=h);
  assert.ok(r.width<=640&&r.height<=640&&r.width<=r.w&&r.height<=r.h);
 }
 assert.equal(T.detailRegion(1280,960,0).x,0);assert.ok(T.detailRegion(1280,960,5).y>0);
});
