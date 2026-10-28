/* GBX1 v1: exact Exporto GbxCodec/BakedPrimitive contract, little endian, feet Z-up.
 * No scene fixtures, camera, renderer, network or payload transport here. */
(function(root){
 'use strict';
 const earcut=typeof module==='object'&&module.exports?require('./vendor/gbx-earcut.js'):root.ARGbxEarcut;
 const LIMITS=Object.freeze({raw:32*1024*1024,objects:10000,vertices:1000000,indices:3000000,triangles:50000,loops:256,contourPoints:4096,renderGroups:256});
 const GRID=1e7,TOL=4/GRID,fail=m=>{throw Error('GBX1: '+m);};
 const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,k)=>a.map(v=>v*k),dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=a=>Math.hypot(...a);
 function evenRound(v){const f=Math.floor(v),d=v-f;return d===.5?(f%2===0?f:f+1):Math.round(v);}
 function dropAxis(n){const q=n.map(v=>evenRound(Math.abs(v)*1e9));return q[0]>=q[1]&&q[0]>=q[2]?0:q[1]>=q[2]?1:2;}
 function project(p,drop){return (drop===0?[p[1],p[2]]:drop===1?[p[2],p[0]]:[p[0],p[1]]).map(v=>evenRound(v*GRID));}
 function lift(p,n,d,drop){const u=p[0]/GRID,v=p[1]/GRID;return drop===0?[(d-n[1]*u-n[2]*v)/n[0],u,v]:drop===1?[v,(d-n[2]*u-n[0]*v)/n[1],u]:[u,v,(d-n[0]*u-n[1]*v)/n[2]];}
 const determinant=(a,b,c)=>{const x=BigInt(b[0]-a[0]),y=BigInt(b[1]-a[1]),u=BigInt(c[0]-a[0]),v=BigInt(c[1]-a[1]);return x*v-y*u;};
 function sign(a,b,c){const x=b[0]-a[0],y=b[1]-a[1],u=c[0]-a[0],v=c[1]-a[1],d=x*v-y*u;
  return Math.abs(d)>(Math.abs(x*v)+Math.abs(y*u))*Number.EPSILON*8?Math.sign(d):Number(determinant(a,b,c)>0n)-Number(determinant(a,b,c)<0n);
 }
 function on(a,b,p){return !sign(a,b,p)&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);}
 function intersects(a,b,c,d){const s=sign(a,b,c),t=sign(a,b,d),u=sign(c,d,a),v=sign(c,d,b);return s*t<0&&u*v<0||!s&&on(a,b,c)||!t&&on(a,b,d)||!u&&on(c,d,a)||!v&&on(c,d,b);}
 function area2(p){let s=0n;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];s+=BigInt(a[0])*BigInt(b[1])-BigInt(b[0])*BigInt(a[1]);}return s;}
 function inside(p,ring){let value=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[j],b=ring[i];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])value=!value;
 }return value;}
 function caps(contours,n){
  const drop=dropAxis(n);if(n[drop]<=0)fail('extrusion axis is not canonical positive');
  const d=dot(n,contours[0][0]),rings=contours.map((points,id)=>{
   if(points.some(p=>Math.abs(dot(n,p)-d)>TOL))fail('non-planar extrusion contour');
   const q=points.map(p=>project(p,drop)),a=area2(q);if(a===0n)fail('zero contour area');
   for(let i=0;i<q.length;i++)if(!sign(q[(i+q.length-1)%q.length],q[i],q[(i+1)%q.length]))fail('collapsed/collinear contour edge');
   return{id,q,a,abs:a<0n?-a:a,parent:null,depth:0};
  });
  // Bounded by contourPoints; adaptive exact integer predicates near roundoff.
  const edges=rings.flatMap(r=>r.q.map((a,i)=>({ring:r.id,i,a,b:r.q[(i+1)%r.q.length],count:r.q.length})));
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
   const a=edges[i],b=edges[j];if(a.ring===b.ring&&(Math.abs(a.i-b.i)===1||Math.abs(a.i-b.i)===a.count-1))continue;
   if(Math.max(a.a[0],a.b[0])<Math.min(b.a[0],b.b[0])||Math.max(b.a[0],b.b[0])<Math.min(a.a[0],a.b[0])||Math.max(a.a[1],a.b[1])<Math.min(b.a[1],b.b[1])||Math.max(b.a[1],b.b[1])<Math.min(a.a[1],a.b[1]))continue;
   if(intersects(a.a,a.b,b.a,b.b))fail('intersecting/touching contour edges');
  }
  for(const r of rings)for(const other of rings)if(other.abs>r.abs&&inside(r.q[0],other.q)&&(!r.parent||other.abs<r.parent.abs))r.parent=other;
  for(const r of rings){for(let p=r.parent;p;p=p.parent){if(++r.depth>LIMITS.loops)fail('contour nesting limit');}if((r.a>0n)!==(r.depth%2===0))fail('invalid contour winding');}
  const triangles=[];
  for(const outer of rings.filter(r=>r.depth%2===0)){
   const holes=rings.filter(r=>r.parent===outer),all=[outer,...holes],points=all.flatMap(r=>r.q),flat=[],starts=[];let at=0;
   for(const r of all){if(at)starts.push(at);for(const p of r.q)flat.push(p[0]-outer.q[0][0],p[1]-outer.q[0][1]);at+=r.q.length;}
   const indices=earcut.triangulate(flat,starts,2),expected=(points.length+2*holes.length-2)*3;
   if(!indices.length||indices.length%3||indices.length>expected)fail('incomplete contour triangulation');
   const faces=[];for(let i=0;i<indices.length;i+=3)faces.push(indices.slice(i,i+3).map(j=>points[j]));
   // Earcut may filter collinear bridge vertices between aligned holes. Insert every
   // contour vertex on all incident cap edges, so side walls never meet a T-junction.
   for(const p of points)for(let i=0,limit=faces.length;i<limit;i++){
    const t=faces[i];if(t.some(q=>q[0]===p[0]&&q[1]===p[1]))continue;
    for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],c=t[(j+2)%3];
     if(p[0]<Math.min(a[0],b[0])||p[0]>Math.max(a[0],b[0])||p[1]<Math.min(a[1],b[1])||p[1]>Math.max(a[1],b[1])||sign(a,b,p))continue;
     faces[i]=[a,p,c];faces.push([p,b,c]);break;
    }
   }
   if(faces.length*3!==expected)fail('incomplete conforming cap triangulation');
   let covered=0n;
   for(const face of faces){let [a,b,c]=face,s=determinant(a,b,c);if(s===0n)fail('degenerate cap triangle');if(s<0n){[b,c]=[c,b];s=-s;}
    const center=[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3];if(!inside(center,outer.q)||holes.some(h=>inside(center,h.q)))fail('triangulation crosses a hole');
    covered+=s;triangles.push([a,b,c].map(p=>lift(p,n,d,drop)));
   }
   if(covered!==all.reduce((s,r)=>s+r.a,0n))fail('triangulation coverage mismatch');
  }
  return triangles;
 }
 function closedPositive(mesh){
  const edges=new Map(),p=mesh.positions,origin=p.slice(0,3);let volume=0;
  const point=i=>p.slice(i*3,i*3+3),key=p=>p.map(x=>evenRound(x*GRID)).join(',');
  for(let i=0;i<mesh.indices.length;i+=3){const t=[0,1,2].map(j=>point(mesh.indices[i+j]));volume+=dot(sub(t[0],origin),cross(sub(t[1],origin),sub(t[2],origin)))/6;
   const keys=t.map(key);for(let j=0;j<3;j++){const a=keys[j],b=keys[(j+1)%3];if(a===b)fail('collapsed primitive edge');const forward=a<b,k=forward?a+'|'+b:b+'|'+a,value=edges.get(k)||[0,0];value[0]++;value[1]+=forward?1:-1;edges.set(k,value);}
  }
  if(!Number.isFinite(volume)||volume<=1e-12||[...edges.values()].some(e=>e[0]!==2||e[1]!==0))fail('primitive is not closed/outward');
 }
 function decode(input){
  if(!(input instanceof Uint8Array)||input.length<20||input.length>LIMITS.raw)fail('invalid raw size');
  const v=new DataView(input.buffer,input.byteOffset,input.byteLength);let at=0,totalVertices=0,totalIndices=0;
  const need=n=>{if(n<0||n>input.length-at)fail('truncated data');};
  const u8=()=>{need(1);return v.getUint8(at++);},u16=()=>{need(2);const n=v.getUint16(at,true);at+=2;return n;},i32=()=>{need(4);const n=v.getInt32(at,true);at+=4;return n;},f64=()=>{need(8);const n=v.getFloat64(at,true);at+=8;if(!Number.isFinite(n))fail('non-finite double');return n;};
  const count=(max,stride)=>{const n=i32();if(n<1||n>max||n*stride>input.length-at)fail('count/remaining byte limit');return n;};
  const point=()=>{const p=[f64(),f64(),f64()];if(p.some(x=>Math.abs(x)>1e6))fail('coordinate limit');return p;};
  if([u8(),u8(),u8(),u8()].join(',')!=='71,66,88,49'||u16()!==1||u16()!==0)fail('unsupported version/flags');
  const scale=f64();if(scale<=0)fail('invalid scale');const number=count(LIMITS.objects,5),meshes=[];let boxes=0,extrusions=0,fallbacks=0;
  function budget(nv,ni){if(totalVertices+nv>LIMITS.vertices||totalIndices+ni>LIMITS.indices||(totalIndices+ni)/3>LIMITS.triangles)fail('expanded geometry/render limit; model not truncated');}
  for(let object=0;object<number;object++){
   const kind=u8(),rgba=[u8(),u8(),u8(),u8()],mesh={positions:[],indices:[],rgba,kind};
   const triangle=(a,b,c)=>{budget(mesh.positions.length/3+3,mesh.indices.length+3);if(![...a,...b,...c].every(Number.isFinite)||length(cross(sub(b,a),sub(c,a)))<1e-15)fail('degenerate triangle');const offset=mesh.positions.length/3;mesh.positions.push(...a,...b,...c);mesh.indices.push(offset,offset+1,offset+2);};
   if(kind===0){fallbacks++;const nv=count(LIMITS.vertices-totalVertices,24),ni=count(LIMITS.indices-totalIndices,4);if(ni%3)fail('incomplete mesh triangle');need(nv*24+ni*4);budget(nv,ni);
    for(let i=0;i<nv;i++)mesh.positions.push(...point());for(let i=0;i<ni;i++){const index=i32();if(index<0||index>=nv)fail('mesh index limit');mesh.indices.push(index);}
    for(let i=0;i<ni;i+=3){const p=[0,1,2].map(j=>mesh.positions.slice(mesh.indices[i+j]*3,mesh.indices[i+j]*3+3));if(length(cross(sub(p[1],p[0]),sub(p[2],p[0])))<1e-15)fail('degenerate mesh triangle');}
   }else if(kind===1){boxes++;const frame=[point(),point(),point(),point()];const axes=frame.slice(1),sizes=axes.map(length);if(sizes.some(x=>x<=TOL)||dot(cross(frame[1],frame[2]),frame[3])<=0||[[0,1],[1,2],[2,0]].some(([a,b])=>Math.abs(dot(mul(axes[a],1/sizes[a]),mul(axes[b],1/sizes[b])))>=1e-9))fail('invalid box orientation/axes');budget(36,36);
    const p=Array.from({length:8},(_,i)=>add(add(add(frame[0],mul(frame[1],i&1)),mul(frame[2],(i>>1)&1)),mul(frame[3],(i>>2)&1)));
    for(const f of [[0,2,3,1],[4,5,7,6],[0,1,5,4],[2,6,7,3],[0,4,6,2],[1,3,7,5]]){triangle(p[f[0]],p[f[1]],p[f[2]]);triangle(p[f[0]],p[f[2]],p[f[3]]);}closedPositive(mesh);
   }else if(kind===2){extrusions++;const vector=point(),len=length(vector);if(len<=TOL)fail('short extrusion');const loops=count(LIMITS.loops,4),contours=[];let points=0;
    for(let j=0;j<loops;j++){const n=count(LIMITS.contourPoints-points,24);if(n<3)fail('short contour');points+=n;contours.push(Array.from({length:n},point));}
    budget(points*12,points*12);const cap=caps(contours,mul(vector,1/len));
    for(const [a,b,c]of cap){triangle(a,c,b);triangle(add(a,vector),add(b,vector),add(c,vector));}
    for(const contour of contours)for(let i=0;i<contour.length;i++){const a=contour[i],b=contour[(i+1)%contour.length],aa=add(a,vector),bb=add(b,vector);triangle(a,b,bb);triangle(a,bb,aa);}closedPositive(mesh);
   }else fail('unsupported primitive kind');
   totalVertices+=mesh.positions.length/3;totalIndices+=mesh.indices.length;meshes.push(mesh);
  }
  if(at!==input.length)fail('extra bytes');
  // Exactly ArSheetEncoder normalization: feet -> meters*scale; (x,z,-y), bottom-center all referenced geometry.
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(const m of meshes){const source=m.positions;m.positions=new Float64Array(source.length);for(let i=0;i<source.length;i+=3){m.positions[i]=source[i]*.3048*scale;m.positions[i+1]=source[i+2]*.3048*scale;m.positions[i+2]=-source[i+1]*.3048*scale;}if(!m.positions.every(Number.isFinite))fail('coordinate overflow');for(const index of m.indices)for(let a=0;a<3;a++){const x=m.positions[index*3+a];bounds.min[a]=Math.min(bounds.min[a],x);bounds.max[a]=Math.max(bounds.max[a],x);}m.indices=Uint32Array.from(m.indices);}
  const originMeters=[bounds.min[0]/2+bounds.max[0]/2,bounds.min[1],bounds.min[2]/2+bounds.max[2]/2];
  for(const m of meshes)for(let i=0;i<m.positions.length;i++)m.positions[i]-=originMeters[i%3];
  bounds.min=bounds.min.map((x,i)=>x-originMeters[i]);bounds.max=bounds.max.map((x,i)=>x-originMeters[i]);const extent=bounds.min.map((x,i)=>bounds.max[i]-x);if(!extent.every(Number.isFinite))fail('extent overflow');
  // Match the existing CBX render contract: exact RGBA batching, no welding or loss.
  const groups=new Map(),records=[];for(const m of meshes){const key=m.rgba.join(',');let g=groups.get(key);if(!g){if(groups.size>=LIMITS.renderGroups)fail('render material/group limit; model not truncated');g={id:groups.size,rgba:m.rgba.slice(),parts:[],vertices:0,indices:0};groups.set(key,g);}records.push({kind:m.kind,group:g.id,firstVertex:g.vertices,vertexCount:m.positions.length/3,firstIndex:g.indices,indexCount:m.indices.length,rgba:m.rgba.slice()});g.parts.push(m);g.vertices+=m.positions.length/3;g.indices+=m.indices.length;}
  const batched=[...groups.values()].map(g=>{const positions=new Float64Array(g.vertices*3),indices=new Uint32Array(g.indices);let vertex=0,index=0;for(const m of g.parts){positions.set(m.positions,vertex*3);for(let j=0;j<m.indices.length;j++)indices[index+j]=m.indices[j]+vertex;vertex+=m.positions.length/3;index+=m.indices.length;}return{positions,indices,rgba:g.rgba};});
  return{meshes:batched,records,objects:number,vertices:totalVertices,triangles:totalIndices/3,bounds,extent,originMeters,scale,units:'m',up:'Y',rawBytes:input.length,excluded:['UV/textures and PBR are not represented by GBX1; RGBA preserved','No BIM metadata or paper-marker placement in GBX1'],primitives:{boxes,extrusions,meshes:fallbacks}};
 }
 const api={decode,LIMITS};if(typeof module==='object'&&module.exports)module.exports=api;else root.ARGbx=api;
})(typeof globalThis==='object'?globalThis:this);
