// Native relief artwork: one seeded landform, with less surface detail at a distance.
// Geometry is generated before profile-dependent drawing so zoom never reshapes it.
const COLORS = {
  taiga: {base:'#899184',shade:'#68766d',deep:'#596b63',face:'#a4aa98',light:'#bdc1ac',high:'#d0d2bc',scree:'#a5a88e',snow:'#e2e5d5',ice:'#b4c9c3'},
  tundra:{base:'#98aaa7',shade:'#788e91',deep:'#617b83',face:'#b2bfba',light:'#cdd6c9',high:'#e0e4d6',scree:'#a9b6aa',snow:'#edf0df',ice:'#a4c1c5'},
  desert:{base:'#b29274',shade:'#96765f',deep:'#806750',face:'#c4a481',light:'#dac09a',high:'#e6cea9',scree:'#b7a17d',snow:'#e1cba6',ice:'#bfb496'},
};
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
function path(c,points){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();}
function poly(c,points,color){path(c,points);c.fillStyle=color;c.fill();}
function line(c,points,color,width=.7){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.lineJoin='round';c.stroke();}
function oval(c,x,y,rx,ry,color){c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=color;c.fill();}
function talus(c,points,color){c.save();c.globalAlpha=.5;poly(c,points,color);c.restore();}
function bounded(c){c.save();c.beginPath();c.rect(0,-7,32,39);c.clip();}
function noise(r,count){return Array.from({length:count},()=>r());}

// Texture follows a slope rather than a regular grid of speckles. Every mark is
// generated even when omitted in Region, keeping later objects on the same seed.
function surface(c,marks,p,profile,desert=false){
  marks.forEach((v,i)=>{
    if(profile==='region'&&i%5!==0||profile==='town'&&i%2!==0)return;
    const x=1+v[0]*30,y=5+v[1]*26,w=.7+v[2]*2.6;
    line(c,[[x,y],[x+w*.5,y-.45],[x+w,y-.25]],i%3?p.light:p.deep,profile==='region'?.7:.45);
    if(profile==='detail'&&i%4===0)line(c,[[x,y+.65],[x+w*.35,y+1.4]],desert?p.shade:p.scree,.4);
  });
}

function rockyMassif(c,detail,n,marks,p,biome,profile){
  const ridge=/ridge/.test(detail),ice=detail==='ice-peak',low=/foothill/.test(detail);
  const count=ridge?2+(n[0]>.58?1:0):1+(n[0]>.47?1:0)+(n[0]>.88?1:0);
  const peaks=[];
  for(let i=0;i<count;i++){
    const x=count===1?11+n[1]*10:5+(i+.32+n[2+i]*.34)*23/count;
    const y=low?10+n[5+i]*5:ice?-5+n[5+i]*5:(ridge?1: -2)+n[5+i]*(ridge?9:8);
    peaks.push([x,y]);
  }
  // Each crest has a ledge, a broken crown and a shoulder. It reads as a massif
  // instead of several identical triangular cones when neighboring tiles meet.
  const contour=[[.7,27.8],[1.3,23+n[10]*3],[3,19+n[11]*4]];
  for(let i=0;i<peaks.length;i++){
    const [x,y]=peaks[i],previous=peaks[i-1],left=previous?(previous[0]+x)/2:x-4.8;
    if(previous)contour.push([left-1,Math.max(previous[1],y)+6+n[12+i]*3],[left+.4,Math.max(previous[1],y)+4.8]);
    else contour.push([Math.max(3,x-6),y+9],[Math.max(4,x-3.8),y+5.6]);
    contour.push([x-2,y+1.5+n[15+i]],[x-.5,y+.8],[x+.4,y],[x+1.7,y+.5],[x+3,y+3+n[18+i]*2]);
  }
  const last=peaks.at(-1);contour.push([Math.min(28,last[0]+5.3),last[1]+9],[29,20+n[22]*3],[30.6,27.8],[28.5,30],[22,31],[15,30.6],[8,31],[2.2,30]);
  poly(c,contour,low?(biome==='tundra'?'#a0afa0':'#8b9a7e'):p.base);
  c.save();path(c,contour);c.clip();
  for(let i=0;i<peaks.length;i++){
    const [x,y]=peaks[i],foot=clamp(x-5+n[24+i]*7,4,27),next=peaks[i+1];
    poly(c,[[x-5,y+8],[x-.5,y+.8],[x+1.3,y+4.6],[x-.8,y+10],[foot+1,21],[foot-2,27],[Math.max(0,x-11),30],[x-8,23]],p.face);
    poly(c,[[x+.4,y],[x+3,y+3+n[18+i]*2],[next?(x+next[0])/2+1:x+6,y+13],[x+9,30],[foot+2,28],[x+1.6,y+15],[x+2.2,y+8]],p.shade);
    poly(c,[[x-1.8,y+2],[x-.5,y+.8],[x+1.1,y+4.4],[x-.8,y+10],[foot-1,24],[foot-4,28],[foot-2,20],[x-3,y+10]],low?'#adb79b':p.light);
    // Branching gullies break up the large faces without dark contour outlines.
    const gully=[[x+2.2,y+8],[x+1,y+13],[x+3.5,y+18],[x+2.6,24],[x+7,29.5]];
    line(c,gully,p.deep,profile==='region'?.8:.65);
    line(c,[[x+1,y+13],[x+5,y+16],[x+6.7,23]],p.base,.65);
    line(c,[[x-2,y+10],[x-4,y+16],[foot-2,23]],p.high,profile==='region'?.7:.55);
    if(biome==='tundra'||/snow|ice|glacial|peak/.test(detail)&&biome!=='desert'&&!low){
      const snowline=y+(biome==='tundra'?9:5.2)+n[30+i]*2;
      poly(c,[[x-4,y+5.8],[x-2,y+1.5+n[15+i]],[x+.4,y],[x+1.7,y+.5],[x+3,y+3+n[18+i]*2],[x+4.7,snowline],[x+2.8,snowline-1.5],[x+1.7,snowline+2.8],[x+.4,y+5.7],[x-1,snowline-.5],[x-2.6,snowline+1.5],[x-2.9,snowline-2.2],[x-5,snowline]],p.snow);
      poly(c,[[x+.4,y+.5],[x+1.7,y+1],[x+3,y+4],[x+4.7,snowline],[x+2.8,snowline-1.5],[x+1.7,snowline+2.8],[x+1.3,y+6]],p.ice);
      if(biome==='tundra')poly(c,[[x-2.2,snowline+1],[x-3,18],[x-5,23],[x-7,26],[x-4.3,24],[x-1.6,20],[x-.8,15]],p.light);
    }
  }
  // Broad talus aprons soften the transition into the ground.
  talus(c,[[1,29],[5,25],[8,27],[12,25.5],[17,28],[24,25.5],[30,28],[28,30.5],[21,31],[14,29.8],[7,30.7]],p.scree);
  surface(c,marks,p,profile);
  c.restore();
  if(detail==='wooded-foothill')for(let i=0;i<7;i++){
    const x=3+n[35+i]*25,y=23+n[42+i]*6;
    oval(c,x,y,1.2+n[49+i]*1.4,.8+n[56+i]*.6,i%2?'#74876c':'#657e68');
    if(profile!=='region')line(c,[[x-.7,y-.5],[x,y-1.1],[x+.8,y-.6]],'#a4b38b',.55);
  }
}

function mesa(c,detail,n,marks,p,profile){
  const narrow=detail==='butte',count=narrow?(n[0]>.58?2:1):(n[0]>.72?2:1);
  const formations=Array.from({length:count},(_,i)=>({
    cx:count===1?13+n[1]*6:9+i*14+(n[2+i]-.5)*3,
    width:narrow?6+n[4+i]*5:15+n[4+i]*7,
    top:(narrow?-3:2)+n[6+i]*7,base:28+n[8+i]*2,
  }));
  for(let i=formations.length-1;i>=0;i--){
    const f=formations[i],left=clamp(f.cx-f.width/2,2,26),right=clamp(f.cx+f.width/2,6,30),top=f.top;
    const crown=[[left-1,top+4],[left+.5,top+1.6],[left+2,top+1.5],[left+2.6,top],[right-3,top+.4+n[12+i]],[right-1.5,top-.3],[right+.3,top+2.2],[right,top+5]];
    const shape=[[Math.max(.4,left-5),f.base],[left-2,top+17],[left-.2,top+12],...crown,[right-.9,top+11],[right+1,top+17],[Math.min(31.5,right+5),f.base],[f.cx+4,31],[f.cx-7,30.7]];
    poly(c,shape,p.base);c.save();path(c,shape);c.clip();
    poly(c,[[f.cx+1,top+3],[right,top+3],[right-1,top+11],[right+1,top+17],[right+5,f.base],[f.cx+3,28],[f.cx-1,20]],p.shade);
    poly(c,[[left-2,top+5],[left+2,top+4],[left+1,top+13],[left+3,top+20],[left-3,29],[left-5,28]],p.face);
    // Uneven sediment shelves and vertical gullies remain readable at 50% zoom.
    for(let band=0;band<5;band++){
      const y=top+6+band*4+n[16+band]*1.2;
      poly(c,[[left-5,y+.3],[left+2,y-1],[f.cx,y],[right+4,y-.8],[right+5,y+.6],[f.cx,y+1.6],[left-5,y+1.2]],band%2?p.face:p.light);
    }
    for(let crack=0;crack<3;crack++){
      const x=left+2+(right-left-3)*n[22+crack];
      line(c,[[x,top+5],[x-.6,top+10],[x+1,top+15],[x-.5,top+21],[x-2,28]],crack%2?p.base:p.deep,profile==='region'?.8:.6);
      if(profile!=='region')line(c,[[x-.9,top+9],[x-1.4,top+13],[x-.4,top+17]],p.light,.5);
    }
    surface(c,marks,p,profile,true);c.restore();
    poly(c,[...crown.slice(0,7),[right-1,top+4],[f.cx+1,top+5.3],[left+2,top+4.7]],p.light);
    line(c,[[left+.7,top+1.9],[left+2.7,top+.5],[right-3,top+1],[right-1.5,top+.3]],p.high,profile==='region'?.7:.55);
    talus(c,[[Math.max(0,left-4),28],[left-1,24.5],[left+1,26],[f.cx,28],[right+1,26],[Math.min(32,right+5),29.7],[f.cx+2,31],[left-4,30]],p.scree);
  }
}

function canyon(c,n,marks,p,profile){
  const gap=12+n[0]*7,depth=7+n[1]*4;
  const faces=[[[.5,29],[1,12],[3,8],[8,5+n[2]*3],[gap-2,7],[gap+1,10],[gap-2,16],[gap-4,23],[gap-7,31]],[[gap+1,31],[gap+4,22],[gap+4,15],[gap+6,depth],[28,depth-2],[31,depth+3],[31.5,29]]];
  poly(c,[[gap-7,31],[gap-2,16],[gap+1,10],[gap+6,depth],[gap+4,22],[gap+1,31]],p.deep);
  faces.forEach((face,i)=>{
    poly(c,face,i?p.shade:p.base);c.save();path(c,face);c.clip();
    for(let k=0;k<5;k++){
      const y=13+k*3.5+n[5+k];
      poly(c,[[0,y],[10,y-2],[20,y+1],[32,y-1],[32,y+1],[20,y+2.8],[10,y-.5],[0,y+1.3]],k%2?p.face:p.light);
    }
    line(c,[[i?28:6,11],[i?27:7,18],[i?29:5,25],[i?28:3,30]],p.deep,.7);
    surface(c,marks,p,profile,true);c.restore();
    const top=i?[[gap+4,15],[gap+6,depth],[28,depth-2],[31,depth+3],[27,depth+4],[gap+7,depth+3]]:[[1,12],[3,8],[8,5+n[2]*3],[gap-2,7],[gap+1,10],[gap-3,11],[8,9],[4,12]];
    poly(c,top,p.light);line(c,top.slice(0,4),p.high,.65);
  });
  line(c,[[gap+1,12],[gap-1,20],[gap-3,25],[gap-4,31]],p.scree,profile==='region'?1.5:1);
}

function glacier(c,n,marks,p,profile){
  const x=12+n[0]*7,top=-2+n[1]*5;
  const shape=[[.5,28],[3,20],[5,11],[x-6,top+4],[x-2,top],[x+2,top+.6],[x+5,top+5],[27,13],[29,23],[31.5,29],[24,31],[15,30],[8,31]];
  poly(c,shape,p.shade);c.save();path(c,shape);c.clip();
  poly(c,[[2,26],[6,13],[x-6,top+4],[x-2,top],[x+2,top+.6],[x+5,top+5],[26,14],[28,26],[22,29],[15,26],[8,29]],p.light);
  poly(c,[[6,14],[x-6,top+4],[x-2,top],[x+1,top+.8],[x+3,top+7],[20,14],[25,20],[24,25],[19,27],[16,23],[10,26],[6,25],[9,21]],p.snow);
  poly(c,[[x+1,top+.8],[x+5,top+5],[26,14],[28,26],[23,28],[23,22],[19,16],[x+3,top+7]],p.ice);
  for(let i=0;i<4;i++){
    const xx=7+i*4.5+n[4+i]*2,yy=11+n[8+i]*8;
    line(c,[[xx-1,yy-3],[xx,yy],[xx-1,yy+2],[xx+2,yy+5]],p.shade,profile==='region'?.85:.65);
    line(c,[[xx-.4,yy-2.8],[xx+.6,yy-.2],[xx-.4,yy+1.8]],p.high,.5);
  }
  talus(c,[[1,28],[5,24],[8,29],[13,27],[18,29],[24,28],[30,26],[30,30],[22,31],[15,29.5],[7,30.7]],p.scree);
  surface(c,marks,p,profile);c.restore();
}

export function drawMountain(c,detail,r,biome,profile='town'){
  const p=COLORS[biome]||COLORS.taiga,n=noise(r,68),marks=Array.from({length:32},()=>noise(r,3));
  bounded(c);
  // A ridge never occupies precisely the same footprint as its neighbor. Moving
  // its foot as well as its summit prevents dense ranges becoming rows of icons.
  const width=.63+n[63]*.36,base=23+n[64]*8;
  const height=Math.min(.67+n[65]*.34,(base+6)/37);
  const left=(32-32*width)*(.12+n[66]*.76);
  c.translate(left,base-31*height);c.scale(width,height);
  oval(c,15+n[67]*3,29.8,11+n[62]*3,1.2+n[61]*.5,'#34473618');
  if(detail==='mesa'||detail==='butte'||biome==='desert'&&!['canyon','cliff'].includes(detail))mesa(c,detail,n,marks,p,profile);
  else if(detail==='canyon'||detail==='cliff')canyon(c,n,marks,p,profile);
  else if(detail==='glacier')glacier(c,n,marks,p,profile);
  else rockyMassif(c,detail,n,marks,p,biome,profile);
  c.restore();
}

export function drawBoulder(c,x,y,size,r,biome,profile='town'){
  const p=COLORS[biome]||COLORS.taiga,n=noise(r,42);
  const w=size*(.44+n[0]*.23),h=size*(.35+n[1]*.37),lean=(n[2]-.5)*w*.65;
  // Unequal shoulders and chipped edges produce rounded erratics, split slabs,
  // and squat outcrops from one silhouette generator.
  const points=[[x-w,y-.12*h],[x-w*(.91+n[3]*.13),y-h*.45],[x-w*.7+lean,y-h*(.72+n[4]*.16)],[x-w*.3+lean,y-h*(.88+n[5]*.12)],[x+w*.12+lean,y-h],[x+w*.55,y-h*(.66+n[6]*.27)],[x+w*(.85+n[7]*.13),y-h*.51],[x+w,y-h*.13],[x+w*.59,y+h*.1],[x-w*.3,y+h*.08]];
  bounded(c);oval(c,x+w*.2,y+.5,w*1.08,Math.max(.7,h*.25),'#34473629');
  poly(c,points,p.shade);c.save();path(c,points);c.clip();
  poly(c,[points[0],points[1],points[2],points[3],points[4],[x+w*.16,y-h*.37],[x-w*.2,y-h*.03]],p.face);
  poly(c,[points[2],points[3],points[4],points[5],[x+w*.33,y-h*.52],[x-w*.23,y-h*.42]],p.light);
  poly(c,[points[5],points[6],points[7],points[8],[x+w*.37,y-h*.19],[x+w*.33,y-h*.52]],p.base);
  if(n[8]>.4)poly(c,[[x+lean,y-h],[x+w*.1,y-h*.52],[x-w*.08,y-h*.15],[x+w*.08,y],[x-w*.1,y],[x-w*.22,y-h*.19],[x-w*.05,y-h*.57]],p.shade);
  if(profile!=='region'){
    line(c,[[x-w*.55,y-h*.72],[x-w*.12,y-h*.5],[x+w*.05,y-h*.13]],p.deep,.4);
    for(let i=0;i<7;i++){
      const xx=x-w+n[10+i]*w*2,yy=y-h+n[18+i]*h;
      if(profile==='detail'||i%2===0)line(c,[[xx,yy],[xx+.45+n[26+i]*.8,yy-.15]],i%2?p.high:p.base,.4);
    }
  }
  if(biome==='tundra'&&n[9]>.25)poly(c,[points[2],points[3],points[4],points[5],[x+w*.34,y-h*.62],[x,y-h*.72],[x-w*.25,y-h*.61]],p.snow);
  c.restore();
  for(let i=0;i<2;i++){
    const xx=x+(i?1:-1)*w*(.7+n[34+i]*.35),yy=y+.2+n[36+i]*.6,s=Math.max(.65,size*(.09+n[38+i]*.09));
    poly(c,[[xx-s,yy],[xx-s*.7,yy-s*.6],[xx+s*.2,yy-s],[xx+s,yy-s*.25],[xx+s*.7,yy+.2]],i?p.base:p.face);
  }
  c.restore();
}
