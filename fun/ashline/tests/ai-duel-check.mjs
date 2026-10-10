// Long commander duels on Veteran: four pairings that between them field every doctrine and a random commander.
// Each duel resumes exactly from a save taken mid-battle and from a save taken the moment any commander plan
// (waves, a hauler raid, scouting, a fire-from-concealment answer) first goes live on either side; every save
// along the way, of the original and of the restored game, must load. Malformed commander plans are refused.
import assert from 'node:assert/strict';
import {createGame,updateGame,MAP_SIZES} from '../sim.js';
import {encodeGame,decodeGame} from '../save.js';

const snapshot=s=>JSON.parse(encodeGame(s)).game;
const PLANS=['waves','harass','intel','shelled'];
const duels=[
  {seed:'DUEL-SWARM-1',races:['organics','aiUnity'],doctrines:['swarm','ironclad']},
  {seed:'DUEL-PROSPECT-SIEGE',races:['aiUnity','organics'],doctrines:['prospector','siegebreaker']},
  {seed:'DUEL-RANDOM',races:['aiUnity','aiUnity'],doctrines:['random','balanced']},
  // Balanced's waves meet Siegebreaker's remembered towers and fall back from them (a regroup point once went NaN).
  {seed:'FOG-FUZZ-1',races:['organics','aiUnity'],doctrines:['balanced','siegebreaker']},
];
// Plans seen per side (ticks live), and the plans whose first live moment was saved and resumed exactly.
const seen=[Object.fromEntries(PLANS.map(key=>[key,0])),Object.fromEntries(PLANS.map(key=>[key,0]))],resumed=new Set();
const loads=(s,label)=>{
  // JSON turns a non-finite number into null, so a damaged plan fails validation here instead of comparing equal.
  assert.doesNotThrow(()=>decodeGame(encodeGame(s)),`${label}: the save loads`);
  for(const ai of [s.aiByTeam[0],s.ai])for(const wave of ai.waves||[])for(const key of ['tx','ty','rx','ry','need'])if(wave[key]!==undefined)assert(Number.isFinite(wave[key]),`${label}: wave ${wave.id} ${key} is finite`);
};
let mid=null;
for(const {seed,races,doctrines} of duels){
  const s=createGame(seed,'hard',{...MAP_SIZES.standard,races,aiTeams:[0,1],aiProfiles:{0:{doctrine:doctrines[0]},1:{doctrine:doctrines[1]}}});
  const shadows=[];
  const tick=()=>{
    updateGame(s,.25);
    for(const shadow of shadows)if(shadow.left>0){
      updateGame(shadow.game,.25);
      if(--shadow.left===0){assert.deepEqual(snapshot(shadow.game),snapshot(s),`${seed}: resumes exactly from the first live ${shadow.key} plan`);resumed.add(shadow.key);}
    }
    [s.aiByTeam[0],s.ai].forEach((ai,side)=>{for(const key of PLANS)if(ai[key]){
      // The first live moment of a plan in this duel: fork a restored copy and follow it for 30 seconds.
      if(!seen[side][key]&&!resumed.has(key)&&!shadows.some(shadow=>shadow.key===key))shadows.push({key,game:decodeGame(encodeGame(s)).game,left:120});
      seen[side][key]++;
    }});
  };
  for(let block=0;block<8&&s.status==='playing';block++){for(let i=0;i<120;i++)tick();loads(s,`${seed} at ${s.time.toFixed(0)} s`);}
  const restored=decodeGame(encodeGame(s)).game;
  assert.deepEqual(snapshot(restored),snapshot(s),`${seed}: the save captures the commanders exactly`);
  for(let block=0;block<8&&s.status==='playing';block++){
    for(let i=0;i<120;i++){tick();updateGame(restored,.25);}
    assert.deepEqual(snapshot(restored),snapshot(s),`${seed}: identical after ${270+block*30} s`);
    loads(s,`${seed} at ${s.time.toFixed(0)} s`);loads(restored,`${seed} restored at ${restored.time.toFixed(0)} s`);
    if(!mid&&s.ai.waves&&s.ai.intel)mid=encodeGame(s);
  }
}
for(const key of ['waves','harass','intel'])assert(resumed.has(key),`A live ${key} plan was saved and resumed exactly`);
assert(seen.every(side=>side.waves&&side.intel),'Both sides of the duels raid and scout');
assert(mid,'A save with live commander plans was captured');

// Every commander plan field is validated: malformed or out-of-range values are refused.
const corrupt=[
  g=>{g.ai.waves[0].ids=['x'];},g=>{g.ai.waves[0].ids=[g.nextId+5];},g=>{g.ai.waves[0].state='charge';},g=>{g.ai.waves[0].kind='feint';},
  g=>{g.ai.waves[0].tx=-4;},g=>{g.ai.waves[0].since=g.time+10;},g=>{g.ai.waves[0].id=g.ai.waveId+1;},
  g=>{g.ai.waves[0].state='regroup';delete g.ai.waves[0].rx;},g=>{Object.assign(g.ai.waves[0],{state:'regroup',rx:null,ry:null,need:1});},g=>{g.ai.waves[0].targetId=0;},
  g=>{g.ai.waves[0].ids=[g.ai.waves[0].ids[0],g.ai.waves[0].ids[0]];},
  g=>{g.ai.waves=Array(65).fill(g.ai.waves[0]);},g=>{g.ai.waveId=-1;},
  g=>{g.ai.harass={ids:[1,2,3,4,5,6,7,8,9],tx:1,ty:1,state:'hunt',since:0,legs:0};},g=>{g.ai.harass={ids:[],tx:1,ty:1,state:'lurk',since:0,legs:0};},
  g=>{g.ai.intel={index:-1,next:0};},g=>{g.ai.intel={index:0,next:0,route:Array(9).fill({x:1,y:1})};},g=>{g.ai.intel={index:2,next:0,route:[{x:1,y:1}]};},
  g=>{g.ai.intel={index:0,next:0,spot:{x:1,y:1}};},g=>{g.ai.intel={index:0,next:0,repair:1};},
  g=>{g.ai.shelled={x:1,y:1,at:0,hits:0};},g=>{g.ai.shelled={x:1,y:1,at:0,hits:2,answered:0,bx:3,by:0};},g=>{g.ai.shelled={x:-1,y:1,at:0,hits:1};},
  g=>{g.ai.wallTried=[0];},g=>{g.ai.wallTried=Array(65).fill(1);},g=>{g.ai.nextHarass=-5;},g=>{g.ai.nextWalls='soon';},g=>{g.ai.nextRefinery=Infinity;},
];
for(const mutate of corrupt){
  const raw=JSON.parse(mid);mutate(raw.game);
  assert.throws(()=>decodeGame(JSON.stringify(raw)),`Malformed commander plan is refused: ${mutate}`);
}
const valid=JSON.parse(mid);assert.doesNotThrow(()=>decodeGame(JSON.stringify(valid)));
console.log(`AI duel checks passed: ${duels.length} doctrine duels resume exactly from mid-battle saves and from the first live ${[...resumed].join(', ')} plans; every 30-second save loads (plan ticks per side: ${JSON.stringify(seen)}); ${corrupt.length} malformed commander plans are refused.`);
