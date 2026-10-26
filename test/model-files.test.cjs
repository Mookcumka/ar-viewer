const {test}=require('node:test'),assert=require('node:assert/strict'),files=require('../model-files.js');
function parse(bytes){const b=Buffer.from(bytes);assert.equal(b.readUInt32LE(0),0x46546c67);assert.equal(b.readUInt32LE(4),2);assert.equal(b.readUInt32LE(8),b.length);const n=b.readUInt32LE(12);assert.equal(n%4,0);assert.equal(b.readUInt32LE(16),0x4e4f534a);const json=JSON.parse(b.subarray(20,20+n).toString()),offset=20+n;assert.equal(b.readUInt32LE(offset+4),0x004e4942);assert.equal(b.readUInt32LE(offset),b.length-offset-8);return{json,bin:b.subarray(offset+8)};}
test('GLB is self-contained glTF2 with binary positions, normals and linear RGBA',()=>{
 const scene=[{positions:[0,0,0,2,0,0,0,3,0],color:[128,64,255],opacity:.5},{positions:[0,0,1,1,0,1,0,1,1],linearColor:[.25,.5,.75],opacity:1}];
 const {json:j,bin}=parse(files.glb(scene));assert.equal(j.buffers[0].uri,undefined);assert.equal(j.buffers[0].byteLength,bin.length);assert.equal(j.meshes.length,2);assert.equal(j.scenes[0].nodes.length,2);
 assert.equal(j.materials[0].alphaMode,'BLEND');assert.equal(j.materials[0].pbrMetallicRoughness.baseColorFactor[3],.5);assert.deepEqual(j.materials[1].pbrMetallicRoughness.baseColorFactor,[.25,.5,.75,1]);
 const a=j.accessors[j.meshes[0].primitives[0].attributes.POSITION],v=j.bufferViews[a.bufferView];assert.deepEqual(Array.from(new Float32Array(bin.buffer,bin.byteOffset+v.byteOffset,a.count*3)),scene[0].positions);assert.deepEqual(a.min,[0,0,0]);assert.deepEqual(a.max,[2,3,0]);assert.ok(j.accessors.every(a=>a.componentType===5126));assert.ok(j.bufferViews.every(v=>v.byteOffset%4===0));
 assert.ok(!JSON.stringify(j).includes('http'));assert.equal(j.nodes.some(n=>'scale'in n),false);
});
test('bad/empty/float32-collapsed geometry and invalid materials fail rather than truncate',()=>{
 for(const m of [[],[{positions:[0,0,0],color:[1,2,3]}],[{positions:[0,0,0,NaN,1,0,0,0,1],color:[1,2,3]}],[{positions:[1e10,0,0,1e10+1,0,0,1e10,1,0],color:[1,2,3]}],[{positions:[0,0,0,1,0,0,0,1,0],linearColor:[2,0,0]}]])assert.throws(()=>files.glb(m));
});
module.exports={parse};
