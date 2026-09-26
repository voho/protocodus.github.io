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
function curve(c,x,y,cx,cy,tx,ty,color,width=.65){c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.beginPath();c.moveTo(x,y);c.quadraticCurveTo(cx,cy,tx,ty);c.stroke();}
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
function shrub(c,g,t,plant,biome,detail,regional){
  const {x,y}=plant,s=Math.min(plant.s,(Math.min(x,32-x)-.5)/5.8),palette=foliage(biome),dry=detail==='scrub';
  const branches=3+Math.floor(g()*4),width=(dry?3.7:4.6)*s,height=(dry?2.5:3.5)*s;
  oval(c,x+.7,y+.6,width*.9,.85*s,'#53614620');
  const tips=[];
  for(let k=0;k<branches;k++){
    const bx=x+(g()-.5)*width*1.7,by=y-height*(.55+g()*.75);tips.push([bx,by]);
    curve(c,x+(g()-.5),y,bx+(x-bx)*.4,by+height*.4,bx,by,dry?'#91866a':'#778264',.5*s);
  }
  if(detail==='willow-scrub'){
    for(const [bx,by]of tips){
      const lean=(bx-x)*.35;
      for(let j=0;j<4;j++){const px=bx-lean*j*.15,py=by+j*.7*s;
        poly(c,[[px,py+.9],[px-1.7*s,py-.1],[px-.6*s,py-.6],[px+.8*s,py-.15]],j%2?palette[1]:palette[2]);}
    }
  }else{
    patch(c,g,t,x,y-height*.47,width,height,palette,regional);
    for(const [bx,by]of tips.slice(0,dry?2:3))patch(c,g,t,bx,by,1.2*s,.9*s,[palette[0],palette[1],palette[2]],regional);
    if(detail==='heather'||detail==='berry-bushes'){
      const buds=7+Math.floor(g()*7),flower=detail==='heather';
      for(let i=0;i<buds;i++){
        const bx=x+(g()+g()-1)*width*.9,by=y-height*.35-g()*height*.8;
        if(flower)line(c,[[bx,by+.9],[bx+.15,by-.6]],i%3?'#b3a0ad':'#cbb6bd',regional?.8:.65);
        else oval(c,bx,by,.4+g()*.22,.4,i%3?'#a88170':'#cead89');
      }
    }
  }
}
function grass(c,g,plant,detail,biome,regional){
  const {x,y,s}=plant,cotton=detail==='cotton-grass',reeds=detail==='reeds';
  const colors=detail==='dry-grass'?['#9e8962','#c5ae7d','#dbca9f']:biome==='tundra'?['#7f9684','#a9b698','#ccd1b0']:['#6b8659','#96aa74','#bfca94'];
  const count=(reeds?7:4)+Math.floor(g()*5),height=(reeds?6:3.2)*s,lean=(g()-.5)*2.5;
  oval(c,x+.4,y+.4,2.8*s,.6*s,'#5d6a4420');
  for(let i=0;i<count;i++){
    const root=x+(g()-.5)*2.7*s,dx=(g()-.5)*(reeds?4:6)*s+lean,h=Math.min(y-1.8,height*(.45+g()*.85)),tipY=y-h,stroke=.45+g()*.22;
    curve(c,root,y,root+dx*.15,tipY-.7,root+dx,tipY,colors[i%3],regional?.65:stroke);
    // Geometry randomness is consumed regardless of profile.
    const head=g(),seedSize=.5+g()*.4;
    if(cotton&&head>.53){
      const tipX=root+dx;poly(c,[[tipX-1*seedSize,tipY],[tipX-.8,tipY-1.1],[tipX+.25,tipY-1.5],[tipX+1,tipY-.7],[tipX+.6,tipY+.45]],'#e4e7cd');
      if(!regional)line(c,[[tipX-.6,tipY-.8],[tipX+.4,tipY-.5]],'#faf7e3',.5);
    }else if(reeds&&head>.59)line(c,[[root+dx,tipY-.7],[root+dx-.15,tipY+.6]],'#8a8162',.85);
    else if(detail==='dry-grass'&&head>.68)line(c,[[root+dx-.6,tipY-.25],[root+dx+.5,tipY+.4]],colors[2],.55);
  }
}
function flowers(c,g,t,detail,biome,regional){
  const palette=detail==='bluebells'?['#8c8fac','#b1a4bf','#cac0d0']:detail==='arctic-poppies'?['#ccb367','#ebd899','#ece4c0']:detail==='desert-flowers'?['#bd8f83','#d7ac94','#e4ccb0']:['#ddd8af','#b7b2ca','#cca7a0','#cfbe86'];
  const plants=clusters(g,7,14,7);
  for(const plant of plants){
    const {x,y,s}=plant,h=(detail==='bluebells'?3.5:2.3)*s,lean=(g()-.5)*2.2,topX=x+lean,topY=y-h;
    curve(c,x,y,x-.3,topY,topX,topY,biome==='desert'?'#89946d':'#718d60',regional?.65:.5);
    const leafSide=g()<.5?-1:1,leafY=y-h*.35;
    poly(c,[[x,leafY],[x+leafSide*1.7,leafY-.8],[x+leafSide*.8,leafY+.2]],'#9aad79');
    const color=palette[Math.floor(g()*palette.length)],bend=(g()-.5)*.5;
    if(detail==='bluebells'){
      poly(c,[[topX-.35,topY-.6],[topX+.65,topY-.45],[topX+1.1,topY+.9],[topX-.6,topY+.7]],color);
      if(!regional)line(c,[[topX-.35,topY+.8],[topX+.75,topY+.95]],palette[2],.45);
    }else{
      const petals=3+Math.floor(g()*3),angle=g()*TAU;
      for(let j=0;j<petals;j++){const a=angle+j*TAU/petals;oval(c,topX+Math.cos(a)*.58*s,topY+Math.sin(a)*.42*s,.54*s,.43*s,color);}
      oval(c,topX+bend,topY,.25,.23,'#aa946b');
    }
    const dustX=x+(t()-.5)*2,dustY=y+t();if(!regional)rect(c,dustX,dustY,.55,.35,'#c4c59b65');
  }
}
function fern(c,g,plant,regional){
  const {x,y}=plant,s=Math.min(plant.s,(Math.min(x,32-x)-.8)/6.7),fronds=5+Math.floor(g()*4),turn=g()*TAU;
  oval(c,x+.5,y+.6,3.8*s,1.3*s,'#53644524');
  for(let k=0;k<fronds;k++){
    const a=turn+k*TAU/fronds+(g()-.5)*.35,len=(3.7+g()*3)*s,dx=Math.cos(a)*len,dy=Math.sin(a)*len*.55-1.3*s,bend=(g()-.5)*1.8;
    curve(c,x,y,x+dx*.38+bend,y+dy*.4-.8,x+dx,y+dy,k%2?'#527c4e':'#6c915f',.6);
    const leaflets=4+Math.floor(g()*3);
    for(let j=1;j<leaflets;j++){
      const u=j/leaflets,px=x+dx*u+bend*Math.sin(u*Math.PI)*.4,py=y+dy*u-.65*Math.sin(u*Math.PI),size=(1-u)*1.5*s+.25;
      const nx=-Math.sin(a)*size,ny=Math.cos(a)*size*.65;
      poly(c,[[px-.2,py+.3],[px+nx-dx*.11,py+ny-dy*.11],[px+dx*.06,py+dy*.06]],k%2?'#789d60':'#63894f');
      poly(c,[[px+.2,py],[px-nx-dx*.09,py-ny-dy*.09],[px+dx*.08,py+dy*.08]],'#a3bc80');
    }
    if(!regional)curve(c,x,y,x+dx*.35+bend,y+dy*.35-.8,x+dx*.84,y+dy*.84,'#bdcba07d',.3);
  }
}
function stone(c,g,t,plant,biome,regional){
  const {x,y,s}=plant,w=(2+g()*2.5)*s,h=w*(.45+g()*.4),left=.5+g()*.25;
  const colors=biome==='desert'?['#96826c','#baa488','#d9c29e']:['#829388','#adbbae','#d2d9c4'];
  const pts=[[x-w*.9,y],[x-w,y-h*.45],[x-w*left,y-h],[x+w*.24,y-h*(.87+g()*.2)],[x+w*.9,y-h*.38],[x+w*.76,y+.3]];
  poly(c,pts.map(([px,py])=>[px+.7,py+.6]),'#4c594222');poly(c,pts,colors[0]);
  poly(c,[pts[0],pts[1],pts[2],pts[3],[x+w*.05,y-h*.3],[x-w*.3,y]],colors[1]);
  poly(c,[pts[1],pts[2],pts[3],[x+w*.1,y-h*.57],[x-w*.56,y-h*.4]],colors[2]);
  if(!regional){c.save();outline(c,pts);c.clip();for(let i=0;i<12;i++)rect(c,x+(t()-.5)*w*2,y-t()*h,.4+t()*.6,.35,i%3?'#edf0d359':'#586d5b40');c.restore();line(c,[[x-w*.1,y-h*.76],[x-w*.21,y-h*.3],[x+w*.2,y]],colors[0],.4);}
}
function succulent(c,g,t,plant,detail,regional){
  const s=plant.s,x=clamp(plant.x,7*s,32-7*s),y=Math.max(plant.y,11*s),aloe=detail==='aloe',prickly=detail==='prickly-pear';
  oval(c,x+1,y+.8,4*s,1.1*s,'#706b4928');
  if(prickly){
    const pads=3+Math.floor(g()*4),lean=(g()-.5)*2;
    for(let i=0;i<pads;i++){
      const px=x+(i?Math.sin(i*2.4+lean)*(1.5+i*.45)*s:0),py=y-1.6*s-i*.9*s,angle=(g()-.5)*.65,w=(1.15+g()*.45)*s,h=(1.7+g()*.55)*s;
      c.save();c.translate(px,py);c.rotate(angle);oval(c,.3,.2,w,h,'#728968');oval(c,-.2,-.2,w*.86,h*.92,i%2?'#93aa7c':'#a5b489');
      if(!regional)for(let j=0;j<5;j++)rect(c,(t()-.5)*w*1.3,(t()-.5)*h*1.6,.35,.45,'#dae0b094');c.restore();
      if(i>1&&g()>.72)oval(c,px,py-h,.55,.4,'#c79a84');
    }
  }else{
    const count=6+Math.floor(g()*5),turn=g()*TAU;
    for(let i=0;i<count;i++){
      const a=turn+i*TAU/count+(g()-.5)*.4,len=(aloe?3.1:4.1)*s*(.7+g()*.6),dx=Math.cos(a)*len,dy=Math.sin(a)*len*.63-1.1*s,wide=(aloe?.95:.6)*s,bend=(g()-.5)*1.6;
      c.fillStyle=i%3===0?'#5e857b':i%2?'#86a697':'#a9bbae';c.beginPath();c.moveTo(x-wide,y);c.quadraticCurveTo(x+dx*.6+bend,y+dy*.5-1.1,x+dx,y+dy);c.quadraticCurveTo(x+dx*.5,y+dy*.5+wide,x+wide*.5,y);c.fill();
      if(!regional)curve(c,x,y,x+dx*.5+bend*.4,y+dy*.5,x+dx,y+dy,'#d4dcc15c',.35);
      if(aloe)line(c,[[x+dx*.82,y+dy*.82],[x+dx,y+dy]],'#b7988399',.48);
    }
  }
}
function cactus(c,g,t,plant,regional){
  const {x,s}=plant,h=(6+g()*5)*s,y=Math.max(plant.y,h+1.5),lean=(g()-.5)*1.1,width=(1.1+g()*.45)*s;
  oval(c,x+1,y+.6,2.8*s,.9*s,'#766b4928');
  line(c,[[x,y],[x+lean,y-h]],'#667f61',width*2);line(c,[[x-.35*s,y-.3],[x+lean-.35*s,y-h+.1]],'#97aa7b',width);
  const arms=Math.floor(g()*4);
  for(let i=0;i<arms;i++){
    const side=i%2?-1:1,at=y-h*(.2+g()*.42),reach=(1.7+g()*1.4)*s,up=(1.8+g()*2.4)*s;
    c.strokeStyle=i%2?'#738e68':'#8da675';c.lineWidth=width*1.15;c.lineCap='round';c.beginPath();c.moveTo(x,at);c.quadraticCurveTo(x+side*reach,at+.3,x+side*reach,at-up);c.stroke();
  }
  if(!regional)for(let i=0;i<9;i++){const yy=y-t()*h;rect(c,x+(t()-.5)*width*1.1,yy,.3,.45,'#d4d8ac8a');}
  if(g()>.68)oval(c,x+lean,y-h-.35,.7*s,.45*s,'#c0a080');
}
export function drawTerrainDetail(c,rawDetail,r,biome,detailLevel='town'){
  const regional=detailLevel==='region',detail=normalizedDetail(rawDetail);
  const g=randomStream(Math.floor(r()*4294967296)),t=randomStream(Math.floor(r()*4294967296));
  c.save();c.beginPath();c.rect(0,0,32,32);c.clip();
  if(['wildflowers','bluebells','arctic-poppies','desert-flowers'].includes(detail))flowers(c,g,t,detail,biome,regional);
  else if(['grass-tufts','tundra-grass','dry-grass','cotton-grass','reeds'].includes(detail))for(const plant of clusters(g,2,4,6))grass(c,g,plant,detail,biome,regional);
  else if(detail==='ferns')for(const plant of clusters(g,1,3,6))fern(c,g,plant,regional);
  else if(['shrubs','scrub','heather','berry-bushes','willow-scrub'].includes(detail))for(const plant of clusters(g,1,3,7))shrub(c,g,t,plant,biome,detail,regional);
  else if(['agave','aloe','prickly-pear'].includes(detail))for(const plant of clusters(g,1,3,7))succulent(c,g,t,plant,detail,regional);
  else if(detail==='cactus'){
    const plants=clusters(g,1,3,7);for(const plant of plants)cactus(c,g,t,plant,regional);
    if(g()>.45)stone(c,g,t,{x:6+g()*20,y:7+g()*20,s:.35},biome,regional);
  }else if(detail==='marsh'){
    for(const plant of clusters(g,1,3,7)){
      const {x,y,s}=plant;patch(c,g,t,x,y,4.6*s,2.1*s,['#658c7a50','#82a08d48','#b3c4a762'],regional);
      line(c,[[x-2*s,y+.7],[x+.5*s,y+1]],'#c0cdb058',.5);
      grass(c,g,{x:x+2*s,y:y+1,s:.7*s},'reeds',biome,regional);
    }
  }else if(detail==='lichen'){
    for(const {x,y,s}of clusters(g,2,5,8)){
      patch(c,g,t,x,y,3.6*s,1.7*s,['#9daa8b52','#c2c7a685','#e2e0baba'],regional);
      if(!regional)for(let i=0;i<6;i++){const px=x+(t()-.5)*4*s,py=y+(t()-.5)*2*s;line(c,[[px-.5,py+.4],[px,py-.3],[px+.5,py+.2]],'#e5e3bf85',.35);}
    }
  }else if(detail==='glacial'){
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
