// Production buildings share materials with town sprites but have readable,
// industry-specific silhouettes. Art remains within the 32 × 40 sprite envelope.
const kinds=new Set(['sawmill','steel-mill','food-plant','fish-processor','furniture-factory','machine-works','cement-works','sand-pit','glassworks','wire-mill','goods-factory','equipment-factory']);
const rect=(c,x,y,w,h,color)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
function poly(c,points,color){c.fillStyle=color;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();}
function line(c,points,color,width=.65){c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
function oval(c,x,y,rx,ry,color){c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill();}
function hall(c,x,y,w,h,color,roof,detail,biome){
  poly(c,[[x+2,y+3],[x+w+2,y+4],[x+w+3,y+h+2],[x+3,y+h+2]],'#30433745');
  rect(c,x,y+4,w,h-4,color);rect(c,x+w-2,y+4,2,h-4,'#334c4438');
  poly(c,[[x-1,y+5],[x+3,y],[x+w-3,y],[x+w+1,y+5]],roof);
  line(c,[[x+3,y],[x+w-3,y]],'#e3dbc07a',.8);line(c,[[x-1,y+5],[x+w+1,y+5]],'#344a405b',.7);
  if(biome==='tundra')poly(c,[[x+3,y],[x+w-3,y],[x+w-1,y+2],[x+w*.45,y+3],[x+1,y+2]],'#dae2d2');
  if(detail!=='region')for(let xx=x+3;xx<x+w-1;xx+=3)line(c,[[xx,y+1],[xx+1,y+4]],'#e6d8b833',.45);
  if(detail==='detail')for(let yy=y+7;yy<y+h;yy+=2)line(c,[[x,yy],[x+w-2,yy]],'#4e55461b',.4);
  rect(c,x,y+h-.7,w,.7,'#344a4147');
}
function windows(c,x,y,n,detail){for(let i=0;i<n;i++){rect(c,x+i*3.4,y,2.4,3,'#435f62');rect(c,x+i*3.4+.35,y+.35,1.6,1.8,'#bfd3c6');if(detail==='detail')rect(c,x+i*3.4+1.1,y,.3,3,'#d8d6b7');}}
function silo(c,x,y,w,h,detail){rect(c,x+1,y+2,w,h,'#3c51472c');rect(c,x,y,w,h,'#bbc2b1');rect(c,x+w*.65,y,w*.35,h,'#83968d');oval(c,x+w/2,y,w/2,2.2,'#dbe0cc');oval(c,x+w/2,y+h,w/2,1.5,'#9ba999');rect(c,x+1,y+1,.7,h-2,'#e6e4c666');if(detail!=='region')for(let yy=y+4;yy<y+h;yy+=4)line(c,[[x,yy],[x+w,yy]],'#617b7177',.45);}
function stack(c,x,y,h,detail){rect(c,x+1,y+1,3,h,'#30423834');rect(c,x,y,3,h,'#a48266');rect(c,x+2,y,1,h,'#6e6855');rect(c,x-.5,y,4,1,'#686450');rect(c,x+.2,y+.2,2.6,.45,'#384d48');if(detail==='detail')for(let yy=y+3;yy<y+h;yy+=2)rect(c,x,yy,3,.45,'#d0af852e');}
function crate(c,x,y,color='#ae9065',detail='town'){rect(c,x+.8,y+1,4,3,'#374d4437');rect(c,x,y,4,3,color);rect(c,x,y,4,.6,'#e9d2a651');rect(c,x+3,y,.7,3,'#40534442');if(detail!=='region')line(c,[[x+.5,y+.5],[x+3,y+2.6]],'#6c6a4c70',.5);}
function gantry(c,x,y,w,h){rect(c,x,y,1.6,h,'#ac915f');rect(c,x+w-1.6,y,1.6,h,'#82774f');rect(c,x-1,y,w+2,2.2,'#c6a568');line(c,[[x,y+1],[x+w,y+1]],'#e5c582',.5);line(c,[[x+w*.6,y+2],[x+w*.6,y+h*.7],[x+w*.6-1,y+h*.7+1]],'#4e6258',.6);}
export function drawProcessingPlant(c,kind,r,biome,detail='town'){
  if(!kinds.has(kind))return false;
  rect(c,1,13,30,18,biome==='desert'?'#b9a583':biome==='tundra'?'#bbc5b1':'#a0a48b');
  rect(c,1,29,30,2,'#c6bea0');line(c,[[2,30],[30,30]],'#ede2ba60');
  if(detail!=='region')for(let i=0;i<20;i++)rect(c,2+r()*27,14+r()*14,.6,.5,'#e5d8ab38');
  const shed=(x,y,w,h,color,roof)=>hall(c,x,y,w,h,color,roof,detail,biome);
  if(kind==='sawmill'){
    shed(3,6,23,18,'#b7a27d','#856b55');shed(20,13,9,12,'#a99977','#70837a');
    rect(c,5,20,13,5,'#4b5c4e');rect(c,6,20.5,10,2,'#687357');stack(c,24,3,12,detail);
    for(let y=25;y<30;y+=1.6){rect(c,2,y,14,1.3,'#a17b50');rect(c,2,y,1.5,1.3,'#d3b37b');line(c,[[4,y+.25],[15,y+.25]],'#d6b783',.4);}
    for(let i=0;i<3;i++)crate(c,20+i*3,26-i*.9,'#c0a176',detail);
    windows(c,5,15,4,detail);
  }else if(kind==='steel-mill'){
    shed(2,16,18,12,'#ad9c80','#60736d');silo(c,20,3,7,20,detail);stack(c,10,-3,24,detail);stack(c,15,1,17,detail);
    line(c,[[23,5],[29,5],[29,23],[18,23]],'#8c7960',1.7);line(c,[[23,5],[29,5],[29,23]],'#c3ad8277',.55);
    rect(c,4,23,8,4,'#4c5143');rect(c,5,24,5.5,2,'#cd8d45');rect(c,5.5,24,3,1,'#f0c875');
    for(let i=0;i<3;i++){rect(c,18,27+i,11,.8,'#829492');rect(c,18,27+i,11,.3,'#c0cbc0');}
    windows(c,3,20,4,detail);
  }else if(kind==='food-plant'||kind==='fish-processor'){
    const fish=kind==='fish-processor';shed(3,10,26,17,'#dddac0',fish?'#62848a':'#758965');
    silo(c,4,2,6,14,detail);silo(c,10,5,5,11,detail);rect(c,3,21,26,1.3,fish?'#79a4ab':'#87a075');
    windows(c,16,18,3,detail);rect(c,5,22,8,5,'#566f66');rect(c,6,23,6,3,'#87a092');
    for(const x of [17,22,27])crate(c,x,27,fish?'#a9c7c2':'#b3bc83',detail);
    rect(c,19,9,6,2,'#a9b5a1');rect(c,20,9.5,4,.5,'#4d6a61');
  }else if(kind==='furniture-factory'){
    shed(3,4,24,23,'#bc9c79','#746e5d');shed(19,16,11,11,'#c8b494','#8a8066');
    windows(c,5,13,6,detail);windows(c,5,19,4,detail);stack(c,25,0,10,detail);
    rect(c,17,23,6,4,'#597164');rect(c,4,28,13,2,'#b39062');for(let i=0;i<4;i++)rect(c,5+i*3,28,1.6,.5,'#dec093');
    crate(c,24,27,'#bc9a70',detail);crate(c,26,24,'#ae8d65',detail);
  }else if(kind==='cement-works'){
    shed(3,17,14,11,'#bab59b','#8a9483');silo(c,16,1,6,25,detail);silo(c,23,5,6,21,detail);
    line(c,[[6,23],[6,8],[19,8]],'#9ca894',2);line(c,[[6,8],[19,8]],'#d9d9bf',.6);
    windows(c,4,22,3,detail);for(let x=4;x<17;x+=4)crate(c,x,27,'#d3c9a9',detail);
    if(detail!=='region')for(let yy=8;yy<26;yy+=2){rect(c,27,yy,2,.4,'#e8e2c0');}
  }else if(kind==='sand-pit'){
    oval(c,13,21,12,8,'#b49566');oval(c,12,20,10,6,'#c9ac77');oval(c,13,21,6,3.5,'#af925f');
    poly(c,[[2,25],[8,13],[16,25]],'#d4ba86');poly(c,[[8,13],[16,25],[9,23]],'#b39966');
    gantry(c,20,8,8,18);line(c,[[24,13],[15,23]],'#767958',1.4);rect(c,18,27,10,2,'#4e5c49');rect(c,19,24,7,3,'#b8a262');rect(c,22,21,4,4,'#c8ad66');rect(c,23,21.5,2,2,'#58746c');
  }else if(kind==='glassworks'){
    shed(2,12,17,15,'#ad9576','#798c7c');stack(c,5,-2,19,detail);shed(18,6,12,21,'#adc4b6','#809f99');
    poly(c,[[17,11],[23,4],[31,11]],'#adcdc3');line(c,[[23,4],[23,27]],'#e6e2c1',.75);line(c,[[19,11],[29,11]],'#edf0d47a');
    rect(c,4,22,7,4,'#625c47');oval(c,7.5,24,2.2,1.4,'#d3a35c');oval(c,7.5,24,1,1,'#edd38c');
    for(let x=19;x<29;x+=3){rect(c,x,26,2,4,'#85aaa8');line(c,[[x,26],[x+1.8,26],[x+1.8,29]],'#d4e8d0',.4);}
    windows(c,11,21,2,detail);
  }else if(kind==='wire-mill'){
    shed(2,7,27,20,'#c2b291','#7e8a7b');windows(c,4,16,7,detail);stack(c,25,2,9,detail);
    rect(c,4,23,9,4,'#556759');for(const [x,y] of [[17,27],[23,25],[27,28]]){oval(c,x,y,2.7,2.5,'#866c4e');oval(c,x-.2,y-.3,2.1,1.9,'#bc875c');oval(c,x-.2,y-.3,.9,.8,'#526657');if(detail!=='region')line(c,[[x-1,y-1.7],[x+1,y+1.2]],'#dbab786a',.6);}
  }else if(kind==='machine-works'||kind==='equipment-factory'){
    shed(2,5,20,23,'#b6b7a0','#627e7e');shed(21,13,9,15,'#c4c3a9','#89998a');windows(c,4,14,5,detail);windows(c,4,20,3,detail);
    rect(c,15,21,6,7,'#405e59');gantry(c,16,10,14,18);stack(c,3,-2,11,detail);
    for(let i=0;i<3;i++){rect(c,3+i*4,27,3,3,'#809697');rect(c,3+i*4,27,3,.7,'#c0cec1');oval(c,4.5+i*4,28.5,.65,.65,'#425e59');}
    if(kind==='equipment-factory'){rect(c,23,24,6,4,'#b69d65');rect(c,25,22,3,3,'#cbb27b');rect(c,23,27,2,2,'#4c6358');rect(c,28,27,2,2,'#4c6358');}
  }else{
    shed(2,8,13,19,'#c1b69a','#858e7f');shed(15,3,14,24,'#d1c5a5','#7b8c88');windows(c,4,16,3,detail);windows(c,17,13,3,detail);
    for(const x of [5,19]){rect(c,x,23,7,4,'#58716a');rect(c,x+.5,23.5,6,1,'#849b8a');}
    for(const [x,y] of [[2,28],[24,27],[27,24]])crate(c,x,y,'#a99b87',detail);
    rect(c,19,5,6,2,'#adbaab');line(c,[[20,5.6],[24,5.6]],'#5c756a',.6);
  }
  if(biome==='tundra'){poly(c,[[1,29],[9,28.5],[12,31],[1,31]],'#e0e5d4');poly(c,[[27,29],[31,28],[31,31],[25,31]],'#d5ddcb');}
  return true;
}
