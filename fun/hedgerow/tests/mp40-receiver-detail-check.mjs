import './three-hooks.mjs';
import {parseUntexturedGLB} from './rig-fixture.mjs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const THREE=await import('three');
const {readSet,instantiate}=await import('../js/assets.js');
const {prepareMP40ReceiverDetail,releaseMP40ReceiverDetail}=await import('../js/mp40-receiver-detail.js');
const models=new Map();readSet(await parseUntexturedGLB('weapons'),'weapons',models);
const source=models.get('mp40'),g=source.prims[0].geometry;
const hash=m=>createHash('sha256').update(Buffer.concat(m.prims.flatMap(({geometry:g})=>[...Object.values(g.attributes).map(a=>Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength)),Buffer.from(g.index.array.buffer,g.index.array.byteOffset,g.index.array.byteLength)]))).digest('hex');
const before=hash(source),start=performance.now(),candidate=prepareMP40ReceiverDetail(source),prepareMilliseconds=performance.now()-start;
assert.notEqual(candidate,source,'the exact guarded authored receiver/stem/knob are found');
assert.equal(prepareMP40ReceiverDetail(source),candidate,'prepared geometry cached');
assert.equal(prepareMP40ReceiverDetail(models.get('thompson')),models.get('thompson'),'other weapons intact');
assert.equal(prepareMP40ReceiverDetail({...source,prims:[{...source.prims[0],geometry:new THREE.BoxGeometry()}]}).prims[0].geometry.attributes.position.count,24,'unfamiliar asset left intact');
assert.equal(hash(source),before,'shared source geometry byte-identical');
// Missing attributes and unsupported same-count layouts must remain intact.
const unsupported=[];
for(const name of['position','normal','uv','color'])unsupported.push({name:'missing '+name,change:geometry=>geometry.deleteAttribute(name)});
unsupported.push({name:'Float64 normal',change:geometry=>geometry.setAttribute('normal',new THREE.BufferAttribute(new Float64Array(g.attributes.normal.array),3))});
unsupported.push({name:'normalized color',change:geometry=>geometry.setAttribute('color',new THREE.BufferAttribute(new Uint8Array(2754*3),3,true))});
unsupported.push({name:'same-count UV wrong item size',change:geometry=>geometry.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(2754*3),3))});
unsupported.push({name:'non-finite position',change:geometry=>geometry.attributes.position.setX(0,NaN)});
unsupported.push({name:'unsupported extra attribute',change:geometry=>geometry.setAttribute('tangent',new THREE.BufferAttribute(new Float32Array(2754*4),4))});
unsupported.push({name:'out-of-range source index',change:geometry=>{geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array),1));geometry.index.setX(0,9999);}});
for(const{name,change}of unsupported){const geometry=g.clone();change(geometry);const unknown={...source,prims:[{...source.prims[0],geometry},...source.prims.slice(1)]},unknownBefore=hash(unknown);assert.equal(prepareMP40ReceiverDetail(unknown),unknown,name+' falls back unchanged');assert.equal(hash(unknown),unknownBefore,name+' preserves buffers');geometry.dispose();}

assert.equal(candidate.prims.length,2);assert.equal(candidate.prims[1],source.prims[1],'seated magazine original primitive reused');
const triples=new Set();for(const p of candidate.prims.slice(0,1)){for(const[n,a]of Object.entries(g.attributes))assert.deepEqual(p.geometry.attributes[n].array.subarray(0,a.array.length),a.array,`all source ${n} bytes exact`);for(let t=0;t<p.geometry.index.count;t+=3)triples.add([0,1,2].map(k=>p.geometry.index.getX(t+k)).join(','));}
const untouched=[];for(let t=0;t<g.index.count;t+=3)if(triples.has([0,1,2].map(k=>g.index.getX(t+k)).join(',')))untouched.push(t);
assert.equal(untouched.length,2662,'all2662original triangles outside the66-face cut retain exact indices and winding');
let minArea=Infinity,maxNormalError=0,unchangedDegenerateTriangles=0;
for(const p of candidate.prims.slice(0,1)){
  const out=p.geometry;for(const a of Object.values(out.attributes))assert.ok(a.array.every(Number.isFinite),'finite geometry attributes');
  for(let i=g.attributes.position.count;i<out.attributes.position.count;i++)maxNormalError=Math.max(maxNormalError,Math.abs(new THREE.Vector3().fromBufferAttribute(out.attributes.normal,i).length()-1));
  for(let t=0;t<out.index.count;t+=3){const ids=[0,1,2].map(k=>out.index.getX(t+k)),a=new THREE.Vector3().fromBufferAttribute(out.attributes.position,ids[0]),b=new THREE.Vector3().fromBufferAttribute(out.attributes.position,ids[1]),c=new THREE.Vector3().fromBufferAttribute(out.attributes.position,ids[2]),area=b.sub(a).cross(c.sub(a)).length()/2;
    if(ids.some(i=>i>=g.attributes.position.count))minArea=Math.min(minArea,area);else if(area<1e-13)unchangedDegenerateTriangles++;}
}
assert.ok(minArea>1e-13,'no new zero-area output triangles');assert.equal(unchangedDegenerateTriangles,24,'existing folded-stock seam degenerates preserved untouched');
const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),gun=instantiate(candidate,{resolve:()=>material});
assert.equal(gun.children.length,2,'original two meshes, no handle action node');const body=gun.children[0];gun.updateMatrixWorld(true);
const hits=[];
for(let k=0;k<=14;k++){
  const z=-.05+.07*k/14,hit=new THREE.Raycaster(new THREE.Vector3(.06,.066,z),new THREE.Vector3(-1,0,0),0,.06).intersectObject(body)[0];
  assert.ok(!!hit,'true recessed cavity back is present');assert.ok(Math.abs(hit.point.x-.0105)<1e-7,'opening has no old opaque skin');hits.push(hit.point.x);
}
const oldBody=new THREE.Mesh(g,material);let outsideRays=0;
for(let k=0;k<=18;k++)for(const y of [.057,.074]){
  const ray=new THREE.Raycaster(new THREE.Vector3(.06,y,-.05+.09*k/18),new THREE.Vector3(-1,0,0),0,.06),old=ray.intersectObject(oldBody)[0],now=ray.intersectObject(body)[0];
  assert.ok(old&&now&&old.point.distanceTo(now.point)<1e-7,'outside cavity skin ray unchanged');outsideRays++;
}

// Exact identity of source model metadata/primitive transforms, anchors,
// collider descriptors and seated original magazine is the integration contract.
for(const key of Object.keys(source))if(key!=='prims')assert.equal(candidate[key],source[key],key+' identity retained');
for(const key of Object.keys(source.prims[0]))if(key!=='geometry')assert.equal(candidate.prims[0][key],source.prims[0][key],key+' primitive identity retained');
// The measured authored receiver island has606front/seam vertices and84rear
// vertices. Pin its actual identity so a later source change fails closed.
const shifted={...source,prims:[{...source.prims[0],geometry:g.clone()},...source.prims.slice(1)]},shiftedPosition=shifted.prims[0].geometry.attributes.position;
for(const i of[...Array.from({length:606},(_,i)=>i),...Array.from({length:84},(_,i)=>1710+i)])shiftedPosition.setY(i,shiftedPosition.getY(i)+.5);
const shiftedBefore=hash(shifted);assert.equal(prepareMP40ReceiverDetail(shifted),shifted,'changed receiver can miss the slot without throwing or partially deriving');assert.equal(hash(shifted),shiftedBefore,'unfamiliar source buffers remain exact');shifted.prims[0].geometry.dispose();
assert.equal(prepareMP40ReceiverDetail(candidate),candidate,'already detailed model remains exact');
const out=candidate.prims[0].geometry;g.computeBoundingBox();g.computeBoundingSphere();
assert.deepEqual(out.boundingBox.min.toArray(),g.boundingBox.min.toArray());assert.deepEqual(out.boundingBox.max.toArray(),g.boundingBox.max.toArray());
assert.deepEqual(out.boundingSphere.center.toArray(),g.boundingSphere.center.toArray());assert.equal(out.boundingSphere.radius,g.boundingSphere.radius);
// The original132 handle/stem triangles are again indexed in the SAME body
// buffer and retain exact authored vertex attributes/rest coordinates.
const handleOffsets=Array.from({length:132},(_,i)=>2976+i*3);
for(const t of handleOffsets)assert.ok(triples.has([0,1,2].map(k=>g.index.getX(t+k)).join(',')));
const oldHandleHit=new THREE.Raycaster(new THREE.Vector3(.06,.066,.04),new THREE.Vector3(-1,0,0),0,.06).intersectObject(oldBody)[0];
const handleHit=new THREE.Raycaster(new THREE.Vector3(.06,.066,.04),new THREE.Vector3(-1,0,0),0,.06).intersectObject(body)[0];assert.ok(oldHandleHit&&handleHit&&oldHandleHit.point.distanceTo(handleHit.point)<1e-7,'visible authored handle rest is exactly unchanged');
const bytes=m=>m.prims.reduce((n,p)=>n+Object.values(p.geometry.attributes).reduce((s,a)=>s+a.array.byteLength,0)+p.geometry.index.array.byteLength,0);
const report={note:'Static receiver cavity only: no state, action, pose, audio, camera or gameplay imports. Original handle/stem remain in exact original buffer positions and indexed body triangles; original two primitive/draw structure. Bounds/anchors/material/primitive transforms/magazine identity preserved.',sourceSha256:before,sourceUnchanged:hash(source)===before,unsupportedLayouts:unsupported.length,totalTriangles:candidate.prims.reduce((n,p)=>n+p.geometry.index.count/3,0),originalTriangles:source.prims.reduce((n,p)=>n+p.geometry.index.count/3,0),primitives:candidate.prims.length,outsideCutExactOriginalTriangles:untouched.length,originalHandleTriangles:handleOffsets.length,cavityRays:hits.length,outsideSkinControlRays:outsideRays,handleRestHitDelta:handleHit.point.distanceTo(oldHandleHit.point),minNewTriangleArea:minArea,maxNewNormalLengthError:maxNormalError,unchangedOriginalDegenerateTriangles:unchangedDegenerateTriangles,prepareMilliseconds,cacheReturnsSame:prepareMP40ReceiverDetail(source)===candidate,originalBytes:bytes(source),candidateBytes:bytes(candidate)};
console.log(JSON.stringify(report,null,2));
let originalDisposed=0,derivedDisposed=0;for(const p of source.prims)p.geometry.addEventListener('dispose',()=>originalDisposed++);candidate.prims[0].geometry.addEventListener('dispose',()=>derivedDisposed++);
gun.removeFromParent();assert.equal(releaseMP40ReceiverDetail(source),true);assert.equal(releaseMP40ReceiverDetail(source),false);assert.equal(originalDisposed,0);assert.equal(derivedDisposed,1);assert.equal(hash(source),before);const rebuilt=prepareMP40ReceiverDetail(source);assert.notEqual(rebuilt,candidate);releaseMP40ReceiverDetail(source);console.log('cache-release:1derived geometry,0original geometries; idempotent; reprepare supported');
