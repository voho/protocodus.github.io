// Ashline: deterministic, dependency-free skirmish simulation. Coordinates are tiles.
export const BUILDINGS = {
  core: {name:'Command nexus',cost:1800,hp:3000,size:3,buildTime:40,power:20,requires:[],description:'Your command center. Lose it and the operation ends.',sight:12},
  reactor: {name:'Flux reactor',cost:240,hp:700,size:2,buildTime:12,power:100,requires:['core'],description:'Produces 100 power for production and defenses.',sight:7},
  refinery: {name:'Shard refinery',cost:500,hp:1400,size:3,buildTime:20,power:-30,requires:['core'],description:'Includes one automatic shard hauler. Converts deliveries into credits.',sight:9},
  barracks: {name:'Field barracks',cost:320,hp:1100,size:2,buildTime:15,power:-15,requires:['core'],description:'Trains rifle squads, rocket infantry, and recon rovers.',sight:8},
  factory: {name:'War foundry',cost:650,hp:1700,size:3,buildTime:26,power:-40,requires:['barracks','refinery'],description:'Builds tanks and siege crawlers.',sight:8},
  turret: {name:'Rail sentry',cost:300,hp:900,size:1,buildTime:15,power:-20,requires:['barracks'],description:'Powered anti-vehicle defense. Vulnerable to siege fire.',sight:11,range:8,damage:42,interval:1.1},
  rocketTower: {name:'Rocket tower',cost:480,hp:1100,size:2,buildTime:24,power:-35,requires:['barracks','reactor'],description:'Powered missile defense with explosive splash. Strong against clustered armor.',sight:11,range:9,damage:85,interval:2.6,splash:1.8,splashDamage:.45},
};
export const UNITS = {
  rifle: {name:'Rifle squad',cost:80,hp:105,size:.45,speed:2.7,range:4.8,damage:15,trainTime:5,buildTime:5,power:0,requires:[],producer:'barracks',description:'Cheap infantry. Holds ground and screens armor; weak against vehicles.',sight:8,interval:.75,armor:'infantry'},
  rocket: {name:'Rocket infantry',cost:160,hp:95,size:.48,speed:2.4,range:7,damage:60,trainTime:9,buildTime:9,power:0,requires:[],producer:'barracks',description:'Long-range anti-armor launcher. Slow firing and vulnerable to rifle squads.',sight:8,interval:2.4,armor:'infantry',splash:.9,splashDamage:.3},
  scout: {name:'Recon rover',cost:140,hp:200,size:.65,speed:4.1,range:5.5,damage:18,trainTime:8,buildTime:8,power:0,requires:[],producer:'barracks',description:'Fast scout with a wide sensor radius and anti-infantry gun.',sight:13,interval:.65,armor:'light'},
  tank: {name:'Vanguard tank',cost:300,hp:520,size:.8,speed:2.1,range:7,damage:72,trainTime:14,buildTime:14,power:0,requires:[],producer:'factory',description:'Armored main battle tank. Crushes vehicles and defenses.',sight:9,interval:1.55,armor:'heavy'},
  artillery: {name:'Siege crawler',cost:380,hp:270,size:.8,speed:1.7,range:11.5,damage:115,trainTime:19,buildTime:19,power:0,requires:[],producer:'factory',description:'Long-range splash damage. Devastates buildings; protect it.',sight:9,interval:3.2,armor:'light'},
  harvester: {name:'Shard hauler',cost:300,hp:600,size:.8,speed:2.7,range:0,damage:0,trainTime:14,buildTime:14,power:0,requires:[],producer:'refinery',description:'Automatically collects shards and delivers 200 credits per load. Resumes after moving.',sight:8,interval:1,armor:'heavy',capacity:200},
};

export const MAP_WIDTH=144,MAP_HEIGHT=112;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const sq=(x)=>x*x;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const center=e=>e.kind==='building'?{x:e.x+e.size/2,y:e.y+e.size/2}:e;
const cell=(s,x,y)=>Math.floor(y)*s.width+Math.floor(x);
const inside=(s,x,y)=>x>=0&&y>=0&&x<s.width&&y<s.height;
const good=()=>({ok:true,reason:''});
const bad=reason=>({ok:false,reason});
const alive=e=>e.hp>0;
const own=(s,t,type)=>s.entities.filter(e=>alive(e)&&e.team===t&&(!type||e.type===type));
const completed=(s,t,type)=>own(s,t,type).some(e=>e.kind==='building'&&e.progress>=1);
const definition=e=>e.kind==='building'?BUILDINGS[e.type]:UNITS[e.type];

export function unitRank(e){return e?.kind==='unit'?Math.min(3,Math.floor(Math.max(0,e.kills||0)/5)):0;}
export function unitStats(e){
  const d=UNITS[e?.type];if(!d)return null;
  const rank=unitRank(e),bonus=1+rank*.2;
  return{rank,hp:d.hp*bonus,damage:d.damage*bonus,speed:d.speed*bonus};
}

export function mapLayout(s){
  return{start:{x:Math.round(s.width/6),y:Math.round(s.height*37/56)},end:{x:Math.round(s.width*59/72),y:Math.round(s.height*12/56)},bend:10*Math.min(s.width/72,s.height/56)};
}

function random(s){let x=s.rng|0;x^=x<<13;x^=x>>>17;x^=x<<5;s.rng=x>>>0;return s.rng/4294967296;}
function hash(seed){let h=2166136261;for(const c of String(seed)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0||1;}
function event(s,text,team=0){s.events.push({text,team,time:s.time});}
export function getEntity(s,id){return s.entities.find(e=>e.id===id&&alive(e));}
export function powerStats(s,team){let supply=0,demand=0;for(const e of own(s,team)){if(e.kind!=='building'||e.progress<1)continue;const p=BUILDINGS[e.type].power;if(p>0)supply+=p;else demand-=p;}return{supply,demand,ratio:demand?Math.min(1,supply/demand):1};}

function addEntity(s,team,kind,type,x,y,built=true){
  const d=kind==='building'?BUILDINGS[type]:UNITS[type];
  const e={id:s.nextId++,team,kind,type,x,y,hp:built?d.hp:d.hp*.2,maxHp:d.hp,size:d.size,angle:team?Math.PI:0,progress:built?1:0,cooldown:random(s),order:{type:'idle'},path:[],repath:0};
  if(kind==='unit')e.kills=0;
  if(kind==='building'){e.queue=[];if(type==='refinery')e.haulerPending=true;if(type==='refinery'||type==='core'){e.processingAmount=0;e.processingTotal=0;}s.navVersion++;}else if(type==='harvester'){e.cargo=0;e.unload=0;e.unloadDepotId=null;e.harvestPhase='gather';e.order={type:'harvest'};}
  s.entities.push(e);return e;
}

// Relief primitives: integer-hash value noise, so terrain is identical in every engine and never touches gameplay RNG.
const lat=(x,y,k)=>{let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(k|0,1274126177))|0;h=Math.imul(h^h>>>15,2246822519);h=Math.imul(h^h>>>13,3266489917);return((h^h>>>16)>>>0)/4294967296;};
function vnoise(x,y,k){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);return(lat(ix,iy,k)*(1-u)+lat(ix+1,iy,k)*u)*(1-v)+(lat(ix,iy+1,k)*(1-u)+lat(ix+1,iy+1,k)*u)*v;}
function fbm(x,y,k,oct=3){let sum=0,amp=1,norm=0;for(let o=0;o<oct;o++){sum+=vnoise(x,y,k+o*101)*amp;norm+=amp;x=x*2.03+7.1;y=y*1.97+3.3;amp*=.5;}return sum/norm;}
const quantile=(a,q)=>{const sorted=a.slice().sort();return sorted[Math.min(a.length-1,Math.floor(a.length*q))];};

// Writes 0 ground / 1 rock / 2 basalt for every tile from layered, domain-warped value noise in a route-aligned frame.
// The field is point-symmetric about the mineral mirror centre, so both bases face the same relief.
function relief(s){
  const {width:W,height:H}=s,N=W*H,area=N/(72*56),k=hash(`${s.seed}:relief`),{start,end}=mapLayout(s);
  const cx=(start.x+end.x)/2,cy=(start.y+end.y)/2,dx=end.x-start.x,dy=end.y-start.y,len=Math.hypot(dx,dy),ux=dx/len,uy=dy/len;
  const field=(u,v)=>{
    const px=u/18,py=v*.6/18; // 18-tile wavelength; the anisotropy makes contours tend to cross the routes
    const wx=px+(fbm(px*.7+31,py*.7,k+7,2)-.5)*.9,wy=py+(fbm(px*.7,py*.7+17,k+13,2)-.5)*.9;
    const r=fbm(wx*1.3+5,wy*1.3,k+40,2);
    return[fbm(wx,wy,k,3),1-Math.abs(2*r-1),vnoise(u/9,v/9,k+120)]; // height, ridge (peaks on the r=.5 contour), gap
  };
  const height=new Float32Array(N),ridge=new Float32Array(N),gap=new Float32Array(N);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    // Tile centres make u,v exactly negate under the mineral mirror (start+end-1-x); fold u<0 onto u>0 with a 6-tile blend band instead of a seam.
    const u=(x+.5-cx)*ux+(y+.5-cy)*uy,v=-(x+.5-cx)*uy+(y+.5-cy)*ux,i=y*W+x;
    let f;
    if(u>=3)f=field(u,v);else if(u<=-3)f=field(-u,-v);
    else{const a=field(u,v),b=field(-u,-v),t=u/6+.5,w=t*t*(3-2*t);f=[a[0]*w+b[0]*(1-w),a[1]*w+b[1]*(1-w),a[2]*w+b[2]*(1-w)];}
    height[i]=f[0];ridge[i]=f[1];gap[i]=f[2];
  }
  // Per-map quantiles pin the material shares before clearing: 4% mesa, 20% gapped ridge, 27% basalt.
  const open=ridge.filter((_,i)=>gap[i]>.45),mesa=quantile(height,.96),basin=quantile(height,.27),crest=open.length?quantile(open,Math.max(0,1-.20*N/open.length)):Infinity;
  for(let i=0;i<N;i++)s.terrain[i]=ridge[i]>crest&&gap[i]>.45||height[i]>mesa?1:height[i]<basin?2:0;
  // Boulder outcrops in mirrored pairs: separate small formations the lava pass can recolour.
  const rng={rng:hash(`${s.seed}:outcrops`)},scale=Math.min(W/72,H/56),ringOut=12.5+scale+2.2,mx=start.x+end.x-1,my=start.y+end.y-1;
  const rockNear=(x,y,R)=>{for(let yy=Math.floor(y-R);yy<=y+R;yy++)for(let xx=Math.floor(x-R);xx<=x+R;xx++)if(inside(s,xx,yy)&&sq(xx-x)+sq(yy-y)<=R*R&&s.terrain[yy*W+xx]===1)return true;return false;};
  for(let attempt=0,placed=0;placed<Math.round(10*area)&&attempt<2000*area;attempt++){
    const r=1.6+random(rng)*1.6,x=4+Math.floor(random(rng)*(W-8)),y=4+Math.floor(random(rng)*(H-8)),spots=[{x,y},{x:mx-x,y:my-y}];
    if(Math.hypot(x-spots[1].x,y-spots[1].y)<2*r+4)continue;
    if(spots.some(p=>p.x<4||p.y<4||p.x>=W-4||p.y>=H-4||height[p.y*W+p.x]>mesa||Math.hypot(p.x-start.x,p.y-start.y)<ringOut+r+2||Math.hypot(p.x-end.x,p.y-end.y)<ringOut+r+2||rockNear(p.x,p.y,r+1.5)))continue;
    placed++;
    for(const p of spots)for(let yy=Math.floor(p.y-r-1);yy<=p.y+r+1;yy++)for(let xx=Math.floor(p.x-r-1);xx<=p.x+r+1;xx++){
      const rr=r+(vnoise(xx/2.5,yy/2.5,k+77)-.5)*1.4;
      if(inside(s,xx,yy)&&sq(xx-p.x)+sq(yy-p.y)<rr*rr)s.terrain[yy*W+xx]=1;
    }
  }
}
// A wobbly rock ring around each base; the three route clearings cut its gates afterwards.
function plateauRing(s,protectedGround){
  const {width:W,height:H}=s,k=hash(`${s.seed}:relief`)+50,{start,end}=mapLayout(s),scale=Math.min(W/72,H/56),ringIn=12.5+scale,ringOut=ringIn+2.2;
  if(scale<2)return; // legacy 72x56 has no room: the ring would eat the only tree-eligible band
  for(const c of [start,end])for(let y=Math.max(0,Math.floor(c.y-ringOut-2));y<=Math.min(H-1,c.y+ringOut+2);y++)for(let x=Math.max(0,Math.floor(c.x-ringOut-2));x<=Math.min(W-1,c.x+ringOut+2);x++){
    const i=y*W+x;if(protectedGround[i])continue;
    const d=Math.hypot(x-c.x,y-c.y)+(vnoise(x/5,y/5,k)-.5)*3;
    if(d>=ringIn&&d<=ringOut)s.terrain[i]=1;
  }
}
// Rock within 5.5 tiles of a mineral field centre opens up; only rock is touched, so this can only add connectivity.
function mineralBowls(s,centers){
  const {width:W,height:H}=s,k=hash(`${s.seed}:relief`)+60;
  for(const c of centers)for(let y=Math.max(0,Math.floor(c.y-7.5));y<=Math.min(H-1,c.y+7.5);y++)for(let x=Math.max(0,Math.floor(c.x-7.5));x<=Math.min(W-1,c.x+7.5);x++){
    const i=y*W+x,d=Math.hypot(x-c.x,y-c.y)+(vnoise(x/4,y/4,k)-.5)*2.5;
    if(d<=5.5&&s.terrain[i]===1)s.terrain[i]=0;
  }
}
// Every enclosed pocket of 30+ tiles gets one 3-wide back door to the main region.
function breachPockets(s,clear){
  const {width:W}=s,N=W*s.height,{start}=mapLayout(s);
  for(let guard=0;guard<12;guard++){
    s.navVersion++;rebuildNavigation(s);const main=s.regions[cell(s,start.x,start.y)],sizes=new Map();
    for(let i=0;i<N;i++)if(s.regions[i]&&s.regions[i]!==main)sizes.set(s.regions[i],(sizes.get(s.regions[i])||0)+1);
    const pocket=[...sizes.entries()].filter(([,n])=>n>=30).sort((a,b)=>b[1]-a[1])[0];if(!pocket)return;
    let best=Infinity,a,b;const inMain=[],inPocket=[];
    for(let i=0;i<N;i++){if(s.regions[i]===main)inMain.push(i);else if(s.regions[i]===pocket[0])inPocket.push(i);}
    // ponytail: sampled every 3rd tile of each side, O(pocket*main/9); measured <2 ms, replace with a BFS from the pocket if it ever matters.
    for(let p=0;p<inPocket.length;p+=3){const px=inPocket[p]%W,py=Math.floor(inPocket[p]/W);for(let m=0;m<inMain.length;m+=3){const mx=inMain[m]%W,my=Math.floor(inMain[m]/W),d=sq(px-mx)+sq(py-my);if(d<best){best=d;a={x:px,y:py};b={x:mx,y:my};}}}
    const steps=Math.max(1,Math.ceil(Math.sqrt(best)*2));for(let i=0;i<=steps;i++)clear(a.x+(b.x-a.x)*i/steps,a.y+(b.y-a.y)*i/steps,1.3);
  }
}

function generateMap(s){
  const {width:W,height:H}=s,N=W*H,area=N/(72*56),{start,end,bend}=mapLayout(s);
  // The original scatter only remains to consume the same gameplay RNG draws; relief() overwrites every tile.
  for(let i=0;i<N;i++)s.terrain[i]=random(s)<.18?2:0;
  for(let b=0;b<Math.round(105*area);b++){
    const x=2+Math.floor(random(s)*(W-4)),y=2+Math.floor(random(s)*(H-4)),r=1+random(s)*2.1;
    for(let yy=Math.floor(y-r);yy<=y+r;yy++)for(let xx=Math.floor(x-r);xx<=x+r;xx++)if(inside(s,xx,yy)&&sq(xx-x)+sq(yy-y)<r*r&&random(s)>.13)s.terrain[yy*W+xx]=1;
  }
  relief(s);
  const protectedGround=new Uint8Array(N);
  const clear=(x,y,r)=>{for(let yy=Math.floor(y-r);yy<=y+r;yy++)for(let xx=Math.floor(x-r);xx<=x+r;xx++)if(inside(s,xx,yy)&&sq(xx-x)+sq(yy-y)<=r*r){const i=yy*W+xx;s.terrain[i]=0;protectedGround[i]=1;}};
  clear(start.x,start.y,11);clear(end.x,end.y,11);
  plateauRing(s,protectedGround);
  // Three guaranteed routes prevent unlucky seeds from sealing either base.
  const routeSteps=Math.round(100*Math.sqrt(area));
  for(let i=0;i<=routeSteps;i++){const t=i/routeSteps,x=start.x+(end.x-start.x)*t,y=start.y+(end.y-start.y)*t;clear(x,y,2.6);clear(x,y+Math.sin(t*Math.PI)*bend,2.1);clear(x,y-Math.sin(t*Math.PI)*bend,2.1);}
  // Separate distribution draws from gameplay RNG; both sides receive the same loose patch and budget.
  const centers=[],scatterRng={rng:hash(`${s.seed}:mineral-scatter`)},treeRng={rng:hash(`${s.seed}:trees`)};
  rebuildNavigation(s);const region=s.regions[cell(s,start.x,start.y)];
  const access=(a,b)=>{const steps=Math.max(1,Math.ceil(distance(a,b)*2));for(let i=0;i<=steps;i++)clear(a.x+(b.x-a.x)*i/steps,a.y+(b.y-a.y)*i/steps,.8);};
  const patch=(c,offsets,amounts,mirror)=>{
    centers.push(c);
    if(s.regions[cell(s,c.x,c.y)]!==region){
      let nearest,score=Infinity;
      for(let i=0;i<N;i++)if(s.regions[i]===region){const p={x:i%W,y:Math.floor(i/W)},d=sq(p.x-c.x)+sq(p.y-c.y);if(d<score){score=d;nearest=p;}}
      if(nearest)access(c,nearest);
    }
    offsets.forEach((p,i)=>{const x=c.x+p.x*mirror,y=c.y+p.y*mirror;access(c,{x,y});s.minerals[y*W+x]+=amounts[i];});
  };
  const field=(a,b,amounts)=>{
    const candidates=[];
    for(let y=-4;y<=4;y++)for(let x=-4;x<=4;x++){
      const radius=x*x+y*y;if(!radius||radius>20)continue;
      const points=[{x:a.x+x,y:a.y+y},{x:b.x-x,y:b.y-y}];
      if(points.some(p=>p.x<1||p.y<1||p.x>=W-1||p.y>=H-1||distance(p,start)<6.5||distance(p,end)<6.5))continue;
      candidates.push({x,y,radius,score:random(scatterRng)});
    }
    candidates.sort((a,b)=>a.score-b.score);
    const offsets=[{x:0,y:0},...candidates.filter(p=>p.radius<=8).slice(0,12),...candidates.filter(p=>p.radius>8).slice(0,8)];
    for(const p of candidates)if(offsets.length<21&&!offsets.includes(p))offsets.push(p);
    patch(a,offsets,amounts,1);patch(b,offsets,amounts,-1);
  };
  const fields=[[start.x+8,start.y+1],[start.x,start.y+7],[start.x-6,start.y-12],[Math.round(W*29/72),Math.round(H*27/56)],[Math.round(W*35/72),Math.round(H*40/56)]];
  for(const [x,y] of fields){
    const amounts=Array.from({length:21},()=>320+Math.floor(random(s)*300));field({x,y},{x:start.x+end.x-1-x,y:start.y+end.y-1-y},amounts);
  }
  // Extra remote fields fill the enlarged sector without changing the starting cargo routes.
  const resourceRng={rng:hash(`${s.seed}:fields`)};
  for(let attempt=0;centers.length<Math.round(10*area)&&attempt<1000;attempt++){
    const a={x:4+Math.floor(random(resourceRng)*(W/2-8)),y:4+Math.floor(random(resourceRng)*(H-8))},b={x:W-1-a.x,y:H-1-a.y};
    if([a,b].some(p=>distance(p,start)<17||distance(p,end)<17||centers.some(c=>distance(c,p)<6))||distance(a,b)<6)continue;
    const amounts=Array.from({length:21},()=>320+Math.floor(random(s)*300));field(a,b,amounts);
  }
  mineralBowls(s,centers);
  breachPockets(s,clear);
  addLavaPools(s);
  for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
    const at=y*W+x;if(random(treeRng)>.035||protectedGround[at])continue;
    let open=true;
    // An open eight-neighbor ring guarantees that one new root cannot sever a passage.
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const i=(y+dy)*W+x+dx;if(![0,2].includes(s.terrain[i])||s.minerals[i]>0)open=false;}
    if(open)s.terrain[at]=4;
  }
}

function addLavaPools(s){
  const {width:W,height:H}=s,N=W*H,area=N/(72*56),{start:base,end}=mapLayout(s),dx=end.x-base.x,dy=end.y-base.y;
  // Recolor whole rock formations: routes, minerals, base clearings and combat RNG stay unchanged.
  const visited=new Uint8Array(N),pools=[],lavaRng={rng:hash(`${s.seed}:lava`)};
  for(let start=0;start<N;start++){
    if(visited[start]||s.terrain[start]!==1)continue;
    const tiles=[start];visited[start]=1;
    for(let head=0;head<tiles.length;head++){
      const at=tiles[head],x=at%W,y=Math.floor(at/W);
      for(const next of [x>0?at-1:-1,x<W-1?at+1:-1,y>0?at-W:-1,y<H-1?at+W:-1])if(next>=0&&!visited[next]&&s.terrain[next]===1){visited[next]=1;tiles.push(next);}
    }
    if(tiles.length<6||tiles.length>65||tiles.some(at=>at%W<3||at%W>=W-3||Math.floor(at/W)<3||Math.floor(at/W)>=H-3))continue;
    const x=tiles.reduce((sum,at)=>sum+at%W,0)/tiles.length,y=tiles.reduce((sum,at)=>sum+Math.floor(at/W),0)/tiles.length;
    const routeDistance=Math.abs(-dy*(x-base.x)+dx*(y-base.y))/Math.hypot(dx,dy);
    pools.push({tiles,score:Math.max(0,routeDistance-7)+random(lavaRng)*12});
  }
  pools.sort((a,b)=>a.score-b.score||a.tiles[0]-b.tiles[0]);
  for(const pool of pools.slice(0,Math.round((5+Math.floor(random(lavaRng)*3))*area)))for(const at of pool.tiles)s.terrain[at]=3;
}

export function createGame(seed='ASH-001',difficulty='normal',{width:W=MAP_WIDTH,height:H=MAP_HEIGHT}={}){
  if(!((W===72&&H===56)||(W===MAP_WIDTH&&H===MAP_HEIGHT)))throw new RangeError('Unsupported map dimensions');
  const N=W*H;
  const s={width:W,height:H,seed:String(seed),difficulty:['easy','normal','hard'].includes(difficulty)?difficulty:'normal',rng:hash(seed),nextId:1,time:0,status:'playing',terrain:new Uint8Array(N),minerals:new Float32Array(N),visible:[new Uint8Array(N),new Uint8Array(N)],explored:[new Uint8Array(N),new Uint8Array(N)],entities:[],teams:[{credits:1800,kills:0},{credits:1800,kills:0}],effects:[],events:[],navVersion:0,navBuilt:-1,blocked:new Uint8Array(N),fogClock:0,ai:{nextThink:3,nextRaid:105,known:{},mode:'Establishing base',scoutIndex:0,buildIndex:0,raid:0}};
  s.ai.nextRaid=s.difficulty==='easy'?300:s.difficulty==='hard'?100:150;
  generateMap(s);
  const {start,end}=mapLayout(s);
  for(let team=0;team<2;team++){
    const building=(type,x,y)=>addEntity(s,team,'building',type,team?end.x+11-x-BUILDINGS[type].size:start.x+x-12,team?end.y+36-y-BUILDINGS[type].size:start.y+y-37);
    const unit=(type,x,y)=>addEntity(s,team,'unit',type,team?end.x+11-x:start.x+x-12,team?end.y+36-y:start.y+y-37);
    building('core',10,35);building('reactor',6,35);building('refinery',15,38);
    for(let j=0;j<3;j++)unit('rifle',11+j,33.7);
    unit('scout',15.5,33);
  }
  // Initial footprints must never contain shards, including the generated field fringe.
  for(const e of s.entities)if(e.kind==='building')for(let y=e.y;y<e.y+e.size;y++)for(let x=e.x;x<e.x+e.size;x++){s.terrain[y*W+x]=0;s.minerals[y*W+x]=0;}
  rebuildNavigation(s);for(const e of [...s.entities])deliverRefineryHauler(s,e);
  updateFog(s);event(s,'Command online. Secure the shards. Destroy the hostile nexus.');
  return s;
}

function rebuildNavigation(s){
  const {width:W,height:H}=s,N=W*H;
  if(s.navBuilt===s.navVersion&&s.regionSize)return;
  for(let i=0;i<N;i++)s.blocked[i]=s.terrain[i]===1||s.terrain[i]===3||s.terrain[i]===4?1:0;
  for(const e of s.entities)if(alive(e)&&e.kind==='building')for(let y=e.y;y<e.y+e.size;y++)for(let x=e.x;x<e.x+e.size;x++)s.blocked[y*W+x]=1;
  // Connected regions let haulers skip isolated mineral pockets without repeated A* failures.
  s.regions=new Uint16Array(N);let region=0;const queue=new Int32Array(N);
  for(let start=0;start<N;start++)if(!s.blocked[start]&&!s.regions[start]){
    region++;let head=0,tail=1;queue[0]=start;s.regions[start]=region;
    while(head<tail){const at=queue[head++],x=at%W,y=Math.floor(at/W);for(const next of [x>0?at-1:-1,x<W-1?at+1:-1,y>0?at-W:-1,y<H-1?at+W:-1])if(next>=0&&!s.blocked[next]&&!s.regions[next]){s.regions[next]=region;queue[tail++]=next;}}
  }
  // Region sizes are derived, never saved: a loaded map rebuilds them once.
  s.regionSize=new Uint32Array(region+1);for(let i=0;i<N;i++)s.regionSize[s.regions[i]]++;
  s.navBuilt=s.navVersion;
}
function walkable(s,x,y,r=.19){
  const {width:W,height:H}=s;
  if(x<r||y<r||x>=W-r||y>=H-r)return false;
  for(const yy of [y-r,y+r])for(const xx of [x-r,x+r])if(s.blocked[cell(s,xx,yy)])return false;
  return true;
}
function seen(s,team,e){if(e.team===team)return true;const c=center(e);if(!inside(s,c.x,c.y))return false;if(s.visible[team][cell(s,c.x,c.y)])return true;if(e.kind==='building')for(let y=e.y;y<e.y+e.size;y++)for(let x=e.x;x<e.x+e.size;x++)if(s.visible[team][y*s.width+x])return true;return false;}

export function canPlace(s,team,type,x,y){
  const {width:W,height:H}=s;
  const d=BUILDINGS[type];if(s.status!=='playing')return bad('Operation has ended');if(!d||![0,1].includes(team))return bad('Unknown structure');
  if(!Number.isFinite(x)||!Number.isFinite(y)||x!==Math.floor(x)||y!==Math.floor(y))return bad('Place on the ground grid');
  if(type==='core')return bad('Only one command nexus per operation');
  if(s.teams[team].credits<d.cost)return bad('Insufficient credits');
  const missing=d.requires.find(key=>!completed(s,team,key));if(missing)return bad(`Requires ${BUILDINGS[missing].name}`);
  if(x<1||y<1||x+d.size>=W||y+d.size>=H)return bad('Outside construction zone');
  rebuildNavigation(s);
  for(let yy=y;yy<y+d.size;yy++)for(let xx=x;xx<x+d.size;xx++){
    const i=yy*W+xx;if(!s.visible[team][i])return bad('Requires sensor coverage');if(s.terrain[i]===3)return bad('Lava prevents construction');if(s.terrain[i]===4)return bad('Tree roots obstruct construction');if(s.blocked[i])return bad('Ground is obstructed');if(s.minerals[i]>0)return bad('Shard field obstructs construction');
  }
  if(s.entities.some(e=>alive(e)&&e.kind==='unit'&&e.x>x-.3&&e.x<x+d.size+.3&&e.y>y-.3&&e.y<y+d.size+.3))return bad('Unit in construction area');
  if(!own(s,team).some(e=>e.kind==='building'&&e.progress>=1&&Math.hypot(Math.max(e.x-x-d.size,x-e.x-e.size,0),Math.max(e.y-y-d.size,y-e.y-e.size,0))<=7))return bad('Build within 7 tiles of a finished structure');
  return good();
}
export function placeBuilding(s,team,type,x,y){
  const result=canPlace(s,team,type,x,y);if(!result.ok)return result;
  s.teams[team].credits-=BUILDINGS[type].cost;const entity=addEntity(s,team,'building',type,x,y,false);event(s,`${BUILDINGS[type].name}: construction started`,team);return{...result,id:entity.id};
}
export function toggleRepair(s,id,team=0){
  if(s.status!=='playing')return bad('Operation has ended');
  const e=getEntity(s,id);
  if(!e||e.kind!=='building'||e.team!==team||![0,1].includes(team))return bad('Select one of your structures');
  if(e.progress<1)return bad('Finish construction before repairing');
  if(e.hp>=e.maxHp){e.repairing=false;return bad('Structure is at full integrity');}
  e.repairing=!e.repairing;return{...good(),repairing:e.repairing};
}
export function salvageValue(e){
  if(e?.kind!=='building'||e.type==='core'||!alive(e))return 0;
  // A deployed included hauler survives the sale; its value cannot be cashed out again.
  const cost=BUILDINGS[e.type].cost-(e.type==='refinery'&&!e.haulerPending?UNITS.harvester.cost:0);
  return Math.floor(cost*.5*clamp(e.hp/e.maxHp,0,1)+1e-8)+e.queue.reduce((sum,q)=>sum+UNITS[q.type].cost,0);
}
export function sellBuilding(s,id,team=0){
  if(s.status!=='playing')return bad('Operation has ended');
  const e=getEntity(s,id);
  if(!e||e.kind!=='building'||e.team!==team||![0,1].includes(team))return bad('Select one of your structures');
  if(e.type==='core')return bad('The command nexus cannot be sold');
  const refund=salvageValue(e);s.teams[team].credits+=refund;
  s.entities=s.entities.filter(entity=>entity!==e);s.navVersion++;
  for(const hauler of s.entities)if(hauler.unloadDepotId===id){hauler.unload=0;hauler.unloadDepotId=null;hauler.path=[];hauler.repath=0;}
  event(s,`${BUILDINGS[e.type].name} sold: +${refund} credits`,team);
  return{...good(),refund};
}
export function trainUnit(s,team,type,producerId){
  const d=UNITS[type];if(s.status!=='playing')return bad('Operation has ended');if(!d||![0,1].includes(team))return bad('Unknown unit');
  if(s.teams[team].credits<d.cost)return bad('Insufficient credits');
  const producers=own(s,team,d.producer).filter(e=>e.kind==='building'&&e.progress>=1&&(producerId===undefined||e.id===producerId));
  if(!producers.length)return bad(producerId===undefined?`Requires ${BUILDINGS[d.producer].name}`:'Selected producer unavailable');
  if(d.requires.some(key=>!completed(s,team,key)))return bad('Technology unavailable');
  const remaining=e=>e.queue.reduce((seconds,q)=>seconds+UNITS[q.type].trainTime*(1-q.progress),0);
  const producer=producers.filter(e=>e.queue.length<6).sort((a,b)=>remaining(a)-remaining(b)||a.id-b.id)[0];
  if(!producer)return bad('Production queue full');
  if(own(s,team).reduce((n,e)=>n+(e.kind==='unit'?1:e.queue.length+(e.haulerPending?1:0)),0)>=60)return bad('Unit limit reached (60)');
  s.teams[team].credits-=d.cost;producer.queue.push({type,progress:0});return good();
}

export function setRallyPoint(s,team,ids,point){
  if(s.status!=='playing')return bad('Operation has ended');
  if(![0,1].includes(team)||!Array.isArray(ids)||!ids.length)return bad('Select a production building');
  if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||!inside(s,point.x,point.y))return bad('Rally point outside the sector');
  const producers=[...new Set(ids)].map(id=>getEntity(s,id));
  if(producers.some(e=>!e||e.team!==team||e.kind!=='building'||!['barracks','factory','refinery'].includes(e.type)))return bad('Select your barracks, foundries, or refineries');
  for(const e of producers)e.rally={x:point.x,y:point.y};
  return good();
}

function movementDestinations(s,units,x,y){
  rebuildNavigation(s);
  const selected=new Set(units.map(u=>u.id)),groups=new Map(),slots=[];
  for(const u of units){const region=s.regions[cell(s,u.x,u.y)];if(!groups.has(region))groups.set(region,{count:0,size:0});const g=groups.get(region);g.count++;g.size=Math.max(g.size,u.size);}
  const occupied=[];
  for(const e of s.entities)if(alive(e)&&e.kind==='unit'&&!selected.has(e.id)){
    if(e.team===units[0].team&&['move','attackMove'].includes(e.order.type))occupied.push({...e.order,size:e.size});
    else if((e.order.type==='idle'||!e.moving)&&seen(s,units[0].team,e))occupied.push(e);
  }
  const free=(p,size)=>walkable(s,p.x,p.y,size*.43+.08)&&occupied.every(e=>distance(p,e)>(size+e.size)*.43+.18);
  const region=s.regions[cell(s,x,y)];
  // Keep precise single-unit clicks when free; groups reserve distinct cells so A* cannot merge them.
  if(units.length===1&&region&&region===s.regions[cell(s,units[0].x,units[0].y)]&&free({x,y},units[0].size))return new Map([[units[0].id,{x,y}]]);
  const candidates=[];
  for(let i=0;i<s.blocked.length;i++)if(!s.blocked[i]&&groups.has(s.regions[i])&&s.regions[i])candidates.push(i);
  const score=i=>sq(i%s.width+.5-x)+sq(Math.floor(i/s.width)+.5-y);
  candidates.sort((a,b)=>score(a)-score(b)||a-b);
  // One bounded map scan also handles blocked clicks, map edges and disconnected destinations.
  for(const i of candidates){
    const region=s.regions[i],g=groups.get(region);if(!g.count)continue;
    const p={x:i%s.width+.5,y:Math.floor(i/s.width)+.5,region};
    if(!free(p,g.size))continue;slots.push(p);occupied.push({...p,size:g.size});g.count--;
    if(slots.length===units.length)break;
  }
  const assigned=new Map(),remaining=[...units].sort((a,b)=>a.id-b.id);
  // Repeated orders keep the same individual slot, including an active traffic yield.
  for(let i=remaining.length-1;i>=0;i--){const u=remaining[i],at=slots.findIndex(p=>p.x===u.order.x&&p.y===u.order.y&&p.region===s.regions[cell(s,u.x,u.y)]);if(at>=0){assigned.set(u.id,slots.splice(at,1)[0]);remaining.splice(i,1);}}
  while(remaining.length&&slots.length){
    let best=Infinity,unit=-1,slot=-1;
    for(let i=0;i<remaining.length;i++)for(let j=0;j<slots.length;j++)if(slots[j].region===s.regions[cell(s,remaining[i].x,remaining[i].y)]){
      const d=sq(remaining[i].x-slots[j].x)+sq(remaining[i].y-slots[j].y);if(d<best){best=d;unit=i;slot=j;}
    }
    if(unit<0)break;
    assigned.set(remaining[unit].id,slots.splice(slot,1)[0]);remaining.splice(unit,1);
  }
  return assigned;
}

export function issueOrder(s,ids,order){
  const {width:W,height:H}=s;
  if(!order||!['move','attack','attackMove','attackmove','harvest','explore'].includes(order.type))return;
  const units=[...new Set(ids)].map(id=>getEntity(s,id)).filter(e=>e?.kind==='unit');
  const plans=units.map(u=>{
    let x=Number.isFinite(order.x)?clamp(order.x,.5,W-.5):u.x,y=Number.isFinite(order.y)?clamp(order.y,.5,H-.5):u.y;
    const target=getEntity(s,order.targetId);if(target&&seen(s,u.team,target)){const c=center(target);x=c.x;y=c.y;}
    const type=u.type==='harvester'&&!['harvest','explore'].includes(order.type)?'move':order.type==='attackmove'?'attackMove':order.type;
    return{u,type,x,y,target:target&&seen(s,u.team,target)?target.id:null};
  });
  const groups=new Map();
  for(const p of plans)if(p.type==='move'||p.type==='attackMove'){const key=`${p.x},${p.y}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
  for(const group of groups.values()){
    const goals=movementDestinations(s,group.map(p=>p.u),group[0].x,group[0].y);
    for(const p of group){const goal=goals.get(p.u.id);if(goal){p.x=goal.x;p.y=goal.y;}else p.type=p.u.type==='harvester'?'harvest':'idle';}
  }
  plans.forEach(({u,type,x,y,target})=>{
    if(u.order.type===type&&u.order.x===x&&u.order.y===y&&(u.order.targetId??null)===target)return;
    if(u.order.type!==type||Math.hypot((u.order.x??u.x)-x,(u.order.y??u.y)-y)>1){delete u.trafficWait;delete u.passUntil;}
    u.order=type==='explore'||type==='idle'||type==='harvest'&&order.type!=='harvest'?{type}:{type,x,y,...(target?{targetId:target}:{})};u.targetId=null;u.path=[];u.repath=0;
    if(u.type==='harvester'){u.unloadDepotId=null;if(u.cargo>=UNITS.harvester.capacity)u.harvestPhase='return';}
  });
}
export function stopUnits(s,ids){for(const id of ids){const u=getEntity(s,id);if(u?.kind==='unit'){u.order={type:u.type==='harvester'?'harvest':'idle'};u.targetId=null;u.path=[];u.repath=0;delete u.trafficWait;delete u.passUntil;if(u.type==='harvester')u.unloadDepotId=null;}}}

function updateFog(s){
  const {width:W,height:H}=s;
  for(let team=0;team<2;team++){
    const v=s.visible[team],explored=s.explored[team];v.fill(0);
    for(const e of own(s,team)){
      const c=center(e),r=e.progress<1?4:definition(e).sight;
      for(let y=Math.max(0,Math.floor(c.y-r));y<=Math.min(H-1,c.y+r);y++)for(let x=Math.max(0,Math.floor(c.x-r));x<=Math.min(W-1,c.x+r);x++)if(sq(x+.5-c.x)+sq(y+.5-c.y)<=r*r){v[y*W+x]=1;explored[y*W+x]=1;}
    }
  }
  for(const e of s.entities)if(e.team===0&&alive(e)&&seen(s,1,e)){const c=center(e);s.ai.known[e.id]={id:e.id,kind:e.kind,type:e.type,x:c.x,y:c.y,hp:e.hp,seenAt:s.time};}
  for(const [id,m] of Object.entries(s.ai.known))if(s.visible[1][cell(s,m.x,m.y)]&&!s.entities.some(e=>e.id===Number(id)&&alive(e)&&seen(s,1,e)))delete s.ai.known[id];
}

// A* searches static terrain/buildings. Units use local separation instead of blocking routes.
// ponytail: a per-tick search budget spreads a 60-unit group order over a few ticks; raise it if armies grow.
let pathBudget=16,scratch={N:0};
function findPath(s,u,tx,ty,stop=0){
  if(clearStep(s,u,tx,ty))return[{x:tx,y:ty}];
  if(pathBudget<=0)return null;pathBudget--;
  const {width:W,height:H}=s,N=W*H;
  const start=cell(s,u.x,u.y),goalX=clamp(Math.floor(tx),0,W-1),goalY=clamp(Math.floor(ty),0,H-1);
  if(scratch.N!==N)scratch={N,costs:new Float32Array(N),parent:new Int32Array(N),closed:new Uint8Array(N)};
  const {costs,parent,closed}=scratch,heap=[];costs.fill(Infinity);costs[start]=0;parent.fill(-1);closed.fill(0);
  const heuristic=i=>Math.hypot(i%W+.5-tx,Math.floor(i/W)+.5-ty);
  const push=(i,f)=>{let p=heap.length;heap.push({i,f});while(p){const q=(p-1)>>1;if(heap[q].f<=f)break;heap[p]=heap[q];p=q;}heap[p]={i,f};};
  const pop=()=>{const out=heap[0],last=heap.pop();if(heap.length){let p=0;while(p*2+1<heap.length){let q=p*2+1;if(q+1<heap.length&&heap[q+1].f<heap[q].f)q++;if(heap[q].f>=last.f)break;heap[p]=heap[q];p=q;}heap[p]=last;}return out.i;};
  let best=start,bestH=heuristic(start);push(start,bestH);let count=0;
  while(heap.length&&count++<N){
    const cur=pop();if(closed[cur])continue;closed[cur]=1;
    const h=heuristic(cur);if(h<bestH){best=cur;bestH=h;}
    const x=cur%W,y=Math.floor(cur/W);if(stop>=.2&&h<=Math.max(.75,stop)||(x===goalX&&y===goalY)){best=cur;break;}
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;if(!inside(s,xx,yy))continue;
      const next=yy*W+xx;if(s.blocked[next]||closed[next]||(dx&&dy&&(s.blocked[y*W+xx]||s.blocked[yy*W+x])))continue;
      const g=costs[cur]+(dx&&dy?1.4142:1);if(g>=costs[next])continue;costs[next]=g;parent[next]=cur;push(next,g+heuristic(next));
    }
  }
  const path=[];for(let at=best;at!==start&&at>=0;at=parent[at])path.push({x:at%W+.5,y:Math.floor(at/W)+.5});path.reverse();
  if(stop<.2&&clearStep(s,path.at(-1)||u,tx,ty))path.push({x:tx,y:ty});
  // Long straight grid runs share one bend candidate, avoiding repeated long swept checks.
  const bends=path.filter((p,i)=>!i||i===path.length-1||
    (p.x-path[i-1].x)*(path[i+1].y-p.y)!==(p.y-path[i-1].y)*(path[i+1].x-p.x));
  // Extend each clear leg until the next bend is blocked; don't rescan the distant route per corner.
  const route=[];let anchor=u;
  for(let i=0;i<bends.length;){
    let end=i;
    // After the first shortcut, limit extra rays to 12 tiles so full-army detours stay responsive.
    while(end+1<bends.length&&(end===i||distance(anchor,bends[end+1])<=12)&&clearStep(s,anchor,bends[end+1].x,bends[end+1].y))end++;
    anchor=bends[end];route.push(anchor);i=end+1;
  }
  return route;
}

function clearStep(s,u,x,y){
  // Check the whole segment so sidesteps and waypoint shortcuts cannot cut solid corners.
  const steps=Math.max(1,Math.ceil(Math.hypot(x-u.x,y-u.y)/.12));
  let previousX=u.x,previousY=u.y;
  for(let i=1;i<=steps;i++){
    const nx=u.x+(x-u.x)*i/steps,ny=u.y+(y-u.y)*i/steps;
    if(!walkable(s,nx,ny)||!walkable(s,nx,previousY)||!walkable(s,previousX,ny))return false;
    previousX=nx;previousY=ny;
  }
  return true;
}
function unitSpacing(a,b,time){return(a.size+b.size)*.43*(a.team===b.team&&Math.max(a.passUntil||0,b.passUntil||0)>time?.16:1);}

function navigate(s,u,tx,ty,dt,stop=.2,movement){
  const precise=stop<.2;
  if(precise&&(!walkable(s,tx,ty,u.size*.43+.08)||s.regions[cell(s,tx,ty)]!==s.regions[cell(s,u.x,u.y)])){
    const goal=movementDestinations(s,[u],tx,ty).get(u.id);if(!goal)return false;
    tx=u.order.x=goal.x;ty=u.order.y=goal.y;u.repath=0;
  }
  if(Math.hypot(tx-u.x,ty-u.y)<=stop+(precise?0:.12)){u.path=[];return true;}
  if(u.repath<=0||u.pathVersion!==s.navVersion||!u.pathGoal||Math.hypot(u.pathGoal.x-tx,u.pathGoal.y-ty)>1.4){
    const found=findPath(s,u,tx,ty,stop);if(!found){u.path=[];return false;}
    u.path=found;u.pathGoal={x:tx,y:ty};u.pathVersion=s.navVersion;u.repath=1.3+random(s)*.6;
  }
  if(!u.path.length){
    if(!precise)return Math.hypot(tx-u.x,ty-u.y)<=Math.max(stop+.8,1.1);
    if(!clearStep(s,u,tx,ty))return false;
    u.path=[{x:tx,y:ty}];
  }
  // Follow a short distance around each bend, rounding it only while the swept route stays clear.
  const lookahead=Math.max(.65,unitStats(u).speed*.35);
  while(u.path.length>1&&distance(u,u.path[0])<lookahead){
    const a=u.path[0],b=u.path[1],t=Math.min(1,(lookahead-distance(u,a))/Math.max(.001,distance(a,b)));
    const ahead={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
    if(!clearStep(s,u,ahead.x,ahead.y))break;
    if(t<1){u.path[0]=ahead;break;}u.path.shift();
  }
  const p=u.path[0],dx=p.x-u.x,dy=p.y-u.y,d=Math.hypot(dx,dy),step=Math.min(d,unitStats(u).speed*dt);
  if(d<.08){u.path.shift();return false;}
  const fx=dx/d,fy=dy/d,intent={x:u.x,y:u.y,dx:fx,dy:fy,step,traffic:false};movement.set(u.id,intent);
  const neighbors=s.entities.filter(e=>e!==u&&e.kind==='unit'&&alive(e)&&distance(u,e)<1.7);
  let avoid=0;
  for(const other of neighbors){
    const ox=other.x-u.x,oy=other.y-u.y,ahead=ox*fx+oy*fy,side=-ox*fy+oy*fx;
    const spacing=unitSpacing(u,other,s.time),reach=spacing+.45;
    if(ahead<-.1||ahead>reach||Math.abs(side)>spacing+.1)continue;
    if(other.team===u.team)intent.traffic=true;
    if(spacing<(u.size+other.size)*.2)continue;
    const strength=(1-Math.max(0,ahead)/reach)*(side>.06?-1:1);
    if(Math.abs(strength)>Math.abs(avoid))avoid=strength;
  }
  const side=avoid<0?-1:1,candidates=[[fx-fy*avoid*2,fy+fx*avoid*2],[fx,fy]];
  if(avoid||intent.traffic)candidates.push([-fy*side,fx*side],[fy*side,-fx*side]);
  // Off-center units can round a solid corner in two axis steps when a diagonal is blocked.
  if(fx&&fy)candidates.push([fx,0,Math.min(step,Math.abs(dx))],[0,fy,Math.min(step,Math.abs(dy))]);
  for(const [vx,vy,amount=step] of candidates){
    const length=Math.hypot(vx,vy),nx=u.x+vx/length*amount,ny=u.y+vy/length*amount;
    if(!clearStep(s,u,nx,ny))continue;
    if(neighbors.some(other=>{
      const next=Math.hypot(nx-other.x,ny-other.y);
      if(next>=unitSpacing(u,other,s.time)-.001||next>=distance(u,other)-.001)return false;
      if(other.team===u.team)intent.traffic=true;return true;
    }))continue;
    u.x=nx;u.y=ny;
    const heading=Math.atan2(vy,vx),turn=Math.atan2(Math.sin(heading-u.angle),Math.cos(heading-u.angle));
    const turnRate=UNITS[u.type].armor==='infantry'?9:6;
    u.angle+=clamp(turn,-turnRate*dt,turnRate*dt);
    if(distance(u,p)<.08)u.path.shift();return false;
  }
  if(!intent.traffic&&!avoid){u.repath=0;u.path=[];}
  return false;
}

function nearestMineral(s,u,x=u.x,y=u.y){
  const W=s.width,N=W*s.height;
  let best=-1,score=Infinity;const region=s.regions[cell(s,u.x,u.y)];
  for(let i=0;i<N;i++)if(s.minerals[i]>0&&s.explored[u.team][i]&&!s.blocked[i]&&s.regions[i]===region){const d=sq(i%W+.5-x)+sq(Math.floor(i/W)+.5-y);if(d<score){best=i;score=d;}}
  return best;
}
function harvest(s,u,dt,movement){
  const W=s.width;
  const cap=UNITS.harvester.capacity;
  if(u.cargo>=cap-.001)u.harvestPhase='return';
  if(u.harvestPhase==='return'){
    const refineries=own(s,u.team,'refinery').filter(e=>e.progress>=1),depot=(refineries.length?refineries:own(s,u.team,'core')).sort((a,b)=>distance(u,center(a))-distance(u,center(b)))[0];
    if(!depot)return;
    const c=center(depot),stop=depot.size/2+.7;
    if(navigate(s,u,c.x,c.y,dt,stop,movement)||distance(u,c)<stop+.4){
      if(u.cargo>0)u.unloadDepotId=depot.id;
      u.unload=(u.unload||0)+dt;
      if(u.unload>=1.2){
        const amount=u.cargo*(depot.type==='core'?.6:1);s.teams[u.team].credits+=amount;
        // Processing is visual bookkeeping after the existing immediate credit deposit.
        depot.processingAmount=(depot.processingAmount||0)+u.cargo;depot.processingTotal=(depot.processingTotal||0)+u.cargo;
        event(s,`Shard delivery: +${Math.floor(amount)} credits`,u.team);
        u.cargo=0;u.unload=0;u.unloadDepotId=null;u.harvestPhase='gather';u.repath=0;
      }
    }
    return;
  }
  if(u.mineralTile===undefined||s.minerals[u.mineralTile]<=0||u.mineralTile<0&&s.time>=(u.mineralSearchAt||0)||u.mineralNavVersion!==s.navVersion||u.harvestTargetX!==u.order.x||u.harvestTargetY!==u.order.y){u.mineralTile=nearestMineral(s,u,u.order.x??u.x,u.order.y??u.y);u.harvestTargetX=u.order.x;u.harvestTargetY=u.order.y;u.mineralNavVersion=s.navVersion;u.mineralSearchAt=s.time+1;u.repath=0;}
  if(u.mineralTile<0){if(u.cargo>0)u.harvestPhase='return';return;}
  const x=u.mineralTile%W+.5,y=Math.floor(u.mineralTile/W)+.5;
  if(navigate(s,u,x,y,dt,.75,movement)||Math.hypot(u.x-x,u.y-y)<1.1){const amount=Math.min(28*dt,s.minerals[u.mineralTile],cap-u.cargo);s.minerals[u.mineralTile]-=amount;u.cargo+=amount;}
}

function explore(s,u,dt,movement){
  const {width:W,height:H}=s,N=W*H;
  const order=u.order;
  if(order.tile===undefined||order.navVersion!==s.navVersion||s.explored[u.team][order.tile]&&s.time>=order.nextPlan){
    let best=-1,score=Infinity;const region=s.regions[cell(s,u.x,u.y)];
    // Mark only the nearby cells around other destinations, keeping large scout groups cheap.
    const crowding=new Float32Array(N);
    for(const e of own(s,u.team))if(e!==u&&e.order.type==='explore'&&e.order.tile!==undefined){
      const tx=e.order.tile%W,ty=Math.floor(e.order.tile/W);
      for(let y=Math.max(0,ty-5);y<=Math.min(H-1,ty+5);y++)for(let x=Math.max(0,tx-5);x<=Math.min(W-1,tx+5);x++)crowding[y*W+x]+=Math.max(0,6-Math.hypot(x-tx,y-ty));
    }
    for(let i=0;i<N;i++)if(!s.explored[u.team][i]&&!s.blocked[i]&&s.regions[i]===region){
      const x=i%W+.5,y=Math.floor(i/W)+.5;
      const value=Math.hypot(x-u.x,y-u.y)+crowding[i];
      if(value<score){best=i;score=value;}
    }
    if(best<0){stopUnits(s,[u.id]);event(s,`${UNITS[u.type].name}: reachable territory explored`,u.team);return;}
    order.tile=best;order.x=best%W+.5;order.y=Math.floor(best/W)+.5;order.navVersion=s.navVersion;order.nextPlan=s.time+1;
    u.path=[];u.repath=0;
  }
  if(navigate(s,u,order.x,order.y,dt,.35,movement))order.tile=undefined;
}

function targetDistance(a,b){const ca=center(a),cb=center(b);return Math.max(0,distance(ca,cb)-(b.kind==='building'?b.size*.45:0));}
function acquire(s,e,r){
  let best=null,score=Infinity;for(const enemy of s.entities){if(enemy.team===e.team||!alive(enemy)||!seen(s,e.team,enemy))continue;const d=targetDistance(e,enemy);if(d>r)continue;const threat=enemy.kind==='building'?(BUILDINGS[enemy.type].damage?-1:1):enemy.type==='harvester'?.8:0;const value=d+threat;if(value<score){score=value;best=enemy;}}
  return best;
}
function armorMultiplier(attacker,target){
  const armor=target.kind==='building'?'building':UNITS[target.type].armor;
  const table={rifle:{infantry:1,light:.55,heavy:.23,building:.4},rocket:{infantry:.3,light:.9,heavy:1.8,building:.7},scout:{infantry:1.25,light:.65,heavy:.26,building:.4},tank:{infantry:.5,light:1.1,heavy:1,building:1},artillery:{infantry:.9,light:1,heavy:.8,building:1.5},turret:{infantry:.75,light:1,heavy:1,building:.8},rocketTower:{infantry:.45,light:1,heavy:1.2,building:.8}};
  return table[attacker.type]?.[armor]??1;
}
function hurt(s,target,amount,attacker){
  if(!alive(target))return;target.hp-=amount;target.lastHit=s.time;target.attackerId=attacker.id;
  // A throttled alert for forces that are not already fighting on the player's orders; the HUD turns it into a warning toast and minimap ping.
  const engaging=target.kind==='unit'&&(target.order.type==='attack'||target.order.type==='attackMove'||s.time-(target.lastShot??-99)<3);
  if(target.team===0&&!engaging&&s.time-(s.alertAt??-99)>8){s.alertAt=s.time;event(s,`${definition(target).name} under attack`,0);}
  if(target.hp<=0){
    s.teams[attacker.team].kills++;
    const killer=getEntity(s,attacker.id);
    if(killer?.kind==='unit'&&killer.team===attacker.team){
      const previousRank=unitRank(killer);killer.kills=(killer.kills||0)+1;
      if(unitRank(killer)>previousRank){
        const stats=unitStats(killer);killer.hp=Math.min(stats.hp,killer.hp+stats.hp-killer.maxHp);killer.maxHp=stats.hp;
        event(s,`${UNITS[killer.type].name} promoted to rank ${stats.rank}`,killer.team);
      }
    }
    const c=center(target);s.effects.push({type:'explosion',x:c.x,y:c.y,life:.6,maxLife:.6,team:target.team,size:target.kind==='building'?target.size:1});
    if(target.kind==='building'){s.navVersion++;event(s,`${BUILDINGS[target.type].name} destroyed`,target.team);}
    else{event(s,`${UNITS[target.type].name} lost`,target.team);if(target.type==='harvester'&&!own(s,target.team,'harvester').length&&!queued(s,target.team,'harvester')&&!own(s,target.team,'refinery').some(r=>r.haulerPending))event(s,'All haulers lost. Train a new one at the refinery.',target.team);}
    if(target.type==='core'){s.status=target.team===0?'defeat':'victory';event(s,target.team===0?'Command nexus lost. Operation failed.':'Hostile nexus destroyed. Sector secured.');}
  }
}
function shoot(s,e,target){
  const d=definition(e),a=center(e),b=center(target),damage=e.kind==='unit'?unitStats(e).damage:d.damage;e.angle=Math.atan2(b.y-a.y,b.x-a.x);e.cooldown=d.interval||1;e.lastShot=s.time;
  if(e.type==='rocket'||e.type==='rocketTower'){
    const flight=clamp(distance(a,b)/15,.2,.65);
    s.effects.push({type:'rocket',weapon:e.type,attackerId:e.id,targetId:target.id,damage,x:a.x,y:a.y,tx:b.x,ty:b.y,life:flight,maxLife:flight,team:e.team});
    return;
  }
  s.effects.push({type:e.type==='artillery'?'shell':'shot',weapon:e.type,x:a.x,y:a.y,tx:b.x,ty:b.y,life:e.type==='artillery'?.35:.13,maxLife:e.type==='artillery'?.35:.13,team:e.team});
  hurt(s,target,damage*armorMultiplier(e,target),e);
  if(e.type==='artillery')for(const other of s.entities)if(other!==target&&other.team!==e.team&&alive(other)&&distance(center(other),b)<1.6)hurt(s,other,damage*.45*armorMultiplier(e,other),e);
}

function rocketImpact(s,fx){
  const d=fx.weapon==='rocketTower'?BUILDINGS.rocketTower:UNITS.rocket,damage=fx.damage??d.damage;
  const attacker={id:fx.attackerId,type:fx.weapon,team:fx.team},impact={x:fx.tx,y:fx.ty};
  s.effects.push({type:'explosion',weapon:fx.weapon,x:impact.x,y:impact.y,life:.35,maxLife:.35,team:fx.team,size:fx.weapon==='rocketTower'?1.15:.65});
  for(const target of s.entities){
    if(!alive(target)||target.team===fx.team||distance(center(target),impact)>d.splash)continue;
    hurt(s,target,damage*(target.id===fx.targetId?1:d.splashDamage)*armorMultiplier(attacker,target),attacker);
  }
}

function stepUnit(s,u,dt,movement){
  if(u.type==='harvester')u.unloadDepotId=null;
  u.repath-=dt;u.cooldown=Math.max(0,u.cooldown-dt);
  if(u.type==='harvester'&&!['move','explore'].includes(u.order.type)){if(u.order.type!=='harvest')u.order={type:'harvest'};harvest(s,u,dt,movement);return;}
  const d=UNITS[u.type],order=u.order;
  if(order.type==='move'){
    const arrived=navigate(s,u,order.x,order.y,dt,.08,movement);
    // Movement goals are reachable parking slots; traffic must not cancel an unfinished delivery move.
    if(arrived)u.order={type:u.type==='harvester'?'harvest':'idle'};
    return;
  }
  let target=getEntity(s,order.type==='attack'?order.targetId:u.targetId);
  if(target&&(target.team===u.team||!seen(s,u.team,target)))target=null;
  if(target&&order.type!=='attack'&&targetDistance(u,target)>(order.type==='attackMove'?d.sight+1:d.range))target=null;
  if(!target&&d.damage>0)target=acquire(s,u,order.type==='attackMove'?d.sight:d.range);
  u.targetId=target?.id??null;
  if(target){
    const c=center(target);if(order.type==='attack'&&target.id===order.targetId){order.x=c.x;order.y=c.y;}
    if(targetDistance(u,target)<=d.range){if(order.type==='explore'){u.path=[];u.repath=0;}if(u.cooldown<=0)shoot(s,u,target);return;}
    if(order.type==='attack'||order.type==='attackMove'){navigate(s,u,c.x,c.y,dt,d.range+(target.kind==='building'?target.size*.45:0)-.2,movement);return;}
  }
  if(order.type==='explore'){explore(s,u,dt,movement);return;}
  if(order.type==='attackMove'||order.type==='attack'){
    // A concealed building's centre is solid ground: stop at its edge instead of searching the whole map.
    const goal=order.type==='attack'?getEntity(s,order.targetId):null,stop=order.type==='attackMove'?.08:goal?.kind==='building'?goal.size*.71+.75:.45;
    if(navigate(s,u,order.x,order.y,dt,stop,movement))u.order={type:'idle'};
  }
}

function spawnAt(s,producer,type){
  if(own(s,producer.team).filter(e=>e.kind==='unit').length>=60)return false;
  const c=center(producer);let best=null,bestScore=Infinity;
  for(let y=producer.y-2;y<=producer.y+producer.size+2;y++)for(let x=producer.x-2;x<=producer.x+producer.size+2;x++){
    // Never deploy into a sealed pocket between buildings: such a unit could not follow any order.
    if(!walkable(s,x+.5,y+.5,.3)||s.regionSize[s.regions[y*s.width+x]]<40)continue;
    const crowded=s.entities.filter(e=>e.kind==='unit'&&alive(e)&&Math.hypot(e.x-x-.5,e.y-y-.5)<.8).length;
    const score=distance(c,{x:x+.5,y:y+.5})+crowded*5;if(score<bestScore){best={x:x+.5,y:y+.5};bestScore=score;}
  }
  if(!best)return false;
  const u=addEntity(s,producer.team,'unit',type,best.x,best.y);
  if(producer.rally)issueOrder(s,[u.id],{type:type==='harvester'?'move':'attackMove',...producer.rally});
  event(s,`${UNITS[type].name} ready`,producer.team);return true;
}

function deliverRefineryHauler(s,e){
  // Keep the included hauler pending if its exit is blocked or the army is full.
  if(e.haulerPending&&e.progress>=1&&spawnAt(s,e,'harvester'))e.haulerPending=false;
}

function separateUnits(s,dt,movement){
  // ponytail: pairwise separation is bounded by the 60-unit cap per team; use buckets for larger armies.
  const units=s.entities.filter(e=>e.kind==='unit'&&alive(e));
  for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++){
    const a=units[i],b=units[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);const min=unitSpacing(a,b,s.time);
    if(d>=min)continue;if(d<.001){dx=.01;dy=.004;d=Math.hypot(dx,dy);}
    const movingA=movement.has(a.id),movingB=movement.has(b.id),shareA=movingA===movingB?.5:movingA?1:0;
    const push=Math.min((min-d)*.9,dt*1.8),px=dx/d*push,py=dy/d*push;
    if(clearStep(s,a,a.x-px*shareA,a.y-py*shareA)){a.x-=px*shareA;a.y-=py*shareA;}
    if(clearStep(s,b,b.x+px*(1-shareA),b.y+py*(1-shareA))){b.x+=px*(1-shareA);b.y+=py*(1-shareA);}
  }
  for(const u of units){
    const intent=movement.get(u.id);
    if(!intent){delete u.trafficWait;delete u.passUntil;continue;}
    if(u.passUntil<=s.time)delete u.passUntil;
    const progress=(u.x-intent.x)*intent.dx+(u.y-intent.y)*intent.dy;
    if(intent.traffic&&!(u.passUntil>s.time)&&progress<intent.step*.25)u.trafficWait=Math.min(.8,(u.trafficWait||0)+dt);
    else u.trafficWait=Math.max(0,(u.trafficWait||0)-dt*2);
    // Only friendly spacing softens during a jam; static geometry stays solid.
    if(u.trafficWait>=.8-1e-8){u.passUntil=s.time+1.5;u.trafficWait=0;}
  }
}

function aiBuild(s,type){
  const {width:W,height:H}=s;
  const base=own(s,1,'core')[0];if(!base)return false;
  const c=center(base),toward={x:(W/2-c.x),y:(H/2-c.y)};const length=Math.hypot(toward.x,toward.y);toward.x/=length;toward.y/=length;
  const preferred=BUILDINGS[type].damage?{x:c.x+toward.x*9,y:c.y+toward.y*9}:c;
  const candidates=[];
  for(let y=Math.max(1,base.y-11);y<Math.min(H-4,base.y+14);y++)for(let x=Math.max(1,base.x-12);x<Math.min(W-4,base.x+14);x++)if(canPlace(s,1,type,x,y).ok)candidates.push({x,y,score:Math.hypot(x-preferred.x,y-preferred.y)});
  candidates.sort((a,b)=>a.score-b.score);if(!candidates.length)return false;
  const spot=candidates[Math.min(candidates.length-1,Math.floor(random(s)*3))];return placeBuilding(s,1,type,spot.x,spot.y).ok;
}
function queued(s,team,type){return own(s,team).reduce((sum,e)=>sum+(e.queue?.filter(q=>q.type===type).length||0),0);}
function thinkAI(s){
  const {width:W,height:H}=s;
  const ai=s.ai,hard=s.difficulty==='hard',easy=s.difficulty==='easy';ai.nextThink=s.time+(hard?1.2:easy?3.5:2);
  const core=own(s,1,'core')[0];if(!core)return;const c=center(core),buildings=own(s,1).filter(e=>e.kind==='building');
  const units=own(s,1).filter(e=>e.kind==='unit'),army=units.filter(e=>e.type!=='harvester');
  const enemies=s.entities.filter(e=>e.team===0&&alive(e)&&seen(s,1,e));
  // A parked rover or hauler is left to the guards; only an armed intrusion pulls the army home.
  const intruders=enemies.filter(e=>e.kind==='unit'&&e.type!=='scout'&&e.type!=='harvester'&&buildings.some(b=>distance(center(b),e)<13));
  const constructing=buildings.some(e=>e.progress<1),power=powerStats(s,1);
  if(!constructing){
    if(!completed(s,1,'refinery'))aiBuild(s,'refinery');
    else if(power.supply-power.demand<25)aiBuild(s,'reactor');
    else if(!completed(s,1,'barracks'))aiBuild(s,'barracks');
    else if(!completed(s,1,'factory')&&s.time>(easy?70:35))aiBuild(s,'factory');
    else if(own(s,1,'turret').length+own(s,1,'rocketTower').length<(hard?3:2)&&s.time>75)aiBuild(s,own(s,1,'turret').length?'rocketTower':'turret');
    else if(s.teams[1].credits>1200&&own(s,1,'barracks').length<2&&!easy&&s.time>(hard?0:240))aiBuild(s,'barracks');
  }
  const haulers=units.filter(e=>e.type==='harvester');
  if(haulers.length+queued(s,1,'harvester')<(easy?2:3))trainUnit(s,1,'harvester');
  if(completed(s,1,'barracks')){
    if(!units.some(e=>e.type==='scout')&&!queued(s,1,'scout'))trainUnit(s,1,'scout');
    if(s.time>(easy?75:45)&&units.filter(e=>e.type==='rocket').length+queued(s,1,'rocket')<Math.min(easy?2:hard?5:4,Math.floor(army.length/3))&&s.teams[1].credits>(completed(s,1,'factory')?300:600))trainUnit(s,1,'rocket');
    if(queued(s,1,'rifle')<2&&units.filter(e=>e.type==='rifle').length<(easy?6:hard?14:10)&&s.teams[1].credits>(completed(s,1,'factory')?180:450))trainUnit(s,1,'rifle');
  }
  if(completed(s,1,'factory')&&s.teams[1].credits>300){
    const tanks=units.filter(e=>e.type==='tank').length,siege=units.filter(e=>e.type==='artillery').length;
    // Cadet opposition fields a small armored column and never brings siege guns.
    const type=!easy&&tanks>=3&&siege<Math.floor(tanks/3)?'artillery':'tank';if(!(easy&&tanks>=4)&&queued(s,1,type)<2)trainUnit(s,1,type);
  }
  const rally={x:c.x+(W/2-c.x)*.3,y:c.y+(H/2-c.y)*.3};
  for(const b of buildings)b.rally=rally;
  if(intruders.length){
    ai.mode='Defending perimeter';const threat=intruders.sort((a,b)=>distance(c,a)-distance(c,b))[0];
    // One grouped order per response keeps the destination search bounded for large armies.
    issueOrder(s,army.filter(u=>u.hp/u.maxHp>.25).map(u=>u.id),{type:'attack',targetId:threat.id,x:threat.x,y:threat.y});
    const fleeing=haulers.filter(h=>enemies.some(e=>e.kind==='unit'&&e.type!=='harvester'&&distance(h,e)<7));
    if(fleeing.length)issueOrder(s,fleeing.map(h=>h.id),{type:'move',x:c.x+3,y:c.y+4});
    return;
  }
  const wounded=army.filter(u=>u.hp/u.maxHp<.25&&distance(u,c)>7);
  if(wounded.length)issueOrder(s,wounded.map(u=>u.id),{type:'move',x:c.x+4,y:c.y+4});
  const knownBuildings=Object.values(ai.known).filter(e=>e.kind==='building');
  const scout=army.find(e=>e.type==='scout'&&e.hp/e.maxHp>.3);
  const {start}=mapLayout(s);
  const waypoints=[{x:W*35/72,y:H/2},{x:start.x+6,y:start.y+3},{x:W/6,y:H*15/56},{x:W*50/72,y:H*43/56},{x:start.x-3,y:start.y+11}];
  if(scout&&!knownBuildings.length&&(scout.order.type==='idle'||s.time>25&&scout.order.type==='attackMove')){
    const point=waypoints[ai.scoutIndex%waypoints.length];if(distance(scout,point)<3)ai.scoutIndex++;const dest=waypoints[ai.scoutIndex%waypoints.length];issueOrder(s,[scout.id],{type:'move',...dest});ai.mode='Scouting the sector';
  }
  const fighting=army.filter(e=>e!==scout&&e.hp/e.maxHp>.3);
  if(s.time>=ai.nextRaid&&fighting.length>=(easy?9:hard?5:7)){
    const priority={refinery:0,reactor:1,turret:3,rocketTower:3,core:2,barracks:2,factory:2};
    const target=knownBuildings.sort((a,b)=>(priority[a.type]??2)-(priority[b.type]??2)||distance(c,a)-distance(c,b))[0];
    const dest=target||waypoints[ai.scoutIndex++%waypoints.length];
    issueOrder(s,fighting.slice(0,easy?8:hard?Infinity:10).map(e=>e.id),{type:'attackMove',x:dest.x,y:dest.y});ai.nextRaid=s.time+(easy?150:hard?50:90);ai.raid++;ai.mode=target?'Raiding enemy infrastructure':'Probing unexplored territory';
  }else{
    const idle=fighting.filter(u=>u.order.type==='idle'&&distance(u,rally)>4);
    if(idle.length)issueOrder(s,idle.map(u=>u.id),{type:'attackMove',...rally});
  }
}

// Power throttles everything; the opposition additionally builds and trains slower below Veteran.
const AI_PACE={easy:.55,normal:.75,hard:1};
export function productionRate(s,team,power=powerStats(s,team)){return Math.max(.2,power.ratio)*(team===1?AI_PACE[s.difficulty]:1);}
function step(s,dt){
  if(s.status!=='playing')return;s.time+=dt;rebuildNavigation(s);pathBudget=16;
  s.fogClock-=dt;if(s.fogClock<=0){updateFog(s);s.fogClock=.2;}
  const powers=[powerStats(s,0),powerStats(s,1)],movement=new Map();
  for(const e of [...s.entities]){
    if(!alive(e))continue;
    if(e.kind==='building'){
      const rate=Math.max(.2,powers[e.team].ratio),pace=productionRate(s,e.team,powers[e.team]);
      if(e.progress<1){const delta=Math.min(1-e.progress,dt/BUILDINGS[e.type].buildTime*pace);e.progress=Math.min(1,e.progress+delta);e.hp=Math.min(e.maxHp,e.hp+e.maxHp*.8*delta);if(e.progress>=1){event(s,`${BUILDINGS[e.type].name} online`,e.team);deliverRefineryHauler(s,e);}continue;}
      if(e.repairing){
        const costPerHp=BUILDINGS[e.type].cost*.5/e.maxHp;
        const amount=Math.min(e.maxHp-e.hp,dt*e.maxHp*.02,s.teams[e.team].credits/costPerHp);
        e.hp=Math.min(e.maxHp,e.hp+amount);s.teams[e.team].credits=Math.max(0,s.teams[e.team].credits-amount*costPerHp);
        if(e.hp>=e.maxHp)e.repairing=false;
      }
      if(e.processingAmount>0){e.processingAmount=Math.max(0,e.processingAmount-dt*UNITS.harvester.capacity/6);if(e.processingAmount<1e-8)e.processingAmount=e.processingTotal=0;}
      deliverRefineryHauler(s,e);
      const q=e.queue[0];if(q){q.progress=Math.min(1,q.progress+dt/UNITS[q.type].trainTime*pace);if(q.progress>=1){if(spawnAt(s,e,q.type))e.queue.shift();else if(Math.floor(s.time/10)!==Math.floor((s.time-dt)/10))event(s,`${BUILDINGS[e.type].name}: deployment bay blocked`,e.team);}}
      if(BUILDINGS[e.type].damage){e.cooldown=Math.max(0,e.cooldown-dt*rate);const target=acquire(s,e,BUILDINGS[e.type].range);e.targetId=target?.id??null;if(target&&e.cooldown<=0&&powers[e.team].ratio>=1)shoot(s,e,target);}
    }else stepUnit(s,e,dt,movement);
  }
  separateUnits(s,dt,movement);
  // Damaged vehicles can fall back to their nexus for slow paid repairs.
  for(const e of s.entities)if(alive(e)&&e.kind==='unit'&&e.hp<e.maxHp&&s.time-(e.lastHit??-99)>8&&s.teams[e.team].credits>1&&own(s,e.team,'core').some(core=>distance(e,center(core))<7)){const amount=Math.min(e.maxHp-e.hp,dt*5,s.teams[e.team].credits*8);e.hp+=amount;s.teams[e.team].credits-=amount/8;}
  for(const effect of s.effects){
    if(effect.type==='rocket'){
      const target=getEntity(s,effect.targetId);
      if(target&&seen(s,effect.team,target)){const c=center(target);effect.tx=c.x;effect.ty=c.y;}
    }
    effect.life-=dt;
    if(effect.type==='rocket'&&effect.life<=1e-8){effect.life=0;if(s.status==='playing')rocketImpact(s,effect);}
  }
  s.effects=s.effects.filter(e=>e.life>0);
  s.entities=s.entities.filter(alive);
  if(s.status==='playing'&&s.time>=s.ai.nextThink)thinkAI(s);
}
export function updateGame(s,dt){
  if(!Number.isFinite(dt)||dt<=0||s.status!=='playing')return;
  // Fixed upper step keeps projectile cooldowns, harvest rates, and collision stable.
  let remaining=Math.min(dt,1);while(remaining>1e-8&&s.status==='playing'){const amount=Math.min(.05,remaining);step(s,amount);remaining-=amount;}
}
