// Actual catalog attic variant, preserved facade/collision/UV source,
// real city static batching and actual cosmetic glass consumer.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const THREE = await import('three');
const { addPragueRoofDetails } = await import('../js/prague-roof-details.js');
const { pragueModels } = await import('../js/prague-models.js');
const { pragueStreetModels } = await import('../js/prague-street-models.js');
const { createMaterialLibrary } = await import('../js/materials.js');
const { createStaticBatcher, worldColliders } = await import('../js/assets.js');
const { createWorld, MOVE, SHOT, SIGHT } = await import('../js/world.js');
const L = (await import('../js/levels/prague.js')).default;
const { createPragueGlassFeedback } = await import('../js/prague-glass-feedback.js');
const hash = model => {
  const h = createHash('sha256');
  for (const p of model.prims) {
    for (const a of Object.values(p.geometry.attributes)) h.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
    if (p.geometry.index) h.update(Buffer.from(p.geometry.index.array.buffer));
  }
  return h.digest('hex');
};
const catalog = new Map([...pragueModels(), ...pragueStreetModels()]), original = catalog.get('prague_old_classical');
const sourceHash = hash(original), preparedGlass = original.prims.filter(p => p.key === 'glass');
assert.equal(preparedGlass.filter(p => p.material?.userData?.pragueAmbientWindows).length, 1);
const variant = catalog.get('prague_old_classical_attic');
assert.ok(variant, 'The actual factory registers the prepared attic variant');
const isolated = new Map([[original.name,original]]);
assert.equal(addPragueRoofDetails(isolated),isolated);
assert.equal(hash(original),sourceHash,'Preparing another catalog never alters borrowed source arrays');
assert.equal(hash(isolated.get(variant.name)),hash(variant),'Actual factory and direct helper produce the same geometry');
assert.equal(hash(original), sourceHash); assert.equal(catalog.get('prague_old_classical'), original);
assert.equal(variant.name, 'prague_old_classical_attic');
assert.equal(variant.colliders, original.colliders); assert.equal(variant.anchors, original.anchors); assert.equal(variant.extras, original.extras);
assert.deepEqual(variant.box, original.box); assert.equal(variant.extras.floors, 3);
assert.deepEqual(variant.prims.slice(0, original.prims.length), original.prims);
for (const [i, p] of original.prims.entries()) assert.equal(variant.prims[i], p);
assert.deepEqual(variant.prims.filter(p => p.key === 'glass'), preparedGlass, 'Existing marked UV geometry/material objects stay exact');
const sources = new Set(original.prims.map(p => p.material)), additions = variant.prims.slice(original.prims.length);
for (const p of additions) {
  assert.ok(sources.has(p.material)); assert.ok(original.box.containsBox(p.geometry.boundingBox));
  for (const a of Object.values(p.geometry.attributes)) assert.ok(a.array.every(Number.isFinite));
}
const tris = geometry => (geometry.index?.count || geometry.attributes.position.count) / 3;
assert.equal(additions.reduce((n,p) => n + tris(p.geometry), 0), 372);
const geometryBytes = additions.reduce((n,p) => n + Object.values(p.geometry.attributes).reduce((s,a) => s + a.array.byteLength,0),0);
assert.equal(geometryBytes, 49104);
const roofMeshes = original.prims.filter(p => /^roof_/.test(p.key)).map(p => new THREE.Mesh(p.geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})));
const plaster = additions.find(p => p.key === 'plaster').geometry;
let roots = 0;
for(let i=0;i<plaster.attributes.position.count;i++) if(plaster.attributes.normal.getY(i)<-.99) {
  const point = new THREE.Vector3().fromBufferAttribute(plaster.attributes.position,i);
  const hit = new THREE.Raycaster(new THREE.Vector3(point.x,original.box.max.y+1,point.z),new THREE.Vector3(0,-1,0),0,10).intersectObjects(roofMeshes)[0];
  assert.ok(hit); const embed = hit.point.y-point.y;
  assert.ok(embed>=0 && embed<=.16,'Dormer body intersects the real original roof by a modest depth'); roots++;
}
assert.ok(roots>=24); for(const mesh of roofMeshes)mesh.material.dispose();
const entries = [...catalog]; assert.equal(addPragueRoofDetails(catalog), catalog); assert.deepEqual([...catalog], entries);
const absent = new Map(); assert.equal(addPragueRoofDetails(absent), absent); assert.equal(absent.size, 0);
const candidateProps = L.props.filter(p => catalog.has(p.m) && /^prague_/.test(p.m));
const selected = candidateProps.filter(p => p.m === variant.name);
assert.deepEqual(selected.map(p => [p.x,p.z]), [[-19,-32],[-19,38],[-19,136]], 'Three ordinary older houses only; passages and damage remain untouched');
const props = candidateProps.map(p => p.m === variant.name ? {...p,m:original.name} : p);
const library = createMaterialLibrary(new Proxy({}, { get: () => null }), { wet: { value: .28 }, rain: { value: 0 }, time: { value: 12.3 } });
const budgets = [];
for (const placements of [props, candidateProps]) {
  const batch = createStaticBatcher(library, 48);
  for (const p of placements) {
    const yaw = (p.yaw || 0) * Math.PI / 180, q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
    const y = typeof p.y === 'number' ? p.y : L.baseHeight(p.x,p.z)-.04;
    batch.add(catalog.get(p.m),new THREE.Matrix4().compose(new THREE.Vector3(p.x,y,p.z),q,new THREE.Vector3().setScalar(p.scale || 1)));
  }
  const group = batch.build(); budgets.push({ buckets: group.children.length, triangles: group.children.reduce((n,p) => n + tris(p.geometry),0) });
  group.traverse(o=>{if(o.isMesh)o.geometry.dispose();});
}
assert.equal(budgets[1].buckets, budgets[0].buckets); assert.equal(budgets[1].triangles - budgets[0].triangles, 1116);
const world = createWorld({ minX:-40,maxX:40,minZ:-60,maxZ:160 });
const placed = candidateProps.filter(p => p.m === variant.name).map(p => ({ m: variant, x:p.x,y:p.y,z:p.z,yaw:p.yaw*Math.PI/180,scale:1 }));
for (const p of placed) for (const c of worldColliders(p.m,p.x,p.y,p.z,p.yaw,1)) world.add(c);
const audio = [], shards = [], atlas = new THREE.Texture();
const owner = createPragueGlassFeedback(placed, { map:atlas, effects:{glass:(...a)=>shards.push(a)},audio:{impact:(...a)=>audio.push(a)},random:()=>.5 });
const cases = [];
for (const p of placed) {
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(p.x,p.y,p.z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),p.yaw),new THREE.Vector3(1,1,1));
  for (const [label, coordinates, expected, side] of [
    ['mapped upper pane',[-4.10,5.50,5.1725],true,1],
    ['shop pane',[-4.00,1.90,5.1975],true,1],
    ['rear pane',[-4.10,5.50,-5.1725],true,-1],
    ['original mullion',[-4.45,5.50,5.1725],false,1],
    ['solid masonry',[-6.50,5.50,5.1725],false,1],
  ]) {
    const target = new THREE.Vector3().fromArray(coordinates).applyMatrix4(matrix);
    const origin = new THREE.Vector3(coordinates[0],coordinates[1],coordinates[2]+6*side).applyMatrix4(matrix);
    const dir = target.clone().sub(origin).normalize();
    const hit = world.raycast(origin.x,origin.y,origin.z,dir.x,dir.y,dir.z,15,SHOT,{noWater:true});
    assert.ok(hit); const before = {...hit}; Object.freeze(hit);
    const count = audio.length, blocked = [MOVE,SHOT,SIGHT].map(mask => !world.clear(origin.x,origin.y,origin.z, p.x,p.y+coordinates[1],p.z,mask));
    assert.deepEqual(blocked,[true,true,true]);
    const result = owner.impact(hit,dir); assert.equal(!!result,expected,label);
    assert.equal(audio.length-count,expected?1:0); assert.deepEqual({...hit},before); assert.equal(hit.surface,'stone');
    if(expected) { assert.equal(audio.at(-1)[3],'glass'); assert.deepEqual(shards.at(-1)[5],{glints:false}); assert.ok(new THREE.Vector3(result.x,result.y,result.z).distanceTo(target)<1e-5); }
    assert.deepEqual([MOVE,SHOT,SIGHT].map(mask => !world.clear(origin.x,origin.y,origin.z,p.x,p.y+coordinates[1],p.z,mask)),blocked);
    cases.push({address:[p.x,p.z],label,glass:!!result,physicalSurface:hit.surface});
  }
}
assert.equal(audio.length,9); assert.equal(shards.length,9); assert.equal(owner.mesh.count,9);
assert.equal(hash(original),sourceHash); owner.dispose(); atlas.dispose();
console.log('prague-roof-details-check: 372 unique/1116 placed triangles, no new city buckets/materials/maps; exact facade/collision/marked UVs, 9 real variant pane hits and 6 frame/masonry controls pass.');
