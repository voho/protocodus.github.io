// Real AI-versus-AI race trials. This is an empirical harness, not a scripted unit-strength comparison.
// --doctrines a,b plays doctrine a against doctrine b: both race orientations and both doctrine assignments.
// --profile a,b plays only those map profiles; without it, every profile.
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGame,updateGame,MAP_SIZES,MAP_PROFILES,UNIT_CAP,BUILDINGS,UNITS,buildingRole,unitRole,powerStats} from '../sim.js';
import {DOCTRINES} from '../ai.js';

const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const selected=option('--profile'),suite=option('--suite')||'calibration',size=option('--size')||'standard',difficulty=option('--difficulty')||'hard';
const doctrines=option('--doctrines')?.split(',');
assert.ok(Object.hasOwn(MAP_SIZES,size),'--size must be standard, frontier, or vast');
assert.ok(['calibration','holdout','extended'].includes(suite));
assert.ok(['easy','normal','hard'].includes(difficulty),'--difficulty must be easy, normal or hard');
assert.ok(!doctrines||doctrines.length===2&&doctrines.every(id=>Object.hasOwn(DOCTRINES,id)),'--doctrines takes two doctrine ids, such as balanced,swarm');
const seeds=suite==='extended'?['EXTENDED-HORIZON-06']:suite==='holdout'?['HOLDOUT-EMBER-04','HOLDOUT-OBSIDIAN-05']:['BALANCE-CINDER-01','BALANCE-VAULT-02','BALANCE-DUSK-03'];
const profiles=selected?selected.split(','):Object.keys(MAP_PROFILES);
assert.ok(profiles.every(profile=>Object.hasOwn(MAP_PROFILES,profile)),`--profile takes one or more of ${Object.keys(MAP_PROFILES).join(', ')}, separated by commas`);
const limit=Number(option('--limit')||2400),output=option('--output')||`/tmp/ashline-race-balance-${doctrines?doctrines.join('-'):selected?profiles.join('-'):'all'}.json`;
// Provenance covers every simulation module, in a fixed order, so a change to any of them is visible.
const simulationSources=['sim.js','ai.js','terrain.js','flocking.js','traffic.js','mission.js','campaign.js','abilities.js'];
const simulationSha256=simulationSources.reduce((digest,file)=>digest.update(`${file}\n`).update(readFileSync(new URL(`../${file}`,import.meta.url))),createHash('sha256')).digest('hex');
const report={generatedAt:new Date().toISOString(),simulationSha256,simulationSources,balanceConfig:{units:Object.fromEntries(Object.entries(UNITS).map(([type,d])=>[type,{hp:d.hp,damage:d.damage,interval:d.interval,speed:d.speed,cost:d.cost,trainTime:d.trainTime}])),buildings:Object.fromEntries(Object.entries(BUILDINGS).map(([type,d])=>[type,{hp:d.hp,power:d.power,cost:d.cost,buildTime:d.buildTime}]))},parameters:{suite,size,difficulty,doctrines:doctrines??null,unitCap:UNIT_CAP,width:MAP_SIZES[size].width,height:MAP_SIZES[size].height,step:.25,timeLimitSeconds:limit,seeds,profiles,aiTeams:[0,1],pairedSideSwaps:true},matches:[]};
// Null-prototype tallies: the role "constructor" must never read Object.prototype.constructor.
const tally=()=>Object.create(null);
const countBy=(values,key)=>values.reduce((counts,value)=>{const k=key(value);counts[k]=(counts[k]||0)+1;return counts;},tally());
const pairings=[];
for(const races of [['organics','aiUnity'],['aiUnity','organics']])for(const assigned of doctrines?[doctrines,[...doctrines].reverse()]:[null])pairings.push({races,assigned});
for(const profile of profiles)for(const seed of seeds)for(const {races,assigned} of pairings){
  const aiProfiles=assigned?{0:{doctrine:assigned[0]},1:{doctrine:assigned[1]}}:{};
  const s=createGame(seed,difficulty,{...MAP_SIZES[size],profile,races,aiTeams:[0,1],aiProfiles}),start=performance.now(),peakUnits=[0,0],peakComposition=[tally(),tally()],samples=[];
  const firstRaid=[null,null],floatSeconds=[0,0],peakCores=[1,1];
  for(let tick=0;tick<limit*4&&s.status==='playing';tick++){
    updateGame(s,.25);
    for(const team of [0,1]){
      const ai=team?s.ai:s.aiByTeam[0];if(ai.raid&&firstRaid[team]===null)firstRaid[team]=+s.time.toFixed(2);
      if(s.teams[team].credits>1500)floatSeconds[team]+=.25;
    }
    if(tick%4===0){
      for(const team of [0,1]){
        const units=s.entities.filter(e=>e.team===team&&e.kind==='unit');peakUnits[team]=Math.max(peakUnits[team],units.length);
        assert.ok(units.length<=UNIT_CAP&&s.teams[team].credits>=0,'AI obeys population and economy limits');
        for(const [type,count] of Object.entries(countBy(units,e=>e.type)))peakComposition[team][type]=Math.max(peakComposition[team][type]||0,count);
        peakCores[team]=Math.max(peakCores[team],s.entities.filter(e=>e.team===team&&buildingRole(e)==='core'&&e.progress>=1).length);
      }
    }
    if(tick%240===0)samples.push({time:+s.time.toFixed(2),units:[0,1].map(team=>s.entities.filter(e=>e.team===team&&e.kind==='unit').length),credits:s.teams.map(team=>Math.round(team.credits)),kills:s.teams.map(team=>team.kills),power:[0,1].map(team=>powerStats(s,team).status),research:s.teams.map(team=>Object.keys(team.research||{}))});
  }
  // The Charter rule decides: status is reported from side 0, and a side keeps its claim while a nexus or
  // a construction vehicle survives.
  const winner=s.status==='victory'?0:s.status==='defeat'?1:null,cores=[0,1].map(team=>s.entities.find(e=>e.team===team&&buildingRole(e)==='core'&&e.hp>0));
  assert.ok(winner===null||!cores[winner^1]&&!s.entities.some(e=>e.team===(winner^1)&&unitRole(e)==='constructor'),'Victory requires the loser to have no nexus and no construction vehicle');
  const haulersLost=[0,1].map(team=>s.events.filter(e=>e.team===team&&e.kind==='unitLost'&&e.role==='harvester').length);
  const match={seed,profile,size,difficulty,races,doctrines:assigned,winnerTeam:winner,winnerRace:winner===null?null:races[winner],winnerDoctrine:winner===null||!assigned?null:assigned[winner],
    result:winner===null?'time-limit draw':s.status,timeSeconds:+s.time.toFixed(2),wallTimeMs:Math.round(performance.now()-start),kills:s.teams.map(team=>team.kills),credits:s.teams.map(team=>Math.round(team.credits)),
    peakUnits,peakComposition,finalComposition:[0,1].map(team=>countBy(s.entities.filter(e=>e.team===team&&e.kind==='unit'),e=>unitRole(e))),research:s.teams.map(team=>Object.keys(team.research||{})),
    raids:[s.aiByTeam[0].raid,s.ai.raid],firstRaid,peakCores,haulersLost,floatSeconds,coreHp:cores.map(core=>core?Math.round(core.hp):0),samples};
  report.matches.push(match);writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({seed,profile,races,doctrines:assigned,winner:match.winnerRace,winnerTeam:winner,winnerDoctrine:match.winnerDoctrine,time:match.timeSeconds,result:match.result,wallTimeMs:match.wallTimeMs,units:peakUnits,coreHp:match.coreHp,raids:match.raids}));
}
const decided=report.matches.filter(match=>match.winnerTeam!==null);
report.summary={matches:report.matches.length,completed:decided.length,draws:report.matches.length-decided.length,wins:countBy(decided,match=>match.winnerRace),sideWins:countBy(decided,match=>match.winnerTeam),...(doctrines?{doctrineWins:countBy(decided,match=>match.winnerDoctrine)}:{})};
writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,summary:report.summary}));
