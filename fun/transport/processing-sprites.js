import { SPRITE_SCALE, featureSpriteUnits } from './sprite-art-direction.js';

// Doors, floors and loading bays retain their metre dimensions as parcels grow.
// Multiple low halls replace the oversized one-tile toy factory fallback.
const farms=new Set(['farm','dairy-farm','vegetable-farm','orchard','livestock-farm']);
const kinds=new Set([...farms,'logging-camp','coal-mine','iron-mine','copper-mine','quarry','oil-well','refinery','fishery','dairy-plant','cannery','meat-packer','sawmill','steel-mill','food-plant','fish-processor','furniture-factory','machine-works','cement-works','sand-pit','glassworks','wire-mill','goods-factory','equipment-factory']);
function poly(c,points,color){c.fillStyle=color;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();}
function line(c,points,color,width=.3){c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
function rect(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(x,y,w,h);}
function oval(c,x,y,rx,ry,color){c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill();}
function palette(biome){return biome==='desert'?{ground:'#c4b28a',wall:'#d2bd98',roof:'#a0795e'}:biome==='tundra'?{ground:'#cbd4c5',wall:'#cbd0c0',roof:'#657d83'}:{ground:'#91a77a',wall:'#c8c7aa',roof:'#738783'};}
function yard(c,biome){poly(c,[[2,18],[16,11],[30,18],[16,25]],palette(biome).ground);}
function hall(c,x,y,w,d,u,{wall='#c8c7aa',roof='#71847d',height=6,bays=2,windows=3}={}){
  const h=u(height),a=[x,y],b=[x+w,y+w/2],z=[x+w+d,y+(w-d)/2],back=[x+d,y-d/2];
  poly(c,[[a[0],a[1]-h],[b[0],b[1]-h],b,a],wall);
  poly(c,[[b[0],b[1]-h],[z[0],z[1]-h],z,b],'#81938a');
  poly(c,[[a[0],a[1]-h],[b[0],b[1]-h],[z[0],z[1]-h],[back[0],back[1]-h]],roof);
  const doorHeight=u(SPRITE_SCALE.doorHeightMetres),bayHeight=u(SPRITE_SCALE.loadingBayHeightMetres),windowSize=u(SPRITE_SCALE.windowHeightMetres);
  rect(c,x+w*.1,y+w*.05-doorHeight,u(SPRITE_SCALE.doorWidthMetres),doorHeight,'#4f635b');
  for(let i=0;i<bays;i++){const t=.32+i*.54/Math.max(1,bays);rect(c,x+w*t,y+w*t/2-bayHeight,u(3.1),bayHeight,'#4e625a');}
  for(let i=0;i<windows;i++){const t=.16+i*.7/Math.max(1,windows);rect(c,x+w*t,y+w*t/2-h+u(.8),windowSize,windowSize,'#a4bdb6');}
}
function silo(c,x,y,diameter,height,u,color='#bfc6b6'){const w=u(diameter),h=u(height);rect(c,x-w/2,y-h,w,h,color);rect(c,x,y-h,w/2,h,'#8e9f95');oval(c,x,y-h,w/2,w/4,'#d8ddcb');oval(c,x,y,w/2,w/4,'#a0afa3');}
function chimney(c,x,y,u,height=18){rect(c,x,y-u(height),u(2),u(height),'#99785e');oval(c,x+u(1),y-u(height),u(1),u(.5),'#655e50');}
function core(c,kind,biome,u){
  const p=palette(biome),roof=kind==='vegetable-farm'||kind==='orchard'?'#758279':kind==='livestock-farm'?'#81745f':'#a16f51';
  hall(c,4,18,11,6,u,{wall:p.wall,roof,height:5.5,bays:kind==='orchard'?1:2,windows:2});
  if(kind==='vegetable-farm')hall(c,18,20,6,4,u,{wall:'#aec5b7',roof:'#96b6a9',height:3.6,bays:0,windows:2});
  else if(kind==='farm'||kind==='dairy-farm')silo(c,23,19,3.2,kind==='farm'?10:7,u);
  else hall(c,20,20,5,3,u,{wall:'#b5a284',roof,height:SPRITE_SCALE.storeyHeightMetres,bays:0,windows:0});
}
export function drawNativeFarmCore(c,kind,r,biome,detail='town',footprint=2){
  if(!farms.has(kind))return false;
  yard(c,biome);core(c,kind,biome,metres=>featureSpriteUnits(metres,footprint));return true;
}
export function drawProcessingPlant(c,kind,r,biome,detail='town',footprint=5){
  if(!kinds.has(kind))return false;
  const u=metres=>featureSpriteUnits(metres,footprint),p=palette(biome);yard(c,biome);
  if(farms.has(kind)){
    poly(c,[[3,19],[11,15],[24,21.5],[16,25.5]],kind==='farm'?'#bfaf70':kind==='livestock-farm'?'#91a172':'#849b6b');
    if(kind==='farm'||kind==='vegetable-farm')for(let i=0;i<4;i++)line(c,[[4+i*3,19+i*1.5],[11+i*3,15+i*1.5]],kind==='farm'?'#d1bd79':'#aabc83',.5);
    hall(c,12,14,kind==='livestock-farm'?9:6,4,u,{wall:kind==='dairy-farm'?'#d5d3b7':kind==='livestock-farm'?'#b69b72':p.wall,roof:kind==='vegetable-farm'?'#758479':kind==='livestock-farm'?'#81755f':'#9e7052',height:5,bays:1,windows:1});
    if(kind==='vegetable-farm')hall(c,20,21,5,4,u,{wall:'#adc5b6',roof:'#95b4a8',height:3.6,bays:0,windows:2});
    else if(kind==='orchard')for(const [x,y]of [[6,19],[11,22],[16,25]]){rect(c,x-u(.25),y-u(2),u(.5),u(2),'#897354');oval(c,x,y-u(3),u(2),u(1.6),'#759365');}
    else if(kind==='livestock-farm'){const fenceHeight=u(SPRITE_SCALE.fenceHeightMetres);line(c,[[3,19-fenceHeight],[16,25.5-fenceHeight],[24,21.5-fenceHeight]],'#bbaa85',.45);}
    else{silo(c,24,16,3,8,u);if(kind==='dairy-farm')silo(c,27,18,2.5,6,u);}
    return true;
  }
  if(['quarry','sand-pit','coal-mine','iron-mine','copper-mine'].includes(kind)){
    const mineral=kind==='coal-mine'?'#626b60':kind==='iron-mine'||kind==='copper-mine'?'#af8164':biome==='desert'?'#c9ad7d':'#b7b9a4';
    for(let i=0;i<3;i++)poly(c,[[3+i*2,18],[12,13+i],[24-i*2,18],[14,23-i]],i%2?'#929f87':mineral);
    hall(c,19,21,5,3,u,{wall:p.wall,roof:p.roof,height:4.5,bays:1,windows:1});
    if(kind.endsWith('mine')){const h=u(Math.min(18,footprint*15));line(c,[[10,17],[11,17-h],[13,17-h],[15,19]],'#76654f',.65);line(c,[[11,17-h],[13,17-h]],'#c4b17a',1);}else line(c,[[6,17],[18,21]],'#7b8a76',.9);
    return true;
  }
  if(kind==='logging-camp'||kind==='sawmill'){
    hall(c,4,18,10,4,u,{wall:'#b4a282',roof:kind==='sawmill'?'#a47754':'#7e7c63',height:5,bays:3,windows:1});
    hall(c,15,16,7,4,u,{wall:'#a89b7c',roof:'#85745e',height:4.5,bays:2,windows:0});
    for(let i=0;i<3;i++)line(c,[[8,21+i],[18,26+i]],'#aa8759',.9);return true;
  }
  if(kind==='oil-well'||kind==='refinery'){
    for(const [x,y]of [[7,18],[16,21],[24,18]])silo(c,x,y,kind==='oil-well'?5:8,kind==='oil-well'?4:8,u);
    if(kind==='oil-well')for(const [x,y]of [[6,15],[17,14]]){line(c,[[x,y],[x+1,y-u(6)],[x+3,y]],'#647966',.55);line(c,[[x-1,y-u(7)],[x+4,y-u(5)]],'#b49b61',.75);}
    else for(const [x,y]of [[11,15],[19,16],[25,21]])silo(c,x,y,3,Math.min(19,footprint*13.5),u,'#b6b8a5');
    hall(c,4,23,5,3,u,{wall:p.wall,roof:p.roof,height:SPRITE_SCALE.storeyHeightMetres,bays:0,windows:1});return true;
  }
  if(kind==='fishery'){
    poly(c,[[3,19],[17,26],[30,19],[17,12]],'#779ca0');for(const x of [7,15,23])line(c,[[x,16],[x,24]],'#b79f75',1.2);
    hall(c,5,17,12,5,u,{wall:p.wall,roof:'#627f88',height:5,bays:3,windows:2});return true;
  }
  const blue=['machine-works','equipment-factory','goods-factory','dairy-plant','fish-processor'].includes(kind),brick=['steel-mill','furniture-factory','wire-mill','cannery'].includes(kind),roof=blue?'#67838a':kind==='meat-packer'?'#a37964':'#768b71',wall=brick?'#b38c71':p.wall;
  for(const [x,y,w,d]of [[3,17,9,4],[12,20,9,4],[18,15,7,4]])hall(c,x,y,w,d,u,{wall,roof,height:kind==='steel-mill'?9:6,bays:2,windows:3});
  // A compact historic parcel has shorter equipment, while the human features
  // keep their dimensions. Tall silos must fit its original sprite envelope.
  if(['food-plant','dairy-plant','cement-works','cannery','steel-mill'].includes(kind))for(const [x,y]of [[6,13],[11,15]])silo(c,x,y,kind==='cement-works'?5:4,Math.min(kind==='cement-works'?19:11,footprint*13.5),u);
  if(brick||kind==='glassworks')chimney(c,22,15,u,Math.min(kind==='steel-mill'?25:17,footprint*15));
  if(kind==='glassworks')hall(c,6,22,11,4,u,{wall:'#a8c2b5',roof:'#84a89b',height:6,bays:2,windows:4});
  return true;
}
