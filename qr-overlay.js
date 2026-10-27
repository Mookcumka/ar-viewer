/* Screen-space QR acquisition/tracking/validation feedback. One existing video, no camera/zoom controls. */
(function(root){
 'use strict';
 function create({svg,emit=()=>{},onTargets=()=>{}}){
  const bank=ARQrTracker.bank(),nodes=new Map();let video=null,worker=null,epoch=0,seq=0,pending=null,timer=0,raf=0,size='',active=false,run=0;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  function clear(){epoch++;pending=null;size='';bank.reset();svg.replaceChildren();nodes.clear();worker?.postMessage({type:'reset'});onTargets(0);}
  function fallback(reason){worker?.terminate();worker=null;pending=null;emit({mode:'decoded-only',reason});}
  function capture(){
   if(!active||!video?.videoWidth||video.readyState<2||video.paused||document.hidden||!ctx)return;
   if(pending){if(performance.now()-pending.at>1200)fallback('worker-timeout');else return;}
   if(!worker)return;
   const scale=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight)),w=Math.max(40,Math.round(video.videoWidth*scale)),h=Math.max(40,Math.round(video.videoHeight*scale));
   if(size!==w+'x'+h){clear();size=w+'x'+h;}
   try{
    canvas.width=w;canvas.height=h;ctx.drawImage(video,0,0,w,h);const image=ctx.getImageData(0,0,w,h),at=performance.now();pending={seq:++seq,at};
    worker.postMessage({type:'frame',epoch,seq,at,width:w,height:h,buffer:image.data.buffer},[image.data.buffer]);
   }catch(error){pending=null;emit({mode:'frame-skipped',reason:error.name||'Error'});}

  }
  function draw(){
   if(!active)return;
   const targets=bank.sample(performance.now()),visible=new Set(),box=svg.getBoundingClientRect();
   if(video?.videoWidth&&box.width&&box.height){
    svg.setAttribute('viewBox','0 0 '+box.width+' '+box.height);
    for(const t of targets){
     let node=nodes.get(t.id);if(!node){node=document.createElementNS('http://www.w3.org/2000/svg','polygon');node.dataset.track=String(t.id);nodes.set(t.id,node);svg.append(node);}
     const frame={width:video.videoWidth,height:video.videoHeight},points=t.points.map(p=>({x:p.x*frame.width,y:p.y*frame.height}));
     const mapped=ARScanFeedback.map(points,frame,video.getBoundingClientRect(),box,getComputedStyle(video).objectFit);
     node.setAttribute('points',mapped.map(p=>p.x+','+p.y).join(' '));node.dataset.kind=t.state;node.style.opacity=String(t.opacity);visible.add(t.id);
    }
   }
   for(const [id,node]of nodes)if(!visible.has(id)){node.remove();nodes.delete(id);}
   onTargets(visible.size);raf=requestAnimationFrame(draw);
  }
  return {
   start(source){
    this.stop();video=source;active=true;epoch++;
    try{
     worker=new Worker('./qr-track-worker.js');const ownWorker=worker,ownRun=run;
     worker.onmessage=event=>{const m=event.data;if(!active||m.epoch!==epoch||m.seq!==pending?.seq)return;
      pending=null;if(m.type==='error'){fallback(m.message);return;}
      const now=performance.now();if(now-m.at>350)return;
      for(const t of m.targets||[]){const x=bank.observe(t.points,t.at,null,t.detectedAt===t.at);if(x)x.detectedAt=Math.max(x.detectedAt,t.detectedAt);}
      emit({mode:'locator-flow',tracks:m.targets.length,latencyMs:Math.round(now-m.at)});
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
