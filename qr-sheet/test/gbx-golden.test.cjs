/* Frozen production C# GBX/QRL3 goldens, Exporto e61028be67c937587056f1a3c53c0ee95adc07b8.
 * Tests cover software interoperability, NOT Revit execution or physical iPhone/Android. */
const{test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib');
const codec=require('../../qr-geometry.js'),usd=require('../../usdz.js'),files=require('../../model-files.js'),vectors=require('./gbx1-v1.json');
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),sub=(a,b)=>a.map((x,i)=>x-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const triangles=m=>Array.from({length:m.indices.length/3},(_,i)=>[0,1,2].map(j=>Array.from(m.positions.subarray(m.indices[i*3+j]*3,m.indices[i*3+j]*3+3))));
function contains(p,t,normal){const n=cross(sub(t[1],t[0]),sub(t[2],t[0])),size=Math.hypot(...n);if(dot(n,normal)<=0||Math.abs(dot(n,sub(p,t[0])))/size>1e-9)return false;
 const a=sub(t[1],t[0]),b=sub(t[2],t[0]),q=sub(p,t[0]),aa=dot(a,a),bb=dot(b,b),ab=dot(a,b),aq=dot(a,q),bq=dot(b,q),d=aa*bb-ab*ab,u=(bb*aq-ab*bq)/d,v=(aa*bq-ab*aq)/d;return u>=-1e-8&&v>=-1e-8&&u+v<=1+1e-8;}
function area(t){return Math.hypot(...cross(sub(t[1],t[0]),sub(t[2],t[0])))/2;}
function compareSurface(a,b){near(a.reduce((s,t)=>s+area(t),0),b.reduce((s,t)=>s+area(t),0),1e-8);for(const [source,target]of [[a,b],[b,a]])for(const t of source){const n=cross(sub(t[1],t[0]),sub(t[2],t[0]));
 for(const w of [[1/3,1/3,1/3],[.8,.1,.1],[.1,.8,.1],[.1,.1,.8],[.5,.5,0],[0,.5,.5],[.5,0,.5]]){const p=[0,1,2].map(k=>w.reduce((s,x,i)=>s+x*t[i][k],0));assert.ok(target.some(other=>contains(p,other,n)),'surface or normal mismatch');}}
}
for(const fixture of vectors)test(`C# GBX1/QRL3 golden ${fixture.Name}: bytes, surfaces, RGBA, scale, USDZ and GLB`,async()=>{
 const raw=Buffer.from(fixture.Raw,'base64');assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),fixture.RawSha256.toLowerCase());
 const c=new codec.Collector(),packets=fixture.Packets.map(p=>Buffer.from(p,'base64'));for(const p of packets.slice().reverse())c.add(p);assert.equal(c.add(packets[0]).duplicate,true);
 assert.deepEqual(zlib.gunzipSync(c.join().compressed),raw);const scene=await codec.restore(c.join());assert.equal(scene.codec,'gzip-gbx1');assert.equal(scene.objects,fixture.Expected.length);assert.equal(scene.scale,fixture.Scale);
 assert.deepEqual(scene.primitives,{boxes:fixture.Boxes,extrusions:fixture.Extrusions,meshes:fixture.MeshFallbacks});assert.equal(scene.records.length,fixture.Expected.length);
 const expected=fixture.Expected.map(e=>({positions:Float64Array.from(e.PositionsFt.flatMap(([x,y,z])=>[x*.3048*fixture.Scale,z*.3048*fixture.Scale,-y*.3048*fixture.Scale])),indices:e.Indices,rgba:e.Rgba}));
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const m of expected)for(const i of m.indices)for(let a=0;a<3;a++){min[a]=Math.min(min[a],m.positions[i*3+a]);max[a]=Math.max(max[a],m.positions[i*3+a]);}
 const origin=[min[0]/2+max[0]/2,min[1],min[2]/2+max[2]/2];origin.forEach((x,i)=>near(scene.originMeters[i],x));
 for(const m of expected)for(let i=0;i<m.positions.length;i++)m.positions[i]-=origin[i%3];
 for(let i=0;i<expected.length;i++){const r=scene.records[i],group=scene.meshes[r.group],actual={positions:group.positions,indices:group.indices.subarray(r.firstIndex,r.firstIndex+r.indexCount)};assert.deepEqual(r.rgba,expected[i].rgba);compareSurface(triangles(actual),triangles(expected[i]));
  if(r.kind===0){assert.deepEqual(Array.from(actual.indices,x=>x-r.firstVertex),expected[i].indices);Array.from(group.positions.subarray(r.firstVertex*3,(r.firstVertex+r.vertexCount)*3)).forEach((x,j)=>assert.equal(x,expected[i].positions[j]));}
 }
 const meshes=codec.usdzMeshes(scene),usdz=Buffer.from(usd.build(meshes)),glb=Buffer.from(files.glb(meshes));const offset=30+usdz.readUInt16LE(26)+usdz.readUInt16LE(28),n=usdz.readUInt32LE(22);assert.equal(offset%64,0);assert.equal(usd.crc32(usdz.subarray(offset,offset+n)),usdz.readUInt32LE(14));assert.equal(glb.readUInt32LE(0),0x46546c67);
 const doc=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString());assert.equal(doc.meshes.length,scene.meshes.length);doc.materials.forEach((m,i)=>near(m.pbrMetallicRoughness.baseColorFactor[3],scene.meshes[i].rgba[3]/255));assert.equal(doc.accessors.filter((_,i)=>i%2===0).reduce((s,a)=>s+a.count,0),scene.triangles*3);
});
