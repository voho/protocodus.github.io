/* Static MP40 receiver detail in the authored model.
 * Original handle remains fixed in its exact authored position.
 * Prepare one cached body geometry; keep original atlas/material/two primitives. */
import * as THREE from 'three';

const SLOT = Object.freeze({
  min:[.009,.06125,-.055],max:[.06,.07075,.045],floorX:.0105,connectorX:.01025,
  // Existing dark matte MP40 atlas texel; no new material or texture.
  cavityUV:[151.5/1024,71.5/1024],
});
const prepared = new WeakMap(), owned = new WeakMap();

function solids(g) {
  const p=g.attributes.position, parent=Array.from({length:p.count},(_,i)=>i);
  const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const join=(a,b)=>{parent[root(a)]=root(b);}, coordinates=new Map();
  for(let i=0;i<p.count;i++){
    const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e5)).join(',');
    if(coordinates.has(key))join(i,coordinates.get(key));else coordinates.set(key,i);
  }
  for(let i=0;i<g.index.count;i+=3){join(g.index.getX(i),g.index.getX(i+1));join(g.index.getX(i),g.index.getX(i+2));}
  const result=new Map(), point=new THREE.Vector3();
  for(let i=0;i<p.count;i++){
    const id=root(i);if(!result.has(id))result.set(id,{bounds:new THREE.Box3(),faces:[]});
    result.get(id).bounds.expandByPoint(point.fromBufferAttribute(p,i));
  }
  for(let i=0;i<g.index.count;i+=3)result.get(root(g.index.getX(i))).faces.push(i);
  return [...result.values()];
}
const area=poly=>{
  let total=0;for(let i=1;i<poly.length-1;i++)total+=new THREE.Vector3(...poly[i].attrs.position).sub(new THREE.Vector3(...poly[0].attrs.position))
    .cross(new THREE.Vector3(...poly[i+1].attrs.position).sub(new THREE.Vector3(...poly[0].attrs.position))).length()/2;
  return total;
};
function split(poly,axis,value,sign){
  const inside=[],outside=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=(a.attrs.position[axis]-value)*sign,db=(b.attrs.position[axis]-value)*sign;
    const ia=da>=-1e-12,ib=db>=-1e-12;(ia?inside:outside).push(a);
    if(ia!==ib){const t=da/(da-db),v={original:null,attrs:Object.fromEntries(Object.keys(a.attrs).map(n=>[n,a.attrs[n].map((x,k)=>x+(b.attrs[n][k]-x)*t)]))};inside.push(v);outside.push(v);}
  }return{inside,outside};
}

export function prepareMP40ReceiverDetail(model) {
  if(model?.name!=='mp40')return model;
  if(owned.has(model)&&!owned.get(model).released)return model;
  const cached=prepared.get(model);
  if(cached&&!cached.released)return cached.model;
  const primitive=model.prims?.[0],g=primitive?.geometry;
  if(!g?.index||!g.attributes||Object.keys(g.attributes).length!==4)return model;
  for(const[name,size]of Object.entries({position:3,normal:3,uv:2,color:3})){
    const attribute=g.attributes[name];
    if(!attribute?.isBufferAttribute||!(attribute.array instanceof Float32Array)||attribute.normalized||attribute.itemSize!==size||attribute.count!==2754||!attribute.array.every(Number.isFinite))return model;
  }
  const indicesIn=g.index;
  if(indicesIn.itemSize!==1||indicesIn.normalized||indicesIn.count!==8184||!(indicesIn.array instanceof Uint16Array||indicesIn.array instanceof Uint32Array)||indicesIn.array.some(i=>i>=2754))return model;
  const parts=solids(g), stem=parts.find(({bounds:b,faces:f})=>f.length===32&&b.min.x>.0159&&b.max.x<.0321&&b.min.y>.0619&&b.max.y<.0701&&b.min.z>.0359&&b.max.z<.0441);
  const knob=parts.find(({bounds:b,faces:f})=>f.length===100&&b.min.x>.0311&&b.max.x<.0409&&b.min.y>.0587&&b.max.y<.0733&&b.min.z>.0327&&b.max.z<.0473);
  const receiver=parts.find(({bounds:b,faces:f})=>f.length===980&&b.min.x>-.0174&&b.max.x<.0174&&b.min.z>-.0781&&b.max.z>.4219);
  if(!stem||!knob||!receiver)return model;
  const receiverFaces=new Set(receiver.faces);
  const attrs=Object.fromEntries(Object.entries(g.attributes).map(([n,a])=>[n,Array.from(a.array)]));
  const vertex=i=>({original:i,attrs:Object.fromEntries(Object.entries(g.attributes).map(([n,a])=>[n,Array.from({length:a.itemSize},(_,k)=>a.getComponent(i,k))]))});
  const indices=[],newVertices=new Map();let affected=0;
  function index(v){
    if(v.original!==null)return v.original;
    // Newly clipped normals are interpolated; keep only new vertices unit length.
    v.attrs.normal = new THREE.Vector3(...v.attrs.normal).normalize().toArray();
    const key=JSON.stringify(v.attrs);if(newVertices.has(key))return newVertices.get(key);
    const i=attrs.position.length/3;for(const[n,a]of Object.entries(v.attrs))attrs[n].push(...a);newVertices.set(key,i);return i;
  }
  for(let t=0;t<g.index.count;t+=3){
    const original=[g.index.getX(t),g.index.getX(t+1),g.index.getX(t+2)];
    if(!receiverFaces.has(t)){indices.push(...original);continue;}
    let remain=original.map(vertex);const keep=[];
    for(let axis=0;axis<3;axis++)for(const[value,sign]of [[SLOT.min[axis],1],[SLOT.max[axis],-1]]){
      if(!remain.length)break;const halves=split(remain,axis,value,sign);if(halves.outside.length>=3)keep.push(halves.outside);remain=halves.inside;
    }
    if(remain.length<3||area(remain)<1e-12){indices.push(...original);continue;}
    affected++;
    for(const poly of keep)for(let k=1;k<poly.length-1;k++){
      const tri=[poly[0],poly[k],poly[k+1]];if(area(tri)>1e-12)indices.push(...tri.map(index));
    }
  }
  const clipIndices=indices.length;
  const edges=new Map(),pos=i=>attrs.position.slice(i*3,i*3+3),key=i=>pos(i).map(v=>Math.round(v*1e6)).join(',');
  for(let t=0;t<clipIndices;t+=3)for(let k=0;k<3;k++){
    const a=indices[t+k],b=indices[t+(k+1)%3],pa=pos(a),pb=pos(b);
    if(pa[0]<SLOT.min[0]||pb[0]<SLOT.min[0])continue;
    const axis=[1,2].find(axis=>[SLOT.min[axis],SLOT.max[axis]].some(v=>Math.abs(pa[axis]-v)<1e-7&&Math.abs(pb[axis]-v)<1e-7));
    if(axis===undefined)continue;
    const id=[key(a),key(b)].sort().join('|');if(edges.has(id))edges.get(id).count++;else edges.set(id,{a,b,axis,count:1});
  }
  const boundary=[...edges.values()].filter(e=>e.count===1);
  // Fail closed when a future source no longer has the measured authored cut.
  if (affected !== 66 || boundary.length !== 66) return model;
  function appendTriangle(target,targetIndices,vertices,wantedNormal,shade){
    const v=vertices.map(x=>({attrs:Object.fromEntries(Object.entries(x.attrs).map(([n,a])=>[n,[...a]]))}));
    const normal=new THREE.Vector3(...v[1].attrs.position).sub(new THREE.Vector3(...v[0].attrs.position))
      .cross(new THREE.Vector3(...v[2].attrs.position).sub(new THREE.Vector3(...v[0].attrs.position))).normalize();
    if(normal.dot(wantedNormal)<0){[v[1],v[2]]=[v[2],v[1]];normal.negate();}
    for(const x of v){x.attrs.normal=normal.toArray();x.attrs.uv=[...SLOT.cavityUV];x.attrs.color=x.attrs.color.map(c=>c*shade);const i=target.position.length/3;for(const[n,a]of Object.entries(x.attrs))target[n].push(...a);targetIndices.push(i);}
  }
  const atOutput=i=>({attrs:Object.fromEntries(Object.entries(g.attributes).map(([n,a])=>[n,attrs[n].slice(i*a.itemSize,(i+1)*a.itemSize)]))});
  for(const {a,b,axis}of boundary){
    const av=atOutput(a),bv=atOutput(b),ai=atOutput(a),bi=atOutput(b);ai.attrs.position[0]=bi.attrs.position[0]=SLOT.floorX;
    const normal=new THREE.Vector3();normal.setComponent(axis,Math.abs(av.attrs.position[axis]-SLOT.min[axis])<1e-7?1:-1);
    appendTriangle(attrs,indices,[av,bv,bi],normal,.62);appendTriangle(attrs,indices,[av,bi,ai],normal,.62);
  }
  const sample=atOutput(boundary[0].a),floor=[];
  for(const [y,z]of [[.06125,-.055],[.07075,-.055],[.07075,.045],[.06125,.045]]){
    const v={attrs:Object.fromEntries(Object.entries(sample.attrs).map(([n,a])=>[n,[...a]]))};v.attrs.position=[SLOT.floorX,y,z];floor.push(v);
  }
  appendTriangle(attrs,indices,[floor[0],floor[1],floor[2]],new THREE.Vector3(1,0,0),.24);
  appendTriangle(attrs,indices,[floor[0],floor[2],floor[3]],new THREE.Vector3(1,0,0),.24);
  // Extend the real stem inward, embedding its cap 0.25mm behind the back.
  for(const t of stem.faces)for(let k=0;k<3;k++){
    const v=vertex(g.index.getX(t+k)),x=v.attrs.position[0];
    v.attrs.position[0]=SLOT.connectorX+(x-stem.bounds.min.x)*(stem.bounds.min.x-SLOT.connectorX)/(stem.bounds.max.x-stem.bounds.min.x);
    const n=new THREE.Vector3(...v.attrs.normal);n.x/=(stem.bounds.min.x-SLOT.connectorX)/(stem.bounds.max.x-stem.bounds.min.x);v.attrs.normal=n.normalize().toArray();
    const i=attrs.position.length/3;for(const[name,a]of Object.entries(v.attrs))attrs[name].push(...a);indices.push(i);
  }
  function geometry(values,faces){const out=new THREE.BufferGeometry();for(const[n,a]of Object.entries(g.attributes))out.setAttribute(n,new THREE.BufferAttribute(new a.array.constructor(values[n]),a.itemSize,a.normalized));out.setIndex(faces);out.computeBoundingBox();out.computeBoundingSphere();return out;}
  const result={...model,prims:[{...primitive,geometry:geometry(attrs,indices)},...model.prims.slice(1)]};
  const record={model:result,geometry:result.prims[0].geometry,released:false};
  prepared.set(model,record);owned.set(result,record);return result;
}

// Only a model-library owner may call this after ALL users are gone.
// A character switch/death/dispose must never release shared geometry.
export function releaseMP40ReceiverDetail(model){
  const record=owned.get(model)||prepared.get(model);if(!record||record.released)return false;
  const geometry=record.geometry;record.released=true;
  prepared.delete(model);owned.delete(record.model);
  record.model=null;record.geometry=null;geometry.dispose();return true;
}
