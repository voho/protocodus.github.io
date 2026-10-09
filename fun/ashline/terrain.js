// Ashline terrain: seeded, point-symmetric map generation. Coordinates are tiles.
// Pure: it reads a game's size, seed and profile, writes its terrain and mineral grids, and draws
// only from local hash-seeded streams, so map layout never shifts the shared simulation RNG (s.rng).
export const MAP_SIZES={
  standard:{name:'Standard',width:144,height:112},
  frontier:{name:'Frontier',width:192,height:144},
  vast:{name:'Vast',width:224,height:168},
};
export const MAP_PROFILES={
  rift:{name:'Volcanic rift',description:'Lava shores, broken ridges, and exposed rich central deposits.'},
  basin:{name:'Basalt basin',description:'Broad open basalt plains, sheltered expansions, and scattered mesas.'},
  highlands:{name:'Shattered highlands',description:'Raised plateaus, defended passes, and valuable flanking expansions.'},
};
const sq=x=>x*x;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const cell=(s,x,y)=>Math.floor(y)*s.width+Math.floor(x);
const inside=(s,x,y)=>x>=0&&y>=0&&x<s.width&&y<s.height;
// The same xorshift as the simulation's random(s), applied to a local {rng} stream object.
function random(stream){let x=stream.rng|0;x^=x<<13;x^=x>>>17;x^=x<<5;stream.rng=x>>>0;return stream.rng/4294967296;}
export function hash(seed){let h=2166136261;for(const c of String(seed)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0||1;}
export function mapLayout(s){
  if(s.width===72&&s.height===56)return{start:{x:12,y:37},end:{x:59,y:12},bend:10};
  const start={x:Math.round(s.width/6),y:Math.round(s.height*.72)},end={x:s.width+1-start.x,y:s.height+1-start.y};
  const bend=(s.mapProfile==='basin'?12:s.mapProfile==='highlands'?9:10)*Math.min(s.width/72,s.height/56);
  return{start,end,bend};
}

// Relief primitives: integer-hash value noise. Map generation never consumes combat RNG.
const lat=(x,y,k)=>{let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(k|0,1274126177))|0;h=Math.imul(h^h>>>15,2246822519);h=Math.imul(h^h>>>13,3266489917);return((h^h>>>16)>>>0)/4294967296;};
function vnoise(x,y,k){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);return(lat(ix,iy,k)*(1-u)+lat(ix+1,iy,k)*u)*(1-v)+(lat(ix,iy+1,k)*(1-u)+lat(ix+1,iy+1,k)*u)*v;}
function fbm(x,y,k,oct=3){let sum=0,amp=1,norm=0;for(let o=0;o<oct;o++){sum+=vnoise(x,y,k+o*101)*amp;norm+=amp;x=x*2.03+7.1;y=y*1.97+3.3;amp*=.5;}return sum/norm;}
// Quantile of a numerically sorted TypedArray whose entries each stand for `copies` cells.
const quantile=(sorted,q,copies=1)=>{const length=sorted.length*copies;return sorted[Math.floor(Math.min(length-1,Math.floor(length*q))/copies)];};
export const PROFILE_RELIEF={
  rift:{wavelength:23,ridges:.22,mesas:.045,basalt:.22,gap:.43,ring:2.4,route:2.9,flank:2.5,trees:.028,lava:7,outcrop:4.5},
  basin:{wavelength:29,ridges:.10,mesas:.07,basalt:.47,gap:.5,ring:1.9,route:3.9,flank:3.2,trees:.04,lava:2,outcrop:3.8},
  highlands:{wavelength:19,ridges:.26,mesas:.08,basalt:.16,gap:.4,ring:3,route:2.7,flank:2.4,trees:.035,lava:3.5,outcrop:3.4},
};
const terrainProfile=s=>PROFILE_RELIEF[s.mapProfile]||PROFILE_RELIEF.rift;
// Every terrain mutation has a mirrored partner, including gates, mineral access, lava and tree roots.
function mirroredTerrain(s,i,type){s.terrain[i]=type;s.terrain[s.terrain.length-1-i]=type;}

function relief(s){
  const {width:W,height:H}=s,N=W*H,k=hash(`${s.seed}:relief:${s.mapProfile}`),rules=terrainProfile(s),{start,end}=mapLayout(s);
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
  const rng={rng:hash(`${s.seed}:outcrops:${s.mapProfile}`)},target=Math.round(6*Math.sqrt(N/(72*56))),exclusion=19;
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
function plateauRing(s,protectedGround){
  const {width:W,height:H}=s,k=hash(`${s.seed}:relief`)+50,{start}=mapLayout(s),scale=Math.min(W/72,H/56),ringIn=12.5+scale,ringOut=ringIn+terrainProfile(s).ring;
  if(scale<2)return;
  const c=start;
  for(let y=Math.max(0,Math.floor(c.y-ringOut-2));y<=Math.min(H-1,c.y+ringOut+2);y++)for(let x=Math.max(0,Math.floor(c.x-ringOut-2));x<=Math.min(W-1,c.x+ringOut+2);x++){
    const i=y*W+x;if(protectedGround[i])continue;
    const d=Math.hypot(x-c.x,y-c.y)+(vnoise(x/5,y/5,k)-.5)*3;
    if(d>=ringIn&&d<=ringOut)mirroredTerrain(s,i,1);
  }
}
function mineralBowls(s,centers){
  const {width:W,height:H}=s,k=hash(`${s.seed}:relief`)+60;
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
  // One visitor per pass, rather than a closure per cell; open ground is terrain 0, 2 or 5.
  const neighbors=(i,visit)=>{const x=i%W;if(x>0)visit(i-1);if(x<W-1)visit(i+1);if(i>=W)visit(i-W);if(i<N-W)visit(i+W);};
  const flood=next=>{const t=terrain[next];if(!regions[next]&&(t===0||t===2||t===5)){regions[next]=id;queue[tail++]=next;}};
  for(let i=0;i<N;i++){
    if(regions[i]||terrain[i]===1||terrain[i]===3||terrain[i]===4)continue;
    id=++count;tail=1;queue[0]=i;regions[i]=id;sizes[id]=0;resources[id]=false;
    for(let head=0;head<tail;head++){at=queue[head];sizes[id]++;if(s.minerals[at]>0)resources[id]=true;neighbors(at,flood);}
  }
  const main=regions[cell(s,start.x,start.y)],needed=new Set();
  for(let id=1;id<=count;id++)if(id!==main&&(sizes[id]>=30||resources[id]))needed.add(id);
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

export function generateMap(s){
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
  const centers=[],scatterRng={rng:hash(`${s.seed}:mineral-scatter`)},treeRng={rng:hash(`${s.seed}:trees`)};
  const access=(a,b)=>{const steps=Math.max(1,Math.ceil(distance(a,b)*2));for(let i=0;i<=steps;i++)clear(a.x+(b.x-a.x)*i/steps,a.y+(b.y-a.y)*i/steps,.95);};
  const field=(a,type)=>{
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
    centers.push(a,b);
    for(const p of offsets){
      const x=a.x+p.x,y=a.y+p.y,i=y*W+x,amount=(320+Math.floor(random(scatterRng)*300))*(type===3?2:1);
      access(a,{x,y});s.minerals[i]=s.minerals[N-1-i]=amount;s.mineralTypes[i]=s.mineralTypes[N-1-i]=type;
    }
  };
  // Safe mint starter fields, a blue natural expansion, and richer exposed central red reserves.
  field({x:start.x+8,y:start.y+1},1);field({x:start.x,y:start.y+9},1);
  const near={x:start.x-7,y:start.y-14};field(near,2);
  const central={x:Math.round(W*.43),y:Math.round(H*.46)};field(central,3);
  const flank={x:Math.round(W*.39),y:Math.round(H*(s.mapProfile==='highlands'?.76:.70))};field(flank,s.mapProfile==='basin'?2:3);
  const resourceRng={rng:hash(`${s.seed}:fields:${s.mapProfile}`)},targetPairs=Math.max(5,Math.round(4+N/2400));
  for(let attempt=0;centers.length<targetPairs*2&&attempt<1600;attempt++){
    const a={x:6+Math.floor(random(resourceRng)*(W/2-12)),y:6+Math.floor(random(resourceRng)*(H-12))},b={x:W-1-a.x,y:H-1-a.y};
    if([a,b].some(p=>distance(p,start)<20||distance(p,end)<20||centers.some(c=>distance(c,p)<10))||distance(a,b)<10)continue;
    const contested=Math.abs(a.x-W/2)<W*.18&&distance(a,start)>W*.26;
    field(a,contested?3:2);
  }
  mineralBowls(s,centers);
  breachPockets(s,clear);
  addLavaPools(s);
  // Each mirrored pair is isolated by an open neighbor ring, so roots cannot close a route.
  for(let i=W+1;i<N/2;i++){
    const x=i%W,y=Math.floor(i/W),mx=W-1-x,my=H-1-y,m=N-1-i;
    if(x<1||x>=W-1||random(treeRng)>rules.trees||protectedGround[i]||protectedGround[m]||Math.abs(x-mx)<3&&Math.abs(y-my)<3)continue;
    let open=true;
    for(const at of [i,m])for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const p=at+dy*W+dx;if(![0,2,5].includes(s.terrain[p])||s.minerals[p]>0)open=false;}
    if(open)mirroredTerrain(s,i,4);
  }
  addCraters(s,protectedGround,centers);
}

// Craters offer exposed firing positions beside the main approaches. They never overwrite a route,
// resource bowl, base clearing, tree root or rock obstacle, so cover cannot close a guaranteed path.
function addCraters(s,protectedGround,fields){
  const {width:W,height:H}=s,N=W*H;if(N<8000)return;
  const rng={rng:hash(`${s.seed}:craters:${s.mapProfile}`)},k=hash(`${s.seed}:crater-rims`),{start,end}=mapLayout(s);
  const dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy),target=Math.round((s.mapProfile==='highlands'?5:s.mapProfile==='basin'?3:4)*Math.sqrt(N/(72*56))),centers=[];
  for(let attempt=0;centers.length<target&&attempt<target*90;attempt++){
    const c={x:7+Math.floor(random(rng)*(W-14)),y:7+Math.floor(random(rng)*(H/2-14))},r=2.8+random(rng)*2.1,m={x:W-1-c.x,y:H-1-c.y};
    const routeDistance=Math.abs(-dy*(c.x-start.x)+dx*(c.y-start.y))/length;
    if(routeDistance>Math.min(W,H)*.3||distance(c,m)<r*2+4||[c,m].some(p=>[start,end].some(base=>distance(p,base)<r+18)||fields.some(field=>distance(p,field)<r+6)||centers.some(other=>distance(p,other)<r+7)))continue;
    const cells=[];let available=true;
    for(let y=Math.floor(c.y-r-1);y<=c.y+r+1;y++)for(let x=Math.floor(c.x-r-1);x<=c.x+r+1;x++){
      const edge=r+(vnoise(x/3,y/3,k)-.5)*.6;
      if(sq(x-c.x)+sq((y-c.y)/.83)>edge*edge)continue;
      const i=y*W+x;
      if(!inside(s,x,y)||protectedGround[i]||![0,2].includes(s.terrain[i])||s.minerals[i]>0){available=false;break;}
      cells.push(i);
    }
    if(!available||cells.length<16)continue;
    centers.push(c);for(const i of cells)mirroredTerrain(s,i,5);
  }
}

function addLavaPools(s){
  const {width:W,height:H}=s,N=W*H,{start:base,end}=mapLayout(s),dx=end.x-base.x,dy=end.y-base.y,rules=terrainProfile(s);
  // Recolor complete, compact formations; shorelines cannot obstruct an existing route.
  const visited=new Uint8Array(N),pools=[],lavaRng={rng:hash(`${s.seed}:lava:${s.mapProfile}`)};
  for(let start=0;start<N;start++){
    if(visited[start]||s.terrain[start]!==1)continue;
    const tiles=[start];visited[start]=1;let minX=W,maxX=0,minY=H,maxY=0,maxAt=start;
    for(let head=0;head<tiles.length;head++){
      const at=tiles[head],x=at%W,y=Math.floor(at/W);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);maxAt=Math.max(maxAt,at);
      for(const next of [x>0?at-1:-1,x<W-1?at+1:-1,y>0?at-W:-1,y<H-1?at+W:-1])if(next>=0&&!visited[next]&&s.terrain[next]===1){visited[next]=1;tiles.push(next);}
    }
    // Only select one member of a mirror pair, and keep long ridge walls as raised rock.
    if(start>N-1-maxAt||tiles.length<12||tiles.length>220||minX<3||maxX>=W-3||minY<3||maxY>=H-3||tiles.length/((maxX-minX+1)*(maxY-minY+1))<.38)continue;
    const x=(minX+maxX)/2,y=(minY+maxY)/2,routeDistance=Math.abs(-dy*(x-base.x)+dx*(y-base.y))/Math.hypot(dx,dy);
    pools.push({tiles,score:Math.max(0,routeDistance-7)+random(lavaRng)*14});
  }
  pools.sort((a,b)=>a.score-b.score||a.tiles[0]-b.tiles[0]);
  const count=Math.round(rules.lava*Math.sqrt(N/(72*56)));
  for(const pool of pools.slice(0,count))for(const at of pool.tiles)mirroredTerrain(s,at,3);
}
