/* Scan feedback/coordinates only. No scene geometry, camera ownership or tracking. */
(function(root){
  'use strict';
  const corners = qr => ['topLeftCorner','topRightCorner','bottomRightCorner','bottomLeftCorner'].map(k=>qr.location?.[k]);
  // Mask only this frame's decoded quadrilateral. An AABB can erase a neighbour on a tilted sheet.
  function mask(image, points) {
    if(points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))return false;
    const {width:w,height:h,data}=image;
    let changed=false;
    for(let y=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y))));y<Math.min(h,Math.ceil(Math.max(...points.map(p=>p.y))));y++){
      const xs=[],cy=y+.5;
      for(let i=0;i<4;i++){const a=points[i],b=points[(i+1)%4];if((a.y<=cy&&b.y>cy)||(b.y<=cy&&a.y>cy))xs.push(a.x+(cy-a.y)*(b.x-a.x)/(b.y-a.y));}
      xs.sort((a,b)=>a-b);
      for(let i=0;i+1<xs.length;i+=2)for(let x=Math.max(0,Math.floor(xs[i]));x<Math.min(w,Math.ceil(xs[i+1]));x++){const at=(y*w+x)*4;data[at]=data[at+1]=data[at+2]=data[at+3]=255;changed=true;}
    }
    return changed;
  }
  function regions(w,h){
    const result=[{x:0,y:0,width:w,height:h}];
    for(const [cols,rows] of [[3,2],[2,2]])for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const left=Math.max(0,Math.floor((x-.18)*w/cols)),top=Math.max(0,Math.floor((y-.18)*h/rows));
      result.push({x:left,y:top,width:Math.min(w,Math.ceil((x+1.18)*w/cols))-left,height:Math.min(h,Math.ceil((y+1.18)*h/rows))-top});
    }
    result.push({x:Math.floor(w*.15),y:Math.floor(h*.15),width:Math.floor(w*.7),height:Math.floor(h*.7)});return result;
  }
  function crop(image,r){
    if(r.x===0&&r.y===0&&r.width===image.width&&r.height===image.height)return image;
    const data=new Uint8ClampedArray(r.width*r.height*4);
    for(let y=0;y<r.height;y++){const at=((y+r.y)*image.width+r.x)*4;data.set(image.data.subarray(at,at+r.width*4),y*r.width*4);}
    return{data,width:r.width,height:r.height};
  }
  // A generator yields to UI/cancellation between bounded decoder calls. Whole-frame jsQR can
  // fail on many finder patterns; overlapping crops isolate candidates without another camera.
  // Mask ALL decoded codes (including launch/duplicates) in THIS snapshot only.
  function* scan(image, decode, limit=12, offset=0){
    const all=regions(image.width,image.height),start=((offset%all.length)+all.length)%all.length;
    const views=Array.from({length:Math.max(1,Math.min(12,limit))},(_,i)=>all[(start+i)%all.length]);
    for(const region of views){
      // jsQR returns one code per call. After masking it, read the SAME region again so a launch QR or an
      // already accepted part does not hide the next code beside it until a later frame.
      const seen=[];
      for(let pass=0;pass<3;pass++){
        const part=crop(image,region),found=decode(part.data,part.width,part.height,{inversionAttempts:'dontInvert'});if(!found){if(!pass)yield {qr:null,points:[]};break;}
        const location={...found.location};
        for(const key of ['topLeftCorner','topRightCorner','bottomRightCorner','bottomLeftCorner'])if(location[key])location[key]={x:location[key].x+region.x,y:location[key].y+region.y};
        const qr={...found,location},points=corners(qr);
        // The same quadrilateral again means the mask did not hide it: stop instead of re-reading it.
        const bytes=String(found.binaryData||found.data||'');
        if(pass&&points.every(p=>p)&&seen.some(q=>q.bytes===bytes&&q.points.every((c,i)=>Math.abs(c.x-points[i].x)<2&&Math.abs(c.y-points[i].y)<2)))break;
        seen.push({points,bytes});const masked=mask(image,points);yield{qr,points};if(!masked)break;
      }
    }
  }
  function map(points, frame, rect, overlay, fit='fill'){
    let w=rect.width,h=rect.height,x=rect.left-overlay.left,y=rect.top-overlay.top;
    if(fit==='cover'||fit==='contain'){const s=(fit==='cover'?Math.max:Math.min)(w/frame.width,h/frame.height);const nw=frame.width*s,nh=frame.height*s;x+=(w-nw)/2;y+=(h-nh)/2;w=nw;h=nh;}
    return points.map(p=>({x:x+p.x/frame.width*w,y:y+p.y/frame.height*h}));
  }
  function progress(count, received){const have=Array.from(new Set(received)).filter(n=>Number.isInteger(n)&&n>=1&&n<=count).sort((a,b)=>a-b);return{have,missing:Array.from({length:count},(_,i)=>i+1).filter(n=>!have.includes(n))};}
  const api={scan,map,progress};if(typeof module==='object'&&module.exports)module.exports=api;else root.ARScanFeedback=api;
})(typeof globalThis==='object'?globalThis:this);
