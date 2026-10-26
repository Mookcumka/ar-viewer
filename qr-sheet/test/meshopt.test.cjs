// Numeric C# golden unit fixtures only. Never production geometry or proof of a Revit run.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
global.MeshoptDecoder=require('../../vendor/meshopt_decoder.js');
const C=require('../../qr-geometry.js'),V=JSON.parse(fs.readFileSync(path.join(__dirname,'meshopt-vectors.json')));
function collect(packets){const c=new C.Collector();packets.forEach(p=>c.add(Uint8Array.from(p)));return c;}
function triangles(s){const result=[];for(const m of s.meshes)for(let i=0;i<m.indices.length;i+=3){const p=[0,1,2].map(j=>Array.from(m.positions.subarray(m.indices[i+j]*3,m.indices[i+j]*3+3)).join(','));result.push(m.rgba.join(',')+':'+[p.join('|'),[p[1],p[2],p[0]].join('|'),[p[2],p[0],p[1]].join('|')].sort()[0]);}return result.sort();}
for(const v of V)test(`QRL2 native C# -> official WASM: ${v.name}`,async()=>{
 const s=await C.restore(collect(v.packets.slice().reverse()).join());assert.equal(s.triangles,v.expected.Triangles);assert.equal(s.vertices,v.expected.Vertices);assert.equal(s.codec,v.expected.Codec);
 assert.equal(v.packets.length,Math.ceil(s.compressedBytes/857));C.usdzMeshes(s);
 if(v.legacyPackets){const old=await C.restore(collect(v.legacyPackets).join());assert.deepEqual(triangles(s),triangles(old));assert.deepEqual(s.originMeters,old.originMeters);assert.equal(s.scale,old.scale);}
 else{assert.equal(v.expected.LegacyFitsBudget,false);assert.equal(v.expected.LegacyQrCount,0);}
});
test('new frames preserve missing-parts, corruption, conflicts and reject mixing v1/v2',async()=>{
 const v=V.find(v=>v.packets.length===4),c=collect([v.packets[0]]);assert.throws(()=>c.join(),/Не все/);c.add(Uint8Array.from(v.packets[0]));assert.equal(c.parts.size,1);
 const old=v.packets[0].slice();old[3]=49;assert.throws(()=>c.add(Uint8Array.from(old)));
 const parts=v.packets.map(p=>p.slice());parts.at(-1)[48]^=1;await assert.rejects(()=>C.restore(collect(parts).join()),/SHA-256/);
});
function repack(raw){const compressed=zlib.gzipSync(raw);return{compressed,hash:crypto.createHash('sha256').update(compressed).digest('hex'),count:1};}
function rawMesh(){const v=V.find(x=>x.expected.Codec.startsWith('meshopt'));return zlib.gunzipSync(Buffer.concat(v.packets.map(p=>Buffer.from(p).subarray(48))));}
function alter(f){const raw=rawMesh(),n=raw.readUInt32LE(4),meta=JSON.parse(raw.subarray(8,8+n)),geometry=Buffer.from(raw.subarray(8+n));f(meta,geometry);const json=Buffer.from(JSON.stringify(meta)),head=Buffer.alloc(8);head.write('CBX2');head.writeUInt32LE(json.length,4);return Buffer.concat([head,json,geometry]);}
test('CBX2 malformed layout, topology and codec fail explicitly',async()=>{
 for(const change of [m=>m.codec='unknown',m=>m.meshes[0].vertices=1000001,m=>m.meshes[0].offset=1,m=>m.meshes[0].vertexBytes=0,m=>m.nodes[0].matrix[0]=2,m=>m.meshes[0].rgba[0]=-1])await assert.rejects(()=>C.restore(repack(alter(change))));
 await assert.rejects(()=>C.restore(repack(alter((m,g)=>g.fill(0)))) ,/meshoptimizer/);
});
test('missing meshopt decoder gives actionable error while legacy still restores',async()=>{
 const old=global.MeshoptDecoder;delete global.MeshoptDecoder;
 try{await assert.rejects(()=>C.restore(repack(rawMesh())),/Обновите AR Viewer/);assert.equal((await C.restore(collect(V[0].legacyPackets).join())).triangles,12);}finally{global.MeshoptDecoder=old;}
});
