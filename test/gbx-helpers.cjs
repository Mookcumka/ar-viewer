const assert=require('node:assert/strict');
const box=(frame=[[0,0,0],[2,0,0],[0,3,0],[0,0,4]],rgba=[20,90,180,255])=>({kind:1,frame,rgba});
const outer=[[0,0,0],[4,0,0],[4,4,0],[0,4,0]],hole=[[1,1,0],[1,3,0],[3,3,0],[3,1,0]];
const extrusion=(contours=[outer,hole],vector=[0,0,1])=>({kind:2,vector,contours,rgba:[128,20,90,128]});
function encode(objects,scale=1){const chunks=[];function b(n,fn,value){const a=Buffer.alloc(n);a[fn](value);chunks.push(a);}const i=n=>b(4,'writeInt32LE',n),d=n=>b(8,'writeDoubleLE',n),p=point=>point.forEach(d);chunks.push(Buffer.from('GBX1'));b(2,'writeUInt16LE',1);b(2,'writeUInt16LE',0);d(scale);i(objects.length);
 for(const o of objects){chunks.push(Buffer.from([o.kind,...o.rgba]));if(o.kind===1)o.frame.forEach(p);else if(o.kind===2){p(o.vector);i(o.contours.length);for(const c of o.contours){i(c.length);c.forEach(p);}}else{i(o.points.length);i(o.faces.length);o.points.forEach(p);o.faces.forEach(i);}}return Buffer.concat(chunks);
}
const volume=scene=>scene.meshes.reduce((sum,m)=>{let v=0;for(let i=0;i<m.indices.length;i+=3){const p=[0,1,2].map(j=>Array.from(m.positions.subarray(m.indices[i+j]*3,m.indices[i+j]*3+3)));v+=(p[0][0]*(p[1][1]*p[2][2]-p[1][2]*p[2][1])+p[0][1]*(p[1][2]*p[2][0]-p[1][0]*p[2][2])+p[0][2]*(p[1][0]*p[2][1]-p[1][1]*p[2][0]))/6;}return sum+v;},0);
const close=(a,b,e=1e-10)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
module.exports={encode,box,extrusion,outer,hole,volume,close};
