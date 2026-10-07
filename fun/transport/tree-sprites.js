// Stable woodland compositions: the same trunks and crowns at every zoom.
// The renderer varies the seed per tile; none of this changes simulation state.
const TAU = Math.PI * 2;
function random(seed) { let a=seed>>>0;return()=>{a+=0x6d2b79f5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}; }
function hash(text) { let h=2166136261;for(const ch of text)h=Math.imul(h^ch.charCodeAt(0),16777619);return h>>>0; }
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const palette={
  pine:['#29493d','#3f6550','#648365','#8fa079'], spruce:['#2c4945','#40685b','#698877','#93a58b'],
  fir:['#294c43','#4b705b','#769477','#a0ad83'], larch:['#635f3d','#929250','#b4ad68','#d0c78c'],
  oak:['#3c5938','#63804a','#899954','#b0b576'], birch:['#47664b','#7c975f','#a0ae75','#c5c893'],
  aspen:['#566544','#859956','#a5b76e','#cbce97'], 'dwarf-birch':['#66745b','#8e9a74','#b3ba91','#d0d1a9'],
  'dwarf-pine':['#405c53','#627d6b','#8c9c7c','#b0b699'],
  acacia:['#576648','#7b8956','#a0a477','#c1bc8b'], palm:['#405f48','#698753','#95a56c','#bdc18b'],
  joshua:['#61745a','#829370','#a4ae84','#c6caa0'], tamarisk:['#667b69','#8fa58b','#b1bca0','#cecdb0'],
};
const pools={taiga:['pine','spruce','fir','birch','oak','aspen'],tundra:['pine','larch','dwarf-birch','dwarf-pine'],desert:['palm','acacia','joshua','tamarisk']};
const leafSpecies=new Set(['oak','birch','aspen','dwarf-birch','larch','acacia','tamarisk']);

export function forestComposition(biome='taiga',detail='',variant=0) {
  const v=((Math.floor(variant)||0)%64+64)%64,seed=hash(`${biome}:${detail}`)^Math.imul(v+1,2654435761),r=random(seed),pool=pools[biome]||pools.taiga;
  const primary=palette[detail]?detail:detail==='broadleaf'?(biome==='desert'?'acacia':'oak'):pool[Math.floor(r()*pool.length)];
  const count=detail==='sparse'?1+v%2:detail==='dense'?3+v%3:1+v%5;
  const mixed=v%4===2||v%7===3||detail==='mixed',bareStand=detail==='deadwood'||v%17===11;
  const rotation=r()*TAU,centerX=8+r()*16,centerY=9+r()*18,trees=[];
  for(let i=0;i<count;i++) {
    const species=mixed&&i>0?pool[(pool.indexOf(primary)+i+Math.floor(r()*2)+1)%pool.length]:primary;
    const juvenile=count>2&&r()<.35,base=count===1?23:count===2?21:19;
    const size=base*(juvenile?.44+r()*.2:.72+r()*.36)*(species.startsWith('dwarf')?.8:1);
    const angle=rotation+i*2.399963,spread=count===1?0:count===2?6:7+2*r();
    const spreadX=Math.cos(angle)*spread+(r()-.5)*3,spreadY=Math.sin(angle)*spread*.62+(r()-.5)*3;
    const crownWidth={oak:.78,birch:.62,aspen:.54,'dwarf-birch':.62,pine:.61,'dwarf-pine':.75,palm:.66,acacia:.69,tamarisk:.55};
    const width=size*(crownWidth[species]||.45);
    // Crowns can overhang eight pixels into adjacent cells, like real woodland.
    const x=clamp(centerX+spreadX,Math.max(2,width-6.8),Math.min(30,38.8-width)),y=clamp(centerY+spreadY,size*1.1-14.5,27.8);
    trees.push({x,y,size,species,bare:bareStand||(leafSpecies.has(species)&&r()<.15),seed:Math.floor(r()*4294967296)});
  }
  return trees.sort((a,b)=>a.y-b.y);
}
// All native foliage is modeled in a horizontal u/v plane and projected with
// the same 2:1 ground axes as the buildings. Crowns hide upper trunks naturally.
const point=(u,v,z=0)=>[u-v,(u+v)/2-z];
function path(c,points,color,width=1){c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
function polygon(c,points,color){c.fillStyle=color;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();}
function branch(c,points,white,width){const p=points.map(q=>point(...q));path(c,p,white?'#63705e':'#4b5642',width);path(c,p.map(([x,y])=>[x-width*.18,y-width*.1]),white?'#c8c9ad':'#9e9671',width*.48);}
// An upper octagon and four visible side facets give a broad crown a real top.
// There is no frontal disc, central black outline or decorative leaf noise.
function canopy(c,u,v,z,radius,depth,colors,turn=0){
  const count=8,ring=Array.from({length:count},(_,i)=>{const a=turn+i/count*TAU;return[u+Math.cos(a)*radius,v+Math.sin(a)*radius,z];});
  const upper=ring.map(([x,y])=>[u+(x-u)*.65,v+(y-v)*.65,z+depth]);
  const low=ring.map(([x,y])=>[u+(x-u)*.84,v+(y-v)*.84,z-depth*.42]);
  for(let i=0;i<count;i++){
    const j=(i+1)%count,a=ring[i],b=ring[j];if(a[0]+a[1]+b[0]+b[1]<2*(u+v))continue;
    polygon(c,[point(...a),point(...b),point(...low[j]),point(...low[i])],i<count/2?colors[0]:colors[1]);
  }
  for(let i=0;i<count;i++){
    const j=(i+1)%count,a=ring[i],b=ring[j],lit=(a[0]+b[0])-(a[1]+b[1])<2*(u-v);
    polygon(c,[point(...a),point(...b),point(...upper[j]),point(...upper[i])],lit?colors[2]:colors[1]);
  }
  polygon(c,upper.map(q=>point(...q)),colors[2]);
  polygon(c,[point(u-radius*.22,v-radius*.26,z+depth*.99),point(...upper[4]),point(...upper[5]),point(...upper[6])],colors[3]);
}
function bareTree(c,tree,r){
  const h=tree.size*.82,white=/birch|aspen/.test(tree.species),turn=r()*TAU;
  branch(c,[[0,0,0],[h*.025,0,h*.46],[0,-h*.025,h]],white,h*.054);
  for(let i=0;i<5;i++){
    const a=turn+i*TAU/5,reach=h*(.2+r()*.08),z=h*(.4+i*.08),u=Math.cos(a)*reach,v=Math.sin(a)*reach;
    branch(c,[[0,0,z],[u*.55,v*.55,z+h*.08],[u,v,z+h*.19]],white,h*.024);
    branch(c,[[u*.55,v*.55,z+h*.08],[u*.62-v*.3,v*.62+u*.3,z+h*.23]],white,h*.013);
  }
}
function broadleaf(c,tree,r,colors){
  const h=tree.size,white=/birch|aspen/.test(tree.species),wide=tree.species==='oak'?1.1:tree.species==='aspen'?.72:1,turn=r()*TAU,nodes=[];
  branch(c,[[0,0,0],[h*.015,-h*.02,h*.5],[0,0,h*.82]],white,h*.058);
  for(let i=0;i<3;i++){
    const a=turn+i*TAU/3,u=Math.cos(a)*h*.15*wide,v=Math.sin(a)*h*.15*wide,z=h*(.57+r()*.08),radius=h*(.21+r()*.035)*wide;
    branch(c,[[0,0,h*.32],[u*.75,v*.75,z*.9],[u,v,z]],white,h*.028);
    nodes.push({u,v,z,radius,depth:h*.1});
  }
  nodes.push({u:-h*.015,v:-h*.02,z:h*.79,radius:h*.22*wide,depth:h*.11});
  nodes.sort((a,b)=>a.u+a.v-b.u-b.v||a.z-b.z);
  for(const node of nodes)canopy(c,node.u,node.v,node.z,node.radius,node.depth,colors,turn);
}
function evergreen(c,tree,r,colors){
  const h=tree.size,pine=/pine/.test(tree.species),dwarf=tree.species==='dwarf-pine',turn=r()*TAU;
  branch(c,[[0,0,0],[h*.025,0,h*.4],[0,0,h*.9]],false,h*.052);
  if(pine){
    const nodes=[];
    for(let i=0;i<3;i++){
      const a=turn+i*TAU/3,u=Math.cos(a)*h*(dwarf?.18:.14),v=Math.sin(a)*h*(dwarf?.18:.14),z=h*(.52+i*.095),radius=h*(dwarf?.21:.19);
      branch(c,[[0,0,z*.55],[u,v,z]],false,h*.025);nodes.push({u,v,z,radius});
    }
    nodes.sort((a,b)=>a.u+a.v-b.u-b.v);for(const n of nodes)canopy(c,n.u,n.v,n.z,n.radius,h*.075,colors,turn);
    canopy(c,0,0,h*.89,h*.16,h*.08,colors,turn);
  }else{
    // Horizontal diamond tiers show their lit upper planes. Lower tiers remain
    // broad enough to read as a conifer crown instead of a flat green triangle.
    const width=h*(tree.species==='spruce'?.23:tree.species==='larch'?.3:.27);
    for(let i=0;i<4;i++){
      const t=i/4,z=h*(.2+t*.67),radius=width*(1-t*.79),tip=point(0,0,z+h*(.3-t*.1));
      const corners=[point(-radius,0,z),point(0,-radius,z),point(radius,0,z),point(0,radius,z)];
      polygon(c,[corners[0],corners[1],tip],colors[2]);polygon(c,[corners[1],corners[2],tip],colors[1]);
      polygon(c,[corners[2],corners[3],tip],colors[0]);polygon(c,[corners[3],corners[0],tip],colors[1]);
      polygon(c,[corners[0],point(-radius*.3,0,z+h*.2),tip],colors[3]);
    }
  }
}
function rosette(c,u,v,z,radius,colors,turn,count=7){
  for(let i=0;i<count;i++){
    const a=turn+i*TAU/count,dx=Math.cos(a)*radius,dy=Math.sin(a)*radius,nx=-Math.sin(a)*radius*.11,ny=Math.cos(a)*radius*.11;
    polygon(c,[point(u,v,z),point(u+dx*.46+nx,v+dy*.46+ny,z+radius*.12),point(u+dx,v+dy,z-radius*.16),point(u+dx*.48-nx,v+dy*.48-ny,z+radius*.06)],Math.cos(a)-Math.sin(a)<0?colors[2]:colors[1]);
    path(c,[point(u,v,z),point(u+dx*.5,v+dy*.5,z+radius*.12),point(u+dx,v+dy,z-radius*.16)],colors[3],.36);
  }
}
function aridTree(c,tree,r,colors){
  const h=tree.size,turn=r()*TAU;
  if(tree.species==='palm'){
    const u=h*.06,v=-h*.03,z=h*.73;branch(c,[[0,0,0],[u*.3,v*.3,h*.37],[u,v,z]],false,h*.063);rosette(c,u,v,z,h*.32,colors,turn,8);
    canopy(c,u,v,z,.9,.45,colors,turn);
  }else if(tree.species==='joshua'){
    branch(c,[[0,0,0],[0,0,h*.6]],false,h*.075);
    for(let i=0;i<3;i++){const a=turn+i*TAU/3,u=Math.cos(a)*h*.17,v=Math.sin(a)*h*.17,z=h*(.52+i*.1);branch(c,[[0,0,h*.3],[u,v,h*.4],[u,v,z]],false,h*.045);rosette(c,u,v,z,h*.15,colors,turn+i,9);}
  }else if(tree.species==='acacia'){
    branch(c,[[0,0,0],[h*.035,0,h*.4],[0,0,h*.64]],false,h*.066);
    const nodes=[];for(let i=0;i<3;i++){const a=turn+i*TAU/3,u=Math.cos(a)*h*.18,v=Math.sin(a)*h*.18;branch(c,[[0,0,h*.32],[u,v,h*.64]],false,h*.027);nodes.push({u,v});}
    nodes.sort((a,b)=>a.u+a.v-b.u-b.v);for(const n of nodes)canopy(c,n.u,n.v,h*.65,h*.24,h*.065,colors,turn);
  }else broadleaf(c,{...tree,size:h*.8},r,colors);
}
export function drawTree(c,tree,biome='taiga',profile='town'){
  const r=random(tree.seed),colors=palette[tree.species]||palette.pine,h=tree.size;
  c.save();c.translate(tree.x,tree.y);
  // A subdued ground-plane shadow projects toward the southeast. This does
  // not alter composition or the generated-sprite shadow placement contract.
  polygon(c,[point(-h*.13,0),point(0,-h*.13),point(h*.25,h*.03),point(h*.22,h*.1),point(0,h*.12)],'#283e302b');
  if(tree.bare)bareTree(c,tree,r);else if(biome==='desert')aridTree(c,tree,r,colors);else if(['pine','spruce','fir','larch','dwarf-pine'].includes(tree.species))evergreen(c,tree,r,colors);else broadleaf(c,tree,r,colors);
  c.restore();
}
export function drawForest(c,biome,detail,variant,profile='town'){
  for(const tree of forestComposition(biome,detail,variant))drawTree(c,tree,biome,profile);
}
