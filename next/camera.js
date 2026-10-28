/* Shared camera policy. No lens-label guessing, persisted IDs, second stream or manual focus distance. */
(function(root){
  'use strict';
  const keys=['width','height','aspectRatio','frameRate','facingMode','resizeMode','focusMode','zoom'];
  function read(track,method){try{return track?.[method]?.()||{};}catch{return {};}}
  function safe(value){
    const out={};for(const k of keys){const v=value[k];
      if(typeof v==='string'||typeof v==='number'||typeof v==='boolean')out[k]=v;
      else if(Array.isArray(v))out[k]=v.filter(x=>typeof x==='string'||typeof x==='number');
      else if(v&&typeof v==='object'){out[k]={};for(const n of ['min','max','step'])if(Number.isFinite(v[n]))out[k][n]=v[n];}
    }return out;
  }
  function snapshot(track){return {settings:safe(read(track,'getSettings')),capabilities:safe(read(track,'getCapabilities')),constraints:safeConstraints(read(track,'getConstraints')),readyState:track?.readyState||'unknown'};}
  function safeConstraints(value){
    const out=safe(value);for(const k of keys)if(value[k]&&typeof value[k]==='object'&&!Array.isArray(value[k])){
      for(const n of ['ideal','exact'])if(['string','number'].includes(typeof value[k][n]))(out[k]||={})[n]=value[k][n];
    }return out;
  }
  function request(supported={}){
    const video={facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}};
    // Native frames preferred; no viewport aspectRatio or digital crop-and-scale request.
    if(supported.resizeMode)video.resizeMode={ideal:'none'};
    return {audio:false,video};
  }
  async function configure(track,supported={},emit=()=>{},current=()=>true){
    const capabilities=read(track,'getCapabilities');
    const candidates=[];
    if(supported.focusMode&&Array.isArray(capabilities.focusMode)&&capabilities.focusMode.includes('continuous'))candidates.push(['focusMode','continuous']);
    const z=capabilities.zoom;
    if(supported.zoom&&z&&Number.isFinite(z.min)&&Number.isFinite(z.max)&&z.min>0&&z.max>=z.min){
      // 1 when advertised; otherwise the lowest advertised magnification. This is NOT an optical-lens selector.
      let value=z.min<=1&&z.max>=1?1:z.min;
      if(Number.isFinite(z.step)&&z.step>0)value=z.min+Math.round((value-z.min)/z.step)*z.step;
      value=Math.min(z.max,Math.max(z.min,value));candidates.push(['zoom',value]);
    }
    let constraints=read(track,'getConstraints');
    for(const [name,value]of candidates){
      if(!current()||track.readyState==='ended')return;
      if(typeof track.applyConstraints!=='function')break;
      try{const next={...constraints,advanced:[...(constraints.advanced||[]),{[name]:value}]};await track.applyConstraints(next);constraints=next;emit('camera-control',{name,value,result:'resolved',observed:safe(read(track,'getSettings'))[name]});}
      catch(error){emit('camera-control',{name,value,result:'rejected',error:error.name||'Error'});}
    }
    if(current())emit('camera-parameters',snapshot(track));
  }
  function preview(video){
    const r=video.getBoundingClientRect(),w=video.videoWidth,h=video.videoHeight;
    const scale=w&&h?Math.min(r.width/w,r.height/h):0;
    return {intrinsic:{width:w,height:h},box:{width:r.width,height:r.height},fit:'contain',content:{width:w*scale,height:h*scale},cropped:false};
  }
  const api={request,configure,snapshot,preview};root.ARCamera=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
