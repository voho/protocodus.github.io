// Real authored root components, not a second copy of the subdivision code.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseUntexturedGLB} from './rig-fixture.mjs';
const THREE=await import('three');
const {readSet}=await import('../js/assets.js');
const {addTreeRootDetails,prepareTreeRootDetails,releaseTreeRootDetails}=await import('../js/tree-root-details.js');
const fixture=JSON.parse(readFileSync(new URL('./fixtures/tree-roots.json',import.meta.url)));
assert.equal(createHash('sha256').update(readFileSync(new URL('../assets/models/nature.glb',import.meta.url))).digest('hex'),fixture.sha256,'Fixture belongs to actual shipped geometry');
const originals=new Map();readSet(await parseUntexturedGLB('nature'),'nature',originals);
const hash=g=>{const h=createHash('sha256');for(const a of Object.values(g.attributes))h.update(Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength));h.update(Buffer.from(g.index.array.buffer,g.index.array.byteOffset,g.index.array.byteLength));return h.digest('hex');};
const originalHashes=new Map([...originals].map(([n,m])=>[n,m.prims.map(p=>hash(p.geometry))]));
const models=new Map(originals);assert.equal(addTreeRootDetails(models),models);
const bytes=g=>Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,g.index.array.byteLength);
const point=(g,i)=>new THREE.Vector3().fromBufferAttribute(g.attributes.position,i);
const vertexKey=v=>v.toArray().join(',');
const atlasKey=(uv,color)=>[...uv,...color].map(Math.fround).join(',');
let rootCount=0,addedTriangles=0,additionalBytes=0,halfspaces=0;

for(const [name,model]of models){
 const original=originals.get(name),spec=fixture.models[name];
 assert.deepEqual(original.prims.map(p=>hash(p.geometry)),originalHashes.get(name),'Borrowed geometry remains byte-identical: '+name);
 if(!spec){assert.equal(model,original,'Every mid/far and other nature model is untouched: '+name);continue;}
 assert.notEqual(model,original);assert.equal(prepareTreeRootDetails(original),model);assert.equal(prepareTreeRootDetails(model),model);
 assert.deepEqual(Object.keys(model).sort(),Object.keys(original).sort(),'No diagnostic/source-owner metadata is retained');
 for(const key of['name','set','box','colliders','anchors','extras'])assert.equal(model[key],original[key],name+': '+key);
 assert.equal(model.prims.length,original.prims.length,'No additional draws');
 model.prims.forEach((p,i)=>{assert.equal(p.material,original.prims[i].material);assert.equal(p.key,original.prims[i].key);if(i)assert.equal(p,original.prims[i],'Foliage primitive is borrowed unchanged');});
 const src=original.prims[0].geometry,dst=model.prims[0].geometry;
 assert.equal(src.attributes.position.count,spec.vertices);assert.equal(src.index.count,spec.indices);
 for(const [key,a]of Object.entries(src.attributes))assert.deepEqual(dst.attributes[key].array.slice(0,a.array.length),a.array,'Original attribute bytes retained: '+name+'/'+key);
 for(const a of Object.values(dst.attributes))for(const x of a.array)assert.ok(Number.isFinite(x));
 assert.deepEqual(dst.boundingBox,src.boundingBox,'Actual full wood bounds stay exact');
 const removed=new Set(spec.roots.flatMap(r=>r.triangles));let offset=0;
 for(let i=0;i<src.index.count;i+=3)if(!removed.has(i))for(let k=0;k<3;k++)assert.equal(dst.index.getX(offset++),src.index.getX(i+k),'Every nonroot triangle stays exact');
 for(const root of spec.roots){
  rootCount++;const originalPoints=root.hull.map(i=>point(src,i)),beforeBox=new THREE.Box3().setFromPoints(originalPoints),ids=new Set();
  for(let i=0;i<60*3;i++)ids.add(dst.index.getX(offset++));
  assert.ok([...ids].every(i=>i>=src.attributes.position.count),'Only derived vertices replace the original root faces');
  const derivedPoints=[...ids].map(i=>point(dst,i)),afterBox=new THREE.Box3().setFromPoints(derivedPoints),keys=new Set(derivedPoints.map(vertexKey));
  assert.deepEqual(afterBox,beforeBox,'Root-local extrema remain exact');
  for(const i of root.pinned)assert.ok(keys.has(vertexKey(point(src,i))),'Full base ring and buried tip remain fixed');
  // Independent convex-hull halfspaces from all supporting original triples.
  // Every derived point must stay inside every original supporting plane.
  for(let i=0;i<originalPoints.length;i++)for(let j=i+1;j<originalPoints.length;j++)for(let k=j+1;k<originalPoints.length;k++){
   const o=originalPoints[i],normal=originalPoints[j].clone().sub(o).cross(originalPoints[k].clone().sub(o));if(normal.lengthSq()<1e-16)continue;normal.normalize();
   const distances=originalPoints.map(p=>normal.dot(p.clone().sub(o))),lo=Math.min(...distances),hi=Math.max(...distances);
   if(lo>=-1e-7)normal.negate();else if(hi>1e-7)continue;halfspaces++;
   for(const p of derivedPoints)assert.ok(normal.dot(p.clone().sub(o))<1e-6,'Refinement must not expand the original convex footprint/volume');
  }
  const allowedAtlas=new Set();
  for(const t of root.triangles){const corners=[0,1,2].map(k=>src.index.getX(t+k));for(let k=0;k<3;k++){
   const a=corners[k],b=corners[(k+1)%3],u=src.attributes.uv,c=src.attributes.color;
   allowedAtlas.add(atlasKey([u.getX(a),u.getY(a)],[c.getX(a),c.getY(a),c.getZ(a)]));
   allowedAtlas.add(atlasKey([(u.getX(a)+u.getX(b))*.5,(u.getY(a)+u.getY(b))*.5],[(c.getX(a)+c.getX(b))*.5,(c.getY(a)+c.getY(b))*.5,(c.getZ(a)+c.getZ(b))*.5]));
  }}
  const seamNormals=new Map();
  for(const i of ids){const u=dst.attributes.uv,c=dst.attributes.color,n=new THREE.Vector3().fromBufferAttribute(dst.attributes.normal,i);assert.ok(Math.abs(n.length()-1)<1e-5);
   assert.ok(allowedAtlas.has(atlasKey([u.getX(i),u.getY(i)],[c.getX(i),c.getY(i),c.getZ(i)])),'UV/colour values use only original vertices or their own original triangle edges');
   const key=vertexKey(point(dst,i));if(seamNormals.has(key))assert.deepEqual(n.toArray(),seamNormals.get(key),'UV seam duplicates share smooth geometric normal');else seamNormals.set(key,n.toArray());
  }
 }
 assert.equal(offset,dst.index.count);const delta=dst.index.count/3-src.index.count/3;assert.equal(delta,spec.roots.length*45);addedTriangles+=delta;additionalBytes+=bytes(dst)-bytes(src);
}
assert.equal(rootCount,63);assert.equal(addedTriangles,2835);assert.ok(additionalBytes<180000);assert.ok(halfspaces>1000);
const identities=new Map([...models].map(([n,m])=>[n,m]));addTreeRootDetails(models);for(const[n,m]of models)assert.equal(m,identities.get(n),'Repeated catalog hook is idempotent');

// Changed or unsupported source geometry must leave the model untouched.
assert.equal(prepareTreeRootDetails(null),null);
const original=originals.get('beech_big');
for(const issue of['missingIndex','missingPosition','missingNormal','missingUV','missingColor','wrongSchema','extraAttribute','unsupportedPosition','nonfinitePosition','nonfiniteUV','countMismatch','unsupportedIndex','outOfRangeIndex','wrongIndexLayout','foliageMaterial','changedTip']){
 const geometry=original.prims[0].geometry.clone(),material=original.prims[0].material.clone();
 if(issue==='missingIndex')geometry.setIndex(null);if(issue==='missingPosition')geometry.deleteAttribute('position');if(issue==='missingNormal')geometry.deleteAttribute('normal');if(issue==='missingUV')geometry.deleteAttribute('uv');if(issue==='missingColor')geometry.deleteAttribute('color');if(issue==='wrongSchema')geometry.attributes.position.itemSize=2;if(issue==='foliageMaterial')material.alphaTest=.5;
 if(issue==='extraAttribute')geometry.setAttribute('unknown',geometry.attributes.position.clone());if(issue==='unsupportedPosition')geometry.setAttribute('position',new THREE.BufferAttribute(new Float64Array(geometry.attributes.position.array),3));if(issue==='nonfinitePosition')geometry.attributes.position.setX(0,NaN);if(issue==='nonfiniteUV')geometry.attributes.uv.setY(0,Infinity);if(issue==='countMismatch')geometry.setAttribute('normal',new THREE.BufferAttribute(new Float32Array((geometry.attributes.position.count-1)*3),3));if(issue==='unsupportedIndex')geometry.setIndex(new THREE.BufferAttribute(new Float32Array(geometry.index.array),1));if(issue==='outOfRangeIndex')geometry.index.setX(0,geometry.attributes.position.count);if(issue==='wrongIndexLayout')geometry.index.itemSize=2;
 if(issue==='changedTip'){const spec=fixture.models.beech_big.roots[0],tip=point(geometry,spec.pinned.at(-1)),p=geometry.attributes.position;for(let i=0;i<p.count;i++)if(point(geometry,i).equals(tip))p.setY(i,p.getY(i)+.01);}
 const unsupported={...original,prims:[{...original.prims[0],geometry,material},...original.prims.slice(1)]};assert.equal(prepareTreeRootDetails(unsupported),unsupported,issue+' fails closed');geometry.dispose();material.dispose();
}

// Retire/reupload keeps CPU arrays/cache; terminal cleanup owns only its
// derived geometry and cannot dispose the source geometry/material/atlas.
let sourceDisposals=0,materialDisposals=0,atlasDisposals=0,derivedDisposals=0;
const previousMap=original.prims[0].material.map,atlas=new THREE.DataTexture(new Uint8Array([80,70,50,255]),1,1);atlas.addEventListener('dispose',()=>atlasDisposals++);original.prims[0].material.map=atlas;
original.prims[0].geometry.addEventListener('dispose',()=>sourceDisposals++);original.prims[0].material.addEventListener('dispose',()=>materialDisposals++);
const candidate=models.get('beech_big'),geometry=candidate.prims[0].geometry,before=hash(geometry);geometry.addEventListener('dispose',()=>derivedDisposals++);
assert.equal(candidate.prims[0].material.map,atlas);geometry.dispose();assert.equal(hash(geometry),before);assert.equal(prepareTreeRootDetails(original),candidate,'Context retirement preserves prepared CPU geometry/cache');assert.equal(prepareTreeRootDetails(candidate),candidate,'Derived owner also survives graphics retirement');
// A terminal dispose listener may synchronously retry either owner key.
// Guard the fixture callback itself so an unfixed helper fails by counts/results,
// rather than overflowing the stack and obscuring the ownership regression.
let enteredDisposeListener=false;const reentrant=[];
geometry.addEventListener('dispose',()=>{if(enteredDisposeListener)return;enteredDisposeListener=true;reentrant.push(releaseTreeRootDetails(original),releaseTreeRootDetails(candidate));});
assert.equal(derivedDisposals,1);assert.equal(releaseTreeRootDetails(candidate),true);assert.deepEqual(reentrant,[false,false],'Retire both owner paths before invoking synchronous dispose listeners');assert.equal(derivedDisposals,2);assert.equal(releaseTreeRootDetails(candidate),false);assert.equal(releaseTreeRootDetails(original),false);
assert.deepEqual([sourceDisposals,materialDisposals,atlasDisposals],[0,0,0],'Borrowed owners survive retirement and terminal cleanup');
const rebuilt=prepareTreeRootDetails(original);assert.notEqual(rebuilt,candidate);assert.equal(hash(rebuilt.prims[0].geometry),before,'Fresh owner rebuild is deterministic');let rebuiltDisposals=0,enteredSourceListener=false;const sourceReentrant=[];rebuilt.prims[0].geometry.addEventListener('dispose',()=>{rebuiltDisposals++;if(enteredSourceListener)return;enteredSourceListener=true;sourceReentrant.push(releaseTreeRootDetails(rebuilt),releaseTreeRootDetails(original));});assert.equal(releaseTreeRootDetails(original),true);assert.deepEqual(sourceReentrant,[false,false],'Source-key cleanup also retires both paths before disposal');assert.equal(rebuiltDisposals,1,'Source-owner cleanup releases exactly one rebuilt geometry');assert.equal(releaseTreeRootDetails(rebuilt),false);assert.equal(releaseTreeRootDetails(original),false);assert.equal(rebuiltDisposals,1);
const third=prepareTreeRootDetails(original);assert.notEqual(third,rebuilt);assert.equal(hash(third.prims[0].geometry),before,'Rebuild after source cleanup remains exact');assert.equal(prepareTreeRootDetails(third),third);assert.equal(releaseTreeRootDetails(third),true);assert.equal(releaseTreeRootDetails(original),false);assert.equal(releaseTreeRootDetails(third),false);
for(const[name,model]of models)if(name!=='beech_big')releaseTreeRootDetails(model);
for(const[name,model]of originals)assert.deepEqual(model.prims.map(p=>hash(p.geometry)),originalHashes.get(name),'Terminal cleanup never alters original buffers: '+name);
assert.deepEqual([sourceDisposals,materialDisposals,atlasDisposals],[0,0,0],'Every cleanup order leaves borrowed owners untouched');
original.prims[0].material.map=previousMap;atlas.dispose();assert.equal(atlasDisposals,1,'Only the fixture atlas owner disposes the borrowed map');
console.log('Tree roots: 63 actual components; exact source/collision/LOD identity; pinned bounds; convexity; UV seams; cache and borrowed-resource ownership pass.');
