/* Screen-space QR acquisition/tracking/validation feedback. One existing video, no camera/zoom controls. */
(function(root){
 'use strict';
 function create({svg,emit=()=>{},onTargets=()=>{}}){
  const bank=ARQrTracker.bank(),nodes=new Map();let video=null,worker=null,epoch=0,seq=0,pending=null,timer=0,raf=0,size='',active=false,run=0,region=0,tracked=[],focusedPasses=0;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true}),detailCanvas=document.createElement('canvas'),detailCtx=detailCanvas.getContext('2d',{willReadFrequently:true});
  function clear(){epoch++;pending=null;size='';tracked=[];focusedPasses=0;bank.reset();svg.replaceChildren();nodes.clear();worker?.postMessage({type:'reset'});onTargets(0,[]);}
  function fallback(reason){worker?.terminate();worker=null;pending=null;emit({mode:'decoded-only',reason});}
  function capture(){
   if(!active||!video?.videoWidth||video.readyState<2||video.paused||document.hidden||!ctx)return;
   if(pending){if(performance.now()-pending.at>1200)fallback('worker-timeout');else return;}
   if(!worker)return;
   const scale=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight)),w=Math.max(40,Math.round(video.videoWidth*scale)),h=Math.max(40,Math.round(video.videoHeight*scale));
   if(size!==w+'x'+h){clear();size=w+'x'+h;}
   try{
    canvas.width=w;canvas.height=h;ctx.drawImage(video,0,0,w,h);const image=ctx.getImageData(0,0,w,h),at=performance.now();pending={seq:++seq,at};
    // Revisit an acquired dense target before its 900ms detection freshness expires.
    // Other frames continue the global search; no extra camera and no display zoom.
    const focus=focusedPasses<2?tracked.filter(t=>at-t.at<500&&at-t.detectedAt>=300).sort((a,b)=>a.detectedAt-b.detectedAt)[0]:null;
    pending.search=!focus;
    const buffers=[image.data.buffer],details=[],r=ARQrTracker.detailRegion(video.videoWidth,video.videoHeight,region,focus?.points);
    if(r&&detailCtx){detailCanvas.width=r.width;detailCanvas.height=r.height;detailCtx.drawImage(video,r.x,r.y,r.w,r.h,0,0,r.width,r.height);const pixels=detailCtx.getImageData(0,0,r.width,r.height);details.push({width:r.width,height:r.height,rect:r.rect,buffer:pixels.data.buffer});buffers.push(pixels.data.buffer);}
    worker.postMessage({type:'frame',epoch,seq,at,width:w,height:h,buffer:image.data.buffer,details},buffers);
   }catch(error){pending=null;emit({mode:'frame-skipped',reason:error.name||'Error'});}

  }
  function draw(){
   if(!active)return;
   const targets=bank.sample(performance.now()),visible=new Set(),box=svg.getBoundingClientRect(),rects=[];
   if(video?.videoWidth&&box.width&&box.height){
    svg.setAttribute('viewBox','0 0 '+box.width+' '+box.height);
    for(const t of targets){
     let node=nodes.get(t.id);if(!node){node=document.createElementNS('http://www.w3.org/2000/svg','polygon');node.dataset.track=String(t.id);nodes.set(t.id,node);svg.append(node);}
     const frame={width:video.videoWidth,height:video.videoHeight},points=t.points.map(p=>({x:p.x*frame.width,y:p.y*frame.height}));
     const mapped=ARScanFeedback.map(points,frame,video.getBoundingClientRect(),box,getComputedStyle(video).objectFit);
     node.setAttribute('points',mapped.map(p=>p.x+','+p.y).join(' '));node.dataset.kind=t.state;node.style.opacity=String(t.opacity);visible.add(t.id);
     // Screen box of the tracked quadrilateral: the viewer's search hint flies onto it.
     const xs=mapped.map(p=>p.x),ys=mapped.map(p=>p.y);rects.push({x:box.left+Math.min(...xs),y:box.top+Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys),state:t.state});
    }
   }
   for(const [id,node]of nodes)if(!visible.has(id)){node.remove();nodes.delete(id);}
   onTargets(visible.size,rects);raf=requestAnimationFrame(draw);
  }
  return {
   start(source){
    this.stop();video=source;active=true;epoch++;region=0;
    try{
     worker=new Worker('./qr-track-worker.js');const ownWorker=worker,ownRun=run;
     worker.onmessage=event=>{const m=event.data;if(!active||m.epoch!==epoch||m.seq!==pending?.seq)return;
      const searched=pending.search;pending=null;if(m.detailSearched){if(searched){region=(region+1)%6;focusedPasses=0;}else focusedPasses++;}if(m.type==='error'){fallback(m.message);return;}
      const now=performance.now();if(now-m.at>350)return;tracked=m.targets||[];
      for(const t of m.targets||[]){const x=bank.observe(t.points,t.at,null,t.detectedAt===t.at);if(x)x.detectedAt=Math.max(x.detectedAt,t.detectedAt);}
      emit({mode:'locator-flow',tracks:m.targets.length,latencyMs:Math.round(now-m.at),sourceWidth:video.videoWidth,sourceHeight:video.videoHeight,overviewWidth:canvas.width,overviewHeight:canvas.height,detailRegions:Math.max(video.videoWidth,video.videoHeight)>640?6:0});
     };
     worker.onerror=event=>{event.preventDefault();if(active&&worker===ownWorker&&run===ownRun)fallback('worker-error');};
    }catch(_){fallback('worker-unavailable');}
    timer=setInterval(capture,80);capture();raf=requestAnimationFrame(draw);
   },
   clear,
   hit(points,frame,state='decoded',key='',at=performance.now()){
    if(!active||!video||!frame.width||!frame.height)return;
    const normalized=points.map(p=>({x:p.x/frame.width,y:p.y/frame.height}));
    const now=performance.now();if(now-at>350)return;
    bank.mark(normalized,at,state,key,now);
   },
   stop(){run++;active=false;clearInterval(timer);cancelAnimationFrame(raf);worker?.terminate();worker=null;clear();video=null;}
  };
 }
 root.ARQrOverlay={create};
})(typeof globalThis!=='undefined'?globalThis:this);
