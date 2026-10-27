/* Byte construction here is unit-only, NOT evidence of a Revit export. C# goldens tested separately. */
const {test}=require('node:test'),assert=require('node:assert/strict');const gbx=require('../gbx-geometry.js');
const {encode,box,extrusion,outer,hole,volume,close}=require('./gbx-helpers.cjs');
test('GBX1 box preserves rotation, outward faces, feet->metres, export scale, bottom-center',()=>{
 const c=Math.sqrt(.5),o=box([[100,-200,30],[2*c,2*c,0],[-3*c,3*c,0],[0,0,4]]),scene=gbx.decode(encode([o],.5));
 assert.equal(scene.triangles,12);assert.equal(scene.vertices,36);assert.deepEqual(scene.meshes[0].rgba,o.rgba);assert.deepEqual(scene.primitives,{boxes:1,extrusions:0,meshes:0});
 close(volume(scene),24*Math.pow(.3048*.5,3));close(scene.bounds.min[1],0);close(scene.bounds.min[0],-scene.bounds.max[0]);close(scene.extent[1],4*.3048*.5);assert.equal(scene.up,'Y');
 const mirrored=gbx.decode(encode([box([[0,0,0],[-2,0,0],[0,0,4],[0,3,0]])]));close(volume(mirrored),24*Math.pow(.3048,3));
});
test('GBX1 extrusion retains hole and material alpha with correct volume and cap coverage',()=>{
 const scene=gbx.decode(encode([extrusion()]));assert.equal(scene.triangles,32);close(volume(scene),12*Math.pow(.3048,3));assert.equal(scene.meshes[0].rgba[3],128);
 const m=scene.meshes[0];for(let i=0;i<m.indices.length;i+=3){const p=[0,1,2].map(j=>Array.from(m.positions.subarray(m.indices[i+j]*3,m.indices[i+j]*3+3)));if(p.every(q=>Math.abs(q[1]-p[0][1])<1e-12)){const x=p.reduce((s,q)=>s+q[0],0)/3,z=p.reduce((s,q)=>s+q[2],0)/3;assert.ok(!(Math.abs(x)<.3048&&Math.abs(z)<.3048),'cap triangle centroid fills hole');}}
});
test('GBX1 wall window and arbitrary mesh mix preserve all objects without category-specific code',()=>{
 const wall=extrusion([outer,hole].map(c=>c.map(([x,y])=>[y,0,x])),[0,.5,0]);const mesh={kind:0,rgba:[200,150,10,0],points:[[0,0,0],[1,0,0],[0,1,2]],faces:[0,1,2]};
 const scene=gbx.decode(encode([box(),wall,mesh],.1));assert.equal(scene.meshes.length,3);assert.deepEqual(scene.primitives,{boxes:1,extrusions:1,meshes:1});assert.deepEqual(Array.from(scene.meshes[2].indices),mesh.faces);assert.equal(scene.meshes[2].rgba[3],0);
});
test('GBX1 nested island, disjoint outer loops, multiple holes and arbitrary contour order',()=>{
 const offset=(c,x)=>c.map(p=>[p[0]+x,p[1],p[2]]),island=[[1.5,1.5,0],[2.5,1.5,0],[2.5,2.5,0],[1.5,2.5,0]];
 const scene=gbx.decode(encode([extrusion([hole,offset(outer,10),island,outer]) ]));close(volume(scene),(12+16+1)*Math.pow(.3048,3));
});
test('GBX1 aligned multiple window holes have conforming caps and stay empty',()=>{
 const o=[[0,0,0],[10,0,0],[10,10,0],[0,10,0]],h=x=>[[x,1,0],[x,2,0],[x+1,2,0],[x+1,1,0]];
 const scene=gbx.decode(encode([extrusion([o,h(1),h(3)],[0,0,2])]));close(volume(scene),196*Math.pow(.3048,3));assert.equal(scene.triangles,52);
});
test('GBX1 batches identical RGBA without dropping objects and bounds unique draw groups',()=>{
 const scene=gbx.decode(encode(Array.from({length:100},()=>box())));assert.equal(scene.meshes.length,1);assert.equal(scene.objects,100);assert.equal(scene.triangles,1200);
 assert.throws(()=>gbx.decode(encode(Array.from({length:257},(_,i)=>box(undefined,[i%256,i>>8,0,255])))),/group limit/);
});
test('GBX1 rejects every truncation, trailing bytes, versions, flags, kinds, nonfinite scale/coordinates',()=>{
 const raw=encode([box()]);for(let i=0;i<raw.length;i++)assert.throws(()=>gbx.decode(raw.subarray(0,i)));
 assert.throws(()=>gbx.decode(Buffer.concat([raw,Buffer.from([0])])),/extra/);
 for(const [at,value,fn]of [[4,2,'writeUInt16LE'],[6,1,'writeUInt16LE'],[8,NaN,'writeDoubleLE'],[8,Infinity,'writeDoubleLE'],[8,0,'writeDoubleLE'],[20,9,'writeUInt8'],[25,Infinity,'writeDoubleLE'],[25,1000001,'writeDoubleLE'],[16,10001,'writeInt32LE']]){const b=Buffer.from(raw);b[fn](value,at);assert.throws(()=>gbx.decode(b));}
});
test('GBX1 rejects invalid primitive orientation and degeneracy instead of silently repairing geometry',()=>{
 for(const o of [box([[0,0,0],[1,0,0],[0,1,0],[0,0,-1]]),box([[0,0,0],[1,0,0],[1,0,0],[0,0,1]]),extrusion([outer],[0,0,-1]),extrusion([outer],[0,0,0]),extrusion([outer.map(p=>[...p]).map((p,i)=>i===1?[p[0],p[1],.1]:p)])])assert.throws(()=>gbx.decode(encode([o])));
});
test('GBX1 rejects crossing/touching/reversed/collinear contours and hole winding errors',()=>{
 const bad=[[[0,0,0],[4,4,0],[0,4,0],[4,0,0]],outer.slice().reverse(),[[0,0,0],[2,0,0],[4,0,0],[4,4,0],[0,4,0]]];for(const c of bad)assert.throws(()=>gbx.decode(encode([extrusion([c])])));
 assert.throws(()=>gbx.decode(encode([extrusion([outer,hole.slice().reverse()])])),/winding/);
 const touch=hole.map(p=>[p[0]-1,p[1],p[2]]);assert.throws(()=>gbx.decode(encode([extrusion([outer,touch])])),/touching/);
});
test('GBX1 mesh invalid count/index/triangle and render expansion cap reject atomically',()=>{
 const mesh={kind:0,rgba:[0,0,0,255],points:[[0,0,0],[1,0,0],[0,1,0]],faces:[0,1,9]};assert.throws(()=>gbx.decode(encode([mesh])),/index/);
 mesh.faces=[0,0,1];assert.throws(()=>gbx.decode(encode([mesh])),/degenerate/);mesh.faces=[0,1];assert.throws(()=>gbx.decode(encode([mesh])),/incomplete/);
 assert.throws(()=>gbx.decode(encode(Array.from({length:4167},()=>box()))),/render limit/);
});
