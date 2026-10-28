/* GBX2 unit tests: hand-built records, not evidence of a Revit export. */
const {test}=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const gbx2=require('../gbx2-geometry.js');const {volume,close}=require('./gbx-helpers.cjs');
const W=[235,235,230,255],B=[245,240,225,255],E=[200,200,200,255],D=[120,80,50,255];
const scene=(records,palette=[W,B,E,D])=>gbx2.write({palette,records});
const decode=(r,o)=>gbx2.decode(scene(r),o);
const mm=x=>x*1e-9; // mm^3 -> m^3
test('box: yaw keeps size, volume and outward faces',async()=>{
 for(const yaw of [0,8192,30000]){const s=await decode([{kind:'box',color:0,origin:[5000,0,5000],yaw,size:[2000,3000,4000]}]);
  assert.equal(s.triangles,12);close(volume(s),24,1e-5);close(s.bounds.min[1],0);close(s.extent[1],3,1e-6);}
});
test('wall: window hole, door notch and mitered ends give the exact solid',async()=>{
 const wall={kind:'wall',color:0,colorB:1,colorEdge:2,a:[1000,1000],b:[8000,1000],t:300,e0:300,e1:-300,y0:0,h:2700,
  openings:[{u0:1500,v0:900,w:1500,h:1500},{u0:5000,v0:0,w:900,h:2100}]};
 const s=await decode([wall]);
 const plan=0.3*(7+6.4)/2;close(volume(s),plan*2.7-0.3*(1.5*1.5+0.9*2.1),1e-5);
 assert.deepEqual(s.meshes.map(m=>m.rgba),[W,B,E]);assert.deepEqual(s.primitives,{boxes:0,prisms:0,walls:1,instances:0,meshes:0});
 const flipped=await decode([{...wall,t:-300}]);close(volume(flipped),volume(s),1e-5);
});
test('wall: rejects openings that leave the wall or overlap',async()=>{
 const base={kind:'wall',color:0,a:[0,0],b:[4000,0],t:200,y0:0,h:2700};
 for(const o of [[{u0:0,v0:0,w:900,h:2100}],[{u0:3500,v0:0,w:900,h:2100}],[{u0:100,v0:900,w:500,h:1800}],[{u0:500,v0:0,w:900,h:2100},{u0:1200,v0:900,w:500,h:500}]])
  await assert.rejects(decode([{...base,openings:o}]),/проём/);
});
test('prism: slab with a hole and two outer contours',async()=>{
 const sq=(x,z,s)=>[[x,z],[x+s,z],[x+s,z+s],[x,z+s]];
 const s=await decode([{kind:'prism',color:0,y0:0,h:200,loops:[sq(0,0,4000),sq(1000,1000,1000).reverse(),sq(6000,0,1000)]}]);
 close(volume(s),0.2*(16-1+1),1e-5);
});
test('instance: library door/window/wc build in place, unknown code and newer library rejected',async()=>{
 const s=await decode([{kind:'instance',color:3,code:1,origin:[1000,0,1000],yaw:16384,params:[900,2100,120,1]},
  {kind:'instance',color:0,code:2,origin:[3000,900,1000],params:[1500,1500,300]},{kind:'instance',color:0,code:10,origin:[0,0,0]}]);
 assert.deepEqual(s.families,{door:1,window:1,wc:1});assert.equal(s.primitives.instances,3);assert.ok(s.triangles>100);
 const unknown=await decode([{kind:'box',color:0,origin:[0,0,0],size:[1000,1000,1000]},{kind:'instance',color:0,code:999,origin:[5000,0,0],params:[800,600,2000]}]);
 assert.equal(unknown.primitives.boxes,1);assert.match(unknown.warnings[0],/999 неизвестно.*серый габарит/);close(unknown.extent[1],2,1e-6);
 await assert.rejects(gbx2.decode(gbx2.write({libVersion:99,palette:[W],records:[{kind:'box',color:0,origin:[0,0,0],size:[1,1,1]}]})),/Обновите/);
});
test('instance: export scale shrinks library sizes with the model',async()=>{
 const full=await decode([{kind:'instance',color:0,code:24,origin:[0,0,0]}]);
 const half=await gbx2.decode(gbx2.write({scale:0.5,palette:[W],records:[{kind:'instance',color:0,code:24,origin:[0,0,0]}]}));
 close(full.extent[1],2.2,1e-9);close(half.extent[1],1.1,1e-9);
});
test('mesh: raw u16 codec keeps indices; degenerate triangle rejected',async()=>{
 const s=await decode([{kind:'mesh',color:0,points:[[0,0,0],[1000,0,0],[0,1000,0]],faces:[0,1,2]}]);assert.equal(s.triangles,1);close(s.extent[0],1,1e-6);
 await assert.rejects(decode([{kind:'mesh',color:0,points:[[0,0,0],[1000,0,0],[2000,0,0]],faces:[0,1,2]}]),/вырожден/);
});
test('rejects every truncation, trailing byte, bad palette index and version',async()=>{
 const raw=scene([{kind:'wall',color:0,a:[0,0],b:[4000,0],t:200,y0:0,h:2700,openings:[{u0:500,v0:0,w:900,h:2100}]},{kind:'instance',color:3,code:1,origin:[1000,0,0]}]);
 await gbx2.decode(raw);
 for(let i=0;i<raw.length;i++)await assert.rejects(gbx2.decode(raw.subarray(0,i)));
 await assert.rejects(gbx2.decode(Uint8Array.from([...raw,0])),/лишние/);
 for(const [at,value] of [[4,2],[5,1]]){const b=raw.slice();b[at]=value;await assert.rejects(gbx2.decode(b));}
});
// Apartment shell from the 28.10 estimate (7x5 m, 7 walls, 6 openings, slab, 4 doors, 2 windows, 7 furniture items).
function apartment(){
 const T=300,t=120,H=2700,w=(a,b,th,openings=[],color=0)=>({kind:'wall',color,colorB:1,colorEdge:2,a,b,t:th,y0:200,h:H,openings});
 return [w([0,0],[7000,0],-T,[{u0:1000,v0:900,w:1500,h:1500},{u0:4200,v0:900,w:1500,h:1500}]),w([7000,0],[7000,5000],-T,[{u0:2000,v0:900,w:1200,h:1500}]),
  w([7000,5000],[0,5000],-T,[{u0:1100,v0:0,w:900,h:2100}]),w([0,5000],[0,0],-T),w([3000,300],[3000,4700],t,[{u0:2500,v0:0,w:800,h:2100}],1),
  w([300,3000],[3000,3000],t,[{u0:1500,v0:0,w:700,h:2100}],1),w([3120,2500],[6700,2500],t,[{u0:500,v0:0,w:800,h:2100}],1),
  {kind:'prism',color:2,y0:0,h:200,loops:[[[0,0],[7000,0],[7000,5000],[0,5000]]]},
  ...[[5450,5000,0,900],[3000,3200,16384,800],[2150,3000,0,700],[3920,2500,0,800]].map(([x,z,yaw,wd])=>({kind:'instance',color:3,code:1,origin:[x,200,z],yaw,params:[wd,2100,120]})),
  ...[[1750,1500],[4950,1500]].map(([x,wd])=>({kind:'instance',color:0,code:2,origin:[x,1100,0],params:[wd,1500,300]})),
  {kind:'instance',color:0,code:21,origin:[1500,200,4700],yaw:32768},{kind:'instance',color:0,code:22,origin:[5100,200,1400]},{kind:'instance',color:0,code:20,origin:[4800,200,4700],yaw:32768},
  {kind:'instance',color:0,code:25,origin:[1550,200,300]},{kind:'instance',color:0,code:26,origin:[1550,1700,300]},{kind:'instance',color:0,code:10,origin:[6000,200,2550]},{kind:'instance',color:0,code:11,origin:[5000,200,2620]}];
}
test('apartment shell with furniture fits two QR (<=1778 compressed bytes)',async()=>{
 const raw=scene(apartment()),packed=zlib.deflateRawSync(raw,{level:9}),s=await gbx2.decode(raw);
 console.log(`GBX2 apartment: raw ${raw.length} B, deflate-raw ${packed.length} B, ${s.triangles} triangles, ${Math.ceil(packed.length/889)} QR`);
 assert.ok(packed.length<=2*889);assert.equal(s.primitives.walls,7);
});

// Reference QRL4 framing (Exporto must produce identical bytes): deflate-raw, SHA-256 prefix, <=889-byte slices.
function qrl4(raw,chunks){const z=zlib.deflateRawSync(raw,{level:9}),hash=require('node:crypto').createHash('sha256').update(z).digest().subarray(0,8);
 const count=chunks||Math.ceil(z.length/889),size=Math.ceil(z.length/count);
 return Array.from({length:count},(_,i)=>{const body=z.subarray(i*size,Math.min(z.length,(i+1)*size)),h=Buffer.alloc(16);h.write('QRL4');hash.copy(h,4);h.writeUInt16LE(z.length,12);h[14]=i;h[15]=count;return new Uint8Array(Buffer.concat([h,body]));});}
test('QRL4 packets collect in any order and restore the GBX2 scene end to end',async()=>{
 const qr=require('../qr-geometry.js');globalThis.crypto??=require('node:crypto').webcrypto;
 const raw=scene(apartment()),packets=qrl4(raw,2),c=new qr.Collector();
 for(const p of packets.slice().reverse())c.add(p);assert.equal(c.add(packets[0]).duplicate,true);
 const s=await qr.restore(c.join());assert.equal(s.codec,'deflate-gbx2');assert.equal(s.qrCount,2);assert.equal(s.primitives.walls,7);assert.equal(qr.usdzMeshes(s).length,s.meshes.length);assert.equal(qr.usdzMeshes(s).length,s.meshes.length);
 const bad=packets[1].slice();bad[bad.length-1]^=1;const d=new qr.Collector();d.add(packets[0]);d.add(bad);await assert.rejects(qr.restore(d.join()),/SHA-256/);
 assert.throws(()=>qr.packet(Uint8Array.from([...packets[0].subarray(0,15)])),/QRL4/);
});
test('library v2: every family builds from defaults and decodes in place',async()=>{
 const lib=require('../gbx2-library.js');assert.equal(lib.VERSION,2);
 for(const code of Object.keys(lib.FAMILIES).map(Number)){
  const s=await decode([{kind:'instance',color:0,code,origin:[0,0,0]}]);
  assert.equal(s.primitives.instances,1,lib.FAMILIES[code].name);assert.ok(s.triangles>=12,lib.FAMILIES[code].name);
  close(s.bounds.min[1],0,1e-9);
 }
});
