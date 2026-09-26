import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DIFFICULTIES,difficultyProfile,normalizeDifficulty} from '../difficulty.js';
import {ENEMY_TYPES} from '../ships.js';
import {cycleScale} from '../campaign.js';
import {createCampaign,beginLevel,spawnEnemy,spawnFormation,update} from '../sim.js';
import {startDive,startChallenge,updateDirector} from '../waves.js';
// Captured before difficulty integration: three seeded sectors, scripted waves,
// every hull, dive, beam, captive fire, player fire and 90 seconds of simulation.
function easyFingerprint(difficulty) {
  let seed=0x14ef0731;const original=Math.random;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const hash=createHash('sha256');
  try {
    for(const level of [0,9,20]) {
      const s=createCampaign(level,null,difficulty);s.players[0].guard=1e6;
      for(let frame=0;frame<1800;frame++){
        if(frame===900){
          for(let type=0;type<10;type++){
            const e=spawnEnemy(s,type,120+type*100,130);e.fire=0;
            if(type===1)startDive(s,e,s.players[0]);
            if(type===5)Object.assign(e,{ai:'station',stationX:e.x,stationY:130,hold:40,sway:0});
            if(type===6)Object.assign(e,{ai:'captor',capState:3,capTimer:20,captive:1,capX:e.x});
          }
        }
        update(s,1/60,[{x:Math.sin(frame*.03)*.4,y:0,fire:frame%180<80}]);
        if(frame%30===0)hash.update(JSON.stringify(s,(key,value)=>key==='difficulty'?undefined:value));
        s.events.length=0;
      }
    }
    return hash.digest('hex');
  }finally{Math.random=original;}
}
const originalEasy='3b5702124d5bc57a9a7e074cd064a5a02c7b3d84a1c050f059f9395c6d3b5c93';
assert.equal(easyFingerprint(),originalEasy,'Default combat remains bit-identical to original tuning');
assert.equal(easyFingerprint('easy'),originalEasy,'Explicit Easy remains bit-identical to original tuning');
const near=(actual,expected,label)=>assert(Math.abs(actual-expected)<1e-8,`${label}: ${actual} != ${expected}`);
const isolated=(id,level=3)=>{
  const s=createCampaign(level,null,id);s.director.hold=true;s.players[0].guard=1e6;return s;
};
const results=[];
for(const profile of DIFFICULTIES){
  const id=profile.id,s=isolated(id),p=s.players[0];
  assert.equal(s.difficulty,id);beginLevel(s,4);assert.equal(s.difficulty,id);
  assert.equal(createCampaign(4,s,'easy').difficulty,id,'Retry uses its campaign difficulty');
  assert.equal(createCampaign(4,{...s,difficulty:undefined},id).difficulty,id,'Legacy checkpoints use requested difficulty');
  for(let type=0;type<10;type++){
    const e=spawnEnemy(s,type,100+type*95,150),boss=type===9;
    const hp=ENEMY_TYPES[type].hp*(1+4*(boss?.08:.24))*(boss?1.8:1)*profile.health;
    assert.equal(e.hp,hp);assert.equal(e.maxHp,hp);
    for(const weak of e.weakPoints||[])assert.equal(weak.maxHp,hp*.13,'Guardian weak points inherit difficulty once');
  }
  const challenge=isolated(id,20);startChallenge(challenge,spawnEnemy);
  assert.equal(challenge.enemies.length,40,'Challenge actor count remains fixed');
  for(const e of challenge.enemies)assert.equal(e.hp,(8+9*2)*cycleScale(20,.22)*profile.health,'Challenge override applies health once');

  const shooting=isolated(id),e=spawnEnemy(shooting,2,300,180);e.fire=0;update(shooting,.001);
  const shot=shooting.bullets.find(b=>b.team<0);assert(shot);
  near(Math.hypot(shot.vx,shot.vy),(175+3*7+2*4)*.95*profile.shotSpeed,'Shot speed');
  near(shot.damage,(3.8+22*.16+2*.42)*(1+3*.09)*profile.damage,'Shot damage');
  const cadence=isolated(id),boss=spawnEnemy(cadence,9,600,155);boss.fire=0;let shots=0;
  for(let frame=0;frame<600;frame++){update(cadence,1/60);shots+=cadence.bullets.filter(b=>b.team<0).length;cadence.bullets.length=0;cadence.events.length=0;}

  // Hive pressure changes timers while retaining the original launch group size.
  const hive=isolated(id),member=spawnEnemy(hive,2,600,180);
  Object.assign(hive.director,{hold:false,state:'wave',wave:0,kind:'hive',clock:2,timeout:40,dive:1,potshot:1});
  Object.assign(member,{ai:'hive',wave:0,slotRow:0,slotCol:0,slotCount:1});
  updateDirector(hive,.1,spawnEnemy,spawnFormation,hive.players[0]);
  near(hive.director.dive,1-.1*profile.diveRate,'Hive dive cadence');near(hive.director.potshot,1-.1*profile.fireRate,'Hive firing cadence');
  startDive(hive,member,hive.players[0]);near(member.diveSpeed,(250+3*11)*profile.diveSpeed,'Dive movement');

  // Beam/contact damage bypasses projectiles and must not be scaled twice.
  const beam=isolated(id),bp=beam.players[0];Object.assign(bp,{guard:0,lastHit:0,shield:200});
  const owner=spawnEnemy(beam,5,bp.x,bp.y-200);owner.noFire=true;owner.harmless=true;
  beam.beams.push({owner:owner.id,angle:Math.PI/2,t:0,warn:0,dx:0,dy:0});update(beam,.001);
  near(200-bp.shield,(15+3*.9)*profile.damage,'Beam damage');
  const ram=isolated(id),rp=ram.players[0];Object.assign(rp,{guard:0,lastHit:0,shield:200});
  const rammer=spawnEnemy(ram,8,rp.x,rp.y);rammer.noFire=true;update(ram,.001);
  near(200-rp.shield,22*profile.damage,'Contact damage');
  const tractor=isolated(id),tp=tractor.players[0];Object.assign(tp,{guard:0,lastHit:0,shield:200,y:400,py:400,fireEnergy:100,fireEnergyDelay:1});
  const cap=spawnEnemy(tractor,6,tp.x,226);Object.assign(cap,{ai:'captor',capState:2,capTimer:2,capX:tp.x,noFire:true});update(tractor,.025);
  near(200-tp.shield,26*.025*profile.damage,'Tractor shield drain');near(100-tp.fireEnergy,34*.025*profile.damage,'Tractor energy drain');
  const captive=isolated(id),captor=spawnEnemy(captive,6,600,200);
  Object.assign(captor,{ai:'captor',capState:3,capTimer:20,captive:1,captiveFire:1});update(captive,.025);
  near(captor.captiveFire,1-.025*profile.fireRate,'Captured drone firing cadence');
  const lancer=isolated(id),l=spawnEnemy(lancer,5,600,180);Object.assign(l,{ai:'station',stationX:600,stationY:180,hold:30,sway:0,fire:0});update(lancer,.001);
  assert.equal(lancer.beams[0].warn,1-3*.025,'Lancer warning duration is unchanged');

  // Higher pressure never expands hostile allocations or authored wave counts.
  const dense=isolated(id,Number.MAX_SAFE_INTEGER);
  for(let n=0;n<30;n++){const b=spawnEnemy(dense,9,600,155);b.fire=0;}
  update(dense,.001);assert.equal(dense.bullets.filter(b=>b.team<0).length,78,'Hostile projectile cap remains78');
  const scripted=isolated(id,Number.MAX_SAFE_INTEGER);scripted.director.hold=false;const counts=[];
  for(let wave=0;wave<scripted.director.plan.length;wave++){
    scripted.enemies.length=0;scripted.formations.length=0;scripted.squadrons.length=0;
    Object.assign(scripted.director,{state:'rest',clock:0});updateDirector(scripted,3,spawnEnemy,spawnFormation,scripted.players[0]);
    counts.push(scripted.enemies.length);assert(scripted.enemies.length<=28);assert(scripted.director.timeout<=44);
  }
  if(results.length)assert.deepEqual(counts,results[0].counts,'Difficulty preserves wave actor counts');
  results.push({id,hp:e.hp,damage:shot.damage,speed:Math.hypot(shot.vx,shot.vy),shots,counts});
}
for(let i=1;i<results.length;i++)for(const key of ['hp','damage','speed','shots'])assert(results[i][key]>results[i-1][key],`${key} rises with difficulty`);
assert.equal(normalizeDifficulty('unknown'),'easy');assert.equal(difficultyProfile(null).id,'easy');
assert.equal(createCampaign(0,null,'unknown').difficulty,'easy');
assert.equal(createCampaign(0,{difficulty:null},'real').difficulty,'easy','Present invalid checkpoint difficulty falls back to Easy');
const legacy=createCampaign();delete legacy.difficulty;beginLevel(legacy,1);assert.equal(legacy.difficulty,'easy');
console.log('PASS four combat difficulties, original Easy replay, retry/sector persistence, monotonic enemy pressure, exact damage and unchanged caps/telegraphs.');
console.log(JSON.stringify(results));
