import assert from 'node:assert/strict';
import {createGame,MAP_SIZES,MAP_PROFILES,mapLayout,canPlace,placeBuilding,updateGame,issueOrder} from '../sim.js';

const dimensions=[{width:72,height:56},...Object.values(MAP_SIZES)];
const mineralTotal=s=>s.minerals.reduce((n,v)=>n+v,0);
const summary=[];
for(const size of dimensions)for(let seed=0;seed<24;seed++){
  const s=createGame(`distribution-${seed}`,'normal',size),again=createGame(s.seed,'normal',size),area=s.width*s.height/(72*56),{start,end}=mapLayout(s);
  assert.deepEqual(s.terrain,again.terrain);assert.deepEqual(s.minerals,again.minerals);assert.equal(s.rng,again.rng);
  const scouts=s.entities.filter(e=>e.type==='scout'),region=s.regions[Math.floor(scouts[0].y)*s.width+Math.floor(scouts[0].x)],quadrants=new Set();
  assert(region>0);assert(scouts.every(e=>s.regions[Math.floor(e.y)*s.width+Math.floor(e.x)]===region),'Both armies retain connected routes');
  let trees=0,minerals=0,loose=0;
  for(let i=0;i<s.terrain.length;i++){
    const x=i%s.width,y=Math.floor(i/s.width);
    if(s.terrain[i]===4){
      trees++;quadrants.add(Math.floor(x/(s.width/2))+2*Math.floor(y/(s.height/2)));
      assert.equal(s.blocked[i],1);assert.equal(s.minerals[i],0);
      assert(Math.hypot(x-start.x,y-start.y)>11&&Math.hypot(x-end.x,y-end.y)>11,'Base construction clearings stay tree-free');
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy){const j=(y+dy)*s.width+x+dx;assert([0,2,5].includes(s.terrain[j]),'Trees grow on scattered open ground with an open ring, not rocky ridges');assert.equal(s.minerals[j],0);}
    }
    if(s.minerals[i]>0){
      minerals++;assert.equal(s.regions[i],region,'Every mineral satellite is reachable from the starting armies');assert.equal(s.blocked[i],0);
      const neighbors=[i-1,i+1,i-s.width,i+s.width].filter(j=>s.minerals[j]>0).length;if(neighbors<=1)loose++;
    }
  }
  assert(trees>=4*area&&trees<=70*area,'Trees remain sparse at either map size');assert(quadrants.size>=(s.width===72?2:4),'Mirrored trees cover open sectors; compact legacy clearings can occupy two quadrants');
  assert(minerals>=150&&minerals/s.terrain.length>.015&&minerals/s.terrain.length<.065,'Mineral patches remain sparse while larger sectors gain expansion reserves');
  assert(loose/minerals>.2,'Loose patches include satellite deposits, rather than only solid disks');
  for(let i=0;i<s.minerals.length;i++)if(s.minerals[i]>0){const density=s.mineralTypes[i]===3?2:1;assert(s.minerals[i]>=320*density&&s.minerals[i]<620*density,'Rich red fields have exactly twice the reserve range');if(s.width>72)assert.equal(s.minerals[i],s.minerals[s.minerals.length-1-i],'New-map factions receive identical reserves');}
  const local=[start,end].map(p=>s.minerals.reduce((n,v,i)=>n+(Math.hypot(i%s.width-p.x,Math.floor(i/s.width)-p.y)<14?v:0),0));
  if(s.width>72){assert(Math.min(...local)>14000);assert(Math.max(...local)/Math.min(...local)<1.35,'Nearby resources remain balanced between starting bases');} // Compact legacy anchors predate map-centre symmetry; stored saves keep their original deposits.
  if(seed<3){
    s.ai.nextThink=1e12;for(let i=0;i<1200;i++)updateGame(s,.05);
    assert(s.teams.every(t=>t.credits>=2600),'Both automatic haulers complete several real deliveries');
  }
  summary.push({width:s.width,trees,minerals,loose});
}

// Changing terrain profiles preserves safe starting resources; additional value sits in exposed red expansions.
for(const seed of ['ASH-001','smoke','player-victory'])for(const size of Object.values(MAP_SIZES)){
  const budgets=Object.keys(MAP_PROFILES).map(profile=>{const s=createGame(seed,'normal',{...size,profile});return s.minerals.reduce((sum,amount,i)=>sum+(s.mineralTypes[i]===1?amount:0),0);});
  assert(budgets.every(amount=>amount===budgets[0]),'All profiles preserve the same starting mint budget');
}

// Roots are real saved-map obstacles for movement and construction, with ordinary fog privacy.
{
  const s=createGame('tree-obstruction');let site;
  const core=s.entities.find(e=>e.team===0&&e.type==='core');
  for(let y=core.y-8;y<core.y+12&&!site;y++)for(let x=core.x-8;x<core.x+12&&!site;x++)if(canPlace(s,0,'reactor',x,y).ok)site={x,y};
  assert(site);const at=site.y*s.width+site.x,before=s.teams[0].credits;s.terrain[at]=4;s.navVersion++;
  assert.equal(canPlace(s,0,'reactor',site.x,site.y).reason,'Tree roots obstruct construction');
  assert.equal(placeBuilding(s,0,'reactor',site.x,site.y).ok,false);assert.equal(s.teams[0].credits,before);
  s.visible[0][at]=0;assert.equal(canPlace(s,0,'reactor',site.x,site.y).reason,'Requires sensor coverage');
  const u=s.entities.find(e=>e.team===0&&e.type==='scout');s.entities=[u];s.ai.nextThink=1e12;s.terrain.fill(0);s.minerals.fill(0);s.navVersion++;
  u.x=29.5;u.y=28.5;s.terrain[28*s.width+32]=4;issueOrder(s,[u.id],{type:'move',x:35.5,y:28.5});
  for(let i=0;i<200;i++){updateGame(s,.05);for(const dx of [-.189,.189])for(const dy of [-.189,.189])assert.equal(s.blocked[Math.floor(u.y+dy)*s.width+Math.floor(u.x+dx)],0,'Moving units route around tree roots');}
  assert(Math.hypot(u.x-35.5,u.y-28.5)<=.081);
}
console.log('Distribution checks passed: 96 deterministic current/legacy maps, scattered trees and mineral satellites, balanced budgets, connected bases/deposits, working haulers, and root navigation/construction/fog.',JSON.stringify(summary.filter((_,i)=>i%24===0)));
