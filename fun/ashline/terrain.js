// Ashline terrain: seeded, point-symmetric map generation. Coordinates are tiles.
// Pure: it reads a game's size, seed and profile, writes its terrain and mineral grids plus named strategic
// sites, and draws only from local hash-seeded streams, so map layout never shifts the shared simulation RNG (s.rng).
export const MAP_SIZES={
  standard:{name:'Standard',width:144,height:112},
  frontier:{name:'Frontier',width:192,height:144},
  vast:{name:'Vast',width:224,height:168},
};
export const MAP_PROFILES={
  rift:{name:'Volcanic rift',description:'Lava shores, broken ridges, and exposed rich central deposits.'},
  basin:{name:'Basalt basin',description:'Broad open basalt plains, sheltered expansions, and scattered mesas.'},
  highlands:{name:'Shattered highlands',description:'Raised plateaus, defended passes, and valuable flanking expansions.'},
  ember:{name:'Ember channels',description:'Chained lava channels cut every lane; narrow basalt fords decide each crossing.'},
  steppe:{name:'Impact steppe',description:'Open ash plains, crater belts across every lane, and wide flanking routes.'},
  deadwood:{name:'Deadwood barrens',description:'Dead groves screen the flanks, and walled passes guard the centre lane.'},
  crown:{name:'Caldera crown',description:'A walled central caldera holds a red seam both bases reach in equal time.'},
};
const sq=x=>x*x;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const cell=(s,x,y)=>Math.floor(y)*s.width+Math.floor(x);
const inside=(s,x,y)=>x>=0&&y>=0&&x<s.width&&y<s.height;
const open=t=>t===0||t===2||t===5;
const smooth=t=>t*t*(3-2*t);
// The same xorshift as the simulation's random(s), applied to a local {rng} stream object.
function random(stream){let x=stream.rng|0;x^=x<<13;x^=x>>>17;x^=x<<5;stream.rng=x>>>0;return stream.rng/4294967296;}
export function hash(seed){let h=2166136261;for(const c of String(seed)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0||1;}
export function mapLayout(s){
  if(s.width===72&&s.height===56)return{start:{x:12,y:37},end:{x:59,y:12},bend:10};
  const start={x:Math.round(s.width/6),y:Math.round(s.height*.72)},end={x:s.width+1-start.x,y:s.height+1-start.y};
  const bend=terrainProfile(s).bend*Math.min(s.width/72,s.height/56);
  return{start,end,bend};
}

// Relief primitives: integer-hash value noise. Map generation never consumes combat RNG.
const lat=(x,y,k)=>{let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(k|0,1274126177))|0;h=Math.imul(h^h>>>15,2246822519);h=Math.imul(h^h>>>13,3266489917);return((h^h>>>16)>>>0)/4294967296;};
function vnoise(x,y,k){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);return(lat(ix,iy,k)*(1-u)+lat(ix+1,iy,k)*u)*(1-v)+(lat(ix,iy+1,k)*(1-u)+lat(ix+1,iy+1,k)*u)*v;}
function fbm(x,y,k,oct=3){let sum=0,amp=1,norm=0;for(let o=0;o<oct;o++){sum+=vnoise(x,y,k+o*101)*amp;norm+=amp;x=x*2.03+7.1;y=y*1.97+3.3;amp*=.5;}return sum/norm;}
// Quantile of a numerically sorted TypedArray whose entries each stand for `copies` cells.
const quantile=(sorted,q,copies=1)=>{const length=sorted.length*copies;return sorted[Math.floor(Math.min(length-1,Math.floor(length*q))/copies)];};
// Per-profile generator knobs. Relief: noise `wavelength` and the ridge/mesa/basalt quantiles; `ring` base plateau
// thickness; `route`/`flank` lane radii; `bend` flank bend per map scale; `trees` root chance; `lava` pool count and
// `craters` bowl count per map scale; `outcrops` boulder count; `tint` the baked ground's warm shift.
// Profiles without `lanes` keep the original pipeline (three sinusoid routes, fixed natural/central/flank fields), so
// their maps stay byte-identical. `lanes` switches to seeded curved routes with expansion tiers chosen by path distance,
// plus one signature feature: lava `channels` with basalt fords, crater `belts`, tree `groves` or a central `crown`.
export const PROFILE_RELIEF={
  rift:{wavelength:23,ridges:.22,mesas:.045,basalt:.22,gap:.43,ring:2.4,route:2.9,flank:2.5,trees:.028,lava:7,outcrop:4.5,outcrops:6,bend:10,craters:4,craterRadius:[2.8,2.1],flankField:{y:.70,type:3},tint:0},
  basin:{wavelength:29,ridges:.10,mesas:.07,basalt:.47,gap:.5,ring:1.9,route:3.9,flank:3.2,trees:.04,lava:2,outcrop:3.8,outcrops:6,bend:12,craters:3,craterRadius:[2.8,2.1],flankField:{y:.70,type:2},tint:-3},
  highlands:{wavelength:19,ridges:.26,mesas:.08,basalt:.16,gap:.4,ring:3,route:2.7,flank:2.4,trees:.035,lava:3.5,outcrop:3.4,outcrops:6,bend:9,craters:5,craterRadius:[2.8,2.1],flankField:{y:.76,type:3},tint:4},
  ember:{wavelength:21,ridges:.12,mesas:.035,basalt:.3,gap:.45,ring:2.2,route:2.7,flank:2.4,trees:.012,lava:2,outcrop:3.6,outcrops:4,bend:11,craters:2,craterRadius:[2.8,1.6],flankField:{y:.70,type:3},tint:6,
    lanes:{swing:[.04,.09],flank:[.95,1.3],wobble:.2,pinch:2.3},channels:{t:[.3,.34],pool:[7,10],dike:[1.6,2.6],half:[2.5,3.2]}},
  steppe:{wavelength:27,ridges:.07,mesas:.03,basalt:.27,gap:.5,ring:1.8,route:3.4,flank:3,trees:.016,lava:1,outcrop:4.2,outcrops:8,bend:12,craters:4,craterRadius:[2.8,3],flankField:{y:.70,type:2},tint:2,
    lanes:{swing:[.03,.08],flank:[1,1.35],wobble:.25},belts:{t:[.27,.33],radius:[2.7,3.8],gap:[.2,1.4]}},
  deadwood:{wavelength:22,ridges:.15,mesas:.045,basalt:.2,gap:.44,ring:2.2,route:2.8,flank:2.4,trees:.02,lava:2,outcrop:3.6,outcrops:5,bend:10,craters:3,craterRadius:[2.8,2.1],flankField:{y:.70,type:3},tint:-2,
    lanes:{swing:[.04,.09],flank:[.95,1.25],wobble:.2,pinch:2.3,pinchAt:[.34,.4],shoulder:12},groves:{scale:11,threshold:.5,density:.75}},
  crown:{wavelength:24,ridges:.16,mesas:.04,basalt:.24,gap:.44,ring:2.2,route:2.8,flank:2.6,trees:.022,lava:3,outcrop:3.8,outcrops:5,bend:13,craters:3,craterRadius:[2.8,2.1],flankField:{y:.70,type:3},tint:3,
    lanes:{swing:[0,.03],flank:[1.1,1.4],wobble:.15},crown:{inner:5.5,ring:2.8,gate:2.4}},
};
const terrainProfile=s=>PROFILE_RELIEF[s.mapProfile]||PROFILE_RELIEF.rift;
const legacySize=s=>s.width===72&&s.height===56;
// Compact 72 × 56 anchors are not mirrored, so curved lanes only apply to the current map sizes.
const curved=s=>!!terrainProfile(s).lanes&&!legacySize(s);
// Every terrain mutation has a mirrored partner, including gates, mineral access, lava and tree roots.
function mirroredTerrain(s,i,type){s.terrain[i]=type;s.terrain[s.terrain.length-1-i]=type;}

function relief(s,key=s.seed){
  const {width:W,height:H}=s,N=W*H,k=hash(`${key}:relief:${s.mapProfile}`),rules=terrainProfile(s),{start,end}=mapLayout(s);
  const cx=W/2,cy=H/2,dx=end.x-start.x,dy=end.y-start.y,len=Math.hypot(dx,dy),ux=dx/len,uy=dy/len;
  const field=(u,v)=>{
    const px=u/rules.wavelength,py=v*.63/rules.wavelength;
    const wx=px+(fbm(px*.7+31,py*.7,k+7,2)-.5)*.9,wy=py+(fbm(px*.7,py*.7+17,k+13,2)-.5)*.9;
    const r=fbm(wx*1.3+5,wy*1.3,k+40,2);
    return[fbm(wx,wy,k,3),1-Math.abs(2*r-1),vnoise(u/10,v/10,k+120)];
  };
  const height=new Float32Array(N),ridge=new Float32Array(N),gap=new Float32Array(N);
  for(let i=0;i<N/2;i++){
    const x=i%W+.5-cx,y=Math.floor(i/W)+.5-cy,u=x*ux+y*uy,v=-x*uy+y*ux;
    let f;
    if(u>=3)f=field(u,v);else if(u<=-3)f=field(-u,-v);
    else{const a=field(u,v),b=field(-u,-v),t=u/6+.5,w=t*t*(3-2*t);f=[a[0]*w+b[0]*(1-w),a[1]*w+b[1]*(1-w),a[2]*w+b[2]*(1-w)];}
    const m=N-1-i;height[i]=height[m]=f[0];ridge[i]=ridge[m]=f[1];gap[i]=gap[m]=f[2];
  }
  // Point symmetry stores every value at both i and N-1-i, so with an even cell count the
  // first half, sorted once, yields every quantile. TypedArray sort stays numeric.
  const copies=N%2?1:2,half=N/copies,heights=height.slice(0,half).sort(),open=ridge.slice(0,half).filter((_,i)=>gap[i]>rules.gap).sort();
  const mesa=quantile(heights,1-rules.mesas,copies),basin=quantile(heights,rules.basalt,copies),crest=open.length?quantile(open,Math.max(0,1-rules.ridges*N/(open.length*copies)),copies):Infinity;
  for(let i=0;i<N/2;i++)mirroredTerrain(s,i,ridge[i]>crest&&gap[i]>rules.gap||height[i]>mesa?1:height[i]<basin?2:0);
  // Rounded satellite outcrops leave room for maneuver, and supply separate broad lava shores.
  const rng={rng:hash(`${key}:outcrops:${s.mapProfile}`)},target=Math.round(rules.outcrops*Math.sqrt(N/(72*56))),exclusion=19;
  const rockNear=(x,y,R)=>{for(let yy=Math.floor(y-R);yy<=y+R;yy++)for(let xx=Math.floor(x-R);xx<=x+R;xx++)if(inside(s,xx,yy)&&sq(xx-x)+sq(yy-y)<=R*R&&s.terrain[yy*W+xx]===1)return true;return false;};
  for(let attempt=0,placed=0;placed<target&&attempt<target*48;attempt++){
    const r=2+random(rng)*(rules.outcrop-2),x=5+Math.floor(random(rng)*(W-10)),y=5+Math.floor(random(rng)*(H/2-10)),m={x:W-1-x,y:H-1-y};
    if(distance({x,y},m)<2*r+4||[start,end].some(c=>distance(c,{x,y})<exclusion+r||distance(c,m)<exclusion+r)||rockNear(x,y,r+1.2))continue;
    placed++;
    for(let yy=Math.floor(y-r-1);yy<=y+r+1;yy++)for(let xx=Math.floor(x-r-1);xx<=x+r+1;xx++){
      const rr=r+(vnoise(xx/3,yy/3,k+77)-.5)*1.4;
      if(inside(s,xx,yy)&&sq(xx-x)+sq(yy-y)<rr*rr)mirroredTerrain(s,yy*W+xx,1);
    }
  }
}
// Broken plateau gates and protected approach lanes give each base the same defensive footprint.
function plateauRing(s,protectedGround,key=s.seed){
  const {width:W,height:H}=s,k=hash(`${key}:relief`)+50,{start}=mapLayout(s),scale=Math.min(W/72,H/56),ringIn=12.5+scale,ringOut=ringIn+terrainProfile(s).ring;
  if(scale<2)return;
  const c=start;
  for(let y=Math.max(0,Math.floor(c.y-ringOut-2));y<=Math.min(H-1,c.y+ringOut+2);y++)for(let x=Math.max(0,Math.floor(c.x-ringOut-2));x<=Math.min(W-1,c.x+ringOut+2);x++){
    const i=y*W+x;if(protectedGround[i])continue;
    const d=Math.hypot(x-c.x,y-c.y)+(vnoise(x/5,y/5,k)-.5)*3;
    if(d>=ringIn&&d<=ringOut)mirroredTerrain(s,i,1);
  }
}
function mineralBowls(s,centers,key=s.seed){
  const {width:W,height:H}=s,k=hash(`${key}:relief`)+60;
  for(const c of centers)for(let y=Math.max(0,Math.floor(c.y-7));y<=Math.min(H-1,c.y+7);y++)for(let x=Math.max(0,Math.floor(c.x-7));x<=Math.min(W-1,c.x+7);x++){
    const i=y*W+x,d=Math.hypot(x-c.x,y-c.y)+(vnoise(x/4,y/4,k)-.5)*2;
    if(d<=5.7&&s.terrain[i]===1)mirroredTerrain(s,i,0);
  }
}
// One flood and one multi-source breadth-first search connect every large or resource-bearing pocket.
// Unlike the former all-pairs nearest-tile scan, work is linear in map area, even on the vast setting.
function breachPockets(s,clear){
  const {width:W,terrain}=s,N=terrain.length,{start}=mapLayout(s),regions=new Uint32Array(N),queue=new Int32Array(N),sizes=[0],resources=[false];
  let count=0,id=0,tail=0,at=0;
  // One visitor per pass keeps the flood free of per-cell allocations; open ground is terrain 0, 2 or 5.
  const neighbors=(i,visit)=>{const x=i%W;if(x>0)visit(i-1);if(x<W-1)visit(i+1);if(i>=W)visit(i-W);if(i<N-W)visit(i+W);};
  const flood=next=>{const t=terrain[next];if(!regions[next]&&(t===0||t===2||t===5)){regions[next]=id;queue[tail++]=next;}};
  for(let i=0;i<N;i++){
    if(regions[i]||terrain[i]===1||terrain[i]===3||terrain[i]===4)continue;
    id=++count;tail=1;queue[0]=i;regions[i]=id;sizes[id]=0;resources[id]=false;
    for(let head=0;head<tail;head++){at=queue[head];sizes[id]++;if(s.minerals[at]>0)resources[id]=true;neighbors(at,flood);}
  }
  const main=regions[cell(s,start.x,start.y)],needed=new Set();
  for(let region=1;region<=count;region++)if(region!==main&&(sizes[region]>=30||resources[region]))needed.add(region);
  if(!needed.size)return;
  const parent=new Int32Array(N);parent.fill(-1);tail=0;
  for(let i=0;i<N;i++)if(regions[i]===main){queue[tail++]=i;parent[i]=i;}
  const connect=next=>{
    if(parent[next]!==-1)return;parent[next]=at;queue[tail++]=next;
    const region=regions[next];if(!needed.has(region))return;
    needed.delete(region);
    for(let p=next;parent[p]!==p;p=parent[p])clear(p%W,Math.floor(p/W),1.65);
  };
  for(let head=0;head<tail&&needed.size;head++){at=queue[head];neighbors(at,connect);}
}

// Mirrored mineral fields: a centre deposit plus seeded inner and outer satellites, each with hauler access.
function fieldTools(s,clear,key=s.seed){
  const {width:W,height:H}=s,N=W*H,{start,end}=mapLayout(s),centers=[],placed=[],scatterRng={rng:hash(`${key}:mineral-scatter`)};
  const access=(a,b)=>{const steps=Math.max(1,Math.ceil(distance(a,b)*2));for(let i=0;i<=steps;i++)clear(a.x+(b.x-a.x)*i/steps,a.y+(b.y-a.y)*i/steps,.95);};
  const field=(a,type,kind)=>{
    const b={x:W-1-a.x,y:H-1-a.y},candidates=[];
    for(let y=-4;y<=4;y++)for(let x=-4;x<=4;x++){
      const radius=x*x+y*y;if(!radius||radius>22)continue;
      const points=[{x:a.x+x,y:a.y+y},{x:b.x-x,y:b.y-y}];
      if(points.some(p=>p.x<1||p.y<1||p.x>=W-1||p.y>=H-1||distance(p,start)<7||distance(p,end)<7))continue;
      candidates.push({x,y,radius,score:random(scatterRng)});
    }
    candidates.sort((a,b)=>a.score-b.score);
    // Loose inner deposits and outer satellites retain visible gaps at every zoom.
    const offsets=[{x:0,y:0},...candidates.filter(p=>p.radius<=8).slice(0,10),...candidates.filter(p=>p.radius>8).slice(0,8)];
    centers.push(a,b);placed.push({a,b,type,kind});
    for(const p of offsets){
      const x=a.x+p.x,y=a.y+p.y,i=y*W+x,amount=(320+Math.floor(random(scatterRng)*300))*(type===3?2:1);
      access(a,{x,y});s.minerals[i]=s.minerals[N-1-i]=amount;s.mineralTypes[i]=s.mineralTypes[N-1-i]=type;
    }
  };
  return{centers,placed,field};
}

const MAX_ATTEMPTS=4;
// Returns how many attempts the sector took (1 unless a curved map was re-rolled).
export function generateMap(s){
  if(!curved(s)){s.sites=classicMap(s);return 1;}
  // A degenerate curved map re-rolls its noise, resources and features under a salted key; the lane plan
  // stays keyed by the seed alone, so mapRoutes never needs to know which attempt was kept.
  let best=null;
  for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++){
    if(attempt){s.terrain.fill(0);s.minerals.fill(0);s.mineralTypes.fill(0);}
    const {sites,d0}=curvedMap(s,attempt?`${s.seed}:attempt-${attempt}`:s.seed),issues=survey(s,sites,d0).issues.length;
    if(!issues){s.sites=sites;return attempt+1;}
    if(!best||issues<best.issues)best={issues,sites,terrain:s.terrain.slice(),minerals:s.minerals.slice(),mineralTypes:s.mineralTypes.slice()};
  }
  s.terrain.set(best.terrain);s.minerals.set(best.minerals);s.mineralTypes.set(best.mineralTypes);s.sites=best.sites;
  return MAX_ATTEMPTS;
}

function classicMap(s){
  const {width:W,height:H}=s,N=W*H,{start,end,bend}=mapLayout(s),rules=terrainProfile(s);
  relief(s);
  const protectedGround=new Uint8Array(N);
  const clear=(x,y,r)=>{for(let yy=Math.floor(y-r);yy<=y+r;yy++)for(let xx=Math.floor(x-r);xx<=x+r;xx++)if(inside(s,xx,yy)&&sq(xx-x)+sq(yy-y)<=r*r){const i=yy*W+xx;mirroredTerrain(s,i,0);protectedGround[i]=protectedGround[N-1-i]=1;}};
  clear(start.x,start.y,11.5);clear(end.x,end.y,11.5);
  plateauRing(s,protectedGround);
  // Three broad, continuous routes; their bends leave flanking expansion shelves between them.
  const routeSteps=Math.ceil(distance(start,end)*2);
  for(let i=0;i<=routeSteps;i++){
    const t=i/routeSteps,x=start.x+(end.x-start.x)*t,y=start.y+(end.y-start.y)*t;
    clear(x,y,rules.route);clear(x,y+Math.sin(t*Math.PI)*bend,rules.flank);clear(x,y-Math.sin(t*Math.PI)*bend,rules.flank);
  }
  const {centers,placed,field}=fieldTools(s,clear),treeRng={rng:hash(`${s.seed}:trees`)};
  // Safe mint starter fields, a blue natural expansion, and richer exposed central red reserves.
  field({x:start.x+8,y:start.y+1},1,'starter');field({x:start.x,y:start.y+9},1,'starter');
  const near={x:start.x-7,y:start.y-14};field(near,2,'natural');
  const central={x:Math.round(W*.43),y:Math.round(H*.46)};field(central,3,'reserve');
  const flank={x:Math.round(W*.39),y:Math.round(H*rules.flankField.y)};field(flank,rules.flankField.type,'reserve');
  const resourceRng={rng:hash(`${s.seed}:fields:${s.mapProfile}`)},targetPairs=Math.max(5,Math.round(4+N/2400));
  for(let attempt=0;centers.length<targetPairs*2&&attempt<1600;attempt++){
    const a={x:6+Math.floor(random(resourceRng)*(W/2-12)),y:6+Math.floor(random(resourceRng)*(H-12))},b={x:W-1-a.x,y:H-1-a.y};
    if([a,b].some(p=>distance(p,start)<20||distance(p,end)<20||centers.some(c=>distance(c,p)<10))||distance(a,b)<10)continue;
    const contested=Math.abs(a.x-W/2)<W*.18&&distance(a,start)>W*.26;
    field(a,contested?3:2,'reserve');
  }
  mineralBowls(s,centers);
  breachPockets(s,clear);
  addLavaPools(s);
  // Each mirrored pair is isolated by an open neighbor ring, so roots cannot close a route.
  for(let i=W+1;i<N/2;i++){
    const x=i%W,y=Math.floor(i/W),mx=W-1-x,my=H-1-y,m=N-1-i;
    if(x<1||x>=W-1||random(treeRng)>rules.trees||protectedGround[i]||protectedGround[m]||Math.abs(x-mx)<3&&Math.abs(y-my)<3)continue;
    let open=true;
    for(const at of [i,m])for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const p=at+dy*W+dx,t=s.terrain[p];if(!(t===0||t===2||t===5)||s.minerals[p]>0)open=false;}
    if(open)mirroredTerrain(s,i,4);
  }
  addCraters(s,protectedGround,centers);
  return compileSites(s,placed,[]);
}

// Craters offer exposed firing positions beside the main approaches. They never overwrite a route,
// resource bowl, base clearing, tree root or rock obstacle, so cover cannot close a guaranteed path.
function addCraters(s,protectedGround,fields,key=s.seed){
  const {width:W,height:H}=s,N=W*H;if(N<8000)return;
  const rules=terrainProfile(s),rng={rng:hash(`${key}:craters:${s.mapProfile}`)},k=hash(`${key}:crater-rims`),{start,end}=mapLayout(s);
  const dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy),target=Math.round(rules.craters*Math.sqrt(N/(72*56))),centers=[];
  for(let attempt=0;centers.length<target&&attempt<target*90;attempt++){
    const c={x:7+Math.floor(random(rng)*(W-14)),y:7+Math.floor(random(rng)*(H/2-14))},r=rules.craterRadius[0]+random(rng)*rules.craterRadius[1],m={x:W-1-c.x,y:H-1-c.y};
    const routeDistance=Math.abs(-dy*(c.x-start.x)+dx*(c.y-start.y))/length;
    if(routeDistance>Math.min(W,H)*.3||distance(c,m)<r*2+4||[c,m].some(p=>[start,end].some(base=>distance(p,base)<r+18)||fields.some(field=>distance(p,field)<r+6)||centers.some(other=>distance(p,other)<r+7)))continue;
    const cells=[];let available=true;
    for(let y=Math.floor(c.y-r-1);y<=c.y+r+1;y++)for(let x=Math.floor(c.x-r-1);x<=c.x+r+1;x++){
      const edge=r+(vnoise(x/3,y/3,k)-.5)*.6;
      if(sq(x-c.x)+sq((y-c.y)/.83)>edge*edge)continue;
      const i=y*W+x;
      if(!inside(s,x,y)||protectedGround[i]||!(s.terrain[i]===0||s.terrain[i]===2)||s.minerals[i]>0){available=false;break;}
      cells.push(i);
    }
    if(!available||cells.length<16)continue;
    centers.push(c);for(const i of cells)mirroredTerrain(s,i,5);
  }
}

// keepRock marks walls that must stay raised rock (the crown ring, pass shoulders); a formation touching existing lava would merge
// into one oversized pool, so it stays rock too. Neither case occurs on classic maps.
function addLavaPools(s,key=s.seed,keepRock=null){
  const {width:W,height:H}=s,N=W*H,{start:base,end}=mapLayout(s),dx=end.x-base.x,dy=end.y-base.y,rules=terrainProfile(s);
  // Recolor complete, compact formations; shorelines cannot obstruct an existing route.
  const visited=new Uint8Array(N),pools=[],lavaRng={rng:hash(`${key}:lava:${s.mapProfile}`)};
  for(let start=0;start<N;start++){
    if(visited[start]||s.terrain[start]!==1)continue;
    const tiles=[start];visited[start]=1;let minX=W,maxX=0,minY=H,maxY=0,maxAt=start,fixed=false;
    for(let head=0;head<tiles.length;head++){
      const at=tiles[head],x=at%W,y=Math.floor(at/W);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);maxAt=Math.max(maxAt,at);
      if(keepRock?.[at])fixed=true;
      for(const next of [x>0?at-1:-1,x<W-1?at+1:-1,y>0?at-W:-1,y<H-1?at+W:-1])if(next>=0){if(s.terrain[next]===3)fixed=true;else if(!visited[next]&&s.terrain[next]===1){visited[next]=1;tiles.push(next);}}
    }
    // Only select one member of a mirror pair, and keep long ridge walls as raised rock.
    if(fixed||start>N-1-maxAt||tiles.length<12||tiles.length>220||minX<3||maxX>=W-3||minY<3||maxY>=H-3||tiles.length/((maxX-minX+1)*(maxY-minY+1))<.38)continue;
    const x=(minX+maxX)/2,y=(minY+maxY)/2,routeDistance=Math.abs(-dy*(x-base.x)+dx*(y-base.y))/Math.hypot(dx,dy);
    pools.push({tiles,score:Math.max(0,routeDistance-7)+random(lavaRng)*14});
  }
  pools.sort((a,b)=>a.score-b.score||a.tiles[0]-b.tiles[0]);
  const count=Math.round(rules.lava*Math.sqrt(N/(72*56)));
  for(const pool of pools.slice(0,count))for(const at of pool.tiles)mirroredTerrain(s,at,3);
}

// ---- Curved-lane profiles -------------------------------------------------------------------------------------
// A sector plan holds everything derived from the seed alone: lane shapes and radii, and where the profile's
// signature feature sits. Terrain passes read it, and mapRoutes reports its lanes for any saved operation.
const plans=new Map();
function sectorPlan(s){
  const id=`${s.width}x${s.height}:${s.mapProfile}:${s.seed}`;
  if(plans.has(id))return plans.get(id);
  const rules=terrainProfile(s),L=rules.lanes,{width:W,height:H}=s,scale=Math.min(W/72,H/56),{start,bend}=mapLayout(s);
  // Lanes join the two nexus centres, which are exact point mirrors of each other.
  const S={x:start.x-.5,y:start.y-.5},dx=W-2*S.x,dy=H-2*S.y,len=Math.hypot(dx,dy),u={x:dx/len,y:dy/len},n={x:-u.y,y:u.x},C={x:W/2,y:H/2};
  const rng={rng:hash(`${s.seed}:lanes:${s.mapProfile}`)},pick=([a,b])=>a+random(rng)*(b-a);
  const point=(t,v)=>({x:S.x+dx*t+n.x*v,y:S.y+dy*t+n.y*v});
  const plan={S,len,u,n,C,scale,lanes:[],pinches:[],marks:[],channel:null,crown:null,belt:null};
  if(rules.channels){const c=rules.channels;plan.channel={a:len*pick(c.t),amp:pick([1.5,3.5]),half:pick(c.half),pool:c.pool,dike:c.dike,k:hash(`${s.seed}:channel:${s.mapProfile}`)};}
  if(rules.belts){const b=rules.belts;plan.belt={a:len*pick(b.t),amp:pick([1.5,3]),radius:b.radius,gap:b.gap,k:hash(`${s.seed}:belt:${s.mapProfile}`)};}
  if(rules.crown){const c=rules.crown;plan.crown={inner:c.inner*scale,ring:c.ring,gate:c.gate,side:(random(rng)-.5)*.6};}
  const rC=rules.route,rF=rules.flank,outer=plan.crown?plan.crown.inner+plan.crown.ring+1:0;
  // The centre lane is its own mirror (an S-curve through the map centre); the right flank is free and the left
  // flank is its mirror image, so both commanders see the same lane shapes.
  const offsets=shape=>{
    const centre=t=>shape.swing*Math.sin(2*Math.PI*t)+shape.c2*Math.sin(4*Math.PI*t);
    // A flattened envelope lets the flanks open away from the base before the centre lane swings.
    const right=t=>Math.sin(Math.PI*t)**.6*(shape.b+shape.w*Math.sin(2*Math.PI*t+shape.phase));
    return{left:t=>-right(1-t),centre,right};
  };
  const fits=shape=>{
    const v=offsets(shape);
    for(let j=0;j<=100;j++){
      const t=j/100,lanes=[[v.left(t),rF],[v.centre(t),rC],[v.right(t),rF]];
      if(t>=.04&&t<=.96&&lanes.some(([offset,r])=>{const p=point(t,offset);return p.x<r+2||p.y<r+2||p.x>W-r-2||p.y>H-r-2;}))return false;
      if(t>=.22&&t<=.78&&(v.right(t)-v.centre(t)<rC+rF+6||v.centre(t)-v.left(t)<rC+rF+6))return false;
      if(outer&&distance(point(t,v.right(t)),C)<outer+rF+6)return false;
    }
    return true;
  };
  let shape=null;
  for(let attempt=0;attempt<24&&!shape;attempt++){
    const swing=len*pick(L.swing)*(random(rng)<.5?-1:1),b=bend*pick(L.flank),candidate={swing,c2:swing*(random(rng)-.5)*.5,b,w:b*(random(rng)*2-1)*L.wobble,phase:random(rng)*Math.PI*2};
    if(fits(candidate))shape=candidate;
  }
  shape??={swing:0,c2:0,b:Math.max(bend,outer+rF+8),w:0,phase:0};
  const v=offsets(shape);
  const lanes=[['left','flank',v.left,rF],['centre','centre',v.centre,rC],['right','flank',v.right,rF]].map(([id,kind,offset,r0])=>({id,kind,offset,r0,pinches:[],at:t=>point(t,offset(t))}));
  const lane=id=>lanes.find(l=>l.id===id);
  const pinch=(l,t,r,half,kind,extra)=>{const p={kind,lane:l.id,t,r,half,...l.at(t),...extra};l.pinches.push(p);plan.pinches.push(p);};
  if(plan.channel){
    // Lanes advance len tiles along the axis per unit t, so a lane meets the channel where its axial position equals
    // the channel's wobbling centreline; the mirrored channel is the same curve rotated about the centre.
    const ch=plan.channel,axial=sigma=>ch.a+ch.amp*(vnoise(sigma/9+3.7,1.3,ch.k)*2-1);
    plan.channel.axial=axial;
    for(const l of lanes)for(const mirrored of [false,true]){
      let t=mirrored?1-ch.a/len:ch.a/len;
      for(let k=0;k<8;k++)t=mirrored?(len-axial(-l.offset(t)))/len:axial(l.offset(t))/len;
      pinch(l,t,L.pinch,ch.half+2,'ford',{side:mirrored?1:0});
    }
  }
  if(plan.crown){
    const c=plan.crown,centre=lane('centre'),middle=c.inner+c.ring/2;
    let lo=0,hi=.5;for(let k=0;k<30;k++){const t=(lo+hi)/2;if(distance(centre.at(t),C)>middle)lo=t;else hi=t;}
    pinch(centre,lo,c.gate,c.ring/2+2,'gate',{side:0});pinch(centre,1-lo,c.gate,c.ring/2+2,'gate',{side:1});
    const angle=Math.atan2(n.y,n.x)+c.side,dir={x:Math.cos(angle),y:Math.sin(angle)};
    plan.crown.dir=dir;
    for(const sign of [1,-1])plan.pinches.push({kind:'gate',lane:null,r:c.gate,x:C.x+dir.x*middle*sign,y:C.y+dir.y*middle*sign});
  }
  if(L.pinchAt){
    const centre=lane('centre'),t=pick(L.pinchAt);
    pinch(centre,t,L.pinch,2.5,'pass',{side:0,shoulder:L.shoulder});pinch(centre,1-t,L.pinch,2.5,'pass',{side:1,shoulder:L.shoulder});
  }
  if(plan.belt){
    const b=plan.belt,centre=lane('centre');plan.belt.axial=sigma=>b.a+b.amp*(vnoise(sigma/10+1.9,4.4,b.k)*2-1);
    let t=b.a/len;for(let k=0;k<8;k++)t=plan.belt.axial(centre.offset(t))/len;
    for(const [tt,side] of [[t,0],[1-t,1]])plan.marks.push({kind:'cover',side,r:b.radius[1]+1,...centre.at(tt)});
  }
  for(const l of lanes){
    // A pinch holds the narrow radius across the obstacle it gates, then eases back over three tiles.
    l.r=t=>{let r=l.r0;for(const p of l.pinches){const d=Math.abs(t-p.t)*len,k=d<=p.half?0:d>=p.half+3?1:smooth((d-p.half)/3);r=Math.min(r,p.r+(l.r0-p.r)*k);}return r;};
    let arc=0;for(let j=1;j<=400;j++)arc+=distance(l.at(j/400),l.at((j-1)/400));l.arc=arc;
  }
  plan.lanes=lanes;
  plan.routes=lanes.map(l=>({id:l.id,kind:l.kind,points:Array.from({length:121},(_,j)=>({...l.at(j/120),r:l.r(j/120)}))}));
  if(plans.size>=16)plans.delete(plans.keys().next().value);
  plans.set(id,plan);
  return plan;
}
// Lane centrelines are sampled finely enough that consecutive carving discs overlap.
function traceLane(lane,visit){const steps=Math.ceil(lane.arc/.4);for(let j=0;j<=steps;j++){const t=j/steps;visit(lane.at(t),lane.r(t),t);}}

// Guaranteed routes as plain polylines: [{id:'left'|'centre'|'right', kind, points:[{x,y,r}]}]. Sides are relative to
// team 0's advance; r is the guaranteed open radius. Classic profiles return their three sinusoids exactly.
export function mapRoutes(s){return curved(s)?structuredClone(sectorPlan(s).routes):classicRoutes(s);}
const routesOf=s=>curved(s)?sectorPlan(s).routes:classicRoutes(s);
function classicRoutes(s){
  const {start,end,bend}=mapLayout(s),rules=terrainProfile(s);
  return[['left','flank',-bend,rules.flank],['centre','centre',0,rules.route],['right','flank',bend,rules.flank]].map(([id,kind,b,r])=>({id,kind,points:Array.from({length:121},(_,j)=>{const t=j/120;return{x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t+Math.sin(t*Math.PI)*b,r};})}));
}

function curvedMap(s,key){
  const {width:W,height:H}=s,N=W*H,plan=sectorPlan(s),{start,end}=mapLayout(s);
  relief(s,key);
  const protectedGround=new Uint8Array(N),laneGround=new Uint8Array(N),keepRock=new Uint8Array(N);
  const clear=(x,y,r,lane=false)=>{for(let yy=Math.floor(y-r);yy<=y+r;yy++)for(let xx=Math.floor(x-r);xx<=x+r;xx++)if(inside(s,xx,yy)&&sq(xx-x)+sq(yy-y)<=r*r){const i=yy*W+xx;mirroredTerrain(s,i,0);protectedGround[i]=protectedGround[N-1-i]=1;if(lane)laneGround[i]=laneGround[N-1-i]=1;}};
  clear(start.x,start.y,11.5);clear(end.x,end.y,11.5);
  plateauRing(s,protectedGround,key);
  // Obstacles that lanes gate are raised first; carving then cuts each gate exactly to the lane's width.
  if(plan.crown)raiseCrown(s,plan,protectedGround,keepRock,key);
  for(const p of plan.pinches)if(p.shoulder)raiseShoulder(s,plan,p,protectedGround,keepRock,key);
  const fords=plan.channel?cutChannel(s,plan,protectedGround,key):null;
  for(const lane of plan.lanes)traceLane(lane,(p,r)=>clear(p.x-.5,p.y-.5,r,true));
  if(plan.crown){
    const {dir,inner,ring,gate}=plan.crown;
    for(let d=inner-1.5;d<=inner+ring+3;d+=.4)clear(plan.C.x+dir.x*d-.5,plan.C.y+dir.y*d-.5,gate,true);
  }
  if(fords)for(const i of fords)if(s.terrain[i]===0)mirroredTerrain(s,i,2);
  const {centers,placed}=tieredFields(s,plan,clear,protectedGround,laneGround,key);
  mineralBowls(s,centers,key);
  breachPockets(s,clear);
  addLavaPools(s,key,keepRock);
  settleLava(s);
  plantTrees(s,plan,protectedGround,key);
  addCraters(s,protectedGround,centers,key);
  if(plan.belt)craterBelt(s,plan,protectedGround,laneGround,key);
  const d0=pathDistances(s,anchors(s)[0]);
  return{sites:compileSites(s,placed,[...plan.pinches,...plan.marks],d0),d0};
}

// The caldera crown: a self-mirrored rock ring around the map centre over a sunken basalt floor.
function raiseCrown(s,plan,protectedGround,keepRock,key){
  const {width:W}=s,N=s.terrain.length,{inner,ring}=plan.crown,k=hash(`${key}:crown`),reach=inner+ring+2;
  for(let y=Math.floor(plan.C.y-reach);y<=plan.C.y+reach;y++)for(let x=Math.floor(plan.C.x-reach);x<=plan.C.x+reach;x++){
    const i=y*W+x;if(i>=N/2||protectedGround[i])continue;
    const d=Math.hypot(x+.5-plan.C.x,y+.5-plan.C.y)+(vnoise(x/4,y/4,k)-.5)*1.6;
    if(d>=inner&&d<=inner+ring){mirroredTerrain(s,i,1);keepRock[i]=keepRock[N-1-i]=1;}
    else if(d<inner)mirroredTerrain(s,i,d<inner-1.5?2:0);
  }
}
// A rock shoulder runs across a lane at its pinch, out until it meets existing rock or reaches its length. Like the
// crown ring it stays raised rock, never a lava pool.
function raiseShoulder(s,plan,pinch,protectedGround,keepRock,key){
  const lane=plan.lanes.find(l=>l.id===pinch.lane),a=lane.at(Math.max(0,pinch.t-.01)),b=lane.at(Math.min(1,pinch.t+.01)),k=hash(`${key}:shoulder`);
  const length=Math.hypot(b.x-a.x,b.y-a.y),nx=-(b.y-a.y)/length,ny=(b.x-a.x)/length,{width:W}=s;
  for(const side of [1,-1])for(let d=0;d<=pinch.shoulder;d+=.5){
    const x=pinch.x+nx*d*side,y=pinch.y+ny*d*side;
    if(x<1||y<1||x>=W-1||y>=s.height-1)break;
    if(d>pinch.r+2.5&&s.terrain[cell(s,x,y)]===1&&!keepRock[cell(s,x,y)])break;
    const r=1.3+vnoise(d/2,side*3,k)*.6;
    for(let yy=Math.floor(y-r-.5);yy<=y+r;yy++)for(let xx=Math.floor(x-r-.5);xx<=x+r;xx++){
      const i=yy*W+xx;if(!inside(s,xx,yy)||sq(xx+.5-x)+sq(yy+.5-y)>r*r||protectedGround[i])continue;
      mirroredTerrain(s,i,1);keepRock[i]=keepRock[s.terrain.length-1-i]=1;
    }
  }
}
// Ember channels: a band of compact lava pools separated by rock dikes crosses the whole sector on each side.
// Where a lane will pass, the band stays rock, so carving leaves a ford exactly the lane's width between rock banks.
// Returns the ford tiles, which turn to basalt once the lanes are cut.
function cutChannel(s,plan,protectedGround,key){
  const {width:W,height:H}=s,N=W*H,ch=plan.channel,{S,u,n,len}=plan,rng={rng:hash(`${key}:channel-pools`)},pick=([a,b])=>a+random(rng)*(b-a);
  const reach=new Uint8Array(N);
  for(const lane of plan.lanes)traceLane(lane,(p,r)=>{const R=r+1.5;for(let y=Math.floor(p.y-R);y<=p.y+R;y++)for(let x=Math.floor(p.x-R);x<=p.x+R;x++)if(inside(s,x,y)&&sq(x+.5-p.x)+sq(y+.5-p.y)<=R*R)reach[y*W+x]=1;});
  const corners=[[0,0],[W,0],[0,H],[W,H]].map(([x,y])=>(x-S.x)*n.x+(y-S.y)*n.y),low=Math.min(...corners)-2,bins=Math.ceil((Math.max(...corners)+2-low)/.5)+1;
  const half=sigma=>ch.half*(1+.3*(vnoise(sigma/6,7.1,ch.k)-.5));
  const band=[],ford=new Uint8Array(bins);
  for(let i=0;i<N;i++){
    const x=i%W+.5,y=Math.floor(i/W)+.5,a=(x-S.x)*u.x+(y-S.y)*u.y;
    if(a>len/2||Math.abs(a-ch.a)>ch.amp+ch.half*1.2+3)continue;
    const sigma=(x-S.x)*n.x+(y-S.y)*n.y,offset=a-ch.axial(sigma),h=half(sigma);
    if(Math.abs(offset)>h+1.5)continue;
    const bin=Math.floor((sigma-low)/.5);
    if(reach[i])ford[bin]=1;
    band.push({i,sigma,offset,h,bin,core:Math.abs(offset)<=h});
  }
  // Rock banks of about 1.5 tiles keep pools off the lane corridors.
  const blocked=new Uint8Array(bins);for(let b=0;b<bins;b++)if(ford[b])for(let d=-3;d<=3;d++)if(b+d>=0&&b+d<bins)blocked[b+d]=1;
  const pools=[];
  for(let b=0;b<bins;){
    if(blocked[b]){b++;continue;}
    let end=b;while(end+1<bins&&!blocked[end+1])end++;
    const from=low+b*.5,to=low+(end+1)*.5;
    for(let at=from+pick(ch.dike)/2;;){
      let length=pick(ch.pool);const rest=to-at-length;
      if(rest<ch.dike[0]+ch.pool[0])length=to-at-ch.dike[0]/2;
      if(length<5)break;
      pools.push({centre:at+length/2,half:length/2});
      at+=length+pick(ch.dike);if(at>=to-5)break;
    }
    b=end+1;
  }
  const poolOf=sigma=>pools.find(p=>Math.abs(sigma-p.centre)<p.half);
  const lava=new Map(),fords=[];
  for(const tile of band){
    const {i,sigma,offset,h}=tile;
    if(protectedGround[i])continue;
    if(ford[tile.bin]){fords.push(i);if(!tile.core)continue;}
    if(!tile.core)continue;
    const p=blocked[tile.bin]?null:poolOf(sigma),inPool=p&&Math.abs((sigma-p.centre)/p.half)**2.4+Math.abs(offset/h)**2.4<=1;
    if(inPool){if(!lava.has(p))lava.set(p,[]);lava.get(p).push(i);}
    mirroredTerrain(s,i,1);
  }
  // Pools that would touch the map margin stay as rock spurs, so every molten basin keeps its recessed banks.
  for(const tiles of lava.values())if(tiles.every(i=>{const x=i%W,y=Math.floor(i/W);return x>=3&&y>=3&&x<W-3&&y<H-3;}))for(const i of tiles)mirroredTerrain(s,i,3);
  return fords;
}
// Lava that a later pass cut, thinned or pushed out of bounds settles back into rock: blocked either way, so routes keep.
// What remains is compact recessed pools of 12–220 tiles, the bound the renderer's per-pool surfaces rely on.
function settleLava(s){
  const {width:W,height:H}=s,N=W*H,{start,end}=mapLayout(s),seen=new Uint8Array(N);
  for(let i=0;i<N;i++){
    if(seen[i]||s.terrain[i]!==3)continue;
    const group=[i];seen[i]=1;let valid=true,minX=W,maxX=0,minY=H,maxY=0;
    for(let head=0;head<group.length;head++){
      const at=group[head],x=at%W,y=Math.floor(at/W);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      if(x<3||y<3||x>=W-3||y>=H-3||Math.hypot(x-start.x,y-start.y)<=11.5||Math.hypot(x-end.x,y-end.y)<=11.5||s.minerals[at]>0)valid=false;
      for(const next of [x>0?at-1:-1,x<W-1?at+1:-1,y>0?at-W:-1,y<H-1?at+W:-1])if(next>=0&&!seen[next]&&s.terrain[next]===3){seen[next]=1;group.push(next);}
    }
    if(!valid||group.length<12||group.length>220||group.length/((maxX-minX+1)*(maxY-minY+1))<.3)for(const at of group)mirroredTerrain(s,at,1);
  }
}
// Deadwood groves: a low-frequency mask, strongest in two belts across the lanes, raises the root chance.
// The open-ring rule still isolates every tree, so groves screen ground without sealing it.
function plantTrees(s,plan,protectedGround,key){
  const {width:W,height:H}=s,N=W*H,rules=terrainProfile(s),rng={rng:hash(`${key}:trees`)},g=rules.groves,k=hash(`${key}:groves`);
  const chance=(x,y)=>{
    if(!g)return rules.trees;
    const a=((x+.5-plan.S.x)*plan.u.x+(y+.5-plan.S.y)*plan.u.y)/plan.len,belt=Math.max(0,1-Math.abs(Math.abs(a-.5)-.21)/.14);
    const mask=vnoise(x/g.scale,y/g.scale,k)*.55+belt*.45;
    return rules.trees+(mask>g.threshold?g.density*smooth(Math.min(1,(mask-g.threshold)/.1)):0);
  };
  for(let i=W+1;i<N/2;i++){
    const x=i%W,y=Math.floor(i/W),mx=W-1-x,my=H-1-y,m=N-1-i;
    if(x<1||x>=W-1||random(rng)>chance(x,y)||protectedGround[i]||protectedGround[m]||Math.abs(x-mx)<3&&Math.abs(y-my)<3)continue;
    let free=true;
    for(const at of [i,m])for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const p=at+dy*W+dx;if(!open(s.terrain[p])||s.minerals[p]>0)free=false;}
    if(free)mirroredTerrain(s,i,4);
  }
}
// Impact steppe: a line of crater bowls crosses every lane on each side. Lane ground may hold a bowl (it stays
// passable), but base clearings, fields and reserved nexus sites never do; a bowl's rim stops at raised rock.
function craterBelt(s,plan,protectedGround,laneGround,key){
  const {width:W,height:H}=s,b=plan.belt,{S,u,n}=plan,rng={rng:hash(`${key}:belt-craters`)},k=hash(`${key}:crater-rims`),pick=([lo,hi])=>lo+random(rng)*(hi-lo);
  const corners=[[0,0],[W,0],[0,H],[W,H]].map(([x,y])=>(x-S.x)*n.x+(y-S.y)*n.y),last=Math.max(...corners);
  // Two staggered rows make a belt deep enough to hold a firing line.
  for(const row of [-1,1])for(let sigma=Math.min(...corners)+2+(row>0?b.radius[1]:0);sigma<last;){
    const r=pick(b.radius),at=sigma+r,a=b.axial(at)+row*b.radius[1]*.95,cx=S.x+u.x*a+n.x*at-.5,cy=S.y+u.y*a+n.y*at-.5,cells=[];
    sigma+=2*r+pick(b.gap);
    let available=true;
    for(let y=Math.floor(cy-r-1);y<=cy+r+1&&available;y++)for(let x=Math.floor(cx-r-1);x<=cx+r+1;x++){
      const edge=r+(vnoise(x/3,y/3,k)-.5)*.6;
      if(sq(x-cx)+sq((y-cy)/.83)>edge*edge)continue;
      const i=y*W+x;
      if(!inside(s,x,y)||protectedGround[i]&&!laneGround[i]||s.minerals[i]>0){available=false;break;}
      if(s.terrain[i]===0||s.terrain[i]===2)cells.push(i);
    }
    if(available&&cells.length>=12)for(const i of cells)mirroredTerrain(s,i,5);
  }
}

// Travel distance in tiles over open ground (rock, lava and roots block; entities do not), or -1 when unreachable.
// Moves go eight ways: straight steps cost 1 and diagonal steps 1.5, never cutting a blocked corner. A bucket queue in
// half-tile units keeps the search linear in map area.
function pathDistances(s,from){
  const {width:W,terrain}=s,N=terrain.length,cost=new Int32Array(N).fill(-1),buckets=[[],[],[],[]],d=new Float32Array(N).fill(-1);
  if(!open(terrain[from]))return d;
  cost[from]=0;buckets[0].push(from);let pending=1;
  const relax=(next,c)=>{if(cost[next]<0||c<cost[next]){cost[next]=c;buckets[c&3].push(next);pending++;}};
  for(let c=0;pending;c++){
    const bucket=buckets[c&3];
    for(let k=0;k<bucket.length;k++){
      const at=bucket[k];pending--;if(cost[at]!==c)continue;
      const x=at%W,l=x>0&&open(terrain[at-1]),r=x<W-1&&open(terrain[at+1]),u=at>=W&&open(terrain[at-W]),b=at<N-W&&open(terrain[at+W]);
      if(l)relax(at-1,c+2);if(r)relax(at+1,c+2);if(u)relax(at-W,c+2);if(b)relax(at+W,c+2);
      if(l&&u&&open(terrain[at-W-1]))relax(at-W-1,c+3);if(r&&u&&open(terrain[at-W+1]))relax(at-W+1,c+3);
      if(l&&b&&open(terrain[at+W-1]))relax(at+W-1,c+3);if(r&&b&&open(terrain[at+W+1]))relax(at+W+1,c+3);
    }
    bucket.length=0;
  }
  for(let i=0;i<N;i++)if(cost[i]>=0)d[i]=cost[i]/2;
  return d;
}
// Chebyshev distance from each tile to the nearest flagged tile (8-connected), capped at 255.
function spread(s,flagged){
  const {width:W}=s,N=s.terrain.length,d=new Uint8Array(N).fill(255),queue=new Int32Array(N);let tail=0;
  for(let i=0;i<N;i++)if(flagged(i)){d[i]=0;queue[tail++]=i;}
  for(let head=0;head<tail;head++){
    const at=queue[head],x=at%W,y=Math.floor(at/W),step=d[at]+1;if(step>=255)continue;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const xx=x+dx,yy=y+dy;if((!dx&&!dy)||xx<0||yy<0||xx>=W||yy>=s.height)continue;
      const next=yy*W+xx;if(d[next]>step){d[next]=step;queue[tail++]=next;}
    }
  }
  return d;
}
// Approximate Euclidean distance (chamfer 1/√2) from each tile centre to the nearest obstacle centre or the outer edge;
// a corridor's width at a tile is then about 2d − 1 tiles, whatever its direction.
function clearanceField(s){
  const {width:W,height:H,terrain}=s,N=W*H,d=new Float32Array(N),D=Math.SQRT2;
  for(let i=0;i<N;i++){const x=i%W,y=(i-x)/W;d[i]=open(terrain[i])?Math.min(x+1,y+1,W-x,H-y):0;}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;let v=d[i];if(!v)continue;if(x>0)v=Math.min(v,d[i-1]+1);if(y>0){v=Math.min(v,d[i-W]+1);if(x>0)v=Math.min(v,d[i-W-1]+D);if(x<W-1)v=Math.min(v,d[i-W+1]+D);}d[i]=v;}
  for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){const i=y*W+x;let v=d[i];if(!v)continue;if(x<W-1)v=Math.min(v,d[i+1]+1);if(y<H-1){v=Math.min(v,d[i+W]+1);if(x<W-1)v=Math.min(v,d[i+W+1]+D);if(x>0)v=Math.min(v,d[i+W-1]+D);}d[i]=v;}
  return d;
}
// Each base's anchor is its nexus centre tile; on current map sizes the two are exact mirrors.
function anchors(s){const {start,end}=mapLayout(s),W=s.width;return[(start.y-1)*W+start.x-1,(end.y-1)*W+end.x-1];}
function rivalDistances(s,d0){
  if(legacySize(s))return pathDistances(s,anchors(s)[1]);
  const N=d0.length,d1=new Float32Array(N);for(let i=0;i<N;i++)d1[i]=d0[N-1-i];return d1;
}
// A nexus needs a clear 3 × 3 of ash or basalt 4.5–10 tiles from its ore, reachable from the bases (the AI's rule).
function nexusSpot(s,site,reach,accept=()=>true){
  const {width:W,height:H}=s;
  for(let y=Math.max(1,Math.floor(site.y)-9);y<Math.min(H-4,site.y+8);y++)for(let x=Math.max(1,Math.floor(site.x)-9);x<Math.min(W-4,site.x+8);x++){
    const d=Math.hypot(x+1.5-site.x,y+1.5-site.y);if(d<4.5||d>10)continue;
    let legal=true;
    for(let yy=y;yy<y+3&&legal;yy++)for(let xx=x;xx<x+3;xx++){const i=yy*W+xx,t=s.terrain[i];if(!(t===0||t===2)||s.minerals[i]>0||reach[i]<0||!accept(i)){legal=false;break;}}
    if(legal)return{x,y};
  }
  return null;
}

// Expansion tiers by path distance from the home nexus; the rival's distance is the mirrored index (d1[i]=d0[N-1-i]).
// Every field reserves an AI-legal nexus site that trees and craters must leave clear.
function tieredFields(s,plan,clear,protectedGround,laneGround,key){
  const {width:W,height:H}=s,N=W*H,{start,end}=mapLayout(s),[home,away]=anchors(s),d0=pathDistances(s,home),d1=rivalDistances(s,d0),D=Math.max(1,d0[away]);
  const laneNear=spread(s,i=>laneGround[i]===1),reserved=new Uint8Array(N),sites=[],rng={rng:hash(`${key}:fields:${s.mapProfile}`)};
  const tools=fieldTools(s,clear,key),{centers,field}=tools,S=plan.S;
  // Mint starter fields come first with the unsalted scatter stream order, so every profile keeps the same budget.
  field({x:start.x+8,y:start.y+1},1,'starter');field({x:start.x,y:start.y+9},1,'starter');
  const lavaNear=(a,r)=>{for(let y=a.y-r;y<=a.y+r;y++)for(let x=a.x-r;x<=a.x+r;x++)if(inside(s,x,y)&&s.terrain[y*W+x]===3)return true;return false;};
  const stamp=new Int32Array(N);let generation=0;
  // Ground reachable from the field centre within a small box, so the reserved site joins the field's own region.
  const local=a=>{
    generation++;const queue=[a.y*W+a.x];stamp[queue[0]]=generation;
    for(let head=0;head<queue.length;head++){const at=queue[head],x=at%W,y=Math.floor(at/W);for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){const i=ny*W+nx;if(Math.abs(nx-a.x)<=12&&Math.abs(ny-a.y)<=12&&inside(s,nx,ny)&&stamp[i]!==generation&&open(s.terrain[i])){stamp[i]=generation;queue.push(i);}}}
  };
  const siteFor=(a,avoid)=>{
    local(a);let best=null,score=Infinity;
    for(let y=a.y-9;y<=a.y+8;y++)for(let x=a.x-9;x<=a.x+8;x++){
      if(x<1||y<1||x+3>=W||y+3>=H)continue;
      const d=Math.hypot(x+1-a.x,y+1-a.y);if(d<6.2||d>9.2)continue;
      let legal=true;
      for(let yy=y;yy<y+3&&legal;yy++)for(let xx=x;xx<x+3;xx++){
        const i=yy*W+xx,t=s.terrain[i];
        if(!(t===0||t===2)||s.minerals[i]>0||laneNear[i]<2||reserved[i]||stamp[i]!==generation||avoid.some(p=>Math.hypot(xx-p.x,yy-p.y)<5.3)){legal=false;break;}
      }
      const value=Math.abs(d-7.2)+(d0[(y+1)*W+x+1]<0?0:d0[(y+1)*W+x+1]*.01);
      if(legal&&value<score){best={x,y};score=value;}
    }
    return best;
  };
  const reserve=site=>{for(let y=site.y-1;y<=site.y+3;y++)for(let x=site.x-1;x<=site.x+3;x++)if(inside(s,x,y)){const i=y*W+x;reserved[i]=reserved[N-1-i]=1;protectedGround[i]=protectedGround[N-1-i]=1;}sites.push({x:site.x+1,y:site.y+1},{x:W-2-site.x,y:H-2-site.y});};
  const spaced=(a,gap)=>{const b={x:W-1-a.x,y:H-1-a.y};return distance(a,b)>=gap&&[a,b].every(p=>centers.every(c=>distance(c,p)>=gap)&&sites.every(c=>distance(c,p)>=7.6));};
  const usable=(a,lane=6)=>a.x>=6&&a.y>=6&&a.x<W-6&&a.y<H-6&&(s.terrain[a.y*W+a.x]===0||s.terrain[a.y*W+a.x]===2)&&d0[a.y*W+a.x]>=0&&laneNear[a.y*W+a.x]>=lane&&!lavaNear(a,6)&&spaced(a,12);
  const place=(a,type,kind,avoid=[a])=>{const site=siteFor(a,avoid);if(!site)return false;reserve(site);field(a,type,kind);return true;};
  const ranked=(test,score)=>{const list=[];for(let i=0;i<N;i++){const x=i%W,y=Math.floor(i/W);if(test(i,x,y))list.push({x,y,score:score(i,x,y)+random(rng)*4});}return list.sort((a,b)=>a.score-b.score||a.y-b.y||a.x-b.x);};
  if(plan.crown){
    // The crown seam is its own mirror at the exact centre, so both nexuses are equally far from it.
    const a={x:W/2,y:H/2},b={x:W/2-1,y:H/2-1},site=siteFor(a,[a,b]);
    if(site){reserve(site);field(a,3,'crown');}
  }
  const euclid=(x,y)=>Math.hypot(x+.5-S.x,y+.5-S.y);
  // A contested seam sits where both path distances agree; it may lie nearer a lane than a home expansion would.
  const tiers=[
    ['natural',2,6,(i,x,y)=>{const e=euclid(x,y);return e>=19&&e<=27&&d0[i]>=0&&d1[i]-d0[i]>=.3*D;},(i,x,y)=>Math.abs(euclid(x,y)-22.5)],
    ['third',2,6,i=>d0[i]>=.25*D&&d0[i]<=.42*D&&d1[i]-d0[i]>=.16*D,i=>Math.abs(d0[i]-.33*D)/4],
    ['contested',3,4.5,(i,x,y)=>d0[i]>=0&&Math.abs(d0[i]-d1[i])<=Math.max(2,.012*D)&&d0[i]<=.75*D&&Math.hypot(x+.5-plan.C.x,y+.5-plan.C.y)>=(plan.crown?plan.crown.inner+plan.crown.ring+6:9),i=>d0[i]/D],
  ];
  for(const [kind,type,lane,test,score] of tiers)for(const a of ranked((i,x,y)=>test(i,x,y)&&usable({x,y},lane),score))if(place(a,type,kind))break;
  const target=Math.max(5,Math.round(4+N/2400)),resourceRng={rng:hash(`${key}:reserves:${s.mapProfile}`)};
  for(let attempt=0;centers.length<target*2&&attempt<1600;attempt++){
    const a={x:6+Math.floor(random(resourceRng)*(W/2-12)),y:6+Math.floor(random(resourceRng)*(H-12))},i=a.y*W+a.x;
    if([a,{x:W-1-a.x,y:H-1-a.y}].some(p=>distance(p,start)<20||distance(p,end)<20)||!usable(a))continue;
    place(a,Math.abs(d0[i]-d1[i])<=.12*D?3:2,'reserve');
  }
  return tools;
}

// ---- Strategic sites ------------------------------------------------------------------------------------------
const PREFIXES=['Cinder','Ember','Slag','Tephra','Pumice','Scoria','Clinker','Soot','Flint','Obsidian','Sulphur','Kiln','Furnace','Brimstone','Char','Glass','Rime','Lantern','Warden','Vael','Charter','Signal','Ashfall','Tinder','Smelter','Bellows','Anvil','Quench','Shale','Ochre','Gallows','Lodestar'];
const NOUNS={
  natural:['Hollow','Shelf','Terrace','Bench','Pocket','Ledge'],third:['Reach','Spur','Flats','Draw','Fold','Shoulder'],outpost:['Outcrop','Bluff','Knoll','Rest','Wells','Mesa'],
  contested:['Seam','Lode','Fault','Scar','Vein','Gash'],crown:['Crown','Caldera','Dais'],centre:['Cross','Meridian','Junction','Commons'],
  pass:['Gate','Notch','Narrows','Throat','Saddle','Neck'],gate:['Gate','Arch','Breach','Postern'],ford:['Ford','Crossing','Causeway','Steps'],cover:['Line','Pits','Furrows','Trenches'],
};
// Sites are plain saved data: {id, kind, x, y, r, name} plus `side` (0 or 1) for ground that belongs to one base.
// Names come from their own seeded stream, never from s.rng.
function compileSites(s,placed,features,d0=pathDistances(s,anchors(s)[0])){
  const {width:W,height:H}=s,away=anchors(s)[1],d1=rivalDistances(s,d0),D=Math.max(1,d0[away]),sites=[],counts={};
  const add=(kind,x,y,r,side)=>{const id=`${kind}-${counts[kind]=(counts[kind]??-1)+1}`;sites.push({id,kind,x:Math.min(W,Math.max(0,x)),y:Math.min(H,Math.max(0,y)),r,...(side===undefined?{}:{side})});};
  const crown=placed.find(f=>f.kind==='crown');
  if(crown){const c=terrainProfile(s).crown;add('crown',W/2,H/2,c.inner*Math.min(W/72,H/56)+c.ring);}
  else{const route=routesOf(s).find(r=>r.id==='centre'),mid=route.points[60];add('centre',mid.x,mid.y,6);}
  const fields=placed.filter(f=>f.kind!=='starter'&&f.kind!=='crown').map(f=>{
    const i=f.a.y*W+f.a.x,margin=d0[i]<0||d1[i]<0?0:d1[i]-d0[i];
    const kind=f.kind==='reserve'?(Math.abs(margin)<=.12*D?'contested':'outpost'):f.kind;
    return{...f,kind,margin};
  });
  const order=['contested','natural','third'];
  for(const kind of order)for(const f of fields.filter(f=>f.kind===kind)){
    const own=f.margin>=0?0:1;
    add(kind,f.a.x+.5,f.a.y+.5,5.5,kind==='contested'?undefined:own);add(kind,f.b.x+.5,f.b.y+.5,5.5,kind==='contested'?undefined:1-own);
  }
  for(const f of features)add(f.kind,f.x,f.y,f.kind==='cover'?f.r:f.r+2,f.side);
  for(const f of fields.filter(f=>f.kind==='outpost')){const own=f.margin>=0?0:1;add('outpost',f.a.x+.5,f.a.y+.5,5.5,own);add('outpost',f.b.x+.5,f.b.y+.5,5.5,1-own);}
  // Each name prefers an unused prefix, so one sector rarely repeats a word.
  const kept=sites.slice(0,64),rng={rng:hash(`${s.seed}:names`)},used=new Set(),free=[...PREFIXES];
  for(const site of kept){
    const nouns=NOUNS[site.kind];let name='';
    for(let tries=0;!name||used.has(name);tries++){
      const pool=free.length?free:PREFIXES,prefix=pool[Math.floor(random(rng)*pool.length)];
      name=`${prefix} ${nouns[Math.floor(random(rng)*nouns.length)]}`;
      if(tries>=40&&used.has(name))name+=` ${tries}`;
      if(!used.has(name)){const at=free.indexOf(prefix);if(at>=0)free.splice(at,1);}
    }
    used.add(name);site.name=name;
  }
  return kept.map(({id,kind,x,y,r,name,side})=>({id,kind,x:+x.toFixed(2),y:+y.toFixed(2),r:+r.toFixed(2),name,...(side===undefined?{}:{side})}));
}

// ---- Fairness report ------------------------------------------------------------------------------------------
const FIELD_KINDS=new Set(['natural','third','outpost','contested','crown']);
// mapReport describes a generated sector: base-to-base path length, open lanes and their narrowest gates, separate
// corridors across the centre line, the widest bottleneck between bases, buildable 2 × 2 ground near each base, and
// for each expansion site its path distance from both bases and whether a nexus can deploy there.
export function mapReport(s){return survey(s,s.sites??[]);}
function survey(s,sites,d0=pathDistances(s,anchors(s)[0])){
  const {width:W,height:H,terrain}=s,N=W*H,[home,away]=anchors(s),d1=rivalDistances(s,d0),pathLength=d0[away];
  const clearance=clearanceField(s),seen=new Int32Array(N),queue=new Int32Array(N);
  // Widest bottleneck: the largest clearance k (in half-tile steps) such that tiles at least k from any obstacle still
  // join the bases, found by bisection.
  const joins=(k,mark)=>{
    if(clearance[home]<k||clearance[away]<k)return false;
    let tail=1;queue[0]=home;seen[home]=mark;
    for(let head=0;head<tail;head++){
      const at=queue[head],x=at%W;if(at===away)return true;
      for(const next of [x>0?at-1:-1,x<W-1?at+1:-1,at-W,at+W])if(next>=0&&next<N&&seen[next]!==mark&&clearance[next]>=k){seen[next]=mark;queue[tail++]=next;}
    }
    return false;
  };
  let minCorridor=0;
  if(pathLength>=0){let lo=1,hi=21,mark=0;if(joins(.5,++mark)){while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(joins(mid/2,++mark))lo=mid;else hi=mid-1;}minCorridor=joins(lo/2,++mark)?lo-1:0;}}
  const routes=routesOf(s),laneReport=routes.map(route=>{
    let clear=true,narrowest=Infinity;
    route.points.forEach((p,j)=>{const t=j/120,i=cell(s,p.x,p.y);if(t<.08||t>.92)return;if(!inside(s,p.x,p.y)||!open(terrain[i])||d0[i]<0)clear=false;else if(t>=.15&&t<=.85)narrowest=Math.min(narrowest,2*clearance[i]-1);});
    return{id:route.id,open:clear,width:narrowest===Infinity?0:+narrowest.toFixed(1)};
  });
  // Along the centre line (the perpendicular bisector of the bases): separate reachable corridors at least three tiles
  // wide, and how much of the line is reachable ground at all.
  const {start}=mapLayout(s),ax=W/2-(start.x-.5),ay=H/2-(start.y-.5),al=Math.hypot(ax,ay),nx=-ay/al,ny=ax/al;
  let crossings=0,run=0,centreOpen=0;
  for(let sigma=-Math.hypot(W,H);sigma<=Math.hypot(W,H);sigma+=.5){
    const x=W/2+nx*sigma,y=H/2+ny*sigma,i=cell(s,x,y),passable=inside(s,x,y)&&open(terrain[i])&&d0[i]>=0;
    if(passable){run++;centreOpen+=.5;}else{if(run>=6)crossings++;run=0;}
  }
  if(run>=6)crossings++;
  const buildable=[home,away].map(anchor=>{
    const ax=anchor%W,ay=Math.floor(anchor/W);let count=0;
    for(let y=ay-14;y<=ay+13;y++)for(let x=ax-14;x<=ax+13;x++){
      if(x<0||y<0||x+1>=W||y+1>=H||Math.hypot(x+1-ax,y+1-ay)>14)continue;
      let ok=true;for(const i of [y*W+x,y*W+x+1,(y+1)*W+x,(y+1)*W+x+1])if(!(terrain[i]===0||terrain[i]===2)||s.minerals[i]>0)ok=false;
      if(ok)count++;
    }
    return count;
  });
  // A site on a tile corner (the crown at the exact centre) touches four tiles; take the nearest of them.
  const reach=(d,site)=>{let best=-1;for(const y of new Set([Math.floor(site.y-.25),Math.floor(site.y+.25)]))for(const x of new Set([Math.floor(site.x-.25),Math.floor(site.x+.25)])){const v=d[y*W+x];if(v>=0&&(best<0||v<best))best=v;}return best;};
  const fields=sites.filter(site=>FIELD_KINDS.has(site.kind)).map(site=>{
    const from=reach(d0,site),to=reach(d1,site);
    return{id:site.id,kind:site.kind,side:site.side,d0:from,d1:to,margin:from<0||to<0?null:to-from,nexus:!!nexusSpot(s,site,d0)};
  });
  const issues=[];
  if(pathLength<0)issues.push('bases are not connected');
  if(laneReport.some(lane=>!lane.open))issues.push('a guaranteed lane is blocked');
  if(minCorridor<3)issues.push('every route narrows below three tiles');
  if(fields.some(f=>!f.nexus))issues.push('an expansion has no legal nexus site');
  if(curved(s)){
    if(!fields.some(f=>f.kind==='natural'))issues.push('no natural expansion');
    if(!fields.some(f=>(f.kind==='contested'||f.kind==='crown')&&f.margin!==null&&Math.abs(f.margin)<=Math.max(4,.04*pathLength)))issues.push('no contested deposit');
    if(fields.some(f=>f.kind==='natural'&&f.side===0&&!(f.margin>=.25*pathLength)))issues.push('natural expansion is not secure');
    if(centreOpen<24)issues.push('the centre line is nearly sealed');
  }
  return{profile:s.mapProfile??'rift',pathLength,directLength:+Math.hypot((home%W)-(away%W),Math.floor(home/W)-Math.floor(away/W)).toFixed(2),lanes:laneReport.filter(l=>l.open).length,laneWidths:Object.fromEntries(laneReport.map(l=>[l.id,l.width])),crossings,centreOpen,minCorridor,buildable,fields,issues};
}
