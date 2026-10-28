const {test}=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib'),crypto=require('node:crypto');
const codec=require('../../qr-geometry.js'),usd=require('../../usdz.js'),files=require('../../model-files.js'),{encode,box,extrusion}=require('../../test/gbx-helpers.cjs');
function packets(raw,magic='QRL3'){
 const compressed=zlib.gzipSync(raw),hash=crypto.createHash('sha256').update(compressed).digest(),count=Math.ceil(compressed.length/857),length=Math.ceil(compressed.length/count),all=[];
 for(let i=0;i<count;i++){const body=compressed.subarray(i*length,(i+1)*length),p=Buffer.alloc(48+body.length);p.write(magic);hash.copy(p,4);p.writeUInt32LE(compressed.length,36);p.writeUInt16LE(i,40);p.writeUInt16LE(count,42);p.writeUInt32LE(body.length,44);body.copy(p,48);all.push(p);}return all;
}
const collect=p=>{const c=new codec.Collector();p.forEach(x=>c.add(x));return c;};
test('QRL3 gzip GBX1 -> SHA verification -> universal meshes -> standalone USDZ/GLB',async()=>{
 const raw=encode([box(),extrusion()]),parts=packets(raw),c=collect(parts.reverse());assert.equal(c.add(parts[0]).duplicate,true);assert.equal(c.join().version,3);
 const scene=await codec.restore(c.join());assert.equal(scene.codec,'gzip-gbx1');assert.equal(scene.rawBytes,raw.length);assert.deepEqual(scene.primitives,{boxes:1,extrusions:1,meshes:0});
 const meshes=codec.usdzMeshes(scene),usdz=Buffer.from(usd.build(meshes)),glb=Buffer.from(files.glb(meshes));assert.equal(usdz.readUInt32LE(0),0x04034b50);assert.equal(glb.readUInt32LE(0),0x46546c67);
 const json=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString());assert.ok(json.materials.some(m=>m.alphaMode==='BLEND'));assert.equal(json.accessors.filter(a=>a.type==='VEC3').reduce((n,a)=>n+a.count,0),scene.triangles*6);assert.match(usdz.toString(),/inputs:opacity = 0.50196/);
});
test('QRL3 forbids cross-version combination, wrong payload type and any hash corruption',async()=>{
 const raw=encode([box()]),parts=packets(raw),c=collect(parts);const old=Buffer.from(parts[0]);old.write('QRL2');assert.throws(()=>c.add(old),/другой модели/);
 await assert.rejects(codec.restore(collect(packets(raw,'QRL2')).join()),/QRL3/);await assert.rejects(codec.restore(collect(packets(Buffer.from('CBX1invalid'))).join()),/QRL3/);
 const bad=c.join();bad.compressed[bad.compressed.length-1]^=1;await assert.rejects(codec.restore(bad),/SHA-256/);
});
test('QRL3 bounds, unsupported GBX flags, missing parts and decompression bomb fail atomically',async()=>{
 const p=packets(encode([box()]))[0];for(const mutate of [b=>b.writeUInt16LE(0,42),b=>b.writeUInt16LE(7,42),b=>b.writeUInt16LE(9,40),b=>b.writeUInt32LE(5143,36),b=>b.writeUInt32LE(858,44)]){const b=Buffer.from(p);mutate(b);assert.throws(()=>codec.packet(b));}
 const raw=encode([box()]);raw.writeUInt16LE(1,6);await assert.rejects(codec.restore(collect(packets(raw)).join()),/version\/flags/);
 const compressed=zlib.gzipSync(Buffer.alloc(32*1024*1024+1));await assert.rejects(codec.restore({compressed,hash:crypto.createHash('sha256').update(compressed).digest('hex'),count:1,version:3}),/32 МиБ/);
});
module.exports={packets};

test('QRL3 multi-part scene assembles in arbitrary order, missing parts never restore',async()=>{
 const points=Array.from({length:90},(_,i)=>[Math.sin(i*12.345),Math.cos(i*5.678),Math.sin(i*7.891)]),raw=encode([{kind:0,rgba:[10,20,30,40],points,faces:Array.from({length:90},(_,i)=>i)}]),p=packets(raw);assert.ok(p.length>1&&p.length<=6);
 const c=collect(p.slice(1).reverse());assert.throws(()=>c.join(),/Не все/);c.add(p[0]);assert.equal(c.add(p[0]).duplicate,true);const scene=await codec.restore(c.join());assert.equal(scene.triangles,30);assert.equal(scene.qrCount,p.length);
});
