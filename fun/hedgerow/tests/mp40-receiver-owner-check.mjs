// Run the actual model-library return path with real shipped GLB geometry.
// Only browser file/image I/O is replaced by the existing CPU GLB decoder.
import './three-hooks.mjs';
import {parseUntexturedGLB} from './rig-fixture.mjs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const THREE=await import('three');
const {GLTFLoader}=await import('../assets/vendor/GLTFLoader.js');
const {loadModels,readSet,instantiate}=await import('../js/assets.js');
const {prepareMP40ReceiverDetail,releaseMP40ReceiverDetail}=await import('../js/mp40-receiver-detail.js');
const hash=model=>createHash('sha256').update(Buffer.concat(model.prims.flatMap(({geometry:g})=>[
  ...Object.values(g.attributes).map(a=>Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength)),
  Buffer.from(g.index.array.buffer,g.index.array.byteOffset,g.index.array.byteLength),
]))).digest('hex');
const events=[],disposed=[],materialDisposals=[];
const loadAsync=GLTFLoader.prototype.loadAsync,dispose=THREE.BufferGeometry.prototype.dispose;
const disposeMaterial=THREE.Material.prototype.dispose,previousScheduler=globalThis.scheduler;
GLTFLoader.prototype.loadAsync=async function(url,onProgress){
  assert.equal(url,'cpu-library/weapons.glb');events.push(url);
  onProgress?.({loaded:1,total:1});return parseUntexturedGLB('weapons');
};
THREE.BufferGeometry.prototype.dispose=function(){disposed.push(this);return dispose.call(this);};
THREE.Material.prototype.dispose=function(){materialDisposals.push(this);return disposeMaterial.call(this);};
// Avoid opening browser-lived MessageChannels in this bounded Node fixture.
globalThis.scheduler={yield:async()=>{}};
try{
  const progress=[],library=await loadModels('cpu-library',['weapons'],fraction=>progress.push(fraction));
  assert.equal(events.length,1);assert.equal(progress.at(-1),1);
  const returned=library.models.get('mp40');
  assert.equal(returned.prims.length,2);
  assert.equal(returned.prims[0].geometry.attributes.position.count,3417);
  assert.equal(returned.prims[0].geometry.index.count,8868);
  const before=hash(returned),geometry=returned.prims[0].geometry,magazine=returned.prims[1].geometry;
  const instances=[instantiate(returned,{resolve:m=>m}),instantiate(returned,{resolve:m=>m})];
  for(const instance of instances){assert.equal(instance.children[0].geometry,geometry);instance.removeFromParent();instance.clear();}
  // Library cleanup is terminal, after every shared actor/user is gone.
  disposed.length=0;materialDisposals.length=0;
  assert.equal(releaseMP40ReceiverDetail(returned),true,'the actual returned library owner can release');
  assert.deepEqual(disposed,[geometry]);assert.equal(materialDisposals.length,0);
  assert.equal(releaseMP40ReceiverDetail(returned),false);
  assert.equal(disposed.length,1);assert.ok(!disposed.includes(magazine));assert.equal(hash(returned),before);
  const reloaded=(await loadModels('cpu-library',['weapons'])).models.get('mp40');
  assert.notEqual(reloaded,returned);assert.notEqual(reloaded.prims[0].geometry,geometry);assert.equal(hash(reloaded),before);
  assert.equal(releaseMP40ReceiverDetail(reloaded),true);assert.equal(releaseMP40ReceiverDetail(reloaded),false);

  // Retain a source to prove both key forms, borrowed-resource safety and rebuild.
  const sourceModels=new Map();readSet(await parseUntexturedGLB('weapons'),'weapons',sourceModels);
  const source=sourceModels.get('mp40'),sourceBefore=hash(source),first=prepareMP40ReceiverDetail(source);
  const derivedBefore=hash(first);
  assert.equal(prepareMP40ReceiverDetail(source),first);assert.equal(prepareMP40ReceiverDetail(first),first);
  disposed.length=0;materialDisposals.length=0;
  assert.equal(releaseMP40ReceiverDetail(first),true);
  assert.equal(releaseMP40ReceiverDetail(first),false);assert.equal(releaseMP40ReceiverDetail(source),false);
  assert.deepEqual(disposed,[first.prims[0].geometry]);assert.equal(materialDisposals.length,0);assert.equal(hash(source),sourceBefore);
  const second=prepareMP40ReceiverDetail(source);
  assert.notEqual(second,first);assert.notEqual(second.prims[0].geometry,first.prims[0].geometry);assert.equal(hash(second),derivedBefore);
  assert.equal(releaseMP40ReceiverDetail(source),true);
  assert.equal(releaseMP40ReceiverDetail(second),false);assert.equal(releaseMP40ReceiverDetail(source),false);
  assert.equal(hash(source),sourceBefore);
  assert.deepEqual(disposed,[first.prims[0].geometry,second.prims[0].geometry]);
  const third=prepareMP40ReceiverDetail(source);assert.equal(hash(third),derivedBefore);
  // Graphics context retirement keeps CPU arrays/cache available for reupload.
  third.prims[0].geometry.dispose();
  assert.equal(prepareMP40ReceiverDetail(source),third);assert.equal(prepareMP40ReceiverDetail(third),third);assert.equal(hash(third),derivedBefore);
  assert.equal(releaseMP40ReceiverDetail(third),true);assert.equal(releaseMP40ReceiverDetail(source),false);
  const fourth=prepareMP40ReceiverDetail(source),reentrant=[];
  fourth.prims[0].geometry.addEventListener('dispose',()=>reentrant.push(releaseMP40ReceiverDetail(source),releaseMP40ReceiverDetail(fourth)));
  disposed.length=0;
  assert.equal(releaseMP40ReceiverDetail(fourth),true);
  assert.deepEqual(reentrant,[false,false]);assert.deepEqual(disposed,[fourth.prims[0].geometry]);assert.equal(hash(source),sourceBefore);
  assert.equal(materialDisposals.length,0);
  console.log('mp40-receiver-owner-check: actual loadModels owner, derived/source cleanup once, borrowed resources, rebuild, context retirement and reentry pass');
}finally{
  GLTFLoader.prototype.loadAsync=loadAsync;THREE.BufferGeometry.prototype.dispose=dispose;THREE.Material.prototype.dispose=disposeMaterial;
  if(previousScheduler===undefined)delete globalThis.scheduler;else globalThis.scheduler=previousScheduler;
}
