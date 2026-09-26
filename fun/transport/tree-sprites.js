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
function path(c,points,color,width=1) {c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
function polygon(c,points,color) {c.fillStyle=color;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();}
function oval(c,x,y,rx,ry,color) {c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,TAU);c.fill();}
// Broken edges and offset light planes give crowns volume without smooth circles.
function crown(c,x,y,rx,ry,colors,r,profile,needles=false) {
  const points=[],n=needles?19:23;
  for(let i=0;i<n;i++){const a=i/n*TAU,s=.79+r()*.26;points.push([x+Math.cos(a)*rx*s,y+Math.sin(a)*ry*s]);}
  polygon(c,points,colors[0]);
  polygon(c,points.map(([px,py])=>[x+(px-x)*.87-.25,y+(py-y)*.85-.6]),colors[1]);
  const lobes=5+Math.floor(r()*3);
  for(let k=0;k<lobes;k++){
    const a=r()*TAU,rad=Math.sqrt(r())*.61,lx=x+Math.cos(a)*rx*rad-rx*.14,ly=y+Math.sin(a)*ry*rad-ry*.15,w=rx*(.22+r()*.23),h=ry*(.24+r()*.24);
    const edge=[];for(let j=0;j<7;j++){const aa=j/7*TAU,s=.72+r()*.32;edge.push([lx+Math.cos(aa)*w*s,ly+Math.sin(aa)*h*s]);}
    polygon(c,edge,colors[k%3===0?3:2]);
  }
  for(let k=0;k<22;k++){
    const a=r()*TAU,rad=Math.sqrt(r())*.82,px=x+Math.cos(a)*rx*rad,py=y+Math.sin(a)*ry*rad;
    const w=.35+r()*.8,h=.3+r()*.4,bright=r()>.43;
    if(profile==='region'&&k%5!==0)continue;
    c.globalAlpha=bright?.55:.35;
    if(needles)path(c,[[px-.65,py+.2],[px+.1,py-.6],[px+.7,py-.3]],colors[bright?3:0],profile==='region'?.65:.4);
    else{c.fillStyle=colors[bright?3:0];c.fillRect(px,py,w,h);}
    c.globalAlpha=1;
  }
}
function skeleton(c,h,w,lean,r,white,profile) {
  const trunk=white?'#c6c6a9':'#726e51',shade=white?'#626e5e':'#484f3d';
  path(c,[[0,0],[-.3,-h*.26],[lean*.42,-h*.54],[lean,-h*.86]],shade,Math.max(.8,h*.064));
  path(c,[[-.25,0],[-.6,-h*.27],[lean*.42-.3,-h*.54],[lean-.2,-h*.86]],trunk,Math.max(.48,h*.034));
  const branches=[];
  for(let i=0;i<7;i++) {
    const side=i%2?1:-1,t=.25+i*.072,y=-h*t,reach=w*(.6+r()*.4)*(i<2?.7:1),tx=lean*t+side*reach,ty=y-h*(.13+r()*.12),bend=lean*t+side*reach*.47;
    path(c,[[lean*t*.55,y+1],[bend,y-h*.05],[tx,ty]],trunk,Math.max(.4,h*.027*(1-i*.06)));
    for(let j=0;j<3;j++){
      const f=.48+j*.2,xx=bend+(tx-bend)*f,yy=y-h*.05+(ty-y+h*.05)*f;
      path(c,[[xx,yy],[xx+side*w*.12,yy-h*.09],[xx+side*w*.1,yy-h*.14]],trunk,profile==='region'?.55:.36);
    }
    branches.push({x:tx,y:ty,side});
  }
  if(white)for(let i=0;i<6;i++)path(c,[[-.4+lean*i*.055,-i*h*.12],[.4+lean*i*.055,-i*h*.12-.3]],'#626a55',.5);
  return branches;
}
function broadleaf(c,tree,r,colors,profile) {
  const h=tree.size,w=h*(tree.species==='oak'?.45:tree.species==='aspen'?.29:.34),lean=(r()-.5)*h*.19;
  const branches=skeleton(c,h,w,lean,r,/birch|aspen/.test(tree.species),profile);
  if(tree.bare)return;
  const narrow=tree.species==='aspen',nodes=branches.map((b,i)=>({x:b.x*.78,y:b.y,rx:w*(.48+r()*.2),ry:h*(narrow?.2:.17)*(1+r()*.3)}));
  nodes.push({x:lean,y:-h*.8,rx:w*.67,ry:h*.2});
  nodes.sort((a,b)=>a.y-b.y);
  for(const node of nodes)crown(c,node.x,node.y,node.rx,node.ry,colors,r,profile);
  // A short exposed fork makes the branch architecture visible through the leaves.
  path(c,[[0,-h*.15],[lean*.4,-h*.42],[-w*.25,-h*.58]],/birch|aspen/.test(tree.species)?'#bfc4a0':'#788062',profile==='region'?.6:.5);
}
function evergreen(c,tree,r,colors,profile) {
  const h=tree.size,lean=(r()-.5)*h*.14,species=tree.species;
  if(tree.bare){skeleton(c,h,h*.28,lean,r,false,profile);return;}
  path(c,[[0,1],[lean*.3,-h*.4],[lean,-h*.95]],'#5c5c45',Math.max(.8,h*.055));
  path(c,[[-.3,0],[lean*.3-.3,-h*.4]],'#9b9070',.45);
  if(species==='pine'||species==='dwarf-pine'){
    // Pines have open, crooked stems and separate windswept needle cushions.
    const dwarf=species==='dwarf-pine',w=h*(dwarf?.42:.33),n=dwarf?5:4+Math.floor(r()*3);
    for(let i=0;i<n;i++){
      const t=.36+i/n*.55,side=i%2?1:-1,x=lean*t+side*w*(.4+r()*.46),y=-h*t;
      path(c,[[lean*t*.5,y+h*.15],[x*.7,y+h*.035],[x,y-h*.02]],'#776f50',Math.max(.5,h*.025));
      crown(c,x,y,w*(.46+r()*.25),h*(.075+r()*.06),colors,r,profile,true);
    }
    crown(c,lean,-h*.91,w*.56,h*.12,colors,r,profile,true);
  }else{
    // A single irregular outline with drooping branch tips, rather than stacked triangles.
    const width=h*(species==='spruce'?.24:species==='larch'?.3:.32),tiers=6+Math.floor(r()*3),outline=[];
    for(let side=-1;side<=1;side+=2){
      const flank=[];
      for(let i=0;i<tiers;i++){
        const t=i/tiers,yy=-h*.14-h*.82*t,ww=width*(1-t)*(.77+r()*.35);
        flank.push([lean*t+side*ww,yy+h*.055],[lean*t+side*ww*.68,yy-h*.06],[lean*t+side*ww*.83,yy-h*.055]);
      }
      if(side<0)outline.push(...flank,[lean,-h]);else outline.push(...flank.reverse());
    }
    polygon(c,outline,colors[0]);
    for(let i=0;i<tiers;i++){
      const t=i/tiers,yy=-h*.18-h*.77*t,ww=width*(1-t)*(.7+r()*.22),cx=lean*t;
      const ends=[cx-ww,yy+.7,cx+ww*(.5+r()*.45),yy+1.1];
      polygon(c,[[cx,yy-h*.17],[cx-ww*.36,yy-h*.08],[ends[0],ends[1]],[cx-.2,yy-h*.025],[ends[2],ends[3]],[cx+ww*.38,yy-h*.07]],colors[1]);
      for(let j=0;j<4;j++){
        const xx=cx-ww*.8+r()*ww*1.15,by=yy-r()*h*.045;
        path(c,[[xx-ww*.16,by+.3],[xx,by-h*.065],[xx+ww*.16,by-.3]],j%3?colors[2]:colors[3],profile==='region'?.7:.5);
      }
    }
  }
}
function aridTree(c,tree,r,colors,profile) {
  const h=tree.size,w=h*.46;
  if(tree.bare){skeleton(c,h,w*.68,(r()-.5)*2,r,false,profile);return;}
  if(tree.species==='palm'){
    const lean=(r()-.5)*h*.27,top=-h*.8;
    path(c,[[0,0],[lean*.5,-h*.4],[lean,top]],'#786e50',h*.071);
    path(c,[[-.4,0],[lean*.5-.4,-h*.4],[lean-.4,top]],'#bcaa7c',h*.035);
    for(let i=1;i<8;i++){const t=i/8;path(c,[[lean*t-1,-h*.8*t],[lean*t+.4,-h*.8*t-.3]],'#655f4699',.45);}
    const n=7+Math.floor(r()*3);
    for(let i=0;i<n;i++){
      const a=i/n*TAU+r()*.24,len=w*(.65+r()*.37),dx=Math.cos(a)*len,dy=Math.sin(a)*len*.48;
      polygon(c,[[lean,top],[lean+dx*.42,top+dy*.45-h*.1],[lean+dx*.86,top+dy-h*.04],[lean+dx,top+dy+h*.12],[lean+dx*.62,top+dy*.58]],colors[i%3===0?1:2]);
      path(c,[[lean,top],[lean+dx*.6,top+dy*.5-h*.03],[lean+dx,top+dy+h*.12]],colors[3],.45);
      for(let j=2;j<6;j++){const t=j/6;path(c,[[lean+dx*t,top+dy*t-h*.03],[lean+dx*t-dy*.2,top+dy*t+h*.055]],colors[0],.42);}
    }
    oval(c,lean+.8,top+1,1,1.2,'#877958');
  }else if(tree.species==='joshua'){
    const lean=(r()-.5)*2;
    path(c,[[0,0],[lean,-h*.48],[lean-3,-h*.76]],'#8c8265',h*.1);
    path(c,[[lean,-h*.28],[h*.2,-h*.45],[h*.23,-h*.78]],'#8c8265',h*.075);
    for(const [x,y]of [[lean-3,-h*.76],[h*.23,-h*.78],[lean,-h*.48]]){
      for(let i=0;i<12;i++){const a=i/12*TAU,len=h*(.11+r()*.07);polygon(c,[[x-.6,y],[x+Math.cos(a)*len,y+Math.sin(a)*len],[x+.6,y+.3]],colors[i%3+1]);}
    }
  }else if(tree.species==='acacia'){
    const lean=(r()-.5)*h*.2;
    path(c,[[0,1],[lean,-h*.43],[-h*.21,-h*.7]],'#746e50',h*.065);
    path(c,[[lean,-h*.43],[h*.15,-h*.62],[h*.3,-h*.72]],'#746e50',h*.047);
    for(let i=0;i<5;i++){const x=(i-2)*h*.19,y=-h*.73+r()*h*.05;crown(c,x,y,h*(.17+r()*.05),h*.1,colors,r,profile);}
  }else{
    skeleton(c,h*.82,w*.67,(r()-.5)*h*.2,r,false,profile);
    for(let i=0;i<6;i++){const x=(r()-.5)*w*1.2,y=-h*(.35+r()*.44);crown(c,x,y,h*.2,h*.19,colors,r,profile);}
  }
}
export function drawTree(c,tree,biome='taiga',profile='town') {
  const r=random(tree.seed),colors=palette[tree.species]||palette.pine;
  c.save();c.translate(tree.x,tree.y);
  const shadow=tree.size*(tree.bare?.3:.42);
  oval(c,1.7,1.2,shadow,Math.max(1,tree.size*.085),'#283e302b');
  if(biome==='desert')aridTree(c,tree,r,colors,profile);
  else if(['pine','spruce','fir','larch','dwarf-pine'].includes(tree.species))evergreen(c,tree,r,colors,profile);
  else broadleaf(c,tree,r,colors,profile);
  // Broken leaf litter and small roots anchor trunks without identical base discs.
  for(let i=0;i<4;i++){
    const x=(r()-.5)*tree.size*.42,y=r()*1.6;
    if(profile!=='region'){c.fillStyle=biome==='desert'?'#a8976880':tree.bare?'#a7986580':'#8b995c70';c.fillRect(x,y,.7+r()*.6,.45);}
  }
  c.restore();
}
export function drawForest(c,biome,detail,variant,profile='town') {
  const trees=forestComposition(biome,detail,variant);
  for(const tree of trees)drawTree(c,tree,biome,profile);
}
