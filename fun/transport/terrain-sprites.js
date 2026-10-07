// Small, transparent habitat sprites scattered over the painted terrain tiles.
function rect(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(x,y,w,h);}
function oval(c,x,y,rx,ry,color){c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill();}
function line(c,points,color,width=.7){c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
function poly(c,points,color){c.fillStyle=color;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();}
export const BIOME_NATURE = Object.freeze({
  taiga: { trees:['pine','spruce','fir','birch','oak','aspen','deadwood'], mountains:['granite-ridge','wooded-foothill','granite-peak'], plants:['wildflowers','bluebells','ferns','grass-tufts','berry-bushes','heather','shrubs','reeds','marsh'] },
  tundra: { trees:['pine','larch','dwarf-birch','dwarf-pine','deadwood'], mountains:['ice-peak','glacier','frost-ridge'], plants:['arctic-poppies','cotton-grass','heather','lichen','willow-scrub','tundra-grass','shrubs','reeds','marsh'] },
  desert: { trees:['palm','acacia','joshua','tamarisk','deadwood'], mountains:['mesa','butte','canyon'], plants:['cactus','agave','prickly-pear','aloe','desert-flowers','dry-grass','scrub','reeds'] },
});
const aliases={meadow:'wildflowers',flowers:'wildflowers',heath:'heather',wetland:'marsh','red-sand':'canyon',salt:'saltflat',gravel:'glacial',powder:'snow',scree:'glacial',cliff:'canyon',boulders:'glacial',ridge:'glacial',peak:'snow',shore:'reeds'};
export function normalizedDetail(detail){return aliases[detail]||detail;}
export const PLANT_DETAILS = new Set([...Object.values(BIOME_NATURE).flatMap(nature=>nature.plants),'deadwood']);
export const isPlantDetail = detail => PLANT_DETAILS.has(normalizedDetail(detail));
// Geometry and surface texture have separate local streams. A zoom profile can
// omit tiny texture marks without moving any plant, branch or dune crest.
function randomStream(seed){let a=seed>>>0;return()=>{a+=0x6d2b79f5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const TAU=Math.PI*2;
function outline(c,points){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();}
function jagged(g,x,y,rx,ry,points=13){return Array.from({length:points},(_,i)=>{const a=(i+g()*.35)*TAU/points,k=.72+g()*.34;return[x+Math.cos(a)*rx*k,y+Math.sin(a)*ry*k];});}
function patch(c,g,t,x,y,rx,ry,palette,regional){
  const points=jagged(g,x,y,rx,ry,11+Math.floor(g()*5));
  poly(c,points.map(([px,py])=>[px+.8,py+.9]),'#45523d24');poly(c,points,palette[0]);
  poly(c,points.map(([px,py])=>[x+(px-x)*.84-.45,y+(py-y)*.72-.45]),palette[1]);
  c.save();outline(c,points);c.clip();
  if(!regional)for(let i=0;i<19;i++){
    const px=x+(t()-.5)*rx*2,py=y+(t()-.5)*ry*2,len=.35+t()*.65;
    line(c,[[px-len,py+.15],[px+len*.4,py-.45]],i%3?palette[2]:palette[0],.38+t()*.3);
  }
  c.restore();return points;
}
function clusters(g,min,max,spread=5){
  const count=min+Math.floor(g()*(max-min+1)),centers=Array.from({length:g()<.55?1:2},()=>({x:9+g()*14,y:12+g()*13}));
  return Array.from({length:count},(_,i)=>{const center=centers[i%centers.length];return{x:clamp(center.x+(g()+g()-1)*spread,5,27),y:clamp(center.y+(g()+g()-1)*spread,9,28),s:.65+g()*.7};}).sort((a,b)=>a.y-b.y);
}
function foliage(biome){return biome==='desert'?['#788060','#98a078','#bdc098']:biome==='tundra'?['#7e9180','#a2b19a','#c9ceb0']:['#58754e','#7f975f','#b1bb83'];}
function stone(c,g,t,plant,biome,regional){
  const {x,y,s}=plant,w=(2+g()*2.5)*s,h=w*(.45+g()*.4),left=.5+g()*.25;
  const colors=biome==='desert'?['#96826c','#baa488','#d9c29e']:['#829388','#adbbae','#d2d9c4'];
  const pts=[[x-w*.9,y],[x-w,y-h*.45],[x-w*left,y-h],[x+w*.24,y-h*(.87+g()*.2)],[x+w*.9,y-h*.38],[x+w*.76,y+.3]];
  poly(c,pts.map(([px,py])=>[px+.7,py+.6]),'#4c594222');poly(c,pts,colors[0]);
  poly(c,[pts[0],pts[1],pts[2],pts[3],[x+w*.05,y-h*.3],[x-w*.3,y]],colors[1]);
  poly(c,[pts[1],pts[2],pts[3],[x+w*.1,y-h*.57],[x-w*.56,y-h*.4]],colors[2]);
  if(!regional){c.save();outline(c,pts);c.clip();for(let i=0;i<12;i++)rect(c,x+(t()-.5)*w*2,y-t()*h,.4+t()*.6,.35,i%3?'#edf0d359':'#586d5b40');c.restore();line(c,[[x-w*.1,y-h*.76],[x-w*.21,y-h*.3],[x+w*.2,y]],colors[0],.4);}
}
// Sparse native plants are projected from a horizontal ground plane. Short,
// broad leaves expose their upper surfaces instead of forming frontal clumps.
function drawPlants(c,g,detail,biome){
  const colors=foliage(biome),dry=['dry-grass','scrub','desert-flowers'].includes(detail),flower=['wildflowers','bluebells','arctic-poppies','desert-flowers'].includes(detail);
  const count=flower?2+Math.floor(g()*3):g()<.8?1:2;
  const plants=clusters(g,count,count,7);
  for(const plant of plants){
    const {x,y}=plant,s=.48+g()*.42,turn=g()*TAU;
    const at=(u,v,z=0)=>[x+(u-v)*s,y+(u+v)*s/2-z*s];
    const shape=(points,color)=>poly(c,points.map(q=>at(...q)),color);
    const stem=(points,color=colors[0],width=.48)=>line(c,points.map(q=>at(...q)),color,width*s);
    const leaf=(u,v,z,a,length,width,color)=>{
      const dx=Math.cos(a)*length,dy=Math.sin(a)*length,nx=-Math.sin(a)*width,ny=Math.cos(a)*width;
      shape([[u,v,z],[u+dx*.48+nx,v+dy*.48+ny,z+length*.15],[u+dx,v+dy,z-length*.06],[u+dx*.5-nx,v+dy*.5-ny,z+length*.05]],color);
    };
    const crown=(u,v,z,radius)=>{
      const ring=Array.from({length:6},(_,i)=>{const a=i*TAU/6;return[u+Math.cos(a)*radius,v+Math.sin(a)*radius,z];});
      shape(ring.map(([a,b,h])=>[a,b,h-.65]),colors[0]);
      shape(ring,colors[1]);shape([[u-radius*.9,v,z],[u-radius*.5,v-radius*.85,z],[u+radius*.5,v-radius*.85,z],[u,v,z+.35]],colors[2]);
    };
    const column=(u,v,z,width,depth,height,color=colors[1])=>{
      shape([[u-width,v-depth,z],[u+width,v-depth,z],[u+width,v-depth,z+height],[u-width,v-depth,z+height]],color);
      shape([[u+width,v-depth,z],[u+width,v+depth,z],[u+width,v+depth,z+height],[u+width,v-depth,z+height]],colors[0]);
      shape([[u-width,v+depth,z],[u+width,v+depth,z],[u+width,v+depth,z+height],[u-width,v+depth,z+height]],color);
      shape([[u-width,v-depth,z+height],[u+width,v-depth,z+height],[u+width,v+depth,z+height],[u-width,v+depth,z+height]],colors[2]);
    };
    shape([[-1.4,-.9],[1.6,-.5],[2.3,1],[-.4,1.4]],'#304a3624');
    if(flower){
      const z=detail==='bluebells'?2.5:1.7;stem([[0,0],[.12,.03,z]],dry?'#a28e65':colors[0]);
      leaf(0,0,.35,turn,1.7,.42,colors[1]);leaf(0,0,.4,turn+Math.PI,1.3,.35,colors[2]);
      const color=detail==='bluebells'?'#a2a5bb':detail==='arctic-poppies'?'#d4bd7e':detail==='desert-flowers'?'#c79a88':g()<.5?'#d4cfb0':'#bca3a6';
      shape([[-.65,0,z],[0,-.65,z+.15],[.65,0,z],[0,.65,z-.15]],color);
    }else if(['grass-tufts','tundra-grass','dry-grass','cotton-grass','reeds','marsh'].includes(detail)){
      const tall=detail==='reeds'||detail==='marsh',z=tall?3.4:1.4,n=tall?3:4;
      if(detail==='marsh')shape([[-2.5,0],[0,-2],[2.5,0],[0,2]],'#71988b3a');
      for(let i=0;i<n;i++){
        const a=turn+i*TAU/n,len=1.8+g()*1.5,u=Math.cos(a)*.6,v=Math.sin(a)*.6;
        if(tall){stem([[u,v],[u+.15,v-.1,z]],colors[0],.62);leaf(u,v,z*.5,a,len,.36,colors[i%3]);}
        else leaf(0,0,z*.45,a,len,.35,dry?['#9e8962','#c5ae7d','#dbca9f'][i%3]:colors[i%3]);
        if(detail==='cotton-grass')shape([[u-.4,v,z],[u,v-.4,z+.25],[u+.4,v,z],[u,v+.4,z]],'#e4e3c9');
      }
    }else if(['ferns','agave','aloe'].includes(detail)){
      const count=detail==='ferns'?6:7,radius=detail==='ferns'?3.8:3.2;
      for(let i=0;i<count;i++){
        const a=turn+i*TAU/count;leaf(0,0,.75,a,radius,.55,colors[(i+1)%3]);
        if(detail==='ferns')for(const t of [.45,.7]){const u=Math.cos(a)*radius*t,v=Math.sin(a)*radius*t;leaf(u,v,1,a+.85,1.25*(1-t),.3,colors[2]);leaf(u,v,1,a-.85,1.25*(1-t),.3,colors[1]);}
      }
    }else if(detail==='cactus'){
      const height=2.5+g()*3.2;column(0,0,0,.58,.5,height);
      const a=turn,u=Math.cos(a)*1.3,v=Math.sin(a)*1.3;
      stem([[0,0,height*.4],[u,v,height*.4]],colors[1],1);column(u,v,height*.4,.38,.35,height*.3);
    }else if(detail==='prickly-pear'){
      column(0,0,0,.55,.22,1.6);column(-.6,.6,.9,.68,.2,1.5);column(.6,-.45,1.4,.55,.2,1.3);
    }else if(detail==='lichen'){
      shape([[-2.6,0],[-.8,-1.8],[2.5,-.6],[2.2,1.2],[-1,1.5]],'#b9c3a17a');
      shape([[-1.7,0],[-.5,-.9],[1.3,-.4],[.7,.7]],'#d7d7b798');
    }else{
      stem([[0,0],[0,0,1.8]],dry?'#a28e65':colors[0]);crown(-.55,-.2,1.55,1.8);crown(.8,.45,1.2,1.5);
      if(detail==='heather'||detail==='berry-bushes')shape([[-.8,-.4,1.7],[-.2,-.8,1.7],[.6,-.4,1.7],[0,.15,1.7]],detail==='heather'?'#b2a0ac':'#ab8774');
    }
  }
}
export function drawTerrainDetail(c,rawDetail,r,biome,detailLevel='town'){
  const regional=detailLevel==='region',detail=normalizedDetail(rawDetail);
  const g=randomStream(Math.floor(r()*4294967296)),t=randomStream(Math.floor(r()*4294967296));
  c.save();c.beginPath();c.rect(0,0,32,32);c.clip();
  if(isPlantDetail(detail)&&detail!=='deadwood')drawPlants(c,g,detail,biome);
  else if(detail==='glacial'){
    for(const plant of clusters(g,2,5,8))stone(c,g,t,plant,biome,regional);
  }else if(detail==='ice'){
    for(const {x,y,s}of clusters(g,1,2,7)){
      const points=jagged(g,x,y,Math.min(8*s,x-1,31-x),Math.min(5*s,y-1,31-y),8);poly(c,points,'#88ada955');poly(c,points.map(([px,py])=>[x+(px-x)*.87-.4,y+(py-y)*.8-.6]),'#d0dfd075');
      const cracks=3+Math.floor(g()*3);for(let i=0;i<cracks;i++){const a=g()*TAU,len=(2+g()*4)*s,bend=(g()-.5)*2;line(c,[[x+Math.cos(a)*len,y+Math.sin(a)*len*.6],[x+bend,y+.3],[x+bend+1.2,y+2.7*s]],i%2?'#759b9b70':'#eef0d9a0',regional?.7:.5);}
    }
  }else if(detail==='snow'){
    for(const {x,y,s}of clusters(g,1,4,8)){
      const length=(4+g()*3)*s,angle=(g()-.5)*.7;c.save();c.translate(x,y);c.rotate(angle);
      c.fillStyle='#98ad9a20';c.beginPath();c.moveTo(-length,1);c.quadraticCurveTo(-length*.2,-2,length,0);c.quadraticCurveTo(length*.4,2,-length,1);c.fill();
      c.fillStyle='#f2f2de79';c.beginPath();c.moveTo(-length,-.1);c.quadraticCurveTo(0,-3.2*s,length,.1);c.quadraticCurveTo(0,.65,-length,-.1);c.fill();c.restore();
    }
  }else if(detail==='dunes'){
    const count=1+Math.floor(g()*3),direction=(g()-.5)*.9;
    for(let i=0;i<count;i++){
      const x=14+g()*4,y=11+g()*9,len=6+g()*7,height=1+g()*2,angle=direction+(g()-.5)*.3;
      c.save();c.translate(x,y);c.rotate(angle);
      c.fillStyle='#a78b5c20';c.beginPath();c.moveTo(-len,2);c.bezierCurveTo(-len*.55,-height,len*.24,-height*1.4,len,1);c.bezierCurveTo(len*.37,height*2,-len*.3,height,-len,2);c.fill();
      c.fillStyle='#e4cca05e';c.beginPath();c.moveTo(-len,1.5);c.bezierCurveTo(-len*.5,-height-.5,len*.25,-height,len,1);c.bezierCurveTo(len*.15,-height*.25,-len*.4,0,-len,1.5);c.fill();
      c.strokeStyle='#eed7aa86';c.lineWidth=.55;c.beginPath();c.moveTo(-len*.83,.5);c.bezierCurveTo(-len*.42,-height,len*.24,-height*.9,len*.82,.35);c.stroke();
      if(!regional)for(let j=0;j<12;j++){const px=(t()-.5)*len*1.7,py=t()*height;rect(c,px,py,.35+t()*.65,.25,'#bea37439');}
      c.restore();
    }
  }else if(detail==='saltflat'){
    const x=10+g()*12,y=10+g()*12;patch(c,g,t,x,y,9,6,['#c8b99335','#e6ddbd59','#f4e7c485'],regional);
    const nodes=Array.from({length:4+Math.floor(g()*4)},()=>[5+g()*22,5+g()*22]);
    for(let i=1;i<nodes.length;i++){
      const [ax,ay]=nodes[i-1],[bx,by]=nodes[i],mx=(ax+bx)/2+(g()-.5)*3,my=(ay+by)/2+(g()-.5)*3;
      line(c,[[ax,ay],[mx,my],[bx,by]],'#a3977852',regional?.55:.4);
      line(c,[[mx,my],[mx+(g()-.5)*5,my+(g()-.5)*5]],'#baa98a48',.35);
    }
  }else if(detail==='canyon'){
    for(const {x,y,s}of clusters(g,1,3,8)){
      const points=jagged(g,x,y,5*s,3.4*s,7);poly(c,points,'#9b806057');
      poly(c,points.map(([px,py])=>[x+(px-x)*.86-.6,y+(py-y)*.67-.65]),'#d5b18877');
      for(let j=0;j<3;j++){const xx=x-3*s+g(),yy=y-1.5*s+j*1.2*s;line(c,[[xx,yy],[x-.5,yy-.4],[x+3*s,yy-.1]],j%2?'#9879595e':'#e0bf9678',.55);}
    }
  }else if(detail==='deadwood'){
    const x=10+g()*12,y=13+g()*11,len=8+g()*9,a=(g()-.5)*1.8,dx=Math.cos(a)*len/2,dy=Math.sin(a)*len*.35,bend=(g()-.5)*2;
    line(c,[[x-dx+.7,y-dy+.8],[x+bend+.7,y+.8],[x+dx+.7,y+dy+.8]],'#5e634432',3);
    line(c,[[x-dx,y-dy],[x+bend,y],[x+dx,y+dy]],'#776e54',2.35);
    line(c,[[x-dx,y-dy-.6],[x+bend,y-.6],[x+dx,y+dy-.6]],'#b3a182',.8);
    const branches=2+Math.floor(g()*3);for(let i=0;i<branches;i++){
      const u=.2+g()*.6,px=x-dx+dx*2*u,py=y-dy+dy*2*u,side=i%2?-1:1,reach=2+g()*2;
      line(c,[[px,py],[px+Math.sin(a)*reach*side,py-Math.cos(a)*reach*side],[px+Math.sin(a)*reach*side+1,py-Math.cos(a)*reach*side-.8]],'#897d61',.6);
    }
    oval(c,x-dx,y-dy,.75,1,'#c4b395');if(!regional)line(c,[[x-dx+2,y-dy-.2],[x+bend,y-.3],[x+dx-1,y+dy-.15]],'#584f3e65',.35);
  }
  c.restore();
}
