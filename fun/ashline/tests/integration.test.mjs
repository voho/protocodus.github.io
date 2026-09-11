import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,updateGame,MAP_SIZES,UNIT_CAP,UNITS,powerStats} from '../sim.js';
import {encodeGame,decodeGame} from '../save.js';

const advance=(s,seconds)=>{for(let i=0;i<seconds*4;i++)updateGame(s,.25);};
const snapshot=s=>JSON.parse(encodeGame(s)).game;

for(const dimensions of [{width:72,height:56},MAP_SIZES.standard,MAP_SIZES.vast]){
  test(`save continuation is deterministic at ${dimensions.width}×${dimensions.height}`,()=>{
    const s=createGame('CONTINUATION','normal',{...dimensions,profile:'basin'});
    advance(s,90);
    const saved=encodeGame(s),loaded=decodeGame(saved).game;
    assert.deepEqual(snapshot(loaded),snapshot(s));
    for(let second=0;second<75;second++){updateGame(s,1);updateGame(loaded,1);}
    assert.deepEqual(snapshot(loaded),snapshot(s),'restored simulation has identical positions, orders, AI, economy, fog and effects');
  });
}

test('legacy save conversion preserves every stored terrain tile and depleted reserve',()=>{
  const s=createGame('LEGACY-CONTENT','easy',{...MAP_SIZES.standard});
  const i=s.minerals.findIndex(value=>value>0);
  s.minerals[i]-=17.5;
  const old=JSON.parse(encodeGame(s));
  delete old.game.mapProfile;delete old.game.mineralTypes;
  for(const team of old.game.teams)delete team.research;
  for(const e of old.game.entities)delete e.tech;
  const loaded=decodeGame(JSON.stringify(old)).game;
  assert.deepEqual(Array.from(loaded.terrain),old.game.terrain);
  assert.deepEqual(Array.from(loaded.minerals),old.game.minerals);
  assert.equal(loaded.minerals[i],s.minerals[i]);
  assert.ok(loaded.mineralTypes.every((type,i)=>type===(loaded.minerals[i]>0?1:0)),'legacy materials default to mint without regenerating positions');
  assert.doesNotThrow(()=>encodeGame(loaded));
});

test('unseen player army composition cannot change early AI choices',()=>{
  const a=createGame('HIDDEN-COMPOSITION','hard'),b=createGame('HIDDEN-COMPOSITION','hard');
  for(const e of b.entities)if(e.team===0&&e.type==='rifle'){
    e.type='tank';e.size=UNITS.tank.size;e.hp=e.maxHp=UNITS.tank.hp;
  }
  advance(a,6);advance(b,6);
  assert.deepEqual(a.ai.known,{},'no starting player entities are visible to the enemy');
  assert.deepEqual(b.ai.known,{});
  assert.deepEqual(b.ai,a.ai);
  assert.deepEqual(b.entities.filter(e=>e.team===1),a.entities.filter(e=>e.team===1));
});

for(const difficulty of ['easy','normal','hard']){
  test(`${difficulty}: ten-minute vast-map economy, research, population and save soak`,{timeout:45000},t=>{
    const s=createGame('TEN-MINUTE',difficulty,{...MAP_SIZES.vast,profile:'highlands'});
    const core=s.entities.find(e=>e.team===0&&e.type==='core'),start=performance.now();
    // Keep the passive player's nexus alive so late-game production and combat run for all ten minutes.
    for(let tick=0;tick<2400;tick++){
      core.hp=core.maxHp;updateGame(s,.25);
      assert.equal(s.status,'playing');
      for(const team of [0,1]){
        assert.ok(Number.isFinite(s.teams[team].credits)&&s.teams[team].credits>=0);
        assert.ok(s.entities.filter(e=>e.team===team&&e.kind==='unit').length<=UNIT_CAP,'population cap is preserved');
      }
      for(const e of s.entities)assert.ok(Number.isFinite(e.x)&&Number.isFinite(e.y)&&Number.isFinite(e.hp)&&e.hp<=e.maxHp+.0001&&e.x>=0&&e.y>=0&&e.x<s.width&&e.y<s.height,'entities stay finite and in bounds');
    }
    assert.ok(Math.abs(s.time-600)<.001);
    assert.ok(s.ai.raid>0,'AI leaves its base and conducts raids');
    assert.ok(s.entities.some(e=>e.team===1&&e.type==='factory'&&e.progress===1),'AI develops armored production');
    if(difficulty!=='easy'){
      assert.ok(Object.keys(s.teams[1].research||{}).length>=3,'AI invests in research');
      assert.ok(s.entities.filter(e=>e.team===1&&e.type==='refinery').length>=2,'AI expands its economy');
      const nexuses=s.entities.filter(e=>e.team===1&&e.type==='core'&&e.progress===1);
      assert.ok(nexuses.length>=2&&nexuses.some(e=>Math.hypot(e.x-nexuses[0].x,e.y-nexuses[0].y)>20),'The starting economy funds completed remote nexuses without injected credits');
    }
    assert.equal(powerStats(s,1).status,'stable','AI sustains its power grid');
    const saved=encodeGame(s),loaded=decodeGame(saved).game;
    assert.ok(saved.length<4_000_000,'large operation fits the bounded save format');
    assert.deepEqual(snapshot(loaded),snapshot(s));
    t.diagnostic(`${(performance.now()-start).toFixed(0)} ms for 600 simulated seconds; ${s.entities.length} entities; ${(saved.length/1024).toFixed(0)} KiB save`);
  });
}
