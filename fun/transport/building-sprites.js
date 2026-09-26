// Painted miniature town atlas. Every identity has its own silhouette and street details.
// Coordinates share the original 32 px plot with eight pixels of roof overhang.
// Profiles are scoped to a drawing context so concurrent atlases never share state.
const regionalContexts = new WeakSet();
const finishes = new WeakMap();
const finish = c => finishes.get(c) || {variant:0,biome:'taiga',kind:'',detail:'town'};
const isRegional = c => regionalContexts.has(c);
const ink = '#4b5954', glass = '#729292', cream = '#ded8bd', wall = '#c7c6ae';
function rect(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(x,y,w,h);}
function poly(c,points,color){c.fillStyle=color;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();}
function line(c,points,color,width=.7){c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
function oval(c,x,y,rx,ry,color){c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill();}
function window(c,x,y,w=2,h=3){
  rect(c,x-.25,y-.3,w+.5,h+.65,'#c6c4ab');rect(c,x,y,w,h,ink);
  if(isRegional(c)){rect(c,x+.5,y+.5,w-1,Math.min(1.5,h-1),'#d4d9ba');return;}
  const warm=(Math.floor(x+y)+finish(c).variant)%5===0;
  rect(c,x+.35,y+.35,w-.7,h-.7,warm?'#d3c696':'#8caca9');
  poly(c,[[x+.35,y+.35],[x+w-.35,y+.35],[x+.35,y+h-1]],warm?'#efe0b1':'#c8dfd3');
  if(w>=2.4&&h>=3){rect(c,x+w/2-.17,y+.3,.34,h-.6,'#dbd9bd');rect(c,x+.3,y+h*.56,w-.6,.28,'#d7d6bb');}
  rect(c,x-.35,y+h,w+.7,.5,'#e1d9b8');rect(c,x,y+h+.5,w,.4,'#46575035');
}
function windows(c,x,y,n,step=4,w=2,h=3){for(let i=0;i<n;i++)window(c,x+i*step,y,w,h);}
function door(c,x,y,w=3,h=4,color='#776c55'){rect(c,x,y,w,h,color);rect(c,x+.6,y+.6,w-1.2,1.1,glass);if(!isRegional(c))rect(c,x+w-.8,y+h-1.4,.4,.4,cream);}
function hedge(c,x,y,w,h=2){rect(c,x+.7,y+1,w,h,'#495c4444');rect(c,x,y,w,h,'#6a8055');if(!isRegional(c))rect(c,x+.6,y,w-1.2,.6,'#9aa372');}
function tree(c,x,y,size=3){
  const biome=finish(c).biome;oval(c,x+1,y+2,size,1.6,'#41553d35');rect(c,x-.4,y-1,.8,3,'#75694d');
  if(biome==='tundra'){poly(c,[[x,y-size-2],[x-size,y+1],[x+size,y+1]],'#688878');poly(c,[[x,y-size-2],[x-size*.65,y-.1],[x+.4,y-.2]],'#d4ddc9');}
  else if(biome==='desert'){oval(c,x,y-1,size*1.15,size*.64,'#68845b');oval(c,x-.7,y-1.7,size*.8,size*.4,'#9ead75');}
  else{oval(c,x,y-1,size,size,'#516f46');oval(c,x-.8,y-1.6,size*.77,size*.83,'#7e9657');oval(c,x+.9,y-.3,size*.55,size*.55,'#67894d');if(!isRegional(c))oval(c,x-1.1,y-2.3,size*.38,size*.34,'#a1b06a');}
}
function pot(c,x,y,color='#b3986c'){rect(c,x,y,2,1.6,color);oval(c,x+1,y-.2,1.5,1,'#6a8751');if(!isRegional(c))rect(c,x+.5,y-.8,1,.6,'#d5bc76');}
function chimney(c,x,y,h=4){rect(c,x,y,2,h,'#796d5b');rect(c,x-.3,y,2.6,.9,'#b3a88d');}
function path(c,x,y,w,h){rect(c,x,y,w,h,'#b9b49a');rect(c,x,y,w,.7,'#d6d0b4');}
function plot(c,biome,kind='garden'){
  const {variant,detail}=finish(c);
  if(kind==='paved'){
    rect(c,2,6,28,25,biome==='desert'?'#b9aa8c':'#aaa994');
    if(!isRegional(c))for(let y=8;y<30;y+=3){line(c,[[2,y],[30,y]],'#e3dfc224',.45);if(detail==='detail')for(let x=3+(y%2)*2;x<30;x+=4)line(c,[[x,y],[x,y+3]],'#5f6e5a20',.4);}
    rect(c,2,29,28,2,'#c6c2a8');rect(c,2,29,28,.6,'#e0dbc0');
  }else {
    const green=biome==='desert'?['#aaa37a','#a2a578','#adac7d']:biome==='tundra'?['#b5c1ac','#abbba5','#c4cdb8']:['#8e9f6b','#849964','#92a16f'];
    rect(c,2,7,28,23,green[variant%3]);
    for(let y=8;y<29;y+=4)rect(c,3,y,26,1.5,biome==='tundra'?'#eff0dc15':'#d4d3a616');
    if(!isRegional(c))for(let i=0;i<18;i++){const x=3+(i*11+variant*3)%26,y=8+(i*7+variant)%20;rect(c,x,y,.6,.5,'#c6c8a642');}
    rect(c,2,29,28,1,'#b6baa0');
    if(variant%3===1){for(const x of [3,6,9,24,27,29])rect(c,x,28,.55,2.6,'#d5ceae');line(c,[[3,29],[10,29]],'#b9b895',.6);line(c,[[24,29],[29,29]],'#b9b895',.6);}
  }
}
function roof(c,x,y,w,d,color='#8c715b',style='hip'){
  const f=finish(c);
  if(f.kind.startsWith('house-')){
    const colors=f.biome==='desert'?['#af815e','#9b7053','#c09870','#8c8770']:['#986f56','#6b8280','#897d62','#a97555'];
    color=colors[(f.variant+Number(f.kind.at(-1)))%colors.length];
  }
  if(style==='flat'){
    rect(c,x-1,y,w+2,d,color);rect(c,x-.6,y,w+1.2,.9,'#dce0c247');rect(c,x-1,y,1,d,'#f5efd030');rect(c,x-1,y+d-.8,w+2,1,'#4d5b493f');
  }else {
    poly(c,[[x-1,y+d],[x+1.8,y],[x+w-1.8,y],[x+w+1,y+d]],color);
    poly(c,[[x+1.8,y],[x+w-1.8,y],[x+w-.8,y+d*.43],[x+.8,y+d*.43]],'#20372c24');
    line(c,[[x+.8,y+d*.43],[x+w-.8,y+d*.43]],'#e4d6aa70');
    if(!isRegional(c))for(let yy=1.8;yy<d-.3;yy+=1.8){
      const inset=1.8-yy/d*2.7;line(c,[[x+inset,y+yy],[x+w-inset,y+yy]],'#352f292f',.45);
      if(f.detail==='detail')for(let xx=x+inset+((Math.round(yy)+f.variant)%2)*1.3;xx<x+w-inset;xx+=2.6){line(c,[[xx,y+yy],[xx-.25,y+Math.min(d,yy+1.65)]],'#e0c6a02b',.35);}
    }
    line(c,[[x+2,y+.4],[x+w-2,y+.4]],'#ead6b16b',.65);
    if(f.biome==='tundra'){
      poly(c,[[x+2,y],[x+w-2,y],[x+w-.8,y+d*.35],[x+w*.57,y+d*.44],[x+w*.32,y+d*.28],[x+.9,y+d*.4]],'#dae1d0');
      line(c,[[x+.9,y+d*.4],[x+w*.32,y+d*.28],[x+w*.57,y+d*.44]],'#f1f0dc',.7);
    }
    rect(c,x-1,y+d-.5,w+2,1,'#42463c4d');
  }
}
function block(c,x,y,w,h,roofDepth=7,roofColor='#879188',wallColor=wall,style='hip'){
  poly(c,[[x+2,y+4],[x+w+3,y+5],[x+w+4,y+h+3],[x+4,y+h+3]],'#253c363d');
  const f=finish(c),facadeY=y+roofDepth-1,facadeH=h-roofDepth+1;
  if(f.kind.startsWith('house-'))wallColor=(f.biome==='desert'?['#e0c49b','#d5b58b','#d6c5a5']:['#d9d1b5','#c6b799','#d3cbb5','#bca68a'])[f.variant% (f.biome==='desert'?3:4)];
  rect(c,x,facadeY,w,facadeH,wallColor);
  if(!isRegional(c)){
    rect(c,x,facadeY,1,facadeH,'#f1e4c737');
    if(f.detail==='detail')for(let row=0;row<facadeH;row+=2){line(c,[[x,y+roofDepth+row],[x+w,y+roofDepth+row]],'#695e4c12',.35);for(let xx=x+(row%4?2:0);xx<x+w;xx+=4)rect(c,xx,facadeY+row,.35,1.7,'#685e4c12');}
  }
  rect(c,x+w-2,y+roofDepth-1,2,h-roofDepth+1,'#727b6866');rect(c,x,y+h-1,w,1,'#5d665552');
  roof(c,x,y,w,roofDepth,roofColor,style);
  if(!isRegional(c)){line(c,[[x-.6,y+roofDepth+.7],[x+w+.6,y+roofDepth+.7]],'#dbd4b767',.45);rect(c,x+w-1.4,y+roofDepth,.45,Math.max(0,h-roofDepth),'#565c4b3a');}
  if(f.biome==='tundra'&&style==='flat'){rect(c,x+.4,y+.3,w-1.4,Math.max(1,roofDepth*.35),'#dce3d1');}

}
function gable(c,x,y,w,h,color='#9a7559'){
  poly(c,[[x-1,y+h],[x+w*.5,y],[x+w+1,y+h]],color);line(c,[[x-.5,y+h],[x+w*.5,y+.2],[x+w+.5,y+h]],'#dac49b80');
}
function awning(c,x,y,w,color){rect(c,x,y,w,3,color);const step=isRegional(c)?6:3;for(let i=0;i<w;i+=step)rect(c,x+i,y,Math.min(step/2,w-i),3,'#e5d8b8');line(c,[[x,y+3],[x+w,y+3]],'#545c4a66');}
function car(c,x,y,color='#7f9996',vertical=false){
  const w=vertical?3:6,h=vertical?6:3;rect(c,x+.5,y+1,w,h,'#344f4b55');rect(c,x,y,w,h,color);rect(c,x+(vertical?.4:1.5),y+(vertical?1.5:.4),vertical?2:2.5,vertical?2.5:2,'#43676a');rect(c,x,y,vertical?1:1.2,vertical?1.2:1,'#e1ddbb');
}
function flowerbed(c,x,y,w,color='#cab076'){rect(c,x,y,w,2,'#6c7950');if(isRegional(c)){rect(c,x,y,w,1,color);return;}for(let i=0;i<w;i+=2){rect(c,x+i,y,.8,.8,color);rect(c,x+i+1,y+1,.8,.8,'#cba890');}}
function home(c,kind,biome){
  plot(c,biome);hedge(c,2,8,2,19);hedge(c,27,8,3,19);
  if(kind==='house-cheap-1'){
    path(c,14,21,4,10);block(c,6,11,20,13,7,'#9c7657','#d1c9aa');windows(c,8,20,2,11,3,3);door(c,15,20);chimney(c,22,11,5);roof(c,13,23,7,2,'#858673','flat');rect(c,13,25,1,2,cream);rect(c,19,25,1,2,cream);flowerbed(c,5,27,6);rect(c,23,25,3,3,'#8b785a');tree(c,6,6,2.6);
  }else if(kind==='house-cheap-2'){
    path(c,14,22,4,9);block(c,8,5,16,20,11,'#6a7f74','#917c5f');if(!isRegional(c))for(let y=17;y<25;y+=2)line(c,[[8,y],[22,y]],'#d0b18a',.6);gable(c,8,2,16,8,'#718377');rect(c,14,8,4,3,'#536153');windows(c,10,19,2,9,2,3);door(c,15,20,3,5);chimney(c,20,3,7);for(let i=0;i<4;i++){rect(c,4,23+i*1.4,4,1.2,'#877050');rect(c,4,23+i*1.4,1,1.2,'#c4ae7c');}tree(c,26,10,2.8);rect(c,19,28,5,1,'#9f8862');
  }else if(kind==='house-cheap-3'){
    path(c,5,26,22,4);block(c,3,10,13,16,8,'#9b6d53','#c6b991');block(c,16,10,13,16,8,'#887b60','#d1c6a8');windows(c,5,20,2,5);windows(c,18,20,2,5);door(c,11,22,3,4);door(c,18,22,3,4);chimney(c,14,8,6);rect(c,5,7,8,2,'#8d9563');rect(c,18,7,7,2,'#7d925d');flowerbed(c,3,29,8);flowerbed(c,23,29,5,'#bd9679');
  }else if(kind==='house-normal-1'){
    path(c,14,23,4,8);path(c,24,20,5,11);block(c,5,5,17,21,9,'#997053','#dad4b5');windows(c,7,17,3,4,2,3);door(c,13,22,3,4);gable(c,9,7,9,8,'#aa8766');window(c,12,12,3,3);block(c,22,15,7,10,5,'#88765b','#c4bca0');rect(c,23,21,5,4,'#868e7c');for(let i=0;i<3;i++)line(c,[[23,22+i],[28,22+i]],'#c4c8aa',.4);chimney(c,18,4,5);tree(c,5,26,2.4);pot(c,18,27);flowerbed(c,7,29,6);
  }else if(kind==='house-normal-2'){
    path(c,16,25,4,6);block(c,8,3,18,24,8,'#6f8180','#af9374');windows(c,10,13,3,5,2.5,4);windows(c,10,20,3,5,2.5,4);rect(c,8,18,16,1,'#c7b694');rect(c,12,19,10,1,'#d6c9a7');line(c,[[12,18],[12,21],[22,21],[22,18]],'#586c65',.65);door(c,16,23,3,4);chimney(c,21,2,5);tree(c,4,12,3);flowerbed(c,3,28,9,'#c9af8a');rect(c,23,28,5,2,'#b4ae8e');
  }else if(kind==='house-normal-3'){
    path(c,16,22,4,9);block(c,3,11,26,13,7,'#98865e','#d7cdb0');block(c,3,5,9,13,6,'#95825b','#c8c2a4');windows(c,14,20,3,4,2.5,3);door(c,8,20,3,4);chimney(c,25,11,4);rect(c,4,25,8,4,'#b6ad88');line(c,[[4,27],[12,27]],'#e2d2a977');pot(c,4,27);pot(c,11,27);flowerbed(c,21,27,7,'#b393a8');tree(c,25,5,3);
  }else if(kind==='house-expensive-1'){
    path(c,2,26,28,5);block(c,3,11,8,15,7,'#7c8277',cream);block(c,21,11,8,15,7,'#7c8277',cream);block(c,9,2,14,25,10,'#647b78',cream);windows(c,11,14,3,4,2,4);windows(c,5,20,1,4,3,4);windows(c,24,20,1,4,3,4);rect(c,12,20,8,1,'#ece4c9');for(const x of [12,19])rect(c,x,20,1,6,'#efead2');gable(c,11,17,10,4,'#b7bda6');door(c,15,22,3,5);chimney(c,10,1,5);chimney(c,22,1,5);oval(c,16,29,4.2,1.6,'#889b87');oval(c,16,29,2.5,1,'#7caaa4');rect(c,15.5,27,.7,2,'#d2d7c0');tree(c,4,5,2.6);tree(c,28,5,2.6);
  }else if(kind==='house-expensive-2'){
    path(c,9,28,16,3);block(c,6,-1,22,28,9,'#637772','#d4c7a4');poly(c,[[5,8],[8,-1],[26,-1],[29,8]],'#657a74');roof(c,9,-2,16,4,'#7a8b7e','flat');for(const x of [10,20]){gable(c,x,2,5,4,'#b8b59b');window(c,x+1.5,5,2,3);}windows(c,8,12,4,5,2.5,4);windows(c,8,20,4,5,2.5,4);rect(c,6,18,20,1,'#9b9b80');rect(c,8,19,17,1,'#e7ddbe');line(c,[[8,18],[8,21],[25,21],[25,18]],'#58675a',.7);door(c,16,23,4,5);rect(c,14,28,8,1,'#ded5b5');chimney(c,7,-2,5);pot(c,7,28);pot(c,26,28);hedge(c,2,5,2,21);
  }else if(kind==='house-expensive-3'){
    path(c,13,28,7,3);block(c,3,4,26,10,6,'#a18767',cream);block(c,3,11,8,17,6,'#9d7d5b',cream);block(c,21,11,8,17,6,'#9d7d5b',cream);windows(c,12,11,3,4,2,2);windows(c,5,21,1,3,3,4);windows(c,23,21,1,3,3,4);rect(c,12,16,8,10,'#d7ceb0');rect(c,13,17,6,7,'#7baba4');rect(c,14,18,4,1,'#bfd7c0');pot(c,11,26);pot(c,20,26);tree(c,4,1,2.5);tree(c,28,1,2.5);door(c,15,11,3,3);
  }
}
function civic(c,kind,biome){
  plot(c,biome,kind==='church'?'garden':'paved');
  if(kind==='school'){
    rect(c,19,18,11,11,'#8a9973');line(c,[[21,26],[23,20],[25,26]],'#b68a59',1);line(c,[[23,21],[28,24]],'#d7b45b',1);rect(c,20,27,7,1,'#b6aa70');block(c,3,10,25,12,6,'#8b7c60','#d4c6a1');block(c,4,3,9,24,8,'#9e7856','#d8cba5');windows(c,15,18,3,4,2.5,3);windows(c,6,16,2,4);door(c,7,22,4,5);rect(c,17,24,1,6,'#d9d6b7');poly(c,[[18,24],[23,25],[18,27]],'#ae9271');gable(c,5,1,7,6,'#ae8b63');oval(c,8.5,7,1.5,1.5,cream);line(c,[[8.5,6],[8.5,7],[9.5,7]],ink,.5);
  }else if(kind==='hospital'){
    block(c,3,9,26,18,7,'#91a39c','#e0dec5','flat');block(c,10,0,13,26,9,'#a6b2a5','#dcdcc5','flat');rect(c,14,2,5,5,'#e2e2cb');rect(c,16,2.7,1,3.6,'#ae7767');rect(c,14.7,4,3.6,1,'#ae7767');windows(c,12,12,3,3.7,2.3,3);windows(c,5,19,2,4);windows(c,23,19,1,4,3,3);rect(c,12,19,8,7,glass);line(c,[[16,19],[16,26]],cream);roof(c,10,24,13,2,'#9fafa1','flat');car(c,4,28,'#e2ddbe');rect(c,5,28,2,3,'#b48a73');rect(c,4.5,29,3,1,'#b48a73');car(c,24,27,'#b7c8bc',true);
  }else if(kind==='police-station'){
    block(c,4,5,24,21,8,'#657e82','#c5c9b5','flat');windows(c,7,15,4,4.5,2.5,3);rect(c,6,20,19,2,'#6a8794');door(c,14,22,4,4);rect(c,6,8,7,3,'#d6d9c0');poly(c,[[8,8.5],[11,8.5],[11,10],[9.5,11],[8,10]],'#6b8b9a');rect(c,24,0,.7,9,'#596e67');line(c,[[21,2],[27,2]],'#647b71');car(c,3,28,'#d8d8c2');rect(c,5,28,2,3,'#658598');rect(c,4.4,27.7,2.8,.6,'#819eaf');car(c,23,28,'#d8d8c2');rect(c,25,28,2,3,'#658598');
  }else if(kind==='fire-station'){
    block(c,3,12,26,14,5,'#887967','#c4ad8e','flat');block(c,22,-1,7,23,6,'#93785c','#b59d7b');window(c,24,8,2.5,5);rect(c,23,15,4,1,cream);for(const x of [5,13]){rect(c,x,20,6,6,'#565e52');rect(c,x+.7,22,4.7,4,'#a3634f');rect(c,x+1,22.5,4,1.3,'#bed0be');rect(c,x+.6,26,1,1,'#434e45');rect(c,x+4,26,1,1,'#434e45');rect(c,x+1,24.5,4,.6,'#d4b07f');}rect(c,4,18,15,1,'#9f6f55');path(c,4,28,24,3);rect(c,25,26,1.5,3,'#aa8060');
  }else if(kind==='stadium'){
    oval(c,16,17,15,13,'#666f603a');oval(c,15,15,14.5,13,'#d3cbb0');oval(c,15,15,11.5,10.6,'#a18c6a');oval(c,15,15,10.4,9.5,'#c0a783');rect(c,7,7,16,16,'#76976a');for(let y=7;y<23;y+=4)rect(c,7,y,16,2,'#819f73');line(c,[[8,8],[22,8],[22,22],[8,22],[8,8]],'#dfe0bd',.6);line(c,[[8,15],[22,15]],'#dfe0bd',.6);c.strokeStyle='#dfe0bd';c.lineWidth=.6;c.beginPath();c.ellipse(15,15,2.7,2.8,0,0,Math.PI*2);c.stroke();line(c,[[12,8],[12,11],[18,11],[18,8]],'#dfe0bd',.6);line(c,[[12,22],[12,19],[18,19],[18,22]],'#dfe0bd',.6);rect(c,13,6.3,4,1.3,cream);rect(c,13,22,4,1.3,cream);for(const x of [1,26]){rect(c,x,5,4,21,'#899687');for(let y=7;y<24;y+=3)rect(c,x+.5,y,3,1,'#bcc3a9');}for(const [x,y] of [[3,3],[27,3],[3,28],[27,28]]){rect(c,x,y-4,.6,5,'#758376');rect(c,x-1,y-5,3,1,cream);}
  }else if(kind==='church'){
    path(c,13,23,7,8);block(c,5,13,23,10,5,'#818a80','#c7c5ac');block(c,10,5,13,21,9,'#6e8079','#dbd5b8');windows(c,12,18,3,3.5,1.6,4);block(c,12,0,8,27,6,'#a7ab94','#d9d0af','flat');poly(c,[[10,7],[16,-7],[22,7]],'#657a75');line(c,[[16,-8],[16,-4]],'#bcb99c',.8);line(c,[[14.5,-6.3],[17.5,-6.3]],'#bcb99c',.8);window(c,14,10,4,5);oval(c,16,20,2.3,3,'#697263');rect(c,13.7,20,4.6,7,'#697263');line(c,[[16,21],[16,27]],'#a5aa90',.6);tree(c,5,8,2.3);tree(c,27,9,2.3);for(const x of [4,25]){rect(c,x,25,2,2,'#b2b49e');rect(c,x+.6,24,.8,4,'#b2b49e');}
  }else if(kind==='pub'){
    block(c,5,3,22,23,9,'#8b6c53','#d9cfaf');rect(c,5,16,20,1,'#786b50');for(const x of [7,15,24])rect(c,x,13,1,12,'#897253');line(c,[[7,17],[15,24],[24,17]],'#8d7758',.7);windows(c,9,14,3,5,2.5,3);windows(c,8,21,2,13,3,3);door(c,15,21,4,5);chimney(c,22,2,6);line(c,[[27,14],[30,14],[30,17]],'#556359',.7);rect(c,28,16,4,5,'#697b5a');rect(c,29,17,1.5,2.5,'#d0b66e');rect(c,30.5,17.6,.6,1,'#d0b66e');for(const x of [5,23]){oval(c,x+1,29,2.7,1.6,'#9f8760');rect(c,x,29,2,1.8,'#aa9168');rect(c,x-2,27,1,3,'#8a795c');}flowerbed(c,9,29,4,'#caa175');
  }
}
function shop(c,kind,biome){
  plot(c,biome,'paved');
  if(kind==='shop-grocery'){
    block(c,4,5,24,21,8,'#7e917c','#d5c8a9');windows(c,6,15,4,5,2.5,3);awning(c,4,19,24,'#6f885e');rect(c,6,23,12,3,'#688782');door(c,22,22,4,5);for(let i=0;i<3;i++){rect(c,4+i*5,27,4,3,'#9c865e');for(let j=0;j<3;j++)oval(c,5+i*5+j,27.8,.6,.7,['#a8ad68','#bd956b','#aaa35d'][i]);}chimney(c,24,4,5);
  }else if(kind==='shop-bakery'){
    block(c,5,6,21,21,9,'#a98260','#dfcba6');gable(c,10,3,12,8,'#a88360');window(c,14,10,3,3);awning(c,5,19,21,'#af9770');rect(c,7,23,11,3,'#6b8682');door(c,21,22,3,5);for(let i=0;i<3;i++)oval(c,9+i*3,24.5,1.1,.65,'#d1b97e');chimney(c,6,2,10);rect(c,12,16,7,2,'#c7b18a');oval(c,15.5,17,2,.7,'#ece0b7');oval(c,8,29,2.5,1.1,'#a78d65');rect(c,8,29,.7,2,'#877255');
  }else if(kind==='shop-butcher'){
    block(c,5,2,23,24,8,'#817975','#c6b499');windows(c,8,13,3,6,3,4);rect(c,6,18,19,2,'#9d6f64');awning(c,5,20,23,'#a86f62');rect(c,7,24,12,2.5,'#6d8a85');door(c,23,23,3,4);for(const x of [10,15]){line(c,[[x,23],[x,24]],'#cbbd9d');oval(c,x,25,1,1.2,'#b58977');rect(c,x-.3,23.6,.7,.7,'#decdb0');}rect(c,2,27,3,4,'#897864');rect(c,2.5,27.5,2,2,'#d4c6a6');
  }else if(kind==='shop-hardware'){
    block(c,3,8,26,17,6,'#838e86','#b7b398','flat');rect(c,5,16,17,3,'#767e6d');line(c,[[10,16.5],[13,18.5]],'#dccdae',1.1);line(c,[[11,16.4],[9.7,18.3]],'#dccdae',1.3);rect(c,5,20,10,5,'#536d68');door(c,24,20,3,5);for(let i=0;i<3;i++)rect(c,17+i*2,19,1.4,8,'#b69e74');rect(c,3,27,9,3,'#9d855c');line(c,[[4,28],[10,28]],'#cfb787');rect(c,22,27,4,3,'#829287');rect(c,26,25,3,5,'#a18b61');rect(c,5,9,7,3,'#9fa692');
  }else if(kind==='shop-florist'){
    block(c,3,5,17,22,8,'#7c907c','#d4cab0');windows(c,6,15,2,6,3,3);awning(c,3,20,17,'#8f9770');door(c,13,23,4,4);rect(c,21,15,8,12,'#97b0a0');poly(c,[[20,15],[25,10],[30,15]],'#b5c7b1');line(c,[[25,11],[25,26]],'#e1dcc0');for(const y of [18,22])line(c,[[21,y],[29,y]],'#dcd7b8');rect(c,4,24,7,3,'#657b5a');for(let i=0;i<4;i++)pot(c,3+i*7,29);for(const [x,y,col] of [[5,23,'#c69d87'],[8,23,'#d8c283'],[23,20,'#b99399'],[27,24,'#e2c48c']]){oval(c,x,y,1.3,1,col);}
  }
}
function service(c,kind,biome){
  plot(c,biome,'paved');
  if(kind==='service-post-office'){
    block(c,5,4,23,22,8,'#8b846c','#d3c29d');gable(c,10,2,13,7,'#9d9071');rect(c,12,14,10,4,'#aa7d61');rect(c,14,15,6,2,'#e3d3ad');line(c,[[14,15],[17,16.5],[20,15]],'#8e755e',.5);windows(c,8,20,2,13,3,4);door(c,15,21,4,5);rect(c,2,24,3,6,'#a9735c');rect(c,2.4,25,2.2,.6,'#515e4f');rect(c,26,28,4,3,'#9a9478');
  }else if(kind==='service-bank'){
    block(c,4,7,25,20,5,'#87988b','#d2d0b5','flat');gable(c,3,2,26,10,'#b0b6a0');gable(c,7,5,18,6,'#d8d7bc');rect(c,15,8,3,2,'#8c9b89');rect(c,6,14,20,10,'#7c8d7e');for(const x of [7,12,19,24]){rect(c,x,13,2,12,'#e0dcc0');rect(c,x-.6,12,3.2,1,'#eeead1');rect(c,x-.5,24,3,1,'#d4d2b7');}door(c,15,20,3,5,'#617e74');for(let i=0;i<3;i++)rect(c,4-i,26+i,25+i*2,1,'#babaa1');pot(c,3,29);pot(c,28,29);
  }else if(kind==='service-hotel'){
    block(c,5,-1,23,28,8,'#7a847b','#d2c6a6');roof(c,9,-3,15,4,'#8d9586','flat');for(const x of [9,18]){gable(c,x,1,5,4,'#c4c3a6');window(c,x+1.5,4,2,3);}windows(c,8,10,4,5,2.5,4);windows(c,8,17,4,5,2.5,4);rect(c,5,15.5,21,.8,'#b9af8c');rect(c,13,22,8,5,'#5e7972');roof(c,11,23,12,2,'#8c775d','flat');rect(c,11,25,1,3,cream);rect(c,22,25,1,3,cream);rect(c,3,10,3,10,'#86785c');for(let i=0;i<4;i++)rect(c,3.8,11+i*2,1.5,.8,'#e5d3a6');path(c,11,29,13,2);pot(c,6,28);pot(c,26,28);
  }else if(kind==='service-garage'){
    block(c,3,12,27,14,6,'#7f8f88','#c3bda0','flat');block(c,4,4,8,16,6,'#8d988c','#ccc4a6','flat');window(c,6,14,4,4);rect(c,14,20,13,6,'#4c655c');rect(c,15,21,4,5,'#67766a');rect(c,22,21,4,5,'#67766a');car(c,19,25,'#bd9b67',true);rect(c,3,28,5,2,'#a19272');for(const x of [5,9]){oval(c,x,26,1.5,2,'#4f5b4f');oval(c,x,26,.65,1,'#9ba087');}line(c,[[16,14],[21,14],[21,15.5]],'#d7c9a7',1);rect(c,26,8,2,10,'#927b5b');rect(c,25,8,4,4,'#bba47b');rect(c,25.5,8.5,3,2,'#667969');
  }else if(kind==='service-barber'){
    block(c,7,1,18,25,9,'#6b817b','#c9bda0');windows(c,10,13,2,8,3,4);rect(c,8,19,15,2,'#827662');rect(c,10,22,7,4,'#6d938f');door(c,20,21,3,5);rect(c,26,19,2.5,7,'#e2dbc0');for(let y=19;y<26;y+=2)poly(c,[[26,y],[28.5,y+1],[28.5,y+2],[26,y+1]],'#ae7d6d');oval(c,27.25,18.7,1.5,.6,'#7e9182');oval(c,27.25,26.2,1.5,.6,'#7e9182');rect(c,4,27,3,4,'#8e8063');rect(c,4.5,27.5,2,2,'#cbb894');pot(c,9,28);chimney(c,21,0,5);
  }
}
export function drawTownBuilding(ctx,kind,biome,detailLevel='town',variant=0){
  finishes.set(ctx,{variant:Math.abs(Math.floor(variant))%12,biome,kind,detail:detailLevel});
  if(detailLevel==='region')regionalContexts.add(ctx);
  try {
    if(kind.startsWith('house-'))home(ctx,kind,biome);
    else if(kind.startsWith('shop-'))shop(ctx,kind,biome);
    else if(kind.startsWith('service-'))service(ctx,kind,biome);
    else civic(ctx,kind,biome);
    if(biome==='tundra'){
      // Small drifts preserve the roof materials while seating every sprite in the snow.
      poly(ctx,[[2,29],[8,29],[10,30],[8,31],[2,31]],'#e0e5d4');
      poly(ctx,[[25,27],[29,27],[30,29],[26,30]],'#dbe1d0');
    }
  } finally { regionalContexts.delete(ctx);finishes.delete(ctx); }
}
