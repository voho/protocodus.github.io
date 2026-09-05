import assert from 'node:assert/strict';
import {createGame,mapLayout,canPlace,placeBuilding,updateGame,issueOrder} from '../sim.js';

const dimensions=[{width:72,height:56},{width:144,height:112}];
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
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy){const j=(y+dy)*s.width+x+dx;assert([0,2].includes(s.terrain[j]),'Trees grow on scattered open ground with an open ring, not rocky ridges');assert.equal(s.minerals[j],0);}
    }
    if(s.minerals[i]>0){
      minerals++;assert.equal(s.regions[i],region,'Every mineral satellite is reachable from the starting armies');assert.equal(s.blocked[i],0);
      const neighbors=[i-1,i+1,i-s.width,i+s.width].filter(j=>s.minerals[j]>0).length;if(neighbors<=1)loose++;
    }
  }
  assert(trees>=4*area&&trees<=70*area,'Trees remain sparse at either map size');assert.equal(quadrants.size,4,'Trees appear across the whole sector');
  assert(minerals>=200*area&&minerals<=210*area,'Scattered fields retain roughly the same deposit count');
  assert(loose/minerals>.2,'Loose patches include satellite deposits, rather than only solid disks');
  assert(mineralTotal(s)>90000*area&&mineralTotal(s)<110000*area,'More scattering does not inflate or deplete the resource budget');
  const local=[start,end].map(p=>s.minerals.reduce((n,v,i)=>n+(Math.hypot(i%s.width-p.x,Math.floor(i/s.width)-p.y)<14?v:0),0));
  assert(Math.min(...local)>20000);assert(Math.max(...local)/Math.min(...local)<1.35,'Nearby resources remain balanced between starting bases');
  if(seed<3){
    s.ai.nextThink=1e12;for(let i=0;i<1200;i++)updateGame(s,.05);
    assert(s.teams.every(t=>t.credits>=2600),'Both automatic haulers complete several real deliveries');
  }
  summary.push({width:s.width,trees,minerals,loose});
}

// Recorded pre-scatter budgets guard against accidentally multiplying field resources.
for(const [seed,budgets] of Object.entries({'ASH-001':[96806,385981],smoke:[98853,400157],'player-victory':[95585,391562]}))for(let i=0;i<dimensions.length;i++){
  const current=mineralTotal(createGame(seed,'normal',dimensions[i]));assert(Math.abs(current/budgets[i]-1)<.03,'Distribution retains the previous approximate mineral budget');
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
console.log('Distribution checks passed: 48 deterministic new/legacy maps, scattered trees and mineral satellites, balanced budgets, connected bases/deposits, working haulers, and root navigation/construction/fog.',JSON.stringify(summary.filter((_,i)=>i%24===0)));
