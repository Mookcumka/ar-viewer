/* QR spatial tracks only. Neither location nor optical flow is proof of decoded/valid payload. */
(function(root){
 'use strict';
 const copy=p=>p.map(v=>({x:v.x,y:v.y})),center=p=>({x:p.reduce((n,v)=>n+v.x,0)/4,y:p.reduce((n,v)=>n+v.y,0)/4});
 const area=p=>Math.abs(p.reduce((s,v,i)=>s+v.x*p[(i+1)%4].y-p[(i+1)%4].x*v.y,0))/2;
 function valid(p,w=1,h=1){
  if(!Array.isArray(p)||p.length!==4||p.some(v=>!Number.isFinite(v.x)||!Number.isFinite(v.y)||v.x<0||v.y<0||v.x>w||v.y>h))return false;
  const a=area(p);if(a<.0003*w*h||a>.8*w*h)return false;
  let sign=0;for(let i=0;i<4;i++){const a=p[i],b=p[(i+1)%4],c=p[(i+2)%4],n=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);if(Math.abs(n)<1e-8||sign*n<0)return false;sign=n;}
  const edges=p.map((v,i)=>Math.hypot(v.x-p[(i+1)%4].x,v.y-p[(i+1)%4].y));return Math.min(...edges)>3/640*Math.min(w,h)&&Math.max(...edges)/Math.min(...edges)<5;
 }
 function align(a,b){let best,score=Infinity;for(let k=0;k<4;k++){const p=b.map((_,i)=>b[(i+k)%4]),v=p.reduce((n,q,i)=>n+(q.x-a[i].x)**2+(q.y-a[i].y)**2,0)/4;if(v<score){score=v;best=p;}}return{points:copy(best),score:Math.sqrt(score)};}
 function near(a,b){const r=align(a,b),scale=Math.sqrt(Math.min(area(a),area(b))),ratio=area(a)/area(b);return ratio>.4&&ratio<2.5&&r.score<scale*.42?r:null;}
 function bank(){
  let targets=[],next=0;
  return {
   reset(){targets=[];next=0;},
   observe(points,at,id=null,detected=true){
    if(!valid(points))return null;
    let t=id===null?null:targets.find(t=>t.id===id),match=t?align(t.goal,points):null;
    if(!t){let best=Infinity;for(const x of targets){const r=near(x.goal,points);if(r&&r.score<best){t=x;match=r;best=r.score;}}}
    if(!t){t={id:id??++next,goal:copy(points),points:copy(points),seen:at,detectedAt:at,drawAt:at,state:'candidate',stateUntil:0};targets.push(t);}
    if(at<t.seen)return t; // Async worker frame must not rewind a newer decoder observation.
    if(at-t.seen>220){t.state='candidate';t.stateUntil=0;}
    t.goal=match?match.points:copy(points);t.seen=at;if(detected)t.detectedAt=at;
    if(targets.length>8)targets.sort((a,b)=>b.seen-a.seen).splice(8);return t;
   },
   mark(points,at,state,key,checkedAt=at){
    const t=this.observe(points,at);if(!t)return null;
    if(t.key!==key){t.state='decoded';t.stateUntil=0;}t.key=key;
    t.state=['accepted','rejected','decoded','other'].includes(state)?state:'candidate';t.stateUntil=checkedAt+650;return t.id;
   },
   sample(at){
    targets=targets.filter(t=>at-t.seen<650&&at-t.detectedAt<950);
    return targets.map(t=>{const k=1-Math.exp(-Math.max(0,Math.min(80,at-t.drawAt))/55);t.points=t.points.map((p,i)=>({x:p.x+(t.goal[i].x-p.x)*k,y:p.y+(t.goal[i].y-p.y)*k}));t.drawAt=at;
     return{id:t.id,points:copy(t.points),state:at<t.stateUntil?t.state:'candidate',opacity:Math.max(0,Math.min(1,(650-(at-t.seen))/300))};});
   }
  };
 }
 function project(m,p){const z=m[6]*p.x+m[7]*p.y+m[8];return{x:(m[0]*p.x+m[1]*p.y+m[2])/z,y:(m[3]*p.x+m[4]*p.y+m[5])/z};}
 // Read detail from the ORIGINAL video, before the overview loses dense QR modules.
 function detailRegion(w,h,index,points=null){
  if(Math.max(w,h)<=640)return null;
  const rw=Math.round(w*.5),rh=Math.round(h*.65),col=index%3,row=Math.floor(index/3)%2;
  const c=valid(points)?center(points):null,x=c?Math.max(0,Math.min(w-rw,Math.round(c.x*w-rw/2))):Math.round(col*(w-rw)/2),y=c?Math.max(0,Math.min(h-rh,Math.round(c.y*h-rh/2))):row*(h-rh),scale=Math.min(1,640/Math.max(rw,rh));
  return {x,y,w:rw,h:rh,width:Math.round(rw*scale),height:Math.round(rh*scale),rect:{x:x/w,y:y/h,w:rw/w,h:rh/h}};
 }
 function engine(cv,locator){
  let tracks=[],serial=0,previous=null,last=0,lastDetection=-Infinity,region=0,width=0,height=0,detailSearched=false;
  const kernel=new cv.motion_model.homography2d();
  function reset(){tracks=[];previous=null;last=0;lastDetection=-Infinity;region=0;width=height=0;serial=0;}
  function flow(current,t){
   if(!previous||t.points.length!==4)return null;
   const from=[],points=t.points;
   // Interior grid avoids relying on a single weak bottom-right QR corner.
   for(const u of [.12,.35,.65,.88])for(const v of [.12,.35,.65,.88])from.push({x:(1-v)*((1-u)*points[0].x+u*points[1].x)+v*((1-u)*points[3].x+u*points[2].x),y:(1-v)*((1-u)*points[0].y+u*points[1].y)+v*((1-u)*points[3].y+u*points[2].y)});
   const n=from.length,a=new Float32Array(n*2),b=new Float32Array(n*2),back=new Float32Array(n*2),status=new Uint8Array(n),rev=new Uint8Array(n);
   from.forEach((p,i)=>{a[i*2]=p.x;a[i*2+1]=p.y;});
   cv.optical_flow_lk.track(previous,current,a,b,n,15,20,status,.01,.001);
   cv.optical_flow_lk.track(current,previous,b,back,n,15,20,rev,.01,.001);
   const good=[],to=[];
   function patchError(p,q){let sum=0,count=0;const old=previous.data[0].data,fresh=current.data[0].data;
    for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++){const ax=Math.round(p.x)+x,ay=Math.round(p.y)+y,bx=Math.round(q.x)+x,by=Math.round(q.y)+y;
     if(ax<0||ay<0||bx<0||by<0||ax>=width||bx>=width||ay>=height||by>=height)return Infinity;
     sum+=Math.abs(old[ay*width+ax]-fresh[by*width+bx]);count++;
    }return sum/count;
   }
   for(let i=0;i<n;i++)if(status[i]&&rev[i]&&Math.hypot(back[i*2]-a[i*2],back[i*2+1]-a[i*2+1])<1.6){const q={x:b[i*2],y:b[i*2+1]};if(patchError(from[i],q)<35){good.push(from[i]);to.push(q);}}
   if(good.length<8)return null;
   const h=new cv.matrix_t(3,3,cv.F32C1_t),mask=new cv.matrix_t(good.length,1,cv.U8C1_t),params=new cv.ransac_params_t(4,2,.4,.99);
   if(!cv.motion_estimator.ransac(params,kernel,good,to,good.length,h,mask,40)||Array.from(mask.data.subarray(0,good.length)).filter(Boolean).length<Math.max(8,Math.ceil(good.length*.75)))return null;
   const p=points.map(p=>project(h.data,p)),r=align(points,p);
   return valid(p,width,height)&&r.score<Math.sqrt(area(points))*.4&&area(p)/area(points)>.65&&area(p)/area(points)<1.55?p:null;
  }
  function crop(image,r){const data=new Uint8ClampedArray(r.w*r.h*4);for(let y=0;y<r.h;y++){const at=((y+r.y)*image.width+r.x)*4;data.set(image.data.subarray(at,at+r.w*4),y*r.w*4);}return{width:r.w,height:r.h,data};}
  return {reset,get detailSearched(){return detailSearched;},process(image,at,details=[]){
   detailSearched=false;
   if(!image||image.width>640||image.height>640||image.width<40||image.height<40||image.data.length!==image.width*image.height*4)throw Error('Invalid tracker frame');
   if(image.width!==width||image.height!==height||at-last>300){reset();width=image.width;height=image.height;}
   const current=new cv.pyramid_t(3);current.allocate(width,height,cv.U8C1_t);cv.imgproc.grayscale(image.data,width,height,current.data[0]);current.build(current.data[0],true);
   for(const t of tracks){const p=t.seen===last?flow(current,t):null;if(p){t.points=p;t.seen=at;}}
   if(at-lastDetection>=160){
    const views=[{x:0,y:0,w:width,h:height}];
    // Overlapping full-height/width strips avoid combining finder patterns of neighbouring QR.
    const windows=[{x:0,y:0,w:Math.ceil(width*.55),h:height},{x:Math.floor(width*.45),y:0,w:Math.ceil(width*.55),h:height},
     {x:0,y:0,w:width,h:Math.ceil(height*.6)},{x:0,y:Math.floor(height*.4),w:width,h:Math.ceil(height*.6)}];
    for(let row=0;row<2;row++)for(let col=0;col<3;col++){const x=Math.max(0,Math.floor((col-.12)*width/3)),y=Math.max(0,Math.floor((row-.12)*height/2));windows.push({x,y,w:Math.min(width-x,Math.floor(width*1.24/3)),h:Math.min(height-y,Math.floor(height*1.24/2))});}
    for(let i=0;i<2;i++){views.push(windows[region]);region=(region+1)%windows.length;}
    // High-resolution crops are additional observations of the SAME frame and stream.
    // Keep the overview for large QR; use one original-detail region instead of two blurred crops.
    const inputs=details.length?[{image,rect:{x:0,y:0,w:1,h:1}}]:views.map(r=>({image:crop(image,r),rect:{x:r.x/width,y:r.y/height,w:r.w/width,h:r.h/height}}));
    for(const d of details.slice(0,1))if(d?.image?.width>=40&&d.image.height>=40&&d.image.width<=640&&d.image.height<=640&&d.image.data.length===d.image.width*d.image.height*4&&d.rect&&['x','y','w','h'].every(k=>Number.isFinite(d.rect[k]))&&d.rect.x>=0&&d.rect.y>=0&&d.rect.w>0&&d.rect.h>0&&d.rect.x+d.rect.w<=1.00001&&d.rect.y+d.rect.h<=1.00001){inputs.unshift(d);detailSearched=true;}
    const used=new Set();for(const input of inputs)for(const raw of locator.detect(input.image)){const r=input.rect,p=raw.map(p=>({x:(r.x+p.x/input.image.width*r.w)*width,y:(r.y+p.y/input.image.height*r.h)*height}));if(!valid(p,width,height))continue;
     let match=null,best=Infinity,ordered;for(const t of tracks){const a=near(t.points,p);if(a&&a.score<best){match=t;best=a.score;ordered=a.points;}}
     if(match){if(!used.has(match.id)){match.points=ordered;match.seen=match.detectedAt=at;used.add(match.id);}}
     else if(tracks.length<8){tracks.push({id:++serial,points:p,seen:at,detectedAt:at});used.add(serial);}
    }lastDetection=at;
   }
   tracks=tracks.filter(t=>at-t.seen<500&&at-t.detectedAt<900);previous=current;last=at;
   return tracks.map(t=>({id:t.id,points:t.points.map(p=>({x:p.x/width,y:p.y/height})),at:t.seen,detectedAt:t.detectedAt}));
  }};
 }
 const api={bank,engine,valid,align,near,area,detailRegion};root.ARQrTracker=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
