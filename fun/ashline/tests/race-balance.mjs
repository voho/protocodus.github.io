// Real AI-versus-AI race trials. This is an empirical harness, not a scripted unit-strength comparison.
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGame,updateGame,MAP_SIZES,MAP_PROFILES,UNIT_CAP,BUILDINGS,UNITS,buildingRole,unitRole,powerStats} from '../sim.js';

const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const selected=option('--profile'),suite=option('--suite')||'calibration',size=option('--size')||'standard';
assert.ok(Object.hasOwn(MAP_SIZES,size),'--size must be standard, frontier, or vast');
assert.ok(['calibration','holdout','extended'].includes(suite));
const seeds=suite==='extended'?['EXTENDED-HORIZON-06']:suite==='holdout'?['HOLDOUT-EMBER-04','HOLDOUT-OBSIDIAN-05']:['BALANCE-CINDER-01','BALANCE-VAULT-02','BALANCE-DUSK-03'];
const profiles=selected?[selected]:Object.keys(MAP_PROFILES);
assert.ok(profiles.every(profile=>Object.hasOwn(MAP_PROFILES,profile)));
const limit=Number(option('--limit')||2400),output=option('--output')||`/tmp/ashline-race-balance-${selected||'all'}.json`;
const report={generatedAt:new Date().toISOString(),simulationSha256:createHash('sha256').update(readFileSync(new URL('../sim.js',import.meta.url))).digest('hex'),balanceConfig:{units:Object.fromEntries(Object.entries(UNITS).map(([type,d])=>[type,{hp:d.hp,damage:d.damage,interval:d.interval,speed:d.speed,cost:d.cost,trainTime:d.trainTime}])),buildings:Object.fromEntries(Object.entries(BUILDINGS).map(([type,d])=>[type,{hp:d.hp,power:d.power,cost:d.cost,buildTime:d.buildTime}]))},parameters:{suite,size,difficulty:'hard',unitCap:UNIT_CAP,width:MAP_SIZES[size].width,height:MAP_SIZES[size].height,step:.25,timeLimitSeconds:limit,seeds,profiles,aiTeams:[0,1],pairedSideSwaps:true},matches:[]};
const countBy=(values,key)=>values.reduce((counts,value)=>{const k=key(value);counts[k]=(counts[k]||0)+1;return counts;},{});
for(const profile of profiles)for(const seed of seeds)for(const races of [['organics','aiUnity'],['aiUnity','organics']]){
  const s=createGame(seed,'hard',{...MAP_SIZES[size],profile,races,aiTeams:[0,1]}),start=performance.now(),peakUnits=[0,0],peakComposition=[{},{}],samples=[];
  for(let tick=0;tick<limit*4&&s.status==='playing';tick++){
    updateGame(s,.25);
    if(tick%4===0){
      for(const team of [0,1]){
        const units=s.entities.filter(e=>e.team===team&&e.kind==='unit');peakUnits[team]=Math.max(peakUnits[team],units.length);
        assert.ok(units.length<=UNIT_CAP&&s.teams[team].credits>=0,'AI obeys population and economy limits');
        for(const [type,count] of Object.entries(countBy(units,e=>e.type)))peakComposition[team][type]=Math.max(peakComposition[team][type]||0,count);
      }
    }
    if(tick%240===0)samples.push({time:+s.time.toFixed(2),units:[0,1].map(team=>s.entities.filter(e=>e.team===team&&e.kind==='unit').length),credits:s.teams.map(team=>Math.round(team.credits)),kills:s.teams.map(team=>team.kills),power:[0,1].map(team=>powerStats(s,team).status),research:s.teams.map(team=>Object.keys(team.research||{}))});
  }
  const cores=[0,1].map(team=>s.entities.find(e=>e.team===team&&buildingRole(e)==='core'&&e.hp>0)),winner=cores[0]&&!cores[1]?0:cores[1]&&!cores[0]?1:null;
  assert.ok(winner===null||s.status!=='playing','Victory requires an actually destroyed opposing nexus');
  const match={seed,profile,size,races,winnerTeam:winner,winnerRace:winner===null?null:races[winner],result:winner===null?(cores.every(Boolean)?'time-limit draw':'mutual destruction'):s.status,timeSeconds:+s.time.toFixed(2),wallTimeMs:Math.round(performance.now()-start),kills:s.teams.map(team=>team.kills),credits:s.teams.map(team=>Math.round(team.credits)),peakUnits,peakComposition,finalComposition:[0,1].map(team=>countBy(s.entities.filter(e=>e.team===team&&e.kind==='unit'),e=>unitRole(e))),research:s.teams.map(team=>Object.keys(team.research||{})),raids:[s.aiByTeam[0].raid,s.ai.raid],coreHp:cores.map(core=>core?Math.round(core.hp):0),samples};
  report.matches.push(match);writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({seed,profile,races,winner:match.winnerRace,winnerTeam:winner,time:match.timeSeconds,result:match.result,wallTimeMs:match.wallTimeMs,units:peakUnits,coreHp:match.coreHp,raids:match.raids}));
}
report.summary={matches:report.matches.length,completed:report.matches.filter(match=>match.winnerRace).length,draws:report.matches.filter(match=>!match.winnerRace).length,wins:countBy(report.matches.filter(match=>match.winnerRace),match=>match.winnerRace),sideWins:countBy(report.matches.filter(match=>match.winnerRace),match=>match.winnerTeam)};
writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,summary:report.summary}));
