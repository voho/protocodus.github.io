// Long commander duels: every doctrine pairing resumes exactly from a save taken mid-battle, and malformed
// commander plans in a save are refused.
import assert from 'node:assert/strict';
import {createGame,updateGame,MAP_SIZES} from '../sim.js';
import {encodeGame,decodeGame} from '../save.js';

const snapshot=s=>JSON.parse(encodeGame(s)).game;
const advance=(s,seconds)=>{for(let i=0;i<seconds*4;i++)updateGame(s,.25);};
const duels=[
  {seed:'DUEL-SWARM-IRON',races:['organics','aiUnity'],doctrines:['swarm','ironclad']},
  {seed:'DUEL-PROSPECT-SIEGE',races:['aiUnity','organics'],doctrines:['prospector','siegebreaker']},
  {seed:'DUEL-RANDOM',races:['aiUnity','aiUnity'],doctrines:['random','balanced']},
];
const plans={waves:0,harass:0,intel:0,shelled:0};
let mid=null;
for(const {seed,races,doctrines} of duels){
  const s=createGame(seed,'hard',{...MAP_SIZES.standard,races,aiTeams:[0,1],aiProfiles:{0:{doctrine:doctrines[0]},1:{doctrine:doctrines[1]}}});
  advance(s,240);
  const restored=decodeGame(encodeGame(s)).game;
  assert.deepEqual(snapshot(restored),snapshot(s),`${seed}: the save captures the commanders exactly`);
  for(let block=0;block<8&&s.status==='playing';block++){
    advance(s,30);advance(restored,30);
    assert.deepEqual(snapshot(restored),snapshot(s),`${seed}: identical after ${270+block*30} s`);
    for(const ai of [s.ai,s.aiByTeam[0]])for(const key of Object.keys(plans))if(ai[key])plans[key]++;
    if(!mid&&s.ai.waves&&s.ai.intel)mid=encodeGame(s);
  }
}
assert(plans.waves&&plans.intel,'The duels exercise waves and scouting plans');
assert(mid,'A save with live commander plans was captured');

// Every commander plan field is validated: malformed or out-of-range values are refused.
const corrupt=[
  g=>{g.ai.waves[0].ids=['x'];},g=>{g.ai.waves[0].ids=[g.nextId+5];},g=>{g.ai.waves[0].state='charge';},g=>{g.ai.waves[0].kind='feint';},
  g=>{g.ai.waves[0].tx=-4;},g=>{g.ai.waves[0].since=g.time+10;},g=>{g.ai.waves[0].id=g.ai.waveId+1;},
  g=>{g.ai.waves[0].state='regroup';delete g.ai.waves[0].rx;},g=>{g.ai.waves[0].targetId=0;},g=>{g.ai.waves[0].ids=[g.ai.waves[0].ids[0],g.ai.waves[0].ids[0]];},
  g=>{g.ai.waves=Array(65).fill(g.ai.waves[0]);},g=>{g.ai.waveId=-1;},
  g=>{g.ai.harass={ids:[1,2,3,4,5,6,7,8,9],tx:1,ty:1,state:'hunt',since:0,legs:0};},g=>{g.ai.harass={ids:[],tx:1,ty:1,state:'lurk',since:0,legs:0};},
  g=>{g.ai.intel={index:-1,next:0};},g=>{g.ai.intel={index:0,next:0,route:Array(9).fill({x:1,y:1})};},g=>{g.ai.intel={index:2,next:0,route:[{x:1,y:1}]};},
  g=>{g.ai.intel={index:0,next:0,spot:{x:1,y:1}};},g=>{g.ai.intel={index:0,next:0,repair:1};},
  g=>{g.ai.shelled={x:1,y:1,at:0,hits:0};},g=>{g.ai.shelled={x:1,y:1,at:0,hits:2,answered:0,bx:3,by:0};},g=>{g.ai.shelled={x:-1,y:1,at:0,hits:1};},
  g=>{g.ai.nextHarass=-5;},g=>{g.ai.nextWalls='soon';},g=>{g.ai.nextRefinery=Infinity;},
];
for(const mutate of corrupt){
  const raw=JSON.parse(mid);mutate(raw.game);
  assert.throws(()=>decodeGame(JSON.stringify(raw)),`Malformed commander plan is refused: ${mutate}`);
}
const valid=JSON.parse(mid);assert.doesNotThrow(()=>decodeGame(JSON.stringify(valid)));
console.log(`AI duel checks passed: ${duels.length} doctrine duels resume exactly from mid-battle saves (plans seen: ${JSON.stringify(plans)}), and ${corrupt.length} malformed commander plans are refused.`);
