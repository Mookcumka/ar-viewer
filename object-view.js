/* Ordinary 3D mode of the SAME viewer, entered only by an explicit AR/3D switch. */
(function(root){
 'use strict';
 function create({THREE,container}){
  let run=null;
  function end(){if(!run)return;const r=run;run=null;r.renderer.setAnimationLoop(null);r.listeners.forEach(f=>f());r.clone.removeFromParent();r.renderer.domElement.remove();r.renderer.dispose();}
  function start(group){
   end();const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true}),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.01,100);
   const clone=group.clone(true);clone.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(clone),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
   const extent=Math.max(size.x,size.y,size.z);if(!Number.isFinite(extent)||extent<=0){renderer.dispose();throw Error('Пустая 3D-модель');}
   const content=new THREE.Group();content.add(clone);clone.position.sub(center);content.scale.setScalar(1/extent);scene.add(content);
   scene.add(new THREE.HemisphereLight(0xffffff,0x777777,2));const light=new THREE.DirectionalLight(0xffffff,1);light.position.set(1,3,2);scene.add(light);
   renderer.setPixelRatio(Math.min(root.devicePixelRatio||1,2));renderer.setClearColor(0x111416,1);renderer.domElement.id='object-canvas';renderer.domElement.style.touchAction='none';container.append(renderer.domElement);
   const state=run={renderer,clone,listeners:[],yaw:.6,pitch:.35,distance:2.2,zoom:1,fit:2.2,pointers:new Map(),pinch:0};
   function listen(target,name,fn,options){target.addEventListener(name,fn,options);state.listeners.push(()=>target.removeEventListener(name,fn,options));}
   function resize(){renderer.setSize(root.innerWidth,root.innerHeight);camera.aspect=root.innerWidth/root.innerHeight;camera.updateProjectionMatrix();const half=Math.min(camera.fov*Math.PI/360,Math.atan(Math.tan(camera.fov*Math.PI/360)*camera.aspect));state.fit=(size.length()/extent/2)/Math.sin(half)*1.12;}resize();listen(root,'resize',resize);
   const gap=()=>{const a=[...state.pointers.values()];return a.length===2?Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y):0;};
   listen(renderer.domElement,'pointerdown',e=>{renderer.domElement.setPointerCapture(e.pointerId);state.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});state.pinch=gap();});
   listen(renderer.domElement,'pointermove',e=>{const before=state.pointers.get(e.pointerId);if(!before)return;state.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(state.pointers.size===1){state.yaw-=(e.clientX-before.x)*.008;state.pitch=Math.max(-1.4,Math.min(1.4,state.pitch+(e.clientY-before.y)*.008));}else{const next=gap();if(state.pinch>0&&next>0)state.zoom=Math.max(.25,Math.min(4,state.zoom*state.pinch/next));state.pinch=next;}});
   const release=e=>{state.pointers.delete(e.pointerId);state.pinch=0;};for(const n of ['pointerup','pointercancel','lostpointercapture'])listen(renderer.domElement,n,release);
   listen(renderer.domElement,'wheel',e=>{e.preventDefault();state.zoom=Math.max(.25,Math.min(4,state.zoom*Math.exp(e.deltaY*.001)));},{passive:false});
   renderer.setAnimationLoop(()=>{if(run!==state)return;state.distance=state.fit*state.zoom;camera.position.set(Math.sin(state.yaw)*Math.cos(state.pitch)*state.distance,Math.sin(state.pitch)*state.distance,Math.cos(state.yaw)*Math.cos(state.pitch)*state.distance);camera.lookAt(0,0,0);renderer.render(scene,camera);});
  }
  return {start,end,get active(){return !!run;}};
 }
 root.ARObjectView={create};
})(globalThis);
