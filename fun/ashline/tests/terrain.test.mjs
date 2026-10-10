import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,MAP_WIDTH,MAP_HEIGHT,MAP_SIZES,MAP_PROFILES,mapLayout,buildingRole} from '../sim.js';
import {PROFILE_RELIEF,generateMap,mapRoutes,mapReport} from '../terrain.js';
import {encodeGame,decodeGame} from '../save.js';

const open=type=>type===0||type===2||type===5;
const curved=Object.keys(MAP_PROFILES).filter(profile=>PROFILE_RELIEF[profile].lanes);
const classic=Object.keys(MAP_PROFILES).filter(profile=>!PROFILE_RELIEF[profile].lanes);
const sizes=Object.entries(MAP_SIZES);
function verifyMap(s){
  const n=s.width*s.height;
  assert.equal(s.terrain.length,n);
  assert.equal(s.minerals.length,n);
  assert.equal(s.mineralTypes.length,n);
  const scout=s.entities.find(e=>e.team===0&&e.type==='scout');
  const main=s.regions[Math.floor(scout.y)*s.width+Math.floor(scout.x)];
  assert.ok(main,'starting scout has reachable ground');
  const enemy=s.entities.find(e=>e.team===1&&e.type==='scout');
  assert.equal(s.regions[Math.floor(enemy.y)*s.width+Math.floor(enemy.x)],main,'both bases share a reachable region');
  for(const e of s.entities.filter(e=>e.team===0&&e.kind==='building')){
    assert.ok(s.entities.some(other=>other.team===1&&other.type===e.type&&other.x===s.width-e.x-e.size&&other.y===s.height-e.y-e.size),'starting structures have exactly mirrored footprints');
    for(let y=e.y;y<e.y+e.size;y++)for(let x=e.x;x<e.x+e.size;x++)assert.equal(s.minerals[y*s.width+x],0,'starting footprints contain no minerals');
  }
  const types=new Set();
  for(let i=0;i<n;i++){
    assert.equal(s.terrain[i],s.terrain[n-1-i],`terrain mirror at ${i}`);
    assert.equal(s.minerals[i],s.minerals[n-1-i],`mineral reserve mirror at ${i}`);
    assert.equal(s.mineralTypes[i],s.mineralTypes[n-1-i],`mineral type mirror at ${i}`);
    if(s.minerals[i]>0){
      types.add(s.mineralTypes[i]);
      assert.ok(open(s.terrain[i]),`resource ${i} is on accessible ground`);
      assert.equal(s.regions[i],main,`resource ${i} is reachable from the bases`);
      const density=s.mineralTypes[i]===3?2:1;
      assert.ok(s.minerals[i]>=320*density&&s.minerals[i]<620*density,'red deposits contain twice the standard reserve range');
      if(density===2)assert.equal(s.minerals[i]%2,0,'red reserve doubles the base integer amount');
    }
  }
  assert.deepEqual([...types].sort(),[1,2,3],'all mineral materials have deposits');
  for(let id=1;id<s.regionSize.length;id++)if(id!==main)assert.ok(s.regionSize[id]<30,`no sealed pocket of ${s.regionSize[id]} tiles`);
  // Every guaranteed route keeps vehicle clearance along its whole length, between samples too.
  const routes=mapRoutes(s);
  assert.deepEqual(routes.map(r=>r.id),['left','centre','right']);
  for(const route of routes)for(let j=1;j<route.points.length;j++){
    const t=j/(route.points.length-1);if(t<.12||t>.88)continue;
    for(const f of [0,.5]){
      const a=route.points[j-1],b=route.points[j],x=b.x+(a.x-b.x)*f,y=b.y+(a.y-b.y)*f,r=Math.max(.75,Math.min(a.r,b.r)-1.2);
      for(const ox of [-.75,.75])for(const oy of [-.75,.75])assert.ok(open(s.terrain[Math.floor(y+oy)*s.width+Math.floor(x+ox)]),'each approach has vehicle clearance');
      for(let yy=Math.floor(y-r);yy<=y+r;yy++)for(let xx=Math.floor(x-r);xx<=x+r;xx++)if(Math.hypot(xx+.5-x,yy+.5-y)<=r)assert.ok(open(s.terrain[yy*s.width+xx]),`${route.id} lane keeps its guaranteed radius`);
    }
  }
}

test('new operations default to the larger frontier and validate map options',()=>{
  const s=createGame('DEFAULT');
  assert.equal(s.width,192);assert.equal(s.height,144);
  assert.equal(s.width,MAP_WIDTH);assert.equal(s.height,MAP_HEIGHT);
  assert.equal(s.mapProfile,'rift');
  assert.equal(Object.keys(MAP_PROFILES)[0],'rift','the volcanic rift stays the first and default profile');
  assert.throws(()=>createGame('BAD','normal',{width:200,height:144}),RangeError);
  assert.throws(()=>createGame('BAD','normal',{profile:'unknown'}),RangeError);
  for(const [id,profile] of Object.entries(MAP_PROFILES)){
    assert.ok(Object.hasOwn(PROFILE_RELIEF,id),`${id} has generator rules`);
    assert.ok(profile.name.length>4&&profile.name.length<=24&&/^[A-Z][a-z]+ [a-z]+$/.test(profile.name),`${id} has a short normal-case name`);
    assert.ok(profile.description.length<=90&&/\.$/.test(profile.description)&&!profile.description.includes('!'),`${id} has terse briefing copy`);
  }
});

for(const [size,dimensions] of sizes)for(const profile of Object.keys(MAP_PROFILES)){
  test(`${size} / ${profile}: balanced routes, resources and terrain across six seeds`,()=>{
    for(const seed of ['ASH-001','CINDER-019','LONG-NIGHT','A','0','map-dimensions'])verifyMap(createGame(seed,'normal',{...dimensions,profile}));
  });
}

test('seeded generation is repeatable and independent of difficulty',()=>{
  for(const profile of ['highlands','ember','crown']){
    const a=createGame('REPEAT','easy',{profile}),b=createGame('REPEAT','hard',{profile});
    assert.deepEqual(a.terrain,b.terrain);assert.deepEqual(a.minerals,b.minerals);assert.deepEqual(a.mineralTypes,b.mineralTypes);assert.deepEqual(a.sites,b.sites);
    const c=createGame('DIFFERENT','easy',{profile});
    assert.notDeepEqual(a.terrain,c.terrain);
  }
});

test('profiles change terrain structure and preserve the same starting resource budget',()=>{
  const maps=Object.fromEntries(Object.keys(MAP_PROFILES).map(profile=>[profile,createGame('PROFILE-CHECK','normal',{profile})]));
  const {rift,basin,highlands}=maps;
  const count=(s,type)=>s.terrain.filter(t=>t===type).length;
  assert.ok(count(basin,2)>count(rift,2)*1.5,'basin has substantially more basalt');
  assert.ok(count(highlands,1)>count(basin,1)*1.25,'highlands has substantially more raised rock');
  assert.ok(count(rift,3)>count(basin,3),'rift has more lava');
  assert.ok(count(maps.ember,3)>count(basin,3)*2,'ember channels carry far more lava than the basin');
  assert.ok(count(maps.steppe,5)>count(rift,5)*2,'the impact steppe is cratered');
  assert.ok(count(maps.steppe,1)<count(highlands,1)*.7,'the impact steppe is open ground');
  assert.ok(count(maps.deadwood,4)>count(rift,4)*1.5,'deadwood barrens are wooded');
  assert.ok(maps.crown.sites.some(site=>site.kind==='crown'),'the caldera crown has its central site');
  const mint=s=>s.minerals.reduce((sum,amount,i)=>sum+(s.mineralTypes[i]===1?amount:0),0);
  for(const [profile,s] of Object.entries(maps))assert.equal(mint(s),mint(rift),`${profile} keeps the safe mint starter budget`);
});

test('original compact dimensions remain available for compatibility',()=>{
  const s=createGame('LEGACY','normal',{width:72,height:56});
  assert.equal(s.terrain.length,4032);
  assert.deepEqual(mapLayout(s),{start:{x:12,y:37},end:{x:59,y:12},bend:10});
  assert.ok(s.entities.every(e=>e.x>=0&&e.y>=0&&e.x<s.width&&e.y<s.height));
  // Unmirrored compact anchors keep the sinusoid routes on every profile.
  for(const profile of ['rift','ember'])assert.equal(mapRoutes(createGame('LEGACY','normal',{width:72,height:56,profile}))[1].points[60].y,24.5);
});

test('classic profiles report exactly their original sinusoid routes',()=>{
  for(const profile of classic)for(const [,dimensions] of sizes){
    const s=createGame('ROUTES','normal',{...dimensions,profile}),{start,end,bend}=mapLayout(s),rules=PROFILE_RELIEF[profile];
    assert.equal(bend,rules.bend*Math.min(s.width/72,s.height/56));
    for(const [index,route] of mapRoutes(s).entries()){
      const sign=index-1;
      assert.equal(route.points.length,121);
      route.points.forEach((p,j)=>{const t=j/120;assert.deepEqual(p,{x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t+Math.sin(t*Math.PI)*bend*sign,r:sign?rules.flank:rules.route});});
    }
  }
});

test('curved lanes are point-symmetric, start at both nexus centres, and are fixed by the seed',()=>{
  for(const profile of curved)for(const [,dimensions] of sizes)for(const seed of ['LANES-1','LANES-2']){
    const s=createGame(seed,'normal',{...dimensions,profile}),routes=mapRoutes(s),[left,centre,right]=routes,W=s.width,H=s.height;
    const nexus=[0,1].map(team=>s.entities.find(e=>e.team===team&&buildingRole(e)==='core')).map(e=>({x:e.x+e.size/2,y:e.y+e.size/2}));
    for(const route of routes){
      assert.ok(Math.hypot(route.points[0].x-nexus[0].x,route.points[0].y-nexus[0].y)<1e-6,'every lane leaves from the home nexus');
      assert.ok(Math.hypot(route.points[120].x-nexus[1].x,route.points[120].y-nexus[1].y)<1e-6,'every lane ends at the rival nexus');
    }
    for(let j=0;j<=120;j++){
      const near=(a,b)=>Math.abs(a.x-(W-b.x))<1e-6&&Math.abs(a.y-(H-b.y))<1e-6&&Math.abs(a.r-b.r)<1e-9;
      assert.ok(near(centre.points[j],centre.points[120-j]),'the centre lane is its own mirror');
      assert.ok(near(left.points[j],right.points[120-j]),'the flanks mirror each other');
    }
    assert.ok(Math.hypot(centre.points[60].x-W/2,centre.points[60].y-H/2)<1e-9,'the centre lane crosses the map centre');
    // The flanks run well clear of the centre lane through the middle of the sector.
    for(let j=30;j<=90;j++)assert.ok(Math.hypot(left.points[j].x-centre.points[j].x,left.points[j].y-centre.points[j].y)>8,'lanes stay separate');
    const again=createGame(seed,'hard',{...dimensions,profile});
    assert.deepEqual(mapRoutes(again),routes,'the lane plan depends only on the seed, profile and size');
    assert.deepEqual(mapRoutes({...again,terrain:null}),routes,'saved operations recover the same routes without their grids');
  }
});

// Perpendicular open width through a lane point, in tiles.
function gateWidth(s,route,j){
  const p=route.points[j],a=route.points[Math.max(0,j-1)],b=route.points[Math.min(120,j+1)],l=Math.hypot(b.x-a.x,b.y-a.y),nx=-(b.y-a.y)/l,ny=(b.x-a.x)/l;
  let width=0;
  for(const side of [1,-1])for(let d=0;d<24;d+=.25){const x=p.x+nx*d*side,y=p.y+ny*d*side;if(x<0||y<0||x>=s.width||y>=s.height||!open(s.terrain[Math.floor(y)*s.width+Math.floor(x)]))break;width+=.25;}
  return width;
}
test('pinched lanes cut gates exactly their width through real obstacles',()=>{
  const seen={pass:0,ford:0,gate:0};
  for(const profile of curved)for(const [size,dimensions] of sizes.slice(0,2))for(const seed of ['CHOKE-1','CHOKE-2','CHOKE-3']){
    const s=createGame(seed,'normal',{...dimensions,profile}),routes=mapRoutes(s);
    for(const site of s.sites.filter(site=>['pass','ford','gate'].includes(site.kind))){
      seen[site.kind]++;
      let best=null;
      for(const route of routes)route.points.forEach((p,j)=>{const d=Math.hypot(p.x-site.x,p.y-site.y);if(!best||d<best.d)best={d,route,j};});
      if(best.d>1.5)continue; // crown side gates open sideways from the caldera, away from the lanes
      const r=best.route.points[best.j].r,widths=[-1,0,1].map(k=>gateWidth(s,best.route,Math.max(0,Math.min(120,best.j+k))));
      assert.ok(r<=PROFILE_RELIEF[profile].route,`${profile} ${size} ${seed}: the lane narrows at ${site.id}`);
      assert.ok(Math.min(...widths)>=2*r-1.2,`${site.id} keeps the lane's own width (${widths}) for radius ${r}`);
      assert.ok(Math.min(...widths)<=2*r+2.6,`${profile} ${size} ${seed}: ${site.id} is a real chokepoint, ${Math.min(...widths)} tiles wide for radius ${r}`);
      if(site.kind==='ford'){
        let lava=0,basalt=0;
        for(let y=Math.floor(site.y)-10;y<=site.y+10;y++)for(let x=Math.floor(site.x)-10;x<=site.x+10;x++)if(x>=0&&y>=0&&x<s.width&&y<s.height){const t=s.terrain[y*s.width+x];if(t===3)lava++;if(t===2&&Math.hypot(x+.5-site.x,y+.5-site.y)<4)basalt++;}
        assert.ok(lava>=12,`${site.id} crosses a lava channel`);assert.ok(basalt>=4,`${site.id} is a basalt ford at least two tiles wide`);
      }
    }
  }
  assert.ok(seen.pass>=8&&seen.ford>=24&&seen.gate>=16,'every pinching profile reports its chokepoints');
});

test('the caldera crown is a walled ring with gates and a seam both bases reach in equal time',()=>{
  for(const [size,dimensions] of sizes)for(const seed of ['CROWN-1','CROWN-2','CROWN-3']){
    const s=createGame(seed,'normal',{...dimensions,profile:'crown'}),crown=s.sites.find(site=>site.kind==='crown'),W=s.width,H=s.height;
    assert.deepEqual([crown.x,crown.y],[W/2,H/2],'the crown sits at the exact map centre');
    const report=mapReport(s),field=report.fields.find(f=>f.kind==='crown');
    assert.equal(field.d0,field.d1,`${size} ${seed}: both nexuses are the same path distance from the crown seam`);
    assert.ok(field.nexus,'a nexus can deploy inside the crown');
    assert.ok(s.minerals[Math.floor(H/2)*W+Math.floor(W/2)]>0&&s.mineralTypes[Math.floor(H/2)*W+Math.floor(W/2)]===3,'a red seam lies at the centre');
    const rules=PROFILE_RELIEF.crown.crown,middle=rules.inner*Math.min(W/72,H/56)+rules.ring/2;
    let arcs=0,openCount=0,previous=null;
    for(let k=0;k<720;k++){
      const a=k/720*Math.PI*2,x=W/2+Math.cos(a)*middle,y=H/2+Math.sin(a)*middle,passable=open(s.terrain[Math.floor(y)*W+Math.floor(x)]);
      if(passable){openCount++;if(previous===false)arcs++;}previous=passable;
    }
    assert.ok(openCount/720<.35,`${size} ${seed}: the ring is mostly raised rock`);
    assert.ok(arcs>=2&&arcs<=8,`${size} ${seed}: the ring has a few gates (${arcs})`);
    assert.equal(s.sites.filter(site=>site.kind==='gate').length,4,'two lane gates and two side gates');
  }
});

const SITE_KINDS=['centre','crown','natural','third','contested','outpost','pass','ford','gate','cover'];
test('strategic sites are named, valid, mirrored, deterministic and survive saving',()=>{
  for(const profile of Object.keys(MAP_PROFILES))for(const [size,dimensions] of sizes)for(const seed of ['SITES-1','SITES-2']){
    const s=createGame(seed,'normal',{...dimensions,profile}),W=s.width,H=s.height,label=`${profile} ${size} ${seed}`;
    assert.ok(Array.isArray(s.sites)&&s.sites.length>=8&&s.sites.length<=64,`${label}: a bounded site list`);
    assert.equal(new Set(s.sites.map(site=>site.id)).size,s.sites.length,'unique ids');
    assert.equal(new Set(s.sites.map(site=>site.name)).size,s.sites.length,'unique names');
    for(const site of s.sites){
      assert.ok(SITE_KINDS.includes(site.kind),`known kind ${site.kind}`);
      assert.ok(site.id.length<=40&&site.id.startsWith(`${site.kind}-`));
      assert.match(site.name,/^[A-Z][a-z]+ [A-Z][a-z]+( \d+)?$/,'two-word sector names');assert.ok(site.name.length<=60);
      assert.ok(site.x>=0&&site.y>=0&&site.x<=W&&site.y<=H&&site.r>0&&site.r<=Math.max(W,H));
      assert.deepEqual(Object.keys(site).filter(key=>!['id','kind','x','y','r','name','side'].includes(key)),[]);
      if(site.side!==undefined)assert.ok(site.side===0||site.side===1);
      if(['natural','third','contested','outpost','crown'].includes(site.kind))assert.ok(s.minerals[Math.floor(site.y)*W+Math.floor(site.x)]>0,`${site.id} marks a deposit`);
    }
    for(const kind of ['natural','third','outpost']){
      const owned=s.sites.filter(site=>site.kind===kind);
      for(const site of owned.filter(site=>site.side===0))assert.ok(owned.some(other=>other.side===1&&Math.abs(other.x-(W-site.x))<1e-9&&Math.abs(other.y-(H-site.y))<1e-9),`${site.id} has a mirrored rival counterpart`);
    }
    assert.equal(s.sites.filter(site=>site.kind==='natural').length,2,`${label}: one natural expansion per side`);
    assert.ok(s.sites.some(site=>site.kind==='centre'||site.kind==='crown'),'the map centre is named');
    if(PROFILE_RELIEF[profile].lanes)assert.ok(s.sites.some(site=>site.kind==='contested'),'curved sectors always offer a contested deposit');
    assert.deepEqual(createGame(seed,'hard',{...dimensions,profile}).sites,s.sites,'sites are deterministic');
    assert.equal(s.rng,createGame(seed,'normal',{width:72,height:56}).rng,'site names never draw from the simulation stream');
    if(seed==='SITES-1'&&size==='standard')assert.deepEqual(decodeGame(encodeGame(s)).game.sites,s.sites,'sites survive a save');
  }
});

test('the fairness report holds every curved sector to its bounds',()=>{
  for(const profile of curved)for(const [size,dimensions] of sizes)for(const seed of ['FAIR-1','FAIR-2','FAIR-3','FAIR-4']){
    const s=createGame(seed,'normal',{...dimensions,profile}),r=mapReport(s),label=`${profile} ${size} ${seed}`;
    assert.deepEqual(r.issues,[],`${label}: no degenerate layout`);
    assert.equal(r.lanes,3,`${label}: three open lanes`);
    assert.ok(r.minCorridor>=3&&Object.values(r.laneWidths).every(width=>width>=3),`${label}: every lane stays at least three tiles wide`);
    assert.ok(r.pathLength>0&&r.pathLength<=r.directLength*1.6,`${label}: no extreme detour between bases`);
    assert.ok(Math.min(...r.buildable)>=380&&Math.max(...r.buildable)/Math.min(...r.buildable)<1.15,`${label}: both bases have comparable building ground`);
    const natural=r.fields.find(f=>f.kind==='natural'&&f.side===0);
    assert.ok(natural.margin>=.25*r.pathLength,`${label}: the natural expansion is clearly home ground`);
    assert.ok(r.fields.some(f=>(f.kind==='contested'||f.kind==='crown')&&Math.abs(f.margin)<=Math.max(4,.04*r.pathLength)),`${label}: a deposit is truly contested`);
    assert.ok(r.fields.every(f=>f.nexus),`${label}: every expansion has an AI-legal nexus site`);
    for(const f of r.fields)if(f.side!==undefined)assert.equal(f.side===0,f.margin>=0,`${f.id} belongs to the nearer base`);
  }
  for(const profile of classic){
    const r=mapReport(createGame('FAIR-1','normal',{profile}));
    assert.equal(r.lanes,3);assert.ok(r.minCorridor>=5);assert.equal(r.fields.filter(f=>f.kind==='natural').length,2);
  }
});

test('degenerate curved sectors re-roll deterministically under a salted seed',()=>{
  const blank=(seed,profile)=>{const {width,height}=MAP_SIZES.standard,N=width*height;return{width,height,seed,mapProfile:profile,terrain:new Uint8Array(N),minerals:new Float32Array(N),mineralTypes:new Uint8Array(N)};};
  // This seed's first deadwood layout leaves no truly contested deposit once groves grow, so its second attempt is kept.
  const a=blank('REROLL-55','deadwood'),b=blank('REROLL-55','deadwood');
  assert.equal(generateMap(a),2);assert.equal(generateMap(b),2);
  assert.deepEqual(a.terrain,b.terrain);assert.deepEqual(a.minerals,b.minerals);assert.deepEqual(a.sites,b.sites);
  assert.deepEqual(mapReport(a).issues,[]);
  assert.equal(generateMap(blank('ASH-001','rift')),1,'classic profiles never re-roll');
  assert.deepEqual(mapRoutes(a),mapRoutes(createGame('REROLL-55','normal',{...MAP_SIZES.standard,profile:'deadwood'})),'routes ignore the attempt');
  // The report flags what a re-roll repairs.
  const blocked=createGame('FAIR-1','normal',{...MAP_SIZES.standard,profile:'ember'}),centre=mapRoutes(blocked)[1].points[60];
  for(let y=Math.floor(centre.y)-6;y<=centre.y+6;y++)for(let x=Math.floor(centre.x)-6;x<=centre.x+6;x++){blocked.terrain[y*blocked.width+x]=1;blocked.terrain[blocked.terrain.length-1-(y*blocked.width+x)]=1;}
  assert.ok(mapReport(blocked).issues.includes('a guaranteed lane is blocked'));
});

test('terrain generation is pure: it writes only the map grids and sites and never touches the shared stream',async()=>{
  const {readFile}=await import('node:fs/promises');
  assert.doesNotMatch(await readFile(new URL('../terrain.js',import.meta.url),'utf8'),/^\s*import\b/m,'terrain.js stays standalone');
  for(const profile of ['rift','crown']){
    const {width,height}=MAP_SIZES.standard,N=width*height;
    const s={width,height,seed:'PURE',mapProfile:profile,rng:12345,terrain:new Uint8Array(N),minerals:new Float32Array(N),mineralTypes:new Uint8Array(N)};
    generateMap(s);
    assert.equal(s.rng,12345);
    assert.deepEqual(Object.keys(s).sort(),['height','mapProfile','mineralTypes','minerals','rng','seed','sites','terrain','width']);
    assert.deepEqual(s.terrain,createGame('PURE','normal',{width,height,profile}).terrain,'a created game keeps the generated terrain');
  }
});
