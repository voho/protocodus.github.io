// Actual player/input collection geometry, capacity and bounded visibility.
import assert from 'node:assert/strict';
import { pickupScenario as scenario } from './pickup-fixture.mjs';
for(const [kind,expected]of [['open',true],['wall',false],['upper-floor',false],['curb',true],['crate-top',true],['height-boundary',true],['height-outside',false],['crouch',true]]){
 const s=scenario({kind}),before=s.P.health,k=s.M.pickups[0],sight=s.G.world.clear(...s.G.camera.position.toArray(),k.x,k.y+.15,k.z);s.tick();
 assert.equal(k.taken,expected,kind);assert.equal(s.P.health,!expected?before:100,kind+' health');
 if(kind==='wall'||kind==='upper-floor')assert.equal(sight,false,'solid access is genuinely blocked');
 s.dispose();
}
for(const distance of [1.4,1.4001]){const s=scenario({distance});s.tick();assert.equal(s.M.pickups[0].taken,distance===1.4,'old inclusive horizontal boundary remains intact');s.dispose();}
for(const type of ['medkit','ammo','grenades'])for(const full of [false,true]){
 const s=scenario({type,full}),before=s.P.inventory();s.tick();assert.equal(s.M.pickups[0].taken,!full,'resource capacity still controls consumption');
 if(full){assert.equal(s.P.health,100);assert.deepEqual(s.P.inventory(),before,'full inventory is unchanged');}
 if(!full&&type==='ammo')assert.ok(Object.values(s.P.ammo).some(a=>a.reserve>0));if(!full&&type==='grenades')assert.equal(s.P.grenades,2);
 s.dispose();
}
for(const type of ['ammo','grenades']){const s=scenario({type,kind:'wall'}),before=s.P.inventory();s.tick();assert.equal(s.M.pickups[0].taken,false);assert.deepEqual(s.P.inventory(),before);s.dispose();}
{
 const s=scenario({drop:true,type:'ammo'});s.killForDrop();assert.equal(s.M.pickups.length,1,'actual AI death emits a real supply drop');const k=s.M.pickups[0];assert.equal(k.type,'ammo');s.tick();assert.equal(k.taken,true);assert.ok(Object.values(s.P.ammo).some(a=>a.reserve>0));s.dispose();
}
{
 const s=scenario();s.tick();assert.equal(s.M.pickups[0].taken,true);s.M.restoreCheckpoint();s.P.health=40;s.tick();assert.equal(s.P.health,40,'retry cannot collect a consumed dressing twice');assert.equal(s.M.pickups[0].taken,true);s.dispose();
}
{
 for(const spec of [{kind:'open',distance:4},{kind:'upper-floor'},{kind:'open',full:true}]){const s=scenario(spec);for(let i=0;i<30;i++)s.tick();assert.equal(s.rays(),0,'out-of-range/different-floor/full-health dressing adds no idle traces');s.dispose();}
 const s=scenario({kind:'wall',type:'ammo',count:25}),seen=new Set();const clear=s.G.world.clear;s.G.world.clear=(...a)=>{seen.add(a.slice(3,6).join(','));return clear(...a);};
 // Give each bundle a distinct actual position on the blocked side, all in range.
 s.M.pickups.forEach((k,i)=>{k.x=(i-12)*.02;k.object.position.x=k.x;});
 for(let i=0;i<100;i++)s.tick(false);assert.equal(s.rays(),2,'same simulation instant cannot exceed two collection traces');
 for(let i=0;i<13;i++){const before=s.rays();s.tick();assert.ok(s.rays()-before<=2);}
 assert.equal(seen.size,25,'bounded rotation eventually checks every real nearby bundle');assert.ok(s.M.pickups.every(k=>!k.taken),'blocked candidates stay available');
 s.M.restoreCheckpoint();const before=s.rays();s.tick(false);assert.equal(s.rays()-before,2,'retry clears only the ephemeral query budget');s.dispose();
}
console.log('ok actual player pickup access, resources, enemy drops, checkpoint and bounded-query controls');
