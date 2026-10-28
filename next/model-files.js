/* Local standalone model files. No model URL, network request or embedded scene. */
(function(root){
  'use strict';
  const CAP=32*1024*1024;
  function triangles(group,THREE){
    group.updateWorldMatrix(true,true);
    const inverse=group.matrixWorld.clone().invert(),result=[];
    group.traverse(o=>{
      if(!o.isMesh)return;
      if(Array.isArray(o.material))throw Error('Несколько материалов в одном меше не поддержаны экспортом');
      const geometry=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();
      try{
        const matrix=inverse.clone().multiply(o.matrixWorld);geometry.applyMatrix4(matrix);
        const a=geometry.getAttribute('position');if(!a||a.count%3)throw Error('Неполная треугольная геометрия');
        const positions=new Float32Array(a.count*3);
        for(let i=0;i<a.count;i++){positions[i*3]=a.getX(i);positions[i*3+1]=a.getY(i);positions[i*3+2]=a.getZ(i);}
        if(matrix.determinant()<0)for(let i=0;i<positions.length;i+=9)for(let k=0;k<3;k++)[positions[i+3+k],positions[i+6+k]]=[positions[i+6+k],positions[i+3+k]];
        // Every supported QR contains triangles and constant RGBA, not textures/UV or BIM properties.
        const color=o.userData.rgb||[255,255,255],m=o.material;
        const linearColor=o.userData.linearColor||[m.color.r,m.color.g,m.color.b];
        result.push({positions,color,linearColor,opacity:o.userData.opacity??m.opacity??1,precisePositions:true,
          roughness:m.roughness??.75,metalness:m.metalness??0,doubleSided:m.side===THREE.DoubleSide});
      }finally{geometry.dispose();}
    });
    if(!result.length)throw Error('В модели нет треугольников');
    return result;
  }
  function glb(meshes){
    const doc={asset:{version:'2.0',generator:'Exporto AR Viewer'},scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],materials:[],buffers:[{byteLength:0}],bufferViews:[],accessors:[]};
    const chunks=[];let length=0;
    function add(data){
      const index=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:length,byteLength:data.byteLength,target:34962});
      chunks.push(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));length+=data.byteLength;return index;
    }
    for(const m of meshes){
      const positions=Float32Array.from(m.positions);if(!positions.length||positions.length%9||!positions.every(Number.isFinite))throw Error('Недопустимые координаты GLB');
      if(length+positions.byteLength*2>CAP)throw Error('GLB превышает 32 МиБ; модель не обрезана');
      const normal=new Float32Array(positions.length),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
      for(let i=0;i<positions.length;i+=9){
        const p=positions,u=[p[i+3]-p[i],p[i+4]-p[i+1],p[i+5]-p[i+2]],v=[p[i+6]-p[i],p[i+7]-p[i+1],p[i+8]-p[i+2]];
        const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],size=Math.hypot(...n);
        if(!Number.isFinite(size)||size===0)throw Error('GLB float32 схлопывает треугольник; модель не изменена');
        for(let j=0;j<3;j++)for(let k=0;k<3;k++)normal[i+j*3+k]=n[k]/size;
      }
      for(let i=0;i<positions.length;i++) {const a=i%3;min[a]=Math.min(min[a],positions[i]);max[a]=Math.max(max[a],positions[i]);}
      const rgb=m.linearColor||m.color.map(x=>{const c=x/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}),alpha=m.opacity??1;
      if([...rgb,alpha,m.roughness??.75,m.metalness??0].some(x=>!Number.isFinite(x)||x<0||x>1))throw Error('Недопустимый материал GLB');
      const material=doc.materials.length;doc.materials.push({pbrMetallicRoughness:{baseColorFactor:[...rgb,alpha],roughnessFactor:m.roughness??.75,metallicFactor:m.metalness??0},doubleSided:m.doubleSided!==false,alphaMode:alpha<1?'BLEND':'OPAQUE'});
      const position=doc.accessors.length;doc.accessors.push({bufferView:add(positions),componentType:5126,count:positions.length/3,type:'VEC3',min,max});
      const normals=doc.accessors.length;doc.accessors.push({bufferView:add(normal),componentType:5126,count:normal.length/3,type:'VEC3'});
      const index=doc.meshes.length;doc.meshes.push({primitives:[{attributes:{POSITION:position,NORMAL:normals},mode:4,material}]});doc.nodes.push({mesh:index});doc.scenes[0].nodes.push(index);
    }
    if(!doc.meshes.length)throw Error('Пустая модель GLB');doc.buffers[0].byteLength=length;
    const json=new TextEncoder().encode(JSON.stringify(doc)),jsonSize=(json.length+3)&~3,total=12+8+jsonSize+8+length;
    if(total>CAP)throw Error('GLB превышает 32 МиБ');
    const bytes=new Uint8Array(total),view=new DataView(bytes.buffer);view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,total,true);
    view.setUint32(12,jsonSize,true);view.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+jsonSize);bytes.set(json,20);
    const offset=20+jsonSize;view.setUint32(offset,length,true);view.setUint32(offset+4,0x004e4942,true);let cursor=offset+8;
    for(const c of chunks){bytes.set(c,cursor);cursor+=c.length;}return bytes;
  }
  const api={triangles,glb};root.ARModelFiles=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
