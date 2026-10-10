// Commander doctrines and difficulty tiers: the table, deterministic 'random' commanders, setup listing,
// race-aware commander names, each doctrine's signature in real games, walls that never seal a base, and
// a Cadet that a modest scripted player can beat.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,updateGame,MAP_SIZES,RESEARCH,UNITS,BUILDINGS,canPlace,placeBuilding,trainUnit,issueOrder,entityRole,rebuildNavigation,center,addEntity} from '../sim.js';
import {DOCTRINES,LEVEL_NAMES,newAI,aiKnobs,aiCommander,doctrineOptions,randomDoctrine} from '../ai.js';

const ROLES=['rifle','rocket','scout','tank','artillery','striker'];

test('every doctrine is complete, original and well formed',()=>{
  const ids=Object.keys(DOCTRINES);
  assert(ids.length>=5&&ids[0]==='balanced','Balanced plus at least four doctrines');
  const names=new Set();
  for(const [id,d] of Object.entries(DOCTRINES)){
    for(const key of ['name','commander','callsign','description'])assert(typeof d[key]==='string'&&d[key].length>1,`${id}.${key}`);
    assert(d.unity.commander&&d.unity.callsign,`${id} names a Unity commander`);
    names.add(d.commander);names.add(d.unity.commander);
    const k=d.knobs,mix=ROLES.reduce((sum,role)=>sum+(k.mix[role]||0),0);
    assert(Math.abs(mix-1)<1e-9&&Object.keys(k.mix).every(role=>ROLES.includes(role)),`${id} mix covers combat roles and sums to one`);
    assert.deepEqual([...k.research].sort(),Object.keys(RESEARCH).sort(),`${id} orders every research project`);
    assert(Object.keys(k.targets).every(role=>Object.values(BUILDINGS).some(b=>b.role===role)),`${id} targets real structures`);
    for(const key of ['raid','wave','expand','storm'])assert(k[key]>0,`${id}.${key}`);
  }
  assert.equal(names.size,ids.length*2,'Every commander has a distinct name');
  assert.deepEqual(Object.keys(LEVEL_NAMES),['easy','normal','hard']);
});

test("'random' resolves once from the seed and team, never stored as random",()=>{
  const seen=new Set();
  for(let i=0;i<40;i++){
    const seed=`RANDOM-${i}`,s=createGame(seed,'normal',{width:72,height:56,aiTeams:[0,1],aiProfiles:{0:{doctrine:'random'},1:{doctrine:'random'}}});
    assert.equal(s.ai.doctrine,randomDoctrine(seed,1));assert.equal(s.aiByTeam[0].doctrine,randomDoctrine(seed,0));
    assert(Object.hasOwn(DOCTRINES,s.ai.doctrine));seen.add(s.ai.doctrine);
    assert.equal(createGame(seed,'normal',{width:72,height:56,aiProfiles:{1:{doctrine:'random'}}}).ai.doctrine,s.ai.doctrine,'The same operation always meets the same commander');
  }
  assert(seen.size>=4,'Random commanders vary across operations');
  assert.throws(()=>newAI('normal',{doctrine:'random'}),RangeError,'Random needs an operation to resolve against');
  const options=doctrineOptions();
  assert.equal(options[0].id,'random');
  assert.deepEqual(options.slice(1).map(o=>o.id),Object.keys(DOCTRINES));
  assert(options.every(o=>o.name&&o.description));
});

test('commander identity follows the doctrine and the race; a doctrine shifts the first raid',()=>{
  const s=createGame('IDENTITY','hard',{width:72,height:56,races:['organics','aiUnity'],aiTeams:[0,1],aiProfiles:{0:{doctrine:'ironclad'},1:{doctrine:'swarm'}}});
  assert.deepEqual(aiCommander(s,0),{doctrine:'ironclad',name:'Ironclad',commander:DOCTRINES.ironclad.commander,callsign:DOCTRINES.ironclad.callsign,description:DOCTRINES.ironclad.description});
  assert.equal(aiCommander(s,1).commander,DOCTRINES.swarm.unity.commander,'Unity commanders carry machine designations');
  assert.equal(aiCommander(createGame('IDENTITY','hard',{width:72,height:56}),0),null,'A human side has no commander');
  assert.equal(aiCommander(createGame('IDENTITY','hard',{width:72,height:56}),1).doctrine,'balanced','No profile means Balanced');
  assert(s.ai.nextRaid<s.aiByTeam[0].nextRaid,'Swarm raids before Ironclad');
});

test('difficulty is behaviour: Cadet slow and plain, Commander adaptive, Veteran everything',()=>{
  const k=level=>aiKnobs({difficulty:level},{});
  const [easy,normal,hard]=['easy','normal','hard'].map(k);
  assert(easy.think>normal.think&&normal.think>hard.think,'Thinks faster with rank');
  assert(easy.firstRaid>normal.firstRaid&&normal.firstRaid>hard.firstRaid);
  assert(easy.waveMax<=8&&easy.caps.artillery===0,'Cadet columns stay small and never bring siege guns');
  assert(!easy.abilities&&!easy.lanchester&&!easy.adapt&&!easy.focus&&!easy.harass&&!easy.walls,'Cadet uses no advanced behaviour');
  assert(normal.abilities&&normal.lanchester&&normal.adapt>0&&!normal.focus,'Commander adapts and uses abilities but does not micro');
  assert(hard.focus>0&&hard.harass>0&&hard.walls&&hard.adapt>normal.adapt,'Veteran focus-fires, raids haulers and walls its towers');
  assert.equal(aiKnobs({difficulty:'normal'},{doctrine:'swarm'}).harass,DOCTRINES.swarm.knobs.harass,'Raider doctrines hunt haulers from Commander up');
  assert.equal(aiKnobs({difficulty:'normal'},{doctrine:'balanced'}).harass,0);
});

// A passive base with powered towers facing the rival, placed on clear ground near its nexus.
function fortify(s,core){
  const c=center(core),dx=s.width/2-c.x,dy=s.height/2-c.y,length=Math.hypot(dx,dy);
  addEntity(s,0,'building','reactor',core.x-3,core.y+1);rebuildNavigation(s);
  for(const [type,turn] of [['rocketTower',0],['turret',.5],['rocketTower',-.5]]){
    const angle=Math.atan2(dy,dx)+turn,size=BUILDINGS[type].size;
    for(let r=6;r<14;r++){
      const x=Math.round(c.x+Math.cos(angle)*r-size/2),y=Math.round(c.y+Math.sin(angle)*r-size/2);let clear=true;
      for(let yy=y;yy<y+size;yy++)for(let xx=x;xx<x+size;xx++){const i=yy*s.width+xx;clear&&=s.terrain[i]===0&&!s.minerals[i]&&!s.blocked[i];}
      if(clear){addEntity(s,0,'building',type,x,y);rebuildNavigation(s);break;}
    }
  }
  void length;
}
// Each doctrine plays a passive opponent whose nexus is kept standing, so the game runs its full course.
function signature(doctrine,{seconds=480,seed='SIGNATURE-1',profile='rift',fortified=false}={}){
  const s=createGame(seed,'hard',{...MAP_SIZES.standard,profile,aiProfiles:{1:{doctrine}}}),core=s.entities.find(e=>e.team===0&&entityRole(e)==='core');
  if(fortified)fortify(s,core);
  const out={doctrine,s,firstRaid:null,harass:false,siege:false,peak:Object.create(null),nexusAt:null,maxWave:0};
  for(let tick=0;tick<seconds*4;tick++){
    core.hp=core.maxHp;updateGame(s,.25);
    if(s.ai.raid&&out.firstRaid===null)out.firstRaid=s.time;
    out.harass||=!!s.ai.harass;out.siege||=(s.ai.waves||[]).some(w=>w.siege);
    for(const w of s.ai.waves||[])out.maxWave=Math.max(out.maxWave,w.ids.length);
    if(tick%8===0){
      const count=Object.create(null);for(const e of s.entities)if(e.team===1){const r=entityRole(e);count[r]=(count[r]||0)+1;}
      for(const r in count)out.peak[r]=Math.max(out.peak[r]||0,count[r]);
      if(out.nexusAt===null&&s.entities.some(e=>e.team===1&&entityRole(e)==='core'&&e.progress>=1&&Math.hypot(e.x-s.entities.find(c=>c.team===1&&entityRole(c)==='core').x,e.y-s.entities.find(c=>c.team===1&&entityRole(c)==='core').y)>15))out.nexusAt=s.time;
    }
  }
  return out;
}
const results={};
const run=(doctrine,options={})=>results[`${doctrine}:${JSON.stringify(options)}`]??=signature(doctrine,options);
const infantry=r=>((r.peak.rifle||0)+(r.peak.rocket||0)+(r.peak.scout||0))/Math.max(1,ROLES.reduce((n,role)=>n+(r.peak[role]||0),0));

test('Swarm raids early and often with infantry, rovers and strikers, and hunts haulers',{timeout:120000},()=>{
  const swarm=run('swarm'),balanced=run('balanced');
  assert(swarm.firstRaid<balanced.firstRaid,'Swarm attacks first');
  assert(swarm.s.ai.raid>balanced.s.ai.raid,'and more often');
  assert(swarm.harass,'A raider squad goes after haulers');
  assert(infantry(swarm)>infantry(balanced),'Its army leans on infantry and rovers');
  assert((swarm.peak.striker||0)>0,'Strikers join once the assembly bay is fitted');
});

test('Ironclad walls a wide sentry line and hits with fewer, heavier waves',{timeout:120000},()=>{
  const iron=run('ironclad'),balanced=run('balanced');
  const towers=r=>(r.peak.turret||0)+(r.peak.rocketTower||0);
  assert(towers(iron)>towers(balanced),'More defensive towers');
  assert((iron.peak.wall||0)>=4,'Walls in front of its towers');
  assert(iron.firstRaid>balanced.firstRaid&&iron.maxWave>=aiKnobs(iron.s,iron.s.ai).waveMin,'One later, heavier push');
  const armor=r=>((r.peak.tank||0)+(r.peak.artillery||0))/Math.max(1,ROLES.reduce((n,role)=>n+(r.peak[role]||0),0));
  assert(armor(iron)>armor(balanced),'A larger share of tanks and siege guns');
});

test('Prospector claims remote fields first',{timeout:120000},()=>{
  const pro=run('prospector'),balanced=run('balanced');
  assert(pro.nexusAt!==null&&(balanced.nexusAt===null||pro.nexusAt<balanced.nexusAt),'Its first remote nexus stands before Balanced has one');
  assert((pro.peak.core||0)>=(balanced.peak.core||0)&&(pro.peak.refinery||0)>=(balanced.peak.refinery||0),'A broader economy');
});

test('Siegebreaker brings guns, spotters and stand-off sieges',{timeout:120000},()=>{
  const siege=run('siegebreaker'),balanced=run('balanced'),fortified=run('siegebreaker',{fortified:true});
  assert((siege.peak.artillery||0)>(balanced.peak.artillery||0),'More siege crawlers');
  assert((siege.peak.scout||0)>=2,'Rovers spot for the guns');
  assert(fortified.siege,'A tower line is besieged from beyond its reach');
  assert(fortified.s.entities.filter(e=>e.team===0&&BUILDINGS[e.type]?.damage).length<3,'and the guns bring towers down');
});

test('AI walls never seal production bays, hauler lanes or the way out',{timeout:120000},()=>{
  for(const r of [run('ironclad'),run('ironclad',{seed:'SIGNATURE-2',profile:'highlands'})]){
    const {s}=r;rebuildNavigation(s);
    assert(s.entities.filter(e=>e.team===1&&entityRole(e)==='wall').length>=4,`${r.doctrine} built walls`);
    const open=(x,y)=>x>=0&&y>=0&&x<s.width&&y<s.height&&!s.blocked[y*s.width+x]&&s.regionSize[s.regions[y*s.width+x]]>=40;
    const ring=e=>{const cells=[];for(let y=e.y-2;y<=e.y+e.size+1;y++)for(let x=e.x-2;x<=e.x+e.size+1;x++)if(open(x,y))cells.push(y*s.width+x);return cells;};
    const home=s.entities.find(e=>e.team===1&&entityRole(e)==='core'),homeRegion=s.regions[ring(home)[0]];
    for(const e of s.entities)if(e.team===1&&['barracks','factory','refinery','core'].includes(entityRole(e))&&e.progress>=1){
      assert(ring(e).length>0,`${r.doctrine} ${entityRole(e)} keeps an open spawn bay`);
    }
    for(const e of s.entities)if(e.team===1&&entityRole(e)==='refinery'&&e.progress>=1){
      const regions=new Set(ring(e).map(i=>s.regions[i]));
      let reaches=false;for(let i=0;i<s.minerals.length&&!reaches;i++)if(s.minerals[i]>0){const x=i%s.width,y=Math.floor(i/s.width);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])if(open(x+dx,y+dy)&&regions.has(s.regions[(y+dy)*s.width+x+dx]))reaches=true;}
      assert(reaches,`${r.doctrine} refinery haulers still reach shards`);
    }
    const enemy=s.entities.find(e=>e.team===0&&entityRole(e)==='core');
    assert(ring(enemy).some(i=>s.regions[i]===homeRegion),`${r.doctrine} army can still leave the base`);
  }
});

test('a modest scripted player beats the Cadet commander',{timeout:120000},()=>{
  const s=createGame('cadet-check','easy');
  const home=s.entities.find(e=>e.team===0&&e.type==='core'),enemy=s.entities.find(e=>e.team===1&&e.type==='core'),goal=center(enemy);
  const mine=type=>s.entities.filter(e=>e.team===0&&(!type||e.type===type));
  const build=type=>{let best;for(let y=home.y-12;y<home.y+11;y++)for(let x=home.x-6;x<home.x+20;x++)if(canPlace(s,0,type,x,y).ok){const d=Math.hypot(x-home.x-8,y-home.y+3);if(!best||d<best.d)best={x,y,d};}if(best)placeBuilding(s,0,type,best.x,best.y);};
  // One barracks and one foundry, a steady trickle of rifles and tanks, and a single push at four minutes.
  for(let tick=0;tick<6000&&s.status==='playing';tick++){
    if(tick%30===0){
      if(!mine().some(e=>e.kind==='building'&&e.progress<1)){if(!mine('barracks').length)build('barracks');else if(!mine('factory').length)build('factory');else if(mine('reactor').length<2)build('reactor');}
      if(mine('harvester').length<2)trainUnit(s,0,'harvester');
      if(s.teams[0].credits>300)trainUnit(s,0,mine('rifle').length<6?'rifle':'tank');
      if(s.time>=240)for(const u of mine().filter(e=>e.kind==='unit'&&UNITS[e.type].damage&&e.order.type==='idle'))issueOrder(s,[u.id],{type:'attackMove',...goal});
    }
    updateGame(s,.1);
  }
  assert.equal(s.status,'victory','A plain build and one push defeats Cadet');
});
